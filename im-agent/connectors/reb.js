'use strict';
/**
 * reb.js — 한국부동산원 R-ONE(부동산통계정보) Connector.
 *
 *   ① 지가지수     지역·월별 지수 (A_2024_00901) — **시점수정은 이쪽**
 *   ② 지가변동률   지역·월별 변동률 (A_2024_00903, 2005-01 ~) — 추이 표시용
 *
 * ★ **또 다른 별개 키다.** data.go.kr 키도, 기상청 API허브 키도 아니다.
 *   reb.or.kr 에서 따로 발급받는다 (`REB_API_KEY`). data.go.kr 키를 넣으면
 *   ERROR-290 만 돌아온다 — 실측 확인.
 *
 * ★ 왜 필요한가: 개별공시지가는 **매년 1월 1일 기준**이다. 8월에 만드는 IM 에
 *   1월 1일 값을 그대로 쓰면 경과 기간만큼 어긋난다. 감정평가 실무는 그 사이를
 *   보정한다(시점수정). 이 값은 **공표 통계라 가정치가 아니다** — 현재
 *   08 Appraisal 에서 유일한 가정인 현실화계수와는 성격이 다르다.
 *
 * ★ 응답이 **오름차순**이다 (첫 행이 2005-01). 이 저장소가 같은 함정에 걸린
 *   네 번째 API 다 — 개별공시지가·토지특성·REC 가 앞의 셋이었다.
 *   조회 기간을 명시해서 애초에 필요한 구간만 받는다.
 */

const { request, buildUrl, redact } = require('./http');
const cache = require('./cache');

const PROVIDER = 'reb';
const BASE = 'https://www.reb.or.kr/r-one/openapi';

/** (월) 지역별 지가변동률 — 월별 변동 폭. 추이를 보여 줄 때 쓴다. */
const TBL_LAND_PRICE = { id: 'A_2024_00903', cycle: 'MM', item: 100001 };

/**
 * (월) 지역별 **지가지수** — 시점수정은 이쪽을 쓴다.
 *
 * ★ 왜 변동률이 아니라 지수인가: 변동률을 곱해 누적하면 **구간 경계에서 한 달을
 *   더 세기 쉽다.** 실제로 그렇게 했다가 틀렸다 (2026-08-16 발견).
 *   `202601` 변동률은 2025-12 → 2026-01 구간인데, 공시지가 기준일은 2026-01-01
 *   이라 그 구간은 기준일 **이전**이다. 그걸 포함해 +2.28% 로 계산했고,
 *   지수 비로 낸 정답은 +1.94% 였다 — 0.34%p 과대였다.
 *
 *   지수는 경계가 값 자체에 박혀 있어 그런 실수가 생기지 않는다.
 *   시점수정 계수 = 지수(평가시점) ÷ 지수(공시기준월).
 */
const TBL_LAND_INDEX = { id: 'A_2024_00901', cycle: 'MM', item: null };

/** 전국 */
const CLS_NATIONWIDE = 500001;

/** 한 번에 받는 행수. 지역 색인을 만들 때 페이지 수를 좌우한다. */
const PAGE_SIZE = 1000;

function apiKey() {
  return (process.env.REB_API_KEY || '').trim();
}

function isAvailable() {
  return Boolean(apiKey());
}

function unavailable(what) {
  return { ok: false, error: `REB_API_KEY 미설정 — ${what} 조회 생략`, unavailable: true };
}

/**
 * 한 페이지 조회.
 * R-ONE 은 오류를 최상위 `RESULT` 로, 정상을 `SttsApiTblData` 로 준다.
 */
async function page(params) {
  const url = buildUrl(`${BASE}/SttsApiTblData.do`, { Type: 'json', KEY: apiKey(), ...params });
  const r = await request(url);
  if (!r.ok) return { ok: false, error: redact(r.error) };

  let body;
  try {
    body = JSON.parse(r.body);
  } catch (_) {
    return { ok: false, error: 'JSON 이 아닌 응답' };
  }

  if (body.RESULT) {
    return { ok: false, error: redact(`${body.RESULT.MESSAGE} (${body.RESULT.CODE})`) };
  }
  const blocks = body.SttsApiTblData || [];
  const head = blocks[0]?.head || [];
  const total = head[0]?.list_total_count ?? 0;
  const rows = blocks[1]?.row || [];
  return { ok: true, total, rows };
}

/**
 * 지가변동률 — 지역·기간별 월간 변동률(%).
 *
 * @param {object} opts
 * @param {number|string} [opts.clsId] 지역코드. 생략하면 전국.
 * @param {string} opts.from YYYYMM
 * @param {string} opts.to   YYYYMM
 */
async function landPriceChange({ clsId = CLS_NATIONWIDE, from, to } = {}) {
  if (!isAvailable()) return unavailable('지가변동률');
  if (!from || !to) return { ok: false, error: '조회 기간(from, to) 이 필요하다' };

  return cache.through(PROVIDER, 'landchange', { clsId, from, to }, async () => {
    const r = await page({
      STATBL_ID: TBL_LAND_PRICE.id,
      DTACYCLE_CD: TBL_LAND_PRICE.cycle,
      CLS_ID: clsId,
      ITM_ID: TBL_LAND_PRICE.item,
      START_WRTTIME: from,
      END_WRTTIME: to,
      pIndex: 1,
      pSize: PAGE_SIZE,
    });
    if (!r.ok) return r;

    const rows = r.rows
      .map(x => ({
        month: String(x.WRTTIME_IDTFR_ID || ''),
        region: x.CLS_FULLNM || x.CLS_NM || null,
        clsId: x.CLS_ID,
        rate: Number(x.DTA_VAL),
        label: x.WRTTIME_DESC || null,
      }))
      .filter(x => /^\d{6}$/.test(x.month) && Number.isFinite(x.rate))
      .sort((a, b) => (a.month < b.month ? -1 : 1));

    if (!rows.length) return { ok: false, error: `지가변동률 자료 없음 (지역 ${clsId}, ${from}~${to})` };
    return { ok: true, value: rows };
  }, { ttl: 30 * 86400 });
}

/** 지가지수 — 지역·기간별 월간 지수 */
async function landIndex({ clsId = CLS_NATIONWIDE, from, to } = {}) {
  if (!isAvailable()) return unavailable('지가지수');
  if (!from || !to) return { ok: false, error: '조회 기간(from, to) 이 필요하다' };

  return cache.through(PROVIDER, 'landindex', { clsId, from, to }, async () => {
    const r = await page({
      STATBL_ID: TBL_LAND_INDEX.id,
      DTACYCLE_CD: TBL_LAND_INDEX.cycle,
      CLS_ID: clsId,
      START_WRTTIME: from,
      END_WRTTIME: to,
      pIndex: 1,
      pSize: PAGE_SIZE,
    });
    if (!r.ok) return r;

    const rows = r.rows
      .map(x => ({
        month: String(x.WRTTIME_IDTFR_ID || ''),
        region: x.CLS_FULLNM || x.CLS_NM || null,
        index: Number(x.DTA_VAL),
      }))
      .filter(x => /^\d{6}$/.test(x.month) && Number.isFinite(x.index) && x.index > 0)
      .sort((a, b) => (a.month < b.month ? -1 : 1));

    if (!rows.length) return { ok: false, error: `지가지수 자료 없음 (지역 ${clsId}, ${from}~${to})` };
    return { ok: true, value: rows };
  }, { ttl: 30 * 86400 });
}

/**
 * 시점수정 계수 — 공시지가 기준월 대비 평가시점의 지가지수 비.
 *
 * ★ **지수의 비로 낸다.** 월별 변동률을 곱해 쌓는 방식은 구간 경계에서 한 달을
 *   더 세기 쉽고, 실제로 그렇게 틀렸다 (TBL_LAND_INDEX 주석 참고).
 *
 * ★ 기준월의 지수를 자료에서 직접 읽는다. "기준시점 2026.01 = 100" 이라고
 *   100 을 상수로 박지 않는다 — 지수는 주기적으로 재기준화되고, 그때 공시지가
 *   기준연도와 어긋나면 100 이 아니다.
 *
 * @param {string} from 공시지가 기준월 (YYYYMM, 보통 `${고시연도}01`)
 * @param {string} to   평가시점 (YYYYMM)
 * @returns factor 는 공시지가에 곱할 계수 (1.0 이면 변동 없음)
 */
async function timeAdjustment({ clsId = CLS_NATIONWIDE, from, to, expectRegion = null } = {}) {
  const r = await landIndex({ clsId, from, to });
  if (!r.ok) return r;

  const rows = r.value;
  const base = rows[0];
  const last = rows[rows.length - 1];

  if (base.month !== from) {
    return { ok: false, error: `공시지가 기준월(${from})의 지가지수가 없다 — 시점수정 불가` };
  }

  // ★ 고른 지역과 실제로 조회된 지역이 같은지 대조한다.
  //   통계표마다 지역코드 체계가 달라, 다른 표의 색인을 쓰면 엉뚱한 지역 지수로
  //   보정하고도 값이 그럴듯해 아무도 모른다 (2026-08-16 실제 발생).
  //   틀리면 **적용하지 않는다** — 잘못 보정하느니 안 하는 편이 낫다.
  if (expectRegion && base.region && base.region !== expectRegion) {
    return {
      ok: false,
      error: `지역이 어긋난다 — '${expectRegion}' 를 고랐는데 지가지수는 `
        + `'${base.region}' 를 돌려줬다 (CLS_ID ${clsId}). 통계표별 지역코드 체계 확인 필요`,
    };
  }

  const factor = last.index / base.index;

  return {
    ok: true,
    cached: r.cached,
    value: {
      clsId,
      region: base.region,
      from: base.month,
      to: last.month,
      months: rows.length - 1,          // 기준월은 경과 개월에 세지 않는다
      baseIndex: base.index,
      lastIndex: last.index,
      factor: Math.round(factor * 1e6) / 1e6,
      percent: Math.round((factor - 1) * 1000) / 10,
      monthly: rows,
    },
  };
}

/**
 * 지역 색인 — CLS_FULLNM → CLS_ID.
 *
 * ★ **통계표마다 지역코드 체계가 다르다.** 같은 `CLS_ID=510088` 이
 *   변동률표(A_2024_00903)에서는 `인천>남동구`, 지수표(A_2024_00901)에서는
 *   `울산>북구` 다 — 실측 확인(2026-08-16). 한쪽 표로 만든 색인을 다른 표에
 *   쓰면 **엉뚱한 지역 값으로 보정하고도 결과가 그럴듯해 아무도 모른다.**
 *   실제로 그렇게 한 번 나갔다.
 *
 *   그래서 색인은 **조회할 표와 같은 표에서** 만든다. `table` 인자를 필수로 둔다.
 *
 * ★ 한 달치 전량을 받아 만든다(약 10,700건, 페이지 11회). 지역코드는 거의
 *   변하지 않으므로 180일 캐시한다 — 프로젝트마다 다시 받지 않는다.
 * ★ **시도>시군구 2단계만 남긴다.** 읍면동까지 두면 "중구"처럼 흔한 이름이
 *   여러 시도에서 겹쳐 잘못 매칭된다.
 */
async function regionIndex(month, table = TBL_LAND_INDEX) {
  if (!isAvailable()) return unavailable('지역 색인');

  return cache.through(PROVIDER, 'regionindex', { month, table: table.id }, async () => {
    const out = [];
    let total = null;

    for (let p = 1; p <= 20; p++) {
      const r = await page({
        STATBL_ID: table.id,
        DTACYCLE_CD: table.cycle,
        ITM_ID: table.item,
        START_WRTTIME: month,
        END_WRTTIME: month,
        pIndex: p,
        pSize: PAGE_SIZE,
      });
      if (!r.ok) return r;
      if (total === null) total = r.total;

      for (const x of r.rows) {
        const full = x.CLS_FULLNM;
        if (!full) continue;
        const parts = full.split('>');
        if (parts.length !== 2) continue;     // 시도>시군구 만
        out.push({ clsId: x.CLS_ID, full, sido: parts[0], sigungu: parts[1] });
      }
      if (!r.rows.length || p * PAGE_SIZE >= total) break;
    }

    if (!out.length) return { ok: false, error: '지역 색인을 만들지 못했다' };
    return { ok: true, value: out };
  }, { ttl: 180 * 86400 });
}

/**
 * 주소에서 지역코드를 찾는다.
 *
 * ★ **못 찾으면 전국으로 조용히 대체하지 않는다.** 전국 변동률로 시점수정하면
 *   지역 편차가 통째로 사라지는데 문서에는 "시점수정 적용"만 남는다.
 *   찾지 못했다는 사실을 그대로 돌려준다 — 판단은 호출자가 한다.
 *
 * @param {string} address 예: '서울특별시 중구 세종대로 110'
 */
async function resolveRegion(address, month, table = TBL_LAND_INDEX) {
  if (!address) return { ok: false, error: '주소 없음' };

  const idx = await regionIndex(month, table);
  if (!idx.ok) return idx;

  // '서울특별시' → '서울', '경기도' → '경기' 로 줄여 맞춘다 (R-ONE 표기가 축약형이다)
  const addr = String(address).replace(/\s+/g, ' ').trim();
  const hits = idx.value.filter(r => {
    const sidoShort = r.sido.replace(/(특별자치)?(시|도)$/, '');
    return addr.includes(r.sigungu) && (addr.includes(r.sido) || addr.includes(sidoShort));
  });

  if (!hits.length) return { ok: false, error: `주소에서 지역을 특정하지 못했다: ${addr}` };
  // 시군구명이 긴 쪽이 더 구체적이다 ('수원시 장안구' vs '중구')
  hits.sort((a, b) => b.sigungu.length - a.sigungu.length);
  return { ok: true, cached: idx.cached, value: hits[0], candidates: hits.length };
}

module.exports = {
  landPriceChange, landIndex, timeAdjustment, regionIndex, resolveRegion,
  isAvailable, TBL_LAND_PRICE, TBL_LAND_INDEX, CLS_NATIONWIDE, PROVIDER,
};
