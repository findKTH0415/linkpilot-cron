'use strict';
/**
 * appview.test.js — **앱 자리 지도가 옛말을 하지 않게** 〈2026-08-30 · D-185〉.
 *
 * 사장님 지시: 「(뿌리 주소) 여기로 보여지는 **앱환경의 기준으로 대화가 되어야함** ·
 * 그것을 html url 로 링크하여 **항상 미리보기 창에 보여줘**」.
 *
 * ★★★ 지도가 **옛 판을 가리키면 안 주느니만 못하다.** 사장님은 그 지도를 보고
 *   판을 가리시는데, 지도가 옛 지문을 말하면 **멀쩡한 판을 옛것으로 읽으신다**
 *   (M-25 가 막으려던 바로 그 상태를 지도가 다시 만드는 꼴이다).
 *
 * ★★ 그리고 **주소는 저장소에 없어야 한다** (§2 — NAS 접속정보). 바탕에는
 *   자리만 두고 값은 `LP_APP_BASE` 로 받는다. 이 검사가 그것을 지킨다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const A = require(path.join(ROOT, 'im-agent', 'tools', 'appview.js'));
const stamp = require(path.join(ROOT, 'im-agent', 'ui', 'platform', 'build-stamp.js'));
const FLOW = require(path.join(ROOT, 'im-agent', 'ui', 'platform', 'flow-core.js'));

const src = () => fs.readFileSync(A.SRC, 'utf8');

test('★★★ 바탕에 주소가 한 글자도 없다 (§2 — NAS 접속정보)', () => {
  const s = src();
  assert.doesNotMatch(s, /\.ts\.net/,
    '바탕에 tailnet 주소가 박혀 있다 — 이 저장소는 public 이다');
  assert.doesNotMatch(s, /synologynas/i, '바탕에 NAS 이름이 박혀 있다');
  assert.match(s, /\{\{APP_BASE\}\}/, '주소를 채울 자리가 없다');
});

test('★★ 주소를 안 주면 **비운 채** 그린다 — 그럴듯한 가짜를 안 만든다', () => {
  const had = process.env.LP_APP_BASE;
  delete process.env.LP_APP_BASE;
  try {
    const r = A.build();
    const out = fs.readFileSync(r.out, 'utf8');
    assert.strictEqual(r.base, false, '주소를 안 받았는데 받았다고 한다');
    assert.match(out, /앱 주소를 안 받았다/, '비었다는 사실이 판에 안 보인다');
    assert.doesNotMatch(out, /\.ts\.net/, '어디선가 주소가 새어 들어왔다');
  } finally { if (had) process.env.LP_APP_BASE = had; }
});

test('★★★ 지도가 **지금 판**을 말한다 (지문·화면 수·단계 수를 재서 넣는다)', () => {
  const had = process.env.LP_APP_BASE;
  process.env.LP_APP_BASE = 'https://example.invalid';
  try {
    const r = A.build();
    const out = fs.readFileSync(r.out, 'utf8');
    const want = stamp.bundleHash();

    assert.ok(out.indexOf(want) !== -1, `지도가 지금 지문(${want})을 안 말한다`);
    assert.ok(out.indexOf(`화면 ${stamp.pages().length}개`) !== -1, '화면 수가 실제와 다르다');
    assert.ok(out.indexOf(`단계 ${FLOW.SECTIONS.length}개`) !== -1, '단계 수가 실제와 다르다');

    /* 주소가 실제로 들어갔는가 — 자리만 남아 있으면 눌러도 아무 데도 안 간다 */
    assert.doesNotMatch(out, /\{\{APP_/, '채울 자리가 그대로 남아 있다');
    assert.ok(out.indexOf('https://example.invalid/im-flow/report-flow.html') !== -1,
      '보고서 흐름 주소가 안 만들어졌다');

    assert.ok(A.check().ok, 'check 가 방금 만든 판을 옛것이라 한다');
  } finally {
    if (had) process.env.LP_APP_BASE = had; else delete process.env.LP_APP_BASE;
  }
});

test('★★ 판이 **못 하는 것**을 스스로 적는다 (없는 것을 그리지 않는다)', () => {
  const s = src();
  assert.match(s, /앱 화면 자체를 그려 보일 수 없습니다/,
    '미리보기가 앱 화면이 아니라는 사실을 안 적는다 — 사장님이 이것을 앱으로 읽으신다');
});
