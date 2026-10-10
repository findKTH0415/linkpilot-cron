'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { findEmoji } = require('./emoji-lite');

test('★ 이모지 잣대 — 강조 기호(★ ☆ △ ▽ ※)는 안 잡고 진짜 이모지는 Node 판과 상관없이 잡는다', () => {
  assert.deepStrictEqual(findEmoji('★ ☆ △ ▽ ※ · ✓ 글자'), [], '강조 기호를 이모지로 셌다');
  for (const e of ['⚠', '✅', '🔑', '🔴']) {
    assert.strictEqual(findEmoji(`앞 ${e} 뒤`).length, 1, `${e} 를 못 잡았다 — 잣대가 무뎌졌다`);
  }
});
