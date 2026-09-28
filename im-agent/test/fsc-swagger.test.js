'use strict';
/**
 * fsc-swagger.test.js — odcloud 규격(api-docs)에서 부를 자리를 «읽기만» 하는가 〈2026-09-29〉
 *
 * ★ 실호출은 여기서 못 잰다(호스트가 막혀 있고 열쇠도 없다). 재는 것은 둘이다 —
 *   ① 규격 JSON 에서 뿌리·경로·방법·필수 인자를 **문서에 적힌 대로** 뽑는가
 *   ② 못 읽으면 null(「못 읽었다」) — 빈 목록(「경로가 없다」)으로 뭉개지 않는가 (§8).
 * ★★ 값이 필요한 인자를 지어 넣지 않는지는 소스로 센다 — 사업자번호 같은 값이 코드에 없어야 한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '..', '..', 'scripts', 'fsc-probe.mjs');

test('swagger 2 — host·basePath 로 뿌리를 만들고 경로·필수 인자를 뽑는다(serviceKey·header 는 뺀다)', async () => {
  const { swaggerOps } = await import(SRC);
  const doc = {
    swagger: '2.0', host: 'api.odcloud.kr', basePath: '/api',
    paths: {
      '/nts-businessman/v1/status': { post: { parameters: [{ in: 'body', name: 'body', required: true }, { in: 'query', name: 'serviceKey', required: true }] } },
      '/15121307/v1/uddi:abc': { get: { parameters: [{ in: 'query', name: 'page' }, { in: 'query', name: 'perPage' }, { in: 'header', name: 'Authorization', required: true }] } },
      '/x/v1/need': { get: { parameters: [{ in: 'query', name: 'b_no', required: true }] } },
    },
  };
  const s = swaggerOps(JSON.stringify(doc));
  assert.strictEqual(s.root, 'https://api.odcloud.kr/api');
  const post = s.ops.find((o) => o.method === 'POST');
  assert.deepStrictEqual(post, { method: 'POST', path: '/nts-businessman/v1/status', required: [], body: true });
  const get = s.ops.find((o) => o.path.startsWith('/15121307'));
  assert.deepStrictEqual(get.required, []);
  assert.deepStrictEqual(s.ops.find((o) => o.path === '/x/v1/need').required, ['b_no']);
});

test('openapi 3 — servers[0].url 로 뿌리 · 상대 주소면 뿌리를 비운다(지어 붙이지 않는다)', async () => {
  const { swaggerOps } = await import(SRC);
  assert.strictEqual(swaggerOps({ openapi: '3.0.1', servers: [{ url: '//api.odcloud.kr/api/' }], paths: { '/a': { get: {} } } }).root, 'https://api.odcloud.kr/api');
  assert.strictEqual(swaggerOps({ openapi: '3.0.1', servers: [{ url: '/api' }], paths: { '/a': { get: {} } } }).root, '');
});

test('못 읽으면 null — 빈 목록으로 뭉개지 않는다', async () => {
  const { swaggerOps } = await import(SRC);
  assert.strictEqual(swaggerOps('<html>swagger-ui</html>'), null);
  assert.strictEqual(swaggerOps({ swagger: '2.0' }), null);
});

test('값이 필요한 인자는 부르지 않고 이름만 적는다 · 규격만 읽고 못 부른 것은 «못 쟀다(3)»', () => {
  const s = fs.readFileSync(SRC, 'utf8');
  assert.match(s, /지어 넣지 않아 안 불렀다/);
  assert.match(s, /odSpec \? \{ code: 3/);
  assert.doesNotMatch(s, /b_no['"]?\s*:\s*\[\s*['"]\d/, '사업자번호 값을 지어 넣으면 안 된다');
});
