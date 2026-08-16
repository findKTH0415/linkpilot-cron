'use strict';
/**
 * kosis.js — 통계청 KOSIS 공유서비스 Connector (제조 딜의 **가동률 대조**).
 *
 * 왜 필요한가: 제조 IM 의 매출은 **생산능력 × 가동률 × 단가**다. 단가는 D-42 의
 * 1번(ECOS 생산자물가)으로 대조가 붙었다. 남은 둘 중 **가동률은 지금 재무모델에서
 * 근거가 0인 숫자**다 — 사업계획서가 「가동률 85%」라고 하면 그대로 들어간다.
 * 85% 와 70% 는 매출을 20% 넘게 흔든다.
 *
 * ★ **이 커넥터는 값을 채우지 않는다. 대조한다.**
 *   개별 공장의 가동률은 공적으로 나오지 않는다. 나오는 것은 **업종 평균**뿐이다.
 *   그래서 우리가 낼 수 있는 말은 「이 딜의 85% 는 업종 평균 73% 보다 12%p 높다」
 *   이지, 「가동률은 73% 다」가 아니다. 후자로 쓰면 딜의 고유 조건이 사라진다.
 *
 * ★ **가장 위험한 것은 「지수」와 「%」를 섞는 것이다.**
 *   광업제조업동향조사는 **가동률지수(2020=100)** 와 **제조업 평균가동률(%)** 을
 *   둘 다 낸다. 이름이 비슷하고 숫자도 비슷한 자리(70~110)에 있다.
 *   지수 102.3 을 가동률로 읽으면 「가동률 102%」가 되는데, **물리적으로 불가능한
 *   값인데도 표에서는 그럴듯해 보인다.** 그래서 이 파일은 응답의 단위를 읽어
 *   성격을 판정하고, **성격이 다르면 견주기를 거부한다.**
 *
 * ★ **통계표를 자동으로 고르지 않는다** (§4.9). KOSIS 에는 표가 수천 개고
 *   이름이 겹친다. `tables()` 로 후보를 내고 사람이 `tblId`·`itmId`·업종코드를
 *   지정한다. 아래 후보 상수는 **참고용이며 실측되지 않았다** (D-44).
 *
 * 인증키: KOSIS_API_KEY — kosis.kr 공유서비스에서 발급 (무료, 신청 필요).
 *   ★ ECOS·부동산원·data.go.kr 키와 **서로 통용되지 않는다** (§4.1).
 *
 * ⚠️ 엔드포인트·응답 필드명은 공식 문서 기준이고 **실제 키로 검증하지 않았다**
 *    (등록부 D-44). `npm run im:smoke` 가 대조한다.
 */

// ★ `request` 를 뜯어내지 않고 모듈 객체로 붙든다 — 뜯어내면 테스트가 응답을
//   갈아끼울 수 없어 해석 경로가 한 번도 안 돈 채 통과한다 (M-08).
const http = require('./http');
const { buildUrl, redact } = http;
const cache = require('./cache');

const PROVIDER = 'kosis';

const DATA_BASE = 'https://kosis.kr/openapi/Param/statisticsParameterData.do';
const META_BASE = 'https://kosis.kr/openapi/statisticsData.do';
const SEARCH_BASE = 'https://kosis.kr/openapi/statisticsSearch.do';

/** 통계청 */
const ORG_STATISTICS_KOREA = '101';

/**
 * 후보 통계표 — **실측되지 않았다. 그대로 쓰지 않는다** (D-44).
 *
 * 여기 적어 두는 이유는 「어디를 뒤져야 하는지」를 남기기 위해서다.
 * 실제 조회는 `tables()` 로 후보를 받아 사람이 고른 `tblId` 로 한다.
 */
const CANDIDATES = [
  {
    key: 'utilization',
    what: '제조업 가동률 (동향조사)',
    org: ORG_STATISTICS_KOREA,
    survey: '광업제조업동향조사',
    search: '가동률',
    caution: '같은 조사에 **지수(2020=100)** 와 **평균가동률(%)** 이 따로 있다. '
      + '항목명(ITM_NM)·단위(UNIT_NM)를 보고 고른다',
  },
  {
    key: 'shipment',
    what: '업종별 출하액 (광업제조업조사)',
    org: ORG_STATISTICS_KOREA,
    survey: '광업제조업조사',
    search: '출하액',
    caution: '연간 조사라 최신 자료가 1~2년 뒤진다. 기준연도를 출처에 반드시 적는다',
  },
];

function apiKey() {
  return (process.env.KOSIS_API_KEY || '').trim();
}

function isAvailable() {
  return Boolean(apiKey());
}

function unavailable(what) {
  return {
    ok: false,
    error: `KOSIS_API_KEY 미설정 — ${what || '통계청 자료'} 조회 생략 `
      + '(가동률이 근거 없는 가정치로 남는다)',
    unavailable: true,
  };
}

/** 키가 쿼리에 들어가지만 짧을 수 있어 명시적으로도 가린다 */
function mask(text) {
  return redact(text, [apiKey()]);
}

/**
 * 단위 문자열의 **성격**. 이 판정이 이 파일의 존재 이유다.
 *
 * ★ 「지수」와 「%」를 섞으면 「가동률 102%」 같은 값이 태연히 나온다.
 *   모르면 `unknown` 을 돌려주고, 모른 채로 견주지 않는다.
 */
function unitKind(unitName) {
  const u = String(unitName || '').trim();
  if (!u) return 'unknown';
  if (/^%$|퍼센트|백분율/.test(u)) return 'percent';
  // '2020=100' · '지수' · '2015=100' 등
  if (/지수|=\s*100|^p$/i.test(u)) return 'index';
  return 'unknown';
}

/** 'YYYY-MM' · 'YYYYMM' · 'YYYY' → 주기에 맞는 기간 문자열 */
function period(v, prdSe) {
  const t = String(v || '').replace(/[-.]/g, '');
  if (prdSe === 'Y') return /^\d{4}$/.test(t) ? t : (/^\d{6}$/.test(t) ? t.slice(0, 4) : '');
  if (prdSe === 'Q') return /^\d{5,6}$/.test(t) ? t : '';
  return /^\d{6}$/.test(t) ? t : '';   // M
}

/**
 * KOSIS 응답 해석. **네트워크와 분리해 둔다** — 여기가 가장 틀리기 쉽고,
 * 틀리면 「조회는 성공했는데 값이 빈다」는 형태로 나타난다.
 *
 * ★ KOSIS 는 오류를 `{err, errMsg}` 로 주고 **HTTP 200 으로** 돌려준다.
 *   이걸 안 보면 성공으로 세고 조용히 가정치로 돌아간다.
 */
function parseData(body) {
  let j;
  try { j = JSON.parse(body); } catch (_) {
    return { ok: false, error: 'KOSIS 응답이 JSON 이 아니다 (키·통계표 ID 확인)' };
  }

  if (j && !Array.isArray(j) && (j.err || j.errMsg)) {
    return { ok: false, error: mask(`KOSIS ${j.err || ''}: ${j.errMsg || '조회 실패'}`.trim()) };
  }
  const raw = Array.isArray(j) ? j : [];
  if (!raw.length) return { ok: false, error: 'KOSIS: 조건에 맞는 자료가 없다 (표 ID·항목·분류·기간 확인)' };

  const rows = raw
    // ★ 빈 값을 **Number() 앞에서** 걷어낸다. `Number('')` 은 0 이고
    //   `isFinite(0)` 은 참이라, 안 걸러내면 결측이 「가동률 0%」로 들어온다
    .filter(x => x.DT !== null && x.DT !== undefined && String(x.DT).trim() !== '')
    .map(x => ({
      period: String(x.PRD_DE || ''),
      value: Number(x.DT),
      item: x.ITM_NM || null,
      category: x.C1_NM || null,
      unit: x.UNIT_NM || null,
      table: x.TBL_NM || null,
    }))
    .filter(x => x.period && Number.isFinite(x.value));

  if (!rows.length) {
    return { ok: false, error: 'KOSIS: 숫자 값이 있는 행이 없다 (DT 필드명·결측 확인)' };
  }
  // ★ 응답 순서를 믿지 않는다 (§4.4) — 앞에서 집으면 몇 년 전 값을 최신으로 쓴다
  rows.sort((a, b) => a.period.localeCompare(b.period));
  return { ok: true, rows };
}

/**
 * 통계표 검색 — **사람이 고르라고 내놓는 목록이다.**
 *
 * @param {string} searchWord 예: '가동률'
 */
async function tables(searchWord, opt) {
  if (!isAvailable()) return unavailable('통계표 목록');
  const word = String(searchWord || '').trim();
  if (!word) return { ok: false, error: '검색어가 필요하다 — 표를 자동으로 고르지 않는다' };

  const o = opt || {};
  return cache.through(PROVIDER, 'kosis-tables', { word, org: o.orgId || '' }, async () => {
    const url = buildUrl(SEARCH_BASE, {
      method: 'getList', apiKey: apiKey(), searchNm: word,
      orgId: o.orgId || undefined, format: 'json', jsonVD: 'Y',
    });
    const r = await http.request(url);
    if (!r.ok) return { ok: false, error: mask(r.error) };

    let j;
    try { j = JSON.parse(r.body); } catch (_) {
      return { ok: false, error: 'KOSIS 검색 응답이 JSON 이 아니다' };
    }
    if (j && !Array.isArray(j) && (j.err || j.errMsg)) {
      return { ok: false, error: mask(`KOSIS ${j.err || ''}: ${j.errMsg || ''}`.trim()) };
    }
    const raw = Array.isArray(j) ? j : [];
    if (!raw.length) {
      return { ok: false, error: `KOSIS: '${word}' 로 찾은 통계표가 없다 (검색 엔드포인트 미검증 — 등록부 D-44)` };
    }
    return {
      ok: true,
      value: raw.map(x => ({
        orgId: x.ORG_ID, tblId: x.TBL_ID, name: x.TBL_NM,
        survey: x.STAT_NM || null,
        // 어느 구간까지 있는 자료인지 — 조회 기간을 사람이 정할 때 필요하다
        from: x.PRD_DE_FR || x.START_PRD_DE || null,
        to: x.PRD_DE_TO || x.END_PRD_DE || null,
      })),
    };
  }, { ttl: 180 * 86400 });
}

/**
 * 통계표의 항목·분류 목록 — **업종 코드를 여기서 고른다.**
 *
 * @param {object} o { orgId, tblId, type } type: 'ITM'(항목) | 'OBJ'(분류)
 */
async function meta(o) {
  const opt = o || {};
  if (!isAvailable()) return unavailable('통계표 메타');
  if (!opt.tblId) return { ok: false, error: '통계표 ID(tblId)가 필요하다 — tables() 로 찾아 사람이 고른다' };
  const type = opt.type === 'OBJ' ? 'OBJ' : 'ITM';

  return cache.through(PROVIDER, 'kosis-meta', { org: opt.orgId || ORG_STATISTICS_KOREA, tbl: opt.tblId, type }, async () => {
    const url = buildUrl(META_BASE, {
      method: 'getMeta', apiKey: apiKey(), format: 'json', jsonVD: 'Y',
      orgId: opt.orgId || ORG_STATISTICS_KOREA, tblId: opt.tblId, type,
    });
    const r = await http.request(url);
    if (!r.ok) return { ok: false, error: mask(r.error) };

    let j;
    try { j = JSON.parse(r.body); } catch (_) {
      return { ok: false, error: 'KOSIS 메타 응답이 JSON 이 아니다' };
    }
    if (j && !Array.isArray(j) && (j.err || j.errMsg)) {
      return { ok: false, error: mask(`KOSIS ${j.err || ''}: ${j.errMsg || ''}`.trim()) };
    }
    const raw = Array.isArray(j) ? j : [];
    if (!raw.length) return { ok: false, error: `KOSIS ${opt.tblId}: ${type} 목록이 비어 있다 (표 ID 확인 — 등록부 D-44)` };

    return {
      ok: true,
      value: raw.map(x => ({
        code: x.ITM_ID || x.OBJ_ITM_ID || x.C1 || null,
        name: x.ITM_NM || x.OBJ_ITM_NM || x.C1_NM || null,
        unit: x.UNIT_NM || null,
        // ★ 단위를 여기서 이미 판정해 둔다 — 고르는 순간 성격을 알아야
        //   「지수」를 가동률로 착각한 채 진행하지 않는다
        kind: unitKind(x.UNIT_NM),
        objId: x.OBJ_ID || null,
      })),
    };
  }, { ttl: 180 * 86400 });
}

/**
 * 시계열 조회.
 *
 * @param {object} o { orgId, tblId, itmId, objL1, prdSe, from, to }
 *   objL1 은 업종 분류코드 (meta(type:'OBJ') 로 고른다)
 */
async function series(o) {
  const opt = o || {};
  if (!isAvailable()) return unavailable('통계 시계열');
  if (!opt.tblId || !opt.itmId) {
    return {
      ok: false,
      error: '통계표 ID(tblId)와 항목코드(itmId)를 지정해야 한다 — 자동으로 고르지 않는다. '
        + 'tables() 로 표를, meta() 로 항목·업종을 받아 사람이 고른다 '
        + '(같은 조사에 지수와 %가 함께 있어 잘못 고르면 「가동률 102%」가 나온다)',
    };
  }
  const prdSe = opt.prdSe || 'M';
  const from = period(opt.from, prdSe);
  const to = period(opt.to, prdSe);
  if (!from || !to) return { ok: false, error: `조회 구간이 필요하다 (주기 ${prdSe} 형식)` };

  const params = {
    orgId: opt.orgId || ORG_STATISTICS_KOREA, tblId: opt.tblId,
    itmId: opt.itmId, objL1: opt.objL1 || 'ALL', prdSe, from, to,
  };

  return cache.through(PROVIDER, 'kosis', params, async () => {
    const url = buildUrl(DATA_BASE, {
      method: 'getList', apiKey: apiKey(), format: 'json', jsonVD: 'Y',
      orgId: params.orgId, tblId: params.tblId, itmId: params.itmId,
      objL1: params.objL1, prdSe, startPrdDe: from, endPrdDe: to,
    });
    const r = await http.request(url);
    if (!r.ok) return { ok: false, error: mask(r.error) };

    const p = parseData(r.body);
    if (!p.ok) return p;

    const rows = p.rows;
    const last = rows[rows.length - 1];
    const kind = unitKind(last.unit);

    return {
      ok: true,
      value: {
        rows, first: rows[0], last,
        unit: last.unit, kind,
        item: last.item, category: last.category, table: last.table,
        prdSe,
      },
    };
  }, { ttl: prdSe === 'Y' ? 30 * 86400 : 7 * 86400 });
}

/**
 * 업종 평균 대조값 — **채우는 값이 아니라 견줄 값이다.**
 *
 * ★ 평균에는 **모수**가 붙어야 한다 (§4.7). 몇 개월치를 평균했는지 없으면
 *   한 달짜리 값인지 3년치인지 알 수 없다.
 */
async function benchmark(o) {
  const r = await series(o);
  if (!r.ok) return r;

  const { rows, last, unit, kind, item, category, table, prdSe } = r.value;
  const mean = rows.reduce((a, x) => a + x.value, 0) / rows.length;

  return {
    ok: true,
    cached: r.cached,
    value: {
      latest: last.value,
      latestPeriod: last.period,
      mean: Math.round(mean * 100) / 100,
      n: rows.length,
      from: rows[0].period, to: last.period,
      unit, kind, item, category, prdSe,
      // ★ 값만 옮기지 않는다 — 어디서·언제·무엇을 몇 개 평균한 값인지 남긴다
      source: {
        provider: '통계청 KOSIS',
        label: `${table || '통계청'} · ${item || ''}${category ? ` · ${category}` : ''}`.trim(),
        note: `${rows[0].period}~${last.period} ${rows.length}개 시점 평균 ${Math.round(mean * 100) / 100}${unit || ''} `
          + `· 최근값 ${last.value}${unit || ''}(${last.period}). `
          + '업종 평균이며 개별 공장 값이 아니다 — 딜의 가동률을 대체하지 않고 견주기만 한다',
      },
    },
  };
}

/**
 * 딜의 가동률을 업종 평균과 견준다.
 *
 * ★ **단위 성격이 다르면 거부한다.** 가동률지수(2020=100)와 가동률(%)은
 *   둘 다 70~110 자리에 있어 뺄셈이 태연히 성립한다 — 「업종 대비 +12%p」라는
 *   문장까지 그대로 나오고, 그게 지수와 %의 차라는 사실은 어디에도 안 남는다.
 *
 * @param {number} dealRate 딜의 가동률 (%)
 * @param {object} bm benchmark() 의 value
 */
function compare(dealRate, bm) {
  const d = Number(dealRate);
  if (!Number.isFinite(d)) return { ok: false, error: '딜의 가동률이 숫자가 아니다' };
  if (!bm) return { ok: false, error: '대조값이 없다' };

  if (bm.kind !== 'percent') {
    return {
      ok: false,
      error: `대조값의 단위가 '${bm.unit || '알 수 없음'}' 이라 가동률(%)과 견줄 수 없다. `
        + '지수(2020=100)를 %로 읽으면 「가동률 102%」 같은 값이 그럴듯하게 나온다 — '
        + '평균가동률(%) 항목을 골라야 한다',
      unitMismatch: true,
    };
  }

  const gap = Math.round((d - bm.mean) * 10) / 10;
  return {
    ok: true,
    value: {
      dealRate: d,
      industryMean: bm.mean,
      gap,
      // 「높다/낮다」만 낸다. 좋다/나쁘다는 이 커넥터가 판정할 것이 아니다
      direction: gap > 0 ? 'above' : (gap < 0 ? 'below' : 'equal'),
      text: `이 딜의 가동률 ${d}% 는 업종 평균 ${bm.mean}%(${bm.from}~${bm.to}, ${bm.n}개 시점)보다 `
        + `${Math.abs(gap)}%p ${gap > 0 ? '높다' : gap < 0 ? '낮다' : '같다'}`,
    },
  };
}

module.exports = {
  tables, meta, series, benchmark, compare,
  isAvailable, unavailable, mask, unitKind, period, parseData,
  PROVIDER, ORG_STATISTICS_KOREA, CANDIDATES,
  DATA_BASE, META_BASE, SEARCH_BASE,
};
