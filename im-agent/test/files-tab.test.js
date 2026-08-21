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
const os = require('os');

const F = require('../ui/platform/flow-core.js');
const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');

/** 주석을 뺀 코드만 본다 — 설명 글이 규칙 위반으로 잡히면 안 된다 */
const codeOf = (html) => html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

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
  // ★ 2026-08-21 사용자 지시로 **셋**이 되었다 — 앱에서 가져오기가 갈래로 올라왔다
  ['＋ 앱 프로젝트에서 가져오기', '폴더를 연결해서', '파일업로드'].forEach((w) => {
    assert.ok(html.includes(w), `세 갈래 중 '${w}' 가 화면에 없다`);
  });
  // ★ 「올려서 보관」은 뺐다 (2026-08-20 사용자 결정 — 불필요)
  assert.ok(!/id: 'kept'/.test(html), '보관 갈래가 되살아났다');
  assert.ok(html.includes('사본을 만들지 않습니다'),
    '연결이 사본을 안 만든다는 말이 없다 — 「업로드」로 읽힌다');
  assert.ok(html.includes('다시 쓸 수 없'),
    '1회성이 재사용 불가라는 말이 없다 — 올린 뒤에 알면 늦다');
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

/**
 * ★★ 401·403 도 **고장이 아니다.** 로그인 안 했거나 등급이 모자란 것은 상태다.
 *   빨간 오류로 그리면 고장으로 읽혀 문의가 온다 — 501 은 조심했는데 이건
 *   놓쳤었다(2026-08-18). 헤드리스로 확인: 401 판에서도 오류 상자 0개.
 */
test('★★ 401·403 을 오류로 그리지 않는다 (게이트로 그린다)', () => {
  const html = read('files.html');
  assert.match(html, /r\.status === 401 \|\| r\.status === 403/, '401·403 을 따로 다루지 않는다');
  assert.match(html, /G\.access\(C\.session, C\.requiredPlan\)/,
    '등급 판정을 화면이 말하지 않는다 — 목록만 비면 「자료가 없다」로 읽힌다');
  assert.ok(html.includes("requiredPlan: 'free'"), '자료 탭이 무료가 아니다');
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

/* ═════════ ⑤ 첨부 — 여기서 고르고 여기서 올린다 (2026-08-20) ═════════ */

/**
 * ★★ 세 갈래가 **설명만**이던 때가 있었다. 무엇이 다른지는 알려 주는데 정작
 *   여기서 올릴 수는 없어서, 자료를 넣으려면 1단계로 되돌아가야 했다.
 */
test('★★ 두 갈래를 고를 수 있다 (설명만이 아니다)', () => {
  const html = read('files.html');
  assert.match(html, /var WAYS = \[/, '갈래가 데이터로 있지 않다');
  assert.match(html, /el\('button', 'pw'/, '갈래가 눌리지 않는다 — 설명만이다');
  assert.match(html, /addEventListener\('click'/, '고르는 동작이 없다');
});

/**
 * ★★ 올리는 방법은 **한 곳에만** 있다. 1단계와 이 탭이 따로 쓰면 갈린다 —
 *   이 저장소는 그 갈라짐을 색에서 한 번 겪었다.
 */
test('★★ 올리는 방법을 화면마다 따로 쓰지 않는다', () => {
  const files = read('files.html');
  const intake = read('intake.html');
  [files, intake].forEach((h) => {
    assert.match(h, /<script src="upload-core\.js"><\/script>/, 'upload-core.js 를 안 부른다');
    assert.ok(!/new XMLHttpRequest\(\)/.test(codeOf(h)),
      '화면이 직접 XHR 을 쓴다 — upload-core.js 와 갈린다');
  });
});

/**
 * ★ 갈래를 바꾸면 고른 파일을 **버린다.** 보관하려던 것이 1회성으로 넘어가면
 *   읽고 지워지고, 그 실수는 **되돌릴 수 없다.**
 */
test('★★ 갈래를 바꾸면 고른 파일을 들고 가지 않는다', () => {
  const code = codeOf(read('files.html'));
  assert.match(code, /if \(state\.way !== w\.id\) \{ state\.picked = \[\]/,
    '갈래를 바꿔도 고른 파일이 남는다 — 보관하려던 것이 1회성으로 넘어간다');
});

/** ★ 연결은 **올리는 것이 아니다.** 파일 고르기를 주면 「업로드」로 읽힌다 */
test("★★ 연결 갈래에는 파일 고르기가 없다", () => {
  const code = codeOf(read('files.html'));
  const at = code.indexOf("if (state.way === 'linked')");
  assert.ok(at > 0, '연결 갈래를 따로 다루지 않는다');
  const upto = code.slice(at, code.indexOf('card.appendChild(dropZone())'));
  assert.match(upto, /return card;/, '연결에서도 드롭존까지 내려간다 — 사본을 만드는 것처럼 보인다');
});

/**
 * ★★ 서버 응답의 **껍데기를 벗겨서** 쓴다.
 *
 * `call()` 은 `{ok, body}` 를 준다. 껍데기째 넣었더니 값이 `undefined` 가 되어
 * 화면에 **「파일 하나 0 B」**가 그럴듯하게 찍혔다 — 오류가 아니라 **틀린 값**이라
 * 눈으로만 보면 「한도가 0 이라 못 올린다」로 읽힌다 (2026-08-20 실측).
 */
test('★★ 한도를 껍데기째 넣지 않는다 (0 B 로 찍혔다)', () => {
  const code = codeOf(read('files.html'));
  assert.match(code, /if \(r && r\.ok && r\.body\) \{ state\.limits = r\.body;/,
    'call() 의 껍데기를 벗기지 않는다 — 한도가 0 B 로 찍힌다');
  assert.match(code, /state\.limits\.maxBytesPerFile > 0/,
    '모르는 한도를 0 으로 그린다 — 「못 올린다」로 읽힌다');
});

/**
 * ★ 진행 상태 이름표가 **빈 채로** 뜬 적이 있다 — `el(t, c, x)` 의 둘째가
 *   class 인데 글자를 거기 넣었다. 오류는 안 나고 글자만 사라진다.
 */
test('★ 진행 상태 이름표에 글자가 들어간다', () => {
  const code = codeOf(read('files.html'));
  assert.match(code, /el\('b', null,\s*\n?\s*u\.phase === 'sending'/,
    "el('b', …) 둘째 자리에 글자를 넣었다 — class 가 되어 이름표가 빈다");
});

/** ★ 거절된 것을 숨기지 않는다. 「올렸습니다」만 보면 다 올라간 줄 안다 */
test('★★ 거절 사유를 결과에 함께 적는다', () => {
  const code = codeOf(read('files.html'));
  assert.match(code, /\(state\.result\.rejected \|\| \[\]\)\.forEach/,
    '거절 목록을 안 그린다 — 「올렸습니다」만 보고 다 올라간 줄 안다');
});

/** ★ 올린 뒤 목록을 다시 읽는다 — 안 읽으면 방금 올린 것이 안 보인다 */
test('★ 올린 뒤 목록을 다시 읽는다', () => {
  const code = codeOf(read('files.html'));
  assert.match(code, /onDone:[\s\S]{0,220}loadOne\(state\.projectId\)/,
    '올린 뒤 목록을 안 다시 읽는다 — 방금 올린 것이 안 보인다');
});

/**
 * ★★ 미리 그린 판이 **빈 채로 나가지 않게** 한다.
 *
 * 처음 만들 때 설정 블록을 고쳐 쓰다가 괄호가 어긋나 스크립트가 통째로 죽었고,
 * **화면은 빈 채로 뜨는데 오류는 어디에도 안 보였다.** 8KB 짜리 그럴듯한 파일이
 * 나왔고 열어 봐야 비어 있다는 것을 알 수 있었다.
 */
test('★★ 자료 업로드 탭을 미리 그리면 실제로 내용이 들어간다', async () => {
  const { build } = require(path.join(PLATFORM, 'build-files.js'));
  const { findBrowser } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;   // 크로미움이 없는 서버가 실제로 있다 — 거기서는 건너뛴다

  const out = path.join(os.tmpdir(), 'lp-files-artifact-test.html');
  try {
    await build(out);
    const html = fs.readFileSync(out, 'utf8');
    const body = html.slice(html.indexOf('<div class="pv">'));
    assert.ok(body.length > 800, `미리 그린 판이 비었다 (${body.length}B) — 스크립트가 죽었다`);
    assert.equal((body.match(/class="err"/g) || []).length, 0, '오류 상자가 그려졌다');
    ['＋ 앱 프로젝트에서 가져오기', '폴더를 연결해서', '파일업로드'].forEach((w) => {
      assert.ok(body.includes(w), `미리 그린 판에 '${w}' 가 없다`);
    });
    assert.match(html, /예시 화면입니다/, '예시라는 표시가 없다 — 실제로 오해한다');
  } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
});

/**
 * ★★ **「보인다」와 「된다」는 다른 확인이다.**
 *
 * 미리 그린 판은 눌리지 않는다. 그래서 눌러 볼 수 있는 판을 따로 낸다
 * (`npm run im:files:live`). 만들면서 둘이 나왔고 **둘 다 오류를 안 냈다**:
 *   ① 설정 주입이 인라인한 모듈의 주석에 걸려 **로그인 안 한 화면**이 나왔다
 *   ② 가짜 서버를 화면보다 **뒤에** 넣어 「프로젝트가 없습니다」가 그럴듯하게 떴다
 */
test('★★ 눌러 볼 수 있는 판이 실제로 설정을 받고 나온다', async () => {
  const { buildLive, publishableLive } = require(path.join(PLATFORM, 'build-files.js'));
  const out = path.join(os.tmpdir(), 'lp-files-live-test.html');
  try {
    await buildLive(out);
    const html = fs.readFileSync(out, 'utf8');

    // ① 주입이 **설정 블록보다 뒤에** 있어야 한다. 앞이면 덮어써진다
    const cfg = html.search(/^window\.LINKPILOT_FILES\s*=/m);
    const inject = html.indexOf('Object.assign(window.LINKPILOT_FILES');
    assert.ok(cfg > 0 && inject > cfg, '설정 주입이 설정 블록보다 앞에 있다 — 덮어써진다');
    assert.match(html, /"authenticated":true/, '세션이 안 들어갔다 — 로그인 화면이 뜬다');

    // ② 가짜 서버가 **화면보다 먼저** 있어야 한다. 뒤면 첫 요청을 못 가로챈다
    const fake = html.indexOf('window.fetch = function');
    const screen = html.indexOf('<div class="pv">');
    assert.ok(fake > 0 && fake < screen, '가짜 서버가 화면보다 뒤에 있다 — 목록이 빈다');

    // 스크립트는 **있어야 한다** (이 판은 도는 판이다)
    assert.match(html, /<script/, '스크립트가 없다 — 이건 미리 그린 판이다');
    assert.deepEqual(publishableLive(html), [], '올릴 수 없는 조각이다');
    assert.match(html, /서버는 예시입니다/, '예시라는 표시가 없다');
    // 연결은 실제로도 안 열려 있다 — 되는 것처럼 보여 주지 않는다
    assert.match(html, /501/, '연결 갈래를 되는 것처럼 만들었다');
  } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
});

/* ═════════ ⑤-2 끌어다 놓기 · 활동 그래프 · 새 프로젝트 (2026-08-20) ═════════ */

/**
 * ★★ **점선 상자를 빗나가면 브라우저가 그 파일을 탭에 열어 버린다.**
 *   화면은 통째로 사라지고 올린 것은 없다 — 아무 오류도 안 나므로 사용자는
 *   「끌어다 놓기가 없는 기능」이라고 읽는다. 그래서 문서 전체에서 먼저 막는다.
 */
test('★★ 화면 아무 데나 떨어뜨려도 브라우저가 파일을 열지 않는다', () => {
  const code = codeOf(read('files.html'));
  assert.match(code, /document\.addEventListener\('drop'/, '문서에서 떨어뜨림을 안 받는다');
  assert.match(code, /document\.addEventListener\('dragover'/,
    'dragover 를 안 막으면 drop 자체가 안 온다');
  // 갈래를 **대신 바꾸지 않는다** — 1회성은 읽고 버리는 길이라 되돌릴 수 없다
  assert.ok(!/state\.way = 'oneshot';\s*\n\s*addFiles/.test(code),
    '떨어뜨렸다고 갈래를 대신 바꿨다 — 되돌릴 수 없는 것을 화면이 정하면 안 된다');
});

/**
 * ★★ **막대 하나로는 어디서 걸렸는지 알 수 없다.** 「보내는 중」이 오래 걸리는
 *   것과 「서버가 읽는 중」이 오래 걸리는 것은 원인이 다르다 — 앞은 회선,
 *   뒤는 파일. 같은 막대로 그리면 고장으로 읽고 창을 닫는다.
 *
 * ★ 자취는 **잰 것만** 그린다. 모르는 순간을 0 으로 이으면 선이 뚝 떨어져
 *   「되돌아갔다」로 보이는데, 실제로는 못 잰 것뿐이다.
 */
test('★★ 활동 그래프는 잰 것만 그린다 (모르는 값을 0 으로 잇지 않는다)', () => {
  const code = codeOf(read('files.html'));
  assert.match(code, /function activityGraph\(/, '활동 그래프가 없다');
  assert.match(code, /if \(u\.pct !== null && u\.pct !== undefined\) \{[\s\S]{0,200}state\.trace\.push/,
    '진행률을 모르는 순간까지 자취에 담는다 — 선이 뚝 떨어져 「되돌아갔다」로 읽힌다');
  assert.match(code, /if \(!pts \|\| pts\.length < 2\) return null;/,
    '점 하나로 선을 긋는다 — 뜻이 없는데 그럴듯해 보인다');
  // 이번 판만 그린다. 안 비우면 지난 판이 앞에 붙는다
  assert.match(code, /state\.trace = \[\]; state\.traceAt0 = now\(\);/, '자취를 안 비우고 다시 쓴다');
  // 움직임을 싫어하는 설정을 존중한다
  assert.match(read('files.html'), /@media \(prefers-reduced-motion: reduce\)/,
    '움직임 감소 설정을 무시한다');
  // 벽시계를 쓰면 자정·시간대에 자취가 흔들린다
  assert.match(code, /performance\.now/, '벽시계로 잰다 — 단조 시계를 쓴다');
});

/**
 * ★ 「+ 새 프로젝트」는 **고르기가 아니라 만들기**다. 화면이 몰래 만들지 않는다 —
 *   무엇을 만들지 적은 문장에서 자산군이 정해지기 때문이다 (프로젝트-연결-규칙 §4).
 */
test('★ 새 프로젝트는 한 줄을 받고 만든다 (몰래 만들지 않는다)', () => {
  const code = codeOf(read('files.html'));
  assert.match(code, /var NEW_OPT = 'new:';/, '새 프로젝트 항목이 없다');
  assert.match(code, /call\('POST', '\/projects', \{ request:/, '요청문 없이 만든다');
  assert.match(code, /\{ localGate: true \}/,
    '등급 부족이 화면 전체를 잠근다 — 이미 있는 프로젝트에 자료 붙이는 것까지 막힌다');
});

/**
 * ★★ **원인을 틀리게 말하지 않는다** 〈2026-08-20 실측〉.
 *
 * 실서버에서 제공자 단추 넷이 멀쩡히 떠 있었고, 누르면
 * 「이 브라우저에서는 파일 고르기를 열 수 없습니다」가 떴다.
 * **브라우저는 아무 상관이 없었다** — 앱이 고르기 창을 안 넘겼거나 제공자
 * 콘솔 등록이 안 된 것이다. 그 문장을 읽은 사람은 브라우저를 바꾸러 간다.
 * **틀린 원인을 말하는 것이 아무 말도 안 하는 것보다 나쁘다.**
 */
test('★★ 열 수 없는 제공자를 누를 수 있게 두지 않는다 (브라우저 탓을 안 한다)', () => {
  const html = read('files.html');
  const code = codeOf(html);
  assert.ok(!/이 브라우저에서는/.test(code),
    '브라우저 탓을 하는 문장이 남아 있다 — 원인이 아니다');
  assert.match(code, /var canOpen = typeof C\.pickFrom === 'function';/,
    '고르기 창이 붙었는지 보지 않는다');
  assert.match(code, /b\.disabled = !open;/, '열 수 없는 단추가 눌린다');
  // ★ 옛 서버가 `configured` 를 안 주면 **막지 않는다** — 모르는 것을 「안 된다」로
  //   그리면 되는 것까지 못 쓰게 된다
  assert.match(code, /p\.configured === undefined\) \? true/,
    '모르는 것을 「안 된다」로 그린다 — 되는 것까지 막힌다');
  // 막혔을 때 **되는 길**을 알려 준다.
  // ★ 이름을 문장에 박아 두지 않고 갈래 표에서 가져오는지를 본다 — 박아 두면
  //   갈래 제목을 바꾸는 날 안내만 옛 이름을 말한다 (2026-08-21 실제로 그랬다)
  assert.match(code, /지금 자료를 넣으려면 「' \+ wayName\('oneshot'\) \+ '」 갈래를/,
    '지금 쓸 수 있는 길을 안 알려 주거나, 갈래 이름을 손으로 적어 두었다');
});

/**
 * ★★ **키가 있는지는 서버만 안다.** 화면이 짐작하면 위와 같은 헛다리를 짚는다.
 * ★ 값이 아니라 **환경변수 이름**만 나간다 (CLAUDE.md §2 — 값은 절대 안 나간다).
 */
test('★★ 서버가 제공자마다 등록 여부를 말한다 (키 값은 안 내보낸다)', async () => {
  const W = require(path.join(__dirname, '..', 'ui', 'report-api.cjs'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-prov-'));
  process.env.IM_AGENT_ROOT = tmp;
  const h = W.createHandlers({
    agentRoot: tmp, agentModulePath: path.join(__dirname, '..'),
    authenticate: () => ({ planId: 'pro', status: 'active' }),
  });
  const made = await h.createProject({ headers: {} }, { request: '인천 남동공단 데이터센터' });
  const id = made.body.projectId;

  const secret = 'SECRET-' + 'dropbox-key-must-not-leak';
  const had = process.env.DROPBOX_APP_KEY;
  process.env.DROPBOX_APP_KEY = secret;
  delete process.env.BOX_CLIENT_ID;
  try {
    const r = await h.listLinked({ headers: {} }, id);
    assert.strictEqual(r.status, 200);
    const by = {};
    r.body.providers.forEach((p) => { by[p.id] = p; });
    assert.strictEqual(by.dropbox.configured, true, '키가 있는데 등록 안 됨으로 나온다');
    assert.strictEqual(by.box.configured, false, '키가 없는데 등록됨으로 나온다');
    assert.strictEqual(by.dropbox.keyEnv, 'DROPBOX_APP_KEY', '무엇을 넣어야 하는지 안 알려 준다');
    // ★★ 값은 **어디에도** 안 실린다
    assert.ok(!JSON.stringify(r.body).includes(secret), '키 값이 응답에 실렸다');
  } finally {
    if (had === undefined) delete process.env.DROPBOX_APP_KEY;
    else process.env.DROPBOX_APP_KEY = had;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * ★★ **위 검사는 전부 소스를 들여다보는 검사다.** 실제로 도는지는 브라우저가
 *   말해 준다 — 그래서 눌러 볼 수 있는 판을 **띄워서 직접 떨어뜨려 본다.**
 *   (M-08 — 「부르지 않는 테스트」를 만들지 않는다)
 */
test('★★ 실제 브라우저에서 떨어뜨리면 붙고, 그래프가 끝까지 간다', async () => {
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;   // 크로미움이 없는 서버가 실제로 있다

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-files-drop-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = `
    <div id="probe"></div>
    <script>
    (async function () {
      var sleep = function (m) { return new Promise(function (r) { setTimeout(r, m); }); };
      var t = function (n) { return n ? (n.textContent || '').trim().replace(/\\s+/g, ' ') : null; };
      var o = {};
      await sleep(150);
      var sel = document.querySelector('select');
      sel.value = 'LP-DC-2026-001';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(200);
      // ★ 처음 갈래는 **앱**이다 (2026-08-21 — 프로젝트 고르는 자리가 거기뿐이라
      //   기본값이 바뀌었다). 여기서 재려는 것은 「연결 갈래에서 떨어뜨렸을 때
      //   갈래를 대신 바꾸지 않는가」이므로, **연결로 옮기고 나서** 떨어뜨린다
      [].slice.call(document.querySelectorAll('.pw')).filter(function (b) {
        return /폴더를 연결해서/.test(t(b)); })[0].click();
      await sleep(120);
      // 연결 갈래인 채로 떨어뜨린다 — 갈래를 대신 바꾸지 않는다
      var d0 = new DataTransfer();
      d0.items.add(new File([new Uint8Array(8)], 'a.pdf'));
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: d0 }));
      await sleep(80);
      o.keptWay = t(document.querySelector('.pw.on .pw__t'));
      o.rowsWhileLinked = document.querySelectorAll('.row').length;
      // 1회성으로 바꾸고 **카드 바깥**에 떨어뜨린다
      [].slice.call(document.querySelectorAll('.pw')).filter(function (b) {
        return t(b).indexOf('파일업로드') === 0; })[0].click();
      await sleep(60);
      var d = new DataTransfer();
      d.items.add(new File([new Uint8Array(4000)], '감정평가서.pdf'));
      var far = document.querySelector('.lead') || document.body;
      far.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: d }));
      // ★★ **정해진 시간을 기다리지 않는다.** 파일 읽기는 타이머가 아니라
      //   FileReader 라서 가상 시계가 기다려 주지 않는다. 기계가 바쁘면 읽기가
      //   덜 끝난 채로 지나가고, 그러면 버튼이 잠긴 채라 눌러도 아무 일이 없다 —
      //   그 상태가 「그래프가 안 뜬다」로 보여서 **엉뚱한 곳을 파게 된다.**
      //   그래서 **버튼이 풀릴 때까지** 기다린다 (실제로 한 번 이렇게 헛울었다).
      //
      // ★★ 횟수를 넉넉히 둔다 〈2026-08-21〉. 가상 시계는 **파일 읽기를 기다려
      //   주지 않는다** — 돌 것이 없으면 그냥 앞으로 감는다. 그래서 기계가
      //   바쁠 때(전체 시험을 한꺼번에 돌릴 때) 200번이 실제로는 눈 깜짝할
      //   사이에 다 소모됐다. 혼자 돌리면 늘 통과하고 **함께 돌릴 때만** 실패해서,
      //   증상만 보면 화면이 깨진 것처럼 보인다. 한 번 헛다리를 짚었다.
      var go = null;
      for (var w = 0; w < 1200; w++) {
        go = [].slice.call(document.querySelectorAll('.btn')).filter(function (b) {
          return t(b).indexOf('파일업로드') === 0; })[0];
        if (go && !go.disabled) break;
        await sleep(20);
      }
      o.rows = document.querySelectorAll('.row').length;
      o.goReady = !!(go && !go.disabled);
      // ★ 한 번만 재면 **놓친다.** 가상 시계에서는 올리기가 표본 사이에 끝나 버리고,
      //   그러면 「도는 중에 칸을 가리켰나」를 못 재고도 통과하거나 헛울음이 난다.
      //   그래서 **바뀔 때마다** 받아 적는다 — 표본 간격에 기대지 않는다
      o.seen = [];
      new MutationObserver(function () {
        var n = t(document.querySelector('.fx__n--now .fx__t'));
        if (n && o.seen.indexOf(n) < 0) o.seen.push(n);
      }).observe(document.body, { childList: true, subtree: true });
      go.click();
      await sleep(1800);
      o.stagesDone = [].slice.call(document.querySelectorAll('.fx__n--done .fx__t')).map(t);
      o.stillRunning = !!document.querySelector('.fx__l--run');
      o.chart = !!document.querySelector('.fx__c svg');
      o.errBoxes = document.querySelectorAll('.err').length;
      document.getElementById('probe').textContent = JSON.stringify(o);
    }());
    </script>`;
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  try {
    const dom = renderDom(findBrowser(), page, 30000);
    const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
    assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 스크립트가 죽었다');
    const r = JSON.parse(m[1]);
    assert.equal(r.errBoxes, 0, '오류 상자가 떴다');
    // 연결 갈래에서는 받지 않는다 (되돌릴 수 없는 것을 대신 정하지 않는다)
    assert.equal(r.rowsWhileLinked, 0, '연결 갈래인데 떨어뜨린 파일을 받았다');
    assert.match(r.keptWay, /폴더를 연결해서/, '갈래를 대신 바꿨다');
    // 카드 **바깥**에 떨어뜨려도 붙는다
    assert.equal(r.rows, 1, `카드 바깥에 떨어뜨린 파일이 안 붙었다 (${r.rows}개)`);
    // 읽기가 안 끝났으면 버튼이 잠긴 채다 — 그걸 「그래프가 없다」로 읽지 않게 먼저 가른다
    assert.ok(r.goReady, '파일을 다 읽지 못해 올리기 버튼이 잠겨 있다');
    // 그래프가 도는 중에 실제로 한 칸을 가리키고, 끝나면 네 칸이 다 찬다
    // 도는 동안 **가운데 칸**을 실제로 지나갔는가 (끝 칸만 보이면 그래프가 아니라 결과다)
    assert.ok(r.seen.some(function (x) { return x === '보내는 중' || x === '서버가 읽는 중'; }),
      '올리는 중에 가운데 칸을 한 번도 안 가리켰다 — 본 것: ' + JSON.stringify(r.seen));
    // ★ 앞 넷이 올리기 칸이다. 뒤에 붙는 것은 **이어서 도는 스캔**이다
    //   (2026-08-21 지시). 넷만 기대하면 기능이 느는 날 통과가 깨진다
    assert.deepEqual(r.stagesDone.slice(0, 4), ['고른 파일', '보내는 중', '서버가 읽는 중', '붙었습니다'],
      '끝났는데 칸이 다 안 찼다');
    assert.equal(r.stillRunning, false, '끝났는데 선이 계속 흐른다 — 도는 것처럼 보인다');
    assert.ok(r.chart, '자취 그림이 없다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/**
 * ★★ **앱에서 가져오는 셋** 〈2026-08-20 요청〉 — 프로젝트 내용 · 첨부파일 ·
 *   이미지파일. 실제 브라우저에서 딜을 골라 끝까지 가져와 본다.
 *
 * ★ 여기서 지키는 것 셋:
 *   ① 개수를 **가져오기 전에** 보여 준다 (누르고 나서 알면 늦다)
 *   ② 사전에 없는 항목은 **값이 되지 않고**, 그 사실이 화면에 남는다
 *   ③ 프로젝트를 바꾸면 앞 딜의 꾸러미가 **따라오지 않는다**
 */
test('★★ 앱에서 셋(내용·첨부·이미지)을 가져온다 — 거절도 숨기지 않는다', async () => {
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-app-import-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = `
    <div id="probe"></div>
    <script>
    (async function () {
      var sleep = function (m) { return new Promise(function (r) { setTimeout(r, m); }); };
      var t = function (n) { return n ? (n.textContent || '').trim().replace(/\\s+/g, ' ') : null; };
      var o = {};
      await sleep(200);
      var sel = document.querySelector('select');
      o.groups = [].slice.call(sel.querySelectorAll('optgroup')).map(function (g) { return g.label; });
      // ★ 목록에서 **몇 번째**인지까지 본다. 「있다」만 보면 맨 아래로 밀려도 통과한다
      o.first = sel.children[0] && sel.children[0].textContent;
      o.second = sel.children[1] && sel.children[1].textContent;
      o.lastIsNew = /신규프로젝트/.test(sel.children[sel.children.length - 1].textContent || '');
      sel.value = 'app:deal-8842';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      // 앱이 곧바로 주지 않는다 — 카드가 뜰 때까지 기다린다
      var go = null;
      for (var w = 0; w < 1200; w++) {
        go = [].slice.call(document.querySelectorAll('.btn')).filter(function (b) {
          return t(b) === '가져오기'; })[0];
        if (go && !go.disabled) break;
        await sleep(20);
      }
      o.ready = !!(go && !go.disabled);
      o.rows = [].slice.call(document.querySelectorAll('.row')).map(t);
      o.note = t(document.querySelector('.card .note'));
      if (go) { go.click(); }
      for (var k = 0; k < 250; k++) {
        await sleep(20);
        if (document.querySelector('.up--done, .up--error')) break;
      }
      o.stagesDone = [].slice.call(document.querySelectorAll('.fx__n--done .fx__t')).map(t);
      o.report = t(document.querySelector('.up'));
      // 프로젝트를 바꾸면 앞 딜의 꾸러미가 따라오지 않는다
      var sel2 = document.querySelector('select');
      sel2.value = 'LP-DC-2026-001';
      sel2.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(400);
      o.afterSwitch = [].slice.call(document.querySelectorAll('.card__t')).map(t);
      o.afterRows = [].slice.call(document.querySelectorAll('.row')).map(t);
      o.afterScan = t(document.querySelector('.up--done, .up--error'));
      o.errBoxes = document.querySelectorAll('.err').length;
      document.getElementById('probe').textContent = JSON.stringify(o);
    }());
    </script>`;
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  try {
    const dom = renderDom(findBrowser(), page, 30000);
    const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
    assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 스크립트가 죽었다');
    const r = JSON.parse(m[1]);
    assert.equal(r.errBoxes, 0, '오류 상자가 떴다');
    assert.ok(r.groups.includes('앱 프로젝트에서 가져오기'), '앱 딜 무리가 없다');
    // ★★ **맨 위여야 한다** 〈2026-08-20 사용자 지시〉. 프로젝트가 수십 개면
    //   아래 것은 끝까지 굴려야 보이는데, 새로 만드는 사람은 목록에 볼 것이
    //   없는 사람이다. 「있다」만 검사하면 아래로 밀려도 통과한다 — 자리를 잰다
    assert.match(r.second, /신규프로젝트/,
      `「＋ 신규프로젝트」가 맨 위가 아니다 — 2번째 자리에 있는 것: ${r.second}`);
    assert.equal(r.lastIsNew, false, '맨 아래에도 하나 더 있다 — 두 번 그렸다');
    // ★ 앱이 준 함수가 화면 대입에 지워지면 여기서 걸린다 (실제로 한 번 지워졌다)
    assert.ok(r.ready, '앱에서 셋을 못 읽었다 — fetchAppProject 가 안 붙었는가');

    // ① 개수를 **먼저** 보여 준다
    ['프로젝트 내용', '첨부파일', '이미지파일'].forEach((label) => {
      assert.ok(r.rows.some(x => x.indexOf(label) === 0), `${label} 칸이 없다`);
    });
    assert.ok(r.rows.some(x => /첨부파일 · 2개/.test(x)), '첨부 개수를 안 보여 준다');
    assert.ok(r.rows.some(x => /이미지파일 · 1개/.test(x)), '이미지 개수를 안 보여 준다');

    // ② 값이 될 수 없는 것은 그렇다고 적는다
    assert.match(r.note, /가져오지 않습니다/, '값이 못 되는 것을 조용히 넘겼다');
    // ★ 앞 넷은 가져오기, 뒤는 **이어서 자동으로 도는 스캔**이다 (2026-08-21 지시).
    //   `deepEqual` 로 넷만 기대하면 스캔이 붙는 날 통과가 깨지는데, 그건
    //   기능이 는 것이지 고장이 아니다 — **앞부분이 맞는지**를 본다
    assert.deepEqual(r.stagesDone.slice(0, 4),
      ['앱에서 읽기', '프로젝트 내용', '자료 잇기', '가져왔습니다'], '가져오기가 끝까지 안 갔다');
    // ★★ 가져온 뒤 **자동으로 읽어야 한다.** 안 읽으면 2단계에 가도 빈 칸뿐이다
    assert.ok(r.stagesDone.indexOf('자료 모으기') > 3,
      `가져온 뒤 자료 스캔이 자동으로 안 돌았다 — 칸: ${r.stagesDone.join(' · ')}`);
    assert.match(r.report, /첨부 2개/, '첨부가 안 붙었다');
    assert.match(r.report, /이미지 1개/, '이미지가 안 붙었다');
    // ★★ 거절을 **접어 두지 않는다** — 「가져왔습니다」만 보면 다 들어온 줄 안다
    assert.match(r.report, /사전에 없는 항목/, '거절 사유가 화면에 없다');

    // ③ 프로젝트를 바꾸면 앞 딜 꾸러미가 따라오지 않는다 (붙으면 엉뚱한 곳에 붙는다)
    // ★ 「앱에서 가져오기」는 이제 카드 제목이 아니라 **갈래 안쪽**이다 (2026-08-21).
    //   제목으로만 재면 카드가 사라진 지금은 **무엇을 해도 통과한다** — 칸을 잰다
    assert.ok(!(r.afterRows || []).some(x => /^첨부파일 · /.test(x)),
      `다른 프로젝트로 옮겼는데 앞 딜의 가져오기 칸이 남아 있다: ${(r.afterRows || []).join(' | ')}`);
    // ★★ 스캔 결과도 따라오면 안 된다 — 앞 프로젝트의 값 개수가 그대로 떠 있으면
    //   그럴듯하게 틀린 화면이 된다
    assert.equal(r.afterScan, null,
      `다른 프로젝트로 옮겼는데 앞 프로젝트의 스캔 결과가 남아 있다: ${r.afterScan}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/**
 * ★★ 이 탭에는 앱이 얹는 것이 하나 더 있다 —
 *   「외부 분석 AGENT 로 만들기(기반정보 내보내기)」.
 *
 * 그쪽이 프로젝트를 따로 고르게 하면 **같은 탭에 프로젝트 고르기가 둘**이 되고,
 * 둘이 다른 것을 가리키는 순간 사용자는 **어느 프로젝트의 기반정보를 받았는지
 * 모른다.** 받아 간 파일에는 그 사실이 안 적힌다 — 그게 제일 나쁘다.
 *
 * 그래서 고르는 곳은 여기 하나로 두고, 앱은 이 알림을 따라간다.
 */
test('★★ 고른 프로젝트를 부모에게 알린다 (앱의 기반정보 내보내기가 따라간다)', () => {
  const code = codeOf(read('files.html'));
  assert.match(code, /type: 'lp-files-project'/, '부모에게 알리지 않는다 — 앱이 따라갈 수 없다');
  // ★ 아무 데나 보내지 않는다. 다른 출처면 브라우저가 막는 것이 맞다
  assert.match(code, /postMessage\([\s\S]{0,120}window\.location\.origin\)/,
    "'*' 로 보낸다 — 같은 출처로만 보낸다");
  // 고를 때마다 알린다. 비운 것도 알려야 앱이 그 자리를 비운다
  assert.match(code, /announce\(state\.projectId\);/, '고를 때 알리지 않는다');
});

/* ═════════ ⑥ iframe 없이 앱 안에 바로 얹는 조각 (2026-08-20) ═════════ */

/**
 * ★★ iframe 으로 얹으면 앱이 높이를 정해야 하고, 안 맞으면 화면 안에
 *   **스크롤바가 하나 더** 생긴다. 스크롤이 둘이면 바깥을 내렸는데 안이
 *   안 내려가는 상태가 된다 — 앱처럼 안 보인다. 그래서 문서 하나로 합친다.
 *
 * ★ 합치면 **CSS 가 앱 전체로 샌다.** 화면 CSS 는 `.card`·`.row` 처럼 흔한
 *   이름을 쓴다. 가두지 않은 규칙 하나가 앱의 다른 화면을 바꾼다.
 */
test('★★ 조각의 CSS 가 전부 갇혀 있다 (앱 전체로 새지 않는다)', () => {
  const { build, check } = require(path.join(PLATFORM, 'build-inline.js'));
  const r = build('files.html', null);
  assert.equal(r.id, 'lp-files');
  assert.equal(r.global, 'LINKPILOT_FILES');
  assert.ok(r.bytes > 20000, `조각이 너무 작다 (${r.bytes}B) — 스크립트가 빠졌는가`);

  // 가두지 않은 선택자를 **심어서** 실제로 잡는지 본다.
  // 통과만 확인하면 check() 가 아무것도 안 하게 된 날에도 통과한다
  const leaky = '<style>body { margin: 0; }\n#lp-files .card { color: red; }</style><div id="lp-files"></div>';
  const hit = check(leaky, 'lp-files');
  assert.ok(hit.some(x => /body/.test(x)), '가두지 않은 body 규칙을 못 잡았다');

  // 선언부를 선택자로 잘못 읽지 않는다 (그렇게 헛울음이 났다)
  const fine = '<style>#lp-files .row { color: var(--x); font-variant-numeric: tabular-nums; }</style><div id="lp-files"></div>';
  assert.deepEqual(check(fine, 'lp-files'), [], '멀쩡한 규칙을 잘못 잡았다 — 헛울음이다');
});

/**
 * ★★ 조각에서는 설정을 **덮어쓰지 않는다.** 원본의 `window.X = {…}` 대입은
 *   앱이 미리 넣어 둔 값을 지운다 — 그러면 화면이 로그인 안 한 상태로 뜬다.
 */
test('★★ 조각은 앱이 먼저 넣은 설정을 지우지 않는다 (대입 → 병합)', () => {
  const { build } = require(path.join(PLATFORM, 'build-inline.js'));
  const r = build('files.html', path.join(os.tmpdir(), 'lp-inline-test.html'));
  const html = fs.readFileSync(r.file, 'utf8');
  try {
    assert.match(html, /window\.LINKPILOT_FILES = Object\.assign\(\{/,
      '설정이 여전히 대입이다 — 앱이 넣은 값을 지운다');
    assert.match(html, /\}, window\.LINKPILOT_FILES \|\| \{\}\);/,
      '병합이 닫히지 않았다');
    // 스크립트를 걷어내면 그림이지 화면이 아니다
    assert.match(html, /<script/, '스크립트가 없다');
    assert.ok(!/<iframe/.test(html), 'iframe 이 들어 있다 — 빼려고 만든 조각이다');
  } finally { fs.unlinkSync(r.file); }
});

/**
 * ★ iframe 으로 얹는 길도 남는다. 그때는 **높이를 부모에게 알려** 안쪽
 *   스크롤바가 안 생기게 한다 — 넘치는 것을 숨기지는 않는다(잘리면 더 나쁘다).
 */
test('★★ 브리지가 얹혔을 때 높이를 알린다 (안쪽 스크롤을 없앤다)', () => {
  const bridge = read('embed-bridge.js');
  assert.match(bridge, /type: 'lp-embed-height'/, '높이를 안 알린다 — 앱이 늘려 줄 수 없다');
  assert.match(bridge, /height:auto!important/, '높이 고정을 안 푼다');
  assert.ok(!/overflow[^;]*hidden/.test(bridge),
    '넘치는 것을 숨긴다 — 부모가 안 늘려 주면 내용이 잘린다');
  assert.match(bridge, /window\.location\.origin/, '아무 출처로나 보낸다');
});

/* ═════════ ⑦ 올린 자료가 어디에 쓰이는가 (2026-08-20) ═════════ */

/**
 * ★★ 올린 자료가 **실제로 추출에 들어가는지**를 재 본다.
 *
 * 화면이 「4단계에서 읽힙니다」라고 적어 두고 실제로는 안 읽히면, 그 문구가
 * 곧 거짓말이 된다. 그래서 **올려서 뽑아 본다** — 글자만 대조하지 않는다.
 */
test('★★ 올린 자료가 추출까지 실제로 들어간다 (출처와 함께)', async () => {
  const os2 = require('os');
  const root = fs.mkdtempSync(path.join(os2.tmpdir(), 'lp-updown-'));
  const prevRoot = process.env.IM_AGENT_ROOT;
  const prevOff = process.env.IM_AGENT_OFFLINE;
  process.env.IM_AGENT_ROOT = root;
  process.env.IM_AGENT_OFFLINE = '1';
  try {
    const AGENT = path.join(__dirname, '..');
    const { createHandlers } = require(path.join(AGENT, 'ui', 'report-api.cjs'));
    const store = require(path.join(AGENT, 'core', 'store'));
    const ext = require(path.join(AGENT, 'agents', '02-extraction'));
    const h = createHandlers({
      agentModulePath: AGENT,
      authenticate: () => ({ name: '테스트', planId: 'pro', status: 'active' }),
    });

    const made = await h.createProject({}, { request: '인천 데이터센터 IM' });
    const id = made.body.projectId;
    const up = await h.uploadSources({}, id, {
      files: [{ name: '사업계획서.txt',
        contentBase64: Buffer.from('총사업비 2,846억원\n대지면적 12,345 ㎡\n').toString('base64') }],
    });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal((up.body.saved || []).length, 1);

    // 추출기가 **그 파일을 본다**
    const seen = store.listSourceFiles(id).map(f => f.name);
    assert.ok(seen.includes('사업계획서.txt'), `추출기가 못 본다: ${seen.join(', ')}`);

    const ctx = { warn() {}, info() {}, log() {}, error() {} };
    const r = await ext.run({ projectId: id }, ctx);
    const facts = r.facts || (r.output && r.output.facts) || [];
    const one = facts.find(f => f.key === 'investment.total');
    assert.ok(one, `값이 안 뽑혔다: ${facts.map(f => f.key).join(', ')}`);
    // ★ 값만 오면 안 된다. **어디서 나왔는지**가 이 시스템의 전부다
    assert.equal(one.source, '사업계획서.txt', '출처에 파일 이름이 없다');
    assert.ok(one.quote && one.quote.length > 2, '근거 문장이 없다');
  } finally {
    if (prevRoot === undefined) delete process.env.IM_AGENT_ROOT; else process.env.IM_AGENT_ROOT = prevRoot;
    if (prevOff === undefined) delete process.env.IM_AGENT_OFFLINE; else process.env.IM_AGENT_OFFLINE = prevOff;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ═════════ 앱이 내부로 넘기는 출처 (2026-08-21 · 본체 실측 보고) ═════════
 *
 * ★★ **문서·화면이 정한 값을 검증기가 거절하고 있었다.**
 *   문서(작업인계-지시서 §2-1-2)와 화면은 `linkpilot-app` 으로 정했는데
 *   `connectors/storage.js` 만 그 이름을 몰라 「모르는 저장소입니다」로 전부
 *   거절했다. 실기기에서 첨부 2개를 골라 [가져오기] 했더니 **「첨부 0개」**가
 *   떴다 (2026-08-21 08:12 본체 실측).
 *
 *   같은 값이 **세 곳에 따로** 적혀 있어서 생긴 일이다. 그래서 아래 셋을 고정한다:
 *     ① 문서에 적힌 그 참조가 실제로 통과한다
 *     ② 단추 목록에는 안 뜬다 (고를 창이 없는 출처다)
 *     ③ 서버가 알려 주는 이름과 화면이 들고 있는 대비값이 같다
 */

test('★★ 문서(§2-1-2)에 적은 앱 참조가 그대로 통과한다', () => {
  const storage = require('../connectors/storage.js');
  // 문서의 예시 그대로 — provider 는 'linkpilot-app', rev 를 함께 준다
  const r = storage.normalizeRef({
    provider: 'linkpilot-app',
    fileId: 'f1',
    name: '금호클래식카 회사 소개서.pdf',
    rev: 'v3',
    path: '/deal/8842/회사소개서.pdf',
    bytes: 2400000,
  });
  assert.strictEqual(r.ok, true,
    `문서가 정한 참조를 검증기가 거절한다: ${r.reason}`);
  assert.strictEqual(r.value.provider, 'linkpilot-app');
  assert.strictEqual(storage.refKey(r.value), 'linkpilot-app:f1');

  // 판(rev)이 없으면 **여전히 거절한다.** 앱이라고 봐주지 않는다 —
  // 판을 안 남기면 원본이 바뀌어도 문서에는 아무 표시가 안 남는다
  const noRev = storage.normalizeRef({ provider: 'linkpilot-app', fileId: 'f1', name: 'a.pdf' });
  assert.strictEqual(noRev.ok, false);
  assert.match(noRev.reason, /판\(rev/);

  // 토큰이 섞여 오면 **여전히 거절한다** (장부에 열쇠를 두지 않는다)
  const tok = storage.normalizeRef({
    provider: 'linkpilot-app', fileId: 'f1', name: 'a.pdf', rev: 'v1', accessToken: 'x' });
  assert.strictEqual(tok.ok, false);
  assert.match(tok.reason, /토큰/);
});

test('★★ 앱 출처는 연결 단추 목록에 뜨지 않는다 (고를 창이 없다)', () => {
  const storage = require('../connectors/storage.js');
  assert.ok(storage.KNOWN_IDS.includes('linkpilot-app'), '아는 목록에 없다 — 참조가 거절된다');
  assert.ok(!storage.PROVIDER_IDS.includes('linkpilot-app'),
    '단추 목록에 앱이 떴다 — 누를 창이 없는 단추다');
  assert.ok(!storage.REGISTRATION.some(r => r.provider === 'linkpilot-app'),
    '콘솔 등록 목록에 앱이 들어갔다 — 등록할 콘솔이 없다');
  // 범위 검사는 해당 없음이다. 「검사했다」로 넘기지 않고 그렇게 말한다
  const sc = storage.checkScope('linkpilot-app', '');
  assert.strictEqual(sc.ok, true);
  assert.strictEqual(sc.internal, true);
  assert.deepStrictEqual(sc.tooWide, []);
  // 출처 한 줄이 코드값이 아니라 **사람이 읽는 이름**으로 나온다
  const linked = require('../core/linked.js');
  const cite = linked.citation({ provider: 'linkpilot-app', name: 'a.pdf',
    path: '/deal/8842/a.pdf', rev: 'v3', readAt: '2026-08-21T09:00:00+09:00' });
  assert.match(cite, /^LinkPilot 앱 · \/deal\/8842\/a\.pdf · 판 v3 · 2026-08-21 읽음/);
  assert.match(cite, /사본 보관 안 함$/);
  assert.ok(!/linkpilot-app/.test(cite), '출처에 코드값이 그대로 실렸다');
});

test('★★ 앱 출처 이름은 서버가 정한다 (화면의 대비값과 같아야 한다)', async () => {
  const storage = require('../connectors/storage.js');
  const W = require('../ui/report-api.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-appprov-'));
  process.env.IM_AGENT_ROOT = tmp;
  const h = W.createHandlers({
    agentRoot: tmp, agentModulePath: path.join(__dirname, '..'),
    authenticate: () => ({ planId: 'pro', status: 'active' }),
  });
  try {
    const made = await h.createProject({ headers: {} }, { request: '인천 남동공단 데이터센터' });
    const r = await h.listLinked({ headers: {} }, made.body.projectId);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.appProvider, 'linkpilot-app', '서버가 앱 출처 이름을 안 알려 준다');
    assert.ok(!r.body.providers.some(p => p.id === 'linkpilot-app'),
      '단추 목록 응답에 앱이 섞였다');

    // ★ 화면이 들고 있는 대비값이 서버 값과 **같아야 한다.** 갈리면 옛 서버에서
    //   조용히 거절된다 — 이번 사고가 정확히 그 모양이었다
    const screen = read('files.html');
    const m = screen.match(/var APP_PROVIDER = '([^']+)';/);
    assert.ok(m, '화면에서 대비값을 못 찾았다 — 대조가 불가능해졌다');
    assert.strictEqual(m[1], storage.INTERNAL_IDS[0],
      '화면의 대비값이 서버가 정한 이름과 다르다');
    // 그리고 화면은 **서버 값을 먼저** 쓴다
    assert.match(codeOf(screen), /state\.linked && state\.linked\.appProvider\) \|\| APP_PROVIDER/,
      '화면이 서버가 알려 준 이름을 안 쓴다');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

/**
 * ★★ **가짜 서버가 진짜보다 너그러우면 안 된다.**
 *
 * 이번 사고가 미리보기에서 안 잡힌 이유가 이것이다 — 데모 서버는
 * `provider === 'linkpilot-app'` 이면 그냥 받아 줬고, 진짜 검증기는 거절했다.
 * 미리보기는 초록이었고 실기기에서만 「첨부 0개」가 떴다.
 * (심지어 데모 참조에는 `rev` 도 없었다 — 그것도 진짜였다면 거절이다.)
 */
test('★★ 미리보기의 가짜 서버가 진짜 검증기와 같은 기준으로 거절한다', async () => {
  const storage = require('../connectors/storage.js');
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const out = path.join(os.tmpdir(), 'lp-files-strict-test.html');
  try {
    await buildLive(out);
    const html = fs.readFileSync(out, 'utf8');
    // 진짜 목록을 **심어서** 쓴다 (손으로 옮겨 적지 않는다)
    assert.ok(html.includes(JSON.stringify(storage.KNOWN_IDS)),
      '가짜 서버가 진짜 목록을 안 쓴다 — 데모만 초록이 될 수 있다');
    assert.match(html, /KNOWN_IDS\.indexOf\(String\(ref\.provider/, '모르는 저장소를 안 거른다');
    assert.match(html, /if \(!ref\.rev\)/, '판(rev) 없는 참조를 데모가 받아 준다');
    // 데모 참조에도 판이 들어 있어야 한다 — 없으면 데모가 자기 서버에 거절당한다
    assert.ok(!/provider: 'linkpilot-app'[^}]*name: '[^']+', kind:/.test(html),
      '데모 참조에 판(rev)이 빠졌다');
  } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
});

/* ═════════ 원본이 그대로인가 (2026-08-21 · D-72 결정) ═════════
 *
 * ★★ 「그때그때 고르기」로 가기로 했다 — 남의 저장소 열쇠를 **보관하지 않는다.**
 *   그래서 **폴더를 지켜볼 수가 없다.** 원본이 바뀌어도 우리는 모른다.
 *   대신 사람이 눌러서 묻는다. 그 길(`POST /linked/verify`)은 서버에 처음부터
 *   있었는데 **화면이 한 번도 안 불렀다** — 만들어 놓고 아무도 안 부르는 것이었다.
 */

test('★★ 연결한 원본이 그대로인지 화면에서 물어볼 수 있다', () => {
  const code = codeOf(read('files.html'));
  assert.match(code, /\/linked\/verify/, '확인하는 길을 화면이 안 부른다');
  assert.match(code, /function checkLinked\(/);
  // ★ 폴더를 안 지켜보는 **이유**를 화면이 말한다. 안 말하면 「왜 자동이 아니냐」가 된다
  assert.match(code, /열쇠를 보관하지 않기 때문입니다/,
    '왜 사람이 눌러야 하는지 화면이 말하지 않는다');
  // ★ 등급 부족이 화면 전체를 잠그지 않는다
  assert.match(code, /'\/linked\/verify',\s*\n?\s*\{\},\s*\{ localGate: true \}/,
    '확인 하나 때문에 탭 전체가 잠긴다');
});

test('★★ 확인 결과를 종류별로 갈라 말한다 (뭉치면 할 일을 모른다)', () => {
  const code = codeOf(read('files.html'));
  // 넷은 사용자가 할 일이 각각 다르다
  assert.match(code, /원본이 바뀌었습니다/, '바뀐 것을 안 말한다');
  assert.match(code, /원본이 없습니다/, '사라진 것을 안 말한다');
  assert.match(code, /아직 한 번도 읽지 않아/, '못 견준 것을 「그대로」로 센다');
  assert.match(code, /c\.errors \|\| \[\]/, '못 확인한 것을 숨긴다');
  // ★ 「그대로다」는 **센 것만** 말한다
  assert.match(code, /\(c\.ok_ \|\| \[\]\)\.length/, '센 것과 다른 수를 말한다');
});

test('★★ 실제 브라우저에서 확인이 돌고, 만료를 고장으로 그리지 않는다', () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-chk-'));
  const frag = path.join(dir, 'frag.html');

  return buildLive(frag).then(() => {
    const probe = `
    <div id="probe"></div>
    <script>
    (async function () {
      var sleep = function (m) { return new Promise(function (r) { setTimeout(r, m); }); };
      var t = function (n) { return n ? (n.textContent || '').trim().replace(/\\s+/g, ' ') : null; };
      var o = {};
      await sleep(200);
      var sel = document.querySelector('select');
      sel.value = 'app:deal-9107';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      var go = null;
      for (var w = 0; w < 1200; w++) {
        go = [].slice.call(document.querySelectorAll('.btn')).filter(function (b) {
          return t(b) === '가져오기'; })[0];
        if (go && !go.disabled) break;
        await sleep(20);
      }
      go.click();
      for (var k = 0; k < 250; k++) { await sleep(20); if (document.querySelector('.up--done, .up--error')) break; }
      await sleep(200);
      [].slice.call(document.querySelectorAll('.pw')).filter(function (b) {
        return t(b).indexOf('폴더를') === 0; })[0].click();
      await sleep(150);
      o.btn = t(document.querySelector('.chk__b'));
      document.querySelector('.chk__b').click();
      for (var j = 0; j < 150; j++) { await sleep(20); if (document.querySelector('.chk__r')) break; }
      o.title = t(document.querySelector('.chk__t'));
      o.lines = [].slice.call(document.querySelectorAll('.chk__l li')).map(t);
      // ★ 빨간 「오류」 상자로 그리지 않는다 — 만료는 고장이 아니라 상태다
      o.errBoxes = document.querySelectorAll('.err').length;
      document.getElementById('probe').textContent = JSON.stringify(o);
    }());
    </script>`;
    const page = path.join(dir, 'page.html');
    fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>'
      + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');
    const dom = renderDom(findBrowser(), page, 30000);
    const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
    assert.ok(m && m[1], '탐침이 아무것도 안 남겼다');
    const r = JSON.parse(m[1]);
    assert.match(r.btn, /원본이 그대로인지 확인/, '확인 단추가 없다');
    assert.match(r.title, /확인이 필요한 것이/, '결과를 안 그린다');
    assert.ok(r.lines.some(x => /원본이 바뀌었습니다/.test(x)), '바뀐 것을 안 보여 준다');
    assert.ok(r.lines.some(x => /다시 골라 주세요/.test(x)), '만료를 안 보여 준다');
    // ★★ 만료를 **빨간 오류**로 그리면 고장으로 읽힌다 — 이 선택의 값일 뿐이다
    assert.equal(r.errBoxes, 0, '만료를 오류 상자로 그렸다');
  }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
});

/* ═════════ ⑨ 넣었으면 읽고, 읽었으면 넘긴다 (2026-08-21 사용자 지시) ═════════ */

/**
 * ★★ **「보인다」가 아니라 「간다」를 잰다.** 스캔 칸이 그려지는 것과 실제로
 *   2단계로 넘어가는 것은 다른 확인이다 — 넘기는 것은 앱이고, 이 화면은
 *   `lp-open-project` 를 쏘기만 한다. 그 신호가 실제로 나가는지를 본다.
 *
 * ★ 신호가 안 나가면 사용자는 「올렸는데 아무 일도 안 일어난다」를 본다.
 *   화면은 멀쩡하고 오류도 없다 — 그래서 눈으로는 절대 안 잡힌다.
 */
test('★★ 파일업로드로 넣으면 읽고 「보고서 생성」으로 넘긴다', async () => {
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-scan-move-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = `
    <div id="probe"></div>
    <script>
    (async function () {
      var sleep = function (m) { return new Promise(function (r) { setTimeout(r, m); }); };
      var t = function (n) { return n ? (n.textContent || '').trim().replace(/\\s+/g, ' ') : null; };
      var o = { moves: [] };
      // ★ 앱 노릇을 한다 — 받았다고 답해야 화면이 「넘겼습니다」를 말할 수 있다
      document.addEventListener('lp-open-project', function (ev) {
        o.moves.push(ev.detail);
        ev.preventDefault();
      });
      await sleep(200);
      var sel = document.querySelector('.pick select');
      sel.value = 'LP-DC-2026-001';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
      // 「파일업로드」 갈래로 옮긴다
      var ways = [].slice.call(document.querySelectorAll('.pw'));
      var up = ways.filter(function (b) { return /파일업로드/.test(t(b)); })[0];
      o.wayCount = ways.length;
      if (up) up.click();
      await sleep(150);
      // 파일 하나를 떨어뜨린다 (input 에 직접 넣는다 — 고르기 창은 못 연다)
      var inp = document.querySelector('.drop input[type=file]');
      o.hasInput = !!inp;
      var dt = new DataTransfer();
      dt.items.add(new File([new Blob(['총사업비 2,846억원'])], '계획서.txt', { type: 'text/plain' }));
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      // FileReader 는 타이머가 아니다 — 단추가 열릴 때까지 **기다린다**
      var go = null;
      for (var w = 0; w < 1200; w++) {
        go = [].slice.call(document.querySelectorAll('.btn')).filter(function (b) {
          return /파일업로드/.test(t(b)); })[0];
        if (go && !go.disabled) break;
        await sleep(20);
      }
      o.ready = !!(go && !go.disabled);
      if (go) go.click();
      for (var k = 0; k < 300; k++) {
        await sleep(20);
        if (o.moves.length) break;
      }
      o.note = [].slice.call(document.querySelectorAll('.note')).map(t).join(' // ');
      o.errBoxes = document.querySelectorAll('.err').length;
      document.getElementById('probe').textContent = JSON.stringify(o);
    }());
    </script>`;
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  try {
    const dom = renderDom(findBrowser(), page, 30000);
    const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
    assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 스크립트가 죽었다');
    const r = JSON.parse(m[1]);
    assert.equal(r.errBoxes, 0, '오류 상자가 떴다');
    assert.equal(r.wayCount, 3, `갈래가 셋이 아니다 (${r.wayCount}개)`);
    assert.ok(r.hasInput, '파일 고르기 칸이 없다');
    assert.ok(r.ready, '파일을 읽고도 올리기 단추가 안 열렸다');
    // ★★ 핵심 — **실제로 넘어갔는가**
    assert.equal(r.moves.length, 1, `「보고서 생성」으로 안 넘겼다 (신호 ${r.moves.length}건)`);
    assert.equal(r.moves[0].section, F.SECTION.id, '엉뚱한 탭으로 넘겼다');
    assert.equal(r.moves[0].step, 'fields', '값이 들어간 2단계가 아니라 다른 단계로 넘겼다');
    assert.equal(r.moves[0].projectId, 'LP-DC-2026-001', '프로젝트를 안 실어 보냈다');
    // ★ 넘겼다는 것을 화면도 말해야 한다 — 앱이 안 받았을 때와 구분이 돼야 한다
    assert.match(r.note, new RegExp(F.SECTION.tab + '」으로 넘겼습니다'),
      `넘긴 것을 화면이 말하지 않는다: ${r.note}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/**
 * ★★ **값이 하나도 없으면 넘기지 않는다.** 넘기면 2단계에서 빈 칸만 보게 되고,
 *   사용자는 자기가 뭘 잘못한 줄 안다. 여기서 「무엇을 못 읽었는지」를 먼저 본다.
 */
test('★★ 읽었는데 값이 0이면 넘기지 않고 이유를 보여 준다', async () => {
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-scan-stay-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = `
    <div id="probe"></div>
    <script>
    (async function () {
      var sleep = function (m) { return new Promise(function (r) { setTimeout(r, m); }); };
      var t = function (n) { return n ? (n.textContent || '').trim().replace(/\\s+/g, ' ') : null; };
      var o = { moves: [] };
      document.addEventListener('lp-open-project', function (ev) { o.moves.push(ev.detail); ev.preventDefault(); });
      // ★ 예시 서버 위에 한 겹 덮는다 — 「읽었는데 값이 0」은 실제로 흔하다
      //   (글자 없는 스캔본 · OCR 키 없음). 그 답을 만들어 준다
      var prev = window.fetch;
      window.fetch = function (url, opt) {
        if (/\\/scan$/.test(String(url))) {
          return Promise.resolve({ ok: true, status: 200, json: function () {
            return Promise.resolve({ scanned: [{ name: '스캔본.png', how: 'ocr', ocr: true, readable: true }],
              unread: [], facts: 0, documents: 0, empty: true });
          } });
        }
        return prev.apply(this, arguments);
      };
      await sleep(200);
      var sel = document.querySelector('.pick select');
      sel.value = 'LP-DC-2026-001';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
      var scan = [].slice.call(document.querySelectorAll('.btn')).filter(function (b) {
        return t(b) === '자료 스캔'; })[0];
      o.hasScan = !!scan;
      if (scan) scan.click();
      for (var k = 0; k < 200; k++) { await sleep(20); if (document.querySelector('.up')) break; }
      o.box = t(document.querySelector('.up'));
      o.errBoxes = document.querySelectorAll('.err').length;
      document.getElementById('probe').textContent = JSON.stringify(o);
    }());
    </script>`;
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  try {
    const dom = renderDom(findBrowser(), page, 30000);
    const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
    assert.ok(m && m[1], '탐침이 아무것도 안 남겼다');
    const r = JSON.parse(m[1]);
    assert.equal(r.errBoxes, 0, '오류 상자가 떴다');
    assert.ok(r.hasScan, '스캔 단추가 없다');
    assert.equal(r.moves.length, 0, '값이 0인데 다음 단계로 넘겼다 — 빈 칸만 보게 된다');
    // ★ **왜 안 넘어갔는지**를 말해야 한다. 아무 말 없이 안 가면 고장으로 읽힌다
    assert.match(r.box, /넘어가지 않았습니다/, `안 넘어간 이유를 안 말한다: ${r.box}`);
    assert.match(r.box, /OCR/, '무엇을 어떻게 읽었는지 안 보여 준다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ═════════ ⑩ 프로젝트 고르는 자리는 **하나뿐**이다 (2026-08-21 사용자 지시) ═════════ */

/**
 * ★★ 전에는 **둘**이었다. 화면 맨 위에 고르기가 있고, 「＋ 앱 프로젝트에서
 *   가져오기」 갈래 안에 앱 딜 고르기가 또 있었다. 같은 앱 딜이 두 곳에 뜨고
 *   둘이 같은 함수를 부르니, 화면만 봐서는 **어느 쪽이 진짜인지 모른다.**
 *   사용자가 「상단을 지우고 갈래로 병합」이라고 정했다.
 *
 * ★★ 자리를 하나로 모으면 **막다른 길**이 생길 수 있다 — 다른 갈래로 열었는데
 *   프로젝트가 없으면 고를 방법이 화면에 안 보인다. 그래서 **한 번에 가는
 *   단추**를 둔다. 이 검사는 그 단추가 실제로 데려다주는지까지 본다.
 */
test('★★ 프로젝트 고르기가 하나뿐이고, 다른 갈래에서 한 번에 갈 수 있다', async () => {
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-onepick-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = `
    <div id="probe"></div>
    <script>
    (async function () {
      var sleep = function (m) { return new Promise(function (r) { setTimeout(r, m); }); };
      var t = function (n) { return n ? (n.textContent || '').trim().replace(/\\s+/g, ' ') : null; };
      var o = {};
      await sleep(250);
      // ① 화면 전체에 고르기는 하나다
      o.pickers = document.querySelectorAll('.pick select').length;
      o.firstWay = t(document.querySelector('.pw.on .pw__t'));
      var sel = document.querySelector('.pick select');
      o.groups = [].slice.call(sel.querySelectorAll('optgroup')).map(function (g) { return g.label; });
      o.second = sel.children[1] && sel.children[1].textContent;

      // ② 다른 갈래에는 고르기가 없고, 대신 **가는 단추**가 있다
      [].slice.call(document.querySelectorAll('.pw')).filter(function (b) {
        return /파일업로드/.test(t(b)); })[0].click();
      await sleep(150);
      o.pickersElsewhere = document.querySelectorAll('.pick select').length;
      var back = [].slice.call(document.querySelectorAll('.btn2')).filter(function (b) {
        return /로 가기/.test(t(b)); })[0];
      o.hasBack = !!back;

      // ③ 그 단추가 실제로 데려다준다 (있다고 적어만 두면 막다른 길이다)
      if (back) back.click();
      await sleep(200);
      o.afterBackWay = t(document.querySelector('.pw.on .pw__t'));
      o.afterBackPickers = document.querySelectorAll('.pick select').length;

      // ④ 「＋ 신규프로젝트」가 **갈래 안에서** 열린다 (다른 탭으로 안 보낸다)
      var s2 = document.querySelector('.pick select');
      s2.value = 'new:';
      s2.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(250);
      o.newInputs = document.querySelectorAll('.new input').length;
      o.cards = document.querySelectorAll('section.card').length;
      o.titles = [].slice.call(document.querySelectorAll('.card__t')).map(t);

      // ⑤ 프로젝트를 고르면 붙이기·스캔이 열린다
      var s3 = document.querySelector('.pick select');
      s3.value = 'LP-DC-2026-001';
      s3.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(400);
      o.afterPick = [].slice.call(document.querySelectorAll('.card__t')).map(t);
      o.errBoxes = document.querySelectorAll('.err').length;
      document.getElementById('probe').textContent = JSON.stringify(o);
    }());
    </script>`;
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  try {
    const dom = renderDom(findBrowser(), page, 30000);
    const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
    assert.ok(m && m[1], '탐침이 아무것도 안 남겼다');
    const r = JSON.parse(m[1]);
    assert.equal(r.errBoxes, 0, '오류 상자가 떴다');

    // ① 하나뿐
    assert.equal(r.pickers, 1, `프로젝트 고르기가 ${r.pickers}개다 — 상단 고르기가 되살아났는가`);
    assert.match(r.firstWay, /앱 프로젝트에서 가져오기/,
      `처음 갈래가 고르는 자리가 아니다(${r.firstWay}) — 열자마자 아무것도 못 하는 화면이 된다`);
    // 셋이 한 목록에 있다
    assert.ok(r.groups.includes('보고서 프로젝트'), '보고서 프로젝트 무리가 없다');
    assert.ok(r.groups.includes('앱 프로젝트에서 가져오기'), '앱 딜 무리가 없다');
    assert.match(r.second, /신규프로젝트/, '「＋ 신규프로젝트」가 맨 위가 아니다');

    // ② 다른 갈래에는 고르기를 또 그리지 않는다
    assert.equal(r.pickersElsewhere, 0, '다른 갈래에도 고르기를 그린다 — 다시 둘이 됐다');
    assert.ok(r.hasBack, '다른 갈래에서 고르는 자리로 갈 길이 없다 — 막다른 길이다');

    // ③ 단추가 실제로 데려다준다
    assert.match(r.afterBackWay, /앱 프로젝트에서 가져오기/, '단추를 눌러도 안 옮겨진다');
    assert.equal(r.afterBackPickers, 1, '옮겨졌는데 고르기가 없다');

    // ④ 만들기가 갈래 안에서 열리고, 카드가 겹치지 않는다
    assert.equal(r.newInputs, 1, '「＋ 신규프로젝트」를 골랐는데 적는 칸이 없다');
    assert.ok(r.titles.includes('신규프로젝트'), '만드는 칸 제목이 없다');
    assert.equal(r.cards, 1, `카드가 ${r.cards}개다 — 갈래 안에 카드를 또 둘러 테두리가 겹친다`);

    // ⑤ 고르면 붙이기·스캔이 열린다
    assert.ok(r.afterPick.includes('자료 스캔'),
      `프로젝트를 골랐는데 스캔 칸이 없다: ${r.afterPick.join(' | ')}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ═════════ ⑪ 좁은 화면에서만 부푸는 것 ═════════ */

/**
 * ★★ **실측으로 잡은 버그다** 〈2026-08-21〉. 고르기 칸에 `flex: 1 1 240px` 을
 *   줬는데, 좁은 화면에서 `flex-direction: column` 으로 바뀌면 그 240px 이
 *   **너비가 아니라 높이**가 된다. 칸 하나가 세로 240px 로 부풀었다.
 *
 * ★ 오류는 안 난다. **넓은 화면에서는 멀쩡하다.** 그래서 넓은 창으로만 재는
 *   검사는 이것을 절대 못 잡는다 — **좁혀서 재야** 잡힌다.
 *
 * ★ 「글씨 크기가 CSS 대로인가」와 같은 계열이다(58군데 font 축약형). 화면 치수는
 *   **소스를 읽어서가 아니라 브라우저에게 물어서** 확인한다.
 */
test('★★ 좁은 화면에서 고르기 칸이 세로로 부풀지 않는다', async () => {
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const { findBrowser } = require(path.join(PLATFORM, 'build-static.js'));
  const browser = findBrowser();
  if (!browser) return;
  const { execFileSync } = require('child_process');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-narrow-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = `
    <script>
    setTimeout(function () {
      var s = document.querySelector('.pick select');
      var r = s ? s.getBoundingClientRect() : null;
      var pre = document.createElement('pre');
      pre.id = 'M';
      pre.textContent = JSON.stringify(r ? {
        w: Math.round(r.width), h: Math.round(r.height),
        dir: getComputedStyle(s.parentNode).flexDirection,
        over: document.documentElement.scrollWidth > innerWidth,
      } : null);
      document.body.appendChild(pre);
    }, 700);
    </script>`;
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  const measure = (w) => {
    const dom = execFileSync(browser, ['--headless', '--disable-gpu', '--no-sandbox',
      '--hide-scrollbars', '--window-size=' + w + ',900', '--virtual-time-budget=15000',
      '--dump-dom', 'file://' + page], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const m = dom.match(/<pre id="M">([^<]*)<\/pre>/);
    assert.ok(m && m[1], `창 ${w}px: 탐침이 아무것도 안 남겼다`);
    return JSON.parse(m[1]);
  };

  try {
    const narrow = measure(430);
    const wide = measure(1100);

    assert.ok(narrow, '좁은 화면에 고르기 칸이 없다');
    // ★ 한 줄짜리 고르기 칸이다. 두 줄을 넘으면 무언가 부푼 것이다
    assert.ok(narrow.h < 70,
      `좁은 화면에서 고르기 칸이 세로 ${narrow.h}px 다 — flex-basis 가 높이로 먹었는가`);
    assert.ok(wide.h < 70, `넓은 화면에서도 세로 ${wide.h}px 다`);
    // ★ 좁은 화면에서는 세로로 쌓이는 것이 맞다 (그건 의도한 것이다)
    assert.equal(narrow.dir, 'column', '좁은 화면에서 라벨과 목록이 안 쌓인다');
    assert.equal(wide.dir, 'row', '넓은 화면에서 한 줄로 안 놓인다');
    // ★ 가로로 넘치면 본문이 좌우로 흔들린다
    assert.equal(narrow.over, false, '좁은 화면에서 가로로 넘친다');
    // ★ 좁을수록 칸은 좁아져야 한다 — 안 그러면 폭을 안 따라간 것이다
    assert.ok(narrow.w < wide.w, `좁혔는데 칸이 안 좁아진다 (${narrow.w} vs ${wide.w})`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
