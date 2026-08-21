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

/* ═════════ ③ **좁은 화면 여백** — 준 값이 실제로 먹었는가 ═════════ */

/**
 * ★★ 〈2026-08-21 · 사용자 지시 「[파일 업로드] 와 위아래 여백을 넉넉히」〉
 *
 *   여백을 넓히고 **재 봤더니 준 값이 아니었다.** 좁은 화면용 규칙을 파일
 *   앞쪽 미디어 블록에 적었는데, **아래에 있는 기본 규칙이 그대로 덮어썼다** —
 *   힘이 같으면 나중에 쓴 것이 이긴다.
 *
 * ★ 이 종류는 **눈으로 안 잡힌다.** 화면은 멀쩡히 뜨고 오류도 없다. 여백이
 *   22px 인지 20px 인지는 보고 알 수 없고, 「고쳤다」와 「덮였다」가 똑같아
 *   보인다. 그래서 **소스가 아니라 그려진 결과를 잰다.**
 */
test('★★ 좁은 화면에서 준 여백이 실제로 먹는다 (덮이면 잡는다)', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;

  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-gap-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = `<div id="probe"></div><script>setTimeout(function () {
    var w = document.querySelector('.wayin');
    var pick = w && w.querySelector('.pick'), note = w && w.querySelector('.note');
    var cs = w && getComputedStyle(w);
    document.getElementById('probe').textContent = JSON.stringify({
      found: !!w,
      padTop: cs && parseFloat(cs.paddingTop),
      padBottom: cs && parseFloat(cs.paddingBottom),
      /* ★ 속성이 아니라 실제 간격을 잰다 — 아래 여백이 margin 에서 단 사이
       *   간격(grid gap)으로 옮겨갔다. 속성만 보면 0px 이라 「붙었다」로 읽히는데
       *   화면은 22px 떨어져 있다. (여기 안에는 역따옴표를 쓰지 않는다 —
       *   이 글은 템플릿 문자열 속이라 한 글자로 문자열이 끊긴다) */
      gapBelow: (function () {
        var next = w && w.parentNode && w.parentNode.nextElementSibling;
        if (next) return Math.round(next.getBoundingClientRect().top - w.getBoundingClientRect().bottom);
        return cs ? parseFloat(cs.marginBottom) : null;
      })(),
      noteGap: (pick && note)
        ? Math.round(note.getBoundingClientRect().top - pick.getBoundingClientRect().bottom) : null
    });
  }, 900);</script>`;

  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  // ★ 휴대폰 너비로 잰다. 넓은 화면에서는 이 규칙이 아예 안 걸려 통과해 버린다
  const dom = renderDom(findBrowser(), page, 20000, 430);
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다');
  const r = JSON.parse(m[1]);

  assert.ok(r.found, '고르기 칸을 못 찾았다 — 아무것도 재지 못했다');

  // 좁은 화면 규칙이 말하는 값 (files.html 의 @media max-width:560px)
  assert.strictEqual(r.padBottom, 22,
    `아래 안쪽 여백이 ${r.padBottom}px 다 — 좁은 화면 규칙(22px)이 덮였다. `
    + '기본 규칙보다 **뒤에** 두었는지 본다');
  assert.ok(r.gapBelow >= 20,
    `고르기 칸 아래가 ${r.gapBelow}px 다 — 다음 단과 붙는다`);
  assert.ok(r.padTop >= 18, `위 안쪽 여백이 ${r.padTop}px 다 (18px 이상이어야 한다)`);

  // ★ 고르기와 안내가 붙어 있으면 한 덩어리로 읽혀 안내를 안 본다
  assert.ok(r.noteGap >= 12,
    `고르기와 안내 사이가 ${r.noteGap}px 다 — 붙어 있으면 안내를 안 읽는다`);

  process.stderr.write(`  [여백] 위 ${r.padTop} · 아래 ${r.padBottom} · 아래간격 `
    + `${r.gapBelow} · 고르기↔안내 ${r.noteGap} (430px 너비)\n`);
});

/* ═════════ ④ 자료 붙이기 **단 배치** 〈2026-08-21 사용자 지시〉 ═════════ */

/**
 *     1단  앱 프로젝트에서 가져오기        (+ 고르기가 이어 붙는다)
 *     2단  폴더를 연결해서 · 파일업로드    (나란히)
 *     3단  파일 드롭하여 놓기              (파일업로드를 누르면 함께 뜬다)
 *
 * ★★ 앞 판은 셋을 `auto-fit` 으로 **한 줄에 흘렸다.** 창 너비에 따라 2+1 이
 *   되기도 1+1+1 이 되기도 해서 **어느 것이 한 벌인지가 그때그때 달랐다.**
 *   그래서 이 검사는 **휴대폰 너비에서** 단이 실제로 그렇게 나뉘는지 본다 —
 *   넓은 창에서 재면 흘러가는 배치도 그럴듯하게 통과한다.
 */
test('★★ 자료 붙이기가 세 단으로 나뉘고, 파일업로드가 창을 한 번만 연다', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;

  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-rows-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = `<div id="probe"></div><script>setTimeout(function () {
    var o = {}, nm = function (r) {
      return [].slice.call(r.querySelectorAll('.pw__t')).map(function (t) {
        return t.textContent.trim().replace(/\\s*무료$/, ''); }); };
    o.rows = [].slice.call(document.querySelectorAll('.pwrow')).map(nm);

    var st = document.querySelector('.pwstack'), wi = document.querySelector('.wayin');
    o.wayinInStack = !!(st && wi && st.contains(wi));
    if (st && wi) o.attachGap =
      Math.round(wi.getBoundingClientRect().top - st.querySelector('.pwrow').getBoundingClientRect().bottom);
    var rows = document.querySelectorAll('.pwrow');
    if (rows.length > 1 && wi) o.rowGap =
      Math.round(rows[1].getBoundingClientRect().top - wi.getBoundingClientRect().bottom);

    // 프로젝트를 먼저 고른다 — 안 고르면 문지기가 먼저 걸린다
    var sel = document.querySelector('.wayin select');
    if (sel) {
      var opt = [].slice.call(sel.options).filter(function (x) { return /^LP-/.test(x.value); })[0];
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    setTimeout(function () {
      var up = [].slice.call(document.querySelectorAll('.pw')).filter(function (b) {
        return /파일업로드/.test(b.textContent); })[0];
      o.hasUpTile = !!up;
      var n = 0, orig = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () { n++; return orig.apply(this, arguments); };
      if (up) up.click();
      setTimeout(function () {
        o.inputClicked = n;
        o.dropShown = !!document.querySelector('.drop');
        document.getElementById('probe').textContent = JSON.stringify(o);
      }, 400);
    }, 500);
  }, 900);</script>`;

  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  const dom = renderDom(findBrowser(), page, 22000, 430);
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다');
  const r = JSON.parse(m[1]);

  // ① 단이 **둘**이고, 무엇이 어디에 있는지가 정해져 있다
  assert.strictEqual(r.rows.length, 2, `단이 ${r.rows.length}개다 (2개여야 한다)`);
  assert.strictEqual(r.rows[0].length, 1, '1단에 둘 이상이 있다 — 앱 갈래 하나여야 한다');
  assert.match(r.rows[0][0], /앱 프로젝트에서 가져오기/, '1단이 앱 갈래가 아니다');
  assert.strictEqual(r.rows[1].length, 2, '2단이 나란히 둘이 아니다');
  assert.match(r.rows[1][0], /폴더를 연결해서/, '2단 왼쪽이 연결이 아니다');
  assert.match(r.rows[1][1], /파일업로드/, '2단 오른쪽이 파일업로드가 아니다');

  // ② ★ 고르기는 1단에 **이어 붙는다** — 떨어지면 어느 갈래 것인지 안 보인다
  assert.ok(r.wayinInStack, '고르기가 1단 겹 밖에 있다');
  assert.ok(r.attachGap <= 0, `1단과 고르기 사이가 ${r.attachGap}px 벌어졌다 — 붙어 있어야 한다`);

  // ③ 단 사이는 **넉넉히** (사용자 지시)
  assert.ok(r.rowGap >= 20, `단 사이가 ${r.rowGap}px 다 — 붙어 있으면 한 덩어리로 읽힌다`);

  // ④ ★★ 파일업로드를 누르면 **드롭 자리가 함께 뜨고, 창은 한 번만** 열린다
  assert.ok(r.hasUpTile, '파일업로드 칸을 못 찾았다');
  assert.ok(r.dropShown, '파일업로드를 눌렀는데 드롭 자리가 안 떴다');
  assert.strictEqual(r.inputClicked, 1,
    `고르기 창이 ${r.inputClicked}번 열렸다 — 두 번이면 사용자에게는 「닫으면 또 뜬다」로 보인다`);

  process.stderr.write(`  [단] 1단 ${r.rows[0].length}칸 · 2단 ${r.rows[1].length}칸 · `
    + `이음매 ${r.attachGap} · 단 사이 ${r.rowGap} · 창 ${r.inputClicked}회\n`);
});
