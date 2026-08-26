'use strict';
/**
 * codecheck.test.js — 법규 검토를 코드로 옮긴 것이 **손으로 한 판정과 같은가**.
 *
 * ★★ 왜 이 시험이 있나. 2026-08-25 에 사장님 지시로 법규 검토를 **손으로** 했다.
 *   그 판정이 슬라이드(S-05)에 박혔는데, 딜이 바뀌면 처음부터 다시 해야 하고
 *   **다시 할 때 같은 답이 나온다는 보장이 없었다.** 이 시험이 그 보장이다 —
 *   본건 수치를 넣으면 그때 손으로 낸 열 줄이 그대로 나와야 한다.
 *
 * ★ 특히 **「모르는 것을 적합으로 세지 않는가」**를 잰다. 「확인되지 않음」을
 *   통과로 세는 것이 이 저장소가 가장 경계하는 실수다 (enviro 커넥터와 같은 결).
 */
const test = require('node:test');
const assert = require('node:assert');
const cc = require('../core/codecheck');

/** 본건 — 2026-08-25 슬라이드 S-05 와 같은 입력 */
const DEAL = {
  floors: 38, heightM: 125.5, zone: '일반상업지역', typicalFloorSqm: 784,
  residentialFloors: 35, netPerFloorSqm: 453.08, elevators: 2, stairs: 2,
  sprinkler: true, nonCombustible: true, refugeArea: false,
  buildingSeparationM: 20, farPct: 592.3,
};
const find = (r, id) => r.items.find(i => i.id === id);

test('★★ 본건 = 준초고층 — 38층·125.5m 는 고층이되 초고층은 아니다', () => {
  const r = cc.review(DEAL);
  assert.strictEqual(r.grade, '준초고층');
  // 경계를 양쪽에서 확인한다 — 한쪽만 재면 부등호 방향을 놓친다
  assert.strictEqual(cc.review({ floors: 29, heightM: 119 }).grade, '일반');
  assert.strictEqual(cc.review({ floors: 30, heightM: 90 }).grade, '준초고층');   // 층수만으로도
  assert.strictEqual(cc.review({ floors: 20, heightM: 120 }).grade, '준초고층');  // 높이만으로도
  assert.strictEqual(cc.review({ floors: 50, heightM: 150 }).grade, '초고층');
  assert.strictEqual(cc.review({ floors: 40, heightM: 200 }).grade, '초고층');
});

test('★★★ 부적합 둘을 잡는다 — 피난안전구역·승용승강기', () => {
  const r = cc.review(DEAL);
  assert.deepStrictEqual(r.summary.blocking, ['피난안전구역', '승용승강기']);
  assert.strictEqual(r.summary.clear, false);

  // 승강기: 6층↑ 거실 35 × 453.08 = 15,857.8㎡ → 1 + ceil((15857.8-3000)/3000) = 6대
  const lift = find(r, 'passengerLift');
  assert.strictEqual(lift.verdict, 'fail');
  assert.match(lift.actual, /6대 필요/);
  assert.match(lift.note, /4대 부족/);

  // 피난안전구역: 38층의 1/2 = 19층, 상하 5개층 → 14~24F
  const ref = find(r, 'refuge');
  assert.strictEqual(ref.verdict, 'fail');
  assert.match(ref.note, /14~24F/);
});

test('★ 방화구획은 전제(불연·스프링클러)에 따라 한도가 바뀐다', () => {
  const base = { floors: 38, heightM: 125.5, typicalFloorSqm: 784 };
  // 불연 + SP = 1,500㎡ → 784 는 적합
  assert.strictEqual(find(cc.review({ ...base, nonCombustible: true, sprinkler: true }), 'fireCompart').verdict, 'ok');
  // 불연만 = 500㎡ → 784 는 부적합
  assert.strictEqual(find(cc.review({ ...base, nonCombustible: true, sprinkler: false }), 'fireCompart').verdict, 'fail');
  // SP 만 = 600㎡ → 784 는 부적합
  assert.strictEqual(find(cc.review({ ...base, sprinkler: true }), 'fireCompart').verdict, 'fail');
  // 아무것도 없으면 200㎡ → 부적합
  assert.strictEqual(find(cc.review(base), 'fireCompart').verdict, 'fail');
});

test('★★ 인동거리는 용도지역에 얹혀 있다 — 상업이면 제외, 주거면 즉시 부적합', () => {
  const commercial = find(cc.review(DEAL), 'separation');
  assert.strictEqual(commercial.verdict, 'na');
  assert.match(commercial.note, /주거지역이면 0\.5 × 126m = 63m 필요/);

  // 같은 매스를 일반주거지역에 놓으면 인동 20m 로는 안 선다 (0.5 × 125.5 = 62.75m)
  const resid = find(cc.review({ ...DEAL, zone: '제2종일반주거지역' }), 'separation');
  assert.strictEqual(resid.verdict, 'fail');

  // 정북 일조도 같이 뒤집힌다
  assert.strictEqual(find(cc.review(DEAL), 'northLight').verdict, 'na');
  assert.strictEqual(find(cc.review({ ...DEAL, zone: '제2종일반주거지역' }), 'northLight').verdict, 'review');
});

test('★★★ 모르는 것을 적합으로 세지 않는다', () => {
  // 계단·승강기·용도지역을 비우면 unknown 이지 ok 가 아니다
  const r = cc.review({ floors: 38, heightM: 125.5, typicalFloorSqm: 784, residentialFloors: 35, netPerFloorSqm: 453 });
  assert.strictEqual(find(r, 'stairs').verdict, 'unknown');
  assert.strictEqual(find(r, 'passengerLift').verdict, 'unknown');
  assert.strictEqual(find(r, 'northLight').verdict, 'unknown');
  assert.ok(r.summary.unknown >= 3);
  // ★ unknown 이 남아 있으면 「검토 끝」이 아니다
  assert.strictEqual(r.summary.clear, false);
});

test('★★ 용적률은 조례가 정한다 — 시행령 상한으로 적합 판정하지 않는다', () => {
  const far = find(cc.review(DEAL), 'far');
  assert.strictEqual(far.verdict, 'ordinance');
  assert.notStrictEqual(far.verdict, 'ok');
  assert.match(far.note, /조례/);
});

test('★ 판정마다 조문 참조가 붙어 있다 (원문은 LAW_OC 가 붙여 준다)', () => {
  const r = cc.review(DEAL);
  r.items.forEach((i) => {
    assert.ok(i.ref && i.ref.law, `${i.label} 에 근거 법령이 없다`);
    // 원문을 아직 안 붙였으므로 sourced 는 false 여야 한다 — 근거 있는 척하지 않는다
    assert.strictEqual(i.sourced, false);
  });
  const ref = find(r, 'refuge').ref;
  assert.deepStrictEqual(ref, { law: '건축법 시행령', jo: 34, hang: 4 });
});

test('★ LAW_OC 가 없으면 원문을 못 붙였다는 사실을 남긴다', async () => {
  const r = cc.review(DEAL);
  const fake = { isAvailable: () => false };
  const out = await cc.attachSources(r, { law: fake });
  assert.strictEqual(out.sourcesAttached, false);
  assert.match(out.reason, /LAW_OC/);
});

test('★★ LAW_OC 가 있으면 조문 원문이 판정에 붙는다', async () => {
  const r = cc.review(DEAL);
  const calls = [];
  const fake = {
    isAvailable: () => true,
    findLaw: async (name) => { calls.push(['find', name]); return { ok: true, value: [{ mst: 'M-' + name }] }; },
    article: async ({ mst, jo, hang }) => {
      calls.push(['article', mst, jo, hang]);
      return { ok: true, value: { text: `제${jo}조 본문`, enforcedAt: '20260101' } };
    },
  };
  const out = await cc.attachSources(r, { law: fake });
  assert.strictEqual(out.sourcesAttached, true);
  assert.strictEqual(find(out, 'refuge').sourced, true);
  assert.strictEqual(find(out, 'refuge').text, '제34조 본문');
  // ★ 같은 법령은 한 번만 찾는다 (호출을 늘리지 않는다, §4.5)
  const finds = calls.filter(c => c[0] === 'find').map(c => c[1]);
  assert.strictEqual(new Set(finds).size, finds.length, '같은 법령을 두 번 찾았다');
  // 별표(설비기준규칙)는 조문 조회 대상이 아니라 건너뛴다
  assert.strictEqual(find(out, 'passengerLift').sourced, false);
});
