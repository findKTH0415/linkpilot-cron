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

const { request, buildUrl, redact, looksUrlEncoded } = require('./http');
const cache = require('./cache');
const { normalize, num } = require('./xml');

/* ★ 쿼터 통을 **갈래로 나눈다** 〈2026-08-23 · D-85〉. data.go.kr 은 상세기능마다
   하루치를 세는데(개발계정 1,000), 앞 판은 아홉 커넥터가 `data.go.kr` 한 통을
   같이 썼다 — 한 곳이 다 쓰면 나머지 여덟이 함께 막힌다. `cache.js` 참고. */
const PROVIDER = 'data.go.kr:molit';
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

  // ★ 엔드포인트는 `BldRgstHubService` 다. 구 `BldRgstService_v2` 는 폐기되어
  //   NO_OPENAPI_SERVICE_ERROR(코드 12) 만 돌아온다 — 2026-08-15 실측 확인.
  //   키 문제와 증상이 달라서(403 vs 400) 응답 본문을 봐야 구분된다.
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

/**
 * 인허가 단계 판정 — 날짜가 찍힌 순서가 곧 진행 단계다.
 *
 * ★ 건축HUB 는 '상태' 필드를 주지 않는다. 허가일·착공일·사용승인일이 있고,
 *   어디까지 찍혔는지가 단계다. 뒤에서부터 본다.
 */
function permitStage(p) {
  if (p.useAprDay) return { stage: '사용승인', order: 4, date: p.useAprDay };
  if (p.realStcnsDay) return { stage: '착공', order: 3, date: p.realStcnsDay };
  if (p.archPmsDay) return { stage: '건축허가', order: 2, date: p.archPmsDay };
  if (p.stcnsSchedDay) return { stage: '착공예정', order: 1, date: p.stcnsSchedDay };
  return { stage: '미확인', order: 0, date: null };
}

function txt(v) {
  const s = String(v == null ? '' : v).trim();
  return s || null;
}

function day(v) {
  const s = String(v == null ? '' : v).replace(/\D/g, '');
  return /^\d{8}$/.test(s) ? s : null;
}

/**
 * 건축인허가 (건축HUB) — 필지의 인허가 이력.
 *
 * ★ **한 필지에 여러 건이 쌓인다** (표본 필지는 11건). 과거 건물의 인허가가
 *   섞이므로 "가장 최근 건 = 이 프로젝트의 인허가" 라고 단정할 수 없다.
 *   그래서 하나를 고르지 않고 **이력 전체를 최신순으로** 돌려준다.
 *   무엇이 이 딜의 인허가인지는 사람이 안다.
 *
 * ★ 정렬을 직접 한다. 이 저장소가 공공 API 정렬 방향에 걸린 것이 다섯 번째다.
 */
async function buildingPermits({ sigunguCd, bjdongCd, bun, ji }) {
  if (!isAvailable()) return unavailable('건축인허가');
  const bad = keyFormatError(); if (bad) return bad;
  if (!sigunguCd || !bjdongCd) return { ok: false, error: '법정동코드 없음' };

  const r = await call('ArchPmsHubService/getApBasisOulnInfo', {
    sigunguCd, bjdongCd, bun, ji, numOfRows: 100, pageNo: 1,
  }, 'permit', { sigunguCd, bjdongCd, bun, ji });

  if (!r.ok) return r;
  if (!r.value.length) return { ok: false, error: '건축인허가 자료 없음 (인허가 이력이 없는 필지)' };

  const rows = r.value.map((x) => {
    const p = {
      pk: x.mgmPmsrgstPk || null,
      // ★ 빈 값이 '' 가 아니라 공백 한 칸으로 오는 필드가 있다. trim 없이 두면
      //   화면에 '( )' 처럼 찍힌다 — 값이 있는 줄 알고 들여다보게 된다.
      name: txt(x.bldNm),
      archType: txt(x.archGbCdNm),            // 신축 / 증축 / 대수선 / 용도변경
      mainUse: txt(x.mainPurpsCdNm),
      totalAreaSqm: num(x.totArea),
      platAreaSqm: num(x.platArea),
      bcRatio: num(x.bcRat),
      vlRatio: num(x.vlRat),
      archPmsDay: day(x.archPmsDay),
      stcnsSchedDay: day(x.stcnsSchedDay),
      realStcnsDay: day(x.realStcnsDay),
      useAprDay: day(x.useAprDay),
    };
    return { ...p, ...permitStage(p) };
  });

  // 최신 인허가가 앞에 오게 한다 (날짜가 없는 건은 뒤로)
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  return {
    ok: true, cached: r.cached, value: rows,
    latest: rows[0],
    count: rows.length,
  };
}

/**
 * 주택인허가 단계 — **건축법이 아니라 주택법 트랙이다.**
 *
 * ★ 30세대 이상 공동주택은 건축허가가 아니라 **사업계획승인**을 받는다.
 *   그래서 건축인허가(ArchPmsHubService)에는 나오지 않는다. 주택 개발 딜에서
 *   "인허가 기록 없음" 으로 보이는 것은 대개 여기를 안 봤기 때문이다.
 *
 *   건축법:  건축허가 → 착공 → 사용승인
 *   주택법:  사업계획승인 → 착공 → 사용검사     ← 이쪽
 */
function housingPermitStage(p) {
  if (p.useInsptDay) return { stage: '사용검사', order: 4, date: p.useInsptDay };
  if (p.stcnsDay) return { stage: '착공', order: 3, date: p.stcnsDay };
  if (p.apprvDay) return { stage: '사업계획승인', order: 2, date: p.apprvDay };
  if (p.stcnsSchedDay) return { stage: '착공예정', order: 1, date: p.stcnsSchedDay };
  return { stage: '미확인', order: 0, date: null };
}

/**
 * 주택인허가 (건축HUB) — 필지의 주택법 인허가 이력.
 * ★ 오퍼레이션명이 `getHpBasisOulnInfo` 다. 서비스는 HsPmsHubService 인데
 *   오퍼레이션 접두사는 Hp 다 — 둘이 어긋나 있어서 이름만으로는 못 맞춘다.
 */
async function housingPermits({ sigunguCd, bjdongCd, bun, ji }) {
  if (!isAvailable()) return unavailable('주택인허가');
  const bad = keyFormatError(); if (bad) return bad;
  if (!sigunguCd || !bjdongCd) return { ok: false, error: '법정동코드 없음' };

  const r = await call('HsPmsHubService/getHpBasisOulnInfo', {
    sigunguCd, bjdongCd, bun, ji, numOfRows: 100, pageNo: 1,
  }, 'hspermit', { sigunguCd, bjdongCd, bun, ji });

  if (!r.ok) return r;
  if (!r.value.length) return { ok: false, error: '주택인허가 자료 없음 (주택법 대상이 아닌 필지)' };

  const rows = r.value.map((x) => {
    const p = {
      pk: x.mgmHsrgstPk || null,
      name: txt(x.bldNm),
      mainUse: txt(x.purpsCdNm),
      structure: txt(x.strctCdNm),
      totalAreaSqm: num(x.totArea),
      // ★ 세대수는 기본개요에 채워지지 않는다 (실측: 전부 0). 0 을 그대로 두면
      //   "0세대" 로 읽혀 자료가 있는 것처럼 보인다. 세대수가 필요하면 동별개요를
      //   따로 불러야 한다 — 여기서는 없는 것으로 둔다.
      households: num(x.totHhldCnt) || null,
      apprvDay: day(x.apprvDay),            // 사업계획승인일
      stcnsSchedDay: day(x.stcnsSchedDay),
      stcnsDay: day(x.stcnsDay),
      useInsptDay: day(x.useInsptDay),      // 사용검사일
      demolition: txt(x.demolExtngGbCdNm),  // 멸실 구분
    };
    return { ...p, ...housingPermitStage(p) };
  });

  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return { ok: true, cached: r.cached, value: rows, latest: rows[0], count: rows.length };
}

module.exports = {
  trades, buildingRegister, buildingPermits, housingPermits,
  permitStage, housingPermitStage,
  isAvailable, keyFormatError, TRADE_ENDPOINTS, toTrade, PROVIDER,
};
