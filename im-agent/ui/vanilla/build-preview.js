'use strict';
/**
 * build-preview.js — 단일 HTML 미리보기 생성기.
 *
 * CSS·JS·실제 스냅샷을 한 파일에 넣어 preview.html 을 만든다.
 * API 서버 없이 브라우저로 열기만 하면 대시보드가 보인다.
 *
 *   node im-agent/ui/vanilla/build-preview.js [PROJECT_ID]
 *
 * ★ 인라인 삽입 시 닫는 스크립트 태그를 반드시 이스케이프한다.
 *   HTML 파서는 문자열 안이든 주석 안이든 상관없이 그 지점에서 스크립트를 끝낸다 —
 *   이스케이프를 빼먹으면 화면이 통째로 비고, 원인이 눈에 보이지 않는다.
 */
const fs = require('fs');
const path = require('path');

const UI = path.join(__dirname, '..');
const ROOT = process.env.IM_AGENT_ROOT || path.join(process.cwd(), 'im-projects');
const projectId = process.argv[2] || 'LP-DC-2026-001';

/** HTML 안에 JS 를 인라인할 때 스크립트가 조기 종료되지 않게 한다 */
function inlineSafe(js) {
  return js.replace(/<\/(script)/gi, '<\\/$1');
}

const snapshotPath = path.join(ROOT, projectId, '01_Project', 'control-tower.json');
if (!fs.existsSync(snapshotPath)) {
  console.error(`스냅샷이 없다: ${snapshotPath}`);
  console.error('먼저 `npm run im:demo` 로 데모 프로젝트를 만든다.');
  process.exit(1);
}

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const css = fs.readFileSync(path.join(UI, 'controlTower.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'control-tower.js'), 'utf8');

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LinkPilot Control Tower — ${projectId}</title>
<style>
${css}
</style>
</head>
<body>
<div id="ct"></div>
<script>
${inlineSafe(js)}
</script>
<script>
// 실제 실행 결과에서 나온 control-tower.json 스냅샷이다.
// snapshot 을 직접 주면 폴링하지 않는다 — API 없이 화면만 확인하는 용도.
var SNAPSHOT = ${inlineSafe(JSON.stringify(snapshot))};
LinkPilotControlTower.mount(document.getElementById('ct'), { snapshot: SNAPSHOT });
</script>
</body>
</html>
`;

const out = path.join(__dirname, 'preview.html');
fs.writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024).toFixed(0)}KB) — ${projectId}`);
console.log(`전체 ${snapshot.overall}% / 제작 ${snapshot.tracks?.production?.pct}%`);
