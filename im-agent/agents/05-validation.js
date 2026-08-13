'use strict';
/**
 * 05 Cross Validation Agent
 *
 * ★ 전부 결정적 규칙이다. LLM 미사용. 검증을 LLM에 맡기면 검증 자체를 신뢰할 수 없다.
 *
 * 검사 항목:
 *   ① 값 충돌      — 같은 항목에 서로 다른 값 (예: 연면적 54,822 vs 52,822)
 *   ② 범위 이탈    — Data Dictionary 허용범위 밖 (예: PUE 0.8)
 *   ③ 내부 정합성  — 총사업비 = 구성비 합, 차입+자본 = 총사업비, 용적률, 거치≤만기 등
 *   ④ 미검증 사용  — 독립출처 1개뿐인 값이 IM/재무모델에 쓰임
 *   ⑤ 가정치 비중  — 재무모델 입력 중 문서 미확인 비율
 *   ⑥ 자료 신선도  — 출처 일자가 1년 이상 경과
 *   ⑦ 필수 누락    — IM 필수 항목 결측
 *
 * 출력: RED / YELLOW / GREEN 플래그 + QC Score + PASS/CONDITIONAL/REJECT
 */

const { FIELDS, labelFor, rangeViolation, requiredFor } = require('../core/dictionary');
const { round, formatEok } = require('../core/numeric');
const { kstDate, daysBetween } = require('../core/kst');

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    financial: { type: 'object', nullable: true },
    research: { type: 'object', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['flags', 'score', 'verdict'],
  properties: {
    flags: { type: 'array' },
    score: { type: 'object' },
    verdict: { type: 'string', enum: ['PASS', 'CONDITIONAL PASS', 'REJECT'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const REL_TOL = 0.02; // 합계 정합성 허용오차 2%

function flag(severity, type, message, detail = {}) {
  return { severity, type, message, ...detail };
}

/** a ≈ b ? */
function close(a, b, tol = REL_TOL) {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return true;
  return Math.abs(a - b) / scale <= tol;
}

function checkConsistency(ds) {
  const flags = [];
  const n = k => ds.num(k);

  // ① 총사업비 = 토지비 + 공사비 + 기타
  const total = n('investment.total');
  const parts = ['investment.land', 'investment.construction', 'investment.other'].map(n).filter(v => v !== null);
  if (total !== null && parts.length >= 2) {
    const sum = parts.reduce((a, b) => a + b, 0);
    if (!close(total, sum)) {
      flags.push(flag('RED', 'SUM_MISMATCH',
        `총사업비(${formatEok(total)})와 구성비 합계(${formatEok(sum)})가 ${round(Math.abs(total - sum) / total * 100, 1)}% 차이난다`,
        { keys: ['investment.total', 'investment.land', 'investment.construction', 'investment.other'], expected: round(sum, 2), actual: total }));
    }
  }

  // ② 차입금 + 자기자본 = 총사업비
  const debt = n('debt.amount');
  const equity = n('equity.amount');
  if (total !== null && debt !== null && equity !== null && !close(total, debt + equity)) {
    flags.push(flag('RED', 'FUNDING_MISMATCH',
      `자금조달 합계(차입 ${formatEok(debt)} + 자본 ${formatEok(equity)} = ${formatEok(debt + equity)})가 총사업비 ${formatEok(total)}와 불일치한다`,
      { keys: ['debt.amount', 'equity.amount', 'investment.total'] }));
  }

  // ③ LTC 표기 vs 실제
  const ltc = n('debt.ltc');
  if (ltc !== null && total !== null && debt !== null) {
    const actual = (debt / total) * 100;
    if (!close(ltc, actual, 0.05)) {
      flags.push(flag('YELLOW', 'RATIO_MISMATCH',
        `문서상 LTC ${ltc}% 와 실제 차입비율 ${round(actual, 1)}% 가 다르다`,
        { keys: ['debt.ltc', 'debt.amount', 'investment.total'] }));
    }
  }

  // ④ 운영비율 상식 범위
  const rev = n('revenue.annual');
  const opex = n('opex.annual');
  if (rev !== null && opex !== null) {
    const ratio = (opex / rev) * 100;
    if (ratio >= 90) {
      flags.push(flag('RED', 'MARGIN', `연간 운영비가 매출의 ${round(ratio, 1)}% — 수익구조 재확인 필요`, { keys: ['opex.annual', 'revenue.annual'] }));
    } else if (ratio > 60) {
      flags.push(flag('YELLOW', 'MARGIN', `연간 운영비 비중이 매출의 ${round(ratio, 1)}%로 높다`, { keys: ['opex.annual', 'revenue.annual'] }));
    }
  }

  // ⑤ 용적률 상식 범위
  const land = n('land.area_sqm');
  const gfa = n('building.gfa_sqm');
  if (land !== null && gfa !== null && land > 0) {
    const far = gfa / land;
    if (far < 0.2 || far > 20) {
      flags.push(flag('YELLOW', 'RATIO_OUTLIER',
        `연면적/대지면적 = ${round(far * 100, 0)}% — 용적률이 통상 범위를 벗어난다`,
        { keys: ['building.gfa_sqm', 'land.area_sqm'] }));
    }
  }

  // ⑥ 거치기간 ≤ 대출기간, Exit ≤ 운영기간
  const grace = n('debt.grace_years');
  const tenor = n('debt.tenor_years');
  if (grace !== null && tenor !== null && grace > tenor) {
    flags.push(flag('RED', 'TERM_CONFLICT', `거치기간(${grace}년)이 대출기간(${tenor}년)보다 길다`, { keys: ['debt.grace_years', 'debt.tenor_years'] }));
  }
  const exitY = n('exit.year');
  const ops = n('schedule.ops_years');
  if (exitY !== null && ops !== null && exitY > ops) {
    flags.push(flag('YELLOW', 'TERM_CONFLICT', `Exit 시점(${exitY}년차)이 운영기간(${ops}년)을 초과한다`, { keys: ['exit.year', 'schedule.ops_years'] }));
  }

  // ⑦ IT Load vs 수전용량 (PUE 정합)
  const it = n('capacity.it_load_mw');
  const power = n('capacity.power_mw');
  const pue = n('capacity.pue');
  if (it !== null && power !== null && it > power) {
    flags.push(flag('RED', 'CAPACITY_CONFLICT', `IT Load(${it}MW)가 수전용량(${power}MW)보다 크다`, { keys: ['capacity.it_load_mw', 'capacity.power_mw'] }));
  }
  if (it !== null && power !== null && pue !== null) {
    const implied = power / it;
    if (!close(implied, pue, 0.15)) {
      flags.push(flag('YELLOW', 'CAPACITY_CONFLICT',
        `수전용량/IT Load = ${round(implied, 2)} 인데 문서상 PUE는 ${pue} 다`,
        { keys: ['capacity.pue', 'capacity.power_mw', 'capacity.it_load_mw'] }));
    }
  }

  return flags;
}

function checkLegal(ds) {
  const flags = [];
  const permit = ds.get('legal.permit_status');
  const ownership = ds.get('land.ownership');

  if (!permit) {
    flags.push(flag('RED', 'LEGAL', '인허가 현황 미확인 — 투자자료에 인허가 상태 없이 배포 불가', { keys: ['legal.permit_status'] }));
  } else if (/미|불가|반려|예정|검토중|협의중/.test(String(permit.value))) {
    flags.push(flag('RED', 'LEGAL', `인허가 미완료 상태: "${permit.value}" (${permit.citation()})`, { keys: ['legal.permit_status'] }));
  } else {
    flags.push(flag('GREEN', 'LEGAL', `인허가 확인: ${permit.value} (${permit.citation()})`, { keys: ['legal.permit_status'] }));
  }

  if (!ownership) {
    flags.push(flag('RED', 'LEGAL', '토지 확보상태 미확인 — 토지사용권 없이 사업성 판단 불가', { keys: ['land.ownership'] }));
  } else if (/미확보|협의|가계약|LOI|예정/i.test(String(ownership.value))) {
    flags.push(flag('YELLOW', 'LEGAL', `토지 미확보 상태: "${ownership.value}" (${ownership.citation()})`, { keys: ['land.ownership'] }));
  } else {
    flags.push(flag('GREEN', 'LEGAL', `토지 확보 확인: ${ownership.value} (${ownership.citation()})`, { keys: ['land.ownership'] }));
  }

  return flags;
}

async function run(input, ctx) {
  const ds = ctx.dataset;
  if (!ds) throw new Error('ctx.dataset 필요');

  const flags = [];

  // ① 값 충돌 (Dataset이 resolve 시점에 이미 수집)
  for (const c of ds.conflicts) {
    const label = labelFor(c.key);
    if (c.type === 'VALUE_CONFLICT') {
      const detail = c.values.map(v => `${v.value}${v.unit || ''} (${v.sources.join('; ')})`).join(' vs ');
      // 숫자 충돌 = RED(치명적), 문자열 표기 차이 = YELLOW(검토 대상)
      flags.push(flag(c.severity || 'RED', 'VALUE_CONFLICT',
        `${label}: 서로 다른 값이 존재한다 — ${detail}`, { keys: [c.key], values: c.values }));
    } else {
      flags.push(flag('RED', c.type, `${label}: ${c.message}`, { keys: [c.key] }));
    }
  }

  // ② 범위 이탈
  for (const key of ds.keys()) {
    const f = ds.get(key);
    const v = rangeViolation(key, f.value);
    if (v) flags.push(flag('RED', 'RANGE', `${v} (${f.citation()})`, { keys: [key] }));
  }

  // ③ 내부 정합성 + 법률
  flags.push(...checkConsistency(ds));
  flags.push(...checkLegal(ds));

  // ④ 미검증 값 (독립출처 1개)
  const single = ds.keys().filter(k => {
    const f = ds.get(k);
    return !f.verified && f.source !== 'financial_model (04_financial)' && (f.corroboration || 1) < 2;
  });
  if (single.length) {
    flags.push(flag('YELLOW', 'SINGLE_SOURCE',
      `단일 출처로만 확인된 항목 ${single.length}건 — 교차확인 전까지 '미검증'으로 표기된다`,
      { keys: single.slice(0, 15) }));
  }

  // ⑤ 재무모델 가정치 비중
  const fin = input.financial;
  if (fin) {
    const assumedCount = (fin.assumed || []).length;
    const sourcedCount = (fin.sourcedFields || []).length;
    const totalIn = assumedCount + sourcedCount;
    const ratio = totalIn ? assumedCount / totalIn : 1;
    if (ratio >= 0.5) {
      flags.push(flag('RED', 'ASSUMPTION_HEAVY',
        `재무모델 입력의 ${Math.round(ratio * 100)}%(${assumedCount}/${totalIn})가 문서 미확인 가정치다`,
        { keys: (fin.assumed || []).map(a => a.dictKey).filter(Boolean).slice(0, 15) }));
    } else if (assumedCount) {
      flags.push(flag('YELLOW', 'ASSUMPTION',
        `가정치 ${assumedCount}건이 재무모델에 사용됐다 — IM 가정표에 명시된다`,
        { keys: (fin.assumed || []).map(a => a.dictKey).filter(Boolean).slice(0, 15) }));
    }

    const base = fin.scenarios && fin.scenarios.base && fin.scenarios.base.metrics;
    if (base) {
      // 모델 총사업비 vs 문서 총사업비 (건설이자·수수료 자본화로 벌어질 수 있다)
      const docTotal = ds.num('investment.total');
      if (docTotal !== null && !close(docTotal, base.totalProjectCost, 0.03)) {
        flags.push(flag('YELLOW', 'TPC_GAP',
          `모델 총사업비 ${formatEok(base.totalProjectCost)} ≠ 문서 총사업비 ${formatEok(docTotal)} — 건설이자 ${formatEok(base.idc)} · 수수료 ${formatEok(base.arrangementFee)} 자본화 차이. 문서 수치에 이미 포함되어 있다면 중복 계상이다`,
          { keys: ['investment.total'] }));
      }
      if (base.minDSCR !== null && base.minDSCR < 1.0) {
        flags.push(flag('RED', 'DSCR', `Base 시나리오 최소 DSCR ${base.minDSCR} < 1.0 — 원리금 상환 불가 구간이 존재한다`));
      } else if (base.minDSCR !== null && base.minDSCR < 1.2) {
        flags.push(flag('YELLOW', 'DSCR', `Base 최소 DSCR ${base.minDSCR} — 통상 금융조건(1.2x) 미달`));
      } else if (base.minDSCR !== null) {
        flags.push(flag('GREEN', 'DSCR', `Base 최소 DSCR ${base.minDSCR}`));
      }
      // Exit Value 가 총사업비의 2배를 넘으면 Cap Rate 가정이 과도할 가능성이 크다
      if (base.exitValue && base.totalProjectCost && base.exitValue / base.totalProjectCost > 2) {
        flags.push(flag('YELLOW', 'EXIT_OUTLIER',
          `Exit Value ${formatEok(base.exitValue)} 가 총사업비 ${formatEok(base.totalProjectCost)} 의 ${round(base.exitValue / base.totalProjectCost, 1)}배 — Exit Cap Rate ${fin.scenarios.base.assumptions.exitCapRate}% 가정의 근거 확인 필요`,
          { keys: ['exit.cap_rate'] }));
      }

      const down = fin.scenarios.downside && fin.scenarios.downside.metrics;
      if (down && down.equityIRR !== null && down.equityIRR < 0) {
        flags.push(flag('YELLOW', 'DOWNSIDE', `Downside 시나리오 Equity IRR ${down.equityIRR}% — 원금 손실 구간`));
      }
    }
  }

  // ⑥ 자료 신선도
  const today = kstDate();
  for (const key of ds.keys()) {
    const f = ds.get(key);
    if (!f.sourceDate) continue;
    const age = daysBetween(f.sourceDate, today);
    if (age > 365) {
      flags.push(flag('YELLOW', 'STALE', `${labelFor(key)}: 출처 자료가 ${Math.floor(age / 365)}년 경과 (${f.citation()})`, { keys: [key] }));
    }
  }

  // ⑦ IM 필수 항목 누락
  const missingIm = ds.missing(requiredFor('im'));
  if (missingIm.length) {
    flags.push(flag('YELLOW', 'MISSING', `IM 필수 항목 ${missingIm.length}건 미확인: ${missingIm.map(k => FIELDS[k].label).join(', ')}`, { keys: missingIm }));
  }

  // ⑧ 시장조사 근거
  const research = input.research;
  if (research && !research.offline) {
    const noSrc = (research.sections || []).filter(s => !s.sources.length).length;
    if (noSrc) flags.push(flag('YELLOW', 'MARKET_EVIDENCE', `시장분석 ${noSrc}개 항목에 인용 출처가 없다`));
  } else if (research && research.offline) {
    flags.push(flag('YELLOW', 'MARKET_EVIDENCE', '시장조사 미실행 (LLM 오프라인)'));
  }

  // ── QC Score ──
  const red = flags.filter(f => f.severity === 'RED').length;
  const yellow = flags.filter(f => f.severity === 'YELLOW').length;

  const dataAccuracy = clamp(100 - red * 20 - yellow * 4);
  const financialAccuracy = clamp(100 - (fin ? Math.round((1 - (fin.confidence ?? 0)) * 60) : 60)
    - flags.filter(f => ['DSCR', 'SUM_MISMATCH', 'FUNDING_MISMATCH', 'ASSUMPTION_HEAVY'].includes(f.type) && f.severity === 'RED').length * 15);
  const legalCompleteness = clamp(100 - flags.filter(f => f.type === 'LEGAL' && f.severity === 'RED').length * 35
    - flags.filter(f => f.type === 'LEGAL' && f.severity === 'YELLOW').length * 12);
  const marketEvidence = clamp(research ? Math.round((research.confidence ?? 0) * 100) : 0);
  const consistency = clamp(100 - flags.filter(f => ['VALUE_CONFLICT', 'RATIO_MISMATCH', 'CAPACITY_CONFLICT', 'TERM_CONFLICT'].includes(f.type)).length * 18);
  const sourceCoverage = clamp(Math.round((ds.keys().filter(k => ds.get(k).verified).length / Math.max(1, ds.keys().length)) * 100));

  const score = {
    dataAccuracy, financialAccuracy, legalCompleteness,
    marketEvidence, consistency, sourceCoverage,
    total: Math.round((dataAccuracy + financialAccuracy + legalCompleteness + marketEvidence + consistency + sourceCoverage) / 6),
  };

  const verdict = red > 0 ? 'REJECT' : (yellow > 3 || score.total < 80 ? 'CONDITIONAL PASS' : 'PASS');

  if (red) ctx.warn(`RED FLAG ${red}건 — 승인 게이트가 차단된다`);

  return {
    flags, score, verdict,
    summary: { red, yellow, green: flags.filter(f => f.severity === 'GREEN').length },
    confidence: round(score.total / 100, 3),
  };
}

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

module.exports = { id: '05_validation', label: 'Cross Validation Agent', inputSchema, outputSchema, run, checkConsistency, checkLegal };
