'use strict';
/**
 * molit.js — 국토교통부 공공데이터(data.go.kr) Connector.
 *
 *   ① 실거래가   토지 / 상업업무용 / 아파트 매매 (시군구코드 + 계약월 단위)
 *   ② 건축물대장 표제부 (연면적·건폐율·용적률·층수·용도)
 *
 * ★ 호출 최소화가 이 파일의 설계 제약이다.
 *   실거래가는 (시군구, 월) 조합마다 1회씩 필요하므로 조회 개월 수를 기본 6개월로 제한하고,
 *   응답은 전부 캐시한다(TTL 7일). 같은 프로젝트를 재실행해도 재호출되지 않는다.
 *
 * 인증키: DATA_GO_KR_KEY (GitHub Secrets) — 디코딩된 일반 인증키를 넣는다.
 */

const { request, buildUrl, redact } = require('./http');
const cache = require('./cache');
const { normalize, num } = require('./xml');

const PROVIDER = 'data.go.kr';
const BASE = 'https://apis.data.go.kr/1613000';

/** 거래유형별 엔드포인트 */
const TRADE_ENDPOINTS = {
  land: { path: 'RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade', label: '토지' },
  commercial: { path: 'RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade', label: '상업업무용' },
  apartment: { path: 'RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev', label: '아파트' },
};

function apiKey() {
  return process.env.DATA_GO_KR_KEY || '';
}

function isAvailable() {
  return Boolean(apiKey());
}

function unavailable(what) {
  return { ok: false, error: `DATA_GO_KR_KEY 미설정 — ${what} 조회 생략`, unavailable: true };
}

async function call(path, params, namespace, cacheParams) {
  return cache.through(PROVIDER, namespace, cacheParams, async () => {
    const url = buildUrl(`${BASE}/${path}`, { ...params, serviceKey: apiKey(), _type: 'json' });
    const r = await request(url);
    if (!r.ok) return { ok: false, error: redact(r.error) };

    const parsed = normalize(r.body);
    if (!parsed.ok) return { ok: false, error: redact(parsed.error) };
    return { ok: true, value: parsed.items };
  });
}

/**
 * 실거래가 조회.
 * @param {string} sigunguCd 시군구코드 5자리 (PNU에서 파생)
 * @param {string[]} months  YYYYMM 배열
 * @param {'land'|'commercial'|'apartment'} type
 */
async function trades(sigunguCd, months, type = 'land') {
  if (!isAvailable()) return unavailable('실거래가');
  const endpoint = TRADE_ENDPOINTS[type];
  if (!endpoint) return { ok: false, error: `알 수 없는 거래유형: ${type}` };
  if (!sigunguCd) return { ok: false, error: '시군구코드 없음' };

  const all = [];
  const errors = [];
  let cachedCount = 0;

  for (const ym of months) {
    const r = await call(endpoint.path, {
      LAWD_CD: sigunguCd, DEAL_YMD: ym, numOfRows: 200, pageNo: 1,
    }, 'trade', { type, sigunguCd, ym });

    if (!r.ok) {
      errors.push(`${ym}: ${r.error}`);
      if (r.quotaExhausted) break; // 쿼터 소진이면 즉시 중단
      continue;
    }
    if (r.cached) cachedCount++;
    for (const item of r.value) all.push(toTrade(item, ym, type));
  }

  const valid = all.filter(t => t.pricePerSqm !== null);
  return {
    ok: valid.length > 0,
    value: valid,
    label: endpoint.label,
    monthsQueried: months.length,
    cachedMonths: cachedCount,
    error: valid.length ? null : (errors[0] || '실거래 자료 없음'),
    errors,
  };
}

/** 공공데이터 원본 필드 → 공통 거래 레코드. 거래금액 단위는 만원이다. */
function toTrade(item, ym, type) {
  const amountManwon = num(item.거래금액 ?? item.dealAmount ?? item.dealAmt);
  const areaSqm = num(item.거래면적 ?? item.dealArea ?? item.건물면적 ?? item.buildingAr ?? item.전용면적 ?? item.excluUseAr);
  const eok = amountManwon === null ? null : amountManwon / 10000; // 만원 → 억원

  return {
    type,
    ym,
    dealAmountEok: eok,
    areaSqm,
    pricePerSqm: (eok !== null && areaSqm) ? Math.round((eok * 1e8) / areaSqm) : null, // 원/㎡
    jibun: item.지번 ?? item.jibun ?? null,
    dong: item.법정동 ?? item.umdNm ?? null,
    usage: item.용도지역 ?? item.지목 ?? item.buildingUse ?? null,
    buildYear: num(item.건축년도 ?? item.buildYear),
    dealDate: [num(item.년 ?? item.dealYear), num(item.월 ?? item.dealMonth), num(item.일 ?? item.dealDay)]
      .every(v => v !== null)
      ? `${item.년 ?? item.dealYear}-${String(item.월 ?? item.dealMonth).padStart(2, '0')}-${String(item.일 ?? item.dealDay).padStart(2, '0')}`
      : null,
  };
}

/** 건축물대장 표제부 */
async function buildingRegister({ sigunguCd, bjdongCd, bun, ji }) {
  if (!isAvailable()) return unavailable('건축물대장');
  if (!sigunguCd || !bjdongCd) return { ok: false, error: '법정동코드 없음' };

  const r = await call('BldRgstService_v2/getBrTitleInfo', {
    sigunguCd, bjdongCd, bun, ji, numOfRows: 10, pageNo: 1,
  }, 'building', { sigunguCd, bjdongCd, bun, ji });

  if (!r.ok) return r;
  if (!r.value.length) return { ok: false, error: '건축물대장 자료 없음 (나대지일 수 있음)' };

  const b = r.value[0];
  return {
    ok: true, cached: r.cached,
    value: {
      name: b.bldNm || null,
      platAreaSqm: num(b.platArea),        // 대지면적
      archAreaSqm: num(b.archArea),        // 건축면적
      totalAreaSqm: num(b.totArea),        // 연면적
      vlRatEstmTotArea: num(b.vlRatEstmTotArea), // 용적률 산정 연면적
      bcRatio: num(b.bcRat),               // 건폐율
      vlRatio: num(b.vlRat),               // 용적률
      groundFloors: num(b.grndFlrCnt),
      basementFloors: num(b.ugrndFlrCnt),
      heightM: num(b.heit),
      mainUse: b.mainPurpsCdNm || null,
      approvalDate: b.useAprDay || null,
    },
  };
}

module.exports = { trades, buildingRegister, isAvailable, TRADE_ENDPOINTS, toTrade, PROVIDER };
