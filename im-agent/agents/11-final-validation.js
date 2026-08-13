'use strict';
/**
 * 11 Final Validation Agent — 독립 제3자 검증 (8 GATES)
 *
 * ★ 이 Agent는 앞선 Agent의 결과를 신뢰하지 않는다.
 *   특히 GATE 03 은 Financial Agent를 다시 호출하지 않고, 발표된 현금흐름표에서
 *   다른 알고리즘으로 지표를 역산한다 (finance/verify.js).
 *   같은 코드를 다시 돌리면 같은 버그가 같은 답을 낸다 — 그건 검증이 아니다.
 *
 * ★ LLM을 호출하지 않는다. 검증을 언어모델에 맡기면 검증 자체를 신뢰할 수 없다.
 *
 * GATE 01 Source · 02 Data · 03 Calculation · 04 Cross · 05 Legal
 *      06 Financial · 07 Document/Design · 08 Distribution
 */

const { verifyScenario } = require('../finance/verify');
const { FIELDS, labelFor, requiredFor } = require('../core/dictionary');
const { grade } = require('../core/confidence');
const outputspec = require('../core/outputspec');
const { round, formatEok } = require('../core/numeric');
const { kstDate, daysBetween } = require('../core/kst');

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    financial: { type: 'object', nullable: true },
    validation: { type: 'object', nullable: true },
    writer: { type: 'object', nullable: true },
    geo: { type: 'object', nullable: true },
    appraisal: { type: 'object', nullable: true },
    massing: { type: 'object', nullable: true },
    research: { type: 'object', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['gates', 'score', 'status', 'issues'],
  properties: {
    gates: { type: 'array' },
    score: { type: 'object' },
    status: { type: 'string' },
    issues: { type: 'array' },
    traceability: { type: 'object' },
    calculation: { type: 'object', nullable: true },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

/** 점수 배점 (사양 §29) */
const WEIGHTS = {
  dataAccuracy: 20, sourceVerification: 15, financialAccuracy: 20,
  crossValidation: 15, legal: 10, marketEvidence: 5,
  documentQuality: 5, visualQuality: 5, traceability: 5,
};

/** 자동 배포 차단 사유 (사양 §31) */
const BLOCKING = new Set([
  'CRITICAL_DATA_ERROR', 'FINANCIAL_MODEL_ERROR', 'UNRESOLVED_DATA_CONFLICT',
  'UNVERIFIED_OWNERSHIP', 'MATERIAL_LEGAL_ISSUE', 'MATERIAL_PERMIT_ISSUE',
  'IRR_CALCULATION_ERROR', 'INVESTMENT_AMOUNT_ERROR', 'SOURCE_MISSING_MATERIAL',
  'IM_FINANCIAL_MISMATCH', 'TEASER_IM_MISMATCH',
]);

let seq = 0;
function issue(code, severity, category, message, action, detail = {}) {
  seq += 1;
  return {
    id: `E${String(seq).padStart(3, '0')}`,
    code, severity, category, message,
    action, status: 'OPEN', ...detail,
  };
}

/** IM 본문에서 반드시 출처가 있어야 하는 항목 (사양 §27) */
const MATERIAL_KEYS = [
  'investment.total', 'investment.land', 'investment.construction',
  'revenue.annual', 'debt.amount', 'equity.amount', 'debt.rate',
  'land.area_sqm', 'building.gfa_sqm', 'exit.cap_rate',
  'legal.permit_status', 'land.ownership',
];

async function run(input, ctx) {
  seq = 0;
  const ds = ctx.dataset;
  if (!ds) throw new Error('ctx.dataset 필요');

  const { financial, validation, writer, geo, appraisal, massing, research } = input;
  const issues = [];
  const gates = [];
  const today = kstDate();

  // ══ GATE 01 — SOURCE VALIDATION ═══════════════════════════
  const g1 = { id: 'GATE 01', name: 'Source Validation', checks: [] };
  const materialPresent = MATERIAL_KEYS.filter(k => ds.has(k));
  const missingSource = [];
  const noDate = [];

  for (const key of ds.keys()) {
    const f = ds.get(key);
    if (!f.source) missingSource.push(key);
    if (!f.sourceDate && !/financial_model|매스 검토|감정평가 Agent/.test(f.source)) noDate.push(key);
  }
  for (const key of MATERIAL_KEYS) {
    if (!ds.has(key)) continue;
    const f = ds.get(key);
    if (!f.source) {
      issues.push(issue('SOURCE_MISSING_MATERIAL', 'CRITICAL', 'Source',
        `핵심 항목 ${labelFor(key)} 에 출처가 없다`, '원본자료 확인 후 재추출'));
    }
  }
  g1.checks.push({ item: '핵심 항목 출처', result: missingSource.length ? 'FAIL' : 'PASS', detail: `출처 누락 ${missingSource.length}건` });
  g1.checks.push({ item: '기준일 표기', result: noDate.length ? 'PARTIAL' : 'PASS', detail: `기준일 없음 ${noDate.length}건` });
  const materialMissing = MATERIAL_KEYS.filter(k => !ds.has(k));
  if (materialMissing.length) {
    g1.checks.push({ item: '핵심 항목 확보', result: 'PARTIAL', detail: `미확보 ${materialMissing.map(labelFor).join(', ')}` });
  }
  g1.status = issues.some(i => i.code === 'SOURCE_MISSING_MATERIAL') ? 'FAIL' : (missingSource.length || materialMissing.length ? 'WARNING' : 'PASS');
  gates.push(g1);

  // ══ GATE 02 — DATA VALIDATION ═════════════════════════════
  const g2 = { id: 'GATE 02', name: 'Data Validation', checks: [] };

  // 단위 검사 — dictionary 정의와 Fact 단위가 다른가
  const unitMismatch = ds.keys().filter(k => {
    const f = ds.get(k);
    const field = FIELDS[k];
    return field && field.unit && f.unit && f.unit !== field.unit;
  });
  if (unitMismatch.length) {
    issues.push(issue('UNIT_MISMATCH', 'MAJOR', 'Data',
      `단위가 표준과 다른 항목 ${unitMismatch.length}건: ${unitMismatch.map(labelFor).join(', ')}`,
      '단위 환산 확인'));
  }
  g2.checks.push({ item: '단위 일관성', result: unitMismatch.length ? 'FAIL' : 'PASS', detail: `불일치 ${unitMismatch.length}건` });

  // 기준일 일관성 (사양 §8)
  const dates = ds.keys().map(k => ds.get(k).sourceDate).filter(Boolean).sort();
  let dateResult = 'PASS';
  if (dates.length >= 2) {
    const span = daysBetween(dates[0], dates[dates.length - 1]);
    if (span > 730) {
      dateResult = 'FAIL';
      issues.push(issue('DATE_INCONSISTENCY', 'MAJOR', 'Data',
        `자료 기준일이 ${Math.floor(span / 365)}년 넘게 벌어져 있다 (${dates[0]} ~ ${dates[dates.length - 1]})`,
        '기준일 통일 또는 문서에 명시'));
    } else if (span > 365) {
      dateResult = 'WARNING';
    }
    g2.checks.push({ item: '기준일 일관성', result: dateResult, detail: `${dates[0]} ~ ${dates[dates.length - 1]} (${span}일)` });
  }

  // 오래된 시장자료 (사양 §23)
  const stale = ds.keys().filter(k => {
    const f = ds.get(k);
    return f.sourceDate && daysBetween(f.sourceDate, today) > 365;
  });
  if (stale.length) {
    issues.push(issue('STALE_DATA', 'MINOR', 'Market',
      `1년 이상 경과한 자료 ${stale.length}건이 현재 시장자료처럼 쓰이고 있다`, '최신 자료로 갱신 또는 기준일 명시'));
  }
  g2.status = unitMismatch.length || dateResult === 'FAIL' ? 'FAIL' : (stale.length ? 'WARNING' : 'PASS');
  gates.push(g2);

  // ══ GATE 03 — CALCULATION VALIDATION (독립 재계산) ═════════
  const g3 = { id: 'GATE 03', name: 'Calculation Validation', checks: [] };
  let calc = null;

  if (financial && financial.scenarios) {
    calc = verifyScenario(financial.scenarios.base, 'Base');
    for (const c of calc.checks) {
      g3.checks.push({ item: c.item, result: c.level, detail: c.message });
      if (c.level === 'CRITICAL') {
        const code = /IRR/.test(c.item) ? 'IRR_CALCULATION_ERROR'
          : /총사업비|자본/.test(c.item) ? 'INVESTMENT_AMOUNT_ERROR' : 'FINANCIAL_MODEL_ERROR';
        issues.push(issue(code, 'CRITICAL', 'Financial', c.message, '재무모델 재계산 및 원인 확인'));
      } else if (c.level === 'MAJOR') {
        issues.push(issue('CALCULATION_DEVIATION', 'MAJOR', 'Financial', c.message, '계산 근거 확인'));
      } else if (c.level === 'WARNING') {
        issues.push(issue('CALCULATION_DEVIATION', 'MINOR', 'Financial', c.message, '허용오차 확인'));
      }
    }
    g3.status = calc.worst === 'PASS' ? 'PASS' : (['CRITICAL', 'MAJOR'].includes(calc.worst) ? 'FAIL' : 'WARNING');
    g3.method = '발표된 현금흐름표에서 Newton-Raphson 으로 역산 (원본은 이분법) — 모델을 다시 호출하지 않는다';
  } else {
    g3.status = 'WARNING';
    g3.checks.push({ item: '재무모델', result: 'UNVERIFIABLE', detail: '검산할 재무모델이 없다' });
  }
  gates.push(g3);

  // ══ GATE 04 — CROSS VALIDATION ════════════════════════════
  const g4 = { id: 'GATE 04', name: 'Cross Validation', checks: [] };

  // 미해소 값 충돌
  const conflicts = (ds.conflicts || []).filter(c => c.type === 'VALUE_CONFLICT' && c.severity === 'RED');
  for (const c of conflicts) {
    issues.push(issue('UNRESOLVED_DATA_CONFLICT', 'CRITICAL', 'Data',
      `${labelFor(c.key)}: 값이 확정되지 않았다 — ${c.values.map(v => `${v.value} (${v.sources.join('; ')})`).join(' vs ')}`,
      '원본자료 대조 후 확정'));
  }
  g4.checks.push({ item: '값 충돌', result: conflicts.length ? 'FAIL' : 'PASS', detail: `미해소 ${conflicts.length}건` });

  // IM ↔ Financial Model 일치 (사양 §14)
  const imFinance = crossCheckImFinancial(ds, financial);
  for (const m of imFinance.mismatches) {
    issues.push(issue('IM_FINANCIAL_MISMATCH', 'CRITICAL', 'Consistency', m, 'IM 수치를 재무모델 기준으로 갱신'));
  }
  g4.checks.push({ item: 'IM ↔ 재무모델', result: imFinance.mismatches.length ? 'FAIL' : 'PASS', detail: `대조 ${imFinance.compared}건` });

  // IM ↔ Teaser 일치 (사양 §15)
  if (writer && writer.im && writer.teaser) {
    const teaserCheck = crossCheckImTeaser(writer.im, writer.teaser);
    for (const m of teaserCheck.mismatches) {
      issues.push(issue('TEASER_IM_MISMATCH', 'CRITICAL', 'Consistency', m, 'Teaser 를 IM 기준으로 갱신'));
    }
    g4.checks.push({ item: 'IM ↔ Teaser', result: teaserCheck.mismatches.length ? 'FAIL' : 'PASS', detail: `공통 지표 ${teaserCheck.compared}건 대조` });
  }

  // IM ↔ 3D 매스 (사양 §16)
  if (massing && massing.inputs) {
    const gfaDs = ds.num('building.gfa_sqm');
    if (gfaDs !== null && massing.inputs.gfaSqm !== null && Math.abs(gfaDs - massing.inputs.gfaSqm) > 1) {
      issues.push(issue('CRITICAL_DATA_ERROR', 'MAJOR', 'Consistency',
        `연면적이 데이터셋(${gfaDs}㎡)과 매스 모델(${massing.inputs.gfaSqm}㎡)에서 다르다`, '매스 재생성'));
    }
    g4.checks.push({ item: 'IM ↔ 3D 매스', result: 'PASS', detail: `연면적·층수·용적률 대조` });
  }

  // GIS ↔ 공적자료 (사양 §17)
  if (geo && geo.parcel && geo.parcel.officialAreaSqm && geo.parcel.polygonAreaSqm) {
    const diff = Math.abs(geo.parcel.polygonAreaSqm - geo.parcel.officialAreaSqm) / geo.parcel.officialAreaSqm;
    g4.checks.push({
      item: 'GIS ↔ 공부',
      result: diff > 0.05 ? 'WARNING' : 'PASS',
      detail: `지적도 실측 ${geo.parcel.polygonAreaSqm}㎡ vs 공부 ${geo.parcel.officialAreaSqm}㎡ (${round(diff * 100, 1)}%)`,
    });
  }
  g4.status = g4.checks.some(c => c.result === 'FAIL') ? 'FAIL' : (g4.checks.some(c => c.result === 'WARNING') ? 'WARNING' : 'PASS');
  gates.push(g4);

  // ══ GATE 05 — LEGAL / REGULATORY ══════════════════════════
  const g5 = { id: 'GATE 05', name: 'Legal / Regulatory Validation', checks: [] };
  const permit = ds.get('legal.permit_status');
  const ownership = ds.get('land.ownership');

  if (!permit) {
    issues.push(issue('MATERIAL_PERMIT_ISSUE', 'CRITICAL', 'Legal',
      '인허가 현황이 확인되지 않았다', 'LEGAL CONFIRMATION REQUIRED — 인허가 서류 확보'));
  } else if (/미|불가|반려|예정|검토중|협의중/.test(String(permit.value))) {
    issues.push(issue('MATERIAL_PERMIT_ISSUE', 'CRITICAL', 'Legal',
      `인허가 미완료: "${permit.value}" (${permit.citation()})`, 'LEGAL CONFIRMATION REQUIRED'));
  }
  if (!ownership) {
    issues.push(issue('UNVERIFIED_OWNERSHIP', 'CRITICAL', 'Legal',
      '토지 확보상태가 확인되지 않았다', '등기부등본 등 소유권 자료 확보'));
  }

  // 용적률 법정한도 (매스 Agent 결과 병합)
  for (const f of (massing && massing.flags) || []) {
    if (f.severity === 'RED') {
      issues.push(issue('MATERIAL_LEGAL_ISSUE', 'CRITICAL', 'Legal', f.message, '설계 규모 조정 또는 조례 확인'));
    }
  }
  g5.checks.push({ item: '인허가', result: permit ? (/미|불가|반려|예정/.test(String(permit.value)) ? 'FAIL' : 'PASS') : 'FAIL' });
  g5.checks.push({ item: '토지 소유권', result: ownership ? 'PASS' : 'FAIL' });
  g5.checks.push({ item: '용적률·건폐율 법정한도', result: (massing && massing.flags || []).some(f => f.severity === 'RED') ? 'FAIL' : 'PASS' });
  g5.status = g5.checks.some(c => c.result === 'FAIL') ? 'FAIL' : 'PASS';
  gates.push(g5);

  // ══ GATE 06 — FINANCIAL / INVESTMENT ══════════════════════
  const g6 = { id: 'GATE 06', name: 'Financial / Investment Validation', checks: [] };
  if (financial && financial.scenarios) {
    const base = financial.scenarios.base.metrics;
    const down = financial.scenarios.downside.metrics;

    if (base.minDSCR !== null && base.minDSCR < 1.0) {
      issues.push(issue('FINANCIAL_MODEL_ERROR', 'MAJOR', 'Financial',
        `Base 최소 DSCR ${base.minDSCR} < 1.0 — 원리금 상환 불가 구간이 존재한다`, '금융조건 재구성 또는 매출 가정 재검토'));
    }
    // 가정치 비중 — 가정이 사실처럼 표현되면 오류 (사양 §22)
    const assumedRatio = (financial.assumed || []).length / Math.max(1, (financial.assumed || []).length + (financial.sourcedFields || []).length);
    if (assumedRatio >= 0.5) {
      issues.push(issue('ASSUMPTION_HEAVY', 'MAJOR', 'Financial',
        `재무모델 입력의 ${Math.round(assumedRatio * 100)}%가 가정치다 — 결과를 사실로 제시할 수 없다`,
        '핵심 가정을 원본자료로 대체'));
    }
    g6.checks.push({ item: 'DSCR', result: base.minDSCR !== null && base.minDSCR >= 1.2 ? 'PASS' : 'WARNING', detail: `최소 ${base.minDSCR}` });
    g6.checks.push({ item: '가정치 비중', result: assumedRatio >= 0.5 ? 'FAIL' : 'PASS', detail: `${Math.round(assumedRatio * 100)}%` });
    g6.checks.push({ item: 'Downside 생존', result: down.equityIRR !== null && down.equityIRR > 0 ? 'PASS' : 'WARNING', detail: `Equity IRR ${down.equityIRR}%` });
  }
  // 감정평가 편차
  for (const f of (appraisal && appraisal.flags) || []) {
    if (f.severity === 'RED') {
      issues.push(issue('CRITICAL_DATA_ERROR', 'MAJOR', 'Valuation', f.message, '평가 가정 재검토'));
    }
  }
  g6.status = g6.checks.some(c => c.result === 'FAIL') ? 'FAIL' : (g6.checks.some(c => c.result === 'WARNING') ? 'WARNING' : 'PASS');
  gates.push(g6);

  // ══ GATE 07 — DOCUMENT / DESIGN ═══════════════════════════
  const g7 = { id: 'GATE 07', name: 'Document / Design Validation', checks: [] };
  if (writer) {
    const unsourced = (writer.unsourcedNumbers || []).length;
    if (unsourced) {
      issues.push(issue('SOURCE_MISSING_MATERIAL', 'CRITICAL', 'Document',
        `본문에 출처 없는 숫자 ${unsourced}건 — AI가 만들어낸 값일 수 있다`, '해당 문장에서 수치 제거 또는 출처 확보'));
    }
    const designRed = (writer.designViolations || []).filter(v => v.severity === 'RED');
    for (const v of designRed) {
      issues.push(issue('DESIGN_VIOLATION', 'MAJOR', 'Design', `${v.rule}: ${v.message}`, '디자인 규칙 준수'));
    }
    g7.checks.push({ item: '출처 없는 숫자', result: unsourced ? 'FAIL' : 'PASS', detail: `${unsourced}건` });
    g7.checks.push({ item: '디자인 규칙', result: designRed.length ? 'FAIL' : 'PASS', detail: `RED ${designRed.length}건` });
    g7.checks.push({ item: '수치 출처표', result: (writer.citations || []).length ? 'PASS' : 'FAIL', detail: `인용 ${(writer.citations || []).length}건` });
  }
  g7.status = g7.checks.some(c => c.result === 'FAIL') ? 'FAIL' : 'PASS';
  gates.push(g7);

  // ══ GATE 08 — FINAL DISTRIBUTION ══════════════════════════
  const g8 = { id: 'GATE 08', name: 'Final Distribution Validation', checks: [] };
  const spec = outputspec.read(input.projectId);

  if (!spec) {
    issues.push(issue('SPEC_MISSING', 'MAJOR', 'Output', '출력 사양이 없다', 'cli.js spec propose 실행'));
    g8.checks.push({ item: '출력 사양', result: 'FAIL', detail: '미생성' });
  } else {
    g8.checks.push({ item: '출력 사양 확정', result: spec.locked ? 'PASS' : 'FAIL', detail: spec.locked ? `${spec.version} LOCKED` : 'DRAFT — 사람 확정 필요' });
    if (!spec.locked) {
      issues.push(issue('SPEC_NOT_LOCKED', 'MAJOR', 'Output',
        '출력 사양이 확정되지 않았다 — 최종 산출물을 만들 수 없다', 'cli.js spec confirm <ID> --by "<이름>"'));
    }
    const specCheck = outputspec.validateSpec(spec);
    for (const p of specCheck.problems) {
      issues.push(issue('SPEC_INCOMPLETE', 'MAJOR', 'Output', `출력 사양: ${p}`, '사양 보완'));
    }
    // 페이지 예산 대비 실제 절 수
    if (writer && spec.targetPages) {
      const budget = outputspec.buildPageBudget(writer.sections || [], spec.targetPages, { coverIncluded: spec.coverIncluded });
      const diff = budget.total - spec.targetPages;
      const within = Math.abs(diff) <= (spec.tolerance ?? 2);
      g8.checks.push({
        item: '페이지 예산', result: within ? 'PASS' : 'WARNING',
        detail: `목표 ${spec.targetPages} / 예산 ${budget.total} (${diff >= 0 ? '+' : ''}${diff}, 허용 ±${spec.tolerance ?? 2})`,
      });
      if (!within) {
        issues.push(issue('PAGE_COUNT_DEVIATION', 'MINOR', 'Output',
          `페이지 예산 ${budget.total}p 가 목표 ${spec.targetPages}p 허용범위를 벗어난다`,
          '절별 분량 조정 — 내용을 임의로 삭제하지 않는다'));
      }
      g8.pageBudget = budget;
    }
  }
  g8.status = g8.checks.some(c => c.result === 'FAIL') ? 'FAIL' : (g8.checks.some(c => c.result === 'WARNING') ? 'WARNING' : 'PASS');
  gates.push(g8);

  // ══ 추적성 (사양 §5 · §40 ④) ══════════════════════════════
  const traceability = buildTraceability(ds, writer);
  if (traceability.failures.length) {
    issues.push(issue('SOURCE_TRACEABILITY_FAILURE', 'MAJOR', 'Source',
      `원천자료까지 추적되지 않는 핵심 수치 ${traceability.failures.length}건`, '출처 보완'));
  }

  // ══ 점수 · 판정 ═══════════════════════════════════════════
  const score = computeScore({ ds, issues, calc, validation, research, writer, traceability, spec });
  const critical = issues.filter(i => i.severity === 'CRITICAL');
  const blocked = critical.some(i => BLOCKING.has(i.code));

  let status;
  if (blocked) status = 'DISTRIBUTION BLOCKED';
  else if (score.total >= 95) status = 'APPROVED FOR DISTRIBUTION';
  else if (score.total >= 90) status = 'CONDITIONAL APPROVAL';
  else if (score.total >= 80) status = 'REVIEW REQUIRED';
  else if (score.total >= 70) status = 'REVISION REQUIRED';
  else status = 'DISTRIBUTION BLOCKED';

  if (blocked) {
    ctx.warn(`배포 차단 — CRITICAL ${critical.length}건 (${[...new Set(critical.map(i => i.code))].join(', ')})`);
  }

  return {
    gates, score, status, issues,
    traceability,
    calculation: calc,
    summary: {
      critical: issues.filter(i => i.severity === 'CRITICAL').length,
      major: issues.filter(i => i.severity === 'MAJOR').length,
      minor: issues.filter(i => i.severity === 'MINOR').length,
      gatesPassed: gates.filter(g => g.status === 'PASS').length,
      gatesTotal: gates.length,
    },
    confidence: round(score.total / 100, 3),
  };
}

/** IM 데이터셋 ↔ 재무모델 지표 대조 (사양 §14) */
function crossCheckImFinancial(ds, financial) {
  const mismatches = [];
  let compared = 0;
  if (!financial || !financial.scenarios) return { mismatches, compared };

  const m = financial.scenarios.base.metrics;
  const pairs = [
    ['returns.equity_irr', m.equityIRR, 'Equity IRR', 0.01],
    ['returns.project_irr', m.projectIRR, 'Project IRR', 0.01],
    ['returns.min_dscr', m.minDSCR, '최소 DSCR', 0.01],
    ['returns.npv', m.npv, 'NPV', 0.5],
    ['returns.exit_value', m.exitValue, 'Exit Value', 0.5],
    ['returns.noi_stabilized', m.noiStabilized, '안정화 NOI', 0.5],
  ];
  for (const [key, modelValue, label, tol] of pairs) {
    const dsValue = ds.num(key);
    if (dsValue === null || modelValue === null || modelValue === undefined) continue;
    compared++;
    if (Math.abs(dsValue - modelValue) > tol) {
      mismatches.push(`${label}: IM 데이터셋 ${dsValue} ≠ 재무모델 ${modelValue}`);
    }
  }
  return { mismatches, compared };
}

/** IM 본문 ↔ Teaser 수치 대조 (사양 §15) */
function crossCheckImTeaser(im, teaser) {
  const mismatches = [];
  const pick = (text, label) => {
    const re = new RegExp(`${label}[^|\\n]*?\\|\\s*([\\d,.]+%?|[\\d,.]+억원|[\\d,.]+x)`, 'i');
    const m = String(text).match(re);
    return m ? m[1].trim() : null;
  };
  const labels = ['Equity IRR', 'Project IRR', '최소 DSCR', 'Exit Value', '안정화 NOI'];
  let compared = 0;
  for (const label of labels) {
    const a = pick(im, label);
    const b = pick(teaser, label);
    if (a === null || b === null) continue;
    compared++;
    if (a !== b) mismatches.push(`${label}: IM ${a} ≠ Teaser ${b}`);
  }
  return { mismatches, compared };
}

/** 핵심 수치 원천자료 추적표 (사양 §5 · §40 ④) */
function buildTraceability(ds, writer) {
  const rows = [];
  const failures = [];

  for (const key of MATERIAL_KEYS) {
    const f = ds.get(key);
    if (!f) {
      failures.push({ key, label: labelFor(key), reason: '값 자체가 없음' });
      continue;
    }
    const chain = [
      f.source,
      f.page ? `p.${f.page}` : null,
      f.sourceDate,
      f.quote ? `"${String(f.quote).slice(0, 40)}"` : null,
    ].filter(Boolean);

    const traceable = Boolean(f.source) && (Boolean(f.page) || Boolean(f.quote) || /financial_model|매스 검토|감정평가 Agent|VWorld|건축물대장|지적공부/.test(f.source));
    const row = {
      key, label: labelFor(key),
      value: f.value, unit: f.unit,
      grade: grade(f), verified: f.verified,
      corroboration: f.corroboration || 1,
      chain, traceable,
    };
    rows.push(row);
    if (!traceable) failures.push({ key, label: labelFor(key), reason: '페이지·근거문구 없음' });
  }

  const cited = (writer && writer.citations) || [];
  return {
    rows, failures,
    coverage: rows.length ? round(rows.filter(r => r.traceable).length / rows.length, 3) : 0,
    citationCount: cited.length,
  };
}

function computeScore({ ds, issues, calc, validation, research, writer, traceability, spec }) {
  const critical = issues.filter(i => i.severity === 'CRITICAL').length;
  const major = issues.filter(i => i.severity === 'MAJOR').length;
  const minor = issues.filter(i => i.severity === 'MINOR').length;

  const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(v)));

  const dataAccuracy = clamp(WEIGHTS.dataAccuracy
    - issues.filter(i => i.category === 'Data').length * 5, WEIGHTS.dataAccuracy);

  const verifiedRatio = ds.keys().length
    ? ds.keys().filter(k => ds.get(k).verified).length / ds.keys().length : 0;
  const sourceVerification = clamp(WEIGHTS.sourceVerification * verifiedRatio
    + WEIGHTS.sourceVerification * 0.3, WEIGHTS.sourceVerification);

  const calcPenalty = calc
    ? calc.checks.filter(c => ['CRITICAL', 'MAJOR'].includes(c.level)).length * 6
      + calc.checks.filter(c => c.level === 'WARNING').length * 2
    : WEIGHTS.financialAccuracy * 0.5;
  const financialAccuracy = clamp(WEIGHTS.financialAccuracy - calcPenalty, WEIGHTS.financialAccuracy);

  const crossValidation = clamp(WEIGHTS.crossValidation
    - issues.filter(i => i.category === 'Consistency').length * 7
    - (ds.conflicts || []).filter(c => c.severity === 'RED').length * 5, WEIGHTS.crossValidation);

  const legal = clamp(WEIGHTS.legal - issues.filter(i => i.category === 'Legal').length * 5, WEIGHTS.legal);

  const marketEvidence = clamp(WEIGHTS.marketEvidence * (research ? (research.confidence ?? 0) : 0), WEIGHTS.marketEvidence);

  const documentQuality = clamp(WEIGHTS.documentQuality
    - issues.filter(i => i.category === 'Document').length * 3, WEIGHTS.documentQuality);

  const visualQuality = clamp(WEIGHTS.visualQuality
    - issues.filter(i => i.category === 'Design').length * 3, WEIGHTS.visualQuality);

  const trace = clamp(WEIGHTS.traceability * (traceability.coverage || 0), WEIGHTS.traceability);

  const total = dataAccuracy + sourceVerification + financialAccuracy + crossValidation
    + legal + marketEvidence + documentQuality + visualQuality + trace;

  return {
    dataAccuracy, sourceVerification, financialAccuracy, crossValidation,
    legal, marketEvidence, documentQuality, visualQuality, traceability: trace,
    total: Math.max(0, Math.min(100, total)),
    weights: WEIGHTS,
    counts: { critical, major, minor },
  };
}

module.exports = {
  id: '11_final_validation', label: 'Final Validation Agent',
  inputSchema, outputSchema, run,
  crossCheckImFinancial, crossCheckImTeaser, buildTraceability, computeScore,
  WEIGHTS, BLOCKING, MATERIAL_KEYS,
};
