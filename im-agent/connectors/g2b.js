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

/**
 * ★ 쿼터 버킷은 **키 단위로 묶는다.** 한동안 `'data.go.kr(조달청)'` 으로 따로
 *   세고 있었는데, data.go.kr 의 일 10,000건 한도는 API 별이 아니라 **인증키
 *   전체**에 걸린다. 버킷을 쪼개면 각각 10,000 까지 세어 실제로는 두 배를 쓰고도
 *   한도에 안 걸린 것으로 보인다 — 소진은 조회 실패로만 나타나고, 그때는 이미
 *   그날 치가 없다.
 
 * ★★ **정정 〈2026-08-23 실측 · D-85〉** — 「일 10,000건이 인증키 전체에 걸린다」는
 *   틀렸다. data.go.kr 활용신청 화면은 **상세기능(오퍼레이션)마다** 일일 트래픽을
 *   적어 주고, 개발계정은 **1,000건**이다. 그래서 쿼터 통을 `data.go.kr:<갈래>` 로
 *   나눴다 (`cache.js` 의 `FAMILY_QUOTA`).
 */
/* ★ 쿼터 통을 **갈래로 나눈다** 〈2026-08-23 · D-85〉. data.go.kr 은 상세기능마다
   하루치를 세는데(개발계정 1,000), 앞 판은 아홉 커넥터가 `data.go.kr` 한 통을
   같이 썼다 — 한 곳이 다 쓰면 나머지 여덟이 함께 막힌다. `cache.js` 참고. */
const PROVIDER = 'data.go.kr:g2b';
const BASE = 'https://apis.data.go.kr/1230000';

/**
 * 쓰는 오퍼레이션.
 * ★ 이름을 이 파일 밖에 적지 않는다 — 두 곳에 두면 한쪽만 고치는 날 갈린다.
 */
const OPS = {
  /**
   * 공사 **낙찰된 목록 현황**.
   *
   * ★★★ **여기까지 오는 데 세 번 갈렸다** 〈2026-08-22~23 실측〉:
   *
   *   1) `ao/ScsbidInfoService/…`            → 코드 12 (없거나 폐기됨)
   *   2) `as/ScsbidInfoService/…`            → 코드 30 → 403 (활용신청 안 됨)
   *   3) `as/…/getOpengResultListInfoCnstwkPPSSrch` → **200 인데 금액이 하나도 없다**
   *
   *   셋째가 가장 고약했다. 권한도 경로도 맞고 `resultCode 00` 인데, 그 응답은
   *   「개찰이 있었다」는 사실만 준다 — 금액도 낙찰률도 없다. **기간을 넓혀도
   *   안 나온다.** 오퍼레이션이 다른 것이었다.
   *
   * ★ 지금 것은 실측으로 고른 것이다:
   *     sucsfbidAmt = 67171559 · sucsfbidRate = 90.089
   *   **낙찰률을 API 가 직접 준다.** 그래서 우리가 나누지 않는다 — 분모로 무엇을
   *   쓸지 고를 일 자체가 없어진다 (기초금액이 이 응답에 없다는 점도 함께 해결).
   */
  award: {
    path: 'as/ScsbidInfoService/getScsbidListSttusCnstwkPPSSrch',
    label: '공사 낙찰현황',
  },
  /** 공사 입찰공고 목록 — 기초금액·공고명·지역이 여기 실린다 */
  notice: {
    path: 'ad/BidPublicInfoService/getBidPblancListInfoCnstwkPPSSrch',
    label: '공사 입찰공고',
  },
};

/**
 * 응답이 주는 낙찰률. **문자열로 온다** (예: `"90.089"`).
 * ★ 빈 문자열·`0` 을 「없다」와 섞지 않는다 — 0% 낙찰은 없지만, 빈 값을 0 으로
 *   세면 중앙값이 조용히 내려앉는다 (§4.7 결측을 0 으로 세지 않는다).
 */
function rate(x) {
  const v = x.sucsfbidRate ?? x.sucsfbidrate;
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

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
    /* ★★★ **추정가격으로 기초금액을 메우지 않는다** 〈2026-08-23 실측〉.
     *
     *   앞 판은 `bssamt ?? bsisAmt ?? presmptPrce` 였다. 그런데 셋은 **다른 값**이다:
     *
     *     기초금액(bssamt)   = 예정가격을 정하는 기준. **부가세가 들어 있다**
     *     추정가격(presmptPrce) = 부가세·관급자재를 **뺀** 값
     *
     *   ★ 낙찰률은 `낙찰금액 ÷ 기초금액` 이다. 분모에 추정가격을 넣으면 **분모가
     *     작아져 낙찰률이 부풀려진다** — 부가세 몫만 해도 10%p 가까이 뛴다.
     *     그리고 **그 값은 그럴듯하게 나온다.** 출처 표시도 멀쩡하다.
     *
     *   ★ 그래서 기초금액이 없으면 **낙찰률을 내지 않는다** (§4.9 — 대체값으로
     *     메우면 「적용됨」만 남고 무엇이 빠졌는지 사라진다). 낙찰금액 자체는
     *     그대로 낸다 — 그건 이 응답에 실려 있다.
     *
     *   ★ 2026-08-23 실측으로 확인한 것: **입찰공고 서비스 응답에는
     *     `bssamt`·`bsisAmt` 가 아예 없다**(추정가격·예산금액·관급자재금액만 있다).
     *     기초금액은 **개찰결과 서비스** 응답에서 와야 한다. 그 서비스는 아직
     *     활용신청 전이라(403) 필드 이름을 실측하지 못했다 — 열리면 확인한다. */
    const base = toEok(x.bssamt ?? x.bsisAmt);
    /* ★★★ **`opengCorpInfo` 를 금액 자리에서 뺐다** 〈2026-08-23 실측〉.
     *   그것은 **개찰업체 정보**(문자열)다. 금액 대체값으로 세워 두면 숫자가
     *   아닌 것이 분자로 들어갈 길이 생긴다 — 지금은 `toEok` 이 걸러 주지만
     *   **걸러 준다는 사실에 기대는 배선**은 다음에 바뀌면 조용히 샌다. */
    const award = toEok(x.sucsfbidAmt ?? x.sucsfbidamt);
    return {
      /* ★★★ 아래 이름은 **실측으로 확인한 것**이다 〈2026-08-23 · 한 건 전체를 떠서 대조〉.
       *   `getScsbidListSttusCnstwkPPSSrch` 한 건이 실제로 이렇게 온다:
       *
       *     bidNtceNo bidNtceOrd bidClsfcNo rbidNo ntceDivCd bidNtceNm prtcptCnum
       *     bidwinnrNm bidwinnrBizno bidwinnrCeoNm bidwinnrAdrs bidwinnrTelNo
       *     sucsfbidAmt sucsfbidRate rlOpengDt dminsttCd dminsttNm rgstDt
       *     fnlSucsfDate fnlSucsfCorpOfcl
       *
       *   ★ 앞 판은 낙찰업체를 `opengCorpNm ?? sucsfbidCorpNm` 에서 찾았다.
       *     **둘 다 없는 이름**이라 업체명이 늘 빈칸으로 나갔다 — 빈칸은 오류가
       *     안 나므로 화면만 봐서는 안 잡힌다. 실제 이름은 `bidwinnrNm` 이다.
       *   ★ `opengDt` 도 이 응답엔 없다(`rlOpengDt` 가 실개찰일시다). 대체 이름은
       *     **뒤로 물리되 지우지는 않는다** — 다른 오퍼레이션에서 쓰일 수 있다. */
      title: txt(x.bidNtceNm ?? x.ntceNm),
      agency: txt(x.dminsttNm ?? x.ntceInsttNm),
      date: txt(x.rlOpengDt ?? x.opengDt ?? x.fnlSucsfDate ?? x.bidNtceDt),
      baseEok: base,
      awardEok: award,
      /* ★★★ **낙찰률은 받아 쓴다. 우리가 나누지 않는다** 〈2026-08-23 실측〉.
       *   응답에 `sucsfbidRate` 가 실려 온다(예: 90.089). 조달청이 계산한 값이므로
       *   **분모를 우리가 고를 일이 없다** — 기초금액이냐 추정가격이냐로 헤맨
       *   자리가 통째로 사라진다 (D-85).
       *   ★ 나눗셈은 **받아 오지 못했을 때만** 한다. 그때도 분모는 기초금액뿐이고,
       *     그것도 없으면 낙찰률을 내지 않는다 (§4.9 — 대체값으로 메우지 않는다). */
      awardRate: rate(x) ?? ((base && award) ? Math.round((award / base) * 1000) / 10 : null),
      // 낙찰률을 어디서 얻었는지 — 출처가 다르면 그 사실이 값과 함께 다녀야 한다 (§4.7)
      rateFrom: rate(x) !== null ? 'api' : ((base && award) ? 'computed' : null),
      winner: txt(x.bidwinnrNm ?? x.opengCorpNm ?? x.sucsfbidCorpNm),
    };
  }).filter((x) => {
    if (!x.awardEok || x.awardEok < minEok) return false;
    /* ★ 지역은 **공고명·수요기관**으로만 거른다. 응답에 `bidwinnrAdrs`(낙찰업체
       주소)도 있지만 그건 **업체가 어디 회사인가**이지 공사가 어디인가가 아니다.
       서울 업체가 여수 공사를 따는 일이 흔하다 — 넣으면 엉뚱한 건이 걸린다. */
    if (o.region && !(`${x.title || ''} ${x.agency || ''}`).includes(o.region)) return false;
    if (o.keyword && !(x.title || '').includes(o.keyword)) return false;
    return true;
  });

  // ★ 정렬을 직접 한다. 이 계열은 오래된 것부터 주는 경우가 있고,
  //   앞에서부터 집으면 몇 년 전 낙찰가를 최신값으로 쓰게 된다 (§4.4)
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  if (!rows.length) {
    /* ★★★ **「건이 없다」와 「금액이 없다」를 가른다** 〈2026-08-23 실측〉.
     *
     *   앞 판은 둘을 한 문장으로 뭉쳐 「조건을 넓히거나 응답 필드명을 확인」이라고
     *   했다. 그러면 사람은 **기간부터 넓힌다** — 그쪽이 만만하기 때문이다.
     *   그런데 2026-08-23 실측에서 나온 것은 이랬다: 응답은 왔고(`resultCode 00`)
     *   건도 있는데, **그 응답에 금액 필드가 하나도 없다.**
     *
     *     필드: bidNtceNo bidNtceOrd bidClsfcNo rbidNo bidNtceNm opengDt
     *           prtcptCnum opengCorpInfo progrsDivCdNm inptDt
     *           rsrvtnPrceFileExistnceYn ntceInsttCd ntceInsttNm dminsttCd
     *           dminsttNm opengRsltNtcCntnts
     *
     *   기간을 아무리 넓혀도 금액은 안 나온다. **오퍼레이션이 다른 것**이다.
     *   ★ 그래서 「받은 건은 있었는가」를 세어 두 경우를 갈라 말한다.
     */
    const got = (r.value || []).length;
    const withAmount = (r.value || []).filter((x) => toEok(x.sucsfbidAmt ?? x.sucsfbidamt) || rate(x)).length;
    if (got && !withAmount) {
      return {
        ok: false, window: w, count: 0, fieldMismatch: true,
        error: `조회는 됐고 ${got}건을 받았는데 **금액 필드가 하나도 없다** `
          + `(받은 필드: ${Object.keys(r.value[0] || {}).join(' ')}). `
          + '기간을 넓혀도 안 나온다 — 이 오퍼레이션에 낙찰금액이 실리지 않는 것이므로 '
          + '오퍼레이션이 다른 것이다 — 2026-08-23 에 `getOpengResultListInfoCnstwkPPSSrch` 가 '
          + '정확히 이랬다 (등록부 D-85)',
      };
    }
    /* ★★★ **거르는 데 쓰는 칸이 비어 있으면 그렇다고 말한다** 〈2026-08-23〉.
     *   지역·키워드는 `title`·`agency` 안에서 부분일치로 거른다. 그 두 칸이
     *   **전부 비어 있으면 무엇을 넣어도 0건**이 되는데, 증상은 「조건에 맞는
     *   건이 없다」와 똑같다. 그러면 사람은 조건을 넓히다가 시간을 버린다 —
     *   실제 원인은 **필드 이름이 달라 값이 안 들어온 것**이다. */
    if (got && (o.region || o.keyword)) {
      const named = (r.value || []).filter((x) => txt(x.bidNtceNm ?? x.ntceNm)
        || txt(x.dminsttNm ?? x.ntceInsttNm)).length;
      if (!named) {
        return {
          ok: false, window: w, count: 0, fieldMismatch: true,
          error: `${got}건을 받았는데 **공고명·수요기관이 전부 비어 있다** `
            + `(받은 필드: ${Object.keys(r.value[0] || {}).join(' ')}). `
            + '지역·키워드는 그 두 칸으로 거르므로 무엇을 넣어도 0건이 된다 — '
            + '조건이 아니라 **필드 이름**을 봐야 한다',
        };
      }
    }
    return {
      ok: false, window: w, count: 0,
      error: `조회는 됐지만 조건에 맞는 낙찰 건이 없다 (기간 ${w.from.slice(0, 8)}~${w.to.slice(0, 8)}`
        + `${o.region ? ` · 지역 ${o.region}` : ''}${o.keyword ? ` · ${o.keyword}` : ''}`
        + ` · ${minEok}억 이상). 조건을 넓혀 본다`,
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
    /* ★ **왜 못 냈는지를 값 옆에 붙인다** 〈2026-08-23〉. `medianRate: null` 만
       두면 「0 이다」와 「못 냈다」가 화면에서 같아 보인다 (§4.7). */
    rateReason: rates.length ? null
      : '응답에 기초금액(bssamt)이 없어 낙찰률을 내지 않았다 — 추정가격으로 대신 '
        + '나누면 분모가 작아져 낙찰률이 부풀려진다',
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
