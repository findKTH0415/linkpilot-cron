'use strict';
/**
 * specimen.js — **레이아웃 시스템 견본** (IM Layout System Specimen).
 *
 * 〈2026-09-06 신설 · 사장님 지시 「반영된 디자인 레이아웃 구축해줘」〉
 *
 * ★★★ **왜 필요한가.** 디자인은 데이터로 다 있는데(`layouts.js` 12종 ·
 *   `themes.js` 13종) **눈으로 볼 자리가 없었다.** 있는 것은 테마 갤러리
 *   (`build-themes.js`) 하나뿐이고 그것은 **표지 색만** 보여 준다.
 *   L06 과 L09 가 어떻게 다른지, L11 이 몇 칸인지는 **코드를 읽어야 알았다.**
 *
 *   그러면 무슨 일이 생기나 — 고르는 사람이 이름만 보고 고른다. 그것은
 *   고른 것이 아니다 (`build-themes.js` 머리말과 같은 결).
 *
 * ★★ **판정 규칙은 글로 옮겨 적지 않고 `pick()` 을 실제로 돌려서 적는다.**
 *   우선순위 사슬(지도 > 위험 > 차트 > 표 > KPI > 이미지 > 서술)을 손으로
 *   베껴 두면 `layouts.js` 를 고친 날부터 **견본만 옛말을 한다** — 그리고
 *   그 상태가 아무 오류도 안 낸다 (CLAUDE.md §8 「손으로 적으면 화면만 옛말」).
 *
 * ★ **파일 하나로 열린다.** 서버·빌드 도구가 있어야 열리는 것은 미리보기가
 *   아니다 (CLAUDE.md §8). CSS 는 문서 안에 심는다.
 *
 * ★ **이모지를 쓰지 않는다.** 이 견본은 대외 문서 규격을 보여 주는 자리다
 *   (rules.json D3-no-emoji · CLAUDE.md §6-3).
 */

const css = require('./css');
const themes = require('./themes');
const layouts = require('./layouts');
const { COLOR, SIZE, PAGE, FONT, eok, num, pct, CAPTION_PREFIX } = require('./tokens');
const rules = require('./rules.json');
const { kstStamp } = require('../core/kst');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ─────────────────────────────────────────────────────────
 * 1. 판정 규칙 — **돌려서 잰다**
 * ───────────────────────────────────────────────────────── */

/**
 * `pick()` 이 실제로 무엇을 고르는지 재는 표본.
 *
 * ★★ 표본은 **재려는 성질을 지켜야 한다** (CLAUDE.md §8 「표본이 거짓말을 하면
 *   잡히는 것도 거짓」). 그래서 각 줄은 `detect()` 가 보는 낱말을 **실제로**
 *   담는다 — 「지도」라고 이름만 붙이고 본문에 그 낱말이 없으면 이 표는
 *   초록인 채로 아무것도 안 잰다.
 */
const PROBES = [
  { what: '지적·위성 자료가 있는 절', text: '대상 부지의 지적 경계를 VWorld 위성 영상 위에 표시했다. 지도에서 보기.' },
  { what: '위험 플래그가 붙은 절', text: '[RED] 인허가 조건이 확인되지 않았다. [YELLOW] 지반조사 미실시.' },
  { what: '민감도 분석이 있는 절', text: '할인율 민감도(Sensitivity)를 ±100bp 구간에서 검토했다.' },
  { what: '일정만 있는 절', text: '착공 2027년 3월, 준공 2029년 8월. 공사기간 29개월.' },
  { what: '표와 지표가 함께 있는 절', text: '| 구분 | 값 |\n| Equity IRR | 14.2% |\n프로젝트 IRR 과 최소 DSCR 을 함께 본다.' },
  { what: '표만 있는 절', text: '| 항목 | 금액 |\n| 토지 | 420억원 |' },
  { what: '지표만 있는 절', text: 'Equity IRR 14.2%, 최소 DSCR 1.28배, MOIC 1.9배.' },
  { what: '이미지만 있는 절', text: '전경 사진은 site-aerial.jpg 를 쓴다.' },
  { what: '자료가 거의 없는 절', text: '검토 중.' },
  { what: '순수 서술 절', text: '본 사업은 수도권 남부의 물류 인프라 수요 증가에 대응하기 위한 것으로, 인접 고속도로 접근성과 배후 수요를 근거로 한다.' },
];

/** 표본을 실제로 `pick()` 에 넣어 결과를 받는다 */
function decisions() {
  return PROBES.map((p, i) => {
    const got = layouts.pick({ no: i + 1, id: `probe${i}`, title: p.what, text: p.text });
    return { what: p.what, id: got.id, label: got.label, reason: got.reason };
  });
}

/* ─────────────────────────────────────────────────────────
 * 2. 레이아웃 열두 장 — 실제 격자로 그린다
 * ───────────────────────────────────────────────────────── */

const box = (cls, inner) => `<div class="${cls}">${inner}</div>`;
const ph = (label, extra = '') =>
  `<div class="ph ${extra}"><span>${esc(label)}</span></div>`;

/** 레이아웃별 속을 채운다 — 무엇을 담는 자리인지 눈에 보여야 뜻이 있다 */
function inner(id) {
  const kpi = (l, v, s) =>
    `<div class="im-kpi"><div class="im-kpi-label">${esc(l)}</div>`
    + `<div class="im-kpi-value">${esc(v)}</div><div class="im-kpi-sub">${esc(s)}</div></div>`;
  const table = (rows) =>
    `<table class="im-table"><thead><tr><th>구분</th><th class="im-r">값</th></tr></thead><tbody>`
    + rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="im-r">${esc(b)}</td></tr>`).join('')
    + `</tbody></table>`;

  switch (id) {
    case 'L01': return ph('전경 이미지 (전면)') + `<div class="im-caption">${esc(CAPTION_PREFIX)}현장 촬영 2026-08</div>`;
    case 'L02': return `<div><div class="im-h3">서술</div><div class="im-text tiny">본문이 왼쪽에 선다.</div></div><div>${table([['토지', '420.0억원'], ['건축', '1,214.3억원']])}</div>`;
    case 'L03': return ['입지', '규모', '수익'].map((t) => `<div><div class="im-h3">${t}</div><div class="im-text tiny">축 하나.</div></div>`).join('');
    case 'L04': return kpi('Equity IRR', '14.2%', '세후') + kpi('Project IRR', '9.8%', '세전')
      + kpi('최소 DSCR', '1.28배', '운영 1~5년') + kpi('MOIC', '1.9배', '보유 7년');
    case 'L05': return `<div class="chart">${[62, 88, 45, 74, 96].map((h) => `<i style="height:${h}%"></i>`).join('')}</div>`
      + `<div class="im-caption">${esc(CAPTION_PREFIX)}민감도 분석</div>`;
    case 'L06': return table([['매출', '284.1억원'], ['영업이익', '61.9억원'], ['당기순이익', '△12.4억원']])
      + `<div class="im-caption">${esc(CAPTION_PREFIX)}사업계획서 p.34</div>`;
    case 'L07': return ph('지도 · 위성') + `<div>${table([['지목', '공장용지'], ['면적', '18,204㎡'], ['용도지역', '일반공업']])}</div>`;
    case 'L08': return `<div class="tl">${['설계', '인허가', '착공', '준공'].map((t, i) => `<b><span>${t}</span><em>${2026 + i}</em></b>`).join('')}</div>`;
    case 'L09': return table([['본 사업', '14.2%'], ['비교사업 A', '11.6%'], ['비교사업 B', '9.4%']]);
    case 'L10': return `<div>${box('im-navybox', '<div class="im-navybox-label">Total</div><div class="im-navybox-value">1,634.3억원</div><div class="im-navybox-sub">Equity 30% / Debt 70%</div>')}</div>`
      + `<div>${table([['Equity', '490.3억원'], ['Senior', '980.6억원'], ['Mezzanine', '163.4억원']])}</div>`;
    case 'L11': return ['인허가', '공사비', '분양', '금리', '환경', '준공지연']
      .map((t, i) => `<div class="risk r${i % 3}"><span>${t}</span></div>`).join('');
    case 'L12': return `<div class="im-text tiny">서술만 있는 절이다. 표도 지표도 없을 때 이 레이아웃으로 간다. 자료가 부족하다는 사실을 감추지 않고, 있는 문장을 읽기 좋게 놓는 것이 이 판의 일이다.</div>`
      + box('im-quote-gold', '<div class="im-text tiny">근거가 부족한 문장은 인용선을 달아 갈라 둔다.</div>');
    default: return '';
  }
}

function sheet(id) {
  const L = layouts.LAYOUTS[id];
  const needs = L.needs.length ? L.needs.join(' · ') : '없음';
  return `<figure class="sheet">
  <div class="paper">
    <div class="im-chapter-label">CHAPTER 03</div>
    <div class="im-h3 tight">${esc(L.label)}</div>
    <div class="im-layout im-${id} fill">${inner(id)}</div>
  </div>
  <figcaption>
    <b>${esc(id)}</b> <span>${esc(L.label)}</span>
    <div class="use">${esc(L.use)}</div>
    <div class="needs">필요한 자료: ${esc(needs)}</div>
  </figcaption>
</figure>`;
}

/* ─────────────────────────────────────────────────────────
 * 3. 문서 조립
 * ───────────────────────────────────────────────────────── */

function build({ themeId = 'institutional', stamp = null } = {}) {
  const T = themes.get(themeId) || themes.get('institutional');
  const when = stamp || kstStamp();
  const L = layouts.LAYOUTS;
  const ids = Object.keys(L);
  const dec = decisions();
  const themeList = themes.list();

  /* 팔레트 — 테마가 정하는 값과 구조가 정하는 값을 갈라 적는다 */
  const paletteTheme = [
    ['primary', T.primary, '주색 — 제목·표 머리·네이비 박스'],
    ['primaryMid', T.primaryMid, '보조 막대'],
    ['accent', T.accent, '라벨·강조'],
    ['accentLight', T.accentLight, '하이라이트'],
    ['onPrimary', T.onPrimary, '주색 위 글자'],
    ['surfaceAlt', T.surfaceAlt, '강조 박스 바탕'],
  ];
  const paletteFixed = [
    ['body', COLOR.body, '본문'],
    ['muted', COLOR.muted, '보조 설명'],
    ['faint', COLOR.faint, '캡션'],
    ['ruleStrong', COLOR.ruleStrong, '굵은 괘선'],
    ['ruleWeak', COLOR.ruleWeak, '가는 괘선'],
    ['negative', COLOR.negative, '음수·경고'],
  ];
  const swatch = (rows) => rows.map(([k, v, use]) =>
    `<div class="sw"><i style="background:${esc(v)}"></i><b>${esc(k)}</b>`
    + `<code>${esc(v)}</code><span>${esc(use)}</span></div>`).join('');

  const scale = [
    ['h1', SIZE.h1, '표지 제목'], ['h2', SIZE.h2, '장 제목'],
    ['h2Small', SIZE.h2Small, '작은 장 제목'], ['h3', SIZE.h3, '절 제목'],
    ['body', SIZE.body, '본문'], ['table', SIZE.table, '표'],
    ['tableHead', SIZE.tableHead, '표 머리'], ['caption', SIZE.caption, '캡션'],
    ['micro', SIZE.micro, '각주·페이지번호'],
  ];

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IM 레이아웃 시스템 견본</title>
<style>
${css.build(themeId)}

/* ── 견본 자체의 껍데기 (산출물 규격이 아니다) ────────────── */
*{box-sizing:border-box}
body{margin:0;background:#F2F1EE;color:var(--im-body);font-family:var(--im-sans);font-size:14px;line-height:1.7}
.wrap{max-width:1180px;margin:0 auto;padding:44px 20px 90px}
.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--im-accent);font-weight:600;margin:0 0 14px}
h1.top{font-family:var(--im-serif);font-size:clamp(28px,4.6vw,42px);line-height:1.12;letter-spacing:-.025em;color:var(--im-primary);margin:0 0 14px;font-weight:500}
.lede{font-size:16px;color:var(--im-body-2);max-width:64ch;margin:0 0 6px}
h2.sec{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--im-muted);font-weight:600;margin:52px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--im-rule-strong)}
p{max-width:66ch;margin:0 0 12px}
.small{font-size:13px;color:var(--im-muted)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}

/* 판정 한 줄 (CLAUDE.md §6-3 ①) */
.verdict{display:flex;flex-wrap:wrap;gap:10px 26px;align-items:baseline;background:var(--im-surface);border-left:4px solid var(--im-accent);padding:18px 20px;margin:24px 0 8px}
.verdict b{font-family:var(--im-serif);font-size:30px;color:var(--im-primary);font-variant-numeric:tabular-nums}
.verdict span{font-size:14px;color:var(--im-body-2)}

/* 테마 갈아 끼우기 */
.themebar{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0 4px}
.themebar button{font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--im-rule-strong);background:var(--im-surface);color:var(--im-body);padding:5px 11px}
.themebar button[aria-pressed="true"]{background:var(--im-primary);color:var(--im-on-primary);border-color:var(--im-primary)}
.themebar button:focus-visible{outline:2px solid var(--im-accent);outline-offset:1px}

/* 팔레트 */
.sws{display:grid;grid-template-columns:repeat(auto-fill,minmax(288px,1fr));gap:8px}
.sw{display:flex;align-items:center;gap:10px;background:var(--im-surface);padding:9px 11px}
.sw i{width:26px;height:26px;flex:none;border:1px solid rgba(0,0,0,.12)}
.sw b{font-size:12px;font-weight:600;min-width:82px}
.sw code{color:var(--im-muted);min-width:64px}
.sw span{font-size:11.5px;color:var(--im-faint);line-height:1.35}

/* 활자 계단 */
.scale{background:var(--im-surface);padding:10px 16px}
.scale div{display:flex;align-items:baseline;gap:14px;padding:7px 0;border-bottom:1px solid var(--im-rule-weak)}
.scale div:last-child{border-bottom:0}
.scale i{font-style:normal;font-family:var(--im-serif);color:var(--im-primary);line-height:1.1}
.scale b{font-size:11.5px;font-weight:600;min-width:78px;color:var(--im-body-2)}
.scale code{color:var(--im-muted);min-width:44px}
.scale span{font-size:11.5px;color:var(--im-faint)}

/* 레이아웃 열두 장 */
.sheets{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:18px}
.sheet{margin:0;background:var(--im-surface);border:1px solid var(--im-rule-weak)}
.paper{aspect-ratio:${PAGE.widthMm}/${PAGE.heightMm};padding:14px;display:flex;flex-direction:column;gap:7px;overflow:hidden}
.paper .tight{margin:0 0 2px;font-size:13px}
.fill{flex:1;min-height:0}
.tiny{font-size:8.5px;line-height:1.5}
.ph{background:var(--im-track);display:flex;align-items:center;justify-content:center;min-height:44px}
.ph span{font-size:8.5px;letter-spacing:.06em;color:var(--im-faint-2)}
.paper .im-table{font-size:8px}
.paper .im-table th,.paper .im-table td{padding:3px 4px}
.paper .im-kpi{padding:6px 7px;border-top-width:1.5px}
.paper .im-kpi-label{font-size:6.5px;letter-spacing:.08em}
.paper .im-kpi-value{font-size:13px}
.paper .im-kpi-sub{font-size:6.5px}
.paper .im-navybox{padding:10px 11px}
.paper .im-navybox-label{font-size:6.5px}
.paper .im-navybox-value{font-size:16px}
.paper .im-navybox-sub{font-size:7px}
.paper .im-caption{font-size:7px;margin:0}
.chart{display:flex;align-items:flex-end;gap:5px;height:100%;min-height:52px}
.chart i{flex:1;background:var(--im-primary-mid);display:block}
.chart i:nth-child(2){background:var(--im-primary)}
.chart i:nth-child(4){background:var(--im-accent-light)}
.tl{display:flex;align-items:center;gap:4px;height:100%;min-height:52px}
.im-L08.fill{align-content:center}
.tl b{flex:1;border-top:2px solid var(--im-primary);padding-top:5px;font-weight:400;display:block}
.tl span{display:block;font-size:7.5px;color:var(--im-body)}
.tl em{display:block;font-style:normal;font-size:6.5px;color:var(--im-faint)}
.risk{display:flex;align-items:center;justify-content:center;min-height:26px;font-size:7px;color:#fff}
.risk.r0{background:var(--im-primary)}
.risk.r1{background:var(--im-primary-mid)}
.risk.r2{background:var(--im-negative)}
figcaption{padding:10px 12px;border-top:1px solid var(--im-rule-weak)}
figcaption b{font-family:var(--im-serif);font-size:14px;color:var(--im-primary)}
figcaption>span{font-size:12px;color:var(--im-body-2);margin-left:6px}
figcaption .use{font-size:11.5px;color:var(--im-muted);margin-top:3px}
figcaption .needs{font-size:11px;color:var(--im-faint);margin-top:2px}

/* 표 */
.tbl{background:var(--im-surface);overflow-x:auto}
.tbl table{width:100%;border-collapse:collapse;font-size:13px;min-width:520px}
.tbl th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--im-muted);font-weight:600;text-align:left;padding:9px 12px;border-bottom:1px solid var(--im-rule-strong)}
.tbl td{padding:8px 12px;border-bottom:1px solid var(--im-rule-weak);white-space:nowrap}
.tbl tr:last-child td{border-bottom:0}
.tbl code{color:var(--im-primary);font-weight:500}
.sev{font-size:11px;font-weight:600;padding:1px 8px;white-space:nowrap}
.sev.RED{background:#F7E4E1;color:var(--im-negative)}
.sev.YELLOW{background:#F7EFDC;color:#8A6100}

footer{margin-top:60px;padding-top:16px;border-top:1px solid var(--im-rule-strong);font-size:12px;color:var(--im-muted)}
@media print{body{background:#fff}.themebar{display:none}}
</style>
</head>
<body>
<div class="wrap" id="root">

  <p class="eyebrow">LinkPilot IM &middot; Design System &middot; ${esc(when)}</p>
  <h1 class="top">IM 레이아웃 시스템</h1>
  <p class="lede">이 문서는 손으로 쓴 것이 아니다. <code>design/tokens.js</code> &middot; <code>themes.js</code> &middot; <code>layouts.js</code> &middot; <code>rules.json</code> 을 읽어 만든다. 값을 바꾸려면 그 네 곳을 고치고 다시 만든다 &mdash; 여기를 고치면 다음 생성 때 지워진다.</p>

  <div class="verdict">
    <b>${ids.length}</b><span>레이아웃</span>
    <b>${themeList.length}</b><span>테마</span>
    <b>${Object.keys(themes.WRITING || {}).length}</b><span>문체</span>
    <b>${Object.keys(themes.DOC_PROFILE || {}).length}</b><span>문서 종류</span>
    <b>${(rules.rules || []).length}</b><span>디자인 규칙</span>
  </div>
  <p class="small">지면 ${esc(PAGE.format)} ${PAGE.widthMm}&times;${PAGE.heightMm}mm &middot; 여백 ${PAGE.marginMm}mm &middot; 기본 테마 <code>${esc(T.id)}</code> (${esc(T.labelKr)})</p>

  <h2 class="sec">테마 — 눌러서 갈아 끼운다</h2>
  <p class="small">아래 모든 그림이 그 자리에서 바뀐다. 구조 토큰(괘선 두께 &middot; 표 규격 &middot; 지면 기하)은 테마가 바꾸지 않는다 &mdash; 바꾸면 문서가 서로 다른 시스템처럼 보인다.</p>
  <div class="themebar" id="themebar">
${themeList.map((t) => `    <button type="button" data-t="${esc(t.id)}" aria-pressed="${t.id === T.id ? 'true' : 'false'}">${esc(t.label)}</button>`).join('\n')}
  </div>

  <h2 class="sec">팔레트 — 테마가 정하는 것</h2>
  <div class="sws">${swatch(paletteTheme)}</div>

  <h2 class="sec">팔레트 — 테마가 바꾸지 않는 것</h2>
  <div class="sws">${swatch(paletteFixed)}</div>

  <h2 class="sec">활자</h2>
  <p class="small">본문 <code>${esc(FONT.sans)}</code> &middot; 제목 <code>${esc(FONT.serif)}</code>. 두 번째 이름을 지우지 않는다 &mdash; <code>Noto Sans KR</code> 만 적으면 그 이름이 없는 기계에서 브라우저가 <b>말없이 다른 CJK 글꼴로 그린다</b> (실측: 중국어 글꼴로 나갔다).</p>
  <div class="scale">
${scale.map(([k, v, use]) => `    <div><b>${esc(k)}</b><code>${v}px</code><i style="font-size:${Math.min(v, 34)}px">국문 Abc 123</i><span>${esc(use)}</span></div>`).join('\n')}
  </div>

  <h2 class="sec">레이아웃 ${ids.length}종</h2>
  <p class="small">각 장은 실제 A4 비율(${PAGE.widthMm}:${PAGE.heightMm})로 그렸고, 격자는 <code>design/css.js</code> 의 <code>.im-L**</code> 규칙 그대로다.</p>
  <div class="sheets">
${ids.map(sheet).join('\n')}
  </div>

  <h2 class="sec">어떤 절이 어떤 레이아웃으로 가는가</h2>
  <p class="small">아래 표는 옮겨 적은 것이 아니라 <code>layouts.pick()</code> 을 <b>실제로 돌린 결과</b>다. 규칙을 고치면 이 표가 따라 바뀐다.</p>
  <div class="tbl"><table>
    <thead><tr><th>절의 내용</th><th>고른 레이아웃</th><th>고른 이유</th></tr></thead>
    <tbody>
${dec.map((d) => `      <tr><td>${esc(d.what)}</td><td><code>${esc(d.id)}</code> ${esc(d.label)}</td><td>${esc(d.reason)}</td></tr>`).join('\n')}
    </tbody>
  </table></div>

  <h2 class="sec">부품</h2>
  <div class="sws" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr));align-items:stretch">
    <div style="background:var(--im-surface);padding:14px">
      <div class="im-navybox">
        <div class="im-navybox-label">Total Investment</div>
        <div class="im-navybox-value">${esc(eok(1634.3))}</div>
        <div class="im-navybox-sub">Equity ${esc(pct(30))} / Debt ${esc(pct(70))}</div>
      </div>
    </div>
    <div style="background:var(--im-surface);padding:14px">
      <div class="im-creambox">
        <div class="im-h3" style="margin:0 0 4px">강조 박스</div>
        <div class="im-text" style="font-size:11.5px">근거는 있으나 가정이 섞인 값은 여기에 둔다.</div>
      </div>
    </div>
    <div style="background:var(--im-surface);padding:14px">
      <div class="im-kpi">
        <div class="im-kpi-label">Equity IRR</div>
        <div class="im-kpi-value">${esc(pct(14.2))}</div>
        <div class="im-kpi-sub">세후 &middot; 보유 7년</div>
      </div>
    </div>
    <div style="background:var(--im-surface);padding:14px">
      <div class="im-quote-red">
        <div class="im-text" style="font-size:11.5px">확인되지 않은 값은 붉은 인용선으로 갈라 둔다.</div>
      </div>
    </div>
  </div>

  <h2 class="sec">표 · 숫자 · 캡션</h2>
  <div style="background:var(--im-surface);padding:16px">
    <div class="im-table-wrap"><table class="im-table">
      <thead><tr><th>구분</th><th class="im-r">금액</th><th class="im-r">비중</th></tr></thead>
      <tbody>
        <tr><td>토지비</td><td class="im-r">${esc(eok(420))}</td><td class="im-r">${esc(pct(25.7))}</td></tr>
        <tr><td>건축공사비</td><td class="im-r">${esc(eok(1214.3))}</td><td class="im-r">${esc(pct(74.3))}</td></tr>
        <tr><td>당기순이익</td><td class="im-r im-neg">${esc(eok(-12.4))}</td><td class="im-r">&mdash;</td></tr>
        <tr><td>합계</td><td class="im-r">${esc(eok(10762.4))}</td><td class="im-r">${esc(pct(100))}</td></tr>
      </tbody>
    </table></div>
    <div class="im-caption">${esc(CAPTION_PREFIX)}사업계획서 p.34 &middot; 기준일 2026-08-31</div>
  </div>
  <p class="small">금액은 원화 억원/조원, 음수는 <code>&#9651;</code>, 숫자는 <code>tabular-nums</code> 로 자릿수를 맞춘다. 캡션은 언제나 <code>${esc(CAPTION_PREFIX.trim())}</code> 로 시작한다 &mdash; 출처 없는 표는 IM 에서 근거가 없는 것과 같다.</p>

  <h2 class="sec">디자인 규칙 ${(rules.rules || []).length}개</h2>
  <p class="small">규칙의 단일 소스는 <code>design/rules.json</code> 이고, 게이트(<code>design/check.js</code>)와 이 문서가 <b>같은 파일</b>을 읽는다.</p>
  <div class="tbl"><table>
    <thead><tr><th>ID</th><th>규칙</th><th>적용</th><th>등급</th></tr></thead>
    <tbody>
${(rules.rules || []).map((r) => `      <tr><td><code>${esc(r.id)}</code></td><td style="white-space:normal">${esc(r.label)}</td><td>${esc(r.applies)}</td><td><span class="sev ${esc(r.severity)}">${esc(r.severity)}</span></td></tr>`).join('\n')}
    </tbody>
  </table></div>

  <footer>
    PDI GID &middot; LinkPilot IM Agent &middot; 생성 ${esc(when)}<br>
    이 문서에 보이는 숫자는 <b>디자인을 보이기 위한 예시</b>이지 실제 딜의 값이 아니다.
    글꼴이 이 자리에 없으면 브라우저가 다른 활자로 그리므로, 활자 판단은 글꼴이 설치된 자리에서 한다.
  </footer>
</div>

<script>
(function(){
  var bar=document.getElementById('themebar'), root=document.getElementById('root');
  if(!bar||!root)return;
  bar.addEventListener('click',function(e){
    var b=e.target.closest('button[data-t]'); if(!b)return;
    root.setAttribute('data-im-theme', b.getAttribute('data-t'));
    Array.prototype.forEach.call(bar.querySelectorAll('button'),function(x){
      x.setAttribute('aria-pressed', x===b?'true':'false');
    });
  });
})();
</script>
</body></html>
`;
}

module.exports = { build, decisions, sheet, PROBES };
