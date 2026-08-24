'use strict';
/**
 * routes.test.js — 라우트 표가 **단일 출처**인가 (2026-08-18).
 *
 * ★★ 왜 있나: NAS 서버가 라우트 등록을 **손으로 옮겨 적고** 있었고, 엔진에
 *   라우트가 늘어도 그쪽은 몰라서 **11개가 빠진 채 404** 가 났다(본체 실측).
 *   오류는 「없는 주소」로만 보이므로, 두 목록을 나란히 세어 보기 전까지
 *   「서버가 옛 표를 들고 있다」는 것이 드러나지 않는다.
 *
 * 여기서 지키는 것 넷:
 *   ① 표에 있는 것과 라우터가 **실제로 거는 것**이 같다 (사본이 생길 수 없다)
 *   ② 표의 handler 가 전부 실재한다 (이름만 적고 함수가 없으면 500 이 난다)
 *   ③ 차례가 뜻을 바꾸는 자리(`/verify` vs `:name`)가 지켜진다
 *   ④ 순수 http 서버도 같은 표로 길을 찾을 수 있다 (express 를 강요하지 않는다)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const routes = require('../ui/routes.cjs');
const W = require('../ui/report-api.cjs');
const R = require('../ui/api-router.cjs');

const AGENT = path.join(__dirname, '..');
function handlers() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
  process.env.IM_AGENT_ROOT = tmp;
  return {
    write: W.createHandlers({ agentRoot: tmp, agentModulePath: AGENT, authenticate: () => ({ planId: 'pro' }) }),
    read: R.createHandlers({ agentModulePath: AGENT }),
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

/* ═════════ ① 표 = 실제 등록 ═════════ */

/**
 * ★★ **이것이 404 를 막는 장치다.** 라우터를 가짜로 만들어 무엇을 거는지 받아
 *   적고, 표와 한 글자도 다르지 않은지 본다. 다르면 그 순간 사본이 생긴 것이다.
 */
test('★★ 라우터가 거는 것이 표와 정확히 같다 (사본이 생길 수 없다)', () => {
  [['쓰기', W.ROUTES], ['읽기', R.ROUTES]].forEach(([label, table]) => {
    const got = [];
    const fake = {};
    ['get', 'post', 'put', 'delete', 'patch'].forEach((verb) => {
      fake[verb] = (p) => got.push(verb.toUpperCase() + ' ' + p);
    });
    routes.mount(fake, table, {});
    assert.deepStrictEqual(got, routes.list(table),
      `${label} 라우터가 표와 다른 것을 걸었다 — 손으로 옮긴 자리가 생겼다`);
  });
});

test('★ 라우트 수가 읽기 6 · 쓰기 25 = 31 이다', () => {
  assert.strictEqual(R.ROUTES.length, 6);
  // 23 번째는 POST /projects/:id/scan — 넣은 자료를 값으로 만드는 길 (2026-08-21)
  // 24 번째는 PUT /projects/:id/hidden — 목록에서 접기 (2026-08-24 · 지우지 않는다)
  // 25 번째는 GET /projects/:id/scan/progress — 읽는 중에 「몇 개 중 몇 개」 (2026-08-24)
  assert.strictEqual(W.ROUTES.length, 25);
});

/* ═════════ ② 이름만 적힌 handler 가 없다 ═════════ */

test('★ 표의 handler 가 전부 실재한다', () => {
  const h = handlers();
  try {
    W.ROUTES.forEach((r) => {
      assert.strictEqual(typeof h.write[r.handler], 'function',
        `쓰기 ${r.method} ${r.path} 의 handler '${r.handler}' 가 없다`);
    });
    R.ROUTES.forEach((r) => {
      assert.strictEqual(typeof h.read[r.handler], 'function',
        `읽기 ${r.method} ${r.path} 의 handler '${r.handler}' 가 없다`);
    });
  } finally { h.cleanup(); }
});

/** 같은 길을 두 번 등록하면 뒤엣것은 영원히 안 불린다 — 조용하다 */
test('★ 같은 method+path 가 두 번 있지 않다', () => {
  [W.ROUTES, R.ROUTES].forEach((table) => {
    const keys = routes.list(table);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepStrictEqual(dup, [], `같은 길이 두 번 등록되었다: ${dup.join(', ')}`);
  });
});

/* ═════════ ③ 차례가 뜻을 바꾸는 자리 ═════════ */

test('★★ 고정 경로가 :param 보다 먼저 잡힌다', () => {
  const hit = (m, p) => {
    const r = routes.match(W.ROUTES, m, p);
    return r && r.route.handler;
  };
  assert.strictEqual(hit('POST', '/projects/LP-DC-2026-001/sources/purge'), 'purgeSources');
  assert.strictEqual(hit('POST', '/projects/LP-DC-2026-001/linked/verify'), 'verifyLinked');
  assert.strictEqual(hit('DELETE', '/projects/LP-DC-2026-001/sources/x.pdf'), 'deleteSource');
  assert.strictEqual(hit('POST', '/projects/LP-DC-2026-001/spec/confirm'), 'confirmSpec');
});

/* ═════════ ④ express 없이도 길을 찾는다 ═════════ */

test('★ 순수 http 서버도 같은 표로 길을 찾는다 (프레임워크를 강요하지 않는다)', () => {
  const m = routes.match(W.ROUTES, 'GET', '/projects/LP-DC-2026-001/reports?x=1');
  assert.strictEqual(m.route.handler, 'listReports');
  assert.deepStrictEqual(m.params, { id: 'LP-DC-2026-001' });

  assert.strictEqual(routes.match(W.ROUTES, 'GET', '/없는/길'), null, '없는 길은 null 이다');
  assert.strictEqual(routes.match(W.ROUTES, 'PATCH', '/projects'), null, 'method 가 다르면 안 잡힌다');
  // 빈 조각을 값으로 받으면 그 뒤 검사가 「모르는 프로젝트」로 엉뚱하게 답한다
  assert.strictEqual(routes.match(W.ROUTES, 'GET', '/projects//reports'), null);
});

test('★ 파일 라우트는 JSON 이 아니라고 표가 말한다', () => {
  const f = W.ROUTES.find(r => r.path === '/projects/:id/file');
  assert.strictEqual(f.kind, routes.KIND.FILE,
    '파일 라우트에 kind 가 없으면 부르는 쪽이 JSON 으로 읽어 깨진다');
  // 나머지는 JSON 이다 (kind 를 안 적으면 JSON)
  assert.strictEqual(W.ROUTES.filter(r => r.kind === routes.KIND.FILE).length, 1);
});

/* ═════════ ⑤ 진짜로 불러 본다 (M-08 — 「부르지 않는 테스트」를 만들지 않는다) ═════════ */

/**
 * ★★ 위 검사들은 전부 **표를 들여다보는** 검사다. 표가 맞아도 `call()` 의 인자
 *   모양이 틀리면 실제 호출에서만 깨진다 — 그리고 그 깨짐은 NAS 에서 처음 보인다.
 *   그래서 **express 없이 순수 http 서버를 세워** 실제로 부른다.
 *   이것이 본체가 손으로 옮긴 표를 버리고 이 표를 걸 수 있다는 증거다.
 */
test('★★ express 없이 표만으로 서버가 돈다 (실제 호출)', async () => {
  const http = require('http');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-live-'));
  process.env.IM_AGENT_ROOT = tmp;

  const hw = W.createHandlers({
    agentRoot: tmp, agentModulePath: AGENT,
    authenticate: req => (req.headers.authorization === 'Bearer good'
      ? { name: '검증', planId: 'pro', status: 'active' } : null),
  });
  const hr = R.createHandlers({ agentModulePath: AGENT });
  const table = [...R.ROUTES.map(r => [r, hr]), ...W.ROUTES.map(r => [r, hw])];

  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let hit = null; let h = null;
    for (const [r, hh] of table) {
      const m = routes.match([r], req.method, u.pathname);
      if (m) { hit = m; h = hh; break; }
    }
    if (!hit) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"없는 주소"}'); }
    const raw = await new Promise((ok) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => ok(b)); });
    const ctx = { headers: req.headers, body: raw ? JSON.parse(raw) : {}, query: Object.fromEntries(u.searchParams) };
    try {
      const r = await hit.route.call(h, ctx, hit.params);
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(r.body));
    } catch (e) { res.writeHead(500); return res.end(JSON.stringify({ error: e.message })); }
  });

  await new Promise(ok => srv.listen(0, ok));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const go = async (m, p, tok, b) => {
    const r = await fetch(base + p, {
      method: m,
      headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}),
      body: b ? JSON.stringify(b) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };

  try {
    assert.strictEqual((await go('GET', '/intake')).status, 200, '읽기 라우트가 안 잡힌다');
    /* 인증은 **서버가** 막는다 — 화면이 아니다.
       ★ 〈2026-08-23 · D-94〉 접수(`POST /projects`)는 이제 **로그인을 안 묻는다.**
         그래서 여기서 재는 것은 「막혔는가」가 아니라 **「문을 지나 검증까지
         갔는가」**다 — 요청문이 한 글자라 400 이 온다. 401 이 오면 문이 다시
         닫힌 것이고, 200/201 이 오면 검증이 사라진 것이다. 둘 다 잡는다. */
    const anonMake = await go('POST', '/projects', null, { request: 'x' });
    assert.notStrictEqual(anonMake.status, 401, '접수가 로그인 없이 막혔다 (D-94)');
    assert.strictEqual(anonMake.status, 400, '문은 지났는데 요청문 검증이 안 걸렸다');
    // ★ 값 저장은 **그대로 묻는다** — 연 선이 「만드는 것까지」임을 여기서도 잰다
    assert.strictEqual((await go('POST', '/projects/LP-DC-2026-001/spec', null, {})).status, 401,
      '출력조건 저장이 로그인 없이 열렸다');
    const made = await go('POST', '/projects', 'good', { request: '인천 남동공단 데이터센터' });
    assert.strictEqual(made.status, 201, JSON.stringify(made.body));
    const id = (await go('GET', '/projects')).body.projects[0].id;

    // ★ 접근권 없이 연결하면 받지 않는다 — 이 문구가 화면에 그대로 뜬다.
    //   (2026-08-20 전에는 「내려받기가 안 붙어 있다」로 501 이었다. 이제 엔진
    //   기본 구현이 있으므로, 막는 기준이 **그 파일을 읽을 접근권**으로 옮겼다.)
    const linked = await go('POST', '/projects/' + id + '/linked', 'good', { ref: {} });
    assert.strictEqual(linked.status, 400, JSON.stringify(linked.body));
    assert.match(linked.body.error, /접근권이 없습니다/);

    // 차례가 뜻을 바꾸는 자리 — purge 가 「purge 라는 이름의 파일」로 안 잡힌다
    const purge = await go('POST', '/projects/' + id + '/sources/purge', 'good', {});
    assert.strictEqual(purge.status, 400);
    assert.match(purge.body.error, /olderThanDays/);

    assert.strictEqual((await go('GET', '/projects/' + id + '/없음', 'good')).status, 404);
  } finally {
    await new Promise(ok => srv.close(ok));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
