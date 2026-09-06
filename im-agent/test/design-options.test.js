'use strict';
/**
 * design-options.test.js — **스타일 두 안이 실제로 고를 거리인가.**
 *
 * 〈2026-09-06 신설 · 사장님 지시 「2가지 스타일 옵션 선택 하도록」〉
 *
 * ★★★ **무엇을 막으려고 만들었나.** 「두 안을 냈다」는 말은 쉽고, **둘이 사실상
 *   같은 안**이어도 화면은 멀쩡히 뜬다. 첫 판이 그랬다 — `global_ib` 와
 *   `institutional` 을 냈는데 갈리는 축이 **표지 형식 하나뿐**이었고 문체·밀도·색이
 *   전부 같았다. 갈래표는 「다르다」고 하는데 **그린 것은 같았다.**
 *
 * ★★ 그래서 이 검사는 **갈리는 축을 세어 본다.** 말이 아니라 수다.
 *
 * ★ 그리고 **장점·주의점이 지어낸 것이 아닌지** 잰다 — 전부 `themes.js` 의 실제
 *   값에서 나와야 한다 (CLAUDE.md §4.8: 가정이 섞이면 자동으로 내지 않는다).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'design');
const options = require(path.join(D, 'options.js'));
const themes = require(path.join(D, 'themes.js'));
const builder = require(path.join(__dirname, '..', 'ui', 'platform', 'build-styleoptions.js'));

/** 실제로 들어올 만한 딜 모양 — 한 가지만 재면 아무것도 안 재는 것이다 */
const DEALS = [
  { assetType: 'datacenter', docType: 'im', investorType: 'institutional' },
  { assetType: 'hotel', docType: 'teaser' },
  { assetType: 'solar', docType: 'pf_proposal', investorType: 'bank' },
  { assetType: 'realestate', docType: 'investor_presentation' },
  { assetType: 'road', docType: 'feasibility' },
  { assetType: 'office', docType: 'ic_memo' },
  {},
];

test('★ 어떤 딜이든 두 안이 나오고, 둘은 서로 다른 테마다', () => {
  DEALS.forEach((d) => {
    const r = options.pick2(d);
    assert.ok(r.A && r.B, `${JSON.stringify(d)} 에서 두 안이 안 나왔다`);
    assert.notStrictEqual(r.A.themeId, r.B.themeId,
      `${JSON.stringify(d)} 에서 A·B 가 같은 테마다 (${r.A.themeId}) — 고를 것이 없다`);
    assert.ok(themes.get(r.A.themeId) && themes.get(r.B.themeId), '없는 테마를 냈다');
  });
});

test('★★ 두 안은 **성격 갈래가 반대**다 (보수 ↔ 현대)', () => {
  DEALS.forEach((d) => {
    const r = options.pick2(d);
    assert.notStrictEqual(r.A.family, r.B.family,
      `${JSON.stringify(d)} 에서 A·B 가 같은 갈래(${r.A.family})다 — 갈라 두는 뜻이 없다`);
  });
});

test('★★★ 두 안이 **실제로 갈리는 축**이 둘 이상이다 (말이 아니라 수로 잰다)', () => {
  const weak = [];
  DEALS.forEach((d) => {
    const r = options.pick2(d);
    if (r.diffs.diff.length < 2) weak.push(`${JSON.stringify(d)} → ${r.A.themeId}/${r.B.themeId} (${r.diffs.diff.length}축)`);
  });
  assert.deepStrictEqual(weak, [],
    '갈리는 축이 하나뿐인 딜이 있다 — 화면은 둘인데 고를 것이 없다:\n  ' + weak.join('\n  '));
});

test('★ 색이 가까우면 **가깝다고 적는다** (그림과 글이 다른 말을 하지 않게)', () => {
  DEALS.forEach((d) => {
    const r = options.pick2(d);
    const gap = r.diffs.colorGap;
    const said = /색은 가깝다/.test(r.note);
    if (gap < options.COLOR_NOTICEABLE) {
      assert.ok(said, `색 거리 ${gap} 인데 「색은 가깝다」를 안 적었다 (${r.A.themeId}/${r.B.themeId})`);
    } else {
      assert.ok(!said, `색 거리 ${gap} 인데 「색은 가깝다」를 적었다 (${r.A.themeId}/${r.B.themeId})`);
    }
  });
  /* 자를 실제로 대 본다 — 상수만 있고 안 쓰이면 이 검사는 헛돈다 */
  assert.strictEqual(options.colorGap('#000000', '#000000'), 0);
  assert.ok(options.colorGap('#10233C', '#0B1B2B') < options.COLOR_NOTICEABLE);
  assert.ok(options.colorGap('#10233C', '#7A1F2B') > options.COLOR_NOTICEABLE);
});

test('★★ 장점·주의점이 **themes.js 의 실제 값**에서 나온다 (지어내지 않았다)', () => {
  const T = themes.get('premium');       // airy · fullImage · persuasive
  const c = options.cautions(T).join(' ');
  /* 잰 값이 그대로 문장에 들어가는가 — 인상만 적었으면 숫자가 없다 */
  assert.ok(c.includes(String(themes.DENSITY.airy.section)),
    `여백형 주의점에 잰 값(${themes.DENSITY.airy.section})이 없다 — 인상만 적었다`);
  assert.ok(c.includes(String(themes.DENSITY.normal.section)), '비교 기준값이 없다');
  assert.ok(/사진 전면/.test(c), 'fullImage 표지의 주의점이 없다');
  assert.ok(/설득형/.test(c), 'persuasive 문체의 주의점이 없다');

  const s = options.strengths(T).join(' ');
  T.traits.forEach((t) => assert.ok(s.includes(t), `traits "${t}" 가 장점에 없다`));

  /* 걸리는 것이 없는 테마는 **없다고 적는다** — 빈 목록을 내지 않는다 */
  const plain = options.cautions(themes.get('corporate'));
  assert.ok(plain.length >= 1, '주의점이 빈 목록이다');
});

test('★ 규칙 기반이다 — 같은 딜이면 같은 두 안이 나온다', () => {
  DEALS.forEach((d) => {
    const a = options.pick2(d);
    const b = options.pick2(d);
    assert.strictEqual(a.A.themeId, b.A.themeId);
    assert.strictEqual(a.B.themeId, b.B.themeId);
    assert.strictEqual(a.note, b.note);
  });
});

/* ───────────── 화면 ───────────── */

test('★ 화면에 두 안이 **실제 지면으로** 그려진다 (색 견본이 아니다)', () => {
  const html = builder.build(builder.DEFAULT_SIGNALS);
  const r = options.pick2(builder.DEFAULT_SIGNALS);

  assert.strictEqual((html.match(/class="opt"/g) || []).length, 2, '안이 둘이 아니다');
  assert.ok(html.includes(`data-im-theme="${r.A.themeId}"`), 'A안에 테마가 안 걸렸다');
  assert.ok(html.includes(`data-im-theme="${r.B.themeId}"`), 'B안에 테마가 안 걸렸다');
  /* 표지 + 본문 = 안마다 두 장, 모두 넷 */
  assert.strictEqual((html.match(/class="paper"/g) || []).length, 4, '지면이 넷이 아니다');
  /* 두 안이 **같은 숫자**를 쓰는가 — 다르면 비교가 아니라 딴 문서 둘이다 */
  const total = require(path.join(D, 'tokens.js')).eok(builder.DEAL.total);
  assert.strictEqual((html.match(new RegExp(total.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 2,
    '두 안의 총사업비가 같은 값으로 두 번 나오지 않는다');
});

test('★ 갈리는 것·같은 것을 화면에 **함께** 적는다', () => {
  const html = builder.build(builder.DEFAULT_SIGNALS);
  const r = options.pick2(builder.DEFAULT_SIGNALS);
  r.diffs.diff.forEach((d) => assert.ok(html.includes(d), `갈리는 축 "${d}" 가 화면에 없다`));
  r.diffs.same.forEach((d) => assert.ok(html.includes(d), `같은 축 "${d}" 가 화면에 없다`));
});

test('★ 고르지 않은 안도 순위와 함께 보여 준다 (둘 다 싫을 수 있다)', () => {
  const html = builder.build(builder.DEFAULT_SIGNALS);
  const r = options.pick2(builder.DEFAULT_SIGNALS);
  assert.ok(r.ranked.length >= 2, '추천 순위가 비었다');
  r.ranked.forEach((x) => assert.ok(html.includes(x.label), `순위표에 ${x.label} 이 없다`));
});

test('★ 화면에 이모지가 없다 (대외 문서 규격을 보이는 자리다)', () => {
  const html = builder.build(builder.DEFAULT_SIGNALS);
  const emoji = html.match(/\p{Extended_Pictographic}/gu) || [];
  assert.strictEqual(emoji.length, 0, `이모지가 있다: ${emoji.join(' ')}`);
});

test('★ 파일 하나로 열린다 — 바깥 파일을 안 부른다 (CLAUDE.md §8)', () => {
  const html = builder.build(builder.DEFAULT_SIGNALS);
  assert.ok(!/<link[^>]+href=/i.test(html), '바깥 스타일시트를 부른다');
  assert.ok(!/<script[^>]+src=/i.test(html), '바깥 스크립트를 부른다');
  assert.ok(!/https?:\/\//.test(html), '바깥 주소를 부른다');
});

test('★ 돌릴 때마다 달라지지 않는다 — 시각을 안 박는다', () => {
  const a = builder.build(builder.DEFAULT_SIGNALS);
  const b = builder.build(builder.DEFAULT_SIGNALS);
  assert.strictEqual(a, b);
  assert.ok(!/20\d\d-\d\d-\d\d \d\d:\d\d/.test(a), '생성 시각이 박혀 있다');
});

test('★ 화면이 예시 숫자임을 **화면에** 박는다 (데모를 실제로 오해하지 않게)', () => {
  const html = builder.build(builder.DEFAULT_SIGNALS);
  assert.match(html, /예시/, '예시임을 안 적었다');
});

test('★★★ B안은 **그 문서 종류에 쓰는 테마**에서 고른다 (없으면 없다고 적는다)', () => {
  /* 실측에서 잡았다: IM 인데 B안이 `government`(공식 행정형)로 나왔다 —
     그 테마는 docTypes 에 im 을 안 적어 두었다. 갈리기만 하면 되는 것이 아니라
     **둘 다 쓸 수 있는 안**이어야 고를 거리가 된다. */
  const cases = [
    { assetType: 'datacenter', docType: 'im', investorType: 'institutional' },
    { assetType: 'hotel', docType: 'teaser' },
    { assetType: 'road', docType: 'feasibility' },
    { assetType: 'office', docType: 'ic_memo' },
  ];
  cases.forEach((d) => {
    const r = options.pick2(d);
    const T = themes.get(r.B.themeId);
    const fits = (T.docTypes || []).includes(d.docType);
    if (r.docFiltered) {
      assert.ok(fits, `${d.docType} 인데 B안 ${r.B.themeId} 은 그 문서에 쓴다고 안 적혀 있다`);
      assert.strictEqual(r.B.docFit, true);
    } else {
      /* 못 맞췄으면 **못 맞췄다고 적어야** 한다 */
      assert.match(r.B.why, /문서 종류를 못 맞췄다/,
        `${d.docType} 에서 문서 종류를 못 맞췄는데 그 사실을 안 적었다`);
    }
  });

  /* 거를 것이 없는 경우가 실제로 있는지 — 없으면 위 else 는 헛돈다 */
  const none = options.pick2({ assetType: 'solar', docType: 'pf_proposal', investorType: 'bank' });
  assert.strictEqual(none.docFiltered, false, '표본이 「못 맞추는 경우」를 안 담고 있다');
  assert.match(none.B.why, /문서 종류를 못 맞췄다/);
});

test('★★ 문서 종류에 안 맞는 안은 **화면에 그렇다고 적는다** (조용히 넘어가지 않는다)', () => {
  /* A안도 잰다 — A 는 recommend.js 가 고르는데 자산유형 가중치(40)가
     문서유형(22)보다 커서 문서에 안 맞는 테마가 1위로 올 수 있다 (실측). */
  const sig = { assetType: 'office', docType: 'ic_memo' };
  const r = options.pick2(sig);
  assert.strictEqual(r.A.docFit, false, '표본이 「안 맞는 A안」을 안 담고 있다');
  const html = builder.build(sig);
  assert.match(html, /쓴다고 적혀 있지 않습니다/, '안 맞는다는 사실이 화면에 없다');
  assert.strictEqual((html.match(/class="misfit"/g) || []).length, 1,
    '안 맞는 안이 하나인데 경고가 하나가 아니다');

  /* 둘 다 맞으면 경고가 하나도 없어야 한다 — 늘 뜨면 아무도 안 본다 */
  const ok = builder.build({ assetType: 'datacenter', docType: 'im', investorType: 'institutional' });
  assert.strictEqual((ok.match(/class="misfit"/g) || []).length, 0, '멀쩡한데 경고가 떴다');
});

test('★ 커밋된 화면이 지금 소스로 만든 것과 같다 (CLAUDE.md §8)', () => {
  let got;
  try { got = fs.readFileSync(builder.OUT, 'utf8'); }
  catch (_) { assert.fail('style-options.html 이 없다 — npm run im:styles 를 돌려라'); }
  assert.strictEqual(got, builder.build(builder.DEFAULT_SIGNALS),
    'style-options.html 이 소스와 갈렸다 — npm run im:styles 를 다시 돌려 커밋해라');
});
