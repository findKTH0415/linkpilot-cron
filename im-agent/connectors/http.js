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

const DEFAULT_TIMEOUT = 15000;
const RETRY_DELAYS = [1000, 2000, 4000]; // 1s, 2s, 4s

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 재시도해도 소용없는 오류 (인증·요청 오류) */
function isFatalStatus(status) {
  return status === 400 || status === 401 || status === 403 || status === 404;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.binary] 본문을 Buffer 로 받는다 (ZIP 등 — 텍스트로 읽으면 깨진다)
 * @returns {Promise<{ok:boolean, status?:number, body?:string|Buffer, error?:string, attempts:number}>}
 */
async function request(url, {
  timeoutMs = DEFAULT_TIMEOUT, headers = {}, method = 'GET', binary = false,
  // ★ 이름이 `body` 면 아래 응답 본문(`const body`)과 겹쳐 **모든 호출이 죽는다.**
  //   섀도잉이라 문법 오류도 안 나고, `Cannot access 'body' before initialization`
  //   이라는 엉뚱한 메시지만 남는다 (실제로 그렇게 만들었다가 교차검증에서 잡았다).
  requestBody = undefined,
} = {}) {
  let lastError = null;

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

      if (r.ok) return { ok: true, status: r.status, body, attempts: attempt + 1 };

      lastError = `HTTP ${r.status}`;
      if (isFatalStatus(r.status)) {
        return { ok: false, status: r.status, error: `${lastError} (재시도 무의미)`, body, attempts: attempt + 1 };
      }
    } catch (e) {
      lastError = e.name === 'AbortError' ? `타임아웃 ${timeoutMs}ms` : e.message;
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: `${lastError} (${RETRY_DELAYS.length + 1}회 시도 실패)`, attempts: RETRY_DELAYS.length + 1 };
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
  'DATA_GO_KR_KEY',
  'ECOS_API_KEY',      // 20자쯤 — 안 걸린다
  'DART_API_KEY',
  'GEMINI_API_KEY',
  'KMA_APIHUB_KEY',    // 22자쯤 — 안 걸린다 (기상청 API허브)
  'REB_API_KEY',       // 32자쯤 — 안 걸린다 (한국부동산원 R-ONE)
  'KOSIS_API_KEY',     // 40자쯤 (통계청 공유서비스) — 쿼리에 들어간다
  'LAW_OC',            // 국가법령정보 — 아주 짧아 패턴에 절대 안 걸린다
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
];

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

module.exports = { request, buildUrl, redact, sleep, looksUrlEncoded, SECRET_ENV, DEFAULT_TIMEOUT };
