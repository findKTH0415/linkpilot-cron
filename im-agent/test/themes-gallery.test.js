'use strict';
/**
 * themes-gallery.test.js — 디자인 테마 **고르는 화면** (D-51).
 *
 * 왜 이 화면이 있는가: 지금까지 화면에는 테마 **이름 버튼 13개**만 있었다.
 * 「Premium」과 「Institutional」이 어떻게 다른지 **이름만 보고는 고를 수 없다.**
 * 그래서 고르는 사람은 첫 번째를 누르거나 추천을 그냥 받아들인다 — 둘 다
 * 고른 것이 아니다. 선택은 취향의 영역이고, 취향은 **보여 줘야** 생긴다.
 *
 * 여기서 못 박는 것은 셋이다.
 *   ① 추천이 결정으로 바뀌지 않는가 (딜을 모르면 추천을 안 붙이는가)
 *   ② 견본이 **실제 렌더**인가 (색 견본만 보여 주면 표지를 알 수 없다)
 *   ③ **틀린 조건으로 고르게 두지 않는가** — 글꼴이 없거나 테마 차이가
 *      색뿐일 때 그 사실이 화면에 적히는가
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const builder = require('../ui/platform/build-themes');
const themes = require('../design/themes');

/**
 * ★ 빌드가 **비싸다** — 테마 13종을 헤드리스로 한 장씩 찍는다(십수 초).
 *   테스트마다 다시 돌리면 이 파일 하나가 전체 테스트를 몇 분 늘린다.
 *   인자 조합별로 **한 번만** 돌리고 결과를 붙든다.
 */
const CACHE = new Map();

/**
 * ★★ **커밋본에 쓰지 않는다** (2026-08-25 개정).
 *
 *   앞 판은 빌더를 그냥 돌렸고, 빌더가 쓰는 자리는 커밋된 `theme-gallery.html`
 *   하나뿐이었다. 그래서 **`npm test` 를 돌린 것만으로 작업본이 더러워졌다.**
 *   앞 판도 그것을 알고 끝에 「인자 없는 판으로 다시 빌드해 되돌리기」를 뒀는데,
 *   **그 되돌리기가 되돌리지 못한다** — 다시 빌드하면 그 기계에서 실제로 그린
 *   표지 PNG 가 들어가고, 한글 글꼴이 없는 기계에서는 「활자가 실제와 다릅니다」
 *   경고까지 붙는다. 원본과 다른 판이 「되돌린 판」으로 남는 것이다.
 *
 *   그 상태로 `git add -A` 하면 **아무도 의도하지 않은 판이 저장소에 들어간다.**
 *   (실제로 이번 세션에서 두 번 그럴 뻔했다)
 *
 *   ★ 이제 임시 폴더에 쓴다(`--out`). 커밋된 판은 사람이 `npm run im:themes` 를
 *     돌렸을 때만 바뀐다. 되돌리기가 필요 없어져 빌드도 한 번 줄었다.
 */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'im-themes-'));

function buildWith(args) {
  const key = (args || []).join(' ');
  if (!CACHE.has(key)) {
    const out = path.join(TMP, `gallery-${CACHE.size}.html`);
    execFileSync('node', [path.join(ROOT, 'im-agent/ui/platform/build-themes.js'), ...(args || []), '--out', out],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
    CACHE.set(key, fs.readFileSync(out, 'utf8'));
  }
  return CACHE.get(key);
}

test('★ 검사가 커밋된 화면을 건드리지 않는다', () => {
  buildWith([]);
  const committed = execFileSync('git', ['status', '--porcelain', '--', builder.OUT],
    { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(committed, '',
    `검사가 ${path.basename(builder.OUT)} 을 고쳤다 — 이 기계에서 그린 판이 저장소로 들어간다`);
});

/* ═════════ ① 추천이 결정으로 바뀌지 않는다 ═════════ */

/**
 * ★ 추천은 자산유형·문서종류로 정해진다. 이 화면은 **딜과 무관하게도** 만들어지는데
 *   그때 특정 딜의 추천을 박아 두면 다른 딜에서 **틀린 추천이 그럴듯하게 붙는다.**
 */
test('★ 딜을 모르면 추천을 붙이지 않는다', () => {
  const html = buildWith([]);
  assert.ok(!/class="rec"/.test(html), '딜도 모르는데 추천을 붙였다');
  assert.match(html, /추천은 붙이지 않았습니다/, '왜 없는지 말해야 한다');
  assert.match(html, /--asset/, '어떻게 하면 붙는지 말해야 한다');
});

test('★ 딜을 주면 순위와 근거를 함께 붙인다 (배지만 달지 않는다)', () => {
  // 그림은 이 검사와 무관하다 — 13장을 찍으면 십수 초가 그냥 든다
  const html = buildWith(['--asset', 'datacenter', '--no-shots']);
  const badges = html.match(/class="rec"/g) || [];
  assert.ok(badges.length >= 1 && badges.length <= 3, `추천 배지 ${badges.length}개 — 1~3개여야 한다`);
  assert.match(html, /추천 1위/);
  assert.match(html, /추천 근거/, '근거 없는 추천은 그냥 지시다');
  assert.match(html, /추천은 참고입니다/, '강제가 아니라는 말이 있어야 한다');
});

test('★ 추천을 못 내도 화면은 나온다 (고르는 것이 본질이다)', () => {
  const html = buildWith(['--asset', '없는자산유형입니다', '--no-shots']);
  assert.match(html, /class="card"/, '추천이 안 되면 화면이 통째로 죽었다');
});

/* ═════════ ② 견본이 실제 렌더다 ═════════ */

test('★ 13종 전부 카드가 있고, 표지가 실제 렌더로 박혀 있다', () => {
  const html = buildWith([]);
  const count = themes.list().length;
  assert.strictEqual((html.match(/class="card"/g) || []).length, count);
  // 색 견본만 보여 주면 표지에서 어떻게 보이는지 모른다
  assert.strictEqual((html.match(/data:image\/png;base64,/g) || []).length, count,
    '표지 그림이 빠진 테마가 있다');
});

/** ★ 파일 하나로 열려야 미리보기다 (§8) — 서버·CDN 이 있어야 열리면 안 된다 */
test('★ 자체 완결 HTML 이다 (외부를 부르지 않는다)', () => {
  const html = buildWith([]);
  assert.ok(!/src="(?!data:)/.test(html), '외부 이미지를 부른다');
  assert.ok(!/href="https?:/.test(html), '외부 링크를 부른다');
  assert.ok(!/<script/.test(html), '스크립트 없이 보여야 한다 — 미리 그려 넣었다');
});

test('테마마다 무엇에 쓰는 것인지와 색이 함께 보인다', () => {
  const html = buildWith([]);
  // ★ 화면은 HTML 이라 `M&A` 가 `M&amp;A` 로 들어간다. 원문 그대로 찾으면
  //   멀쩡한 화면을 두고 「없다」고 한다 (실제로 그렇게 짰다가 잡혔다)
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  themes.list().forEach((t) => {
    assert.ok(html.includes(esc(t.label)), `${t.id}: 이름이 없다`);
    if (t.labelKr) assert.ok(html.includes(esc(t.labelKr)), `${t.id}: 용도가 없다`);
  });
});

/* ═════════ ③ 틀린 조건으로 고르게 두지 않는다 ═════════ */

/**
 * ★ **이 검사가 이 파일의 핵심이다.** 테마는 표지 구조(rule/split/fullImage)와
 *   밀도(normal/compact/airy)를 선언하는데 `design/a4.js` 는 그 값을 읽지 않는다.
 *   즉 **13종이 색만 다르다.** 그 사실을 안 적으면 고르는 사람은 「13종 중에
 *   고른다」고 믿는데 실제로는 **색 팔레트를 고르는 것**이다 (D-51).
 */
test('★ 테마 차이가 색뿐이면 그 사실을 화면에 적는다', () => {
  const unused = builder.unusedFields();
  const html = buildWith([]);
  if (unused.length) {
    assert.match(html, /색과 활자뿐입니다/, '선언과 실제의 간극을 안 적었다');
    assert.match(html, /D-51/, '어디서 결정하는지 가리켜야 한다');
    unused.forEach(f => assert.ok(html.includes(f), `안 쓰이는 항목 ${f} 가 화면에 없다`));
  } else {
    // 렌더러가 다 쓰게 되면 이 경고는 사라져야 한다 — 낡은 경고가 남는 것이 더 나쁘다
    assert.ok(!/색과 활자뿐입니다/.test(html), '이제 안 맞는 경고가 남아 있다');
  }
});

test('선언만 되고 안 쓰이는 항목을 코드에서 직접 잰다 (손으로 적지 않는다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'design', 'a4.js'), 'utf8');
  builder.unusedFields().forEach((f) => {
    assert.ok(!new RegExp(`T\\.${f}\\b`).test(src), `${f} 는 실제로 쓰이는데 안 쓰인다고 했다`);
  });
});

/**
 * ★ 글꼴이 없으면 견본 활자가 최종본과 다르다. 안 적으면 **틀린 활자로
 *   디자인을 고른다.**
 */
test('★ 한글 글꼴이 없으면 견본 활자가 다르다고 적는다', () => {
  const html = buildWith([]);
  if (builder.fontAvailable('Noto Sans')) {
    assert.ok(!/견본의 활자는 실제와 다릅니다/.test(html), '글꼴이 있는데 경고가 남아 있다');
  } else {
    assert.match(html, /견본의 활자는 실제와 다릅니다/);
    assert.match(html, /Noto Sans KR/, '무엇이 없는지 말해야 한다');
  }
});

/* ═════════ 고른 뒤에 무엇이 남는가 ═════════ */

/**
 * ★ 취향으로 고른 선택일수록 **누가 왜 골랐는지**가 남아야 한다 —
 *   반년 뒤에 「왜 이 테마지」가 되면 다시 논의한다.
 */
test('★ 고른 기록이 남는다는 사실을 화면이 말한다', () => {
  const html = buildWith([]);
  assert.match(html, /고른 기록이 남습니다/);
  assert.match(html, /되돌릴 수 있습니다/);
  // design-state 가 실제로 그 기록을 남기는지도 본다 (화면만 말하면 거짓말이 된다)
  const ds = fs.readFileSync(path.join(__dirname, '..', 'core', 'design-state.js'), 'utf8');
  assert.match(ds, /history/, '이력을 안 남기면서 남는다고 적었다');
  assert.match(ds, /by/, '누가 골랐는지 안 남긴다');
});

/** ★ 테마는 보이는 방식만 정한다 — 내용이 바뀐다고 오해하면 안 고른다 */
test('테마가 내용을 바꾸지 않는다고 적는다', () => {
  const html = buildWith([]);
  assert.match(html, /내용은 바뀌지 않습니다/);
  assert.match(html, /디자인 확인용 예시/, '견본 수치를 실제로 오해하면 안 된다');
});

test('npm 스크립트가 걸려 있다', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['im:themes']);
});
