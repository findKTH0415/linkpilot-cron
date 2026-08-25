'use strict';
/**
 * llm.js — Gemini 호출 래퍼. 기존 크론 스크립트의
 * 키 로테이션 · 모델 폴백 패턴을 그대로 따른다. 새 의존성 없음(fetch 내장).
 *
 * ★ 원칙: LLM은 '문장'과 '분류'만 담당한다. 숫자 계산은 finance/ 가 한다.
 * ★ OFFLINE 모드(IM_AGENT_OFFLINE=1 또는 키 없음)에서는 호출 대신 OfflineError를
 *   던져, 각 Agent가 degrade 경로로 빠지게 한다. (전체 파이프라인을 죽이지 않는다)
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
 *   아래 `KEYS` 는 **이 파일을 부르는 순간** 정해진다. 그전에 `.env` 가 안
 *   올라와 있으면 **영영 오프라인**이다 — NAS 엔진이 정확히 그 상태였고,
 *   화면은 「GEMINI_API_KEY 가 필요합니다」만 되풀이했다. */
require('./env').ensure();

const KEYS = (process.env.GEMINI_API_KEY || '')
  .split(',').map(s => s.trim()).filter(Boolean);

class OfflineError extends Error {
  constructor(msg) { super(msg); this.code = 'LLM_OFFLINE'; }
}

function isOffline() {
  return process.env.IM_AGENT_OFFLINE === '1' || KEYS.length === 0;
}

function endpoint(model, key) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
}
const INTERACTIONS = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** Interactions API 로 한 번 시도. 실패하면 throw — 호출부가 generateContent 로 폴백한다 */
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
  if (!r.ok) throw new Error((j && j.error && (j.error.message || j.error)) || `HTTP ${r.status}`);
  const steps = Array.isArray(j?.steps) ? j.steps : [];
  const text = steps.filter(st => st && st.type === 'model_output')
    .flatMap(st => Array.isArray(st.content) ? st.content : [])
    .map(c => (c && c.type === 'text' && c.text) || '').join('').trim();
  if (!text) throw new Error('빈 응답(interactions)' + (j && j.status ? ` status=${j.status}` : ''));
  return text;
}

/**
 * 텍스트 생성. 키 × 모델 조합을 순회하며 재시도한다.
 * @returns {Promise<string>}
 */
async function generate({ system, prompt, files, temperature = 0.3, maxOutputTokens = 4096, timeoutMs = 60000 }) {
  if (isOffline()) throw new OfflineError('LLM 오프라인 모드 — GEMINI_API_KEY 미설정 또는 IM_AGENT_OFFLINE=1');

  const errors = [];
  for (const model of MODELS) {
    for (const key of KEYS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        /* ① Interactions API (Gemini 3.x) — 되면 여기서 끝 */
        try {
          const t = await callInteractions({ model, key, system, prompt, files, temperature, maxOutputTokens, signal: controller.signal });
          return t;
        } catch (ie) {
          errors.push(`${model}[interactions]: ${ie.message}`);
        }
        /* ② generateContent (구 경로 · gemma-4 등) */
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
          signal: controller.signal,
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error((j && j.error && j.error.message) || `HTTP ${r.status}`);
        const text = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
        if (!text) throw new Error('빈 응답');
        return text;
      } catch (e) {
        errors.push(`${model}: ${e.message}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new Error(`Gemini 전체 실패 — ${errors.slice(0, 4).join(' / ')}`);
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

module.exports = { generate, generateJson, extractJson, isOffline, OfflineError, MODELS };
