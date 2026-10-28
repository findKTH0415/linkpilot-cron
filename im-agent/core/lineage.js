'use strict';
/**
 * lineage.js — Master Data Lineage (사양 §30) + Change Impact (사양 §31).
 *
 * "이 숫자는 어디서 왔는가" 와 "이 숫자를 바꾸면 무엇이 흔들리는가" 에 답한다.
 *
 * ★ 계보는 추측하지 않는다. 실제 산출물(dataset·financial·im·teaser)에 남은 기록만 읽는다.
 *   기록이 없으면 '추적 불가' 라고 쓴다 — 그럴듯한 경로를 지어내지 않는다.
 */

const store = require('./store');
const { labelFor, COMPUTED_KEYS } = require('./dictionary');
const { grade } = require('./confidence');

/** 재무모델 입력 → 산출 지표. 하나가 바뀌면 이 지표들이 전부 다시 계산된다. */
const FINANCIAL_INPUTS = [
  'investment.total', 'investment.land', 'investment.construction', 'investment.other',
  'investment.contingency_pct', 'revenue.annual', 'revenue.escalation', 'revenue.ramp_years',
  'opex.annual', 'opex.ratio', 'opex.escalation', 'debt.amount', 'debt.ltc', 'debt.rate',
  'debt.tenor_years', 'debt.grace_years', 'debt.fee_pct', 'tax.rate', 'tax.depreciation_years',
  'schedule.construction_years', 'schedule.ops_years', 'exit.cap_rate', 'exit.year',
  'exit.selling_cost_pct',
];

/** 매스 검토 입력 → 산출 */
const MASSING_INPUTS = ['land.area_sqm', 'building.gfa_sqm', 'building.floors', 'building.footprint_sqm', 'land.far_limit', 'land.bcr_limit', 'land.zoning'];
const MASSING_OUTPUTS = ['massing.gfa_allowed_sqm', 'massing.far_planned', 'massing.bcr_planned'];

/** 감정평가 입력 → 산출 */
const APPRAISAL_INPUTS = ['land.area_sqm', 'land.official_price', 'geo.pnu', 'exit.cap_rate', 'investment.construction'];
const APPRAISAL_OUTPUTS = ['appraisal.land_value_official', 'appraisal.land_value_comparison', 'appraisal.land_value_income', 'appraisal.land_value_concluded', 'appraisal.market_price_per_sqm'];

const RETURNS = COMPUTED_KEYS.filter(k => k.startsWith('returns.'));

/**
 * 값 하나의 계보 — 원천자료부터 최종 문서까지.
 * @returns {{key, label, found, chain:Array, consumers:Array}}
 */
function trace(projectId, key) {
  const datasetJson = store.readJson(projectId, '01_Project/dataset.json', null);
  if (!datasetJson) return { key, label: labelFor(key), found: false, reason: 'dataset.json 없음', chain: [], consumers: [] };

  const resolved = datasetJson.facts && datasetJson.facts[key];
  const candidates = (datasetJson.candidates && datasetJson.candidates[key]) || [];

  if (!resolved) {
    return { key, label: labelFor(key), found: false, reason: '해당 항목이 데이터셋에 없다', chain: [], consumers: [] };
  }

  const chain = [];

  // ① 원천자료 (후보 전부 — 채택되지 않은 것도 보여준다)
  for (const c of candidates) {
    chain.push({
      stage: 'SOURCE',
      label: c.source,
      detail: [c.page ? `p.${c.page}` : null, c.sourceDate, c.quote ? `"${String(c.quote).slice(0, 50)}"` : null].filter(Boolean).join(' · '),
      value: c.value,
      adopted: sameish(c.value, resolved.value),
    });
  }

  // ② 확정값
  chain.push({
    stage: 'RESOLVED',
    label: '데이터셋 확정값',
    detail: `등급 ${grade(resolved)} · 독립출처 ${resolved.corroboration || 1}건 · ${resolved.verified ? '검증됨' : '미검증'}`,
    value: resolved.value,
    adopted: true,
  });

  // ③ 소비처 — 실제 산출물에 남은 기록만 읽는다
  const consumers = [];
  const financial = store.readJson(projectId, '07_Financial/financial.json', null);
  if (financial && (financial.sourcedFields || []).some(f => f.endsWith(`=${key}`))) {
    consumers.push({ stage: 'FINANCIAL MODEL', label: '재무모델 입력', affects: RETURNS.map(labelFor) });
    chain.push({ stage: 'CALCULATION', label: '재무모델(04_financial)', detail: `${RETURNS.length}개 투자지표 산출에 사용`, value: null, adopted: true });
  }
  if (MASSING_INPUTS.includes(key) && store.readJson(projectId, '04_Property/massing.json', null)) {
    consumers.push({ stage: 'MASSING', label: '매스 검토 입력', affects: MASSING_OUTPUTS.map(labelFor) });
  }
  if (APPRAISAL_INPUTS.includes(key) && store.readJson(projectId, '04_Property/appraisal.json', null)) {
    consumers.push({ stage: 'APPRAISAL', label: '감정평가 입력', affects: APPRAISAL_OUTPUTS.map(labelFor) });
  }

  // ④ 문서
  const im = store.readJson(projectId, '09_IM/im.json', null);
  if (im) {
    const cited = (im.citations || []).find(c => c.key === key);
    if (cited) {
      const sections = (im.sections || []).filter(s => String(s.text).includes(cited.value));
      chain.push({
        stage: 'DOCUMENT',
        label: 'IM 본문',
        detail: sections.length ? `${sections.map(s => `${s.no} ${s.title}`).slice(0, 3).join(', ')}` : '부록 출처표',
        value: cited.value, adopted: true,
      });
      consumers.push({ stage: 'IM', label: 'IM 문서', affects: sections.map(s => `${s.no} ${s.title}`) });
    }
  }
  const teaserPath = require('path').join(store.projectDir(projectId), '10_Teaser/teaser.md');
  if (require('fs').existsSync(teaserPath)) {
    const teaser = require('fs').readFileSync(teaserPath, 'utf8');
    if (teaser.includes(String(resolved.value))) {
      chain.push({ stage: 'DOCUMENT', label: 'Teaser', detail: '요약표에 노출', value: resolved.value, adopted: true });
    }
  }

  return {
    key, label: labelFor(key), found: true,
    value: resolved.value, unit: resolved.unit,
    grade: grade(resolved), verified: resolved.verified,
    chain, consumers,
    conflicted: candidates.length > 1 && candidates.some(c => !sameish(c.value, resolved.value)),
  };
}

/**
 * 변경 영향 분석 (사양 §31) — 이 값을 바꾸면 무엇을 다시 계산해야 하는가.
 * @returns {{key, affectedAgents, affectedValues, affectedDocuments, rerunOrder}}
 */
function impact(projectId, key) {
  const affectedAgents = [];
  const affectedValues = [];

  if (FINANCIAL_INPUTS.includes(key)) {
    affectedAgents.push('04_financial');
    affectedValues.push(...RETURNS);
    // 재무모델이 바뀌면 감정평가(수익환원법)도 바뀐다
    affectedAgents.push('08_appraisal');
    affectedValues.push(...APPRAISAL_OUTPUTS);
  }
  if (APPRAISAL_INPUTS.includes(key) && !affectedAgents.includes('08_appraisal')) {
    affectedAgents.push('08_appraisal');
    affectedValues.push(...APPRAISAL_OUTPUTS);
  }
  if (MASSING_INPUTS.includes(key)) {
    affectedAgents.push('09_massing');
    affectedValues.push(...MASSING_OUTPUTS);
  }
  if (key.startsWith('geo.') || key === 'project.location') {
    affectedAgents.push('07_geo', '08_appraisal', '09_massing');
  }

  // 값이 하나라도 바뀌면 검증·문서는 항상 다시 돌아야 한다
  affectedAgents.push('05_validation', '06_im_writer', '11_final_validation');

  const affectedDocuments = [
    '09_IM/im.md', '10_Teaser/teaser.md', '12_Final/im-a4.html', '12_Final/content.json',
    '11_QC/validation-report.md', '11_QC/traceability-report.md', '12_Final/manifest.json',
  ];

  const order = ['07_geo', '04_financial', '08_appraisal', '09_massing', '05_validation', '06_im_writer', '11_final_validation'];
  const rerunOrder = order.filter(a => affectedAgents.includes(a));

  return {
    key, label: labelFor(key),
    affectedAgents: [...new Set(affectedAgents)],
    affectedValues: [...new Set(affectedValues)].map(k => ({ key: k, label: labelFor(k) })),
    affectedDocuments,
    rerunOrder,
    totalAffected: new Set([...affectedValues, ...affectedDocuments]).size,
    // 승인이 걸려 있으면 변경 시 새 버전이 필요하다 (사양 §37 · §39)
    requiresNewVersion: Boolean(store.readJson(projectId, '11_QC/approval.json', null)),
  };
}

function sameish(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    const scale = Math.max(Math.abs(a), Math.abs(b));
    return scale === 0 ? true : Math.abs(a - b) / scale <= 0.001;
  }
  return String(a).trim() === String(b).trim();
}

module.exports = { trace, impact, FINANCIAL_INPUTS, MASSING_INPUTS, APPRAISAL_INPUTS, RETURNS, sameish };
