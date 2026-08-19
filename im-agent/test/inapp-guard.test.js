'use strict';
/**
 * inapp-guard.test.js — 화면이 로드하는 inapp.js 가 **링크 가드까지** 하는가 (2026-08-20).
 *
 * [사고] build-embed 사본에는 앱의 인라인 가드 주입이 없다. inapp.js 는 배너 모듈이라
 * window.open 을 안 감쌌고, 앱 배포 게이트(verify-build)가 「가드 없는 _blank」로 막았다 —
 * 게이트를 「inapp.js 로드 = 가드」로 완화했으면 **가드 없는 화면이 그대로 나갔다**.
 * 그래서 가드를 이 모듈에 넣고, 이 테스트가 그것을 고정한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const inapp = require('../ui/platform/inapp');

function fakeWin(ua) {
  const listeners = {};
  const doc = { defaultView: null, hidden: false,
    addEventListener: (t, f) => { listeners[t] = f; }, createElement: () => ({ style: {} }) };
  const w = { navigator: { userAgent: ua }, document: doc, location: { href: 'https://app/' },
    open() { w.__native = true; return {}; }, setTimeout };
  doc.defaultView = w;
  return { w, doc, listeners };
}

test('인앱(카카오)에서 window.open 이 탈출 경로로 바뀐다 — about:blank#blocked 차단', () => {
  const { w, doc } = fakeWin('Mozilla KAKAOTALK');
  assert.strictEqual(inapp.guard(doc), true);
  const r = w.open('https://example.com/x');
  assert.strictEqual(r, null, '인앱에서는 네이티브 새 창을 열지 않는다');
  assert.match(w.location.href, /kakaotalk:\/\/web\/openExternal/, '카카오 공식 스킴으로 나간다');
  assert.notStrictEqual(w.__native, true);
});

test('일반 브라우저에서는 네이티브 open 을 건드리지 않는다 (감지는 허용 판단에만)', () => {
  const { w, doc } = fakeWin('Mozilla Chrome Safari');
  inapp.guard(doc);
  w.open('https://example.com/y');
  assert.strictEqual(w.__native, true);
});

test('_blank 클릭을 가로챈다 — download 앵커는 건드리지 않는다', () => {
  const { w, doc, listeners } = fakeWin('Mozilla KAKAOTALK');
  inapp.guard(doc);
  const click = listeners.click;
  assert.strictEqual(typeof click, 'function', '클릭 인터셉터가 무조건 등록된다');
  let prevented = 0;
  const mk = (href, dl) => ({ target: { closest: (sel) => (sel.includes('_blank') ? { href, hasAttribute: (a) => a === 'download' ? dl : false } : null) },
    preventDefault: () => { prevented += 1; }, stopPropagation: () => {} });
  click(mk('https://example.com/z', false));
  assert.strictEqual(prevented, 1, '_blank 는 가로챈다');
  click(mk('https://example.com/file.pdf', true));
  assert.strictEqual(prevented, 1, 'download 앵커는 통과 — 파일 저장이 깨진다');
});

test('두 번 설치해도 한 번만 건다', () => {
  const { doc } = fakeWin('Mozilla KAKAOTALK');
  assert.strictEqual(inapp.guard(doc), true);
  assert.strictEqual(inapp.guard(doc), true);
});
