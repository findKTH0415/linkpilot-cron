'use strict';
/**
 * probe-viewport.test.js — **화면 크기 검사가 진짜로 잡는가** 〈2026-09-01 · M-71 · M-72〉.
 *
 * ★★★ 왜 이 시험이 필요한가. 이 검사는 **아무것도 못 잡아도 초록**이다. 실제로
 *   처음 만들었을 때 헤드리스 창이 390px 로 안 줄어들어 **485px 를 재고 있었는데도
 *   「폰 통과」로 찍혔다.** 그러니 「돌아간다」가 아니라 **「틀린 것을 빨갛게
 *   만드는가」**를 재야 한다 (CLAUDE.md §8 「표본이 거짓말을 하면 잡히는 것도 거짓」).
 */
const test = require('node:test');
const assert = require('node:assert');

const VP = require('../tools/probe-viewport');

test('★★★ 가로로 넘치면 빨갛다', () => {
  assert.ok(VP.bad({ w: 390, sideways: 845, over: [], cut: [] }),
    '가로 넘침을 안 잡는다');
});

test('★★★ 화면 밖으로 나간 것을 잡는다', () => {
  assert.ok(VP.bad({ w: 390, sideways: 0, over: ['DIV.x →1220'], cut: [] }),
    '화면 밖 요소를 안 잡는다');
});

test('★★ 상자가 내용보다 작으면 빨갛다 (M-71 이 난 모양)', () => {
  assert.ok(VP.bad({ w: 390, sideways: 0, over: [], cut: [], boxH: 213, contentH: 845 }),
    '상자가 내용보다 작은 것을 안 잡는다');
});

test('★★ 글자가 잘리면 빨갛다', () => {
  assert.ok(VP.bad({ w: 390, sideways: 0, over: [], cut: ['SPAN.t 80<140'] }),
    '잘린 글자를 안 잡는다');
});

test('★★★ 멀쩡하면 초록이다 — 늘 빨간 검사는 아무도 안 본다', () => {
  assert.strictEqual(
    VP.bad({ w: 390, sideways: 0, over: [], cut: [], boxH: 900, contentH: 845 }),
    null, '멀쩡한데 빨갛다');
  /* 반올림만큼은 봐 준다 */
  assert.strictEqual(
    VP.bad({ w: 390, sideways: VP.SLACK, over: [], cut: [], boxH: 845, contentH: 845 }),
    null, '반올림을 고장으로 센다');
});

test('★ 못 잰 것은 「이상 없음」이 아니다 — 따로 센다', () => {
  assert.strictEqual(VP.bad({ error: '폭이 485px 로 나왔다' }), null,
    '못 잰 것을 이상으로 세면 원인이 뒤섞인다');
  /* ★ 그 대신 부르는 쪽이 **되돌아오는 값 2** 로 끝낸다 — 아래에서 소스로 못박는다 */
  const src = require('fs')
    .readFileSync(require('path').join(__dirname, '..', 'tools', 'probe-viewport.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /errs\.length[\s\S]{0,200}return 2;/,
    '못 잰 것이 있는데 2 로 안 끝난다 — 통과로 세면 안 된다');
});

test('★★★ 재려던 폭으로 못 쟀으면 「못 쟀다」로 끝낸다', () => {
  /* 이것이 이 도구가 처음에 틀렸던 자리다 — 폰을 잰 줄 알고 485px 를 쟀다 */
  const src = require('fs')
    .readFileSync(require('path').join(__dirname, '..', 'tools', 'probe-viewport.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /Math\.abs\(got\.w - size\.w\)/,
    '잰 폭이 재려던 폭과 같은지 안 본다');
});

test('★ 보는 폭에 폰이 들어 있다', () => {
  assert.ok(VP.SIZES.some((s) => s.w <= 400), `폰 폭이 없다: ${JSON.stringify(VP.SIZES)}`);
  assert.ok(VP.SIZES.some((s) => s.w >= 1200), `데스크탑 폭이 없다: ${JSON.stringify(VP.SIZES)}`);
});
