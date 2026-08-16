#!/usr/bin/env node
'use strict';
/**
 * build-themes.js — 디자인 테마 **고르는 화면**을 만든다.
 *
 *   npm run im:themes
 *
 * 왜 필요한가: `design/recommend.js` 는 자산유형·투자자·거래형태로 테마를
 * **골라 준다.** 그런데 디자인은 그것만으로 정해지지 않는다 — 같은 데이터센터
 * 딜이라도 어느 쪽이 마음에 드는지는 사람마다 다르고, **그 선택은 취향의 영역**이다.
 *
 * 지금 화면(`reports.html`)에는 테마 **이름 버튼 13개**만 있다.
 * 「Premium」과 「Institutional」이 어떻게 다른지 **이름만 보고는 고를 수 없다.**
 * 그래서 고르는 사람은 대충 첫 번째를 누르거나, 추천을 그냥 받아들인다 —
 * 둘 다 고른 것이 아니다.
 *
 * ★ **추천은 보여 주되 강제하지 않는다.** 순위와 **근거**를 함께 달되 아무거나
 *   고를 수 있다. 추천이 곧 결정이면 선택권이 없는 것이고, 그러면 이 화면을
 *   만들 이유도 없다.
 *
 * ★ **딜을 모르면 추천을 붙이지 않는다.** 추천은 자산유형·문서종류로 정해지는데,
 *   이 화면은 딜과 무관하게도 만들어진다. 그때 특정 딜의 추천을 박아 두면
 *   **다른 딜에서 틀린 추천이 그럴듯하게 붙는다.** `--asset` 을 줄 때만 붙인다.
 *
 * ★ **실제 렌더를 그려 넣는다.** 색 견본만 보여 주면 표지에서 어떻게 보이는지
 *   모른다. 빌드할 때 헤드리스로 진짜 표지를 찍어 그림으로 박는다 —
 *   그래야 파일 하나로 열리고(§8), 스크립트 없이도 보인다.
 *
 * ★ **글꼴 경고를 화면에 박는다.** 이 서버에는 `Noto Sans KR` 이 없어 견본이
 *   다른 글꼴로 그려진다. 그걸 안 적으면 **사람이 틀린 활자로 디자인을 고른다.**
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const AGENT = path.join(__dirname, '..', '..');
const themes = require(path.join(AGENT, 'design/themes'));
const a4 = require(path.join(AGENT, 'design/a4'));
const recommend = require(path.join(AGENT, 'design/recommend'));
const raster = require(path.join(AGENT, 'core/raster'));

const OUT = path.join(__dirname, 'theme-gallery.html');

/**
 * 테마가 **선언했지만 렌더러가 아직 안 쓰는** 항목.
 *
 * ★ 이걸 화면에 적는 이유: 지금 13종은 **색만 다르다.** 표지 구조(rule/split/
 *   fullImage)와 밀도(normal/compact/airy)를 테마가 선언하는데 `design/a4.js` 가
 *   읽지 않는다. 안 적으면 고르는 사람은 「13종 중에 고른다」고 믿는데
 *   실제로는 **색 팔레트를 고르는 것**이다 (등록부 D-51).
 */
const DECLARED_BUT_UNUSED = ['cover', 'density', 'layouts', 'emphasisKpis', 'chart'];

/** 렌더러가 실제로 읽는 테마 필드인가 — 선언과 실제의 간극을 빌드할 때 잰다 */
function unusedFields() {
  const src = fs.readFileSync(path.join(AGENT, 'design/a4.js'), 'utf8');
  return DECLARED_BUT_UNUSED.filter(f => !new RegExp(`T\\.${f}\\b`).test(src));
}

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

/** A4 폭(96dpi). 표지 윗부분만 찍는다 — 카드에 들어갈 크기다 */
const SHOT = { width: 794, height: 1123, scale: 1 };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 테마 하나의 표지를 찍는다.
 * ★ 실패해도 **조용히 넘어가지 않는다.** 그림이 없으면 색 견본으로 대신하고
 *   「못 그렸다」를 화면에 적는다 — 빈 카드는 고장으로 읽힌다.
 */
function shoot(themeId, browser, tmp) {
  const html = a4.preview(themeId, { docType: 'im' });
  const src = path.join(tmp, `${themeId}.html`);
  const png = path.join(tmp, `${themeId}.png`);
  fs.writeFileSync(src, html, 'utf8');

  try {
    execFileSync(browser, [
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      `--force-device-scale-factor=${SHOT.scale}`,
      `--window-size=${SHOT.width},${SHOT.height}`,
      '--default-background-color=FFFFFFFF',
      `--screenshot=${png}`, `file://${src}`,
    ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000 });
    const buf = fs.readFileSync(png);
    return { ok: true, dataUri: `data:image/png;base64,${buf.toString('base64')}`, bytes: buf.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** 이 서버에 테마가 요구하는 한글 글꼴이 있는가 */
function fontAvailable(family) {
  try {
    const out = execFileSync('fc-list', [':lang=ko', 'family'], { encoding: 'utf8', timeout: 5000 });
    return out.split('\n').some(l => l.toLowerCase().includes(String(family).toLowerCase()));
  } catch (_) {
    return false;   // fontconfig 이 없으면 알 수 없다 — 없는 것으로 본다
  }
}

function card(t, shot, rec) {
  const swatches = [t.primary, t.primaryMid, t.accent, t.accentLight, t.surfaceAlt]
    .filter(Boolean)
    .map(c => `<i style="background:${esc(c)}"></i>`).join('');

  const shotHtml = shot.ok
    ? `<img src="${shot.dataUri}" alt="${esc(t.label)} 표지 미리보기" loading="lazy">`
    : `<div class="miss">표지를 그리지 못했다<br><small>${esc(shot.reason || '')}</small></div>`;

  return `
<article class="card" id="t-${esc(t.id)}" data-id="${esc(t.id)}">
  <div class="shot">${shotHtml}</div>
  <div class="meta">
    <div class="head">
      <span class="no">${esc(t.no || '')}</span>
      <h2>${esc(t.label)}</h2>
      ${rec ? `<span class="rec">추천 ${rec.rank}위 · ${rec.confidence}</span>` : ''}
    </div>
    <p class="kr">${esc(t.labelKr || '')}</p>
    <p class="purpose">${esc(t.purpose || '')}</p>
    <div class="sw">${swatches}</div>
    <ul class="traits">${(t.traits || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${rec && rec.reasons.length ? `<p class="why">추천 근거 — ${esc(rec.reasons.join(' · '))}</p>` : ''}
    <p class="pick">이 테마로 정하려면 <code>themeId: ${esc(t.id)}</code></p>
  </div>
</article>`;
}

function build() {
  const list = themes.list();
  const browser = raster.findBrowser();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'themes-'));

  // 추천은 **참고로만** 붙인다. 딜(자산유형)을 줄 때만 붙는다 — 안 주면 안 붙는다
  const assetType = argOf('--asset');
  const docType = argOf('--doc') || 'im';
  const recs = {};
  if (assetType) {
    try {
      const r = recommend.recommend({ assetType, docType });
      (r.recommendations || []).slice(0, 3).forEach((x, i) => {
        recs[x.themeId] = { rank: i + 1, confidence: x.confidence, reasons: x.reasons || [] };
      });
    } catch (_) { /* 추천을 못 내도 화면은 나온다 — 고르는 것이 본질이다 */ }
  }

  // ★ 표지를 안 찍는 판. 글·추천만 확인할 때 쓴다 — 13장을 찍으면 십수 초가 든다.
  //   **기본은 찍는 쪽이다.** 빠른 쪽을 기본으로 두면 그림 없는 화면이 배포된다
  const noShots = process.argv.includes('--no-shots');
  const shots = {};
  let made = 0;
  if (noShots) {
    list.forEach((t) => { shots[t.id] = { ok: false, reason: '--no-shots 로 건너뜀' }; });
  } else if (browser) {
    for (const t of list) {
      shots[t.id] = shoot(t.id, browser, tmp);
      if (shots[t.id].ok) made++;
    }
  } else {
    list.forEach((t) => { shots[t.id] = { ok: false, reason: '헤드리스 크로미움이 없다' }; });
  }

  const hasKoFont = fontAvailable('Noto Sans');
  const unused = unusedFields();
  const cards = list.map(t => card(t, shots[t.id], recs[t.id] || null)).join('\n');

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>디자인 테마 고르기</title>
<style>
  :root { --ink:#1A1A1A; --sub:#6B6B6B; --line:#E4E4E4; --bg:#FAFAF8; --point:#C00000; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font-family:'Noto Sans KR','Malgun Gothic',system-ui,sans-serif; line-height:1.6; }
  header { padding:28px 20px 18px; border-bottom:1px solid var(--line); background:#fff; }
  h1 { margin:0 0 6px; font-size:20px; letter-spacing:-.01em; }
  .lead { margin:0; color:var(--sub); font-size:13px; max-width:62ch; }
  .warn { margin:14px 20px 0; padding:12px 14px; border-left:3px solid var(--point);
          background:#FFF6F6; font-size:12.5px; color:#5A1A1A; max-width:70ch; }
  .warn b { color:var(--point); }
  main { display:grid; gap:18px; padding:20px;
         grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); }
  .card { background:#fff; border:1px solid var(--line); border-radius:4px; overflow:hidden;
          display:flex; flex-direction:column; }
  .shot { background:#F2F2F0; border-bottom:1px solid var(--line); overflow:hidden; height:300px; }
  .shot img { width:100%; display:block; }
  .miss { padding:40px 16px; text-align:center; color:var(--sub); font-size:12px; }
  .meta { padding:14px 16px 16px; }
  .head { display:flex; align-items:baseline; gap:8px; }
  .no { font-size:11px; color:var(--sub); letter-spacing:.1em; }
  h2 { margin:0; font-size:15px; }
  .rec { margin-left:auto; font-size:11px; padding:2px 7px; border:1px solid var(--point);
         color:var(--point); border-radius:2px; }
  .kr { margin:4px 0 0; font-size:12.5px; color:var(--ink); }
  .purpose { margin:2px 0 10px; font-size:12px; color:var(--sub); }
  .sw { display:flex; gap:0; margin:0 0 10px; }
  .sw i { display:block; width:26px; height:14px; }
  .traits { display:flex; flex-wrap:wrap; gap:5px; margin:0 0 10px; padding:0; list-style:none; }
  .traits li { font-size:11px; color:var(--sub); border:1px solid var(--line);
               border-radius:2px; padding:1px 6px; }
  .why { margin:0 0 8px; font-size:11.5px; color:var(--point); }
  .pick { margin:0; font-size:11.5px; color:var(--sub); }
  code { background:#F3F3F1; padding:1px 5px; border-radius:2px; font-size:11.5px; }
  footer { padding:18px 20px 40px; color:var(--sub); font-size:12px; max-width:76ch; }
  footer p { margin:0 0 8px; }
</style>
</head>
<body>
<header>
  <h1>디자인 테마 고르기 — ${list.length}종</h1>
  <p class="lead">표지·본문·색·활자가 통째로 바뀝니다.
    ${assetType
      ? `<b>추천은 참고입니다</b> — <code>${esc(assetType)}</code> 기준으로 뽑은 것일 뿐이고, 어느 쪽이 마음에 드는지는 고르는 사람이 정합니다.`
      : '딜을 지정하지 않아 <b>추천은 붙이지 않았습니다</b> — <code>npm run im:themes -- --asset datacenter</code> 처럼 주면 순위와 근거가 함께 붙습니다.'}</p>
</header>

${unused.length ? `<div class="warn">
  <b>지금 테마 사이의 차이는 색과 활자뿐입니다.</b> 각 테마는 표지 구조(rule ·
  split · fullImage)와 밀도(normal · compact · airy)를 선언하는데,
  <b>렌더러가 아직 그 값을 읽지 않습니다</b> (안 쓰이는 항목:
  <code>${esc(unused.join(' · '))}</code>).
  그래서 아래 견본들은 <b>짜임새가 서로 같습니다</b> — 색으로 고르시면 되고,
  표지 구조까지 갈리게 하려면 렌더러 작업이 따로 필요합니다 (등록부 D-51).
</div>` : ''}

${hasKoFont ? '' : `<div class="warn">
  <b>견본의 활자는 실제와 다릅니다.</b> 이 화면을 만든 서버에 테마가 요구하는
  <code>Noto Sans KR</code>·<code>Noto Serif KR</code> 이 없어, 브라우저가 다른 글꼴로
  대신 그렸습니다. <b>색·짜임새는 보고 고르셔도 되지만 글자 모양은 최종본과 다릅니다.</b>
  (글꼴을 번들로 넣기 전까지는 만드는 서버마다 활자가 달라집니다)
</div>`}

<main>
${cards}
</main>

<footer>
  <p><b>고른 기록이 남습니다.</b> 테마를 정하면 누가·언제·왜 골랐는지와 이전 테마가
    함께 저장되고(<code>design-state</code>), 되돌릴 수 있습니다.</p>
  <p><b>내용은 바뀌지 않습니다.</b> 테마는 보이는 방식만 정합니다 — 수치·출처·검증
    결과는 어느 테마를 골라도 같습니다.</p>
  <p>표지 견본의 수치는 <b>디자인 확인용 예시</b>이며 실제 프로젝트 값이 아닙니다.</p>
  <p style="margin-top:14px">
    그림 ${made}/${list.length}장 · <code>npm run im:themes</code> 로 다시 만듭니다.</p>
</footer>
</body>
</html>`;

  fs.writeFileSync(OUT, html, 'utf8');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }

  const kb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
  console.log(`${OUT} (${kb}KB) · 테마 ${list.length}종 · 표지 그림 ${made}장`);
  if (!browser) console.log('  ⚠ 헤드리스 크로미움이 없어 표지를 못 그렸다 — 색 견본만 보인다');
  if (made < list.length) console.log(`  ⚠ ${list.length - made}종은 표지를 못 그렸다`);
  if (!hasKoFont) console.log('  ⚠ Noto Sans KR 이 없어 견본 활자가 실제와 다르다 (화면에 경고를 넣었다)');
  if (unused.length) {
    console.log(`  ⚠ 테마가 선언했지만 렌더러가 안 쓰는 항목: ${unused.join(', ')} — 13종이 색만 다르다 (D-51)`);
  }
  return { out: OUT, count: list.length, made, hasKoFont, unused };
}

if (require.main === module) build();

module.exports = { build, card, shoot, fontAvailable, unusedFields, OUT, SHOT, DECLARED_BUT_UNUSED };
