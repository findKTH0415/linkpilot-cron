'use strict';
/**
 * handoff-link.test.js — **눌러도 아무 일이 없는 단추를 두지 않는다**
 * 〈2026-08-29 · D-165 · 사장님 신고: 「클릭이 안됨 · 다음단계의 진행이 불가」〉.
 *
 * 자료 업로드 화면의 「‘보고서 만들기’으로 가기」 단추는 `openSection()` 으로
 * **앱에 신호만 보냈다.** 앱이 그 신호를 안 들으면 **아무 일도 안 일어났고**,
 * 화면은 아래에 「위 탭에서 눌러 주십시오」라고 적을 뿐이었다.
 *
 * ★★★ 이 저장소는 「눌러도 아무 일이 없는 단추가 가장 나쁘다 — 고장으로
 *   읽힌다」를 못박아 두었는데, 정작 여기가 그것이었다. 사용자는 거기서 멈춘다.
 *
 * ★ 고침은 둘이다:
 *   ① 그 자리를 **진짜 링크**로 만들고, 앱이 받았을 때만 이동을 취소한다
 *      → 어느 경우에도 도달한다
 *   ② 도착 화면이 **자기 주소의 `?project=`·`?step=`** 을 읽는다
 *      → 안 읽으면 도착해도 단계가 전부 잠긴 채로 열린다
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const F = require('../ui/platform/flow-core.js');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');
/** 주석을 떼고 본다 — 이 파일들의 주석에 같은 낱말이 잔뜩 있다 (CLAUDE.md §8) */
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const FILES = bare(read('files.html'));
const FLOW = bare(read('report-flow.html'));

// ══ 주소를 만드는 자리 ══════════════════════════════════════════

test('절 화면 주소를 만드는 자리가 있다', () => {
  assert.strictEqual(typeof F.sectionUrl, 'function', 'sectionUrl 이 없다');
  assert.strictEqual(F.sectionUrl({ projectId: 'LP-1', step: 'fields' }),
    'report-flow.html?project=LP-1&step=fields');
});

/**
 * ★★ **상대 경로여야 한다.** 화면들은 한 폴더에 함께 있고 각 화면이 `<base>` 를
 *   세우므로, 어디에 얹혀 있든 같은 폴더로 닿는다 (M-56). 절대 경로를 적으면
 *   앱이 옮겨 갈 때마다 또 틀린다.
 */
test('★★ 주소는 상대 경로다 (앞부분을 박지 않는다)', () => {
  const u = F.sectionUrl({ projectId: 'LP-1' });
  assert.ok(!u.startsWith('/'), '앞에 슬래시를 박았다 — 앱이 옮기면 틀린다');
  assert.ok(!/^https?:/.test(u), '전체 주소를 박았다');
});

test('프로젝트가 없으면 물음표 뒤를 안 붙인다', () => {
  assert.strictEqual(F.sectionUrl({}), 'report-flow.html');
});

// ══ 단추 ═══════════════════════════════════════════════════════

test('★★★ 「으로 가기」는 단추가 아니라 **진짜 링크**다', () => {
  assert.match(FILES, /var go = el\('a', 'btn'/,
    '아직 button 이다 — 앱이 안 받으면 아무 일도 안 일어난다');
  assert.match(FILES, /go\.href = url;/, '주소를 안 달았다');
  assert.match(FILES, /go\.setAttribute\('target', '_top'\)/,
    '앱 안의 틀에서 열면 틀 안에 또 화면이 생긴다 (D-164 와 같은 모습)');
});

/**
 * ★ 앱이 받았을 때**만** 이동을 취소한다. 반대로 하면 앱이 멀쩡한데도 주소로
 *   가 버려 탭 밖으로 튕긴다.
 */
test('★★★ 앱이 받았을 때만 이동을 취소한다', () => {
  assert.match(FILES, /if \(r\.sent\) \{ if \(e\.preventDefault\) e\.preventDefault\(\); render\(\); return; \}/,
    '받았는지와 무관하게 움직인다');
  assert.ok(!/^\s*e\.preventDefault\(\);\s*$/m.test(FILES),
    '무조건 이동을 막는 줄이 있다 — 그러면 다시 막다른 단추가 된다');
});

test('막다른 문장으로 끝내지 않는다 (스캔 칸에도 링크를 둔다)', () => {
  assert.match(FILES, /F\.sectionUrl && F\.sectionUrl\(\{ projectId: state\.projectId, step: 'fields' \}\)/,
    '스캔 칸이 주소를 안 만든다');
  assert.match(read('files.html'), /화면 열기/, '갈 수 있는 링크 글자가 없다');
});

// ══ 도착 ═══════════════════════════════════════════════════════

/**
 * ★★★ 안 읽으면 **도착해도 단계가 전부 잠긴다** — 보내는 쪽은 「보냈다」이고
 *   받는 쪽은 「아무것도 못 받았다」가 된다.
 */
test('★★★ 도착 화면이 자기 주소의 project·step 을 읽는다', () => {
  assert.match(FLOW, /function fromUrl\(k\)/, '주소를 읽는 자리가 없다');
  assert.match(FLOW, /projectId: C\.projectId \|\| fromUrl\('project'\) \|\| null/,
    '주소의 프로젝트를 안 받는다 — 도착해도 잠긴 화면이 뜬다');
  assert.match(FLOW, /current: fromUrl\('step'\)/, '어느 칸을 열지 안 받는다');
});

/**
 * ★ 앱이 넘긴 값이 **먼저**다. 앱 안에서는 앱이 아는 것이 더 정확하고,
 *   주소는 단독으로 열렸을 때의 길이다.
 */
test('★ 앱이 넘긴 값이 주소보다 먼저다', () => {
  const i = FLOW.indexOf("C.projectId || fromUrl('project')");
  assert.ok(i > 0, '순서를 확인할 자리를 못 찾았다 — 검사가 헛돈다');
  assert.ok(!FLOW.includes("fromUrl('project') || C.projectId"),
    '주소가 앱 설정을 덮는다 — 앱 안에서 엉뚱한 프로젝트가 열린다');
});

test('주소를 못 읽어도 죽지 않는다', () => {
  assert.match(FLOW, /catch \(_\) \{ return null; \}/,
    '주소 읽기가 실패하면 화면이 통째로 죽는다');
});
