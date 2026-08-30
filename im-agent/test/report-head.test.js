'use strict';
/**
 * report-head.test.js — **보고서 생성 화면의 머리는 이 화면이 단다** 〈2026-08-30 · D-200〉.
 *
 * ★★★ 왜 있나. 같은 일을 하는 자리가 둘이었다 — 앱이 사진 배너를 그리고, 이 화면은
 *   `inTab` 이면 제목을 안 그렸다. 그 둘이 어긋나 **배너가 두 벌로 보이고 사이가 떴다.**
 *   사장님 지시로 앱 쪽 배너를 지웠는데, 그 순간 이 화면의 `if (!C.inTab)` 한 줄이
 *   **앱 안에서 이름을 지우는 줄**이 되었다 — 오류는 안 나고 이름만 사라진다.
 *
 * ★ 그래서 세 가지를 잰다: ① 조건 없이 그리는가 ② 이름을 여기 옮겨 적지 않았는가
 *   ③ 앱이 얹을 때 덮어쓰는 규칙이 이 머리를 감추지 않는가.
 *
 * ★★ **주석을 떼고 본다** (CLAUDE.md §8 — 경위를 잘 적어 둘수록 검사가 눈이 먼다).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'ui', 'platform');
const RAW = fs.readFileSync(path.join(P, 'report-flow.html'), 'utf8');

/* 주석(블록·줄·HTML)을 떼어 낸 「진짜 코드」만 남긴다 */
const CODE = RAW
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ');

test('★★★ 머리를 조건 없이 그린다 — `inTab` 이 이름을 지우지 않는다', () => {
  assert.ok(/view\.appendChild\(hd\)/.test(CODE),
    '머리를 그리는 줄이 없다 — 앱 안에서 **이름 없는 화면**이 된다');
  assert.ok(!/if\s*\(\s*!\s*C\.inTab\s*\)\s*view\.appendChild/.test(CODE),
    '`inTab` 이면 제목을 안 그리는 줄이 살아 있다 — 앱은 이제 배너를 안 그린다 (D-200)');
});

test('★★ 이름은 한 곳에서만 읽는다 — 화면에 글자로 옮겨 적지 않는다', () => {
  assert.ok(/F\.SECTION\.title/.test(CODE),
    '제목을 `flow-core` 의 SECTION 에서 읽지 않는다 — 두 벌이 되면 한쪽만 고쳐진다');
  const F = require(path.join(P, 'flow-core.js'));
  assert.ok(!CODE.includes("'" + F.SECTION.title + "'"),
    '제목 글자가 화면 코드에 박혀 있다 — SECTION 을 고쳐도 여기가 안 따라온다');
});

test('★ 앱이 얹을 때 덮어쓰는 규칙이 이 머리를 감추지 않는다', () => {
  const F = require(path.join(P, 'flow-core.js'));
  const css = F.EMBED_CSS;
  assert.ok(/\.side\{display:none/.test(css.replace(/\s/g, '')),
    '재려는 규칙 자체가 사라졌다 — 표본이 거짓말을 하면 잡히는 것도 거짓이다 (M-30)');
  assert.ok(!/\.head\s*\{[^}]*display:\s*none/.test(css),
    '앱이 얹을 때 머리를 감춘다 — **앱 안에서만 조용히 사라진다**');
  /* 모양도 여기 있어야 한다 — 클래스만 있고 규칙이 없으면 줄이 안 보인다 */
  assert.ok(/\.head\s*\{/.test(RAW) && /\.head__d\s*\{/.test(RAW),
    '`.head` · `.head__d` 모양 규칙이 화면에 없다');
});
