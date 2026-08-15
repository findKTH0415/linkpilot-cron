'use strict';
/**
 * build-worklog.js — 작업지시판 미리보기 HTML 을 만든다.
 *
 *   node im-agent/ui/platform/build-worklog.js [--out <경로>]
 *
 * 왜 별도 빌더인가:
 *   `board.html` 은 **제품 화면**이다 (고객이 자기 업무를 관리하는 보드).
 *   여기서 만드는 것은 **이 저장소의 작업지시판**이다 — 데이터가 다르다.
 *   화면 로직을 복사하면 둘이 갈리므로, board.html 을 그대로 읽어
 *   데이터 블록만 바꿔 끼운다. 렌더·정렬·마감 판정은 한 벌만 존재한다.
 *
 * 결과물은 파일 하나로 열린다 — 서버·빌드 도구·의존성 없음.
 *
 * ★ 닫는 스크립트 태그를 이스케이프한다. 빼먹으면 HTML 파서가 그 지점에서
 *   스크립트를 끝내고 화면이 통째로 빈다 — 오류도 안 뜬다.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DOCS = path.join(HERE, '..', '..', '..', 'docs');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inlineSafe = (js) => js.replace(/<\/(script)/gi, '<\\/$1');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

function build() {
  const data = JSON.parse(read(DOCS, '작업지시.json'));
  let html = read(HERE, 'board.html');

  // 외부 스크립트를 인라인한다 (파일 하나로 열려야 한다)
  ['gate-core.js', 'catalog.js', 'inapp.js', 'board-core.js'].forEach((f) => {
    const tag = `<script src="${f}"></script>`;
    if (!html.includes(tag)) throw new Error(`board.html 에 ${tag} 가 없다 — 구조가 바뀌었다`);
    html = html.replace(tag, '<script>' + inlineSafe(read(HERE, f)) + '</script>');
  });

  // 데이터 블록을 통째로 바꿔 끼운다.
  // 시작·끝 표식이 없으면 조용히 데모 데이터가 남으므로 반드시 확인한다
  const start = html.indexOf('window.LINKPILOT_BOARD = {');
  const end = html.indexOf('\n};', start);
  if (start === -1 || end === -1) {
    throw new Error('board.html 에서 LINKPILOT_BOARD 블록을 찾지 못했다 — 구조가 바뀌었다');
  }

  const cfg = {
    session: { authenticated: true, planId: 'pro', status: 'active', name: 'PDI GID' },
    requiredPlan: 'pro',
    planNames: { free: 'Free', basic: 'Basic', pro: 'Pro', business: 'Business' },
    api: null,                      // 미리보기다 — 옮긴 카드는 저장되지 않는다
    tasks: data.tasks,
    people: data.people,
    projects: data.projects,
  };

  // ★ 세미콜론을 빼먹지 않는다. 바로 뒤가 `(function(){...}())` 이라
  //   세미콜론이 없으면 객체 리터럴을 함수처럼 호출하는 꼴이 되어
  //   화면이 통째로 비고 DOM 만 봐서는 원인이 안 보인다
  html = html.slice(0, start)
    + 'window.LINKPILOT_BOARD = ' + JSON.stringify(cfg, null, 2) + ';'
    + html.slice(end + 3);

  // 제목·머리말을 작업지시판으로 바꾼다
  // 치환이 조용히 실패하면 '업무지시 보드'라는 제품 화면 제목이 그대로 남아
  // 미리보기를 실제 보드로 오해한다. 확인하고 넘어간다
  const H1 = /(<h1 class="head__t">)[^<]*(<\/h1>)/;
  if (!H1.test(html)) throw new Error('board.html 의 제목 요소를 찾지 못했다 — 구조가 바뀌었다');
  html = html
    .replace(/<title>[^<]*<\/title>/, '<title>LinkPilot 작업지시판</title>')
    .replace(H1, '$1작업지시판$2');

  // 미리보기임을 화면에 박아 둔다. 실제 보드로 오해하면 여기서 카드를 옮긴다
  const banner = '<div style="background:#FDF3E3;color:#8A5A10;padding:11px 26px;'
    + 'font:600 13px/1.5 -apple-system,BlinkMacSystemFont,\'Malgun Gothic\',sans-serif;'
    + 'border-bottom:1px solid #F0E2C4">'
    + `미리보기 — 이 저장소의 작업 현황 (기준일 ${data.updatedAt}). `
    + '카드를 옮겨도 저장되지 않습니다. 출처: docs/작업지시.json'
    + '</div>';
  html = html.replace('<div class="rule"></div>', '<div class="rule"></div>' + banner);

  return html;
}

/**
 * 게시용 조각 — `<!doctype>` · `<html>` · `<head>` · `<body>` 를 벗긴다.
 * 호스팅 쪽이 그 뼈대를 씌우므로 여기서 또 넣으면 문서가 중첩된다.
 * 스타일·스크립트는 그대로 두어 파일 하나로 완결되는 성질을 유지한다.
 */
function buildFragment() {
  const full = build();
  const head = full.indexOf('<title>');
  const bodyOpen = full.indexOf('<body>');
  const bodyClose = full.lastIndexOf('</body>');
  if (head === -1 || bodyOpen === -1 || bodyClose === -1) {
    throw new Error('문서 뼈대를 찾지 못했다 — board.html 구조가 바뀌었다');
  }
  const title = full.slice(head, full.indexOf('</title>') + 8);
  const style = full.slice(full.indexOf('<style>'), full.indexOf('</style>') + 8);
  const body = full.slice(bodyOpen + 6, bodyClose);
  return `${title}\n${style}\n${body}`;
}

// ★ require 만으로 파일을 쓰지 않는다. 테스트가 build() 를 부르는데,
//   여기서 바로 써 버리면 테스트를 돌릴 때마다 저장소 파일이 조용히 바뀐다
if (require.main === module) {
  const fragment = process.argv.includes('--fragment');
  const out = arg('--out', path.join(HERE, 'worklog.html'));
  const html = fragment ? buildFragment() : build();
  fs.writeFileSync(out, html);

  const counts = JSON.parse(read(DOCS, '작업지시.json')).tasks
    .reduce((a, t) => { a[t.status] = (a[t.status] || 0) + 1; return a; }, {});
  console.log(`${out} (${Math.round(html.length / 1024)}KB)`);
  console.log('할 일 %d · 진행 %d · 검토 %d · 완료 %d',
    counts.todo || 0, counts.doing || 0, counts.review || 0, counts.done || 0);
}

module.exports = { build, buildFragment };
