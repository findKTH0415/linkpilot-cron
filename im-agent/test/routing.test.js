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


/* ★★★ **옆 칸이 «그때의 상태»를 재고 있었다** 〈2026-09-21 · D-252〉.
     앎 판은 「대중교통은 «못 낸다»고 말하는가」를 재고 `reason==='auth'` 를 박아 두었다.
     그것은 «그때 안 돌았다»는 사실이지 재려던 성질이 아니다.
   ★ 재려던 성질은 **「자동차 값을 대신 내지 않는가」**이고, 아래 칸이 그대로 잴다 —
     **약하게 고친 것이 아니라 재는 자리를 옮긴 것이다** (§6-2-5 의 그 잣대). */

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

/* ══════════════════════════════════════════════════════════════════════════
   대중교통 — ODsay 〈2026-09-21 · D-252〉

   ★★★ **사장님 콘솔 화면이 잰 값을 줬다** — 「서비스 상태 **활성화**(기한제한 없음) ·
     현재 호출수 0/30 · 서비스 URI·서버 IP 등록됨」. 곧 열쇠도 등록도 멀쩡한데
     진단이 **러너(해외 IP)** 에서 돌아 거부됐다. ODsay 는 **등록 서버에서 온 요청만**
     통과시킨다 — 그러니 이 갈래는 **국내 자리(NAS)에서** 돈다 (D-206 과 같은 규칙).

   ★ 여기서 못 재는 것: **그 열쇠가 실제로 먹는지.** 이 자리는 호스트가 막혀 있고
     열쇠도 없다. 이 칸이 재는 것은 **「무엇이 오든 갈래를 갈라 말하는 구조인가」**다.
     **못 잰 것을 통과로 적지 않는다** (§8).
   ══════════════════════════════════════════════════════════════════════════ */

/** ODsay 쪽 망만 가짜로 끼운다 — 판정은 진짜가 돈다 (§12-30) */
async function withOdsay(reply, fn) {
  const real = http.request;
  const prev = routing.ODSAY_KEY_NAMES.map((k) => [k, process.env[k]]);
  process.env.ODSAY_API_KEY = KEY;
  http.request = async () => (typeof reply === 'function' ? reply() : reply);
  try { return await fn(); }
  finally {
    http.request = real;
    prev.forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
}

const OD_OK = JSON.stringify({
  result: { path: [{ info: { totalTime: 43, totalDistance: 11200 } }] },
});

test('대중교통: 값이 오면 «분»을 초로 옮기고 출처를 함께 낸다', async () => {
  const [a, b] = pts();
  const r = await withOdsay({ ok: true, status: 200, body: OD_OK },
    () => routing.transitDuration(a, b));
  assert.equal(r.ok, true, `값이 왔는데 못 냈다: ${r.error || ''}`);
  assert.equal(r.mode, 'transit');
  assert.equal(r.seconds, 43 * 60, '분을 초로 안 옮긴다 — 43분이 43초가 되면 그 값이 거짓이다');
  assert.equal(r.meters, 11200);
  assert.ok(r.source && r.source.기관 === 'ODsay', '출처를 안 적으면 값만 옮긴 것이다 (§4.7)');
});

test('대중교통: 인증 거부가 «HTTP 200» 으로 와도 auth 로 가른다 (D-229 의 그 갈래)', async () => {
  const [a, b] = pts();
  const body = JSON.stringify({ error: [{ code: '500', message: '[ApiKeyAuthFailed] ApiKey authentication failed.' }] });
  const r = await withOdsay({ ok: true, status: 200, body }, () => routing.transitDuration(a, b));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'auth',
    `★ 상태코드만 보고 «규격 문제»로 적으면 고칠 것이 없는 자리를 가리킨다 (지금: ${r.reason})`);
  assert.match(r.error, /등록된 서버/, '★ 무엇을 보셔야 하는지 안 적으면 그 글이 값이 없다 (§4.6)');
});

test('대중교통: 「못 닿음」과 「거부」를 갈라 적는다 — 할 일이 정반대다', async () => {
  const [a1, b1] = pts();
  const un = await withOdsay({ ok: false, status: undefined, error: 'fetch failed' },
    () => routing.transitDuration(a1, b1));
  assert.equal(un.reason, 'unreachable',
    '★ 상태코드를 못 받았는데 «거부»로 적으면 이미 하신 등록을 또 하시게 된다 (M-86)');

  const [a2, b2] = pts();
  const au = await withOdsay({ ok: false, status: 403, error: 'forbidden' },
    () => routing.transitDuration(a2, b2));
  assert.equal(au.reason, 'auth', '진짜 403 은 여전히 거부다 — 반대로도 막는다');
});

test('대중교통: 값을 못 뽑으면 «본문 앞머리»를 함께 싣는다 (첫 실행이 곧 진단)', async () => {
  const [a, b] = pts();
  const body = JSON.stringify({ result: { path: [{ info: { totalTimeX: 43 } }] } });
  const r = await withOdsay({ ok: true, status: 200, body }, () => routing.transitDuration(a, b));
  assert.equal(r.reason, 'no-value');
  assert.match(r.error, /totalTimeX/,
    '★ 본문을 안 실으면 「규격이 어디가 다른지」를 알려고 또 한 판을 돌려야 한다 (§4.3)');
});

test('대중교통: 열쇠가 주소에 실리므로 «바깥 글»에서 그 값이 안 샌다 (§2)', async () => {
  const [a, b] = pts();
  /* ★ ODsay 는 apiKey 를 URL 에 싣는다 — 되비추는 오류에 그 주소가 섞여 올 수 있다 (D-230) */
  const leak = `https://api.odsay.com/v1/api/searchPubTransPathT?apiKey=${KEY}&SX=1`;
  const r = await withOdsay({ ok: true, status: 200, body: JSON.stringify({ error: [{ message: leak }] }) },
    () => routing.transitDuration(a, b));
  assert.equal(r.ok, false);
  assert.ok(!String(r.error).includes(KEY),
    '★ 열쇠 값이 화면에 샌다 — 이 저장소는 공개다 (§2 · D-10)');
});

test('대중교통: 열쇠가 없으면 unavailable — «지어내지 않는다»', async () => {
  const prev = routing.ODSAY_KEY_NAMES.map((k) => [k, process.env[k]]);
  routing.ODSAY_KEY_NAMES.forEach((k) => delete process.env[k]);
  try {
    const [a, b] = pts();
    const r = await routing.transitDuration(a, b);
    assert.equal(r.reason, 'unavailable');
    assert.match(r.error, /ODSAY_API_KEY/, '어느 이름을 넣어야 하는지 안 적으면 안내가 아니다 (§5)');
  } finally {
    prev.forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
});

test('대중교통이 «자동차 값»을 대신 내지 않는다 — 그것이 곧 지어낸 값이다 (§4.9)', async () => {
  const [a, b] = pts();
  /* 자동차 모양의 응답을 먹여도 대중교통으로 안 센다 */
  const r = await withOdsay({ ok: true, status: 200, body: OK_BODY },
    () => routing.transitDuration(a, b));
  assert.equal(r.ok, false, '★ 자동차 응답을 대중교통 값으로 셌다 — 그 숫자는 거짓이다');
});

test('이름 둘을 다 읽는다 — 이름이 갈리면 «아무 오류 없이 조용히» 값이 죽는다', () => {
  assert.deepEqual(routing.ODSAY_KEY_NAMES, ['ODSAY_API_KEY', 'ODSAY_KEY']);
  const prev = routing.ODSAY_KEY_NAMES.map((k) => [k, process.env[k]]);
  try {
    routing.ODSAY_KEY_NAMES.forEach((k) => delete process.env[k]);
    process.env.ODSAY_KEY = 'x'.repeat(20);
    assert.equal(routing.odsayUsedName(), 'ODSAY_KEY', '둘째 이름을 안 읽는다');
    assert.equal(routing.odsayHasKey(), true);
  } finally {
    prev.forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   NAS 에서 도는 자리 — 「만들었다」와 「닿는다」는 다른 사실이다 (§8)
   ══════════════════════════════════════════════════════════════════════════ */

test('★ 국내 자리 스크립트가 «배포가 올리는 폴더» 안에 있다 (scripts/ 에 두면 NAS 에 없다)', () => {
  const sh = path.join(__dirname, '..', 'tools', 'routing-nas.sh');
  assert.ok(fs.existsSync(sh), 'routing-nas.sh 가 없다');
  /* ★ `deploy/engine.sh` 가 NAS 로 올리는 것은 `im-agent/` 뿐이다 — 그 밖에 두면
       **저장소에는 있고 NAS 에는 없고, 검사는 초록이다** (§4 의 calendar-nas.sh 가 겪은 자리) */
  assert.ok(sh.includes(`${path.sep}im-agent${path.sep}`), '★ im-agent/ 밖이면 NAS 에 안 올라간다');

  const eng = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'engine.sh'), 'utf8');
  const ex = [...eng.matchAll(/--exclude='im-agent\/([^']+)'/g)].map((m) => m[1]);
  assert.ok(ex.length >= 1, '배포가 빼는 폴더를 못 읽었다 — 이 칸은 아무것도 안 잰다');
  ex.forEach((d) => assert.ok(!sh.includes(`${path.sep}im-agent${path.sep}${d}${path.sep}`),
    `★ 배포가 빼는 폴더(${d}) 안에 있다 — NAS 에 안 올라간다`));

  const body = fs.readFileSync(sh, 'utf8');
  /* ★ 접속 자격증명도 데이터 열쇠도 없어야 한다 — NAS 가 «스스로» 자기 것을 부른다 (규정집 2-8) */
  assert.ok(!/NAS_SSH|TAILSCALE|ODSAY_API_KEY\s*=|KAKAO\w*\s*=[^=]/.test(body),
    '★ 수집 스크립트에 접속 자격증명·열쇠가 들어갔다 (§4 · §12-33)');
  /* ★ 갈래를 갈라 끝낸다 — 「돌았다」와 「값이 왔다」는 다른 사실이다 */
  /* ★ 갈래 3 은 셸이 내고 1·4 는 node 가 낸다 — 두 자리를 함께 센다.
       이름으로 찾으면 한쪽만 보고 «눈이 먼 채» 초록이 된다 (§12-37 의 그 잣대). */
  assert.match(body, /exit 3/, '자리가 없을 때 갈래가 없다');
  assert.match(body, /process\.exit\(4\)/, '둘 다 못 받았을 때 갈래가 없다');
  assert.match(body, /process\.exit\(1\)/, '하나만 왔을 때 갈래가 없다');
});

test('★ NAS 의 열쇠를 읽는 사슬이 이어져 있다 — 끊기면 «열쇠가 있어도 없다»가 된다', () => {
  /* ★★★ **내 표본이 한 번 틀렸다** 〈2026-09-21 · 실측〉 — 임시 폴더를 cwd 로 주고
       「읽는가」를 재려 했는데, `env.js` 의 `repoRoot()` 는 **`__dirname` 기준**이라
       cwd 를 안 본다. **검사가 옷았고 틀린 것은 표본이다** (§8).
     ★ 그래서 둘로 갈라 잴다 — **파일 읽기는 돌려서**, **사슬은 소스로**.
     ★★ **못 재는 것을 적는다**: 한 프로세스 안에서 «통째로» 재려면 모듈 캐시 때문에
       이미 `ensure()` 가 돌아 있어 그 칸이 늘 초록이 된다 — 아무것도 안 재는 것이다. */
  const envmod = require('../core/env');

  // (가) 파일 읽기 — 돌려서 잴다
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-env-'));
  const NAME = 'ODSAY_KEY';
  const VAL = 'lp-env-probe-8f2a19c7d3';
  const f = path.join(dir, 'linkpilot.env');
  fs.writeFileSync(f, `${NAME}=${VAL}\n`);
  const prev = process.env[NAME];
  delete process.env[NAME];
  try {
    const got = envmod.load(f);
    assert.equal(got.exists, true, 'linkpilot.env 를 못 읽었다');
    assert.equal(process.env[NAME], VAL, '★ 읽고도 process.env 를 안 채운다');
    assert.ok(envmod.NAMES.includes('linkpilot.env'),
      '★ `linkpilot.env` 를 안 보면 NAS 의 열쇠가 통째로 안 읽힌다');
  } finally {
    if (prev === undefined) delete process.env[NAME]; else process.env[NAME] = prev;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }

  // (나) 사슬 — routing → http → env.ensure()
  const hsrc = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'http.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
  assert.match(hsrc, /require\(['"]\.\.\/core\/env['"]\)\.ensure\(\)/,
    '★ http.js 가 env.ensure() 를 안 부른다 — NAS 에 열쇠가 있어도 「없다」가 된다');
  const rsrc = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'routing.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
  assert.match(rsrc, /require\(['"]\.\/http['"]\)/,
    '★ routing.js 가 http.js 를 안 부르면 그 사슬이 끊긴다');
});
