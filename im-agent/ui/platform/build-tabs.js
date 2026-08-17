'use strict';
/**
 * build-tabs.js — 「자료」 탭을 넣은 **탭 구성안** 화면 (D-63).
 *
 *   node im-agent/ui/platform/build-tabs.js [--out <경로>]
 *
 * 왜 따로 만드는가:
 *   탭 바 자체는 **본체 플랫폼(NAS 의 React/Vite) 쪽**이라 이 저장소에 없다.
 *   그래서 구성안을 말로만 주고받으면 어느 탭에 무엇이 들어가는지 사람마다
 *   다르게 그린다. 눌러 볼 수 있는 그림 하나가 그 차이를 없앤다.
 *
 * ★ **이것은 배포판이 아니라 구성안이다.** 화면에 그렇게 박아 둔다 —
 *   구성안을 완성품으로 오해하면 그것을 근거로 일정을 잡는다.
 *
 * ★ 스크립트를 쓰지 않는다. 조각을 주소로 올릴 때 CSP 가 막기 때문에
 *   (`build-static.js` 의 `publishable()`), 탭 전환은 **라디오 + CSS** 로 한다.
 *
 * ★ 목록·한도·단계는 **손으로 적지 않는다.** 실제 코드에서 가져온다 —
 *   손으로 적으면 코드가 바뀐 날부터 구성안만 옛말을 하고 아무도 모른다.
 *     완성 보고서 목록 ← report-api.cjs 의 OUTPUTS
 *     새 보고서 생성   ← flow-core.js 의 STEPS
 *     자료 형식·한도   ← 02-extraction 의 readGroups() · api-router 의 상한
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const AGENT = path.join(HERE, '..', '..');

const FLOW = require('./flow-core.js');
const api = require('../report-api.cjs');
const ex = require(path.join(AGENT, 'agents', '02-extraction'));

const esc = (t) => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const mb = (n) => `${Math.round(n / (1024 * 1024))}MB`;

/**
 * 탭 셋. `state` 는 **지금 이 저장소에 그 화면이 있는가**다 — 구성안에서 가장
 * 중요한 정보이고, 안 적으면 셋 다 있는 것처럼 읽힌다.
 */
const TABS = [
  {
    id: 'done', order: 1, name: '완성 보고서',
    sub: '만들어진 산출물 목록',
    state: 'none',
    stateText: '아직 없다 — API 는 있고 그리는 화면이 없다',
    plan: 'Pro',
  },
  {
    id: 'make', order: 2, name: '새 보고서 생성',
    sub: '외부 엔진(IM Agent) 4단계',
    state: 'have',
    stateText: '있다 — report-flow.html',
    plan: 'Pro',
  },
  {
    id: 'files', order: 3, name: '자료',
    sub: '프로젝트별 자료 보관',
    state: 'move',
    stateText: '옮겨 온다 — intake.html 의 자료 부분',
    plan: '무료 (등급별 용량)',
  },
];

const STATE_LABEL = { have: '있다', none: '아직 없다', move: '옮겨 온다' };

/* ────────────────────────── 탭 안에 들어가는 것 ────────────────────────── */

function doneBody() {
  const rows = api.OUTPUTS.map(o => `
    <li class="doc">
      <span class="doc__n">${esc(o.name)}</span>
      <code class="doc__p">${esc(o.rel)}</code>
    </li>`).join('');
  return `
  <p class="body__lede">한 프로젝트에서 나올 수 있는 산출물 <b>${api.OUTPUTS.length}종</b>입니다.
    목록은 <b>파일이 실제로 있는지로</b> 판정합니다 — 「생성됨」 표시를 믿지 않습니다.</p>
  <p class="stamp">아래는 <b>예시 목록</b>입니다. 프로젝트를 물리지 않았으므로 상태 표시는 비어 있습니다.</p>
  <ul class="docs">${rows}</ul>
  <p class="body__note"><b>이름에 「감정평가서」·「평가의견서」를 쓰지 않습니다.</b>
    목록에서 그렇게 보이면 받는 사람이 정식 평가로 읽습니다 — 문서 안에 다섯 곳으로 박아 둔 고지와 같은 이유입니다.</p>`;
}

function makeBody() {
  const steps = FLOW.STEPS.map(s => `
    <li class="step">
      <span class="step__n">${s.no}</span>
      <div>
        <div class="step__t">${esc(s.name)}</div>
        <p class="step__d">${esc(s.note)}</p>
      </div>
    </li>`).join('');
  return `
  <p class="body__lede">지금의 <b>4단계 화면이 통째로 이 탭의 내용</b>이 됩니다.
    화면 자체는 손대지 않고, <b>자체 <code>&lt;h1&gt;</code> 만 뺍니다</b> — 탭 바가 이미 이름을 말하므로
    그대로 얹으면 제목이 두 번 나옵니다.</p>
  <ol class="steps">${steps}</ol>
  <p class="body__note">이 넷은 실제로 눌러 볼 수 있는 미리보기가 따로 있습니다
    (<code>section-preview.html</code>). 여기서는 <b>탭 안의 어느 자리에 놓이는지</b>만 보입니다.</p>`;
}

function filesBody() {
  const groups = ex.readGroups().map(g => `
    <div class="fmt">
      <div class="fmt__t">${esc(g.label)}${g.needsKey ? ' <span class="tag tag--warn">키 필요</span>' : ''}</div>
      <div class="fmt__e">${g.ext.map(e => `<code>${esc(e)}</code>`).join('')}</div>
    </div>`).join('');

  return `
  <p class="body__lede">보고서를 만들지 않아도 <b>자료를 먼저 올려 두는 자리</b>입니다.
    지금은 보고서 생성을 시작해야만 자료를 올릴 수 있어 순서가 거꾸로입니다 —
    실무에서 자료는 보고서보다 먼저 모이고 <b>더 오래 삽니다</b>.</p>

  <div class="callout callout--rule">
    <div class="callout__t">여기서 숫자를 넣지 않습니다</div>
    <p>출처 없는 숫자를 막는 검사(출처 필수 · 계산 항목 입력 금지 · 사양 확정)는
      <b>보고서 생성 안에</b> 있습니다. 이 탭은 <b>파일만</b> 받고, 값을 뽑는 것은 지금과 똑같이
      보고서 생성이 하며 같은 검사를 그대로 지납니다.</p>
  </div>

  <div class="grid2">
    <section class="pane">
      <h4 class="pane__t">올릴 수 있는 자료</h4>
      ${groups}
      <div class="limits">
        <span>파일 하나 <b>${mb(api.MAX_FILE_BYTES)}</b></span>
        <span>한 번에 <b>${mb(api.MAX_REQUEST_BYTES)}</b></span>
      </div>
      <p class="pane__n">이 블록은 <b>지우는 것이 아니라 옮기는 것</b>입니다 —
        크기 한도를 <b>미리</b> 알려 주는 자리가 지금은 여기뿐입니다.</p>
    </section>

    <section class="pane">
      <h4 class="pane__t">보관 용량</h4>
      <table class="cap">
        <thead><tr><th>등급</th><th>상한</th><th>넘으면</th></tr></thead>
        <tbody>
          <tr><td>무료</td><td class="und">미정</td><td>업로드 차단<span class="cap__s">기존 자료는 그대로</span></td></tr>
          <tr><td>Pro</td><td class="und">미정</td><td>별도 계산<span class="cap__s">10GB 블록</span></td></tr>
          <tr><td>Biz</td><td class="und">추후 예정</td><td>별도 계산<span class="cap__s">임시 적용 중엔 알림만</span></td></tr>
        </tbody>
      </table>
      <p class="pane__n"><b class="und">미정</b>은 아직 숫자가 없다는 뜻입니다.
        정해지기 전에는 이 표가 화면에 이대로 뜨면 안 됩니다.</p>

      <h4 class="pane__t pane__t--2">보관하는 동안</h4>
      <ul class="vault">
        <li><b>덮어쓰지 않습니다</b> — 같은 이름이면 이전 판이 휴지통으로</li>
        <li><b>지우면 휴지통까지만</b> — 되돌릴 수 있습니다</li>
        <li><b>바뀌면 대조에서 잡힙니다</b> — 저장할 때 남긴 해시로</li>
        <li>휴지통을 비우려면 <b>며칠 지난 것인지</b>를 지정해야 합니다</li>
      </ul>
      <p class="pane__n">서버 쪽은 <b>이미 동작합니다</b> (<code>core/vault.js</code>).
        이 탭은 그것을 <b>보여 주는 화면</b>입니다.</p>
    </section>
  </div>`;
}

const BODIES = { done: doneBody, make: makeBody, files: filesBody };

/* ────────────────────────── 화면 ────────────────────────── */

/** 왼쪽 레일 — 본체 플랫폼의 기능 목록. 어디에 얹히는지 보이라고 둔다 */
const RAIL = ['할일', '연락처', '프로젝트', '캘린더', 'Q&A', '투자소스 DB']
  .map(n => `<span class="rail__i">${esc(n)}</span>`).join('')
  + '<span class="rail__i rail__i--on">보고서</span>';

function appMock() {
  // ★ 라디오는 `.tabs` **밖**에 둔다. 안에 넣으면 `~` 로 닿지 못해 탭이 안 바뀐다
  const radios = TABS.map((t, i) => `
    <input class="sr" type="radio" name="tab" id="tab-${t.id}"${i === 0 ? ' checked' : ''}>`).join('');
  const tabs = TABS.map(t => `
      <label class="tab tab--${t.id}" for="tab-${t.id}">
        <span class="tab__n">${esc(t.name)}</span>
        <span class="tab__s">${esc(t.sub)}</span>
        <span class="dot dot--${t.state}" title="${esc(STATE_LABEL[t.state])}"></span>
      </label>`).join('');

  const bodies = TABS.map(t => `
    <section class="body body--${t.id}">
      <header class="body__h">
        <div>
          <h3 class="body__t">${esc(t.name)}</h3>
          <p class="body__st"><span class="dot dot--${t.state}"></span>${esc(t.stateText)}</p>
        </div>
        <span class="plan">${esc(t.plan)}</span>
      </header>
      ${BODIES[t.id]()}
    </section>`).join('');

  return `
<div class="app">
  <aside class="rail"><span class="rail__b">LINKPILOT</span>${RAIL}</aside>
  <div class="main">
    <div class="crumb">보고서</div>
    ${radios}
    <div class="tabs">${tabs}
    </div>
    <div class="bodies">${bodies}</div>
  </div>
</div>`;
}

/* ────────────────────────── CSS ────────────────────────── */

/**
 * ★ 두 세계가 섞여 있다.
 *   ① **바깥 문서**(설명·판단)는 여는 사람의 테마를 따른다.
 *   ② **안쪽 앱 그림**은 제품과 같은 밝은 판으로 못 박는다 — 제품이 밝은 화면이라,
 *      다크에서 색을 뒤집으면 실제와 다른 그림을 보여 주게 된다.
 *   그래서 ②는 자기 배경·글자색을 **전부 직접** 칠한다 (물려받지 않는다).
 */
const CSS = `
:root {
  --ground: #F4F5F7; --surface: #FFFFFF; --ink: #17181A; --ink2: #6E757D;
  --line: #E3E6E9; --line2: #EDEFF1;
  --lime: #9ED700; --lime-deep: #4E6900; --lime-soft: #EFF8DA;
  --warn: #D08A1C; --warn-soft: #FCF3E2; --warn-ink: #7A5008;
  --blue: #3F63A8; --blue-soft: #EAEFF8; --blue-ink: #2B457A;
  --red: #C92A2A; --red-soft: #FCECEC;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #131517; --surface: #1B1E21; --ink: #E9ECEE; --ink2: #98A0A8;
    --line: #2B3036; --line2: #23272B;
    --lime: #A9E20B; --lime-deep: #C9F04A; --lime-soft: #26320B;
    --warn: #D9A13E; --warn-soft: #33270F; --warn-ink: #E7BE72;
    --blue: #7C9AD4; --blue-soft: #1B2333; --blue-ink: #9DB6E4;
    --red: #E86A6A; --red-soft: #331A1A;
  }
}
:root[data-theme="dark"] {
  --ground: #131517; --surface: #1B1E21; --ink: #E9ECEE; --ink2: #98A0A8;
  --line: #2B3036; --line2: #23272B;
  --lime: #A9E20B; --lime-deep: #C9F04A; --lime-soft: #26320B;
  --warn: #D9A13E; --warn-soft: #33270F; --warn-ink: #E7BE72;
  --blue: #7C9AD4; --blue-soft: #1B2333; --blue-ink: #9DB6E4;
  --red: #E86A6A; --red-soft: #331A1A;
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--ground); color: var(--ink);
  font: 400 15px/1.65 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
        'Malgun Gothic', 'Noto Sans KR', Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
}
.wrap { max-width: 1080px; margin: 0 auto; padding: 34px 20px 90px; }

.eyebrow {
  font: 700 11.5px/1 inherit; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink2); margin: 0 0 10px;
}
h1 { font-size: 30px; font-weight: 800; letter-spacing: -.02em; margin: 0 0 10px; text-wrap: balance; }
.lede { color: var(--ink2); font-size: 15px; margin: 0; max-width: 60ch; }

.draft {
  display: flex; gap: 12px; align-items: flex-start;
  margin: 22px 0 26px; padding: 14px 16px; border-radius: 12px;
  background: var(--warn-soft); color: var(--warn-ink);
  border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
  font-size: 13.5px; line-height: 1.6;
}
.draft b { color: inherit; }

/* ── 앱 그림 — 제품과 같은 밝은 판으로 못 박는다 ───────────────── */
.frame {
  border-radius: 16px; overflow: hidden;
  border: 1px solid var(--line);
  box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 12px 32px -18px rgba(0,0,0,.35);
}
.app {
  display: grid; grid-template-columns: 178px 1fr;
  background: #F5F6F8; color: #17181A;
  font: inherit;
}
.rail {
  display: flex; flex-direction: column; gap: 2px;
  background: #FFFFFF; border-right: 1px solid #E8EAEC; padding: 16px 10px 22px;
}
.rail__b {
  font: 800 12px/1 inherit; letter-spacing: .14em; color: #17181A;
  padding: 4px 10px 14px;
}
.rail__i {
  font-size: 13px; color: #7C838C; padding: 7px 10px; border-radius: 8px;
}
.rail__i--on { background: #EDF7DC; color: #4E6900; font-weight: 700; }

.main { padding: 16px 18px 24px; min-width: 0; position: relative; }
.crumb { font: 700 12px/1 inherit; letter-spacing: .1em; color: #9AA1A9; text-transform: uppercase; }

/* 눈에는 안 보이되 **키보드로는 닿아야 한다.** display:none 이면 탭 이동이 끊긴다 */
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

.tabs { display: flex; gap: 6px; margin: 12px 0 0; border-bottom: 1px solid #E8EAEC; }
.tab {
  display: flex; flex-direction: column; gap: 2px; position: relative;
  padding: 11px 15px 12px; border-radius: 10px 10px 0 0; cursor: pointer;
  border: 1px solid transparent; border-bottom: 0; margin-bottom: -1px;
  background: transparent; min-width: 0;
}
.tab__n { font: 700 14px/1.3 inherit; color: #5C646D; }
.tab__s { font: 400 11.5px/1.3 inherit; color: #9AA1A9; }
.tab:hover .tab__n { color: #17181A; }
.tab .dot { position: absolute; top: 9px; right: 9px; }

/* 라디오로 고른 탭만 살아난다 (스크립트를 못 쓰는 자리다) */
#tab-done:checked ~ .tabs label[for="tab-done"],
#tab-make:checked ~ .tabs label[for="tab-make"],
#tab-files:checked ~ .tabs label[for="tab-files"] {
  background: #FFFFFF; border-color: #E8EAEC;
}
#tab-done:checked ~ .tabs label[for="tab-done"] .tab__n,
#tab-make:checked ~ .tabs label[for="tab-make"] .tab__n,
#tab-files:checked ~ .tabs label[for="tab-files"] .tab__n { color: #17181A; }
#tab-done:checked ~ .tabs label[for="tab-done"]::after,
#tab-make:checked ~ .tabs label[for="tab-make"]::after,
#tab-files:checked ~ .tabs label[for="tab-files"]::after {
  content: ''; position: absolute; left: 12px; right: 12px; bottom: -1px; height: 2px;
  background: #9ED700; border-radius: 2px;
}
/* 키보드로 옮길 때 어느 탭에 있는지 보여야 한다 */
#tab-done:focus-visible ~ .tabs label[for="tab-done"],
#tab-make:focus-visible ~ .tabs label[for="tab-make"],
#tab-files:focus-visible ~ .tabs label[for="tab-files"] {
  outline: 2px solid #4E6900; outline-offset: 2px;
}

.bodies { background: #FFFFFF; border: 1px solid #E8EAEC; border-top: 0;
  border-radius: 0 0 12px 12px; padding: 20px 22px 24px; }
.body { display: none; }
#tab-done:checked ~ .bodies .body--done,
#tab-make:checked ~ .bodies .body--make,
#tab-files:checked ~ .bodies .body--files { display: block; }

.body__h { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 14px; padding-bottom: 14px; border-bottom: 1px solid #EDEFF1; margin-bottom: 16px; }
.body__t { font: 800 19px/1.3 inherit; margin: 0; letter-spacing: -.01em; color: #17181A; }
.body__st { display: flex; align-items: center; gap: 7px; margin: 5px 0 0;
  font-size: 12.5px; color: #7C838C; }
.plan { flex: none; font: 700 11.5px/1 inherit; padding: 6px 10px; border-radius: 999px;
  background: #EDF7DC; color: #4E6900; white-space: nowrap; }

.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dot--have { background: #9ED700; }
.dot--none { background: #D08A1C; }
.dot--move { background: #3F63A8; }

.body__lede { margin: 0 0 14px; font-size: 14px; color: #3F464D; max-width: 62ch; }
.body__note { margin: 16px 0 0; padding-top: 13px; border-top: 1px solid #EDEFF1;
  font-size: 12.5px; color: #7C838C; max-width: 66ch; }
.body code { font: 500 12px/1.4 ${'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'};
  background: #F1F2F4; color: #4A5158; padding: 1.5px 5px; border-radius: 5px; }

.stamp { display: inline-block; margin: 0 0 12px; padding: 5px 10px; border-radius: 7px;
  background: #FCF3E2; color: #7A5008; font-size: 12px; }

/* 완성 보고서 */
.docs { list-style: none; margin: 0; padding: 0; display: grid;
  grid-template-columns: repeat(auto-fill, minmax(258px, 1fr)); gap: 7px; }
.doc { display: flex; flex-direction: column; gap: 3px;
  border: 1px solid #E8EAEC; border-radius: 10px; padding: 9px 12px; background: #FCFDFD; }
.doc__n { font: 600 13.5px/1.35 inherit; color: #17181A; }
.doc__p { font-size: 11.5px !important; background: transparent !important;
  color: #8B939B !important; padding: 0 !important; }

/* 새 보고서 생성 */
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.step { display: flex; gap: 12px; align-items: flex-start;
  border: 1px solid #E8EAEC; border-radius: 11px; padding: 12px 14px; background: #FCFDFD; }
.step__n { flex: none; width: 22px; height: 22px; border-radius: 50%; background: #17181A;
  color: #FFFFFF; display: grid; place-items: center; font: 800 12px/1 inherit; margin-top: 1px; }
.step__t { font: 700 14px/1.4 inherit; color: #17181A; }
.step__d { margin: 3px 0 0; font-size: 12.5px; color: #7C838C; line-height: 1.6; }

/* 자료 */
.callout { border-radius: 11px; padding: 13px 15px; margin: 0 0 16px; }
.callout--rule { background: #EDF7DC; border: 1px solid #D6E9A8; }
.callout__t { font: 700 13.5px/1.4 inherit; color: #3F5600; margin-bottom: 4px; }
.callout p { margin: 0; font-size: 13px; color: #4E6900; line-height: 1.65; }

.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(298px, 1fr)); gap: 14px; }
.pane { border: 1px solid #E8EAEC; border-radius: 12px; padding: 14px 16px 16px; background: #FCFDFD; }
.pane__t { font: 700 13px/1 inherit; letter-spacing: .02em; color: #17181A; margin: 0 0 11px; }
.pane__t--2 { margin-top: 20px; padding-top: 16px; border-top: 1px solid #EDEFF1; }
.pane__n { margin: 11px 0 0; font-size: 12px; color: #8B939B; line-height: 1.6; }

.fmt { margin-bottom: 10px; }
.fmt__t { font: 600 12.5px/1.4 inherit; color: #3F464D; margin-bottom: 5px; }
.fmt__e { display: flex; flex-wrap: wrap; gap: 4px; }
.fmt__e code { font-size: 11px !important; }
.tag { font: 700 10px/1 inherit; padding: 3px 6px; border-radius: 5px; vertical-align: 1px; }
.tag--warn { background: #FCF3E2; color: #7A5008; }

.limits { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.limits span { font-size: 12px; color: #5C646D; background: #F1F2F4; border-radius: 7px; padding: 5px 10px; }

.cap { width: 100%; border-collapse: collapse; font-size: 12.5px;
  font-variant-numeric: tabular-nums; }
.cap th { text-align: left; font: 700 11px/1 inherit; letter-spacing: .06em;
  text-transform: uppercase; color: #9AA1A9; padding: 0 8px 7px 0; }
.cap td { padding: 7px 8px 7px 0; border-top: 1px solid #EDEFF1; color: #3F464D; vertical-align: top; }
.cap__s { display: block; font-size: 11px; color: #9AA1A9; }
.und { color: #C92A2A; font-weight: 700; }

.vault { margin: 0; padding-left: 17px; font-size: 12.5px; color: #3F464D; line-height: 1.75; }
.vault li { margin-bottom: 2px; }

/* ── 바깥 문서 — 판단이 적히는 자리 ─────────────────────────── */
.after { margin-top: 34px; display: flex; flex-direction: column; gap: 16px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px;
  padding: 18px 20px 20px; }
.card__t { font: 800 16px/1.4 inherit; margin: 0 0 4px; letter-spacing: -.01em; }
.card__s { margin: 0 0 14px; font-size: 13px; color: var(--ink2); }
.card p { font-size: 13.5px; line-height: 1.7; margin: 0 0 10px; max-width: 68ch; }
.card p:last-child { margin-bottom: 0; }
.card code { font: 500 12px/1.4 var(--mono); background: var(--line2);
  color: var(--ink); padding: 1.5px 5px; border-radius: 5px; }

.key { display: grid; gap: 9px; }
.key__r { display: grid; grid-template-columns: 22px 1fr; gap: 11px; align-items: start;
  font-size: 13.5px; line-height: 1.65; }
.key__r .dot { margin-top: 7px; }

.todo { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.todo li { display: grid; grid-template-columns: 20px 1fr; gap: 11px;
  font-size: 13.5px; line-height: 1.65; }
.todo__b { width: 14px; height: 14px; margin-top: 4px; border-radius: 4px;
  border: 1.5px solid var(--red); }
.todo__b--ok { border-color: var(--lime); background: var(--lime); }

.order { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
.order__c { flex: 1 1 260px; border: 1px solid var(--line); border-radius: 11px; padding: 13px 15px; }
.order__t { font: 700 13px/1.4 inherit; margin-bottom: 8px; }
.order__l { display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  font-size: 12.5px; color: var(--ink2); }
.order__l b { font-weight: 700; color: var(--ink); background: var(--line2);
  border-radius: 6px; padding: 3px 8px; }
.order__n { margin: 9px 0 0; font-size: 12.5px; color: var(--ink2); line-height: 1.6; }

.foot { margin-top: 30px; font-size: 12.5px; color: var(--ink2); line-height: 1.7; }

@media (max-width: 720px) {
  .app { grid-template-columns: 1fr; }
  .rail { flex-direction: row; flex-wrap: wrap; border-right: 0; border-bottom: 1px solid #E8EAEC; }
  .tab__s { display: none; }
  h1 { font-size: 24px; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

/* ────────────────────────── 조립 ────────────────────────── */

function build() {
  return `<title>세 탭 구성안</title>
<style>${CSS}</style>
<div class="wrap">
  <p class="eyebrow">D-63 · 구성안</p>
  <h1>「자료」를 넣은 세 탭</h1>
  <p class="lede">「보고서」 안을 세 탭으로 나눕니다. 탭을 눌러 각 탭에 무엇이 들어가는지 보세요.</p>

  <div class="draft">
    <div>
      <b>구성안입니다 — 배포판이 아닙니다.</b> 탭 바 자체는 본체 플랫폼(NAS) 쪽이라 이 저장소에 없고,
      세 탭 중 <b>실제로 있는 화면은 하나</b>입니다. 목록·단계·형식·한도는 손으로 적은 것이 아니라
      실제 코드에서 그대로 가져왔습니다.
    </div>
  </div>

  <div class="frame">${appMock()}</div>

  <div class="after">
    <section class="card">
      <h2 class="card__t">점 세 개가 뜻하는 것</h2>
      <p class="card__s">구성안에서 가장 중요한 정보입니다. 안 적으면 셋 다 있는 것처럼 읽힙니다.</p>
      <div class="key">
        <div class="key__r"><span class="dot dot--have"></span>
          <div><b>있다</b> — <code>report-flow.html</code> 이 그대로 들어갑니다.
            자체 <code>&lt;h1&gt;</code> 만 빼면 됩니다.</div></div>
        <div class="key__r"><span class="dot dot--none"></span>
          <div><b>아직 없다</b> — <code>GET /projects/:id/reports</code> 는 있는데
            그것을 <b>그리는 화면이 없습니다</b>. 새로 만들어야 합니다.</div></div>
        <div class="key__r"><span class="dot dot--move"></span>
          <div><b>옮겨 온다</b> — <code>intake.html</code> 의 「올릴 수 있는 자료」 블록이 이리로 옵니다.
            <b>지우는 것이 아닙니다</b> — 형식 안내와 크기 한도는 자료를 올리는 자리에 그대로 필요합니다.</div></div>
      </div>
    </section>

    <section class="card">
      <h2 class="card__t">탭 순서 — 두 가지가 있습니다</h2>
      <p class="card__s">위 그림은 지시하신 순서입니다. 다른 순서를 한 번 적어 둔 적이 있어 함께 놓습니다.</p>
      <div class="order">
        <div class="order__c">
          <div class="order__t">지시하신 순서 <span class="tag tag--warn">위 그림</span></div>
          <div class="order__l"><b>완성 보고서</b>→<b>새 보고서 생성</b>→<b>자료</b></div>
          <p class="order__n">쓰는 빈도 순서입니다. 대개 <b>결과물을 보러</b> 들어오므로
            가장 자주 여는 것이 맨 앞에 옵니다.</p>
        </div>
        <div class="order__c">
          <div class="order__t">시간 순서 <span class="tag tag--warn">개정안 §3-2</span></div>
          <div class="order__l"><b>자료</b>→<b>새 보고서 생성</b>→<b>완성 보고서</b></div>
          <p class="order__n">일이 진행되는 순서입니다. 모으고 → 만들고 → 봅니다.
            <b>처음 쓰는 사람</b>에게는 이쪽이 다음에 무엇을 할지 알려 줍니다.</p>
        </div>
      </div>
      <p style="margin-top:12px">둘 중 하나를 <b>정해야 합니다.</b> 개정안에는 시간 순서로 적혀 있어
        지금 지시와 다릅니다 — <b>고르시면 개정안 §3-2 를 그 순서로 고칩니다.</b></p>
    </section>

    <section class="card">
      <h2 class="card__t">이 구성안이 나가기 전에 정해야 하는 것</h2>
      <p class="card__s">화면부터 만들면 협력사 손에 있는 지침과 또 갈립니다. 그래서 순서를 고정해 두었습니다.</p>
      <ul class="todo">
        <li><span class="todo__b"></span><div><b>탭 순서</b> — 위 두 가지 중 하나</div></li>
        <li><span class="todo__b"></span><div><b>무료·Pro 보관 용량 숫자</b> — 프로젝트당·계정 전체.
          지금 있는 한도는 파일 하나·한 번에 뿐이고 <b>누적 보관 용량은 없습니다</b></div></li>
        <li><span class="todo__b"></span><div><b>크론 이관처</b>(D-19) — 지침에서 사라진 기능을
          「이전 중」으로 쓸지 표에서 뺄지가 여기서 갈립니다</div></li>
        <li><span class="todo__b"></span><div><b>지침 재발행 판 날짜</b> — 현행 2026-08-14</div></li>
        <li><span class="todo__b todo__b--ok"></span><div><b>자료 탭 등급</b> — 무료부터 열고 등급별 용량 차등 <i>(정해짐)</i></div></li>
        <li><span class="todo__b todo__b--ok"></span><div><b>상한을 넘으면</b> — 무료는 차단, 유료는 별도 계산 <i>(정해짐)</i></div></li>
      </ul>
    </section>
  </div>

  <p class="foot">이 화면은 <code>im-agent/ui/platform/build-tabs.js</code> 가 만듭니다.
    산출물 목록·4단계·자료 형식·크기 한도는 실제 코드에서 읽어 오므로,
    코드가 바뀌면 <b>다시 만들 때 이 그림도 함께 바뀝니다</b>.</p>
</div>
`;
}

function main() {
  const i = process.argv.indexOf('--out');
  const out = (i > -1 && process.argv[i + 1]) || path.join(HERE, 'tabs-artifact.html');
  const html = build();

  // 못 올릴 조각을 올리면 옆 창이 **빈 채로** 열린다 — 올리기 전에 여기서 막는다
  const { publishable } = require('./build-static.js');
  const bad = publishable(html);
  if (bad.length) throw new Error('올릴 수 없는 조각이다 — ' + bad.join(' / '));

  fs.writeFileSync(out, html);
  console.log(`${out} (${Math.round(html.length / 1024)}KB) · 세 탭 구성안`);
}

if (require.main === module) main();

module.exports = { build, TABS, appMock };
