'use strict';
/**
 * kamco.js — 한국자산관리공사(온비드 · data.go.kr) Connector. 〈2026-10-21 · 사장님 「권하는 개선안 대로 진행해」〉
 *
 *   ① 압류재산 공매 낙찰가율   szrPrptPbctPbct/scfbPrcRto (15126398) — 시도·시군구·재산 종류별 감정가 대비 낙찰가
 *   ② 물건 입찰결과 목록        OnbidCltrBidRsltListSrvc2/getCltrBidRsltList2 (15157252) — 개찰일 구간의 물건별 결과
 *
 * ★ 둘 다 **실측으로 값이 온 것만** 붙인다 — `data/_api/fsc-probe.md` 2026-10-21 판정 0. 칸 이름도 그 응답에서 읽었다.
 *   입찰결과의 필수 인자 넷(물건유형·재산유형·개찰일 시작·끝)은 안내 페이지 설명이 적은 값이다(지어내지 않는다 · §4.3).
 * ★ 낙찰가율과 실거래가를 **섞지 않는다** (CLAUDE.md §17) — 이 커넥터는 공매 자료만 돌려주고, 거래사례와 한 분모에 넣지 않는다.
 * ★ 서버 거르기를 믿지 않는다 (§4) — 낙찰가율은 전량을 받아 이 자리에서 시도·시군구·종류로 거른다.
 * ★ 평균만 내지 않는다 — 표본 수와 기간을 함께 돌려준다 (§4.7 「모수」).
 *
 * 인증키: DATA_GO_KR_KEY (이름 목록은 datakey.js 한 곳)
 */

const { request, buildUrl, redact, looksUrlEncoded } = require('./http');
const cache = require('./cache');
const { dataKey } = require('./datakey');

const PROVIDER = 'data.go.kr:kamco';
const BASE = 'https://apis.data.go.kr/B010003';
/** 낙찰가율 한 번에 받는 행 수 — 전량을 받아 이 자리에서 거른다 */
const RATE_ROWS = 1000;

function isAvailable() { return Boolean(dataKey()); }

function keyFormatError() {
  if (!looksUrlEncoded(dataKey())) return null;
  return { ok: false, unavailable: true, error: 'DATA_GO_KR_KEY 가 Encoding 인증키다 — Decoding(일반) 인증키를 써야 한다' };
}

/** 응답 → 항목 배열. 두 서비스의 겉모양이 다르다(`response` 감싸개가 있기도 없기도 하다) */
function itemsOf(body) {
  const root = body && (body.response || body);
  const head = root && (root.header || root.result);
  if (head && head.resultCode && !/^0+$/.test(String(head.resultCode))) {
    return { ok: false, error: `${head.resultMsg || '오류'} (${head.resultCode})` };
  }
  if (!root || !root.body) {
    const msg = body && body.OpenAPI_ServiceResponse && body.OpenAPI_ServiceResponse.cmmMsgHeader && body.OpenAPI_ServiceResponse.cmmMsgHeader.returnAuthMsg;
    return { ok: false, error: msg || '알 수 없는 응답 형식' };
  }
  const it = (root.body.items && (root.body.items.item ?? root.body.items)) || [];
  return { ok: true, value: Array.isArray(it) ? it : [it].filter(Boolean) };
}

async function call(path, params, namespace, cacheParams, ttl) {
  if (!isAvailable()) return { ok: false, error: 'DATA_GO_KR_KEY 미설정 — 온비드 조회 생략', unavailable: true };
  const bad = keyFormatError();
  if (bad) return bad;
  return cache.through(PROVIDER, namespace, cacheParams, async () => {
    const url = buildUrl(`${BASE}/${path}`, { ...params, serviceKey: dataKey(), resultType: 'json' });
    const r = await request(url);
    if (!r.ok) return { ok: false, error: redact(r.error) };
    let body;
    try { body = JSON.parse(r.body); } catch (_) { return { ok: false, error: 'JSON 이 아닌 응답 (인증 오류일 수 있다)' }; }
    const out = itemsOf(body);
    return out.ok ? out : { ok: false, error: redact(out.error) };
  }, ttl ? { ttl } : {});
}

function num(v) { const n = Number(String(v ?? '').replace(/,/g, '')); return v === '' || v == null || !Number.isFinite(n) ? null : n; }
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

/**
 * 압류재산 공매 낙찰가율 — 시도·시군구·재산 종류로 거른 줄과 요약(표본 수·기간·중앙값).
 * @param {{sido?:string, sgg?:string, item?:string}} [q] 낱말이 «들어 있으면» 맞음(시도 «경기» → «경기도»)
 */
async function auctionRates(q = {}) {
  const r = await call('szrPrptPbctPbct/scfbPrcRto', { pageNo: 1, numOfRows: RATE_ROWS }, 'rate', { rows: RATE_ROWS }, 7 * 86400);
  if (!r.ok) return r;
  const has = (v, w) => !w || String(v || '').includes(w);
  const rows = (r.value || []).map(x => ({
    sido: String(x.SDNM || ''), sgg: String(x.SGGNM || ''), item: String(x.PRPT_ITEM_NM || ''),
    ym: `${x.SCFB_YR || ''}${String(x.SCFB_MT || '').padStart(2, '0')}`,
    appraisal: num(x.APSL_EVL_AMT), price: num(x.DSPL_AMT), ratio: num(x.SCFB_PRC_RTO), asOf: String(x.CRTR_YMD || ''),
  })).filter(x => /^\d{6}$/.test(x.ym) && has(x.sido, q.sido) && has(x.sgg, q.sgg) && has(x.item, q.item))
    .sort((a, b) => (a.ym < b.ym ? 1 : a.ym > b.ym ? -1 : 0));   // 최신 먼저 (§4.4)
  const ratios = rows.map(x => x.ratio).filter(x => x !== null);
  if (!rows.length) return { ok: false, error: '조건에 맞는 공매 낙찰가율 자료 없음', cached: r.cached };
  return {
    ok: true, cached: r.cached, value: rows,
    summary: { n: ratios.length, median: ratios.length ? Math.round(median(ratios) * 100) / 100 : null, from: rows[rows.length - 1].ym, to: rows[0].ym, asOf: rows[0].asOf },
  };
}

/** YYYYMM → [첫날, 끝날] (YYYYMMDD) */
function monthRange(ym) {
  const y = Number(String(ym).slice(0, 4)); const m = Number(String(ym).slice(4, 6));
  if (!y || !m) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${ym}01`, `${ym}${String(last).padStart(2, '0')}`];
}

/**
 * 물건 입찰결과 — 개찰일이 그 달인 결과. 기본은 물건유형 0001(부동산) · 재산유형 0007(압류재산)(안내 페이지 코드표 첫 값).
 * @param {{ym:string, cltrTypeCd?:string, prptDivCd?:string, rows?:number}} q
 */
async function bidResults({ ym, cltrTypeCd = '0001', prptDivCd = '0007', rows = 100 } = {}) {
  const rg = monthRange(ym);
  if (!rg) return { ok: false, error: '기준월(YYYYMM)이 없다' };
  const n = Math.min(Math.max(1, rows | 0), 1000);
  const r = await call('OnbidCltrBidRsltListSrvc2/getCltrBidRsltList2',
    { pageNo: 1, numOfRows: n, cltrTypeCd, prptDivCd, opbdDtStart: rg[0], opbdDtEnd: rg[1] },
    'bid', { ym, cltrTypeCd, prptDivCd, n }, 86400);
  if (!r.ok) return r;
  const out = (r.value || []).map(x => ({
    no: String(x.cltrMngNo || ''), name: String(x.onbidCltrNm || ''), prpt: String(x.prptDivNm || ''), method: String(x.dspsMthodNm || ''),
    usage: [x.cltrUsgLclsCtgrNm, x.cltrUsgMclsCtgrNm, x.cltrUsgSclsCtgrNm].filter(Boolean).join(' > '),
    landSqm: num(x.landSqms), bldSqm: num(x.bldSqms), appraisal: num(x.apslEvlAmt), price: num(x.scfbAmt),
    ratio: num(x.apslPrcCtrsScfbPrcRto), status: String(x.pbctStatNm || ''), date: String(x.cltrOpbdDt || '').slice(0, 10), bidders: num(x.vldBddrNope),
  })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { ok: true, cached: r.cached, value: out, query: { ym, cltrTypeCd, prptDivCd, from: rg[0], to: rg[1] } };
}

module.exports = { auctionRates, bidResults, monthRange, itemsOf, isAvailable, keyFormatError, PROVIDER, RATE_ROWS };
