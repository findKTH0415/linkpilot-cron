'use strict';
/**
 * scroll-pinned.test.js — **화면이 한 화면 높이에 못박혀 있지 않은가** 〈2026-09-01 · M-71〉.
 *
 * ★★★ 무슨 일이 있었나. 사장님이 폰에서 「자료 업로드」를 여시니 **내용이 잘린 채
 *   스크롤이 안 됐다.** 단계 화면 다섯에 `html, body { height: 100% }` 가 남아 있었다 —
 *   앱 셸(사이드바 + 100% 높이)로 짜여 있던 시절의 잔재다. 그 셸은 이미 없어졌고
 *   `body` 아래에는 `.wrap` 하나뿐이라 **아무것도 그 규칙에 기대지 않았다.**
 *
 * ★★ **데스크탑에서는 재현되지 않는다.** 같은 규칙으로도 크로미움은 멀쩡히
 *   스크롤한다 — 그래서 오래 안 보였다. 잴 수 있는 것은 스크롤 여부가 아니라
 *   **「상자가 내용보다 작게 못박혔는가」**다: 고치기 전에는 `html` 의 계산된
 *   높이가 **213px**(한 화면)인데 `.wrap` 은 845px 였다.
 *
 * ★ 실제로 스크롤이 되는 두 화면(`report-flow.html` · `index.html`)에는 이 규칙이
 *   **처음부터 없었다.** 잘리는 다섯에만 있었다 — 그것이 이 검사의 근거다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const P = path.join(__dirname, '..', 'ui', 'platform');

/** 앱 안에서 한 칸씩 열리는 단계·탭 화면들 */
const SCREENS = ['intake.html', 'fields.html', 'files.html', 'outputs.html', 'reports.html'];

/** 주석을 떼고 본다 — 경위를 적어 둔 주석이 코드로 읽히면 검사가 눈이 먼다 (§8) */
function css(file) {
  return fs.readFileSync(path.join(P, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

test('★★★ 단계 화면이 `html/body` 를 한 화면 높이로 못박지 않는다', () => {
  const bad = SCREENS.filter((f) =>
    /html\s*,\s*body\s*\{[^}]*(^|[^-\w])height\s*:\s*(100%|100vh)/m.test(css(f)));
  assert.deepStrictEqual(bad, [],
    '이 화면들이 한 화면 높이에 못박혀 있다 — 폰에서 내용이 잘리고 스크롤이 안 된다.'
    + ' `min-height` 로 바꾼다 (배경은 그대로 차고, 내용이 넘치면 늘어난다)');
});

test('★★ 그래도 배경은 화면을 채운다 — `min-height` 는 남아 있어야 한다', () => {
  /* 그냥 지워 버리면 내용이 짧은 날 아래쪽이 흰 띠로 남는다. 고치다 반대로
     망가뜨리지 않게 함께 못박는다. */
  const missing = SCREENS.filter((f) =>
    !/html\s*,\s*body\s*\{[^}]*min-height\s*:\s*100%/m.test(css(f)));
  assert.deepStrictEqual(missing, [], '`min-height: 100%` 가 없다 — 짧은 화면에서 배경이 안 찬다');
});

function findBrowser() {
  const env = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM;
  if (env && fs.existsSync(env)) return env;
  try { return require('../core/raster.js').findBrowser(); } catch (_) { return null; }
}

test('★★★ 실제로 그려서 잰다 — 상자가 내용보다 작지 않다', (t) => {
  const browser = findBrowser();
  if (!browser) { t.skip('헤드리스 크로미움이 없어 **못 쟀다** (통과가 아니다)'); return; }

  /* 화면 이름을 그대로 지켜야 한다 — 이름이 다르면 `hideOwnChrome()` 이
     「앱이 갈아 끼웠다」로 보고 EMBED_CSS 를 얹어 **다른 것을 재게 된다.** */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-scroll-'));
  try {
    for (const n of fs.readdirSync(P)) {
      if (/\.(html?|js|css)$/i.test(n)) {
        try { fs.copyFileSync(path.join(P, n), path.join(dir, n)); } catch (_) {}
      }
    }
    const probe = [
      '<scr' + 'ipt>',
      '(function(){setTimeout(function(){',
      ' var el=document.documentElement,w=document.querySelector(".wrap");',
      ' var o={htmlH:Math.round(parseFloat(getComputedStyle(el).height)),',
      '   wrapH:Math.round(w?w.getBoundingClientRect().height:0)};',
      ' el.setAttribute("data-lp-scroll",JSON.stringify(o));',
      '},2500);}());',
      '</scr' + 'ipt>',
    ].join('\n');
    const target = path.join(dir, 'files.html');
    fs.writeFileSync(target,
      fs.readFileSync(target, 'utf8').replace('</body>', probe + '\n</body>'));

    let dom = '';
    try {
      dom = execFileSync(browser, ['--headless', '--disable-gpu', '--no-sandbox',
        '--window-size=412,300', '--virtual-time-budget=7000',
        '--dump-dom', `file://${target}`], { encoding: 'utf8', timeout: 90000 });
    } catch (e) { t.skip(`크로미움이 못 돌았다 — ${String(e.message).split('\n')[0]}`); return; }

    const m = dom.match(/data-lp-scroll="([^"]*)"/);
    if (!m) { t.skip('재는 값이 안 찍혔다 — **못 쟀다**'); return; }
    const got = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

    assert.ok(got.wrapH > 300, `내용이 한 화면보다 커야 재는 뜻이 있다 (${got.wrapH}px)`);
    assert.ok(got.htmlH >= got.wrapH,
      `상자가 내용보다 작다 — html ${got.htmlH}px < 내용 ${got.wrapH}px.`
      + ' 폰에서 이 모양이 「스크롤이 안 된다」로 나온다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
