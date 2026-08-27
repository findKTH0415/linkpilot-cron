'use strict';
/**
 * stage-mismatch.test.js — **칸에 실린 화면이 그 칸의 것이 아니면 말한다**
 * 〈2026-08-27 · 사장님 신고: 「4번 가이드 필드에 3번 관련자료 업로드가 다시 나온다」〉.
 *
 * ★★ 이 어긋남은 **오류를 안 낸다.** 칸 머리는 「4. 가이드 필드」인데 안에는 다른
 *   화면이 멀쩡히 그려져 있으니, 보는 사람은 원래 그런 화면인 줄 안다. 그러면
 *   무엇을 고쳐야 하는지 단서가 화면에 한 글자도 안 남는다 (M-56 과 같은 결).
 *
 * ★ 그래서 **실제 브라우저에서 그려 보고** 잰다 (M-08 — 부르지 않는 검사를 만들지
 *   않는다). 소스만 훑으면 「그리기는 하는데 그 자리까지 안 간다」를 못 잡는다.
 *
 * ★★ **소스를 지우고 본다** 〈같은 날 · 처음에 여기 걸렸다〉. `--dump-dom` 은 인라인
 *   스크립트까지 그대로 뱉는다. 그래서 「이 문구가 있나」로 재면 **경고를 만드는
 *   코드**가 걸려 멀쩡한 화면도 빨개진다 — CLAUDE.md §8 이 말하는 그 함정이다.
 *   재는 것은 **그려진 안내 상자**이지 그것을 만드는 코드가 아니다.
 *
 * ★ 못 재는 것: 크로미움이 없는 자리에서는 **건너뛴다.** 그 사실을 여기 적어 둔다 —
 *   초록으로 끝나는 것과 「못 쟀다」는 다른 사실이다 (CLAUDE.md §8).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');

/** 그려진 것만 본다 — 인라인 스크립트를 지운다 (§8) */
const drawn = (dom) => dom.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

/** 되짚기 함수의 본문만 떼어 본다 */
function oddSrc() {
  const src = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  const i = src.indexOf('function oddUrlNote');
  return i < 0 ? '' : src.slice(i, i + 1200);
}

/** 칸을 안 나누는 옛 사본을 흉내 낸다 — 주소에서 `part` 를 떼고 부르게 만든다 */
const STUB = `
<script>
window.LINKPILOT_REPORT_FLOW.api = '/api/linkpilot';
window.LINKPILOT_REPORT_FLOW.inTab = true;
window.fetch = function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ items: [] }); } });
};
(function () {
  var F = window.LinkPilotFlow;
  var real = F.urlFor;
  F.urlFor = function (step, ctx) {
    var u = real(step, ctx);
    return u.replace(/([?&])part=[^&]*&?/, '$1').replace(/[?&]$/, '');
  };
}());
</script>
`;

test('★★★ 칸이 부른 화면과 실린 화면이 다르면 **화면이 그렇다고 말한다**', () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  const browser = findBrowser();
  if (!browser) return;   // 크로미움이 없는 서버가 실제로 있다 — 못 쟀다

  const src = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  /* ★ flow-core 를 실은 **뒤**에 끼운다. 앞에 두면 갈아 끼울 대상이 아직 없다 */
  const m = src.match(/<script src="flow-core\.js[^>]*><\/script>/);
  assert.ok(m, '흐름 목록을 싣는 자리를 못 찾았다');

  const probe = path.join(PLATFORM, '__stage-mismatch-probe.html');
  fs.writeFileSync(probe, src.replace(m[0], m[0] + STUB));
  let dom;
  try { dom = renderDom(browser, probe, 9000, 900); } finally { fs.unlinkSync(probe); }

  const seen = drawn(dom);
  assert.match(seen, /<div class="note note--bad"><b>이 칸이 부르는 주소가 이 단계로 되짚어지지 않습니다<\/b>/,
    '칸 표시 없이 실린 화면을 그냥 그렸다 — 어긋남이 화면에 한 글자도 안 남는다');
  assert.match(seen, /intake\.html/, '무엇이 실렸는지를 안 적었다 — 이름이 없으면 못 고친다');
  assert.match(seen, /판 표시/, '어느 쪽이 옛 판인지 가릴 실마리를 안 줬다');
  /* ★ 안쪽 화면을 들여다보지 않는다 — 출처가 다르면 못 읽는다(앱·file 둘 다) */
  assert.ok(!/contentWindow/.test(String(oddSrc())), '안쪽을 들여다보는 방식이면 앱에서 안 돈다');
});

test('★★ 제대로 실린 칸에는 **아무 말도 안 한다** — 늘 뜨는 경고는 아무도 안 본다', () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  const browser = findBrowser();
  if (!browser) return;

  const src = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  const anchor = '<!-- 부모(앱)가 채운 설정을 받아 병합한다.';
  const plain = `
<script>
window.LINKPILOT_REPORT_FLOW.api = '/api/linkpilot';
window.LINKPILOT_REPORT_FLOW.inTab = true;
window.fetch = function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ items: [] }); } });
};
</script>
`;
  const probe = path.join(PLATFORM, '__stage-ok-probe.html');
  fs.writeFileSync(probe, src.replace(anchor, plain + anchor));
  let dom;
  try { dom = renderDom(browser, probe, 9000, 900); } finally { fs.unlinkSync(probe); }

  assert.ok(!/<div class="note note--bad"><b>이 칸이 부르는 주소/.test(drawn(dom)),
    '멀쩡한 칸에도 경고가 뜬다 — 늘 뜨는 경고는 진짜일 때도 안 읽힌다');
});
