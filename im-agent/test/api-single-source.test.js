'use strict';
/**
 * api-single-source.test.js — **서버 주소를 정하는 자리는 한 곳이다** 〈2026-08-27 · D-148〉.
 *
 * ★★★ 실측: 앱이 「보고서 생성 입력」(intake)을 **통째로** 열었더니
 *   「API 주소가 설정되지 않았습니다」로 멈췄다. 그런데 같은 저장소의
 *   `files.html`·`report-flow.html` 은 같은 상황에서 멀쩡히 돌았다 —
 *   **그 둘만 `resolveApi()` 를 썼기 때문**이다.
 *
 *   `flow-core.js` 주석이 그 자리를 미리 경고하고 있었다: 「화면마다 따로
 *   짐작하면 어느 화면은 되고 어느 화면은 안 된다가 되어 **원인이 안 보인다**」.
 *
 * ★ 다만 **모든 화면이 짐작해도 되는 것은 아니다.** `reports.html` 은 산출물
 *   파일 링크를 만들어서, 짐작한 주소로 링크를 만들면 누르면 엉뚱한 곳으로 간다.
 *   그 화면은 일부러 안 짐작한다 (open-file.test.js 가 그 자리를 지킨다).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'ui', 'platform');
/** 주석을 떼고 본다 — 이 저장소는 주석이 길어 검사가 눈이 멀기 쉽다 (CLAUDE.md §8) */
const read = (f) => fs.readFileSync(path.join(P, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 앱이 통째로 열었을 때도 스스로 주소를 정해야 하는 화면 */
const MUST = ['intake.html', 'fields.html', 'files.html', 'report-flow.html', 'outputs.html'];

test('★★★ 읽는 화면은 전부 **한 곳**에서 주소를 받는다', () => {
  MUST.forEach((f) => {
    assert.match(read(f), /resolveApi\(/,
      `${f}: 주소를 스스로 짐작하거나 아예 안 정한다 — 화면마다 다르게 굴면 원인이 안 보인다`);
  });
});

test('★★★ 짐작으로 불렀으면 **그 사실을 문장에 붙인다**', () => {
  // 안 붙이면 서버 탓으로 읽힌다 — 실제로는 앱이 주소를 안 넘긴 것이다
  ['intake.html', 'fields.html'].forEach((f) => {
    const s = read(f);
    assert.match(s, /apiNote\(/, `${f}: 짐작했다는 사실을 안 붙인다`);
    assert.ok(!/'API 주소가 설정되지 않았습니다'/.test(s),
      `${f}: 옛 문장이 남았다 — 그 말은 증상이지 까닭이 아니다`);
  });
  assert.match(fs.readFileSync(path.join(P, 'flow-core.js'), 'utf8'),
    /앱이 서버 주소를 넘기지 않아/, 'apiNote 의 문장이 사라졌다');
});

test('★★★ 파일 링크를 만드는 화면은 **짐작하지 않는다**', () => {
  // 짐작한 주소로 링크를 만들면 누르면 엉뚱한 곳으로 간다
  assert.ok(!/resolveApi\(/.test(read('reports.html')),
    'reports.html 이 주소를 짐작한다 — 깨진 링크를 만들게 된다');
});

test('★★ 다리가 **왜** 못 넘겼는지를 화면이 쓸 수 있다', () => {
  const b = fs.readFileSync(path.join(P, 'embed-bridge.js'), 'utf8');
  assert.match(b, /단독으로 열렸습니다/, '통째로 열린 경우의 까닭이 없다');
  assert.match(b, /reason: state\.reason/, '까닭을 화면이 읽을 수 있게 안 내놓는다');
});
