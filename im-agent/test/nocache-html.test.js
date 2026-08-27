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

/** 그 단계 한 칸만 떼어 본다 — 다음 단계(`- name:`)가 나오면 거기까지다 */
const STEP = (function () {
  const i = WF.indexOf('- name: Do not cache HTML');
  if (i < 0) return '';
  const j = WF.indexOf('\n      - name:', i + 10);
  return WF.slice(i, j < 0 ? WF.length : j);
}());

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
  const step = STEP;
  assert.ok(step.length > 200, '그 단계를 못 찾았다');
  assert.match(step, /cache-control:/i, '실제 응답 머리말을 재는 자리가 없다');
  assert.match(step, /no-cache\|no-store\|max-age=0/, '켜졌는지 가르는 자리가 없다');
  assert.match(step, /아직 안 켜졌다/, '안 켜진 것을 적는 자리가 없다 — 그러면 초록과 구분이 안 된다');
  assert.match(step, /안내-NAS-HTML-캐시-끄기\.md/, '켜는 자리를 안 가리킨다');
});

test('★★★ **재는 단계가 배포를 세우지 않는다** — 한 번 실제로 세웠다 (run #143)', () => {
  const step = STEP;
  /* ★ 이 워크플로는 `bash -e` 로 돈다. `set +e` 가 없으면 「못 받음」 한 줄이
   *   단계를 죽이고, 그러면 **뒤의 확인이 통째로 건너뛰어진다.** */
  assert.match(step, /set \+e/, 'set +e 가 없다 — bash -e 라 「못 받음」에 단계가 죽는다');
  assert.match(step, /\n\s*exit 0\s*\n/, '마지막에 exit 0 이 없다 — 재는 단계는 문턱이 아니다');
  assert.ok(!/exit 1/.test(step), '못 켜진 것으로 배포를 빨갛게 세운다');
  assert.match(step, /::warning::/, '경고조차 안 남기면 아무도 모른다');
});

test('★★★ **확인이 끝난 뒤에 온다** — 앞에 두면 이것이 죽을 때 확인이 건너뛰어진다', () => {
  const iVerify = WF.indexOf('name: Verify deployed');
  const iApp = WF.indexOf('name: Check via app path');
  const iMe = WF.indexOf('name: Do not cache HTML');
  assert.ok(iVerify > 0 && iApp > 0 && iMe > 0, '세 단계를 다 못 찾았다');
  assert.ok(iMe > iVerify, '「Verify deployed」 앞에 있다 — 죽으면 확인이 건너뛰어진다');
  assert.ok(iMe > iApp, '「Check via app path」 앞에 있다 — 같은 이유다');
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

/* ═══ 넣으신 값이 주소가 아닐 때 〈2026-08-27 · 실제로 그랬다〉 ═══════════
 *
 * 안내에 「앱이 보고서 화면을 불러오는 주소 (…/im-flow)」라고 적었더니 사장님이
 * **그 문장을 그대로** Secret 칸에 붙여 넣으셨다. CLAUDE.md §5 가 「바꿔 넣을
 * 자리를 두지 않는다」고 적어 둔 바로 그 사고이고, 이 저장소에서 네 번째다.
 */
const APP_STEP = (function () {
  const i = WF.indexOf('- name: Check via app path');
  if (i < 0) return '';
  const j = WF.indexOf('\n      - name:', i + 10);
  return WF.slice(i, j < 0 ? WF.length : j);
}());

test('★★★ 주소가 아닌 값이 오면 **사람 말로 알린다** — 17개가 빨개지는 것으로 알려 주지 않는다', () => {
  assert.ok(APP_STEP.length > 200, '그 단계를 못 찾았다');
  assert.match(APP_STEP, /http:\/\/\*\|https:\/\/\*/, '주소 꼴인지 보는 자리가 없다');
  assert.match(APP_STEP, /주소가 아니다/, '무엇이 잘못됐는지 사람 말로 안 적는다');
  assert.match(APP_STEP, /한글이 섞여/, '안내 문구가 그대로 들어온 것을 안 잡는다');
  assert.match(APP_STEP, /안내-LP-PUBLIC-BASE-등록\.md/, '어디를 보면 되는지 안 가리킨다');
});

test('★★★ **값을 한 글자도 안 찍는다** (§2) — 길이와 무엇이 이상한지만 적는다', () => {
  const say = APP_STEP.split('\n').filter((l) => /::warning::|GITHUB_STEP_SUMMARY/.test(l)).join('\n');
  assert.ok(!/\$BASE"?\s*$/.test(say) && !/\$\{BASE\}/.test(say),
    '경고 문구에 값을 그대로 넣는다 — 열쇠·주소가 로그에 남는다');
  assert.match(APP_STEP, /\$\{#BASE\}/, '길이조차 안 적는다 — 무엇이 들어갔는지 가늠할 수 없다');
});

test('★★★ 이 단계도 **`set +e`** 다 — 파이프라인 하나가 죽으면 뒤가 통째로 건너뛴다 (M-60)', () => {
  assert.match(APP_STEP, /set \+e/, 'bash -e 라 curl 한 번 실패에 단계가 죽는다');
});

test('★★★ 「앱이 쓰는 길」 확인도 **배포를 세우지 않는다** — 세워도 못 고치는 것이다 (M-60)', () => {
  /* 배포 #148·#149 가 여기서 죽어 **열쇠 파일·엔진 배포가 통째로 건너뛰어졌다.**
     올리기와 「닿았는가」는 이미 초록이었는데도 배포 전체가 빨갛게 끝났다.
     여기서 다른 것은 앱 사본(사람이 올린다)이거나 앱 설정이라 이 배포가 못 고친다. */
  assert.match(APP_STEP, /\n\s*exit 0\s*\n/, '마지막이 exit 0 이 아니다 — 재는 단계가 문턱이 되었다');
  assert.ok(!/exit "\$BAD"/.test(APP_STEP), '다른 개수로 배포를 세운다');
  assert.ok(!/::error::/.test(APP_STEP), '경고가 아니라 오류로 적는다 — 배포가 빨개진다');
  assert.match(APP_STEP, /이 배포로는 못 고친다/, '왜 안 세우는지를 안 적었다');
});
