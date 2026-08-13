'use strict';
/**
 * recommend.js — AI Design Recommendation (사양 §6 · §19).
 *
 * ★ 규칙 기반이다. 언어모델을 쓰지 않는다.
 *   같은 프로젝트에 같은 추천이 나와야 하고, 왜 그 테마가 나왔는지 설명할 수 있어야 한다.
 *   "Confidence 96%" 가 매번 달라지면 그건 신뢰도가 아니라 잡음이다.
 *
 * 점수 = Σ(신호별 가중치). 상위 3개를 normalize 해서 confidence 로 보여준다.
 */

const themes = require('./themes');

/** 신호별 가중치 — 클수록 결정력이 크다 */
const W = {
  assetType: 40,
  docType: 22,
  investorType: 20,
  transactionType: 10,
  country: 8,
};

/** 자산유형 → 테마 점수 */
const ASSET = {
  datacenter: { technology: 1.0, global_ib: 0.55, institutional: 0.45 },
  solar: { renewable: 1.0, infrastructure: 0.5, institutional: 0.45 },
  wind: { renewable: 1.0, infrastructure: 0.55 },
  ess: { renewable: 0.95, technology: 0.5 },
  realestate: { real_estate: 1.0, global_ib: 0.55, institutional: 0.5 },
  hotel: { luxury: 1.0, premium: 0.85, real_estate: 0.6 },
  resort: { luxury: 1.0, premium: 0.8 },
  logistics: { infrastructure: 0.85, real_estate: 0.75, institutional: 0.5 },
  office: { real_estate: 0.95, global_ib: 0.6 },
  mixed_use: { premium: 0.85, real_estate: 0.85 },
  road: { infrastructure: 1.0, government: 0.7 },
  port: { infrastructure: 1.0, government: 0.65 },
  industrial_complex: { infrastructure: 0.9, government: 0.6, real_estate: 0.5 },
  generic: { institutional: 0.6, corporate: 0.5 },
};

/** 문서유형 → 테마 점수 */
const DOC = {
  im: { global_ib: 0.9, real_estate: 0.6, institutional: 0.55 },
  ma_im: { global_ib: 1.0, private_equity: 0.7 },
  teaser: { premium: 0.9, global_ib: 0.7, luxury: 0.5 },
  ic_memo: { minimal: 0.95, private_equity: 0.7, institutional: 0.6 },
  financial_report: { institutional: 1.0, corporate: 0.6, government: 0.5 },
  technical_report: { technology: 0.8, renewable: 0.6, institutional: 0.5 },
  dd_report: { institutional: 0.95, government: 0.5 },
  legal_dd: { institutional: 0.9, government: 0.7 },
  pf_proposal: { institutional: 1.0, infrastructure: 0.7 },
  credit_report: { institutional: 1.0 },
  feasibility: { institutional: 0.7, infrastructure: 0.6, government: 0.6 },
  investor_presentation: { global_ib: 0.85, premium: 0.7, private_equity: 0.6 },
  business_plan: { corporate: 1.0 },
  dashboard: { minimal: 0.8, technology: 0.6 },
};

/** 투자자 유형 → 테마 점수 */
const INVESTOR = {
  bank: { institutional: 1.0, infrastructure: 0.5 },
  institutional: { institutional: 1.0, global_ib: 0.6 },
  pension: { institutional: 0.95, global_ib: 0.6 },
  pe: { private_equity: 1.0, global_ib: 0.7 },
  vc: { private_equity: 0.95, technology: 0.5 },
  global: { global_ib: 1.0, premium: 0.5 },
  strategic: { corporate: 0.8, global_ib: 0.6 },
  public: { government: 1.0, institutional: 0.6 },
  hnwi: { luxury: 0.9, premium: 0.85 },
  internal: { minimal: 0.9, corporate: 0.6 },
};

const TRANSACTION = {
  development: { real_estate: 0.8, infrastructure: 0.5 },
  acquisition: { global_ib: 0.7, premium: 0.5 },
  financing: { institutional: 0.9, infrastructure: 0.5 },
  ma: { global_ib: 1.0, private_equity: 0.6 },
  exit: { private_equity: 0.8, global_ib: 0.6 },
};

const COUNTRY = {
  KR: {},
  global: { global_ib: 0.8 },
  US: { global_ib: 0.8 },
  JP: { global_ib: 0.6, institutional: 0.4 },
  SG: { global_ib: 0.8 },
};

/** 자산유형 문자열/템플릿 id → ASSET 키 */
function assetKey(input) {
  const s = String(input || '').toLowerCase();
  const map = [
    ['datacenter', ['데이터센터', 'data center', 'datacenter', 'idc']],
    ['solar', ['태양광', 'solar', 'pv']],
    ['wind', ['풍력', 'wind']],
    ['ess', ['ess', '에너지저장']],
    ['hotel', ['호텔', 'hotel', 'hospitality']],
    ['resort', ['리조트', 'resort']],
    ['logistics', ['물류', 'logistics', '창고']],
    ['office', ['오피스', 'office', '업무시설']],
    ['mixed_use', ['복합', 'mixed']],
    ['road', ['도로', '철도', 'road', 'rail']],
    ['port', ['항만', 'port']],
    ['industrial_complex', ['산업단지', '지식산업센터', 'industrial']],
    ['realestate', ['부동산', 'real estate', 'pf', '개발사업', '주상복합']],
  ];
  for (const [key, words] of map) {
    if (words.some(w => s.includes(w))) return key;
  }
  return 'generic';
}

function addScores(target, table, key, weight, reasons, label) {
  const row = table[key];
  if (!row) return;
  for (const [themeId, factor] of Object.entries(row)) {
    target[themeId] = (target[themeId] || 0) + factor * weight;
    if (factor >= 0.8) reasons.push({ themeId, reason: label });
  }
}

/**
 * @param {object} ctx { assetType, docType, investorType, transactionType, country, projectName }
 * @returns {{recommendations:Array<{themeId,label,confidence,reasons}>, signals:object}}
 */
function recommend(ctx = {}) {
  const scores = {};
  const reasons = [];

  const aKey = assetKey(ctx.assetType || ctx.templateId || ctx.projectName);
  const dKey = ctx.docType || 'im';
  const iKey = ctx.investorType || null;
  const tKey = ctx.transactionType || null;
  const cKey = ctx.country || 'KR';

  addScores(scores, ASSET, aKey, W.assetType, reasons, `자산유형: ${aKey}`);
  addScores(scores, DOC, dKey, W.docType, reasons, `문서유형: ${dKey}`);
  if (iKey) addScores(scores, INVESTOR, iKey, W.investorType, reasons, `투자자: ${iKey}`);
  if (tKey) addScores(scores, TRANSACTION, tKey, W.transactionType, reasons, `거래유형: ${tKey}`);
  addScores(scores, COUNTRY, cKey, W.country, reasons, `대상국: ${cKey}`);

  const ranked = Object.entries(scores)
    .filter(([id]) => themes.get(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (!ranked.length) {
    const t = themes.get('institutional');
    return {
      recommendations: [{ themeId: t.id, label: t.label, labelKr: t.labelKr, confidence: 60, reasons: ['판단 근거 부족 — 기본 테마'] }],
      signals: { assetType: aKey, docType: dKey, investorType: iKey, transactionType: tKey, country: cKey },
    };
  }

  // 최고 점수를 기준으로 상대 신뢰도를 낸다. 최대치는 98% — 100%는 쓰지 않는다.
  const top = ranked[0][1];
  const maxPossible = W.assetType + W.docType + (iKey ? W.investorType : 0) + (tKey ? W.transactionType : 0) + W.country;
  const absolute = Math.min(0.98, top / maxPossible);

  const recommendations = ranked.map(([id, score]) => {
    const t = themes.get(id);
    const relative = score / top;
    return {
      themeId: id,
      label: t.label,
      labelKr: t.labelKr,
      confidence: Math.round(absolute * relative * 100),
      reasons: [...new Set(reasons.filter(r => r.themeId === id).map(r => r.reason))],
      purpose: t.purpose,
    };
  });

  return {
    recommendations,
    signals: { assetType: aKey, docType: dKey, investorType: iKey, transactionType: tKey, country: cKey },
  };
}

module.exports = { recommend, assetKey, ASSET, DOC, INVESTOR, TRANSACTION, W };
