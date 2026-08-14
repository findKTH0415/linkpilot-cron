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
  // 접근 판정은 gate-core.js 하나만 쓴다. 화면마다 두면 반드시 갈린다.
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gate-core.js'));
  else root.LinkPilotBoard = factory(root.LinkPilotGate);
}(typeof self !== 'undefined' ? self : this, function (Gate) {
  'use strict';

  if (!Gate) throw new Error('board-core: gate-core.js 를 먼저 불러와야 한다');

  var PLAN_RANK = Gate.PLAN_RANK;

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

  var access = Gate.access;
  var kstYmd = Gate.kstYmd;
  var dday = Gate.dday;
  var ddayLabel = Gate.ddayLabel;

  /**
   * 게이트 문구 — 공용 문구에 보드 사정을 덧붙인다.
   * '기존 지시는 보관된다', '무엇을 얻는지'는 이 화면만 아는 내용이다.
   */
  function accessMessage(a, planName) {
    var m = Gate.accessMessage(a, planName, '업무지시 보드');
    if (!m) return null;
    if (a.reason === 'expired') {
      m.body = '갱신하면 보드를 다시 사용할 수 있습니다. 기존 지시는 그대로 보관됩니다.';
    }
    if (a.reason === 'plan') {
      m.body = '업무지시 보드는 담당자에게 일을 배정하고 진행을 추적하는 기능입니다.';
    }
    return m;
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
