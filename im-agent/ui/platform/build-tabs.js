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
const storage = require(path.join(AGENT, 'connectors', 'storage'));

const esc = (t) => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const mb = (n) => `${Math.round(n / (1024 * 1024))}MB`;

/** 소스의 **강조 표시**는 화면에서 글자 그대로 뜬다. 떼고 넣는다 */
const plain = (t) => String(t).replace(/\*\*/g, '');

/**
 * 탭 셋. `state` 는 **지금 이 저장소에 그 화면이 있는가**다 — 구성안에서 가장
 * 중요한 정보이고, 안 적으면 셋 다 있는 것처럼 읽힌다.
 */
const TABS = [
  {
    // 이름은 flow-core.js 의 OUTPUTS_SECTION 이 단일 출처다
    id: 'done', order: 1, name: FLOW.OUTPUTS_SECTION.tab,
    sub: FLOW.OUTPUTS_SECTION.tabNote,
    state: 'have',
    stateText: '있다 — outputs.html (inTab: true 로 얹는다)',
    plan: 'Pro',
  },
  {
    // ★ 이름을 여기 적지 않는다. `flow-core.js` 의 SECTION 이 단일 출처다 —
    //   앱 탭 바도 거기서 읽어 가므로, 복사해 두면 한쪽만 고치는 날 갈린다
    id: 'make', order: 2, name: FLOW.SECTION.tab,
    sub: FLOW.SECTION.tabNote,
    state: 'have',
    stateText: '있다 — report-flow.html (inTab: true 로 얹는다)',
    plan: 'Pro',
  },
  {
    id: 'files', order: 3, name: '자료',
    sub: '연결하거나 1회성으로 올립니다',
    state: 'none',
    stateText: '아직 없다 — 서버 쪽(연결·1회성)은 있고 그리는 화면이 없다',
    plan: '무료',
  },
];

const STATE_LABEL = { have: '있다', none: '아직 없다', move: '옮겨 온다' };

/* ────────────────────────── 진행 막대 ────────────────────────── */

/**
 * 탭마다 맨 위에 놓는 진행 막대.
 *
 * ★ **막대 하나가 세는 것은 하나뿐이다.** 탭마다 세는 대상이 다르므로 `counts` 에
 *   무엇을 세는지 적고, 화면에도 분자/분모를 숫자로 함께 띄운다. % 만 띄우면
 *   「무엇의 몇 %」인지 사라지고, 그 상태로도 화면은 멀쩡해 보인다.
 *
 * ★ **분모가 없으면 막대를 그리지 않는다.** 자료 탭의 보관 용량이 그렇다 —
 *   등급별 상한이 미정이라 분모가 없는데, 없는 채로 막대를 그리면
 *   「거의 찼다」·「여유 있다」가 근거 없이 보인다.
 *
 * ★ 스크립트를 못 쓰는 자리라 상태 전환은 **라디오 + CSS** 로 한다.
 *   구성안에서는 그것이 오히려 낫다 — 보는 사람이 **각 구간의 문구를 직접 넘겨
 *   가며** 확인할 수 있다. 「진행율에 따라 무엇이 뜨는가」가 이 화면의 요점이다.
 */
const PROGRESS = {
  done: {
    counts: '이 프로젝트에서 나와야 하는 산출물 중 실제로 파일이 나온 것',
    note: '분모는 <b>11종 전부가 아니라 이 프로젝트에서 나와야 하는 것</b>입니다 — '
      + '언제나 나오는 것과, 사양의 형식에 들어간 것(PDF 등)까지. '
      + '<b>조건부 산출물(탁상검토·법인가치)은 분모에 넣지 않습니다</b>: 넣으면 어떤 딜도 100% 가 '
      + '되지 않아 <b>다 끝났는데도 덜 된 것처럼</b> 보입니다. 그렇다고 목록에서 빼지도 않습니다 — '
      + '빼면 「나올 수 있는 문서가 있었다」는 사실이 사라집니다. <b>분모는 서버가 줍니다</b>('
      + '<code>progress</code>) — 화면이 계산하면 산출물이 하나 늘 때 한쪽만 고치는 날 조용히 틀립니다.',
    states: [
      { id: 'a', tab: '시작 전', pct: 0, count: '0 / 7종',
        say: '아직 만든 것이 없습니다. 「새 보고서 생성」 탭에서 요청문과 자료를 넣으면 시작됩니다.' },
      { id: 'b', tab: '만드는 중', pct: 43, count: '3 / 7종', on: true,
        say: 'IM 원문·A4 인쇄본·뷰어 데이터가 나왔습니다. PDF·Teaser·검증·RED FLAG 는 아직입니다 — '
          + '<b>무엇이 남았는지와 그 이유가 목록에 함께 뜹니다.</b>' },
      { id: 'c', tab: '끝', pct: 100, count: '7 / 7종',
        say: '사양에 담은 것이 모두 나왔습니다. <b>내보내기 전에 배포 전 교차검증을 지나야 합니다</b> — '
          + '100% 는 「만들어졌다」이지 「보내도 된다」가 아닙니다.' },
    ],
  },
  make: {
    counts: '4단계 중 지나온 단계',
    ticks: 4,
    note: '이 막대가 세는 것은 <b>4단계 중 몇 단계를 지났는가</b> 하나뿐입니다. '
      + '단계 안의 진행(필수 칸을 몇 개 채웠는가·생성이 몇 % 돌았는가)은 <b>각 단계 화면이 따로</b> 보여 줍니다. '
      + '하나로 뭉치지 않는 이유는 <b>1·2 는 사람이 채우고 3 은 확정 여부이며 4 만 기계가 도는 구간</b>이라, '
      + '섞으면 무엇의 몇 % 인지 알 수 없기 때문입니다.',
    states: [
      { id: 'a', tab: '시작 전', pct: 0, count: '0 / 4단계',
        say: '요청문을 한 줄 적고 자료를 올리면 1단계가 끝납니다.' },
      { id: 'b', tab: '값 입력', pct: 50, count: '2 / 4단계', on: true,
        say: '값을 출처와 함께 채웠습니다. 3단계에서 페이지 수·형식·언어를 확정해야 <b>생성 버튼이 열립니다.</b>' },
      { id: 'c', tab: '사양 확정', pct: 75, count: '3 / 4단계',
        say: '사양을 확정했습니다(LOCK). 이제 「보고서 생성 시작」을 누를 수 있습니다.' },
      { id: 'd', tab: '생성 끝', pct: 100, count: '4 / 4단계',
        say: '생성이 끝났습니다. 나온 문서는 「완성 보고서」 탭에 있습니다.' },
    ],
  },
  files: {
    counts: '연결한 자료 중 지금도 그때 그 판인 것',
    note: '이 막대는 <b>연결이 살아 있는가</b>입니다 — 자료를 우리 서버에 두지 않으므로, '
      + '<b>원본이 바뀌었는지는 물어봐야만 압니다.</b> 안 물으면 문서는 그대로 멀쩡하고 근거만 사라집니다. '
      + '<b>보관 용량 막대는 만들지 않습니다</b> — 보관을 하지 않으니 잴 것이 없습니다.',
    states: [
      { id: 'a', tab: '연결 전', pct: 0, count: '0건',
        say: '아직 연결한 자료가 없습니다. Dropbox·Box·Google Drive·OneDrive 에서 <b>파일을 고르면</b> '
          + '여기 목록에 걸립니다 — <b>가져와 두지 않고 필요할 때만 읽습니다.</b>' },
      { id: 'b', tab: '원본이 바뀜', pct: 67, count: '6 / 9건', on: true,
        say: '3건은 <b>연결한 뒤 원본이 바뀌었습니다</b>(판 번호가 다릅니다). '
          + '지금 보고서를 다시 만들면 <b>그때와 다른 값이 나옵니다</b> — 바뀐 3건을 확인하고 새 판으로 다시 거세요.' },
      { id: 'c', tab: '전부 그대로', pct: 100, count: '9 / 9건',
        say: '연결한 자료가 모두 읽었을 때 그대로입니다. 보고서의 숫자와 원본이 어긋나 있지 않습니다.' },
    ],
  },
};

/** 진행 막대 한 벌. `tabId` 로 라디오 이름을 갈라 탭끼리 간섭하지 않게 한다 */
function progressBlock(tabId) {
  const p = PROGRESS[tabId];
  const n = (s) => `p-${tabId}-${s.id}`;

  const radios = p.states.map(s =>
    `<input class="sr" type="radio" name="p-${tabId}" id="${n(s)}"${s.on ? ' checked' : ''}>`).join('');

  const picker = p.states.map(s =>
    `<label class="pick" for="${n(s)}">${esc(s.tab)}</label>`).join('');

  const ticks = p.ticks
    ? `<span class="bar__ticks">${Array.from({ length: p.ticks - 1 },
      (_, i) => `<i style="left:${((i + 1) / p.ticks * 100).toFixed(4)}%"></i>`).join('')}</span>`
    : '';

  const says = p.states.map(s =>
    `<p class="say say--${s.id}">${s.say}</p>`).join('');

  return `
  <div class="prog">
    ${radios}
    <div class="prog__h">
      <span class="prog__l">진행</span>
      <span class="prog__d"><span class="prog__dl">보기</span>${picker}</span>
    </div>
    <div class="bar">${ticks}<span class="bar__f"></span></div>
    <div class="prog__n">
      <b class="pct"></b>
      <span class="cnt"></span>
      <span class="of">${esc(p.counts)}</span>
    </div>
    <div class="says">${says}</div>
    <p class="prog__note">${p.note}</p>
  </div>`;
}

/** 상태마다 막대 너비·숫자·문구를 갈아 끼우는 규칙 (스크립트를 못 쓴다) */
function progressCss() {
  return Object.keys(PROGRESS).map((tabId) => {
    const p = PROGRESS[tabId];
    return p.states.map((s) => {
      const sel = `#p-${tabId}-${s.id}:checked`;
      return [
        `${sel} ~ .bar .bar__f { width: ${s.pct}%; }`,
        `${sel} ~ .prog__n .pct::after { content: '${s.pct}%'; }`,
        `${sel} ~ .prog__n .cnt::after { content: '${s.count}'; }`,
        `${sel} ~ .says .say--${s.id} { display: block; }`,
        `${sel} ~ .prog__h label[for="p-${tabId}-${s.id}"] { background: #17181A; color: #FFFFFF; border-color: #17181A; }`,
        `${sel}:focus-visible ~ .prog__h label[for="p-${tabId}-${s.id}"] { outline: 2px solid #4E6900; outline-offset: 2px; }`,
        s.pct === 0 ? `${sel} ~ .bar .bar__f { background: #D8DCE0; }` : '',
      ].filter(Boolean).join('\n');
    }).join('\n');
  }).join('\n');
}

/* ────────────────────────── 탭 안에 들어가는 것 ────────────────────────── */

function doneBody() {
  const rows = api.OUTPUTS.map(o => `
    <li class="doc">
      <span class="doc__n">${esc(o.name)}</span>
      <code class="doc__p">${esc(o.rel)}</code>
    </li>`).join('');
  return `
  <p class="body__lede">한 프로젝트에서 나올 수 있는 산출물 <b>${api.OUTPUTS.length}종</b>입니다.
    목록은 <b>파일이 실제로 있는지로</b> 판정합니다 — 「생성됨」 표시를 믿지 않습니다.
    화면(<code>outputs.html</code>)은 이 목록을 <b>나온 것 · 아직 안 나온 것 ·
    이 딜에서는 안 나오는 것</b> 셋으로 나눠 보여 줍니다.</p>

  <div class="callout callout--rule">
    <div class="callout__t">100% 는 「보내도 된다」가 아닙니다</div>
    <p>다 나왔다고 배포해도 되는 것이 아닌데 목록이 꽉 차 보이면 그대로 내보냅니다.
      그래서 <b>배포 차단을 목록보다 위</b>에 띄우고, 차단이면 <b>내려받기 자체를 열지 않습니다</b> —
      목록에서는 「차단」인데 파일은 열린다면 검증이 아무 의미도 없습니다.</p>
  </div>
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
    화면 자체는 손대지 않고 설정 한 줄(<code>inTab: true</code>)만 켭니다 —
    그러면 <b>자체 제목을 그리지 않습니다.</b> 탭 바가 이미 이름을 말하므로
    끄지 않으면 「${esc(FLOW.SECTION.tab)}」 아래에 「${esc(FLOW.SECTION.title)}」이 또 나옵니다.</p>

  <div class="callout callout--rule">
    <div class="callout__t">이 탭은 지금 붙일 수 있습니다</div>
    <p>지침 §2 에 <b>「보고서 생성 (Pro)」</b> 로 이미 배포되어 있어 <b>지침을 고치지 않아도 됩니다.</b>
      새로 지침에 실어야 하는 것은 <b>「자료」 탭 하나뿐</b>입니다 — 그것만 재발행을 기다립니다.</p>
  </div>
  <ol class="steps">${steps}</ol>
  <p class="body__note">이 넷은 실제로 눌러 볼 수 있는 미리보기가 따로 있습니다
    (<code>section-preview.html</code>). 여기서는 <b>탭 안의 어느 자리에 놓이는지</b>만 보입니다.</p>`;
}

function filesBody() {
  const providers = storage.REGISTRATION.map(r => `
    <div class="prov">
      <div class="prov__n">${esc(r.name)}
        <span class="tag ${r.verifiable ? 'tag--ok' : 'tag--warn'}">${r.verifiable ? '서버가 막습니다' : '사람이 확인합니다'}</span>
      </div>
      <div class="prov__s">${esc(plain(r.checklist))}</div>
    </div>`).join('');

  const groups = ex.readGroups().map(g => `
    <div class="fmt">
      <div class="fmt__t">${esc(g.label)}${g.needsKey ? ' <span class="tag tag--warn">키 필요</span>' : ''}</div>
      <div class="fmt__e">${g.ext.map(e => `<code>${esc(e)}</code>`).join('')}</div>
    </div>`).join('');

  return `
  <p class="body__lede">자료를 넣는 길이 <b>둘</b>입니다. 둘 다 <b>무료</b>이고, 둘 다
    <b>보관하지 않습니다.</b></p>

  <div class="ways">
    <section class="way way--link">
      <div class="way__h"><span class="way__n">① 저장소 연결</span><span class="tag tag--ok">권합니다</span></div>
      <p class="way__d">쓰시던 Dropbox·Box·Google Drive·OneDrive 를 연결합니다.
        <b>값을 읽어야 할 때만 가져와 읽고 곧바로 지웁니다.</b> 자료는 계속 사용자의 저장소에 있습니다.</p>
      <p class="way__g">원본이 사용자 저장소에 남아 있어 <b>나중에 다시 읽고 대조할 수 있습니다.</b>
        보고서를 다시 만들 때도 다시 올릴 필요가 없습니다.</p>
    </section>

    <section class="way way--once">
      <div class="way__h"><span class="way__n">② 직접 올리기 (1회성)</span><span class="tag tag--warn">보관하지 않습니다</span></div>
      <p class="way__d">저장소를 안 쓰셔도 자료를 넣을 수 있습니다. 받아서 <b>그 자리에서 읽고
        파일은 버립니다</b> — 지문(sha256)과 이름·읽은 시각만 남습니다.</p>
      <p class="way__b">대가 — <b>보고서를 다시 만들려면 다시 올려야 합니다.</b>
        그리고 <b>나중에 원본과 대조할 수 없습니다</b>: 우리도 원본을 갖고 있지 않고
        어디 있는지도 모릅니다. 이것은 올리기 <b>전에</b> 알려 드립니다.</p>
    </section>
  </div>

  <div class="callout callout--rule">
    <div class="callout__t">보관하지 않는 대신 무엇을 남기는가</div>
    <p>파일은 안 남기지만 <b>어디서·어느 판을·언제 읽었는지와 그때의 지문(sha256)</b>은 남깁니다.
      그것이 없으면 나중에 「이 숫자 어디서 나왔나」에 답할 수 없습니다 —
      <b>원본은 언제든 바뀌거나 사라질 수 있고, 그때 문서에는 아무 표시도 안 남습니다.</b>
      출처에 두 길이 <b>다르게</b> 찍힙니다: 연결은 「사본 보관 안 함」,
      1회성은 「사본 보관 안 함 · <b>원본 재확인 불가</b>」.</p>
  </div>

  <div class="grid2">
    <section class="pane">
      <h4 class="pane__t">연결 등록 — 범위는 폴더까지만</h4>
      ${providers}
      <p class="pane__n"><b>자료 몇 건 때문에 드라이브 전체를 읽는 권한을 받지 않습니다.</b>
        넓게 받아도 <b>동작은 똑같아서</b> 잘못 등록한 것이 증상으로 드러나지 않습니다 —
        Google·OneDrive 는 서버가 토큰 범위를 보고 <b>넓으면 연결을 거절</b>하고,
        Dropbox·Box 는 범위가 토큰에 안 실려 <b>등록 화면에서 사람이 확인</b>해야 합니다.</p>

      <h4 class="pane__t pane__t--2">읽을 수 있는 형식</h4>
      ${groups}
      <p class="pane__n">형식 제한은 <b>두 길 모두 같습니다</b> — 우리가 읽는 방법이 없는 파일은
        어디서 오든 읽지 못합니다. 크기 한도(파일 하나 ${mb(api.MAX_FILE_BYTES)} ·
        한 번에 ${mb(api.MAX_REQUEST_BYTES)})는 <b>직접 올리는 경우에만</b> 걸립니다.</p>
    </section>

    <section class="pane">
      <h4 class="pane__t">여기서 숫자를 넣지 않습니다</h4>
      <p class="pane__x">출처 없는 숫자를 막는 검사(출처 필수 · 계산 항목 입력 금지 · 사양 확정)는
        <b>보고서 생성 안에</b> 있습니다. 이 탭은 <b>파일만</b> 받고, 값을 뽑는 것은 지금과 똑같이
        보고서 생성이 하며 같은 검사를 그대로 지납니다.</p>

      <h4 class="pane__t pane__t--2">넣은 뒤에 일어나는 일</h4>
      <ul class="vault">
        <li><b>연결만으로는 아무것도 가져오지 않습니다</b> — 목록에 걸릴 뿐입니다</li>
        <li>읽을 때만 가져오고 <b>끝나면 지웁니다</b> — 지웠다는 것도 기록에 남깁니다</li>
        <li><b>연결한 원본이 바뀌면 대조에서 잡힙니다</b> — 판 번호와 지문을 남겨 뒀기 때문입니다</li>
        <li><b>1회성으로 올린 것은 대조할 수 없습니다</b> — 견줄 원본이 없습니다</li>
        <li><b>연결을 끊어도 원본은 그대로</b>입니다 — 남의 드라이브를 지우지 않습니다</li>
        <li>넣으신 원본을 <b>우리가 다시 배포하지 않습니다</b> — 읽을 권한만 받았습니다</li>
      </ul>
      <p class="pane__n">서버 쪽은 <b>이미 동작합니다</b> (<code>core/linked.js</code> ·
        <code>core/oneshot.js</code> · <code>connectors/storage.js</code>).
        이 탭은 그것을 <b>보여 주는 화면</b>입니다.</p>
    </section>
  </div>

  <p class="body__note"><b>등급 — 자료는 무료입니다.</b> 잠그지 않는 이유는 하나입니다:
    <b>자료를 못 넣으면 보고서를 만들 수도 없습니다.</b>
    보관 용량으로 가르기로 했던 것(D-63)은 <b>없앴습니다</b> — 보관을 하지 않으므로 잴 것이 없습니다.</p>`;
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
      ${progressBlock(t.id)}
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

/* ── 진행 막대 ────────────────────────────────────────────── */
.prog { border: 1px solid #E8EAEC; border-radius: 12px; padding: 14px 16px 15px;
  background: #FCFDFD; margin: 0 0 18px; position: relative; }
.prog__h { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 9px; }
.prog__l { font: 700 11px/1 inherit; letter-spacing: .1em; text-transform: uppercase; color: #8B939B; }
.prog__d { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.prog__dl { font: 400 11px/1 inherit; color: #A6ADB4; margin-right: 2px; }
.pick { font: 600 11.5px/1 inherit; padding: 5px 9px; border-radius: 999px; cursor: pointer;
  border: 1px solid #E0E3E6; background: #FFFFFF; color: #5C646D; white-space: nowrap; }
.pick:hover { border-color: #B9C0C7; color: #17181A; }

.bar { position: relative; height: 9px; border-radius: 999px; background: #E8EAEC; overflow: hidden; }
.bar__f { display: block; height: 100%; width: 0; border-radius: 999px; background: #9ED700; }
.bar__ticks { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.bar__ticks i { position: absolute; top: 0; bottom: 0; width: 1px; background: #FFFFFF; opacity: .85; }

.prog__n { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; margin-top: 9px; }
.pct { font: 800 21px/1 inherit; color: #17181A; font-variant-numeric: tabular-nums;
  letter-spacing: -.01em; }
.cnt { font: 600 13px/1 inherit; color: #4E6900; background: #EDF7DC;
  border-radius: 6px; padding: 4px 8px; font-variant-numeric: tabular-nums; }
.of { font-size: 12px; color: #8B939B; }

/* 진행율에 따라 문구가 바뀐다 — 고른 것 하나만 뜬다 */
.says { margin-top: 11px; }
.say { display: none; margin: 0; font-size: 13.5px; line-height: 1.7; color: #3F464D; max-width: 66ch; }
.say b { color: #17181A; }
.prog__note { margin: 11px 0 0; padding-top: 10px; border-top: 1px solid #EDEFF1;
  font-size: 12px; line-height: 1.65; color: #8B939B; max-width: 72ch; }
.prog__note b { color: #5C646D; }

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
.tag--ok { background: #EDF7DC; color: #4E6900; }

/* 연결할 저장소 */
.prov { padding: 9px 0; border-top: 1px solid #EDEFF1; }
.prov:first-of-type { border-top: 0; padding-top: 0; }
.prov__n { font: 700 13px/1.4 inherit; color: #17181A; }
.prov__s { font-size: 12px; color: #7C838C; line-height: 1.6; margin-top: 2px; }

/* 자료를 넣는 두 길 — 대가가 다르므로 눈에 띄게 다르다 */
.ways { display: grid; grid-template-columns: repeat(auto-fit, minmax(298px, 1fr)); gap: 12px; margin: 0 0 16px; }
.way { border: 1px solid #E8EAEC; border-radius: 12px; padding: 13px 15px 14px; background: #FCFDFD; }
.way--once { border-color: #F0DEBE; background: #FDF9F1; }
.way__h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 7px; }
.way__n { font: 700 14px/1.4 inherit; color: #17181A; }
.way p { margin: 0 0 7px; font-size: 12.5px; line-height: 1.7; }
.way p:last-child { margin-bottom: 0; }
.way__d { color: #3F464D; }
.way__g { color: #4E6900; }
.way__b { color: #7A5008; }
.pane__x { margin: 0; font-size: 12.5px; line-height: 1.7; color: #4A5158; }

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
<style>${CSS}
${progressCss()}</style>
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
        <li><span class="todo__b"></span><div><b>저장소 앱 등록 실행</b> — Dropbox·Box·Google·Microsoft
          콘솔에서 각각 앱을 만듭니다. <b>범위는 폴더까지만</b>으로 정했고, 무엇을 골라야 하는지는
          위 「연결 등록」 칸에 저장소마다 적혀 있습니다</div></li>
        <li><span class="todo__b"></span><div><b>OAuth 흐름·실제 내려받기</b> — 본체 플랫폼이 넣습니다.
          토큰이 거기 있고, 이 저장소로 가져오면 <b>공개 저장소에 시크릿이 붙는 셈</b>입니다</div></li>
        <li><span class="todo__b"></span><div><b>크론 이관처</b>(D-19) — 지침에서 사라진 기능을
          「이전 중」으로 쓸지 표에서 뺄지가 여기서 갈립니다</div></li>
        <li><span class="todo__b"></span><div><b>지침 재발행 판 날짜</b> — 현행 2026-08-14</div></li>
        <li><span class="todo__b todo__b--ok"></span><div><b>자료를 보관하지 않는다</b> — 사용자 저장소를
          연결해 읽을 때만 가져온다 <i>(정해짐)</i></div></li>
        <li><span class="todo__b todo__b--ok"></span><div><b>연결 범위는 폴더까지만</b> — 드라이브 전체
          권한을 받지 않는다 <i>(정해짐)</i></div></li>
        <li><span class="todo__b todo__b--ok"></span><div><b>직접 올리는 길을 남긴다 (1회성)</b> — 저장소를
          안 쓰는 사람도 넣을 수 있게. 받아서 읽고 파일은 버린다 <i>(정해짐)</i></div></li>
        <li><span class="todo__b todo__b--ok"></span><div><b>자료는 무료</b> — 용량으로 가르지 않는다
          (보관을 안 하므로 잴 것이 없다) <i>(정해짐)</i></div></li>
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

module.exports = { build, TABS, PROGRESS, appMock, progressBlock, progressCss };
