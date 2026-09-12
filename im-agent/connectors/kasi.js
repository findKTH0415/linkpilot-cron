'use strict';
/**
 * kasi.js — 한국천문연구원 **특일정보** Connector (data.go.kr `B090041`).
 *
 * 〈2026-09-12 사장님 지시: 「특일정보 API 를 붙여라」 · D-206 결정〉
 *
 * ## 왜 붙이나
 *
 * 설날·정월대보름·부처님오신날·추석은 **음력**이라 양력 날짜가 해마다 다르다.
 * 앞 판은 그것을 `linkpilot-platform` 안에 **해마다 손으로 적은 표**로 들고 있었고,
 * 실측으로 **2026~2028 세 해**만 덮었다.
 * ★★★ **표에 없는 해가 오면 명절이 «아무 오류 없이» 사라진다.** 설날 아침에
 *   인사말이 평범한 「월요일이네요」로 나오고, 알아채는 것은 사장님뿐이다.
 *
 * ## 네 갈래를 읽는다
 *
 *   getRestDeInfo        공휴일        설날·추석·부처님오신날·대체공휴일
 *   get24DivisionsInfo   24절기        입춘·경칩·… (지침서 v1.1 §4.6 이 요구하는 그것)
 *   getSundryDayInfo     잡절          정월대보름·한식·초복 …
 *   getAnniversaryInfo   기념일        어버이날·스승의 날 …
 *
 * ## 이 파일이 지키는 것
 *
 * - 인증키는 **`DATA_GO_KR_KEY`** 다 — 이미 §4.1 표에 있는 열쇠이고, 새 열쇠가 필요 없다.
 *   ★ 다만 **활용신청은 API 하나하나에 필요하다** (§4.2). 신청 전에는 키가 멀쩡해도
 *     거부되고, 그 증상이 「키가 틀렸다」와 **구분되지 않는다** — 그래서 `diagnose()` 가
 *     승인·키형식·없음·형식 넷으로 갈라 준다.
 * - **Decoding(일반) 인증키**여야 한다. Encoding 키는 한 번 더 인코딩되어 인증만 실패한다.
 * - 호출은 **캐시를 경유**한다 (§4.5). 한 해치는 한 번만 부르면 된다 — TTL 을 길게 잡는다.
 * - 실패는 **격리**한다 (§4.6) — 예외 대신 `{ok:false}` 를 돌려주고, 키가 없으면
 *   `unavailable` 로 그 절을 비운다. **지어내지 않는다.**
 *
 * ★★ **정렬 방향을 확인한다** (§4.4). 이 API 는 월 오름차순으로 준다 — 연 단위로
 *   받아 날짜로 다시 정렬하므로 앞에서 집는 실수는 안 난다.
 */

const { request, buildUrl, redact, looksUrlEncoded } = require('./http');
const cache = require('./cache');
const { normalize } = require('./xml');

/* ★ 쿼터 통을 갈래로 나눈다 (§4.5 · D-85) — 다른 data.go.kr 커넥터와 한 통을 안 쓴다 */
const PROVIDER = 'data.go.kr:kasi';
const BASE = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService';

/** 갈래 넷 — 이름은 화면·요약에 그대로 쓰인다 */
const KINDS = {
  holiday: { path: 'getRestDeInfo', label: '공휴일' },
  term: { path: 'get24DivisionsInfo', label: '24절기' },
  sundry: { path: 'getSundryDayInfo', label: '잡절' },
  anniversary: { path: 'getAnniversaryInfo', label: '기념일' },
};

/* 한 해치는 한 번만 받으면 된다 — 지난 해는 안 바뀌고, 올해 것도 공표 뒤엔 안 바뀐다.
   ★ 다만 **대체공휴일은 뒤늦게 공표되는 일이 있다** (§4.6 지침서 「공휴일 변경」).
     그래서 영원히 캐시하지 않고 30일로 둔다. */
const TTL = 30 * 24 * 3600; /* 초 단위 — cache.through 가 그렇게 받는다 */

function apiKey() { return process.env.DATA_GO_KR_KEY || ''; }
function isAvailable() { return Boolean(apiKey()); }

function unavailable(what) {
  return { ok: false, error: `DATA_GO_KR_KEY 미설정 — ${what} 조회 생략`, unavailable: true };
}

/**
 * ★ Encoding 키를 넣었으면 **부르기 전에** 막는다 — molit.js 와 같은 이유다.
 *   그대로 두면 실패 모습이 「키가 틀렸다」와 구분되지 않아, 키를 재발급받고
 *   다시 넣어도 같은 증상이 난다 (CLAUDE.md §4.1).
 */
function keyFormatError() {
  if (!looksUrlEncoded(apiKey())) return null;
  return {
    ok: false, unavailable: true,
    error: 'DATA_GO_KR_KEY 가 Encoding 인증키다 — data.go.kr 마이페이지에서 '
      + '**Decoding(일반) 인증키**를 복사해 넣어야 한다',
  };
}

/**
 * 왜 안 되는지 **갈라서** 말한다.
 * ★ 이것이 이 커넥터의 급소다. 활용신청 전이면 **키가 멀쩡해도 거부**되는데,
 *   그 응답이 「키가 틀렸다」와 똑같이 생겼다 (§4.2). 갈라 주지 않으면
 *   사장님이 **키를 다시 발급받으시고도 같은 증상**을 보신다.
 */
function diagnose(status, body) {
  const t = String(body || '');
  if (/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|등록되지\s*않은/.test(t)) {
    return { kind: 'approval',
      head: '이 API 에 **활용신청이 안 됐다** — data.go.kr 에서 「특일정보」를 신청한다. '
        + '키 문제가 아니다 (§4.2)' };
  }
  if (/NO_OPENAPI_SERVICE_ERROR|SERVICE\s*ERROR/.test(t)) {
    return { kind: 'endpoint', head: '엔드포인트가 없거나 폐기됐다 — 주소를 다시 본다' };
  }
  if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS|일일\s*트래픽/.test(t)) {
    return { kind: 'quota', head: '하루 호출 한도를 넘었다 — 내일 다시 부른다 (§4.5)' };
  }
  if (status === 401 || status === 403) {
    return { kind: 'key', head: `인증이 거부됐다 (HTTP ${status}) — Decoding 키인지 본다` };
  }
  if (/^\s*</.test(t) && !/<response/i.test(t)) {
    return { kind: 'format', head: 'JSON 을 요청했는데 HTML 이 왔다 — 대개 점검 중이거나 승인 전이다' };
  }
  return { kind: 'unknown', head: `판정하지 못했다 (HTTP ${status})` };
}

async function call(kind, year, month) {
  const spec = KINDS[kind];
  if (!spec) return { ok: false, error: `알 수 없는 갈래: ${kind}` };
  const params = { solYear: String(year), numOfRows: 100, _type: 'json' };
  if (month) params.solMonth = String(month).padStart(2, '0');

  return cache.through(PROVIDER, kind, { year, month: month || 0 }, async () => {
    const url = buildUrl(`${BASE}/${spec.path}`, { ...params, serviceKey: apiKey() });
    const r = await request(url);
    if (!r.ok) {
      const d = diagnose(r.status, r.body);
      return { ok: false, error: redact(r.error || d.head), why: d.kind, head: d.head,
        /* ★ 본문 앞머리를 남긴다 (§4 「진단부터 짠다」) — 값은 안 남긴다(redact) */
        sample: redact(String(r.body || '').slice(0, 300)) };
    }
    const parsed = normalize(r.body);
    if (!parsed.ok) {
      const d = diagnose(r.status, r.body);
      return { ok: false, error: redact(parsed.error), why: d.kind, head: d.head,
        sample: redact(String(r.body || '').slice(0, 300)) };
    }
    return { ok: true, value: parsed.items };
  }, { ttl: TTL });
}

/** `20260217` · `2026-02-17` 어느 쪽으로 와도 `2026-2-17` 로 편다 (표가 쓰는 모양) */
function toKey(locdate) {
  const s = String(locdate || '').replace(/\D/g, '');
  if (s.length !== 8) return null;
  return `${Number(s.slice(0, 4))}-${Number(s.slice(4, 6))}-${Number(s.slice(6, 8))}`;
}

/**
 * 한 해치를 갈래별로 받아 `[{date, name, kind, isHoliday}]` 로 돌려준다.
 * @param {number} year
 * @param {string[]} kinds 기본 넷 전부
 */
async function year(y, kinds = Object.keys(KINDS)) {
  if (!isAvailable()) return unavailable('특일정보');
  const bad = keyFormatError(); if (bad) return bad;

  const out = [];
  const errors = [];
  for (const kind of kinds) {
    const r = await call(kind, y);
    if (!r.ok) { errors.push({ kind, label: KINDS[kind].label, error: r.error, why: r.why, head: r.head, sample: r.sample }); continue; }
    for (const it of (r.value || [])) {
      const date = toKey(it.locdate);
      const name = String(it.dateName || '').trim();
      if (!date || !name) continue;
      out.push({ date, name, kind, label: KINDS[kind].label,
        /* `isHoliday` 는 공휴일 갈래에만 온다 ('Y'/'N') */
        isHoliday: kind === 'holiday' ? String(it.isHoliday || 'Y').toUpperCase() === 'Y' : false });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name < b.name ? -1 : 1));
  /* ★ 하나라도 받았으면 ok 다 — 한 갈래가 죽어도 나머지는 쓴다 (§4.6 실패 격리) */
  return { ok: out.length > 0, value: out, errors, year: y };
}

module.exports = { year, diagnose, isAvailable, KINDS, toKey, PROVIDER };
