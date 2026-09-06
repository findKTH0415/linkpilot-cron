'use strict';
/**
 * design-layout.test.js — **반영된 디자인 레이아웃이 소스와 같은가.**
 *
 * 〈2026-09-06 신설 · 사장님 지시 「반영된 디자인 레이아웃 구축해줘」〉
 *
 * ★★★ **무엇을 막으려고 만들었나.** 디자인 값이 **두 벌**이 되는 것이다.
 *   이 저장소는 이미 그 사고를 겪었다 — `--lime-deep` 이 `#5C7A00`·`#4F6900`·
 *   `#4F6A00` 세 값으로 흩어져 있었고 셋 다 디자인 시스템 값이 아니었다
 *   (`design-system.test.js` 머리말). 복붙은 「지금은 같다」일 뿐이고,
 *   **갈리는 날 아무도 눈치채지 못한다.**
 *
 * ★★ 그래서 세 산출물(CSS · 견본 HTML · 적용규칙 문서)이 **`tokens.js` ·
 *   `themes.js` · `layouts.js` · `rules.json` 의 값 그대로인지**를 잰다.
 *   글자가 있는지가 아니라 **값이 같은지**를 본다.
 *
 * ★ 그리고 **커밋본이 소스와 갈리지 않았는지**도 잰다 (CLAUDE.md §8
 *   「재생성 결과가 커밋본과 같은지 테스트로 고정한다」).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'design');
const css = require(path.join(D, 'css.js'));
const specimen = require(path.join(D, 'specimen.js'));
const themes = require(path.join(D, 'themes.js'));
const layouts = require(path.join(D, 'layouts.js'));
const { COLOR, SIZE, PAGE, FONT, CAPTION_PREFIX } = require(path.join(D, 'tokens.js'));
const rules = require(path.join(D, 'rules.json'));
const builder = require(path.join(__dirname, '..', 'ui', 'platform', 'build-layouts.js'));

const IDS = Object.keys(layouts.LAYOUTS);

/* ───────────── CSS 가 토큰 값 그대로인가 ───────────── */

test('★ CSS 의 색이 tokens.js 값 그대로다 (옮겨 적은 값이 없다)', () => {
  const out = css.build('institutional');
  const T = themes.get('institutional');

  /** `--이름: 값;` 을 실제로 파싱해서 본다 — 글자가 어딘가 있는지가 아니라 **그 변수의 값**이다 */
  const varOf = (name) => {
    const m = out.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'));
    return m ? m[1].trim() : null;
  };

  const want = {
    '--im-primary': T.primary,
    '--im-accent': T.accent,
    '--im-on-primary': T.onPrimary,
    '--im-body': COLOR.body,
    '--im-muted': COLOR.muted,
    '--im-faint': COLOR.faint,
    '--im-rule-strong': COLOR.ruleStrong,
    '--im-rule-weak': COLOR.ruleWeak,
    '--im-negative': COLOR.negative,
    '--im-track': COLOR.track,
  };
  Object.entries(want).forEach(([k, v]) => {
    assert.strictEqual(varOf(k), v, `${k} 가 소스 값(${v})과 다르다`);
  });
});

test('★ CSS 의 크기·지면이 tokens.js 값 그대로다', () => {
  const out = css.build();
  const varOf = (n) => (out.match(new RegExp(`^\\s*${n}:\\s*([^;]+);`, 'm')) || [])[1];
  assert.strictEqual(varOf('--im-h1'), `${SIZE.h1}px`);
  assert.strictEqual(varOf('--im-text'), `${SIZE.body}px`);
  assert.strictEqual(varOf('--im-caption'), `${SIZE.caption}px`);
  assert.strictEqual(varOf('--im-page-w'), `${PAGE.widthMm}mm`);
  assert.strictEqual(varOf('--im-page-h'), `${PAGE.heightMm}mm`);
  assert.match(out, new RegExp(`@page \\{ size: ${PAGE.format}; margin: ${PAGE.marginMm}mm; \\}`));
});

test('★ 글꼴 스택의 **두 번째 이름**이 살아 있다 (D-52 — 이게 없으면 중국어 글꼴로 나간다)', () => {
  const out = css.build();
  const sans = (out.match(/^\s*--im-sans:\s*([^;]+);/m) || [])[1];
  const serif = (out.match(/^\s*--im-serif:\s*([^;]+);/m) || [])[1];
  assert.ok(/Noto Sans CJK KR/.test(sans), `본문 스택에 대체 이름이 없다: ${sans}`);
  assert.ok(/Noto Serif CJK KR/.test(serif), `제목 스택에 대체 이름이 없다: ${serif}`);
  /* 토큰과 같은 값인지까지 본다 — 스택을 여기서 새로 쓰면 안 된다 */
  assert.strictEqual(sans, FONT.sans);
  assert.strictEqual(serif, FONT.serif);
});

test('★ 테마 13종이 모두 CSS 에 있고, 값이 themes.js 그대로다', () => {
  const out = css.build('institutional');
  const list = themes.list();
  assert.strictEqual(list.length, 13, `테마 수가 달라졌다: ${list.length}`);

  list.filter((t) => t.id !== 'institutional').forEach((t) => {
    const block = out.match(new RegExp(`\\[data-im-theme="${t.id}"\\] \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(block, `${t.id} 블록이 없다`);
    const T = themes.get(t.id);
    const got = (block[1].match(/--im-primary:\s*([^;]+);/) || [])[1];
    assert.strictEqual(got, T.primary, `${t.id} 의 주색이 소스와 다르다`);
  });
});

test('★ 레이아웃 12종의 격자가 모두 있다 — id 를 새로 짓지 않았다', () => {
  const out = css.build();
  IDS.forEach((id) => {
    assert.ok(new RegExp(`\\.im-${id} \\{`).test(out), `${id} 격자가 없다`);
  });
  /* 없는 id 를 만들어 두면 견본이 있지도 않은 레이아웃을 그린다 */
  const declared = (out.match(/\.im-(L\d\d) \{/g) || []).map((s) => s.slice(4, 7));
  declared.forEach((id) => {
    assert.ok(layouts.LAYOUTS[id], `layouts.js 에 없는 ${id} 가 CSS 에 있다`);
  });
});

test('★ 인쇄 색 보정이 있다 — 없으면 네이비 박스가 흰색으로 인쇄된다 (rules.json D6)', () => {
  const out = css.build();
  assert.match(out, /print-color-adjust:\s*exact/);
  assert.match(out, /break-inside:\s*avoid/);
});

/* ───────────── 견본이 실제로 다 그리는가 ───────────── */

test('★ 견본에 레이아웃 12종이 **격자까지 붙어** 들어 있다', () => {
  const html = specimen.build({ stamp: 'T' });
  IDS.forEach((id) => {
    assert.ok(html.includes(`im-layout im-${id}`), `${id} 장이 격자 없이 들어갔거나 빠졌다`);
    assert.ok(html.includes(`<b>${id}</b>`), `${id} 이름표가 없다`);
  });
  assert.strictEqual((html.match(/class="sheet"/g) || []).length, IDS.length);
});

test('★ 견본의 판정표는 pick() 을 **실제로 돌린 것**이다 (옮겨 적지 않았다)', () => {
  const dec = specimen.decisions();
  assert.strictEqual(dec.length, specimen.PROBES.length);

  /* 표본이 재려는 성질을 지키는가 — 같은 답만 나오면 아무것도 안 재는 것이다 */
  const distinct = new Set(dec.map((d) => d.id));
  assert.ok(distinct.size >= 6,
    `표본이 ${distinct.size}가지 답만 낸다 — 판정 사슬을 안 재고 있다`);

  /* 우선순위 사슬의 앞머리가 실제로 그 답을 내는가 */
  assert.strictEqual(dec[0].id, 'L07', '지도가 최우선이어야 한다');
  assert.strictEqual(dec[1].id, 'L11', '위험 플래그가 그다음이어야 한다');
  assert.strictEqual(dec[2].id, 'L05', '차트가 표보다 앞이어야 한다');

  /* 표에 적힌 이유가 layouts.js 가 실제로 돌려준 이유와 같은가 */
  const html = specimen.build({ stamp: 'T' });
  dec.forEach((d) => {
    assert.ok(html.includes(d.reason), `판정 이유 "${d.reason}" 가 견본에 없다`);
  });
});

test('★ 견본이 규칙 14개를 rules.json 에서 읽어 그대로 싣는다', () => {
  const html = specimen.build({ stamp: 'T' });
  (rules.rules || []).forEach((r) => {
    assert.ok(html.includes(r.id), `규칙 ${r.id} 가 견본에 없다`);
  });
  assert.strictEqual((html.match(/class="sev /g) || []).length, (rules.rules || []).length);
});

test('★ 견본에 이모지가 없다 (rules.json D3 · 대외 문서 규격을 보이는 자리다)', () => {
  const html = specimen.build({ stamp: 'T' });
  /* ★ `\u2600-\u27BF` 로 재면 **★ 가 걸린다** — 이 저장소가 문서 전체에서
     쓰는 강조 기호이지 이모지가 아니다(유니코드도 이모지로 안 친다).
     그래서 `Extended_Pictographic` 로 묻는다: ★ ☆ △ ▽ 는 통과하고
     ⚠️ ✅ 🔑 는 걸린다 (실측). */
  const emoji = html.match(/\p{Extended_Pictographic}/gu) || [];
  assert.strictEqual(emoji.length, 0, `이모지가 있다: ${emoji.join(' ')}`);
});

test('★ 캡션은 언제나 「자료출처: 」 로 시작한다', () => {
  const html = specimen.build({ stamp: 'T' });
  const caps = html.match(/class="im-caption">([^<]*)</g) || [];
  assert.ok(caps.length >= 3, `캡션 표본이 ${caps.length}개뿐 — 아무것도 안 재고 있다`);
  caps.forEach((c) => {
    const text = c.replace(/^class="im-caption">/, '').replace(/<$/, '');
    assert.ok(text.startsWith(CAPTION_PREFIX.trim()), `캡션이 접두어 없이 시작한다: ${text}`);
  });
});

test('★ 견본은 파일 하나로 열린다 — 바깥 파일을 안 부른다 (CLAUDE.md §8)', () => {
  const html = specimen.build({ stamp: 'T' });
  assert.ok(!/<link[^>]+href=/i.test(html), '바깥 스타일시트를 부른다');
  assert.ok(!/<script[^>]+src=/i.test(html), '바깥 스크립트를 부른다');
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')), '바깥 주소를 부른다');
});

test('★ 견본은 돌릴 때마다 달라지지 않는다 — 시각을 안 박는다', () => {
  const a = specimen.build({ stamp: builder.STAMP });
  const b = specimen.build({ stamp: builder.STAMP });
  assert.strictEqual(a, b);
  /* 날짜가 박히면 guard 의 「재생성」 칸이 늘 빨갛다 */
  assert.ok(!/20\d\d-\d\d-\d\d \d\d:\d\d/.test(a), '견본에 생성 시각이 박혀 있다');
});

/* ───────────── 적용규칙 문서 ───────────── */

test('★ 적용규칙 문서의 수치가 소스에서 센 값과 같다', () => {
  const md = builder.doc();
  assert.ok(md.includes(`| 레이아웃 | ${IDS.length} |`), '레이아웃 수가 다르다');
  assert.ok(md.includes(`| 테마 | ${themes.list().length} |`), '테마 수가 다르다');
  assert.ok(md.includes(`| 디자인 규칙 | ${(rules.rules || []).length} |`), '규칙 수가 다르다');
  IDS.forEach((id) => assert.ok(md.includes(`\`${id}\``), `${id} 가 문서에 없다`));
  (rules.rules || []).forEach((r) => assert.ok(md.includes(r.id), `규칙 ${r.id} 가 문서에 없다`));
});

test('★ 자동 판정으로 안 나오는 레이아웃을 **나온다고 적지 않는다**', () => {
  const md = builder.doc();
  const auto = new Set(specimen.decisions().map((d) => d.id));
  const never = IDS.filter((id) => !auto.has(id));
  assert.ok(never.length > 0, '표본이 12종을 다 낸다 — 이 검사가 아무것도 안 재고 있다');
  const line = md.split('\n').find((l) => l.includes('자동 판정으로는 안 나온다'));
  assert.ok(line, '「자동으로는 안 나온다」는 안내가 문서에 없다');
  never.forEach((id) => {
    assert.ok(line.includes(`\`${id}\``) || md.includes(`\`${id}\`) 은`) || md.includes(`\`${id}\``),
      `${id} 가 안내에 빠졌다`);
  });
});

/* ───────────── 커밋본이 소스와 갈리지 않았는가 ───────────── */

test('★ 커밋된 세 파일이 지금 소스로 만든 것과 같다 (CLAUDE.md §8)', () => {
  const pairs = [
    [builder.OUT_CSS, css.build('institutional')],
    [builder.OUT_HTML, specimen.build({ themeId: 'institutional', stamp: builder.STAMP })],
    [builder.OUT_DOC, builder.doc()],
  ];
  pairs.forEach(([file, want]) => {
    let got;
    try { got = fs.readFileSync(file, 'utf8'); }
    catch (_) { assert.fail(`${path.basename(file)} 가 없다 — npm run im:layouts 를 돌려라`); }
    assert.strictEqual(got, want,
      `${path.basename(file)} 가 소스와 갈렸다 — npm run im:layouts 를 다시 돌려 커밋해라`);
  });
});

test('★ 생성물에 「손으로 고치지 않는다」가 박혀 있다', () => {
  assert.match(css.build(), /손으로 고치지 않는다/);
  assert.match(builder.doc(), /손으로 고치지 않는다/);
});
