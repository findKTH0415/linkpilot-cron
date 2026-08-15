'use strict';
/**
 * reb.js — 한국부동산원 R-ONE(부동산통계정보) Connector.
 *
 *   ① 지가변동률   지역·월별 변동률 (A_2024_00903, 2005-01 ~)
 *
 * ★ **또 다른 별개 키다.** data.go.kr 키도, 기상청 API허브 키도 아니다.
 *   reb.or.kr 에서 따로 발급받는다 (`REB_API_KEY`). data.go.kr 키를 넣으면
 *   ERROR-290 만 돌아온다 — 실측 확인.
 *
 * ★ 왜 필요한가: 개별공시지가는 **매년 1월 1일 기준**이다. 8월에 만드는 IM 에
 *   1월 1일 값을 그대로 쓰면 경과 기간만큼 어긋난다. 감정평가 실무는 그 사이를
 *   지가변동률로 보정한다(시점수정). 이 값은 **공표 통계라 가정치가 아니다** —
 *   현재 08 Appraisal 에서 유일한 가정인 현실화계수와는 성격이 다르다.
 *
 * ★ 응답이 **오름차순**이다 (첫 행이 2005-01). 이 저장소가 같은 함정에 걸린
 *   네 번째 API 다 — 개별공시지가·토지특성·REC 가 앞의 셋이었다.
 *   조회 기간을 명시해서 애초에 필요한 구간만 받는다.
 */

const { request, buildUrl, redact } = require('./http');
const cache = require('./cache');

const PROVIDER = 'reb';
const BASE = 'https://www.reb.or.kr/r-one/openapi';

/** (월) 지역별 지가변동률 */
const TBL_LAND_PRICE = { id: 'A_2024_00903', cycle: 'MM', item: 100001 };

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

/**
 * 누적 지가변동률 — 시점수정 계수.
 *
 * ★ 월별 변동률은 **곱해서 누적한다.** 더하면 안 된다 — 복리로 쌓이는 값이고,
 *   기간이 길수록 단순합과 벌어진다. 감정평가 시점수정도 곱셈이다.
 *
 * @returns {{factor:number, percent:number, months:number, ...}} factor 는
 *   공시지가에 곱할 계수 (1.0 이면 변동 없음)
 */
async function timeAdjustment({ clsId = CLS_NATIONWIDE, from, to } = {}) {
  const r = await landPriceChange({ clsId, from, to });
  if (!r.ok) return r;

  const rows = r.value;
  const factor = rows.reduce((f, x) => f * (1 + x.rate / 100), 1);

  return {
    ok: true,
    cached: r.cached,
    value: {
      clsId,
      region: rows[0].region,
      from: rows[0].month,
      to: rows[rows.length - 1].month,
      months: rows.length,
      factor: Math.round(factor * 1e6) / 1e6,
      percent: Math.round((factor - 1) * 1000) / 10,   // 누적 변동률 (%)
      monthly: rows,
    },
  };
}

/**
 * 지역 색인 — CLS_FULLNM → CLS_ID.
 *
 * ★ 한 달치 전량을 받아 만든다(약 10,700건, 페이지 11회). 지역코드는 거의
 *   변하지 않으므로 180일 캐시한다 — 프로젝트마다 다시 받지 않는다.
 * ★ **시도>시군구 2단계만 남긴다.** 읍면동까지 두면 "중구"처럼 흔한 이름이
 *   여러 시도에서 겹쳐 잘못 매칭된다.
 */
async function regionIndex(month) {
  if (!isAvailable()) return unavailable('지역 색인');

  return cache.through(PROVIDER, 'regionindex', { month }, async () => {
    const out = [];
    let total = null;

    for (let p = 1; p <= 20; p++) {
      const r = await page({
        STATBL_ID: TBL_LAND_PRICE.id,
        DTACYCLE_CD: TBL_LAND_PRICE.cycle,
        ITM_ID: TBL_LAND_PRICE.item,
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
async function resolveRegion(address, month) {
  if (!address) return { ok: false, error: '주소 없음' };

  const idx = await regionIndex(month);
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
  landPriceChange, timeAdjustment, regionIndex, resolveRegion,
  isAvailable, TBL_LAND_PRICE, CLS_NATIONWIDE, PROVIDER,
};
