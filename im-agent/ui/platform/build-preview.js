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
const os = require('os');
const path = require('path');

const HERE = __dirname;
const FLOW = require('./flow-core.js');

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
/**
 * 앱에 끼웠을 때의 모습. 화면 파일들은 따로 열면 자기 사이드바·로고·단계 칩을
 * 갖고 있어서, 그대로 묶으면 **로고가 두 번 나오고 단계 표시가 두 벌이 된다.**
 * 확인하라고 보낸 화면이 실제 앱과 다른 그림이면 확인이 아니다.
 */
const EMBED = `<style>${FLOW.EMBED_CSS}</style>`;

function selfContained(file, opt) {
  const o = opt || {};
  let html = read(file);
  // ★ 토큰 파일도 인라인한다. 안 하면 미리보기가 **색 없이** 뜨고 오류는 안 난다 —
  //   CSS 는 못 찾은 변수를 조용히 넘긴다 (2026-08-17 디자인 시스템 반영)
  const links = html.match(/<link rel="stylesheet" href="([^"]+)">/g) || [];
  links.forEach((tag) => {
    const href = tag.match(/href="([^"]+)"/)[1];
    html = html.replace(tag, '<style>' + read(href) + '</style>');
  });
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
  return html + (o.embed === false ? '' : EMBED) + AUTOSIZE + (o.after || '');
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
 * 보고서 생성 4단계. **목록을 여기서 새로 만들지 않는다** — `flow-core.js` 가
 * 제품 화면(report-flow.html)과 공유하는 단일 출처다. 두 벌이 되면
 * 미리보기와 제품이 다른 흐름을 보여주고, 어느 쪽이 맞는지 알 수 없게 된다.
 */
const SCREENS = FLOW.STEPS;

/** 흐름 밖 화면 — 순서에 끼우면 4단계가 5단계처럼 보인다. 지금은 없다 */
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
    .map(s => panel(s, `s${s.no}`, `<span class="scr__no">${s.no}</span>`))
    .join('\n');

  const extras = EXTRAS
    .map((s, i) => panel(s, `x${i}`, '<span class="scr__no scr__no--x">·</span>'))
    .join('\n');

  const nav = SCREENS.map(s => `<a href="#s${s.no}"><b>${s.no}</b>${s.name}</a>`).join('')
    + EXTRAS.map((s, i) => `<a class="nav__x" href="#x${i}">${s.name}</a>`).join('');

  return `<title>보고서 생성 화면 미리보기</title>
<style>
  :root {
    --ink: #0A1419; --ink2: #6B7280; --line: #E5E7EB;
    --bg: #FAFAFA; --surface: #FFFFFF; --lime: #AAE106; --lime-deep: #7BA10F;
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

/**
 * 앱의 [보고서 생성] **섹션 그대로**를 파일 하나로 만든다.
 *
 * 위 `build()` 는 화면 넷을 나열해 보여 준다. 이쪽은 **제품이 실제로 그리는 껍데기**
 * (`report-flow.html`)를 그대로 띄우고, 그 안의 단계 화면만 문서로 심는다 —
 * 레일·잠금 사유·외부 분석 경로까지 실물이다.
 *
 * ★ 화면을 복사하지 않는다. report-flow.html 을 읽어 스크립트만 인라인한다.
 *   복사하면 제품을 고친 날부터 미리보기가 거짓말을 한다.
 */
/**
 * 단계별 문서 넷. 단계마다 상태가 다르므로 파일이 같아도 따로 만든다.
 *
 * ★ 밖으로 꺼내 둔 이유: 「미리 그려 넣는 판」(build-static.js)도 **같은 문서**를
 *   써야 한다. 두 벌이 되면 한쪽만 고치는 날 두 미리보기가 다른 화면을 보여준다.
 */
async function buildSectionDocs() {
  const AGENT = path.join(HERE, '..', '..');
  const { createHandlers } = require(path.join(AGENT, 'ui', 'api-router.cjs'));
  const h = createHandlers({ agentModulePath: AGENT });

  const intakeInfo = (await h.intake()).body;
  const fieldsInfo = (await h.fields()).body;
  const INJECT = {
    'intake.html': { global: 'LINKPILOT_INTAKE', value: { preload: intakeInfo } },
    'fields.html': { global: 'LINKPILOT_FIELDS_CFG', value: { preload: fieldsInfo } },
  };
  const AFTER = { CONFIRM_SPEC };

  const docs = {};
  SCREENS.forEach((s) => {
    docs[s.id] = selfContained(s.file, { inject: INJECT[s.file], after: AFTER[s.after] });
  });
  return docs;
}

/**
 * 세부 진행률이 읽는 값. **지어내지 않는다** — 서버가 실제로 내려주는 필드 정의만
 * 심고, 프로젝트에 딸린 값(입력값·사양·실행 스냅샷)은 없으므로 없는 채로 둔다.
 * 그러면 화면은 「아직」이라고 적는다. 그게 사실이다.
 */
async function flowPreload() {
  const AGENT = path.join(HERE, '..', '..');
  const { createHandlers } = require(path.join(AGENT, 'ui', 'api-router.cjs'));
  const h = createHandlers({ agentModulePath: AGENT });
  const info = (await h.fields()).body;
  return {
    fields: info.fields || {},
    computedKeys: info.computedKeys || [],
    assetClasses: info.assetClasses || [],
    // 미리보기 프로젝트는 데이터센터다 (LP-DC-…). 지어낸 값이 아니라
    // 프로젝트 번호가 말하는 그대로다
    assetClass: 'datacenter',
    values: {},        // 저장된 값이 없다 (0 개 — 「모름」과 다르다)
    sources: null,     // 올린 자료 목록은 서버만 안다 → 모름
    spec: null,
    snapshot: null,
  };
}

/**
 * 제품 껍데기(`report-flow.html`)를 파일 하나로 만든다.
 *
 * @param {object} docs 단계 화면 문서. `{}` 를 주면 **레일과 세부 진행률만** 나온다
 *   (아티팩트 조각처럼 껍데기만 보여야 할 때).
 */
async function flowShell(docs) {
  let shell = read('report-flow.html');
  // ★ 토큰 파일을 인라인한다. 놓치면 **색 없이** 뜨는데 오류는 안 난다
  //   (`flow.test.js` 의 「파일 하나로 열린다」가 잡는다)
  (shell.match(/<link rel="stylesheet" href="([^"]+)">/g) || []).forEach((tag) => {
    shell = shell.replace(tag, '<style>' + read(tag.match(/href="([^"]+)"/)[1]) + '</style>');
  });
  (shell.match(/<script src="([^"]+)"><\/script>/g) || []).forEach((tag) => {
    const src = tag.match(/src="([^"]+)"/)[1];
    shell = shell.replace(tag, '<script>' + read(src).replace(/<\/(script)/gi, '<\\/$1') + '</script>');
  });

  // 설정 블록 **직후**에 끼운다. 앞에 넣으면 덮어써진다
  const at = shell.indexOf('</script>', shell.indexOf('LINKPILOT_REPORT_FLOW'));
  if (at === -1) throw new Error('report-flow.html: 설정 블록을 찾지 못했다');

  // ★ 문서를 스크립트 안에 심을 때 `<` 를 전부 \u003C 로 바꾼다.
  //   닫는 태그만 깨서는 부족하다 — 화면 문서에는 주석 여는 기호와 여는 script
  //   태그도 들어 있고, 브라우저는 그걸 만나면 스크립트 데이터 상태를 바꿔
  //   버려 뒤의 닫는 태그를 종료로 보지 않는다. 그러면 블록 전체가 문법 오류가
  //   되고 화면이 통째로 빈다 — 오류는 콘솔에만 뜬다 (실제로 그랬다).
  const embedded = JSON.stringify(docs).replace(/</g, '\\u003C');
  const preload = JSON.stringify(await flowPreload()).replace(/</g, '\\u003C');

  const inject = `
<script>
// 미리보기 전용 — 서버가 없으므로 단계 화면을 문서로 직접 심는다
window.LINKPILOT_PREVIEW_DOCS = ${embedded};
Object.assign(window.LINKPILOT_REPORT_FLOW, {
  api: '(미리보기 — 서버 없음)',
  projectId: 'LP-DC-2026-001',
  preload: ${preload},
  external: { repoUrl: null, agentUrl: null },
});
<\/script>`;
  return shell.slice(0, at + 9) + inject + shell.slice(at + 9);
}

async function buildSection() {
  const shell = await flowShell(await buildSectionDocs());

  // ★ 미리보기임을 화면에 박아 둔다. 실물로 오해하면 이걸 근거로 판단한다
  const banner = `
<div style="max-width:1120px;margin:18px auto 0;padding:13px 16px;border-radius:12px;
  background:#FDF3E3;color:#8A5A10;font:400 13.5px/1.65 Arial,'Malgun Gothic',sans-serif">
  <b>미리보기입니다 — 서버에 연결되어 있지 않습니다.</b>
  화면이 뜨도록 <b>접수 정보와 데이터 사전만</b> 심어 두었습니다. 서버가 보낼 것과
  같은 출처에서 가져온 값이며 지어낸 것이 아닙니다. 프로젝트 데이터는 심지 않았으므로
  목록·저장된 값은 비어 있고, 저장·생성 버튼은 실제로 아무것도 하지 않습니다.
  제품에서는 네 단계를 하나씩 보여주지만 여기서는 <b>한 번에 펼쳐</b> 둡니다.
</div>`;
  return shell.replace('<body>', '<body>' + banner + changePanel() + evidencePanel() + vaultPanel() + linkedPanel() + deskPanel());
}

/**
 * 자료를 서버에 **보관하는 동안 잃지 않는가**를 눈으로 확인하게 한다 (D-64).
 *
 * ★ 이 계층은 화면이 없다. 그리고 실패가 전부 조용하다 — 덮어써도 「저장됨」만
 *   뜨고, 파일이 바뀌어도 보고서는 그대로 나온다. 말로만 남으면 확인할 방법이 없다.
 *
 * ★ **여기 결과는 손으로 쓴 것이 아니다.** 빌드할 때 임시 폴더를 만들어
 *   `core/vault.js` 를 실제로 돌리고, 그 반환값을 그대로 옮긴다.
 */
function vaultPanel() {
  const AGENT = path.join(HERE, '..', '..');
  const vault = require(path.join(AGENT, 'core', 'vault'));
  const store = require(path.join(AGENT, 'core', 'store'));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-vault-'));
  const id = 'LP-DC-2026-001';
  const p = path.join(root, id);
  fs.mkdirSync(path.join(p, '02_Source_Data'), { recursive: true });
  const B = (s) => Buffer.from(s, 'utf8');

  const rows = [];
  const row = (title, note, out, bad) => rows.push({ title, note, out, bad: !!bad });

  // ① 같은 이름을 덮어쓸 때 이전 판이 사라지는가
  const v1 = vault.put(p, '사업계획서.pdf', B('첫 번째 판 — 총사업비 2,846억원'));
  const v2 = vault.put(p, '사업계획서.pdf', B('두 번째 판 — 총사업비 3,120억원'));
  const listed = vault.list(p);
  row('같은 이름을 다시 올렸다', '이전 판이 사라지는가',
    `저장: ${v2.name} (${v2.sha256.slice(0, 12)}…)\n`
    + `덮어쓴 판: ${v2.replaced ? v2.replaced.as : '(없음)'}\n`
    + `→ 휴지통에 남아 있음 ${listed.trash.length}건 — 되돌릴 수 있다\n`
    + `→ 이전 해시 ${v1.sha256.slice(0, 12)}… 와 일치: ${v2.replaced && v2.replaced.sha256 === v1.sha256}`);

  // ② 같은 파일을 두 번 올리면
  const dup = vault.put(p, '사업계획서.pdf', B('두 번째 판 — 총사업비 3,120억원'));
  row('같은 파일을 다시 올렸다', '세대가 늘어나 용량만 먹는가',
    `duplicate: ${dup.duplicate} · 휴지통 ${vault.list(p).trash.length}건 (늘지 않는다)`);

  // ③ 보관한 파일이 바뀌면 — NAS 공유폴더에서 누가 손댔다고 하자
  vault.put(p, '감정평가서.pdf', B('원본 그대로'));
  const before = vault.verify(p);
  fs.writeFileSync(path.join(p, '02_Source_Data', '감정평가서.pdf'), '누가 바꾼 내용');
  const after = vault.verify(p);
  row('보관 중인 파일이 바뀌었다', '증상이 없는 사고를 잡는가',
    `바뀌기 전: 대조 통과 ${before.ok} (${before.checked}건 확인)\n`
    + `바뀐 뒤 : 대조 통과 ${after.ok} · 불일치 ${after.mismatched.length}건\n`
    + (after.mismatched[0]
      ? `  ${after.mismatched[0].name}\n  기대 ${after.mismatched[0].expected.slice(0, 16)}…\n  실제 ${after.mismatched[0].actual.slice(0, 16)}…`
      : ''), true);

  // ④ 장부에 없는 파일 — NAS 에서 직접 복사해 넣었다고 하자
  fs.writeFileSync(path.join(p, '02_Source_Data', '몰래넣은자료.xlsx'), 'x');
  const unknown = vault.verify(p);
  row('장부에 없는 파일이 있다', '조용히 무시하는가',
    `장부 밖 파일 ${unknown.unknown.length}건: ${unknown.unknown.map(u => u.name).join(', ')}\n`
    + '→ 없던 것으로 치지 않는다. reconcile() 로 등록해야 대조가 통과한다', true);

  // ⑤ 지우기 — 휴지통으로만 간다
  const del = vault.trash(p, '몰래넣은자료.xlsx');
  row('자료를 지웠다', '정말 없어지는가',
    `휴지통으로 이동: ${del.trashed.as}\n`
    + `원본 위치에 남아 있는가: ${fs.existsSync(path.join(p, '02_Source_Data', '몰래넣은자료.xlsx'))}\n`
    + '→ 되돌릴 수 있다. 정말 없애려면 며칠 지난 것인지를 지정해 따로 비운다');

  // ⑥ 비우기는 기본이 미리보기
  const dry = vault.purge(p, { olderThanDays: 0 });
  row('휴지통을 비우려 했다', '되돌릴 수 없는 동작에 기본값이 있는가',
    `날짜를 안 주면: ${JSON.stringify(vault.purge(p, {}).reason)}\n`
    + `날짜만 주면 : dryRun=${dry.dryRun} · 지워질 것 ${dry.willRemove.length}건 (아직 안 지운다)\n`
    + '→ confirm 을 줘야 실제로 지운다');

  // ⑦ 버린 자료가 다시 추출되는가 — 여기가 가장 위험한 자리다
  const prev = process.env.IM_AGENT_ROOT;
  process.env.IM_AGENT_ROOT = root;
  let extracted = [], excluded = [];
  try {
    extracted = store.listSourceFiles(id).map(f => f.name);
    excluded = store.listExcludedSourceFiles(id);
  } finally {
    if (prev === undefined) delete process.env.IM_AGENT_ROOT; else process.env.IM_AGENT_ROOT = prev;
  }
  row('추출기가 무엇을 읽는가', '버린 자료가 다시 실리는가',
    `읽는 것 ${extracted.length}건: ${extracted.join(', ')}\n`
    + '읽지 않는 것:\n' + excluded.map(x => `  ${x.name} (${x.files}건) — ${x.why}`).join('\n'));

  // ⑧ 용량 — 개정안 §3-1 이 세기로 한 것
  const u = vault.usage(p);
  const kb = (n) => `${(n / 1024).toFixed(2)}KB`;
  row('용량은 무엇을 세는가', '§3-1 이 정한 대로인가',
    `원본 ${u.live.files}건 ${kb(u.live.bytes)} · 휴지통 ${u.trash.files}건 ${kb(u.trash.bytes)}\n`
    + `청구 기준 = 원본 + 휴지통 = ${kb(u.billableBytes)}\n`
    + `쓰다 만 조각(.tmp) ${u.tmp.files}건 ${kb(u.tmp.bytes)} — 청구엔 안 넣되 합계에서 숨기지 않는다`);

  const blocks = rows.map(r => `<div class="ev__c${r.bad ? ' bad' : ''}">
    <div class="ev__n">${esc(r.title)}</div>
    <div class="ev__m">${esc(r.note)}</div>
    <pre class="ev__o">${esc(r.out)}</pre>
  </div>`).join('');

  return `
<section class="ev">
  <h2 class="ev__t">눈으로 확인 — 올린 자료를 보관하는 동안 잃지 않는가</h2>
  <p class="ev__s">아래는 이 미리보기를 만들 때 임시 폴더에서 <b>실제로 <code>core/vault.js</code> 를 돌려</b>
    얻은 결과입니다. 손으로 적은 예시가 아닙니다. 이 계층의 실패는 <b>전부 조용합니다</b> —
    덮어써도 화면에는 「저장됨」만 뜨고, 파일이 바뀌어도 보고서는 그대로 나오며 출처 표시도 멀쩡합니다.
    그래서 「되는가」가 아니라 <b>「잃지 않는가」</b>를 확인합니다.</p>
  ${blocks}
</section>`;
}

/**
 * 자료를 **보관하지 않고 연결해서** 쓸 때 무엇을 잃지 않는가 (D-65 · D-66).
 *
 * ★ 이 계층도 화면이 없다. 그리고 실패가 조용하다 — 원본이 바뀌어도 문서는
 *   그대로 멀쩡하고, 붙지 않은 경로는 「올렸는데 아무 일도 안 일어남」이 된다.
 *
 * ★ **빌드할 때 실제로 돌린 결과다.** 손으로 적지 않는다.
 */
function linkedPanel() {
  const AGENT = path.join(HERE, '..', '..');
  const linked = require(path.join(AGENT, 'core', 'linked'));
  const oneshot = require(path.join(AGENT, 'core', 'oneshot'));
  const storage = require(path.join(AGENT, 'connectors', 'storage'));

  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'im-linked-'));
  fs.mkdirSync(path.join(p, '01_Project'), { recursive: true });
  fs.mkdirSync(path.join(p, '02_Source_Data'), { recursive: true });
  const B = (s) => Buffer.from(s, 'utf8');

  const rows = [];
  const row = (t, n, o, bad) => rows.push({ t, n, o, bad: !!bad });

  // ① 범위는 폴더까지만 — 막는 것과 못 막는 것
  const wide = storage.checkScope('gdrive', 'https://www.googleapis.com/auth/drive.readonly');
  const narrow = storage.checkScope('gdrive', 'https://www.googleapis.com/auth/drive.file');
  const dbx = storage.checkScope('dropbox', 'files.metadata.read files.content.read');
  row('연결 범위가 드라이브 전체다', '서버가 막는가',
    `drive.readonly → ok=${wide.ok}\n  ${wide.reason}\n`
    + `drive.file     → ok=${narrow.ok} (verifiable=${narrow.verifiable})\n`
    + `Dropbox        → ok=${dbx.ok} · verifiable=${dbx.verifiable}\n  ${dbx.reason}`, true);

  // ② 연결만으로는 아무것도 안 가져온다
  const ref = { provider: 'dropbox', fileId: 'id:AAA1', name: '사업계획서.pdf', rev: '0123456789ab', path: '/Deals/사업계획서.pdf' };
  const lk = linked.link(p, ref);
  row('자료를 연결했다', '가져와 두는가',
    `연결됨: ${lk.item.key} · 판 ${lk.item.rev}\n`
    + `지문: ${lk.item.fingerprint === null ? 'null (아직 안 읽음 — 지어내지 않는다)' : '?'}\n`
    + `02_Source_Data 안의 파일: ${fs.readdirSync(path.join(p, '02_Source_Data')).length}건`);

  // ③ 읽을 때만 가져오고 끝나면 지운다 (동기적으로 확인 가능한 부분만)
  const before = fs.readdirSync(path.join(p, '01_Project'));
  row('무엇을 남기는가', '파일 대신 무엇이 남는가',
    `01_Project: ${before.join(' · ')}\n`
    + `출처 한 줄: ${linked.citation(linked.list(p).items[0])}`);

  // ④ 1회성 — 읽고 버린다. 대조는 아예 거절한다
  const os1 = oneshot.accept(p, [{ name: '감정평가서.pdf', buf: B('토지가액 120억원') }]);
  const kept = os1.files.map(f => fs.existsSync(f.path));
  const removed = os1.dispose().removed;
  const item = oneshot.list(p).items[0];
  row('1회성으로 올렸다', '파일이 남는가',
    `작업 사본 위치: 프로젝트 폴더 밖 (${os1.dir.startsWith(p) ? '안 — 문제' : '밖'})\n`
    + `읽는 동안 존재: ${kept.join(', ')} → 지운 뒤 ${removed}건 삭제\n`
    + `장부에 남는 것: sha256 ${item.fingerprint.value.slice(0, 12)}… · retainedCopy=${item.retainedCopy}\n`
    + `출처 한 줄: ${oneshot.citation(item)}`);

  const cv = oneshot.cannotVerify();
  row('1회성 자료를 대조하려 했다', '「이상 없음」이 나오는가',
    `verify() 존재: ${typeof oneshot.verify}\n`
    + `cannotVerify → ok=${cv.ok} · byDesign=${cv.byDesign}\n  ${cv.reason}\n`
    + `  → ${cv.insteadDo}`, true);

  const blocks = rows.map(r => `<div class="ev__c${r.bad ? ' bad' : ''}">
    <div class="ev__n">${esc(r.t)}</div>
    <div class="ev__m">${esc(r.n)}</div>
    <pre class="ev__o">${esc(r.o)}</pre>
  </div>`).join('');

  return `
<section class="ev">
  <h2 class="ev__t">눈으로 확인 — 자료를 보관하지 않고 쓰는 길</h2>
  <p class="ev__s">아래는 이 미리보기를 만들 때 임시 폴더에서 <b>실제로 <code>core/linked.js</code> ·
    <code>core/oneshot.js</code> · <code>connectors/storage.js</code> 를 돌려</b> 얻은 결과입니다.
    이 계층은 화면이 없고 <b>실패가 조용합니다</b> — 원본이 바뀌어도 문서는 그대로 멀쩡하고,
    붙지 않은 경로는 「올렸는데 아무 일도 안 일어남」이 됩니다.</p>
  ${blocks}
</section>`;
}

/**
 * 탁상검토 보고서가 **어떤 경우에 값을 안 내는지**를 눈으로 확인하게 한다 (D-57).
 *
 * ★ 이 문서에서 가장 중요한 동작은 「값을 낸다」가 아니라 **「안 낸다」**다.
 *   방식이 하나뿐이거나 편차가 크면 표지에 숫자를 올리지 않는데, 그건 화면
 *   어디에도 안 나오는 판단이라 **말로만 남으면 확인할 방법이 없다.**
 *
 * ★ **여기 결과는 손으로 쓴 것이 아니다.** 빌드할 때 `core/deskappraisal.js` 를
 *   실제로 돌려 그 출력을 그대로 넣는다.
 */
function deskPanel() {
  const AGENT = path.join(HERE, '..', '..');
  const da = require(path.join(AGENT, 'core', 'deskappraisal'));

  const M = (label, valueEok, extra) => Object.assign({ label, valueEok }, extra || {});
  const cases = [
    { label: '3방식이 모이고 편차가 작다', methods: {
      official: M('공시지가 기준', 100), comparison: M('거래사례비교법', 120), income: M('수익환원법', 110),
    }, concluded: { valueEok: 112, weights: { '거래사례비교법': 0.5 }, pricePerSqm: 1300000 } },
    { label: '방식 간 편차가 3배다', methods: {
      official: M('공시지가 기준', 50), comparison: M('거래사례비교법', 150),
    }, concluded: { valueEok: 100, weights: {}, pricePerSqm: 1 } },
    { label: '방식이 하나뿐이다', methods: { income: M('수익환원법', 110) }, concluded: null },
    { label: '아무것도 산정되지 않았다', methods: {}, concluded: null },
  ];

  const rows = cases.map((c) => {
    const con = da.conclusion({ methods: c.methods, concluded: c.concluded });
    const cover = da.coverValue(con);
    return `<div class="ev__c${cover ? '' : ' bad'}">
      <div class="ev__n">${esc(c.label)}</div>
      <div class="ev__m">결론 방식 <b>${esc(con.mode)}</b> · 표지 값 ${cover ? esc(cover) : '<b>올리지 않음</b>'}</div>
      <pre class="ev__o">${esc(con.text)}${con.why ? '\n\n' + esc(con.why) : ''}</pre>
    </div>`;
  }).join('');

  // ── 법인평가 (D-59) — 같은 규칙이 법인 쪽에서도 도는지 ──
  const cr = require(path.join(AGENT, 'core', 'corpreport'));
  const CORP = { corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12 };
  const corpCases = [
    { label: '자료가 갖춰졌다 (부동산 30%)', args: { ...CORP, realEstatePct: 30 } },
    { label: '부동산과다보유법인이다 (62%)', args: { ...CORP, realEstatePct: 62 } },
    { label: '부동산 비율을 모른다', args: { ...CORP } },
    { label: '최근 3년이 손실이다', args: { corpName: CORP.corpName, netAsset: 200, income1: -30, income2: -20, income3: -10, realEstatePct: 10 } },
  ];
  const corpRows = corpCases.map((c) => {
    const r = cr.build({ projectId: 'preview', ...c.args });
    if (!r.ok) {
      return `<div class="ev__c bad"><div class="ev__n">${esc(c.label)}</div>
        <div class="ev__m">문서를 <b>만들지 않음</b></div><pre class="ev__o">${esc(r.reason)}</pre></div>`;
    }
    const cover = cr.coverValue(r.conclusion);
    const w = r.valuation.ok ? r.valuation.value.weights : null;
    return `<div class="ev__c${cover ? '' : ' bad'}">
      <div class="ev__n">${esc(c.label)}</div>
      <div class="ev__m">결론 <b>${esc(r.conclusion.mode)}</b> · 표지 값 ${cover ? esc(cover) : '<b>올리지 않음</b>'}${w ? ` · 가중치 ${w.income}:${w.asset}` : ''}</div>
      <pre class="ev__o">${esc(r.conclusion.text)}${r.conclusion.why ? '\n\n' + esc(r.conclusion.why) : ''}</pre>
    </div>`;
  }).join('');

  const notChecked = da.NOT_CHECKED
    .map(x => `<span>${esc(x.item)}</span>`).join('');

  const corpPanel = `
<section class="ev">
  <h2 class="ev__t">눈으로 확인 — 법인가치 검토가 값을 내지 않는 경우</h2>
  <p class="ev__s">같은 규칙이 법인 쪽에서도 돕니다. <b>부동산 비율 하나로 법령 가중치가
    3:2 에서 2:3 으로 뒤집히므로</b>, 모르면 계산 자체를 하지 않습니다.
    아래는 빌드할 때 <b>실제로 <code>core/corpreport.js</code> 를 돌려</b> 얻은 결과입니다.</p>
  <div class="ev__m">문서가 <b>확인하지 않았다고 적는 것</b> — ${cr.NOT_CHECKED.length}항목</div>
  <div class="ev__k">${cr.NOT_CHECKED.map(x => `<span>${esc(x.item)}</span>`).join('')}</div>
  ${corpRows}
  <div class="ev__m">${esc(cr.NOT_AN_OPINION)}</div>
</section>`;

  return `
<section class="ev">
  <h2 class="ev__t">눈으로 확인 — 탁상검토 보고서가 값을 내지 않는 경우</h2>
  <p class="ev__s">아래는 이 미리보기를 만들 때 <b>실제로 <code>core/deskappraisal.js</code> 를 돌려</b>
    얻은 결과입니다. 이 문서에서 가장 중요한 동작은 「값을 낸다」가 아니라
    <b>「안 낸다」</b>입니다 — 표지에 큰 숫자 하나가 박히면 그것만 읽히기 때문입니다.</p>
  <div class="ev__m">문서가 <b>확인하지 않았다고 적는 것</b> — ${da.NOT_CHECKED.length}항목</div>
  <div class="ev__k">${notChecked}</div>
  ${rows}
  <div class="ev__m">${esc(da.NOT_AN_APPRAISAL)}</div>
</section>${corpPanel}`;
}

/**
 * 화면이 없는 작업을 **눈으로 확인**하게 한다.
 *
 * ★ 왜 필요한가: 파서·커넥터처럼 화면에 안 나오는 작업은 "됐습니다"라는 말밖에
 *   남지 않는다. 그러면 받은 사람은 확인할 방법이 없고, 결국 믿거나 말거나가 된다.
 *
 * ★ **여기 적힌 결과는 손으로 쓴 것이 아니다.** 빌드할 때 실제 파서를 돌려
 *   그 출력을 그대로 넣는다. 손으로 쓰면 코드가 바뀐 날부터 화면만 옛말을 한다.
 *   (`flow.test.js` 가 실제 실행 결과인지 검사한다)
 *
 * ★ 자료는 **합성 예시**다. 실제 딜 자료는 이 저장소에 없다 (public 이다).
 */
function evidencePanel() {
  const AGENT = path.join(HERE, '..', '..');
  const ex = require(path.join(AGENT, 'agents', '02-extraction'));
  const FIX = path.join(AGENT, 'test', 'fixtures');
  const oleFix = require(path.join(FIX, 'ole.js'));
  const zipFix = require(path.join(FIX, 'zip.js'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-evidence-'));
  const put = (name, data) => {
    const f = path.join(tmp, name);
    fs.writeFileSync(f, data);
    return { name, path: f, ext: path.extname(name).toLowerCase() };
  };

  const cases = [
    { label: '글자가 들어 있는 PDF', note: '크로미움이 만든 예시 파일',
      file: put('사업개요.pdf', fs.readFileSync(path.join(FIX, 'sample-text.pdf'))) },
    { label: '스캔 이미지로 만든 PDF', note: '글자 레이어가 없는 예시 파일',
      file: put('감정평가서.pdf', fs.readFileSync(path.join(FIX, 'sample-scan.pdf'))) },
    { label: '한글 (.hwp — 바이너리)', note: '규격대로 만든 예시 파일',
      file: put('사업계획서.hwp', oleFix.buildHwp([
        '인천 남동 데이터센터 개발사업', '대지면적 12,345 ㎡ / 연면적 45,678 ㎡',
        '총사업비 2,846억원 · 계약전력 40 MW'])) },
    { label: '한글 (.hwpx — ZIP)', note: '규격대로 만든 예시 파일',
      file: put('요약.hwpx', zipFix.buildHwpx(['총사업비 2,846억원', 'LTC 65%'])) },
    { label: '옛 엑셀 (.xls)', note: '규격대로 만든 예시 파일',
      file: put('수지분석.xls', oleFix.buildXls([['항목', '값'], ['대지면적(㎡)', 12345], ['총사업비(억원)', 2846]])) },
    { label: '스캐너가 만든 TIFF', note: '읽는 방법이 없는 형식',
      file: put('현장도면.tiff', Buffer.from('II*\0 (예시)')) },
  ];

  const blocks = cases.map((c) => {
    const r = ex.toText(c.file);
    const head = `<div class="ev__n">${esc(c.label)}</div>`
      + `<div class="ev__m">${esc(c.file.name)} · ${esc(c.note)}</div>`;

    if (r.text) {
      const facts = [];
      r.text.split('\n').forEach(l => ex.extractFromLine(l).forEach(f => facts.push(f)));
      const keys = [...new Set(facts.map(f => `${f.key} = ${f.value}${f.unit ? ' ' + f.unit : ''}`))];
      return `<div class="ev__c">${head}
        <div class="ev__m">읽음 · ${r.text.length.toLocaleString()}자 · 규칙 추출 ${facts.length}건 (via ${esc(r.via)})</div>
        <pre class="ev__o">${esc(r.text.slice(0, 240))}</pre>
        ${keys.length ? `<div class="ev__k">${keys.slice(0, 6).map(k => `<span>${esc(k)}</span>`).join('')}</div>` : ''}
      </div>`;
    }
    const next = r.ocr
      ? '→ 실제 실행에서는 글자로 옮겨 읽는 경로로 넘어갑니다 (GEMINI_API_KEY 필요)'
      : '→ 넘어갈 곳이 없습니다. 바꿔서 올려야 합니다';
    return `<div class="ev__c bad">${head}
      <div class="ev__m">못 읽음</div>
      <pre class="ev__o">${esc(r.error)}\n${esc(next)}</pre>
    </div>`;
  }).join('');

  const groups = ex.readGroups().map(g =>
    `<div class="ev__m">${esc(g.label)} — ${esc(g.ext.join(' '))}</div>`).join('');

  return `
<section class="ev">
  <h2 class="ev__t">눈으로 확인 — 자료를 실제로 읽어 본 결과</h2>
  <p class="ev__s">아래 결과는 이 미리보기를 만들 때 <b>실제 파서를 돌려</b> 그대로 옮긴 것입니다.
    손으로 적은 예시가 아닙니다. 다만 <b>자료 자체는 합성 예시</b>입니다 — 실제 딜 자료는
    이 저장소에 두지 않습니다.</p>
  ${groups}
  ${blocks}
</section>`;
}

/** HTML 로 내보낼 때 태그가 되지 않게 한다 (내역 문구는 사람이 쓴 글이다) */
function esc(t) {
  return String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 이번에 바뀐 것 — 미리보기 창 안에 띄운다.
 *
 * ★ 화면을 받은 사람이 **바뀐 줄도 모르고 옛 기준으로 보는 것**이 이 패널이 막는 일이다.
 * ★ 목록을 여기서 새로 적지 않는다. `changes.js` 하나가 출처다.
 * ★ 한 일과 아직 안 된 것을 **갈라 놓는다.** 섞으면 이미 된 것으로 읽힌다.
 */
function changePanel() {
  const C = require('./changes.js');

  const groups = C.byDate().map((g) => `
    <div class="upd__g">
      <div class="upd__d">${esc(g.at)}</div>
      <ul class="upd__l">
        ${g.items.map(i => `<li>
          <b>${esc(i.title)}</b>
          <em>${esc(i.where)}</em>
          <span>${esc(i.why)}</span>
          <div class="upd__ba">
            <div class="upd__b"><em>전</em>${esc(i.was)}</div>
            <div class="upd__a"><em>후</em>${esc(i.now)}</div>
          </div>
          <span class="upd__see">확인: ${esc(i.shows)}</span>
        </li>`).join('')}
      </ul>
    </div>`).join('');

  const pending = C.PENDING.map(p => `<li>
      <b>${esc(p.title)}</b>
      <span>${esc(p.blocked)}</span>
    </li>`).join('');

  return `
<style>
  .upd { max-width: 1120px; margin: 14px auto 0; padding: 18px 20px;
    background: #fff; border: 1px solid #E8EAEC; border-radius: 18px;
    font: 400 14px/1.65 Arial, 'Malgun Gothic', sans-serif; color: #0A1419; }
  .upd__h { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .upd__t { font-size: 17px; font-weight: 700; margin: 0; }
  .upd__at { font-size: 12.5px; color: #7C838C; }
  .upd__s { font-size: 13.5px; color: #7C838C; margin: 0 0 14px; }
  .upd__g { margin-top: 12px; }
  .upd__d { font: 700 12px/1 ui-monospace, Menlo, Consolas, monospace; color: #7BA10F;
    background: #F0FAD8; display: inline-block; padding: 5px 9px; border-radius: 6px; }
  .upd__l, .upd__p { list-style: none; margin: 8px 0 0; padding: 0; }
  .upd__l li, .upd__p li { padding: 9px 0 9px 13px; border-left: 2px solid #AAE106; margin-bottom: 8px; }
  .upd__p li { border-left-color: #FF9500; }
  .upd__l b, .upd__p b { display: block; font-size: 14.5px; }
  .upd__l em { font-style: normal; font-size: 12px; color: #7C838C; }
  .upd__l span, .upd__p span { display: block; margin-top: 3px; font-size: 13px; color: #4A5560; }
  .upd__see { color: #7BA10F !important; font-weight: 600; }

  /* 어떻게 바뀌었는가 — 전과 후를 나란히 둔다. 한쪽만 적으면 비교가 안 된다 */
  .upd__ba { display: grid; gap: 6px; margin-top: 8px; }
  .upd__b, .upd__a { font-size: 12.5px; line-height: 1.6; padding: 8px 11px; border-radius: 8px;
    display: grid; grid-template-columns: 26px 1fr; gap: 9px; align-items: baseline; }
  .upd__b { background: #F2F2F7; color: #7C838C; }
  .upd__a { background: #F0FAD8; color: #3F5400; }
  .upd__b em, .upd__a em { font-style: normal; font-weight: 800; font-size: 11.5px;
    text-align: center; padding: 2px 0; border-radius: 5px; }
  .upd__b em { background: #E3E5E8; color: #5C636B; }
  .upd__a em { background: #AAE106; color: #0A1419; }
  @media (min-width: 720px) { .upd__ba { grid-template-columns: 1fr 1fr; } }

  /* 화면이 없는 작업의 확인 */
  .ev { max-width: 1120px; margin: 14px auto 0; padding: 18px 20px;
    background: #fff; border: 1px solid #E8EAEC; border-radius: 18px;
    font: 400 14px/1.65 Arial, 'Malgun Gothic', sans-serif; color: #0A1419; }
  .ev__t { font-size: 17px; font-weight: 700; margin: 0; }
  .ev__s { font-size: 13.5px; color: #7C838C; margin: 4px 0 14px; }
  .ev__c { border: 1px solid #E8EAEC; border-radius: 12px; padding: 13px 15px; margin-top: 10px; }
  .ev__c.bad { border-color: #F0DEBE; background: #FDF3E3; }
  .ev__n { font-size: 13.5px; font-weight: 700; }
  .ev__m { font-size: 12.5px; color: #7C838C; margin-top: 2px; }
  .ev__o { margin: 9px 0 0; padding: 10px 12px; background: #F2F2F7; border-radius: 8px;
    font: 400 12.5px/1.7 ui-monospace, Menlo, Consolas, monospace;
    white-space: pre-wrap; word-break: break-all; overflow-x: auto; }
  .ev__k { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .ev__k span { font: 600 11.5px/1 ui-monospace, Menlo, Consolas, monospace;
    padding: 5px 8px; border-radius: 6px; background: #F0FAD8; color: #7BA10F; }
  .upd__pt { margin: 20px 0 0; font-size: 14px; font-weight: 700; }
  .upd__pd { margin: 3px 0 0; font-size: 12.5px; color: #7C838C; }
</style>
<section class="upd">
  <div class="upd__h">
    <h2 class="upd__t">이번에 바뀐 것</h2>
    <span class="upd__at">최근 반영 ${esc(C.latestAt())} (KST)</span>
  </div>
  <p class="upd__s">아래 화면에 이미 반영되어 있습니다. <b>무엇이 · 왜 · 어떻게</b> 바뀌었는지
    함께 적습니다 — 전과 후를 나란히 두어야 무엇이 달라졌는지 눈으로 비교됩니다.</p>
  ${groups}

  <p class="upd__pt">아직 안 된 것</p>
  <p class="upd__pd">위 목록과 섞지 않습니다 — 섞으면 이미 된 것으로 읽힙니다.</p>
  <ul class="upd__p">${pending}</ul>
</section>`;
}

async function main() {
  if (process.argv.includes('--section')) {
    const outS = arg('--out', path.join(HERE, 'section-preview.html'));
    const htmlS = await buildSection();
    fs.writeFileSync(outS, htmlS);
    console.log(`${outS} (${Math.round(htmlS.length / 1024)}KB) · 보고서 생성 섹션 (단계 ${SCREENS.length}개)`);
    return;
  }
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

module.exports = {
  build, buildSection, buildSectionDocs, flowShell, SCREENS, EXTRAS,
  // 「미리 그려 넣는 판」이 같은 패널을 쓴다 — 두 벌로 만들지 않는다
  changePanel, evidencePanel, vaultPanel, linkedPanel, deskPanel,
};
