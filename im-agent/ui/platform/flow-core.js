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
      id: 'fields', no: 2, name: '가이드 필드 입력', file: 'fields.html',
      needsProject: true,
      note: '수치를 출처와 함께 넣는다. 출처가 없으면 저장 버튼이 열리지 않고, '
        + '계산 항목은 입력란을 만들지 않는다. 자동으로 채워지는 줄에는 출처를 묻지 않는다.',
    },
    {
      id: 'spec', no: 3, name: '출력 사양 확정', file: 'reports.html',
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
  ].join('');

  /** 잠긴 이유 — 화면에 그대로 띄운다. 이유 없이 회색이면 고장으로 보인다 */
  var WHY = {
    project: '1단계에서 프로젝트를 먼저 만듭니다',
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
    if (step.needsProject && c.projectId) {
      url += '?project=' + encodeURIComponent(c.projectId);
    }
    return url;
  }

  /** 화면 파일에서 단계를 되찾는다 (iframe 이 스스로 이동했을 때 rail 을 맞춘다) */
  function stepOfFile(file) {
    var f = String(file || '').split('/').pop().split('?')[0];
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].file === f) return STEPS[i];
    return null;
  }

  return {
    STEPS: STEPS, WHY: WHY, EMBED_CSS: EMBED_CSS,
    stepState: stepState, urlFor: urlFor, stepOfFile: stepOfFile,
  };
}));
