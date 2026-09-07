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
const recommend = require(path.join(D, 'recommend.js'));
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

test('★★★ 문서 종류 **전부**가 두 계열 모두에서 짝을 찾는다 (사장님 지시 · 외부 문서 여섯)', () => {
  /* 〈2026-09-06 사장님 지시: 「오류발생 · 외부에서 · financial_report ·
     technical_report · dd_report · legal_dd · investor_presentation · dashboard」〉

     스타일 두 안은 **보수·공식 하나 · 현대·시각 하나**를 낸다. 그러니 문서 종류마다
     양쪽 계열에 **쓴다고 적힌 테마가 하나씩은** 있어야 고를 거리가 둘이 된다.
     그 여섯은 한쪽(또는 양쪽)이 비어 있었고, `legal_dd`·`dashboard` 는 **양쪽 다**
     비어 있었다. */
  const holes = [];
  Object.keys(themes.DOC_PROFILE).forEach((d) => {
    const fam = { formal: 0, visual: 0 };
    themes.list().forEach((x) => {
      const T = themes.get(x.id);
      if (!(T.docTypes || []).includes(d)) return;
      const f = options.FAMILY[T.id];
      if (f) fam[f]++;
    });
    if (!fam.formal || !fam.visual) {
      holes.push(`${d}: 보수 ${fam.formal}개 · 현대 ${fam.visual}개`);
    }
  });
  assert.deepStrictEqual(holes, [],
    '한쪽 계열이 빈 문서 종류가 있다 — 그 문서에서는 고를 거리가 하나다:\n  ' + holes.join('\n  '));
});

test('★★★ 실제 조합 전부에서 두 안이 **그 문서에 쓰는 테마**다 (안 맞는 것이 0건)', () => {
  const assets = ['datacenter', 'solar', 'realestate', 'hotel', 'office', 'logistics', 'road', 'generic'];
  const bad = [];
  Object.keys(themes.DOC_PROFILE).forEach((d) => assets.forEach((a) => {
    const r = options.pick2({ assetType: a, docType: d });
    if (!r.A.docFit) bad.push(`${a}+${d}: A=${r.A.themeId}`);
    if (!r.B.docFit) bad.push(`${a}+${d}: B=${r.B.themeId}`);
  }));
  assert.deepStrictEqual(bad, [],
    `안 맞는 안이 ${bad.length}건 남았다:\n  ` + bad.slice(0, 12).join('\n  '));
});

test('★★ 그래도 정말 없으면 **없다고 적는다** (지어내지 않는다)', () => {
  /* ★ 표본을 **없는 문서 종류**로 만든다. 실제 문서 종류는 이제 전부 맞으므로,
     진짜 조합으로는 이 갈래를 못 잰다 — 그렇다고 갈래를 지우면 나중에 문서 종류가
     늘었을 때 **조용히 엉뚱한 테마가 나간다.** */
  const r = options.pick2({ assetType: 'generic', docType: 'no_such_doc_type' });
  assert.strictEqual(r.docFiltered, false, '없는 문서 종류인데 걸러졌다고 한다');
  assert.match(r.B.why, /문서 종류를 못 맞췄다/, 'B안이 못 맞췄다고 안 적는다');
  assert.strictEqual(r.A.docFit, false);
  assert.strictEqual(r.B.docFit, false);
  assert.ok(r.A && r.B, '못 맞춰도 두 안은 나와야 한다 — 빈 화면을 내지 않는다');
});

test('★★ 문서 종류에 안 맞는 안은 **화면에 그렇다고 적는다** (조용히 넘어가지 않는다)', () => {
  /* A안도 잰다. ★ 이제 A 도 순위 안에서 문서 종류에 맞는 것을 먼저 집으므로,
     안 맞는 경우는 **순위 셋이 전부 그 문서를 안 적어 둔 때**만 남는다.
     앞 판 표본(오피스+IC메모)은 고치고 나서 맞아 버렸다 — 시험이 잡아 줬다. */
  /* ★ 실제 문서 종류는 이제 전부 맞으므로 **없는 종류**로 그 갈래를 연다.
     앞 판 표본(datacenter+legal_dd)은 여섯을 메우면서 맞아 버렸다 — 시험이 잡아 줬다. */
  const sig = { assetType: 'datacenter', docType: 'no_such_doc_type' };
  const r = options.pick2(sig);
  assert.strictEqual(r.A.docFit, false, '표본이 「안 맞는 A안」을 안 담고 있다');
  const html = builder.build(sig);
  assert.match(html, /쓴다고 적혀 있지 않습니다/, '안 맞는다는 사실이 화면에 없다');
  /* ★ 「하나」로 못박지 않는다 — 둘 다 안 맞는 조합이 실제로 있다(datacenter+legal_dd).
     **안 맞는 개수만큼** 떠야 한다는 것이 재려는 성질이다. 수를 박아 두면 표본이
     바뀔 때마다 검사가 헛울음을 낸다 (앞 판이 그랬고, 그래서 빨개졌다). */
  const misfits = [r.A, r.B].filter((o) => !o.docFit).length;
  assert.strictEqual((html.match(/class="misfit"/g) || []).length, misfits,
    `안 맞는 안이 ${misfits}개인데 경고 수가 다르다`);

  /* 둘 다 맞으면 경고가 하나도 없어야 한다 — 늘 뜨면 아무도 안 본다 */
  const ok = builder.build({ assetType: 'datacenter', docType: 'im', investorType: 'institutional' });
  assert.strictEqual((ok.match(/class="misfit"/g) || []).length, 0, '멀쩡한데 경고가 떴다');
});

test('★★ A안도 **문서 종류에 맞는 것**을 순위 안에서 먼저 집는다 (추천 규칙은 안 건드린다)', () => {
  /* recommend.js 는 자산유형 가중치(40)가 문서유형(22)보다 커서 문서에 안 맞는
     테마를 1위로 낸다 — 그 표는 다른 자리도 읽으므로 안 건드리고, **여기서 고를 때만**
     순위 안에서 맞는 것을 집는다. 실측: 오피스+IC메모 는 recommend 1위가
     `real_estate`(ic_memo 없음)인데 A 는 `minimal`(ic_memo 있음)이 되어야 한다. */
  const sig = { assetType: 'office', docType: 'ic_memo' };
  const top = recommend.recommend(sig).recommendations[0].themeId;
  assert.ok(!(themes.get(top).docTypes || []).includes('ic_memo'),
    `표본이 못 쓴다 — recommend 1위(${top})가 이미 그 문서에 맞는다`);

  const r = options.pick2(sig);
  assert.strictEqual(r.A.docFit, true, `A안 ${r.A.themeId} 이 그 문서에 맞지 않는다`);
  assert.notStrictEqual(r.A.themeId, top, '순위 1위를 그대로 집었다 — 거르지 않았다');

  /* 순위 **안에서** 집어야 한다 — 아무 테마나 데려오면 추천이 뜻을 잃는다 */
  const ids = recommend.recommend(sig).recommendations.map((x) => x.themeId);
  assert.ok(ids.includes(r.A.themeId), `A안 ${r.A.themeId} 이 추천 순위 밖에서 왔다`);
});

test('★★ 축 수가 같으면 **색이 더 갈리는 쪽**을 집는다 (없는 테마를 만들지 않는다)', () => {
  /* 처음에는 「팔레트가 전부 어두워 색으로는 못 가른다」고 적었는데 **재 보니 틀렸다** —
     갈래를 가로지르는 35쌍 중 8쌍이 기준(60)을 넘는다. 색 변화는 이미 있었고
     고르는 규칙이 거기까지 안 갔을 뿐이다. */
  const F = []; const V = [];
  themes.list().forEach((x) => {
    const f = options.FAMILY[x.id];
    if (f === 'formal') F.push(themes.get(x.id));
    if (f === 'visual') V.push(themes.get(x.id));
  });
  let over = 0;
  F.forEach((a) => V.forEach((b) => { if (options.colorGap(a.primary, b.primary) >= options.COLOR_NOTICEABLE) over++; }));
  assert.ok(over >= 5, `갈래를 가로질러 색이 갈리는 짝이 ${over}쌍뿐 — 색으로 고를 거리가 없다`);

  /* ★★ **규칙을 그대로 다시 계산해 대 본다** — 「색이 갈리는 딜이 하나라도 있는가」로
     재면 동점처리를 꺼도 통과한다(사보타주로 확인했다). 재려는 것은
     **축이 충분한 후보 중 색이 가장 갈리는 것을 집었는가**다. */
  const cases = [
    { assetType: 'hotel', docType: 'financial_report' },   // 후보 셋 · 색 48/86/117
    { assetType: 'road', docType: 'im' },                  // 후보 여섯
    { assetType: 'datacenter', docType: 'feasibility' },
    { assetType: 'hotel', docType: 'pf_proposal' },
  ];
  let decided = 0;
  cases.forEach((d) => {
    const r = options.pick2(d);
    const A = themes.get(r.A.themeId);
    const cands = Object.keys(options.FAMILY)
      .filter((id) => options.FAMILY[id] === r.B.family && id !== A.id
        && (!d.docType || (themes.get(id).docTypes || []).includes(d.docType)))
      .map((id) => ({
        id,
        n: options.differences({ themeId: A.id }, { themeId: id }).diff.length,
        g: options.colorGap(A.primary, themes.get(id).primary),
      }))
      .filter((c) => c.n >= 2);
    if (cands.length < 2) return;
    const gaps = new Set(cands.map((c) => c.g));
    if (gaps.size < 2) return;               // 색이 다 같으면 이 딜은 안 재진다
    decided++;
    const want = cands.slice().sort((a, b) => b.g - a.g)[0];
    assert.strictEqual(r.B.themeId, want.id,
      `${d.assetType}+${d.docType}: 색이 가장 갈리는 ${want.id}(${want.g}) 대신 `
      + `${r.B.themeId}(${cands.find((c) => c.id === r.B.themeId).g}) 를 집었다`);
  });
  assert.ok(decided >= 3, `동점처리가 실제로 결정한 딜이 ${decided}개뿐 — 표본이 안 재고 있다`);
});

test('★ renewable 이 pf_proposal 을 받는다 — 그 문서에 쓸 현대·시각 테마가 있어야 한다', () => {
  /* 실측에서 잡은 빈자리: `pf_proposal` 에 쓴다고 적힌 현대·시각 계열 테마가 하나도
     없어서 PF 제안서에서 B안이 문서 종류를 못 맞췄다. 재생에너지 PF 는 이 저장소가
     실제로 다루는 딜이다(태양광·ESS). */
  assert.ok((themes.get('renewable').docTypes || []).includes('pf_proposal'),
    'renewable 이 pf_proposal 을 안 받는다');
  const r = options.pick2({ assetType: 'solar', docType: 'pf_proposal', investorType: 'bank' });
  assert.strictEqual(r.docFiltered, true, 'pf_proposal 에서 여전히 문서 종류를 못 맞춘다');
  assert.strictEqual(r.B.docFit, true, `B안 ${r.B.themeId} 이 pf_proposal 에 안 맞는다`);
  assert.strictEqual(r.A.docFit, true, `A안 ${r.A.themeId} 이 pf_proposal 에 안 맞는다`);
});

test('★★ 순위 셋이 다 안 맞으면 **같은 계열 안에서** 바꿔 온다 (계열까지 버리지 않는다)', () => {
  /* 실측: 호텔+재무보고서 — 추천 순위는 luxury·premium·real_estate 인데 셋 다
     financial_report 를 안 적어 두었다. 계열(현대·시각)은 지키고 global_ib 로 바꾼다. */
  const sig = { assetType: 'hotel', docType: 'financial_report' };
  const ids = recommend.recommend(sig).recommendations.map((x) => x.themeId);
  ids.forEach((id) => assert.ok(!(themes.get(id).docTypes || []).includes('financial_report'),
    `표본이 못 쓴다 — 순위의 ${id} 가 이미 그 문서에 맞는다`));

  const r = options.pick2(sig);
  assert.strictEqual(r.aFromOutside, true, '순위 밖에서 데려왔다고 표시하지 않는다');
  assert.strictEqual(r.A.docFit, true, `A안 ${r.A.themeId} 이 그 문서에 안 맞는다`);
  assert.strictEqual(options.FAMILY[r.A.themeId], options.FAMILY[ids[0]],
    `계열이 바뀌었다: ${ids[0]}(${options.FAMILY[ids[0]]}) → ${r.A.themeId}(${options.FAMILY[r.A.themeId]})`);
  assert.match(r.A.why, /모두 financial_report 에 쓴다고 적혀 있지 않아/,
    '왜 바꿨는지 화면에 적지 않는다');
});

test('★★ `custom` 은 **의도된 빈칸**이다 — 채우지 않는다', () => {
  /* 〈2026-09-06 · 권고 ①을 재 보고 뒤집었다〉 앞서 「custom 의 docTypes 가 비어 있어
     어떤 문서에도 안 맞는다」를 고칠 것으로 적었는데, 소스를 읽어 보니 **일부러 비운
     것**이었다 — 「사람이 고른다 · custom 은 값을 지어내지 않는다」. Brand Kit 이
     덮어쓰는 자리라 문서 종류를 미리 박으면 그 뜻이 깨진다.

     ★ 그래서 채우는 대신 **채우지 못하게** 못박는다. 나중에 누가 「빈 칸이네」하고
       메우면 이 검사가 빨개진다. */
  const T = themes.get('custom');
  assert.ok(T, 'custom 테마가 사라졌다');
  assert.deepStrictEqual(T.docTypes, [],
    'custom 에 문서 종류가 들어갔다 — 일부러 비운 자리다 (Brand Kit 이 덮어쓴다)');
  assert.strictEqual(T.writing, null, 'custom 에 문체가 박혔다 — 사람이 고르는 자리다');
  assert.strictEqual(T.inherits, 'institutional', 'custom 이 상속 대상을 잃었다');

  /* 두 안 후보에 안 들어간다 — 갈래표에 없어야 그렇게 된다 */
  assert.strictEqual(options.FAMILY.custom, undefined,
    'custom 이 성격 갈래에 들어갔다 — 값이 없는 테마가 A·B 로 뽑힌다');

  /* 그리고 **왜 비웠는지가 소스에 적혀 있어야** 한다 — 이유가 없으면 반년 뒤 메운다 */
  const src = fs.readFileSync(path.join(D, 'themes.js'), 'utf8');
  const blk = src.slice(src.indexOf('  custom: {'), src.indexOf('  custom: {') + 900);
  assert.match(blk, /지어내지 않는다|사람이 고른다/, 'custom 을 비운 이유가 소스에 없다');
});

test('★★★ 보수·공식이 **한 테마에 쏠리지 않는다** (두 안이 늘 같은 안이면 뜻이 없다)', () => {
  /* 〈2026-09-06 · 실측〉 88개 조합에서 `institutional` 이 45번(51%)이고 `corporate`
     는 2번뿐이었다. 그러면 B안이 사실상 늘 같은 안이라 「두 안」이 무색해진다.
     government·infrastructure·corporate 에 대안을 더해 폭을 넓혔다. */
  const assets = ['datacenter', 'solar', 'realestate', 'hotel', 'office', 'logistics', 'road', 'generic'];
  const docs = Object.keys(themes.DOC_PROFILE);
  const cnt = {};
  let total = 0;
  docs.forEach((d) => assets.forEach((a) => {
    const r = options.pick2({ assetType: a, docType: d });
    [r.A, r.B].forEach((x) => {
      if (options.FAMILY[x.themeId] !== 'formal') return;
      cnt[x.themeId] = (cnt[x.themeId] || 0) + 1;
      total++;
    });
  }));
  assert.ok(total > 50, `보수 쪽 표본이 ${total}개뿐 — 아무것도 안 재고 있다`);

  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  const share = top[1] / total;
  /* ★ 기준 0.48 은 **실측 두 값 사이**에서 잡았다 — 고치기 전 0.511(45/88),
     고친 뒤 0.420(37/88). 넉넉하게 0.55 로 뒀더니 **되돌려도 안 물었다**
     (사보타주로 확인했다). 재려는 상태를 못 잡는 기준은 없는 것과 같다. */
  assert.ok(share <= 0.48,
    `보수 쪽이 ${top[0]} 하나에 ${Math.round(share * 100)}% 쏠렸다 `
    + `(${JSON.stringify(cnt)}) — 두 안이 늘 같은 안이 된다`);

  /* 쓰이는 테마가 몇 종인지도 본다 — 한둘만 돌면 위 비율이 낮아도 뜻이 없다 */
  assert.ok(Object.keys(cnt).length >= 4,
    `보수 쪽에서 ${Object.keys(cnt).length}종만 쓰인다 — 나머지는 죽은 테마다`);
});

test('★★★ 화면이 내놓는 테마 이름이 **엔진에 실제로 있다** (권고 ③ · 진짜 버그였다)', () => {
  /* 〈2026-09-06 · 권고 ③을 하다가 잡았다〉 출력조건 화면(`reports.html`)이 테마 셋을
     손으로 박아 두었고, 그중 **둘(`modern`·`pdi`)이 `themes.js` 에 없는 이름**이었다.
     고르면 `design-state.select()` 가 「알 수 없는 디자인 테마」로 **던진다** —
     그런데 화면에서는 멀쩡히 눌렸고 아무 표시도 안 났다. */
  const P = path.join(__dirname, '..', 'ui', 'platform');
  const screen = fs.readFileSync(path.join(P, 'reports.html'), 'utf8');

  /* 없는 이름이 되살아나면 빨개진다 */
  ['modern', 'pdi'].forEach((bad) => {
    assert.ok(!new RegExp(`id:\\s*'${bad}'`).test(screen),
      `화면에 엔진에 없는 테마 '${bad}' 가 다시 들어왔다`);
  });

  /* 짝 표를 실제로 읽는가 — 안 읽으면 다시 손으로 박은 것이다.
     ★ **글자만 찾지 않는다** — 이 화면의 주석에도 `style-ab.js` 가 적혀 있어서
       그냥 찾으면 스크립트 태그를 지워도 통과한다(사보타주로 확인했다).
       CLAUDE.md §8 「소스를 글자로 대조하는 검사는 주석을 떼고 본다」와 같은 결이다.
       그래서 **여는 script 태그**를 본다. */
  assert.match(screen, /<script\s+src="style-ab\.js/,
    '화면이 짝 표 스크립트를 안 싣는다 (주석에만 있고 태그가 없다)');
  assert.match(screen.replace(/\/\*[\s\S]*?\*\//g, ''), /lpStylePair\(/,
    '화면이 짝 표 함수를 안 부른다 (주석을 뺀 코드에 없다)');

  /* 화면 소스에 남은 테마 id 는 전부 엔진에 있어야 한다 */
  const ids = [...screen.matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1]);
  const known = new Set(themes.list().map((x) => x.id));
  ids.filter((id) => known.has(id) || /^(institutional|global_ib|premium|luxury|minimal|corporate|government|technology|renewable|infrastructure|real_estate|private_equity|custom)$/.test(id))
    .forEach((id) => assert.ok(known.has(id), `화면의 테마 '${id}' 가 엔진에 없다`));
});

test('★★ 짝 표(생성물)가 소스와 같고, 없는 이름을 안 담는다', () => {
  const gen = builder.pairsFile();
  let got;
  try { got = fs.readFileSync(builder.OUT_PAIRS, 'utf8'); }
  catch (_) { assert.fail('style-ab.js 가 없다 — npm run im:styles 를 돌려라'); }
  /* ★ 판 지문(`LP_BUILD`)은 **`build-stamp.js` 가 나중에 채운다.** 생성기는 빈 값으로
     내므로, 대 볼 때는 `bare()` 와 같은 방식으로 그 자리를 지우고 본다 —
     안 그러면 지문을 찍을 때마다 이 검사가 빨개진다 (M-29 와 같은 결). */
  const blank = (t) => t.replace(/(LP_BUILD = ')[0-9a-f_]*(')/g, '$1$2');
  assert.strictEqual(blank(got), blank(gen),
    'style-ab.js 가 소스와 갈렸다 — npm run im:styles 를 다시 돌려라');
  assert.match(got, /LP_BUILD = '[0-9a-f]{8}'/,
    '짝 표에 판 지문이 안 찍혔다 — npm run im:stamp 를 돌려라');

  /* 담긴 이름이 전부 실재하는가 — 이것이 이 파일을 만든 이유다 */
  const data = builder.pairs();
  const known = new Set(themes.list().map((x) => x.id));
  const docs = Object.keys(themes.DOC_PROFILE);
  assert.deepStrictEqual(Object.keys(data).sort(), docs.slice().sort(),
    '문서 종류가 빠졌거나 없는 것이 들어갔다');
  docs.forEach((d) => {
    [data[d].A, data[d].B].forEach((o) => {
      assert.ok(known.has(o.id), `${d} 의 ${o.role}안 '${o.id}' 가 엔진에 없다`);
      assert.ok(o.name && o.color, `${d} 의 ${o.role}안에 이름·색이 없다`);
    });
    assert.notStrictEqual(data[d].A.id, data[d].B.id, `${d} 의 두 안이 같다`);
  });

  /* 화면이 고른 값을 거를 수 있게 이름 목록도 함께 나가는가 */
  assert.match(gen, /LP_THEME_IDS/, '엔진 테마 이름 목록이 안 나간다');
  themes.list().forEach((x) => assert.ok(gen.includes(`"${x.id}"`), `${x.id} 가 목록에 없다`));
});

test('★★★ 화면이 부르는 형제 스크립트가 **배포 목록에 있다** (없으면 조용히 안 돈다)', () => {
  /* ★ 이것이 이 저장소의 단골 사고다 — 파일은 저장소에 있고 검사도 초록인데
     **NAS 에 안 올라가서** 화면에서만 기능이 죽는다. 404 는 오류를 안 낸다.
     `reports.html` 이 `style-ab.js` 를 부르므로 그 파일도 함께 나가야 한다. */
  const P = path.join(__dirname, '..', 'ui', 'platform');
  const wf = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', 'deploy-nas.yml'), 'utf8');

  const screen = fs.readFileSync(path.join(P, 'reports.html'), 'utf8');
  const siblings = [...screen.matchAll(/<script\s+src="([a-z0-9-]+\.js)/g)].map((m) => m[1]);
  assert.ok(siblings.length >= 4, `형제 스크립트를 ${siblings.length}개만 찾았다 — 안 재고 있다`);
  assert.ok(siblings.includes('style-ab.js'), '짝 표가 형제 목록에 없다');

  const missing = siblings.filter((f) => !wf.includes(`im-agent/ui/platform/${f}`));
  assert.deepStrictEqual(missing, [],
    `화면이 부르는데 배포 목록에 없는 파일: ${missing.join(' · ')} — NAS 에서 404 가 되고 기능이 조용히 죽는다`);
});

test('★★★ 짝 표를 다시 만들어도 **판 지문이 안 지워진다** (guard 가 잡은 구멍)', () => {
  /* 〈2026-09-06 · guard 가 잡았다〉 생성기가 늘 빈 지문으로 내던 판에서는,
     `guard` 가 「미리보기 재생성」으로 이 파일을 다시 만들 때마다 지문이 지워져
     바로 다음 칸(「화면 지문」)이 **매번 빨갰다** — 고칠 것이 없는데도.
     생성기는 내용만 책임지고 지문은 build-stamp 가 소유한다. */
  const onDisk = fs.readFileSync(builder.OUT_PAIRS, 'utf8');
  const now = (onDisk.match(/LP_BUILD = '([0-9a-f_]*)'/) || [])[1];
  assert.match(now || '', /^[0-9a-f]{8}$/, '짝 표에 판 지문이 안 찍혀 있다');

  /* 다시 만들어도 같은 지문이 남아야 한다 */
  const again = builder.pairsFile();
  const kept = (again.match(/LP_BUILD = '([0-9a-f_]*)'/) || [])[1];
  assert.strictEqual(kept, now,
    `다시 만들자 지문이 '${now}' → '${kept}' 로 바뀌었다 — guard 가 매번 빨개진다`);
  assert.strictEqual(builder.keptStamp(), now);
});

test('★ 커밋된 화면이 지금 소스로 만든 것과 같다 (CLAUDE.md §8)', () => {
  let got;
  try { got = fs.readFileSync(builder.OUT, 'utf8'); }
  catch (_) { assert.fail('style-options.html 이 없다 — npm run im:styles 를 돌려라'); }
  assert.strictEqual(got, builder.build(builder.DEFAULT_SIGNALS),
    'style-options.html 이 소스와 갈렸다 — npm run im:styles 를 다시 돌려 커밋해라');
});
