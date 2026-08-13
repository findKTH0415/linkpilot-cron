'use strict';
/**
 * reports.js — 최종 산출물 4종 (사양 §40).
 *
 *   ① FINAL DOCUMENT      (writer 가 생성 — 여기서는 manifest 로 목록화)
 *   ② VALIDATION REPORT   전체 검증 결과
 *   ③ RED FLAG REPORT     미해결 위험사항
 *   ④ TRACEABILITY REPORT 핵심 수치 원천자료 추적표
 *
 * 전부 데이터에서 기계적으로 생성한다. 서술을 지어내지 않는다.
 */

const store = require('./store');
const { kstStamp, kstDate } = require('./kst');
const { LABEL: GRADE_LABEL } = require('./confidence');

function header(projectId, title) {
  const p = store.readJson(projectId, '01_Project/project.json', {});
  return [
    'Strictly Private and Confidential',
    '',
    `# ${title}`,
    '',
    `- Project: ${p.name || projectId}`,
    `- Project ID: ${projectId}`,
    `- Date: ${kstDate()} (KST)`,
    '',
  ].join('\n');
}

/** ② VALIDATION REPORT */
function validationReport(projectId, final, spec) {
  const out = [header(projectId, 'LINKPILOT FINAL VALIDATION REPORT')];

  out.push('## 종합 판정', '');
  out.push('| 항목 | 값 |', '|---|---|');
  out.push(`| Overall Score | **${final.score.total} / 100** |`);
  out.push(`| Status | **${final.status}** |`);
  out.push(`| Critical | ${final.summary.critical} |`);
  out.push(`| Major | ${final.summary.major} |`);
  out.push(`| Minor | ${final.summary.minor} |`);
  out.push(`| Gate 통과 | ${final.summary.gatesPassed} / ${final.summary.gatesTotal} |`);
  out.push('', '자료출처: 본 자료 최종검증 Agent(11_final_validation) 산출. 앞선 Agent 결과를 재계산·재대조한 것이다.', '');

  out.push('## 배점', '');
  out.push('| 항목 | 획득 | 배점 |', '|---|---:|---:|');
  const rows = [
    ['Data Accuracy', 'dataAccuracy'], ['Source Verification', 'sourceVerification'],
    ['Financial Accuracy', 'financialAccuracy'], ['Cross Validation', 'crossValidation'],
    ['Legal / Regulatory', 'legal'], ['Market Evidence', 'marketEvidence'],
    ['Document Quality', 'documentQuality'], ['Visual Quality', 'visualQuality'],
    ['Traceability', 'traceability'],
  ];
  for (const [label, key] of rows) out.push(`| ${label} | ${final.score[key]} | ${final.score.weights[key]} |`);
  out.push(`| **합계** | **${final.score.total}** | **100** |`);
  out.push('', '자료출처: 본 자료 배점표(사양 고정 가중치).', '');

  out.push('## GATE 결과', '');
  for (const g of final.gates) {
    out.push(`### ${g.id} — ${g.name} : ${g.status}`, '');
    if (g.method) out.push(`> 검증 방식: ${g.method}`, '');
    if (g.checks && g.checks.length) {
      out.push('| 검사 항목 | 결과 | 상세 |', '|---|---|---|');
      for (const c of g.checks) out.push(`| ${c.item} | ${c.result} | ${c.detail || '-'} |`);
      out.push('', '자료출처: 본 자료 검증 Agent 실행 결과.', '');
    }
  }

  if (final.calculation) {
    out.push('## 독립 재계산 (GATE 03 상세)', '');
    out.push('> 재무모델을 다시 호출하지 않고, 발표된 현금흐름표에서 Newton-Raphson 으로 역산했다.',
      '> 원본은 이분법을 쓰므로 알고리즘이 다르다 — 같은 값이 나와야 정상이다.', '');
    out.push('| 지표 | 발표값 | 독립계산 | 차이(%) | 판정 |', '|---|---:|---:|---:|---|');
    for (const c of final.calculation.checks) {
      out.push(`| ${c.item} | ${fmt(c.reported)} | ${fmt(c.recomputed)} | ${c.diffPct === null ? '-' : c.diffPct} | ${c.level} |`);
    }
    out.push('', '자료출처: 본 자료 독립 재계산(finance/verify.js).', '');
  }

  if (spec) {
    out.push('## 출력 사양', '');
    out.push('| 항목 | 값 |', '|---|---|');
    out.push(`| 문서유형 | ${spec.docType} |`);
    out.push(`| 페이지 크기 | ${spec.pageSize} ${spec.orientation} |`);
    out.push(`| 목표 페이지 | ${spec.targetPages} (허용 ±${spec.tolerance ?? 2}) |`);
    out.push(`| 형식 | ${(spec.formats || []).join(', ')} |`);
    out.push(`| 언어 | ${spec.language} |`);
    out.push(`| 버전 | ${spec.version} |`);
    out.push(`| 확정 상태 | ${spec.locked ? `LOCKED (${spec.confirmedBy})` : 'DRAFT — 사람 확정 필요'} |`);
    out.push('', '자료출처: 본 프로젝트 출력 사양(01_Project/output-spec.json).', '');
  }

  out.push('---', `_생성: ${kstStamp()} · LinkPilot Final Validation Agent_`);
  return out.join('\n');
}

/** ③ RED FLAG REPORT */
function redFlagReport(projectId, final) {
  const out = [header(projectId, 'RED FLAG REPORT — 미해결 위험사항')];
  const bySeverity = { CRITICAL: [], MAJOR: [], MINOR: [] };
  for (const i of final.issues) (bySeverity[i.severity] || bySeverity.MINOR).push(i);

  if (!final.issues.length) {
    out.push('미해결 위험사항 없음.', '');
  }

  for (const sev of ['CRITICAL', 'MAJOR', 'MINOR']) {
    const list = bySeverity[sev];
    if (!list.length) continue;
    out.push(`## ${sev} (${list.length}건)`, '');
    out.push('| ID | 분류 | 내용 | 필요 조치 | 상태 |', '|---|---|---|---|---|');
    for (const i of list) {
      out.push(`| ${i.id} | ${i.category} | ${i.message} | ${i.action} | ${i.status} |`);
    }
    out.push('', '자료출처: 본 자료 최종검증 Agent 검출 결과.', '');
  }

  const blocking = final.issues.filter(i => i.severity === 'CRITICAL');
  if (blocking.length) {
    out.push('## 배포 차단', '');
    out.push(`> CRITICAL ${blocking.length}건이 해소되지 않아 최종 배포가 차단되었다.`,
      '> 해당 항목을 수정한 뒤 재검증해야 한다.', '');
  }

  out.push('---', `_생성: ${kstStamp()}_`);
  return out.join('\n');
}

/** ④ DATA TRACEABILITY REPORT */
function traceabilityReport(projectId, final) {
  const out = [header(projectId, 'DATA TRACEABILITY REPORT — 핵심 수치 원천자료 추적표')];
  const t = final.traceability;

  out.push(`추적 가능 비율: **${Math.round((t.coverage || 0) * 100)}%** (${t.rows.filter(r => r.traceable).length}/${t.rows.length})`, '');

  out.push('| 항목 | 값 | 등급 | 검증 | 출처 추적 체인 |', '|---|---:|:--:|:--:|---|');
  for (const r of t.rows) {
    out.push(`| ${r.label} | ${fmt(r.value)}${r.unit ? ' ' + r.unit : ''} | ${r.grade} | ${r.verified ? 'O' : 'X'} | ${r.chain.join(' → ')} |`);
  }
  out.push('', '자료출처: 각 행에 표기된 원본자료. 등급은 출처·검증여부에서 파생된다.', '');

  out.push('## 등급 기준', '');
  out.push('| 등급 | 의미 |', '|---|---|');
  for (const [k, v] of Object.entries(GRADE_LABEL)) out.push(`| ${k} | ${v} |`);
  out.push('');

  if (t.failures.length) {
    out.push('## 추적 실패 항목', '');
    out.push('| 항목 | 사유 |', '|---|---|');
    for (const f of t.failures) out.push(`| ${f.label} | ${f.reason} |`);
    out.push('', '자료출처: 본 자료 추적성 검사 결과.', '');
  }

  out.push('---', `_생성: ${kstStamp()}_`);
  return out.join('\n');
}

/** OUTPUT MANIFEST (사양 §25) */
function manifest(projectId, { spec, writer, final, theme }) {
  const p = store.readJson(projectId, '01_Project/project.json', {});
  const files = [
    { path: '09_IM/im.md', kind: 'markdown', generated: !!(writer && writer.im) },
    { path: '12_Final/im-a4.html', kind: 'html', generated: !!(writer && writer.html) },
    { path: '12_Final/content.json', kind: 'json', generated: !!(writer && writer.content) },
    { path: '10_Teaser/teaser.md', kind: 'markdown', generated: !!(writer && writer.teaser) },
    { path: '12_Final/theme.json', kind: 'json', generated: !!theme },
    { path: '11_QC/validation-report.md', kind: 'markdown', generated: !!final },
    { path: '11_QC/red-flag-report.md', kind: 'markdown', generated: !!final },
    { path: '11_QC/traceability-report.md', kind: 'markdown', generated: !!final },
  ];

  return {
    schema: 'linkpilot-output-manifest/1.0',
    generatedAt: kstStamp(),
    project: { id: projectId, name: p.name || null, assetType: p.assetType || null },
    document: spec ? {
      type: spec.docType, label: spec.label,
      pageSize: spec.pageSize, orientation: spec.orientation,
      targetPages: spec.targetPages, tolerance: spec.tolerance,
      formats: spec.formats, language: spec.language,
      version: spec.version, fileName: spec.fileName,
      confidentiality: spec.confidentiality, watermark: spec.watermark,
      specLocked: !!spec.locked, specConfirmedBy: spec.confirmedBy || null,
    } : null,
    design: theme ? { themeId: theme.id, label: theme.label, docType: theme.docType } : null,
    sections: writer ? (writer.sections || []).length : 0,
    validation: final ? {
      status: final.status, score: final.score.total,
      critical: final.summary.critical, major: final.summary.major, minor: final.summary.minor,
      traceability: final.traceability.coverage,
    } : null,
    files,
    // 실제 생성 가능한 형식만 표시한다 — 못 만드는 형식을 '생성됨'으로 쓰지 않는다
    status: !spec || !spec.locked ? 'DRAFT — 출력 사양 미확정'
      : (final && final.status === 'DISTRIBUTION BLOCKED') ? 'BLOCKED'
        : 'READY FOR HUMAN APPROVAL',
  };
}

function fmt(v) {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number') return v.toLocaleString('ko-KR');
  return String(v);
}

module.exports = { validationReport, redFlagReport, traceabilityReport, manifest };
