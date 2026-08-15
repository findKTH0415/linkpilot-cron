'use strict';
/**
 * dart.test.js — 금융감독원 전자공시(DART) Connector. 〈C-01〉
 *
 * 이 파일이 지키는 것은 두 가지다.
 *   ① **없는 것을 없다고 단정하지 않는다.** DART 는 공시대상회사만 수록한다.
 *      SPC·비상장 시행사는 원래 조회되지 않으므로, 못 찾은 것을 "법인 미확인"
 *      으로 적으면 정상적인 딜이 IM 에서 문제 있는 것처럼 나간다.
 *   ② **동명 법인 중 하나를 고르지 않는다.** 엉뚱한 회사의 재무제표가 IM 에
 *      실리는 것이, 안 싣는 것보다 나쁘다.
 */
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');

const dart = require('../connectors/dart');
const cache = require('../connectors/cache');
const research = require('../agents/03-research');

function withKey(key, fn) {
  const before = process.env.DART_API_KEY;
  if (key === null) delete process.env.DART_API_KEY;
  else process.env.DART_API_KEY = key;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.DART_API_KEY;
    else process.env.DART_API_KEY = before;
  }
}

/* ───────────── 이 커넥터가 무엇을 하는가 ───────────── */

test('★ 시행사를 채우지 않는다 — 대조가 목적이다', () => {
  assert.ok(!research.FILLS.includes('project.sponsor'),
    '채운다고 선언하면 화면이 시행사를 안 물어보고, 그러면 대조할 원본이 사라진다');

  const plan = require('../core/fieldplan').plan('datacenter');
  assert.notStrictEqual(plan['project.sponsor'].fill, 'public',
    '공공데이터가 채운다고 하면 안 물어보게 된다');
});

/* ───────────── 이름 대조 ───────────── */

test('법인 표기 차이를 같은 이름으로 본다', () => {
  const forms = ['㈜가온개발', '주식회사 가온개발', '가온개발(주)', '가온개발', ' 가온 개발 '];
  const norm = forms.map(dart.normalizeName);
  assert.strictEqual(new Set(norm).size, 1, `표기가 달라 못 찾으면 대조 자체가 안 된다: ${norm.join(' / ')}`);
});

test('정규화가 다른 회사를 같게 만들지는 않는다', () => {
  assert.notStrictEqual(dart.normalizeName('가온개발'), dart.normalizeName('가온건설'));
});

/* ───────────── status 해석 (200 으로 오는 실패) ───────────── */

test('★ 인증 실패가 200 으로 와도 성공으로 세지 않는다', () => {
  const r = dart.parseCompany(JSON.stringify({ status: '100', message: '부적절한 키입니다' }));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /100/);
  assert.match(r.error, /인증키/);
});

test('자료 없음과 한도 초과를 구분해서 말한다', () => {
  assert.match(dart.statusError({ status: '013' }), /자료가 없다/);
  assert.match(dart.statusError({ status: '020' }), /한도 초과/);
  assert.strictEqual(dart.statusError({ status: '000' }), null);
  assert.strictEqual(dart.statusError({}), null);
});

test('XML 로 온 오류도 읽는다 (corpCode 는 오류일 때 XML 이다)', () => {
  const xml = '<result><status>101</status><message>등록되지 않은 키</message></result>';
  assert.match(dart.statusError(xml), /101/);
});

test('JSON 이 아니면 그렇게 말한다', () => {
  const r = dart.parseCompany('<html>error</html>');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /JSON/);
});

/* ───────────── 개인정보 ───────────── */

test('★ 대표자 성명을 가져오지 않는다', () => {
  const r = dart.parseCompany(JSON.stringify({
    status: '000', corp_name: '가온개발', ceo_nm: '홍길동',
    jurir_no: '1101110000000', adres: '서울특별시 서초구', est_dt: '20180312', corp_cls: 'E',
  }));
  assert.strictEqual(r.ok, true);
  assert.ok(!JSON.stringify(r.value).includes('홍길동'),
    '개인 성명이다 — 이 저장소는 공개이고 PDI 하우스 스타일도 대외 문서에 성명을 적지 않는다');
  assert.strictEqual(r.value.corpName, '가온개발');
  assert.strictEqual(r.value.establishedAt, '2018-03-12', 'YYYYMMDD 를 사람이 읽는 형식으로');
  assert.strictEqual(r.value.corpClass, '기타(공시대상)');
});

/* ───────────── 키 취급 ───────────── */

test('키가 없으면 부르지 않는다', async () => {
  await withKey(null, async () => {
    assert.strictEqual(dart.isAvailable(), false);
    const r = await dart.findCompany('가온개발');
    assert.strictEqual(r.unavailable, true);
    const c = await dart.company('00123456');
    assert.strictEqual(c.unavailable, true);
  });
});

test('법인코드 형식을 먼저 본다 (8자리)', async () => {
  await withKey('x'.repeat(40), async () => {
    const r = await dart.company('123');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /8자리/);
  });
});

test('키가 로그로 새지 않는다', () => {
  const key = 'a1b2c3d4e5f6a7b8c9d0';  // 40자 미만 — 일반 규칙에 안 걸린다
  withKey(key, () => {
    assert.ok(!dart.mask(`요청 실패: ${dart.BASE}/company.json?crtfc_key=${key}`).includes(key));
  });
});

/* ───────────── ZIP 해제 ───────────── */

/** 항목 하나짜리 ZIP 을 만든다 (deflate 또는 무압축) */
function makeZip(name, content, { store = false } = {}) {
  const nameBuf = Buffer.from(name, 'utf8');
  const raw = Buffer.from(content, 'utf8');
  const data = store ? raw : zlib.deflateRawSync(raw);
  const method = store ? 0 : 8;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);   // 로컬 헤더 위치

  const cdOffset = local.length + nameBuf.length + data.length;
  const cdSize = central.length + nameBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

test('★ ZIP 을 의존성 없이 푼다 (압축 · 무압축 둘 다)', () => {
  const xml = '<result><list><corp_code>00126380</corp_code><corp_name>가온개발</corp_name></list></result>';
  assert.strictEqual(dart.unzipFirstEntry(makeZip('CORPCODE.xml', xml)), xml);
  assert.strictEqual(dart.unzipFirstEntry(makeZip('CORPCODE.xml', xml, { store: true })), xml,
    '무압축 항목도 있다');
});

test('ZIP 이 아니면 조용히 빈 값이 되지 않는다', () => {
  assert.throws(() => dart.unzipFirstEntry(Buffer.from('not a zip at all, definitely')),
    /EOCD|서명/, '깨진 응답을 빈 목록으로 넘기면 "법인이 하나도 없다"가 된다');
});

test('법인 목록 XML 을 읽는다 (태그가 <item> 이 아니라 <list> 다)', () => {
  const { parseItems } = require('../connectors/xml');
  const rows = parseItems(
    '<result><list><corp_code>00126380</corp_code><corp_name>㈜가온개발</corp_name>'
    + '<stock_code> </stock_code><modify_date>20250102</modify_date></list></result>', 'list');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].corp_code, '00126380');
  assert.strictEqual(rows[0].corp_name, '㈜가온개발');
});

/* ───────────── 못 찾음 · 동명이인 ───────────── */

function withIndex(rows, fn) {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const before = process.env.IM_AGENT_CACHE;
  process.env.IM_AGENT_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'dart-'));
  cache.write('corpcode', { v: 1 }, rows);
  return Promise.resolve(fn()).finally(() => {
    if (before === undefined) delete process.env.IM_AGENT_CACHE;
    else process.env.IM_AGENT_CACHE = before;
  });
}

test('★ 못 찾은 것을 "법인이 없다"로 적지 않는다', async () => {
  await withKey('k'.repeat(40), () => withIndex(
    [{ corpCode: '00126380', corpName: '다른회사', stockCode: null }],
    async () => {
      const r = await dart.findCompany('가온개발');
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.notFound, true);
      assert.match(r.error, /법인이 없다는 뜻이 아니다/);
      assert.match(r.error, /공시대상/, '왜 없는지 짚어 줘야 사람이 판단할 수 있다');
    }));
});

test('★ 동명 법인이 여럿이면 하나를 고르지 않는다', async () => {
  await withKey('k'.repeat(40), () => withIndex([
    { corpCode: '00111111', corpName: '가온개발', stockCode: null },
    { corpCode: '00222222', corpName: '㈜가온개발', stockCode: '123456' },
  ], async () => {
    const r = await dart.findCompany('가온개발');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.ambiguous, true);
    assert.strictEqual(r.candidates.length, 2, '후보를 돌려줘야 사람이 고를 수 있다');
    assert.match(r.error, /엉뚱한 회사/);
  }));
});

test('하나면 찾는다 (표기가 달라도)', async () => {
  await withKey('k'.repeat(40), () => withIndex(
    [{ corpCode: '00126380', corpName: '주식회사 가온개발', stockCode: null }],
    async () => {
      const r = await dart.findCompany('㈜가온개발');
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.corpCode, '00126380');
      assert.strictEqual(r.value.corpName, '주식회사 가온개발', '표시에는 등기된 이름을 쓴다');
    }));
});

/* ───────────── Agent 쪽 판단 ───────────── */

test('★ SPC 라서 못 찾는 것은 경고하지 않는다', async () => {
  const warns = [];
  const ctx = { warn: m => warns.push(m), dataset: { get: () => ({ value: '가온개발' }) } };
  await withKey('k'.repeat(40), () => withIndex(
    [{ corpCode: '00126380', corpName: '다른회사', stockCode: null }],
    async () => {
      const s = await research.sponsorCheck(ctx);
      assert.strictEqual(s.status, 'not_in_dart');
      assert.deepStrictEqual(warns, [],
        '매 딜마다 뜨는 경고는 아무도 안 읽는다 — 경고는 사람이 골라야 할 때만 낸다');
    }));
});

test('동명 법인일 때는 경고한다 (사람이 골라야 한다)', async () => {
  const warns = [];
  const ctx = { warn: m => warns.push(m), dataset: { get: () => ({ value: '가온개발' }) } };
  await withKey('k'.repeat(40), () => withIndex([
    { corpCode: '00111111', corpName: '가온개발', stockCode: null },
    { corpCode: '00222222', corpName: '가온개발', stockCode: null },
  ], async () => {
    const s = await research.sponsorCheck(ctx);
    assert.strictEqual(s.status, 'ambiguous');
    assert.strictEqual(warns.length, 1);
    assert.match(warns[0], /2건/);
  }));
});

test('시행사가 없으면 아무것도 하지 않는다', async () => {
  assert.strictEqual(await research.sponsorCheck({ dataset: { get: () => null } }), null);
  assert.strictEqual(await research.sponsorCheck({}), null);
});

test('키가 없으면 확인하지 않았다고 말한다 (확인했다고 하지 않는다)', async () => {
  await withKey(null, async () => {
    const s = await research.sponsorCheck({ dataset: { get: () => ({ value: '가온개발' }) } });
    assert.strictEqual(s.status, 'unchecked');
    assert.match(s.note, /DART_API_KEY/);
  });
});

/* ───────────── 기존 구조에 얹혔는가 ───────────── */

test('★ 기존 커넥터 구조를 그대로 쓴다 (cache + http)', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'connectors', 'dart.js'), 'utf8');
  assert.match(src, /require\('\.\/cache'\)/);
  assert.match(src, /require\('\.\/http'\)/);
  assert.match(src, /cache\.through\(/);
  assert.ok(!/\bfetch\(/.test(src), 'fetch 를 직접 부르면 재시도·마스킹이 빠진다');
  assert.strictEqual(cache.TTL.corpcode, 30 * 86400, '10만 건짜리 목록을 매번 받으면 안 된다');
});
