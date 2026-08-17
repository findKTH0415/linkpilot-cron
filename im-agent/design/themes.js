'use strict';
/**
 * themes.js — Design Theme 13종.
 *
 * ★ 테마는 코드가 아니라 데이터다. 렌더러(A4 HTML)·PPT 빌더·Dashboard 가 전부
 *   같은 테마 객체를 읽어야 '한 프로젝트 = 한 디자인' 이 성립한다.
 *   그래서 테마는 색 하나까지 전부 이 파일에 있고, 렌더러는 값을 하드코딩하지 않는다.
 *
 * ★ 구조 토큰(페이지 기하·괘선 두께·표 규격)은 테마가 바꾸지 않는다.
 *   바꾸는 것은 팔레트·타이포·표지 형식·차트 색·강조 KPI·선호 레이아웃뿐이다.
 *   구조까지 테마마다 다르면 문서가 서로 다른 시스템처럼 보인다.
 *
 * ★ institutional 이 PDI 핸드오프 정본(Navy #10233C / Gold #A6813C)이다.
 *   기존 Grand Hyatt IM·태양광 리포트와 나란히 놓을 문서는 이 계열을 쓴다.
 */

/**
 * ★ 글꼴 스택은 **`tokens.js` 한 곳에서만 정한다.** 13개 테마에 같은 문자열이
 *   복붙되어 있었고, 그래서 한글 글꼴 대체 문제(D-52)를 고치려면 13군데를
 *   똑같이 고쳐야 했다 — 하나만 빠뜨리면 그 테마로 만든 문서만 조용히 다른
 *   활자로 나간다. 테마가 타이포를 바꿀 일이 생기면 그때 값을 적는다.
 */
const { FONT } = require('./tokens');

/** 모든 테마가 공유하는 구조 토큰 (테마가 바꾸지 않는다) */
const STRUCTURE = {
  ruleStrong: '#D8D2C6',
  ruleWeak: '#E4DFD4',
  surface: '#FFFFFF',
  track: '#EDE9E0',
  negative: '#B4453A',
  brandRed: '#C0392B',
  body: '#2E3949',
  body2: '#3C4759',
  muted: '#6E7A8C',
  faint: '#8A8578',
  faint2: '#A09A8C',
};

/**
 * theme:
 *   primary       주색 (네이비 박스·표 괘선·제목)
 *   primaryMid    보조 막대
 *   accent        라벨·강조 (골드 계열)
 *   accentLight   하이라이트 막대
 *   onPrimary     주색 위 텍스트
 *   onPrimarySub  주색 위 보조 텍스트
 *   surfaceAlt    강조 박스 배경
 *   serif/sans    타이포
 *   cover         'rule' | 'fullImage' | 'split'
 *   chart         차트 팔레트 (5색)
 *   emphasisKpis  표지 KPI 우선순위 (dictionary key)
 *   layouts       절 유형별 선호 레이아웃
 *   density       'compact' | 'normal' | 'airy'  (여백 배율)
 */
const THEMES = {
  institutional: {
    id: 'institutional', no: '01',
    label: 'Institutional',
    labelKr: '기관투자자 / PF / Credit',
    purpose: '은행·기관투자자·금융기관·Credit Committee 제출용',
    traits: ['신뢰성', '보수적', '데이터 중심', '장식 배제'],
    docTypes: ['pf_proposal', 'credit_report', 'ic_memo', 'financial_report', 'dd_report'],
    primary: '#10233C', primaryMid: '#35506F', accent: '#A6813C', accentLight: '#C9A15A',
    onPrimary: '#F3E3C4', onPrimarySub: '#9FB0C4', surfaceAlt: '#F7F5F0',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'rule', density: 'normal',
    chart: ['#10233C', '#35506F', '#6E86A3', '#A6813C', '#C9A15A'],
    emphasisKpis: ['returns.min_dscr', 'debt.ltc', 'returns.project_irr', 'investment.total'],
    layouts: { financial: 'L06', risk: 'L11', sensitivity: 'L06' },
    note: 'PDI 핸드오프 정본. 기존 IM·리포트와 나란히 놓을 문서는 이 테마를 쓴다.',
  },

  global_ib: {
    id: 'global_ib', no: '02',
    label: 'Global Investment Bank',
    labelKr: 'M&A / 글로벌 투자자',
    purpose: '글로벌 투자은행 및 해외 투자자용',
    traits: ['Premium', 'International', 'Data-driven', 'Executive-focused'],
    docTypes: ['im', 'ma_im', 'teaser', 'investor_presentation'],
    primary: '#0B1B2B', primaryMid: '#2C4257', accent: '#B08D57', accentLight: '#CFAE7B',
    onPrimary: '#EFE6D3', onPrimarySub: '#9AAABB', surfaceAlt: '#F6F4EF',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'split', density: 'normal',
    chart: ['#0B1B2B', '#2C4257', '#5E7488', '#B08D57', '#CFAE7B'],
    emphasisKpis: ['returns.equity_irr', 'returns.equity_moic', 'investment.total', 'returns.exit_value'],
    layouts: { financial: 'L06', highlights: 'L04', market: 'L09' },
  },

  private_equity: {
    id: 'private_equity', no: '03',
    label: 'Private Equity',
    labelKr: 'PE / VC / 대체투자',
    purpose: 'PE·VC·Alternative Investment Fund',
    traits: ['Investment thesis 중심', 'KPI 강조', 'IRR/MOIC 강조', 'Exit 강조'],
    docTypes: ['im', 'ic_memo', 'investor_presentation'],
    primary: '#14213D', primaryMid: '#3A4E75', accent: '#C9A227', accentLight: '#E0BE55',
    onPrimary: '#F5EFDD', onPrimarySub: '#A3AEC6', surfaceAlt: '#F6F5F1',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'rule', density: 'compact',
    chart: ['#14213D', '#3A4E75', '#7686A8', '#C9A227', '#E0BE55'],
    emphasisKpis: ['returns.equity_irr', 'returns.equity_moic', 'returns.npv', 'returns.payback_years'],
    layouts: { highlights: 'L04', financial: 'L05', exit: 'L09', risk: 'L11' },
    // 사양 STYLE 03: Thesis → Metrics → Value Creation → Returns → Risk → Exit 순서 우선
    sectionPriority: ['highlights', 'exec_summary', 'financial', 'sensitivity', 'risk', 'exit'],
  },

  real_estate: {
    id: 'real_estate', no: '04',
    label: 'Real Estate Investment',
    labelKr: '부동산 개발 / 매입 / 매각',
    purpose: '부동산 개발·매입·매각·투자 프로젝트',
    traits: ['Location 강조', 'Satellite/GIS', '3D Modeling', 'Valuation', 'Feasibility'],
    docTypes: ['im', 'teaser', 'feasibility', 'valuation_report'],
    primary: '#12314B', primaryMid: '#3E5C77', accent: '#A6813C', accentLight: '#C9A15A',
    onPrimary: '#F3E3C4', onPrimarySub: '#A2B3C4', surfaceAlt: '#F7F5F0',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'fullImage', density: 'normal',
    chart: ['#12314B', '#3E5C77', '#7A93A9', '#A6813C', '#C9A15A'],
    emphasisKpis: ['investment.total', 'building.gfa_sqm', 'returns.equity_irr', 'exit.cap_rate'],
    layouts: { location: 'L07', asset: 'L01', financial: 'L06', risk: 'L11' },
    note: '부동산개발 IM의 기본 추천 테마.',
  },

  corporate: {
    id: 'corporate', no: '05',
    label: 'Corporate',
    labelKr: '기업 보고서 / 사업계획서',
    purpose: '기업 보고서 및 사업계획서',
    traits: ['Corporate Identity', 'Brand Color', '정돈된 표'],
    docTypes: ['business_plan', 'annual_report', 'financial_report'],
    primary: '#17457A', primaryMid: '#4571A0', accent: '#8C6D3F', accentLight: '#B08F5E',
    onPrimary: '#F0F4F8', onPrimarySub: '#A9BDD2', surfaceAlt: '#F5F7FA',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'rule', density: 'normal',
    chart: ['#17457A', '#4571A0', '#7C9DBE', '#8C6D3F', '#B08F5E'],
    emphasisKpis: ['investment.total', 'revenue.annual', 'returns.project_irr'],
    layouts: {},
    brandKitPriority: true, // 기업 Brand Guide 가 있으면 그쪽이 우선
  },

  premium: {
    id: 'premium', no: '06',
    label: 'Premium',
    labelKr: '호텔 / 복합개발 / 랜드마크',
    purpose: '호텔·복합개발·고급 주거·랜드마크 프로젝트',
    traits: ['Large Image', 'Minimal Text', 'Premium Typography', 'Full-page Image'],
    docTypes: ['teaser', 'im', 'investor_presentation'],
    primary: '#14100E', primaryMid: '#3B322C', accent: '#C9A15A', accentLight: '#DFC38C',
    onPrimary: '#F3E7D3', onPrimarySub: '#B8AA96', surfaceAlt: '#F8F5F0',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'fullImage', density: 'airy',
    chart: ['#14100E', '#3B322C', '#6E6055', '#C9A15A', '#DFC38C'],
    emphasisKpis: ['returns.exit_value', 'investment.total', 'returns.equity_irr'],
    layouts: { asset: 'L01', location: 'L01', exec_summary: 'L02' },
  },

  minimal: {
    id: 'minimal', no: '07',
    label: 'Minimal',
    labelKr: 'CEO / Executive 보고',
    purpose: '경영진 보고 및 Executive Presentation',
    traits: ['White Space', 'Minimal Color', 'Short Text', 'Large Number'],
    docTypes: ['ic_memo', 'executive_summary', 'teaser'],
    primary: '#111827', primaryMid: '#4B5563', accent: '#6B7280', accentLight: '#9CA3AF',
    onPrimary: '#F9FAFB', onPrimarySub: '#C3C9D2', surfaceAlt: '#F7F7F8',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'rule', density: 'airy',
    chart: ['#111827', '#4B5563', '#9CA3AF', '#D1D5DB', '#6B7280'],
    emphasisKpis: ['returns.equity_irr', 'investment.total', 'returns.min_dscr'],
    layouts: { exec_summary: 'L04', financial: 'L04' },
    onePointPerPage: true, // 사양 STYLE 07: 한 페이지 하나의 핵심 메시지
  },

  technology: {
    id: 'technology', no: '08',
    label: 'Technology / Data Center',
    labelKr: 'Data Center / AI / ICT',
    purpose: 'Data Center·AI Infrastructure·Cloud·ICT 프로젝트',
    traits: ['Technology Visual', 'Power Flow', 'Rack/MW Visualization', 'Infrastructure Diagram'],
    docTypes: ['im', 'technical_report', 'investor_presentation'],
    primary: '#0E1A2B', primaryMid: '#1F7A8C', accent: '#2FA8B8', accentLight: '#67C6D2',
    onPrimary: '#E8F4F6', onPrimarySub: '#8FB3BD', surfaceAlt: '#F2F7F8',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'split', density: 'compact',
    chart: ['#0E1A2B', '#1F7A8C', '#2FA8B8', '#67C6D2', '#A6813C'],
    emphasisKpis: ['capacity.it_load_mw', 'capacity.pue', 'investment.total', 'returns.equity_irr'],
    layouts: { technical: 'L05', asset: 'L04', financial: 'L06' },
  },

  renewable: {
    id: 'renewable', no: '09',
    label: 'Renewable Energy',
    labelKr: 'Solar / Wind / ESS / Hydrogen',
    purpose: '재생에너지·에너지 인프라 프로젝트',
    traits: ['Satellite Image', 'Site Map', 'Energy Flow', 'Carbon Reduction'],
    docTypes: ['im', 'feasibility', 'technical_report'],
    primary: '#0F3D2E', primaryMid: '#2F6A52', accent: '#7FA650', accentLight: '#A7C579',
    onPrimary: '#EAF3EC', onPrimarySub: '#9BB8A8', surfaceAlt: '#F3F7F3',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'fullImage', density: 'normal',
    chart: ['#0F3D2E', '#2F6A52', '#7FA650', '#A7C579', '#A6813C'],
    emphasisKpis: ['capacity.dc_kw', 'revenue.annual', 'returns.project_irr', 'investment.total'],
    layouts: { location: 'L07', technical: 'L05', financial: 'L06' },
  },

  infrastructure: {
    id: 'infrastructure', no: '10',
    label: 'Infrastructure',
    labelKr: 'SOC / 물류 / 산업단지',
    purpose: '도로·철도·항만·발전소·산업단지·물류',
    traits: ['Master Plan', 'Infrastructure Map', 'Timeline', 'Funding Structure'],
    docTypes: ['pf_proposal', 'im', 'feasibility'],
    primary: '#263238', primaryMid: '#4F6470', accent: '#C07C2C', accentLight: '#D9A052',
    onPrimary: '#F0F2F3', onPrimarySub: '#A8B4BB', surfaceAlt: '#F5F6F7',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'rule', density: 'normal',
    chart: ['#263238', '#4F6470', '#8497A1', '#C07C2C', '#D9A052'],
    emphasisKpis: ['investment.total', 'debt.amount', 'returns.min_dscr', 'schedule.construction_years'],
    layouts: { development: 'L08', financing: 'L10', financial: 'L06' },
  },

  luxury: {
    id: 'luxury', no: '11',
    label: 'Luxury / Hospitality',
    labelKr: '호텔 / 리조트 / 복합관광',
    purpose: '호텔·리조트·복합관광개발',
    traits: ['Full-page Photography', 'Large Typography', 'Experience-oriented'],
    docTypes: ['im', 'teaser', 'investor_presentation'],
    primary: '#1B1410', primaryMid: '#4A3B31', accent: '#BFA06A', accentLight: '#D8C098',
    onPrimary: '#F5EADA', onPrimarySub: '#BCA98F', surfaceAlt: '#F9F6F1',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'fullImage', density: 'airy',
    chart: ['#1B1410', '#4A3B31', '#7D6B5C', '#BFA06A', '#D8C098'],
    emphasisKpis: ['returns.noi_stabilized', 'exit.cap_rate', 'returns.exit_value', 'returns.equity_irr'],
    layouts: { asset: 'L01', location: 'L01', market: 'L09' },
  },

  government: {
    id: 'government', no: '12',
    label: 'Government / Public',
    labelKr: '공공기관 / 지자체 / 정책사업',
    purpose: '공공기관·지자체·정책사업·공공투자',
    traits: ['Formal', 'Clear', 'Accessible', 'Official'],
    docTypes: ['feasibility', 'financial_report', 'dd_report'],
    primary: '#12365E', primaryMid: '#41618A', accent: '#6E7A8C', accentLight: '#93A0B0',
    onPrimary: '#EEF3F8', onPrimarySub: '#A7B8CB', surfaceAlt: '#F4F6F9',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'rule', density: 'normal',
    chart: ['#12365E', '#41618A', '#7A8FA8', '#6E7A8C', '#93A0B0'],
    emphasisKpis: ['investment.total', 'schedule.construction_years', 'returns.project_irr'],
    layouts: { financial: 'L06', development: 'L08' },
  },

  custom: {
    id: 'custom', no: '13',
    label: 'Custom',
    labelKr: '사용자 지정',
    purpose: '사용자가 직접 지정하거나 Brand Kit 을 적용',
    traits: [],
    docTypes: [],
    // 기본값은 institutional 을 상속하고 Brand Kit 이 덮어쓴다
    inherits: 'institutional',
    primary: '#10233C', primaryMid: '#35506F', accent: '#A6813C', accentLight: '#C9A15A',
    onPrimary: '#F3E3C4', onPrimarySub: '#9FB0C4', surfaceAlt: '#F7F5F0',
    serif: FONT.serif, sans: FONT.sans,
    cover: 'rule', density: 'normal',
    chart: ['#10233C', '#35506F', '#6E86A3', '#A6813C', '#C9A15A'],
    emphasisKpis: [],
    layouts: {},
  },
};

const DENSITY = {
  compact: { section: 16, card: 14, cover: 20 },
  normal: { section: 20, card: 16, cover: 26 },
  airy: { section: 28, card: 22, cover: 36 },
};

/**
 * 문서 유형별 테마 보정 (사양 §9).
 * ★ 프로젝트 Brand Identity 는 유지한다 — 테마를 통째로 바꾸지 않고
 *   밀도·표지형식·레이아웃만 문서 성격에 맞춘다.
 */
const DOC_PROFILE = {
  im: { density: null, cover: null },
  teaser: { density: 'airy', cover: 'fullImage' },
  ic_memo: { density: 'compact', cover: 'rule' },
  financial_report: { density: 'compact', cover: 'rule' },
  technical_report: { density: 'compact', cover: 'rule' },
  dd_report: { density: 'normal', cover: 'rule' },
  legal_dd: { density: 'normal', cover: 'rule' },
  pf_proposal: { density: 'normal', cover: 'rule' },
  feasibility: { density: 'normal', cover: 'rule' },
  investor_presentation: { density: 'airy', cover: 'split' },
  dashboard: { density: 'compact', cover: null },
};

function list() {
  return Object.values(THEMES).map(t => ({
    id: t.id, no: t.no, label: t.label, labelKr: t.labelKr,
    purpose: t.purpose, traits: t.traits, note: t.note || null,
  }));
}

function get(id) {
  return THEMES[id] || null;
}

/**
 * 테마 + 문서유형 + Brand Kit → 최종 테마 객체.
 * Brand Kit 이 가장 강하다 (사양 §8: 기업 선택 시 자동 적용).
 */
function resolve(themeId = 'institutional', { docType = 'im', brandKit = null } = {}) {
  const base = THEMES[themeId] || THEMES.institutional;
  const profile = DOC_PROFILE[docType] || {};

  const theme = {
    ...STRUCTURE,
    ...base,
    docType,
    density: profile.density || base.density,
    cover: profile.cover || base.cover,
  };

  if (brandKit) {
    if (brandKit.primaryColor) theme.primary = brandKit.primaryColor;
    if (brandKit.secondaryColor) theme.primaryMid = brandKit.secondaryColor;
    if (brandKit.accentColor) { theme.accent = brandKit.accentColor; theme.accentLight = brandKit.accentColor; }
    if (brandKit.font) { theme.sans = brandKit.font; theme.serif = brandKit.font; }
    if (Array.isArray(brandKit.chart) && brandKit.chart.length) theme.chart = brandKit.chart;
    theme.brandKit = {
      company: brandKit.company || null,
      logo: brandKit.logo || null,
      footer: brandKit.footer || null,
      website: brandKit.website || null,
    };
  }

  theme.spacing = DENSITY[theme.density] || DENSITY.normal;
  theme.resolvedFrom = { themeId: base.id, docType, brandKit: !!brandKit };
  return theme;
}

/** 테마를 CSS 변수로 — PPT 빌더·Dashboard 가 같은 값을 쓰게 한다 */
function toCss(theme) {
  const vars = [
    ['primary', theme.primary], ['primary-mid', theme.primaryMid],
    ['accent', theme.accent], ['accent-light', theme.accentLight],
    ['on-primary', theme.onPrimary], ['on-primary-sub', theme.onPrimarySub],
    ['surface', theme.surface], ['surface-alt', theme.surfaceAlt],
    ['track', theme.track], ['negative', theme.negative],
    ['rule-strong', theme.ruleStrong], ['rule-weak', theme.ruleWeak],
    ['body', theme.body], ['muted', theme.muted], ['faint', theme.faint],
    ['brand-red', theme.brandRed],
    ['font-serif', theme.serif], ['font-sans', theme.sans],
  ];
  const chart = theme.chart.map((c, i) => `  --lp-chart-${i + 1}: ${c};`).join('\n');
  return `/* LinkPilot Design Theme — ${theme.label} (${theme.id}) */\n:root {\n`
    + vars.map(([k, v]) => `  --lp-${k}: ${v};`).join('\n')
    + `\n${chart}\n}\n`;
}

module.exports = { THEMES, STRUCTURE, DENSITY, DOC_PROFILE, list, get, resolve, toCss };
