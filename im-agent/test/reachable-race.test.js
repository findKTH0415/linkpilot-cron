'use strict';
/**
 * reachable — **살아 있는 폴더를 걷는 스캔이 파일이 사라져도 안 죽는가**
 * 〈2026-08-26 · CI 에서 실제로 났다 · PR #13〉
 *
 * ★★★ 무슨 일이 있었나.
 *
 *   `reachable.scan()` 은 저장소를 걸으며 화면(`.html`)을 출발점으로 모은다.
 *   그런데 **검사들이 같은 폴더에 임시 표본을 만들었다 지운다** —
 *   `files-tab.test.js` 의 탐침(`.lp-embed-probe.html`)이 그렇다.
 *
 *   `node --test` 는 파일마다 프로세스를 띄운다. 그래서 **목록을 잡은 순간과
 *   읽는 순간 사이**에 그 파일이 사라질 수 있고, 그때 `ENOENT` 로 죽는다.
 *
 * ★★ **가장 나쁜 점은 엉뚱한 데가 빨개진다는 것이다.** 죽는 자리가
 *   `guardPanel()` → 미리보기 생성이라, 화면과 아무 상관도 없는
 *   「내역마다 어디를 보면 확인되는지 적혀 있다」가 실패로 찍혔다.
 *   그리고 **그 검사만 혼자 돌리면 통과한다** — 원인이 안 보인다.
 *
 * ★ 그래서 막는 곳이 둘이다.
 *   ① 숨은 이름(`.` 으로 시작)은 **애초에 목록에 안 넣는다** — 임시 표본이다
 *   ② 그래도 읽다가 사라지면 **「가리키는 것 없음」으로 넘긴다** — 죽지 않는다
 *
 *   ①만으로는 부족하다. 숨지 않은 이름으로 임시 파일을 쓰는 검사가 내일
 *   생길 수 있고, 그때 또 같은 자리에서 엉뚱하게 빨개진다.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const reachable = require('../tools/reachable.js');
const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');

/* ───────────── ① 숨은 이름은 안 센다 ───────────── */

test('★★ 숨은 이름의 화면은 출발점으로 세지 않는다', () => {
  const probe = path.join(PLATFORM, '.lp-race-probe.html');
  fs.writeFileSync(probe, '<!doctype html><html lang="ko"><body>표본</body></html>');
  try {
    const r = reachable.scan();
    assert.ok(r.total > 0, '모듈을 하나도 못 셌다 — 표본이 스캔 자체를 깨뜨렸다');
    assert.deepStrictEqual(r.orphans, [],
      '숨은 표본 때문에 멀쩡한 모듈이 고아로 잡혔다');
  } finally {
    fs.rmSync(probe, { force: true });
  }
});

/* ───────────── ② 읽다가 사라져도 안 죽는다 ───────────── */

test('★★★ 읽는 사이에 파일이 사라져도 스캔이 죽지 않는다 (CI 에서 난 그 꼴)', () => {
  // ★ 실제로 난 것과 **같은 순간**을 만든다: 목록에는 잡혔는데 읽으려는
  //   찰나에 없어진다. 이 표본이 없으면 이 검사는 아무것도 안 재고 초록이 된다.
  const probe = path.join(PLATFORM, 'lp-race-probe.html');   // 일부러 **안 숨긴** 이름
  fs.writeFileSync(probe, '<!doctype html><html lang="ko"><body>표본</body></html>');

  const real = fs.readFileSync;
  let vanished = false;
  fs.readFileSync = function patched(f, ...rest) {
    if (String(f).endsWith('lp-race-probe.html')) {
      try { fs.rmSync(probe, { force: true }); vanished = true; } catch (_) { /* 이미 없다 */ }
    }
    return real.call(fs, f, ...rest);
  };
  try {
    const r = reachable.scan();
    assert.ok(vanished, '표본이 안 사라졌다 — 이 검사는 아무것도 안 쟀다');
    assert.ok(r.total > 0, '모듈을 하나도 못 셌다');
  } finally {
    fs.readFileSync = real;
    fs.rmSync(probe, { force: true });
  }
});

test('★★ 막는 장치를 빼면 빨개진다 — 두 곳이 다 코드에 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'reachable.js'), 'utf8')
    // 주석을 떼고 본다 — 경위를 잘 적어 둘수록 글자 대조가 눈이 먼다 (CLAUDE.md §8)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /e\.name\.startsWith\('\.'\)/,
    '숨은 이름을 안 거르면 임시 표본이 출발점으로 세어진다');
  assert.match(src, /e\.code === 'ENOENT'/,
    '사라진 파일에 죽으면 엉뚱한 검사가 빨개진다 — 그리고 혼자 돌리면 통과해서 안 보인다');
});

/* ───────────── 재려는 것을 실제로 재는가 ───────────── */

test('★ 지금 저장소에 고아 모듈이 없다 (이 검사가 재는 본래 값)', () => {
  const r = reachable.scan();
  assert.deepStrictEqual(r.orphans, [],
    `아무 데서도 안 부르는 모듈이 있다: ${r.orphans.join(' · ')}`);
});
