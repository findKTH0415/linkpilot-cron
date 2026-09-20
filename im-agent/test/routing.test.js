'use strict';
/**
 * routing.test.js — 길찾기 소요시간 Connector (D-246).
 *
 * ★★★ **「낱말이 있는가」로는 아무것도 안 잰다** — 망 호출만 가짜로 끼우고
 *   **판정은 진짜를 돌린다** (CLAUDE.md §12-30 의 그 구분).
 *
 * ★ 캐시를 지나가므로 칸마다 **좌표를 다르게** 준다 — 같은 좌표를 쓰면 앞 칸의
 *   답이 돌아와 그 칸이 아무것도 안 재게 된다 (§8 「표본이 거짓말을 하면
 *   잡히는 것도 거짓이다」와 같은 결).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/* ★ 캐시 뿌리를 임시 폴더로 돌린다 — 저장소를 안 더럽히고, 앞 실행의 답도 안 온다.
   ★★ 이름은 `IM_AGENT_CACHE` 다. 처음에 `IM_AGENT_CACHE_DIR` 로 잘못 적었더니
     저장소의 `im-projects/.cache` 에 **앞 실행의 빈 값이 써지고 그것이 돌아왔다** —
     검사가 옳았고 틀린 것은 표본이다 (CLAUDE.md §8). */
process.env.IM_AGENT_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-routing-'));

const http = require('../connectors/http');
const routing = require('../connectors/routing');

const KEY = 'TESTKEY_FOR_ROUTING_0000';
let n = 1000;
/** 칸마다 다른 좌표 — 캐시가 앞 답을 돌려주지 않게 */
function pts() {
  n += 1;
  return [{ x: 127 + n / 100000, y: 37 + n / 100000 }, { x: 127.1, y: 37.1 }];
}

/** 망 호출만 가짜로 끼운다. 판정은 진짜가 돈다 */
async function withReply(reply, fn) {
  const real = http.request;
  const saved = KEY_NAMES_SAVE();
  process.env.KAKAO_MOBILITY_REST_API = KEY;
  http.request = async () => reply;
  try { return await fn(); }
  finally { http.request = real; saved(); }
}
function KEY_NAMES_SAVE() {
  const prev = routing.KEY_NAMES.map((k) => [k, process.env[k]]);
  return () => prev.forEach(([k, v]) => {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });
}

const OK_BODY = JSON.stringify({
  routes: [{ result_code: 0, result_msg: '길찾기 성공',
    summary: { duration: 1381, distance: 10679 } }],
});

test('열쇠가 없으면 «지어내지 않고» 그 사실을 이름과 함께 말한다', async () => {
  const saved = KEY_NAMES_SAVE();
  routing.KEY_NAMES.forEach((k) => delete process.env[k]);
  try {
    const [a, b] = pts();
    const r = await routing.carDuration(a, b);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unavailable');
    routing.KEY_NAMES.forEach((k) => assert.ok(r.error.includes(k),
      `받는 이름 ${k} 를 안 적는다 — 사장님이 「내가 넣은 이름이 이 중에 있나」를 못 대신다`));
  } finally { saved(); }
});

test('값이 오면 «잰 칸»에서 초·미터를 뽑는다', async () => {
  await withReply({ ok: true, status: 200, body: OK_BODY }, async () => {
    const [a, b] = pts();
    const r = await routing.carDuration(a, b);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.seconds, 1381, 'routes[0].summary.duration (초)');
    assert.equal(r.meters, 10679, 'routes[0].summary.distance (미터)');
    assert.equal(r.mode, 'car');
    /* ★ 값만 옮기지 않는다 — 어디서·언제·어떤 조건인지를 함께 남긴다 (§4.7) */
    assert.ok(r.source && r.source.기관 && r.source.조회시각 && r.source.기준,
      '출처(기관·조회시각·기준)를 안 남긴다');
  });
});

test('★ 길을 못 찾은 것도 HTTP 200 으로 온다 — result_code 를 본다', async () => {
  const body = JSON.stringify({ routes: [{ result_code: 104, result_msg: '출발지와 도착지가 너무 가까움' }] });
  await withReply({ ok: true, status: 200, body }, async () => {
    const [a, b] = pts();
    const r = await routing.carDuration(a, b);
    assert.equal(r.ok, false, '200 이라고 성공으로 세면 안 된다');
    assert.equal(r.reason, 'no-route');
    assert.ok(/104/.test(r.error), '무엇이 막았는지 코드를 적는다');
  });
});

test('★ 「대답이 왔다」와 「값이 왔다」는 다른 사실이다 — 칸이 비면 성공으로 안 센다', async () => {
  const body = JSON.stringify({ routes: [{ result_code: 0, summary: { duration: null, distance: null } }] });
  await withReply({ ok: true, status: 200, body }, async () => {
    const [a, b] = pts();
    const r = await routing.carDuration(a, b);
    assert.equal(r.ok, false, 'isFinite(null) 이 참이라 숫자인지까지 봐야 한다');
    assert.equal(r.reason, 'no-value');
  });
});

test('★ 「못 닿음」과 「거부」를 갈라 적는다 — 할 일이 정반대다', async () => {
  await withReply({ ok: false, status: undefined, error: 'fetch failed' }, async () => {
    const [a, b] = pts();
    const r = await routing.carDuration(a, b);
    assert.equal(r.reason, 'unreachable', '상태코드를 못 받았으면 «도는 자리»를 옮기는 일이다');
  });
  await withReply({ ok: false, status: 401, error: 'Unauthorized' }, async () => {
    const [a, b] = pts();
    const r = await routing.carDuration(a, b);
    assert.equal(r.reason, 'auth', '401·403 은 열쇠·등록 쪽이다');
  });
});

test('★ JSON 이 아닌 답을 «그 칸이 없다»와 같은 값으로 적지 않는다', async () => {
  await withReply({ ok: true, status: 200, body: '<html>502 Bad Gateway</html>' }, async () => {
    const [a, b] = pts();
    const r = await routing.carDuration(a, b);
    assert.equal(r.reason, 'not-json');
  });
});

test('좌표가 숫자가 아니거나 범위 밖이면 부르지 않는다', async () => {
  await withReply({ ok: true, status: 200, body: OK_BODY }, async () => {
    for (const bad of [null, {}, { x: 'a', y: 37 }, { x: 999, y: 37 }, { x: 127, y: 0 }]) {
      const r = await routing.carDuration(bad, { x: 127.1, y: 37.1 });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'bad-input', `${JSON.stringify(bad)} 를 그대로 보낸다`);
    }
  });
});

test('★★★ 대중교통은 «못 낸다»고 말하고, 자동차 값을 그 자리에 안 넣는다', async () => {
  const r = await routing.transitDuration();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'auth');
  assert.ok(!('seconds' in r), '자동차 값을 대중교통 자리에 넣으면 그것이 곧 지어낸 값이다');
  /* ★ 낱말이 아니라 «틀린 곳을 가리키지 않는가»를 잰다 (§4.6 의 그 잣대) */
  assert.ok(/등록|신청|콘솔/.test(r.error), '무엇을 보셔야 하는지가 글에 없다');
});

test('★ 열쇠 이름 셋이 SECRET_ENV 에 다 있다 — 없으면 오류 본문에 평문으로 샌다 (§2)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'http.js'), 'utf8');
  routing.KEY_NAMES.forEach((k) => assert.ok(src.includes(`'${k}'`),
    `${k} 가 SECRET_ENV 에 없다 — 그 값이 로그에 평문으로 남는다`));
});

test('★ 값을 한 글자도 안 찍는다 — 실패 글에 열쇠가 안 섞인다 (§2)', async () => {
  await withReply({ ok: false, status: 403, error: `denied key=${KEY}` }, async () => {
    const [a, b] = pts();
    const r = await routing.carDuration(a, b);
    assert.ok(!JSON.stringify(r).includes(KEY), '열쇠 값이 돌려주는 값에 섞여 나간다');
  });
});
