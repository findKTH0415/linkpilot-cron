'use strict';
/**
 * llm.js — Gemini 호출 래퍼. 기존 크론 스크립트(fetch-daily-quote.js)의
 * 키 로테이션 · 모델 폴백 패턴을 그대로 따른다. 새 의존성 없음(fetch 내장).
 *
 * ★ 원칙: LLM은 '문장'과 '분류'만 담당한다. 숫자 계산은 finance/ 가 한다.
 * ★ OFFLINE 모드(IM_AGENT_OFFLINE=1 또는 키 없음)에서는 호출 대신 OfflineError를
 *   던져, 각 Agent가 degrade 경로로 빠지게 한다. (전체 파이프라인을 죽이지 않는다)
 */

const { assertValid } = require('./schema');

const MODELS = (process.env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.0-flash')
  .split(',').map(s => s.trim()).filter(Boolean);
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

/**
 * 텍스트 생성. 키 × 모델 조합을 순회하며 재시도한다.
 * @returns {Promise<string>}
 */
async function generate({ system, prompt, temperature = 0.3, maxOutputTokens = 4096, timeoutMs = 60000 }) {
  if (isOffline()) throw new OfflineError('LLM 오프라인 모드 — GEMINI_API_KEY 미설정 또는 IM_AGENT_OFFLINE=1');

  const errors = [];
  for (const model of MODELS) {
    for (const key of KEYS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
  throw new Error(`Gemini 전체 실패 — ${errors.slice(0, 3).join(' / ')}`);
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
