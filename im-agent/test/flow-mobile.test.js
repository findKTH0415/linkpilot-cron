'use strict';
/**
 * flow-mobile.test.js — **보고서 생성이 휴대폰에서 느린 이유**
 * 〈2026-08-21 · 사용자 신고: 「모바일 환경에서 너무 느리게 릴리즈 됨」〉
 *
 * ★★ 원인은 **덩치가 아니었다.** 화면 파일은 40KB 이고 스크립트를 다 합쳐도
 *   90KB 가 안 된다. 느린 것은 **되먹임 고리**였다.
 *
 *   ① `fit()` 이 잴 때마다 `style.height` 를 **무조건** 썼다.
 *      높이를 쓰면 바깥이 다시 배치되고 → 안쪽 화면의 크기가 바뀌고 →
 *      안쪽이 다시 그려지면서 클래스·style 이 움직이고 → 감시자가 그걸 잡아
 *      **또 재고 또 쓴다.** 값이 그대로여도 고리가 돈다.
 *
 *   ② `watch()` 는 부를 때마다 MutationObserver 와 setInterval 을 **새로
 *      만들고 옛것을 끄지 않았다.** 화면이 실릴 때마다·단계를 옮길 때마다
 *      불리므로 **감시자가 쌓인다.** 「쓸수록 느려진다」가 여기서 나온다.
 *
 *   ③ 그 감시자가 `attributes: true` 로 **문서 전체의 속성**을 보고 있었다.
 *      안쪽 화면이 제 일을 하느라 클래스 하나만 토글해도 높이를 다시 쟀다.
 *
 * ★ 데스크톱에서는 한 바퀴가 순식간이라 눈에 안 띈다. 휴대폰에서는 그 한
 *   바퀴가 비싸서 **화면이 뒤늦게 덜컥덜컥 자리를 잡는다.**
 *
 * ★★ 그래서 이 검사는 **실제 브라우저에서 재고 세어 본다** (M-08 — 부르지
 *   않는 테스트를 만들지 않는다). 정적으로 소스만 훑으면 고리가 도는지
 *   알 수 없다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const FLOW = require(path.join(PLATFORM, 'flow-core.js'));

/** 단계 화면 대신 **작은 대역**을 심는다 — 재는 것은 감시자이지 화면이 아니다 */
function stubDocs() {
  const docs = {};
  FLOW.STEPS.forEach((s) => {
    docs[s.id] = '<!doctype html><html><head><meta charset="utf-8"></head>'
      + '<body><div id="lp-stub" style="height:600px">' + s.name + '</div></body></html>';
  });
  return docs;
}

test('★★ 휴대폰에서 느린 고리가 끊겼는가 — 감시자가 쌓이지 않고 높이가 멈춘다', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;   // 크로미움이 없는 서버가 실제로 있다

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-flow-mobile-'));
  require(path.join(PLATFORM, 'build-embed.js')).build(dir);

  let html = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');

  // ① 재는 도구를 **페이지보다 먼저** 심는다 — 나중에 심으면 이미 만들어진 것을 못 센다
  const meter = `
<script>
window.__lp = { intervals: 0, live: 0, heightWrites: 0 };
(function () {
  var si = window.setInterval, ci = window.clearInterval, alive = {};
  window.setInterval = function (f, m) {
    var id = si.apply(window, arguments);
    alive[id] = 1; window.__lp.intervals++; window.__lp.live++;
    return id;
  };
  window.clearInterval = function (id) {
    if (alive[id]) { delete alive[id]; window.__lp.live--; }
    return ci.apply(window, arguments);
  };
})();
</script>`;
  html = html.replace('<title>', meter + '\n<title>');

  // ② 프로젝트를 쥐여 주고 단계 화면을 대역으로 바꾼다 (설정 대입 **뒤**에 넣는다)
  const cfg = `
<script>
window.LINKPILOT_REPORT_FLOW.projectId = 'LP-T-1';
window.LINKPILOT_PREVIEW_DOCS = ${JSON.stringify(stubDocs()).replace(/</g, '\\u003c')};
</script>`;
  html = html.replace('<script src="embed-bridge.js"', cfg + '\n<script src="embed-bridge.js"');
  /* ★ 아래 `</body>` 치환보다 **먼저** 넣으면 안 된다 — 대역 문서 안에도
   *   `</body>` 가 들어 있어서 몰이꾼이 JSON 한복판에 박힌다. 그래서 대역은
   *   `<` 를 이스케이프해 둔다 (아래 stubDocs 직렬화). */

  // ③ 몰이꾼 — 페이지가 다 돈 **뒤에** 붙는다
  const driver = `
<div id="probe"></div>
<script>
(async function () {
  var sleep = function (m) { return new Promise(function (r) { setTimeout(r, m); }); };
  var o = { steps: 0 };
  await sleep(300);

  // 잠긴 절이 있으면 눌러서 단계 화면을 띄운다
  var fr = document.querySelector('.stage iframe');
  if (!fr) {
    var heads = [].slice.call(document.querySelectorAll('.sec__h'));
    for (var i = 0; i < heads.length && !fr; i++) {
      heads[i].click(); await sleep(150);
      fr = document.querySelector('.stage iframe');
    }
  }
  o.hasFrame = !!fr;
  if (!fr) { document.getElementById('probe').textContent = JSON.stringify(o); return; }

  await sleep(400);
  o.liveAfterBoot = window.__lp.live;

  // ★ 같은 화면에 load 가 여러 번 오는 판을 그대로 만든다 (실제로 그렇게 불린다)
  for (var k = 0; k < 6; k++) { fr.dispatchEvent(new Event('load')); await sleep(60); }
  o.liveAfterReloads = window.__lp.live;
  o.intervalsMade = window.__lp.intervals;

  // ★ 높이 쓰기가 **멈추는가** — 고리가 돌면 여기서 계속 는다
  var writes = 0;
  new MutationObserver(function () { writes++; })
    .observe(fr, { attributes: true, attributeFilter: ['style'] });
  await sleep(1200);          // 지켜보기(250ms x 8)가 끝나고도 남는 시간
  o.settled = writes;

  o.h = fr.style.height;
  document.getElementById('probe').textContent = JSON.stringify(o);
})();
</script>`;
  html = html.replace('</body>', driver + '\n</body>');

  const page = path.join(dir, 'probe.html');
  fs.writeFileSync(page, html);

  const dom = renderDom(findBrowser(), page, 30000);
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 스크립트가 죽었다');
  const r = JSON.parse(m[1]);

  assert.ok(r.hasFrame, '단계 화면이 안 떴다 — 이 검사가 아무것도 재지 못했다');

  // ★★ ① 감시자가 **쌓이지 않는다**. 앞 판은 load 한 번에 하나씩 늘었다
  assert.ok(r.liveAfterReloads <= r.liveAfterBoot,
    `같은 화면에 load 가 여섯 번 왔는데 감시자가 늘었다 — `
    + `부팅 뒤 ${r.liveAfterBoot}개 → 여섯 번 뒤 ${r.liveAfterReloads}개`);

  // 살아 있는 지켜보기는 **많아야 하나**다
  assert.ok(r.liveAfterBoot <= 1,
    `부팅만 했는데 지켜보기가 ${r.liveAfterBoot}개다 — 하나면 된다`);

  // ★★ ② 높이 쓰기가 **멈춘다**. 고리가 돌면 여기가 0 이 아니다
  assert.strictEqual(r.settled, 0,
    `내용이 그대로인데 높이를 ${r.settled}번 더 썼다 — 되먹임 고리가 아직 돈다`);

  // ★ 그래도 **재긴 했다**. 0 이면 위 둘은 「아무것도 안 해서」 통과한 것이다
  assert.match(String(r.h), /^\d+px$/, `높이를 아예 못 쟀다 (${r.h}) — 통과가 아니라 안 한 것이다`);

  // ★ 잰 값을 남긴다. 「통과」만 남기면 다음 사람이 얼마나 나아졌는지 모른다
  process.stderr.write(`  [모바일] 지켜보기 ${r.liveAfterBoot}개 · load 6번 뒤 `
    + `${r.liveAfterReloads}개 · 만든 누적 ${r.intervalsMade}개 · 잔여 높이쓰기 ${r.settled}회 · ${r.h}\n`);
});

/**
 * ★★ **이 검사가 옛 판에서 실제로 걸리는지 확인했다** 〈2026-08-21〉.
 *   `git show HEAD:...report-flow.html` 로 되돌려 돌렸더니 이렇게 걸렸다:
 *
 *     같은 화면에 load 가 여섯 번 왔는데 감시자가 늘었다 —
 *     부팅 뒤 4개 → 여섯 번 뒤 10개
 *
 *   ★ **부팅만 했는데 이미 4개**였다. 쓰기 시작하기도 전에 넷이 같은 일을
 *     하고 있었던 것이다. 걸리는 것을 보고 나서야 이 검사가 재는 검사가 된다
 *     (M-08).
 */
