'use strict';
/**
 * build-files.js — 「자료 업로드」탭을 **미리 그려** 한 장으로 낸다 (2026-08-20).
 *
 *   npm run im:files
 *
 * ★★ 왜 따로 있나: 보고서 생성 미리보기(`im:section`)는 **4단계만** 담는다 —
 *   흐름 밖 화면을 그 순서에 끼우면 4단계가 5단계처럼 보이기 때문이다. 그래서
 *   자료 업로드 탭은 어느 미리보기에도 안 들어가고, **바뀌어도 볼 방법이 없었다.**
 *
 * ★ 스크립트를 미리 돌려 **결과 DOM 만** 남긴다. 아티팩트로 올리면 옆 창에서
 *   확실히 열리지만 **눌리지는 않는다** — 직접 만져 봐야 하면 파일을 함께 준다.
 *
 * ★ 데이터는 **예시다.** 그렇다고 화면에 박아 둔다 — 데모를 실제로 오해하면
 *   그것을 근거로 판단한다.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const HERE = __dirname;
const { findBrowser, publishable, renderDom } = require('./build-static.js');
const { inlineScreen } = require('./build-static.js');

/** 예시 자료 — 실제 딜 자료는 이 저장소에 두지 않는다 (public) */
const DEMO = {
  projects: [{ id: 'LP-DC-2026-001', name: '인천 남동 데이터센터' }],
};

const WRAP_CSS = `
:root { --pg: #F2F2F7; --sf: #FFFFFF; --ln: #E8EAEC; --ink: #0A1419; --ink2: #7C838C; }
:root:not([data-theme="light"]) { color-scheme: light; }
body { margin: 0; background: var(--pg); color: var(--ink);
  font: 400 15px/1.6 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
    'Malgun Gothic', Arial, sans-serif; }
.lead { max-width: 1120px; margin: 0 auto; padding: 22px 20px 0; }
.lead__t { font-size: 21px; font-weight: 800; margin: 0; }
.lead__d { font-size: 13.5px; color: var(--ink2); margin: 7px 0 0; line-height: 1.7; }
.demo { max-width: 1120px; margin: 12px auto 0; padding: 12px 16px; border-radius: 12px;
  background: #FFF4E5; color: #8A5A10; font-size: 13px; line-height: 1.7; }
.pv { max-width: 1120px; margin: 14px auto 24px; background: var(--sf);
  border: 1px solid var(--ln); border-radius: 18px; overflow: hidden; padding: 4px 0; }
`;

/**
 * 설정을 심은 사본을 만든다 — **원본을 고치지 않는다.**
 *
 * ★ 설정 블록 자체를 고쳐 쓰지 않는다. 괄호 하나만 어긋나도 스크립트가 통째로
 *   죽고, 그때 **화면은 빈 채로 뜨는데 오류는 안 보인다.** 실제로 그렇게 한 번
 *   빈 판이 나왔다. 그러니 **뒤에 덧붙여 병합**한다 — 대입이 아니라 병합이다.
 */
function withConfig(html, cfg) {
  const inject = `<script>Object.assign(window.LINKPILOT_FILES, ${JSON.stringify(cfg)});</script>\n`;
  const at = html.indexOf('<script src="embed-bridge.js"');
  if (at < 0) throw new Error('브리지 태그를 못 찾았다 — 설정을 넣을 자리가 없다');
  return html.slice(0, at) + inject + html.slice(at);
}

async function build(outFile) {
  const browser = findBrowser();
  if (!browser) throw new Error('헤드리스 크로미움이 없어 미리 그릴 수 없다');

  const src = fs.readFileSync(path.join(HERE, 'files.html'), 'utf8');
  const cfg = {
    api: null,                    // 서버를 부르지 않는다 — 예시만 보여 준다
    session: { authenticated: true, name: '예시 사용자', planId: 'pro', status: 'active' },
    projectId: DEMO.projects[0].id,
    inTab: true,
    preload: DEMO,
    requiredPlan: 'free',
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-files-'));
  const f = path.join(tmp, 'files.html');
  // 화면이 참조하는 형제 파일들을 같은 곳에 둔다 (`<script src>` 로 부른다)
  ['gate-core.js', 'flow-core.js', 'upload-core.js', 'embed-bridge.js', 'tokens.css', 'catalog.js', 'inapp.js']
    .filter(n => fs.existsSync(path.join(HERE, n)))
    .forEach(n => fs.copyFileSync(path.join(HERE, n), path.join(tmp, n)));
  fs.writeFileSync(f, withConfig(src, cfg));

  const part = inlineScreen(renderDom(browser, f), 'scr-files');

  const frag = `<title>자료 업로드 탭</title>
<style>
${WRAP_CSS}
${part.css}
</style>
<div class="lead">
  <h1 class="lead__t">자료 업로드 — 붙이는 자리</h1>
  <p class="lead__d">세 갈래를 고르면 그 자리에서 파일을 고르고 올립니다.
    전에는 셋이 <b>설명만</b>이어서, 자료를 넣으려면 보고서 생성 1단계로 되돌아가야 했습니다.</p>
</div>
<div class="demo"><b>예시 화면입니다.</b> 프로젝트와 목록은 실제 자료가 아니고,
  이 판은 <b>미리 그려 넣은 것</b>이라 눌리지 않습니다 — 직접 만져 보려면 함께 보낸
  <code>files.html</code> 을 브라우저로 여십시오.</div>
<div class="pv">${part.html}</div>
`;

  const bad = publishable(frag);
  if (bad && bad.length) throw new Error('아티팩트로 올릴 수 없다:\n  ' + bad.join('\n  '));

  fs.writeFileSync(outFile, frag);
  return { file: outFile, bytes: frag.length };
}

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const out = i > -1 && process.argv[i + 1]
    ? path.resolve(process.argv[i + 1])
    : path.join(HERE, 'files-artifact.html');
  build(out).then((r) => {
    console.log(`${r.file} (${Math.round(r.bytes / 1024)}KB) · 자료 업로드 탭`);
  }).catch((e) => { console.error(e.message); process.exit(2); });
}

module.exports = { build, DEMO };
