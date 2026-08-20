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
  ['올려서 보관', '연결해서 쓰기', '1회성으로 올리기'].forEach((w) => {
    assert.ok(html.includes(w), `세 갈래 중 '${w}' 가 화면에 없다`);
  });
  assert.ok(html.includes('사본을 만들지 않습니다'),
    '연결이 사본을 안 만든다는 말이 없다 — 「업로드」로 읽힌다');
  assert.ok(html.includes('다시 쓸 수 없'),
    '1회성이 재사용 불가라는 말이 없다 — 올린 뒤에 알면 늦다');
});

test('★★ 1회성은 올리기 **전에**, 그리고 **한 번만** 경고한다', () => {
  const code = codeOf(read('files.html'));
  const hits = code.split('올리기 전에 확인해 주세요').length - 1;
  assert.equal(hits, 1, `경고가 ${hits}번 나온다 — 같은 말을 두 번 하면 읽지 않는다`);

  // ★ 경고는 **고르는 자리**(붙이기 칸)에 있어야 한다. 아래 목록에 두면
  //   이미 올린 뒤에 읽게 된다
  const warn = code.indexOf('올리기 전에 확인해 주세요');
  const drop = code.indexOf("card.appendChild(dropZone())");
  assert.ok(warn > 0 && drop > 0 && warn < drop,
    '경고가 파일 고르기보다 뒤에 있다 — 고르고 나서 읽는다');
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
test('★★ 세 갈래를 고를 수 있다 (설명만이 아니다)', () => {
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
    ['올려서 보관', '연결해서 쓰기', '1회성으로 올리기'].forEach((w) => {
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
