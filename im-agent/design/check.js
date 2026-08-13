'use strict';
/**
 * check.js — 디자인 규칙 게이트.
 *
 * 핸드오프의 check-im-rules.js 패턴을 따른다: 규칙의 단일 소스는 rules.json 이고
 * 게이트와 문서가 같은 파일을 읽는다. 규칙을 바꾸려면 rules.json 만 고친다.
 *
 * ★ 게이트를 만들었으면 게이트를 시험해야 한다 — test/design.test.js 가
 *   일부러 위반을 만들어 실제로 검출되는지 확인한다.
 */

const RULES = require('./rules.json');
const { COLOR } = require('./tokens');

/** 아침 브리핑 팔레트 — IM 산출물에 섞이면 안 된다 (실제 발생했던 사고) */
const FORBIDDEN_COLORS = ['#C00000', '#c00000'];
const FORBIDDEN_FONTS = ['Arial', '맑은 고딕'];

// 이모지 (문서용 기호 △ ㅣ — 등은 제외)
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F02F}]/u;

function violation(ruleId, message, detail = {}) {
  const rule = RULES.rules.find(r => r.id === ruleId);
  return {
    rule: ruleId,
    label: rule ? rule.label : ruleId,
    severity: rule ? rule.severity : 'YELLOW',
    message,
    ...detail,
  };
}

/**
 * A4 HTML 검사.
 * @returns {{ok:boolean, violations:Array}}
 */
function checkHtml(html, { chapterCount = null } = {}) {
  const v = [];
  const s = String(html || '');

  // D1 — 챕터 오프너가 모두 새 페이지에서 시작하는가
  const openers = (s.match(/Chapter\s+\d+/g) || []).length;
  const breaks = (s.match(/break-before:\s*page/g) || []).length;
  if (openers && breaks < openers) {
    v.push(violation('D1-chapter-break', `챕터 오프너 ${openers}개 중 ${breaks}개만 break-before:page 를 가진다`));
  }
  if (chapterCount !== null && openers !== chapterCount) {
    v.push(violation('D1-chapter-break', `챕터 수 불일치: 문서 ${openers}개 ≠ 목차 ${chapterCount}개`));
  }

  // D2 — 표 아래 캡션
  const tables = (s.match(/<table/g) || []).length;
  const captions = (s.match(/자료출처:/g) || []).length;
  if (tables > 0 && captions === 0) {
    v.push(violation('D2-caption-prefix', `표 ${tables}개가 있으나 '자료출처:' 캡션이 하나도 없다`));
  }

  // D3 — 이모지
  const emoji = s.match(EMOJI);
  if (emoji) v.push(violation('D3-no-emoji', `대외 문서에 이모지가 포함되어 있다: ${emoji[0]}`));

  // D5 — 브리핑 팔레트 혼입
  for (const c of FORBIDDEN_COLORS) {
    if (s.includes(c)) v.push(violation('D5-palette', `아침 브리핑 팔레트 ${c} 가 IM 산출물에 섞였다`));
  }
  for (const f of FORBIDDEN_FONTS) {
    if (s.includes(f)) v.push(violation('D5-palette', `브리핑 폰트 '${f}' 가 IM 산출물에 섞였다`));
  }

  // D6 — 인쇄 색상
  if (!/print-color-adjust:\s*exact/.test(s)) {
    v.push(violation('D6-print-color', 'print-color-adjust: exact 가 없어 네이비 박스가 흰색으로 인쇄된다'));
  }

  // D7 — 페이지 기하
  if (!/@page\s*\{[^}]*A4/.test(s)) v.push(violation('D7-page-geometry', '@page 에 A4 지정이 없다'));
  if (!/margin:\s*17mm/.test(s)) v.push(violation('D7-page-geometry', '여백 17mm 지정이 없다'));

  // D8 — 산출·추정치 구분 표기
  if (!/미검증|미확인|산출치|추정/.test(s)) {
    v.push(violation('D8-source-marking', '산출·추정치 구분 표기가 문서에 없다'));
  }

  return { ok: v.filter(x => x.severity === 'RED').length === 0, violations: v };
}

/** 마크다운(IM 본문) 검사 */
function checkMarkdown(md) {
  const v = [];
  const s = String(md || '');

  const emoji = s.match(EMOJI);
  if (emoji) v.push(violation('D3-no-emoji', `대외 문서에 이모지가 포함되어 있다: ${emoji[0]}`));
  if (!/미검증|미확인|산출|가정/.test(s)) {
    v.push(violation('D8-source-marking', '산출·추정치 구분 표기가 없다'));
  }
  return { ok: v.filter(x => x.severity === 'RED').length === 0, violations: v };
}

/** SVG 등 시각 산출물 검사 */
function checkAsset(text) {
  const v = [];
  const s = String(text || '');
  for (const c of FORBIDDEN_COLORS) {
    if (s.includes(c)) v.push(violation('D5-palette', `아침 브리핑 팔레트 ${c} 사용`));
  }
  for (const f of FORBIDDEN_FONTS) {
    if (s.includes(f)) v.push(violation('D5-palette', `브리핑 폰트 '${f}' 사용`));
  }
  return { ok: v.filter(x => x.severity === 'RED').length === 0, violations: v };
}

/**
 * 테마 일관성 검사 (사양 §13 Design Consistency Check).
 * 문서에 쓰인 색이 전부 활성 테마 팔레트에서 나왔는지 확인한다.
 * 테마를 골라놓고 다른 색이 섞이면 '한 프로젝트 = 한 디자인' 이 깨진다.
 */
function checkThemeConsistency(html, theme) {
  const v = [];
  if (!theme) return { ok: true, violations: v };

  const allowed = new Set([
    theme.primary, theme.primaryMid, theme.accent, theme.accentLight,
    theme.onPrimary, theme.onPrimarySub, theme.surface, theme.surfaceAlt,
    theme.track, theme.negative, theme.brandRed,
    theme.ruleStrong, theme.ruleWeak, theme.body, theme.body2,
    theme.muted, theme.faint, theme.faint2,
    ...(theme.chart || []),
  ].filter(Boolean).map(c => String(c).toUpperCase()));

  const used = new Set((String(html).match(/#[0-9A-Fa-f]{6}\b/g) || []).map(c => c.toUpperCase()));
  const stray = [...used].filter(c => !allowed.has(c));

  if (stray.length) {
    v.push(violation('D11-theme-consistency',
      `테마 '${theme.id}' 팔레트에 없는 색 ${stray.length}개가 문서에 쓰였다: ${stray.slice(0, 5).join(', ')}`,
      { colors: stray }));
  }

  const fonts = String(html).match(/font-family:\s*([^;"]+)/g) || [];
  const themeFonts = [theme.serif, theme.sans].map(f => String(f).replace(/['"]/g, ''));
  const strayFonts = [...new Set(fonts.map(f => f.replace(/font-family:\s*/, '').replace(/['"]/g, '').trim()))]
    .filter(f => !themeFonts.some(tf => tf.includes(f.split(',')[0].trim()) || f.includes(tf.split(',')[0].trim())));
  if (strayFonts.length) {
    v.push(violation('D11-theme-consistency', `테마 폰트가 아닌 서체가 쓰였다: ${strayFonts.slice(0, 3).join(' / ')}`));
  }

  return { ok: v.filter(x => x.severity === 'RED').length === 0, violations: v };
}

/** 규칙 목록 (문서 생성·CLI 노출용) */
function list() {
  return RULES.rules.map(r => ({ ...r }));
}

module.exports = { checkHtml, checkMarkdown, checkAsset, checkThemeConsistency, list, RULES, FORBIDDEN_COLORS, EMOJI };
