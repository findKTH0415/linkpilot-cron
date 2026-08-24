/**
 * **[열기] 가 아무것도 안 열었다 — 두 번째.**
 *
 * ★★★ 2026-08-24 사장님 화면: 산출물 일곱이 다 「완료」인데 [열기] 를 누르니
 *   빨간 줄이 떴다.
 *
 *     팝업이 차단되었습니다. 외부 브라우저(Chrome · Safari)에서 다시 열어
 *     주세요. 주소: /api/linkpilot/projects/LP-RE-2026-013/file?rel=…
 *
 *   ★ **두 겹으로 틀렸다.**
 *     ① 원인을 잘못 짚었다 — 사장님은 사파리에 계셨다. 막은 것은 브라우저가
 *        아니라 **앱 화면이 틀(iframe) 안이라서**다. 틀 안에서 스크립트가
 *        여는 새 창은 브라우저가 막는다.
 *     ② **시키는 대로 해도 안 되는 안내였다.** 적힌 주소는 상대 경로라
 *        도메인이 없고, 글자라서 누를 수도 없다.
 *
 * ★ 고친 방향: **여는 일을 브라우저에 맡긴다.** 사람이 누른 링크는 안 막힌다.
 *   `window.open` 은 인쇄창이 필요할 때만 쓰고, 막히면 **막지 않는다** —
 *   링크의 원래 동작이 그대로 이어진다.
 *
 * ★ 여기서 재는 것:
 *   ① 산출물 단추가 **진짜 링크**인가 (href 가 있는가)
 *   ② 인쇄가 막혀도 **링크의 기본 동작을 안 막는가**
 *   ③ 안내에 나오는 주소가 **절대 주소이고 누를 수 있는가**
 *   ④ 원인을 **셋으로 가르는가** (인앱 · 틀 안 · 맨 위)
 *   ⑤ 차단된 산출물은 여전히 **안 열리는가** (사유만 보인다)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'ui', 'platform', 'reports.html'), 'utf8');

/** ★ 주석을 떼고 본다 — 경위를 잘 적어 둘수록 검사가 눈이 먼다 (CLAUDE.md §8) */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('★★★ 산출물 단추가 진짜 링크다 — 틀(iframe) 안에서 막히지 않으려면 이것뿐이다', () => {
  assert.ok(/el\(isLink \? 'a' : 'button', 'out__a'/.test(CODE),
    '늘 button 으로 만든다 — 스크립트가 여는 새 창은 틀 안에서 막힌다');
  assert.ok(/a\.href = url;/.test(CODE), 'href 를 안 붙인다 — 링크가 아니다');
  assert.ok(/a\.target = '_blank';/.test(CODE));
  assert.ok(/a\.rel = 'noopener';/.test(CODE), 'noopener 가 없다');
});

/**
 * ★★★ **새 탭에는 인증이 안 붙는다** 〈2026-08-25 · M-33 의 재발〉.
 *
 *   앞 판에서 단추를 링크로 바꿔 **열리기는 했다.** 그런데 열린 탭이
 *   `{"error":"로그인이 필요합니다"}` 를 받았다 — 이 화면은 앱이 넘긴 자격으로
 *   API 를 부르는데 **새 탭은 그 자격을 안 들고 간다.**
 *
 * ★ 그래서 **화면이 직접 받아 온다.** 화면 안에서 부르는 길은 이미 인증돼 있다.
 */
test('★★★ 화면이 자격을 들고 직접 받아 온다 — 새 탭에 맡기지 않는다', () => {
  assert.ok(/function fetchAsBlob\(url, relPath\)/.test(CODE), '받아 오는 길이 없다');
  assert.ok(/credentials: 'same-origin'/.test(CODE), '자격을 안 싣는다');
  assert.ok(/URL\.createObjectURL\(blob\)/.test(CODE), 'blob 으로 안 만든다');
  /* ★ 링크를 그대로 따라가면 자격 없는 탭이 열린다 — 반드시 막고 우리가 연다 */
  assert.ok(/if \(ev && ev\.preventDefault\) ev\.preventDefault\(\);\s*\n\s*var busy/.test(CODE),
    '링크의 기본 동작을 안 막는다 — 자격 없는 탭이 열려 거절당한다');
});

test('★★★ 못 받으면 **서버가 말한 까닭**을 그대로 적는다 — 팝업 탓으로 안 돌린다', () => {
  assert.ok(/JSON\.parse\(t\) \|\| \{\}\)\.error/.test(CODE),
    '서버가 준 까닭을 안 읽는다');
  assert.ok(/을 못 받았습니다 — /.test(CODE));
  assert.ok(/로그인\/\.test\(e\.message\)/.test(CODE),
    '로그인 문제일 때 무엇을 하면 되는지 안 적는다');
});

test('★★ blob 주소를 바로 놓아 주지 않는다 — 열리기 전에 사라진다', () => {
  assert.ok(/setTimeout\(function \(\) \{ try \{ URL\.revokeObjectURL/.test(CODE),
    '만들자마자 지우면 새 창이 빈 화면이 된다');
});

test('★★ 인쇄창은 A4 인쇄본에만 띄운다', () => {
  assert.ok(/if \(printable\) \{\s*\n\s*try \{\s*\n\s*w\.addEventListener\('load'/.test(CODE),
    'printable 을 안 보고 늘 인쇄창을 띄운다');
});

test('★★★ 안내 주소가 **절대 주소**다 — 상대 경로는 붙여 넣어도 못 간다', () => {
  assert.ok(/function absUrl\(u\)/.test(CODE), '절대 주소로 바꾸는 곳이 없다');
  assert.ok(/new URL\(String\(u\), window\.location\.href\)\.href/.test(CODE));
  assert.ok(/var url = raw \? absUrl\(raw\) : null;/.test(CODE),
    '단추 주소를 절대 주소로 안 만든다');
  /* ★ 빈 주소를 절대 주소로 바꾸면 **이 페이지 자신**이 된다 — 누르면
   *   새로고침만 되고 파일은 안 열린다 〈검사가 실제로 잡은 자리다〉 */
  assert.ok(!/absUrl\(fileUrlFor\([^)]*\) \|\| ''\)/.test(CODE),
    '빈 주소를 절대 주소로 바꾼다 — 페이지 자신으로 가는 링크가 된다');
});

test('★★★ 안내에 나오는 주소가 **누를 수 있다** — 글자로 적으면 아무 소용이 없다', () => {
  const fn = CODE.slice(CODE.indexOf('function cantOpenNote'), CODE.indexOf('function openForPrint'));
  assert.ok(/a\.href = url;/.test(fn), '주소를 링크로 안 만든다');
  assert.ok(/el\('a', null, url\)/.test(fn));
  assert.ok(!/외부 브라우저\(Chrome · Safari\)에서 다시 열어 주세요/.test(CODE),
    '틀린 안내가 그대로 남아 있다 — 사장님은 이미 사파리에 계셨다');
});

test('★★★ 원인을 셋으로 가른다 — 인앱 · 틀 안 · 맨 위', () => {
  const fn = CODE.slice(CODE.indexOf('function whereAreWe'), CODE.indexOf('function fileUrlFor'));
  assert.ok(/inApp/.test(fn), '인앱 브라우저를 안 본다');
  assert.ok(/window\.top !== window\.self/.test(fn),
    '틀 안인지를 안 본다 — 사파리에서 막힌 진짜 원인이 이것이다');
  assert.ok(/catch \(_\) \{ framed = true; \}/.test(fn),
    '교차출처면 접근 자체가 던진다 — 그때는 틀 안으로 봐야 한다');
  const note = CODE.slice(CODE.indexOf('function cantOpenNote'), CODE.indexOf('function openForPrint'));
  assert.ok(/앱 화면 안에서는/.test(note), '틀 안일 때의 말이 없다');
});

test('★★ 차단된 산출물은 여전히 안 열린다 — 사유만 보인다', () => {
  assert.ok(/var isLink = r\.status !== 'blocked' && !!url;/.test(CODE),
    '차단된 것에도 링크를 달면 검증을 우회해 열린다');
  assert.ok(/if \(r\.status === 'blocked'\) \{/.test(CODE));
});

test('★★ 주소를 못 만들면 **왜 못 만들었는지**를 갈라서 적는다 (서버 탓으로 단정하지 않는다)', () => {
  assert.ok(/if \(!url\) \{/.test(CODE));
  assert.ok(/whyCantOpen\(\)/.test(CODE));
});

/* ── 실제로 그려지는가 ───────────────────────────────────── */

/**
 * ★★★ **표본이 성질을 지켜야 한다** (CLAUDE.md §8).
 *
 *   그냥 `reports.html` 을 열면 서버 주소가 없어 링크가 안 생긴다 — 그 상태로
 *   재면 **검사는 초록인데 아무것도 안 재고 있다.** 그래서 서버 주소를 심은
 *   사본을 만들어 잰다. 값은 가짜여도 **「주소가 있으면 링크가 된다」는 성질**은
 *   지킨다.
 */
function renderWith(seed) {
  const B = require('../ui/platform/build-static.js');
  const b = B.findBrowser();
  if (!b) return null;
  const os = require('node:os');
  const src = path.join(__dirname, '..', 'ui', 'platform', 'reports.html');
  const html = fs.readFileSync(src, 'utf8')
    .replace('}, window.LINKPILOT_REPORTS || {});', `}, ${JSON.stringify(seed)});`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-open-'));
  /* ★ 형제 스크립트를 같이 찾아야 하므로 **같은 폴더**에 둔다 */
  const tmp = path.join(path.dirname(src), `.open-test-${process.pid}.html`);
  try {
    fs.writeFileSync(tmp, html, 'utf8');
    return B.renderDom(b, tmp, 30000, 430) || '';
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('★★★ 헤드리스에서 산출물 줄이 **링크로** 그려진다', () => {
  const dom = renderWith({ api: '/api/linkpilot', project: 'LP-RE-2026-013' });
  if (dom === null) { console.log('# 크로미움이 없다 — 못 쟀다'); return; }
  const m = dom.match(/<a[^>]*class="out__a"[^>]*>/);
  assert.ok(m, '주소가 있는데도 링크가 하나도 없다 — 이것이 이번 사고의 정체다');
  assert.ok(/href="[^"]*\/file\?rel=/.test(m[0]), `링크에 파일 주소가 없다: ${m[0]}`);
  assert.ok(/target="_blank"/.test(m[0]), m[0]);

  /* ★ 차단된 것은 링크가 아니어야 한다 — 링크면 검증을 우회해 열린다 */
  const buttons = dom.match(/<button[^>]*class="out__a"[^>]*>[\s\S]*?<\/button>/g) || [];
  assert.ok(buttons.some((x) => /사유 보기/.test(x)),
    '차단된 산출물까지 링크가 됐다 — 검증을 우회해 열린다');
});

test('★★ 서버 주소가 없으면 링크를 안 만든다 — 깨진 링크보다 낫다', () => {
  const dom = renderWith({});
  if (dom === null) { console.log('# 크로미움이 없다 — 못 쟀다'); return; }
  assert.ok(!/<a[^>]*class="out__a"/.test(dom),
    '주소도 없이 링크를 만들었다 — 누르면 엉뚱한 곳으로 간다');
});

/* ── 글자가 깨져 나왔다 ─────────────────────────────────── */

/**
 * ★★★ **내가 만든 회귀다** 〈2026-08-25 사장님 화면〉.
 *
 *   어제 M-33(새 탭에 자격이 안 붙는다)을 고치면서 `r.blob()` 으로 바꿨다.
 *   그런데 **blob 으로 열면 글자표(charset)가 사라진다** — 서버는
 *   `charset=utf-8` 을 보내는데, `text/markdown` 처럼 브라우저가 렌더 규칙을
 *   모르는 형식은 그 딱지를 **무시하고 기본 인코딩으로 그린다.**
 *   IM 본문이 통째로 `蹂묒뿭` 처럼 나왔다.
 *
 * ★★ **문서가 안 열리는 것보다 나쁘다.** 열리기는 하니 사람은 「생성이
 *   깨졌다」고 읽는다 — 멀쩡한 문서인데 보는 길만 틀렸다.
 */

test('★★★ 글자 파일은 글자로 받아 UTF-8 로 다시 담는다', () => {
  assert.ok(/function textTypeFor\(path\)/.test(CODE), '형식을 안 가른다');
  assert.ok(/return r\.text\(\)\.then\(function \(t\) \{ return new Blob\(\[t\], \{ type: type \}\); \}\);/.test(CODE),
    'blob 을 그대로 쓴다 — 글자표가 사라져 깨진다');
  /* ★ 이진 파일은 글자로 바꾸면 깨진다 */
  assert.ok(/if \(!type\) return r\.blob\(\);/.test(CODE), 'PDF 까지 글자로 받는다');
});

test('★★★ 딱지에 charset=utf-8 이 반드시 붙는다', () => {
  const fn = CODE.slice(CODE.indexOf('function textTypeFor'), CODE.indexOf('function fetchAsBlob'));
  const types = fn.match(/'[a-z/+]+; charset=utf-8'/g) || [];
  assert.ok(types.length >= 3, `글자표를 안 붙인 형식이 있다: ${fn}`);
  assert.ok(/\.html\?\$/.test(fn) && /text\/html/.test(fn), 'html 을 text/html 로 안 연다 — 인쇄가 안 된다');
  assert.ok(/md\|txt/.test(fn), 'md 를 안 가른다 — IM 본문이 이 형식이다');
});

test('★★ 어느 파일인지 알려 줘야 형식을 가른다', () => {
  assert.ok(/fetchAsBlob\(url, r\.path\)/.test(CODE),
    '경로를 안 넘기면 형식을 못 가려 전부 이진으로 받는다');
});
