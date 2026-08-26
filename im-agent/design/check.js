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
 * 권리·비밀 검사 〈2026-08-26 · D-127 · 디자인 지시서 §14.5〉.
 *
 * ★★ **첫 판은 막지 않는다.** 셋 다 YELLOW 다. 오탐 하나에 문서가 아예 안
 *   나가면 사람들은 검사를 꺼 버린다 — 그러면 없느니만 못하다. 오탐을 세어
 *   본 뒤 RED 로 올린다 (D-118 에 그렇게 적어 두었다).
 *
 * ★★ **열쇠는 이름이 아니라 값으로 찾는다.** `SECRET_ENV` 에 적힌 환경변수의
 *   **실제 값**이 산출물에 들어갔는지 본다. 이름만 찾으면
 *   「ECOS_API_KEY 를 넣으세요」라는 안내문까지 걸린다.
 *
 * ★ **값이 짧으면 건너뛴다.** 여덟 자 미만은 아무 데나 걸린다.
 * ★ **찾은 것을 로그에 찍지 않는다.** 어디서 걸렸는지만 말한다 (CLAUDE.md §2).
 */
const SECRET_NAMES = [
  'VWORLD_KEY', 'VWORLD_DOMAIN', 'DATA_GO_KR_KEY', 'ECOS_API_KEY', 'ECOS_BOK_KEY',
  'DART_API_KEY', 'GEMINI_API_KEY', 'KMA_APIHUB_KEY', 'REB_API_KEY', 'KOSIS_API_KEY',
  'LAW_OC', 'LAW_OPEN_DATA', 'RHINO_COMPUTE_KEY', 'RHINO_COMPUTE_URL',
  'KEPCO_BIGDATA_KEY', 'PEXELS_API_KEY', 'SOLAPI_API_KEY', 'SOLAPI_API_SECRET',
];

/** 개인정보 꼴 — 확정이 아니라 **표시**다 */
const PII = [
  { re: /\b01[016-9][-\s]?\d{3,4}[-\s]?\d{4}\b/g, what: '휴대전화 번호' },
  { re: /\b\d{6}[-\s]?[1-4]\d{6}\b/g, what: '주민등록번호 꼴' },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, what: '이메일 주소' },
];

/** 권리 확인이 필요한 자산의 자취 */
const RIGHTS = [
  { re: /(pexels|unsplash|shutterstock|gettyimages|istockphoto)/gi, what: '스톡 이미지 출처' },
  { re: /(®|™|\(R\)|\(TM\))/g, what: '상표 기호' },
];

/**
 * @param {string} text 산출물 본문 (HTML·마크다운·SVG)
 * @param {object} opts { env } — 검사용으로 환경을 주입할 수 있다
 * @returns {{ok:boolean, violations:Array}}
 */
function checkRights(text, opts = {}) {
  const v = [];
  const s = String(text || '');
  const env = opts.env || process.env;

  // ① 열쇠 — **값**으로 찾는다
  for (const name of SECRET_NAMES) {
    const val = env[name];
    if (!val || String(val).trim().length < 8) continue;
    const raw = String(val).trim();
    if (s.includes(raw) || s.includes(encodeURIComponent(raw))) {
      // ★ 값을 메시지에 넣지 않는다
      v.push(violation('D12-secret-leak', `${name} 의 값이 산출물에 들어 있다`));
    }
  }

  // ② 개인정보 꼴
  for (const { re, what } of PII) {
    const hits = s.match(new RegExp(re.source, re.flags)) || [];
    if (hits.length) v.push(violation('D13-personal-info', `${what} ${hits.length}건`));
  }

  // ③ 권리 확인이 필요한 자산
  for (const { re, what } of RIGHTS) {
    const hits = s.match(new RegExp(re.source, re.flags)) || [];
    if (hits.length) v.push(violation('D14-rights-unchecked', `${what} ${hits.length}건 — 사람이 확인해야 한다`));
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

module.exports = { checkHtml, checkMarkdown, checkAsset, checkThemeConsistency, checkRights, list, RULES, FORBIDDEN_COLORS, EMOJI, SECRET_NAMES, PII, RIGHTS };
