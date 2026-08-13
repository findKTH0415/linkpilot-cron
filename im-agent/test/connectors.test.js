'use strict';
/**
 * Connector Layer 테스트 — 네트워크를 타지 않는다.
 * 캐시·쿼터·파서만 검증한다 (CLAUDE.md의 일 10,000건 한도 규칙이 실제로 강제되는지).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'im-conn-'));
process.env.IM_AGENT_CACHE = ROOT;

const cache = require('../connectors/cache');
const { normalize } = require('../connectors/xml');
const { buildUrl, redact } = require('../connectors/http');
const molit = require('../connectors/molit');

test('캐시: 첫 호출은 miss, 두 번째는 hit (재호출 금지 규칙)', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, value: { v: 1 } }; };

  const a = await cache.through('test-provider', 'geocode', { addr: 'A' }, fetcher);
  const b = await cache.through('test-provider', 'geocode', { addr: 'A' }, fetcher);

  assert.strictEqual(calls, 1, '동일 파라미터는 한 번만 호출되어야 한다');
  assert.strictEqual(a.cached, false);
  assert.strictEqual(b.cached, true);
  assert.deepStrictEqual(b.value, { v: 1 });
});

test('캐시: 파라미터가 다르면 별도 항목', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, value: calls }; };
  await cache.through('test-provider', 'geocode', { addr: 'B' }, fetcher);
  await cache.through('test-provider', 'geocode', { addr: 'C' }, fetcher);
  assert.strictEqual(calls, 2);
});

test('캐시: 키 순서가 달라도 같은 항목', () => {
  assert.strictEqual(
    cache.keyFor('ns', { a: 1, b: 2 }),
    cache.keyFor('ns', { b: 2, a: 1 }),
  );
});

test('캐시: 실패한 응답은 저장하지 않는다', async () => {
  let calls = 0;
  const failing = async () => { calls++; return { ok: false, error: 'boom' }; };
  await cache.through('test-provider', 'trade', { x: 1 }, failing);
  await cache.through('test-provider', 'trade', { x: 1 }, failing);
  assert.strictEqual(calls, 2, '실패는 캐시되면 안 된다');
});

test('쿼터: 한도를 넘으면 호출 자체가 거부된다', async () => {
  process.env.IM_AGENT_QUOTA_QUOTATEST = '2';
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, value: calls }; };

  const r1 = await cache.through('quotatest', 'trade', { m: 1 }, fetcher);
  const r2 = await cache.through('quotatest', 'trade', { m: 2 }, fetcher);
  const r3 = await cache.through('quotatest', 'trade', { m: 3 }, fetcher);

  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r3.ok, false);
  assert.strictEqual(r3.quotaExhausted, true);
  assert.match(r3.error, /한도 소진/);
  assert.strictEqual(calls, 2, '한도 초과분은 네트워크를 타지 않는다');
  delete process.env.IM_AGENT_QUOTA_QUOTATEST;
});

test('쿼터: 캐시 히트는 쿼터를 소모하지 않는다', async () => {
  process.env.IM_AGENT_QUOTA_CACHEQ = '1';
  const fetcher = async () => ({ ok: true, value: 'x' });
  await cache.through('cacheq', 'geocode', { k: 'same' }, fetcher);
  const before = cache.used('cacheq');
  const again = await cache.through('cacheq', 'geocode', { k: 'same' }, fetcher);
  assert.strictEqual(again.ok, true);
  assert.strictEqual(again.cached, true);
  assert.strictEqual(cache.used('cacheq'), before);
  delete process.env.IM_AGENT_QUOTA_CACHEQ;
});

test('파서: 공공데이터 JSON 응답', () => {
  const r = normalize(JSON.stringify({
    response: { header: { resultCode: '00' }, body: { totalCount: 2, items: { item: [{ a: '1' }, { a: '2' }] } } },
  }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.totalCount, 2);
});

test('파서: 공공데이터 XML 응답', () => {
  const r = normalize(`<response><header><resultCode>00</resultCode></header><body><items>
    <item><거래금액> 84,000 </거래금액><거래면적>120.5</거래면적></item>
  </items><totalCount>1</totalCount></body></response>`);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.items[0]['거래금액'], '84,000');
});

test('파서: 오류코드를 성공으로 넘기지 않는다', () => {
  const r = normalize(JSON.stringify({ response: { header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED' } } }));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /30/);
});

test('파서: 인증 오류 XML', () => {
  const r = normalize('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /인증 오류/);
});

test('실거래 레코드: 만원 → 억원, 원/㎡ 단가 산출', () => {
  const t = molit.toTrade({ 거래금액: '84,000', 거래면적: '120', 년: '2026', 월: '3', 일: '5', 법정동: '남동동' }, '202603', 'land');
  assert.strictEqual(t.dealAmountEok, 8.4);
  assert.strictEqual(t.pricePerSqm, Math.round((8.4 * 1e8) / 120));
  assert.strictEqual(t.dealDate, '2026-03-05');
});

test('실거래 레코드: 면적이 없으면 단가를 만들지 않는다', () => {
  const t = molit.toTrade({ 거래금액: '84,000' }, '202603', 'land');
  assert.strictEqual(t.pricePerSqm, null);
});

test('URL 조립: 빈 값은 제외한다', () => {
  const url = buildUrl('https://x.test/a', { a: 1, b: null, c: '', d: 'v' });
  assert.ok(url.includes('a=1') && url.includes('d=v'));
  assert.ok(!url.includes('b=') && !url.includes('c='));
});

test('로그 마스킹: 서비스키가 평문으로 남지 않는다', () => {
  const key = 'A'.repeat(64);
  const masked = redact(`https://apis.data.go.kr/x?serviceKey=${key}&LAWD_CD=11680`);
  assert.ok(!masked.includes(key), '키가 그대로 남아 있다');
  assert.ok(masked.includes('LAWD_CD=11680'));
});

test('★ 지오코딩 type 이 덮어써지지 않는다 (ROAD/PARCEL → json 덮어쓰기 회귀)', () => {
  const saved = process.env.VWORLD_KEY;
  process.env.VWORLD_KEY = 'test-key';
  const vworld = require('../connectors/vworld');

  const url = new URL(vworld.buildRequestUrl('address', {
    service: 'address', request: 'getcoord', version: '2.0',
    crs: 'EPSG:4326', address: '서울시청', type: 'ROAD',
  }));
  assert.strictEqual(url.searchParams.get('type'), 'ROAD',
    'type=json 이 주소 서비스의 ROAD/PARCEL 을 덮으면 지오코딩이 항상 실패한다');
  assert.strictEqual(url.searchParams.get('format'), 'json');
  assert.strictEqual(url.searchParams.get('key'), 'test-key');

  if (saved) process.env.VWORLD_KEY = saved; else delete process.env.VWORLD_KEY;
});

test('VWORLD_DOMAIN 은 스킴·경로를 제거해 호스트만 보낸다', () => {
  const vworld = require('../connectors/vworld');
  const saved = process.env.VWORLD_DOMAIN;

  process.env.VWORLD_DOMAIN = 'https://synologynas.tail43fc79.ts.net/linkpilot-platform.html';
  assert.strictEqual(vworld.domain(), 'synologynas.tail43fc79.ts.net');

  process.env.VWORLD_DOMAIN = 'synologynas.tail43fc79.ts.net';
  assert.strictEqual(vworld.domain(), 'synologynas.tail43fc79.ts.net');

  delete process.env.VWORLD_DOMAIN;
  assert.strictEqual(vworld.domain(), '');
  if (saved) process.env.VWORLD_DOMAIN = saved;
});

test('도메인이 설정되면 요청에 domain 파라미터가 실린다', () => {
  const saved = { k: process.env.VWORLD_KEY, d: process.env.VWORLD_DOMAIN };
  process.env.VWORLD_KEY = 'test-key';
  process.env.VWORLD_DOMAIN = 'synologynas.tail43fc79.ts.net';
  const vworld = require('../connectors/vworld');

  const url = new URL(vworld.buildRequestUrl('data', { service: 'data', request: 'GetFeature' }));
  assert.strictEqual(url.searchParams.get('domain'), 'synologynas.tail43fc79.ts.net');

  delete process.env.VWORLD_DOMAIN;
  const url2 = new URL(vworld.buildRequestUrl('data', { service: 'data' }));
  assert.strictEqual(url2.searchParams.has('domain'), false, '미설정 시 빈 파라미터를 보내지 않는다');

  if (saved.k) process.env.VWORLD_KEY = saved.k; else delete process.env.VWORLD_KEY;
  if (saved.d) process.env.VWORLD_DOMAIN = saved.d;
});

test('키가 없으면 Connector 는 unavailable 로 응답한다 (죽지 않는다)', async () => {
  const saved = process.env.DATA_GO_KR_KEY;
  delete process.env.DATA_GO_KR_KEY;
  const r = await molit.trades('11680', ['202603'], 'land');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.unavailable, true);
  if (saved) process.env.DATA_GO_KR_KEY = saved;
});

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
