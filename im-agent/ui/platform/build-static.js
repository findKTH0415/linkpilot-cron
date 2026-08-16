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

/**
 * 앱 안에 끼웠을 때의 모습으로 그린다.
 *
 * ★ 화면 파일들은 따로 열면 자기 사이드바·로고·단계 칩을 갖고 있다. 섹션에 끼우면
 *   `flow-core` 의 EMBED_CSS 가 그것들을 감추는데, 미리 그릴 때 이걸 빼먹으면
 *   미리보기에만 사이드바가 두 번 나오고 단계 표시가 두 벌로 보인다 —
 *   실제 앱과 다른 그림을 확인용으로 보내는 셈이다.
 */
const EMBED = `<style>${FLOW.EMBED_CSS}</style>`;

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
    fs.writeFileSync(f, docs[s.id] + EMBED + EXPAND + MEASURE);
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

/**
 * 주소로 여는 판 (아티팩트). 파일로 보내면 다운로드 카드로만 뜨는 곳이 있어서,
 * **한 문서로 이어 붙인** 조각을 만든다 — iframe 도 스크립트도 쓰지 않는다.
 *
 * 결과는 `<title>` + `<style>` + 본문 조각이다. 감싸는 문서(doctype·head·body)는
 * 올리는 쪽이 붙이므로 여기서 만들지 않는다.
 */
async function buildArtifact() {
  const browser = findBrowser();
  if (!browser) throw new Error('헤드리스 크로미움이 없어 미리 그릴 수 없다');

  const docs = await buildSectionDocs();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-art-'));

  const css = [], body = [];
  SCREENS.forEach((s, i) => {
    const f = path.join(tmp, `${s.id}.html`);
    fs.writeFileSync(f, docs[s.id] + EMBED + EXPAND + MEASURE);
    const dom = renderDom(browser, f);
    const part = inlineScreen(dom, `scr-${s.id}`);
    css.push(part.css);
    body.push(`
  <section class="pv">
    <header class="pv__h">
      <span class="pv__n">${i + 1}</span>
      <div>
        <h2 class="pv__t">${esc(s.name)}</h2>
        <p class="pv__d">${esc(s.note || '')}</p>
      </div>
    </header>
    ${part.html}
  </section>`);
    process.stderr.write(`  ${i + 1}. ${s.name} — ${Math.round(part.html.length / 1024)}KB\n`);
  });

  const { changePanel, evidencePanel } = require('./build-preview.js');
  const frag = `<title>보고서 생성 섹션</title>
<style>
${WRAP_CSS}
${css.join('\n')}
</style>
<div class="lead">
  <h1 class="lead__t">보고서 생성 섹션</h1>
  <p class="lead__d">LinkPilot 앱에 붙는 4단계 화면과, 지금까지 한 일을 확인하는 두 패널입니다.
    화면은 <b>만들 때 미리 그려서</b> 넣었습니다 — 그대로 보이지만 눌리지는 않습니다.</p>
</div>
${changePanel()}
${evidencePanel()}
${body.join('')}
`;

  // ★ 못 올릴 조각을 올리면 옆 창이 **빈 채로** 열린다. 그때는 무엇이 잘못됐는지
  //   화면에 아무것도 안 뜨므로, 올리기 전에 여기서 막는다
  const bad = publishable(frag);
  if (bad.length) throw new Error('올릴 수 없는 조각이다 — ' + bad.join(' / '));
  return frag;
}

/**
 * 올릴 수 있는 조각인가.
 *
 * ★ 이 검사가 있는 이유는 **같은 실수를 네 번 했기 때문이다.** 파일로 보내면
 *   내려받기 카드로만 뜨는 환경이 있는데, 그걸 모른 채 파일만 다시 보냈다.
 *   주소로 여는 페이지는 감싸는 문서를 올리는 쪽이 붙이고, 스크립트·iframe·
 *   바깥 주소가 막혀 있다. 그 조건을 어긴 조각은 조용히 빈 화면이 된다.
 *
 * @returns {string[]} 어긴 것들. 빈 배열이면 올려도 된다
 */
function publishable(frag) {
  const bad = [];
  const has = (re, why) => { if (re.test(frag)) bad.push(why); };
  has(/<!doctype/i, 'doctype 가 있다 (감싸는 문서는 올리는 쪽이 붙인다)');
  has(/<html[\s>]/i, '<html> 이 있다');
  has(/<head[\s>]/i, '<head> 가 있다');
  has(/<body[\s>]/i, '<body> 가 있다');
  has(/<script/i, '<script> 가 있다 (스크립트가 막힌 곳을 전제한다)');
  has(/<iframe/i, '<iframe> 이 있다');
  has(/(?:src|href)="https?:/i, '바깥 주소를 부른다 (CSP 가 막는다)');
  if (!/<title>[^<]{2,}<\/title>/i.test(frag)) bad.push('<title> 이 없다 (목록에서 이름이 안 뜬다)');
  return bad;
}

/** 감싸는 판의 스타일. 화면 자체의 색(라임 #9ED700 · 먹 #17181A)을 그대로 쓴다 */
const WRAP_CSS = `
  :root { --pg: #F5F6F8; --sf: #FFFFFF; --ln: #E8EAEC; --ink: #17181A; --ink2: #7C838C; }
  :root:not([data-theme="light"]) { color-scheme: light; }
  body { margin: 0; background: var(--pg); color: var(--ink);
    font: 400 15px/1.6 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
      'Malgun Gothic', Arial, sans-serif; }
  .lead { max-width: 1120px; margin: 0 auto; padding: 22px 20px 0; }
  .lead__t { font-size: 21px; font-weight: 800; margin: 0; }
  .lead__d { font-size: 13.5px; color: var(--ink2); margin: 7px 0 0; }
  .pv { max-width: 1120px; margin: 14px auto 0; background: var(--sf);
    border: 1px solid var(--ln); border-radius: 18px; overflow: hidden; }
  .pv__h { display: flex; gap: 12px; align-items: flex-start; padding: 16px 20px;
    border-bottom: 1px solid var(--ln); }
  .pv__n { width: 26px; height: 26px; flex: none; border-radius: 50%; background: var(--ink);
    color: #fff; display: grid; place-items: center; font: 800 13px/1 inherit; }
  .pv__t { font-size: 16px; font-weight: 800; margin: 0; }
  .pv__d { font-size: 13px; color: var(--ink2); margin: 3px 0 0; }
  .scr { display: block; }
`;

async function run() {
  if (process.argv.includes('--artifact')) {
    const outPath = process.argv[process.argv.indexOf('--artifact') + 1] || path.join(HERE, 'section-artifact.html');
    const frag = await buildArtifact();
    fs.writeFileSync(outPath, frag);
    console.log(`${outPath} (${Math.round(frag.length / 1024)}KB) · 주소로 여는 조각`);
    return;
  }
  await main();
}

if (require.main === module) run().catch((e) => { console.error(e.message || e); process.exit(1); });

module.exports = { stripScripts, heightOf, findBrowser, buildArtifact, publishable, EXPAND, MEASURE };

/* ── 아티팩트(URL 로 여는 판) ──────────────────────────────── */
//
// 파일로 보내면 다운로드 카드로만 뜨는 환경이 있다. 그때는 **주소로 열리는
// 페이지**가 유일한 길이다. 그런데 그 페이지는 iframe·스크립트가 막혀 있을 수
// 있으므로, 화면 넷을 **한 문서에 이어 붙인다.**
//
// ★ 이어 붙이면 화면 넷의 CSS 가 서로 덮는다 (원래 iframe 을 쓰던 이유다).
//   그래서 각 화면의 CSS 를 **그 화면 안으로 가둔다** — 선택자마다 `#scr-xx` 를
//   앞에 붙이고, `html`/`body`/`:root` 는 그 칸 자체로 바꾼다.

/** 선택자 하나를 한 칸 안으로 가둔다 */
function scopeSelector(sel, scope) {
  return sel.split(',').map((raw) => {
    const t = raw.trim();
    if (!t) return '';
    if (t === '*') return `${scope}, ${scope} *`;
    // 화면의 뿌리(html·body·:root)는 그 칸 자체가 된다
    const m = t.match(/^(html|body|:root)\b(.*)$/i);
    if (m) {
      const rest = m[2].trim();
      return rest ? `${scope}${rest.startsWith(':') || rest.startsWith('.') ? '' : ' '}${rest}` : scope;
    }
    return `${scope} ${t}`;
  }).filter(Boolean).join(', ');
}

/** 규칙 단위로 훑으며 가둔다. @media·@supports 는 안쪽까지 들어간다 */
function scopeBlocks(css, scope) {
  let out = '', i = 0;
  while (i < css.length) {
    const at = css.indexOf('{', i);
    if (at === -1) { out += css.slice(i); break; }
    const prelude = css.slice(i, at).trim();
    let depth = 1, j = at + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(at + 1, j - 1);
    if (prelude.startsWith('@')) {
      const kind = prelude.split(/[\s(]/)[0].toLowerCase();
      out += (kind === '@media' || kind === '@supports' || kind === '@layer')
        ? `${prelude}{${scopeBlocks(body, scope)}}`
        : `${prelude}{${body}}`;          // @keyframes·@font-face 는 그대로 둔다
    } else {
      out += `${scopeSelector(prelude, scope)}{${body}}`;
    }
    i = j;
  }
  return out;
}

function scopeCss(css, scope) {
  return scopeBlocks(String(css).replace(/\/\*[\s\S]*?\*\//g, ''), scope);
}

/**
 * 그려진 문서에서 **스타일과 본문만** 꺼낸다.
 * ★ `position: fixed` 는 한 문서에 모으면 화면 밖으로 떠올라 다른 칸을 덮는다.
 *   칸 안에 있어야 할 것이므로 제자리에 눕힌다.
 */
function inlineScreen(dom, id) {
  const scope = `#${id}`;
  const styles = [...dom.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const bodyM = dom.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyM ? bodyM[1] : dom;
  const css = scopeCss(styles, scope)
    + `\n${scope}{position:relative;overflow:hidden;}`
    + `\n${scope} .save{position:static!important;left:auto!important;right:auto!important;}`;
  return { css, html: `<div class="scr" id="${id}">${stripScripts(body)}</div>` };
}

module.exports.scopeCss = scopeCss;
module.exports.scopeSelector = scopeSelector;
module.exports.inlineScreen = inlineScreen;
