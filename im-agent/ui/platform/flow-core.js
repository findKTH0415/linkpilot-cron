/**
 * flow-core.js — 보고서 생성 **4단계의 단일 출처**.
 *
 * 이 목록이 두 벌이 되면 제품 화면과 미리보기가 서로 다른 흐름을 보여준다.
 * 그래서 `report-flow.html`(제품)과 `build-preview.js`(미리보기)가 **둘 다
 * 여기를 읽는다.** 단계를 늘리거나 순서를 바꾸려면 이 파일만 고친다.
 *
 * ★ 순서가 곧 강제 흐름이다. 앞 단계를 건너뛸 수 없다 —
 *   프로젝트가 없으면 값을 넣을 곳이 없고, 사양이 확정되기 전에는 생성이 열리지 않는다.
 *
 * ★ 3·4 는 **같은 화면의 서로 다른 상태**다 (확정 전 / 확정 후).
 *   파일을 나누면 확정 버튼이 두 곳에 생기고, 그때부터 어느 쪽이 진짜인지 모른다.
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 동작한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotFlow = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STEPS = [
    {
      id: 'intake', no: 1, name: '보고서 생성 입력', file: 'intake.html',
      needsProject: false,
      note: '요청문과 원본 자료를 받는다. 지원하지 않는 형식은 올리기 전에 막고, '
        + '요청문에서 뽑은 값은 미확인으로 표시한다.',
    },
    {
      id: 'fields', no: 2, name: '가이드 필드 (자동입력 + 직접입력)', file: 'fields.html',
      needsProject: true,
      // ★★ **이름에 「자동입력 + 직접입력」을 박는다** 〈2026-08-20 사용자 지시〉.
      //   전에는 「가이드 필드 입력」이라 **전부 손으로 치는 칸**으로 읽혔다.
      //   실제로는 올린 자료를 훑어 채울 수 있는 것은 채우고, 못 채운 것만 묻는다.
      //   그 사실을 이름에서 말하지 않으면 사용자는 자료를 올릴 이유를 모른다.
      note: '올린 자료를 훑어 채울 수 있는 값은 **자동으로 채우고**, 못 채운 것만 '
        + '직접 받는다. 출처가 없으면 저장 버튼이 열리지 않고, 계산 항목은 입력란을 '
        + '만들지 않는다. 자동으로 채워지는 줄에는 출처를 묻지 않는다.',
    },
    {
      id: 'spec', no: 3, name: '출력조건', file: 'reports.html',
      needsProject: true,
      note: '페이지 수·형식·언어를 사람이 못 박는다. 확정 전에는 생성 버튼이 열리지 않는다.',
    },
    {
      id: 'make', no: 4, name: '생성', file: 'reports.html', after: 'CONFIRM_SPEC',
      needsProject: true,
      note: '확정(LOCK) 뒤의 화면이다. 3단계와 같은 화면이며, 확정을 누르면 여기로 바뀐다.',
    },
  ];

  /**
   * **화면의 큰 뼈대 — 넷** 〈2026-08-20 사용자 지시〉.
   *
   * 전에는 「단계 레일 4칸 + 세부 진행률 + 지금 단계 화면」이 따로 놀았다.
   * 레일은 위에 있고 진행률은 그 아래에 있어서, **어디까지 왔는지**와
   * **지금 무엇을 하는지**가 서로 다른 곳에서 말하고 있었다.
   *
   *   ① 새보고서 진행률   — 지금 어디까지 왔나 (단계마다 따로. 합계를 만들지 않는다)
   *   ② 보고서 생성 입력   — 요청문과 자료를 받는다
   *   ③ 가이드 필드        — **자동입력 + 직접입력**
   *   ④ 출력조건          — 사양을 못 박고, 확정하면 그 자리에서 생성한다
   *
   * ★★ ④ 가 `spec` 과 `make` **둘을 품는다.** 둘은 원래 같은 화면의 서로 다른
   *   상태다(확정 전 / 확정 후). 화면에서까지 둘로 갈라 놓으면 사용자는 3단계를
   *   끝내고 4단계로 「넘어가야」 하는 줄 아는데, 실제로는 같은 자리에서 버튼
   *   하나가 바뀔 뿐이다.
   *
   * ★ 순서를 여기서만 정한다. 화면이 따로 적으면 한쪽만 고치는 날 갈린다.
   */
  var SECTIONS = [
    {
      no: 1, id: 'progress', name: '새보고서 진행률', steps: [],
      note: '단계마다 따로 보여준다. 하나로 합친 「80%」는 무엇의 80% 인지 아무도 모른다.',
    },
    {
      no: 2, id: 'intake', name: '보고서 생성 입력', steps: ['intake'],
      note: '요청문과 원본 자료를 받는다.',
    },
    {
      no: 3, id: 'fields', name: '가이드 필드 (자동입력 + 직접입력)', steps: ['fields'],
      note: '올린 자료를 훑어 채울 수 있는 값은 자동으로 채우고, 못 채운 것만 직접 받는다.',
    },
    {
      no: 4, id: 'output', name: '출력조건', steps: ['spec', 'make'],
      note: '쪽수·형식·언어를 못 박는다. 확정하면 같은 자리에서 생성으로 바뀐다.',
    },
  ];

  /** 어느 단계가 어느 절에 속하는가 — 화면이 되짚을 때 쓴다 */
  function sectionOfStep(stepId) {
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].steps.indexOf(stepId) !== -1) return SECTIONS[i];
    }
    return null;
  }

  /**
   * 단계 상태를 **절 단위로** 묶는다. 화면은 이것을 그대로 그린다.
   *
   * ★ 절의 상태는 **그 절이 품은 단계들**에서 나온다:
   *     - 하나라도 지금 단계면 `current`
   *     - 전부 잠겼으면 `locked` (이유는 첫 잠긴 단계의 것)
   *   진행률 절(품은 단계 없음)은 늘 열려 있다 — 볼 수만 있는 곳이다.
   */
  function sectionState(ctx) {
    var steps = stepState(ctx);
    var by = {};
    steps.forEach(function (s) { by[s.id] = s; });
    return SECTIONS.map(function (sec) {
      var mine = sec.steps.map(function (id) { return by[id]; }).filter(Boolean);
      var open = mine.filter(function (s) { return !s.locked; });
      var cur = mine.filter(function (s) { return s.current; })[0] || null;
      var firstLocked = mine.filter(function (s) { return s.locked; })[0] || null;
      return {
        no: sec.no, id: sec.id, name: sec.name, note: sec.note,
        steps: mine,
        // 볼 수만 있는 절은 잠기지 않는다 (품은 단계가 없다)
        locked: mine.length > 0 && open.length === 0,
        why: (mine.length && !open.length && firstLocked) ? firstLocked.why : null,
        current: !!cur,
        // 이 절을 열면 어느 단계로 가는가 — 열린 것 중 첫째
        opensTo: (open[0] && open[0].id) || null,
      };
    });
  }

  /**
   * 단계 화면을 **섹션 안에 끼울 때** 덮어쓰는 것.
   *
   * 화면 셋은 각자 앱 한 벌로 짜여 있다 (사이드바 + 로고 + 100% 높이). 그대로
   * 끼우면 ① 사이드바가 두 번 뜨고 ② 안쪽에 스크롤이 또 생긴다 —
   * 창 안을 다시 끄는 화면이 되는데, 그건 안 만들기로 한 것이다.
   *
   * ★ 화면 소스는 건드리지 않는다. 끼울 때만 이 규칙을 얹는다.
   */
  var EMBED_CSS = [
    'html,body{height:auto!important;min-height:0!important;background:transparent!important}',
    'body{overflow-y:hidden!important}',
    '.app{min-height:0!important}',
    '.side{display:none!important}',   /* 사이드바는 앱이 이미 그린다 */
    '.top{display:none!important}',    /* 로고도 마찬가지 */
    '.main{margin-left:0!important}',
    // ★ 화면 안의 단계 칩도 감춘다. 셸이 이미 레일을 그리므로 그대로 두면
    //   같은 단계 표시가 한 화면에 두 번 뜬다 — 어느 쪽을 눌러야 하는지 모른다
    '.steps{display:none!important}',
  ].join('');

  /**
   * 이 섹션이 앱에서 불리는 이름 — **한 곳에서만 정한다.**
   *
   * `title` 단독으로 열었을 때 화면이 스스로 그리는 제목
   * `tab`   앱의 탭 바에 다는 이름 (탭 안에서는 `title` 을 안 그린다)
   *
   * ★ 둘이 다른 이유: 탭 바에는 「완성 보고서」가 나란히 서므로 **「새」가 있어야**
   *   구분되고, 단독 화면에는 견줄 상대가 없어 「보고서 생성」이 맞다.
   *   지침 §2 에 배포된 이름은 **「보고서 생성 (Pro)」** 이라 그쪽이 `title` 이다.
   *
   * ★ 앱이 탭 이름을 **복사해서 적지 않는다.** 여기서 읽어 간다 — 두 벌이 되면
   *   한쪽만 고치는 날 탭 이름과 문서가 갈린다.
   */
  var SECTION = {
    id: 'make',
    title: '보고서 생성',
    // ★ 탭 이름과 섹션 제목이 **같다** (2026-08-18 사용자 결정). 「새 보고서 생성」
    //   이었는데, 이 화면은 앱 밖에서 불러오는 것이 아니라 앱 안의 기능이므로
    //   탭에도 그냥 「보고서 생성」이라고 적는다. 부제에서 「외부 엔진」도 뺐다 —
    //   붙이고 나면 사용자에게는 앱 기능이고, 어느 엔진이 도는지는 알 필요가 없다.
    // ★ 둘이 같으므로 `inTab: true` 를 **반드시** 켠다. 안 켜면 탭 이름 바로 아래에
    //   같은 글자가 한 번 더 나온다 (배포-지시서 §4-3).
    tab: '보고서 생성',
    tabNote: '입력부터 산출까지 4단계',
    file: 'report-flow.html',
    plan: 'pro',
  };

  /**
   * 「완성 보고서」 탭 — 만들어진 산출물 목록 〈2026-08-17〉.
   *
   * ★ SECTION 과 나란히 둔다. 탭 이름이 두 파일에 흩어지면 한쪽만 고치는 날
   *   탭 바와 화면이 다른 이름을 말한다.
   * ★ 여기는 `title` 과 `tab` 이 같다 — 「새」를 붙일 이유가 없다.
   */
  var OUTPUTS_SECTION = {
    id: 'done',
    title: '완성 보고서',
    tab: '완성 보고서',
    tabNote: '만들어진 산출물 목록',
    file: 'outputs.html',
    plan: 'pro',
  };

  /**
   * 「자료 업로드」 탭 — 보고서에 쓸 자료를 넣는 곳 〈2026-08-18〉.
   *
   * ★ 이름은 사용자가 정했다(「자료 업로드」). 다만 이 탭이 하는 일은 **셋**이고
   *   그중 둘은 업로드가 아니다 — 화면 안에서 그 구분을 분명히 말한다:
   *     ① 올려서 보관   (Pro · 우리 서버에 둔다)
   *     ② 폴더를 연결해서 (무료 · **보관하지 않는다** — 남의 드라이브를 읽기만)
   *     ③ 파일업로드(1회성) (무료 · 읽고 **바로 버린다**)
   *   ②를 「업로드」로 읽으면 사본이 우리 쪽에 남는 줄 안다 — 그게 D-65 가
   *   막으려던 오해다. 그래서 탭 이름은 짧게 두고 **화면이 설명한다.**
   *
   * ★ 무료다. 자료를 넣는 길이 유료면 Pro 를 살지 판단할 자료조차 못 넣는다.
   */
  var FILES_SECTION = {
    id: 'files',
    title: '자료 업로드',
    tab: '자료 업로드',
    tabNote: '보관 · 연결 · 1회성',
    file: 'files.html',
    plan: 'free',
  };

  /**
   * **탭 셋의 단일 출처.** 본체(NAS) 탭 바가 이것을 읽는다 —
   * 이름·순서·파일·필요 플랜을 앱과 이 저장소가 **같은 곳에서** 가져가게 한다.
   *
   * ★ 순서는 **시간 순서가 아니라 쓰는 순서**다: 만든 것을 보고(완성 보고서),
   *   새로 만들고(보고서 생성), 자료를 넣는다(자료 업로드).
   *   화면 스크린샷의 탭 순서와 같다 — 앱에서 이미 그 순서로 보인다.
   *
   * ★ 이름을 앱 쪽에 **복사해 적지 않는다.** 복사하면 한쪽만 고치는 날 갈리고,
   *   그때 사용자는 탭 이름과 화면 제목이 다른 것을 본다.
   */
  var TABS = [OUTPUTS_SECTION, SECTION, FILES_SECTION];

  /**
   * **토큰이 실렸는가** (2026-08-17).
   *
   * ★ `tokens.css` 를 같이 안 올리면 화면이 **색 없이** 뜨는데 **오류는 안 난다** —
   *   CSS 는 못 찾은 변수를 조용히 넘긴다. 배포에서 파일 하나를 빠뜨리면
   *   「글꼴도 색도 없는 화면」이 되는데 콘솔에도 아무 말이 없다.
   *   실제로 미리보기를 만들다 그 상태를 봤다.
   *
   * @returns {boolean|null} null = 브라우저가 아니라 판정할 수 없다
   */
  function tokensLoaded() {
    if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return null;
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--lp-brand');
      return String(v).trim().length > 0;
    } catch (e) { return null; }
  }

  /** 안 실렸을 때 화면이 띄우는 말. 「색이 이상하다」로 끝나지 않게 원인을 적는다 */
  var TOKENS_MISSING = '디자인 토큰(tokens.css)이 실리지 않았습니다 — '
    + '화면 파일과 같은 폴더에 tokens.css 를 함께 올려야 합니다.';

  /** 잠긴 이유 — 화면에 그대로 띄운다. 이유 없이 회색이면 고장으로 보인다 */
  var WHY = {
    // ★★ **번호로 말하지 않는다** 〈2026-08-20〉. 화면의 절 번호(②)와 단계 번호(1)가
    //   서로 다르다 — 「1단계에서」라고 적으면 ② 를 보고 있는 사람이 1을 찾는다.
    //   이름은 어느 쪽에서 세든 같다
    project: '먼저 「보고서 생성 입력」에서 프로젝트를 만듭니다',
    api: '서버(api)가 연결되어 있지 않습니다',
  };

  /**
   * 단계별 상태.
   * @param {object} ctx { projectId, api }
   * @returns {Array} STEPS 에 { locked, why, current } 를 붙인 배열
   */
  function stepState(ctx) {
    var c = ctx || {};
    var currentId = c.current || (c.projectId ? 'fields' : 'intake');
    return STEPS.map(function (s) {
      var why = null;
      // ★ 서버 미연결을 먼저 본다. 프로젝트가 없는 것은 서버가 없으면 당연한 결과라,
      //   순서를 바꾸면 "프로젝트를 만드세요"만 뜨고 진짜 원인(미연결)이 가려진다
      if (!c.api) why = WHY.api;
      else if (s.needsProject && !c.projectId) why = WHY.project;
      return {
        id: s.id, no: s.no, name: s.name, file: s.file, note: s.note, after: s.after,
        needsProject: s.needsProject,
        locked: Boolean(why),
        why: why,
        current: s.id === currentId,
      };
    });
  }

  /** 단계 화면 주소. 프로젝트가 있으면 붙여 준다 (화면들이 ?project= 를 읽는다) */
  function urlFor(step, ctx) {
    var c = ctx || {};
    var base = c.base || '';
    var url = base + step.file;
    /* ★ 2026-08-16 — api 도 함께 넘긴다.
       [사고] project 만 넘겨 단계 화면(intake/fields/reports)이 각자 api:null 인 채 열렸다.
              부모 report-flow 는 api 가 있어 단계를 열었는데, 안에서는 「API 주소가 설정되지
              않았습니다」— 부모가 열어 준 문이 안에서 잠겨 있었다. reports.html 은 api 가 없으면
              **데모 데이터**를 쓰므로 앱 안에서는 가짜 산출물이 진짜처럼 보일 수 있었다. */
    var qs = [];
    if (c.api) qs.push('api=' + encodeURIComponent(c.api));
    if (step.needsProject && c.projectId) qs.push('project=' + encodeURIComponent(c.projectId));
    if (qs.length) url += '?' + qs.join('&');
    return url;
  }

  /** 화면 파일에서 단계를 되찾는다 (iframe 이 스스로 이동했을 때 rail 을 맞춘다) */
  function stepOfFile(file) {
    var f = String(file || '').split('/').pop().split('?')[0];
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].file === f) return STEPS[i];
    return null;
  }


  /**
   * **탭 옮기기 — 한 곳에서만 만든다** 〈2026-08-21〉.
   *
   * ★★ 화면들은 각자 탭 하나일 뿐이라 **스스로 다른 탭으로 갈 수 없다.** 옮기는
   *   것은 앱(본체)이다. 그래서 알리기만 하고, **앱이 받았는지를 확인한다.**
   *   받았는지 모르면서 「옮겼습니다」라고 하면, 사용자는 눌러 놓고 아무 일도
   *   안 일어나는 화면을 본다 — 그때는 고장으로 읽힌다.
   *
   * ★ 「받았다」의 증거는 둘이다.
   *     ① iframe 안이면 `postMessage` 가 나갔다 — 부모가 있다는 뜻이다
   *     ② 같은 창이면 앱이 `preventDefault()` 로 **받았다고 답한다**
   *   ②가 없으면 아무도 안 듣는 것이다. 그때는 그렇다고 말한다.
   *
   * ★ 이 함수를 화면마다 복사해 두지 않는다. 복사하면 한쪽만 고치는 날
   *   두 화면이 서로 다른 방법으로 앱을 부른다 (outputs.html 이 원본이었다).
   *
   * @param {{projectId:string, section:string, step?:string, why?:string}} opts
   * @returns {{sent:boolean, reason:(string|null)}}
   */
  var OPEN_EVENT = 'lp-open-project';

  function openSection(opts) {
    var o = opts || {};
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { sent: false, reason: '브라우저가 아닙니다' };
    }
    var detail = { projectId: o.projectId || null, section: o.section || null };
    if (o.step) detail.step = o.step;
    if (o.why) detail.why = o.why;

    var sent = false;
    try {
      if (window.parent !== window) {
        var msg = { type: OPEN_EVENT, projectId: detail.projectId, section: detail.section };
        if (detail.step) msg.step = detail.step;
        if (detail.why) msg.why = detail.why;
        window.parent.postMessage(msg, window.location.origin);
        sent = true;
      }
    } catch (_) { /* 막혀 있으면 아래 이벤트로 간다 */ }
    try {
      var ev = new CustomEvent(OPEN_EVENT, { detail: detail, cancelable: true });
      // 앱이 받아서 처리하면 `preventDefault()` 로 알려 준다 — 그게 「받았다」의 증거다
      if (!document.dispatchEvent(ev)) sent = true;
    } catch (_) {}

    return { sent: sent, reason: sent ? null : '받는 쪽이 없습니다' };
  }

  return {
    STEPS: STEPS, WHY: WHY, EMBED_CSS: EMBED_CSS,
    SECTIONS: SECTIONS, sectionState: sectionState, sectionOfStep: sectionOfStep,
    SECTION: SECTION, OUTPUTS_SECTION: OUTPUTS_SECTION,
    FILES_SECTION: FILES_SECTION, TABS: TABS,
    stepState: stepState, urlFor: urlFor, stepOfFile: stepOfFile,
    tokensLoaded: tokensLoaded, TOKENS_MISSING: TOKENS_MISSING,
    openSection: openSection, OPEN_EVENT: OPEN_EVENT,
  };
}));
