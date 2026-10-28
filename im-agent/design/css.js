'use strict';
/**
 * css.js — **디자인 시스템을 CSS 로 내보낸다** 〈2026-09-06 신설 · 사장님 지시
 *   「반영된 디자인 레이아웃 구축해줘」〉.
 *
 * ★★★ **왜 만들었나.** 이 저장소의 디자인은 이미 데이터로 다 있다 —
 *   `tokens.js`(색·활자·크기) · `themes.js`(13종) · `layouts.js`(12종) ·
 *   `rules.json`(규칙). 그런데 **그것을 쓰는 길이 하나뿐이었다**:
 *   `a4.js` 가 값을 읽어 **인라인 style 문자열**로 박는 길.
 *
 *   그래서 A4 산출물 밖에서 같은 디자인을 쓰려면 **사람이 색을 옮겨 적었다.**
 *   옮겨 적은 것은 「지금은 같다」일 뿐이고, **갈리는 날 아무도 눈치채지 못한다**
 *   — `design-system.test.js` 가 잡아낸 `--lime-deep` 세 값(#5C7A00 · #4F6900 ·
 *   #4F6A00)이 정확히 그 사고였다.
 *
 * ★★ **그러니 CSS 를 손으로 쓰지 않는다.** 이 파일은 `tokens.js` 와 `themes.js`
 *   에서 값을 **읽어서** CSS 를 만든다. 토큰을 고치면 CSS 가 따라 바뀌고,
 *   따로 고칠 자리가 없다. 두 벌이 안 생기는 유일한 방법이다 (CLAUDE.md §8-1).
 *
 * ★ **인라인 style 을 없애자는 것이 아니다.** `a4.js` 의 인라인 방식은 핸드오프
 *   규격이라 그대로 둔다(rules.json D7). 이 CSS 는 **A4 밖**을 위한 것이다 —
 *   레이아웃 견본·미리보기·화면에 얹는 보고서 조각.
 *
 * ★★ **한 곳에서 두 갈래가 같은 값을 말하는지는 시험이 잰다**
 *   (`test/design-layout.test.js`). 사람이 눈으로 대지 않는다.
 */

const { COLOR, FONT, SIZE, PAGE } = require('./tokens');
const themes = require('./themes');
const { LAYOUTS } = require('./layouts');

/**
 * 토큰 → CSS 커스텀 속성 이름.
 *
 * ★ 접두어를 `--im-` 으로 둔다. 플랫폼 화면 토큰은 `--lp-` 이고 **다른 체계다**
 *   (tokens.js 머리말: 브리핑 #C00000/Arial · IM 은 A4 인쇄). 접두어가 같으면
 *   한 화면에 둘이 섞였을 때 **어느 쪽이 이겼는지 알 수 없다.**
 */
function varsFor(theme) {
  const T = theme;
  return {
    /* 팔레트 — 테마가 정하는 것 */
    '--im-primary': T.primary,
    '--im-primary-mid': T.primaryMid,
    '--im-accent': T.accent,
    '--im-accent-light': T.accentLight,
    '--im-on-primary': T.onPrimary,
    '--im-on-primary-sub': T.onPrimarySub,
    '--im-surface-alt': T.surfaceAlt,

    /* 구조 — 테마가 바꾸지 않는 것 (themes.js STRUCTURE 와 같은 값) */
    '--im-body': COLOR.body,
    '--im-body-2': COLOR.body2,
    '--im-muted': COLOR.muted,
    '--im-faint': COLOR.faint,
    '--im-faint-2': COLOR.faint2,
    '--im-rule-strong': COLOR.ruleStrong,
    '--im-rule-weak': COLOR.ruleWeak,
    '--im-surface': COLOR.surface,
    '--im-track': COLOR.track,
    '--im-negative': COLOR.negative,
    '--im-brand-red': COLOR.brandRed,

    /* 활자 */
    '--im-serif': T.serif || FONT.serif,
    '--im-sans': T.sans || FONT.sans,

    /* 크기 (px) */
    '--im-h1': `${SIZE.h1}px`,
    '--im-h2': `${SIZE.h2}px`,
    '--im-h2-small': `${SIZE.h2Small}px`,
    '--im-h3': `${SIZE.h3}px`,
    '--im-text': `${SIZE.body}px`,
    '--im-table': `${SIZE.table}px`,
    '--im-table-head': `${SIZE.tableHead}px`,
    '--im-caption': `${SIZE.caption}px`,
    '--im-micro': `${SIZE.micro}px`,

    /* 지면 */
    '--im-page-w': `${PAGE.widthMm}mm`,
    '--im-page-h': `${PAGE.heightMm}mm`,
    '--im-page-margin': `${PAGE.marginMm}mm`,
  };
}

/**
 * 레이아웃 12종의 격자.
 *
 * ★★ **`layouts.js` 의 id 를 그대로 쓴다.** 여기서 새로 이름을 짓지 않는다 —
 *   이름이 갈리면 「L06 을 골랐다」는 로그와 화면의 L06 이 다른 것을 가리키게
 *   되고, 그 상태가 **아무 오류도 안 낸다** (CLAUDE.md §4 열쇠 이름과 같은 결).
 *
 * ★ 값은 **격자만** 정한다. 색·활자는 위 변수에서 온다.
 */
const GRID = {
  L01: 'grid-template-columns:1fr;grid-template-rows:1fr auto',
  L02: 'grid-template-columns:1fr 1fr',
  L03: 'grid-template-columns:1fr 1fr 1fr',
  L04: 'grid-template-columns:repeat(2,1fr);grid-auto-rows:min-content',
  L05: 'grid-template-columns:1fr;grid-template-rows:1fr auto',
  L06: 'grid-template-columns:1fr',
  L07: 'grid-template-columns:1.4fr 1fr',
  L08: 'grid-template-columns:1fr',
  L09: 'grid-template-columns:1fr',
  L10: 'grid-template-columns:1fr 1.1fr',
  L11: 'grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr',
  L12: 'grid-template-columns:1fr',
};

/** 한 줄짜리 `--이름: 값;` 목록 */
function declare(vars, indent = '  ') {
  return Object.entries(vars).map(([k, v]) => `${indent}${k}: ${v};`).join('\n');
}

/**
 * 디자인 시스템 CSS 전문.
 *
 * @param {string} themeId 기본값 `institutional` — PDI 핸드오프 정본 (themes.js 머리말)
 * @returns {string}
 */
function build(themeId = 'institutional') {
  const T = themes.get(themeId) || themes.get('institutional');
  const vars = varsFor(T);

  /* 나머지 테마는 `[data-im-theme="…"]` 로 얹는다 — 같은 문서 안에서
     테마를 갈아 끼워 볼 수 있어야 견본이 뜻을 갖는다. */
  /* ★★ **`list()` 가 주는 것은 요약이지 팔레트가 아니다** 〈2026-09-06 · 시험이 잡았다〉.
     첫 판은 `list()` 항목을 그대로 `varsFor()` 에 넣어 **12개 테마 블록이 전부
     `--im-primary: undefined` 로 나갔다.** CSS 는 오류를 안 내고 그냥 그 줄을
     버리므로 **테마를 바꿔도 아무 일이 안 일어나는데 아무도 모른다.**
     그래서 반드시 `get()` 으로 본체를 받는다. */
  const others = themes.list()
    .filter((t) => t.id !== T.id)
    .map((t) => themes.get(t.id))
    .filter(Boolean)
    .map((t) => `[data-im-theme="${t.id}"] {\n${declare(varsFor(t))}\n}`)
    .join('\n\n');

  const grids = Object.keys(LAYOUTS)
    .map((id) => `.im-${id} { ${GRID[id]}; }`)
    .join('\n');

  return `/* im-design-system.css — LinkPilot IM 디자인 시스템
 *
 * ★★★ 이 파일은 **손으로 고치지 않는다.** \`im-agent/design/css.js\` 가
 *   \`tokens.js\`·\`themes.js\`·\`layouts.js\` 를 읽어 만든다.
 *   값을 바꾸려면 그 세 곳을 고치고 \`npm run im:layouts\` 를 다시 돌린다.
 *   여기를 직접 고치면 다음 생성 때 조용히 지워진다.
 *
 * 기본 테마: ${T.label} (${T.labelKr}) · 지면 ${PAGE.format} ${PAGE.widthMm}×${PAGE.heightMm}mm
 */

:root {
${declare(vars)}
}

${others}

/* ── 지면 ───────────────────────────────────────────────── */
@page { size: ${PAGE.format}; margin: ${PAGE.marginMm}mm; }

.im-page {
  width: var(--im-page-w);
  min-height: var(--im-page-h);
  padding: var(--im-page-margin);
  background: var(--im-surface);
  color: var(--im-body);
  font-family: var(--im-sans);
  font-size: var(--im-text);
  line-height: 1.75;
  box-sizing: border-box;
}

/* ★ 없으면 네이비 박스가 흰색으로 인쇄된다 (rules.json D6-print-color) */
@media print {
  .im-page, .im-navybox, .im-creambox, .im-kpi, .im-table th {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .im-chapter { break-before: page; break-inside: avoid; }
  .im-table, .im-kpi, .im-navybox, .im-creambox, .im-figure { break-inside: avoid; }
}

/* ── 활자 ───────────────────────────────────────────────── */
.im-h1 {
  font-family: var(--im-serif); font-weight: 500;
  font-size: var(--im-h1); line-height: 1.08; letter-spacing: -.02em;
  color: var(--im-primary); margin: 0; text-wrap: balance;
}
.im-h2 {
  font-family: var(--im-serif); font-weight: 500;
  font-size: var(--im-h2); line-height: 1.2; letter-spacing: -.01em;
  color: var(--im-primary); margin: 10px 0 0;
}
.im-h3 {
  font-family: var(--im-serif); font-weight: 500;
  font-size: var(--im-h3); color: var(--im-primary); margin: 0 0 8px;
}
.im-chapter-label {
  font-family: var(--im-serif); font-size: 10px; font-weight: 600;
  letter-spacing: .2em; text-transform: uppercase; color: var(--im-accent);
}
.im-sub { margin-top: 5px; font-size: 13px; color: var(--im-muted); }
.im-text { font-size: var(--im-text); line-height: 1.75; color: var(--im-body); text-wrap: pretty; }
.im-caption { margin: 0 0 14px; font-size: 9.5px; line-height: 1.65; color: var(--im-faint); }
.im-micro { font-size: var(--im-micro); color: var(--im-faint-2); }

/* ★ 숫자는 자릿수를 맞춘다 — 표에서 세로가 안 맞으면 비교가 안 된다 */
.im-num, .im-table td, .im-kpi-value { font-variant-numeric: tabular-nums; }
/* ★ 음수는 △ 로 적는다 (tokens.js eok) — 색까지 갈라 준다 */
.im-neg { color: var(--im-negative); }

/* ── 상자 ───────────────────────────────────────────────── */
.im-navybox { background: var(--im-primary); padding: 18px 20px; }
.im-navybox-label {
  font-size: 11px; font-weight: 600; letter-spacing: .14em;
  text-transform: uppercase; color: var(--im-accent-light);
}
.im-navybox-value { font-family: var(--im-serif); font-size: 29px; color: var(--im-on-primary); }
.im-navybox-sub { font-size: 11.5px; color: var(--im-on-primary-sub); }
.im-creambox { background: var(--im-surface-alt); padding: 16px 18px; }
.im-quote-gold { border-left: 2px solid var(--im-accent); padding: 2px 0 2px 14px; }
.im-quote-red { border-left: 2px solid var(--im-negative); padding: 2px 0 2px 14px; }

/* ── 표 ─────────────────────────────────────────────────── */
.im-table { width: 100%; border-collapse: collapse; font-size: var(--im-table); }
.im-table th {
  font-size: var(--im-table-head); font-weight: 600; text-align: left;
  color: var(--im-primary); background: var(--im-surface-alt);
  border-top: 1px solid var(--im-rule-strong);
  border-bottom: 1px solid var(--im-rule-strong);
  padding: 7px 9px;
}
.im-table td { padding: 6px 9px; border-bottom: 1px solid var(--im-rule-weak); }
.im-table td.im-r, .im-table th.im-r { text-align: right; }
/* ★ 셀은 한 줄 — 접히면 행 높이가 들쭉날쭉해 표가 안 읽힌다 (CLAUDE.md §6-3 ⑤) */
.im-table td, .im-table th { white-space: nowrap; }
.im-table-wrap { overflow-x: auto; }

/* ── KPI ────────────────────────────────────────────────── */
.im-kpi {
  border-top: 2px solid var(--im-primary);
  background: var(--im-surface-alt); padding: 12px 14px;
}
.im-kpi-label {
  font-size: 9.5px; font-weight: 600; letter-spacing: .12em;
  text-transform: uppercase; color: var(--im-accent);
}
.im-kpi-value {
  font-family: var(--im-serif); font-size: 24px; line-height: 1.15;
  color: var(--im-primary);
}
.im-kpi-sub { font-size: 10px; color: var(--im-muted); }

/* ── 레이아웃 12종 ──────────────────────────────────────── */
.im-layout { display: grid; gap: 10px; }
${grids}

/* ── 차트 트랙 ──────────────────────────────────────────── */
.im-track { background: var(--im-track); height: 8px; }
.im-bar { background: var(--im-primary); height: 8px; }
.im-bar-2 { background: var(--im-primary-mid); }
.im-bar-accent { background: var(--im-accent-light); }
`;
}

module.exports = { build, varsFor, declare, GRID };
