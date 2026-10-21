'use strict';
// 온비드(한국자산관리공사) 커넥터 — 실측 응답 모양(data/_api/fsc-probe.md 2026-10-21 판정 0)으로 돌려서 잰다.
// ★ http·cache 를 가짜로 바꿔 끼운다. 망을 안 탄다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const dir = path.join(__dirname, '..', 'connectors');
function load(body, seen) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(dir)) delete require.cache[k];
  const http = require(path.join(dir, 'http'));
  const cache = require(path.join(dir, 'cache'));
  http.request = async (url) => { if (seen) seen.push(String(url)); return { ok: true, body: JSON.stringify(body) }; };
  cache.through = async (_p, _n, _c, fn) => fn();
  return require(path.join(dir, 'kamco'));
}
const RATE = { header: { resultCode: '00', resultMsg: 'NORMAL_CODE' }, body: { items: { item: [
  { CRTR_YMD: '20261019', SDNM: '경상북도', SGGNM: '포항시 남구', PRPT_ITEM_NM: '공동주택', SCFB_YR: '2025', SCFB_MT: '10', APSL_EVL_AMT: 160000000, DSPL_AMT: 100047000, SCFB_PRC_RTO: 62.53 },
  { CRTR_YMD: '20261019', SDNM: '경기도', SGGNM: '성남시 분당구', PRPT_ITEM_NM: '공동주택', SCFB_YR: '2025', SCFB_MT: '3', APSL_EVL_AMT: 500000000, DSPL_AMT: 400000000, SCFB_PRC_RTO: 80 },
  { CRTR_YMD: '20261019', SDNM: '경기도', SGGNM: '성남시 분당구', PRPT_ITEM_NM: '공동주택', SCFB_YR: '2025', SCFB_MT: '11', APSL_EVL_AMT: 300000000, DSPL_AMT: 210000000, SCFB_PRC_RTO: 70 },
  { CRTR_YMD: '20261019', SDNM: '경기도', SGGNM: '수원시', PRPT_ITEM_NM: '토지', SCFB_YR: '2025', SCFB_MT: '07', APSL_EVL_AMT: 100, DSPL_AMT: 50, SCFB_PRC_RTO: 50 },
] } } };

test('낙찰가율 — 이 자리에서 시도·종류로 거르고, 최신 먼저 · 표본 수·기간·중앙값을 함께 낸다', async () => {
  process.env.DATA_GO_KR_KEY = 'test-key-only';
  const k = load(RATE);
  const r = await k.auctionRates({ sido: '경기', item: '공동주택' });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.value.map(x => x.ym), ['202511', '202503'], '오래된 것부터 오는 응답을 최신 먼저로 (§4.4) · 월은 두 자리');
  assert.deepStrictEqual(r.summary, { n: 2, median: 75, from: '202503', to: '202511', asOf: '20261019' });
  assert.strictEqual((await k.auctionRates({ sido: '제주' })).ok, false, '맞는 줄이 없으면 값을 만들지 않는다');
});

test('입찰결과 — 기준월의 첫날·끝날과 안내 페이지 코드표 값으로 부르고, 칸을 사람이 읽는 이름으로 옮긴다', async () => {
  process.env.DATA_GO_KR_KEY = 'test-key-only';
  const seen = [];
  const k = load({ header: { resultCode: '00', resultMsg: 'NORMAL_CODE' }, body: { items: { item: [
    { cltrMngNo: '2025-10323-001', onbidCltrNm: '경기 성남 아파트', prptDivNm: '압류재산', dspsMthodNm: '매각', cltrUsgLclsCtgrNm: '부동산', cltrUsgMclsCtgrNm: '주거용건물', cltrUsgSclsCtgrNm: '아파트',
      landSqms: '12.5', bldSqms: '84.9', apslEvlAmt: 500000000, scfbAmt: 410000000, apslPrcCtrsScfbPrcRto: 82, pbctStatNm: '낙찰', cltrOpbdDt: '2025-02-10 10:00', vldBddrNope: 3 },
  ] } } }, seen);
  const r = await k.bidResults({ ym: '202502' });
  assert.strictEqual(r.ok, true, r.error);
  assert.ok(/opbdDtStart=20250201/.test(seen[0]) && /opbdDtEnd=20250228/.test(seen[0]), '2월 끝날은 28일');
  assert.ok(/cltrTypeCd=0001/.test(seen[0]) && /prptDivCd=0007/.test(seen[0]));
  assert.deepStrictEqual(r.value[0], { no: '2025-10323-001', name: '경기 성남 아파트', prpt: '압류재산', method: '매각', usage: '부동산 > 주거용건물 > 아파트',
    landSqm: 12.5, bldSqm: 84.9, appraisal: 500000000, price: 410000000, ratio: 82, status: '낙찰', date: '2025-02-10', bidders: 3 });
  assert.strictEqual((await k.bidResults({})).ok, false, '기준월 없이 부르지 않는다');
});

test('오류 본문 — 필수 인자 없음(11)·등록 안 된 키(30)를 값으로 읽지 않는다', async () => {
  process.env.DATA_GO_KR_KEY = 'test-key-only';
  let k = load({ result: { resultCode: '11', resultMsg: 'NO_MANDATORY_REQUEST_PARAMETERS_ERROR' } });
  let r = await k.bidResults({ ym: '202512' }); assert.strictEqual(r.ok, false); assert.ok(/11/.test(r.error));
  k = load({ OpenAPI_ServiceResponse: { cmmMsgHeader: { returnAuthMsg: '등록되지 않은 서비스키' } } });
  r = await k.auctionRates(); assert.strictEqual(r.ok, false); assert.ok(/등록되지 않은/.test(r.error));
});

test('열쇠가 없으면 부르지 않고 unavailable', async () => {
  const save = { ...process.env };
  for (const n of ['DATA_GO_KR_KEY', 'APIS_DATA', 'SPECIAL_DAY_INFO', 'PERSONAL_API_KEY']) delete process.env[n];
  const seen = []; const k = load({}, seen);
  const r = await k.auctionRates();
  Object.assign(process.env, save);
  assert.strictEqual(r.unavailable, true); assert.strictEqual(seen.length, 0);
});
