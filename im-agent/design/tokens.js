'use strict';
/**
 * tokens.js — PDI IM 디자인 토큰 (단일 소스).
 *
 * 출처: design_handoff_grand_hyatt README.md · PDI SOLAR REPORT SPEC v1.0
 * 두 핸드오프의 팔레트·타이포가 동일하므로 하나로 통합했다.
 *
 * ★ 색·크기를 코드 여기저기에 하드코딩하지 않는다. 눈대중으로 바꾸면 핸드오프와 어긋난다.
 * ★ 아침 브리핑의 팔레트(#C00000 / Arial)와는 다른 체계다.
 *   브리핑 = 카카오톡 인앱 모바일, IM = A4 인쇄. 적용 대상이 다르므로 충돌이 아니다.
 *   단, IM에 들어가는 산출물(매스 SVG 등)은 반드시 이 토큰을 써야 한다.
 */

const COLOR = {
  navy: '#10233C',        // primary
  navyMid: '#35506F',     // 보조 막대
  navyL1: '#6E86A3',
  navyL2: '#8FA3BB',
  navyL3: '#B5C3D2',
  cream: '#F3E3C4',       // 네이비 위 텍스트
  onNavy1: '#9FB0C4',
  onNavy2: '#C6D0DE',
  onNavy3: '#7C8CA0',
  gold: '#A6813C',        // 라벨·강조
  goldLight: '#C9A15A',   // 하이라이트 막대
  goldPale: '#D9CBAE',
  brandRed: '#C0392B',    // 로고·태그라인·카드 상단
  body: '#2E3949',
  body2: '#3C4759',
  muted: '#6E7A8C',
  faint: '#8A8578',
  faint2: '#A09A8C',
  ruleStrong: '#D8D2C6',
  ruleWeak: '#E4DFD4',
  surface: '#FFFFFF',
  surfaceAlt: '#F7F5F0',  // 강조 박스
  track: '#EDE9E0',       // 차트 트랙
  negative: '#B4453A',    // 음수·경고
};

const FONT = {
  serif: "'Noto Serif KR', serif",
  sans: "'Noto Sans KR', sans-serif",
};

/** 스케일(px) — Grand Hyatt(IM) 기준. 태양광 리포트는 H1 46/H2 26. */
const SIZE = {
  h1: 48, h2: 26, h2Small: 22, h3: 15.5,
  body: 12.5, table: 11.5, caption: 10.5, micro: 8.5, tableHead: 11,
};

const PAGE = {
  format: 'A4',
  widthMm: 210,
  heightMm: 297,
  marginMm: 17,
};

/**
 * 금액 표기 — ★ 두 핸드오프의 규칙이 서로 다르다.
 *   Grand Hyatt IM : 1,634.3억원 / 1조762.4억원      (억원 소수 1자리)
 *   태양광 리포트   : 28억 9,173만원 / 1,785,200원/kW (억+만원)
 * IM은 Grand Hyatt 규칙을 정본으로 삼는다. 리포트용은 eokManwon() 으로 별도 제공한다.
 * 음수는 △ (핸드오프 공통).
 */
function eok(value, { digits = 1 } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  const v = Number(value);
  const neg = v < 0;
  const abs = Math.abs(v);
  let text;
  if (abs >= 10000) {
    const jo = Math.floor(abs / 10000);
    const rest = abs - jo * 10000;
    text = rest >= 0.05 ? `${jo}조${num(rest, digits)}억원` : `${jo}조원`;
  } else {
    text = `${num(abs, digits)}억원`;
  }
  return neg ? `△${text}` : text;
}

/** 태양광 리포트 규칙: 28억 9,173만원 */
function eokManwon(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  const v = Number(value);
  const neg = v < 0;
  const abs = Math.abs(v);
  const eokPart = Math.floor(abs);
  const manPart = Math.round((abs - eokPart) * 10000);
  let text;
  if (abs >= 10000) return (neg ? '△' : '') + eok(v, { digits: 1 });
  if (eokPart && manPart) text = `${num(eokPart, 0)}억 ${num(manPart, 0)}만원`;
  else if (eokPart) text = `${num(eokPart, 0)}억원`;
  else text = `${num(manPart, 0)}만원`;
  return neg ? `△${text}` : text;
}

function num(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  return Number(value).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  const v = Number(value);
  return `${v < 0 ? '△' : ''}${num(Math.abs(v), digits)}%`;
}

/** 캡션은 항상 '자료출처: ' 로 시작한다 (핸드오프 공통 규칙) */
const CAPTION_PREFIX = '자료출처: ';

function caption(text) {
  const t = String(text || '').trim();
  return t.startsWith(CAPTION_PREFIX.trim()) ? t : CAPTION_PREFIX + t;
}

/** 인라인 스타일 헬퍼 — 핸드오프가 인라인 style 기반이므로 동일하게 간다 */
const S = {
  chapterLabel: `font-family:${FONT.serif};font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${COLOR.gold};font-weight:600;`,
  h2: `margin:10px 0 0;font-family:${FONT.serif};font-weight:500;font-size:${SIZE.h2}px;line-height:1.2;color:${COLOR.navy};letter-spacing:-.01em;`,
  h3: `margin:0 0 8px;font-family:${FONT.serif};font-weight:500;font-size:${SIZE.h3}px;color:${COLOR.navy};`,
  sub: `margin-top:5px;font-size:13px;color:${COLOR.muted};`,
  body: `font-size:${SIZE.body}px;line-height:1.75;color:${COLOR.body};text-wrap:pretty;`,
  caption: `margin:0 0 14px;font-size:9.5px;line-height:1.65;color:${COLOR.faint};`,
  navyBox: `background:${COLOR.navy};padding:18px 20px;`,
  navyBoxLabel: `font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${COLOR.goldLight};font-weight:600;`,
  navyBoxValue: `font-family:${FONT.serif};font-size:29px;color:${COLOR.cream};`,
  navyBoxSub: `font-size:11.5px;color:${COLOR.onNavy1};`,
  quoteGold: `border-left:2px solid ${COLOR.gold};padding:2px 0 2px 14px;`,
  quoteRed: `border-left:2px solid ${COLOR.negative};padding:2px 0 2px 14px;`,
  creamBox: `background:${COLOR.surfaceAlt};padding:16px 18px;`,
  // 챕터 오프너는 항상 새 페이지 최상단 — 핸드오프 필수 규칙
  chapterBreak: 'break-before:page;break-inside:avoid;margin-bottom:20px;',
};

module.exports = { COLOR, FONT, SIZE, PAGE, S, eok, eokManwon, num, pct, caption, CAPTION_PREFIX };
