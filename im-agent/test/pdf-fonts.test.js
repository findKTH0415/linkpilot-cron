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
