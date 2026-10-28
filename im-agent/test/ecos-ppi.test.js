'use strict';
/**
 * ecos-ppi.test.js — 생산자물가지수(제조 딜의 단가 시점수정).
 *
 * 이 커넥터가 조용히 틀릴 수 있는 길은 셋이다. 셋 다 **결과가 그럴듯하게 나오고
 * 문서에는 「시점수정 적용」만 남는다** — 눈으로는 못 잡는다.
 *
 *   ① 업종을 자동으로 골라 버린다 — 「1차 금속」과 「기타 기계 및 장비」는
 *      몇 년 새 두 자릿수로 갈린다. 틀린 업종으로 보정해도 계수는 나온다.
 *   ② 응답 순서를 믿는다 — ECOS 도 오래된 것부터 주는 경우가 있다(§4.4).
 *      앞에서 집으면 2년 전 값을 최신으로 쓰고, 계수가 뒤집힌다.
 *   ③ 월별 변동률을 곱해 쌓는다 — 구간 경계에서 한 달을 더 센다.
 *
 * 그래서 여기서는 **정렬·계수 산식·거부 분기**를 못 박는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ecos = require('../connectors/ecos');
const cache = require('../connectors/cache');
const http = require('../connectors/http');

function withEnv(env, fn) {
  const saved = {};
  Object.keys(env).forEach((k) => { saved[k] = process.env[k]; });
  Object.keys(env).forEach((k) => {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  });
  const done = () => Object.keys(saved).forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
  const r = fn();
  return (r && typeof r.then === 'function') ? r.finally(done) : (done(), r);
}

/**
 * `request` 를 갈아끼워 응답을 흉내 낸다. 실제 키가 없어도 **해석 경로 전체**를
 * 지나가게 하려는 것이다 — 키 없음 분기에서만 끝나면 파서는 한 번도 안 돈다
 * (M-08 이 정확히 그 상태에서 났다).
 *
 * 캐시도 함께 격리한다. 안 하면 앞 테스트 결과가 뒤 테스트에 새어 든다.
 */
function withFakeResponse(bodies, fn) {
  const real = http.request;
  const calls = [];
  const queue = Array.isArray(bodies) ? bodies.slice() : [bodies];
  http.request = async (url) => {
    calls.push(url);
    const b = queue.length > 1 ? queue.shift() : queue[0];
    if (b && b.transportError) return { ok: false, status: 0, error: b.transportError, attempts: 1 };
    return { ok: true, status: 200, body: typeof b === 'string' ? b : JSON.stringify(b), attempts: 1 };
  };
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ppi-cache-'));
  return withEnv({ ECOS_API_KEY: 'K'.repeat(20), IM_AGENT_CACHE: tmp }, () => fn(calls))
    .finally(() => {
      http.request = real;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }
    });
}

/** ECOS 시계열 응답 한 건 */
function row(time, value, name) {
  return { TIME: time, DATA_VALUE: String(value), ITEM_NAME1: name || '기타 기계 및 장비', UNIT_NAME: '2020=100' };
}

/* ───────────── ① 업종을 자동으로 고르지 않는다 (§4.9) ───────────── */

test('★ 업종을 지정하지 않으면 거부한다 — 자동으로 고르지 않는다', async () => {
  await withFakeResponse({}, async () => {
    const r = await ecos.ppiSeries({ from: '202401', to: '202606' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /자동으로 고르지 않는다/);
    assert.match(r.error, /ppiItems/, '어떻게 고르는지 알려 줘야 막다른 길이 안 된다');
  });
});

test('★ 업종 미지정이면 네트워크를 아예 안 탄다', async () => {
  await withFakeResponse({}, async (calls) => {
    await ecos.ppiSeries({ from: '202401', to: '202606' });
    assert.strictEqual(calls.length, 0, '거부할 요청으로 쿼터를 쓰면 안 된다');
  });
});

test('업종 목록은 조회 가능 구간까지 알려 준다 (사람이 구간을 정해야 한다)', async () => {
  await withFakeResponse({
    StatisticItemList: { row: [
      { ITEM_CODE: '*AA', ITEM_NAME: '기타 기계 및 장비', CYCLE: 'M', START_TIME: '196501', END_TIME: '202607' },
      { ITEM_CODE: '*AB', ITEM_NAME: '1차 금속제품', CYCLE: 'M', START_TIME: '196501', END_TIME: '202607' },
    ] },
  }, async () => {
    const r = await ecos.ppiItems();
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.value.length, 2);
    assert.deepStrictEqual(r.value[0], {
      code: '*AA', name: '기타 기계 및 장비', cycle: 'M', from: '196501', to: '202607',
    });
  });
});

test('항목이 하나도 없으면 통계표코드를 의심하라고 한다 (빈 목록으로 넘어가지 않는다)', async () => {
  await withFakeResponse({ StatisticItemList: { row: [] } }, async () => {
    const r = await ecos.ppiItems();
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /D-43/, '아직 실측 안 된 코드라는 사실로 연결돼야 한다');
  });
});

/* ───────────── ② 응답 순서를 믿지 않는다 (§4.4) ───────────── */

/**
 * ★ 국내 공공 API 는 오래된 것부터 주는 경우가 많다. 여기서는 **뒤섞인 순서**로
 *   주어도 양 끝이 맞는지 본다. 틀리면 계수가 1.08 대신 0.93 으로 뒤집히는데,
 *   출처 표시는 멀쩡해서 문서만 봐서는 안 잡힌다.
 */
test('★ 응답 순서가 뒤섞여 있어도 양 끝을 시점으로 고른다', async () => {
  await withFakeResponse({
    StatisticSearch: { row: [row('202506', 112.4), row('202401', 104.0), row('202410', 108.1)] },
  }, async () => {
    const r = await ecos.ppiSeries({ item: '*AA', from: '202401', to: '202506' });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.value.first.time, '202401');
    assert.strictEqual(r.value.last.time, '202506');
    assert.deepStrictEqual(r.value.rows.map(x => x.time), ['202401', '202410', '202506']);
  });
});

test('숫자가 아닌 행은 세지 않는다 (결측을 0 으로 세면 계수가 조용히 작아진다)', async () => {
  await withFakeResponse({
    StatisticSearch: { row: [row('202401', 104.0), { TIME: '202402', DATA_VALUE: '' }, row('202403', 106.0)] },
  }, async () => {
    const r = await ecos.ppiSeries({ item: '*AA', from: '202401', to: '202403' });
    assert.strictEqual(r.value.rows.length, 2);
    assert.strictEqual(r.value.last.value, 106.0);
  });
});

test('구간에 값이 없으면 항목코드·주기를 의심하라고 한다', async () => {
  await withFakeResponse({ StatisticSearch: { row: [] } }, async () => {
    const r = await ecos.ppiSeries({ item: '*AA', from: '202401', to: '202403' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /항목코드·주기 확인/);
  });
});

/** ★ 인증 실패가 200 으로 온다 — 안 보면 「성공, 값 없음」이 되어 가정치로 돌아간다 */
test('★ 인증 실패가 200 으로 와도 성공으로 세지 않는다', async () => {
  await withFakeResponse({ RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다' } }, async () => {
    const r = await ecos.ppiSeries({ item: '*AA', from: '202401', to: '202403' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /INFO-100/);
  });
});

/* ───────────── ③ 계수는 양 끝 지수의 비다 ───────────── */

test('★ 시점수정 계수 = 양 끝 지수의 비 (변동률을 누적하지 않는다)', async () => {
  await withFakeResponse({
    StatisticSearch: { row: [row('202401', 100.0), row('202407', 103.0), row('202506', 110.0)] },
  }, async () => {
    const r = await ecos.priceAdjustment({ item: '*AA', from: '202401', to: '202506' });
    assert.strictEqual(r.ok, true, r.error);
    // 110.0 / 100.0 — 중간 달(103.0)은 계수에 관여하지 않는다
    assert.strictEqual(r.value.factor, 1.1);
    assert.strictEqual(r.value.percent, 10);
    assert.strictEqual(r.value.months, 17, '연도를 넘는 개월 수를 세야 한다');
  });
});

test('★ 기준 시점 지수가 0 이면 계수를 만들지 않는다 (무한대가 나온다)', async () => {
  await withFakeResponse({
    StatisticSearch: { row: [row('202401', 0), row('202506', 110.0)] },
  }, async () => {
    const r = await ecos.priceAdjustment({ item: '*AA', from: '202401', to: '202506' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /계수를 낼 수 없다/);
  });
});

/**
 * ★ 값만 옮기지 않는다 (§4.7). **어느 업종·어느 두 달·어떤 지수**로 나온
 *   계수인지가 없으면, 반년 뒤에 이 숫자가 맞는지 아무도 확인할 수 없다.
 */
test('★ 출처에 업종·기준시점·양 끝 지수가 전부 남는다', async () => {
  await withFakeResponse({
    StatisticSearch: { row: [row('202401', 100.0, '1차 금속제품'), row('202506', 110.0, '1차 금속제품')] },
  }, async () => {
    const r = await ecos.priceAdjustment({ item: '*AB', from: '202401', to: '202506' });
    const s = r.value.source;
    assert.strictEqual(s.provider, '한국은행 ECOS');
    assert.match(s.label, /1차 금속제품/, '어느 업종인지 없으면 검증이 불가능하다');
    assert.match(s.note, /202401 지수 100/);
    assert.match(s.note, /202506 지수 110/);
    assert.match(s.note, /변동률을 누적하지 않았다/);
    assert.match(s.note, /두 번 보정/, '이미 최근 단가에 또 적용하는 위험을 적어야 한다');
  });
});

/**
 * ★ 계수는 **가정이 아니지만 적용은 사람이 정한다.** 이 구분이 무너지면
 *   §4.8(가정 섞이면 자동으로 내지 않는다)의 반대편으로 넘어간다 —
 *   공표 통계를 근거 없이 자동 적용해 단가가 두 번 보정된다.
 */
test('★ 계수를 자동으로 fact 로 등록하지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'ecos.js'), 'utf8');
  assert.ok(!/facts?\.push|addMany|new Dataset/.test(src),
    'fact 를 등록하고 있다 — 사람 확인 없이 단가가 보정된다');
  assert.match(src, /적용할지는/, '누가 적용을 정하는지 코드에 적어야 한다');
});

/* ───────────── 구간 표기 ───────────── */

test('YYYY-MM · YYYYMM · Date 를 모두 받는다', () => {
  assert.strictEqual(ecos.month('2024-01'), '202401');
  assert.strictEqual(ecos.month('202401'), '202401');
  assert.strictEqual(ecos.month(new Date('2024-01-15T00:00:00+09:00')), '202401');
  assert.strictEqual(ecos.month('2024'), '', '못 읽으면 짐작하지 않는다');
  assert.strictEqual(ecos.month(null), '');
});

test('구간이 없으면 부르지 않는다', async () => {
  await withFakeResponse({}, async (calls) => {
    const r = await ecos.ppiSeries({ item: '*AA', from: '2024' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /YYYYMM/);
    assert.strictEqual(calls.length, 0);
  });
});

/* ───────────── 구조·쿼터·시크릿 ───────────── */

test('★ 캐시를 통과한다 (일일 한도 밖으로 새지 않는다)', async () => {
  await withFakeResponse({
    StatisticSearch: { row: [row('202401', 100.0), row('202506', 110.0)] },
  }, async (calls) => {
    const a = await ecos.ppiSeries({ item: '*AA', from: '202401', to: '202506' });
    const b = await ecos.ppiSeries({ item: '*AA', from: '202401', to: '202506' });
    assert.strictEqual(a.cached, false);
    assert.strictEqual(b.cached, true, '같은 조회를 두 번 부르면 안 된다 (§4.5)');
    assert.strictEqual(calls.length, 1);
  });
});

test('★ 업종이 다르면 캐시가 섞이지 않는다', async () => {
  await withFakeResponse({
    StatisticSearch: { row: [row('202401', 100.0), row('202506', 110.0)] },
  }, async (calls) => {
    await ecos.ppiSeries({ item: '*AA', from: '202401', to: '202506' });
    await ecos.ppiSeries({ item: '*AB', from: '202401', to: '202506' });
    assert.strictEqual(calls.length, 2, '업종이 캐시 키에 안 들어가면 다른 업종 값이 나온다');
  });
});

test('TTL 이 자료 성격에 맞다 (월별 공표 · 목록은 개정 시에만)', () => {
  assert.strictEqual(cache.TTL.ppi, 7 * 86400, '월 1회 공표인데 하루짜리 TTL 은 호출만 늘린다');
  assert.strictEqual(cache.TTL['ppi-items'], 180 * 86400, '무거운 목록 조회는 오래 붙든다 (§4.5)');
});

test('★ 캐시 키에 인증키가 들어가지 않는다', () => {
  const k = cache.keyFor('ppi', { item: '*AA', from: '202401', to: '202506' });
  assert.ok(!/K{5,}/.test(String(k)));
  assert.ok(!String(k).includes('ECOS'));
});

test('키가 없으면 지어내지 않고 비운다', async () => {
  await withEnv({ ECOS_API_KEY: undefined }, async () => {
    for (const r of [await ecos.ppiItems(), await ecos.ppiSeries({ item: '*AA', from: '202401', to: '202506' })]) {
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.unavailable, true);
    }
  });
});

/* ───────────── 스모크 · 등록부 ───────────── */

/** ★ 붙였는데 확인할 방법이 없으면 붙인 것이 아니다 (§4.3 ①) */
test('★ 스모크가 이 커넥터를 확인한다', () => {
  const smoke = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  assert.match(smoke, /생산자물가 업종목록/, '스모크에 없으면 붙인 줄도 모른다');
  assert.match(smoke, /ppiItems\(\)/);
  assert.match(smoke, /--ppi-item/, '계수까지 확인하는 길을 알려 줘야 한다');
  assert.match(smoke, /자동으로 고르지 않는다/, '스모크도 이 값의 성격을 말해야 한다');
});

/** ★ 통계표코드가 아직 문서 기준이라는 사실을 코드와 등록부 양쪽에 남긴다 */
test('★ 미검증이라는 사실이 코드와 등록부에 남아 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'ecos.js'), 'utf8');
  assert.match(src, /D-43/, '검증 안 된 코드라는 표시가 있어야 한다');
  assert.match(src, /실제 키로 검증하지 않았다/);

  const reg = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', '미결정-사항.md'), 'utf8');
  assert.match(reg, /D-43\./, '등록부에 없으면 실측 전에 잊는다');
  assert.match(reg, /404Y014/, '어느 통계표를 확인해야 하는지 적어야 한다');
});
