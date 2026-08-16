'use strict';
/**
 * g2b.js — 조달청 나라장터(G2B) 공사 **낙찰 정보** Connector.
 *
 * 무엇에 쓰는가: 시공비 가정을 대조할 **독립된 두 번째 출처**다.
 * 사업계획서가 적은 공사비가 같은 지역·같은 시기의 실제 낙찰금액과 얼마나
 * 떨어져 있는지 보여 준다. 값을 대신 만들어 주는 것이 아니다 (§4).
 *
 * ★ **㎡당 단가를 자동으로 만들지 않는다.**
 *   낙찰금액은 공사 한 건의 총액이고, 공고에 연면적이 실려 있지 않은 경우가
 *   대부분이다. 총액을 아무 면적으로 나누면 「출처 있는 금액 ÷ 짐작한 면적」이
 *   되는데, 결과는 그럴듯한 ㎡당 단가로 보인다 — 문서만 봐서는 안 잡힌다.
 *   그래서 **금액·낙찰률·모수까지만** 내고 나눗셈은 사람이 한다 (§4.8).
 *
 * ★ **낙찰률은 낸다.** 낙찰금액 ÷ 기초금액은 출처 있는 두 값의 비이고
 *   가정계수가 하나도 안 들어간다. 예정가격 대비 실제 낙찰 수준이
 *   공사비 가정의 현실성을 재는 가장 곧은 잣대다.
 *
 * ★ **평균이 아니라 중앙값을 쓴다.** 관급공사는 금액 분포가 크게 벌어져
 *   (몇백만 원 보수공사와 수백억 신축이 한 목록에 섞인다) 평균은 한 건에
 *   끌려간다. 중앙값과 함께 **모수(건수)와 조회 기간**을 반드시 남긴다 (§4.7).
 *
 * ★ **조회 기간을 명시한다.** 이 계열 API 는 정렬 방향이 문서에 없고
 *   실제로 오래된 것부터 주는 경우가 있다 (§4.4). 앞에서부터 집으면 몇 년 전
 *   낙찰가를 최신값으로 쓰게 되고, 출처 표시는 멀쩡하다. 받은 뒤 **직접 정렬**한다.
 *
 * ⚠️ **엔드포인트·응답 필드는 아직 실제 키로 검증되지 않았다** (등록부 D-36).
 *    공식 문서 기준으로 작성했고, `npm run im:smoke` 에 항목을 넣어 두었다.
 *    다르면 조회는 성공하는데 값이 전부 비고 화면에는 아무 경고도 안 뜬다 —
 *    그래서 값이 하나도 안 잡히면 `ok:false` 로 사유를 남긴다 (§4.3).
 *
 * 인증키: DATA_GO_KR_KEY — data.go.kr 의 **Decoding(일반)** 인증키.
 *         활용신청은 API 하나하나에 따로 해야 한다 (§4.2).
 */

const { request, buildUrl, redact, looksUrlEncoded } = require('./http');
const cache = require('./cache');
const { normalize, num } = require('./xml');

const PROVIDER = 'data.go.kr(조달청)';
const BASE = 'https://apis.data.go.kr/1230000';

/**
 * 쓰는 오퍼레이션.
 * ★ 이름을 이 파일 밖에 적지 않는다 — 두 곳에 두면 한쪽만 고치는 날 갈린다.
 */
const OPS = {
  /** 공사 개찰(낙찰) 결과 목록 */
  award: {
    path: 'ao/ScsbidInfoService/getOpengResultListInfoCnstwkPPSSrch',
    label: '공사 개찰결과',
  },
  /** 공사 입찰공고 목록 — 기초금액·공고명·지역이 여기 실린다 */
  notice: {
    path: 'ad/BidPublicInfoService/getBidPblancListInfoCnstwkPPSSrch',
    label: '공사 입찰공고',
  },
};

function apiKey() {
  return process.env.DATA_GO_KR_KEY || '';
}

function isAvailable() {
  return Boolean(apiKey());
}

/** Encoding 키를 넣었으면 **부르기 전에** 막는다 (molit.js 와 같은 이유) */
function keyFormatError() {
  if (!looksUrlEncoded(apiKey())) return null;
  return {
    ok: false, unavailable: true,
    error: 'DATA_GO_KR_KEY 가 Encoding 인증키다 — data.go.kr 마이페이지에서 '
      + 'Decoding(일반) 인증키를 복사해 넣어야 한다',
  };
}

function unavailable(what) {
  return { ok: false, error: `DATA_GO_KR_KEY 미설정 — ${what} 조회 생략`, unavailable: true };
}

/** 'YYYYMMDDHHmm' — 이 계열은 분 단위까지 요구한다 */
function stamp(d, endOfDay) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}${endOfDay ? '2359' : '0000'}`;
}

/**
 * 조회 구간. **기본 12개월** — 짧으면 표본이 몇 건뿐이라 중앙값이 흔들리고,
 * 길면 물가 변동이 섞여 같은 공사끼리 비교가 안 된다.
 */
function windowOf(months, now) {
  const to = now instanceof Date ? new Date(now.getTime()) : new Date();
  const from = new Date(to.getTime());
  from.setUTCMonth(from.getUTCMonth() - Math.max(1, months || 12));
  return { from: stamp(from, false), to: stamp(to, true) };
}

async function call(op, params, cacheParams) {
  return cache.through(PROVIDER, op.path, cacheParams, async () => {
    const url = buildUrl(`${BASE}/${op.path}`, {
      ...params, serviceKey: apiKey(), type: 'json', numOfRows: params.numOfRows || 100, pageNo: 1,
    });
    const r = await request(url);
    if (!r.ok) return { ok: false, error: redact(r.error) };
    const parsed = normalize(r.body);
    if (!parsed.ok) return { ok: false, error: redact(parsed.error) };
    return { ok: true, value: parsed.items, totalCount: parsed.totalCount };
  });
}

/** 중앙값. 짝수 개면 가운데 둘의 평균 — 짝수라고 한쪽으로 치우치게 두지 않는다 */
function median(list) {
  const a = list.filter(x => Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function txt(v) {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s;
}

/** 원 → 억원. 이 저장소의 금액 단위는 억원 하나다 */
function toEok(won) {
  const n = num(won);
  return Number.isFinite(n) ? Math.round((n / 1e8) * 1e6) / 1e6 : null;
}

/**
 * 공사 낙찰 실적.
 *
 * @param {object} opt
 *   region   지역명 (예: '인천') — 공고명·수요기관에 섞여 있어 **부분일치로 거른다**
 *   months   조회 개월 수 (기본 12)
 *   keyword  공고명에 들어가야 할 말 (예: '물류창고')
 *   minEok   이 금액 미만은 뺀다 (기본 10억) — 소액 보수공사가 섞이면 중앙값이 무너진다
 * @returns {{ok, value, count, window, error}}
 */
async function awards(opt) {
  const o = opt || {};
  if (!isAvailable()) return unavailable('조달청 낙찰');
  const bad = keyFormatError();
  if (bad) return bad;

  const w = windowOf(o.months, o.now);
  const params = {
    inqryDiv: '1',
    inqryBgnDt: w.from,
    inqryEndDt: w.to,
    numOfRows: 100,
  };
  const r = await call(OPS.award, params, { ...params, region: o.region || '', keyword: o.keyword || '' });
  if (!r.ok) return { ok: false, error: r.error, window: w };

  const minEok = o.minEok === undefined ? 10 : o.minEok;
  const rows = (r.value || []).map((x) => {
    const base = toEok(x.bssamt ?? x.bsisAmt ?? x.presmptPrce);
    const award = toEok(x.sucsfbidAmt ?? x.opengCorpInfo ?? x.sucsfbidamt);
    return {
      title: txt(x.bidNtceNm ?? x.ntceNm),
      agency: txt(x.dminsttNm ?? x.ntceInsttNm),
      date: txt(x.opengDt ?? x.rlOpengDt ?? x.bidNtceDt),
      baseEok: base,
      awardEok: award,
      // 낙찰률 = 낙찰금액 ÷ 기초금액. 출처 있는 두 값의 비라 가정이 없다
      awardRate: (base && award) ? Math.round((award / base) * 1000) / 10 : null,
      winner: txt(x.opengCorpNm ?? x.sucsfbidCorpNm),
    };
  }).filter((x) => {
    if (!x.awardEok || x.awardEok < minEok) return false;
    if (o.region && !(`${x.title || ''} ${x.agency || ''}`).includes(o.region)) return false;
    if (o.keyword && !(x.title || '').includes(o.keyword)) return false;
    return true;
  });

  // ★ 정렬을 직접 한다. 이 계열은 오래된 것부터 주는 경우가 있고,
  //   앞에서부터 집으면 몇 년 전 낙찰가를 최신값으로 쓰게 된다 (§4.4)
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  if (!rows.length) {
    return {
      ok: false, window: w, count: 0,
      error: `조회는 됐지만 조건에 맞는 낙찰 건이 없다 (기간 ${w.from.slice(0, 8)}~${w.to.slice(0, 8)}`
        + `${o.region ? ` · 지역 ${o.region}` : ''}${o.keyword ? ` · ${o.keyword}` : ''}`
        + ` · ${minEok}억 이상). 조건을 넓히거나 응답 필드명을 확인해야 한다`,
    };
  }

  return {
    ok: true, cached: r.cached, value: rows, count: rows.length, window: w,
  };
}

/**
 * 대조용 요약. **여기까지가 근거 있는 값이다** — ㎡당 단가로 나누지 않는다.
 *
 * @returns {{ok, medianAwardEok, medianRate, count, period, note}}
 */
async function benchmark(opt) {
  const r = await awards(opt);
  if (!r.ok) return r;

  const amounts = r.value.map(x => x.awardEok);
  const rates = r.value.map(x => x.awardRate).filter(x => Number.isFinite(x));
  const period = `${r.window.from.slice(0, 4)}-${r.window.from.slice(4, 6)}~`
    + `${r.window.to.slice(0, 4)}-${r.window.to.slice(4, 6)}`;

  return {
    ok: true,
    cached: r.cached,
    medianAwardEok: median(amounts),
    medianRate: rates.length ? Math.round(median(rates) * 10) / 10 : null,
    rateCount: rates.length,
    count: r.count,
    period,
    latest: r.value[0],
    // ★ 모수와 기간을 값과 함께 들고 다닌다. 떼어 놓으면 「47억」만 남고
    //   그게 몇 건 중 중앙값인지 사라진다 (§4.7)
    source: {
      provider: '조달청 나라장터',
      label: `공사 낙찰금액 중앙값 (${period} · ${r.count}건)`,
      note: '관급공사 낙찰 실적이다. 민간 공사비와 발주 조건·설계 수준이 달라 '
        + '그대로 옮겨 쓸 수 없고, 사업계획서의 공사비를 대조하는 데 쓴다',
    },
    // ㎡당 단가는 만들지 않는다 — 공고에 연면적이 없다
    unitPrice: null,
    unitPriceReason: '낙찰금액은 공사 한 건의 총액이고 공고에 연면적이 실리지 않는다. '
      + '㎡당 단가로 나누려면 면적을 짐작해야 하므로 자동으로 내지 않는다',
  };
}

module.exports = {
  awards, benchmark, isAvailable, keyFormatError,
  median, windowOf, toEok, OPS, PROVIDER, BASE,
};
