'use strict';
/**
 * templates.js — 자산유형별 재무모델 Template.
 *
 * Template이 하는 일:
 *   ① Dataset(Fact) → 모델 입력 매핑
 *   ② 자산유형별 기본 가정 (문서에 값이 없을 때 쓰는 시장 통상치. 반드시 assumed=true 로 표시)
 *   ③ Base / Upside / Downside 시나리오 델타
 *   ④ 민감도 축 정의
 *
 * ★ 기본가정(default)은 '출처 없는 값'이므로 IM 본문에 쓰일 때 반드시
 *   "가정치(문서 미확인)"으로 표기된다. Validation Agent가 YELLOW FLAG를 남긴다.
 */

const BASE_SCENARIOS = {
  base: { label: 'Base', deltas: {} },
  upside: {
    label: 'Upside',
    deltas: { annualRevenue: +7, constructionCost: -3, exitCapRate: -0.25, debtRate: -0.25 },
    unit: { annualRevenue: '%', constructionCost: '%', exitCapRate: 'pp', debtRate: 'pp' },
  },
  downside: {
    label: 'Downside',
    deltas: { annualRevenue: -10, constructionCost: +7, exitCapRate: +0.5, debtRate: +1.0 },
    unit: { annualRevenue: '%', constructionCost: '%', exitCapRate: 'pp', debtRate: 'pp' },
  },
};

/** 공통 매핑: dictionary key → 모델 입력 필드 */
const COMMON_MAP = {
  totalCost: 'investment.total',
  landCost: 'investment.land',
  constructionCost: 'investment.construction',
  otherCost: 'investment.other',
  contingencyPct: 'investment.contingency_pct',
  annualRevenue: 'revenue.annual',
  revenueEscalation: 'revenue.escalation',
  rampYears: 'revenue.ramp_years',
  opexAnnual: 'opex.annual',
  opexRatio: 'opex.ratio',
  opexEscalation: 'opex.escalation',
  debtAmount: 'debt.amount',
  ltc: 'debt.ltc',
  debtRate: 'debt.rate',
  tenorYears: 'debt.tenor_years',
  graceYears: 'debt.grace_years',
  feePct: 'debt.fee_pct',
  taxRate: 'tax.rate',
  depreciationYears: 'tax.depreciation_years',
  constructionYears: 'schedule.construction_years',
  opsYears: 'schedule.ops_years',
  exitCapRate: 'exit.cap_rate',
  exitYear: 'exit.year',
  sellingCostPct: 'exit.selling_cost_pct',
};

const TEMPLATES = {
  datacenter: {
    id: 'datacenter',
    label: '데이터센터',
    keywords: ['데이터센터', 'data center', 'datacenter', 'IDC', '전산센터'],
    map: COMMON_MAP,
    defaults: {
      constructionYears: 3, opsYears: 15, exitYear: 10,
      revenueEscalation: 2, opexRatio: 30, opexEscalation: 2.5, rampYears: 2,
      taxRate: 22, depreciationYears: 30,
      ltc: 65, debtRate: 5.5, tenorYears: 12, graceYears: 3, feePct: 1.0,
      exitCapRate: 5.5, sellingCostPct: 1.5, discountRate: 8, contingencyPct: 5,
    },
    keyMetrics: ['capacity.it_load_mw', 'capacity.pue', 'building.gfa_sqm'],
    sensitivity: [
      { key: 'annualRevenue', label: '연매출 변동(%)', values: [-15, -10, -5, 0, 5, 10] },
      { key: 'exitCapRate', label: 'Exit Cap Rate(pp)', values: [-0.5, -0.25, 0, 0.25, 0.5, 1.0] },
    ],
  },

  solar: {
    id: 'solar',
    label: '태양광 발전',
    keywords: ['태양광', 'solar', 'PV', '발전소'],
    map: COMMON_MAP,
    defaults: {
      constructionYears: 1, opsYears: 20, exitYear: 20,
      revenueEscalation: 0, opexRatio: 15, opexEscalation: 2, rampYears: 0,
      taxRate: 22, depreciationYears: 20,
      ltc: 80, debtRate: 5.8, tenorYears: 15, graceYears: 1, feePct: 1.5,
      exitCapRate: 8, sellingCostPct: 1.0, discountRate: 7, contingencyPct: 3,
    },
    keyMetrics: ['capacity.dc_kw', 'capacity.ac_kw'],
    sensitivity: [
      { key: 'annualRevenue', label: 'SMP+REC 변동(%)', values: [-20, -15, -10, -5, 0, 5] },
      { key: 'debtRate', label: '차입금리(pp)', values: [-0.5, 0, 0.5, 1.0, 1.5, 2.0] },
    ],
  },

  realestate: {
    id: 'realestate',
    label: '부동산 개발 (PF)',
    keywords: ['부동산', '개발사업', 'PF', '물류센터', '오피스', '주상복합', '호텔', '지식산업센터'],
    map: COMMON_MAP,
    defaults: {
      constructionYears: 2, opsYears: 10, exitYear: 5,
      revenueEscalation: 2, opexRatio: 25, opexEscalation: 2, rampYears: 1,
      taxRate: 22, depreciationYears: 40,
      ltc: 70, debtRate: 6.5, tenorYears: 7, graceYears: 2, feePct: 2.0,
      exitCapRate: 5.0, sellingCostPct: 2.0, discountRate: 9, contingencyPct: 5,
    },
    keyMetrics: ['land.area_sqm', 'building.gfa_sqm', 'capacity.leasable_sqm'],
    sensitivity: [
      { key: 'annualRevenue', label: '임대수익 변동(%)', values: [-15, -10, -5, 0, 5, 10] },
      { key: 'exitCapRate', label: 'Exit Cap Rate(pp)', values: [-0.5, -0.25, 0, 0.25, 0.5, 1.0] },
    ],
  },

  generic: {
    id: 'generic',
    label: '일반 프로젝트',
    keywords: [],
    map: COMMON_MAP,
    defaults: {
      constructionYears: 2, opsYears: 10, exitYear: 10,
      revenueEscalation: 2, opexRatio: 25, opexEscalation: 2, rampYears: 1,
      taxRate: 22, depreciationYears: 30,
      ltc: 60, debtRate: 6.0, tenorYears: 10, graceYears: 2, feePct: 1.0,
      exitCapRate: 6.0, sellingCostPct: 1.5, discountRate: 8, contingencyPct: 5,
    },
    keyMetrics: [],
    sensitivity: [
      { key: 'annualRevenue', label: '매출 변동(%)', values: [-15, -10, -5, 0, 5, 10] },
      { key: 'debtRate', label: '차입금리(pp)', values: [-0.5, 0, 0.5, 1.0, 1.5, 2.0] },
    ],
  },
};

/**
 * 서식 적용 구간 — PDI SOLAR REPORT SPEC §10 의 교훈을 그대로 가져왔다.
 *
 *   "값은 토큰으로 갈아끼워지지만 서술문은 그대로 남는다.
 *    숫자는 게이트가 지키지만 문장은 지킬 수 없다."
 *
 * 템플릿의 기본 가정(공사기간·금리·Cap Rate 등)은 특정 규모대를 전제로 한다.
 * 사업이 그 구간을 벗어나면 수치는 맞아도 서술이 다른 구간 기준이 되므로,
 * IM 첫머리에 그 사실을 밝힌다. 구간 안이면 빈 문자열이라 문서가 달라지지 않는다.
 */
const SCALE_BANDS = {
  datacenter:  { key: 'capacity.it_load_mw', label: 'IT Load', unit: 'MW', min: 5, max: 100 },
  solar:       { key: 'capacity.dc_kw', label: '설비용량', unit: 'kW', min: 1000, max: 20000 },
  realestate:  { key: 'investment.total', label: '총사업비', unit: '억원', min: 300, max: 10000 },
  generic:     null,
};

/**
 * @returns {string} 구간 안이면 '' (빈 문자열)
 */
function scaleNotice(template, dataset) {
  const band = SCALE_BANDS[template.id];
  if (!band || !dataset) return '';
  const v = dataset.num(band.key);
  if (v === null) return '';
  if (v >= band.min && v <= band.max) return '';

  const direction = v < band.min ? '작다' : '크다';
  return `본 서식은 ${band.label} ${band.min.toLocaleString('ko-KR')}~${band.max.toLocaleString('ko-KR')}${band.unit} 규모 사업을 기준으로 작성되었다. `
    + `본 사업(${v.toLocaleString('ko-KR')}${band.unit})은 그 구간보다 ${direction}. `
    + `수치는 본 사업 기준으로 계산되었으나 서술문·표준 가정은 기준 구간을 따르므로, 금융조건·공사기간·단가 서술은 별도 확인이 필요하다.`;
}

/** 사용자 요청문/자산유형 문자열 → template */
function pickTemplate(text) {
  const s = String(text || '').toLowerCase();
  for (const t of Object.values(TEMPLATES)) {
    if (t.keywords.some(k => s.includes(k.toLowerCase()))) return t;
  }
  return TEMPLATES.generic;
}

function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES.generic;
}

/**
 * Dataset → 모델 입력. 출처 없는 default 사용 시 assumed 목록에 기록한다.
 * @returns {{input:object, sourced:string[], assumed:Array<{field:string,value:number,reason:string}>}}
 */
function buildInput(template, dataset) {
  const input = {};
  const sourced = [];
  const assumed = [];

  for (const [field, dictKey] of Object.entries(template.map)) {
    const n = dataset.num(dictKey);
    if (n !== null) {
      input[field] = n;
      sourced.push(`${field}=${dictKey}`);
    }
  }

  for (const [field, value] of Object.entries(template.defaults)) {
    if (input[field] === undefined || input[field] === null) {
      input[field] = value;
      const dictKey = template.map[field];
      assumed.push({
        field,
        dictKey: dictKey || null,
        value,
        reason: dictKey ? `${dictKey} 미확인 — ${template.label} 통상치 적용` : `${template.label} 기본 가정`,
      });
    }
  }

  // opexRatio 와 opexAnnual 이 동시에 잡히면 문서값(opexAnnual)을 우선한다
  if (dataset.num('opex.annual') !== null) input.opexRatio = null;

  return { input, sourced, assumed };
}

/** 시나리오 델타 적용 (% 는 비율, pp 는 절대 가산) */
function applyScenario(baseInput, scenario) {
  const out = { ...baseInput };
  const deltas = scenario.deltas || {};
  const units = scenario.unit || {};
  for (const [field, delta] of Object.entries(deltas)) {
    if (out[field] === undefined || out[field] === null) continue;
    out[field] = units[field] === 'pp' ? out[field] + delta : out[field] * (1 + delta / 100);
  }
  return out;
}

module.exports = { TEMPLATES, BASE_SCENARIOS, COMMON_MAP, SCALE_BANDS, pickTemplate, getTemplate, buildInput, applyScenario, scaleNotice };
