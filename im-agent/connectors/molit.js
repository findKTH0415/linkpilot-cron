'use strict';
/**
 * molit.js — 국토교통부 공공데이터(data.go.kr) Connector.
 *
 *   ① 실거래가   토지 / 상업업무용 / 아파트 매매 (시군구코드 + 계약월 단위)
 *   ② 건축물대장 표제부 (연면적·건폐율·용적률·층수·용도)
 *   ③ 건축인허가 기본개요 (허가일·착공일·사용승인일)
 *
 * ★ 호출 최소화가 이 파일의 설계 제약이다.
 *   실거래가는 (시군구, 월) 조합마다 1회씩 필요하므로 조회 개월 수를 기본 6개월로 제한하고,
 *   응답은 전부 캐시한다(TTL 7일). 같은 프로젝트를 재실행해도 재호출되지 않는다.
 *
 * 인증키: DATA_GO_KR_KEY (GitHub Secrets) — 디코딩된 일반 인증키를 넣는다.
 */

const { request, buildUrl, redact, looksUrlEncoded } = require('./http');
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

/**
 * ★ Encoding 키를 넣었으면 **부르기 전에** 막는다.
 *   data.go.kr 은 인증키를 Encoding / Decoding 두 벌로 주고, 화면 위쪽의
 *   Encoding 을 그냥 복사하기 쉽다. buildUrl 이 한 번 더 인코딩하므로
 *   `%2F` → `%252F` 가 되어 **인증만 실패한다.**
 *
 *   그대로 두면 실패 모습이 "키가 틀렸다"와 구분되지 않아, 키를 재발급받고
 *   다시 넣어도 같은 증상이 난다. 조용히 실패하지 않는다 (CLAUDE.md §2).
 */
function keyFormatError() {
  if (!looksUrlEncoded(apiKey())) return null;
  return {
    ok: false, unavailable: true,
    error: 'DATA_GO_KR_KEY 가 Encoding 인증키다 — data.go.kr 마이페이지에서 '
      + '**Decoding(일반) 인증키**를 복사해 넣어야 한다. '
      + 'Encoding 키는 호출 시 한 번 더 인코딩되어 인증에 실패한다',
  };
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
  const bad = keyFormatError(); if (bad) return bad;
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
  const bad = keyFormatError(); if (bad) return bad;
  if (!sigunguCd || !bjdongCd) return { ok: false, error: '법정동코드 없음' };

  // ★ `BldRgstService_v2` 는 **폐기되었다.** 현행은 BldRgstHubService 다.
  //   폐기된 쪽을 부르면 키·활용신청이 멀쩡해도 자료가 안 온다
  //   (2026-08-16 실측으로 확인)
  const r = await call('BldRgstHubService/getBrTitleInfo', {
    sigunguCd, bjdongCd, bun, ji, numOfRows: 10, pageNo: 1,
  }, 'building', { sigunguCd, bjdongCd, bun, ji });

  if (!r.ok) return r;
  if (!r.value.length) return { ok: false, error: '건축물대장 자료 없음 (나대지일 수 있음)' };

  const b = r.value[0];
  return {
    ok: true, cached: r.cached,
    raw: b, // 진단용 원본 — 필드명이 문서와 다를 때 대조한다
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

/* ───────────── ③ 건축인허가 (C-02) ───────────── */

/**
 * 건축인허가 기본개요.
 *
 * ★ **기록이 없는 것과 허가가 없는 것은 다르다.**
 *   개발사업은 대개 나대지에서 시작하고 그때는 인허가 기록 자체가 없다.
 *   그런데 응답이 비었다고 "미허가"라고 적으면, 실제로는 허가를 받았는데
 *   API 수록이 늦었거나 주소가 안 맞은 경우까지 **미허가로 단정**하게 된다.
 *   그래서 빈 응답은 `ok:false` + `notFound:true` 로 돌려주고, 부르는 쪽이
 *   값을 채우지 않고 **사람에게 묻도록** 둔다.
 *
 * ★ 응답 필드명은 공식 문서 기준이고 **실제 키로 검증하지 않았다** (B-4).
 *   그래서 `raw` 를 함께 돌려준다 — 필드명이 다르면 그걸로 대조한다.
 *
 * @param {object} p { sigunguCd, bjdongCd, platGbCd, bun, ji }
 *        platGbCd: 0=대지, 1=산, 2=블록 (PNU 의 대지구분에서 파생한다)
 */
async function buildingPermit({ sigunguCd, bjdongCd, platGbCd = '0', bun, ji }) {
  if (!isAvailable()) return unavailable('건축인허가');
  const bad = keyFormatError(); if (bad) return bad;
  if (!sigunguCd || !bjdongCd) return { ok: false, error: '법정동코드 없음' };

  const r = await call('ArchPmsHubService/getApBasisOulnInfo', {
    sigunguCd, bjdongCd, platGbCd, bun, ji, numOfRows: 30, pageNo: 1,
  }, 'permit', { sigunguCd, bjdongCd, platGbCd, bun, ji });

  if (!r.ok) return r;
  if (!r.value.length) {
    return {
      ok: false, notFound: true,
      error: '건축인허가 기록 없음 — **미허가라는 뜻이 아니다.** '
        + '나대지이거나, 허가는 받았으나 수록이 늦었거나, 지번이 안 맞을 수 있다',
    };
  }

  const records = r.value.map(toPermit).sort(byRecency);
  return { ok: true, cached: r.cached, raw: r.value[0], records, value: permitStatus(records) };
}

/** 인허가 원본 → 공통 레코드. 날짜는 YYYYMMDD 로 온다 */
function toPermit(item) {
  const day = (v) => {
    const s = String(v ?? '').replace(/\D/g, '');
    return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null;
  };
  return {
    permitDate: day(item.archPmsDay),        // 건축허가일
    startDate: day(item.realStcnsDay),       // 착공일
    approvalDate: day(item.useAprDay),       // 사용승인일
    kind: item.archGbCdNm || null,           // 신축/증축/대수선
    mainUse: item.mainPurpsCdNm || null,
    totalAreaSqm: num(item.totArea),
    platAreaSqm: num(item.platArea),
    name: item.bldNm || null,
  };
}

/** 최근 건이 앞으로 (허가일 기준, 없으면 착공·승인일) */
function byRecency(a, b) {
  const k = (r) => r.permitDate || r.startDate || r.approvalDate || '';
  return k(b).localeCompare(k(a));
}

/**
 * 레코드 → `legal.permit_status` 문장.
 *
 * ★ 진행 단계는 **뒤에서부터** 본다. 사용승인이 있으면 허가·착공은 당연히 지났고,
 *   그 상태를 "건축허가 취득"이라고 적으면 실제보다 이른 단계로 읽힌다.
 */
function permitStatus(records) {
  const r = (records || [])[0];
  if (!r) return null;

  const kind = r.kind ? `${r.kind} · ` : '';
  if (r.approvalDate) return `${kind}사용승인 완료 (${r.approvalDate})`;
  if (r.startDate) return `${kind}착공 (${r.startDate})`;
  if (r.permitDate) return `${kind}건축허가 취득 (${r.permitDate})`;
  // 기록은 있는데 날짜가 하나도 없다 — 단계를 지어내지 않는다
  return null;
}

module.exports = {
  trades, buildingRegister, buildingPermit,
  isAvailable, keyFormatError, TRADE_ENDPOINTS, toTrade, toPermit, permitStatus, PROVIDER,
};
