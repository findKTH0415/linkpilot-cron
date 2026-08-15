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

/** 화면 하나를 자체 완결 문서로 만든다 (외부 script 인라인 + 미리보기 값 주입) */
function selfContained(file, inject) {
  let html = read(file);
  const tags = html.match(/<script src="([^"]+)"><\/script>/g) || [];
  tags.forEach((tag) => {
    const src = tag.match(/src="([^"]+)"/)[1];
    html = html.replace(tag, '<script>' + read(src).replace(/<\/(script)/gi, '<\\/$1') + '</script>');
  });
  if (inject) {
    // 설정 블록이 만들어진 **직후**에 끼워 넣는다. 앞에 넣으면 덮어써진다
    const anchor = '</script>';
    const at = html.indexOf(anchor, html.indexOf(inject.global));
    if (at === -1) throw new Error(`${file}: 설정 블록을 찾지 못했다`);
    const code = `\n<script>Object.assign(window.${inject.global}, ${JSON.stringify(inject.value)});</script>`;
    html = html.slice(0, at + anchor.length) + code + html.slice(at + anchor.length);
  }
  return html;
}

const SCREENS = [
  { file: 'intake.html', name: '1 · 보고서 생성 입력',
    note: '요청문과 원본 자료를 받는다. 지원 형식을 올리기 전에 알려주고, 요청문에서 뽑은 값은 미확인으로 표시한다.' },
  { file: 'fields.html', name: '2 · 가이드 필드 입력',
    note: '수치를 출처와 함께 넣는다. 출처가 없으면 저장 버튼이 열리지 않고, 계산 항목은 입력란을 만들지 않는다.' },
  { file: 'reports.html', name: '3~4 · 사양 확정 · 생성',
    note: '출력 사양을 확정(LOCK)해야 생성 버튼이 열린다. 확정 전 생성은 서버도 409 로 막는다.' },
  { file: 'worklog.html', name: '작업지시판',
    note: '이 저장소의 작업 현황. docs/작업지시.json 이 데이터다.' },
];

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

  const frames = SCREENS.map((s, i) => {
    const doc = selfContained(s.file, INJECT[s.file])
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<section class="scr" id="s${i}">
  <header class="scr__h">
    <h2 class="scr__n">${s.name}</h2>
    <p class="scr__d">${s.note}</p>
    <code class="scr__f">im-agent/ui/platform/${s.file}</code>
  </header>
  <iframe class="scr__i" title="${s.name}" srcdoc="${doc}" loading="lazy"></iframe>
</section>`;
  }).join('\n');

  const nav = SCREENS.map((s, i) => `<a href="#s${i}">${s.name}</a>`).join('');

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
  .nav a { font-size: 13px; font-weight: 600; text-decoration: none; padding: 8px 13px;
    border-radius: 999px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); }
  .nav a:hover { border-color: var(--lime); color: var(--lime-deep); }
  .nav a:focus-visible, .scr__i:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .scr { margin-bottom: 38px; scroll-margin-top: 18px; }
  .scr__h { margin-bottom: 12px; }
  .scr__n { font-size: 17px; font-weight: 800; margin: 0 0 5px; }
  .scr__d { font-size: 13.5px; color: var(--ink2); margin: 0 0 7px; max-width: 72ch; }
  .scr__f { font: 600 12px/1 ui-monospace, Menlo, Consolas, monospace; color: var(--ink2);
    background: var(--surface); border: 1px solid var(--line); padding: 5px 9px; border-radius: 6px; }
  .scr__i { width: 100%; height: 760px; border: 1px solid var(--line);
    border-radius: 14px; background: #fff; display: block; }
  @media (max-width: 700px) { .scr__i { height: 560px; } }
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
</div>`;
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
  console.log(`${out} (${Math.round(html.length / 1024)}KB) · 화면 ${SCREENS.length}개`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { build, SCREENS };
