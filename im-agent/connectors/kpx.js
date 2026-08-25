'use strict';
/**
 * kpx.js — 한국전력거래소(data.go.kr) Connector.
 *
 *   ① REC 현물시장   거래일별 육지/제주 평균가·거래량 (2017-05-30 ~)
 *
 * ★ 왜 이 값이 필요한가: 태양광 매출 = 발전량 × (SMP + REC × 가중치) 다.
 *   REC 단가는 **가정치가 아니라 실측 시장가격**이므로 출처와 함께 IM 에 실을 수
 *   있다. 발전량과 매출은 여전히 사람이 넣는다 (등록부 D-25).
 *
 * ★ 응답이 **오름차순**이다 (rn 1 = 2017-05-30). 이 저장소가 같은 함정에 걸린
 *   세 번째 API 다 — 개별공시지가·토지특성이 앞의 둘이었다. 앞에서부터 집으면
 *   9년 전 시세를 "현재가"로 쓴다. 전량을 받아 날짜로 정렬한다.
 *
 * ★ 전량(916건)이 한 번의 호출로 온다. 페이지를 나누면 호출만 늘어난다
 *   (CLAUDE.md §4). 캐시 TTL 은 7일 — 현물시장은 주 2회 개장한다.
 *
 * 인증키: DATA_GO_KR_KEY
 */

const { request, buildUrl, redact, looksUrlEncoded } = require('./http');
const cache = require('./cache');

/* ★ 쿼터 통을 **갈래로 나눈다** 〈2026-08-23 · D-85〉. data.go.kr 은 상세기능마다
   하루치를 세는데(개발계정 1,000), 앞 판은 아홉 커넥터가 `data.go.kr` 한 통을
   같이 썼다 — 한 곳이 다 쓰면 나머지 여덟이 함께 막힌다. `cache.js` 참고. */
const PROVIDER = 'data.go.kr:kpx';
const BASE = 'https://apis.data.go.kr/B552115';

/** 한 번에 받는 최대 행수. 총 916건(2026-08 기준)이라 여유를 둔다. */
const MAX_ROWS = 3000;

function apiKey() {
  return process.env.DATA_GO_KR_KEY || '';
}

function isAvailable() {
  return Boolean(apiKey());
}

/** molit 과 같은 이유로 Encoding 키를 먼저 막는다 (증상이 "키가 틀렸다"와 같다) */
function keyFormatError() {
  if (!looksUrlEncoded(apiKey())) return null;
  return {
    ok: false, unavailable: true,
    error: 'DATA_GO_KR_KEY 가 Encoding 인증키다 — Decoding(일반) 인증키를 써야 한다',
  };
}

async function call(path, params, namespace, cacheParams, ttl) {
  if (!isAvailable()) {
    return { ok: false, error: 'DATA_GO_KR_KEY 미설정 — REC 시장 조회 생략', unavailable: true };
  }
  const bad = keyFormatError();
  if (bad) return bad;

  return cache.through(PROVIDER, namespace, cacheParams, async () => {
    const url = buildUrl(`${BASE}/${path}`, { ...params, serviceKey: apiKey(), dataType: 'JSON' });
    const r = await request(url);
    if (!r.ok) return { ok: false, error: redact(r.error) };

    let body;
    try {
      body = JSON.parse(r.body);
    } catch (_) {
      return { ok: false, error: 'JSON 이 아닌 응답 (인증 오류일 수 있다)' };
    }

    const res = body.response;
    if (!res) {
      const msg = body.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg;
      return { ok: false, error: redact(msg || '알 수 없는 응답 형식') };
    }
    if (res.header && res.header.resultCode !== '00') {
      return { ok: false, error: redact(`${res.header.resultMsg} (${res.header.resultCode})`) };
    }

    const items = res.body?.items?.item ?? res.body?.items ?? [];
    return { ok: true, value: Array.isArray(items) ? items : [items].filter(Boolean) };
  }, ttl ? { ttl } : {});
}

/**
 * REC 현물시장 전체 이력 (거래일 오름차순 → **내림차순으로 뒤집어** 돌려준다).
 * @returns {Promise<{ok:boolean, value?:object[], error?:string}>}
 */
async function recSpotMarket() {
  const r = await call('RecMarketInfo2/getRecMarketInfo2',
    { pageNo: 1, numOfRows: MAX_ROWS }, 'rec', { rows: MAX_ROWS }, 7 * 86400);
  if (!r.ok) return r;

  const rows = (r.value || [])
    .map(x => ({
      date: String(x.bzDd || ''),                    // YYYYMMDD
      landAvg: num(x.landAvgPrc),                    // 육지 평균가 (원/REC)
      jejuAvg: num(x.jejuAvgPrc),                    // 제주 평균가
      landVolume: num(x.landTrdRecValue),            // 육지 거래량 (REC)
      jejuVolume: num(x.jejuTrdRecValue),
      close: num(x.clsPrc),
      totalVolume: num(x.trdRecValue),
    }))
    .filter(x => /^\d{8}$/.test(x.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));   // 최신 먼저

  if (!rows.length) return { ok: false, error: 'REC 시장 자료 없음' };
  return { ok: true, cached: r.cached, value: rows };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** YYYYMMDD 에서 months 개월 뺀 값 (문자열 비교용) */
function monthsBefore(yyyymmdd, months) {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = yyyymmdd.slice(6, 8);
  const total = y * 12 + (m - 1) - months;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}${String(total % 12 + 1).padStart(2, '0')}${d}`;
}

/**
 * 최근 N개월 REC 평균가.
 *
 * ★ **거래량 가중평균**을 기본으로 낸다. 단순평균은 거래가 거의 없던 날을
 *   많이 거래된 날과 같은 무게로 세어 시세를 왜곡한다. 다만 단순평균도 함께
 *   돌려준다 — 둘이 크게 벌어지면 그 자체가 시장이 얇다는 신호다.
 *
 * ★ 기준일은 **자료의 최신 거래일**이지 오늘이 아니다. 오늘로 잡으면 장이
 *   열리지 않은 기간만큼 표본이 조용히 줄어든다.
 *
 * @param {object} [opts]
 * @param {number} [opts.months=12] 최근 몇 개월
 * @param {'land'|'jeju'} [opts.area='land'] 육지 / 제주
 */
async function recAverage({ months = 12, area = 'land' } = {}) {
  const r = await recSpotMarket();
  if (!r.ok) return r;

  const all = r.value;
  const latest = all[0].date;
  const from = monthsBefore(latest, months);

  const priceOf = x => (area === 'jeju' ? x.jejuAvg : x.landAvg);
  const volumeOf = x => (area === 'jeju' ? x.jejuVolume : x.landVolume);

  const window = all.filter(x => x.date >= from && priceOf(x) !== null);
  if (!window.length) {
    return { ok: false, error: `최근 ${months}개월 REC 거래 자료 없음 (최신 거래일 ${latest})` };
  }

  const totalVolume = window.reduce((s, x) => s + (volumeOf(x) || 0), 0);
  const weighted = totalVolume > 0
    ? window.reduce((s, x) => s + priceOf(x) * (volumeOf(x) || 0), 0) / totalVolume
    : null;
  const simple = window.reduce((s, x) => s + priceOf(x), 0) / window.length;

  return {
    ok: true,
    cached: r.cached,
    value: {
      area,
      months,
      weightedAvg: weighted === null ? null : Math.round(weighted),
      simpleAvg: Math.round(simple),
      latestDate: latest,
      latestPrice: priceOf(all[0]),
      from,
      sessions: window.length,
      totalVolume,
    },
    history: window,
  };
}

module.exports = {
  recSpotMarket, recAverage, monthsBefore,
  isAvailable, keyFormatError, PROVIDER, MAX_ROWS,
};
