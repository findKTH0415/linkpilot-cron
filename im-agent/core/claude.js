'use strict';
/**
 * claude.js — **자료를 읽는 두 번째 길** (Anthropic Messages API) 〈2026-08-29 · D-167〉.
 *
 * ★★★ 왜 만드나 — 읽는 길이 **하나뿐이었다.**
 *
 *   사장님이 PDF 여덟을 올리셨는데 셋을 한 글자도 못 읽었다. 그 셋은
 *   **글자의 58~100% 가 ToUnicode 없이 코드값으로만** 들어 있는 PDF 라
 *   그대로 뽑으면 깨진 글자가 수치처럼 들어간다 — 그래서 OCR 로 넘어가는데,
 *   그 OCR 이 **Gemini 하나**였고 그날 열쇠가 전부 막혀 있었다(D-166).
 *
 *   D-166 으로 열쇠가 되살아나게는 했지만, 그것은 **같은 길을 고친 것**이다.
 *   한도가 정말 찬 날에는 여전히 한 글자도 못 읽는다. 그래서 **다른 회사의
 *   다른 길**을 하나 더 둔다. 둘이 같이 막힐 일은 거의 없다.
 *
 * ★★ **새 라이브러리를 들이지 않는다** (CLAUDE.md §5). 공식 SDK 가 있지만
 *   이 엔진은 NAS 에서 도는 한 프로세스고 배포가 `npm install` 을 돌리지
 *   않는다 — 의존성을 하나 더 얹으면 **배포한 날 엔진이 안 뜬다.**
 *   Gemini 도 같은 이유로 `fetch` 로 부른다. 여기도 그 결을 따른다.
 *
 * ★ **열쇠 이름을 하나로 못 박지 않는다.** 사장님이 넣으신 이름이
 *   `CLODE_API_Key2` 였다 — `CLAUDE` 가 아니라 `CLODE` 다. 이름 하나만
 *   기다리면 **오류 없이 조용히 안 읽힌다.** 그래서 여러 철자를 다 받고,
 *   **찾은 이름을 말해 준다** (값은 한 글자도 안 남긴다 · §2).
 */

const https = require('https');

require('./env').ensure();

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/** 이 저장소가 쓰는 모델. 바꾸려면 여기 한 곳만 고친다 */
const MODEL = 'claude-opus-5';

/**
 * 열쇠 이름으로 받아들이는 철자들.
 *
 * ★★★ `CLODE` 는 오타가 아니라 **실제로 들어온 이름**이다 〈2026-08-29〉.
 *   「맞는 철자만 받는다」로 두면 사장님은 넣으셨다고 알고, 엔진은 없다고 하고,
 *   **둘 다 그 사실을 모른다** (M-40 이 기록한 사고 그대로다).
 */
const KEY_PATTERN = /^(CLAUDE|CLODE|ANTHROPIC)_API_?KEY(_?\d+)?$/i;

/** 인라인으로 보낼 수 있는 크기. 요청 한도 32MB 에 여유를 둔다 */
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

/** 이 길이 읽을 수 있는 것 — Gemini 목록과 **일부러 다르다**(겹치는 것만 둔다) */
const MIME_OK = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
]);

/**
 * 들어와 있는 열쇠의 **이름**을 찾는다. 값은 돌려주지 않는다.
 * @returns {string|null}
 */
function keyName() {
  const names = Object.keys(process.env)
    .filter(n => KEY_PATTERN.test(n))
    .filter(n => String(process.env[n] || '').trim().length >= 20)
    .sort();
  return names.length ? names[0] : null;
}

/** 이름을 여럿 넣어 두면 어느 것을 쓰는지 헷갈린다 — 진단이 그것을 말한다 */
function allKeyNames() {
  return Object.keys(process.env)
    .filter(n => KEY_PATTERN.test(n))
    .filter(n => String(process.env[n] || '').trim().length >= 20)
    .sort();
}

function available() { return !!keyName(); }

/** 사람이 읽는 상태. **값은 한 글자도 안 적는다** (§2) */
function diagnose() {
  const found = allKeyNames();
  const seen = Object.keys(process.env).filter(n => KEY_PATTERN.test(n));
  if (found.length) {
    return {
      ok: true,
      name: found[0],
      text: `두 번째 읽기 길(Claude): 켜짐 — 열쇠 이름 ${found[0]}`
        + (found.length > 1 ? ` (${found.length}개 들어와 있어 첫 이름을 쓴다: ${found.join(' · ')})` : ''),
    };
  }
  if (seen.length) {
    return {
      ok: false,
      name: null,
      text: `두 번째 읽기 길(Claude): **꺼짐** — 이름은 있는데 값이 비었거나 너무 짧다 (${seen.join(' · ')})`,
    };
  }
  return {
    ok: false,
    name: null,
    text: '두 번째 읽기 길(Claude): 꺼짐 — 열쇠가 없다 '
      + '(CLAUDE_API_KEY · CLODE_API_KEY2 · ANTHROPIC_API_KEY 중 아무 이름이나 받는다)',
  };
}

class ClaudeOfflineError extends Error {
  constructor(message) { super(message); this.name = 'ClaudeOfflineError'; this.code = 'CLAUDE_NO_KEY'; }
}

/** 파일 하나를 본문 블록으로 — PDF 와 그림은 블록 종류가 다르다 */
function fileBlock(f) {
  const mime = String(f.mime || '');
  if (!MIME_OK.has(mime)) throw new Error(`${mime} 는 이 길로 못 읽는다`);
  const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
  if (data.length > MAX_INLINE_BYTES) {
    throw new Error(`파일이 커서 한 번에 못 보낸다 (${Math.round(data.length / 1048576)}MB · 한도 ${MAX_INLINE_BYTES / 1048576}MB)`);
  }
  const source = { type: 'base64', media_type: mime, data: data.toString('base64') };
  return mime === 'application/pdf'
    ? { type: 'document', source }
    : { type: 'image', source };
}

function post(body, timeoutMs, key) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(text)); }
          catch (e) { reject(new Error('답을 못 알아들었다: ' + e.message)); }
          return;
        }
        /* ★ 상태코드를 실어 보낸다 — 부르는 쪽이 「한도」와 「열쇠」를 갈라야 한다 */
        const err = new Error(`HTTP ${res.statusCode} · ${text.slice(0, 300)}`);
        err.status = res.statusCode;
        reject(err);
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`시간 초과 (${timeoutMs}ms)`)); });
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * 글자를 받아 온다.
 *
 * @param {{system?:string, prompt:string, files?:Array<{mime:string,data:Buffer}>,
 *          maxOutputTokens?:number, timeoutMs?:number}} opts
 * @returns {Promise<string>}
 */
async function generate(opts) {
  const o = opts || {};
  const name = keyName();
  if (!name) throw new ClaudeOfflineError('Claude 열쇠가 없다 — 이 길은 꺼져 있다');
  const key = String(process.env[name]).trim();

  const content = [];
  (o.files || []).forEach(f => content.push(fileBlock(f)));
  content.push({ type: 'text', text: String(o.prompt || '') });

  const body = {
    model: MODEL,
    max_tokens: o.maxOutputTokens || 8192,
    messages: [{ role: 'user', content }],
  };
  if (o.system) body.system = String(o.system);

  const res = await post(body, o.timeoutMs || 180000, key);

  /* ★ 거절도 200 으로 온다. `content` 를 보기 전에 **왜 멈췄는지**부터 본다 */
  if (res.stop_reason === 'refusal') {
    const why = (res.stop_details && res.stop_details.category) || '사유 없음';
    throw new Error(`읽기를 거절했다 (${why})`);
  }
  const text = (res.content || [])
    .filter(b => b && b.type === 'text')
    .map(b => b.text)
    .join('');
  if (!String(text).trim()) throw new Error('빈 답이 왔다');
  return text;
}

module.exports = {
  generate, available, keyName, allKeyNames, diagnose,
  ClaudeOfflineError, MODEL, MIME_OK, MAX_INLINE_BYTES, KEY_PATTERN, API_VERSION, ENDPOINT,
};
