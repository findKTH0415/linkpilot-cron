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

/* ═════════ ② **흰 화면** — 느린 것과 고장난 것이 똑같이 보인다 ═════════ */

/**
 * ★★ 〈2026-08-21 · 신고 화면이 통째로 비어 있었다〉
 *
 *   자료 업로드 탭을 열면 **흰 칸 하나**만 떠 있었다. 사용자는 그것을
 *   「로딩이 너무 느림」이라고 불렀다 — 맞는 말이지만, 더 정확히는
 *   **기다릴지 되돌아갈지 정할 근거가 화면에 하나도 없었다.**
 *
 *   이유는 구조에 있었다. 화면 파일들은 `<body>` 에 `<div id="view"></div>`
 *   하나만 두고 나머지를 스크립트가 그린다. 그래서 **파일을 다 받고 스크립트가
 *   돌기 전까지는 그릴 것이 아무것도 없다.** 자료 업로드 화면은 112KB 라
 *   그 시간이 길다.
 *
 * ★ 그래서 뼈대를 HTML 에 박았다. 첫 바이트가 도착하는 순간
 *   「자리는 잡혔고 채워지는 중」이 보인다. 그리고 **오래 걸리면 말한다** —
 *   뼈대만 영원히 두면 그것도 흰 화면과 다를 바 없다.
 */
const BOOT_SCREENS = ['files.html', 'report-flow.html', 'outputs.html'];

test('★★ 스크립트가 돌기 전에도 그릴 것이 있다 (흰 화면 금지)', () => {
  BOOT_SCREENS.forEach((f) => {
    const s = fs.readFileSync(path.join(PLATFORM, f), 'utf8');

    // ① 뼈대가 **HTML 에** 있다. 스크립트가 만들면 이 문제를 못 푼다
    assert.ok(/<div class="wrap" id="view">\s*<!--/.test(s),
      `${f}: #view 가 비어 있다 — 파일을 다 받을 때까지 흰 화면이다`);
    assert.match(s, /id="lp-boot"/, `${f}: 뼈대가 없다`);

    // ② ★ 읽어 주는 기기에도 「지금 무언가 되는 중」이 전해져야 한다
    assert.match(s, /role="status"/, `${f}: 뼈대에 role=status 가 없다`);

    // ③ ★★ **오래 걸리면 말한다.** 뼈대만 두면 흰 화면과 같아진다
    assert.match(s, /lp-boot-why/, `${f}: 오래 걸릴 때 할 말이 없다`);
    assert.match(s, /아직 화면이 안 떴습니다/, `${f}: 무엇이 문제인지 안 말한다`);

    // ④ 뼈대는 **첫 그리기에서 사라져야 한다** — 안 지우면 진짜 화면 위에 남는다
    assert.ok(/view\.(textContent = ''|innerHTML = '')/.test(s),
      `${f}: 첫 그리기가 #view 를 비우지 않는다 — 뼈대가 안 사라진다`);
  });
});

test('★ 세 화면의 뼈대가 **같다** — 한쪽만 고치면 갈린다', () => {
  const grab = (f) => {
    const s = fs.readFileSync(path.join(PLATFORM, f), 'utf8');
    const m = s.match(/<div class="wrap" id="view">[\s\S]*?<\/div>\n<\/div>|<div class="wrap" id="view">[\s\S]*?\n<\/div>/);
    return m ? m[0] : null;
  };
  const first = grab(BOOT_SCREENS[0]);
  assert.ok(first, '뼈대를 못 찾았다');
  BOOT_SCREENS.slice(1).forEach((f) => {
    assert.strictEqual(grab(f), first,
      `${f} 의 뼈대가 ${BOOT_SCREENS[0]} 과 다르다 — 손으로 세 벌을 들고 있으므로 검사가 붙들어야 한다`);
  });
});

/**
 * ★★ 뼈대는 **모양만 있고 뜻이 없으면** 안 된다. 회색 막대 세 줄이 진짜로
 *   그려지는지, 그리고 스크립트가 돌면 **정말 사라지는지**를 브라우저에서 본다.
 *   (정적으로 훑으면 CSS 가 빠져 안 보이는 경우를 못 잡는다)
 */
test('★★ 실제 브라우저에서 뼈대가 보이고, 화면이 뜨면 사라진다', () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-boot-'));
  require(path.join(PLATFORM, 'build-embed.js')).build(dir);

  // ① 스크립트를 막으면 **뼈대만** 남아야 한다 (= 느린 회선에서 보는 것)
  let s = fs.readFileSync(path.join(PLATFORM, 'files.html'), 'utf8')
    .replace(/<script src="[^"]+"><\/script>/g, '')
    .replace(/<script>(?![\s\S]*?lp-boot-why)[\s\S]*?<\/script>/g, '');
  const slow = path.join(dir, 'slow.html');
  fs.writeFileSync(slow, s + '<div id="probe"></div><script>'
    + 'var b=document.getElementById("lp-boot");'
    + 'var bars=document.querySelectorAll(".boot__b");'
    + 'document.getElementById("probe").textContent=JSON.stringify({'
    + 'boot:!!b, bars:bars.length, h:b?Math.round(b.getBoundingClientRect().height):0});'
    + '</script>');
  const d1 = renderDom(findBrowser(), slow, 8000);
  const m1 = d1.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m1 && m1[1], '탐침이 아무것도 안 남겼다');
  const r1 = JSON.parse(m1[1]);
  assert.ok(r1.boot, '스크립트가 없을 때 뼈대가 안 보인다 — 그러면 흰 화면 그대로다');
  assert.strictEqual(r1.bars, 3, `막대가 ${r1.bars}줄이다 (3줄이어야 한다)`);
  assert.ok(r1.h > 40, `뼈대 높이가 ${r1.h}px 다 — CSS 가 안 실려 자리를 안 잡았다`);

  // ② 제대로 돌면 뼈대가 **사라진다**
  const real = path.join(dir, 'real.html');
  fs.writeFileSync(real, fs.readFileSync(path.join(dir, 'files.html'), 'utf8')
    .replace('</body>', '<div id="probe"></div><script>setTimeout(function(){'
      + 'document.getElementById("probe").textContent=JSON.stringify({'
      + 'boot:!!document.getElementById("lp-boot"),'
      + 'kids:document.getElementById("view").children.length});},600);</script></body>'));
  const d2 = renderDom(findBrowser(), real, 12000);
  const m2 = d2.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m2 && m2[1], '두 번째 탐침이 아무것도 안 남겼다');
  const r2 = JSON.parse(m2[1]);
  assert.ok(r2.kids > 0, '화면이 아무것도 안 그렸다 — 뼈대만 재고 끝낼 뻔했다');
  assert.strictEqual(r2.boot, false, '화면이 떴는데 뼈대가 아직 남아 있다 — 진짜 내용 위에 겹친다');
});
