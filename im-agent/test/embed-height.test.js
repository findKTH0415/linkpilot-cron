'use strict';
/**
 * embed-height.test.js — **iframe 이 끝없이 자라지 않는가** 〈2026-08-23 실제 사고〉.
 *
 * ★★★ 무슨 일이 있었나. 사장님 화면이 **조금씩 계속 내려갔다.** 「자료 업로드」
 *   칸 아래로 빈 칸이 끝없이 늘어나고, 그러는 사이 올리기가 먹통처럼 보였다.
 *
 *   고리는 이렇게 돈다:
 *     ① 자식이 `documentElement.scrollHeight` 를 보낸다
 *     ② 부모가 그 값 **＋ 8px** 로 iframe 높이를 잡는다
 *     ③ 자식의 **화면(viewport)이 8px 커진다**
 *     ④ `scrollHeight` 는 **화면 높이 아래로 안 내려가므로** 커진 값을 그대로 돌려준다
 *     → ②로. **한 바퀴에 8px 씩 영원히.**
 *
 * ★★ 「값이 안 바뀌면 안 보낸다」(4px 문턱)는 이 고리를 **못 막았다.**
 *   매번 8px 씩 **진짜로 바뀌기** 때문이다. 막는 장치가 있는데 이 결에는
 *   안 들었다 — 그래서 **고리 자체를 돌려 본다.**
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLAT = path.join(__dirname, '..', 'ui', 'platform');
const read = (f) => fs.readFileSync(path.join(PLAT, f), 'utf8');

/**
 * 고리를 **실제로 돌려 본다.** 통과가 아니라 **자라는 것**을 잰다.
 * @param {(h:number)=>number} parentPad 부모가 자식 높이로부터 iframe 높이를 정하는 규칙
 * @param {boolean} viewportFloored 자식이 화면 높이에 눌리는 방식으로 재는가
 */
function settle(parentPad, viewportFloored, content) {
  let frame = 320;                       // iframe 시작 높이
  let last = 0;
  for (let i = 0; i < 200; i += 1) {
    // 자식이 재는 값
    const h = viewportFloored ? Math.max(content, frame) : content;
    if (Math.abs(h - last) < 4) return { settled: true, frame, rounds: i };
    last = h;
    frame = Math.max(320, parentPad(h));
  }
  return { settled: false, frame, rounds: 200 };
}

test('★★★ 옛 조합은 실제로 끝없이 자란다 (이 검사가 진짜인지 먼저 잰다)', () => {
  /* ★ 막는 장치를 만들 때는 **막혀야 할 것이 실제로 막히는지** 먼저 본다.
     이 줄이 통과해야 아래 검사가 뜻이 있다 (M-08) */
  const bad = settle((h) => h + 8, true, 800);
  assert.strictEqual(bad.settled, false,
    '옛 조합(여백 8 + 화면에 눌리는 측정)이 안 자란다 — 그러면 이 검사가 헛것이다');
  assert.ok(bad.frame > 1500,
    `200바퀴에 ${bad.frame}px 밖에 안 자랐다 — 고리를 잘못 흉내 냈다`);
});

test('★★★ 지금 조합은 멈춘다 — 내용 높이 ＋ 여백 없음', () => {
  const good = settle((h) => h, false, 800);
  assert.ok(good.settled, 'iframe 높이가 안 멈춘다 — 화면이 끝없이 내려간다');
  assert.strictEqual(good.frame, 800, `멈춘 높이가 ${good.frame}px 다 — 내용과 같아야 한다`);
});

test('★★★ 둘 중 하나만 고쳐도 안 된다 — 양쪽을 다 본다', () => {
  /* 여백만 없애고 측정은 그대로 → 멈추기는 한다 (화면이 내용보다 작을 때만) */
  assert.ok(settle((h) => h, true, 800).settled, '여백을 없앴는데도 안 멈춘다');
  /* 측정만 고치고 여백은 그대로 → **한 번 커지고 멈추지만 8px 이 남는다** */
  const padOnly = settle((h) => h + 8, false, 800);
  assert.ok(padOnly.settled, '측정을 고쳤는데도 안 멈춘다');
  assert.strictEqual(padOnly.frame, 808, '여백이 남으면 빈 칸이 남는다');
});

test('★★★ 코드가 실제로 그 조합인가 — 자식은 내용 높이를 잰다', () => {
  const src = read('embed-bridge.js');
  assert.match(src, /function contentHeight\(\)/,
    '내용 높이를 재는 함수가 없다 — scrollHeight 는 화면 높이에 눌린다');
  /* ★ 「글자가 있나」로는 부족하다 — `if (el && el.getBoundingClientRect)` 만
     남아 있어도 통과했다(실측). **그 값을 돌려주는지**를 본다 */
  assert.match(src, /return Math\.ceil\(r\.height\);/,
    '테두리 상자 높이를 재 놓고 안 돌려준다 — scrollHeight 로 물러서면 그대로다');
  /* ★ `tell()` 이 그 함수를 **실제로 쓰는가.** 만들어 놓고 안 쓰면 그대로다 */
  const at = src.indexOf('function tell()');
  assert.ok(at > 0, 'tell() 을 못 찾았다');
  assert.match(src.slice(at, at + 200), /var h = contentHeight\(\);/,
    'tell() 이 contentHeight() 를 안 쓴다 — 만들어 놓고 옛 방식으로 잰다');
});

test('★★★ 코드가 실제로 그 조합인가 — 부모는 여백을 안 더한다', () => {
  const src = read('intake.html');
  const at = src.indexOf("d.type !== 'lp-embed-height'");
  assert.ok(at > 0, '높이 알림을 듣는 곳을 못 찾았다');
  /* ★★★ **주석을 떼고 본다** 〈2026-08-23 · 오늘만 네 번째로 걸렸다〉.
     바로 위 주석에 「앞 판은 `d.height + 8` 이었다」라고 **경위를 적어 둔 것**을
     코드로 읽고 빨개졌다. 코드는 멀쩡했다.
     ★ 이 저장소에서 오늘 `fetch-depth` · `required()` · `verify-served.sh` 에
       똑같이 걸렸다 — **경위를 잘 적어 둘수록 검사가 눈이 머는** 구조다. */
  const near = src.slice(at, at + 900)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
  assert.ok(!/d\.height\s*\+\s*\d/.test(near),
    '부모가 자식 높이에 여백을 더한다 — 그 여백만큼 매 바퀴 자란다');
  assert.match(near, /Math\.max\(320, d\.height\)/,
    '부모가 자식이 알려 준 높이를 그대로 안 쓴다');
});
