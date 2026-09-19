'use strict';
/**
 * http.js — 외부 API 호출 공통 계층.
 *
 * 규칙:
 *  - 3회 재시도(지수 백오프) 후 실패하면 예외를 던지지 않고 {ok:false} 를 돌려준다.
 *    한 소스가 죽어도 IM 생성 전체를 죽이지 않는다.
 *  - 타임아웃 필수. 무한 대기로 크론/CI를 잡아먹지 않는다.
 *  - 응답은 호출자가 캐시한다 (cache.js).
 */

/* ★★★ **키를 읽기 전에 `.env` 를 올린다** 〈2026-08-23〉.
 *   커넥터의 `isAvailable()` 은 부르는 순간 `process.env` 를 본다. 그전에
 *   `.env` 가 안 올라와 있으면 **전부 「키 없음」으로 조용히 건너뛴다** —
 *   NAS 엔진이 정확히 그 상태였다. 모든 커넥터가 이 파일을 거치므로 여기서 한다. */
require('../core/env').ensure();

const DEFAULT_TIMEOUT = 15000;
const RETRY_DELAYS = [1000, 2000, 4000]; // 1s, 2s, 4s

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 재시도해도 소용없는 오류 (인증·요청 오류) */
function isFatalStatus(status) {
  return status === 400 || status === 401 || status === 403 || status === 404;
}

/* ★★★ **5xx 를 «누가 냈는지»는 헤더가 말한다 — 다만 «정해 둔 이름만» 담는다** 〈D-219〉.
 *   [왜] D-218 이 본문을 되살렸는데, 브이월드가 돌려준 502 본문에는 **서버 서명이 없었다**
 *     (`502 Bad Gateway` 한 줄). 그래서 **기관 게이트웨이인지 중간의 프록시인지** 아직 못 가린다.
 *     할 일이 정반대다 — 앞은 「기다렸다 다시」, 뒤는 「도는 자리를 옮긴다」 (§12-31).
 *   ★ `Server` 한 줄만 있어도 대개 갈린다. `Via`·`X-Cache`·`CF-Ray` 는 **중간이 끼었다**는 표다.
 *   ★★ **전부 담지 않는다.** 응답 헤더에는 쿠키·인증 챌린지가 섞여 올 수 있어,
 *     통째로 나르면 그 자리에서 샌다 (§2 · §4.6 「진단 답을 통째로 찍지 않는다」와 같은 규칙).
 *     그래서 **허용목록**이다 — 새 이름을 더할 때는 그 이름이 값을 나를 수 없는지 먼저 본다.
 *   ★★★ 값은 부르는 쪽이 `redact()` 를 지나게 한다 — `bodyHead` 와 같은 길이다. */
const SAFE_RESPONSE_HEADERS = [
  'server',          // nginx / Apache / … — 대답한 자리의 서명
  'via',             // 중간에 낀 프록시가 스스로 적는다
  'x-cache', 'x-cache-hits', 'x-served-by', 'x-varnish',   // CDN 캐시 계열
  'cf-ray', 'cf-cache-status',                              // Cloudflare
  'x-amz-cf-id',                                            // CloudFront
  'x-powered-by',
  'age',
  'content-type',    // XML 을 부탁했는데 HTML 이 오면 대개 안내 페이지다
];

/** 응답에서 위 이름만 골라 평평한 객체로 돌려준다 (없는 이름은 안 담는다) */
function pickHeaders(r) {
  const out = {};
  if (!r || !r.headers || typeof r.headers.get !== 'function') return out;
  for (const name of SAFE_RESPONSE_HEADERS) {
    const v = r.headers.get(name);
    if (v) out[name] = String(v).slice(0, 200);
  }
  return out;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.binary] 본문을 Buffer 로 받는다 (ZIP 등 — 텍스트로 읽으면 깨진다)
 * @returns {Promise<{ok:boolean, status?:number, body?:string|Buffer, headers?:object, error?:string, attempts:number}>}
 *   `headers` 는 SAFE_RESPONSE_HEADERS 에 적힌 이름만 담는다 — 통째로 담지 않는다 (§2)
 */
async function request(url, {
  timeoutMs = DEFAULT_TIMEOUT, headers = {}, method = 'GET', binary = false,
  // ★ 이름이 `body` 면 아래 응답 본문(`const body`)과 겹쳐 **모든 호출이 죽는다.**
  //   섀도잉이라 문법 오류도 안 나고, `Cannot access 'body' before initialization`
  //   이라는 엉뚱한 메시지만 남는다 (실제로 그렇게 만들었다가 교차검증에서 잡았다).
  requestBody = undefined,
} = {}) {
  let lastError = null;
  // ★★★ **재시도로 끝난 응답의 «본문을 버리지 않는다»** 〈D-218〉.
  //   [왜] 5xx 가 네 번 나면 예전에는 `HTTP 502` 라는 **글자만** 남고
  //   응답 본문을 통째로 버렸다. 그러면 **그 502 를 누가 냈는지**를
  //   가릴 재료가 없다 — 기관 게이트웨이인지, 중간의 프록시인지.
  //   할 일이 **정반대**인데(기다렸다 다시 / 도는 자리를 옛긴다) 한 글자로 뭉개졌다.
  //   §6-2-6 「받자마자 버린 것」 · §12-10 「무엇을 버리는지 본다」와 같은 고장이다.
  // ★ 값은 부르는 쪽이 `redact()` 를 지나게 한다 (§2).
  let lastStatus, lastBody, lastHeaders;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS[attempt - 1]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // ★ body 가 있으면 POST 다. 재시도해도 되는지는 **부르는 쪽이** 판단한다 —
      //   여기서는 같은 요청을 그대로 다시 보낸다. 부수효과가 있는 POST 라면
      //   이 헬퍼를 쓰면 안 된다 (Rhino.Compute 의 풀이는 순수 함수라 안전하다)
      const init = { method, headers, signal: controller.signal };
      if (requestBody !== undefined) init.body = requestBody;
      const r = await fetch(url, init);
      const body = binary ? Buffer.from(await r.arrayBuffer()) : await r.text();

      if (r.ok) return { ok: true, status: r.status, body, headers: pickHeaders(r), attempts: attempt + 1 };

      lastError = `HTTP ${r.status}`;
      lastStatus = r.status; lastBody = body; lastHeaders = pickHeaders(r);
      if (isFatalStatus(r.status)) {
        return { ok: false, status: r.status, error: `${lastError} (재시도 무의미)`, body, headers: lastHeaders, attempts: attempt + 1 };
      }
    } catch (e) {
      lastError = e.name === 'AbortError' ? `타임아웃 ${timeoutMs}ms` : e.message;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    error: `${lastError} (${RETRY_DELAYS.length + 1}회 시도 실패)`,
    status: lastStatus,
    body: lastBody,
    headers: lastHeaders,
    attempts: RETRY_DELAYS.length + 1,
  };
}

/** 쿼리스트링 조립. 값이 null/undefined 인 항목은 제외한다. */
function buildUrl(base, params = {}) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * URL 인코딩된 문자열인가 — data.go.kr 의 **Encoding 인증키**를 잡아내려고 있다.
 *
 * data.go.kr 은 인증키를 Encoding / Decoding 두 벌로 준다. 화면 위쪽에 있는 것이
 * Encoding 이라 그냥 복사하면 그쪽을 집는다. 그런데 `buildUrl` 은 파라미터를 한 번
 * 더 인코딩하므로 `%2F` 가 `%252F` 가 되고 **인증만 실패한다.**
 *
 * 이게 나쁜 이유는 실패 모습이 "키가 틀렸다"와 똑같다는 것이다. 키를 재발급받고
 * 다시 넣어도 같은 증상이 나서, 원인에 도달하기까지 몇 시간이 걸린다.
 * 그래서 호출하기 전에 잡아 이름을 붙여 준다.
 */
function looksUrlEncoded(value) {
  const s = String(value || '');
  if (!/%[0-9A-Fa-f]{2}/.test(s)) return false;
  // 되돌려서 달라지면 인코딩된 것이다 (원문에 % 가 우연히 들어간 경우와 구분)
  try { return decodeURIComponent(s) !== s; } catch (_) { return false; }
}

/**
 * 로그·오류에 평문으로 남으면 안 되는 환경변수 이름.
 *
 * ★ **커넥터를 새로 붙이면 여기에 키 이름을 더한다.** 빠뜨리면 그 키만 조용히
 *   평문으로 남는다 — 다른 키가 다 가려져 있어서 눈에 띄지도 않는다.
 */
const SECRET_ENV = [
  'VWORLD_KEY',        // 36자 (UUID) — 길이 규칙에 안 걸린다
  // ★ 같은 VWorld 열쇠의 다른 이름 둘 — 사장님이 이 이름으로 넣으셨다
  //   (connectors/vworldkey.js 의 KEY_NAMES) — 2026-09-17
  'LINKPILOT_VWORLD_REPORT_KEY', 'LINKPILOT_VWORLD_WEB_KEY',
  'DATA_GO_KR_KEY',
  // ★ 같은 공공데이터포털 키의 다른 이름 — 사장님이 이 이름으로 넣으셨다
  //   (connectors/datakey.js 의 KEY_NAMES) — 2026-09-13
  'APIS_DATA',
  'ECOS_API_KEY',      // 20자쯤 — 안 걸린다
  'ECOS_BOK_KEY',      // 같은 한국은행 키의 다른 이름 (ecos.js KEY_NAMES) — 2026-08-26
  'DART_API_KEY',
  // ★★★ 길찾기 소요시간 — 자동차·대중교통은 출처가 다르다 〈2026-09-15 사장님 승인: 「둘 다」〉.
  //   **열쇠가 들어오기 «전»에 여기 먼저 넣는다** — 넣으신 날 바로 가려지게 하려는 것이다.
  //   여기 없으면 그 값이 로그·오류 본문에 평문으로 남는다 (CLAUDE.md §2).
  //   ★ 이름을 둘씩 읽는다 — 갈리면 아무 오류도 안 나고 조용히 죽는다 (ECOS·LAW 에서 두 번 당했다)
  //   ★★★ **세 번째 철자가 «실제로» 들어왔다** 〈2026-09-19 사장님: 「KAKAO_MOBILITY_REST_API 넣었어」〉.
  //     다시 넣으시라고 하지 않는다 — **읽는 이름을 늘린다**. 그것이 ECOS·LAW 에서 정한 답이다.
  'KAKAO_MOBILITY_KEY', 'KAKAOMOBILITY_KEY', 'KAKAO_MOBILITY_REST_API',
  'ODSAY_API_KEY', 'ODSAY_KEY',
  'GEMINI_API_KEY',
  // ★★ 여섯 슬롯 (D-110 · 지시서 §3). `GEMINI_API_KEY` 를 지우지 않는다 —
  //   지금 NAS 에 들어 있는 유일한 열쇠이고, 새 이름으로 옮기기 전에도 돌아야
  //   한다. 여섯을 여기 빠뜨리면 **그 여섯만** 로그에 평문으로 남는다
  'GEMINI_KEY_01', 'GEMINI_KEY_02', 'GEMINI_KEY_03', 'GEMINI_KEY_04',
  'GEMINI_KEY_05', 'GEMINI_KEY_06', 'GEMINI_KEY_07', 'GEMINI_KEY_08',
  // ★★ **사장님이 실제로 넣으신 이름**이다 〈2026-08-25〉. 내가 안내한 이름과
  //   달랐는데, 다시 넣으시라고 하는 대신 둘 다 읽게 했다. 여기 빠뜨리면
  //   **이 일곱만** 로그에 평문으로 남는다
  'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5',
  'GEMINI_API_KEY_6', 'GEMINI_API_KEY_7', 'GEMINI_API_KEY_8',
  // ★★★ **자료를 읽는 두 번째 길의 열쇠** 〈2026-08-29 · D-167〉.
  //   철자를 하나로 못 박지 않는다 — 사장님이 넣으신 이름이 `CLODE_API_Key2`
  //   였다(`CLAUDE` 가 아니라 `CLODE`). 여기 빠뜨리면 **그 이름만** 로그에
  //   평문으로 남는다. `core/claude.js` 의 KEY_PATTERN 과 짝이다.
  'CLAUDE_API_KEY', 'CLAUDE_API_KEY_2',
  'CLODE_API_KEY', 'CLODE_API_KEY2', 'CLODE_API_KEY_2',
  'ANTHROPIC_API_KEY',
  'KMA_APIHUB_KEY',    // 22자쯤 — 안 걸린다 (기상청 API허브)
  // ★ 날씨 열쇠 — 사장님이 2026-09-13 에 넣으셨다. **어느 시스템인지는 아직 안 쟀다**
  //   (`_GO` 가 붙어 data.go.kr 로 보이지만 추측으로 배선하지 않는다 — §4.3).
  //   ★ 규격을 모르더라도 **가리는 것은 지금 한다** — 진단 로그에 값이 찍힐 자리가 먼저 온다.
  'WEATHER_GO',
  // ★★★ **세계뉴스 열쇠 — 이름을 «화면에서» 읽었다** 〈2026-09-13 · 사장님 화면 · 실측〉.
  //   [무엇이 났나] 사장님이 말씀으로 주신 이름은 `WORLD_NES_KEY` 였는데, 비밀 목록에는
  //     그 이름이 **없었다.** 실제로 들어 있는 것은 **`WORLDWIDE_NEWS`** 와
  //     **`WORLD_NEWS_API`** 둘이다. 말씀만 믿고 등록했으면 **그 둘이 로그에 평문으로
  //     남았을 것**이고, 부르는 코드도 빈 값을 읽었을 것이다 (§2 · §4.1).
  //   ★ **이름은 화면에서 읽는다.** 「들었다」와 「들어 있다」는 다른 사실이다.
  //   ★★ 말씀하신 철자도 함께 둔다 — 나중에 그 이름으로 넣으셔도 안 죽는다.
  //     없는 이름은 그냥 건너뛰므로 두어도 해가 없다.
  //   ★★★ 규격(베이스 URL·인증 파라미터)은 **아직 모른다.** 추측으로 파라미터를 넣지 않고
  //     열쇠가 있는 자리에서 진단부터 돌린다 (CLAUDE.md §4.3 「진단부터 짠다」).
  'WORLDWIDE_NEWS', 'WORLD_NEWS_API',
  'WORLD_NES_KEY', 'WORLD_NEWS_KEY',
  'REB_API_KEY',       // 32자쯤 — 안 걸린다 (한국부동산원 R-ONE)
  'KOSIS_API_KEY',     // 40자쯤 (통계청 공유서비스) — 쿼리에 들어간다
  'LAW_OC',            // 국가법령정보 — 아주 짧아 패턴에 절대 안 걸린다
  // ★ 같은 값을 이 이름으로도 넣으셨다 (2026-08-25 실측). 둘 다 읽고 둘 다 가린다
  'LAW_OPEN_DATA',
  'RHINO_COMPUTE_KEY', // Rhino.Compute 서버 접근키
  // ★ 키는 아니지만 **사내 주소**다 (§2 「NAS 접속정보」와 같은 줄).
  //   지금 Node fetch 는 실패 메시지에 호스트를 안 넣지만, 런타임이 바뀌거나
  //   누가 디버그 로그에 주소를 찍는 날 그대로 새어 나간다 — 미리 가려 둔다
  'RHINO_COMPUTE_URL',
  // ★ 이것도 키가 아니라 **사내 주소**다. VWorld 콘솔에 등록한 서비스URL 인데
  //   실제 값이 NAS 주소이고(`.env.example` 의 예시가 그렇다), **모든 VWorld
  //   요청의 쿼리에 실려 나간다** — RHINO_COMPUTE_URL 보다 노출 면이 넓다.
  //   CLAUDE.md §2 의 「NAS 접속정보」와 같은 줄이다 (2026-08-16 교차검증에서 발견).
  'VWORLD_DOMAIN',
  // ★ **Authorization 헤더**로 나가는 키다. `key=` 패턴에도 안 걸리고 길이도
  //   56자라 일반 규칙에는 걸리지만, 헤더 경로라 명시해 두는 편이 안전하다
  'PEXELS_API_KEY',
  // ★ 전력데이터개방포털(bigdata.kepco.co.kr) **자체 발급키**다. data.go.kr 키와
  //   전혀 다른 계통이라 같이 묶어 두면 어느 쪽이 새는지 구분이 안 된다 (D-54)
  'KEPCO_BIGDATA_KEY',
  // ★ 한국건설기술연구원 자체 발급키 (건설공사비). data.go.kr 키와 다른 계통이다 —
  //   같이 묶으면 어느 쪽이 새는지 구분이 안 된다 (KEPCO 와 같은 이유, D-54)
  'KICT_API_KEY',
  // ★ World News API 인증키 〈2026-09-01 · v1.3 규정집 4-B〉. 이름에 `_KEY` 가 없어
  //   설정값처럼 보이지만 **값은 인증키**다 — 이름만 보고는 안 걸러진다.
  //   ★★ 지금 이 값을 쓰는 것은 엔진이 아니라 **앱**이다 (D-141 · 웹루트 봉인 파일).
  //     그래도 여기 둔다 — 배포가 NAS 열쇠 파일에 함께 싣고, 누가 엔진 쪽에서
  //     뉴스를 부르는 날 **그날부터** 값이 오류 본문에 남는다. 미리 가려 둔다
  //     (RHINO_COMPUTE_URL · VWORLD_DOMAIN 과 같은 줄)
  'WORLDWIDE_NEWS',
  // ★ 키는 아니지만 **엔드포인트 주소**다. 확정 전까지 값이 사내 경유지가 될 수
  //   있어 미리 가려 둔다 (VWORLD_DOMAIN 과 같은 줄)
  'KICT_API_BASE',
  // ★★ 사용자 클라우드 저장소 OAuth (D-65). 여기 키들은 성격이 다르다 —
  //   **자료 한 건이 아니라 그 사용자 드라이브 범위 전체로 가는 열쇠**다.
  //   자료를 보관하지 않기로 했으므로 우리가 가진 것 중 가장 값나가는 것이
  //   이것이 된다. 절대 로그에 남기지 않는다 (§2).
  'DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET',
  'BOX_CLIENT_ID', 'BOX_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'MS_CLIENT_ID', 'MS_CLIENT_SECRET',
];

/**
 * 위에서 고른 헤더를 «한 줄»로 편다 — 커넥터가 요약에 실을 모양이다.
 *
 * ★ **여기 한 벌만 둔다** — 커넥터마다 적으면 한쪽이 옛말을 한다 (§8-1).
 * ★★ 값은 `redact()` 를 지나간다 (§2). 헤더에 열쇠가 실려 오는 일이 실제로 있다
 *   (되비추는 안내 페이지가 요청을 그대로 되돌려주는 경우).
 * ★★★ **부르는 쪽은 이것을 `error` 글자에 안 섞는다** — 그 글자로 「다음 열쇠로
 *   넘어갈지」를 정하는 자리가 있어(vworld 의 `isAuthReject`), `WWW-Authenticate`
 *   같은 낱말 하나에 **엉뚱한 갈래로 넘어간다.** 새 칸으로 나른다.
 */
function fmtHeaders(h) {
  if (!h || typeof h !== 'object') return '';
  const parts = Object.keys(h).map((k) => `${k}: ${h[k]}`);
  if (!parts.length) return '';
  return redact(parts.join(' · ')).slice(0, 300);
}

/**
 * 로그·에러 메시지에서 서비스키를 가린다 (시크릿 평문 노출 금지).
 *
 * ★ 규칙 두 개로는 부족한 경우가 있다. ECOS 는 키를 **URL 경로**에 넣고 길이도
 *   20자쯤이라 `key=` 패턴에도, 40자 이상 규칙에도 안 걸린다. 그런 커넥터는
 *   자기 키를 `extra` 로 넘겨 명시적으로 가린다 — 우연히 가려지는 데 기대지 않는다.
 *
 * @param {string} text
 * @param {string[]} [extra] 반드시 가려야 하는 값 (빈 문자열은 무시한다)
 */
function redact(text, extra) {
  let out = String(text)
    .replace(/(serviceKey|key|apiKey|authKey|OC)=[^&\s]+/gi, '$1=***')
    .replace(/[A-Za-z0-9%+/=]{40,}/g, '***');

  // ★ 길이 규칙(40자 이상)에 **안 걸리는 키가 있다.** VWorld 는 36자(UUID),
  //   기상청은 22자쯤, ECOS 는 20자쯤이다. 그 키들이 경로나 오류 본문에 실려
  //   나가면 로그에 평문으로 남는다 — CLAUDE.md §2 절대 규칙 위반이다.
  //   그래서 **환경변수에 들어 있는 값을 이름으로 찾아 직접 가린다.**
  //   커넥터를 새로 붙이면 이 목록에 키 이름을 더한다.
  SECRET_ENV.forEach((name) => {
    const v = process.env[name];
    if (!v || String(v).length < 8) return;   // 짧으면 본문을 통째로 망가뜨린다
    out = out.split(v).join('***');
    out = out.split(encodeURIComponent(v)).join('***');
  });

  (extra || []).forEach((secret) => {
    const s = String(secret || '');
    if (s.length < 8) return;   // 너무 짧으면 본문을 통째로 망가뜨린다
    out = out.split(s).join('***');
    out = out.split(encodeURIComponent(s)).join('***');
  });
  return out;
}

module.exports = { request, buildUrl, redact, sleep, looksUrlEncoded, SECRET_ENV, SAFE_RESPONSE_HEADERS, pickHeaders, fmtHeaders, DEFAULT_TIMEOUT };
