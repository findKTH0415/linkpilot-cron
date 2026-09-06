'use strict';
/**
 * options.js — **스타일 두 안(A·B)을 골라 준다** 〈2026-09-06 사장님 지시:
 *   「2가지 스타일 옵션 선택 하도록」〉.
 *
 * ★★★ **왜 둘인가.** 앞 판은 테마를 **13개 단추**로 내놓았다. 그런데 13개는
 *   고르는 것이 아니라 **고르기를 포기하게 만드는 수**다 — 실제로 일어나는 일은
 *   첫 번째를 누르거나 추천을 그냥 받아들이는 것이고, 둘 다 **고른 것이 아니다**
 *   (`build-themes.js` 머리말이 같은 말을 한다).
 *
 *   지시서 §5.1 「5단계: 시안 선택」이 이미 답을 적어 두었다 — **A안(권장) ·
 *   B안(보수·공식) · C안(현대·시각)**. 사장님이 그중 **둘**로 하라고 하셨다.
 *
 * ★★ **둘은 성격이 갈려야 한다.** 「추천 1위와 2위」로 뽑으면 둘이 거의 같은 안이
 *   나오기 쉽다 — 그러면 화면은 둘인데 **고를 것이 없다.** 그래서 B 는 순위가
 *   아니라 **A 와 반대 결**에서 뽑는다. A 가 이미 보수 계열이면 B 는 현대 계열,
 *   A 가 현대 계열이면 B 는 보수 계열이다. **그리고 어느 쪽을 뽑았는지 말한다.**
 *
 * ★★★ **장점·주의점을 지어내지 않는다.** 전부 `themes.js` 에 **실제로 있는 값**
 *   에서 나온다 — `traits` · `writing` · `density` · `cover`. 예를 들어
 *   「쪽수가 늘어난다」는 인상이 아니라 `DENSITY.airy.section = 28` 대
 *   `normal = 20` 이라는 **잰 값**이다. 지어낸 주의점은 사장님이 그것을 믿고
 *   고르시는데 근거가 없다 (CLAUDE.md §4.8 과 같은 결).
 *
 * ★ **규칙 기반이다. 언어모델을 쓰지 않는다** (`recommend.js` 와 같은 이유) —
 *   같은 딜에는 같은 두 안이 나와야 하고, 왜 그 둘인지 설명할 수 있어야 한다.
 */

const themes = require('./themes');
const recommend = require('./recommend');
const { DENSITY, WRITING } = themes;

/**
 * 성격 갈래 — **테마 하나는 한 갈래에만 든다.**
 *
 * ★ 이 표를 여기 두는 이유: `themes.js` 의 `traits` 는 사람이 읽는 낱말이라
 *   기계가 「보수인가」를 물을 수 없다. 갈래는 **판단**이므로 코드에 적고,
 *   그 판단의 근거(`writing` · `cover` · `density`)를 함께 적는다.
 */
const FAMILY = {
  /* 보수·공식 — 장식을 줄이고 표·괘선으로 간다 */
  institutional: 'formal',
  government: 'formal',
  corporate: 'formal',
  infrastructure: 'formal',
  minimal: 'formal',
  /* 현대·시각 — 사진·큰 활자·여백으로 간다 */
  global_ib: 'visual',
  premium: 'visual',
  luxury: 'visual',
  real_estate: 'visual',
  private_equity: 'visual',
  technology: 'visual',
  renewable: 'visual',
};

const OPPOSITE = { formal: 'visual', visual: 'formal' };
const FAMILY_KR = { formal: '보수·공식', visual: '현대·시각' };

/**
 * 장점 — 테마에 **실제로 적혀 있는 것**만 옮긴다.
 */
function strengths(T) {
  const out = [];
  if (T.traits && T.traits.length) out.push(T.traits.join(' · '));
  const w = WRITING[T.writing];
  if (w) out.push(`문체 ${w.label} — ${w.traits.join(' · ')} (${w.for} 대상)`);
  if (T.purpose) out.push(T.purpose);
  const d = DENSITY[T.density];
  if (d) {
    out.push(T.density === 'compact'
      ? `빽빽하게 담는다 (절 간격 ${d.section}px) — 같은 내용이 적은 쪽에 들어간다`
      : T.density === 'airy'
        ? `넉넉하게 둔다 (절 간격 ${d.section}px) — 한 쪽에 하나만 말한다`
        : `표준 간격 (절 간격 ${d.section}px)`);
  }
  return out;
}

/**
 * 주의점 — **잰 값에서 나온 것만** 적는다. 인상은 안 적는다.
 */
function cautions(T) {
  const out = [];
  const d = DENSITY[T.density];
  const n = DENSITY.normal;

  if (T.density === 'airy') {
    const more = Math.round(((d.section / n.section) - 1) * 100);
    out.push(`같은 내용에 **쪽수가 늘어난다** — 절 간격이 표준보다 ${more}% 넓다 (${n.section}px → ${d.section}px). 쪽수 제한이 있는 제출처에서는 절을 덜어내야 한다`);
  }
  if (T.density === 'compact') {
    out.push('빽빽해서 **표가 많은 절이 답답해 보일 수 있다** — 절 간격이 표준보다 좁다');
  }
  if (T.cover === 'fullImage') {
    out.push('표지가 **사진 전면**이다 — 쓸 만한 현장 사진이 없으면 표지가 비어 보인다 (지적 필지 형상만으로는 안 채워진다)');
  }
  if (T.cover === 'split') {
    out.push('표지가 사진과 글자로 **갈린다** — 사진 비율이 맞지 않으면 글자 자리가 좁아진다');
  }
  if (T.writing === 'persuasive' || T.writing === 'brand') {
    out.push('문체가 **설득형**이다 — 공공기관·법원 제출에는 맞지 않는다 (지시서 §6.2 · §6.7 은 객관적·절제된 표현을 요구한다)');
  }
  if (FAMILY[T.id] === 'visual') {
    out.push('색과 사진에 기대는 안이라 **흑백으로 인쇄하면 구분이 약해진다** — 흑백 제출이면 보수형이 안전하다');
  }
  if (T.id === 'minimal') {
    out.push('여백이 많아 **자료가 적을 때 더 적어 보인다** — 채울 값이 부족한 딜에는 불리하다');
  }
  if (!out.length) out.push('구조적으로 걸리는 점이 없다 — 무난한 안이다');
  return out;
}

/** 그 테마로 나오는 문서가 어떤 모습인지 — 값에서 만든 한 줄 */
function shape(T) {
  const cover = { rule: '괘선 표지', split: '사진+글자 분할 표지', fullImage: '사진 전면 표지' }[T.cover] || T.cover;
  const dens = { compact: '고밀도', normal: '표준', airy: '여백형' }[T.density] || T.density;
  const w = WRITING[T.writing];
  return `${cover} · ${dens} · ${w ? w.label : '문체 미지정'} · 차트색 ${T.chart.length}단`;
}

/**
 * **두 안이 실제로 무엇이 다른가** — 재서 적는다 〈2026-09-06 · 실측에서 나왔다〉.
 *
 * ★★★ 첫 판을 그려 보니 A(Global IB)와 B(Institutional)가 **둘 다 네이비**라
 *   나란히 놓아도 색으로는 거의 구별이 안 됐다. 그런데 화면에는
 *   「성격이 갈린다」고만 적혀 있었다 — **그림과 글이 서로 다른 말을 하는** 상태다.
 *
 * ★★ 그래서 갈리는 축을 **하나씩 재서** 적는다. 색이 가까우면 **가깝다고 적는다** —
 *   숨기면 사장님이 「왜 둘이 똑같지」에서 멈추시고, 그때 이 화면은 쓸모가 없다.
 *
 * ★ 색 거리는 RGB 유클리드다. 정밀한 색차(ΔE)가 아니라 **「눈에 띄게 다른가」**만
 *   가리려는 것이라 이 정도로 충분하고, 무엇을 쟀는지 설명할 수 있다.
 *   기준 60 은 실측으로 잡았다 — #10233C 대 #0B1B2B 가 21 이고 이 둘은
 *   나란히 놓으면 구별이 안 된다. #10233C 대 #7A1F2B(적계)는 106 이다.
 */
function rgb(hex) {
  const h = String(hex || '').replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
}
function colorGap(a, b) {
  const x = rgb(a); const y = rgb(b);
  return Math.round(Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0)));
}
const COLOR_NOTICEABLE = 60;

/**
 * @returns {{same:string[], diff:string[], colorGap:number, colorClose:boolean}}
 */
function differences(A, B) {
  const TA = themes.get(A.themeId); const TB = themes.get(B.themeId);
  const gap = colorGap(TA.primary, TB.primary);
  const close = gap < COLOR_NOTICEABLE;
  const same = []; const diff = [];

  const COVER_KR = { rule: '괘선 표지', split: '사진+글자 분할 표지', fullImage: '사진 전면 표지' };
  const DENS_KR = { compact: '고밀도', normal: '표준', airy: '여백형' };

  const pair = (label, a, b, kr) => {
    const ka = (kr && kr[a]) || a; const kb = (kr && kr[b]) || b;
    /* ★ 화살표 「↔」를 쓰지 않는다 〈2026-09-06 · 시험이 잡았다〉 — 그 글자는
       유니코드가 **이모지 표현**을 가진 문자라 대외 문서 규격(이모지 금지)에
       걸린다. 자리에 따라 이모지로 그려지기도 한다. 「대」로 적는다. */
    if (a === b) same.push(`${label}: 둘 다 ${ka}`);
    else diff.push(`${label}: ${ka} 대 ${kb}`);
  };
  pair('표지 형식', TA.cover, TB.cover, COVER_KR);
  pair('정보 밀도', TA.density, TB.density, DENS_KR);
  pair('문체', TA.writing, TB.writing,
    Object.fromEntries(Object.entries(WRITING).map(([k, v]) => [k, v.label])));

  if (close) {
    same.push(`주색: ${TA.primary} 와 ${TB.primary} — 색 거리 ${gap} (기준 ${COLOR_NOTICEABLE} 미만이면 나란히 놓아도 구별이 어렵다)`);
  } else {
    diff.push(`주색: ${TA.primary} 대 ${TB.primary} — 색 거리 ${gap}`);
  }
  return { same, diff, colorGap: gap, colorClose: close };
}

/**
 * 두 안을 고른다.
 *
 * @param {object} signals `recommend.recommend()` 가 받는 것과 같다
 *   (assetType · docType · investorType · transactionType · country)
 * @returns {{A:object, B:object, signals:object, ranked:Array, note:string}}
 */
function pick2(signals = {}) {
  const rec = recommend.recommend(signals);
  const ranked = rec.recommendations || [];

  /* ★ 추천이 비면 짐작하지 않는다 — 정본(institutional)과 그 반대 결로 간다 */
  const topId = (ranked[0] && ranked[0].themeId) || 'institutional';
  const A = themes.get(topId) || themes.get('institutional');
  const famA = FAMILY[A.id] || 'formal';
  const wantB = OPPOSITE[famA];

  /* B 후보 — **반대 결 안에서** 추천 점수가 높은 순, 그다음 그 갈래의 나머지. */
  const inRanked = ranked
    .map((r) => r.themeId)
    .filter((id) => id !== A.id && FAMILY[id] === wantB);
  const rest = Object.keys(FAMILY)
    .filter((id) => FAMILY[id] === wantB && id !== A.id && !inRanked.includes(id));
  let candidates = inRanked.concat(rest);

  /* ★★★ **그 문서 종류에 쓰는 테마 중에서 고른다** 〈2026-09-06 · 실측에서 잡았다〉.
     갈래와 갈리는 축만 보고 골랐더니 **IM 에 `government`(공식 행정형)** 가 B안으로
     나왔다. 그 테마는 `docTypes` 에 `im` 을 아예 안 적어 두었다 — 타당성조사·
     재무보고서용이다. 「갈린다」는 맞지만 **그 문서에 쓸 안이 아니다.**

     ★ 갈리기만 하면 되는 것이 아니라 **둘 다 쓸 수 있는 안**이어야 고를 거리가 된다.
       한쪽이 애초에 못 쓰는 안이면 선택지가 하나인 것과 같다.
     ★★ 다만 **거르고 났더니 아무도 안 남으면 거르지 않는다** — 그때는 문서 종류에
       맞는 보수(또는 현대) 계열이 이 시스템에 없다는 뜻이고, 그 사실을 적는다.
       비었는데 걸러진 채로 두면 엉뚱한 기본값이 조용히 나간다. */
  const want = signals.docType;
  const fitsDoc = (id) => {
    const T = themes.get(id);
    return !want || (T && Array.isArray(T.docTypes) && T.docTypes.includes(want));
  };
  const fitted = candidates.filter(fitsDoc);
  const docFiltered = fitted.length > 0;
  if (docFiltered) candidates = fitted;

  /* ★★★ **갈래만 반대면 충분하지 않다** 〈2026-09-06 · 그려 보고 알았다〉.
     첫 판은 `global_ib`(현대 계열)와 `institutional`(보수 계열)을 냈는데,
     실제로 갈리는 축이 **표지 형식 하나뿐**이었다 — 문체·밀도·색이 전부 같아
     나란히 놓아도 거의 같은 문서로 보였다. 갈래표는 「다르다」고 하는데
     **그린 것은 같았다.**

     그래서 이제 **재고 고른다**: 갈리는 축이 둘 이상인 첫 후보를 쓴다.
     하나도 못 찾으면 **가장 많이 갈리는 것**을 쓰고, 몇 개만 갈리는지 적는다 —
     억지로 둘을 만들지 않고 **적은 대로 말한다**. */
  const MIN_AXES = 2;
  const scored = candidates
    .map((id) => {
      const T = themes.get(id);
      if (!T) return null;
      return { id, n: differences({ themeId: A.id }, { themeId: id }).diff.length };
    })
    .filter(Boolean);
  const enough = scored.find((c) => c.n >= MIN_AXES);
  const best = scored.slice().sort((a, b) => b.n - a.n)[0];
  const fallback = wantB === 'formal' ? 'institutional' : 'global_ib';
  const chosen = enough || best;
  const bId = (chosen && chosen.id) || fallback;
  const B = themes.get(bId) || themes.get(fallback);
  const bWasRanked = inRanked.includes(bId);
  const bWeak = !enough;

  const reasonOf = (id) => {
    const hit = ranked.find((r) => r.themeId === id);
    return hit ? { confidence: hit.confidence, reasons: hit.reasons } : null;
  };

  const ra = reasonOf(A.id);
  const rb = reasonOf(B.id);

  /* ★★ **그 안이 이 문서 종류에 쓴다고 적혀 있는가** — 재서 그대로 적는다.
     A안은 `recommend.js` 가 고르는데, 그쪽은 **자산유형 가중치(40)가 문서유형(22)보다
     커서** 문서 종류에 안 맞는 테마가 1위로 올라올 수 있다 (실측: office+ic_memo →
     `real_estate`). 여기서 추천 규칙을 바꾸지는 않는다 — 다른 자리에 영향이 간다.
     대신 **안 맞으면 안 맞는다고 화면에 적는다.** 조용히 넘어가면 사장님이
     그 사실을 모르신 채로 고르신다 (CLAUDE.md §8 「못 잰 것은 통과가 아니다」와 같은 결). */
  const docFit = (T) => !signals.docType
    || (Array.isArray(T.docTypes) && T.docTypes.includes(signals.docType));

  const opt = (T, role, roleKr, r, why) => ({
    role,                                   // 'A' | 'B'
    roleKr,                                 // 화면에 쓰는 이름
    themeId: T.id,
    label: T.label,
    labelKr: T.labelKr,
    family: FAMILY[T.id] || 'formal',
    familyKr: FAMILY_KR[FAMILY[T.id] || 'formal'],
    purpose: T.purpose,
    confidence: r ? r.confidence : null,
    reasons: r ? r.reasons : [],
    why,                                    // 왜 이 자리에 놓였는가
    strengths: strengths(T),
    cautions: cautions(T),
    shape: shape(T),
    docFit: docFit(T),
    docType: signals.docType || null,
  });

  const A0 = opt(A, 'A', '권장안', ra,
    ra ? `이 딜의 신호로 점수가 가장 높다 (${ra.confidence}점 · ${ra.reasons.join(' · ')})`
      : '딜 신호가 없어 정본(기관투자자용)으로 둔다');
  const B0 = opt(B, 'B', wantB === 'formal' ? '보수·공식안' : '현대·시각안', rb,
    `A안(${A.label})이 ${FAMILY_KR[famA]} 계열이라, **성격이 갈리는** ${FAMILY_KR[wantB]} 계열에서`
    + ` 갈리는 축이 가장 확실한 것을 골랐다 (${chosen ? chosen.n : 0}가지가 갈린다)`
    + (want ? (docFiltered ? ` — ${want} 에 쓰는 테마 중에서만 골랐다` : ` — ★ ${want} 에 쓴다고 적힌 ${FAMILY_KR[wantB]} 테마가 없어 **문서 종류를 못 맞췄다**`) : '')
    + (bWasRanked ? ` — 추천 목록에도 든 안이다 (${rb ? rb.confidence + '점' : '점수 없음'})` : ' — 추천 목록에는 없지만, **고를 거리를 만들려고** 넣었다'));
  const diffs = differences(A0, B0);

  return {
    A: A0,
    B: B0,
    diffs,
    signals: rec.signals,
    docFiltered,
    ranked,
    /* ★ 「갈린다」를 말로만 적지 않는다 — **무엇이 갈리고 무엇이 같은지** 함께 적는다.
       색이 가까운데 「성격이 갈린다」고만 쓰면 그림과 글이 서로 다른 말을 한다. */
    note: (bWeak
      ? `★ 이 딜에서는 갈리는 축이 ${diffs.diff.length}가지뿐이다 — 두 안이 비슷하다는 뜻이고, 그것이 사실이다`
      : `두 안은 ${diffs.diff.length}가지가 갈린다`)
      + (diffs.colorClose
        ? ' — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다.'
        : ' — 색까지 갈린다.'),
  };
}

module.exports = { pick2, strengths, cautions, shape, differences, colorGap,
  FAMILY, FAMILY_KR, OPPOSITE, COLOR_NOTICEABLE };
