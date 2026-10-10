'use strict';
/* 화면·견본에 이모지가 있는가를 세는 잣대 — 한 벌.
 *
 * ★ `\p{Extended_Pictographic}` 의 범위는 Node 에 든 유니코드 판을 따른다.
 *   유니코드 16(Node 22.22 · ICU 77)부터 ★(U+2605)가 그 안에 들어와,
 *   이 저장소가 문서 전체에서 쓰는 강조 별표가 「이모지」로 세졌다 —
 *   같은 코드가 Node 판에 따라 빨갰다 초록이었다 했다 (2026-10-10 실측).
 * ★ 그래서 ★ 만 뺀다. ⚠ ✅ 🔑 같은 진짜 이모지는 그대로 잡는다 —
 *   빼는 것은 «판에 따라 갈리는 강조 기호» 하나뿐이다.
 */
const ALLOW = new Set(['★']);
function findEmoji(s) {
  return (String(s).match(/\p{Extended_Pictographic}/gu) || []).filter((c) => !ALLOW.has(c));
}
module.exports = { findEmoji, ALLOW };
