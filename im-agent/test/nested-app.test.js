'use strict';
/**
 * nested-app.test.js — **칸 안에 앱이 통째로 한 벌 더 그려지지 않는다**
 * 〈2026-08-27 사장님 화면 · 심각〉.
 *
 * 실제 신고: 「보고서 생성 입력」의 **자료 업로드** 칸 안에 사이드바·동기화 표시·
 * 「보고서 만들기」 배너까지 **앱 전체**가 한 벌 더 들어와 있었다.
 *
 * ★★ 왜 비싼가. **오류가 하나도 안 난다.** 서버가 200 으로 앱 첫 화면을 돌려주고
 *   그림도 멀쩡히 그려지니, 화면만 봐서는 「원래 이런 화면인가」로 읽힌다.
 *   무엇을 고쳐야 하는지 단서가 화면에 한 글자도 안 남는다 (M-56 · D-151 과 같은 결).
 *
 * ★★★ **여기서 못 재는 것 — 적어 둔다** 〈CLAUDE.md §8〉.
 *   어긋난 경우를 **실제로 그려서** 재려면 화면을 http 로 띄워야 한다. `file://`
 *   로 열면 iframe 이 **다른 출처**가 되어 안쪽 주소를 못 읽고, 그러면 이 장치가
 *   늘 「모른다」로 빠져나가 아무것도 안 재게 된다. 이 컨테이너에서 localhost 로
 *   띄워 보았으나 크로미움이 끝나지 않았다(프록시를 지나는 자리다) — 그래서
 *   **어긋난 경우는 소스로 재고, 멀쩡한 경우만 실제로 그려서 잰다.**
 *   → 「경고가 안 뜬다」는 여기서 **통과가 아니라 못 쟀다**는 뜻이다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const SRC = fs.readFileSync(path.join(PLATFORM, 'intake.html'), 'utf8');
const drawn = (dom) => dom.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

/** 실린 뒤 주소를 되짚는 조각만 떼어 본다 */
const GUARD = (function () {
  const i = SRC.indexOf("fr.addEventListener('load'");
  return i < 0 ? '' : SRC.slice(i, i + 1600);
}());

test('★★★ 실린 뒤 **부른 파일이 왔는지** 되짚는다 — 안 되짚으면 앱이 겹쳐 그려진다', () => {
  assert.ok(GUARD.length > 200, '되짚는 자리가 아예 없다');
  assert.match(GUARD, /var got = here\.split\('\/'\)\.pop\(\);/, '무엇이 왔는지 안 본다');
  assert.match(GUARD, /if \(got === file\) return;/, '부른 파일과 대 보지 않는다');
});

test('★★★ 어긋나면 **틀을 지우고 글자로 적는다** — 겹쳐 그리는 것보다 낫다', () => {
  assert.match(GUARD, /wrap\.textContent = '';/, '엉뚱한 문서를 담은 틀을 그대로 둔다');
  assert.match(GUARD, /자료 업로드 화면을 못 불러왔습니다/, '무슨 일인지 안 적는다');
  assert.match(GUARD, /\+ \(got \|\| '다른 것'\) \+/, '무엇이 왔는지 이름을 안 적는다');
  assert.match(GUARD, /새 탭에서 열기/, '그 화면으로 가는 길이 없다 — 막다른 골목이 된다');
});

test('★★ 안쪽을 못 읽는 자리(다른 출처)에서는 **모른다고 두고 넘어간다**', () => {
  assert.match(GUARD, /catch \(_\) \{ return; \}/,
    '못 읽을 때 그냥 넘어가지 않는다 — 모르는 것을 고장이라고 적게 된다');
  assert.match(GUARD, /if \(!here\) return;/, 'about:blank 를 고장으로 읽는다');
});

test('★★ 멀쩡한 칸에는 **아무 말도 안 한다** — 실제로 그려서 잰다', () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  const browser = findBrowser();
  if (!browser) return;   // 크로미움이 없는 서버가 실제로 있다 — 못 쟀다

  const anchor = '<!-- 부모(앱)가 채운 설정을 받아 병합한다.';
  const cfg = `
<script>
window.LINKPILOT_INTAKE.api = '/api/linkpilot';
window.fetch = function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ items: [], formats: [] }); } });
};
</script>
`;
  const probe = path.join(PLATFORM, '__nested-probe.html');
  fs.writeFileSync(probe, SRC.replace(anchor, cfg + anchor));
  let dom;
  try { dom = drawn(renderDom(browser, probe, 9000, 1100)); } finally { fs.unlinkSync(probe); }

  assert.match(dom, /<iframe/, '자료 업로드 칸이 아예 안 섰다 — 잰 것이 없다');
  assert.ok(!/자료 업로드 화면을 못 불러왔습니다/.test(dom),
    '멀쩡한 칸에도 경고가 뜬다 — 진짜일 때도 안 읽히게 된다');
});
