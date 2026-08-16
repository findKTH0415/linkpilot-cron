'use strict';
/**
 * ecos.js — 한국은행 ECOS Connector (시장금리).
 *
 * 왜 필요한가: `debt.rate`(차입금리)가 지금까지 **산업 통상치**였다. 5.8% 같은
 * 숫자가 어디서 왔는지 아무도 모르는 채로 IRR 을 좌우한다. 금리는 이 시스템이
 * 다루는 값 중 **가장 자주 바뀌고 가장 크게 흔드는** 값이다.
 *
 * ★ 그런데 ECOS 가 주는 것은 **차입금리가 아니라 기준금리**다.
 *   PF 대출금리 = 기준금리(국고채 등) + 가산금리(스프레드)이고, 스프레드는
 *   딜마다 다르다. 국고채 3%를 `debt.rate` 로 넣으면 실제 6%짜리 딜이 3%로
 *   계산되어 **IRR 이 통째로 부풀려진다.**
 *
 *   그래서 이 커넥터는 `debt.benchmark_rate` 만 채운다. 차입금리를 대체하지
 *   않고, 옆에 출처 있는 기준선을 세워 둔다 — 문서가 말하는 금리가 기준선에서
 *   얼마나 떨어져 있는지 검증이 보게 하려는 것이다.
 *   (기준금리 + 스프레드로 차입금리를 만들지 여부는 등록부 D-22 로 남겼다.)
 *
 * 인증키: ECOS_API_KEY — ecos.bok.or.kr 에서 발급 (무료).
 *   ★ 키가 **URL 경로에** 들어간다. 쿼리 파라미터가 아니라서 일반 마스킹 규칙에
 *     안 걸린다 — 이 파일은 자기 키를 명시적으로 가려서 넘긴다.
 *
 * ★ 응답 필드명은 공식 문서 기준으로 작성했고 **실제 키로 검증하지 않았다.**
 *   `npm run im:smoke` 가 필드명을 대조한다 (다른 커넥터와 같은 한계 — B-4).
 */

// ★ `request` 를 뜯어내지 않고 **모듈 객체로 붙든다.** 뜯어내면 테스트가
//   응답을 갈아끼울 수 없어, 해석 경로가 한 번도 안 돈 채 통과한다 —
//   M-08(테스트 733건 통과, HTTP 는 전부 죽어 있었다)이 그렇게 났다.
const http = require('./http');
const { redact } = http;
const cache = require('./cache');
const { kstDate } = require('../core/kst');

const PROVIDER = 'ecos';
const BASE = 'https://ecos.bok.or.kr/api/StatisticSearch';

/**
 * 시장금리(일별) 통계표와 항목코드.
 * 표 하나에 항목이 여럿이라 통계표코드는 같고 항목코드로 가른다.
 */
const SERIES = {
  ktb3: { stat: '817Y002', item: '010200000', label: '국고채(3년)' },
  ktb5: { stat: '817Y002', item: '010200001', label: '국고채(5년)' },
  cd91: { stat: '817Y002', item: '010502000', label: 'CD(91일)' },
  corp3: { stat: '817Y002', item: '010300000', label: '회사채(3년, AA-)' },
};

/** PF 기준선으로 쓰는 계열 — 바꾸려면 여기 한 곳만 고친다 */
const DEFAULT_SERIES = 'ktb3';

/**
 * 생산자물가지수 (제조 딜용).
 *
 * 왜 필요한가: 제조 IM 의 매출은 **생산능력 × 가동률 × 단가**인데, 셋 다
 * 사업계획서가 말하는 대로 믿는 수밖에 없었다. 부동산에서 공시지가·실거래가가
 * 하던 역할을 제조에서는 아무도 안 하고 있다. PPI 는 그중 **단가**에 붙는
 * 독립 출처다 — 2년 전 사업계획서의 단가가 지금 시점에서 얼마인지 말해 준다.
 *
 * ★ **지수의 비는 가정이 아니다.** 공표 통계이고, 공시지가 시점수정과 같은
 *   논리다 (§4.8). 그래서 계수는 자동으로 낼 수 있다.
 * ★ 그런데 **어느 업종 지수를 쓸지는 자동으로 고르지 않는다** (§4.9).
 *   「기타 기계 및 장비」와 「1차 금속」은 몇 년 새 두 자릿수로 갈린다 —
 *   틀린 업종으로 보정하면 문서에는 「시점수정 적용」만 남고 무엇이 틀렸는지 사라진다.
 * ★ **변동률을 곱해 쌓지 않는다** (§4.4). 구간 경계에서 한 달을 더 세기 쉽다.
 *   양 끝 지수의 비만 쓴다.
 *
 * ⚠️ 통계표코드·주기는 공식 문서 기준이고 **실제 키로 검증하지 않았다** (D-43).
 *    `npm run im:smoke` 가 대조한다.
 */
const PPI = {
  stat: '404Y014',          // 생산자물가지수 (기본분류)
  cycle: 'M',               // 월별
  label: '생산자물가지수',
};

function apiKey() {
  return process.env.ECOS_API_KEY || '';
}

function isAvailable() {
  return Boolean(apiKey());
}

function unavailable(what) {
  return { ok: false, error: `ECOS_API_KEY 미설정 — ${what || '시장금리'} 조회 생략`, unavailable: true };
}

/** 이 커넥터 전용 마스킹 — 키가 경로에 있어 일반 규칙만으로는 새어 나갈 수 있다 */
function mask(text) {
  return redact(text, [apiKey()]);
}

/** YYYY-MM-DD → YYYYMMDD (ECOS 일별 조회 형식) */
function compact(isoDate) {
  return String(isoDate).replace(/-/g, '');
}

/** n일 전 KST 날짜 (YYYY-MM-DD) */
function daysAgo(n, from) {
  const base = from ? new Date(`${from}T00:00:00+09:00`) : new Date(`${kstDate()}T00:00:00+09:00`);
  base.setUTCDate(base.getUTCDate() - n);
  return kstDate(base);
}

/**
 * 시장금리 조회. **최근 영업일 값**을 돌려준다.
 *
 * 금리는 영업일에만 고시되므로 하루만 조회하면 주말·공휴일에 빈손이 된다.
 * 넉넉히 뒤로 훑고 마지막(가장 최근) 행을 쓴다.
 *
 * @param {string} seriesId SERIES 의 key (기본 ktb3)
 * @param {number} lookbackDays 며칠까지 거슬러 볼지 (기본 14일 — 연휴를 넘긴다)
 * @returns {Promise<{ok:boolean, value?:{rate:number,date:string,label:string,unit:string}, error?:string}>}
 */
async function marketRate(seriesId = DEFAULT_SERIES, lookbackDays = 14) {
  if (!isAvailable()) return unavailable();

  const s = SERIES[seriesId];
  if (!s) return { ok: false, error: `모르는 금리 계열: ${seriesId}` };

  const end = kstDate();
  const start = daysAgo(lookbackDays);

  // ★ 캐시 키에 인증키를 넣지 않는다. 캐시 파일명·내용에 키가 남으면 안 된다
  return cache.through(PROVIDER, 'rate', { seriesId, start, end }, async () => {
    const url = buildRequestUrl(s, start, end, apiKey());

    const r = await http.request(url);
    if (!r.ok) return { ok: false, error: mask(r.error) };
    return parseResponse(r.body, s, { start, end });
  });
}

/**
 * ECOS 응답 해석. **네트워크와 분리해 둔다** — 여기가 가장 틀리기 쉽고,
 * 틀리면 조회는 성공했는데 값이 비는 형태로 나타난다 (가장 잡기 어려운 오류).
 *
 * @param {string} body   응답 본문
 * @param {object} series SERIES 항목 { stat, item, label }
 * @param {object} range  { start, end } — 오류 문구에만 쓴다
 */
function parseResponse(body, series, range) {
  const s = series || { label: '' };
  const end = (range && range.end) || '';

  let j;
  try { j = JSON.parse(body); } catch (_) {
    return { ok: false, error: 'ECOS 응답이 JSON 이 아니다 (키·통계표코드 확인)' };
  }

  // ★ 인증 실패·조회 없음이 **HTTP 200 으로** 오고 본문에만 드러난다.
  //   이걸 안 보면 "성공했는데 값이 없다"가 되어 조용히 가정치로 돌아간다
  if (j.RESULT) {
    return { ok: false, error: `ECOS ${j.RESULT.CODE || ''}: ${j.RESULT.MESSAGE || '조회 실패'}`.trim() };
  }

  const rows = (j.StatisticSearch && j.StatisticSearch.row) || [];
  if (!rows.length) {
    return { ok: false, error: `ECOS ${s.label}: ${(range || {}).start}~${end} 구간에 고시값이 없다` };
  }

  // 마지막 행이 가장 최근이다. 값이 비어 있는 행(휴일 등)은 건너뛴다
  for (let i = rows.length - 1; i >= 0; i--) {
    const raw = rows[i].DATA_VALUE;
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;

    const t = String(rows[i].TIME || '');
    return {
      ok: true,
      value: {
        rate: v,
        label: rows[i].ITEM_NAME1 || s.label,
        unit: rows[i].UNIT_NAME || '%',
        // TIME 은 YYYYMMDD 로 온다 — 사람이 읽는 형식으로 바꿔 둔다
        date: /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6)}` : (t || end),
      },
    };
  }
  return { ok: false, error: `ECOS ${s.label}: 숫자 값이 있는 행이 없다 (DATA_VALUE 필드명 확인)` };
}

/** 조회 URL 조립 — 키가 **경로**에 들어간다 (쿼리 파라미터가 아니다) */
function buildRequestUrl(series, start, end, key) {
  return [
    BASE, encodeURIComponent(key), 'json', 'kr', '1', '100',
    series.stat, 'D', compact(start), compact(end), series.item,
  ].join('/');
}

/* ── 생산자물가지수 ──────────────────────────────────────── */

const ITEM_BASE = 'https://ecos.bok.or.kr/api/StatisticItemList';

/** 'YYYY-MM' · 'YYYYMM' · Date → 'YYYYMM' */
function month(v) {
  if (v instanceof Date) return kstDate(v).slice(0, 7).replace('-', '');
  const t = String(v || '').replace(/-/g, '');
  return /^\d{6}$/.test(t) ? t : '';
}

/**
 * 이 통계표에 어떤 업종이 있는가. **사람이 고르라고 내놓는 목록이다.**
 *
 * ★ 자동으로 하나를 고르지 않는 이유: 업종을 잘못 잡으면 보정은 되는데
 *   문서에는 「시점수정 적용」만 남는다 — 무엇이 틀렸는지 사라진다 (§4.9).
 */
async function ppiItems() {
  if (!isAvailable()) return unavailable('생산자물가 업종목록');
  return cache.through(PROVIDER, 'ppi-items', { stat: PPI.stat }, async () => {
    const url = [ITEM_BASE, encodeURIComponent(apiKey()), 'json', 'kr', '1', '500', PPI.stat].join('/');
    const r = await http.request(url);
    if (!r.ok) return { ok: false, error: mask(r.error) };

    let j;
    try { j = JSON.parse(r.body); } catch (_) {
      return { ok: false, error: 'ECOS 항목목록 응답이 JSON 이 아니다 (통계표코드 확인)' };
    }
    if (j.RESULT) return { ok: false, error: `ECOS ${j.RESULT.CODE || ''}: ${j.RESULT.MESSAGE || ''}`.trim() };

    const rows = (j.StatisticItemList && j.StatisticItemList.row) || [];
    if (!rows.length) return { ok: false, error: `ECOS ${PPI.stat}: 항목이 없다 (통계표코드 확인 — 등록부 D-43)` };

    return {
      ok: true,
      value: rows.map(x => ({
        code: x.ITEM_CODE,
        name: x.ITEM_NAME,
        cycle: x.CYCLE,
        // 언제부터 언제까지 있는 자료인지 — 조회 구간을 사람이 정할 때 필요하다
        from: x.START_TIME || null,
        to: x.END_TIME || null,
      })),
    };
  });
}

/**
 * 업종별 생산자물가 시계열.
 *
 * @param {object} o { item, from, to } — item 은 ppiItems() 의 code
 * @returns {{ok, value:{rows,first,last,label,unit,baseYear}, error}}
 */
async function ppiSeries(o) {
  const opt = o || {};
  if (!isAvailable()) return unavailable('생산자물가');
  if (!opt.item) {
    return {
      ok: false,
      error: '업종(항목코드)을 지정해야 한다 — 자동으로 고르지 않는다. '
        + 'ppiItems() 로 후보를 받아 사람이 고른다 (틀린 업종으로 보정하면 '
        + '문서에는 「시점수정 적용」만 남는다)',
    };
  }
  const from = month(opt.from);
  const to = month(opt.to);
  if (!from || !to) return { ok: false, error: '조회 구간(YYYYMM)이 필요하다' };

  return cache.through(PROVIDER, 'ppi', { item: opt.item, from, to }, async () => {
    const url = [
      BASE, encodeURIComponent(apiKey()), 'json', 'kr', '1', '500',
      PPI.stat, PPI.cycle, from, to, opt.item,
    ].join('/');
    const r = await http.request(url);
    if (!r.ok) return { ok: false, error: mask(r.error) };

    let j;
    try { j = JSON.parse(r.body); } catch (_) {
      return { ok: false, error: 'ECOS 응답이 JSON 이 아니다 (키·통계표코드 확인)' };
    }
    if (j.RESULT) return { ok: false, error: `ECOS ${j.RESULT.CODE || ''}: ${j.RESULT.MESSAGE || ''}`.trim() };

    const raw = (j.StatisticSearch && j.StatisticSearch.row) || [];
    // ★ **빈 값을 먼저 걷어낸다.** `Number('')` 은 0 이고 `Number.isFinite(0)` 은
    //   참이라, 걸러내지 않으면 결측이 **지수 0** 으로 들어온다. 그 달이 구간 끝이면
    //   계수가 0 이 되고, 시작이면 0 으로 나눈다 — 둘 다 값은 나온다.
    const rows = raw
      .filter(x => x.DATA_VALUE !== null && x.DATA_VALUE !== undefined && String(x.DATA_VALUE).trim() !== '')
      .map(x => ({ time: String(x.TIME || ''), value: Number(x.DATA_VALUE), name: x.ITEM_NAME1, unit: x.UNIT_NAME }))
      .filter(x => /^\d{6}$/.test(x.time) && Number.isFinite(x.value));

    if (!rows.length) {
      return { ok: false, error: `ECOS 생산자물가 ${opt.item}: ${from}~${to} 구간에 값이 없다 (항목코드·주기 확인)` };
    }
    // ★ 응답 순서를 믿지 않는다 (§4.4) — 앞에서 집으면 몇 년 전 값을 최신으로 쓴다
    rows.sort((a, b) => a.time.localeCompare(b.time));

    return {
      ok: true,
      value: {
        rows,
        first: rows[0],
        last: rows[rows.length - 1],
        label: rows[0].name || PPI.label,
        unit: rows[0].unit || '지수',
      },
    };
  });
}

/**
 * 단가 시점수정 계수 — **양 끝 지수의 비**.
 *
 * ★ 변동률을 곱해 쌓지 않는다 (§4.4). 구간 경계에서 한 달을 더 세기 쉽다.
 * ★ 이 계수는 **가정이 아니다** — 공표 통계의 비다 (§4.8). 다만 **적용할지는**
 *   사람이 정한다: 사업계획서 단가가 이미 최근 값이면 두 번 보정하게 된다.
 *
 * @returns {{ok, value:{factor,percent,from,to,fromIndex,toIndex,months,label}, error}}
 */
async function priceAdjustment(o) {
  const opt = o || {};
  const r = await ppiSeries(opt);
  if (!r.ok) return r;

  const { first, last, label, unit } = r.value;
  if (!first.value) {
    return { ok: false, error: `기준 시점(${first.time}) 지수가 0 이라 계수를 낼 수 없다` };
  }
  const factor = last.value / first.value;
  const months = (Number(last.time.slice(0, 4)) - Number(first.time.slice(0, 4))) * 12
    + (Number(last.time.slice(4, 6)) - Number(first.time.slice(4, 6)));

  return {
    ok: true,
    cached: r.cached,
    value: {
      factor: Math.round(factor * 10000) / 10000,
      percent: Math.round((factor - 1) * 1000) / 10,
      from: first.time, to: last.time,
      fromIndex: first.value, toIndex: last.value,
      months,
      label,
      unit,
      // ★ 값만 옮기지 않는다 — 어디서·언제·무엇으로 나온 계수인지 함께 남긴다 (§4.7)
      source: {
        provider: '한국은행 ECOS',
        label: `생산자물가지수 · ${label}`,
        note: `${first.time} 지수 ${first.value} → ${last.time} 지수 ${last.value} `
          + `(${months}개월). 지수의 비이며 변동률을 누적하지 않았다. `
          + '공표 통계라 가정계수가 아니지만, 적용할지는 사람이 정한다 — '
          + '사업계획서 단가가 이미 최근 값이면 두 번 보정된다',
      },
    },
  };
}

module.exports = {
  marketRate, isAvailable, unavailable, parseResponse, buildRequestUrl, mask,
  ppiItems, ppiSeries, priceAdjustment, month,
  SERIES, DEFAULT_SERIES, PPI, PROVIDER, BASE, ITEM_BASE, compact, daysAgo,
};
