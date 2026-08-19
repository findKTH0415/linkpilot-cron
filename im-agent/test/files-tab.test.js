'use strict';
/**
 * files-tab.test.js — 세 번째 탭 「자료 업로드」 (2026-08-18).
 *
 * 여기서 지키는 것 넷:
 *   ① 탭 셋이 **한 곳**에서 나온다 (본체 탭 바가 그것을 읽는다)
 *   ② 「업로드」라는 이름 때문에 **연결이 업로드로 읽히지 않는가**
 *   ③ **501 을 오류로 그리지 않는가** — 아직 안 붙은 것은 고장이 아니다
 *   ④ 화면이 목록·한도·제공자를 **손으로 적어 두지 않는가**
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const F = require('../ui/platform/flow-core.js');
const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');

/* ═════════ ① 탭 셋이 한 곳에서 나온다 ═════════ */

test('★ 탭 셋이 flow-core 한 곳에서 나온다 (본체가 여기서 읽어 간다)', () => {
  assert.deepStrictEqual(F.TABS.map(t => t.tab),
    ['완성 보고서', '보고서 생성', '자료 업로드']);
  assert.deepStrictEqual(F.TABS.map(t => t.id), ['done', 'make', 'files']);
  F.TABS.forEach((t) => {
    assert.ok(t.file && /\.html$/.test(t.file), `${t.id}: 붙일 파일이 없다`);
    assert.ok(fs.existsSync(path.join(PLATFORM, t.file)),
      `${t.id}: ${t.file} 이 없다 — 탭 바에 이름만 뜨고 화면이 안 열린다`);
    assert.ok(['free', 'basic', 'pro', 'business'].includes(t.plan), `${t.id}: 플랜이 없다`);
  });
});

test('★ 자료 탭은 무료다 (자료를 넣는 길이 유료면 Pro 를 살지 판단할 수가 없다)', () => {
  assert.strictEqual(F.FILES_SECTION.plan, 'free');
});

test('★ 구성안이 탭 이름을 복사해 적지 않는다', () => {
  const src = read('build-tabs.js');
  F.TABS.forEach((t) => {
    assert.ok(!src.includes(`'${t.tab}'`),
      `build-tabs.js 에 '${t.tab}' 이 직접 적혀 있다 — 한쪽만 고치는 날 갈린다`);
  });
});

/* ═════════ ② 연결을 업로드로 읽지 않게 ═════════ */

/**
 * ★★ 탭 이름이 「자료 업로드」인데, 이 탭이 하는 일 셋 중 **둘은 업로드가 아니다.**
 *   연결(D-65)은 **사본을 만들지 않는 것**이 존재 이유인데, 업로드로 읽히면
 *   사용자는 우리 서버에 사본이 남는 줄 안다 — 정확히 반대다.
 */
test('★★ 화면이 세 갈래의 차이를 먼저 말한다 (연결 ≠ 업로드)', () => {
  const html = read('files.html');
  ['올려서 보관', '연결해서 쓰기', '1회성으로 올리기'].forEach((w) => {
    assert.ok(html.includes(w), `세 갈래 중 '${w}' 가 화면에 없다`);
  });
  assert.ok(html.includes('사본을 만들지 않습니다'),
    '연결이 사본을 안 만든다는 말이 없다 — 「업로드」로 읽힌다');
  assert.ok(html.includes('다시 쓸 수 없'),
    '1회성이 재사용 불가라는 말이 없다 — 올린 뒤에 알면 늦다');
});

test('★ 1회성은 올리기 **전에** 경고한다', () => {
  const html = read('files.html');
  const at = html.indexOf('올리기 전에 확인해 주세요');
  assert.ok(at > 0, '올리기 전 경고가 없다');
  // 목록보다 위에 있어야 한다 — 아래 있으면 이미 올린 뒤에 읽는다
  assert.ok(at < html.indexOf('1회성으로 올린 자료가 없습니다'),
    '경고가 목록보다 아래에 있다');
});

/* ═════════ ③ 501 은 오류가 아니라 상태다 ═════════ */

/**
 * ★★ 501 을 빨간 「서버 오류」로 그리면 **고장으로 읽혀 문의가 온다.**
 *   닫혀 있는 것은 사실이고, 그 이유는 사용자 잘못이 아니다.
 *   (2026-08-18 헤드리스로 확인: 연결·1회성을 501 로 세워도 `class="err"` 0개)
 */
test('★★ 501 을 오류로 그리지 않는다', () => {
  const html = read('files.html');
  assert.match(html, /r\.status === 501/, '501 을 따로 다루지 않는다');
  assert.ok(html.includes('아직 열려 있지 않습니다'),
    '닫힌 길을 「아직」이라고 말하지 않는다');
  // 세 갈래를 **각각** 들고 있어야 한다 — 하나가 닫혔다고 셋 다 닫힌 것처럼 그리면
  // 열려 있는 길까지 못 쓴다
  assert.match(html, /closed: \{ kept: null, linked: null, oneshot: null \}/,
    '닫힘 상태를 길별로 나눠 들고 있지 않다');
});

test('★ 탭 안에서는 제목을 그리지 않는다 (탭 바가 이미 이름을 말한다)', () => {
  const html = read('files.html');
  assert.match(html, /if \(!C\.inTab\) view\.appendChild\(el\('h1', null, '자료 업로드'\)\)/,
    'inTab 을 안 보고 제목을 그린다 — 탭 이름 아래에 같은 말이 또 나온다');
});

/* ═════════ ④ 손으로 적어 두지 않는다 ═════════ */

test('★ 제공자·한도·목록을 화면에 박아 두지 않는다', () => {
  const html = read('files.html');
  // 제공자 이름을 적어 두면 늘어나는 날 화면만 옛말을 한다 — 서버가 준 것을 그린다
  assert.match(html, /state\.linked\.providers/, '제공자를 서버 응답에서 안 읽는다');
  assert.ok(!/20MB|60MB/.test(html),
    '한도 숫자를 화면에 박아 두었다 — 서버가 바뀌면 화면만 옛말을 한다');
});

test('★ 자체 완결로 열린다 (script 태그 짝이 맞는다)', () => {
  const html = read('files.html');
  const open = (html.match(/<script\b/g) || []).length;
  const close = (html.match(/<\/script>/g) || []).length;
  assert.strictEqual(open, close, 'script 태그 짝이 안 맞는다 — 화면이 통째로 빈다');
  // 붙이는 쪽이 채우는 값은 하나뿐이어야 한다
  assert.match(html, /window\.LINKPILOT_FILES = \{/);
});

test('★ 토큰이 안 실리면 화면이 말한다', () => {
  const html = read('files.html');
  assert.match(html, /tokensLoaded\(\) === false/, '토큰 확인을 안 한다');
  // 그 경고는 토큰 없이도 보여야 하므로 색을 직접 칠한다
  assert.match(html, /\.nostyle \{[^}]*background: #FDECEC/,
    '토큰 경고에 인라인 색이 없다 — 토큰이 없으면 경고까지 안 보인다');
});
