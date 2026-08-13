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

const { COLOR, FONT, SIZE, PAGE, S, eok, num, pct, caption } = require('./tokens');
const { kstDate } = require('../core/kst');

const COMPANY = {
  en: 'PDI Global Infrastructure Development Co.,Ltd',
  kr: '(주)피디아이글로벌인프라스트럭쳐디벨롭먼트',
  tag: 'PROJECT MANAGEMENT & DEALMAKER',
};

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 마크다운 표 → HTML 표 (핸드오프 표 스타일) */
function mdTableToHtml(lines) {
  const rows = lines.map(l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
  if (rows.length < 2) return '';
  const head = rows[0];
  const aligns = rows[1].map(c => (c.endsWith(':') ? 'right' : 'left'));
  const body = rows.slice(2);

  const th = head.map((c, i) =>
    `<th style="padding:7px 8px;border-top:1px solid ${COLOR.navy};border-bottom:1px solid ${COLOR.navy};font-size:7.5px;letter-spacing:.13em;text-transform:uppercase;color:${COLOR.navy};font-weight:600;text-align:${aligns[i]};">${inline(c)}</th>`).join('');

  const tr = body.map((cells, ri) => {
    const last = ri === body.length - 1;
    const strong = cells.some(c => /^\*\*/.test(c));
    return '<tr>' + cells.map((c, i) =>
      `<td style="padding:7px 8px;border-bottom:${last ? `1px solid ${COLOR.navy}` : `.5px solid ${COLOR.ruleWeak}`};color:${strong ? COLOR.navy : COLOR.body};${strong ? 'font-weight:600;' : ''}${strong ? `background:${COLOR.surfaceAlt};` : ''}vertical-align:top;text-align:${aligns[i]};${aligns[i] === 'right' ? 'font-variant-numeric:tabular-nums;' : ''}">${inline(c)}</td>`).join('') + '</tr>';
  }).join('');

  return `<table style="width:100%;border-collapse:collapse;font-size:${SIZE.table}px;margin:0 0 8px;"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

/** 인라인 마크다운(굵게/링크/코드)만 변환 */
function inline(text) {
  let s = esc(text);
  s = s.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${COLOR.navy};font-weight:600;">$1</strong>`);
  s = s.replace(/`([^`]+)`/g, `<code style="font-size:10.5px;color:${COLOR.muted};">$1</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" style="color:${COLOR.gold};text-decoration:none;border-bottom:.5px solid ${COLOR.goldPale};">$1</a>`);
  return s;
}

/** 절 본문(마크다운) → HTML 블록 */
function renderBody(md) {
  const out = [];
  const lines = String(md || '').split('\n');
  let i = 0;
  let list = [];

  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul style="margin:0 0 12px;padding-left:16px;${S.body}">${list.map(x => `<li style="margin:0 0 3px;">${inline(x)}</li>`).join('')}</ul>`);
    list = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*\|/.test(line)) {
      flushList();
      const block = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) block.push(lines[i++]);
      out.push(mdTableToHtml(block));
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushList();
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      const warn = quote.join(' ').includes('⚠') || /주의|불가|초과|아니며/.test(quote.join(' '));
      out.push(`<div style="${warn ? S.quoteRed : S.quoteGold}margin:0 0 14px;"><div style="font-size:11.5px;line-height:1.7;color:${COLOR.body2};">${inline(quote.join(' ').replace(/⚠\s*/g, ''))}</div></div>`);
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      list.push(line.replace(/^\s*-\s+/, ''));
      i++;
      continue;
    }
    if (/^자료출처:/.test(line.trim())) {
      flushList();
      out.push(`<p style="${S.caption}">${inline(line.trim())}</p>`);
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
      out.push(`<p style="margin:0 0 12px;font-size:11.5px;color:${COLOR.muted};font-style:italic;">${inline(line.trim().replace(/^_|_$/g, ''))}</p>`);
      i++;
      continue;
    }
    flushList();
    out.push(`<p style="margin:0 0 12px;${S.body}">${inline(line.trim())}</p>`);
    i++;
  }
  flushList();
  return out.join('\n');
}

function chapterOpener(no, title, subtitle) {
  return `<div style="${S.chapterBreak}">
  <div style="display:flex;align-items:baseline;gap:14px;">
    <span style="${S.chapterLabel}">Chapter ${esc(no)}</span>
    <span style="flex:1;height:1px;background:${COLOR.ruleStrong};"></span>
  </div>
  <h2 style="${S.h2}">${esc(title)}</h2>
  ${subtitle ? `<div style="${S.sub}">${esc(subtitle)}</div>` : ''}
</div>`;
}

function cover({ projectName, projectId, assetType, location, valueRange, kpis, scaleNotice }) {
  const kpiCells = (kpis || []).slice(0, 4).map(k =>
    `<div><div style="font-family:${FONT.serif};font-size:20px;color:${COLOR.navy};font-variant-numeric:tabular-nums;">${esc(k.value)}</div>
     <div style="font-size:7.5px;letter-spacing:.16em;text-transform:uppercase;color:${COLOR.faint};margin-top:4px;">${esc(k.label)}</div></div>`).join('');

  return `<section>
  <div style="height:3px;background:${COLOR.navy};"></div>
  <div style="height:1px;background:${COLOR.goldLight};margin-bottom:26px;"></div>
  <div style="font-size:8.5px;letter-spacing:.2em;text-transform:uppercase;color:${COLOR.gold};font-weight:600;">Strictly confidential</div>
  <h1 style="margin:14px 0 0;font-family:${FONT.serif};font-weight:500;font-size:${SIZE.h1}px;line-height:1.04;letter-spacing:-.02em;color:${COLOR.navy};">${esc(projectName)}</h1>
  <div style="margin-top:10px;font-family:${FONT.serif};font-size:17px;color:#4A5A70;">${esc(location || '')}</div>
  <div style="width:48px;height:1px;background:${COLOR.gold};margin:18px 0 8px;"></div>
  <div style="font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;color:${COLOR.navy};">Information Memorandum ㅣ 투자 분석 보고서</div>
  <div style="margin-top:20px;font-size:11.5px;color:${COLOR.muted};">${esc(assetType || '')} ㅣ Project ID ${esc(projectId)}</div>
  ${scaleNotice ? `<div style="${S.quoteRed}margin-top:16px;"><div style="font-size:11px;line-height:1.7;color:${COLOR.negative};">${esc(scaleNotice)}</div></div>` : ''}
  ${valueRange ? `<div style="${S.navyBox}margin-top:22px;">
    <div style="${S.navyBoxLabel}">Indicative Value</div>
    <div style="${S.navyBoxValue}margin-top:6px;">${esc(valueRange)}</div>
    <div style="${S.navyBoxSub}margin-top:6px;">본 자료 산출치 — 법정 감정평가가 아니다</div>
  </div>` : ''}
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;border-top:1px solid ${COLOR.navy};border-bottom:.5px solid ${COLOR.ruleStrong};padding:16px 0;margin-top:22px;">${kpiCells}</div>
  ${signature(false)}
</section>`;
}

/** 서명부 — 로고 자리 + 3줄(영문/국문/태그라인) 가로 배치 (IM RULES §1) */
function signature(onNavy) {
  const c1 = onNavy ? COLOR.cream : COLOR.navy;
  const c2 = onNavy ? COLOR.onNavy1 : COLOR.muted;
  const c3 = onNavy ? COLOR.onNavy2 : COLOR.brandRed;
  return `<div style="display:flex;align-items:center;gap:12px;margin-top:26px;text-align:left;">
  <div style="width:44px;height:44px;border-radius:50%;background:${onNavy ? COLOR.surface : COLOR.surfaceAlt};border:1px solid ${onNavy ? 'transparent' : COLOR.ruleStrong};flex:0 0 44px;display:flex;align-items:center;justify-content:center;font-family:${FONT.serif};font-size:13px;color:${COLOR.brandRed};font-weight:600;">PDI</div>
  <div>
    <div style="font-family:${FONT.serif};font-size:13.5px;color:${c1};">${COMPANY.en}</div>
    <div style="font-size:11px;color:${c2};">${COMPANY.kr}</div>
    <div style="font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:${c3};font-weight:600;margin-top:2px;">${COMPANY.tag}</div>
  </div>
</div>`;
}

function notice({ disclaimers }) {
  return `<section style="break-before:page;">
  <div style="${S.chapterLabel}">Important Notice</div>
  <h2 style="${S.h2}">중요 고지</h2>
  <div style="${S.quoteGold}margin:18px 0;">
    <div style="font-size:11.5px;line-height:1.7;color:${COLOR.body2};">본 문서는 LinkPilot IM Agent가 제출된 자료와 공공데이터를 근거로 자동 생성한 분석 자료다. 모든 수치에는 출처가 표기되며, 출처가 확인되지 않은 값은 본문에 사용하지 않는다.</div>
  </div>
  ${(disclaimers || []).map(d => `<p style="margin:0 0 12px;${S.body}">${esc(d)}</p>`).join('')}
  <div style="${S.creamBox}margin-top:16px;">
    <div style="font-size:11.5px;line-height:1.75;color:${COLOR.navy};">본 자료는 최종 투자판단 자료가 아니며, 사람의 승인을 거치지 않은 상태에서 배포될 수 없다. 표기 규칙: <strong>[미검증]</strong> = 단일 출처로만 확인된 값, <strong>[미확인]</strong> = 자료 미확보 항목.</div>
  </div>
</section>`;
}

function toc(sections) {
  const rows = sections.map(s =>
    `<div style="display:flex;gap:12px;padding:7px 0;border-bottom:.5px solid ${COLOR.ruleWeak};">
      <span style="font-family:${FONT.serif};font-size:11.5px;color:${COLOR.gold};width:20px;flex:0 0 20px;">${esc(s.no)}</span>
      <span style="font-family:${FONT.serif};font-size:13.5px;color:${COLOR.navy};">${esc(s.title)}</span>
    </div>`).join('');
  return `<section style="break-before:page;">
  <div style="${S.chapterLabel}">Table of Contents</div>
  <div style="height:1px;background:${COLOR.navy};margin:10px 0 14px;"></div>
  ${rows}
</section>`;
}

function contact() {
  return `<section style="break-before:page;">
  <div style="height:3px;background:${COLOR.navy};"></div>
  <div style="height:1px;background:${COLOR.goldLight};margin-bottom:26px;"></div>
  <div style="${S.chapterLabel}">Contact ㅣ 연락처 정보</div>
  <h2 style="${S.h2}">문의 및 후속 절차</h2>
  <p style="margin:14px 0 20px;${S.body}">본 자료에 관한 문의, 추가 분석 요청, 실사 자료 요청은 발행 주체에 연락 주십시오.</p>
  <div style="${S.navyBox}">
    ${signature(true)}
    <div style="border-top:.5px solid ${COLOR.navyMid};margin-top:16px;padding-top:10px;font-size:10px;color:${COLOR.onNavy3};">Strictly Private and Confidential</div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:20px;">
    <span style="font-size:9.5px;color:${COLOR.faint};">LinkPilot IM Agent</span>
    <span style="font-family:${FONT.serif};font-size:11px;letter-spacing:.16em;color:${COLOR.gold};">— END —</span>
  </div>
</section>`;
}

/**
 * IM 산출물 → A4 HTML 문서.
 * @param {object} doc { projectName, projectId, assetType, location, sections[], disclaimers[], kpis[], valueRange, scaleNotice }
 */
function render(doc) {
  const sections = doc.sections || [];
  const chapters = sections.map(s =>
    chapterOpener(s.no, s.title, s.subtitle) + '\n' + renderBody(s.text)).join('\n');

  return `<meta charset="utf-8">
<title>${esc(doc.projectName || doc.projectId)} — Information Memorandum</title>
<style>
  @page { size: ${PAGE.format}; margin: ${PAGE.marginMm}mm; }
  html, body { margin:0; padding:0; }
  body {
    font-family: ${FONT.sans};
    color: ${COLOR.body};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    max-width: ${PAGE.widthMm - PAGE.marginMm * 2}mm;
    margin: 0 auto;
    padding: ${PAGE.marginMm}mm 0;
  }
  p { orphans: 3; widows: 3; }
  table { break-inside: avoid; }
  a { color: ${COLOR.gold}; }
</style>
${cover(doc)}
${notice(doc)}
${toc(sections)}
${chapters}
${contact()}
`;
}

module.exports = { render, renderBody, mdTableToHtml, chapterOpener, cover, contact, signature, esc, COMPANY };
