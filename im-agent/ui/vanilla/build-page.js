'use strict';
/**
 * build-page.js — NAS 에 그대로 올리는 단일 HTML 페이지를 만든다.
 *
 *   node im-agent/ui/vanilla/build-page.js
 *   → im-agent/ui/vanilla/linkpilot-control-tower.html
 *
 * CSS·대시보드·페이지 껍데기를 한 파일에 넣는다. 이 파일 하나만 웹 루트에 두면 끝이다.
 * 데이터는 넣지 않는다 — 본체 API(8181)에서 실시간으로 받는다.
 *
 * ★ 기존 linkpilot-platform.html 을 덮어쓰지 않는다. 별도 파일이다.
 *   원본 구조를 모르는 상태에서 덮어쓰면 되돌릴 수 없다.
 *
 * ★ 인라인 삽입 시 닫는 스크립트 태그를 이스케이프한다.
 *   빼먹으면 HTML 파서가 그 지점에서 스크립트를 끝내고 화면이 통째로 빈다 — 오류도 안 뜬다.
 */
const fs = require('fs');
const path = require('path');

const UI = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'linkpilot-control-tower.html');

/** API 주소를 인자로 받는다: --api https://nas.example.com:8181/api/linkpilot */
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function inlineSafe(js) {
  return js.replace(/<\/(script)/gi, '<\\/$1');
}

const apiBase = arg('--api', '/api/linkpilot');

const css = fs.readFileSync(path.join(UI, 'controlTower.css'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, 'control-tower.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, 'page.js'), 'utf8');

// 페이지 껍데기 스타일. 대시보드 색과 어긋나지 않게 같은 CSS 변수를 쓴다.
const pageCss = `
.lp-page { max-width: 1400px; margin: 0 auto; padding: 24px 20px 64px; }
.lp-page__bar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.lp-page__label { font: 600 12px/1.4 Arial, '맑은 고딕', sans-serif; letter-spacing: .08em;
  text-transform: uppercase; color: var(--lp-body2, #4a5a70); display: flex; align-items: center; gap: 10px; }
.lp-page__select { font: 400 14px/1.4 Arial, '맑은 고딕', sans-serif; padding: 7px 12px;
  border: 1px solid var(--lp-rule, #d7dde5); border-radius: 3px;
  background: var(--lp-surface, #fff); color: var(--lp-body, #1d2b3a); min-width: 320px; }
.lp-page__error { border: 1px solid var(--lp-bad, #c00000); border-left-width: 4px; padding: 18px 20px;
  background: var(--lp-surface, #fff); font: 400 14px/1.7 Arial, '맑은 고딕', sans-serif;
  color: var(--lp-body, #1d2b3a); }
.lp-page__error strong { display: block; margin-bottom: 8px; color: var(--lp-bad, #c00000); }
.lp-page__hint { margin: 10px 0 0; padding-left: 18px; font-size: 13px; color: var(--lp-body2, #4a5a70); }
.lp-page__hint li { margin: 3px 0; }
`;

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LinkPilot Control Tower</title>
<style>
${css}
${pageCss}
</style>
</head>
<body>
<div class="lp-page">
  <div class="lp-page__bar" id="lp-picker"></div>
  <div id="lp-dashboard"></div>
</div>

<script>
// 본체 API 주소. NAS 와 API(8181)가 같은 호스트·포트가 아니면 여기를 고친다.
//   예: window.LINKPILOT_API = 'https://nas.example.com:8181/api/linkpilot';
window.LINKPILOT_API = ${JSON.stringify(apiBase)};
</script>
<script>
${inlineSafe(dashboard)}
</script>
<script>
${inlineSafe(page)}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log(`${OUT} (${(html.length / 1024).toFixed(0)}KB)`);
console.log(`API 주소: ${apiBase}`);
console.log('웹 루트(/volume1/web)에 이 파일 하나만 올리면 된다.');
