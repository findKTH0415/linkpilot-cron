#!/usr/bin/env node
'use strict';
/**
 * build-theme-cards.js — **테마 13종 표지 갤러리**를 만든다.
 *
 *   npm run im:themecards
 *
 * 〈2026-09-17 사장님 지시: 「보고서 생성에 디자인 템플렛 선택 할수 있도록 만들어줘」 ·
 *   PPT 템플릿 갤러리 사진 다섯〉
 *
 * ★★★ **왜 만들었나.** 보고서 화면의 테마 고르는 칸은 **색 점 하나 + 이름**이었다.
 *   「Institutional」과 「Premium」이 어떻게 다른지 **이름만 보고는 못 고른다.**
 *   사장님이 주신 사진은 전부 **표지 모양을 늘어놓고 고르는** 갤러리다.
 *
 * ★★ **그림 파일을 안 쓴다.** 표지를 헤드리스로 찍어 보니 한 장 25 KB 였고,
 *   13장이면 base64 로 **425 KB** 다 — 화면이 그만큼 무거워진다. 테마가 이미
 *   **색과 표지 갈래**를 갖고 있으므로 **CSS 로 그린다**: 파일이 안 늘고,
 *   선명하고, 화면 폭을 따라간다 (§6-1 의 「라이브러리를 안 들인다」와 같은 결).
 *
 * ★ **값을 여기 손으로 적지 않는다** — `design/themes.js` 를 읽는다.
 *   화면(`reports.html`)도 같은 값을 `style-ab.js` 의 `THEME_CARDS` 로 받는다.
 *   **표지를 그리는 규칙은 두 곳에 있으면 안 되므로** 이 파일이 내는 CSS 와
 *   화면의 CSS 가 **같은 클래스 이름**을 쓴다 — 어긋나면 검사가 잡는다.
 *
 * ★★★ **파일 하나로 열린다** (§8). 서버가 있어야 열리는 것은 미리보기가 아니다.
 */
const fs = require('fs');
const path = require('path');
const themes = require('../../design/themes.js');

const OUT = path.join(__dirname, 'theme-cards.html');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 표지 갈래 — 화면과 «같은 규칙»으로 정한다 (build-styleoptions.js 의 themeCards 와 한 벌) */
function shapeOf(cover) {
  const cv = String(cover || '');
  if (/사진.*전면|full/.test(cv)) return 'full';
  if (/사진.*분할|split/.test(cv)) return 'split';
  if (/괘선|rule/.test(cv)) return 'rule';
  return 'plain';
}

function cards() {
  return Object.keys(themes.THEMES).map((id) => {
    const t = themes.get(id);
    return {
      id: t.id, no: t.no || '', name: t.label || t.id, kr: t.labelKr || '',
      purpose: t.purpose || '', traits: t.traits || [],
      shape: shapeOf(t.cover),
      color: t.primary || '#10233C', accent: t.accent || '#A6813C',
      surface: t.surfaceAlt || '#F7F5F0',
      serif: !!(t.serif && String(t.serif).includes('Serif')),
    };
  });
}

/** 표지 하나 — 화면(`reports.html`)의 `cover()` 와 **같은 모양**을 낸다 */
function coverHtml(c) {
  const rules = c.shape === 'rule'
    ? [0, 1, 2, 3].map(r => `<i class="ln" style="top:${26 + r * 13}%"></i>`).join('')
    : '';
  const topStyle = c.shape === 'split' ? `height:54%;background:${esc(c.color)}`
    : c.shape === 'full' ? `height:100%;background:linear-gradient(160deg,${esc(c.color)},${esc(c.accent)})`
      : `height:100%;background:${esc(c.color)}`;
  const barColor = c.shape === 'split' ? esc(c.color) : '#FFFFFF';
  return `<div class="thcov" style="background:${esc(c.surface)}"${c.serif ? ' data-serif="1"' : ''}>
      <div class="thcov__t" style="${topStyle}">${rules}</div>
      <i class="thcov__b1" style="background:${barColor}"></i>
      <i class="thcov__b2" style="background:${barColor}"></i>
      <i class="thcov__ac" style="background:${esc(c.accent)}"></i>
    </div>`;
}

function build() {
  const list = cards();
  const items = list.map(c => `
  <article class="thcard" data-theme-card="${esc(c.id)}" data-shape="${esc(c.shape)}">
    ${coverHtml(c)}
    <span class="thcard__n">${esc(c.no)} · ${esc(c.name)}</span>
    <span class="thcard__k">${esc(c.kr)}</span>
    <p class="thcard__p">${esc(c.purpose)}</p>
  </article>`).join('\n');

  const shapes = {};
  list.forEach(c => { shapes[c.shape] = (shapes[c.shape] || 0) + 1; });

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>보고서 디자인 템플릿 ${list.length}종</title>
<style>
  :root{--ink:#0A1419;--ink2:#41505F;--ink3:#6E7A8C;--line:#DDE3EA;--paper:#FAFBFC;--lime:#6F8F00}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
    font:14px/1.6 "Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;padding:28px 16px 64px}
  .wrap{max-width:960px;margin:0 auto}
  h1{font-size:22px;margin:0 0 6px;letter-spacing:-.02em}
  .sub{color:var(--ink2);font-size:13.5px;margin:0 0 4px}
  .meta{color:var(--ink3);font-size:12px;margin:0 0 22px}
  .thgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
  .thcard{display:flex;flex-direction:column;gap:5px;background:#fff;
    border:1.5px solid var(--line);border-radius:8px;padding:9px}
  .thcard__n{font-size:12px;font-weight:800;line-height:1.3;word-break:keep-all}
  .thcard__k{font-size:10.5px;color:var(--ink3);line-height:1.35;word-break:keep-all}
  .thcard__p{font-size:10.5px;color:var(--ink2);line-height:1.45;margin:3px 0 0;word-break:keep-all}
  .thcov{position:relative;width:100%;aspect-ratio:1/1.414;border-radius:4px;overflow:hidden;
    border:1px solid rgba(0,0,0,.10)}
  .thcov__t{position:absolute;inset:0 0 auto 0}
  .thcov__t .ln{position:absolute;left:14%;right:14%;height:1px;background:rgba(255,255,255,.28)}
  .thcov__b1,.thcov__b2,.thcov__ac{position:absolute;display:block;border-radius:1px}
  .thcov__b1{left:14%;width:56%;height:5%;top:64%;opacity:.92}
  .thcov__b2{left:14%;width:38%;height:4%;top:72%;opacity:.66}
  .thcov__ac{left:14%;width:22%;height:3%;top:83%}
  .note{margin-top:26px;border:1px solid var(--line);border-left:3px solid var(--lime);
    background:#fff;border-radius:4px;padding:14px 16px;font-size:12.5px;color:var(--ink2)}
  .note b{color:var(--ink)}
</style></head><body>
<div class="wrap">
  <h1>보고서 디자인 템플릿 ${list.length}종</h1>
  <p class="sub">보고서 만들기 화면의 <b>디자인 테마</b>에서 고르는 것들입니다. 고르시면 그대로 문서에 들어갑니다.</p>
  <p class="meta">표지 갈래 ${Object.keys(shapes).map(k => k + ' ' + shapes[k]).join(' · ')} ·
    색과 갈래는 <code>design/themes.js</code> 에서 읽습니다 — 이 페이지에 손으로 적은 값은 없습니다.</p>
  <div class="thgrid">${items}
  </div>
  <div class="note">
    <b>표지 모양은 «갈래»를 보여 주는 것이지 실제 표지 그대로가 아닙니다.</b>
    실제 표지에는 사업명·날짜·기밀 표기가 들어갑니다. 여기서 보시는 것은
    <b>색·활자 느낌·표지 구성</b>입니다 — 그 셋이 테마를 가릅니다.<br>
    판형(A4 세로 / 16:9 가로)·글자 크기·그림 비중은 <b>「출력 성격」에서 따로</b> 정합니다.
  </div>
</div>
</body></html>`;
  fs.writeFileSync(OUT, html, 'utf8');
  return { out: OUT, count: list.length, shapes, bytes: Buffer.byteLength(html) };
}

if (require.main === module) {
  const r = build();
  console.log(`${r.out} (${Math.round(r.bytes / 1024)}KB) · 테마 ${r.count}종 · 갈래 ${JSON.stringify(r.shapes)}`);
}

module.exports = { build, cards, coverHtml, shapeOf, OUT };
