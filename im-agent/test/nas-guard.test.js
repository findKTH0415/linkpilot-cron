'use strict';
/**
 * nas-guard.test.js — **막는 장치가 실제로 막는지** 재 본다 (2026-08-19).
 *
 * ★★ 왜 이 파일이 있나: `verify:nas` 는 「초록인데 NAS 는 옛 판」을 막으려고
 *   만든 것인데, **그 자신이 초록을 잘못 냈다.** 화면을 `200` 인지만 보고 있어서
 *   전부 옛 판을 돌려주는 서버에 대고 **11통과 0실패**가 나왔다.
 *
 * ★ 그래서 여기서는 **가짜 NAS 를 실제로 세우고 스크립트를 진짜 돌린다.**
 *   함수를 불러 반환값만 보는 검사였다면 위의 사고를 똑같이 못 잡았을 것이다
 *   (M-08 — 「부르지 않는 테스트」는 그 코드가 도는지 말해 주지 않는다).
 *
 * ★ 「막힌다」를 재려면 **막혀야 할 것을 실제로 만들어 봐야 한다.** 고아 검사도
 *   토큰 검사도, 통과만 확인하면 검사가 아무것도 안 하게 된 날 그대로 통과한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..');
const PLAT = path.join(REPO, 'im-agent', 'ui', 'platform');
const VERIFY = path.join(REPO, 'im-agent', 'tools', 'verify-nas.js');

const embed = require(path.join(PLAT, 'build-embed.js'));
const routes = require(path.join(REPO, 'im-agent', 'ui', 'routes.cjs'));
const W = require(path.join(REPO, 'im-agent', 'ui', 'report-api.cjs'));
const A = require(path.join(REPO, 'im-agent', 'ui', 'api-router.cjs'));
const ALL = [...A.ROUTES, ...W.ROUTES];

/** 가짜 NAS. `stale` 이면 화면을 옛 판으로, `missing` 이면 그 라우트를 404 로 준다 */
function fakeNas(opt) {
  const o = opt || {};
  const missing = new Set(o.missing || []);
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/ver.txt') { res.writeHead(200); return res.end('202608191200'); }

    if (u.startsWith('/im-flow/')) {
      if (o.stale) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!-- 3주 전 판 -->'); }
      const f = path.join(PLAT, path.basename(u));
      if (!fs.existsSync(f)) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>404</h1>'); }
      res.writeHead(200); return res.end(fs.readFileSync(f));
    }

    if (u.startsWith('/api/linkpilot')) {
      const p = u.slice('/api/linkpilot'.length) || '/';
      const m = routes.match(ALL, req.method, p);
      // ★ 프록시 목록에서 빠진 라우트 — 앱이 HTML 404 를 준다
      if (!m || missing.has(`${req.method} ${m.route.path}`)) {
        res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>404</h1>');
      }
      if (req.method !== 'GET') {
        /* ★ `writesOpen` — **무인증으로 쓰기가 열린** 서버. 그 사고를 실제로 세워 본다 */
        if (o.writesOpen) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
        res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"로그인이 필요합니다"}');
      }
      if (['/intake', '/fields', '/projects'].includes(p)) {
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}');
      }
      // ★ 엔진이 내는 404 — **JSON** 이다. 라우트가 없는 것과 여기서 갈린다
      res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"프로젝트를 찾을 수 없습니다"}');
    }

    res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>');
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: srv.address().port })));
}

/** 스크립트를 **진짜 돌린다.** 동기 실행은 이벤트 루프를 막아 가짜 NAS 가 응답을 못 한다 */
function runVerify(port) {
  return new Promise((ok) => {
    const ps = spawn(process.execPath, [VERIFY, '--base', `http://127.0.0.1:${port}`, '--timeout', '4000'],
      { cwd: REPO, env: { ...process.env, NO_PROXY: '*', no_proxy: '*' } });
    let out = '';
    ps.stdout.on('data', d => { out += d; });
    ps.stderr.on('data', d => { out += d; });
    ps.on('close', code => ok({ code, out }));
  });
}

test('★★ verify:nas — 화면이 옛 판이면 200 이어도 실패한다', async () => {
  const { srv, port } = await fakeNas({ stale: true });
  try {
    const r = await runVerify(port);
    // 이 줄이 없던 동안 여기서 「통과 11 · 실패 0」이 나왔다
    assert.notEqual(r.code, 0, '옛 판을 통과시켰다 — 200 만 보고 있다\n' + r.out);
    assert.match(r.out, /옛 판이다/, '무엇이 틀렸는지 말하지 않는다\n' + r.out);
  } finally { srv.close(); }
});

test('★★ verify:nas — 라우트가 프록시 목록에서 빠지면 잡는다', async () => {
  const gone = ['GET /fields', 'GET /projects/:id/control-tower', 'GET /projects/:id/facts'];
  const { srv, port } = await fakeNas({ missing: gone });
  try {
    const r = await runVerify(port);
    assert.notEqual(r.code, 0, '빠진 라우트를 통과시켰다\n' + r.out);
    assert.match(r.out, /3개가 404/, '몇 개가 빠졌는지 말하지 않는다\n' + r.out);
  } finally { srv.close(); }
});

test('★★ verify:nas — 제대로 올라간 서버에는 헛울음을 내지 않는다', async () => {
  const { srv, port } = await fakeNas({});
  try {
    const r = await runVerify(port);
    assert.equal(r.code, 0, '멀쩡한 서버를 실패로 봤다 — 헛울음 한 번이면 아무도 안 믿는다\n' + r.out);
    assert.match(r.out, /라우트 28개가 앱을 거쳐 닿는다/, r.out);
  } finally { srv.close(); }
});

test('★ verify:nas — 프로젝트가 없어 나는 404 를 라우트 누락으로 세지 않는다', async () => {
  // 가짜 NAS 는 없는 프로젝트에 JSON 404 를 준다. 그것까지 실패로 세면 헛울음이다
  const { srv, port } = await fakeNas({});
  try {
    const r = await runVerify(port);
    assert.doesNotMatch(r.out, /개가 404/, 'JSON 404 를 라우트 누락으로 셌다\n' + r.out);
  } finally { srv.close(); }
});

/**
 * ★★★ **404 를 「인증이 안 막는다」로 적지 않는다** 〈2026-08-23 · 실제로 헷갈렸다〉.
 *
 *   배포 판 #53 의 로그에 이렇게 적혀 있었다:
 *
 *       ❌ 무인증 쓰기 → 401     404
 *
 *   그 줄은 `POST /projects` 를 두드린 것이다. 404 는 **인증 이야기가 아니라
 *   그 길이 아예 없다는 뜻**인데, 이름이 「무인증 쓰기 → 401」이라 나는 그것을
 *   읽고 **인증 설정을 의심했다.** 답이 로그 안에 있었는데 못 읽었다.
 *
 * ★ 그리고 그 오해가 **번졌다** — 아래 줄이 쓰기 16개를 「인증이 안 막아서」
 *   건너뛰었다고 적는데, 진짜 이유는 「길이 없어서」다.
 *   **틀린 이유를 적으면 사람이 그 이유부터 판다** (M-24 · M-28 과 같은 종류).
 */
test('★★★ verify:nas — 쓰기 404 를 인증 문제로 적지 않는다', async () => {
  /* 쓰기 라우터가 통째로 안 걸린 서버를 세운다 — 지금 NAS 가 그 상태다 (D-87) */
  const gone = W.ROUTES.map(r => `${r.method} ${r.path}`);
  const { srv, port } = await fakeNas({ missing: gone });
  try {
    const r = await runVerify(port);
    assert.notEqual(r.code, 0, '쓰기 라우터가 통째로 없는데 통과시켰다\n' + r.out);

    /* ① **길이 없다**고 말한다 */
    assert.match(r.out, /쓰기 API\(POST \/projects\)/,
      '쓰기 길이 없는 것을 따로 말하지 않는다\n' + r.out);
    assert.match(r.out, /그 길이 없다/, '404 의 뜻을 안 적는다\n' + r.out);

    /* ② **인증 이야기로 적지 않는다** — 그쪽을 파게 된다 */
    assert.doesNotMatch(r.out, /무인증 쓰기가 401 이 아니다/,
      '길이 없는 것을 「인증이 안 막는다」로 적었다 — 고칠 곳이 다르다\n' + r.out);

    /* ③ 건너뛴 **진짜 이유**를 적는다 */
    assert.match(r.out, /쓰기 라우터가 안 걸려 있다/,
      '왜 못 두드렸는지 틀리게 적는다\n' + r.out);
  } finally { srv.close(); }
});

/**
 * ★ 반대쪽도 잰다 — **정말로 인증이 안 막는 서버**에는 그렇게 적어야 한다.
 *   한쪽만 재면 문구를 통째로 바꿔 놓고도 통과한다.
 */
test('★★ verify:nas — 인증이 정말 안 막으면 그렇게 말한다', async () => {
  const { srv, port } = await fakeNas({ writesOpen: true });
  try {
    const r = await runVerify(port);
    assert.match(r.out, /인증 없이 열려 있다/,
      '무인증으로 쓰기가 되는데 그렇다고 안 말한다 — 이쪽이 더 급한 사고다\n' + r.out);
    assert.doesNotMatch(r.out, /그 길이 없다/,
      '길은 있는데 없다고 말한다 — 헛울음이다\n' + r.out);
  } finally { srv.close(); }
});

test('★★ 사본 빌더 — 표에 없는 설정 전역을 쓰는 화면을 잡는다', () => {
  // 지금은 깨끗하다
  assert.deepEqual(embed.unlisted(embed.required()), []);

  // 표에 없는 화면을 하나 만들어 **실제로 걸리는지** 본다.
  // 이 확인이 없으면 unlisted() 가 빈 배열만 돌려주게 된 날에도 통과한다
  const f = path.join(PLAT, '__unlisted-probe.html');
  fs.writeFileSync(f, '<script>\nwindow.LINKPILOT_PROBE = { api: null };\n</script>\n');
  try {
    const hit = embed.unlisted(['__unlisted-probe.html']);
    assert.equal(hit.length, 1, '표에 없는 전역을 그냥 넘어갔다');
    assert.match(hit[0], /LINKPILOT_PROBE/);
    assert.match(hit[0], /건너뛰어진다/);
  } finally { fs.unlinkSync(f); }
});

test('★★ 고아 모듈 — 만들어 놓고 아무도 안 부르는 것이 없다', () => {
  const { scan } = require(path.join(REPO, 'im-agent', 'tools', 'reachable.js'));
  const r = scan();
  assert.equal(r.orphans.length, 0,
    '아무도 안 부르는 모듈이 있다 (D-48·D-62·materialize 와 같은 종류):\n  ' + r.orphans.join('\n  '));
  assert.ok(r.total > 150, `모듈을 ${r.total}개밖에 못 찾았다 — 훑기가 망가졌다`);
});

test('★★ 고아 검사 — 정말 고아를 잡는지 심어서 본다', () => {
  const { scan } = require(path.join(REPO, 'im-agent', 'tools', 'reachable.js'));
  // ★ 이름을 글자 그대로 적지 않는다. 훑기는 문자열에 적힌 파일 이름도 「부르는
  //   길」로 세기 때문에, 파일 이름을 따옴표 안에 통째로 적는 순간 이 테스트가
  //   심어 둔 고아를 **스스로 이어 버린다.** 실제로 두 번 그렇게 통과했다 —
  //   두 번째는 이 주석에 이름을 적어서였다. 그러니 여기에도 적지 않는다
  const name = '__orphan' + '-probe' + '.js';
  const f = path.join(REPO, 'im-agent', 'core', name);
  fs.writeFileSync(f, "'use strict';\nmodule.exports = {};\n");
  try {
    const r = scan();
    assert.ok(r.orphans.some(o => o.includes(name)),
      '아무도 안 부르는 파일을 심었는데 못 잡았다 — 검사가 통과만 하고 있다');
  } finally { fs.unlinkSync(f); }
});

test('★ 임시 파일을 저장소에 남기지 않는다', () => {
  // 위 두 검사가 중간에 죽으면 심어 둔 파일이 남는다. 남았으면 여기서 말한다
  const leftover = [
    path.join(PLAT, '__unlisted-probe.html'),
    path.join(REPO, 'im-agent', 'core', '__orphan' + '-probe' + '.js'),
  ].filter(fs.existsSync);
  assert.deepEqual(leftover.map(f => path.relative(REPO, f)), [], '심어 둔 파일이 남아 있다');
});
