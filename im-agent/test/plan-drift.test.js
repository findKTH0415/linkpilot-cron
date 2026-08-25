'use strict';
/**
 * plan-drift.test.js — 저장된 계획과 지금의 계획이 갈린 것을 잡는다.
 *
 * ★★ **왜 이 검사가 있나** 〈2026-08-26 · D-119 작업 중 실측〉.
 *   `snapshot()` 은 저장된 `tasks.json` 만 읽는다. 그래서 `taskplan.js` 에 Task 를
 *   새로 더해도 **이미 계획이 잡힌 프로젝트에는 영원히 안 나타난다.**
 *   Platform Manager Task 셋(T22·T23·T24)을 더했는데 화면에 하나도 안 떴다 —
 *   등록만 하고 「만들었다」고 말할 뻔했다.
 *
 * ★★ **거짓 경고를 내지 않는 것이 이 검사의 절반이다.**
 *   첫 판은 `PLAN` 전체와 견줘서 일사량(T13)까지 「빠졌다」고 했다. 그것은
 *   데이터센터 딜에서 **원래 빠지는 것이 맞다.** 거짓 경고가 한 번 뜨면
 *   진짜 경고도 아무도 안 읽는다. 그래서 자산군으로 다시 계획해서 견준다.
 */

const test = require('node:test');
const assert = require('node:assert');

const orchestrator = require('../core/orchestrator');
const taskplan = require('../core/taskplan');

const REQUEST = '인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성';

/** 이 프로젝트라면 나왔을 계획 그대로 */
function fullList() {
  return taskplan.plan({ request: REQUEST, assumeTools: true }).tasks;
}

/** 저장본이 흉내내는 메타 — assetClass 는 실제로 **객체**로 저장된다 */
const DOC = {
  request: REQUEST,
  template: 'datacenter',
  assetClass: { id: 'datacenter', label: '데이터센터', template: 'datacenter' },
};

test('★ 계획과 저장본이 같으면 아무 말도 하지 않는다', () => {
  const d = orchestrator.planDrift(fullList(), DOC);
  assert.deepStrictEqual(d.missing, [], `없는 것을 있다고 했다: ${JSON.stringify(d.missing)}`);
  assert.deepStrictEqual(d.extra, [], `없는 것을 있다고 했다: ${JSON.stringify(d.extra)}`);
});

test('★ 저장본에 없는 Task 를 「새로 생겼다」로 잡는다', () => {
  const list = fullList().filter(t => t.id !== 'T22');
  const d = orchestrator.planDrift(list, DOC);
  assert.deepStrictEqual(d.missing.map(x => x.id), ['T22']);
  assert.deepStrictEqual(d.extra, []);
});

test('★ 계획에서 빠진 Task 가 저장본에 남아 있으면 그것도 말한다', () => {
  const list = fullList().concat([{ id: 'T99', name: '옛날 Task', status: 'QUEUED' }]);
  const d = orchestrator.planDrift(list, DOC);
  assert.deepStrictEqual(d.extra.map(x => x.id), ['T99']);
  assert.deepStrictEqual(d.missing, []);
});

test('★★ 자산군 전용 Task 를 「빠졌다」고 하지 않는다 — 거짓 경고 금지', () => {
  // 일사량(T13)은 태양광 전용이라 데이터센터 계획에는 원래 없다.
  const d = orchestrator.planDrift(fullList(), DOC);
  const ids = d.missing.map(x => x.id).concat(d.extra.map(x => x.id));
  assert.ok(!ids.includes('T13'),
    'T13(일사량)은 데이터센터 딜에서 원래 빠진다 — 이것을 경고로 내면 매번 늑대야가 된다');
});

test('★★ assetClass 가 객체로 저장돼 있어도 알아본다', () => {
  // 실제 저장본은 문자열이 아니라 {id,label,template} 이다.
  // 그대로 넘기면 자산군을 못 알아보고 전용 Task 가 통째로 「빠졌다」로 뜬다.
  const d = orchestrator.planDrift(fullList(), DOC);
  assert.deepStrictEqual(d.extra, [],
    'assetClass 객체를 못 읽으면 T12·T14 가 남는다 — 2026-08-26 에 실제로 그랬다');
});

test('★ 다시 계획하지 못하면 **침묵한다** — 틀린 경고보다 낫다', () => {
  const d = orchestrator.planDrift(fullList(), { assetClass: { id: '없는자산군xyz' } });
  assert.ok(Array.isArray(d.missing) && Array.isArray(d.extra),
    '예외를 던지면 화면 전체가 죽는다');
});

test('★ Platform Manager Task 셋이 계획에 실제로 들어 있다 (D-119)', () => {
  const ids = taskplan.PLAN.map(t => t.id);
  for (const id of ['T22', 'T23', 'T24']) {
    assert.ok(ids.includes(id), `${id} 가 계획에 없다 — 역할만 적고 일감을 안 만든 것이다`);
  }
  const byId = Object.fromEntries(taskplan.PLAN.map(t => [t.id, t]));
  // 지시서가 구현보다 먼저다 — 지침 §5 「입력값·완료조건이 없으면 시작하지 않는다」
  assert.ok(byId.T23.dependsOn.includes('T22'), '지시서 없이 구현이 먼저 돌면 무엇이 끝인지 모른다');
  assert.ok(byId.T24.dependsOn.includes('T23'), '만들지도 않은 것을 검증할 수 없다');
});
