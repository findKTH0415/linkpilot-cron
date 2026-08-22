'use strict';
/**
 * build-inline.js — 화면을 **iframe 없이** 앱 안에 바로 넣는 조각으로 낸다 (2026-08-20).
 *
 *   npm run im:inline               # 기본: files.html
 *   npm run im:inline -- --screen outputs.html --out <경로>
 *
 * ★★ 왜 만들었나: iframe 으로 얹으면 앱이 그 높이를 정해야 하고, 안 맞으면 화면
 *   안에 **스크롤바가 하나 더** 생긴다. 스크롤이 둘이면 사용자는 바깥을 내렸는데
 *   안이 안 내려가는 상태를 만난다 — 앱처럼 안 보인다.
 *   (브리지가 높이를 알려 주긴 하지만, 그건 앱이 받아서 늘려 줘야 듣는다.)
 *
 * ★ 그래서 **문서 하나로 합친다.** 대신 두 가지를 반드시 지켜야 한다:
 *
 *   ① **CSS 를 가둔다.** 화면 CSS 는 `html, body, .card, .row …` 처럼 흔한 이름을
 *      쓴다. 그대로 앱에 부으면 **앱의 다른 화면이 같이 바뀐다.** 그래서 전부
 *      `#lp-<이름>` 아래로 가둔다 (`scopeCss`).
 *
 *   ② **설정을 덮어쓰지 않는다.** 원본의 설정 블록은 `window.X = {…}` 대입이라,
 *      앱이 미리 넣어 둔 값을 **지워 버린다.** 조각에서는 그 줄을 **병합**으로
 *      바꾼다 — 앱이 넣은 것이 이긴다.
 *
 * ★ 스크립트는 **걷어내지 않는다.** 걷어내면 그건 그림이지 화면이 아니다
 *   (`inlineScreen()` 은 미리 그리는 판이라 걷어낸다 — 쓰임이 다르다).
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const { scopeCss } = require('./build-static.js');

function read(f) { return fs.readFileSync(path.join(HERE, f), 'utf8'); }

/** `<script src>` 를 내용으로 바꾼다. 속성은 그대로 옮긴다 (브리지가 읽는다) */
function inlineScripts(html) {
  const tags = html.match(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g) || [];
  tags.forEach((tag) => {
    const src = tag.match(/src="([^"]+)"/)[1];
    const attrs = tag.replace(/^<script/, '').replace(/><\/script>$/, '').replace(/\ssrc="[^"]+"/, '');
    html = html.replace(tag, '<script' + attrs + '>'
      + read(src).replace(/<\/(script)/gi, '<\\/$1') + '</script>');
  });
  return html;
}

/**
 * 설정 블록을 **병합**으로 바꾼다.
 *
 * ★ 줄 첫머리의 대입만 바꾼다. 이름만 찾으면 다른 모듈의 주석·문자열에 걸린다
 *   — 그렇게 한 번 엉뚱한 곳에 끼워 넣어 화면이 로그인 안 한 상태로 나왔다.
 */
function mergeConfig(html, global) {
  const re = new RegExp('^window\\.' + global + '\\s*=\\s*\\{', 'm');
  if (!re.test(html)) throw new Error(`${global} 대입을 찾지 못했다 — 설정을 병합으로 바꿀 수 없다`);
  return html.replace(re, `window.${global} = Object.assign({`)
    // 대입 블록의 닫는 `};` 를 병합 호출의 닫는 괄호로 바꾼다
    .replace(new RegExp('(window\\.' + global + ' = Object\\.assign\\(\\{[\\s\\S]*?\\n)\\};', 'm'),
      `$1}, window.${global} || {});`);
}

/** 이 화면이 쓰는 설정 전역 이름 — 사본 빌더와 **같은 표**를 쓴다 */
function globalOf(screen) {
  const { GLOBALS } = require('./build-embed.js');
  return GLOBALS[screen] || null;
}

function build(screen, outFile) {
  const id = 'lp-' + screen.replace(/\.html$/, '');
  const g = globalOf(screen);

  let html = inlineScripts(read(screen));
  if (g) html = mergeConfig(html, g);

  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const bodyM = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyM) throw new Error(`${screen}: <body> 를 찾지 못했다`);

  // 본문에 남은 <style> 은 걷어낸다 — 가두지 않은 사본이 함께 들어가면
  // 그 안의 `body{…}` 가 **앱 전체**에 걸린다
  const inner = bodyM[1].replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  const css = scopeCss(styles, '#' + id) + `\n#${id}{position:relative;}`;
  const frag = `<style id="${id}-css">\n${css}\n</style>\n<div class="scr" id="${id}">${inner}</div>\n`;

  const bad = check(frag, id);
  if (bad.length) throw new Error('조각으로 낼 수 없다:\n  ' + bad.join('\n  '));

  if (outFile) fs.writeFileSync(outFile, frag);
  return { screen, id, global: g, bytes: frag.length, file: outFile || null };
}

/**
 * 앱에 부어도 되는 조각인가.
 *
 * ★ **가두지 않은 규칙 하나가 앱 전체를 바꾼다.** 그래서 스코프 밖으로 나가는
 *   선택자가 하나라도 있으면 만들지 않는다 — 만들어 놓고 나중에 찾는 것보다 낫다.
 */
function check(frag, id) {
  const bad = [];
  const cssM = frag.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  const css = cssM ? cssM[1] : '';

  // ★ 줄 단위로 보면 안 된다. 선언부(`color: red;`)에도 `:` 와 `;` 가 있어
  //   선택자로 잘못 읽힌다 — 실제로 그렇게 헛울음이 났다.
  //   **중괄호 깊이**를 세면서 깊이 0 에서 `{` 앞에 온 것만 선택자로 본다
  let depth = 0;
  let buf = '';
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (c === '{') {
      if (depth === 0) selectors(buf).forEach(s2 => { if (!scoped(s2, id)) bad.push(`가두지 않은 선택자: ${s2.slice(0, 70)}`); });
      depth += 1; buf = '';
    } else if (c === '}') {
      depth = Math.max(0, depth - 1); buf = '';
    } else if (depth === 0) {
      buf += c;
    }
  }

  if (/<!doctype|<html[\s>]|<body[\s>]/i.test(frag)) bad.push('감싸는 문서가 남아 있다');
  return [...new Set(bad)];
}

/** 깊이 0 에서 모은 글자에서 선택자만 추린다 (@media 같은 규칙은 그 안을 다시 본다) */
function selectors(chunk) {
  const t = chunk.trim();
  if (!t || t.startsWith('@')) return [];      // @media·@keyframes 는 안쪽에서 다시 걸린다
  return t.split(',').map(x => x.trim()).filter(Boolean);
}

/** 스코프 안에 갇혔는가. keyframes 의 `from`·`to`·`50%` 는 선택자가 아니다 */
function scoped(sel, id) {
  if (/^(from|to|\d+(\.\d+)?%)$/.test(sel)) return true;
  return sel.startsWith('#' + id);
}

if (require.main === module) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const screen = arg('--screen', 'files.html');
  const out = path.resolve(arg('--out', path.join(HERE, screen.replace(/\.html$/, '') + '-inline.html')));
  try {
    const r = build(screen, out);
    console.log(`${r.file} (${Math.round(r.bytes / 1024)}KB) · ${r.screen} — iframe 없이 얹는 조각 (#${r.id})`);
    if (r.global) console.log(`  설정: window.${r.global} 을 **조각보다 먼저** 넣는다 (조각이 병합한다)`);
  } catch (e) { console.error(e.message); process.exit(2); }
}

module.exports = { build, check, mergeConfig, inlineScripts };
