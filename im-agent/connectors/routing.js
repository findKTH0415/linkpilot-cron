'use strict';
/**
 * routing.js — 길찾기 **소요시간** Connector (D-246).
 *
 * 무엇에 쓰는가: 브리핑의 동선 카드가 「대중교통 · 자동차」 여는 길만 주고
 * **소요시간은 「아직 못 잽니다」라고 적고 있다** (CLAUDE.md §12). 거리 어림으로
 * 「약 40분」을 적으면 사장님이 그 시각을 믿고 **늦으신다** — 값이 없는 것보다
 * 훨씬 나쁘다 (§4.6 · 지침 v2.0 §17.2). 그래서 **출처 있는 값**이 필요했다.
 *
 * ★★★ **이 파일은 «잰 값»으로만 적혀 있다** 〈2026-09-20 · Actions 진단 실행 · D-246〉.
 *   `scripts/routing-probe.mjs` 가 열쇠가 있는 자리에서 실제로 걸어 본 결과다 —
 *   베이스 URL · 인증 방식 · 좌표 파라미터 · **응답의 칸 이름과 자리**까지.
 *   추측으로 박은 줄이 **한 줄도 없다** (§4.3 — R-ONE 은 이것을 안 해서 여섯 번 다시 썼다).
 *
 *   잰 값 (서울시청 → 강남역):
 *     `GET https://apis-navi.kakaomobility.com/v1/directions?origin=<x>,<y>&destination=<x>,<y>`
 *     `Authorization: KakaoAK <키>` · HTTP 200 · 1563ms
 *     `routes[0].result_code` = 0 (「길찾기 성공」)
 *     `routes[0].summary.duration` = 1381 (**초**)
 *     `routes[0].summary.distance` = 10679 (**미터**)
 *
 * ★ **자동차만 낸다. 대중교통은 «안 낸다».**
 *   ODsay 는 같은 진단에서 **인증이 거부됐다** — HTTP 200 인데 본문이
 *   `[ApiKeyAuthFailed]` 를 말한다 (D-229 가 그 갈래를 가른다). 열쇠는 66자로
 *   멀쩡히 읽혔으므로 **열쇠가 없는 것이 아니라 등록·신청 쪽**이고, 그것은
 *   사장님이 콘솔에서 보실 일이다. **안 되는 길을 되는 척 그리지 않는다** (§8).
 *   ★ 그러니 부르는 쪽은 **자동차 값만 온다**는 것을 알고 써야 한다 — 대중교통 자리에
 *     자동차 값을 넣으면 그것이 곧 지어낸 값이다 (§4.9 — 자동으로 하나를 고르지 않는다).
 *
 * ★★ **열쇠 이름 셋을 다 읽는다** — 갈리면 아무 오류도 안 나고 조용히 죽는다
 *   (`ECOS_API_KEY`/`ECOS_BOK_KEY` · `LAW_OC`/`LAW_OPEN_DATA` 에서 두 번 당했다).
 *   실측에서 실제로 들어온 것은 **`KAKAO_MOBILITY_REST_API`** 하나였고 나머지 둘은 빈칸이다.
 *   ★ 가리는 일은 `http.js` 의 `SECRET_ENV` 가 한다 — 셋 다 거기 있다 (§2).
 *
 * ★★★ **이것을 만든 것과 화면에 실리는 것은 다른 사실이다** (§8 · §12-19).
 *   나르는 자리는 셋이다 — 커넥터가 실어도 부르는 쪽이 안 읽으면 사라지고,
 *   읽어도 화면이 안 그리면 또 사라진다. 그래서 **브리핑의 「소요시간은 아직 못
 *   잽니다」 줄은 값이 실제로 화면에 올 때까지 그대로 둔다** — 그 줄이 사라지는
 *   날이 소요시간을 실제로 재게 된 날이다.
 *
 * ★ **가정을 안 섞는다** (§4.8). 내는 것은 API 가 돌려준 초·미터 그대로다.
 *   교통 상황·출발 시각 보정 같은 것은 여기서 안 한다.
 */

const http = require('./http');
const cache = require('./cache');

/** 받는 이름 — **앞에 있는 것이 이긴다**. 실측에서 들어온 것은 첫째다 */
const KEY_NAMES = ['KAKAO_MOBILITY_REST_API', 'KAKAO_MOBILITY_KEY', 'KAKAOMOBILITY_KEY'];

const PROVIDER = 'kakaomobility';
const BASE = 'https://apis-navi.kakaomobility.com/v1/directions';

/** 실제로 값이 들어 있는 이름. 없으면 null */
function usedName() {
  return KEY_NAMES.find((n) => (process.env[n] || '').trim()) || null;
}

function apiKey() {
  const n = usedName();
  return n ? String(process.env[n]).trim() : '';
}

function hasKey() {
  return Boolean(apiKey());
}

/** 사람에게 보여 줄 이름 목록 */
function namesText() {
  return KEY_NAMES.join(' 또는 ');
}

/**
 * 좌표가 쓸 수 있는 값인가 — **숫자이고 한반도 언저리**인가.
 * ★ 넓게 잡지 않는다. 엉뚱한 값을 그대로 보내면 API 가 돌려주는 오류가
 *   「열쇠가 틀렸다」와 구분되지 않는다 (§4.2 와 같은 결).
 */
function okPoint(p) {
  if (!p || typeof p !== 'object') return false;
  const x = Number(p.x), y = Number(p.y);
  return Number.isFinite(x) && Number.isFinite(y)
    && x > 124 && x < 132 && y > 33 && y < 39;
}

/**
 * 자동차 소요시간.
 *
 * @param {{x:number,y:number}} from 출발 (x=경도 · y=위도)
 * @param {{x:number,y:number}} to   도착
 * @returns {Promise<object>} 성공: `{ok:true, seconds, meters, source, mode:'car'}`
 *   실패: `{ok:false, reason, error}` — **던지지 않는다** (§4.6 — 한 소스가 죽어도
 *   IM 생성 전체를 죽이지 않는다).
 */
async function carDuration(from, to) {
  if (!hasKey()) {
    return { ok: false, reason: 'unavailable',
      error: `${namesText()} 미설정 — 자동차 소요시간 조회 생략` };
  }
  if (!okPoint(from) || !okPoint(to)) {
    return { ok: false, reason: 'bad-input',
      error: '좌표가 숫자가 아니거나 범위 밖이다 (x 124~132 · y 33~39)' };
  }

  const q = `origin=${from.x},${from.y}&destination=${to.x},${to.y}`;
  const url = `${BASE}?${q}`;
  /* ★ 캐시를 반드시 경유한다 (§4.5). 같은 구간을 하루에 여러 번 묻지 않는다 —
       다만 길찾기는 교통 상황을 타므로 TTL 을 짧게 둔다. */
  const got = await cache.through(PROVIDER, 'car', { ox: from.x, oy: from.y, dx: to.x, dy: to.y }, async () => {
    const r = await http.request(url, { headers: { Authorization: `KakaoAK ${apiKey()}` } });
    if (!r.ok) {
      /* ★ 「못 닿음」과 「거부」를 갈라 적는다 — 할 일이 정반대다 (§4 · D-206).
           상태코드를 못 받았으면 못 닿은 것이고, 그때는 도는 자리를 옮기는 일이다. */
      const kind = (r.status === undefined || r.status === null) ? 'unreachable'
        : (r.status === 401 || r.status === 403) ? 'auth' : 'http';
      return { ok: false, reason: kind, httpStatus: r.status ?? null,
        /* ★ 바깥에서 온 글은 **가린다** — 되비추는 오류에 열쇠가 섞여 올 수 있다 (§2 · D-232).
             이 저장소는 공개다 (D-10). */
        error: http.redact(r.error || `자동차 길찾기 실패 (HTTP ${r.status ?? '못 받음'})`) };
    }

    let body;
    try { body = typeof r.body === 'string' ? JSON.parse(r.body) : r.body; }
    catch (_) {
      /* ★ 「JSON 으로 못 읽었다」를 「그 칸이 없다」와 같은 값으로 적지 않는다 (§8 · D-230) */
      return { ok: false, reason: 'not-json',
        error: '응답이 JSON 이 아니다 — 안내 페이지가 왔을 수 있다 (도는 자리·그쪽 서버)' };
    }

    const route = body && Array.isArray(body.routes) ? body.routes[0] : null;
    if (!route) {
      return { ok: false, reason: 'no-route', error: '경로가 한 건도 안 왔다' };
    }
    /* ★ 카카오는 «길을 못 찾은 것»도 HTTP 200 으로 준다 — `result_code` 가 0 이 아니다.
         상태코드만 보면 성공과 구분이 안 된다 (§4.2 와 같은 결 · D-229). */
    if (Number(route.result_code) !== 0) {
      return { ok: false, reason: 'no-route', httpStatus: 200,
        error: http.redact(`길을 못 찾았다 (result_code ${route.result_code}` +
               `${route.result_msg ? ' · ' + route.result_msg : ''})`) };
    }

    const sec = Number(route.summary && route.summary.duration);
    const met = Number(route.summary && route.summary.distance);
    /* ★ 「대답이 왔다」와 「값이 왔다」는 다른 사실이다 (D-228). 칸이 비면 성공으로 안 센다 —
         `isFinite(null)` 이 참이므로 **숫자인지까지** 본다 (§12-30 에서 겪은 자리). */
    if (!Number.isFinite(sec) || typeof route.summary.duration !== 'number') {
      return { ok: false, reason: 'no-value',
        error: '대답은 왔는데 `routes[0].summary.duration` 이 숫자가 아니다 — 규격이 바뀌었을 수 있다' };
    }

    /* ★ `cache.through` 는 성공 시 `result.value` 만 꺼내 돌려준다 — 그 규격을 따른다.
         안 따르면 **아무 오류 없이 `{ok:true}` 만** 오고 값이 통째로 사라진다 (실측). */
    return { ok: true, value: {
      mode: 'car',
      seconds: sec,
      meters: Number.isFinite(met) && typeof route.summary.distance === 'number' ? met : null,
      /* ★ 값만 옮기지 않는다 — 어디서·언제·어떤 조건으로 나왔는지를 함께 남긴다 (§4.7) */
      source: {
        기관: '카카오모빌리티',
        api: 'apis-navi /v1/directions',
        조회시각: new Date().toISOString(),
        기준: '요청 시점의 추천 경로(RECOMMEND) · 실시간 교통 반영',
        비고: '출발 시각을 지정하지 않은 «지금 출발» 기준이다',
      },
    } };
  }, { ttl: 60 * 60 });   /* ★ 길찾기는 교통 상황을 타므로 TTL 을 짧게 둔다 (§4.5) */
  /* ★ 캐시가 감싼 것을 편다 — 실패는 `through` 가 그대로 흘려보내므로 갈래가 안 사라진다 */
  if (!got.ok) return got;
  return { ok: true, cached: Boolean(got.cached), ...got.value };
}

/**
 * 대중교통 — **아직 못 낸다.**
 * ★ 함수를 굳이 두는 이유는 `kepco.js` 와 같다 — 없으면 「아직 안 붙였나 보다」로
 *   읽히고, 언젠가 누가 자동차 값을 그 자리에 넣는다. **못 하는 이유를 코드가 들고 있어야 한다** (§4.9).
 */
async function transitDuration() {
  return { ok: false, reason: 'auth',
    error: 'ODsay 가 인증을 거부한다 (HTTP 200 · `[ApiKeyAuthFailed]` · 2026-09-20 실측). '
         + '열쇠는 읽혔으므로 **없는 것이 아니라 등록·신청 쪽**이다 — ODsay 콘솔의 서비스 URL 은 '
         + '**프로토콜을 빼고 도메인만** 넣어야 한다(브이월드와 정반대다 · CLAUDE.md §12-39). '
         + '★ 자동차 값을 이 자리에 넣지 않는다 — 그것이 곧 지어낸 값이다 (§4.9)' };
}

module.exports = { carDuration, transitDuration, hasKey, usedName, namesText, KEY_NAMES, okPoint };
