'use strict';
/**
 * http-live.test.js — `connectors/http.js` 를 **실제로 부른다** (localhost 서버).
 *
 * 왜 필요한가: 지금까지 http.js 는 한 번도 실제로 호출된 적이 없다. 다른 테스트는
 * 전부 커넥터의 `unavailable` 분기(키 없음)에서 끝나고, 데모는 오프라인으로 돈다.
 * 그 사이에 **모든 HTTP 호출을 죽이는 결함이 들어와도 테스트가 전부 통과했다** —
 * POST 본문 파라미터 이름을 `body` 로 두어 응답 본문(`const body`)과 겹쳤고,
 * 섀도잉이라 문법 오류도 안 나고 `Cannot access 'body' before initialization`
 * 이라는 엉뚱한 메시지만 남았다. 커넥터 15개가 전부 이 함수를 지난다.
 *
 * ★ 바깥으로 나가지 않는다. Node 내장 http 로 **localhost 서버**를 띄운다 —
 *   의존성도 없고 CI 에서 네트워크도 안 탄다.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { request, buildUrl } = require('../connectors/http');

/** 요청을 기록하는 임시 서버. 테스트마다 새로 띄우고 반드시 닫는다 */
function serve(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') });
        handler(req, res, seen.length);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        seen,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

test('★ GET 이 실제로 돈다 (이 함수를 커넥터 15개가 전부 지난다)', async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":1}');
  });
  try {
    const r = await request(`${s.base}/hello`);
    assert.strictEqual(r.ok, true, r.error || '');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body, '{"ok":1}');
    assert.strictEqual(s.seen[0].method, 'GET');
  } finally { await s.close(); }
});

/**
 * ★ 이 테스트가 바로 그 결함을 잡는 것이다. 파라미터 이름을 다시 `body` 로
 *   되돌리면 여기서 `Cannot access 'body' before initialization` 이 난다.
 */
test('★ POST 본문이 실제로 실려 나간다', async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"got":true}');
  });
  try {
    const payload = JSON.stringify({ 대지면적: 12000 });
    const r = await request(`${s.base}/grasshopper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      requestBody: payload,
    });
    assert.strictEqual(r.ok, true, r.error || '');
    assert.strictEqual(s.seen[0].method, 'POST');
    assert.strictEqual(s.seen[0].body, payload, '본문이 안 실렸다');
  } finally { await s.close(); }
});

test('★ 본문이 없으면 GET 그대로 (빈 본문을 만들지 않는다)', async () => {
  const s = await serve((req, res) => { res.writeHead(200); res.end('ok'); });
  try {
    await request(`${s.base}/x`);
    assert.strictEqual(s.seen[0].body, '');
  } finally { await s.close(); }
});

/** ★ 인증·요청 오류는 재시도하지 않는다 (§4.6) — 재시도해도 결과가 같다 */
test('★ 400·401·403·404 는 재시도하지 않는다', async () => {
  for (const code of [400, 401, 403, 404]) {
    const s = await serve((req, res) => { res.writeHead(code); res.end('nope'); });
    try {
      const r = await request(`${s.base}/x`, { timeoutMs: 2000 });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.attempts, 1, `${code}: ${r.attempts}회 시도했다 — 한 번이어야 한다`);
      assert.match(r.error, /재시도 무의미/);
    } finally { await s.close(); }
  }
});

/** ★ 일시적 오류는 다시 걸어 본다 — 한 번 실패로 파이프라인을 죽이지 않는다 */
test('★ 500 은 다시 시도하고, 살아나면 성공으로 돌려준다', async () => {
  const s = await serve((req, res, n) => {
    if (n === 1) { res.writeHead(500); res.end('boom'); return; }
    res.writeHead(200); res.end('recovered');
  });
  try {
    const r = await request(`${s.base}/x`, { timeoutMs: 3000 });
    assert.strictEqual(r.ok, true, r.error || '');
    assert.strictEqual(r.body, 'recovered');
    assert.ok(r.attempts >= 2, '재시도를 안 했다');
  } finally { await s.close(); }
});

/** ★ 이진 파일도 받는다 (건축물대장 첨부 등) */
test('★ binary 를 켜면 Buffer 로 받는다', async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from([0x89, 0x50, 0x4E, 0x47]));
  });
  try {
    const r = await request(`${s.base}/i.png`, { binary: true });
    assert.strictEqual(r.ok, true);
    assert.ok(Buffer.isBuffer(r.body));
    assert.deepStrictEqual([...r.body], [0x89, 0x50, 0x4E, 0x47]);
  } finally { await s.close(); }
});

/** ★ 응답이 없으면 영원히 기다리지 않는다 — 파이프라인 전체가 멈춘다 */
test('★ 타임아웃이 실제로 끊는다', async () => {
  const s = await serve(() => { /* 일부러 아무 응답도 안 한다 */ });
  try {
    const t0 = Date.now();
    const r = await request(`${s.base}/slow`, { timeoutMs: 150 });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /타임아웃 150ms/);
    assert.ok(Date.now() - t0 < 10000, '재시도까지 포함해도 너무 오래 걸린다');
  } finally { await s.close(); }
});

test('★ 쿼리 조립은 빈 값을 넣지 않는다', () => {
  const u = buildUrl('http://x/y', { a: 1, b: null, c: undefined, d: '', e: '값' });
  assert.match(u, /a=1/);
  assert.ok(!/b=/.test(u) && !/c=/.test(u) && !/d=/.test(u), '빈 값이 들어갔다');
  assert.match(u, /e=%EA%B0%92/);
});
