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
  var LP_BUILD = 'fd73a639';

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
    /* ★ 2026-10-28 사장님 화면: 「보고서생성에서 발행 주체 카테고리는 삭제해줘」 — 1단계 «제작 기본정보 입력»(발행 주체 칸)을 걷었다.
       발행 주체는 서버에 저장된 값(issuer.json)이 그대로 문서에 들어간다 — 화면에서 고르지 않을 뿐 엔진 규칙(core/issuer.js)은 그대로다 */
    /* ★ 2026-10-28 사장님 화면: 「무엇을 만들까요 삭제해줘」 — 요청문 칸(ask)을 걷었다. 자료를 올리면 그것으로 시작한다 */
    {
      id: 'sources', no: 1, name: '관련자료 업로드', file: 'intake.html', part: 'files',
      needsProject: false,
      note: '원본 자료를 받는다. 지원하지 않는 형식은 올리기 전에 막는다. '
        + '여기서 [프로젝트 만들기] 를 누르면 앞의 셋이 함께 서버로 간다.',
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
      id: 'spec', no: 3, name: '출력조건', file: 'reports.html',
      needsProject: true,
      note: '페이지 수·형식·언어를 사람이 못 박는다. 확정 전에는 생성 버튼이 열리지 '
        + '않고, **확정하면 그 자리에서 생성으로 바뀐다** — 옮겨 갈 칸이 따로 없다.',
    },
    /**
     * ★★★ **완성 보고서를 흐름 안으로 들였다** 〈2026-08-28 사장님 지시 · D-157〉.
     *
     *   앞 판은 이것이 **딴 탭**이었다. 그래서 만들고 나면 사용자가 「이제 어디로
     *   가지」를 스스로 찾아야 했다 — 흐름이 4단계에서 끊기고 결과가 다른 방에
     *   있었다. 사장님 지시대로 **마지막 칸**으로 들인다.
     */
    {
      id: 'done', no: 4, name: '완성 보고서', file: 'outputs.html',
      needsProject: true,
      note: '만들어진 문서를 여기서 내려받는다. 흐름의 마지막 칸이다.',
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
  /**
   * **화면의 큰 뼈대 — 여섯** 〈2026-08-29 사장님 지시 · D-172〉.
   *
   *   1 기본정보 입력   2 무엇을 만들까요?   3 관련자료 업로드
   *   4 보고서 생성·미리보기   5 출력정보 입력   6 완성결과물
   *
   * ★★★ **한 절에 한 단계로 되돌렸다.** D-157~D-162 에서 절을 넷·셋으로
   *   합쳐 왔는데, 합칠수록 **한 칸 안에 여러 일이 겹쳐** 「지금 무엇을 하는
   *   자리인지」가 흐려졌다 — 끝낸 것을 접는 장치(D-163·D-169)를 두 번 덧대야
   *   했던 것이 그 증거다. 사장님이 여섯으로 다시 그리라고 하신 이유다.
   *
   * ★ 대신 **아무 칸이나 펼 수 있다.** 앞 판은 「지금 칸」만 펴졌다 —
   *   지나온 칸을 다시 보려면 되돌아가야 했다. 이제 잠기지 않은 칸은
   *   눌러서 펴고, 각 칸 맨 아래 [완료] 로 다음 칸이 열린다.
   * ★★ 4(생성)와 5(출력정보)의 **순서는 사장님 지시 그대로**다. 다만 코드는
   *   출력조건을 확정해야 생성 단추가 열리므로, **생성 단추는 5번 안에** 있다.
   *
   * ★★★ **왜 다섯에서 넷으로 줄였나.** 사장님 지시 그대로다 —
   *   「거울 미러링처럼 복잡함 혼란스러워 · 화면 전면적으로 재구성한다」.
   *
   *   앞 판은 절 하나에 단계 하나였다(1:1). 그래서 **한 번에 하나씩만** 보였고,
   *   발행 주체를 적고 [다음] 을 눌러야 요청문이 나왔다. 둘 다 「누가·무엇을」
   *   한 자리에서 정하는 일인데 화면이 둘로 갈라 놓은 것이다.
   *
   * ★★ 이제 **한 절이 여러 단계를 품는다.** 화면은 그 절의 단계를 **함께 펴고**
   *   맨 아래에 [확인] 을 둔다. 아코디언 한 칸이 「한 번에 끝내는 일」이 된다.
   *
   * ★ 절 번호와 단계 번호는 **더 이상 같지 않다.** 대신 규칙은 그대로다 —
   *   모든 단계는 **정확히 한 절**에만 속한다 (`flow.test.js` 가 잰다).
   */
  var SECTIONS = [
    { no: 1, id: 'sources', name: '관련자료 업로드', steps: ['sources'],
      note: '원본 자료를 받고 얼마나 읽었는지 보여 준다. 여기서 프로젝트를 만든다.' },
    { no: 2, id: 'make', name: '보고서 생성 · 미리보기', steps: ['fields'],
      note: '올린 자료가 채운 값을 확인하고 못 채운 것만 넣는다. 만들어진 문서는 아래 [미리보기] 로 본다.' },
    { no: 3, id: 'spec', name: '출력정보 입력', steps: ['spec'],
      note: '쪽수·형식·언어를 못 박는다. 확정하면 그 자리에서 생성으로 바뀐다.' },
    { no: 4, id: 'done', name: '완성결과물', steps: ['done'],
      note: '만들어진 문서를 내려받는다.' },
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
    var c = ctx || {};
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
        /* ★★★ **2~6번은 1번을 끝낸 뒤에 보인다** 〈2026-09-19 사장님 지시:
             「2~6번은 1번완료후 노출되도록 만들어줘」 · 화면에 그 다섯을 빨갛게 두르심〉.
           [왜] 앞 판은 여섯 칸이 한꺼번에 펼쳐져, 아직 할 수 없는 일이 **넷이나 보였다** —
             화면에 있으면 「내가 뭘 넣어야 하나」로 읽힌다 (§6-3 ⑥ · 한 화면에 할 일 하나).
           ★ **「잠김」과 「안 보임」은 다른 일이다.** 잠김은 «여기 있지만 아직»이고,
             안 보임은 «지금 할 일이 아니다»다. 사장님이 두르신 것은 뒤엣것이다.
           ★★★ **「못 물었다」를 「안 됐다」로 접지 않는다** (§12-12 · §12-28 과 같은 결).
             `issuerSet` 은 셋이다 — true · false · **null(서버에 아직 못 물었다)**.
             null 에서 숨기면 서버가 느린 날 화면에 **1번 하나만** 남고, 그것이
             「여기서 끝인가」로 읽힌다. **모를 때는 안 숨긴다.** */
        hidden: false, /* 2026-10-28 — 1번(발행 주체)을 걷어 «1번을 끝내야 보인다»가 없어졌다 */
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
    /* ★★ **아래 탭줄도 앱이 이미 그린다** 〈2026-09-07 · 사장님 화면〉.
     *   `reports.html` 은 혼자 열릴 때를 대비해 아래 탭줄(`.bot`)을 그리는데,
     *   그것이 목록에 없어 **단계 카드 안에 앱 탭줄이 한 벌 더** 떴다.
     *   눌러도 아무 일이 없다 — 전부 `href="#"` 인 죽은 링크다.
     *   ★ 아이콘이 이모지라 §6-3(UI 이모지 금지)도 함께 어겼다. 감추면 둘 다 없어진다. */
    '.bot{display:none!important}',
    /* ★★★ **위 탭줄도 앱이 이미 그린다** 〈2026-09-07 · 사장님 화면 · M-77 옆〉.
     *
     *   [사고] 캐시를 비우고 새 판을 보시자 **탭 줄이 두 벌**로 떴다 — 앱의
     *     「보고서 만들기 / 완성 보고서」 바로 아래에 이 화면이 그린 같은 것이
     *     한 벌 더 있었다. 어느 쪽을 눌러야 하는지 알 수가 없다.
     *
     *   ★★★ **그때 내가 내린 답이 틀렸다** 〈2026-09-07 · 같은 날 되돌림〉.
     *     나는 「탭 줄은 저쪽(앱) 것」이라고 읽고 이쪽 탭을 감췄다. 그런데
     *     **앱은 그 전날 탭을 이미 지웠다** — 저쪽 2026-09-06 S-39 가 배너와
     *     탭 줄을 함께 지우고, 대신 **이쪽이 보내는 탭 신호를 듣도록** 바꿨다.
     *     그러니 앱 안에서 탭을 그리는 자리는 **이쪽 하나뿐**이다.
     *     감추면 [완성 보고서] 로 갈 길이 **양쪽 다** 없어진다.
     *
     *   ★ **사장님이 보신 두 벌은 앱이 옛 판이어서였다** (M-77 — 여드레 옛 화면).
     *     고칠 곳은 이쪽이 아니라 **저쪽을 새 판으로 올리는 것**이었다.
     *     증상만 보고 이쪽에서 덮으면, 저쪽이 새 판이 되는 순간 **아무 탭도 안 남는다.**
     *
     *   [무엇이 어느 쪽 몫인가] 그래서 지금은 이렇게 정리된다 —
     *     · **머리(제목·부제)도 탭 줄도 이쪽 화면이 단다.** 둘 다 안 감춘다.
     *     · 앱은 이쪽 탭 신호(`lp-embed-tab`)를 받아 틀의 주소를 바꾼다.
     *
     *   ★★ 재는 자리: 저쪽 `test-report-no-hero.js` 가 「엔진이 탭을 그리는가」를
     *     보는데, **감춰진 것은 못 잡았다** — 그리기는 그렸기 때문이다.
     *     그래서 그 검사에 「감추지도 않는가」를 더했다. 「그린다」와 「보인다」는
     *     다른 사실이다 (CLAUDE.md §8 과 같은 결). */
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
    /* ★★★ 배너바의 작은 라벨과 한 줄 설명 〈2026-08-31 사장님 지시 — 앱 배너를
     *   지우고 이쪽으로 올렸다〉. 앱이 쓰던 글자를 **그대로** 가져온다 — 옮기면서
     *   말이 바뀌면 사장님이 보시던 화면과 달라진다.
     * ★ `tabNote` 와 갈라 둔다: `tabNote` 는 「지금 어디에 있는지」(3단계),
     *   `lead` 는 「이 자리가 무엇을 하는 곳인지」다. 배너에는 뒤엣것이 맞다. */
    kicker: 'REPORT STUDIO',
    lead: 'IM, Teaser, 보고서, 사업계획서, 재무분석 등 AI 자동작성 프로그램',
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
   * ══════════ **들어오는 자리** 〈2026-08-30 사장님 지시 · D-182〉 ══════════
   *
   *   사장님 지시: 「내가 앞으로 보는 창은 (NAS 주소) 여기 기준으로
   *   **네비게이션 중심으로 재구성**해줘」.
   *
   * ★★★ 지금까지 이 화면들에는 **들어오는 자리가 없었다.** 화면마다 주소를 따로
   *   외워야 했고, 그래서 「어느 주소가 맞느냐」를 여러 번 물으셨다. 폴더 주소로
   *   열면 나오는 `index.html` 이 그 자리다 — 주소 하나만 기억하면 된다.
   *
   * ★ 이름과 차례를 여기서만 정한다. 화면이 따로 적으면 한쪽만 고치는 날 갈린다
   *   (M-63 — 이름을 베껴 적어 화면만 옛말을 했다).
   * ★★ `build-embed.js` 의 `required()` 가 이것을 훑어 묶음에 싣는다. 안 실으면
   *   **배포는 초록인데 그 주소만 404** 가 된다 (M-22 와 같은 결).
   */
  var HUB = {
    id: 'hub',
    file: 'index.html',
    name: '보고서 스튜디오',
    note: '보고서를 요청하고 만드는 자리입니다. 여기서 시작합니다.',
  };

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
    var currentId = c.current || (c.projectId ? 'fields' : 'sources');
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
    /* 2026-10-28 — intake 칸이 하나만 남았다. 다른 칸(part=issuer·ask)을 가리키면 그 하나로 되돌리지 않는다 */
    if (same.length === 1) return (!part || !same[0].part || same[0].part === part) ? same[0] : null;

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

  /**
   * **그 절 화면의 주소** — 앱이 안 받을 때 **스스로 갈 수 있게** 한다
   * 〈2026-08-29 · D-165〉.
   *
   * ★★★ 왜 필요한가: `openSection()` 은 앱에 **신호를 보낼** 뿐이다. 앱이 그
   *   신호를 안 들으면 **아무 일도 안 일어난다.** 그러면 화면에는 「눌러도
   *   아무 일이 없는 단추」가 남는데, 이 저장소가 가장 나쁘다고 못박아 둔
   *   바로 그것이다 — 사용자는 **고장으로 읽고 거기서 멈춘다.**
   *
   * ★★ 이 주소는 **상대 경로**다. 화면들은 한 폴더에 함께 있고, 각 화면이
   *   맨 위에서 `<base>` 를 세워 두므로 어디에 얹혀 있든 같은 폴더로 닿는다
   *   (M-56). 절대 경로를 적으면 앱이 옮겨 갈 때마다 또 틀린다.
   *
   * @returns {string|null} 예: `report-flow.html?project=LP-1&step=fields`
   */
  function sectionUrl(opts) {
    var o = opts || {};
    var file = (o.file || (SECTION && SECTION.file) || '');
    if (!file) return null;
    var qs = [];
    if (o.projectId) qs.push('project=' + encodeURIComponent(o.projectId));
    if (o.step) qs.push('step=' + encodeURIComponent(o.step));
    return qs.length ? file + '?' + qs.join('&') : file;
  }

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

    /* ★★★ **절이 셋으로 줄면서 이 셈도 셋이 되었다** 〈2026-08-28 · D-162〉.
     *   〈D-157 때는 넷이었다 — 자료 업로드가 딴 칸이었다〉
     *   열쇠는 **절 id** 다(`SECTIONS[].id`). 레일 칸 이름을 쓰면 절과 어긋난다.
     *   ★ 못 잰 것은 `known:false` 로 둔다 — 「0%」는 「못 쟀다」가 아니다. */

    /* ★★★ **절이 여섯이 되면서 이 셈도 여섯이 되었다** 〈2026-08-29 · D-172〉.
     *   열쇠는 **절 id** 다(`SECTIONS[].id`). 절 이름을 쓰면 절과 어긋난다.
     *   ★ 못 잰 것은 `known:false` 로 둔다 — 「0%」는 「못 쟀다」가 아니다 (§4.9). */

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

    /* ④ 보고서 생성 · 미리보기 — 값이 얼마나 찼는가.
       ★ 값은 **값과 출처가 둘 다** 있는 것만 센다 (`fields-core.completeness`) */
    var fl = o.fields;
    var pct4 = (fl && fl.total > 0) ? Math.round((fl.filled / fl.total) * 100) : null;
    put('make', !!fl, !!(fl && fl.total > 0 && fl.filled >= fl.total), pct4,
      !fl ? null
        : (fl.total === 0 ? '필수 항목이 없습니다'
          : '필수 ' + fl.total + '개 중 ' + fl.filled + '개 (값과 출처가 모두 있어야 셉니다)'));

    /* ⑤ 출력정보 입력 — 확정했는가 */
    put('spec', o.specLocked !== null && o.specLocked !== undefined, !!o.specLocked, null,
      (o.specLocked === null || o.specLocked === undefined) ? null
        : (o.specLocked ? '출력조건을 확정했습니다' : '아직 확정하지 않았습니다'));

    /* ⑥ 완성결과물 — **여기서는 못 잰다.** 산출물 목록은 그 화면이 받아 온다.
       못 쟀다고 두는 것이 「0건」이라고 적는 것보다 낫다 (§4.9) */
    put('done', false, false, null, null);

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

  /**
   * ══════════ **앱이 앱 안에 들어 있는가** 〈2026-08-28 · D-164〉 ══════════
   *
   * 사장님 신고: 「오류 이중 배너」 — 사진 배너와 탭 줄이 **두 벌**로 보였다.
   *
   * ★★★ 그 배너·탭 문자열(`REPORT STUDIO` 등)은 **이 저장소에 하나도 없다**
   *   (실측 — `docs/지침-개정안-§2.md`). 그러니 두 벌 다 **앱이 그린 것**이고,
   *   그것은 **앱이 자기 페이지를 자기 안에 또 넣었다**는 뜻이다.
   *
   * ★★ **이 저장소는 그것을 못 고친다.** 어느 주소를 틀에 넣을지는 앱이 정한다
   *   (CLAUDE.md §8-2 — platform 이 cron 을 부르지 그 반대가 아니다).
   *
   * ★ 그래도 **잠자코 있지는 않는다.** 겹쳐 보이는 것만도 나쁘지만 **더 나쁜
   *   것은 원인이 안 보이는 것**이다 — 사장님은 「화면이 이상하다」까지밖에
   *   말할 수 없고, 그러면 엉뚱한 곳을 고치게 된다. 그래서 **세어서 말한다.**
   *
   * 세는 법: 앱은 틀을 만들기 전에 `window.LINKPILOT_EMBED` 를 채운다
   * (`embed-bridge.js` 의 계약). 조상을 거슬러 올라가며 그 전역을 **가진 창이
   * 둘 이상**이면 앱이 겹쳐 있는 것이다.
   *
   * @returns {{apps:number, hops:number, blocked:boolean}}
   *   `apps` 앱으로 보이는 조상 수 · `blocked` 다른 출처라 더 못 봤다
   */
  function appDepth(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    if (!w) return { apps: 0, hops: 0, blocked: false };
    var apps = 0, hops = 0;
    try {
      while (w.parent && w.parent !== w && hops < 8) {
        w = w.parent; hops++;
        if (w.LINKPILOT_EMBED) apps++;   // 다른 출처면 여기서 예외
      }
    } catch (e) {
      /* ★ 다른 출처를 만나면 **거기까지가 아는 전부**다. 「겹치지 않았다」로
         단정하지 않는다 — 못 본 것과 없는 것은 다른 사실이다 (§4.9) */
      return { apps: apps, hops: hops, blocked: true };
    }
    return { apps: apps, hops: hops, blocked: false };
  }

  /**
   * ══════════ **나와 맨 위 사이에 무엇이 있는가** 〈2026-08-29 · D-179〉 ══════════
   *
   * ★★★ 왜 세는 수를 하나 더 두나 〈사장님 화면 「잘못된 케이스」〉.
   *
   *   `appDepth()` 는 **위쪽 창이 `LINKPILOT_EMBED` 를 들고 있는가**로 셌다.
   *   그런데 그 전역은 앱이 **우리 화면에 넣어 주는 것**이라, 사이에 낀 것이
   *   **앱 자신의 페이지**면 그 칸이 비어 있다. 그래서 배너·탭이 두 벌로
   *   보이는 화면에서 **경고가 한 줄도 안 떴다** — 세는 자가 그 모양을 못 쟀다.
   *
   * ★ 이 화면(보고서 생성 흐름)은 앱이 **바로** 틀에 넣는 자리다. 그러므로
   *   **나와 맨 위 사이에 문서가 하나라도 있으면** 그것은 우리 것이 아니다 —
   *   앱이 자기 페이지를 한 겹 더 넣었다는 뜻이다. 무엇인지 몰라도 **있다는
   *   사실**은 잴 수 있고, 그것만으로 원인을 가리키기에 충분하다.
   *
   * ★★ 우리 화면끼리의 겹침을 이것으로 재면 **안 된다.** 단계 화면
   *   (`basics` 등)은 이 화면이 틀에 넣으므로 사이에 하나가 **정상으로** 있다.
   *   그래서 이 셈은 **바로 넣히는 화면만** 쓴다 (`direct: true`).
   *
   * ★ 다른 출처를 만나면 **모른다고 답한다** — 못 본 것과 없는 것은 다르다 (§4.9).
   */
  function midFrames(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    if (!w) return { mid: 0, blocked: false, top: true };
    try {
      if (w.top === w) return { mid: 0, blocked: false, top: true };
      var mid = 0, cur = w, hops = 0;
      while (cur.parent && cur.parent !== cur && cur.parent !== w.top && hops < 8) {
        cur = cur.parent; hops++; mid++;
      }
      return { mid: mid, blocked: false, top: false };
    } catch (e) {
      return { mid: 0, blocked: true, top: false };
    }
  }

  /**
   * 겹쳤다고 **말할 수 있을 때만** 문장을 돌려준다. 아니면 `null`.
   *
   * @param {object} [d] `appDepth()` 결과 (안 주면 여기서 잰다)
   * @param {{direct?:boolean}} [opt] `direct` 는 **앱이 바로 틀에 넣는 화면**이라는 뜻.
   *   그때만 `midFrames` 로도 잰다 — 단계 화면은 사이에 하나가 정상으로 있다.
   */
  function nestedAppNote(d, opt) {
    var x = d || appDepth();
    var direct = !!(opt && opt.direct);
    var mid = direct ? midFrames() : { mid: 0, blocked: false, top: true };
    if (x.apps < 2 && !(direct && mid.mid > 0)) return null;
    var howMany = x.apps >= 2 ? (x.apps + '겹') : ((mid.mid + 1) + '겹');
    return '앱 화면이 앱 안에 ' + howMany + '으로 들어 있습니다. '
      + '그래서 배너와 탭 줄이 두 벌로 보입니다. '
      + '이 화면이 만든 것이 아닙니다 — 배너·탭 글자는 이 저장소에 하나도 없습니다. '
      + '앱이 「보고서 만들기」 자리에 넣을 주소로 **앱 자신의 페이지**를 넣고 '
      + '있습니다. 넣어야 하는 것은 im-flow 폴더의 report-flow.html 입니다. '
      + '고치는 자리는 앱 쪽이며, 근본과 방법은 전달 문서의 lp:base 절에 있습니다.';
  }

  /**
   * ══════════ **앱이 나를 갈아 끼웠는가** 〈2026-08-29 · D-173〉 ══════════
   *
   * 사장님 화면: 주소는 `linkpilot-platform.html` 하나인데 **문서가 넷**이었다 —
   * 새로 고칠 때마다 탭 제목이 「보고서 생성」·「보고서 생성 입력」·「자료
   * 업로드」·「LinkPilot」으로 바뀌었다.
   *
   * ★★★ 뜻: **앱이 화면 HTML 을 최상위 문서에 통째로 갈아 끼운다.** 틀(iframe)
   *   안에 넣는 것이 아니라 문서 자체를 바꾼다.
   *
   * ★★ 그래서 **껍데기가 두 벌이 된다.** 화면들은 저마다 사이드바·로고·단계칩을
   *   그리는데(단독으로 열릴 때 필요하다), 앱이 이미 그것을 그려 놓은 자리에
   *   들어가면 같은 것이 한 벌 더 생긴다. 틀에 넣을 때는 `EMBED_CSS` 가 그것을
   *   감췄는데, **문서를 통째로 갈아 끼우면 그 CSS 를 얹는 사람이 없다.**
   *
   * ★ 고침: 화면이 **자기 주소를 보고** 판단한다. 주소의 파일 이름이 제 것이
   *   아니면 「누가 나를 여기 갖다 놓았다」는 뜻이므로 **제 껍데기를 스스로
   *   감춘다.** 제 주소로 열렸으면 그대로 다 그린다.
   * ★★ 다른 출처·이상한 주소면 **아무것도 하지 않는다** — 모르면 건드리지
   *   않는 것이 낫다. 잘못 감추면 화면이 통째로 빈 것처럼 보인다.
   *
   * @param {string} file 이 화면의 파일 이름 (예: 'intake.html')
   * @returns {boolean} 제 주소로 열렸는가
   */
  function selfPlaced(file) {
    if (typeof window === 'undefined') return true;   // 브라우저가 아니면 건드리지 않는다

    /* ★★★ **틀(iframe) 안이면 「내가 놓인 것」이다** 〈2026-09-07 · 사장님 화면〉.
     *
     *   앞 판은 **주소의 파일 이름만** 봤다. 그런데 흐름은 이 화면을 **제 주소
     *   그대로** 틀에 넣는다(`reports.html` 을 `reports.html` 로). 그러면 주소가
     *   제 것이므로 「혼자 열렸다」로 읽고 **껍데기를 다 그린다** — 감추는 장치
     *   (`EMBED_CSS`)가 아예 안 켜진다.
     *
     *   ★ 그래서 사장님 화면의 단계 카드 안에 `LINK PILOT` 줄과 단계 칩줄이
     *     **한 벌 더** 나왔다. 오류는 하나도 안 났다 — 그냥 두 벌로 보일 뿐이다.
     *
     *   ★★ 틀 안에 있다는 것은 **누군가 나를 거기 넣었다**는 뜻이고, 넣은 쪽이
     *     이미 제 껍데기를 그리고 있다. 주소가 무엇이든 감추는 것이 맞다.
     *   ★ 다른 출처의 틀이면 `window.top` 을 읽다 예외가 난다 — 그때도 **틀 안**
     *     인 것은 확실하므로 감춘다. 「모르면 안 건드린다」는 원칙은 **주소를
     *     모를 때**의 이야기이지, 틀 안인 것이 확실한 자리에는 해당하지 않는다. */
    try {
      if (window.top !== window.self) return false;   // 틀 안 — 내가 놓인 것이다
    } catch (_) {
      return false;                                   // 읽다 막혔다 = 남의 틀 안이다
    }

    var here = '';
    try { here = String(window.location.pathname || ''); } catch (_) { return true; }
    if (!here) return true;
    var got = here.split('/').pop();
    if (!got) return true;                            // 폴더 주소 — 판단하지 않는다
    return got === String(file);
  }

  /**
   * 앱이 갈아 끼운 자리라면 **제 껍데기를 감춘다.**
   * @returns {boolean} 감췄는가
   */
  function hideOwnChrome(file) {
    if (typeof document === 'undefined') return false;
    if (selfPlaced(file)) return false;               // 제 주소다 — 다 그린다
    if (document.getElementById('lp-host-chrome')) return true;
    var st = document.createElement('style');
    st.id = 'lp-host-chrome';
    st.textContent = EMBED_CSS;
    (document.head || document.documentElement).appendChild(st);
    return true;
  }

  /**
   * ══════════ **흐름 밖에 홀로 떠 있으면 돌아갈 길을 준다** 〈2026-08-29 · D-170〉
   *
   * 사장님 신고: 「LinkPilot 플랫폼 프레임내 있지 않음」 — 주소는
   * `report-flow.html` 인데 화면과 탭 제목은 `intake.html` 이었다. 즉 단계
   * 화면이 **흐름 밖으로 빠져나가** 홀로 떠 있었다.
   *
   * ★★★ **빠져나간 것 자체보다, 돌아올 길이 없는 것이 문제다.** 단계 화면은
   *   저마다 사이드바를 그리므로 **플랫폼처럼 보인다** — 그래서 사용자는
   *   「여기가 어디지」가 아니라 「플랫폼이 이상하다」로 읽는다. 그 상태에서
   *   할 수 있는 일이 뒤로가기뿐이다.
   *
   * ★ 그래서 **홀로 떴을 때만** 맨 위에 한 줄을 둔다 — 어디에 있는지 말하고,
   *   흐름으로 돌아가는 링크를 준다. 틀 안(앱·흐름)에서는 아무것도 안 그린다.
   * ★★ 「고장」이 아니라 **「여기는 한 칸만 보는 자리」**라고 적는다. 빨간 띠로
   *   그리면 멀쩡한 화면을 고장으로 읽는다 (늑대야를 만들지 않는다).
   *
   * @param {{projectId?:string, step?:string}} opts
   * @returns {HTMLElement|null} 틀 안이면 `null`
   */
  function strandedBar(opts) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    try { if (window.parent !== window) return null; } catch (_) { return null; }

    var o = opts || {};
    /* ★★★ **앱이 갖다 놓은 자리에서는 뜨지 않는다** 〈2026-08-29 · D-173〉.
     *   앱은 화면 HTML 을 최상위 문서에 갈아 끼운다. 그러면 `parent === window`
     *   라 「홀로 떴다」로 보이는데, 실제로는 **앱이 일부러 놓은 자리**다.
     *   거기서 「흐름 밖입니다」라고 하면 **멀쩡한 화면을 고장으로 읽게 만든다** —
     *   내가 D-170 에서 만든 헛울음이다. 주소가 제 것일 때만 말한다. */
    if (o.file && !selfPlaced(o.file)) return null;
    var url = sectionUrl({ projectId: o.projectId, step: o.step });
    if (!url) return null;

    var bar = document.createElement('div');
    bar.setAttribute('data-lp-stranded', '');
    bar.setAttribute('style', 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;'
      + 'padding:11px 16px;background:#F2F2F7;border-bottom:1px solid #E8EAEC;'
      + 'font:600 13.5px/1.5 system-ui,-apple-system,sans-serif;color:#3C4149');

    var t = document.createElement('span');
    t.textContent = '이 화면은 한 칸만 따로 열린 것입니다 — 「보고서 만들기」 흐름 밖입니다.';
    bar.appendChild(t);

    var a = document.createElement('a');
    a.href = url;
    a.textContent = '흐름으로 돌아가기';
    a.setAttribute('style', 'margin-left:auto;background:#AAE106;color:#0A1419;'
      + 'text-decoration:none;font-weight:700;padding:7px 14px;border-radius:10px');
    bar.appendChild(a);
    return bar;
  }

  /** 화면 맨 위에 붙인다. 이미 있으면 두 번 붙이지 않는다 */
  function showStranded(opts) {
    var bar = strandedBar(opts);
    if (!bar || !document.body) return null;
    if (document.querySelector('[data-lp-stranded]')) return null;
    document.body.insertBefore(bar, document.body.firstChild);
    return bar;
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

  /* ★★★ **API 를 부를 때는 «기다릴 시간»을 정한다** 〈2026-09-09 사장님 지시:
       「너무 느림 로딩 교차검증하고 개선해줘」〉.

     [사고] 화면 열셋의 `fetch` 쉰네 곳에 **시간 제한이 한 곳도 없었다.** 서버가
       404 나 오류를 주면 화면이 「못 받았습니다」를 띄우는데, **대답을 아예 안 하고
       매달려 있으면** 그 자리도 안 온다. 사장님 화면의 **글자 하나 없는 흰 상자**가
       그 상태다 — 오류도 없고 안내도 없고, 그냥 영영 기다린다.

     [왜 큰가] 「못 받았다」와 「아직 기다린다」는 사람에게 **똑같이 보인다.** 앞엣것은
       고칠 데가 있고 뒤엣것은 없는데, 화면이 갈라 주지 않으면 둘 다 「고장」으로 읽힌다
       (§8 「빈 화면으로 끝나지 않는다」 · §2 「조용히 죽지 않는다」와 같은 결).

     [정한 것] 기본 12초. 사람이 흰 화면을 참는 한계보다 짧고, 느린 망에서 멀쩡한
       응답을 자르지 않을 만큼은 길다. 부르는 쪽이 필요하면 바꿔 준다.
     ★ 시간이 다 되면 **그냥 실패가 아니라 「시간이 다 됐다」로 갈라** 준다 —
       받는 쪽이 사람에게 다른 말을 할 수 있어야 한다.
     ★★ `AbortSignal.timeout` 이 없는 낡은 브라우저에서는 스스로 만들어 쓴다.
       없다고 시간 제한을 포기하면 그 브라우저에서만 흰 화면이 남는다. */
  var API_TIMEOUT_MS = 12000;
  function lpFetch(url, opts) {
    var o = {};
    for (var k in (opts || {})) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    var ms = o.timeoutMs || API_TIMEOUT_MS;
    delete o.timeoutMs;
    var timer = null;
    if (!o.signal) {
      try {
        if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) o.signal = AbortSignal.timeout(ms);
        else if (typeof AbortController !== 'undefined') {
          var ac = new AbortController();
          o.signal = ac.signal;
          timer = setTimeout(function () { try { ac.abort(); } catch (_) {} }, ms);
        }
      } catch (_) { /* 시간 제한을 못 걸어도 요청 자체는 보낸다 */ }
    }
    return fetch(url, o).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    }, function (e) {
      if (timer) clearTimeout(timer);
      /* 시간이 다 된 것인지 다른 이유인지 갈라 준다 */
      var name = (e && e.name) || '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        var t = new Error('서버가 ' + Math.round(ms / 1000) + '초 안에 대답하지 않았습니다');
        t.lpTimeout = true;
        throw t;
      }
      throw e;
    });
  }
  /* 사람에게 보일 한 줄 — 「못 받았다」와 「너무 오래 걸린다」를 갈라 적는다 */
  function apiWhy(e) {
    if (e && e.lpTimeout) return '서버가 제때 대답하지 않았습니다. 잠시 뒤 다시 열어 주십시오.';
    var m = (e && e.message) || '';
    return m ? ('서버에 닿지 못했습니다 — ' + m) : '서버에 닿지 못했습니다.';
  }


  /**
   * ══════════ **배너 그림 — 세 화면이 같은 얼굴을 쓴다** 〈2026-09-14 사장님 지시〉 ══════════
   *
   * 사장님 지시 그대로다 — 「**배너를 일관성있게 이미지넣어 만들어줘**」.
   *
   * ★ **무엇이 일관성이 없었나** 〈실측〉. 배너와 탭줄이 **세 화면 중 하나**(report-flow)
   *   에만 있었다. 「완성 보고서」·「자료 업로드」로 가면 **머리가 통째로 사라진다** —
   *   한 앱인데 자리를 옮길 때마다 얼굴이 바뀐다. 그림이 없는 것보다 이쪽이 먼저였다.
   *
   * ★★ **앞 판의 「사진은 안 넣는다」를 사장님 지시가 바꾼다.** 그 줄이 있던 이유는
   *   「배너 두 벌」 사고였는데, 그것은 **앱 쪽 배너를 지워서** 이미 풀렸다 (§8-2 · S-39).
   *   남은 이유는 「활자로 승부한다」(§6-3 ③)였고, 그것은 **내 판단**이지 지시가 아니었다.
   *
   * ★★★ **남의 사진을 안 쓴다 — 우리가 그린다.** §6-2-6 이 정한 일곱(공식 API·사진가
   *   표기·Asset Registry)은 **남의 사진**에 걸리는 규칙이다. 박아 둔 사진을 하나 더
   *   늘리면 그 자리에서 지침을 어긴다(이미 55장이 그 상태다). 그리고 미리보기는
   *   **파일 하나로 열려야 한다**(§8) — 바깥 주소를 물면 그 순간 자체 완결이 깨진다.
   *   그래서 **자리마다 뜻이 있는 그림을 우리가 그려** data URI 로 심는다.
   *
   * ★ **난수를 안 쓴다.** 앱의 배너는 열 때마다 새로 그리는데, 이 자리는 그러면
   *   **화면 지문 검사와 헤드리스 렌더가 매번 다른 그림**을 본다 (§8 — 재생성 결과가
   *   커밋본과 같아야 한다). 자리 이름에서 뽑은 **고정된 그림**을 쓴다.
   *
   * ★★ **글자가 먼저다.** 그림은 스크림(어두운 겹) 아래로 들어간다 — 없으면 흰 제목이
   *   그림 위에 얹혀 안 읽힌다 (§6-1-2 · §6-3 ③).
   */

  /**
   * 배너 모양 — **한 벌**이다 〈2026-09-14〉.
   *
   * ★ 앞 판은 이 규칙이 `report-flow.html` 안에만 있었다. 그래서 다른 화면에 배너를
   *   달려면 **규칙을 복사**해야 했고, 그 순간 두 벌이 되어 한쪽이 옛말을 한다 (§8-1).
   * ★★ `headEl` 이 문서마다 **한 번만** 심는다.
   * ★★★ `.head` 라는 이름을 바꾸지 않는다 — 앱이 감추는 이름(`.top`·`.steps`·`.side`)을
   *   피해서 고른 이름이다. 바꾸면 **앱 안에서만 조용히 사라진다**.
   */
  var HEAD_CSS = [
    '.head{margin:0 0 14px;padding:20px 22px;border-radius:16px;',
    /* ★★★ **높이를 앱 배너와 맞춘다** 〈2026-09-14 사장님 지시: 「플렛폼 배너와 크기가 다름 ·
         보고서생성 배너를 일관성 있게 동일하게 만들어줘」〉.
       [무엇이 달랐나] 앱의 `SectionHero` 는 **170px**(줄었을 때 64)인데 이쪽은 **120px** 이었다.
         앱 안에서 두 화면을 오가면 **배너만 껑충거린다** — 같은 앱인데 다른 앱처럼 읽힌다.
       ★ 여기 적힌 170 은 **앱의 값**이다 (`linkpilot-platform.deploy.html` 의 `SectionHero`
         height: shrink ? 64 : 170). 저쪽이 바뀌면 이 값도 함께 바꾼다 — 두 저장소라
         한 곳으로 합칠 수가 없으므로 **같은지 잰다** (§8-1 과 같은 결 · `report-head.test.js`).
       ★★ `min-height` 인 이유: 부제가 두 줄을 넘겨도 글자가 안 잘린다. 앱은 고정 높이인데
         이쪽은 글이 길어질 수 있어 **작아지지만 않게** 막는다. */
    'background-color:var(--lp-navy,#10233C);color:#fff;min-height:170px;box-sizing:border-box;',
    'display:flex;flex-direction:column;justify-content:center;',
    /* ★ 바탕색을 **남긴다** — 그림이 안 뜨는 자리에서도 흰 글자가 읽혀야 한다.
       「그림이 없으면 글자도 안 보인다」를 만들지 않는다. */
    'background-size:cover;background-position:right center;background-repeat:no-repeat;overflow:hidden}',
    '.head h1{margin:0;font-size:clamp(20px,5.4vw,26px);line-height:1.2;color:#fff}',
    /* ★ 부제는 두 줄까지다. 더 접히면 배너가 커져 «몸집»이 달라진다 (M-71 과 같은 결) */
    '.head__d{margin:7px 0 0;font-size:clamp(12px,3.4vw,13.5px);line-height:1.5;',
    'color:rgba(255,255,255,.78);display:-webkit-box;-webkit-line-clamp:2;',
    '-webkit-box-orient:vertical;overflow:hidden}',
  ].join('');

  /** 배너 모양을 문서에 **한 번만** 심는다 */
  function headCssInto(d) {
    if (!d || !d.createElement) return false;
    try {
      if (d.querySelector && d.querySelector('style[data-lp-head-css]')) return false;
      var st = d.createElement('style');
      st.setAttribute('data-lp-head-css', '1');
      st.textContent = HEAD_CSS;
      (d.head || d.documentElement || d.body).appendChild(st);
      return true;
    } catch (_) { return false; }
  }

  var HERO_INK = '#10233C';      // 배너 바탕 — 토큰이 없을 때의 기본값과 같다
  var HERO_LIME = '#AAE106';     // 강조 — 디자인 시스템 §11 (큰 면을 채우지 않는다)

  /** 자리마다 무엇을 그리는가 — **뜻을 나르는 그림만 둔다** (§6-3 「장식으로 넣지 않는다」) */
  function heroArt(id) {
    var w = '#FFFFFF';
    var g = '';
    var i;
    if (id === 'done') {
      /* 완성 보고서 — **쌓여 나온 산출물**. 겹쳐 놓인 장들이 오른쪽으로 퍼진다 */
      for (i = 0; i < 5; i++) {
        g += '<rect x="' + (690 + i * 74) + '" y="' + (96 + i * 12) + '" width="150" height="196" rx="8"'
          + ' fill="' + w + '" opacity="' + (0.05 + i * 0.035).toFixed(3) + '"/>';
      }
      g += '<path d="M968 206 l26 26 l52 -58" fill="none" stroke="' + HERO_LIME
        + '" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>';
    } else if (id === 'files') {
      /* 자료 업로드 — **들어오는 자료**. 세 갈래가 한 곳으로 모인다 */
      var from = [[700, 92], [700, 190], [700, 288]];
      for (i = 0; i < from.length; i++) {
        g += '<path d="M' + from[i][0] + ' ' + from[i][1] + ' C 830 ' + from[i][1] + ', 880 190, 1000 190"'
          + ' fill="none" stroke="' + w + '" stroke-width="3" opacity=".22"/>';
        g += '<circle cx="' + from[i][0] + '" cy="' + from[i][1] + '" r="13" fill="' + w + '" opacity=".3"/>';
      }
      g += '<rect x="1000" y="120" width="140" height="140" rx="14" fill="' + w + '" opacity=".1"/>';
      g += '<path d="M1070 235 v-90 m-32 32 l32 -32 l32 32" fill="none" stroke="' + HERO_LIME
        + '" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>';
    } else {
      /* 보고서 만들기 — **자료가 문서가 된다**. 장 위에 줄이 그어지고 한 줄만 라임이다
         (그 한 줄이 「출처 있는 값」이다 — 이 시스템의 전부가 그것이다) */
      g += '<rect x="720" y="80" width="230" height="230" rx="10" fill="' + w + '" opacity=".07"/>';
      g += '<rect x="790" y="112" width="230" height="230" rx="10" fill="' + w + '" opacity=".05"/>';
      for (i = 0; i < 6; i++) {
        g += '<rect x="752" y="' + (118 + i * 30) + '" width="' + (166 - (i % 3) * 38) + '" height="9" rx="4.5"'
          + ' fill="' + (i === 2 ? HERO_LIME : w) + '" opacity="' + (i === 2 ? '.9' : '.26') + '"/>';
      }
      g += '<circle cx="1092" cy="196" r="66" fill="none" stroke="' + w + '" stroke-width="3" opacity=".18"/>';
      g += '<circle cx="1092" cy="196" r="24" fill="' + HERO_LIME + '" opacity=".22"/>';
    }
    return g;
  }

  /**
   * 배너 바탕 그림 한 장. **`background-image` 에 그대로 넣는 data URI** 를 돌려준다.
   * @param {string} id 자리 이름 (`make` · `done` · `files`)
   */
  function heroSvg(id) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 390" width="1200" height="390">'
      + '<defs><linearGradient id="lpG" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="' + HERO_INK + '"/>'
      + '<stop offset="1" stop-color="#0A1620"/></linearGradient></defs>'
      + '<rect width="1200" height="390" fill="url(#lpG)"/>'
      + heroArt(id)
      + '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /**
   * 배너 한 벌을 만든다 — **세 화면이 이것을 부른다.**
   *
   * ★ 글자는 `SECTION` 에서 읽는다. 여기 옮겨 적으면 두 벌이 된다 (§8-1).
   * ★★ 그림은 **스크림 아래**다 — `linear-gradient` 를 그림 «앞»에 적는다.
   *   차례를 바꾸면 그림이 스크림을 덮어 흰 제목이 안 읽힌다.
   * ★★★ 라임 딱지(`kicker`) 줄은 **안 그린다** 〈2026-09-09 사장님 지시 — 앞 지시가 이긴다〉.
   *   그 값은 `SECTION.kicker` 에 남겨 둔다. 다른 화면이 쓴다.
   *
   * ★★★ **앱이 그림을 넘기면 그것이 이긴다** 〈2026-09-14 사장님 지시: 「배너 이미지
   *   만들어줘 · **다른 섹션과 동일하게**」〉.
   *
   *   [왜] 앱의 다른 섹션 배너는 **앱이 가진 한 생성기**(풍경 씬)로 그린다. 여기서
   *     내가 따로 그리면 **얼굴이 다르다** — 사장님이 말씀하신 「동일하게」가 그것이다.
   *   ★ 그 생성기를 여기 **베끼지 않는다.** 베끼면 두 벌이 되어 앱이 그림을 손보는 날
   *     이쪽만 옛말을 한다 (§8-1). 그러니 **앱이 넘겨 준다** — `LINKPILOT_EMBED` 의
   *     `hero` 다. 이미 있는 계약이라 새 규격을 만들지 않는다 (`embed-bridge.js`).
   *   ★★ **넘겨받지 못하면 조용히 빈 배너가 되지 않는다** — 아래 `heroSvg` 로 우리가
   *     그린 그림을 쓴다. 단독으로 열 때(미리보기)가 그 자리다. 「앱이 안 주면 그림이
   *     없다」로 두면 **미리보기가 제품과 다른 것을 보여 준다** (§8).
   *   ★★★ **바깥 주소는 안 받는다.** `hero` 로 `https://…` 가 들어오면 그 순간
   *     남의 사진을 출처 없이 싣는 길이 열린다 (§6-2-6). `data:` 만 받는다.
   *
   * @param {object} sec  `SECTION` · `OUTPUTS_SECTION` · `FILES_SECTION` 중 하나
   * @param {object} doc  `document` (검사가 다른 문서를 넘길 수 있게 받는다)
   * @param {string} [hero] 앱이 넘긴 그림(`data:` URI). 없으면 우리가 그린 것을 쓴다
   * @returns {HTMLElement}
   */
  function heroFrom(sec, hero) {
    var h = hero == null ? '' : String(hero);
    /* ★ `data:image/` 로 시작하는 것만 받는다 — 바깥 주소는 §6-2-6 을 그 자리에서 어긴다 */
    if (h && h.slice(0, 11) === 'data:image/') return h;
    return heroSvg(sec.id);
  }

  function headEl(sec, doc, hero) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !sec) return null;
    headCssInto(d);
    var hd = d.createElement('div');
    hd.className = 'head';
    hd.setAttribute('data-lp-hero', sec.id || '');
    hd.style.backgroundImage =
      'linear-gradient(100deg, rgba(10,22,32,.92) 0%, rgba(10,22,32,.72) 46%, rgba(10,22,32,.42) 100%), '
      + 'url("' + heroFrom(sec, hero) + '")';
    var h1 = d.createElement('h1');
    h1.textContent = sec.title;
    hd.appendChild(h1);
    var sub = sec.lead || sec.tabNote;
    if (sub) {
      var p = d.createElement('p');
      p.className = 'head__d';
      p.textContent = sub;
      hd.appendChild(p);
    }
    return hd;
  }

  /* ══════════ 보고서 만들기 v2 — 1단계 «배치» 〈2026-10-25 사장님: 「단계별로 다시 짓기」 · 「디자인 레이아웃 반영해줘」〉
   *
   * ★ 화면(`report-flow.html`)은 이 표를 **그리기만** 한다. 문서 양식 11장 · 작성 단계 10칸 ·
   *   사실 표 이름표의 판정이 화면에 따로 적히면 한쪽이 옛말을 한다 (§8-1).
   * ★★ **엔진이 못 만드는 문서를 «만들 수 있다»로 그리지 않는다** (§6-2-3 · §8).
   *   `engine` 이 있는 카드만 고를 수 있고, 나머지는 «준비 중 — 이유»로 선다.
   *   장 수·쪽수도 둘로 가른다 — 엔진 카드는 **엔진의 목차·사양 값**(ENGINE_DOCS · 검사가 im-outline·outputspec 과 대 본다),
   *   준비 중 카드는 디자인 파일의 **예정** 값이다(화면에 «예정»으로 적는다).
   */
  var V2_CATS = [
    { id: 'plan', name: '사업 계획', note: '사업을 설명하고 타당성을 보이는 문서',
      icon: 'M4 19V9M10 19V5M16 19v-7M3 19h18' },
    { id: 'invest', name: '투자 유치', note: '투자자에게 보내는 문서',
      icon: 'M3.6 18.4 9 12.6l3.6 2.8 7.4-8.6M15 6.8h5v5' },
    { id: 'finance', name: '금융 조달', note: '금융기관 제출과 실사 문서',
      icon: 'M3 10 12 4l9 6M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20h18' },
  ];

  /* 엔진이 지금 실제로 만드는 문서 — 값은 엔진에서 왔다 (engine-docs 검사가 대 본다):
   *   im      장 = templates/im-outline.js 의 IM_SECTIONS 수 · 쪽 = outputspec PRESETS.im.targetPages
   *   teaser  항목 = TEASER_ITEMS 수 · 쪽 = PRESETS.teaser.targetPages
   *   summary 쪽 = PRESETS.summary.targetPages · 장 나눔은 엔진에 없다(IM 쓰는 이가 같은 본문을 쓴다)
   *   cover   = 06-im-writer 가 문서 맨 위에 적는 제목 그대로 */
  var ENGINE_DOCS = {
    im:      { label: 'IM (투자설명서)', chapters: 21, items: null, pages: 40, cover: 'Investment Memorandum' },
    teaser:  { label: 'Teaser', chapters: null, items: 11, pages: 3, cover: 'Project Teaser' },
    summary: { label: '요약 보고서', chapters: null, items: null, pages: 10, cover: 'Investment Memorandum' },
  };

  var V2_SOON = '엔진에 아직 이 문서의 목차와 서식이 없습니다';
  var V2_DOCS = [
    { id: 'so', cat: 'plan', name: '사업개요/요약', desc: '사업을 1~4쪽으로 줄인 개요서', engine: 'summary',
      kinds: ['1쪽 요약', '2~4쪽 개요'], plan: { chapters: 3, pages: 6 },
      caution: '엔진의 «요약 보고서» 사양(목표 10쪽)으로 만듭니다 — 개요서 전용 목차는 아직 없어 표지·목차가 IM 과 같습니다.' },
    { id: 'bp', cat: 'plan', name: '사업계획서', desc: '사업 내용 · 시장 · 추진 계획 · 재무 계획', engine: null,
      kinds: ['투자유치용', '정책자금 · 정부지원용', '대출 신청용', '내부 보고용'], plan: { chapters: 8, pages: 35 } },
    { id: 'fs', cat: 'plan', name: '사업성 분석보고서', desc: '입지 · 시장 · 사업비 · 수익성 · 민감도', engine: null,
      kinds: ['개발사업', '에너지 사업', '운영 사업'], plan: { chapters: 7, pages: 28 } },
    { id: 'teaser', cat: 'invest', name: '투자 티저', desc: '첫 접촉용 1~3쪽 요약', engine: 'teaser',
      kinds: null, plan: { chapters: 3, pages: 6 } },
    { id: 'im', cat: 'invest', name: 'IM 풀버전', desc: '투자 검토용 정식 설명서', engine: 'im',
      kinds: null, plan: { chapters: 8, pages: 38 } },
    { id: 'ts', cat: 'invest', name: 'Term Sheet', desc: '거래 주요 조건 요약', engine: null,
      kinds: ['지분 투자', '대출', '메자닌'], plan: { chapters: 4, pages: 8 } },
    { id: 'ir', cat: 'invest', name: '투자검토서', desc: '사업 · 재무 · 위험 검토와 투자 의견', engine: null,
      kinds: null, plan: { chapters: 5, pages: 18 } },
    { id: 'la', cat: 'finance', name: '대출신청서', desc: '신청 금액 · 용도 · 상환 계획 · 담보', engine: null,
      kinds: ['PF 대출', '브릿지 대출', '운영자금 대출', '시설자금 대출'], plan: { chapters: 7, pages: 18 } },
    { id: 'imf', cat: 'finance', name: 'IM제안서', desc: '금융기관 제출용 IM · 대출 조건 제안', engine: null,
      kinds: ['PF 대출', '브릿지 대출', '리파이낸싱'], plan: { chapters: 8, pages: 32 },
      hint: '지금은 [투자 유치 → IM 풀버전]으로 만들 수 있습니다' },
    { id: 'cp', cat: 'finance', name: '여신제안서', desc: '차주 · 여신 조건 · 상환 재원 · 담보', engine: null,
      kinds: ['PF 대출', '브릿지 대출', '운영자금 대출'], plan: { chapters: 6, pages: 22 } },
    { id: 'dd', cat: 'finance', name: '실사보고서', desc: '법률 · 재무 · 기술 실사 결과', engine: null,
      kinds: ['법률 실사', '재무 실사', '기술 실사', '종합 실사'], plan: { chapters: 5, pages: 22 } },
  ];

  function v2Doc(id) {
    for (var i = 0; i < V2_DOCS.length; i++) if (V2_DOCS[i].id === id) return V2_DOCS[i];
    return null;
  }
  function v2DocsOf(cat) { return V2_DOCS.filter(function (d) { return d.cat === cat; }); }
  /** 엔진 종류(im·teaser·summary)를 품은 첫 카드 — 저장된 값이 엔진 종류일 때 되짚는다 */
  function v2DocOfEngine(engine) {
    for (var i = 0; i < V2_DOCS.length; i++) if (V2_DOCS[i].engine === engine) return V2_DOCS[i];
    return null;
  }

  /** 카드 아래 «N개 장 · N쪽» — 엔진 카드는 엔진 값, 준비 중은 «예정» */
  function v2DocMeta(d, bare) {
    if (!d) return '';
    var e = d.engine && ENGINE_DOCS[d.engine];
    if (e) {
      if (e.chapters) return e.chapters + '개 장 · ' + e.pages + '쪽';
      if (e.items) return '핵심 항목 ' + e.items + '개 · ' + e.pages + '쪽';
      return e.pages + '쪽 · 장 나눔 없음';
    }
    return d.plan.chapters + '개 장 · ' + d.plan.pages + '쪽' + (bare ? '' : ' 예정');
  }

  /* ── 작성 단계 10칸 ──────────────────────────────────────
   * ★ 지금 흐름(절 여섯)이 덮는 칸만 «열림»이다. 덮지 않는 칸은 «준비 중»으로 서고
   *   **끝난 것처럼 칠하지 않는다** — 4칸이 늘 «준비 중»이라 % 의 상한은 60 이다.
   *   그것이 지금 사실이다 (10칸 중 6칸만 만들어져 있다). */
  var V2_STEPS = [
    { no: 1, name: '무엇을 만들까', secs: ['sources'] }, /* 2026-10-28 — 요청문 칸을 걷어 자료 올리기가 1칸도 맡는다 */
    { no: 2, name: '사업 파악', secs: ['sources'] },
    { no: 3, name: '받는 곳·목적', secs: [], soon: '받는 곳·목적은 아직 엔진이 받지 않습니다' },
    { no: 4, name: '목차 정하기', secs: [], soon: '목차는 엔진이 정한 차례로 나갑니다 — 장을 고르는 칸은 준비 중입니다' },
    { no: 5, name: '빈칸 채우기', secs: ['make'] },
    { no: 6, name: '디자인·언어', secs: ['spec'] },
    { no: 7, name: '숫자 점검·확정', secs: [], soon: '점검표 화면은 준비 중입니다 — 지금은 만들 때 엔진이 검증 보고서를 함께 냅니다' },
    { no: 8, name: '만들기', secs: ['spec'] },
    { no: 9, name: '고치기', secs: [], soon: '고칠 문단 고르기는 준비 중입니다 — 지금은 «보고서 생성 · 미리보기» 칸의 [수정 요구]로 갑니다' },
    { no: 10, name: '내보내기·보내기', secs: ['done'] },
  ];

  /** 지금 단계(STEPS id) → 10칸 번호 */
  function v2StepOf(stepId, specLocked) {
        if (stepId === 'sources') return 2;
    if (stepId === 'fields') return 5;
    if (stepId === 'spec') return specLocked ? 8 : 6;
    if (stepId === 'done') return 10;
    return null;
  }

  /**
   * 10칸 상태. 판정은 **잰 사실**에서만 나온다.
   * @param {object} o { progress: sectionProgress 결과, sections: sectionState 결과,
   *                     made: 만들어진 문서 수(null=못 쟀다), current: 지금 STEPS id, specLocked }
   * @returns {Array<{no,name,live,done,current,locked,why}>}  done 은 true·false·null(못 잰다)
   */
  function v2Steps(o) {
    var c = o || {};
    var pg = c.progress || {};
    var secBy = {};
    (c.sections || []).forEach(function (s) { secBy[s.id] = s; });
    var cur = v2StepOf(c.current, c.specLocked);
    function sdone(id) { var p = pg[id]; return p && p.known ? !!p.done : null; }
    return V2_STEPS.map(function (st) {
      var live = st.secs.length > 0;
      var done = null;
      if (live) {
        if (st.no === 1) {
          done = sdone('sources');
        } else if (st.no === 2) done = sdone('sources');
        else if (st.no === 5) done = sdone('make');
        else if (st.no === 6) done = sdone('spec');
        else if (st.no === 8) done = (c.made === null || c.made === undefined) ? null : c.made > 0;
        else if (st.no === 10) done = null;   /* 내려받았는지는 이 화면이 못 잰다 */
      }
      var shut = live && st.secs.every(function (id) {
        var s = secBy[id]; return !s || s.locked || s.hidden;
      });
      var whyLocked = null;
      if (shut) {
        var s0 = secBy[st.secs[0]];
        whyLocked = (s0 && s0.why) || (s0 && s0.hidden ? '1번을 끝내면 열립니다' : '앞 칸을 먼저 끝냅니다');
      }
      return {
        no: st.no, name: st.name, live: live, done: live ? done : false,
        current: cur === st.no, locked: !live || shut,
        why: live ? whyLocked : st.soon, secs: st.secs.slice(),
      };
    });
  }

  /** 진행 % — **끝난 칸 수 / 10**. 못 잰 칸·준비 중 칸은 끝난 것으로 안 센다 */
  function v2Progress(steps) {
    var list = steps || [];
    var n = list.filter(function (s) { return s.done === true; }).length;
    var total = V2_STEPS.length;
    return { done: n, total: total, pct: Math.round((n / total) * 100),
      label: total + '단계 중 ' + n + '단계 끝' };
  }

  /** 다음에 할 일 — 열린 칸 중 끝나지 않은 첫 칸 */
  function v2Next(steps) {
    var list = steps || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.live && !s.locked && s.done !== true && s.no !== 10) return s;
    }
    for (var j = 0; j < list.length; j++) if (list[j].live && !list[j].locked && list[j].done !== true) return list[j];
    return null;
  }

  /* ── 사업 파악 — 사실 표 ─────────────────────────────── */
  var V2_FACT_KEYS = [
    ['project.name', '사업명'], ['project.location', '위치'], ['land.area_sqm', '대지면적'],
    ['building.gfa_sqm', '연면적'], ['land.zoning', '용도지역'], ['investment.total', '총사업비'],
  ];

  function v2Fmt(v, unit) {
    if (v === null || v === undefined || v === '') return '';
    var s = (typeof v === 'number') ? v.toLocaleString('ko-KR') : String(v);
    return unit ? s + unit : s;
  }

  /** 출처 한 갈래의 첫 이름 — 「사업계획서.pdf, p.6」 같은 인용에서 앞만 */
  function v2SrcShort(src) {
    /* 견본처럼 문서 이름만 — 「사업계획서.pdf, p.6」 → 「사업계획서」 */
    return String(src || '').split(',')[0].trim().replace(/\.[A-Za-z0-9]{1,5}$/, '');
  }
  /** 받침이 있으면 a, 없으면 b — 한글이 아니면 b (견본: 「12,400㎡를」) */
  function v2Josa(word, a, b) {
    var w = String(word || ''), c = w.charCodeAt(w.length - 1);
    if (c >= 0xAC00 && c <= 0xD7A3) return w + (((c - 0xAC00) % 28) ? a : b);
    return w + b;
  }

  /**
   * 이름표 — 값이 어디서 왔는가.
   * ★ 갈래는 서버가 넘긴 `origin` 을 그대로 쓴다(서버가 비우지 않는다 · report-api getFacts).
   *   origin 이 없으면 **짐작하지 않고** 출처 이름만 적는다 — 판정 규칙을 화면에 또 두지 않는다 (§8-1).
   * @returns {{kind:string, text:string}}  kind: doc·public·request·calc·manual·need·split·src
   */
  function v2Tag(fact) {
    if (!fact || fact.value === '' || fact.value === null || fact.value === undefined) {
      return { kind: 'need', text: '자료 필요' };
    }
    if (fact.alternatives && fact.alternatives.length) return { kind: 'split', text: '자료 필요' };   /* 견본 397 — 값이 갈린 줄도 «자료 필요» */
    var src = v2SrcShort(fact.source);
    var page = (fact.page !== null && fact.page !== undefined && fact.page !== '') ? ' ' + fact.page + '쪽' : '';
    switch (fact.origin) {
      case 'document': return { kind: 'doc', text: '올린 자료 · ' + src + page };
      case 'public': return { kind: 'public', text: '공공자료 · ' + src };
      case 'request': return { kind: 'request', text: '요청문에서' };
      case 'derived': return { kind: 'calc', text: '계산' };
      case 'manual': return { kind: 'manual', text: '직접 입력' };
      default: return { kind: 'src', text: src ? '출처 · ' + src : '출처 없음' };
    }
  }

  /**
   * 표 줄. `values` 가 null 이면 «못 쟀다» → 줄을 안 만든다(null). {} 이면 여섯 줄 모두 «자료 필요».
   * ★ 디자인 파일의 예시 값은 여기 없다 — 값은 /facts 대답에서만 온다.
   */
  function v2FactRows(values, def) {
    if (!values || typeof values !== 'object') return null;
    var d = def || {};
    return V2_FACT_KEYS.map(function (p) {
      var key = p[0], f = values[key] || null, dk = d[key] || {};
      var label = p[1];
      var shown = f ? v2Fmt(f.value, dk.unit || f.unit || null) : '';
      if (f && f.alternatives && f.alternatives.length) {
        shown = [shown].concat(f.alternatives.map(function (a) { return v2Fmt(a.value, dk.unit || a.unit || null); })).join(' / ');
      }
      return { key: key, label: label, value: shown || '자료에 없음', empty: !shown, tag: v2Tag(f) };
    });
  }

  /**
   * 되묻기 — 값이 갈린 항목. 서버가 넘긴 `alternatives` 에서만 만든다.
   * @returns {Array<{key,label,why,opts:[string,string,string]}>}
   */
  function v2Conflicts(values, def) {
    if (!values || typeof values !== 'object') return [];
    var d = def || {};
    var out = [];
    Object.keys(values).sort().forEach(function (key) {
      var f = values[key];
      if (!f || !f.alternatives || !f.alternatives.length) return;
      var dk = d[key] || {};
      var unit = dk.unit || f.unit || null;
      var label = dk.label || key;
      var a = f.alternatives[0];
      var winSrc = v2SrcShort(f.source) || '한 자료';
      var altSrc = v2SrcShort((a.sources && a.sources[0]) || '') || '다른 자료';
      var wv = v2Fmt(f.value, unit), av = v2Fmt(a.value, unit);
      out.push({
        key: key, label: label,
        why: v2Josa(label, '이', '가') + ' ' + winSrc + '에는 ' + wv + ', ' + altSrc + '에는 ' + av
          + '입니다. 보고서 전체에 쓸 값을 정해 주세요.',
        /* 견본 397 차례 — ① 다른 자료의 값 ② 지금 표에 선 값 ③ 둘 다 */
        opts: [altSrc + ' 값 ' + v2Josa(av, '을', '를') + ' 씁니다',
          winSrc + ' 값 ' + v2Josa(wv, '을', '를') + ' 씁니다',
          '두 값을 함께 적고 차이를 주석으로 답니다'],
      });
    });
    return out;
  }

  /* ── 기능 옵션 — 만들 수 있는 형식 ──────────────────────
   * ★ 값은 엔진 사양(outputspec SUPPORTED_FORMATS)에서 왔다. 못 만드는 것은 «아직 못 만든다». */
  /* 분량 고르기 — 견본 글자(20쪽 · 40쪽 · 60쪽+) 그대로. n 은 사양에 적는 쪽수, min~max 는 «켜짐»으로 보는 범위.
   * ★ IM 은 엔진 최소가 30쪽이라 20쪽을 고르면 엔진 사양 검사가 문제로 적는다 — 질문 목록에 올렸다. */
  var V2_PAGES = [{ n: 20, label: '20쪽', min: 0, max: 29 }, { n: 40, label: '40쪽', min: 30, max: 59 },
    { n: 60, label: '60쪽+', min: 60, max: 1e9 }];
  /* 언어 — reports.html(«출력정보 입력»)이 쓰는 값 그대로 */
  var V2_LANGS = [{ id: 'ko', name: '한국어' }, { id: 'en', name: 'English' }, { id: 'ko-en', name: '국문+영문 병기' }];


  /* ══ 디자인·레이아웃 10종 고정 시스템 〈2026-10-25 사장님 지침 v1.0 «추가로 반영해줘»〉
   *   id·name·layout·use·latin 은 지침 §3 표 글자 그대로. colors 는 §3 «컬러 참조» 토큰 넷을 부록 A 의 실제 CSS 값으로 옮긴 것
   *   (차례: 지침에 적힌 차례). paperlogy=true 는 «Paperlogy 유지»(LP-DS-04).
   *   ★ 영문 글꼴 6종은 파일이 없다 — 화면은 «글꼴 파일 등록 전 — Paperlogy 로 보임»으로 적는다(지어 넣지 않는다).
   *   ★ 타입별 표지·본문·도표 그림은 원본이 없어 안 그린다 (지침 §11 3~5 의 후속 구현). */
  var V2_DS_TOKENS = {   /* 부록 A 실제 선언값 */
    '--lp-ink': '#0A1419', '--lp-ink-hover': '#2B3440', '--lp-surface': '#FFFFFF', '--lp-surface-alt': '#F7F7FA',
    '--lp-line-strong': 'rgba(60,60,67,.3)', '--lp-lime-ink': '#577508', '--lp-lime-deep': '#3F5600', '--lp-lime-tint': '#F0FAD8',
    '--lp-warn': '#B25000', '--lp-warn-tint': '#FFF1DE', '--lp-info': '#0063CC', '--lp-info-tint': '#E6F0FF',
  };
  var V2_DS = [
    { id: 'LP-DS-01', name: '기업표준 그리드형', layout: '제목·요약·본문·도표가 정돈된 기본 그리드', use: '기업소개·일반 보고·업무제안', latin: 'Roboto Condensed Bold', refs: ['--lp-ink', '--lp-surface', '--lp-lime-ink', '--lp-lime-tint'] },
    { id: 'LP-DS-02', name: '부동산·투자 IM형', layout: '투자 포인트·핵심 수치·사업구도·재무표', use: '부동산·지분투자·PF IM', latin: 'DIN Condensed Bold', refs: ['--lp-ink', '--lp-surface', '--lp-info', '--lp-info-tint'] },
    { id: 'LP-DS-03', name: '사업계획 캔버스형', layout: '고객·사업모델·시장·운영·재무 모듈', use: '신규사업·사업확장 계획', latin: 'Roboto Condensed Bold', refs: ['--lp-ink', '--lp-surface', '--lp-lime-deep', '--lp-lime-tint'] },
    { id: 'LP-DS-04', name: '공공·정책 보고형', layout: '번호 체계·목적·근거·추진계획·예산', use: '공공 제안·정책지원·기관 제출', latin: 'Paperlogy 유지', paperlogy: true, refs: ['--lp-ink', '--lp-surface', '--lp-surface-alt', '--lp-line-strong'] },
    { id: 'LP-DS-05', name: '데이터분석 대시보드형', layout: '지표 카드·비교 차트·근거 표·해석', use: '시장조사·사업성·실적 보고', latin: 'Roboto Condensed Bold', refs: ['--lp-ink', '--lp-info', '--lp-info-tint', '--lp-surface-alt'] },
    { id: 'LP-DS-06', name: '인프라·사업구도형', layout: '큰 사업구도·참여자 역할·지도·자금 흐름', use: '인프라·에너지·개발사업', latin: 'DIN Condensed Bold', refs: ['--lp-ink', '--lp-lime-deep', '--lp-lime-tint', '--lp-info-tint'] },
    { id: 'LP-DS-07', name: '로드맵·추진일정형', layout: '단계·일정·역할·의사결정 시점', use: '프로젝트 진행·실행계획', latin: 'Roboto Condensed Bold', refs: ['--lp-ink', '--lp-info', '--lp-warn', '--lp-surface'] },
    { id: 'LP-DS-08', name: '분양·프로모션형', layout: '상품 이미지·가격·조건·핵심 혜택', use: '분양·가격 안내·프로모션', latin: '가격: Bebas Neue / 할인·이벤트: Anton', refs: ['--lp-ink', '--lp-lime-deep', '--lp-warn', '--lp-warn-tint'] },
    { id: 'LP-DS-09', name: '사진·브로슈어형', layout: '선명한 사진·짧은 설명·위치·주요 특징', use: '시설소개·브로슈어·사업소개', latin: 'Oswald Bold', refs: ['--lp-ink', '--lp-surface', '--lp-surface-alt', '--lp-lime-ink'] },
    { id: 'LP-DS-10', name: '프리미엄 투자제안형', layout: '넓은 여백·흑백 사진·핵심 문구·절제된 도표', use: '고급 투자제안·주요 투자자 제안', latin: 'Montserrat ExtraBold', refs: ['--lp-ink', '--lp-ink-hover', '--lp-surface', '--lp-lime-ink'] },
  ];
  /* ★ 레이아웃 견본 〈2026-10-26 사장님: 「디자인 선택 적용에 레이아웃 가로, 세로형을 보여주도록」 + 덱 갤러리 사진 여덟〉
   *   타입마다 12쪽의 «쪽 배치»를 선(線)으로 그린다 — 글·숫자는 회색 막대(자리표시)라 실제 문서로 읽히지 않는다(지어내지 않는다 · §8).
   *   색은 그 타입의 참조 색 넷(V2_DS_TOKENS) 그대로. 가로(16:9)·세로(A4) 두 판을 같은 쪽 차례로 그린다. */
  var V2_DS_PAGES = {
    'LP-DS-01': ['cover', 'toc', 'kpi', 'twocol', 'table', 'chart', 'diagram', 'twocol', 'table', 'chart', 'timeline', 'closing'],
    'LP-DS-02': ['cover', 'toc', 'kpi', 'diagram', 'map', 'table', 'chart', 'table', 'kpi', 'timeline', 'table', 'closing'],
    'LP-DS-03': ['cover', 'toc', 'canvas', 'kpi', 'chart', 'diagram', 'table', 'chart', 'timeline', 'table', 'kpi', 'closing'],
    'LP-DS-04': ['cover', 'toc', 'divider', 'twocol', 'table', 'table', 'timeline', 'divider', 'table', 'chart', 'twocol', 'closing'],
    'LP-DS-05': ['cover', 'kpi', 'chart', 'chart', 'table', 'kpi', 'chart', 'table', 'chart', 'kpi', 'twocol', 'closing'],
    'LP-DS-06': ['cover', 'toc', 'diagram', 'map', 'diagram', 'table', 'chart', 'map', 'timeline', 'table', 'kpi', 'closing'],
    'LP-DS-07': ['cover', 'toc', 'timeline', 'timeline', 'table', 'diagram', 'timeline', 'table', 'kpi', 'timeline', 'twocol', 'closing'],
    'LP-DS-08': ['cover', 'photo', 'price', 'photo', 'table', 'price', 'photo', 'kpi', 'map', 'table', 'photo', 'closing'],
    'LP-DS-09': ['cover', 'photo', 'photo', 'twocol', 'map', 'photo', 'kpi', 'photo', 'table', 'photo', 'photo', 'closing'],
    'LP-DS-10': ['cover', 'divider', 'photo', 'kpi', 'twocol', 'chart', 'divider', 'photo', 'table', 'diagram', 'kpi', 'closing'],
  };
  var V2_DS_KIND = { cover: '표지', toc: '목차', divider: '간지', kpi: '핵심 수치', twocol: '본문 2단', table: '표', chart: '도표',
    diagram: '사업구도', map: '지도', timeline: '일정', photo: '사진', price: '가격·조건', canvas: '모듈 캔버스', closing: '맺음' };
  function v2DsPages(id) { return (V2_DS_PAGES[id] || []).slice(); }
  /* ★★ 쪽 견본 = «예시 문서» 〈2026-10-26 사장님: 「실제 예시 작업된 디자인 이미지를 넣어서 · 앳지 있는 디자인으로 깔끔한 레이아웃 · 글로벌 경쟁사 견본을 서치하여」〉
   *   앞 판(선 그림 · 자리표시 막대)을 «예시 회사·예시 숫자가 실린 완성 쪽»으로 바꿨다. 경쟁사 화면을 베끼지 않고, 공통 경향만 옮겼다 —
   *   엄격한 격자 · 짙은 무채색 + 강조색 하나 · 큰 숫자 · 굵은 제목 · 사진과 숫자를 한 쪽에 엮기 · 얇은 선의 도표.
   *   ★ 회사·숫자는 꾸민 값이다 — 쪽마다 «예시» 딱지를 박고 화면에도 그렇게 적는다(§8 「예시면 예시라고 박는다」).
   *   ★ 사진은 받아 오지 않는다(Pexels·Unsplash 공식 API 만 · §6-2-6) — 그 자리는 타입 색으로 그린 벡터 그림이다.
   *   판: 세로 A4 = 210×297 · 가로 16:9 = 320×180. */
  var V2_DS_SAMPLE = {
    'LP-DS-01': { tableT: '사업 영역별 매출', co: '한빛테크', title: '2026 회사소개서', sub: '산업용 IoT 플랫폼 · 업무 제안', illo: 'office',
      kpis: [['312', '고객사'], ['148억', '2025 매출'], ['27%', '3년 성장률'], ['14건', '등록 특허']],
      rows: [['스마트팩토리', '62억', '41%'], ['물류 자동화', '38억', '25%'], ['에너지 관리', '29억', '19%'], ['유지보수', '19억', '15%']], cols: ['사업 영역', '매출', '비중'],
      chart: [42, 55, 61, 78, 96, 121, 148], chartL: ['19', '20', '21', '22', '23', '24', '25'], unit: '억 원', steps: ['진단', '설계', '구축', '운영'] },
    'LP-DS-02': { tableT: '재원 구성', co: 'PDI 예시 PFV', title: '서초 복합개발 투자제안', sub: '오피스·리테일 연면적 48,200㎡ · 지분투자 IM', illo: 'city',
      kpis: [['1,240억', '총사업비'], ['14.2%', '목표 IRR'], ['58%', 'LTV'], ['2028.06', '준공 예정']],
      rows: [['선순위 PF', '720억', '58%'], ['중순위', '180억', '15%'], ['자기자본(RCPS)', '220억', '18%'], ['분양 선수금', '120억', '9%']], cols: ['재원', '금액', '비중'],
      chart: [-180, -420, -380, 160, 520, 610, 640], chartL: ['26', '27', '28', '29', '30', '31', '32'], unit: '현금흐름 · 억 원', steps: ['토지 확보', '인허가', '착공', '준공·매각'] },
    'LP-DS-03': { tableT: '사업모델', co: '예시 로지스', title: '도시형 물류 신사업 계획', sub: '수도권 라스트마일 거점 12곳', illo: 'warehouse',
      kpis: [['12곳', '거점'], ['3.4만', '일 처리량'], ['2.1년', '회수 기간'], ['18%', '영업이익률']],
      rows: [['고객', '수도권 이커머스 셀러'], ['가치', '당일 배송 · 반품 수거'], ['채널', '플랫폼 제휴 · 직판'], ['수익', '건당 수수료 · 보관료']], cols: ['모듈', '내용'],
      chart: [8, 14, 22, 31, 40, 52], chartL: ['1Q', '2Q', '3Q', '4Q', '5Q', '6Q'], unit: '처리량 · 천 건', steps: ['시범 2곳', '확장 6곳', '전국 12곳', '자동화'] },
    'LP-DS-04': { tableT: '추진 개요', co: '예시시', title: '스마트 에너지 지원사업 제안', sub: '공공건물 태양광·ESS 보급 · 기관 제출용', illo: 'civic',
      kpis: [['46개소', '대상 건물'], ['3.8MW', '설치 용량'], ['21억', '국비 신청'], ['31%', '전기료 절감']],
      rows: [['1. 목적', '공공건물 에너지 자립'], ['2. 근거', '신재생에너지법 제12조'], ['3. 추진', '2026.03 ~ 2027.12'], ['4. 예산', '국비 21억 · 시비 9억']], cols: ['항목', '내용'],
      chart: [12, 18, 23, 27, 31], chartL: ['1년', '2년', '3년', '4년', '5년'], unit: '누적 절감률 · %', steps: ['공모', '선정', '설치', '사후관리'] },
    'LP-DS-05': { tableT: '권역별 지표', co: '예시 리서치', title: '수도권 오피스 시장 분석', sub: '2026 3분기 · 권역별 공실·임대료', illo: 'city',
      kpis: [['4.1%', '평균 공실률'], ['+6.3%', '임대료 상승'], ['2.8조', '거래액'], ['5.2%', '캡레이트']],
      rows: [['CBD', '3.6%', '12.4만'], ['GBD', '2.1%', '13.8만'], ['YBD', '5.9%', '10.2만'], ['판교', '1.4%', '9.6만']], cols: ['권역', '공실률', '평당 임대료'],
      chart: [5.8, 5.1, 4.9, 4.6, 4.3, 4.1], chartL: ['21', '22', '23', '24', '25', '26'], unit: '공실률 · %', steps: ['수집', '정제', '분석', '해석'] },
    'LP-DS-06': { tableT: '참여자와 역할', co: '예시 오프쇼어윈드', title: '해상풍력 120MW 사업구도', sub: '전남 서남해 · 발전사업 허가 완료', illo: 'wind',
      kpis: [['120MW', '설비 용량'], ['3,960억', '총사업비'], ['34%', '이용률'], ['20년', 'PPA']],
      rows: [['사업주', 'SPC (예시)'], ['EPC', '국내 조선사 컨소시엄'], ['대주단', '정책금융 + 시중은행'], ['구매자', 'RE100 기업 장기계약']], cols: ['참여자', '역할'],
      chart: [0, 0, 120, 360, 360, 360, 360], chartL: ['26', '27', '28', '29', '30', '31', '32'], unit: '발전량 · GWh', steps: ['허가', '금융 약정', '건설', '상업 운전'] },
    'LP-DS-07': { tableT: '단계별 책임', co: '예시 엔지니어링', title: '추진 로드맵 2026–2028', sub: '단계·일정·결정 시점', illo: 'office',
      kpis: [['4단계', '추진'], ['26개월', '전체 기간'], ['7회', '의사결정'], ['3곳', '주관 기관']],
      rows: [['착수', '2026.01', 'PM'], ['설계', '2026.04', '설계사'], ['인허가', '2026.10', '시행사'], ['시공', '2027.03', '시공사']], cols: ['단계', '시작', '책임'],
      chart: [10, 25, 45, 70, 90, 100], chartL: ['1Q', '2Q', '3Q', '4Q', '5Q', '6Q'], unit: '공정률 · %', steps: ['착수', '설계', '인허가', '시공', '준공'] },
    'LP-DS-08': { tableT: '타입별 분양가', photos: ['외관', '로비', '한강 조망', '커뮤니티', '단지 조경'], co: '더 리버 레지던스', title: '한강 조망 프리미엄 분양', sub: '전용 59·84·112㎡ · 482세대', illo: 'tower',
      kpis: [['482', '세대'], ['6.8억~', '분양가'], ['10%', '계약금'], ['2028.03', '입주']],
      rows: [['59㎡', '6.8억', '186세대'], ['84㎡', '9.4억', '214세대'], ['112㎡', '13.2억', '82세대']], cols: ['타입', '분양가', '세대'],
      chart: [62, 71, 84, 92], chartL: ['1차', '2차', '3차', '4차'], unit: '청약 경쟁률 · 대 1', steps: ['청약', '당첨', '계약', '입주'] },
    'LP-DS-09': { tableT: '시설 구성', photos: ['오션뷰 객실', '인피니티 풀', '스파', '다이닝', '해변 산책로'], co: '예시 리조트', title: '바다 앞 웰니스 리조트', sub: '객실 186 · 스파 · 인피니티 풀', illo: 'resort',
      kpis: [['186실', '객실'], ['2,400㎡', '스파'], ['78%', '평균 점유율'], ['12분', '공항 거리']],
      rows: [['객실', '오션뷰 스위트 42실'], ['스파', '트리트먼트 룸 18'], ['F&B', '레스토랑 3 · 바 2'], ['MICE', '연회장 600석']], cols: ['시설', '내용'],
      chart: [64, 69, 73, 78], chartL: ['23', '24', '25', '26'], unit: '점유율 · %', steps: ['도착', '체크인', '스파', '다이닝'] },
    'LP-DS-10': { tableT: '편입 자산', photos: ['A 타워', 'B 타워', '로비', '주변 업무지구', '전망'], co: 'Private Placement', title: 'Prime Office Fund I', sub: '도심 핵심 오피스 2개 동 · 주요 투자자 제안', illo: 'tower',
      kpis: [['6,800억', '펀드 규모'], ['7.4%', '목표 배당'], ['5년', '운용 기간'], ['98%', '임차율']],
      rows: [['A 타워', '도심 · 연 4.8만㎡', '99%'], ['B 타워', '강남 · 연 3.6만㎡', '97%']], cols: ['자산', '규모', '임차율'],
      chart: [6.8, 7.0, 7.2, 7.4, 7.5], chartL: ['1년', '2년', '3년', '4년', '5년'], unit: '배당률 · %', steps: ['약정', '인수', '운용', '매각'] },
  };
  /** 한 쪽의 예시 그림(SVG 글자) — kind · 타입 id · land(가로 16:9 이면 true) · no(몇째 쪽 · 1부터 · 없으면 그 kind 의 첫 쪽) */
  /* 글자 폭 어림(글자 크기 1 기준) — 한글·전각 1.0 · 영문·숫자 0.58 · 빈칸 0.3 */
  function v2DsEm(s) { var w = 0; String(s || '').split('').forEach(function (ch) { w += /\s/.test(ch) ? 0.3 : ch.charCodeAt(0) > 0x2E7F ? 1.0 : 0.58; }); return w || 1; }
  function v2DsSvg(kind, id, land, no) {
    var t = v2DsType(id), cs = v2DsColors(t), S = V2_DS_SAMPLE[id] || V2_DS_SAMPLE['LP-DS-01'];
    /* 같은 kind 가 한 타입에 여러 번 나오면(사진 다섯 쪽) 몇째인지로 그림·제목을 바꾼다 — 똑같은 쪽이 줄지어 서지 않게 */
    var pages = V2_DS_PAGES[id] || [], pno = no || (pages.indexOf(kind) + 1) || 1, vi = 0;
    for (var pi = 0; pi < pno - 1 && pi < pages.length; pi++) if (pages[pi] === kind) vi++;
    /* 둘째·셋째 같은 kind 는 제목과 예시 줄의 차례를 바꿔 다른 쪽으로 그린다 */
    var VT = { kpi: ['핵심 수치', '투자 포인트', '요약 지표'], twocol: ['사업 개요', '시장 환경', '리스크와 대응'], table: [S.tableT || '구성 요약', '세부 조건', '비교 검토', '추가 자료'],
      chart: ['추이', '전망', '민감도', '비교'], timeline: ['추진 일정', '세부 일정', '결정 시점', '후속 일정'], diagram: ['사업 구도', '자금 흐름', '운영 구조'], map: ['입지', '주변 개발'],
      divider: ['사업 개요', '재무 계획', '실행 계획'], canvas: ['사업모델 캔버스'], price: ['분양가·조건', '할인·혜택'] };
    function vt(k) { var a = VT[k] || [V2_DS_KIND[k] || k]; return a[vi % a.length]; }
    var K0 = S.kpis; /* 뜻으로 집는 칸(분양가·계약금)은 돌리기 전 차례로 읽는다 */
    if (vi) { var rot = function (a) { a = (a || []).slice(); for (var q0 = 0; q0 < vi; q0++) a.push(a.shift()); return a; };
      S = Object.assign({}, S, { rows: rot(S.rows), kpis: rot(S.kpis), steps: rot(S.steps), chart: vi % 2 ? S.chart.slice().reverse() : S.chart, chartL: S.chartL }); }
    /* 참조 색 넷의 차례는 타입마다 뜻이 다르다(09 는 넷째가 강조색) — 채도가 가장 큰 것이 강조, 흰색이 아닌 가장 밝은 것이 옅은 바탕 */
    function rgb(c) { var m = /^#([0-9a-f]{6})$/i.exec(c || ''); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    var ink = cs[0] || '#0A1419', acc = '#577508', tint = '#F2F2F5', bestS = -1, bestL = -1;
    cs.slice(1).forEach(function (c) { var v = rgb(c); if (!v) return; var mx = Math.max(v[0], v[1], v[2]), mn = Math.min(v[0], v[1], v[2]), sat = mx ? (mx - mn) / mx : 0, lum = (v[0] * 0.299 + v[1] * 0.587 + v[2] * 0.114) / 255;
      if (lum < 0.75 && sat > bestS) { bestS = sat; acc = c; }
      if (lum >= 0.85 && mn < 255 && lum > bestL) { bestL = lum; tint = c; } });
    var mono = id === 'LP-DS-10' || id === 'LP-DS-04';   /* 프리미엄·공공은 무채색 — 강조는 한 곳에만 */
    var bg = '#FFFFFF', txt = '#0A1419', sub = '#5B6470', hair = '#DDE1E6', soft = '#EEF0F3';
    var W = land ? 320 : 210, H = land ? 180 : 297, P = land ? 16 : 16, iw = W - P * 2, FF = 'Paperlogy,Cambria,sans-serif';
    var o = [];
    function f1(n) { return (+n).toFixed(1); }
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function r(x, y, w, h, f, rx, extra) { o.push('<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(Math.max(0, w)) + '" height="' + f1(Math.max(0, h)) + '" fill="' + f + '"' + (rx ? ' rx="' + rx + '"' : '') + (extra || '') + '/>'); }
    function ln(x1, y1, x2, y2, c, sw) { o.push('<line x1="' + f1(x1) + '" y1="' + f1(y1) + '" x2="' + f1(x2) + '" y2="' + f1(y2) + '" stroke="' + c + '" stroke-width="' + (sw || 0.5) + '"/>'); }
    function tx(x, y, s, size, c, w, anchor, ls) { o.push('<text x="' + f1(x) + '" y="' + f1(y) + '" font-family="' + FF + '" font-size="' + size + '" font-weight="' + (w || 400) + '" fill="' + c + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + (ls ? ' letter-spacing="' + ls + '"' : '') + '>' + esc(s) + '</text>'); }
    /* 한 줄 제목은 칸 폭에 맞춰 글자를 줄인다 — 넘치면 그림 틀이 잘라 버린다 (Codex #319) */
    function fit(s, base, maxw) { return Math.min(base, Math.floor(maxw / v2DsEm(s) * 10) / 10); }
    function lines(x, y, w, n, gap, c) { for (var i = 0; i < n; i++) r(x, y + i * (gap || 5), w * (i === n - 1 ? 0.62 : (i % 3 === 1 ? 0.92 : 1)), 1.5, c || '#C9CED5'); }
    /* 그림 — 타입 색의 벡터 장면(사진 대신 · 받아 오지 않는다) */
    function illo(x, y, w, h, darkBg) {
      var sky = darkBg ? '#18232B' : (mono ? '#E4E6E9' : tint), g1 = mono ? '#8C939B' : acc, g2 = mono ? '#5E666F' : ink;
      o.push('<g>'); r(x, y, w, h, sky);
      var k = S.illo, base = y + h * 0.78;
      if (k === 'wind') { r(x, base, w, h * 0.22, mono ? '#B5BBC2' : '#9FB7C9'); for (var i = 0; i < 4; i++) { var cx = x + w * (0.18 + i * 0.22), top = y + h * (0.22 + (i % 2) * 0.08); ln(cx, base, cx, top, '#FFFFFF', w * 0.012); var bl = h * 0.2; [0, 120, 240].forEach(function (a) { var rad = (a + i * 20) * Math.PI / 180; ln(cx, top, cx + Math.cos(rad) * bl, top + Math.sin(rad) * bl, '#FFFFFF', w * 0.008); }); } }
      else if (k === 'resort') { var sh = vi % 3; r(x, y + h * 0.62, w, h * 0.38, mono ? '#9AA2AA' : '#3E8FA8'); r(x, y + h * 0.62, w, h * 0.04, '#FFFFFF', 0, ' opacity=".5"');
        o.push('<circle cx="' + f1(x + w * (0.78 - sh * 0.2)) + '" cy="' + f1(y + h * 0.22) + '" r="' + f1(h * 0.09) + '" fill="#FFFFFF" opacity=".8"/>');
        var rx0 = x + w * (0.06 + sh * 0.1); r(rx0, y + h * 0.36, w * 0.5, h * 0.27, '#FFFFFF'); r(rx0, y + h * 0.34, w * 0.5, h * 0.025, g2);
        for (var j = 0; j < 4; j++) for (var jr = 0; jr < 2; jr++) r(rx0 + w * (0.03 + j * 0.12), y + h * (0.41 + jr * 0.1), w * 0.08, h * 0.06, g2, 0, ' opacity=".45"');
        var px0 = x + w * (0.82 - sh * 0.62 > 0.1 ? 0.82 : 0.86); o.push('<path d="M' + f1(px0) + ' ' + f1(y + h * 0.64) + ' Q ' + f1(px0 + w * 0.03) + ' ' + f1(y + h * 0.45) + ' ' + f1(px0 - w * 0.01) + ' ' + f1(y + h * 0.3) + '" stroke="' + g2 + '" stroke-width="' + f1(w * 0.012) + '" fill="none"/>');
        [-40, -10, 20, 160, 200].forEach(function (a) { var rad = a * Math.PI / 180; o.push('<ellipse cx="' + f1(px0 - w * 0.01 + Math.cos(rad) * w * 0.05) + '" cy="' + f1(y + h * 0.3 + Math.sin(rad) * h * 0.04) + '" rx="' + f1(w * 0.055) + '" ry="' + f1(h * 0.018) + '" fill="' + g1 + '" transform="rotate(' + a + ' ' + f1(px0 - w * 0.01 + Math.cos(rad) * w * 0.05) + ' ' + f1(y + h * 0.3 + Math.sin(rad) * h * 0.04) + ')"/>'); }); }
      else if (k === 'warehouse') { r(x, base, w, h * 0.22, '#C7CCD2'); for (var q = 0; q < 3; q++) { var bx = x + w * (0.06 + q * 0.31); o.push('<polygon points="' + f1(bx) + ',' + f1(base) + ' ' + f1(bx) + ',' + f1(y + h * 0.48) + ' ' + f1(bx + w * 0.14) + ',' + f1(y + h * 0.4) + ' ' + f1(bx + w * 0.28) + ',' + f1(y + h * 0.48) + ' ' + f1(bx + w * 0.28) + ',' + f1(base) + '" fill="' + (q === 1 ? g1 : g2) + '"/>'); r(bx + w * 0.08, base - h * 0.14, w * 0.12, h * 0.14, '#FFFFFF', 0, ' opacity=".8"'); } }
      else { /* city · tower · office · civic — 높이가 다른 건물 줄 */
        var bw = [0.12, 0.09, 0.16, 0.1, 0.14, 0.08, 0.13, 0.1], hh = k === 'tower' ? [0.35, 0.5, 0.72, 0.45, 0.6, 0.38, 0.52, 0.3] : [0.3, 0.45, 0.55, 0.36, 0.48, 0.28, 0.42, 0.33], bx2 = x;
        for (var rot = 0; rot < vi; rot++) { bw.push(bw.shift()); hh.unshift(hh.pop()); }
        for (var b = 0; b < bw.length && bx2 < x + w; b++) { var ww = Math.min(w * bw[b], x + w - bx2), top2 = base - h * hh[b], hl = (b === 2 || (k === 'tower' && b === 4));
          r(bx2, top2, ww - w * 0.008, base - top2, hl ? g1 : g2, 0, hl ? '' : ' opacity=".82"');
          for (var wy = top2 + h * 0.05; wy < base - h * 0.04; wy += h * 0.07) r(bx2 + ww * 0.18, wy, ww * 0.6 - w * 0.008, h * 0.018, '#FFFFFF', 0, ' opacity="' + (darkBg ? '.25' : '.35') + '"');
          bx2 += ww; }
        r(x, base, w, h * 0.22, darkBg ? '#0E171D' : '#D5D9DE'); }
      o.push('</g>');
    }
    function tag(x, y, darkBg) { r(x, y - 5.4, 14, 7, darkBg ? 'rgba(255,255,255,.16)' : soft, 1.5); tx(x + 7, y - 0.4, '예시', 4, darkBg ? '#FFFFFF' : sub, 600, 'middle'); }
    function head(no, title, y) { no = pno; tx(P, y, (no < 10 ? '0' : '') + no, 5.4, acc, 700, null, 0.6); tx(P + 11, y, title, land ? 9 : 10, txt, 700); ln(P, y + 4, P + iw, y + 4, txt, 0.6); return y + 12; }
    function foot() { ln(P, H - 10, P + iw, H - 10, hair, 0.4); tx(P, H - 5, S.co + ' · ' + S.title, 3.6, sub); tag(W - P - 14, H - 3.6); }
    var dark = kind === 'cover' || kind === 'closing';
    r(0, 0, W, H, dark ? ink : (kind === 'divider' ? (mono ? '#F4F5F7' : tint) : bg));
    var y = P + 8;
    if (kind === 'cover') {
      if (land) illo(W * 0.5, 0, W * 0.5, H, true); else illo(0, H * 0.46, W, H * 0.54, true);
      tx(P, P + 6, (t ? t.name : '').toUpperCase(), 4.4, mono ? '#C9CED5' : acc === ink ? '#FFFFFF' : '#C8E27A', 600, null, 0.8);
      var ty = land ? H * 0.42 : H * 0.24;
      tx(P, ty, S.title, fit(S.title, land ? 15 : 17, land ? W * 0.5 - P - 4 : iw), '#FFFFFF', 700);
      tx(P, ty + (land ? 10 : 11), S.sub, land ? 5.6 : 6, 'rgba(255,255,255,.72)');
      r(P, ty + (land ? 16 : 18), 22, 1.6, mono ? '#FFFFFF' : acc);
      tx(P, land ? H - P : H * 0.46 - 8, S.co + ' · 2026.10', 4.4, 'rgba(255,255,255,.6)');
      tag(land ? W * 0.5 - P - 14 : W - P - 14, P + 6, true);
    } else if (kind === 'closing') {
      if (land) illo(0, 0, W * 0.42, H, true); else illo(0, 0, W, H * 0.4, true);
      var cx0 = land ? W * 0.42 + P : P, cy0 = land ? H * 0.4 : H * 0.55;
      tx(cx0, cy0, '감사합니다', land ? 16 : 18, '#FFFFFF', 700);
      tx(cx0, cy0 + 11, S.co, 6, 'rgba(255,255,255,.75)', 600);
      r(cx0, cy0 + 17, 22, 1.6, mono ? '#FFFFFF' : acc);
      tx(cx0, H - P, 'Strictly Private and Confidential', 4, 'rgba(255,255,255,.5)', 400, null, 0.4);
      tag(W - P - 14, H - P + 1, true);
    } else if (kind === 'divider') {
      var no = vi + 2;
      tx(P, land ? H * 0.55 : H * 0.48, '0' + no, land ? 54 : 64, mono ? '#C9CED5' : acc, 700);
      tx(P, (land ? H * 0.55 : H * 0.48) + 14, vt('divider'), land ? 12 : 13, txt, 700);
      tx(P, (land ? H * 0.55 : H * 0.48) + 23, S.sub, 5, sub);
      foot();
    } else {
      if (kind === 'toc') {
        y = head(1, '목차', y);
        var items = ['사업 개요', '시장·입지', '사업 구조', '재무 계획', '추진 일정'];
        items.forEach(function (it, i) { var yy = y + 6 + i * (land ? 21 : 34); tx(P, yy, '0' + (i + 1), land ? 10 : 13, i === 0 ? acc : '#B9BFC7', 700); tx(P + (land ? 20 : 24), yy, it, land ? 7 : 8, txt, 600); tx(P + iw, yy, String(3 + i * 3), 5, sub, 400, 'end'); ln(P, yy + 5, P + iw, yy + 5, hair, 0.4); });
      } else if (kind === 'kpi') {
        y = head(pno, vt('kpi'), y);
        var n = land ? 4 : 2, rowsN = land ? 1 : 2, cw = (iw - (n - 1) * 6) / n, ch = land ? 52 : 64;
        S.kpis.forEach(function (kp, i) { var cx = P + (i % n) * (cw + 6), cy = y + Math.floor(i / n) * (ch + 6); r(cx, cy, cw, ch, i === 0 ? ink : (mono ? '#F4F5F7' : tint), 2);
          tx(cx + 6, cy + ch * 0.55, kp[0], land ? 13 : 16, i === 0 ? '#FFFFFF' : (mono ? txt : acc), 700); tx(cx + 6, cy + ch - 7, kp[1], 4.6, i === 0 ? 'rgba(255,255,255,.7)' : sub, 600); });
        var ly = y + rowsN * (ch + 6) + 6; tx(P, ly + 4, '안정적 현금흐름과 분명한 회수 경로를 한 쪽에 보입니다.', land ? 5.4 : 5.6, txt, 600); lines(P, ly + 10, iw, land ? 3 : 6, 5);
      } else if (kind === 'table') {
        y = head(pno, vt('table'), y);
        var cols = S.cols, rh = land ? 15 : 18, c1 = cols.length > 2 ? [0, 0.5, 0.78] : [0, 0.36];
        r(P, y, iw, rh, ink); cols.forEach(function (c, i) { tx(P + 4 + iw * c1[i], y + rh * 0.65, c, 4.8, '#FFFFFF', 600); });
        S.rows.forEach(function (row, i) { var yy = y + rh * (i + 1); if (i % 2) r(P, yy, iw, rh, '#F7F8FA'); row.forEach(function (cell, j) { tx(P + 4 + iw * c1[j], yy + rh * 0.64, cell, 4.8, j === 0 ? txt : (j === row.length - 1 && !mono ? acc : txt), j === 0 ? 600 : 400); }); ln(P, yy + rh, P + iw, yy + rh, hair, 0.4); });
        var ty2 = y + rh * (S.rows.length + 1) + 10; tx(P, ty2, '주: 예시 값 — 실제 사업 자료가 아닙니다.', 4, sub); if (!land) lines(P, ty2 + 8, iw, 8, 5);
      } else if (kind === 'chart') {
        y = head(pno, vt('chart'), y);
        tx(P, y + 4, S.unit, 4.4, sub, 600);
        var vals = S.chart, mx = Math.max.apply(null, vals.map(Math.abs)) || 1, neg = vals.some(function (v) { return v < 0; }),
          gh = land ? H - y - 40 : H * 0.42, gy = y + 10, zero = neg ? gy + gh * 0.55 : gy + gh, gw = iw / vals.length;
        [0.25, 0.5, 0.75].forEach(function (g) { ln(P, gy + gh * g, P + iw, gy + gh * g, soft, 0.4); });
        vals.forEach(function (v, i) { var bh = Math.abs(v) / mx * (neg ? gh * 0.5 : gh * 0.92), last = i === vals.length - 1; var bx = P + i * gw + gw * 0.2;
          r(bx, v >= 0 ? zero - bh : zero, gw * 0.6, bh, last ? acc : (v < 0 ? '#C9CED5' : (mono ? '#8C939B' : ink)), 0.6);
          tx(bx + gw * 0.3, (v >= 0 ? zero - bh : zero + bh + 5) - 2, String(v), 4, last ? acc : sub, last ? 700 : 400, 'middle'); tx(bx + gw * 0.3, gy + gh + 7, S.chartL[i], 4, sub, 400, 'middle'); });
        ln(P, zero, P + iw, zero, txt, 0.6);
        if (!land) { var ky = gy + gh + 20; tx(P, ky, '마지막 해 값이 가장 큽니다 — 강조색 한 곳에만.', 5.6, txt, 600); lines(P, ky + 7, iw, 6, 5); }
      } else if (kind === 'diagram' || kind === 'canvas') {
        y = head(pno, vt(kind), y);
        if (kind === 'canvas') { var cc = land ? 3 : 2, cr = Math.ceil(S.rows.length / cc) || 2, mw = (iw - (cc - 1) * 5) / cc, mh = land ? (H - y - 24) / cr - 5 : 52;
          S.rows.forEach(function (row, i) { var mx2 = P + (i % cc) * (mw + 5), my = y + Math.floor(i / cc) * (mh + 5); r(mx2, my, mw, mh, i === 1 ? ink : (mono ? '#F4F5F7' : tint), 2); tx(mx2 + 5, my + 9, row[0], 5.6, i === 1 ? '#FFFFFF' : acc, 700); tx(mx2 + 5, my + 17, row[1], 4.4, i === 1 ? 'rgba(255,255,255,.8)' : txt); lines(mx2 + 5, my + 23, mw - 10, land ? 1 : 4, 5, i === 1 ? 'rgba(255,255,255,.3)' : '#C9CED5'); });
        } else { var nodes = S.rows.slice(0, 4), bw2 = land ? 62 : 80, bh2 = land ? 22 : 26, cx2 = P + iw / 2, cy2 = y + (land ? 52 : 92);
          r(cx2 - bw2 / 2, cy2 - bh2 / 2, bw2, bh2, ink, 2); tx(cx2, cy2 + 2, nodes[0][0], 6, '#FFFFFF', 700, 'middle');
          var pos = land ? [[-1, 0], [1, 0], [0, 1]] : [[0, -1], [-1, 1], [1, 1]];
          nodes.slice(1).forEach(function (nd, i) { var px = cx2 + pos[i][0] * (land ? 100 : 54), py = cy2 + pos[i][1] * (land ? 46 : 70); ln(cx2, cy2, px, py, acc, 0.9);
            r(px - bw2 / 2, py - bh2 / 2, bw2, bh2, mono ? '#F4F5F7' : tint, 2, ' stroke="' + acc + '" stroke-width=".6"'); tx(px, py + 1, nd[0], 5, txt, 700, 'middle'); tx(px, py + 7, nd[1], 3.6, sub, 400, 'middle'); });
          if (!land) { var dy = cy2 + 110; tx(P, dy, '자금은 화살표 방향으로 흐릅니다.', 5.6, txt, 600); lines(P, dy + 7, iw, 4, 5); } }
      } else if (kind === 'map') {
        y = head(pno, vt('map'), y);
        var mw2 = land ? iw * 0.6 : iw, mh2 = land ? H - y - 22 : H * 0.48;
        r(P, y, mw2, mh2, '#E8EBE5'); o.push('<path d="M' + f1(P) + ' ' + f1(y + mh2 * 0.7) + ' C ' + f1(P + mw2 * 0.3) + ' ' + f1(y + mh2 * 0.55) + ', ' + f1(P + mw2 * 0.6) + ' ' + f1(y + mh2 * 0.9) + ', ' + f1(P + mw2) + ' ' + f1(y + mh2 * 0.72) + '" stroke="#A9C6D9" stroke-width="' + f1(mh2 * 0.08) + '" fill="none"/>');
        [[0.1, 0, 0.3, 1], [0.6, 0, 0.75, 1], [0, 0.35, 1, 0.3]].forEach(function (s) { ln(P + mw2 * s[0], y + mh2 * s[1], P + mw2 * s[2], y + mh2 * s[3], '#FFFFFF', 2.4); });
        o.push('<polygon points="' + [[0.38, 0.36], [0.56, 0.32], [0.6, 0.56], [0.4, 0.6]].map(function (pt) { return f1(P + pt[0] * mw2) + ',' + f1(y + pt[1] * mh2); }).join(' ') + '" fill="rgba(192,0,0,.2)" stroke="#C00000" stroke-width=".9"/>');
        tx(P + mw2 * 0.62, y + mh2 * 0.3, '대상지', 4.6, '#C00000', 700); tx(P + mw2 - 4, y + 8, 'N ↑', 4.4, txt, 700, 'end'); r(P + 4, y + mh2 - 7, 20, 1.2, txt); tx(P + 4, y + mh2 - 9, '500m', 3.4, txt);
        var sx = land ? P + mw2 + 8 : P, sy = land ? y + 4 : y + mh2 + 12;
        ['지하철 2호선 도보 4분', '고속도로 IC 6분', '반경 1km 오피스 38개 동'].forEach(function (s, i) { r(sx, sy + i * 12 - 4, 2.4, 6, acc); tx(sx + 6, sy + i * 12 + 1, s, 4.6, txt, 600); });
      } else if (kind === 'timeline') {
        y = head(pno, vt('timeline'), y);
        var qs = land ? 8 : 6, gx = P + (land ? 46 : 40), gw2 = (P + iw - gx) / qs;
        for (var q2 = 0; q2 < qs; q2++) { tx(gx + q2 * gw2 + gw2 / 2, y + 4, (q2 % 4 + 1) + 'Q', 4, sub, 600, 'middle'); ln(gx + q2 * gw2, y + 7, gx + q2 * gw2, y + 8 + S.steps.length * 16, soft, 0.4); }
        S.steps.forEach(function (s, i) { var yy = y + 12 + i * 16; tx(P, yy + 5, s, 5, txt, 600); r(gx + (i * qs / (S.steps.length + 0.6)) * gw2, yy, gw2 * (qs / S.steps.length) * 1.1, 7, i === 1 ? acc : (mono ? '#8C939B' : ink), 1.5); });
        var my2 = y + 16 + S.steps.length * 16; o.push('<polygon points="' + f1(gx + gw2 * 2.5) + ',' + f1(my2) + ' ' + f1(gx + gw2 * 2.5 + 3) + ',' + f1(my2 + 5) + ' ' + f1(gx + gw2 * 2.5 - 3) + ',' + f1(my2 + 5) + '" fill="#C00000"/>'); tx(gx + gw2 * 2.5 + 5, my2 + 5, '투자 결정', 4.2, '#C00000', 700);
        if (!land) lines(P, my2 + 18, iw, 8, 5);
      } else if (kind === 'photo') {
        var capT = (S.photos || ['외관', '공용 공간', '조망', '커뮤니티', '주변 환경'])[vi % 5];
        if (land) { illo(W * 0.42, 0, W * 0.58, H, false); y = head(pno, capT, P + 8); tx(P, y + 8, S.sub, 6, txt, 700); lines(P, y + 16, W * 0.42 - P * 2, 6, 5); }
        else { illo(0, 0, W, H * 0.5, false); tx(P, H * 0.5 + 10, capT.toUpperCase(), 4.6, acc, 700, null, 0.8); tx(P, H * 0.5 + 21, vi ? capT + ' — ' + S.co : S.title, fit(vi ? capT + ' — ' + S.co : S.title, 11, iw), txt, 700); tx(P, H * 0.5 + 28, S.sub, 5.4, sub); r(P, H * 0.5 + 33, 18, 1.4, acc);
          S.kpis.slice(0, 3).forEach(function (kp, i) { var kx = P + i * (iw / 3); tx(kx, H * 0.5 + 54, kp[0], 11, mono ? txt : acc, 700); tx(kx, H * 0.5 + 62, kp[1], 4.4, sub, 600); }); lines(P, H * 0.5 + 76, iw, 7, 5); }
      } else if (kind === 'price') {
        y = head(pno, vt('price'), y);
        r(P, y, iw, land ? 40 : 54, ink, 2); tx(P + 8, y + (land ? 18 : 22), '분양가', 5, 'rgba(255,255,255,.7)', 600); tx(P + 8, y + (land ? 33 : 42), K0[1][0], land ? 18 : 24, '#FFFFFF', 700);
        tx(P + iw - 8, y + (land ? 33 : 42), '계약금 ' + K0[2][0] + ' · 중도금 무이자', 4.8, mono ? '#FFFFFF' : '#FFD9A8', 700, 'end');
        var py2 = y + (land ? 48 : 64), pc = S.rows.length, pw = (iw - (pc - 1) * 5) / pc, ph = land ? H - py2 - 20 : 70;
        S.rows.forEach(function (row, i) { var px2 = P + i * (pw + 5); r(px2, py2, pw, ph, i === 1 ? acc : (mono ? '#F4F5F7' : tint), 2); tx(px2 + 5, py2 + 11, row[0], 7, i === 1 ? '#FFFFFF' : txt, 700); tx(px2 + 5, py2 + 22, row[1], 8, i === 1 ? '#FFFFFF' : acc, 700); tx(px2 + 5, py2 + 30, row[2], 4.4, i === 1 ? 'rgba(255,255,255,.8)' : sub); });
        if (!land) lines(P, py2 + ph + 12, iw, 6, 5);
      } else { /* twocol */
        y = head(pno, vt('twocol'), y);
        var cw3 = (iw - 8) / 2;
        tx(P, y + 4, S.sub, land ? 6 : 6.4, txt, 700); lines(P, y + 12, cw3, land ? 14 : 24, 5);
        var ry = y + 2; r(P + cw3 + 8, ry, cw3, land ? 52 : 72, mono ? '#F4F5F7' : tint, 2); tx(P + cw3 + 14, ry + 14, S.kpis[0][0], land ? 14 : 18, mono ? txt : acc, 700); tx(P + cw3 + 14, ry + 22, S.kpis[0][1], 4.6, sub, 600);
        lines(P + cw3 + 14, ry + 30, cw3 - 12, land ? 3 : 6, 5); if (!land) { illo(P + cw3 + 8, ry + 80, cw3, 70, false); lines(P + cw3 + 8, ry + 158, cw3, 6, 5); }
      }
      foot();
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc((V2_DS_KIND[kind] || kind) + ' 예시 쪽 — ' + S.title) + '">' + o.join('') + '</svg>';
  }
  function v2DsType(id) { for (var i = 0; i < V2_DS.length; i++) if (V2_DS[i].id === id) return V2_DS[i]; return null; }
  function v2DsColors(t) { return t ? t.refs.map(function (r) { return V2_DS_TOKENS[r]; }) : []; }
  /* 사용자 지정 IM 기본 크기 (지침 §5.1 · pt) — 출력기에 잇는 자리는 질문 목록에 올렸다 */
  var V2_IM_SIZES = [['표지 제목', 18], ['슬라이드 제목', 14], ['핵심 숫자', 10], ['본문', 12], ['표 안의 글자', 10], ['각주', 8], ['주석', 7]];

  var V2_FORMATS = [
    { id: 'pdf', name: 'PDF', ok: true },
    /* 한글은 «HWPX» 다 — 바이너리 .hwp 는 이름만 바꿔 처리하지 않는다 (HWPX 지침 v1.0 §2). id 는 서버 사양(outputspec)과 같은 'hwp' 그대로 */
    { id: 'hwp', name: '한글(HWPX)', ok: false, why: '한글(HWPX)은 준비 중입니다 — 생성·편집 도구와 한글 화면 검수 환경을 아직 시험하지 않았습니다. 지금 나가는 것은 PDF 와 데스크탑 HTML 입니다.' },
    { id: 'docx', name: '워드(DOCX)', ok: false },
    { id: 'pptx', name: 'PPT(PPTX)', ok: false },
    { id: 'html', name: '데스크탑 HTML', ok: true },
    { id: 'mhtml', name: '모바일 HTML', ok: false },
  ];

  /* 한글 문서(HWPX) 두 길 — HWPX 지침 v1.0 §3 · §4 (create_new · edit_existing 을 섞지 않는다).
   * ★ 둘 다 «준비 중»이다 — 생성(kist-aix/hwpx)·편집(hwpx-editing-skill) 어댑터와 한글 렌더 워커를 아직 안 붙였다(§13 0~4단계).
   *   10종 디자인 선택 ≠ 10종 HWPX 지원 (§7) — ready 에 든 타입만 연다. 지금은 비어 있다. */
  var V2_HWPX = {
    starts: [
      { id: 'create_new', name: '새 보고서 만들기', desc: '보고서 유형과 지원 양식을 선택해 새 문서 작성' },
      { id: 'edit_existing', name: '기존 양식 가져오기', desc: '내 HWPX 양식을 불러와 필요한 부분만 수정' },
    ],
    why: '한글 문서(HWPX)는 준비 중입니다 — 기본 보고서 양식의 생성·검사부터 시험한 뒤 엽니다. 그전에는 PDF·데스크탑 HTML 로 받습니다.',
    ready: [],
  };

  return {
    BUILD: LP_BUILD,
    STEPS: STEPS, WHY: WHY, EMBED_CSS: EMBED_CSS,
    SECTIONS: SECTIONS, sectionState: sectionState, sectionOfStep: sectionOfStep,
    SECTION: SECTION, OUTPUTS_SECTION: OUTPUTS_SECTION,
    FILES_SECTION: FILES_SECTION, TABS: TABS, HUB: HUB,
    stepState: stepState, urlFor: urlFor, stepOfFile: stepOfFile,
    sectionProgress: sectionProgress,
    BUILD_ATTR: BUILD_ATTR, buildOf: buildOf, buildLabel: buildLabel, stampInto: stampInto,
    insideLinkPilot: insideLinkPilot,
    appDepth: appDepth, midFrames: midFrames, nestedAppNote: nestedAppNote,
    resolveApi: resolveApi,
    lpFetch: lpFetch, apiWhy: apiWhy, API_TIMEOUT_MS: API_TIMEOUT_MS,
    apiNote: apiNote,
    API_FALLBACK: API_FALLBACK,
    tokensLoaded: tokensLoaded, TOKENS_MISSING: TOKENS_MISSING,
    openSection: openSection, OPEN_EVENT: OPEN_EVENT, sectionUrl: sectionUrl,
    strandedBar: strandedBar, showStranded: showStranded,
    selfPlaced: selfPlaced, hideOwnChrome: hideOwnChrome,
    heroSvg: heroSvg, heroFrom: heroFrom, headEl: headEl, HERO_LIME: HERO_LIME,
    HEAD_CSS: HEAD_CSS, headCssInto: headCssInto,
    V2_CATS: V2_CATS, V2_DOCS: V2_DOCS, ENGINE_DOCS: ENGINE_DOCS, V2_SOON: V2_SOON,
    v2Doc: v2Doc, v2DocsOf: v2DocsOf, v2DocOfEngine: v2DocOfEngine, v2DocMeta: v2DocMeta,
    V2_STEPS: V2_STEPS, v2StepOf: v2StepOf, v2Steps: v2Steps, v2Progress: v2Progress, v2Next: v2Next,
    V2_FACT_KEYS: V2_FACT_KEYS, v2Tag: v2Tag, v2FactRows: v2FactRows, v2Conflicts: v2Conflicts,
    V2_FORMATS: V2_FORMATS, V2_HWPX: V2_HWPX, V2_PAGES: V2_PAGES, V2_LANGS: V2_LANGS,
    V2_DS: V2_DS, V2_DS_TOKENS: V2_DS_TOKENS, v2DsType: v2DsType, v2DsColors: v2DsColors, v2DsPages: v2DsPages, v2DsSvg: v2DsSvg, V2_DS_KIND: V2_DS_KIND, V2_DS_SAMPLE: V2_DS_SAMPLE, v2DsEm: v2DsEm, V2_IM_SIZES: V2_IM_SIZES,
  };
}));
