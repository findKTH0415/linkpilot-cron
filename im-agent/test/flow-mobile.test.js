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
    /* 2026-08-23: 고르기 칸은 갈래 안(.wayin)이 아니라 1(.pickone) 이다.
       역따옴표를 쓰지 않는다 — 이 글은 템플릿 문자열 안에 있다 */
    var w = document.querySelector('.pickone');
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
      /* ★ 아래 여백은 **바깥 상자(.pickway)** 가 갖는다 〈2026-08-22〉 —
       *   상자가 overflow:hidden 이라 안쪽 칸의 margin 은 밖으로 나가지 못한다.
       *   그래서 재는 대상도 상자로 옮긴다 (여기서 옮기지 않으면 「0px 이라
       *   붙었다」로 잘못 잡는다 — 화면은 멀쩡한데 검사만 운다) */
      gapBelow: (function () {
        var host = (w && w.closest('.pickway')) || (w && w.parentNode);
        if (!host) return null;
        var next = host.nextElementSibling;
        if (next) return Math.round(next.getBoundingClientRect().top - w.getBoundingClientRect().bottom);
        var hcs = getComputedStyle(host);
        return parseFloat(hcs.marginBottom);
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

  /* ★ 고르기와 안내가 붙어 있으면 한 덩어리로 읽혀 안내를 안 본다.
   *   ★★ 다만 **안내가 늘 있는 것은 아니다** 〈2026-08-22〉. 「프로젝트를
   *     고르면…」은 고르기 칸이 이미 하는 말이라 지웠다(사용자 지시). 남은
   *     안내는 작업 폴더가 없을 때뿐이다. 그래서 **있을 때만** 잰다 —
   *     없는 것을 0 으로 재면 멀쩡한 화면을 고장이라고 말한다. */
  if (r.noteGap !== null && r.noteGap !== undefined) {
    assert.ok(r.noteGap >= 12,
      `고르기와 안내 사이가 ${r.noteGap}px 다 — 붙어 있으면 안내를 안 읽는다`);
  }

  process.stderr.write(`  [여백] 위 ${r.padTop} · 아래 ${r.padBottom} · 아래간격 `
    + `${r.gapBelow} · 고르기↔안내 ${r.noteGap === null ? '안내 없음' : r.noteGap} (430px 너비)\n`);
});

/* ═════════ ④ 자료 넣는 방법 — **한 벌의 토글** 〈2026-08-22 사용자 지시〉 ═════════ */

/**
 *     [파일업로드] [폴더 지정]   〈2026-08-23 — 프로젝트 지정은 ① 로 올라갔다〉
 *      └─ 고른 갈래의 칸이 **셋 아래**에서 열린다
 *
 * ★★ 이 자리는 판이 세 번 바뀌었다. **검사도 함께 바뀌어 왔다** —
 *   그래서 무엇을 지키려는 것인지 다시 적어 둔다.
 *
 *     ① 처음: `auto-fit` 으로 흘렸다 → 창 너비에 따라 2+1 도 되고 1+1+1 도
 *        되어서 **어느 것이 한 벌인지가 그때그때 달라졌다.**
 *     ② 2026-08-21: 단을 둘로 나눴다 (1단 앱 / 2단 연결·업로드).
 *     ③ 2026-08-22 **지금**: 단을 없애고 셋을 한 줄로.
 *
 * ★ ③ 은 ① 로 되돌아가는 것이 **아니다.** ① 의 문제는 「한 줄」이 아니라
 *   **「몇 칸이 될지 모른다」**였다. 그래서 이 검사는 **열이 흐르지 않는가**를
 *   본다 — 넓은 화면에서는 셋이 나란히, 좁으면 셋이 세로로. 어느 쪽이든
 *   **2+1 이 되지 않는다.**
 */
test('★★★ 자료 넣는 방법 둘이 한 테두리 안에 나란히 있다 (고르는 단계가 없다)', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;

  /* ★★★ 〈2026-08-23 사장님 지시 「병합」으로 이 검사가 통째로 바뀌었다〉
   *
   *   앞 판은 [파일업로드] [폴더 지정] **토글**이었고, 이 검사는 그 칸들이
   *   흐르지 않는가(2+1 이 되지 않는가)를 쟀다. 이제 토글이 없다 — 둘은 한
   *   테두리 안에 **위아래로** 있고, 고르는 단계 자체가 사라졌다.
   *
   *   ★ 왜 합쳤나. 둘은 **고르는 문제가 아니다** — 한 딜에서 사업계획서는
   *     파일로 올리고 실사자료는 폴더로 가리키는 일이 그냥 있다. 토글로 두면
   *     한쪽을 쓰는 동안 다른 쪽이 안 보이고, 그래서 「그건 못 하나 보다」가 된다.
   *
   *   ★ 그래서 지금 재는 것은 **둘이 함께 보이는가**와 **테두리가 하나인가**다.
   *     테두리가 둘이면 다시 「고르는 것」으로 읽힌다.
   */
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-merge-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = `<div id="probe"></div><script>(async function () {
    var sleep = function (m) { return new Promise(function (r) { setTimeout(r, m); }); };
    var t = function (n) { return n ? (n.textContent || '').trim() : null; };
    var o = { err: [] };
    window.addEventListener('error', function (e) { o.err.push(e.message); });
    await sleep(250);
    var sel = document.querySelector('.pickone select');
    if (sel) {
      var opt = [].slice.call(sel.options).filter(function (x) { return /^LP-/.test(x.value); })[0];
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    await sleep(600);
    o.blocks = [].slice.call(document.querySelectorAll('.ways2__t')).map(t);
    o.or = t(document.querySelector('.ways2__or'));
    var box = document.querySelector('.ways2');
    if (box) {
      o.boxBorder = Math.round(parseFloat(getComputedStyle(box).borderTopWidth));
      /* 안쪽 칸에 테두리가 있으면 「고르는 것」으로 읽힌다 */
      o.innerBorders = [].slice.call(box.querySelectorAll('.ways2__b')).filter(function (n) {
        var c = getComputedStyle(n);
        return parseFloat(c.borderTopWidth) > 0 || parseFloat(c.borderLeftWidth) > 0;
      }).length;
      /* 둘이 **세로로** 있다 — 같은 y 면 나란히라 「고르는 것」처럼 보인다 */
      var bs = [].slice.call(box.querySelectorAll('.ways2__b'));
      o.stacked = bs.length === 2
        && Math.round(bs[1].getBoundingClientRect().top) > Math.round(bs[0].getBoundingClientRect().bottom) - 2;
    }
    o.tiles = document.querySelectorAll('.pw').length;
    document.getElementById('probe').textContent = JSON.stringify(o);
  }());<` + `/script>`;

  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  const measure = (w) => {
    const dom = renderDom(findBrowser(), page, 40000, w);
    const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
    assert.ok(m && m[1], `탐침이 아무것도 안 남겼다 (${w}px)`);
    return JSON.parse(m[1]);
  };

  for (const w of [1100, 430]) {
    const r = measure(w);
    assert.deepStrictEqual(r.err, [], `${w}px: 그리는 동안 예외가 났다`);
    assert.deepStrictEqual(r.blocks, ['파일업로드', '폴더 지정'],
      `${w}px: 자료 넣는 칸이 둘이 아니다 — ${JSON.stringify(r.blocks)}`);
    assert.strictEqual(r.tiles, 0,
      `${w}px: 갈래 토글이 되살아났다 (${r.tiles}개) — 합친 뜻이 사라진다`);
    assert.match(String(r.or), /또는/,
      `${w}px: 「또는」이 없다 — 붙여만 두면 아래쪽이 위쪽에 딸린 것으로 읽힌다`);
    assert.ok(r.boxBorder >= 1, `${w}px: 바깥 테두리가 없다 — 한 벌로 안 묶인다`);
    assert.strictEqual(r.innerBorders, 0,
      `${w}px: 안쪽 칸에 테두리가 ${r.innerBorders}개 있다 — 다시 「고르는 것」으로 읽힌다`);
    assert.ok(r.stacked, `${w}px: 둘이 나란히 놓였다 — 세로로 서야 고르는 것으로 안 보인다`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('★★ 진행 그래프가 좁으면 세로로 서고, 넓으면 그대로 가로다', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;

  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-fx-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = `<div id="probe"></div><script>setTimeout(function () {
    var o = {};
    var sel = document.querySelector('.pickone select');
    if (sel) {
      var opt = [].slice.call(sel.options).filter(function (x) { return /^LP-/.test(x.value); })[0];
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    setTimeout(function () {
      var scan = [].slice.call(document.querySelectorAll('button')).filter(function (b) {
        return b.textContent.trim() === '자료 스캔'; })[0];
      o.hasScan = !!scan;
      if (scan) scan.click();
      setTimeout(function () {
        var g = document.querySelector('.fx__g');
        o.hasGraph = !!g;
        if (g) {
          var ns = [].slice.call(g.querySelectorAll('.fx__n'));
          o.dir = getComputedStyle(g).flexDirection;
          o.count = ns.length;
          o.labels = ns.map(function (n) { return (n.querySelector('.fx__t') || {}).textContent; });
          o.tops = ns.map(function (n) { return Math.round(n.getBoundingClientRect().top); });
          var vw = document.documentElement.clientWidth;
          o.cut = ns.filter(function (n) { return n.getBoundingClientRect().right > vw + 1; }).length;
        }
        document.getElementById('probe').textContent = JSON.stringify(o);
      }, 700);
    }, 500);
  }, 900);</script>`;

  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  const read = (w) => {
    const dom = renderDom(findBrowser(), page, 22000, w);
    const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
    assert.ok(m && m[1], `${w}px: 탐침이 아무것도 안 남겼다`);
    return JSON.parse(m[1]);
  };

  // ── 휴대폰 너비 ────────────────────────────────
  const p = read(430);
  assert.ok(p.hasScan, '자료 스캔 단추를 못 찾았다 — 아무것도 재지 못했다');
  assert.ok(p.hasGraph, '진행 그래프가 안 떴다');
  assert.strictEqual(p.dir, 'column', `좁은 화면인데 ${p.dir} 이다 — 세로로 서야 한다`);
  assert.ok(p.count >= 4, `칸이 ${p.count}개다 — 넷이 다 있어야 한다`);
  // ★★ **잘린 칸이 없다.** 이것이 원래 신고된 증상이다
  assert.strictEqual(p.cut, 0, `${p.cut}칸이 화면 밖으로 잘렸다 — 잘린 칸은 없는 것처럼 보인다`);
  // 세로라면 칸마다 top 이 달라야 한다 (같으면 이름만 세로고 실제로는 겹친 것)
  assert.strictEqual(new Set(p.tops).size, p.tops.length,
    '세로라는데 칸들의 높이가 같다 — 겹쳐 있다');
  assert.match(String(p.labels[p.labels.length - 1]), /보고서 생성/,
    '마지막 칸이 「보고서 생성으로」가 아니다 — 다음에 무엇이 오는지가 사라진다');

  // ── 넓은 화면은 **그대로** ──────────────────────
  const d = read(1100);
  assert.strictEqual(d.dir, 'row', `넓은 화면인데 ${d.dir} 이다 — 가로를 망가뜨렸다`);
  assert.strictEqual(new Set(d.tops).size, 1, '넓은 화면에서 칸들이 줄이 어긋났다');
  assert.strictEqual(d.cut, 0, '넓은 화면에서 잘린 칸이 있다');

  process.stderr.write(`  [그래프] 430px ${p.dir} ${p.count}칸 잘림 ${p.cut} · `
    + `1100px ${d.dir} 잘림 ${d.cut}\n`);
});
