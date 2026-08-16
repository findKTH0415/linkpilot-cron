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

  /**
   * 풍력 — **육상과 해상을 나눈다** (등록부 D-55).
   *
   * ★ 하나로 두면 안 되는 이유가 명확하다. 해상은 육상 대비 사업비가 배 이상이고,
   *   공사기간·금융조건·계약구조가 전부 다르다. 하나의 「풍력」 템플릿으로 두면
   *   **숫자는 나오는데 어느 쪽 기준인지 알 수 없는 모델**이 된다 — 이 저장소가
   *   가장 경계하는 「그럴듯하게 틀린 것」이다.
   *
   * ★ **순서가 중요하다.** `pickTemplate` 은 키워드 포함 여부를 위에서부터
   *   본다. 해상을 먼저 두지 않으면 "해상풍력"이 육상으로 잡힌다.
   *
   * ⚠️ **아래 기본값은 전부 추측이다** (등록부 D-55). 제조(D-40)와 같은 처지다 —
   *    국내 실측 근거를 확인하지 못했다. 사업계획서 값이 들어오면 그쪽이 이긴다.
   */
  wind_offshore: {
    id: 'wind_offshore',
    label: '해상풍력',
    keywords: ['해상풍력', 'offshore wind', '부유식', 'floating wind'],
    map: COMMON_MAP,
    defaults: {
      // 〈추측〉 인허가·해상공사·계통연계가 길다. 육상의 배로 본다
      constructionYears: 4,
      // 〈추측〉 REC 계약기간에 맞춘다
      opsYears: 20, exitYear: 20,
      revenueEscalation: 0,
      // 〈추측〉 O&M 이 해상접근 비용 때문에 육상보다 크다
      opexRatio: 25, opexEscalation: 2, rampYears: 0,
      taxRate: 22, depreciationYears: 20,
      // 〈추측〉 사업비가 커 자기자본 부담이 크고, 공사위험이 금리에 실린다
      ltc: 70, debtRate: 6.2, tenorYears: 18, graceYears: 4, feePct: 2.0,
      exitCapRate: 8, sellingCostPct: 1.0, discountRate: 8, contingencyPct: 10,
    },
    keyMetrics: ['capacity.wind_mw', 'capacity.turbine_count', 'capacity.turbine_mw',
      'site.wind_speed', 'site.hub_height_m', 'site.water_depth_m', 'site.distance_to_shore_km'],
    sensitivity: [
      { key: 'annualRevenue', label: 'SMP+REC 변동(%)', values: [-20, -15, -10, -5, 0, 5] },
      // 공사기간이 길어 금리가 육상보다 세게 먹는다
      { key: 'debtRate', label: '차입금리(pp)', values: [-0.5, 0, 0.5, 1.0, 1.5, 2.0] },
    ],
  },

  wind_onshore: {
    id: 'wind_onshore',
    label: '육상풍력',
    keywords: ['육상풍력', 'onshore wind', '풍력', 'wind farm', 'wind'],
    map: COMMON_MAP,
    defaults: {
      // 〈추측〉 태양광(1년)보다 길고 해상보다 짧다 — 진입로·기초공사가 있다
      constructionYears: 2,
      opsYears: 20, exitYear: 20,
      revenueEscalation: 0,
      // 〈추측〉 태양광(15%)보다 크다 — 회전기계라 정비가 든다
      opexRatio: 20, opexEscalation: 2, rampYears: 0,
      taxRate: 22, depreciationYears: 20,
      ltc: 75, debtRate: 5.9, tenorYears: 15, graceYears: 2, feePct: 1.5,
      exitCapRate: 8, sellingCostPct: 1.0, discountRate: 7.5, contingencyPct: 5,
    },
    keyMetrics: ['capacity.wind_mw', 'capacity.turbine_count', 'capacity.turbine_mw',
      'site.wind_speed', 'site.hub_height_m'],
    sensitivity: [
      { key: 'annualRevenue', label: 'SMP+REC 변동(%)', values: [-20, -15, -10, -5, 0, 5] },
      { key: 'debtRate', label: '차입금리(pp)', values: [-0.5, 0, 0.5, 1.0, 1.5, 2.0] },
    ],
  },

  solar: {
    id: 'solar',
    label: '태양광 발전',
    // ★ `발전소` 를 뺐다 (2026-08-16). 「해상풍력 발전소」가 **태양광 템플릿으로
    //   잡히고 있었다** — 풍력 딜이 태양광 금융조건으로 돌아간다. 자산군을
    //   안 밝힌 「100MW 발전소」는 generic 으로 두는 편이 낫다
    keywords: ['태양광', 'solar', 'PV'],
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

  /**
   * 제조 — 생산시설. **부동산과 성격이 다르다.**
   *
   * 부동산은 임대료를 받고 Cap Rate 로 판다. 제조는 물건을 팔고, 나가는 돈의
   * 대부분이 원재료비다. 그래서 운영비율·감가상각 내용연수·운영기간이 전부
   * 다르다 — 「일반 프로젝트」로 두면 그 차이가 통째로 사라진다.
   *
   * ⚠️ **아래 기본값은 추측이다** (등록부 D-40). 업종마다 크게 갈리고
   *    (조립 vs 장치산업), 사용자 확인을 받지 못했다. 사업계획서 값이 들어오면
   *    그쪽이 이긴다 — 기본값은 값이 아예 없을 때의 출발점일 뿐이다.
   */
  manufacturing: {
    id: 'manufacturing',
    label: '제조 (생산시설)',
    keywords: ['제조', '생산공장', '플랜트', 'manufacturing'],
    map: COMMON_MAP,
    defaults: {
      // 〈추측〉 장치 반입·시운전이 있어 부동산보다 길다
      constructionYears: 2,
      // 〈추측〉 설비 내용연수에 맞춰 부동산보다 길게 본다
      opsYears: 15, exitYear: 10,
      revenueEscalation: 2,
      // 〈추측〉 **원재료비가 여기 들어간다** — 부동산(25%)과 가장 크게 갈리는 값이다
      opexRatio: 75,
      opexEscalation: 2, rampYears: 2,
      taxRate: 22,
      // 〈추측〉 건물 40년이 아니라 **기계장치 기준**이다
      depreciationYears: 12,
      ltc: 60, debtRate: 6.0, tenorYears: 10, graceYears: 2, feePct: 1.0,
      // 〈추측〉 제조는 Cap Rate 로 팔지 않는다(EBITDA 배수). 이 값은 자리를
      //   비워 둘 수 없어 넣은 것이고, **그대로 쓰면 안 된다**
      exitCapRate: 10.0,
      sellingCostPct: 1.5, discountRate: 9, contingencyPct: 7,
    },
    keyMetrics: ['capacity.production', 'capacity.power_mw'],
    sensitivity: [
      { key: 'annualRevenue', label: '매출 변동(%)', values: [-20, -15, -10, -5, 0, 5] },
      // 원재료비가 운영비의 대부분이라 여기가 가장 민감하다
      { key: 'opexRatio', label: '운영비율(pp)', values: [-10, -5, 0, 5, 10, 15] },
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
  // 〈추측 D-55〉 국내 사업 규모대를 확인하지 못했다. 구간을 모르면 서술문이
  //   어느 규모 기준인지 밝힐 수 없어, 넓게 잡고 추측임을 남긴다
  wind_onshore:  { key: 'capacity.wind_mw', label: '설비용량', unit: 'MW', min: 20, max: 300 },
  wind_offshore: { key: 'capacity.wind_mw', label: '설비용량', unit: 'MW', min: 100, max: 1500 },
  realestate:  { key: 'investment.total', label: '총사업비', unit: '억원', min: 300, max: 10000 },
  // 〈추측 D-40〉 구간을 모르면 서술문이 어느 규모 기준인지 밝힐 수 없다
  manufacturing: { key: 'investment.total', label: '총사업비', unit: '억원', min: 100, max: 20000 },
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


/**
 * 이 산업에서 쓰는 데이터 사전 key 집합.
 *
 * ★ 목록을 새로 적지 않는다. 이미 있는 정의를 조합할 뿐이다 —
 *   COMMON_MAP(모든 산업 공통 재무 항목) + 해당 템플릿의 keyMetrics +
 *   규모 기준(SCALE_BANDS). 여기에 목록을 따로 두면 템플릿이 바뀔 때 갈린다.
 *
 * 산업 전용 지표(데이터센터의 PUE, 태양광의 DC/AC 용량 등)는 **다른 산업에서는
 * 빠진다.** 태양광 딜에 PUE 입력란을 띄우면 무엇을 넣어야 하는지 헷갈린다.
 *
 * @param {string} id 템플릿 id (datacenter/solar/realestate/generic)
 * @returns {{own:string[], foreign:string[]}} own = 이 산업에서 쓰는 key,
 *   foreign = 다른 산업 전용이라 숨겨야 할 key
 */
function industryKeys(id) {
  const t = TEMPLATES[id] || TEMPLATES.generic;
  const own = new Set(Object.values(COMMON_MAP));
  (t.keyMetrics || []).forEach(k => own.add(k));
  const band = SCALE_BANDS[t.id];
  if (band && band.key) own.add(band.key);

  // 다른 산업의 전용 지표만 골라낸다 (공통 항목은 빼지 않는다)
  const foreign = new Set();
  Object.keys(TEMPLATES).forEach((other) => {
    if (other === t.id) return;
    (TEMPLATES[other].keyMetrics || []).forEach(k => { if (!own.has(k)) foreign.add(k); });
    const b = SCALE_BANDS[other];
    if (b && b.key && !own.has(b.key)) foreign.add(b.key);
  });

  // ★ 파이프라인이 요구하는 항목은 산업과 무관하게 숨기지 않는다.
  //   keyMetrics 는 '이 산업의 핵심 지표'일 뿐 '이 산업 전용'이 아니다 —
  //   대지면적·연면적처럼 어디서나 필요한 값이 섞여 있어서, 그대로 빼면
  //   필수 항목이 화면에서 사라지고 사용자는 왜 진행률이 안 오르는지 모른다.
  const { FIELDS } = require('../core/dictionary');
  [...foreign].forEach((k) => {
    const f = FIELDS[k];
    if (f && (f.requiredFor || []).length) { foreign.delete(k); own.add(k); }
  });

  return { own: [...own].sort(), foreign: [...foreign].sort() };
}

module.exports = { TEMPLATES, industryKeys, BASE_SCENARIOS, COMMON_MAP, SCALE_BANDS, pickTemplate, getTemplate, buildInput, applyScenario, scaleNotice };
