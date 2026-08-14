/**
 * board-core.js — 업무지시 보드의 판정 로직.
 *
 * 화면 그리기와 분리한 이유: 여기가 테스트 대상이다.
 * 접근 판정이 틀리면 무료 회원에게 유료 화면이 열리거나,
 * 유료 회원이 잠긴 화면을 본다. 둘 다 사고다.
 *
 * ★★ 이 파일은 '화면을 무엇으로 그릴지'만 정한다. 권한을 강제하지 않는다.
 *   브라우저 코드는 사용자가 고칠 수 있다. 실제 차단은 서버가 한다 —
 *   보드 데이터를 주는 API 가 세션과 플랜을 다시 확인해야 한다.
 *   이 파일만 믿고 서버 검사를 생략하면 개발자도구로 뚫린다.
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 동작한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotBoard = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PLAN_RANK = { free: 0, basic: 1, pro: 2, business: 3 };

  /** 보드 칸. 순서가 곧 진행 방향이다 */
  var STATUSES = [
    { id: 'todo', label: '지시 대기', tone: 'idle' },
    { id: 'doing', label: '진행 중', tone: 'active' },
    { id: 'review', label: '검토 요청', tone: 'warn' },
    { id: 'done', label: '완료', tone: 'ok' },
  ];

  var PRIORITIES = [
    { id: 'urgent', label: '긴급', tone: 'bad' },
    { id: 'normal', label: '보통', tone: 'idle' },
  ];

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

  /** 판정 사유 → 화면에 띄울 문구 */
  function accessMessage(a, planName) {
    switch (a.reason) {
      case 'unauthenticated':
        return { title: '로그인이 필요합니다', body: '업무지시 보드는 로그인한 사용자만 볼 수 있습니다.', cta: '로그인' };
      case 'expired':
        return { title: '멤버십이 만료되었습니다', body: '갱신하면 보드를 다시 사용할 수 있습니다. 기존 지시는 그대로 보관됩니다.', cta: '멤버십 갱신' };
      case 'plan':
        return { title: (planName || a.requiredPlan) + ' 플랜부터 사용할 수 있습니다',
          body: '업무지시 보드는 담당자에게 일을 배정하고 진행을 추적하는 기능입니다.', cta: '플랜 보기' };
      case 'plan-unknown':
        return { title: '멤버십 정보를 확인할 수 없습니다',
          body: '잠시 후 다시 시도하거나, 문제가 계속되면 관리자에게 문의하세요.', cta: '다시 시도' };
      default:
        return null;
    }
  }

  // ── 날짜 (KST) ────────────────────────────────────────────────────

  function kstYmd(date) {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date || new Date());
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

  // ── 보드 데이터 ───────────────────────────────────────────────────

  /** 알 수 없는 상태는 버리지 않고 '지시 대기'로 모은다 — 카드가 사라지면 일이 사라진다 */
  function normalizeStatus(s) {
    var id = String(s || '').trim();
    for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].id === id) return id;
    return 'todo';
  }

  function normalizePriority(p) {
    return String(p || '').trim() === 'urgent' ? 'urgent' : 'normal';
  }

  /**
   * 카드 정렬 — 완료 칸을 빼면 급한 것이 위로 온다.
   *   긴급 먼저 → 마감이 가까운 순 → 마감 없는 것은 맨 뒤
   * 완료 칸은 최근 완료가 위로 온다.
   */
  function sortTasks(tasks, statusId, today) {
    var t = (tasks || []).slice();
    if (statusId === 'done') {
      return t.sort(function (a, b) {
        return String(b.doneAt || b.due || '').localeCompare(String(a.doneAt || a.due || ''));
      });
    }
    return t.sort(function (a, b) {
      var pa = normalizePriority(a.priority) === 'urgent' ? 0 : 1;
      var pb = normalizePriority(b.priority) === 'urgent' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      var da = dday(a.due, today);
      var db = dday(b.due, today);
      if (da === null && db === null) return 0;
      if (da === null) return 1;      // 마감 없는 것은 뒤로
      if (db === null) return -1;
      return da - db;
    });
  }

  /** 상태별로 나눈다. 빈 칸도 반환한다 — 칸이 사라지면 옮길 곳이 없어진다 */
  function groupByStatus(tasks, today) {
    return STATUSES.map(function (s) {
      var items = (tasks || []).filter(function (t) { return normalizeStatus(t.status) === s.id; });
      return { status: s, tasks: sortTasks(items, s.id, today), count: items.length };
    });
  }

  /** 필터 — 담당자·우선순위·검색어. 빈 값은 전체를 뜻한다 */
  function filterTasks(tasks, f) {
    f = f || {};
    var q = String(f.q || '').trim().toLowerCase();
    return (tasks || []).filter(function (t) {
      if (f.assignee && t.assignee !== f.assignee) return false;
      if (f.priority && normalizePriority(t.priority) !== f.priority) return false;
      if (q) {
        var hay = [t.title, t.detail, t.assignee, t.project].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /** 담당자 목록 — 필터 드롭다운용 */
  function assignees(tasks) {
    var seen = {};
    (tasks || []).forEach(function (t) { if (t.assignee) seen[t.assignee] = true; });
    return Object.keys(seen).sort();
  }

  /**
   * 지연된 지시 — 완료가 아닌데 마감이 지난 것.
   * 보드 맨 위에 한 줄로 알린다. 칸 안에만 있으면 스크롤하다 놓친다.
   */
  function overdue(tasks, today) {
    return (tasks || []).filter(function (t) {
      if (normalizeStatus(t.status) === 'done') return false;
      var n = dday(t.due, today);
      return n !== null && n < 0;
    });
  }

  /** 아바타 글자 — 이름 첫 글자 */
  function initial(name) {
    var s = String(name || '').trim();
    return s ? s.slice(0, 1) : '?';
  }

  return {
    PLAN_RANK: PLAN_RANK, STATUSES: STATUSES, PRIORITIES: PRIORITIES,
    access: access, accessMessage: accessMessage,
    kstYmd: kstYmd, dday: dday, ddayLabel: ddayLabel,
    normalizeStatus: normalizeStatus, normalizePriority: normalizePriority,
    sortTasks: sortTasks, groupByStatus: groupByStatus, filterTasks: filterTasks,
    assignees: assignees, overdue: overdue, initial: initial,
  };
}));
