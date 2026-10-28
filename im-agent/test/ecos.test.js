'use strict';
/**
 * ecos.test.js — 한국은행 ECOS 시장금리 Connector.
 *
 * 가장 중요한 검사는 **"기준금리를 차입금리로 쓰지 않는가"** 다.
 * 국고채 3%를 debt.rate 로 넣으면 실제 6%짜리 딜이 3%로 계산되어 IRR 이 통째로
 * 부풀려진다. 조용히 틀리고, 틀린 채로 IM 에 실린다.
 */
const test = require('node:test');
const assert = require('node:assert');

const ecos = require('../connectors/ecos');
const dict = require('../core/dictionary');

const KTB3 = ecos.SERIES.ktb3;

function withKey(key, fn) {
  const before = process.env.ECOS_API_KEY;
  if (key === null) delete process.env.ECOS_API_KEY;
  else process.env.ECOS_API_KEY = key;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.ECOS_API_KEY;
    else process.env.ECOS_API_KEY = before;
  }
}

/* ───────────── 이 커넥터가 무엇을 채우는가 ───────────── */

test('★ 채우는 것은 기준금리이지 차입금리가 아니다', () => {
  const fills = require('../agents/03-research').FILLS;
  assert.deepStrictEqual(fills, ['debt.benchmark_rate']);
  assert.ok(!fills.includes('debt.rate'),
    '국고채를 차입금리로 넣으면 IRR 이 통째로 부풀려진다 — PF 금리 = 기준금리 + 스프레드');

  // 사전에 두 항목이 따로 있어야 그 구분이 유지된다
  assert.ok(dict.FIELDS['debt.benchmark_rate'], '기준금리 항목이 사전에 없다');
  assert.ok(dict.FIELDS['debt.rate'].requiredFor.includes('financial'));
  assert.strictEqual((dict.FIELDS['debt.benchmark_rate'].requiredFor || []).length, 0,
    '기준금리는 필수가 아니다 — 없다고 보고서를 막을 값이 아니다');
});

test('기준금리는 시점에 따라 달라지는 항목으로 잡힌다', () => {
  assert.strictEqual(dict.FIELDS['debt.benchmark_rate'].dated, true,
    '금리는 언제 조회했는지가 값의 절반이다');
});

/* ───────────── 응답 해석 ───────────── */

test('최근 영업일 값을 고른다 (빈 행은 건너뛴다)', () => {
  const body = JSON.stringify({ StatisticSearch: { row: [
    { TIME: '20260811', DATA_VALUE: '3.01', ITEM_NAME1: '국고채(3년)', UNIT_NAME: '%' },
    { TIME: '20260812', DATA_VALUE: '3.05', ITEM_NAME1: '국고채(3년)', UNIT_NAME: '%' },
    { TIME: '20260813', DATA_VALUE: '', ITEM_NAME1: '국고채(3년)', UNIT_NAME: '%' },
  ] } });
  const r = ecos.parseResponse(body, KTB3, { start: '2026-08-01', end: '2026-08-15' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.rate, 3.05, '빈 행을 만나면 그 앞의 값을 써야 한다');
  assert.strictEqual(r.value.date, '2026-08-12', 'YYYYMMDD 를 사람이 읽는 형식으로');
  assert.strictEqual(r.value.unit, '%');
});

/**
 * ★ 이게 이 파일에서 가장 중요한 검사다.
 *   ECOS 는 인증 실패도 **HTTP 200** 으로 돌려주고 본문에만 적는다.
 *   이걸 안 보면 "조회 성공, 값 없음"이 되어 조용히 가정치로 되돌아간다 —
 *   화면에는 아무 경고도 안 뜬다.
 */
test('인증 실패가 200 으로 와도 성공으로 세지 않는다', () => {
  const body = JSON.stringify({ RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다' } });
  const r = ecos.parseResponse(body, KTB3, {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /INFO-100/);
  assert.match(r.error, /인증키/);
});

test('구간에 고시값이 없으면 이유를 말한다', () => {
  const r = ecos.parseResponse(JSON.stringify({ StatisticSearch: { row: [] } }),
    KTB3, { start: '2026-01-01', end: '2026-01-03' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /고시값이 없다/);
  assert.match(r.error, /2026-01-01/, '어느 구간을 봤는지 알려 줘야 다시 시도할 수 있다');
});

test('필드명이 바뀌면 그렇게 말한다 (조용히 빈 값이 되지 않는다)', () => {
  // DATA_VALUE 가 아닌 이름으로 오면 값을 못 찾는다 — 그때 이유를 짚어 준다
  const body = JSON.stringify({ StatisticSearch: { row: [{ TIME: '20260812', VALUE: '3.05' }] } });
  const r = ecos.parseResponse(body, KTB3, {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /DATA_VALUE/);
});

test('JSON 이 아니면 키·통계표코드를 의심하라고 한다', () => {
  const r = ecos.parseResponse('<html>error</html>', KTB3, {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /JSON/);
});

/* ───────────── 키 취급 ───────────── */

test('★ 키가 경로에 들어가므로 명시적으로 가린다', () => {
  const key = 'ABCD1234EFGH5678IJKL';   // ECOS 키는 20자쯤 — 일반 규칙에 안 걸린다
  withKey(key, () => {
    const url = ecos.buildRequestUrl(KTB3, '2026-08-01', '2026-08-15', key);
    assert.ok(url.includes(key), '조립 자체는 키를 넣는다');
    assert.ok(!ecos.mask(url).includes(key), '로그로 나갈 때는 가려져야 한다');
    assert.ok(!ecos.mask(`요청 실패: ${url}`).includes(key));
  });
});

test('키가 없으면 부르지 않고 사유를 남긴다', async () => {
  await withKey(null, async () => {
    assert.strictEqual(ecos.isAvailable(), false);
    const r = await ecos.marketRate();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.unavailable, true, '데이터를 지어내지 않고 비운다');
    assert.match(r.error, /ECOS_API_KEY/);
  });
});

test('모르는 계열을 부르면 조용히 기본값으로 넘어가지 않는다', async () => {
  await withKey('x'.repeat(20), async () => {
    const r = await ecos.marketRate('없는계열');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /모르는 금리 계열/);
  });
});

/* ───────────── URL 조립 ───────────── */

test('URL 이 ECOS 규격대로 조립된다', () => {
  const url = ecos.buildRequestUrl(KTB3, '2026-08-01', '2026-08-15', 'KEY');
  assert.strictEqual(url,
    `${ecos.BASE}/KEY/json/kr/1/100/817Y002/D/20260801/20260815/010200000`);
  assert.ok(!url.includes('?'), '키는 쿼리가 아니라 경로에 들어간다');
});

test('날짜 변환과 되돌아보기', () => {
  assert.strictEqual(ecos.compact('2026-08-15'), '20260815');
  assert.strictEqual(ecos.daysAgo(14, '2026-08-15'), '2026-08-01');
  assert.strictEqual(ecos.daysAgo(1, '2026-03-01'), '2026-02-28', '월을 넘어도 맞아야 한다');
});

/* ───────────── 기존 구조에 얹혔는가 ───────────── */

test('★ 기존 커넥터 구조를 그대로 쓴다 (cache + http)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'ecos.js'), 'utf8');

  assert.match(src, /require\('\.\/cache'\)/, '캐시를 안 타면 쿼터·재호출 규칙 밖에 있게 된다');
  assert.match(src, /require\('\.\/http'\)/, 'http 의 재시도·타임아웃·마스킹을 그대로 써야 한다');
  assert.match(src, /cache\.through\(/, '캐시를 통과하지 않고 직접 부르면 안 된다');
  assert.ok(!/\bfetch\(/.test(src), 'fetch 를 직접 부르면 재시도·마스킹이 빠진다');

  // 금리는 영업일마다 바뀐다 — 다른 자료와 같은 TTL 을 쓰면 안 된다
  const cache = require('../connectors/cache');
  assert.strictEqual(cache.TTL.rate, 86400, '금리 TTL 은 하루여야 한다');
});

test('캐시 키에 인증키가 들어가지 않는다', () => {
  const cache = require('../connectors/cache');
  withKey('SECRETKEY1234567890', () => {
    const k = cache.keyFor('rate', { seriesId: 'ktb3', start: '2026-08-01', end: '2026-08-15' });
    assert.ok(!String(k).includes('SECRETKEY'), '캐시 파일명에 키가 남으면 안 된다');
  });
});
