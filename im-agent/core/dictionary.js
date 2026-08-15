'use strict';
/**
 * dictionary.js — Data Dictionary.
 *
 * 모든 프로젝트가 동일한 key 체계를 쓴다. 여기에 없는 key는 IM/재무모델에 들어가지 못한다.
 * (자유 서술 항목은 narrative.* 로 별도 관리)
 *
 * 정규화 단위(고정):
 *   금액  = 억원   (KRW 100M)
 *   면적  = ㎡
 *   전력  = MW
 *   비율  = %      (5.5 = 5.5%)
 *   기간  = 년
 */

const CATEGORY = {
  PROJECT: 'Project', LAND: 'Land', BUILDING: 'Building', CAPACITY: 'Capacity',
  INVESTMENT: 'Investment', REVENUE: 'Revenue', OPEX: 'OPEX', DEBT: 'Debt',
  EQUITY: 'Equity', TAX: 'Tax', SCHEDULE: 'Schedule', EXIT: 'Exit', LEGAL: 'Legal',
};

/**
 * field: { label, category, unit, type, aliases[], min, max, tolerance, requiredFor[] }
 *  - aliases: 문서에서 이 항목을 가리키는 표기 (추출 Agent가 사용)
 *  - tolerance: 값 충돌 판정 상대오차
 *  - requiredFor: 'financial' | 'im' | 'teaser'
 */
const FIELDS = {
  // ── Project ────────────────────────────────────────────────
  'project.name':        { label: '사업명', category: CATEGORY.PROJECT, unit: null, type: 'string', aliases: ['사업명', '프로젝트명', 'Project Name'], requiredFor: ['im', 'teaser'] },
  'project.assetType':   { label: '자산유형', category: CATEGORY.PROJECT, unit: null, type: 'string', aliases: ['자산유형', 'Asset Type'], requiredFor: ['im', 'teaser', 'financial'] },
  'project.sponsor':     { label: '시행사/스폰서', category: CATEGORY.PROJECT, unit: null, type: 'string', aliases: ['시행사', '시행자', '사업주체', 'Sponsor', 'Developer'], requiredFor: ['im'] },
  'project.location':    { label: '소재지', category: CATEGORY.PROJECT, unit: null, type: 'string', aliases: ['소재지', '주소', '위치', 'Location', 'Address'], requiredFor: ['im', 'teaser'] },

  // ── Land / Building ────────────────────────────────────────
  'land.area_sqm':       { label: '대지면적', category: CATEGORY.LAND, unit: '㎡', type: 'number', aliases: ['대지면적', '토지면적', '부지면적', 'Site Area', 'Land Area'], min: 0, tolerance: 0.001, requiredFor: ['im'] },
  'land.ownership':      { label: '토지 확보상태', category: CATEGORY.LAND, unit: null, type: 'string', aliases: ['토지소유', '소유권', '토지확보', 'Ownership'], requiredFor: ['im'] },
  'land.zoning':         { label: '용도지역', category: CATEGORY.LAND, unit: null, type: 'string', aliases: ['용도지역', '지목', 'Zoning'] },
  'building.gfa_sqm':    { label: '연면적', category: CATEGORY.BUILDING, unit: '㎡', type: 'number', aliases: ['연면적', '총연면적', 'GFA', 'Gross Floor Area'], min: 0, tolerance: 0.001, requiredFor: ['im'] },
  'building.floors':     { label: '층수', category: CATEGORY.BUILDING, unit: '층', type: 'number', aliases: ['층수', '규모', 'Floors'], min: 0 },

  // ── Capacity ───────────────────────────────────────────────
  'capacity.it_load_mw': { label: 'IT Load', category: CATEGORY.CAPACITY, unit: 'MW', type: 'number', aliases: ['IT Load', 'IT부하', 'IT 용량', '전산부하'], min: 0, requiredFor: ['im', 'teaser'] },
  'capacity.power_mw':   { label: '수전용량', category: CATEGORY.CAPACITY, unit: 'MW', type: 'number', aliases: ['수전용량', '계약전력', '총 전력', 'Power Capacity'], min: 0 },
  'capacity.pue':        { label: 'PUE', category: CATEGORY.CAPACITY, unit: null, type: 'number', aliases: ['PUE'], min: 1.0, max: 2.5 },
  'capacity.dc_kw':      { label: '설비용량(DC)', category: CATEGORY.CAPACITY, unit: 'kW', type: 'number', aliases: ['설비용량', 'DC용량', '모듈용량'], min: 0 },
  'capacity.ac_kw':      { label: '설비용량(AC)', category: CATEGORY.CAPACITY, unit: 'kW', type: 'number', aliases: ['AC용량', '인버터용량', '발전용량'], min: 0 },
  'capacity.leasable_sqm': { label: '임대면적', category: CATEGORY.CAPACITY, unit: '㎡', type: 'number', aliases: ['임대면적', '전용면적', 'NLA', 'Leasable Area'], min: 0 },

  // ── Investment (금액 = 억원) ────────────────────────────────
  'investment.total':        { label: '총사업비', category: CATEGORY.INVESTMENT, unit: '억원', type: 'number', aliases: ['총사업비', '총투자비', '사업비', 'Total Project Cost', 'TPC'], min: 0, tolerance: 0.005, requiredFor: ['financial', 'im', 'teaser'] },
  'investment.land':         { label: '토지비', category: CATEGORY.INVESTMENT, unit: '억원', type: 'number', aliases: ['토지비', '토지매입비', '용지비', 'Land Cost'], min: 0, tolerance: 0.005, requiredFor: ['financial'] },
  'investment.construction': { label: '공사비', category: CATEGORY.INVESTMENT, unit: '억원', type: 'number', aliases: ['공사비', '건축공사비', '도급공사비', 'CAPEX', 'Construction Cost'], min: 0, tolerance: 0.005, requiredFor: ['financial'] },
  'investment.other':        { label: '기타사업비', category: CATEGORY.INVESTMENT, unit: '억원', type: 'number', aliases: ['기타사업비', '간접비', '설계감리비', 'Soft Cost'], min: 0, tolerance: 0.005 },
  'investment.contingency_pct': { label: '예비비율', category: CATEGORY.INVESTMENT, unit: '%', type: 'number', aliases: ['예비비', 'Contingency'], min: 0, max: 30 },

  // ── Revenue / OPEX ─────────────────────────────────────────
  'revenue.annual':      { label: '연간 매출(안정화)', category: CATEGORY.REVENUE, unit: '억원', type: 'number', aliases: ['연매출', '연간매출', '안정화매출', 'Annual Revenue'], min: 0, tolerance: 0.005, requiredFor: ['financial'] },
  'revenue.unit_price':  { label: '단가/임대료', category: CATEGORY.REVENUE, unit: null, type: 'number', aliases: ['임대료', '단가', '월임대료', 'Rent', 'Tariff'], min: 0 },
  'revenue.escalation':  { label: '매출 상승률', category: CATEGORY.REVENUE, unit: '%', type: 'number', aliases: ['임대료상승률', '매출상승률', 'Escalation'], min: -10, max: 20 },
  'revenue.ramp_years':  { label: '매출 안정화 소요기간', category: CATEGORY.REVENUE, unit: '년', type: 'number', aliases: ['안정화기간', 'Ramp-up'], min: 0, max: 10 },
  'opex.annual':         { label: '연간 운영비', category: CATEGORY.OPEX, unit: '억원', type: 'number', aliases: ['운영비', '연간운영비', 'OPEX'], min: 0, tolerance: 0.005 },
  'opex.ratio':          { label: '운영비율(매출대비)', category: CATEGORY.OPEX, unit: '%', type: 'number', aliases: ['운영비율', 'OPEX Ratio'], min: 0, max: 100 },
  'opex.escalation':     { label: '운영비 상승률', category: CATEGORY.OPEX, unit: '%', type: 'number', aliases: ['운영비상승률'], min: -10, max: 20 },

  // ── Debt / Equity ──────────────────────────────────────────
  'debt.amount':         { label: '차입금', category: CATEGORY.DEBT, unit: '억원', type: 'number', aliases: ['차입금', '대출금', '타인자본', 'Debt', 'Loan'], min: 0, tolerance: 0.005 },
  'debt.ltc':            { label: 'LTC(총사업비 대비 차입비율)', category: CATEGORY.DEBT, unit: '%', type: 'number', aliases: ['LTC', '차입비율'], min: 0, max: 100 },
  'debt.ltv':            { label: 'LTV', category: CATEGORY.DEBT, unit: '%', type: 'number', aliases: ['LTV', '담보인정비율'], min: 0, max: 100 },
  'debt.rate':           { label: '차입금리', category: CATEGORY.DEBT, unit: '%', type: 'number', aliases: ['금리', '이자율', '차입금리', 'Interest Rate'], min: 0, max: 30, requiredFor: ['financial'] },
  // ★ 차입금리가 아니라 **기준선**이다. PF 금리 = 기준금리 + 스프레드이고 스프레드는
  //   딜마다 다르다. 이 값으로 debt.rate 를 대체하면 IRR 이 통째로 부풀려진다 (ecos.js)
  'debt.benchmark_rate': { label: '기준금리(시장)', category: CATEGORY.DEBT, unit: '%', type: 'number', min: 0, max: 30 },
  'debt.tenor_years':    { label: '대출기간', category: CATEGORY.DEBT, unit: '년', type: 'number', aliases: ['대출기간', '만기', 'Tenor', 'Maturity'], min: 0, max: 50 },
  'debt.grace_years':    { label: '거치기간', category: CATEGORY.DEBT, unit: '년', type: 'number', aliases: ['거치기간', 'Grace Period'], min: 0, max: 20 },
  'debt.fee_pct':        { label: '취급수수료', category: CATEGORY.DEBT, unit: '%', type: 'number', aliases: ['취급수수료', '주선수수료', 'Arrangement Fee'], min: 0, max: 10 },
  'equity.amount':       { label: '자기자본', category: CATEGORY.EQUITY, unit: '억원', type: 'number', aliases: ['자기자본', '자본금', 'Equity'], min: 0, tolerance: 0.005 },

  // ── Tax / Schedule / Exit ──────────────────────────────────
  'tax.rate':            { label: '법인세율', category: CATEGORY.TAX, unit: '%', type: 'number', aliases: ['법인세율', '세율', 'Tax Rate'], min: 0, max: 50 },
  'tax.depreciation_years': { label: '감가상각 내용연수', category: CATEGORY.TAX, unit: '년', type: 'number', aliases: ['내용연수', '감가상각기간'], min: 1, max: 60 },
  'schedule.construction_years': { label: '공사기간', category: CATEGORY.SCHEDULE, unit: '년', type: 'number', aliases: ['공사기간', '건설기간', 'Construction Period'], min: 0, max: 15, requiredFor: ['financial'] },
  'schedule.ops_years':  { label: '운영기간', category: CATEGORY.SCHEDULE, unit: '년', type: 'number', aliases: ['운영기간', '사업기간', 'Operating Period'], min: 1, max: 50, requiredFor: ['financial'] },
  'exit.cap_rate':       { label: 'Exit Cap Rate', category: CATEGORY.EXIT, unit: '%', type: 'number', aliases: ['Cap Rate', '환원율', 'Exit Cap', '자본환원율'], min: 1, max: 20, requiredFor: ['financial'] },
  'exit.year':           { label: 'Exit 시점(운영 n년차)', category: CATEGORY.EXIT, unit: '년', type: 'number', aliases: ['Exit 시점', '매각시점'], min: 1, max: 50 },
  'exit.selling_cost_pct': { label: '매각부대비용', category: CATEGORY.EXIT, unit: '%', type: 'number', aliases: ['매각비용', 'Selling Cost'], min: 0, max: 10 },

  // ── Geo / 지적 (공공데이터 연동으로 채워지는 항목) ──────────
  'geo.pnu':             { label: '필지고유번호(PNU)', category: CATEGORY.LAND, unit: null, type: 'string', aliases: ['PNU', '필지고유번호'] },
  'geo.lat':             { label: '위도', category: CATEGORY.LAND, unit: null, type: 'number', aliases: [], min: 33, max: 39 },
  'geo.lon':             { label: '경도', category: CATEGORY.LAND, unit: null, type: 'number', aliases: [], min: 124, max: 132 },
  'land.official_price': { label: '개별공시지가', category: CATEGORY.LAND, unit: '원/㎡', type: 'number', aliases: ['개별공시지가', '공시지가'], min: 0, tolerance: 0.01 },
  'land.far_limit':      { label: '용적률 상한', category: CATEGORY.LAND, unit: '%', type: 'number', aliases: ['용적률'], min: 0, max: 2000 },
  'land.bcr_limit':      { label: '건폐율 상한', category: CATEGORY.LAND, unit: '%', type: 'number', aliases: ['건폐율'], min: 0, max: 100 },
  'building.footprint_sqm': { label: '건축면적', category: CATEGORY.BUILDING, unit: '㎡', type: 'number', aliases: ['건축면적'], min: 0, tolerance: 0.001 },
  'building.height_m':   { label: '최고높이', category: CATEGORY.BUILDING, unit: 'm', type: 'number', aliases: ['최고높이', '건축물높이'], min: 0, max: 700 },

  // ── Legal ──────────────────────────────────────────────────
  'legal.permit_status': { label: '인허가 현황', category: CATEGORY.LEGAL, unit: null, type: 'string', aliases: ['인허가', '허가현황', '건축허가', 'Permit'], requiredFor: ['im'] },
  'legal.spc':           { label: 'SPC/사업시행법인', category: CATEGORY.LEGAL, unit: null, type: 'string', aliases: ['SPC', '시행법인', '특수목적법인'] },
};

/**
 * 계산으로만 생성되는 key (추출/입력 금지 — Financial Agent 전용 출력).
 * 표시 라벨을 여기서 함께 관리해야 IM 본문에 raw key 가 노출되지 않는다.
 */
const COMPUTED_FIELDS = {
  'returns.project_irr':    { label: 'Project IRR', unit: '%' },
  'returns.equity_irr':     { label: 'Equity IRR', unit: '%' },
  'returns.project_moic':   { label: 'Project MOIC', unit: 'x' },
  'returns.equity_moic':    { label: 'Equity Multiple', unit: 'x' },
  'returns.npv':            { label: 'NPV', unit: '억원' },
  'returns.min_dscr':       { label: '최소 DSCR', unit: 'x' },
  'returns.avg_dscr':       { label: '평균 DSCR', unit: 'x' },
  'returns.debt_yield':     { label: 'Debt Yield', unit: '%' },
  'returns.payback_years':  { label: '자본 회수기간', unit: '년' },
  'returns.exit_value':     { label: 'Exit Value', unit: '억원' },
  'returns.noi_stabilized': { label: '안정화 NOI', unit: '억원' },

  // 감정평가 Agent 산출 (참고용 간이 평가 — 법정 감정평가 아님)
  'appraisal.land_value_official':    { label: '토지가치(공시지가 기준)', unit: '억원' },
  'appraisal.land_value_comparison':  { label: '토지가치(거래사례비교법)', unit: '억원' },
  'appraisal.land_value_income':      { label: '토지가치(수익환원법)', unit: '억원' },
  'appraisal.land_value_concluded':   { label: '토지가치(참고 결론)', unit: '억원' },
  'appraisal.market_price_per_sqm':   { label: '인근 실거래 단가(중앙값)', unit: '원/㎡' },

  // 매스 검토 Agent 산출
  'massing.gfa_allowed_sqm': { label: '법정 허용 연면적', unit: '㎡' },
  'massing.far_planned':     { label: '계획 용적률', unit: '%' },
  'massing.bcr_planned':     { label: '계획 건폐율', unit: '%' },
};

const COMPUTED_KEYS = Object.keys(COMPUTED_FIELDS);

/**
 * 출처일(sourceDate)을 물어야 하는 항목 — **값이 시점에 따라 달라지는 것만.**
 *
 * 시행사명·연면적·대지면적은 언제 조회했든 같은 값이다. 금리·매출·인허가 현황은
 * 다르다. 안 변하는 값에 날짜를 물으면 사람은 **오늘 날짜를 적고**, 그 날짜는
 * 아무것도 뜻하지 않는다. 뜻 없는 값이 출처표에 실리면 출처표 전체가 덜 믿긴다.
 *
 * ★ 판정은 여기(사전)에서만 한다. 화면은 `def.dated` 를 읽기만 한다 —
 *   화면이 카테고리를 보고 판단하기 시작하면 사전과 갈린다.
 */
const DATED_CATEGORIES = new Set([
  CATEGORY.INVESTMENT,   // 견적 시점이 곧 값의 의미다
  CATEGORY.REVENUE, CATEGORY.OPEX,
  CATEGORY.DEBT, CATEGORY.EQUITY,
  CATEGORY.TAX,          // 세율은 개정된다
  CATEGORY.EXIT,         // Cap Rate 는 시장이다
  CATEGORY.LEGAL,        // 인허가는 시점이 곧 정보다
]);

/** 카테고리 규칙에서 벗어나는 개별 항목 (규칙과 같은 값을 적어 두면 테스트가 잡는다) */
const DATED_OVERRIDE = {
  'land.official_price': true,   // 개별공시지가 — 연 1회 고시, 몇 년치인지가 핵심
  'land.ownership': true,        // 토지 확보상태 — 협의중/계약/이전완료가 시점마다 바뀐다
};

function needsSourceDate(key) {
  if (Object.prototype.hasOwnProperty.call(DATED_OVERRIDE, key)) return DATED_OVERRIDE[key];
  const f = FIELDS[key];
  return !!(f && DATED_CATEGORIES.has(f.category));
}

// 정의에 박아 둔다 — `GET /fields` 가 그대로 내려보내고 화면은 읽기만 한다
Object.keys(FIELDS).forEach((k) => { FIELDS[k].dated = needsSourceDate(k); });

function field(key) { return FIELDS[key] || COMPUTED_FIELDS[key] || null; }

/** 사람이 읽는 항목명. 정의가 없으면 key 그대로 (조용히 빈 문자열로 만들지 않는다) */
function labelFor(key) {
  const f = field(key);
  return f ? f.label : key;
}

function requiredFor(purpose) {
  return Object.entries(FIELDS)
    .filter(([, f]) => (f.requiredFor || []).includes(purpose))
    .map(([k]) => k);
}

/** alias 문자열 → dictionary key (긴 alias 우선 매칭) */
const ALIAS_INDEX = (() => {
  const idx = [];
  for (const [key, f] of Object.entries(FIELDS)) {
    for (const a of f.aliases || []) idx.push({ alias: a, aliasLower: a.toLowerCase(), key });
  }
  idx.sort((a, b) => b.alias.length - a.alias.length);
  return idx;
})();

function keyForAlias(text) {
  const t = String(text).trim().toLowerCase();
  const hit = ALIAS_INDEX.find(e => e.aliasLower === t);
  return hit ? hit.key : null;
}

/** 값이 dictionary 정의 범위를 벗어나는지 (Validation Agent가 사용) */
function rangeViolation(key, value) {
  const f = FIELDS[key];
  if (!f || f.type !== 'number') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return `${f.label}: 숫자가 아님 (${value})`;
  if (f.min !== undefined && n < f.min) return `${f.label}: ${n}${f.unit || ''} < 허용 최소 ${f.min}`;
  if (f.max !== undefined && n > f.max) return `${f.label}: ${n}${f.unit || ''} > 허용 최대 ${f.max}`;
  return null;
}

module.exports = {
  FIELDS, CATEGORY, COMPUTED_FIELDS, COMPUTED_KEYS,
  field, labelFor, requiredFor, keyForAlias, rangeViolation, ALIAS_INDEX,
  needsSourceDate, DATED_CATEGORIES, DATED_OVERRIDE,
};
