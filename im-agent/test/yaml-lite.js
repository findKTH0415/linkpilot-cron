'use strict';
/**
 * yaml-lite.js — 검사들이 **함께 쓰는** YAML 잔손질 한 벌
 *   〈2026-09-19 · D-224 · CLAUDE.md §8-1〉
 *
 * ★★★ **왜 한 곳인가.** `yamlNoComment` 가 `secrets.test.js` 안에만 있었다.
 *   같은 것이 필요한 칸이 하나 더 생겼는데(워크플로가 부르는 스크립트가 실제로
 *   있는가), 거기에 **베껴 두면 한쪽이 옛말을 한다** (§8-1).
 *   합치는 대신 **같은 자리를 부른다.**
 *
 * ★ 이 파일은 `.test.js` 가 아니라 **러너가 안 집는다** — `ws-lite.js` 와 같은 결이다.
 */

/**
 * YAML 한 줄에서 주석을 뗀다 — 따옴표 안의 `#` 은 주석이 아니다.
 *
 * ★ 왜 필요한가 〈D-223 · 그 자리에서 빨개졌다〉: 워크플로 주석에 경위를 잘 적을수록
 *   글자로 대조하는 검사가 **눈이 먼다**(§8). 재려던 성질은 그대로 두고 **보는 자리**를
 *   옮기는 것이 답이다 — 「이름을 말로 바꿔」 넘기면 다음에 또 샌다.
 */
function yamlNoComment(text) {
  return String(text).split('\n').map((line) => {
    let q = null, cut = -1;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      // ★ 값 한가운데의 `#`(예: 색 코드)은 앞에 빈칸이 있어야 주석이다 — YAML 규칙 그대로
      if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) { cut = i; break; }
    }
    return cut < 0 ? line : line.slice(0, cut);
  }).join('\n');
}

module.exports = { yamlNoComment };
