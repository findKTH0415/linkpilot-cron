'use strict';
/**
 * llm.js — Gemini 호출 래퍼. **모든 Agent 가 지나는 하나의 문**이다.
 *
 * ★ 원칙: LLM은 '문장'과 '분류'만 담당한다. 숫자 계산은 finance/ 가 한다.
 * ★ OFFLINE 모드(IM_AGENT_OFFLINE=1 또는 키 없음)에서는 호출 대신 OfflineError를
 *   던져, 각 Agent가 degrade 경로로 빠지게 한다. (전체 파이프라인을 죽이지 않는다)
 *
 * ★★★ **열쇠를 고르는 일은 여기서 하지 않는다** 〈2026-08-25 · D-110〉.
 *   앞 판은 쉼표로 가른 배열을 **그냥 순회**했다. 그래서 429 를 맞은 열쇠를
 *   다음 요청에서 또 먼저 집었고, 401 로 죽은 열쇠를 영원히 다시 집었다.
 *   고르기·거르기·쉬기·되살리기는 전부 `core/gemini-keys.js` 가 한다.
 *   여기는 **부르고, 결과를 그쪽에 알려 주는 것**만 한다.
 *
 * ★★ **404·400 은 열쇠 탓이 아니다.** 아래 모델 목록에는 이 계정에서 안 열리는
 *   모델이 섞여 있다(경위는 바로 아래). 그것을 열쇠 실패로 세면 **멀쩡한 열쇠
 *   여덟이 첫 모델에서 다 죽는다.** 그래서 그 둘은 **다음 모델**로 넘긴다.
 */

const { assertValid } = require('./schema');

/* ★ 2026-08-17 — Gemini 호출 경로가 바뀌었다 (실측).
   새 프로젝트(gen-lang-client-…) 키로는 gemini-2.5/2.0 계열 generateContent 가 전부 404
   "no longer available to new users" 이고, Gemini 3.x 는 **Interactions API**(POST /v1beta/interactions,
   {model,input}) 로만 응답한다(3.7/3.5/3.1 200 확인). generateContent 로 되는 것은 gemma-4 뿐.
   → 기본 모델을 3.x 로 바꾸고, 각 모델을 Interactions → generateContent 순으로 시도한다.
   응답은 steps[].type==='model_output' 의 content[].text 를 잇는다. */
const MODELS = (process.env.GEMINI_MODELS || 'gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite,gemma-4-31b-it')
  .split(',').map(s => s.trim()).filter(Boolean);
/* ★★★ **키를 읽기 전에 `.env` 를 올린다** 〈2026-08-23〉.
 *   그전에 `.env` 가 안 올라와 있으면 **영영 오프라인**이다 — NAS 엔진이
 *   정확히 그 상태였고, 화면은 「GEMINI_API_KEY 가 필요합니다」만 되풀이했다. */
require('./env').ensure();

const keys = require('./gemini-keys');

/** 5xx 재시도 간격 — 지시서 §13 */
const BACKOFF_MS = [500, 1000, 2000];

class OfflineError extends Error {
  constructor(msg) { super(msg); this.code = 'LLM_OFFLINE'; }
}

/** 여덟 열쇠가 다 안 되는 것과, 열쇠가 아예 없는 것은 **다른 사실**이다 */
class AllKeysUnavailableError extends Error {
  constructor(msg, detail) {
    super(msg);
    this.code = 'GEMINI_ALL_KEYS_UNAVAILABLE';
    this.detail = detail || [];
  }
}

/**
 * 오프라인인가 — **등록된 열쇠가 하나도 없을 때**만 그렇다.
 * ★ 여덟이 전부 쉬는 중인 것은 오프라인이 아니다. 그건 잠깐 못 쓰는 것이고,
 *   그 둘을 같게 다루면 「열쇠를 넣으십시오」라는 엉뚱한 안내가 나간다.
 */
function isOffline() {
  return process.env.IM_AGENT_OFFLINE === '1' || keys.ensure().length === 0;
}

function endpoint(model, key) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
}
const INTERACTIONS = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** 응답에서 오류를 만들되 **상태코드를 붙인다** — 그것이 없으면 분류를 못 한다 */
function httpError(status, json, where) {
  const msg = (json && json.error && (json.error.message || json.error)) || `HTTP ${status}`;
  const e = new Error(`${where}: ${msg}`);
  e.status = status;
  return e;
}

/** Interactions API 로 한 번 시도 */
async function callInteractions({ model, key, system, prompt, files, temperature, maxOutputTokens, signal }) {
  const input = (files || []).map(f => ({
    type: (f.mime || '').startsWith('image/') ? 'image' : 'document',
    mime_type: f.mime,
    data: Buffer.isBuffer(f.data) ? f.data.toString('base64') : String(f.data),
  }));
  input.push({ type: 'text', text: prompt });
  const body = { model, input, generation_config: { temperature, max_output_tokens: maxOutputTokens } };
  if (system) body.system_instruction = system;
  const r = await fetch(INTERACTIONS, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw httpError(r.status, j, 'interactions');
  const steps = Array.isArray(j?.steps) ? j.steps : [];
  const text = steps.filter(st => st && st.type === 'model_output')
    .flatMap(st => Array.isArray(st.content) ? st.content : [])
    .map(c => (c && c.type === 'text' && c.text) || '').join('').trim();
  if (!text) throw new Error('빈 응답(interactions)' + (j && j.status ? ` status=${j.status}` : ''));
  return text;
}

/** 구 경로(generateContent) 로 한 번 시도 */
async function callGenerateContent({ model, key, system, prompt, files, temperature, maxOutputTokens, signal }) {
  // ★ 파일은 프롬프트 **앞**에 둔다. Gemini 는 지시문이 자료 뒤에 올 때
  //   자료를 더 성실히 읽는다 (문서 이해 가이드의 권고).
  const parts = (files || []).map(f => ({
    inlineData: {
      mimeType: f.mime,
      data: Buffer.isBuffer(f.data) ? f.data.toString('base64') : String(f.data),
    },
  }));
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, maxOutputTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const r = await fetch(endpoint(model, key), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw httpError(r.status, j, 'generateContent');
  const text = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error('빈 응답');
  return text;
}

/** 「이 모델이 이 계정에 없다」는 뜻의 상태코드 — 열쇠와 무관하다 */
function isModelProblem(status) {
  return status === 404 || status === 400;
}

/**
 * 한 모델 · 한 열쇠로 한 번 부른다. 두 경로를 차례로 시도한다.
 * ★ 429·401·403·5xx 는 **곧바로 올려보낸다.** 열쇠 문제라 두 번째 경로를
 *   두드려 봐야 같은 답이 오고, 그 사이 한도만 더 깎인다.
 */
async function callOnce(opts) {
  try {
    return await callInteractions(opts);
  } catch (e) {
    if (e.status && !isModelProblem(e.status)) throw e;
    return await callGenerateContent(opts);
  }
}

/**
 * 텍스트 생성. **열쇠는 매니저가 고른다.**
 *
 * 지시서 §32 의 흐름 그대로다:
 *   고르기 → 부르기 → 결과 분류 → 상태 갱신 → 다음 열쇠 → … → 다 실패하면 오류
 *
 * @returns {Promise<string>}
 */
async function generate({ system, prompt, files, temperature = 0.3, maxOutputTokens = 4096, timeoutMs = 60000 }) {
  if (isOffline()) throw new OfflineError('LLM 오프라인 모드 — Gemini 열쇠 미설정 또는 IM_AGENT_OFFLINE=1');

  const errors = [];
  let triedAnyKey = false;

  for (const model of MODELS) {
    /* ★ 써 본 열쇠는 **모델마다** 다시 연다. 앞 모델에서 404 로 넘어온 것이지
     *   열쇠가 나쁜 것이 아니기 때문이다. 나쁜 열쇠는 매니저가 이미 걸러 준다. */
    const skip = new Set();
    let modelBad = false;

    for (let attempt = 0; attempt < keys.MAX_KEY_RETRY && !modelBad; attempt++) {
      const k = keys.selectNext(skip);
      if (!k) break;                       // 이 모델에서 더 써 볼 열쇠가 없다
      skip.add(k.fp);
      triedAnyKey = true;

      const one = { model, key: k.key, system, prompt, files, temperature, maxOutputTokens };
      let handled = false;

      /* 5xx 는 **같은 열쇠로** 잠깐 쉬었다 다시 — 구글 쪽 일이다 (지시서 §13) */
      for (let r = 0; r <= BACKOFF_MS.length; r++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const t0 = Date.now();
        try {
          const text = await callOnce({ ...one, signal: controller.signal });
          keys.recordSuccess(k, Date.now() - t0);
          return text;
        } catch (e) {
          const st = e.status || 0;
          if (st === 429) {
            const secs = keys.recordRateLimit(k);
            errors.push(`${model} ${keys.label(k.fp)}: 429 (${secs}초 쉼)`);
            handled = true; break;
          }
          if (st === 401 || st === 403) {
            keys.recordAuthError(k, st);
            errors.push(`${model} ${keys.label(k.fp)}: ${st} 인증 거부`);
            handled = true; break;
          }
          if (st >= 500 && st <= 599) {
            if (r < BACKOFF_MS.length) {
              await new Promise(res => setTimeout(res, BACKOFF_MS[r]));
              continue;                    // 같은 열쇠로 한 번 더
            }
            keys.recordServerError(k, st);
            errors.push(`${model} ${keys.label(k.fp)}: ${st} (재시도 ${BACKOFF_MS.length}회 실패)`);
            handled = true; break;
          }
          if (isModelProblem(st)) {
            /* ★ 열쇠를 건드리지 않는다. 이 모델을 접고 다음 모델로 간다. */
            errors.push(`${model}: ${st} — 이 계정에 없는 모델`);
            modelBad = true; handled = true; break;
          }
          keys.recordUnknownError(k, e.message);
          errors.push(`${model} ${keys.label(k.fp)}: ${e.message}`);
          handled = true; break;
        } finally {
          clearTimeout(timer);
        }
      }
      if (!handled) break;
    }
  }

  /* ★ 「열쇠가 다 안 된다」와 「모델이 다 안 된다」를 갈라 적는다.
   *   앞 판은 둘 다 「Gemini 전체 실패」였고, 그러면 무엇을 고쳐야 하는지가
   *   메시지에서 사라진다. */
  if (triedAnyKey) {
    throw new AllKeysUnavailableError(
      `GEMINI_ALL_KEYS_UNAVAILABLE — 쓸 수 있는 열쇠로 전부 시도했으나 실패했다. ${errors.slice(0, 4).join(' / ')}`,
      errors,
    );
  }
  throw new AllKeysUnavailableError(
    `GEMINI_ALL_KEYS_UNAVAILABLE — 지금 고를 수 있는 열쇠가 없다 (전부 쉬는 중이거나 폐기됨). ${errors.slice(0, 4).join(' / ')}`,
    errors,
  );
}

/** 응답에서 JSON 블록만 뽑아낸다 (```json 펜스, 앞뒤 설명문 제거) */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start === -1) throw new Error('JSON 없음');
  const opener = raw[start];
  const closer = opener === '{' ? '}' : ']';
  const end = raw.lastIndexOf(closer);
  if (end === -1) throw new Error('JSON 종료 문자 없음');
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * 스키마를 강제하는 JSON 생성. 스키마 위반 시 오류를 되먹여 재시도한다.
 * @returns {Promise<any>}
 */
async function generateJson({ system, prompt, schema, label = 'LLM 출력', retries = 2, temperature = 0.1 }) {
  let lastErr = null;
  let extra = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await generate({
      system: [system, '반드시 JSON만 출력한다. 설명·마크다운 펜스 없이 JSON 하나만 출력한다.'].filter(Boolean).join('\n'),
      prompt: prompt + extra,
      temperature,
    });
    try {
      const parsed = extractJson(text);
      if (schema) assertValid(parsed, schema, label);
      return parsed;
    } catch (e) {
      lastErr = e;
      extra = `\n\n[직전 시도 오류 — 반드시 교정할 것]\n${e.message}`;
    }
  }
  throw lastErr || new Error(`${label} 생성 실패`);
}

module.exports = {
  generate, generateJson, extractJson, isOffline,
  OfflineError, AllKeysUnavailableError, MODELS,
  keys,
};
