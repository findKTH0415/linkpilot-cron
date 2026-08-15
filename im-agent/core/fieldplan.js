'use strict';
/**
 * fieldplan.js — 어떤 항목을 **사람이 직접 넣어야 하는가**.
 *
 * 사전에 52개가 있지만 대부분은 사람이 칠 필요가 없다. 요청문·공공데이터·
 * 업로드 자료·산업 통상치·계산이 채운다. 그걸 구분하지 않고 52칸을 내밀면
 * 사람은 어디부터 손대야 할지 모르고, **알지도 못하는 값을 지어내서 채운다** —
 * 그게 이 시스템이 막으려는 바로 그 일이다.
 *
 * ★ 목록을 여기서 새로 만들지 않는다. 각 Agent 가 `FILLS` 로 선언한 것과
 *   `finance/templates.js` 의 map·defaults 를 읽어 조합한다. 여기에 손으로
 *   적어 두면 Agent 가 바뀌는 날부터 화면이 거짓말을 한다.
 *
 * 채움 경로(fill):
 *   request    요청문 한 줄에서 뽑는다        (01 Project)
 *   public     소재지만 있으면 공공데이터가   (07 Geo)
 *   derived    다른 값에서 계산된다           (재무모델)
 *   default    산업 통상치로 채우고 가정치로 표시한다 (템플릿 defaults)
 *   extract    올린 자료에서 뽑을 수 있다     (02 Extraction · 별칭이 있는 항목)
 *   manual     위 어느 것도 못 채운다 — 사람이 넣어야 한다
 */

const dict = require('./dictionary');
const templates = require('../finance/templates');

/** 재무모델이 다른 값에서 만들어 내는 항목 — finance/model.js 의 계산과 같아야 한다 */
const DERIVED = {
  'debt.amount': { from: ['investment.total', 'debt.ltc'], how: '총사업비 × LTC' },
  'equity.amount': { from: ['investment.total', 'debt.amount'], how: '총사업비 − 차입금' },
  'opex.annual': { from: ['revenue.annual', 'opex.ratio'], how: '연매출 × 운영비율' },
  'investment.other': { from: [], how: '없으면 0 으로 둔다' },
};

const LABEL = {
  request: '요청문',
  public: '공공데이터',
  derived: '계산',
  default: '산업 통상치',
  extract: '자료 추출',
  manual: '직접 입력',
};

const WHY = {
  request: '요청문 한 줄에서 뽑습니다',
  public: '소재지만 있으면 공부(公簿)에서 가져옵니다',
  derived: '다른 값에서 계산됩니다',
  default: '산업 통상치를 넣고 가정치로 표시합니다 — 문서값이 들어오면 그것이 이깁니다',
  extract: '올린 자료에서 뽑습니다. 못 뽑으면 직접 넣어야 합니다',
  manual: '자동으로 채울 방법이 없습니다',
};

function agentFills(rel) {
  try {
    return require(rel).FILLS || [];
  } catch (_) {
    return [];   // Agent 가 없거나 선언이 없으면 자동으로 안 채워지는 것으로 본다
  }
}

/**
 * 공공데이터 인증키가 실제로 있는가.
 *
 * ★ 키가 없으면 07 Geo 는 통째로 건너뛴다. 그런데도 화면이 "공공데이터가
 *   채웁니다"라고 말하면 **안 물어보고 빈 채로 남는다** — 사람은 물어보지
 *   않았으니 그 항목이 있는 줄도 모른다. 키 없는 환경에서는 직접 입력이다.
 *   (`VWORLD_KEY`·`DATA_GO_KR_KEY` 는 등록부 D-12 로 아직 미등록 상태다)
 */
function publicDataAvailable() {
  try {
    return require('../connectors/vworld').isAvailable()
      || require('../connectors/nsdi').isAvailable()
      || require('../connectors/molit').isAvailable();
  } catch (_) {
    return false;   // 커넥터를 못 읽으면 없는 것으로 본다 — 있다고 단정하는 쪽이 위험하다
  }
}

/**
 * @param {string} templateId datacenter/solar/realestate/generic
 * @returns {object} key → { fill, label, why, from?, note? }
 */
function plan(templateId) {
  const t = templates.getTemplate(templateId) || templates.getTemplate('generic');
  const fromRequest = agentFills('../agents/01-project');
  const hasPublic = publicDataAvailable();
  const fromPublic = hasPublic ? agentFills('../agents/07-geo') : [];

  // 템플릿 기본값이 있는 dictionary key (map: field→key, defaults: field→value)
  const defaulted = new Set();
  Object.keys(t.defaults || {}).forEach((field) => {
    const key = (t.map || {})[field];
    if (key) defaulted.add(key);
  });

  const out = {};
  Object.keys(dict.FIELDS).forEach((key) => {
    const def = dict.FIELDS[key];
    let fill;

    // 순서가 곧 우선순위다. 먼저 채워지는 쪽을 적는다 —
    // 사람에게는 '언제 채워지는가'가 '무엇이 채우는가'보다 중요하다
    if (fromRequest.indexOf(key) !== -1) fill = 'request';
    else if (fromPublic.indexOf(key) !== -1) fill = 'public';
    else if (DERIVED[key]) fill = 'derived';
    else if (defaulted.has(key)) fill = 'default';
    else if ((def.aliases || []).length) fill = 'extract';
    else fill = 'manual';

    out[key] = {
      fill,
      label: LABEL[fill],
      why: WHY[fill],
      from: DERIVED[key] ? DERIVED[key].from : null,
      how: DERIVED[key] ? DERIVED[key].how : null,
    };
  });
  return out;
}

/** 채움 경로별 개수 — 화면이 '몇 개나 안 물어봐도 되는지' 보여줄 때 쓴다 */
function summary(templateId) {
  const p = plan(templateId);
  const counts = {};
  Object.keys(p).forEach((k) => { counts[p[k].fill] = (counts[p[k].fill] || 0) + 1; });
  return counts;
}

module.exports = { plan, summary, publicDataAvailable, DERIVED, LABEL, WHY };
