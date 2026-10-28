'use strict';
/**
 * pdf-fonts.test.js — PDF 출력(D-53)과 글꼴 대조(D-52).
 *
 * 둘은 **한 묶음이다.** 글꼴 없이 PDF 를 내면 **중국어 글꼴로 나간 문서가
 * 투자자에게 간다.** 실제로 이 저장소의 PDF 에는 한글이 `WenQuanYiZenHei` 로
 * 박혀 있었고, 아무도 몰랐다 — 오류도 경고도 없고 화면에서는 멀쩡히 보였다.
 *
 * 여기서 못 박는 것은 셋이다.
 *   ① 선언(`formats: ['pdf']`)대로 **실제로 PDF 가 나오는가**
 *   ② 글꼴이 바뀐 것을 **조용히 넘어가지 않는가**
 *   ③ 글꼴이 없다고 **문서 생성 전체를 세우지는 않는가** (그게 더 나쁘다)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pdf = require('../core/pdf');
const fonts = require('../core/fonts');
const themes = require('../design/themes');
const a4 = require('../design/a4');
const outputspec = require('../core/outputspec');

function tmpHtml() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const p = path.join(dir, 'doc.html');
  fs.writeFileSync(p, a4.preview('institutional', { docType: 'im' }), 'utf8');
  return { dir, p };
}

/* ═════════ ① 선언대로 PDF 가 나온다 ═════════ */

/**
 * ★ **이 검사가 D-53 의 본체다.** `outputspec` 은 오래전부터 `formats: ['pdf']`
 *   라고 선언했는데 산출물은 HTML 까지였다.
 */
test('★ HTML 에서 실제 PDF 가 나온다 (새 의존성 없이)', () => {
  const { dir, p } = tmpHtml();
  try {
    const r = pdf.fromHtmlFile(p, { theme: themes.get('institutional') });
    assert.strictEqual(r.ok, true, r.reason || '');
    assert.ok(fs.existsSync(r.path), '파일이 없다');
    assert.strictEqual(fs.readFileSync(r.path).slice(0, 5).toString('latin1'), '%PDF-');
    assert.ok(r.pages > 0, '쪽수를 못 셌다 — 사양과 대조할 수 없다');
    assert.ok(r.bytes > 10000, `너무 작다 (${r.bytes}B) — 내용이 안 들어갔을 수 있다`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('★ 사양이 pdf 를 선언한다 (선언과 실제가 갈리지 않게 함께 본다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'outputspec.js'), 'utf8');
  assert.match(src, /formats: \['pdf'\]/, '사양이 pdf 를 선언하지 않는다');
  // 선언만 하고 안 만들면 D-53 이 되살아난다 — 파이프라인이 실제로 부르는지 본다
  const pipe = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  assert.match(pipe, /pdf\.fromHtmlFile/, '파이프라인이 PDF 를 안 만든다');
  assert.match(pipe, /formats \|\| \[\]\)\.includes\('pdf'\)/, '사양을 안 보고 만든다');
});

/** ★ 경로를 손으로 적으면 화면만 옛말을 한다 (실제로 그랬다) */
test('★ 로그가 실제 산출 경로를 낸다 (이름을 박아 두지 않는다)', () => {
  const pipe = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  assert.match(pipe, /path\.relative\(store\.projectDir\(projectId\), r\.path\)/);
  assert.ok(!/→ 12_Final\/im\.pdf`/.test(pipe), '파일명을 로그에 박아 두었다');
});

test('쪽수를 세고 사양과 견준다 (막지는 않는다)', () => {
  assert.strictEqual(pdf.pageCheck(24, { minPages: 30, maxPages: 100, targetPages: 40 }).includes('24p'), true);
  assert.match(pdf.pageCheck(24, { minPages: 30, targetPages: 40 }), /빠진 절이 없는지/);
  assert.strictEqual(pdf.pageCheck(40, { minPages: 30, maxPages: 100, targetPages: 40 }), null);
  assert.match(pdf.pageCheck(120, { minPages: 30, maxPages: 100, targetPages: 40 }), /넘는다/);
  assert.strictEqual(pdf.pageCheck(null, { minPages: 30 }), null, '쪽수를 모르면 판정하지 않는다');
});

/** ★ 대외 문서에 **로컬 경로**가 박히면 안 된다 (§2 와 같은 줄) */
test('★ 브라우저 기본 머리말·꼬리말을 끈다 (파일 경로가 박힌다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'pdf.js'), 'utf8');
  assert.match(src, /--no-pdf-header-footer/);
  assert.match(src, /파일 경로와 날짜/, '왜 끄는지 적어야 한다');
});

test('빈 파일·다른 형식을 성공으로 세지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'pdf.js'), 'utf8');
  assert.match(src, /빈 파일/);
  assert.match(src, /PDF 형식이 아니다/);
});

test('HTML 이 없으면 그렇게 말한다', () => {
  const r = pdf.fromHtmlFile('/없는/경로/x.html');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /HTML 이 없다/);
});

/* ═════════ ② 글꼴이 바뀐 것을 조용히 넘어가지 않는다 ═════════ */

/**
 * ★ **이 검사가 D-52 의 본체다.** 요청한 글꼴이 없으면 브라우저가 말없이 다른
 *   글꼴로 그린다. 오류도 경고도 없고 한글은 멀쩡히 보인다 — 그래서
 *   **만드는 기계마다 활자가 다른 문서**가 나가고 아무도 모른다.
 */
test('★ 요청한 글꼴이 없으면 무엇으로 대체되는지까지 말한다', () => {
  const r = fonts.check(themes.get('institutional'));
  if (r.ok) {
    // 글꼴이 깔린 환경(CI)에서는 통과가 정상이다
    assert.deepStrictEqual(r.missing, []);
    return;
  }
  assert.ok(r.missing.length, '없다고 하면서 무엇이 없는지 안 말한다');
  assert.match(r.reason, /만드는 기계마다 활자가 달라진다/, '왜 문제인지 말해야 한다');
  // ★ 「없다」까지만 하면 고칠 수가 없다. **무엇으로 대신 그려지는지**가 핵심이다
  const subs = Object.values(r.substitutes).filter(Boolean);
  assert.ok(subs.length, '대체 글꼴을 안 알려 준다');
});

test('★ PDF 결과에 글꼴 판정이 함께 실린다 (따로 물어보지 않아도 된다)', () => {
  const { dir, p } = tmpHtml();
  try {
    const r = pdf.fromHtmlFile(p, { theme: themes.get('institutional') });
    assert.ok(typeof r.fontOk === 'boolean', '글꼴 판정이 없다');
    if (r.fontOk === false) assert.ok(r.fontReason, '판정만 있고 사유가 없다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('★ 파이프라인이 글꼴 경고를 로그에 낸다', () => {
  const pipe = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  assert.match(pipe, /r\.fontOk === false/);
  assert.match(pipe, /글꼴: \$\{r\.fontReason\}/);
  // ★ PDF 성패와 **별개**여야 한다 — PDF 는 나왔는데 활자가 다를 수 있다
  assert.match(pipe, /글꼴은 PDF 성패와 별개다/);
});

/**
 * ★ `design/check.js` 는 이걸 못 잡는다 — HTML 의 `font-family` **문자열**만
 *   보지 렌더 시점에 그 글꼴이 있는지는 보지 않는다. 그래서 검사는 통과하고
 *   문서는 틀린다. 그 구분을 코드에 남긴다.
 */
test('★ 문자열 검사와 렌더 시점 검사가 다르다는 것을 적어 둔다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'fonts.js'), 'utf8');
  assert.match(src, /design\/check\.js/);
  assert.match(src, /문자열.*만 보지|문자열\*\*만 보지/);
});

test('총칭 글꼴은 요청 목록에서 뺀다 (sans-serif 는 늘 있다)', () => {
  assert.deepStrictEqual(fonts.familiesOf("'Noto Sans KR', sans-serif"), ['Noto Sans KR']);
  assert.deepStrictEqual(fonts.familiesOf('serif'), []);
  assert.deepStrictEqual(fonts.familiesOf(''), []);
});

/** ★ 모르는 것과 괜찮은 것은 다르다 */
test('★ 글꼴 목록을 못 읽으면 「있다」고 치지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'fonts.js'), 'utf8');
  assert.match(src, /있다고 치지 않는다/);
  assert.match(src, /unknown: true/, '모른다는 상태가 따로 있어야 한다');
});

/* ═════════ ③ 글꼴이 없다고 전체를 세우지 않는다 ═════════ */

/**
 * ★ 글꼴이 없다고 문서 생성을 막으면 **그게 더 나쁘다** — 아무것도 안 나온다.
 *   PDF 는 만들되 활자가 다르다는 사실을 실어 보낸다.
 */
test('★ 글꼴이 없어도 PDF 는 나온다 (막지 않는다)', () => {
  const { dir, p } = tmpHtml();
  try {
    const r = pdf.fromHtmlFile(p, { theme: themes.get('institutional') });
    assert.strictEqual(r.ok, true, '글꼴 때문에 PDF 생성이 막혔다');
    // 글꼴이 없는 환경이면 그 사실이 함께 와야 한다
    if (!fonts.check(themes.get('institutional')).ok) {
      assert.strictEqual(r.fontOk, false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ═════════ 글꼴을 저장소에 넣지 않는 이유 ═════════ */

/**
 * ★ 재 봤다 — Noto Sans/Serif KR 한글 서브셋은 **4벌 약 11MB · 496파일**이다.
 *   공개 저장소에 넣을 크기가 아니다. 대신 **환경에서 맞추고 없으면 알린다.**
 */
test('★ 글꼴 파일을 저장소에 커밋하지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'fonts.js'), 'utf8');
  assert.match(src, /11MB|496파일/, '왜 안 넣는지 숫자로 적어야 한다');

  // fonts/ 에 실제로 커밋된 글꼴이 없어야 한다
  const dir = path.join(__dirname, '..', '..', 'fonts');
  if (fs.existsSync(dir)) {
    const committed = require('child_process')
      .execSync(`git ls-files ${JSON.stringify(dir)}`, { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' })
      .split('\n').filter(f => /\.(woff2?|otf|ttf)$/i.test(f));
    assert.deepStrictEqual(committed, [], `글꼴이 커밋되었다: ${committed.join(', ')}`);
  }
});

/** ★ 우리가 통제하는 환경(CI)에서는 설치해서 맞춘다 */
test('★ CI 가 한글 글꼴을 설치한다', () => {
  const wf = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github/workflows/im-agent-ci.yml'), 'utf8');
  assert.match(wf, /fonts-noto-cjk/, 'CI 에서도 글꼴이 없으면 테스트가 실제와 다른 조건에서 돈다');
  assert.match(wf, /D-52/, '왜 넣었는지 남겨야 한다');
});

/* ═════════ ④ 설치했다는 선언이 실제 활자와 이어지는가 (D-52 재발) ═════════ */

/**
 * ★★ **여기가 2026-08-17 에 뚫린 자리다.** 위 「CI 가 한글 글꼴을 설치한다」는
 *   워크플로 **문자열**만 봤고, 실제로는 이랬다:
 *
 *     설치한 꾸러미 `fonts-noto-cjk` 가 심는 이름 → `Noto Sans CJK KR`
 *     문서가 요청한 이름                          → `Noto Sans KR`
 *
 *   이름이 달라 요청이 통하지 않았고, 브라우저는 **말없이 다른 CJK 글꼴로**
 *   그렸다 — CI 에서는 `Noto Sans CJK JP`(일본어), CJK 글꼴이 여럿인 기계에서는
 *   `WenQuanYi Zen Hei`(중국어). **테스트는 전부 초록이었다.**
 *
 *   실측(2026-08-17 · fonts-noto-cjk 만 깔린 기계에서 실제 PDF 를 만들어 확인):
 *     고치기 전 → PDF 에 `WenQuanYiZenHei` 가 박힌다
 *     고친 뒤   → PDF 에 `NotoSansCJKkr` · `NotoSerifCJKkr` 가 박힌다
 *
 *   그래서 이 묶음은 **선언이 아니라 산출물을 본다.**
 */
test('★★ CI 가 설치하는 꾸러미의 이름이 문서 글꼴 스택에 실제로 들어 있다', () => {
  const wf = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github/workflows/im-agent-ci.yml'), 'utf8');
  assert.match(wf, /fonts-noto-cjk/);

  // `fonts-noto-cjk` 가 심는 한국어 변형의 **정확한 이름**
  const tokens = fs.readFileSync(path.join(__dirname, '..', 'design', 'tokens.js'), 'utf8');
  for (const family of ['Noto Sans CJK KR', 'Noto Serif CJK KR']) {
    assert.ok(tokens.includes(family),
      `설치하는 꾸러미가 심는 이름 '${family}' 이 글꼴 스택에 없다 — `
      + '「설치했다」는 선언만 맞고 문서는 다른 활자로 나간다 (D-52)');
  }
});

/**
 * ★ 대체로 넣어도 되는 것은 **같은 활자의 다른 이름**뿐이다.
 *   JP·SC·TC 는 한자 모양이 다르므로 대체가 아니라 **다른 글꼴**이다 —
 *   나중에 경고를 없애려고 이걸 스택에 밀어 넣으면 D-52 가 그대로 돌아온다.
 */
test('★ 일본어·중국어 변형을 대체 글꼴로 선언하지 않는다', () => {
  // ★ 원문이 아니라 **선언된 값**을 본다 — 주석에 「WenQuanYi 로 그려졌다」고
  //   적어 둔 것까지 걸리면, 왜 이렇게 고쳤는지 적어 둔 글을 지우게 된다
  const { FONT } = require('../design/tokens');
  const declared = [...fonts.familiesOf(FONT.serif), ...fonts.familiesOf(FONT.sans)];
  for (const bad of ['CJK JP', 'CJK SC', 'CJK TC', 'WenQuanYi']) {
    const hit = declared.filter(f => f.includes(bad));
    assert.deepStrictEqual(hit, [],
      `${bad} 을 글꼴 스택에 넣었다 — 한자 모양이 달라 같은 활자가 아니다`);
  }
  // 한국어 변형은 **있어야** 한다 (없으면 위 검사는 통과하고 문서는 틀린다)
  assert.ok(declared.some(f => /CJK KR$/.test(f)), '한국어 변형이 스택에 없다');
});

/**
 * ★ 스택은 **목록**이고 브라우저는 앞에서부터 있는 것을 쓴다. 「목록의 모든
 *   이름이 설치되어 있어야 한다」로 보면 대체가 정상 동작하는 기계에서 헛경고가
 *   뜨고, **진짜 문제가 그 헛경고에 묻힌다.**
 */
test('★ 스택 판정: 하나만 있으면 정상, 하나도 없으면 경고', () => {
  const list = ['Some Installed Face'];
  const ok = fonts.stackOf('sans', "'Nope KR', 'Some Installed Face', sans-serif", list);
  assert.strictEqual(ok.used, 'Some Installed Face', '뒤쪽 대체를 못 찾았다');

  const dead = fonts.stackOf('sans', "'Nope KR', 'Also Nope', sans-serif", list);
  assert.strictEqual(dead.used, null, '없는데 있다고 했다');

  assert.strictEqual(fonts.stackOf('sans', 'sans-serif', list), null, '총칭만 있으면 볼 것이 없다');

  // 하나도 없는 스택은 **목록 전체**를 못 찾은 것으로 보고한다
  const r = fonts.check({ serif: "'Nope A', serif", sans: "'Nope B', sans-serif" });
  if (!r.unknown) {
    assert.strictEqual(r.ok, false);
    assert.ok(r.missing.includes('Nope A') && r.missing.includes('Nope B'));
  }
});

/**
 * ★ 1순위가 아닌 이름으로 그린 것은 **고장이 아니다** — 스택이 제 일을 한 것이다.
 *   다만 어떤 활자로 나갔는지는 말해야 한다. 경고와 사실보고를 섞으면 경고가 무뎌진다.
 */
test('★ 대체로 그렸으면 「무엇으로 그렸는지」를 남긴다 (경고가 아니라 사실)', () => {
  const r = fonts.check(themes.get('institutional'));
  if (!r.ok) return;                       // 글꼴이 아예 없는 기계 — 위 검사가 본다
  assert.ok(r.used && (r.used.sans || r.used.serif), '실제로 그려질 이름을 안 낸다');
  if (r.fallbacks.length) {
    assert.ok(r.note, '대체로 그렸는데 아무 말이 없다');
    assert.match(fonts.summarize(r), /대체로 그린다/);
  }
  // 파이프라인이 그 사실을 실제로 찍는지 — 만들어만 두고 안 부르면 없는 것과 같다
  const pipe = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  assert.match(pipe, /r\.fontNote/, '파이프라인이 글꼴 기록을 안 낸다');
});

/**
 * ★★ **이 검사가 D-52 의 최종 방어선이다.** 위 검사들이 전부 통과해도
 *   산출물이 틀릴 수 있으므로, **실제로 나온 PDF 에 박힌 글꼴 이름**을 본다.
 *   (한글이 안 깔린 기계에서는 판정하지 않는다 — 그건 위 ② 가 잡는다)
 */
test('★★ 실제 PDF 에 한국어 글꼴이 박힌다 (중국어·일본어 글꼴이 아니다)', () => {
  const theme = themes.get('institutional');
  if (!fonts.check(theme).ok) return;      // 선언한 글꼴이 하나도 없는 기계

  const { dir, p } = tmpHtml();
  try {
    const r = pdf.fromHtmlFile(p, { theme });
    assert.strictEqual(r.ok, true, r.reason || '');
    const embedded = fs.readFileSync(r.path).toString('latin1');

    for (const wrong of ['WenQuanYi', 'CJKjp', 'CJKsc', 'CJKtc']) {
      assert.ok(!embedded.includes(wrong),
        `PDF 에 ${wrong} 이 박혔다 — 한글이 한국어 글꼴로 그려지지 않았다 (D-52)`);
    }
    // 「없다」만 보면 글자가 통째로 빠져도 통과한다 — 한국어 글꼴이 **있는지**도 본다
    assert.match(embedded, /CJKkr|NotoSansKR|NotoSerifKR/,
      '한국어 글꼴이 하나도 안 박혔다 — 한글이 그려지지 않았을 수 있다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/**
 * ★ 글꼴 스택은 **한 곳에서만 정한다.** 13개 테마에 같은 문자열이 복붙되어
 *   있어서, 이번 수정은 13군데를 똑같이 고쳐야 하는 일이었다 — 하나만 빠뜨리면
 *   그 테마로 만든 문서만 조용히 다른 활자로 나간다.
 */
test('★ 테마가 글꼴 스택을 복붙하지 않는다 (tokens 한 곳)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'design', 'themes.js'), 'utf8');
  assert.ok(!/serif:\s*"'Noto/.test(src), '테마에 글꼴 문자열을 직접 적었다');
  assert.match(src, /require\('\.\/tokens'\)/, 'tokens 에서 가져와야 한다');

  // 13종 전부가 같은 스택을 쓰는지 — 원문이 아니라 **값**으로 확인한다
  const { FONT } = require('../design/tokens');
  const ids = themes.list().map(t => t.id);
  assert.ok(ids.length >= 13, `테마가 ${ids.length}종뿐이다 — 목록을 못 읽었다`);
  ids.forEach((id) => {
    const t = themes.get(id);
    assert.strictEqual(t.sans, FONT.sans, `${id}: sans 가 토큰과 다르다`);
    assert.strictEqual(t.serif, FONT.serif, `${id}: serif 가 토큰과 다르다`);
  });
});

/** ★ IM 에 들어가는 그림(SVG)도 본문과 같은 활자여야 한다 */
test('★ 매스·조감도 SVG 도 토큰 글꼴을 쓴다', () => {
  for (const f of ['mass.js', 'birdseye.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'geo', f), 'utf8');
    assert.ok(!/font-family="'Noto Sans KR', sans-serif"/.test(src),
      `${f}: 글꼴 스택을 직접 적었다 — 본문만 고치면 그림 글자만 다른 활자로 남는다`);
    assert.match(src, /font-family="\$\{FONT\.sans\}"/, `${f}: 토큰을 안 쓴다`);
  }
});

/** ★ 파일을 직접 넣는 길도 열어 둔다 (오프라인 NAS) */
test('글꼴 파일을 넣으면 문서에 박는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fontdir-'));
  try {
    assert.strictEqual(fonts.faceCss(dir), '', '파일이 없는데 @font-face 를 만들었다');
    fs.writeFileSync(path.join(dir, 'NotoSansKR-400.woff2'), Buffer.from([0x77, 0x4F, 0x46, 0x32]));
    const css = fonts.faceCss(dir);
    assert.match(css, /@font-face/);
    assert.match(css, /font-family:'Noto Sans KR'/, '파일명에서 글꼴 이름을 못 만들었다');
    assert.match(css, /font-weight:400/);
    assert.match(css, /base64,/, '파일을 문서에 박아야 한다 — 경로 참조는 옮기면 깨진다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
