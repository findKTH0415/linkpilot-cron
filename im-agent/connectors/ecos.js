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

const { request, redact } = require('./http');
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

function apiKey() {
  return process.env.ECOS_API_KEY || '';
}

function isAvailable() {
  return Boolean(apiKey());
}

function unavailable() {
  return { ok: false, error: 'ECOS_API_KEY 미설정 — 시장금리 조회 생략', unavailable: true };
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

    const r = await request(url);
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

module.exports = {
  marketRate, isAvailable, unavailable, parseResponse, buildRequestUrl, mask,
  SERIES, DEFAULT_SERIES, PROVIDER, BASE, compact, daysAgo,
};
