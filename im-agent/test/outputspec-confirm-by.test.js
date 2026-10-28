'use strict';
/* outputspec.confirm — 확정자 판정은 낱말 단위 (2026-08-17)
   [사고] /agent|ai|auto|claude|gemini/i 가 'gmail.com' 의 "ai" 에 걸려 @gmail.com 사용자 전원이
          사양을 확정할 수 없었다(앱 실측 409). 이메일은 로컬파트만, 낱말 경계로 본다. */
const test = require('node:test');
const assert = require('node:assert/strict');
const o = require('../core/outputspec');

const tryConfirm = (by) => { try { o.confirm('__no_such_project__', { by }); return 'passed-gate'; } catch (e) { return e.message; } };

test('사람 — 이메일 도메인의 "ai" 에 걸리지 않는다', () => {
  for (const by of ['ws.gmsc@gmail.com', 'trail@example.com', '김태형', 'kim@mail.ai.example']) {
    assert.doesNotMatch(tryConfirm(by), /사람만 할 수 있다/, by);
  }
});
test('AI 표식 — 낱말로 있으면 막는다', () => {
  for (const by of ['ai-agent', 'claude', 'auto@x.com', 'gemini bot', 'AI', 'gpt-4', 'llm runner']) {
    assert.match(tryConfirm(by), /사람만 할 수 있다/, by);
  }
});
