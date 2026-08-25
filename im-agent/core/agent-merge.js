'use strict';
/**
 * agent-merge.js — Agent 결과를 Dataset 에 넣는 **단일 출처**.
 *
 * ★ 왜 따로 뽑았는가
 *   같은 절차(옛 값 버리기 → 병합 → resolve → 저장 → 파일 쓰기)를 파이프라인과
 *   오케스트레이터가 **각자** 갖게 되면, 엔진이 바뀌는 날 **한쪽만 옛말을 한다.**
 *   그리고 그 사실은 문서에 안 나타난다 — 숫자는 그럴듯하게 나오기 때문이다.
 *   (D-68 에서 추출 경로로 똑같은 일을 겪고 `mergeExtraction` 을 하나로 모았다.
 *    이 파일은 그 결정을 나머지 Agent 로 넓힌 것이다.)
 *
 * ★ `drop` 이 왜 필요한가
 *   재실행하면 같은 Agent 가 **같은 출처 이름으로** 새 값을 낸다. 옛 값을 안
 *   버리면 데이터셋이 **자기 자신과 충돌**하고, 교차검증이 그것을 RED FLAG 로
 *   올린다 — 실제로는 어제 값과 오늘 값이 부딪힌 것뿐인데.
 *
 * ★ 여기 적힌 출처 이름은 **Agent 가 실제로 붙이는 이름과 같아야 한다.**
 *   `test/agent-merge.test.js` 가 그것을 지킨다.
 */

const store = require('./store');

/**
 * agentId → { drop, dropOwnSources, onlyWhenFacts, facts, write }
 *   drop            재실행 시 버릴 출처 이름들 (Agent 가 fact 에 붙이는 source 문자열)
 *   dropOwnSources  이번에 들고 온 fact 들의 **자기 출처**도 버린다 —
 *                   출처 이름이 고정이 아니라 조회 결과마다 달라지는 Agent 용
 *   onlyWhenFacts   fact 가 없으면 Dataset 을 아예 건드리지 않는다.
 *                   ★ 이것이 없으면 「이번엔 값이 안 나왔다」가 **지난번 값을 지운다.**
 *   facts           output 의 어느 필드에 fact 배열이 들어 있는가
 *   write           결과 JSON 을 어디에 쓰는가
 */
const MERGE = {
  '07_geo': {
    drop: ['지적공부(VWorld)', '건축물대장(국토교통부)'],
    facts: 'facts',
    write: '04_Property/geo.json',
  },
  '04_financial': {
    drop: ['financial_model (04_financial)'],
    facts: 'computedFacts',
    write: '07_Financial/financial.json',
  },
  '08_appraisal': {
    drop: [
      '감정평가 Agent · 3방식 가중평균',
      '감정평가 Agent · 공시지가 기준',
      '감정평가 Agent · 거래사례비교법',
      '감정평가 Agent · 수익환원법',
    ],
    facts: 'facts',
    write: '04_Property/appraisal.json',
  },
  '09_massing': {
    drop: ['매스 검토 Agent (09_massing)'],
    facts: 'facts',
    write: '04_Property/massing.json',
  },
  '03_research': {
    // ★ 서술(sections)이 아니라 **실측 지표만** Dataset 에 들어간다.
    //   출처 이름이 조회마다 달라져서 자기 출처를 함께 버린다.
    drop: ['REC 현물시장(한국전력거래소)'],
    dropOwnSources: true,
    onlyWhenFacts: true,
    facts: 'facts',
    write: '05_Market/research.json',
  },
};

/** 이 Agent 는 Dataset 을 건드리는가 */
function mutatesDataset(agentId) {
  return Boolean(MERGE[agentId]);
}

/**
 * Agent 결과를 Dataset 에 반영하고 파일로 남긴다.
 *
 * @param {string} projectId
 * @param {string} agentId
 * @param {object} output    Agent 산출물 (null 이면 아무것도 안 한다)
 * @param {object} dataset   core/facts.js 의 Dataset
 * @param {object} opts      { save: dataset 저장 함수 — pipeline 이 가진 것을 넘긴다 }
 * @returns {{merged:number, wrote:string|null}}
 */
function apply(projectId, agentId, output, dataset, opts = {}) {
  const spec = MERGE[agentId];
  if (!spec) throw new Error(`agent-merge 에 없는 Agent: ${agentId}`);
  if (!output) return { merged: 0, wrote: null };

  const facts = spec.facts ? (output[spec.facts] || []) : [];

  let merged = 0;
  // ★ 값이 안 나온 실행이 지난번 값을 지우지 않게 한다 (onlyWhenFacts)
  if (dataset && !(spec.onlyWhenFacts && !facts.length)) {
    for (const name of spec.drop) dataset.dropSource(name);
    if (spec.dropOwnSources) for (const f of facts) dataset.dropSource(f.source);
    if (facts.length) { dataset.addMany(facts); merged = facts.length; }
    dataset.resolve();
    if (typeof opts.save === 'function') opts.save(projectId, dataset);
    else store.writeJson(projectId, '01_Project/dataset.json', dataset.toJSON());
  }

  store.writeJson(projectId, spec.write, output);
  return { merged, wrote: spec.write };
}

module.exports = { MERGE, apply, mutatesDataset };
