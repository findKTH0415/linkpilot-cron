#!/usr/bin/env node
'use strict';
/**
 * build-styleoptions.js — **스타일 두 안 고르는 화면** 〈2026-09-06 사장님 지시:
 *   「2가지 스타일 옵션 선택 하도록」〉.
 *
 *   npm run im:styles
 *   npm run im:styles -- --asset hotel --doc teaser --investor family_office
 *
 * ★★★ **왜 만들었나.** 테마 고르는 자리가 **단추 13개**였다. 13개는 고르는 것이
 *   아니라 **고르기를 포기하게 만드는 수**다 — 실제로는 첫 번째를 누르거나
 *   추천을 그냥 받아들이게 되고, 둘 다 고른 것이 아니다.
 *   지시서 §5.1 이 이미 「A안·B안·C안」을 적어 두었고, 사장님이 **둘**로 정하셨다.
 *
 * ★★ **둘을 나란히 그려서 보여 준다 — 색 견본이 아니라 실제 지면으로.**
 *   팔레트만 보여 주면 「Institutional 과 Global IB 가 어떻게 다른가」를 여전히
 *   모른다. 그래서 **같은 딜·같은 숫자**로 표지와 본문을 두 벌 그린다.
 *   다른 것은 스타일뿐이므로, 차이가 곧 고를 거리다.
 *
 * ★ **장점·주의점을 지어내지 않는다.** 전부 `design/options.js` 가 `themes.js` 의
 *   실제 값(`traits`·`writing`·`density`·`cover`)에서 만든다. 「쪽수가 늘어난다」는
 *   인상이 아니라 `DENSITY.airy.section=28` 대 `normal=20` 이라는 잰 값이다.
 *
 * ★ 시각을 박지 않는다 — 박으면 돌릴 때마다 파일이 달라져 `guard` 의
 *   「미리보기 재생성」 칸이 늘 빨갛다 (`build-layouts.js` 와 같은 규칙).
 */

const fs = require('fs');
const path = require('path');

const DESIGN = path.join(__dirname, '..', '..', 'design');
const css = require(path.join(DESIGN, 'css.js'));
const options = require(path.join(DESIGN, 'options.js'));
const themes = require(path.join(DESIGN, 'themes.js'));
const { PAGE, eok, pct, CAPTION_PREFIX } = require(path.join(DESIGN, 'tokens.js'));

const OUT = path.join(__dirname, 'style-options.html');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `**굵게**` 만 살린다 — 설명에 강조가 필요한 자리가 있다 */
const md = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

/**
 * 두 안이 **같은 딜**을 그린다 — 다른 것은 스타일뿐이어야 고를 거리가 된다.
 * ★ 숫자는 예시다. 화면에 그렇게 박는다 (CLAUDE.md §8).
 */
const DEAL = {
  name: '인천 남동공단 6.5MW 데이터센터 개발사업',
  id: 'LP-DC-2026-001',
  total: 2962, debt: 1850, equity: 1112,
  pirr: 12.08, eirr: 15.92, dscr: 1.28,
  rows: [['토지비', 420, 14.2], ['건축공사비', 1214.3, 41.0], ['전기·설비', 986.4, 33.3], ['기타', 341.3, 11.5]],
};

/** 표지 한 장 — 테마의 `cover` 형식을 실제로 따른다 */
function cover(T) {
  const label = `<div class="im-chapter-label">Confidential Information Memorandum</div>`;
  const title = `<div class="im-h1 cv-title">${esc(DEAL.name)}</div>`;
  const sub = `<div class="im-sub">${esc(DEAL.id)} · Strictly Private and Confidential</div>`;

  if (T.cover === 'fullImage') {
    return `<div class="cv cv-full">
      <div class="ph ph-tall"><span>표지 사진 (전면)</span></div>
      <div class="cv-scrim">${label}${title}${sub}</div>
    </div>`;
  }
  if (T.cover === 'split') {
    return `<div class="cv cv-split">
      <div class="ph"><span>표지 사진</span></div>
      <div class="cv-side">${label}${title}${sub}</div>
    </div>`;
  }
  return `<div class="cv cv-rule">
    <div class="cv-line"></div>
    ${label}${title}${sub}
    <div class="cv-foot">PDI GID</div>
  </div>`;
}

/** 본문 한 장 — 같은 숫자, 스타일만 다르다 */
function body() {
  const kpi = (l, v, s) =>
    `<div class="im-kpi"><div class="im-kpi-label">${esc(l)}</div>`
    + `<div class="im-kpi-value">${esc(v)}</div><div class="im-kpi-sub">${esc(s)}</div></div>`;
  return `<div class="bd">
    <div class="im-chapter-label">Chapter 04</div>
    <div class="im-h2 bd-h">사업비 및 수익성</div>
    <div class="im-navybox">
      <div class="im-navybox-label">Total Investment</div>
      <div class="im-navybox-value">${esc(eok(DEAL.total))}</div>
      <div class="im-navybox-sub">Debt ${esc(eok(DEAL.debt))} / Equity ${esc(eok(DEAL.equity))}</div>
    </div>
    <div class="bd-kpis">
      ${kpi('Project IRR', pct(DEAL.pirr), '세전')}
      ${kpi('Equity IRR', pct(DEAL.eirr), '세후')}
      ${kpi('최소 DSCR', DEAL.dscr + '배', '운영 1~5년')}
    </div>
    <table class="im-table">
      <thead><tr><th>구분</th><th class="im-r">금액</th><th class="im-r">비중</th></tr></thead>
      <tbody>${DEAL.rows.map(([a, b, c]) =>
    `<tr><td>${esc(a)}</td><td class="im-r">${esc(eok(b))}</td><td class="im-r">${esc(pct(c))}</td></tr>`).join('')}</tbody>
    </table>
    <div class="im-caption">${esc(CAPTION_PREFIX)}사업계획서 p.34 · 기준일 2026-08-31</div>
  </div>`;
}

/** 한 안의 카드 */
function card(o) {
  const T = themes.get(o.themeId);
  return `<section class="opt" data-im-theme="${esc(o.themeId)}" data-role="${esc(o.role)}">
  <header class="opt-h">
    <div class="opt-role">${esc(o.role)}안 · ${esc(o.roleKr)}</div>
    <h2 class="opt-name">${esc(o.label)}</h2>
    <div class="opt-kr">${esc(o.labelKr)} · <span class="fam">${esc(o.familyKr)}</span>${o.confidence != null ? ` · 추천 <b>${o.confidence}</b>점` : ' · 추천 점수 없음'}</div>
${o.docFit ? '' : `    <p class="misfit">이 테마는 <b>${esc(o.docType)}</b> 에 쓴다고 적혀 있지 않습니다 — 쓸 수는 있지만, 그 문서용으로 만든 스타일이 아닙니다.</p>`}
  </header>

  <div class="pages">
    <figure><div class="paper">${cover(T)}</div><figcaption>표지</figcaption></figure>
    <figure><div class="paper">${body()}</div><figcaption>본문</figcaption></figure>
  </div>

  <div class="opt-b">
    <h3>왜 이 자리에 놓였나</h3>
    <p>${md(o.why)}</p>

    <h3>장점</h3>
    <ul>${o.strengths.map((s) => `<li>${md(s)}</li>`).join('')}</ul>

    <h3>주의점</h3>
    <ul class="warn">${o.cautions.map((s) => `<li>${md(s)}</li>`).join('')}</ul>

    <h3>나오는 모습</h3>
    <p class="shape">${esc(o.shape)}</p>
  </div>

  <button type="button" class="choose" data-t="${esc(o.themeId)}" data-role="${esc(o.role)}" aria-pressed="false">
    ${esc(o.role)}안으로 정한다
  </button>
</section>`;
}

function build(signals) {
  const r = options.pick2(signals);
  const sig = Object.entries(r.signals || {})
    .filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' · ') || '신호 없음';

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>스타일 두 안 고르기</title>
<style>
${css.build('institutional')}

*{box-sizing:border-box}
body{margin:0;background:#F2F1EE;color:var(--im-body);font-family:var(--im-sans);font-size:14px;line-height:1.7}
.wrap{max-width:1240px;margin:0 auto;padding:44px 20px 90px}
.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--im-accent);font-weight:600;margin:0 0 14px}
h1.top{font-family:var(--im-serif);font-size:clamp(28px,4.6vw,42px);line-height:1.12;letter-spacing:-.025em;color:var(--im-primary);margin:0 0 14px;font-weight:500}
.lede{font-size:16px;color:var(--im-body-2);max-width:64ch;margin:0 0 6px}
.small{font-size:13px;color:var(--im-muted)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}

.verdict{background:var(--im-surface);border-left:4px solid var(--im-accent);padding:18px 20px;margin:24px 0 10px}
.verdict b{font-family:var(--im-serif);font-size:20px;color:var(--im-primary)}
.verdict .vs{color:var(--im-faint);margin:0 10px;font-size:15px}

.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:20px;margin-top:22px;align-items:start}
.opt{background:var(--im-surface);border:1px solid var(--im-rule-weak);display:flex;flex-direction:column}
.opt[aria-current="true"]{border-color:var(--im-primary);box-shadow:0 0 0 2px var(--im-primary)}
.opt-h{padding:18px 20px 14px;border-bottom:1px solid var(--im-rule-weak)}
.opt-role{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--im-accent);font-weight:600}
.opt-name{font-family:var(--im-serif);font-weight:500;font-size:26px;line-height:1.15;letter-spacing:-.02em;color:var(--im-primary);margin:5px 0 4px}
.opt-kr{font-size:13px;color:var(--im-muted)}
.opt-kr .fam{color:var(--im-body-2);font-weight:500}

.pages{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:18px 20px;background:var(--im-surface-alt)}
.pages figure{margin:0}
.pages figcaption{font-size:11px;color:var(--im-muted);margin-top:6px;text-align:center}
.paper{aspect-ratio:${PAGE.widthMm}/${PAGE.heightMm};background:var(--im-surface);border:1px solid var(--im-rule-weak);overflow:hidden;padding:12px;display:flex;flex-direction:column}

/* 표지 세 형식 */
.cv{flex:1;display:flex;flex-direction:column;min-height:0}
.cv-title{font-size:15px;line-height:1.14;margin:6px 0 0}
.cv .im-chapter-label{font-size:5.5px;letter-spacing:.16em}
.cv .im-sub{font-size:6.5px;margin-top:4px}
.cv-rule .cv-line{height:2px;background:var(--im-accent);width:44px;margin-bottom:10px}
.cv-rule{justify-content:flex-start}
.cv-foot{margin-top:auto;font-size:6px;color:var(--im-faint);letter-spacing:.1em}
.cv-split{display:grid;grid-template-rows:1fr auto;gap:8px}
.cv-side{padding-top:2px}
.cv-full{position:relative}
.cv-full .ph-tall{flex:1}
.cv-scrim{position:absolute;left:0;right:0;bottom:0;padding:10px;background:linear-gradient(transparent,rgba(0,0,0,.72))}
.cv-full .im-chapter-label,.cv-full .cv-title,.cv-full .im-sub{color:#fff}
.ph{background:var(--im-track);display:flex;align-items:center;justify-content:center;min-height:40px}
.ph span{font-size:7px;letter-spacing:.06em;color:var(--im-faint-2)}

/* 본문 */
.bd{display:flex;flex-direction:column;gap:6px;flex:1;min-height:0}
.bd .im-chapter-label{font-size:5.5px;letter-spacing:.16em}
.bd-h{font-size:11px;margin:0}
.bd .im-navybox{padding:8px 9px}
.bd .im-navybox-label{font-size:5.5px;letter-spacing:.1em}
.bd .im-navybox-value{font-size:14px}
.bd .im-navybox-sub{font-size:6px}
.bd-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
.bd .im-kpi{padding:5px 6px;border-top-width:1.5px}
.bd .im-kpi-label{font-size:5px;letter-spacing:.06em}
.bd .im-kpi-value{font-size:11px}
.bd .im-kpi-sub{font-size:5px}
.bd .im-table{font-size:6.5px}
.bd .im-table th,.bd .im-table td{padding:2.5px 4px}
.bd .im-caption{font-size:5.5px;margin:0}

.opt-b{padding:18px 20px;flex:1}
.opt-b h3{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--im-muted);font-weight:600;margin:16px 0 6px}
.opt-b h3:first-child{margin-top:0}
.opt-b p{margin:0;font-size:13.5px;color:var(--im-body-2)}
.opt-b ul{margin:0;padding-left:18px;font-size:13.5px;color:var(--im-body-2)}
.opt-b li{margin-bottom:5px}
.opt-b .warn li::marker{color:var(--im-negative)}
.opt-b .shape{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--im-primary)}

.choose{font:inherit;font-size:14px;font-weight:600;cursor:pointer;margin:0;padding:14px;border:0;border-top:1px solid var(--im-rule-weak);background:var(--im-surface-alt);color:var(--im-primary);width:100%}
.choose:hover{background:var(--im-track)}
.choose:focus-visible{outline:2px solid var(--im-accent);outline-offset:-3px}
.choose[aria-pressed="true"]{background:var(--im-primary);color:var(--im-on-primary)}

.after{margin-top:22px;background:var(--im-surface);border-left:3px solid var(--im-rule-strong);padding:16px 20px}
.after[hidden]{display:none}
.after b{color:var(--im-primary)}
.after code{background:var(--im-surface-alt);padding:2px 6px}

.misfit{margin:8px 0 0;padding:7px 10px;background:#FCF3E0;color:#8A6100;font-size:12.5px;line-height:1.5}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.dbox{background:var(--im-surface);padding:16px 20px}
.dh{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;margin:0 0 8px;color:var(--im-primary)}
.dh.same{color:var(--im-faint)}
.dbox ul{margin:0;padding-left:18px;font-size:13.5px;color:var(--im-body-2)}
.dbox li{margin-bottom:5px}
.dbox .none{color:var(--im-faint);list-style:none;margin-left:-18px}
h2.sec{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--im-muted);font-weight:600;margin:48px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--im-rule-strong)}
.tbl{background:var(--im-surface);overflow-x:auto}
.tbl table{width:100%;border-collapse:collapse;font-size:13px;min-width:460px}
.tbl th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--im-muted);font-weight:600;text-align:left;padding:9px 12px;border-bottom:1px solid var(--im-rule-strong)}
.tbl td{padding:8px 12px;border-bottom:1px solid var(--im-rule-weak);white-space:nowrap}
.tbl tr:last-child td{border-bottom:0}
footer{margin-top:56px;padding-top:16px;border-top:1px solid var(--im-rule-strong);font-size:12px;color:var(--im-muted)}
</style>
</head>
<body>
<div class="wrap">

  <p class="eyebrow">LinkPilot IM · 시안 선택 (지시서 §5.1)</p>
  <h1 class="top">스타일 두 안</h1>
  <p class="lede">테마 13개 중 <b>둘</b>만 골라 나란히 놓았습니다. 두 장은 <b>같은 딜·같은 숫자</b>이고 다른 것은 스타일뿐입니다 — 그래야 차이가 곧 고를 거리가 됩니다.</p>

  <div class="verdict">
    <b>${esc(r.A.label)}</b><span class="vs">대</span><b>${esc(r.B.label)}</b>
    <div class="small" style="margin-top:6px">${md(r.note)}</div>
  </div>
  <p class="small">딜 신호: <code>${esc(sig)}</code> — 신호가 바뀌면 두 안도 바뀝니다.</p>

  <div class="grid">
${card(r.A)}
${card(r.B)}
  </div>

  <div class="after" id="after" hidden></div>

  <h2 class="sec">무엇이 갈리고 무엇이 같은가</h2>
  <p class="small">말로 「성격이 다르다」고만 적으면 그림과 글이 서로 다른 말을 할 수 있습니다. 그래서 축을 <b>하나씩 재서</b> 적습니다 — 색 거리는 RGB 거리이고, ${options.COLOR_NOTICEABLE} 미만이면 나란히 놓아도 구별이 어렵다고 봅니다.</p>
  <div class="two">
    <div class="dbox">
      <h3 class="dh">갈리는 것 ${r.diffs.diff.length}가지</h3>
      <ul>${r.diffs.diff.map((d) => `<li>${esc(d)}</li>`).join('') || '<li class="none">없다</li>'}</ul>
    </div>
    <div class="dbox">
      <h3 class="dh same">같은 것 ${r.diffs.same.length}가지</h3>
      <ul>${r.diffs.same.map((d) => `<li>${esc(d)}</li>`).join('') || '<li class="none">없다</li>'}</ul>
    </div>
  </div>

  <h2 class="sec">고르지 않은 안 ${Math.max(0, (r.ranked || []).length - 2)}개</h2>
  <p class="small">추천이 매긴 순위 전부입니다. 둘 중에 마음에 드는 것이 없으면 여기서 이름을 짚어 주십시오.</p>
  <div class="tbl"><table>
    <thead><tr><th>순위</th><th>테마</th><th>점수</th><th>고른 이유</th></tr></thead>
    <tbody>
${(r.ranked || []).map((x, i) => `      <tr><td>${i + 1}</td><td>${esc(x.label)} <span class="small">${esc(x.labelKr)}</span></td><td>${x.confidence}</td><td>${esc((x.reasons || []).join(' · '))}</td></tr>`).join('\n')}
    </tbody>
  </table></div>

  <footer>
    PDI GID · LinkPilot IM Agent · 두 안은 <code>design/options.js</code> 가 규칙으로 고릅니다 (언어모델을 쓰지 않습니다).<br>
    지면의 숫자는 <b>스타일을 보이기 위한 예시</b>이지 실제 딜의 값이 아닙니다. 글꼴이 이 자리에 없으면 다른 활자로 그려지므로, 활자 판단은 글꼴이 설치된 자리에서 합니다.
  </footer>
</div>

<script>
(function(){
  var after=document.getElementById('after');
  document.addEventListener('click',function(e){
    var b=e.target.closest('.choose'); if(!b)return;
    var t=b.getAttribute('data-t'), role=b.getAttribute('data-role');
    Array.prototype.forEach.call(document.querySelectorAll('.choose'),function(x){
      x.setAttribute('aria-pressed', x===b?'true':'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.opt'),function(s){
      s.setAttribute('aria-current', s.getAttribute('data-role')===role?'true':'false');
    });
    after.hidden=false;
    after.innerHTML='<b>'+role+'안 ('+t+')</b> 으로 정하셨습니다. '
      + '이제 이 한 줄이면 그 딜의 모든 산출물이 이 스타일로 나옵니다 — '
      + '<code>design-state.select(프로젝트, { themeId: \\''+t+'\\' })</code>. '
      + '내용(숫자·문장)은 건드리지 않습니다 — 다시 그리기만 합니다. '
      + '<br><span style="color:var(--im-muted)">이 화면에서 누른 것은 표시일 뿐이라 저장되지 않습니다. 고르신 것을 알려 주시면 제가 넣겠습니다.</span>';
    try{ after.scrollIntoView({block:'nearest'}); }catch(_){}
  });
})();
</script>
</body></html>
`;
}

function argOf(name) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : null;
}

/** 기본 신호는 데모 딜과 같다 — 화면과 `im:demo` 가 다른 것을 보여 주면 헷갈린다 */
const DEFAULT_SIGNALS = { assetType: 'datacenter', docType: 'im', investorType: 'institutional' };

if (require.main === module) {
  const signals = {
    assetType: argOf('asset') || DEFAULT_SIGNALS.assetType,
    docType: argOf('doc') || DEFAULT_SIGNALS.docType,
    investorType: argOf('investor') || DEFAULT_SIGNALS.investorType,
  };
  const html = build(signals);
  fs.writeFileSync(OUT, html, 'utf8');
  const r = options.pick2(signals);
  console.log(`두 안: A ${r.A.label} (${r.A.familyKr}) · B ${r.B.label} (${r.B.familyKr})`);
  console.log(`  ${path.relative(path.join(__dirname, '..', '..', '..'), OUT)}  (${html.length.toLocaleString('ko-KR')}자)`);
}

module.exports = { build, card, cover, body, DEAL, DEFAULT_SIGNALS, OUT };
