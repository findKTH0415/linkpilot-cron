'use strict';
/**
 * build-preview.js — 보고서 생성 화면 4개를 한 파일로 묶은 미리보기.
 *
 *   node im-agent/ui/platform/build-preview.js [--out <경로>] [--fragment]
 *
 * CLAUDE.md §8 — 화면 작업은 미리보기까지가 완성이다.
 *
 * 왜 iframe 인가:
 *   화면 넷은 각자 `<style>` 과 즉시실행 스크립트를 갖고 있다. 한 문서에 이어
 *   붙이면 CSS 가 서로 덮고 `state` 같은 전역이 충돌한다. iframe 은 문서를
 *   나눠 주므로 **화면을 하나도 고치지 않고** 실물 그대로 보여줄 수 있다.
 *
 * ★ 화면이 뜨도록 접수 정보·필드 정의를 심는다. **지어낸 값이 아니다** —
 *   서버가 보낼 것과 같은 출처(core/dictionary.js · 02-extraction)에서 그대로
 *   가져온다. 값을 만들어 넣으면 되는 것처럼 보이고, 그 화면을 근거로 판단하게 된다.
 *   프로젝트 데이터는 심지 않으므로 목록은 비어 있는 채로 뜬다.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

/**
 * 미리보기를 **고정형**으로 만드는 조각.
 *
 * 화면들은 `html, body { height: 100% }` 로 앱처럼 짜여 있어, iframe 안에서
 * 뷰포트 높이에 맞춰지고 **안쪽에 스크롤이 생긴다.** 미리보기에서 그러면
 * 화면 하나를 보려고 창 안을 또 끌어야 한다 — 한눈에 안 들어온다.
 *
 * 그래서 미리보기에서만 높이를 풀고, 문서가 자기 높이를 부모에게 알려
 * iframe 이 내용만큼 늘어나게 한다. 화면 소스는 건드리지 않는다.
 *
 * ★ 내용이 바뀌면(판 전환·값 입력) 높이도 따라가야 하므로 MutationObserver 를 쓴다.
 */
const AUTOSIZE = `
<style id="preview-autosize">
  /* 미리보기 전용: 앱 높이 고정을 풀어 내용만큼 늘어나게 한다 */
  html, body { height: auto !important; min-height: 0 !important; }
  .app { min-height: 0 !important; }
  body { overflow-y: hidden !important; }
</style>
<script>
(function () {
  var id = window.name || '';
  var last = 0;
  function tell() {
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0);
    if (!h || Math.abs(h - last) < 4) return;
    last = h;
    parent.postMessage({ linkpilotPreviewHeight: h, frame: id }, '*');
  }
  window.addEventListener('load', tell);
  window.addEventListener('resize', tell);
  if (window.MutationObserver) {
    new MutationObserver(tell).observe(document.documentElement,
      { childList: true, subtree: true, characterData: true, attributes: true });
  }
  // 첫 렌더가 스크립트보다 늦을 수 있다 — 잠깐 더 확인한다
  var n = 0, t = setInterval(function () { tell(); if (++n > 20) clearInterval(t); }, 150);
})();
<\/script>`;

/**
 * 화면 하나를 자체 완결 문서로 만든다.
 * @param {object} [opt] { inject, after }
 *   inject 설정 블록 직후에 끼울 값
 *   after  문서 끝에 붙일 코드 — 단계별 상태를 **실제 조작으로** 만든다
 *          (플래그를 억지로 세우지 않는다. 진짜 버튼을 누른 결과를 보여준다)
 */
function selfContained(file, opt) {
  const o = opt || {};
  let html = read(file);
  const tags = html.match(/<script src="([^"]+)"><\/script>/g) || [];
  tags.forEach((tag) => {
    const src = tag.match(/src="([^"]+)"/)[1];
    html = html.replace(tag, '<script>' + read(src).replace(/<\/(script)/gi, '<\\/$1') + '</script>');
  });
  if (o.inject) {
    // 설정 블록이 만들어진 **직후**에 끼워 넣는다. 앞에 넣으면 덮어써진다
    const anchor = '</script>';
    const at = html.indexOf(anchor, html.indexOf(o.inject.global));
    if (at === -1) throw new Error(`${file}: 설정 블록을 찾지 못했다`);
    const code = `\n<script>Object.assign(window.${o.inject.global}, ${JSON.stringify(o.inject.value)});</script>`;
    html = html.slice(0, at + anchor.length) + code + html.slice(at + anchor.length);
  }
  return html + AUTOSIZE + (o.after || '');
}

/**
 * 4단계 중 마지막(생성)은 **사양이 확정된 뒤**의 화면이다.
 * `state.locked` 를 밖에서 세울 수 없고, 세워서도 안 된다 — 확정은 버튼을 눌러야
 * 일어나는 일이고, 눌리지 않은 것을 눌린 것처럼 보이면 그건 미리보기가 아니라 그림이다.
 * 그래서 진짜 [이 사양으로 확정] 을 누른다.
 */
const CONFIRM_SPEC = `
<script>
(function () {
  var n = 0, t = setInterval(function () {
    var b = Array.prototype.slice.call(document.querySelectorAll('button'))
      .filter(function (x) { return x.textContent.trim() === '이 사양으로 확정' && !x.disabled; })[0];
    if (b) { b.click(); clearInterval(t); }
    if (++n > 30) clearInterval(t);
  }, 100);
})();
<\/script>`;

/**
 * 보고서 생성 4단계. **순서가 곧 강제 흐름이다** — 앞 단계를 건너뛸 수 없다.
 * 3·4 는 같은 파일(reports.html)의 서로 다른 상태다: 확정 전 / 확정 후.
 */
const SCREENS = [
  { step: 1, file: 'intake.html', name: '보고서 생성 입력',
    note: '요청문과 원본 자료를 받는다. 지원하지 않는 형식은 올리기 전에 막고, 요청문에서 뽑은 값은 미확인으로 표시한다.' },
  { step: 2, file: 'fields.html', name: '가이드 필드 입력',
    note: '수치를 출처와 함께 넣는다. 출처가 없으면 저장 버튼이 열리지 않고, 계산 항목은 입력란을 만들지 않는다. 자동으로 채워지는 줄에는 출처를 묻지 않는다.' },
  { step: 3, file: 'reports.html', name: '출력 사양 확정',
    note: '페이지 수·형식·언어를 사람이 못 박는다. 확정 전에는 생성 버튼이 열리지 않는다.' },
  { step: 4, file: 'reports.html', name: '생성', after: 'CONFIRM_SPEC',
    note: '확정(LOCK) 뒤의 화면이다. 아래 [이 사양으로 확정] 을 실제로 누른 결과이며, 상태를 억지로 세운 것이 아니다.' },
];

/**
 * 이 흐름 밖의 화면 — 순서에 끼워 넣으면 4단계가 5단계처럼 보인다.
 * (작업지시판은 2026-08-15 저장소에서 제거되었다)
 */
const EXTRAS = [];

async function build() {
  const AGENT = path.join(HERE, '..', '..');
  const { createHandlers } = require(path.join(AGENT, 'ui', 'api-router.cjs'));
  const h = createHandlers({ agentModulePath: AGENT });

  // ★ 응답을 손으로 만들지 않는다. 서버가 실제로 내려줄 것을 그대로 심는다 —
  //   손으로 만들면 서버가 항목을 하나 더 보내기 시작해도 미리보기는 모른다
  const intakeInfo = (await h.intake()).body;
  const fieldsInfo = (await h.fields()).body;

  const INJECT = {
    'intake.html': { global: 'LINKPILOT_INTAKE', value: { preload: intakeInfo } },
    'fields.html': { global: 'LINKPILOT_FIELDS_CFG', value: { preload: fieldsInfo } },
  };

  const AFTER = { CONFIRM_SPEC };

  /** 화면 한 칸. 높이를 고정하지 않는다 — 문서가 자기 높이를 알려 주면 그만큼 늘어난다 */
  const panel = (s, id, badge) => {
    const doc = selfContained(s.file, { inject: INJECT[s.file], after: AFTER[s.after] })
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<section class="scr" id="${id}">
  <header class="scr__h">
    ${badge}
    <div class="scr__t">
      <h2 class="scr__n">${s.name}</h2>
      <p class="scr__d">${s.note}</p>
    </div>
    <code class="scr__f">${s.file}</code>
  </header>
  <iframe class="scr__i" name="${id}" title="${s.name}" srcdoc="${doc}" scrolling="no"></iframe>
</section>`;
  };

  const frames = SCREENS
    .map(s => panel(s, `s${s.step}`, `<span class="scr__no">${s.step}</span>`))
    .join('\n');

  const extras = EXTRAS
    .map((s, i) => panel(s, `x${i}`, '<span class="scr__no scr__no--x">·</span>'))
    .join('\n');

  const nav = SCREENS.map(s => `<a href="#s${s.step}"><b>${s.step}</b>${s.name}</a>`).join('')
    + EXTRAS.map((s, i) => `<a class="nav__x" href="#x${i}">${s.name}</a>`).join('');

  return `<title>보고서 생성 화면 미리보기</title>
<style>
  :root {
    --ink: #17181A; --ink2: #6B7280; --line: #E5E7EB;
    --bg: #FAFAFA; --surface: #FFFFFF; --lime: #9ED700; --lime-deep: #4F6A00;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 400 15px/1.6 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
          'Malgun Gothic', Arial, sans-serif;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 26px; font-weight: 800; margin: 0 0 8px; letter-spacing: -.01em; }
  .lede { color: var(--ink2); font-size: 14.5px; margin: 0 0 6px; max-width: 68ch; }
  .warn { margin: 18px 0 26px; padding: 13px 16px; border-radius: 12px;
    background: #FDF3E3; color: #8A5A10; font-size: 13.5px; line-height: 1.65; max-width: 68ch; }
  .nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 30px; }
  .nav a { display: inline-flex; align-items: center; gap: 7px;
    font-size: 13px; font-weight: 600; text-decoration: none; padding: 8px 14px;
    border-radius: 999px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); }
  .nav a b { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%;
    background: var(--ink); color: var(--surface); font-size: 11px; font-weight: 800; }
  .nav a:hover { border-color: var(--lime); color: var(--lime-deep); }
  .nav .nav__x { color: var(--ink2); }
  .nav a:focus-visible, .scr__i:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

  /* 단계 패널 — 높이를 고정하지 않는다. 문서가 알려 준 만큼 늘어난다 */
  .scr { margin-bottom: 42px; scroll-margin-top: 18px; }
  .scr__h { display: grid; grid-template-columns: 34px 1fr auto; align-items: start;
    gap: 12px; margin-bottom: 12px; }
  .scr__no { grid-row: span 1; width: 30px; height: 30px; border-radius: 50%;
    display: grid; place-items: center; background: var(--ink); color: var(--surface);
    font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .scr__no--x { background: var(--line); color: var(--ink2); }
  .scr__t { min-width: 0; }
  .scr__n { font-size: 17px; font-weight: 800; margin: 0 0 5px; }
  .scr__d { font-size: 13.5px; color: var(--ink2); margin: 0; max-width: 72ch; }
  .scr__f { font: 600 12px/1 ui-monospace, Menlo, Consolas, monospace; color: var(--ink2);
    background: var(--surface); border: 1px solid var(--line); padding: 5px 9px;
    border-radius: 6px; white-space: nowrap; }
  .scr__i { width: 100%; height: 700px; border: 1px solid var(--line);
    border-radius: 14px; background: #fff; display: block; overflow: hidden;
    transition: height .15s ease-out; }

  .cut { border: 0; border-top: 1px solid var(--line); margin: 46px 0 14px; }
  .cut__d { font-size: 13.5px; color: var(--ink2); margin: 0 0 26px; }

  @media (max-width: 700px) {
    .scr__h { grid-template-columns: 28px 1fr; }
    .scr__f { grid-column: 2; justify-self: start; }
  }
  @media (prefers-reduced-motion: reduce) { .scr__i { transition: none; } }
</style>
<div class="wrap">
  <h1>보고서 생성 화면 미리보기</h1>
  <p class="lede">LinkPilot 보고서 생성의 입력부터 산출까지 4단계 화면입니다. 아래는 실제 파일을 그대로 띄운 것이며, 축소본이나 그림이 아닙니다.</p>
  <div class="warn">
    <b>서버에 연결되어 있지 않습니다.</b> 화면이 뜨도록 <b>접수 정보와 데이터 사전만</b>
    심어 두었습니다 — 서버가 보낼 것과 같은 출처에서 그대로 가져온 값이며 지어낸 것이 아닙니다.
    프로젝트 데이터는 심지 않았으므로 목록·저장된 값은 비어 있습니다. 저장·생성 버튼은
    실제로 아무것도 하지 않습니다.
  </div>
  <nav class="nav">${nav}</nav>
${frames}
  <hr class="cut">
  <p class="cut__d">아래는 <b>보고서 생성 흐름 밖</b>의 화면입니다.</p>
${extras}
</div>
<script>
// 각 문서가 자기 높이를 알려 오면 그만큼 늘린다 — 안쪽 스크롤이 생기지 않게.
// 높이를 여기서 정하지 않는 이유: 화면 내용이 바뀌면(판 전환·값 입력) 필요한
// 높이도 바뀐다. 빌드 시점에 박아 두면 그날부터 틀린 값이 된다.
window.addEventListener('message', function (e) {
  var d = e.data;
  if (!d || typeof d.linkpilotPreviewHeight !== 'number') return;
  // ★ id 로 찾지 않는다 — 앵커용 <section> 이 같은 이름을 쓰고 있어 그걸 집는다.
  //   iframe 은 name 으로 찾는다 (문서가 window.name 으로 자기를 밝힌다)
  if (!/^[a-z0-9]+$/i.test(String(d.frame || ''))) return;
  var f = document.querySelector('iframe[name="' + d.frame + '"]');
  if (!f) return;
  f.style.height = Math.max(240, Math.ceil(d.linkpilotPreviewHeight)) + 'px';
});
<\/script>`;
}

async function main() {
  const out = arg('--out', path.join(HERE, 'preview.html'));
  const frag = await build();
  const html = process.argv.includes('--fragment')
    ? frag
    : `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n`
      + `<meta name="viewport" content="width=device-width, initial-scale=1">\n`
      + frag.slice(0, frag.indexOf('</style>') + 8)
      + `\n</head>\n<body>\n`
      + frag.slice(frag.indexOf('</style>') + 8)
      + `\n</body>\n</html>\n`;
  fs.writeFileSync(out, html);
  console.log(`${out} (${Math.round(html.length / 1024)}KB)`
    + ` · 단계 ${SCREENS.length}개 + 흐름 밖 ${EXTRAS.length}개`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { build, SCREENS, EXTRAS };
