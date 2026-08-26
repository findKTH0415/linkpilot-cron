/**
 * gate-core.js — 유료 기능 접근 판정. 모든 유료 화면이 이것 하나를 쓴다.
 *
 * 화면마다 판정을 따로 두면 반드시 갈린다. 한쪽은 막고 한쪽은 여는 상태가
 * 되면 어느 쪽이 맞는지 알 수 없고, 뚫린 쪽은 한참 뒤에 발견된다.
 *
 * ★★ 이 파일은 '화면을 무엇으로 그릴지'만 정한다. 권한을 강제하지 않는다.
 *   브라우저 코드는 사용자가 고칠 수 있다. 실제 차단은 서버가 한다 —
 *   데이터를 주는 API 가 세션과 플랜을 다시 확인해야 한다.
 *   이 파일만 믿고 서버 검사를 생략하면 개발자도구로 뚫린다.
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 동작한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotGate = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * ★ **이 스크립트가 어느 판인가** 〈2026-08-23 · D-93 사고〉.
   *   `build-stamp.js` 가 채운다 — 손으로 고치지 않는다. 화면이 자기
   *   지문과 대 보고 다르면 「함수가 없다」로 죽기 전에 사람 말로 알린다.
   */
  var LP_BUILD = 'ec3d1270';

  var PLAN_RANK = { free: 0, basic: 1, pro: 2, business: 3 };

  /**
   * 접근 판정 — 인증 먼저, 그 다음 플랜.
   *
   * 순서가 중요하다. 로그인 안 한 사람에게 "Pro 플랜이 필요합니다"라고 하면
   * 무엇을 해야 할지 모른다. 로그인부터 안내한다.
   *
   * @param {object} session { authenticated, planId, status }
   * @param {string} requiredPlan 기본 'pro'
   * @returns {{allowed:boolean, reason:string|null, requiredPlan:string}}
   */
  function access(session, requiredPlan) {
    var need = requiredPlan || 'pro';
    var s = session || {};

    if (!s.authenticated) {
      return { allowed: false, reason: 'unauthenticated', requiredPlan: need };
    }
    // 플랜 정보를 못 받은 것과 무료인 것은 다르다. 무료로 단정하지 않는다
    if (s.planId === null || s.planId === undefined || s.planId === '') {
      return { allowed: false, reason: 'plan-unknown', requiredPlan: need };
    }
    if (s.status === 'expired') {
      return { allowed: false, reason: 'expired', requiredPlan: need };
    }
    var have = PLAN_RANK[s.planId];
    if (have === undefined) {
      // 모르는 플랜 코드를 통과시키지 않는다 (오타 하나로 유료 화면이 열리면 안 된다)
      return { allowed: false, reason: 'plan-unknown', requiredPlan: need };
    }
    if (have < (PLAN_RANK[need] === undefined ? 99 : PLAN_RANK[need])) {
      return { allowed: false, reason: 'plan', requiredPlan: need };
    }
    return { allowed: true, reason: null, requiredPlan: need };
  }

  /**
   * 판정 사유 → 화면에 띄울 문구.
   * @param {object} a access() 결과
   * @param {string} planName 요구 플랜의 표시 이름
   * @param {string} featureName 기능 이름 (화면마다 다르다)
   */
  function accessMessage(a, planName, featureName) {
    var what = featureName || '이 기능';
    switch (a.reason) {
      case 'unauthenticated':
        return { title: '로그인이 필요합니다', body: what + '은 로그인한 사용자만 쓸 수 있습니다.', cta: '로그인' };
      case 'expired':
        return { title: '멤버십이 만료되었습니다',
          body: '갱신하면 다시 사용할 수 있습니다. 기존 자료는 그대로 보관됩니다.', cta: '멤버십 갱신' };
      case 'plan':
        // 화면마다 '무엇을 얻는지'를 덧붙인다. 안 보여주면 살 이유를 모른다
        return { title: (planName || a.requiredPlan) + ' 플랜부터 사용할 수 있습니다',
          body: what + '은 유료 플랜에서 제공됩니다.', cta: '플랜 보기' };
      case 'plan-unknown':
        return { title: '멤버십 정보를 확인할 수 없습니다',
          body: '잠시 후 다시 시도하거나, 문제가 계속되면 관리자에게 문의하세요.', cta: '다시 시도' };
      default:
        return null;
    }
  }

  /** 게이트 화면 아이콘 */
  function gateIcon(reason) {
    return reason === 'unauthenticated' ? '🔑' : reason === 'expired' ? '⏳' : '🔒';
  }

  // ── 날짜 (KST) — 유료 화면들이 공통으로 쓴다 ──────────────────────

  function kstYmd(date) {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date || new Date());
  }

  /** 'YYYY.M.D (요일)' */
  function kstLabel(date) {
    var p = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
    }).formatToParts(date || new Date());
    var g = function (t) { return (p.filter(function (x) { return x.type === t; })[0] || {}).value || ''; };
    return g('year') + '.' + g('month') + '.' + g('day') + ' (' + g('weekday') + ')';
  }

  /** 날짜 문자열끼리 비교하므로 시간대 영향을 받지 않는다 */
  function dday(dateStr, today) {
    if (!dateStr) return null;
    var d = String(dateStr).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    var t = today || kstYmd();
    return Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
      - Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10))) / 86400000);
  }

  function ddayLabel(n) {
    if (n === null) return '';
    if (n === 0) return 'D-DAY';
    return n > 0 ? 'D-' + n : 'D+' + (-n);
  }

  return {
    BUILD: LP_BUILD,
    PLAN_RANK: PLAN_RANK,
    access: access, accessMessage: accessMessage, gateIcon: gateIcon,
    kstYmd: kstYmd, kstLabel: kstLabel, dday: dday, ddayLabel: ddayLabel,
  };
}));
