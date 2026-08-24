/**
 * flow-core.js — 보고서 생성 **다섯 단계의 단일 출처**.
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

  /**
   * ★ **이 스크립트가 어느 판인가** 〈2026-08-23 · D-93 사고〉.
   *   `build-stamp.js` 가 채운다 — 손으로 고치지 않는다. 화면이 자기
   *   지문과 대 보고 다르면 「함수가 없다」로 죽기 전에 사람 말로 알린다.
   */
  var LP_BUILD = 'c760f626';

  /**
   * ★★★ **단계는 다섯이다** 〈2026-08-22 사용자 지시〉.
   *
   *   1 제작 기본정보 입력 · 2 무엇을 만들까요? · 3 관련자료 업로드
   *   4 가이드 필드 (자동입력 + 직접입력) · 5 출력조건
   *
   * ★ 앞의 셋은 **같은 화면(`intake.html`)의 서로 다른 칸**이다. 파일을 나누지
   *   않는 이유는 셋이 한 번의 「만들기」로 함께 서버에 가기 때문이다 — 나누면
   *   프로젝트를 만드는 버튼이 세 곳에 생기고, 그때부터 어느 것이 진짜인지 모른다.
   *   대신 `part` 로 **그 칸만 펴서** 보여준다.
   *
   * ★ 그래서 셋 사이를 오갈 때 화면이 다시 실린다. 적어 둔 것이 날아가지 않게
   *   `intake.html` 이 초안을 **브라우저에 저장**한다. 이것이 없으면 2단계로
   *   갔다 온 사이에 요청문이 사라지는데, 사용자는 자기가 지운 줄 안다.
   */
  var STEPS = [
    {
      id: 'basics', no: 1, name: '제작 기본정보 입력', file: 'intake.html', part: 'issuer',
      needsProject: false,
      note: '누가 내는 문서인지부터 정한다. 발행 주체가 정해져야 나머지가 그 회사 것이 된다.',
    },
    {
      id: 'ask', no: 2, name: '무엇을 만들까요?', file: 'intake.html', part: 'ask',
      needsProject: false,
      note: '요청문과 만들 산출물 종류를 받는다. 요청문에서 뽑은 값은 미확인으로 표시한다.',
    },
    {
      id: 'sources', no: 3, name: '관련자료 업로드', file: 'intake.html', part: 'files',
      needsProject: false,
      note: '원본 자료를 받는다. 지원하지 않는 형식은 올리기 전에 막는다. '
        + '여기서 [프로젝트 만들기] 를 누르면 앞의 셋이 함께 서버로 간다.',
    },
    {
      id: 'fields', no: 4, name: '가이드 필드 (자동입력 + 직접입력)', file: 'fields.html',
      needsProject: true,
      // ★★ **이름에 「자동입력 + 직접입력」을 박는다** 〈2026-08-20 사용자 지시〉.
      //   전에는 「가이드 필드 입력」이라 **전부 손으로 치는 칸**으로 읽혔다.
      //   실제로는 올린 자료를 훑어 채울 수 있는 것은 채우고, 못 채운 것만 묻는다.
      //   그 사실을 이름에서 말하지 않으면 사용자는 자료를 올릴 이유를 모른다.
      note: '올린 자료를 훑어 채울 수 있는 값은 **자동으로 채우고**, 못 채운 것만 '
        + '직접 받는다. 출처가 없으면 저장 버튼이 열리지 않고, 계산 항목은 입력란을 '
        + '만들지 않는다. 자동으로 채워지는 줄에는 출처를 묻지 않는다.',
    },
    /**
     * ★★★ **「생성」을 따로 세지 않는다** 〈2026-08-22 사용자 지시〉.
     *
     *   확정을 누르면 **같은 화면**(`reports.html`)에서 모습만 바뀐다. 옮겨 갈
     *   곳이 없는 칸을 레일에 그려 두면 사용자는 **「한 칸이 더 남았다」**로 읽고
     *   다음을 찾는다 — 찾을 것이 없다.
     *
     *   ★ 없앤 것은 **레일의 칸**이지 기능이 아니다. 확정→생성은 그대로다.
     */
    {
      id: 'spec', no: 5, name: '출력조건', file: 'reports.html',
      needsProject: true,
      note: '페이지 수·형식·언어를 사람이 못 박는다. 확정 전에는 생성 버튼이 열리지 '
        + '않고, **확정하면 그 자리에서 생성으로 바뀐다** — 옮겨 갈 칸이 따로 없다.',
    },
  ];

  /**
   * **화면의 큰 뼈대 — 다섯** 〈2026-08-22 사용자 지시〉.
   *
   *   ① 제작 기본정보 입력  ② 무엇을 만들까요?  ③ 관련자료 업로드
   *   ④ 가이드 필드 (자동입력 + 직접입력)       ⑤ 출력조건
   *
   * ★★ **「새보고서 진행률」 절을 뺐다** 〈2026-08-22 사용자 지시〉. 앞 판은 그것이
   *   ①이라 **단계 번호와 절 번호가 하나씩 어긋났다** — 「1단계」라고 적으면 ②를
   *   보고 있는 사람이 ①을 찾았다. 이제 절 번호와 단계 번호가 **같다.**
   *
   * ★ 순서를 여기서만 정한다. 화면이 따로 적으면 한쪽만 고치는 날 갈린다.
   */
  var SECTIONS = [
    {
      no: 1, id: 'basics', name: '제작 기본정보 입력', steps: ['basics'],
      note: '누가 내는 문서인지부터 정한다.',
    },
    {
      no: 2, id: 'ask', name: '무엇을 만들까요?', steps: ['ask'],
      note: '요청문과 만들 산출물 종류를 받는다.',
    },
    {
      no: 3, id: 'sources', name: '관련자료 업로드', steps: ['sources'],
      note: '원본 자료를 받고, 여기서 프로젝트를 만든다.',
    },
    {
      no: 4, id: 'fields', name: '가이드 필드 (자동입력 + 직접입력)', steps: ['fields'],
      note: '올린 자료를 훑어 채울 수 있는 값은 자동으로 채우고, 못 채운 것만 직접 받는다.',
    },
    {
      no: 5, id: 'output', name: '출력조건', steps: ['spec'],
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
    title: '보고서 만들기',
    // ★ 탭 이름과 섹션 제목이 **같다** (2026-08-18 사용자 결정). 「새 보고서 생성」
    //   이었는데, 이 화면은 앱 밖에서 불러오는 것이 아니라 앱 안의 기능이므로
    //   탭에도 그냥 「보고서 생성」이라고 적는다. 부제에서 「외부 엔진」도 뺐다 —
    //   붙이고 나면 사용자에게는 앱 기능이고, 어느 엔진이 도는지는 알 필요가 없다.
    // ★ 둘이 같으므로 `inTab: true` 를 **반드시** 켠다. 안 켜면 탭 이름 바로 아래에
    //   같은 글자가 한 번 더 나온다 (배포-지시서 §4-3).
    tab: '보고서 만들기',
    tabNote: '입력부터 산출까지 3단계',
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
  /**
   * ★★★ **탭은 둘이다** 〈2026-08-22 사용자 지시〉.
   *
   *   앞 판은 셋이었다: 완성 보고서 · 보고서 생성 · **자료 업로드**.
   *   그런데 자료를 넣는 것은 **보고서를 만드는 일의 첫 걸음**이지 나란히
   *   놓인 다른 일이 아니다. 탭으로 떼어 두면 이렇게 읽힌다 —
   *   「보고서를 만들려면 어느 탭부터 가야 하지?」
   *
   *   ★ 그래서 자료 업로드는 **「보고서 만들기」 1단계 안**으로 들어갔다.
   *     `FILES_SECTION` 은 지우지 않는다 — 화면(`files.html`)은 그대로 살아
   *     있고 1단계가 그것을 품는다. 탭 목록에서만 빠진 것이다.
   *   ★ ~~`TABS` 를 앱 탭 바가 읽는다. 여기서 빼면 앱에서도 탭이 사라진다 —
   *     이름을 앱 쪽에 복사해 두지 않은 이유가 이것이다.~~
   *
   *   ★★★ **틀린 말이었다** 〈2026-08-23 실측〉. 저장소 전체에서 `TABS` 를 읽는
   *     곳은 **`build-embed.js` 한 곳뿐**이고, 거기서는 **어느 파일을 배포할지**를
   *     고르는 데만 쓴다. 배포 산출물(`manifest`)에도 탭 목록은 안 들어간다 —
   *     **앱이 이 목록을 받아 갈 길이 아예 없다.**
   *   ★ 그래서 **탭 이름과 차례는 앱(본체)이 자체적으로 들고 있다.** 여기서
   *     순서를 바꿔도 앱 화면은 안 바뀐다. 실제로 사장님이 「보고서 만들기를
   *     왼쪽으로」를 **두 번** 지시하셨는데 둘 다 안 보였다 — 나는 여기만 고치고
   *     「했습니다」라고 말했다 (D-93).
   *   ★ 그래도 이 목록은 지운다고 될 것이 아니다: 배포 묶음이 여기서 나오고,
   *     `verify:nas` 가 탭 이름을 여기서 읽어 대조한다. **다만 앱 탭 바를
   *     바꾸는 손잡이는 아니다.**
   */
  /* ★★★ **「보고서 만들기」가 먼저다** 〈2026-08-23 사장님 지시〉.
   *   앞 판은 「완성 보고서」가 왼쪽이었다. 그런데 이 화면에 처음 오는 사람이
   *   할 일은 **만드는 것**이고, 완성본은 만든 다음에 보는 곳이다. 순서가 하는
   *   일의 차례와 반대면 첫 화면에서 한 번 더 생각하게 된다. */
  var TABS = [SECTION, OUTPUTS_SECTION];

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
    project: '먼저 「관련자료 업로드」까지 채우고 프로젝트를 만듭니다',
    api: '서버(api)가 연결되어 있지 않습니다',
  };

  /**
   * 단계별 상태.
   * @param {object} ctx { projectId, api }
   * @returns {Array} STEPS 에 { locked, why, current } 를 붙인 배열
   */
  function stepState(ctx) {
    var c = ctx || {};
    var currentId = c.current || (c.projectId ? 'fields' : 'basics');
    return STEPS.map(function (s) {
      var why = null;
      // ★ 서버 미연결을 먼저 본다. 프로젝트가 없는 것은 서버가 없으면 당연한 결과라,
      //   순서를 바꾸면 "프로젝트를 만드세요"만 뜨고 진짜 원인(미연결)이 가려진다
      if (!c.api) why = WHY.api;
      else if (s.needsProject && !c.projectId) why = WHY.project;
      return {
        id: s.id, no: s.no, name: s.name, file: s.file, part: s.part, note: s.note, after: s.after,
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
    /* ★ 앞의 셋은 같은 파일이다. **어느 칸을 펼지**를 여기서 넘긴다 —
       안 넘기면 세 단계가 똑같은 화면을 보여 주고, 번호만 다른 같은 곳이 된다 */
    if (step.part) qs.push('part=' + encodeURIComponent(step.part));
    if (c.api) qs.push('api=' + encodeURIComponent(c.api));
    if (step.needsProject && c.projectId) qs.push('project=' + encodeURIComponent(c.projectId));
    if (qs.length) url += '?' + qs.join('&');
    return url;
  }

  /** 화면 파일에서 단계를 되찾는다 (iframe 이 스스로 이동했을 때 rail 을 맞춘다) */
  /**
   * 주소에서 단계를 되찾는다. 화면이 스스로 넘어가도 레일이 따라가게 하는 짝이다.
   *
   * ★★★ **물음표 뒤를 봐야 한다** 〈2026-08-23 · 실제로 여기서 튕겼다〉.
   *
   *   앞의 셋(제작 기본정보·무엇을 만들까요·관련자료)은 **같은 파일**이고
   *   `?part=` 로만 갈린다. 앞 판은 파일 이름만 보고 **늘 첫째(basics)** 를
   *   돌려줬다. 그래서 2단계를 누르면:
   *
   *     누름 → 2단계로 바꾸고 `intake.html?part=ask` 를 띄운다
   *     → 실린 뒤 다시 재는데 `basics` 가 나온다
   *     → 「단계가 바뀌었다」고 보고 **1단계로 되돌리며 다시 그린다**
   *
   *   누른 사람에게는 **눌러도 안 열리는 화면**으로 보인다.
   *
   * ★ 가르지 못하면 **아무거나 고르지 않는다** (§4.9). `null` 을 돌려주면
   *   부르는 쪽이 「모르겠으니 그대로 둔다」로 처리한다 — 틀린 단계로
   *   되돌리는 것보다 그대로 두는 쪽이 언제나 낫다.
   */
  function stepOfFile(file) {
    var raw = String(file || '');
    var f = raw.split('/').pop().split('?')[0];

    var part = null;
    var qi = raw.indexOf('?');
    if (qi !== -1) {
      var m = /(?:^|[?&])part=([^&#]*)/.exec(raw.slice(qi));
      if (m) { try { part = decodeURIComponent(m[1]); } catch (_) { part = m[1]; } }
    }

    var same = [];
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].file === f) same.push(STEPS[i]);
    if (!same.length) return null;
    if (same.length === 1) return same[0];

    for (var j = 0; j < same.length; j++) if (same[j].part && same[j].part === part) return same[j];
    return null;   // 못 가른다 — 지어내지 않는다
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

  /**
   * 절마다 「끝났는가 · 얼마나 왔는가」 — **한 곳에서만 정한다**
   * 〈2026-08-23 사장님 지시: 1·2·5 완료 표기 / 3·4 진행율 + 완료 표기〉.
   *
   * 순수 함수다. 부르는 쪽이 서버에서 받아 온 사실만 넣는다 — 이 함수는
   * 아무것도 부르지 않는다. 그래야 검사가 서버 없이 전부 잴 수 있다.
   *
   * @param {object} f 잰 사실
   *   issuerSet   {boolean|null} 발행 주체가 정해졌나 (GET /intake 의 issuer.unset 반대)
   *   request     {string|null}  2단계 요청문 (초안 또는 만들어진 프로젝트의 것)
   *   projectId   {string|null}
   *   sources     {{total:number, read:number}|null} 올린 자료 / 그중 읽기 끝난 것
   *   fields      {{filled:number, total:number}|null} 필수 항목 채움
   *   specLocked  {boolean|null} 출력조건을 확정했나
   *
   * @returns {object} 절 id → { known, done, pct, detail }
   *
   * ★★★ **모르는 것을 0% 로 적지 않는다** (§4.9). 0% 는 「아직 아무것도 안 했다」로
   *   읽히는데 실제로는 「못 쟀다」다 — 둘은 다른 말이고, 섞으면 사용자는 다 해
   *   놓고도 처음부터 다시 한다. 못 쟀으면 `known:false` 로 두고 화면은 아무
   *   표시도 하지 않는다.
   *
   * ★ **3·4 만 진행율이 있다.** 나머지 셋은 「했다/안 했다」뿐이라 중간이 없다 —
   *   없는 중간을 지어내면 47% 같은 숫자가 아무 뜻도 없이 돈다.
   */
  function sectionProgress(f) {
    var o = f || {};
    var out = {};

    function put(id, known, done, pct, detail) {
      out[id] = { known: !!known, done: !!(known && done), pct: known ? pct : null, detail: detail || null };
    }

    /* ① 제작 기본정보 — 발행 주체가 정해졌는가. 중간이 없다 */
    put('basics', o.issuerSet !== null && o.issuerSet !== undefined, o.issuerSet, null,
      o.issuerSet ? '발행 주체가 정해졌습니다' : '발행 주체가 아직 없습니다');

    /* ② 무엇을 만들까요 — 요청문이 있는가.
       ★ 프로젝트가 있으면 이 칸은 이미 지나온 것이다 — 요청문 없이는 만들 수 없다 */
    var asked = !!o.projectId || !!(o.request && String(o.request).trim());
    put('ask', true, asked, null,
      asked ? '요청문을 받았습니다' : '아직 무엇을 만들지 안 적었습니다');

    /* ③ 관련자료 업로드 — **프로젝트를 만들면 이 칸의 목적은 끝난다.**
       진행율은 그다음 일(올린 자료를 읽었는가)을 말한다. 자료를 안 올려도
       진행은 되므로, 자료가 0건인 것을 「0%」로 적지 않는다 */
    var src = o.sources;
    var pct3 = (src && src.total > 0) ? Math.round((src.read / src.total) * 100) : null;
    put('sources', true, !!o.projectId, pct3,
      !o.projectId ? '아직 프로젝트가 없습니다'
        : (!src ? '프로젝트가 만들어졌습니다'
          : (src.total === 0 ? '자료 없이 진행 중 — 값을 전부 직접 넣어야 합니다'
            : '자료 ' + src.total + '건 중 ' + src.read + '건을 읽었습니다')));

    /* ④ 가이드 필드 — 필수 항목 중 **값과 출처가 둘 다** 있는 것만 센다
       (`fields-core.js` 의 `completeness`). 값만 있고 출처가 없으면 저장 자체가
       안 되므로, 세어 주면 다 됐다고 착각한다 */
    var fl = o.fields;
    var pct4 = (fl && fl.total > 0) ? Math.round((fl.filled / fl.total) * 100) : null;
    put('fields', !!fl, !!(fl && fl.total > 0 && fl.filled >= fl.total), pct4,
      !fl ? null
        : (fl.total === 0 ? '필수 항목이 없습니다'
          : '필수 ' + fl.total + '개 중 ' + fl.filled + '개 (값과 출처가 모두 있어야 셉니다)'));

    /* ⑤ 출력조건 — 확정했느냐 아니냐다. 중간이 없다 */
    put('output', o.specLocked !== null && o.specLocked !== undefined, o.specLocked, null,
      o.specLocked ? '출력조건을 확정했습니다' : '아직 확정하지 않았습니다');

    return out;
  }

  /* ═══════ 판 지문을 **화면에 보이게** 한다 〈2026-08-23〉 ═══════
   *
   * ★ 이 주석에 여는 태그를 글자 그대로 쓰지 않는다 — 이 파일은 조각(fragment)
   *   안으로 통째로 실리고, 조각 검사기가 그것을 진짜 태그로 읽고 거절한다.
   *   실제로 검사 19개가 그렇게 깨졌다 〈2026-08-23〉.
   *
   * ★★★ 무슨 일이 있었나. `build-stamp.js` 는 묶음 지문을 뿌리 태그의
   *   `data-lp-build` **속성**에만 박고 있었다. 속성은 **사진에 안 찍힌다.** 그래서 사장님이
   *   화면을 찍어 보내셔도 「이것이 그 판인가」를 가릴 수가 없었고, 나는
   *   「반영했습니다」, 사장님은 옛 화면 — 둘 다 그 사실을 모른 채로
   *   같은 왕복을 **다섯 번** 했다 (M-20 · M-22 · M-25 · M-26).
   *
   *   ★ CLAUDE.md §8 은 「화면 아래에 작게 `판 xxxxxxxx` 가 찍혀 있다」고
   *     적고 있었다. **사양이 맞고 코드가 빠져 있었다.**
   *
   * ★ 글자꼴을 요란하게 하지 않는다. 이건 **주장이 아니라 물증**이다 —
   *   작고 흐리게, 대신 **반드시 보이게**.
   */
  var BUILD_ATTR = 'data-lp-build';

  /** 이 화면이 실린 묶음의 지문. 없으면 null */
  function buildOf(doc) {
    try {
      var d = doc || document;
      var v = d.documentElement.getAttribute(BUILD_ATTR);
      return v || null;
    } catch (_) { return null; }
  }

  /** 화면에 적는 말 — **한 곳에서만 만든다.** 두 벌이면 자리마다 다르게 적힌다 */
  function buildLabel(build) {
    return build ? '판 ' + build : null;
  }

  /**
   * 화면 맨 아래에 지문을 붙인다. 이미 붙어 있으면 아무것도 안 한다.
   * ★ 두 번 부르는 자리가 실제로 있다(다시 그리기) — 그때 둘이 되면 안 된다.
   */
  /**
   * 이 화면이 **다른 LinkPilot 화면 안에** 들어 있는가 〈2026-08-23〉.
   *
   * ★★ 왜 필요한가. 지문이 **두 번 찍혔다.** `report-flow` 가 찍고, 그 안의
   *   `intake` 도 찍어서 한 화면에 같은 값이 둘이었다 (사장님 화면 실측).
   *   같은 값이 둘이면 「왜 둘이지」부터 보게 된다 — 잡음이다.
   *
   * ★ 그렇다고 「창 안이면 안 찍는다」로 두면 안 된다. `report-flow` 자체가
   *   **앱 셸의 창 안**에 들어 있어서, 그러면 지문이 통째로 사라진다 —
   *   그것이 오늘 우리를 구한 그 여덟 글자다.
   *
   * ★ 그래서 **부모가 LinkPilot 화면인지**를 본다:
   *     부모에 `LinkPilotFlow` 가 있다  → 우리 화면 안이다 → 찍지 않는다
   *     없다 / 읽을 수 없다(다른 출처)  → 앱 셸이거나 단독이다 → 찍는다
   *   읽을 수 없을 때 **찍는 쪽으로 기운다** — 없는 것보다 둘이 나은 자리다.
   */
  /**
   * 서버 주소를 정한다 — **한 곳에서만.**
   *
   * ★★★ 〈2026-08-23 사장님 화면에서 잡혔다〉 사장님이 **앱 안에서** 여셨는데
   *   화면이 「앱 밖에서 열면 …」이라고 말하고 있었다. `api` 가 비는 이유는
   *   셋인데(부모 없음 · 앱이 안 채움 · 다른 출처) 문구가 그중 하나로 단정한
   *   것이다 — **틀린 짐작을 적으면 사람이 그 짐작부터 판다** (M-24).
   *
   * ★★ 그리고 더 나쁜 것은 **안 부르고 끝낸 것**이다. 안 부르면 서버가 401 을
   *   주는지 404 를 주는지조차 모른 채로 「안 됩니다」만 남는다.
   *
   * ★ 이 화면들은 앱과 **같은 출처**에 얹혀 있다(`/im-flow/*.html`). 그러면
   *   `/api/linkpilot` 은 앱이 부르는 바로 그 주소이고, `embed-bridge.js` 의
   *   계약 예시에 적힌 값과 **글자 그대로 같다.** 그러니 못 받았으면 그것으로
   *   부르고, **짐작으로 부른 사실을 함께 말한다.**
   *
   * ★ 화면마다 따로 짐작하지 않는다 — 세 화면이 각자 정하면 갈리고, 그때는
   *   「어느 화면은 되고 어느 화면은 안 된다」가 되어 원인이 안 보인다.
   *
   * @param {{api?:string}} cfg 화면 설정 전역
   * @returns {{api:string, guessed:boolean, why:(string|null)}}
   */
  var API_FALLBACK = '/api/linkpilot';
  function resolveApi(cfg) {
    var c = cfg || {};
    if (c.api) return { api: c.api, guessed: false, why: null };
    var b = (typeof window !== 'undefined' && window.LinkPilotEmbed) || null;
    return { api: API_FALLBACK, guessed: true, why: (b && b.reason) || null };
  }

  /** 짐작으로 부른 판이면 **그 사실을 문장에 붙인다.** 안 붙이면 서버 탓으로 읽힌다 */
  function apiNote(r, base) {
    if (!r || !r.guessed) return base;
    return base + ' (앱이 서버 주소를 넘기지 않아 ' + r.api + ' 로 불렀습니다'
      + (r.why ? ' — ' + r.why : '') + ')';
  }

  function insideLinkPilot() {
    try {
      if (window.parent === window) return false;
      return !!window.parent.LinkPilotFlow;
    } catch (_) { return false; }   // 다른 출처 — 앱 셸로 본다
  }

  function stampInto(doc) {
    var d = doc || document;
    var b = buildOf(d);
    if (!b || !d.body) return null;
    if (insideLinkPilot()) return null;
    var had = d.querySelector('[data-lp-stamp]');
    if (had) { had.textContent = buildLabel(b); return had; }
    var n = d.createElement('p');
    n.setAttribute('data-lp-stamp', '');
    n.textContent = buildLabel(b);
    n.setAttribute('style', 'margin:22px 0 6px;text-align:center;font-size:11px;'
      + 'line-height:1;letter-spacing:.06em;font-variant-numeric:tabular-nums;'
      + 'color:#98A0A8;user-select:text');
    d.body.appendChild(n);
    return n;
  }

  return {
    BUILD: LP_BUILD,
    STEPS: STEPS, WHY: WHY, EMBED_CSS: EMBED_CSS,
    SECTIONS: SECTIONS, sectionState: sectionState, sectionOfStep: sectionOfStep,
    SECTION: SECTION, OUTPUTS_SECTION: OUTPUTS_SECTION,
    FILES_SECTION: FILES_SECTION, TABS: TABS,
    stepState: stepState, urlFor: urlFor, stepOfFile: stepOfFile,
    sectionProgress: sectionProgress,
    BUILD_ATTR: BUILD_ATTR, buildOf: buildOf, buildLabel: buildLabel, stampInto: stampInto,
    insideLinkPilot: insideLinkPilot,
    resolveApi: resolveApi,
    apiNote: apiNote,
    API_FALLBACK: API_FALLBACK,
    tokensLoaded: tokensLoaded, TOKENS_MISSING: TOKENS_MISSING,
    openSection: openSection, OPEN_EVENT: OPEN_EVENT,
  };
}));
