'use strict';
/**
 * nocache-html.test.js — **화면(HTML)은 캐시하지 말라고 서버에 일러둔다** 〈2026-08-27 · D-150〉.
 *
 * 빨간 띠(화면과 형제 스크립트의 판이 다르다)의 옛 쪽은 거의 늘 **화면**이었다.
 * 형제는 주소에 판 표시가 붙어 불려 바뀌면 주소가 바뀌지만, 화면에는 그런 것이
 * 없어 브라우저가 옛것을 그대로 쓴다 (M-29 · D-149).
 *
 * ★ 이 검사가 재는 것은 셋이다:
 *     ① 배포가 놓는 설정 파일이 **HTML 에만** 걸리고 **안전하게 감싸여** 있는가
 *     ② 배포가 그것을 **올리고, 켜졌는지 실제 응답으로 재는가**
 *     ③ 배포 뒤 재기가 **화면과 형제를 다른 잣대로** 보는가
 *
 * ★ 못 재는 것도 적어 둔다: 이 자리에서는 NAS 를 못 본다. 「켜졌는가」는
 *   배포 요약이 잰다 — 여기서 초록이라고 켜진 것이 아니다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** 주석을 떼고 본다 — 이 저장소는 주석이 길어 검사가 눈이 멀기 쉽다 (CLAUDE.md §8) */
const bare = (s) => s.replace(/^\s*#.*$/gm, '');

const HT = read('deploy/im-flow.htaccess');
const WF = bare(read('.github/workflows/deploy-nas.yml'));
const VS = bare(read('deploy/verify-served.sh'));

test('★★★ 설정 파일은 **HTML 에만** 걸린다 — 형제까지 매번 받게 하면 이득이 사라진다', () => {
  const code = bare(HT);
  assert.match(code, /<FilesMatch\s+"\\\.html\$">/, 'HTML 로 좁히는 자리가 없다');
  assert.match(code, /Header set Cache-Control "no-cache, must-revalidate"/,
    '매번 확인하라는 머리말이 없다');
});

test('★★★ **mod_headers 가 없으면 아무 일도 안 일어나야 한다** — 없으면 그 폴더가 통째로 500 이 된다', () => {
  const code = bare(HT);
  assert.match(code, /<IfModule mod_headers\.c>/, 'IfModule 로 감싸지 않았다');
  const guarded = code.slice(code.indexOf('<IfModule'), code.indexOf('</IfModule>'));
  assert.ok(/Header set/.test(guarded), 'Header 줄이 감싸는 밖에 있다 — 없는 서버에서 500 이 난다');
});

test('★★★ 배포가 그 파일을 **올린다**', () => {
  assert.match(WF, /scp -O -i ~\/\.ssh\/id_deploy deploy\/im-flow\.htaccess/,
    '올리는 자리가 없다 — 파일만 저장소에 있고 NAS 에는 안 간다');
  assert.match(WF, /"\$NAS_USER@\$NAS_HOST:\$DEST\/\.htaccess"/, '낼 곳이 im-flow 폴더가 아니다');
});

test('★★★ **「올렸다」로 끝내지 않는다** — Apache 가 아니면 조용히 무시된다', () => {
  const step = WF.slice(WF.indexOf('Do not cache HTML'), WF.indexOf('Verify deployed'));
  assert.ok(step.length > 200, '그 단계를 못 찾았다');
  assert.match(step, /cache-control:/i, '실제 응답 머리말을 재는 자리가 없다');
  assert.match(step, /no-cache\|no-store\|max-age=0/, '켜졌는지 가르는 자리가 없다');
  assert.match(step, /아직 안 켜졌다/, '안 켜진 것을 적는 자리가 없다 — 그러면 초록과 구분이 안 된다');
  assert.match(step, /안내-NAS-HTML-캐시-끄기\.md/, '켜는 자리를 안 가리킨다');
});

test('★★ 못 켜졌다고 배포를 세우지 않는다 — 나머지는 사람이 눌러야 하는 자리다', () => {
  const step = WF.slice(WF.indexOf('Do not cache HTML'), WF.indexOf('Verify deployed'));
  assert.ok(!/exit 1/.test(step), '못 켜진 것으로 배포를 빨갛게 세운다');
  assert.match(step, /::warning::/, '경고조차 안 남기면 아무도 모른다');
});

test('★★★ 배포 뒤 재기는 **화면과 형제를 다른 잣대로** 본다', () => {
  assert.match(VS, /case "\$NAME" in\s*\n\s*\*\.html\)/,
    '화면을 따로 가르는 자리가 없다');
  assert.match(VS, /no-cache\|no-store\|max-age=0/, '화면이 매번 확인되는지 재는 자리가 없다');
  assert.match(VS, /화면이 캐시된다/, '캐시되고 있다는 사실을 적는 자리가 없다');
  // 형제(스크립트·CSS)는 캐시가 이득이다 — 그쪽까지 경고하면 늘 빨갛다
  assert.match(VS, /브라우저가 제 마음대로 오래 들고 있을 수 있다/,
    '형제 쪽 경고가 사라졌다');
});

test('★★ 사람이 눌러야 할 자리가 **메뉴 이름 그대로** 적혀 있다 (CLAUDE.md §5)', () => {
  const doc = read('docs/안내-NAS-HTML-캐시-끄기.md');
  ['Web Station', '웹 서비스 포털', '사용자 지정 HTTP 헤더', 'Cache-Control'].forEach((w) => {
    assert.ok(doc.includes(w), `안내에 「${w}」 가 없다 — 어디를 눌러야 하는지 모른다`);
  });
  assert.match(doc, /여기서 대개 막힙니다/, '막히기 쉬운 자리를 미리 안 짚었다');
});
