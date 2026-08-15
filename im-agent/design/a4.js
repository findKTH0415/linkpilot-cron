'use strict';
/**
 * a4.js — IM 산출물 → A4 인쇄 HTML.
 *
 * 핸드오프(design_handoff_grand_hyatt / PDI SOLAR REPORT SPEC)의 디자인 규격을 따른다:
 *   표지 → IMPORTANT NOTICE → 목차 → Chapter 01~N → 연락처(END)
 *   챕터 오프너는 항상 새 페이지 최상단, 캡션은 '자료출처:' 로 시작, 인라인 style만 사용.
 *
 * ★ 이 파일은 인쇄 기하를 스스로 소유한다(@page).
 *   핸드오프 본체는 doc-page.js 가 인쇄를 소유하지만 그 런타임은 이 저장소에 없다.
 *   기존 뷰어(build/index.html)로 렌더할 때는 content.js 가 내보내는 content.json 을 쓴다.
 *   즉 산출물은 두 갈래다: 자립형 A4 HTML(이 파일) / 뷰어용 content.json(content.js).
 */

const { SIZE, PAGE, eok, num, pct, caption } = require('./tokens');
const themes = require('./themes');
const layouts = require('./layouts');
const { kstDate } = require('../core/kst');

/**
 * 테마 → 렌더에 쓰는 색·폰트·스타일 조각.
 * ★ 렌더러는 색을 하드코딩하지 않는다. 전부 여기서 나온다.
 *   그래야 A4·PPT·Dashboard 가 같은 테마를 읽고 같은 결과를 낸다.
 */
function styles(T) {
  return {
    chapterLabel: `font-family:${T.serif};font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${T.accent};font-weight:600;`,
    h2: `margin:10px 0 0;font-family:${T.serif};font-weight:500;font-size:${SIZE.h2}px;line-height:1.2;color:${T.primary};letter-spacing:-.01em;`,
    sub: `margin-top:5px;font-size:13px;color:${T.muted};`,
    body: `font-size:${SIZE.body}px;line-height:1.75;color:${T.body};text-wrap:pretty;`,
    caption: `margin:0 0 14px;font-size:9.5px;line-height:1.65;color:${T.faint};`,
    navyBox: `background:${T.primary};padding:18px 20px;`,
    navyBoxLabel: `font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${T.accentLight};font-weight:600;`,
    navyBoxValue: `font-family:${T.serif};font-size:29px;color:${T.onPrimary};`,
    navyBoxSub: `font-size:11.5px;color:${T.onPrimarySub};`,
    quoteGold: `border-left:2px solid ${T.accent};padding:2px 0 2px 14px;`,
    quoteRed: `border-left:2px solid ${T.negative};padding:2px 0 2px 14px;`,
    creamBox: `background:${T.surfaceAlt};padding:16px 18px;`,
    chapterBreak: 'break-before:page;break-inside:avoid;margin-bottom:20px;',
  };
}

/**
 * 발행 주체 — **코드에 박지 않는다.**
 *
 * 이 시스템은 여러 회사가 쓴다. 회사명을 여기 두면 다른 회사가 만든 IM 에
 * 남의 이름이 찍혀 나가고, 대외 배포 문서라 발견도 늦다.
 * `doc.issuer` 로 받고, 없으면 core/issuer.js 의 '미설정' 표시를 쓴다 —
 * 기본 회사를 두면 설정을 잊은 것과 일부러 그 회사인 것을 구분할 수 없다.
 */
const issuerCfg = require('../core/issuer');

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 마크다운 표 → HTML 표 (핸드오프 표 스타일) */
function mdTableToHtml(lines, T) {
  const rows = lines.map(l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
  if (rows.length < 2) return '';
  const head = rows[0];
  const aligns = rows[1].map(c => (c.endsWith(':') ? 'right' : 'left'));
  const body = rows.slice(2);

  const th = head.map((c, i) =>
    `<th style="padding:7px 8px;border-top:1px solid ${T.primary};border-bottom:1px solid ${T.primary};font-size:7.5px;letter-spacing:.13em;text-transform:uppercase;color:${T.primary};font-weight:600;text-align:${aligns[i]};">${inline(c, T)}</th>`).join('');

  const tr = body.map((cells, ri) => {
    const last = ri === body.length - 1;
    const strong = cells.some(c => /^\*\*/.test(c));
    return '<tr>' + cells.map((c, i) =>
      `<td style="padding:7px 8px;border-bottom:${last ? `1px solid ${T.primary}` : `.5px solid ${T.ruleWeak}`};color:${strong ? T.primary : T.body};${strong ? 'font-weight:600;' : ''}${strong ? `background:${T.surfaceAlt};` : ''}vertical-align:top;text-align:${aligns[i]};${aligns[i] === 'right' ? 'font-variant-numeric:tabular-nums;' : ''}">${inline(c, T)}</td>`).join('') + '</tr>';
  }).join('');

  return `<table style="width:100%;border-collapse:collapse;font-size:${SIZE.table}px;margin:0 0 8px;"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

/** 인라인 마크다운(굵게/링크/코드)만 변환 */
function inline(text, T) {
  let s = esc(text);
  s = s.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${T.primary};font-weight:600;">$1</strong>`);
  s = s.replace(/`([^`]+)`/g, `<code style="font-size:10.5px;color:${T.muted};">$1</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" style="color:${T.accent};text-decoration:none;border-bottom:.5px solid ${T.accentLight};">$1</a>`);
  return s;
}

/** 절 본문(마크다운) → HTML 블록 */
function renderBody(md, T, S) {
  const out = [];
  const lines = String(md || '').split('\n');
  let i = 0;
  let list = [];

  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul style="margin:0 0 12px;padding-left:16px;${S.body}">${list.map(x => `<li style="margin:0 0 3px;">${inline(x, T)}</li>`).join('')}</ul>`);
    list = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*\|/.test(line)) {
      flushList();
      const block = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) block.push(lines[i++]);
      out.push(mdTableToHtml(block, T));
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushList();
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      const warn = quote.join(' ').includes('⚠') || /주의|불가|초과|아니며/.test(quote.join(' '));
      out.push(`<div style="${warn ? S.quoteRed : S.quoteGold}margin:0 0 14px;"><div style="font-size:11.5px;line-height:1.7;color:${T.body2};">${inline(quote.join(' ').replace(/⚠\s*/g, ''), T)}</div></div>`);
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      list.push(line.replace(/^\s*-\s+/, ''));
      i++;
      continue;
    }
    if (/^자료출처:/.test(line.trim())) {
      flushList();
      out.push(`<p style="${S.caption}">${inline(line.trim(), T)}</p>`);
      i++;
      continue;
    }
    if (line.trim() === '') {
      flushList();
      i++;
      continue;
    }
    if (/^_.*_$/.test(line.trim())) {
      flushList();
      out.push(`<p style="margin:0 0 12px;font-size:11.5px;color:${T.muted};font-style:italic;">${inline(line.trim().replace(/^_|_$/g, ''), T)}</p>`);
      i++;
      continue;
    }
    flushList();
    out.push(`<p style="margin:0 0 12px;${S.body}">${inline(line.trim(), T)}</p>`);
    i++;
  }
  flushList();
  return out.join('\n');
}

function chapterOpener(no, title, subtitle, T, S) {
  return `<div style="${S.chapterBreak}">
  <div style="display:flex;align-items:baseline;gap:14px;">
    <span style="${S.chapterLabel}">Chapter ${esc(no)}</span>
    <span style="flex:1;height:1px;background:${T.ruleStrong};"></span>
  </div>
  <h2 style="${S.h2}">${esc(title)}</h2>
  ${subtitle ? `<div style="${S.sub}">${esc(subtitle)}</div>` : ''}
</div>`;
}

function cover({ projectName, projectId, assetType, location, valueRange, kpis, scaleNotice, issuer }, T, S) {
  const kpiCells = (kpis || []).slice(0, 4).map(k =>
    `<div><div style="font-family:${T.serif};font-size:20px;color:${T.primary};font-variant-numeric:tabular-nums;">${esc(k.value)}</div>
     <div style="font-size:7.5px;letter-spacing:.16em;text-transform:uppercase;color:${T.faint};margin-top:4px;">${esc(k.label)}</div></div>`).join('');

  return `<section>
  <div style="height:3px;background:${T.primary};"></div>
  <div style="height:1px;background:${T.accentLight};margin-bottom:26px;"></div>
  <div style="font-size:8.5px;letter-spacing:.2em;text-transform:uppercase;color:${T.accent};font-weight:600;">Strictly confidential</div>
  <h1 style="margin:14px 0 0;font-family:${T.serif};font-weight:500;font-size:${SIZE.h1}px;line-height:1.04;letter-spacing:-.02em;color:${T.primary};">${esc(projectName)}</h1>
  <div style="margin-top:10px;font-family:${T.serif};font-size:17px;color:${T.body2};">${esc(location || '')}</div>
  <div style="width:48px;height:1px;background:${T.accent};margin:18px 0 8px;"></div>
  <div style="font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;color:${T.primary};">Information Memorandum ㅣ 투자 분석 보고서</div>
  <div style="margin-top:20px;font-size:11.5px;color:${T.muted};">${esc(assetType || '')} ㅣ Project ID ${esc(projectId)}</div>
  ${scaleNotice ? `<div style="${S.quoteRed}margin-top:16px;"><div style="font-size:11px;line-height:1.7;color:${T.negative};">${esc(scaleNotice)}</div></div>` : ''}
  ${valueRange ? `<div style="${S.navyBox}margin-top:22px;">
    <div style="${S.navyBoxLabel}">Indicative Value</div>
    <div style="${S.navyBoxValue}margin-top:6px;">${esc(valueRange)}</div>
    <div style="${S.navyBoxSub}margin-top:6px;">본 자료 산출치 — 법정 감정평가가 아니다</div>
  </div>` : ''}
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;border-top:1px solid ${T.primary};border-bottom:.5px solid ${T.ruleStrong};padding:16px 0;margin-top:22px;">${kpiCells}</div>
  ${signature(false, T, issuer)}
</section>`;
}

/** 서명부 — 로고 자리 + 3줄(영문/국문/태그라인) 가로 배치 (IM RULES §1) */
function signature(onNavy, T, issuer) {
  const c1 = onNavy ? T.onPrimary : T.primary;
  const c2 = onNavy ? T.onPrimarySub : T.muted;
  const c3 = onNavy ? T.onPrimarySub : T.brandRed;
  const iss = issuer || issuerCfg.UNSET;
  // 미설정이면 눈에 띄게 둔다. 조용히 비우면 그대로 배포된다
  const nameColor = iss.unset ? T.negative : c1;
  const line2 = iss.kr ? `\n    <div style="font-size:11px;color:${c2};">${esc(iss.kr)}</div>` : '';
  const line3 = iss.tag
    ? `\n    <div style="font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:${c3};font-weight:600;margin-top:2px;">${esc(iss.tag)}</div>`
    : '';
  const hint = iss.unset
    ? `\n    <div style="font-size:8.5px;color:${T.negative};margin-top:3px;">issuer.json 을 설정하세요 — 발행 주체 없이 배포할 수 없습니다</div>`
    : '';
  return `<div style="display:flex;align-items:center;gap:12px;margin-top:26px;text-align:left;">
  <div style="width:44px;height:44px;border-radius:50%;background:${onNavy ? T.surface : T.surfaceAlt};border:1px solid ${onNavy ? 'transparent' : T.ruleStrong};flex:0 0 44px;display:flex;align-items:center;justify-content:center;font-family:${T.serif};font-size:13px;color:${T.brandRed};font-weight:600;">${esc(iss.mark || '')}</div>
  <div>
    <div style="font-family:${T.serif};font-size:13.5px;color:${nameColor};">${esc(iss.en)}</div>${line2}${line3}${hint}
  </div>
</div>`;
}

function notice({ disclaimers }, T, S) {
  return `<section style="break-before:page;">
  <div style="${S.chapterLabel}">Important Notice</div>
  <h2 style="${S.h2}">중요 고지</h2>
  <div style="${S.quoteGold}margin:18px 0;">
    <div style="font-size:11.5px;line-height:1.7;color:${T.body2};">본 문서는 LinkPilot IM Agent가 제출된 자료와 공공데이터를 근거로 자동 생성한 분석 자료다. 모든 수치에는 출처가 표기되며, 출처가 확인되지 않은 값은 본문에 사용하지 않는다.</div>
  </div>
  ${(disclaimers || []).map(d => `<p style="margin:0 0 12px;${S.body}">${esc(d)}</p>`).join('')}
  <div style="${S.creamBox}margin-top:16px;">
    <div style="font-size:11.5px;line-height:1.75;color:${T.primary};">본 자료는 최종 투자판단 자료가 아니며, 사람의 승인을 거치지 않은 상태에서 배포될 수 없다. 표기 규칙: <strong>[미검증]</strong> = 단일 출처로만 확인된 값, <strong>[미확인]</strong> = 자료 미확보 항목.</div>
  </div>
</section>`;
}

function toc(sections, T, S) {
  const rows = sections.map(s =>
    `<div style="display:flex;gap:12px;padding:7px 0;border-bottom:.5px solid ${T.ruleWeak};">
      <span style="font-family:${T.serif};font-size:11.5px;color:${T.accent};width:20px;flex:0 0 20px;">${esc(s.no)}</span>
      <span style="font-family:${T.serif};font-size:13.5px;color:${T.primary};">${esc(s.title)}</span>
    </div>`).join('');
  return `<section style="break-before:page;">
  <div style="${S.chapterLabel}">Table of Contents</div>
  <div style="height:1px;background:${T.primary};margin:10px 0 14px;"></div>
  ${rows}
</section>`;
}

function contact(T, S, issuer) {
  return `<section style="break-before:page;">
  <div style="height:3px;background:${T.primary};"></div>
  <div style="height:1px;background:${T.accentLight};margin-bottom:26px;"></div>
  <div style="${S.chapterLabel}">Contact ㅣ 연락처 정보</div>
  <h2 style="${S.h2}">문의 및 후속 절차</h2>
  <p style="margin:14px 0 20px;${S.body}">본 자료에 관한 문의, 추가 분석 요청, 실사 자료 요청은 발행 주체에 연락 주십시오.</p>
  <div style="${S.navyBox}">
    ${signature(true, T, issuer)}
    <div style="border-top:.5px solid ${T.primaryMid};margin-top:16px;padding-top:10px;font-size:10px;color:${T.onPrimarySub};">Strictly Private and Confidential</div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:20px;">
    <span style="font-size:9.5px;color:${T.faint};">LinkPilot IM Agent</span>
    <span style="font-family:${T.serif};font-size:11px;letter-spacing:.16em;color:${T.accent};">— END —</span>
  </div>
</section>`;
}

/**
 * IM 산출물 → A4 HTML 문서.
 * @param {object} doc   { projectName, projectId, sections[], disclaimers[], kpis[], ... }
 * @param {object|string} theme  테마 객체 또는 테마 id (기본 institutional)
 */
function render(doc, theme = null) {
  const T = !theme
    ? themes.resolve('institutional', { docType: doc.docType || 'im' })
    : (typeof theme === 'string' ? themes.resolve(theme, { docType: doc.docType || 'im' }) : theme);
  const S = styles(T);

  // 발행 주체 — doc 에 실려 오면 그것을 쓰고, 없으면 설정에서 읽는다.
  // 어느 쪽도 없으면 '미설정'으로 표시된다 (남의 회사 이름을 찍지 않는다)
  const issuer = doc.issuer || issuerCfg.resolve(doc.projectId);

  const sections = layouts.assign(doc.sections || [], T);
  const chapters = sections.map(s =>
    chapterOpener(s.no, s.title, s.subtitle, T, S) + '\n' + renderBody(s.text, T, S)).join('\n');

  return `<meta charset="utf-8">
<title>${esc(doc.projectName || doc.projectId)} — Information Memorandum</title>
<style>
  @page { size: ${PAGE.format}; margin: ${PAGE.marginMm}mm; }
  html, body { margin:0; padding:0; }
  body {
    font-family: ${T.sans};
    color: ${T.body};
    background: ${T.surface};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    max-width: ${PAGE.widthMm - PAGE.marginMm * 2}mm;
    margin: 0 auto;
    padding: ${PAGE.marginMm}mm 0;
  }
  section { margin-bottom: ${T.spacing.section}px; }
  p { orphans: 3; widows: 3; }
  table { break-inside: avoid; }
  a { color: ${T.accent}; }
</style>
${cover(doc, T, S)}
${notice(doc, T, S)}
${toc(sections, T, S)}
${chapters}
${contact(T, S, issuer)}
`;
}

/**
 * 디자인 Preview (사양 §3) — 문서 전체를 만들지 않고 대표 페이지만 보여준다.
 * 사용자가 APPLY 하기 전에 확인하는 화면이다.
 */
function preview(themeId, { docType = 'im', brandKit = null } = {}) {
  const T = themes.resolve(themeId, { docType, brandKit });
  return render({
    projectId: 'PREVIEW',
    docType,
    projectName: `${T.label} 디자인 미리보기`,
    location: T.labelKr,
    assetType: T.purpose,
    valueRange: '6,500억원 ~ 8,000억원',
    scaleNotice: '',
    kpis: [
      { value: '2,846억원', label: 'Total Project Cost' },
      { value: '15.92%', label: 'Equity IRR' },
      { value: '1.35x', label: 'Min DSCR' },
      { value: '54,822㎡', label: 'Gross Floor Area' },
    ],
    disclaimers: ['미리보기 문서다. 수치는 디자인 확인용 예시이며 실제 프로젝트 값이 아니다. 실제 문서에서는 모든 값에 출처가 표기된다.'],
    citations: [],
    sections: [
      { no: '01', id: 'exec_summary', title: 'Executive Summary', text: '본 미리보기는 선택한 디자인이 문서 전체에 어떻게 적용되는지 확인하기 위한 화면이다.\n\n- 총사업비: 2,846억원 [미검증] (출처: 예시)\n- Equity IRR: 15.92% (출처: 예시)' },
      { no: '02', id: 'highlights', title: 'Investment Highlights', text: '| 항목 | 값 |\n|---|---:|\n| Project IRR | 12.08% |\n| Equity IRR | 15.92% |\n| Equity Multiple | 5.14x |\n\n자료출처: 디자인 미리보기용 예시 수치.' },
      { no: '03', id: 'location', title: 'Location', text: '| 항목 | 내용 | 출처 |\n|---|---|---|\n| 좌표 | 37.5665, 126.9780 | VWorld 지오코딩 |\n| 용도지역 | 일반공업지역 | 토지이용계획 |\n\n자료출처: 디자인 미리보기용 예시.' },
      { no: '04', id: 'risk', title: 'Risk Analysis', text: '| 구분 | 유형 | 내용 |\n|---|---|---|\n| [RED] | VALUE_CONFLICT | 연면적 값 불일치 예시 |\n| [YELLOW] | ASSUMPTION | 가정치 사용 예시 |\n\n자료출처: 디자인 미리보기용 예시.' },
    ],
  }, T);
}

module.exports = { render, preview, styles, renderBody, mdTableToHtml, chapterOpener, cover, contact, signature, esc };
