'use strict';
/**
 * embed.test.js — 이관 ②③④ (2026-08-18).
 *
 * ★★ 왜 있나: 본체가 배포용 사본을 만들면서 **원본 글자를 찾아 끼워 넣고**
 *   있었다. 앵커가 되는 줄이 한 글자만 바뀌면 치환이 빗나가고, 그러면
 *   **설정이 안 들어간 사본이 나간다** — 화면은 멀쩡히 뜨고 값만 비어 있다.
 *   실제로 새 화면(`files.html`)은 그 목록에 없어서 목록이 비었다.
 *
 * 여기서 지키는 것:
 *   ① 화면마다 브리지가 **올바른 자리**에 있다 (순서가 틀리면 조용히 덮인다)
 *   ② 배포용 사본 목록이 실제 참조와 같다
 *   ③ 브리지가 **부모 설정을 실제로 병합한다** (헤드리스 실호출)
 *   ④ NAS 반영 스크립트가 문법이 맞고 되돌리는 길을 낸다
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const embed = require('../ui/platform/build-embed.js');
const FLOW = require('../ui/platform/flow-core.js');

/* ═════════ ① 브리지 자리 ═════════ */

/**
 * ★★ **있는지만 보지 않는다.** 대입 패턴이면 브리지가 **뒤**에, 병합 패턴이면
 *   **앞**에 있어야 한다. 반대로 두면 대입이 병합을 덮어써서 설정이 사라진다 —
 *   그리고 화면은 기본값으로 멀쩡히 뜬다. 실제로 한 번 그렇게 만들었다.
 */
test('★★ 화면마다 브리지가 올바른 자리에 있다', () => {
  Object.keys(embed.GLOBALS).forEach((f) => {
    const r = embed.checkBridge(f);
    assert.strictEqual(r.ok, true, `${f}: ${r.why}`);
  });
});

test('★ 브리지가 전역 이름을 스스로 정하지 않는다 (태그가 알려 준다)', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'embed-bridge.js'), 'utf8');
  assert.match(src, /getAttribute\('data-lp-global'\)/,
    '전역 이름을 코드에 박아 두면 화면마다 브리지를 따로 만들게 된다');
  // 이름을 모르면 아무것도 하지 않는다 — 엉뚱한 전역을 건드리지 않는다
  assert.match(src, /if \(!name\) return;/);
});

test('★ 브리지가 대입이 아니라 병합한다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'embed-bridge.js'), 'utf8');
  assert.ok(!/window\[name\] = cfg/.test(src), '대입하면 화면 기본값이 통째로 날아간다');
  assert.match(src, /Object\.keys\(src\)\.forEach/, '병합이 아니다');
  // 토큰은 헤더로만 쓰고 전역에 남기지 않는다
  assert.match(src, /delete target\.token/, '토큰이 전역에 남으면 로그·장부에 실릴 자리가 생긴다');
});

test('★ 다른 출처면 조용히 넘어가지 않고 이유를 남긴다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'embed-bridge.js'), 'utf8');
  assert.match(src, /같은 출처가 아닙니다/, '읽기 실패 이유가 없으면 「설정이 왜 없나」를 못 찾는다');
  assert.match(src, /state\.reason/);
});

test('★★ 중첩 화면도 설정을 받는다 — 직계 부모가 아니라 조상을 거슬러 읽는다 (D-92 실측)', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'embed-bridge.js'), 'utf8');
  /* 3·4·5단계(files/fields/intake)는 report-flow 안의 iframe 이라 window.parent 가 앱이 아니다.
     직계 부모만 보면 「부모가 채우지 않았습니다」가 나오고 토큰이 없어 401 이 난다(2026-08-23 실측). */
  assert.ok(!/var cfg = window\.parent\.LINKPILOT_EMBED/.test(src), '직계 부모만 본다 — 중첩 화면이 빈손이 된다');
  assert.match(src, /w = w\.parent/, '조상 탐색이 없다');
  // 실제 동작: 2단 중첩에서 꼭대기의 설정을 찾아낸다 (fromParent 만 떼어 실행)
  const m = src.match(/function fromParent\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(m, 'fromParent 본문을 찾지 못했다');
  const top = { LINKPILOT_EMBED: { common: { api: '/x', token: 't' } } }; top.parent = top;
  const mid = { parent: top }; const leaf = { parent: mid };
  const fn = new Function('window', 'state', m[0] + ' return fromParent();');
  const st = {}; const got = fn(leaf, st);
  assert.strictEqual(got, top.LINKPILOT_EMBED, '2단 중첩에서 꼭대기 설정을 못 찾았다: ' + st.reason);
});

/* ═════════ ② 배포용 사본 ═════════ */

test('★ 배포용 사본 목록이 실제 참조와 같다', () => {
  const r = embed.build(null);
  // 탭 셋 + 4단계 + 브리지 + 토큰
  FLOW.TABS.forEach(t => assert.ok(r.files.includes(t.file), `${t.file} 이 빠졌다`));
  assert.ok(r.files.includes('embed-bridge.js'), '브리지가 사본에 안 들어간다');
  assert.ok(r.files.includes('tokens.css'), '토큰이 빠지면 색 없이 뜬다');
  r.files.forEach((f) => {
    assert.ok(fs.existsSync(path.join(PLATFORM, f)), `${f} 이 실제로 없다`);
    assert.match(r.manifest.files[f].sha256, /^[0-9a-f]{64}$/);
  });
});

/** ★ 확인에 걸리면 **만들지 않는다** — 설정 없는 사본이 나가는 것이 더 나쁘다 */
test('★★ 브리지가 어긋나면 사본을 만들지 않는다', () => {
  const f = path.join(PLATFORM, 'outputs.html');
  const keep = fs.readFileSync(f, 'utf8');
  try {
    fs.writeFileSync(f, keep.replace(/<script src="embed-bridge\.js"[^>]*><\/script>/, ''), 'utf8');
    assert.throws(() => embed.build(null), /브리지 확인 실패/);
  } finally { fs.writeFileSync(f, keep, 'utf8'); }
});

test('★ 사본을 실제로 쓸 수 있다 (--out)', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-out-'));
  try {
    const r = embed.build(out);
    r.files.forEach(f => assert.ok(fs.existsSync(path.join(out, f)), `${f} 이 안 써졌다`));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

/* ═════════ ④ NAS 반영 스크립트 ═════════ */

test('★ deploy/nas.sh 가 문법이 맞고 되돌리는 길을 낸다', () => {
  const p = path.join(ROOT, 'deploy', 'nas.sh');
  assert.ok(fs.existsSync(p), 'deploy/nas.sh 가 없다');
  execFileSync('bash', ['-n', p]);          // 문법 오류면 여기서 던진다
  const src = fs.readFileSync(p, 'utf8');
  // 덮어쓰기 전에 백업 — 없으면 되돌리려고 다시 tar 를 말아야 한다
  assert.match(src, /im-agent\.bak-/, '백업을 안 뜬다');
  assert.match(src, /되돌리려면/, '되돌리는 명령을 안 알려 준다');
  // 「올렸다」로 끝내지 않는다
  assert.match(src, /sha256sum/, '지문 대조가 없다 — 전송 성공이 내용 일치는 아니다');
  assert.match(src, /healthz/, '살아났는지 안 묻는다');
});

test('★ dry-run 이 아무것도 건드리지 않고 돈다', () => {
  // ★ 주소는 **환경변수로만** 받는다 (D-10). 저장소에 기본값을 두지 않으므로
  //   테스트도 넣어 줘야 한다 — 닿지 않는 주소를 준다 (dry-run 은 부르지 않는다)
  const out = execFileSync('bash', [path.join(ROOT, 'deploy', 'nas.sh'), '--dry-run'],
    { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { LP_NAS_HOST: 'u@example.invalid' }) });
  assert.match(out, /dry-run/);
  assert.match(out, /되돌리려면/);
});

/**
 * ★★ **접속정보를 저장소에 두지 않는다** — public 이다 (D-10 · M-13).
 *
 * 기본값을 두면 그 기본값이 곧 공개다. 그래서 주소가 없으면 **멈춘다.**
 * 「없으면 알아서 되겠지」로 두면 다음 사람이 다시 기본값을 넣는다.
 */
test('★★ 주소가 없으면 배포 스크립트가 멈춘다 (기본값을 두지 않는다)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'deploy', 'nas.sh'), 'utf8');
  assert.doesNotMatch(src, /LP_NAS_HOST:-[^}\s]/, '접속 주소 기본값이 다시 들어왔다 — public 이다');

  let code = 0; let out = '';
  try {
    execFileSync('bash', [path.join(ROOT, 'deploy', 'nas.sh'), '--dry-run'],
      { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { LP_NAS_HOST: '' }) });
  } catch (e) { code = e.status; out = (e.stderr || '') + (e.stdout || ''); }
  assert.notEqual(code, 0, '주소 없이도 그냥 돌았다');
  assert.match(out, /LP_NAS_HOST/, '무엇을 넣어야 하는지 안 알려 준다');
});

/* ═════════ ④ verify:nas ═════════ */

test('★★ verify:nas 는 못 잰 것을 통과로 세지 않는다', () => {
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', [path.join(__dirname, '..', 'tools', 'verify-nas.js')],
      { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { LP_BASE: '' }) });
  } catch (e) { out = e.stdout || ''; code = e.status; }
  assert.match(out, /못 잰 것은 통과가 아니다/,
    '주소가 없으면 「서버는 못 쟀다」가 보여야 한다 — 초록으로 읽히면 안 된다');
  assert.strictEqual(code, 2, '못 잰 것이 있으면 0 으로 끝나면 안 된다');
});

test('★ verify:nas 가 저장소만으로 아는 것은 실제로 잰다', () => {
  let out = '';
  try {
    out = execFileSync('node', [path.join(__dirname, '..', 'tools', 'verify-nas.js')],
      { cwd: ROOT, encoding: 'utf8' });
  } catch (e) { out = e.stdout || ''; }
  assert.match(out, /탭 둘이 flow-core 한 곳에서 나온다/);
  assert.match(out, /라우트 표/);
  assert.match(out, /읽기 6 · 쓰기 23 = 29/);
});



/* ═════════ ⑤ 토큰이 **두 길 모두**에 붙는가 ═════════ */

/**
 * ★★★ **`fetch` 만 덮으면 자료 올리기가 401 이 된다** 〈2026-08-22 · 실제 사고〉.
 *
 * ★★ 무슨 일이 있었나. 3.8MB 를 올리는데 「**로그인이 필요합니다**」가 떴다.
 *   로그인은 되어 있었고 프로젝트 목록도 화면에 떠 있었다.
 *
 *   원인은 보내는 길이 **둘**이라는 것이었다:
 *
 *       목록 읽기   fetch            → 브리지가 덮음 → Authorization 붙음 → 200
 *       자료 올리기 XMLHttpRequest   → **안 덮음**   → 헤더 없음         → 401
 *
 *   올리기가 XHR 인 이유는 **진행률**이다 — fetch 에는 업로드 진행 이벤트가
 *   없어서 upload-core.js 가 XHR 을 쓴다. 그 한 곳만 인증에서 빠져 있었다.
 *
 * ★★ 이 결함이 비싼 이유는 **증상이 로그인 문제로 보인다**는 것이다. 사용자는
 *   로그인을 다시 하고, 세션을 의심하고, 본문 한도를 뒤진다 — 전부 엉뚱한
 *   자리다. 실제로 세 번 헤맸고, 화면 안내문까지 「크기 문제일 수 있다」고
 *   **틀린 방향**을 가리키고 있었다.
 *
 * ★★ 그래서 **실제 브라우저에서 진짜 XHR 을 보내 헤더를 받아 본다.** 소스만
 *   훑으면 「XMLHttpRequest 라는 글자가 있다」까지밖에 못 재고, 그건 붙었다는
 *   뜻이 아니다 (M-08).
 *
 * ★ file:// 끼리도 부모를 읽을 수 있어야 하므로 --allow-file-access-from-files
 *   를 준다. 이 검사에서만 쓰는 문이고, 실제 배포와는 무관하다.
 */
test('★★★ 브리지 토큰이 fetch 와 XHR 둘 다에 붙는다 (올리기가 401 이던 자리)', () => {
  const { findBrowser } = require(path.join(PLATFORM, 'build-static.js'));
  const browser = findBrowser();
  if (!browser) return;   // 크로미움이 없는 서버가 실제로 있다

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-xhr-auth-'));
  fs.copyFileSync(path.join(PLATFORM, 'embed-bridge.js'), path.join(dir, 'embed-bridge.js'));

  /* 아이 창 — 브리지를 얹기 **전에** 나가는 길 둘을 가로채 둔다.
     실제 화면도 브리지가 나중에 덮으므로 순서가 같다. */
  fs.writeFileSync(path.join(dir, 'child.html'), [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
    '<script>',
    '  window.__seen = { fetch: null, xhr: null, cross: null };',
    '  window.fetch = function (input, init) {',
    '    var h = new Headers((init && init.headers) || {});',
    '    window.__seen.fetch = h.get("Authorization");',
    '    return Promise.resolve({ ok: true, status: 200 });',
    '  };',
    '  var RO = XMLHttpRequest.prototype.open;',
    '  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__h = {}; return RO.apply(this, arguments); };',
    '  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { this.__h[String(k).toLowerCase()] = v; };',
    '  XMLHttpRequest.prototype.send = function () {',
    '    var key = /^https?:\\/\\//.test(this.__u) ? "cross" : "xhr";',
    '    window.__seen[key] = this.__h.authorization || null;',
    '  };',
    '</' + 'script>',
    '<script>window.LINKPILOT_FILES = {};</' + 'script>',
    '<script src="embed-bridge.js" data-lp-global="LINKPILOT_FILES"></' + 'script>',
    '</head><body><script>',
    '  fetch("/api/linkpilot/projects");',
    '  var x = new XMLHttpRequest();',
    '  x.open("POST", "/api/linkpilot/projects/LP-1/oneshot");',
    '  x.setRequestHeader("content-type", "application/json");',
    '  x.send("{}");',
    '  var y = new XMLHttpRequest();',            // 남의 서버로 가는 요청
    '  y.open("POST", "https://example.com/collect");',
    '  y.send("{}");',
    '</' + 'script></body></html>',
  ].join('\n'));

  /* 어미 창 — 앱 노릇을 한다. 토큰을 담아 두고 아이를 띄운 뒤 결과를 받아 적는다 */
  fs.writeFileSync(path.join(dir, 'parent.html'), [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
    '<script>window.LINKPILOT_EMBED = { common: { api: "/api/linkpilot", token: "T-0000-TEST" } };</' + 'script>',
    '</head><body><div id="out"></div>',
    '<iframe id="f" src="child.html"></iframe>',
    '<script>',
    '  document.getElementById("f").addEventListener("load", function () {',
    '    setTimeout(function () {',
    '      var s;',
    '      try { s = JSON.stringify(this.contentWindow.__seen); }',
    '      catch (e) { s = JSON.stringify({ err: e.name }); }',
    '      document.getElementById("out").textContent = s;',
    '    }.bind(this), 60);',
    '  });',
    '</' + 'script></body></html>',
  ].join('\n'));

  const dom = execFileSync(browser, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--virtual-time-budget=20000', '--dump-dom',
    'file://' + path.join(dir, 'parent.html'),
  ], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString();

  const m = dom.match(/<div id="out">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 어미 창이 아이를 못 읽었다');
  const seen = JSON.parse(m[1].replace(/&quot;/g, '"'));
  assert.ok(!seen.err, '아이 창을 못 읽었다 (' + seen.err + ') — 같은 출처가 아니다');

  assert.strictEqual(seen.fetch, 'Bearer T-0000-TEST', 'fetch 에 토큰이 안 붙는다');
  assert.strictEqual(seen.xhr, 'Bearer T-0000-TEST',
    'XHR 에 토큰이 안 붙는다 — 자료 올리기가 401 「로그인이 필요합니다」로 거절당한다');

  /* ★★ **남의 서버에는 붙이면 안 된다.** XHR 은 프로토타입을 덮으므로 화면이
       부르는 모든 요청을 지나간다. 아무 데나 붙이면 열쇠를 통째로 넘기는 것이다 */
  assert.strictEqual(seen.cross, null,
    '다른 출처로 가는 요청에도 토큰을 붙인다 — 열쇠가 남의 서버로 나간다');
});
