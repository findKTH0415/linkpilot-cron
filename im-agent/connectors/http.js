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
async function request(url, { timeoutMs = DEFAULT_TIMEOUT, headers = {}, method = 'GET', binary = false } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS[attempt - 1]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { method, headers, signal: controller.signal });
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
    .replace(/(serviceKey|key|apiKey|authKey)=[^&\s]+/gi, '$1=***')
    .replace(/[A-Za-z0-9%+/=]{40,}/g, '***');

  (extra || []).forEach((secret) => {
    const s = String(secret || '');
    if (s.length < 8) return;   // 너무 짧으면 본문을 통째로 망가뜨린다
    out = out.split(s).join('***');
    out = out.split(encodeURIComponent(s)).join('***');
  });
  return out;
}

module.exports = { request, buildUrl, redact, sleep, looksUrlEncoded, DEFAULT_TIMEOUT };
