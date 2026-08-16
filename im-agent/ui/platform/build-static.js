#!/usr/bin/env node
'use strict';
/**
 * build-static.js — 미리보기를 **스크립트 없이도 보이게** 만든다.
 *
 *   npm run im:static        → section-static.html
 *
 * 왜 따로 만드는가: 평소 미리보기(`im:section`)는 단계 화면 넷을 **브라우저에서
 * 스크립트로 그려 넣는다.** 그래서 보는 쪽에서 스크립트가 막혀 있으면 (사이드
 * 패널·문서 뷰어·메일 등) 위쪽 패널만 뜨고 화면은 빈 칸이 된다. 화면을 보라고
 * 보냈는데 빈 칸이 오는 것은 안 보낸 것보다 나쁘다 — 고장으로 읽힌다.
 *
 * 그래서 여기서는 **빌드할 때 헤드리스 브라우저로 미리 그려서** 그 결과(DOM)를
 * 그대로 심는다. 받는 쪽은 스크립트를 한 줄도 실행하지 않는다.
 *
 * ★ 스크립트를 지운 뒤에도 **CSS 는 살려야** 하므로 iframe(srcdoc)에 담는다.
 *   한 문서에 이어 붙이면 화면 넷의 스타일이 서로 덮는다 (그래서 원래도 iframe 이다).
 *   srcdoc 은 HTML 소스에 글자로 들어가므로 스크립트 없이 그려진다.
 *
 * ★ 높이는 **재서 넣는다.** 스크립트가 없으면 iframe 이 스스로 늘어나지 못해
 *   기본 150px 로 잘린다. 그리기 전에 높이를 재는 코드를 잠깐 넣었다가,
 *   재고 나면 스크립트를 통째로 걷어낸다.
 *
 * ★ 이 빌드는 헤드리스 크로미움이 있어야 돈다. 없으면 만들지 않고 그렇다고 말한다 —
 *   조용히 빈 파일을 내놓지 않는다.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const { SCREENS, buildSectionDocs } = require('./build-preview.js');
const FLOW = require('./flow-core.js');

/** 헤드리스 크로미움 찾기 — 환경마다 경로가 다르다 */
function findBrowser() {
  const fromEnv = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM;
  const candidates = [fromEnv].filter(Boolean);
  const roots = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch (_) { continue; }
    for (const d of dirs) {
      candidates.push(path.join(root, d, 'chrome-linux', 'headless_shell'));
      candidates.push(path.join(root, d, 'chrome-linux', 'chrome'));
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }) || null;
}

/**
 * 그리기 전에 **접힌 것을 펴 둔다.**
 *
 * ★ 미리 그려 넣은 판은 눌러 볼 수 없다. 접힌 채로 그리면 「자동 계산으로
 *   만들어지는 항목 19개」가 제목만 남고 목록은 영영 안 보인다 — 확인하라고
 *   보낸 화면에서 확인할 것이 사라진다. 그래서 아코디언을 전부 펴고 그린다.
 */
const EXPAND = `
<script>
(function () {
  function open() {
    var hs = document.querySelectorAll('.auto__h[aria-expanded="false"]');
    for (var i = 0; i < hs.length; i++) hs[i].click();
    return hs.length;
  }
  var tries = 0;
  var t = setInterval(function () {
    if (open() === 0 || ++tries > 12) clearInterval(t);
  }, 250);
}());
<\/script>`;

/** 높이를 재서 body 에 적어 두는 코드 — 재고 나면 스크립트는 전부 걷힌다 */
const MEASURE = `
<script>
(function () {
  function mark() {
    var d = document.documentElement, b = document.body;
    var h = Math.max(b.scrollHeight, d.scrollHeight, b.offsetHeight, d.offsetHeight);
    b.setAttribute('data-rendered-height', String(h));
  }
  window.addEventListener('load', function () { setTimeout(mark, 900); });
  setTimeout(mark, 2500);
}());
<\/script>`;

function renderDom(browser, file) {
  return execFileSync(browser, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1280,900', '--virtual-time-budget=6000', '--dump-dom',
    'file://' + file,
  ], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

/**
 * 그려진 DOM 에서 스크립트를 걷어낸다.
 * ★ 남겨 두면 받는 쪽에서 다시 돌면서 이미 그려진 화면을 지우고 새로 그린다 —
 *   스크립트가 막힌 환경을 위해 만든 파일인데 스크립트에 다시 기대게 된다.
 */
function stripScripts(dom) {
  return dom
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+="[^"]*"/gi, '');
}

function heightOf(dom) {
  const m = dom.match(/data-rendered-height="(\d+)"/);
  const h = m ? Number(m[1]) : 0;
  // 못 쟀으면 넉넉히 준다. 잘린 화면보다 빈 여백이 낫다
  return Math.min(Math.max(h || 2400, 600), 20000);
}

function esc(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('헤드리스 크로미움을 찾지 못했다 — 미리 그려 넣을 수 없다.');
    console.error('CHROME_PATH 로 알려 주거나, 스크립트가 도는 곳에서는 `npm run im:section` 을 쓴다.');
    process.exit(2);
  }

  const docs = await buildSectionDocs();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-static-'));

  const panels = SCREENS.map((s, i) => {
    const f = path.join(tmp, `${s.id}.html`);
    fs.writeFileSync(f, docs[s.id] + EXPAND + MEASURE);
    const dom = renderDom(browser, f);
    const h = heightOf(dom);
    const clean = stripScripts(dom);
    process.stderr.write(`  ${i + 1}. ${s.name} — ${Math.round(clean.length / 1024)}KB · ${h}px\n`);
    return `
  <section class="pv">
    <header class="pv__h">
      <span class="pv__n">${i + 1}</span>
      <div>
        <h2 class="pv__t">${esc(s.name)}</h2>
        <p class="pv__d">${esc(s.note || (FLOW.WHY && FLOW.WHY[s.id]) || '')}</p>
      </div>
    </header>
    <iframe class="pv__f" style="height:${h}px" title="${esc(s.name)}"
      srcdoc="${esc(clean)}"></iframe>
  </section>`;
  }).join('');

  const { changePanel, evidencePanel } = require('./build-preview.js');

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>보고서 생성 섹션 미리보기 (미리 그려 넣은 판)</title>
<style>
  body { margin: 0; background: #F5F6F8; color: #17181A;
    font: 400 15px/1.6 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
      'Malgun Gothic', Arial, sans-serif; }
  .top { max-width: 1120px; margin: 0 auto; padding: 20px 20px 0; }
  .top__t { font-size: 20px; font-weight: 800; margin: 0; }
  .top__d { font-size: 13.5px; color: #7C838C; margin: 6px 0 0; }
  .pv { max-width: 1120px; margin: 14px auto 0; background: #fff;
    border: 1px solid #E8EAEC; border-radius: 18px; overflow: hidden; }
  .pv__h { display: flex; gap: 12px; align-items: flex-start; padding: 16px 20px;
    border-bottom: 1px solid #E8EAEC; }
  .pv__n { width: 26px; height: 26px; flex: none; border-radius: 50%; background: #17181A;
    color: #fff; display: grid; place-items: center; font: 800 13px/1 inherit; }
  .pv__t { font-size: 16px; font-weight: 800; margin: 0; }
  .pv__d { font-size: 13px; color: #7C838C; margin: 3px 0 0; }
  .pv__f { display: block; width: 100%; border: 0; }
</style>
</head>
<body>
<div class="top">
  <h1 class="top__t">보고서 생성 섹션 — 미리 그려 넣은 판</h1>
  <p class="top__d">화면 넷을 <b>만들 때 미리 그려서</b> 넣었습니다. 여는 쪽에서 스크립트가
    돌지 않아도 그대로 보입니다. 대신 <b>눌러 볼 수는 없습니다</b> — 접기·펼치기나 입력이
    필요하면 <code>section-preview.html</code> 을 여세요.</p>
</div>
${changePanel()}
${evidencePanel()}
${panels}
</body>
</html>
`;

  const out = path.join(HERE, 'section-static.html');
  fs.writeFileSync(out, html);
  console.log(`${out} (${Math.round(html.length / 1024)}KB) · 미리 그려 넣은 화면 ${SCREENS.length}개`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { stripScripts, heightOf, findBrowser, EXPAND, MEASURE };
