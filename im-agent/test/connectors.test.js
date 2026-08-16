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

test('★ VWORLD_DOMAIN 을 가공하지 않는다 (콘솔의 서비스URL 그대로)', () => {
  // ★ 예전에는 스킴·경로를 벗겨 호스트만 보냈다. 그러면 req/* 계열은 통과하는데
  //   ned/* 계열(공시지가·토지이용계획·토지특성)이 **간헐적으로** 인증을 거부한다
  //   — 실측 5회 중 2회 실패 (2026-08-16). 간헐적이라 "가끔 값이 안 들어온다"
  //   로만 보이고, 키를 재발급받아도 같은 증상이 반복된다
  const vworld = require('../connectors/vworld');
  const saved = process.env.VWORLD_DOMAIN;

  process.env.VWORLD_DOMAIN = 'https://nas.example.com/app.html';
  assert.strictEqual(vworld.domain(), 'https://nas.example.com/app.html',
    '스킴·경로를 벗기면 ned/* 계열이 간헐적으로 거부된다');

  process.env.VWORLD_DOMAIN = '  nas.example.com  ';
  assert.strictEqual(vworld.domain(), 'nas.example.com', '앞뒤 공백만 다듬는다');

  delete process.env.VWORLD_DOMAIN;
  assert.strictEqual(vworld.domain(), '');
  if (saved) process.env.VWORLD_DOMAIN = saved;
});

test('도메인이 설정되면 요청에 domain 파라미터가 실린다', () => {
  const saved = { k: process.env.VWORLD_KEY, d: process.env.VWORLD_DOMAIN };
  process.env.VWORLD_KEY = 'test-key';
  process.env.VWORLD_DOMAIN = 'nas.example.com';
  const vworld = require('../connectors/vworld');

  const url = new URL(vworld.buildRequestUrl('data', { service: 'data', request: 'GetFeature' }));
  assert.strictEqual(url.searchParams.get('domain'), 'nas.example.com');

  delete process.env.VWORLD_DOMAIN;
  const url2 = new URL(vworld.buildRequestUrl('data', { service: 'data' }));
  assert.strictEqual(url2.searchParams.has('domain'), false, '미설정 시 빈 파라미터를 보내지 않는다');

  if (saved.k) process.env.VWORLD_KEY = saved.k; else delete process.env.VWORLD_KEY;
  if (saved.d) process.env.VWORLD_DOMAIN = saved.d;
});

test('★ 지오코딩 폴백이 실제 오류를 감추지 않는다', async () => {
  const vworld = require('../connectors/vworld');
  // 인증 실패 문구 → 원인 진단이 붙어야 한다
  const auth = vworld.diagnoseGeocodeFailure([{ type: 'ROAD', error: 'VWorld INVALID_KEY: 등록되지 않은 키' }]);
  assert.match(auth, /키 또는 도메인 인증 실패/);

  const notFound = vworld.diagnoseGeocodeFailure([{ type: 'ROAD', error: 'VWorld NOT_FOUND: 결과가 없습니다' }]);
  assert.match(notFound, /주소가 매칭되지 않았다/);

  const net = vworld.diagnoseGeocodeFailure([{ type: 'ROAD', error: '타임아웃 15000ms' }]);
  assert.match(net, /네트워크/);

  // 알 수 없는 오류는 추측하지 않고 원문 확인을 안내한다
  const unknown = vworld.diagnoseGeocodeFailure([{ type: 'ROAD', error: '??' }]);
  assert.match(unknown, /IM_AGENT_DEBUG_HTTP/);
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

/* ───────────── Encoding / Decoding 인증키 ───────────── */

/**
 * ★ data.go.kr 은 인증키를 Encoding / Decoding 두 벌로 준다.
 *   화면 위쪽이 Encoding 이라 그냥 복사하면 그쪽을 집는다. 그런데 buildUrl 이
 *   파라미터를 한 번 더 인코딩하므로 %2F → %252F 가 되어 **인증만 실패한다.**
 *
 *   실패 모습이 "키가 틀렸다"와 똑같아서, 재발급받고 다시 넣어도 같은 증상이 난다.
 *   원인에 도달하기까지 몇 시간이 걸리는 종류의 실수다 — 부르기 전에 잡는다.
 */
test('Encoding 인증키를 넣으면 호출하기 전에 막는다', () => {
  const http = require('../connectors/http');
  const molit = require('../connectors/molit');
  const before = process.env.DATA_GO_KR_KEY;
  try {
    // data.go.kr Encoding 키의 특징: %2F(/) · %3D(=) 가 들어 있다
    process.env.DATA_GO_KR_KEY = 'abcDEF123%2Fxyz%3D%3D';
    assert.strictEqual(http.looksUrlEncoded(process.env.DATA_GO_KR_KEY), true);
    const bad = molit.keyFormatError();
    assert.ok(bad, 'Encoding 키인데 통과시켰다');
    assert.match(bad.error, /Decoding/, '어느 쪽을 써야 하는지 알려 줘야 한다');
    assert.strictEqual(bad.unavailable, true, '데이터를 지어내지 않고 비운다');

    // 같은 키의 Decoding 형태는 통과해야 한다
    process.env.DATA_GO_KR_KEY = 'abcDEF123/xyz==';
    assert.strictEqual(molit.keyFormatError(), null);
  } finally {
    if (before === undefined) delete process.env.DATA_GO_KR_KEY;
    else process.env.DATA_GO_KR_KEY = before;
  }
});

test('% 가 우연히 들어간 값은 Encoding 키로 오해하지 않는다', () => {
  const { looksUrlEncoded } = require('../connectors/http');
  assert.strictEqual(looksUrlEncoded('abc/def=='), false);
  assert.strictEqual(looksUrlEncoded('100%'), false, '되돌려도 안 바뀌면 인코딩이 아니다');
  assert.strictEqual(looksUrlEncoded(''), false);
  assert.strictEqual(looksUrlEncoded(undefined), false);
});

test('★ 진단 도구도 같은 규칙으로 막는다 — 두 곳이 갈리면 안 된다', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  assert.match(src, /looksUrlEncoded/,
    '진단 도구가 자기만의 판정을 쓰면 커넥터와 갈린다');
});

test('키는 로그·에러에 남지 않는다', () => {
  const { redact } = require('../connectors/http');
  // ★ 실제 키의 일부라도 쓰지 않는다. 테스트 픽스처도 저장소에 남는다 (CLAUDE.md §2)
  const fake = 'A'.repeat(30) + 'bcd0123456789xyz' + 'Q'.repeat(10);
  assert.ok(!redact(`serviceKey=${fake}&x=1`).includes(fake));
  assert.ok(!redact(`요청 실패: ${fake}`).includes(fake), '본문에 섞여 있어도 가린다');
});

/* ───────────── .env 로더 ───────────── */

test('★ .env 는 git 이 추적하지 않는다', () => {
  const fs = require('fs');
  const path = require('path');
  const root = require('../core/env').repoRoot();
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.env$/m, '.env 가 gitignore 에서 빠지면 키가 커밋된다');

  // 예시 파일에는 값이 들어 있으면 안 된다 (그대로 복사해 쓰는 사람이 있다)
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  example.split(/\r?\n/).forEach((line) => {
    const kv = require('../core/env').parseLine(line);
    if (kv) assert.strictEqual(kv.value, '', `.env.example 의 ${kv.key} 에 값이 들어 있다`);
  });
});

test('.env 를 읽되 이미 설정된 값은 덮지 않는다', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const env = require('../core/env');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, [
    '# 주석',
    '',
    'IM_TEST_NEW=fresh',
    "IM_TEST_QUOTED='sing/le=='",
    'IM_TEST_DQ="dou/ble=="',
    'IM_TEST_EXISTING=from-file',
    '잘못된 줄',
    '=값만있음',
  ].join('\n'));

  const before = process.env.IM_TEST_EXISTING;
  process.env.IM_TEST_EXISTING = 'from-shell';
  try {
    const r = env.load(file);
    assert.strictEqual(r.exists, true);
    assert.strictEqual(process.env.IM_TEST_NEW, 'fresh');
    assert.strictEqual(process.env.IM_TEST_QUOTED, 'sing/le==', '따옴표가 값에 남으면 인증이 실패한다');
    assert.strictEqual(process.env.IM_TEST_DQ, 'dou/ble==');
    assert.strictEqual(process.env.IM_TEST_EXISTING, 'from-shell',
      '셸·Secrets 값이 파일보다 세야 한다 — 반대면 CI 에서 남의 .env 가 Secret 을 이긴다');
    assert.ok(r.skipped.includes('IM_TEST_EXISTING'));
    // 값은 결과에 담지 않는다 (로그로 새면 안 된다)
    assert.ok(!JSON.stringify(r).includes('fresh'), '로더 결과에 값이 들어 있다');
  } finally {
    ['IM_TEST_NEW', 'IM_TEST_QUOTED', 'IM_TEST_DQ'].forEach(k => delete process.env[k]);
    if (before === undefined) delete process.env.IM_TEST_EXISTING;
    else process.env.IM_TEST_EXISTING = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('.env 가 없어도 오류가 아니다 — Secrets 로만 도는 환경이 정상이다', () => {
  const r = require('../core/env').load('/없는/경로/.env');
  assert.strictEqual(r.exists, false);
  assert.deepStrictEqual(r.loaded, []);
});

test('★ 스모크 도구가 커넥터보다 먼저 .env 를 올린다', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  const envAt = src.indexOf("require('../core/env')");
  const connAt = src.indexOf("require('../connectors/vworld')");
  assert.ok(envAt > -1 && connAt > -1);
  assert.ok(envAt < connAt,
    '커넥터를 먼저 부르면 isAvailable() 이 먼저 평가되어 조용히 미설정이 된다');
});

/**
 * ★ 진짜처럼 생긴 값을 자리표시자로 쓰지 않는다.
 *
 *   2026-08-15: 진단 도구의 오류 메시지에 "예시"로 적어 둔 UUID 가 **실제 VWorld
 *   키**였다. 공개 저장소에 이틀간 올라가 있었다. 예시와 실키가 같은 모양이면
 *   아무도 구분하지 못한다 — 자리표시자는 한눈에 가짜여야 한다.
 */
test('★ 안내 문구의 자리표시자가 진짜 키처럼 생기지 않았다', () => {
  const fs = require('fs');
  const path = require('path');
  const root = require('../core/env').repoRoot();

  const FILES = [
    'im-agent/tools/smoke-public-data.js',
    'im-agent/connectors/vworld.js',
    'im-agent/connectors/nsdi.js',
    'im-agent/connectors/molit.js',
    '.env.example',
    'README.md',
  ];
  // 8-4-4-4-12 UUID 중 전부 0 이 아닌 것 = 실키로 의심한다
  const UUID = /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g;

  FILES.forEach((rel) => {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) return;
    const text = fs.readFileSync(full, 'utf8');
    (text.match(UUID) || []).forEach((hit) => {
      assert.ok(/^[0-]+$/.test(hit),
        `${rel}: UUID 처럼 생긴 값 '${hit.slice(0, 8)}…' 이 있다 — ` +
        '자리표시자는 00000000-0000-0000-0000-000000000000 처럼 한눈에 가짜여야 한다');
    });
  });
});

// ── 토지이용계획의 규제 사항 (C-05) ───────────────────────────────
//
// 같은 응답에 개발제한구역·군사시설보호구역·지구단위계획구역이 함께 온다.
// 지금까지는 용도지역 하나만 남기고 전부 버렸다 — **그린벨트에 걸린 땅과 아닌 땅이
// '자연녹지지역' 하나로 똑같이 보였다.** 용적률보다 먼저 봐야 하는 정보다.

test('★ 규제 사항을 버리지 않는다', () => {
  const geo = require('../agents/07-geo');
  const conditional = Object.values(geo.CONDITIONAL_FILLS).flat();
  assert.ok(conditional.includes('land.restrictions'),
    '규제가 없는 필지가 대부분이라 조건부다 — 안 물어봤다고 규제가 없는 것은 아니다');
  assert.ok(!geo.FILLS.includes('land.restrictions'));

  const dict = require('../core/dictionary');
  assert.ok(dict.FIELDS['land.restrictions'], '용도지역과 따로 있어야 한다');
  assert.notStrictEqual(dict.FIELDS['land.restrictions'].label, dict.FIELDS['land.zoning'].label);
});

test('★ 사업 가능 여부를 좌우하는 규제를 가려낸다', () => {
  const nsdi = require('../connectors/nsdi');
  ['개발제한구역', '군사기지 및 군사시설 보호구역', '문화재보호구역', '농업진흥구역']
    .forEach(r => assert.strictEqual(nsdi.isCritical(r), true, `${r} 를 놓쳤다`));

  // 용도지역은 규제가 아니다 — 전부 중대 규제로 잡히면 경고가 무의미해진다
  ['제2종일반주거지역', '일반상업지역', '자연녹지지역']
    .forEach(z => assert.strictEqual(nsdi.isCritical(z), false, `${z} 가 규제로 잡혔다`));
});

test('중대 규제가 있으면 값으로만 두지 않고 경고한다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '07-geo.js'), 'utf8');
  assert.match(src, /중대 규제/);
  assert.match(src, /사업 가능 여부/,
    '개발제한구역을 값 한 줄로만 적으면 용적률 표 옆에서 묻힌다');
});

// ── data.go.kr 오류코드 해석 ───────────────────────────────────────
//
// 코드만 보여주면 무엇을 해야 하는지 알 수 없다. 특히 20·30 은 "키가 틀렸다"가
// 아니라 **API 별 활용신청이 승인되지 않았다**는 뜻이다 — 그 구분을 못 하면
// 멀쩡한 키를 계속 재발급받으면서 원인에 도달하지 못한다.

test('★ 활용신청 미승인을 키 오류와 구분해서 말한다', () => {
  const xml = require('../connectors/xml');
  ['20', '30'].forEach((code) => {
    const msg = xml.explainCode(code, 'SERVICE_ACCESS_DENIED_ERROR');
    assert.match(msg, /활용신청/, `${code} 이 활용신청 문제라는 것을 말하지 않는다`);
  });
  assert.match(xml.explainCode('22', ''), /한도 초과/);
  assert.match(xml.explainCode('31', ''), /만료/);
  assert.match(xml.explainCode('03', ''), /키 문제가 아니다/,
    '자료 없음을 키 문제로 오해하면 엉뚱한 곳을 고친다');
});

test('모르는 코드는 제공처 메시지를 그대로 남긴다', () => {
  const xml = require('../connectors/xml');
  const msg = xml.explainCode('77', 'SOMETHING NEW');
  assert.match(msg, /77/);
  assert.match(msg, /SOMETHING NEW/, '해석 못 한다고 원문을 버리면 단서가 사라진다');
});

test('JSON·XML 응답 모두 같은 해석을 쓴다', () => {
  const xml = require('../connectors/xml');
  const j = xml.normalize(JSON.stringify({ response: { header: { resultCode: '30', resultMsg: 'X' } } }));
  const x = xml.normalize('<response><header><resultCode>30</resultCode><resultMsg>X</resultMsg></header></response>');
  assert.strictEqual(j.error, x.error, '형식에 따라 다른 사유가 나오면 대조가 안 된다');
  assert.match(j.error, /활용신청/);
});

// ── 실측으로만 드러난 결함 (2026-08-16 다른 세션 인수인계) ──────────
//
// 셋 다 **결과가 그럴듯했다.** 출처 표시도 멀쩡해서 문서만 봐서는 안 잡힌다.

test('★ 길이 규칙에 안 걸리는 키도 가린다 (VWorld 36자 · ECOS 20자)', () => {
  const { redact, SECRET_ENV } = require('../connectors/http');
  const saved = { v: process.env.VWORLD_KEY, e: process.env.ECOS_API_KEY };
  process.env.VWORLD_KEY = 'A0B1C2D3-E4F5-6789-ABCD-0123456789EF';   // 36자
  process.env.ECOS_API_KEY = 'ABCD1234EFGH5678IJKL';                 // 20자
  try {
    const out = redact('실패 https://api.vworld.kr/ned/data?x=1&key=' + process.env.VWORLD_KEY
      + ' / ECOS .../' + process.env.ECOS_API_KEY + '/json');
    assert.ok(!out.includes(process.env.VWORLD_KEY), 'VWorld 키가 로그에 평문으로 남는다');
    assert.ok(!out.includes(process.env.ECOS_API_KEY), 'ECOS 키가 로그에 평문으로 남는다');
  } finally {
    if (saved.v) process.env.VWORLD_KEY = saved.v; else delete process.env.VWORLD_KEY;
    if (saved.e) process.env.ECOS_API_KEY = saved.e; else delete process.env.ECOS_API_KEY;
  }

  // 커넥터를 붙일 때 여기 더하지 않으면 그 키만 조용히 평문으로 남는다
  ['VWORLD_KEY', 'DATA_GO_KR_KEY', 'ECOS_API_KEY', 'DART_API_KEY']
    .forEach(k => assert.ok(SECRET_ENV.includes(k), `${k} 가 SECRET_ENV 에 없다`));
});

test('★ 공시지가를 넉넉히 받아 온다 (오름차순이라 앞부분만 받으면 옛 값이 최신이 된다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'nsdi.js'), 'utf8');
  const m = src.match(/getIndvdLandPriceAttr[\s\S]{0,160}?numOfRows:\s*(\d+)/);
  assert.ok(m, '공시지가 호출을 찾지 못했다');
  assert.ok(Number(m[1]) >= 100,
    `numOfRows=${m[1]} — NED 응답이 오름차순이라 10건만 받으면 2015년 값이 '최신'이 된다 (실측 30% 오차)`);
});

test('★ 폐기된 건축물대장 엔드포인트를 부르지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'molit.js'), 'utf8');
  assert.ok(!/BldRgstService_v2\/getBrTitleInfo/.test(src),
    'BldRgstService_v2 는 폐기되었다 — 키가 멀쩡해도 자료가 안 온다');
  assert.match(src, /BldRgstHubService/, '현행 엔드포인트를 써야 한다');
});
