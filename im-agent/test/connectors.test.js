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

// ★ 패턴만으로는 못 가린다. 길이 규칙(40자↑)은 VWorld UUID(36자)·기상청(22자)·
//   부동산원(32자)을 놓치고, key= 규칙은 값이 URL 밖에 나타나면 못 잡는다.
//   실제 환경변수 값을 직접 지우는 경로가 살아 있는지 고정한다 (CLAUDE.md §2).
test('로그에서 인증키가 가려진다 — 길이·위치와 무관하게', () => {
  const http = require('../connectors/http');
  const saved = {};
  // ★ 실제 키를 쓰지 않는다. **길이와 모양만** 같으면 이 테스트의 목적을 채운다.
  //   한 번 실제 개발키를 '예시' 로 커밋했다가 public 저장소에 노출됐다 (D-12).
  const fake = {
    VWORLD_KEY: '00000000-1111-2222-3333-444444444444',   // 36자 UUID 모양
    KMA_APIHUB_KEY: 'AaBbCcDdEeFfGgHhIiJjKk',             // 22자
    REB_API_KEY: '00112233445566778899aabbccddeeff',      // 32자 hex 모양
  };
  Object.keys(fake).forEach((k) => { saved[k] = process.env[k]; process.env[k] = fake[k]; });

  try {
    for (const [name, v] of Object.entries(fake)) {
      // URL 안 (key= 형태)
      assert.ok(!http.redact(`https://x/api?key=${v}&a=1`).includes(v), `${name}: URL 안에서 새어 나간다`);
      // URL 밖 — 응답 본문이나 예외 메시지에 값만 실려 오는 경우
      assert.ok(!http.redact(`인증 실패: ${v} 는 등록되지 않았습니다`).includes(v),
        `${name}: 본문에서 새어 나간다`);
    }
    assert.strictEqual(http.redact('오류 없음'), '오류 없음', '평범한 문자열은 건드리지 않는다');
  } finally {
    Object.keys(fake).forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    });
  }
});

// 등록된 서비스URL 을 가공하면 ned/* 계열이 간헐적으로 INCORRECT_KEY 를 낸다.
// 간헐적이라 회귀해도 테스트 없이는 안 드러난다 — 그래서 여기서 고정한다.
test('VWORLD_DOMAIN 은 등록값을 가공하지 않고 그대로 보낸다', () => {
  const vworld = require('../connectors/vworld');
  const saved = process.env.VWORLD_DOMAIN;

  process.env.VWORLD_DOMAIN = 'https://nas.example.com/app.html';
  assert.strictEqual(vworld.domain(), 'https://nas.example.com/app.html',
    '스킴·경로를 벗기면 ned/* 계열이 간헐적으로 거부된다 — 실측 5회 중 2회');

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
  // ★ 지역·지구는 용도지역과 **같은 조회·같은 조건**에서 온다. 그래서 조건부가
  //   아니라 FILLS 다 — zoning 을 선언하면서 이것만 빼면 그것도 거짓말이 된다
  //   (2026-08-16 병합: `land.restrictions` 를 이 이름으로 통일했다)
  assert.ok(geo.FILLS.includes('land.use_districts'));

  const dict = require('../core/dictionary');
  assert.ok(dict.FIELDS['land.use_districts'], '용도지역과 따로 있어야 한다');
  assert.notStrictEqual(dict.FIELDS['land.use_districts'].label, dict.FIELDS['land.zoning'].label);
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
  ['VWORLD_KEY', 'DATA_GO_KR_KEY', 'ECOS_API_KEY', 'DART_API_KEY', 'KOSIS_API_KEY']
    .forEach(k => assert.ok(SECRET_ENV.includes(k), `${k} 가 SECRET_ENV 에 없다`));
});

/**
 * ★ **키가 아닌데 가려야 하는 것들** — 사내 주소다 (CLAUDE.md §2 「NAS 접속정보」).
 *
 *   `VWORLD_DOMAIN` 은 VWorld 콘솔에 등록한 서비스URL 인데 실제 값이 NAS 주소이고
 *   (`.env.example` 의 예시가 그렇다) **모든 VWorld 요청의 쿼리에 실려 나간다.**
 *   `RHINO_COMPUTE_URL` 은 같은 이유로 이미 등록돼 있었는데 이쪽만 빠져 있었다 —
 *   노출 면은 오히려 이쪽이 넓다 (2026-08-16 교차검증에서 발견).
 */
test('★ 키가 아니어도 사내 주소는 가린다 (VWORLD_DOMAIN · RHINO_COMPUTE_URL)', () => {
  const { redact, SECRET_ENV } = require('../connectors/http');
  ['VWORLD_DOMAIN', 'RHINO_COMPUTE_URL']
    .forEach(k => assert.ok(SECRET_ENV.includes(k), `${k} 가 SECRET_ENV 에 없다 — 주소가 평문으로 남는다`));

  const saved = process.env.VWORLD_DOMAIN;
  process.env.VWORLD_DOMAIN = 'https://nas.example.com/app.html';
  try {
    const out = redact('실패 https://api.vworld.kr/req/data?domain='
      + encodeURIComponent(process.env.VWORLD_DOMAIN) + '&x=1');
    assert.ok(!out.includes('nas.example.com'), '사내 주소가 로그에 평문으로 남는다');
  } finally {
    if (saved === undefined) delete process.env.VWORLD_DOMAIN; else process.env.VWORLD_DOMAIN = saved;
  }
});

/**
 * ★ 스모크 출력은 **그대로 복사돼 대화·이슈에 붙는다.** 저장소는 public 이다(D-10).
 *   그래서 사내 주소를 값으로 찍지 않고 **모양만** 낸다 — 진단에 필요한 것은
 *   주소가 아니라 스킴·경로 유무다(호스트만 남기면 ned/* 가 간헐 거부한다).
 */
test('★ 스모크가 VWORLD_DOMAIN 값을 찍지 않는다 (모양만 낸다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  assert.ok(!/VWORLD_DOMAIN  : \$\{vworld\.domain\(\)/.test(src),
    '도메인 값을 그대로 찍고 있다 — 스모크 출력은 그대로 복사돼 붙는다');
  assert.match(src, /domainShape\(/, '모양만 내는 함수를 거쳐야 한다');
  assert.match(src, /function domainShape/);

  // 실제로 값이 안 새는지 함수를 직접 돌려 본다 (문자열 검사만으로는 부족하다)
  const mod = src.match(/function domainShape\(v\) \{[\s\S]*?\n\}/)[0];
  // eslint-disable-next-line no-new-func
  const shape = new Function(`${mod}; return domainShape;`)();
  const out = shape('https://nas.example.com/app.html');
  assert.ok(!out.includes('nas.example.com'), '주소가 출력에 남는다');
  assert.match(out, /스킴 있음/);
  assert.match(shape('nas.example.com'), /스킴 없음/, '알려진 실패 모드를 짚어 줘야 한다');
  assert.match(shape(''), /미설정/);
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

/**
 * ★★★ **쿼터 통은 갈래마다 따로 센다** 〈2026-08-23 실측 · D-85〉.
 *
 *   data.go.kr 은 **상세기능(오퍼레이션)마다** 하루치를 세고, 개발계정은 1,000건이다.
 *   앞 판은 아홉 커넥터가 `data.go.kr` **한 통**을 같이 쓰고 한도를 10,000 으로
 *   재고 있었다 — 계량기가 「여유 있다」고 말하는 동안 상대는 이미 끊는다.
 */
test('★★★ 통이 갈래마다 따로 세어지고, 기본값이 1,000 이다', () => {
  const cache = require('../connectors/cache.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));
  const keep = process.env.IM_AGENT_CACHE;
  process.env.IM_AGENT_CACHE = root;
  try {
    /* ① 갈래가 다르면 서로를 안 막는다 */
    cache.consume('data.go.kr:g2b', 5);
    assert.strictEqual(cache.used('data.go.kr:g2b'), 5);
    assert.strictEqual(cache.used('data.go.kr:molit'), 0, '한 갈래가 다른 갈래를 물들인다');

    /* ② 기관 기본값이 개발계정 한도다 */
    assert.strictEqual(cache.remaining('data.go.kr:g2b'), 1000 - 5);

    /* ③ 기관 밖은 그대로 */
    assert.strictEqual(cache.remaining('vworld'), 10000);
  } finally {
    if (keep === undefined) delete process.env.IM_AGENT_CACHE;
    else process.env.IM_AGENT_CACHE = keep;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * ★ 환경변수로 올릴 수 있어야 한다 — **운영계정으로 바꾸면 한도가 커진다.**
 *   그때 코드를 고치게 두면 결국 아무도 안 고친다.
 *   ★ 이름에 `.` `:` 를 그대로 쓰면 **셸에서 만들 수 없는 이름**이 된다.
 *     앞 판이 그랬고, 그래서 그 덮어쓰기는 한 번도 동작한 적이 없다.
 */
test('★★ 한도를 환경변수로 올릴 수 있다 (좁은 것이 넓은 것을 이긴다)', () => {
  const cache = require('../connectors/cache.js');
  const keep = { ...process.env };
  try {
    /* ★ 이미 쓴 만큼을 빼고 비교한다 — 앞선 검사가 남긴 카운트에 기대지 않는다 */
    const g = cache.used('data.go.kr:g2b');
    const m = cache.used('data.go.kr:molit');

    process.env.IM_AGENT_QUOTA_DATA_GO_KR = '3000';
    assert.strictEqual(cache.remaining('data.go.kr:g2b'), 3000 - g, '기관 단위 설정이 안 먹는다');

    process.env.IM_AGENT_QUOTA_DATA_GO_KR_G2B = '9000';
    assert.strictEqual(cache.remaining('data.go.kr:g2b'), 9000 - g, '갈래 설정이 기관 설정을 못 이긴다');
    assert.strictEqual(cache.remaining('data.go.kr:molit'), 3000 - m, '갈래 설정이 옆 갈래까지 물들인다');
  } finally {
    delete process.env.IM_AGENT_QUOTA_DATA_GO_KR;
    delete process.env.IM_AGENT_QUOTA_DATA_GO_KR_G2B;
    Object.assign(process.env, keep);
  }
});

/**
 * ★★★ **`.env` 를 놓아도 엔진이 안 읽고 있었다** 〈2026-08-23 · 실제 사고〉.
 *
 *   사장님께 「NAS 의 엔진 루트에 `.env` 를 만들고 GEMINI_API_KEY 를 넣으십시오」
 *   라고 안내했다. **그렇게 해도 아무 일도 안 일어났을 것이다** —
 *   `env.load()` 를 부르는 곳이 `cli.js` 와 스모크 도구 **둘뿐**이었고,
 *   실제 서비스를 도는 NAS 엔진 서버는 그것을 안 불렀다.
 *
 * ★ 그러면 「키를 넣었는데 여전히 꺼져 있다」가 되고, **그 이유는 어디에도
 *   안 보인다.** 사람은 키를 의심하고 다시 만들고 또 넣는다.
 * ★ 그래서 키를 **읽는 쪽**이 스스로 올린다. 어느 입구로 들어오든 같다.
 */
test('★★★ 키를 읽는 쪽이 스스로 .env 를 올린다 (엔진도 읽는다)', () => {
  const fs = require('fs');
  const path = require('path');
  const root = require('../core/env').repoRoot();

  const llm = fs.readFileSync(path.join(root, 'im-agent', 'core', 'llm.js'), 'utf8');
  const envAt = llm.indexOf("require('./env').ensure()");
  const poolAt = llm.indexOf("require('./gemini-keys')");
  assert.ok(envAt > -1, 'llm.js 가 .env 를 안 올린다 — 엔진에서는 영영 오프라인이다');
  assert.ok(poolAt > -1, 'llm.js 가 열쇠 관리자를 안 쓴다 — 고르기가 다시 배열 순회로 돌아갔다');
  assert.ok(envAt < poolAt,
    '열쇠를 읽은 뒤에 올린다 — 풀은 부르는 순간 정해지므로 소용이 없다');

  /* ★★ **읽는 곳이 옮겨 갔으면 검사도 따라간다** 〈2026-08-25 · D-104〉.
   *   열쇠를 실제로 읽는 곳은 이제 `core/gemini-keys.js` 다. 거기가 스스로
   *   올리지 않으면 새 입구(엔진의 상태 API 등)에서 또 「영영 오프라인」이 난다. */
  const pool = fs.readFileSync(path.join(root, 'im-agent', 'core', 'gemini-keys.js'), 'utf8');
  const pEnvAt = pool.indexOf("require('./env').ensure()");
  const pKeyAt = pool.indexOf('process.env.GEMINI_API_KEY');
  assert.ok(pEnvAt > -1, 'gemini-keys.js 가 .env 를 안 올린다');
  assert.ok(pEnvAt < pKeyAt, 'gemini-keys.js 가 열쇠를 읽은 뒤에 .env 를 올린다');

  const http = fs.readFileSync(path.join(root, 'im-agent', 'connectors', 'http.js'), 'utf8');
  assert.ok(http.indexOf("require('../core/env').ensure()") > -1,
    'connectors/http.js 가 .env 를 안 올린다 — 커넥터가 전부 「키 없음」으로 건너뛴다');
});

test('★★ 여러 번 올려도 한 번만 읽는다 (부르는 곳이 늘어도 안전하다)', () => {
  const env = require('../core/env');
  assert.strictEqual(typeof env.ensure, 'function');
  assert.strictEqual(env.ensure(), env.ensure(), '부를 때마다 새로 읽는다');
});

test('★★★ .env 를 놓으면 실제로 켜진다 (놓았다 지워 보고 잰다)', () => {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const root = require('../core/env').repoRoot();
  const dotenv = path.join(root, '.env');

  /* ★ 이미 있으면 **건드리지 않는다** — 남의 키를 지우면 안 된다 */
  if (fs.existsSync(dotenv)) return;

  const run = () => execFileSync(process.execPath, ['-e',
    "delete process.env.IM_AGENT_OFFLINE;"
    + "process.stdout.write(String(require(process.argv[1]).isOffline()))",
    path.join(root, 'im-agent', 'core', 'llm.js'),
  ], { encoding: 'utf8' });

  try {
    fs.writeFileSync(dotenv, 'GEMINI_API_KEY=AIzaTESTONLY0000000000\n');
    assert.strictEqual(run(), 'false', '.env 를 놓았는데 여전히 오프라인이다');
  } finally {
    fs.rmSync(dotenv, { force: true });
  }
  assert.strictEqual(run(), 'true', '.env 를 지웠는데 켜져 있다고 한다');
});

/**
 * ★★★ **점 없는 이름도 받는다** 〈2026-08-23 · 실제로 막혔다〉.
 *
 *   「File Station 에서 `.env` 를 만드십시오」라고 안내했는데
 *   **File Station 의 [생성] 에는 「폴더」밖에 없다.** 파일을 만드는 메뉴가
 *   아예 없어서 `env` 라는 **폴더**가 만들어졌다.
 *
 * ★ 점으로 시작하는 이름은 NAS 화면에서 기본으로 숨겨지고 만들기도 어렵다.
 *   사람을 탓할 자리가 아니라 **우리가 받아 주어야 하는 자리**다.
 */
test('★★★ .env 가 없으면 linkpilot.env 를 읽는다 (점 없는 이름)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const env = require('../core/env');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-envname-'));
  try {
    assert.strictEqual(path.basename(env.pick(dir)), '.env',
      '둘 다 없으면 .env 자리를 가리켜야 한다');

    fs.writeFileSync(path.join(dir, 'linkpilot.env'), 'A=1\n');
    assert.strictEqual(path.basename(env.pick(dir)), 'linkpilot.env');

    fs.writeFileSync(path.join(dir, '.env'), 'A=2\n');
    assert.strictEqual(path.basename(env.pick(dir)), '.env',
      '둘 다 있으면 .env 가 이겨야 한다 — 앞서 쓰던 사람이 놀라면 안 된다');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★★★ 같은 이름의 **폴더**가 있어도 넘어간다 (실제로 그렇게 만들어졌다)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const env = require('../core/env');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-envdir-'));
  try {
    /* 사장님 화면에 실제로 만들어진 모양 — `env` 폴더 */
    fs.mkdirSync(path.join(dir, '.env'));
    fs.writeFileSync(path.join(dir, 'linkpilot.env'), 'A=1\n');
    assert.strictEqual(path.basename(env.pick(dir)), 'linkpilot.env',
      '폴더를 파일로 잡으면 읽다가 죽는다');

    const r = env.load(env.pick(dir));
    assert.deepStrictEqual(r.loaded, ['A']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★★ 없는 파일을 읽어도 던지지 않는다', () => {
  const env = require('../core/env');
  const r = env.load('/없는/경로/linkpilot.env');
  assert.strictEqual(r.exists, false);
  assert.deepStrictEqual(r.loaded, []);
});
