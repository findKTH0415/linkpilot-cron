'use strict';
/**
 * stranded-and-frame.test.js — **흐름 밖으로 새는 두 자리** 〈2026-08-29 · D-170 · D-171〉.
 *
 * ① 단계 화면이 흐름 밖에서 홀로 열리면 **돌아갈 길이 없었다.**
 *    그 화면들은 저마다 사이드바를 그리므로 **플랫폼처럼 보인다** — 그래서
 *    사용자는 「여기가 어디지」가 아니라 **「플랫폼이 이상하다」**로 읽는다.
 *    사장님 신고 그대로다: 「LinkPilot 플랫폼 프레임내 있지 않음」.
 *
 * ② 자료 업로드 칸 안에 **앱 전체가 통째로** 또 들어왔다. 확인 장치가 있었는데
 *    **주소 끝만** 봐서 못 잡았다 — `…/im-flow/im-flow/files.html` 은 끝이
 *    여전히 `files.html` 이고, 서버는 그런 파일이 없으니 404 대신 **앱 첫
 *    화면**을 돌려준다. 이름 검사는 그것을 통과시킨다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const F = require('../ui/platform/flow-core.js');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

// ══ ① 흐름 밖에서 돌아갈 길 ═══════════════════════════════

test('돌아갈 길을 만드는 자리가 있다', () => {
  assert.strictEqual(typeof F.strandedBar, 'function');
  assert.strictEqual(typeof F.showStranded, 'function');
});

/**
 * ★★★ **틀 안에서는 아무것도 안 그린다.** 앱·흐름 안에 얹혀 있을 때 이 줄이
 *   뜨면 멀쩡한 화면을 고장으로 읽는다.
 */
test('★★★ 틀 안에서는 안 그린다 (창이 없는 자리에서도 안 죽는다)', () => {
  const src = read('flow-core.js');
  assert.match(src, /if \(typeof window === 'undefined' \|\| typeof document === 'undefined'\) return null;/,
    'Node 에서 부르면 죽는다');
  assert.match(src, /try \{ if \(window\.parent !== window\) return null; \} catch \(_\) \{ return null; \}/,
    '틀 안인지 안 본다 — 앱 안에서도 이 줄이 뜬다');
  // Node 에서는 창이 없으므로 null 이어야 한다
  assert.strictEqual(F.strandedBar({ projectId: 'LP-1' }), null);
});

test('세 단계 화면이 홀로 떴을 때 그 줄을 띄운다', () => {
  ['intake.html', 'fields.html', 'reports.html'].forEach((f) => {
    const c = bare(read(f));
    assert.match(c, /LPF\.showStranded\(/, `${f} 가 돌아갈 길을 안 만든다`);
    /* ★ 주석을 뗐으므로 빈칸 수가 달라진다 — 「감쌌는가」만 본다 (CLAUDE.md §8) */
    /* ★ 「감쌌는가」만 본다 — 안쪽 모양은 D-173 으로 한 번 바뀌었고 또 바뀐다 */
    const at = c.indexOf('LPF.showStranded(');
    assert.ok(at > 0 && c.lastIndexOf('try {', at) > c.lastIndexOf('} catch', at),
      `${f} 에서 이 한 줄 때문에 화면이 죽을 수 있다 (try 로 안 감쌌다)`);
  });
});

/**
 * ★ 「고장」이 아니라 **「여기는 한 칸만 보는 자리」**라고 적는다. 빨간 띠로
 *   그리면 멀쩡한 화면을 고장으로 읽는다.
 */
test('★ 고장이라고 적지 않는다', () => {
  const src = read('flow-core.js');
  assert.match(src, /이 화면은 한 칸만 따로 열린 것입니다/, '어디인지 안 알려 준다');
  assert.match(src, /흐름으로 돌아가기/, '돌아가는 링크 글자가 없다');
  const near = src.slice(src.indexOf('function strandedBar'), src.indexOf('function showStranded'));
  assert.ok(!/#C00000|bad-soft|note--bad/.test(near),
    '빨간 띠로 그리고 있다 — 멀쩡한 화면이 고장으로 읽힌다');
});

test('같은 줄을 두 번 붙이지 않는다', () => {
  const src = read('flow-core.js');
  assert.match(src, /if \(document\.querySelector\('\[data-lp-stranded\]'\)\) return null;/,
    '다시 그릴 때마다 줄이 쌓인다');
});

// ══ ② 틀에 온 것이 진짜 그 화면인가 ═══════════════════════

/**
 * ★★★ 이번 사고의 핵심. 주소 끝만 보면 **앱 첫 화면이 통과한다.**
 */
test('★★★ 주소 끝만 보지 않고 **온 문서가 그 화면인지** 본다', () => {
  const c = bare(read('intake.html'));
  assert.match(c, /fr\.contentDocument\.title/,
    '안쪽 문서가 무엇인지 안 본다 — 앱 첫 화면이 그대로 통과한다');
  assert.match(c, /innerTitle\.indexOf\('자료 업로드'\) !== -1/,
    '기대하는 화면인지 가리는 자리가 없다');
  assert.ok(!/if \(got === file\) return;/.test(c),
    '아직 이름만 보고 통과시킨다');
});

/**
 * ★★ 검사가 재는 그 제목이 실제로 그 화면의 제목이어야 한다. 제목을 바꾸는
 *   날 이 검사가 알려 준다 — 안 그러면 멀쩡한 화면이 「다른 문서」로 잡힌다.
 */
test('★★ 자료 업로드 화면의 제목이 검사와 맞다', () => {
  assert.match(read('files.html'), /<title>자료 업로드 · LINKPILOT<\/title>/,
    '제목이 바뀌었다 — 위 검사가 멀쩡한 화면을 「다른 문서」로 잡는다');
});

/**
 * ★★★ 안쪽을 **못 읽으면 아무 말도 하지 않는다.** 모르는 것을 고장이라고
 *   적으면 멀쩡한 화면이 고장으로 읽힌다 (§4.9).
 */
test('★★★ 못 읽으면 고장이라고 말하지 않는다', () => {
  const c = bare(read('intake.html'));
  assert.match(c, /if \(got === file && \(looksRight \|\| !canRead\)\) return;/,
    '못 읽었을 때 통과시키지 않는다 — 다른 출처면 늘 고장으로 적는다');
});

test('무엇이 왔는지 글자로 적고, 새 탭으로 여는 길을 준다', () => {
  const raw = read('intake.html');
  assert.match(raw, /자료 업로드 화면 대신 다른 화면이 왔습니다/, '무슨 일인지 안 적는다');
  assert.match(raw, /돌아온 문서의 제목이/, '무엇이 왔는지 안 적는다 — 원인을 못 짚는다');
  assert.match(raw, /자료 업로드를 새 탭에서 열기/, '막다른 안내로 끝난다');
});

/* ══════════ 앱이 나를 갈아 끼웠는가 〈2026-08-29 · D-173〉 ══════════
 *
 * 사장님 화면: 주소는 `linkpilot-platform.html` **하나**인데 새로 고칠 때마다
 * 문서가 넷으로 바뀌었다 — 탭 제목이 「보고서 생성」·「보고서 생성 입력」·
 * 「자료 업로드」·「LinkPilot」.
 *
 * ★★★ 뜻: **앱이 화면 HTML 을 최상위 문서에 통째로 갈아 끼운다.** 틀(iframe)에
 *   넣는 것이 아니라 문서 자체를 바꾼다. 그래서 화면이 제 사이드바·로고·
 *   단계칩을 들고 들어가 **앱 것과 두 벌**이 된다 — 틀에 넣을 때는 `EMBED_CSS`
 *   가 감췄는데, 문서를 갈아 끼우면 그 CSS 를 얹는 사람이 없다.
 */
test('★★★ 주소가 제 것인지 본다', () => {
  assert.strictEqual(typeof F.selfPlaced, 'function');
  assert.strictEqual(typeof F.hideOwnChrome, 'function');
  const src = read('flow-core.js');
  assert.match(src, /return got === String\(file\);/, '파일 이름을 대 보지 않는다');
});

/**
 * ★★ **모르면 건드리지 않는다.** 잘못 감추면 화면이 통째로 빈 것처럼 보인다 —
 *   고치려다 더 나쁜 것을 만든다.
 */
test('★★ 판단할 수 없으면 아무것도 안 한다', () => {
  const src = read('flow-core.js');
  assert.match(src, /if \(typeof window === 'undefined'\) return true;/,
    '브라우저가 아닌 자리에서 감추려 든다');
  assert.match(src, /catch \(_\) \{ return true; \}/, '주소를 못 읽으면 감춰 버린다');
  assert.match(src, /if \(!got\) return true;\s*\n\s*\/\/ 폴더 주소|if \(!got\) return true;/,
    '폴더 주소(끝이 슬래시)를 남의 주소로 읽는다');
  // Node 에서는 창이 없으므로 「제 자리」로 보고 아무것도 안 한다
  assert.strictEqual(F.selfPlaced('intake.html'), true);
  assert.strictEqual(F.hideOwnChrome('intake.html'), false);
});

test('감출 때는 틀에 넣을 때와 같은 규칙을 쓴다 (두 벌로 만들지 않는다)', () => {
  const src = read('flow-core.js');
  assert.match(src, /st\.textContent = EMBED_CSS;/,
    '감추는 규칙을 따로 적고 있다 — 한쪽만 고치는 날 갈린다');
  assert.match(src, /if \(document\.getElementById\('lp-host-chrome'\)\) return true;/,
    '다시 그릴 때마다 style 이 쌓인다');
});

test('화면 다섯이 모두 제 껍데기를 감출 줄 안다', () => {
  [['intake.html', 'intake.html'], ['fields.html', 'fields.html'],
    ['reports.html', 'reports.html'], ['files.html', 'files.html'],
    ['outputs.html', 'outputs.html']].forEach(([f, mine]) => {
    const c = bare(read(f));
    assert.ok(c.indexOf("hideOwnChrome('" + mine + "')") !== -1,
      `${f} 가 제 파일 이름을 안 대고 있다 — 엉뚱하게 감추거나 안 감춘다`);
  });
});

/**
 * ★★★ **내가 만든 헛울음을 지웠다.** D-170 의 「흐름 밖입니다」 줄은
 *   `parent === window` 만 봤다. 그런데 앱이 문서를 갈아 끼우면 그 조건이
 *   참이 되어, **앱이 일부러 놓은 자리에서도** 그 줄이 떴다 —
 *   멀쩡한 화면을 고장으로 읽게 만든다.
 */
test('★★★ 앱이 갖다 놓은 자리에서는 「흐름 밖」이라고 하지 않는다', () => {
  const src = read('flow-core.js');
  assert.match(src, /if \(o\.file && !selfPlaced\(o\.file\)\) return null;/,
    '앱이 놓은 자리에서도 「흐름 밖」이라고 말한다 — 헛울음이다');
  ['intake.html', 'fields.html', 'reports.html'].forEach((f) => {
    assert.match(bare(read(f)), /file: '[a-z-]+\.html',/,
      `${f} 가 제 파일 이름을 안 넘긴다 — 위 판단이 헛돈다`);
  });
});

/**
 * ★ 탭으로만 쓰이는 화면에는 「흐름으로 돌아가기」를 붙이지 않는다 —
 *   돌아갈 흐름이 없다. 없는 곳으로 보내는 링크가 가장 나쁘다.
 */
test('★ 탭 화면에는 「돌아가기」를 붙이지 않는다', () => {
  ['files.html', 'outputs.html'].forEach((f) => {
    assert.ok(bare(read(f)).indexOf('showStranded') === -1,
      `${f} 는 흐름의 칸이 아닌데 「흐름으로 돌아가기」를 붙인다`);
  });
});
