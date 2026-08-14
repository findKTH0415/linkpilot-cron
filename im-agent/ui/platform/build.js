'use strict';
/**
 * build.js — LinkPilot 플랫폼 단일 HTML 을 만든다.
 *
 *   node im-agent/ui/platform/build.js [--out <경로>] [--nas <주소>] [--api <주소>]
 *
 * 결과물 하나만 웹서버에 올리면 동작한다. 빌드 도구·번들러·의존성 없음.
 *
 * ★ 기존 파일을 덮어쓰지 않도록 기본 출력은 저장소 안이다.
 *   NAS 배포는 사람이 직접 한다 — 백업 없이 덮어쓰면 되돌릴 수 없다.
 *
 * ★ 닫는 스크립트 태그를 이스케이프한다. 빼먹으면 HTML 파서가 그 지점에서
 *   스크립트를 끝내고 화면이 통째로 빈다 — 오류도 안 뜬다.
 */
const fs = require('fs');
const path = require('path');

const UI = path.join(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function inlineSafe(js) {
  return js.replace(/<\/(script)/gi, '<\\/$1');
}

const out = arg('--out', path.join(__dirname, 'linkpilot-platform.html'));
const nas = arg('--nas', '');
const api = arg('--api', '/api/linkpilot');

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const towerCss = read(UI, 'controlTower.css');
const appCss = read(__dirname, 'app.css');
const towerJs = read(UI, 'vanilla', 'control-tower.js');
const appJs = read(__dirname, 'app.js');
// ★ 「외부 업무지침」 §1 — 협력사가 실제로 여는 파일이 이것이다.
//   카카오톡에서 열면 다운로드가 조용히 실패하므로 여기에 배너가 반드시 있어야 한다
const inappJs = read(__dirname, 'inapp.js');

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LinkPilot</title>
<style>
${towerCss}
${appCss}
</style>
</head>
<body>
<div id="lp-root"></div>

<script>
/* ── 설정 ────────────────────────────────────────────────────────────
 * 이 블록만 고치면 된다. 나머지는 건드릴 필요 없다.
 *
 *   nas         NAS 주소 (sync.php 가 있는 곳). 비우면 인맥·프로젝트·일정이 안 나온다
 *   api         IM Agent API. 본체 서버(8181)에 /api/linkpilot 라우터를 붙인 주소
 *   me          로그인한 사람 정보 — 서버가 내려주는 것이 정석이다
 *   membership  멤버십 상태. 없으면 화면에 '연동 전'으로 표시된다 (Free 로 단정하지 않는다)
 *   plans       요금제. 가격을 넣지 않으면 '문의'로 표시된다 — 지어내지 않는다
 *   billingUrl  결제 페이지. 카드정보는 이 화면에서 받지 않고 여기로 보낸다
 * ─────────────────────────────────────────────────────────────────── */
window.LINKPILOT_CONFIG = {
  nas: ${JSON.stringify(nas)},
  api: ${JSON.stringify(api)},

  me: null,
  // me: { name: '홍길동', email: 'user@example.com', org: 'PDI GID', role: 'CEO' },

  membership: null,
  // membership: {
  //   planId: 'pro', status: 'active', until: '2027-02-10',
  //   usage: { '프로젝트': { used: 4, limit: 20 }, 'IM 생성': { used: 12, limit: null } },
  // },

  plans: null,        // 기본 3종(Free/Pro/Enterprise)을 쓰려면 null 로 둔다
  billingUrl: null,   // 예: 'https://pay.example.com/checkout'
};
</script>
<script>
${inlineSafe(towerJs)}
</script>
<script>
${inlineSafe(appJs)}
</script>
<script>
${inlineSafe(inappJs)}
</script>
<script>
LinkPilotApp.mount(document.getElementById('lp-root'));
/* 지침 §1 — 메신저 인앱 브라우저면 [외부 브라우저로 열기] 배너를 띄운다.
   인앱이 아니면 아무것도 하지 않는다 (오탐이 미탐보다 나쁘다) */
LinkPilotInApp.auto();
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024).toFixed(0)}KB)`);
console.log(`NAS: ${nas || '(미설정)'}   API: ${api}`);
