'use strict';
/**
 * 업무지시 보드 판정 로직 테스트.
 *
 * 접근 판정이 틀리면 무료 회원에게 유료 화면이 열리거나 유료 회원이 잠긴 화면을 본다.
 * 정렬·그룹핑이 틀리면 급한 지시가 아래로 밀리거나 카드가 사라진다.
 *
 * ※ 이 로직은 '무엇을 그릴지'만 정한다. 실제 차단은 서버가 한다 —
 *   브라우저 코드는 사용자가 고칠 수 있다.
 */
const test = require('node:test');
const assert = require('node:assert');

const B = require('../ui/platform/board-core.js');

// ── 접근 판정 ─────────────────────────────────────────────────────

test('★ 미인증이 최우선 사유다 (플랜보다 먼저 안내한다)', () => {
  const a = B.access({ authenticated: false, planId: 'business' }, 'pro');
  assert.strictEqual(a.allowed, false);
  assert.strictEqual(a.reason, 'unauthenticated',
    '로그인 안 한 사람에게 "Pro 플랜 필요"라고 하면 무엇을 해야 할지 모른다');
});

test('무료 회원은 막힌다', () => {
  const a = B.access({ authenticated: true, planId: 'free' }, 'pro');
  assert.strictEqual(a.allowed, false);
  assert.strictEqual(a.reason, 'plan');
});

test('요구 플랜 이상이면 통과한다', () => {
  assert.strictEqual(B.access({ authenticated: true, planId: 'pro' }, 'pro').allowed, true);
  assert.strictEqual(B.access({ authenticated: true, planId: 'business' }, 'pro').allowed, true);
  assert.strictEqual(B.access({ authenticated: true, planId: 'basic' }, 'pro').allowed, false);
});

test('★ 플랜 정보가 없으면 통과시키지 않고, 무료로 단정하지도 않는다', () => {
  for (const planId of [null, undefined, '']) {
    const a = B.access({ authenticated: true, planId }, 'pro');
    assert.strictEqual(a.allowed, false);
    assert.strictEqual(a.reason, 'plan-unknown',
      '정보 없음을 free 로 취급하면 유료 회원이 잠긴 화면을 본다');
  }
});

test('★ 모르는 플랜 코드는 통과시키지 않는다', () => {
  const a = B.access({ authenticated: true, planId: 'enterprise-v2' }, 'pro');
  assert.strictEqual(a.allowed, false, '오타 하나로 유료 화면이 열리면 안 된다');
  assert.strictEqual(a.reason, 'plan-unknown');
});

test('만료된 유료 회원은 막히되 사유가 다르다', () => {
  const a = B.access({ authenticated: true, planId: 'pro', status: 'expired' }, 'pro');
  assert.strictEqual(a.allowed, false);
  assert.strictEqual(a.reason, 'expired');
  assert.match(B.accessMessage(a).body, /보관/, '기존 지시가 사라지지 않는다는 점을 알린다');
});

test('세션이 통째로 없어도 죽지 않는다', () => {
  assert.strictEqual(B.access(null).reason, 'unauthenticated');
  assert.strictEqual(B.access(undefined).reason, 'unauthenticated');
});

test('사유마다 다음 행동이 있다', () => {
  for (const reason of ['unauthenticated', 'expired', 'plan', 'plan-unknown']) {
    const m = B.accessMessage({ reason, requiredPlan: 'pro' });
    assert.ok(m && m.title && m.body && m.cta, `${reason} 안내에 다음 행동이 없다`);
  }
  assert.strictEqual(B.accessMessage({ reason: null }), null, '통과했으면 안내가 없다');
});

// ── 보드 데이터 ───────────────────────────────────────────────────

const TODAY = '2026-08-14';
const TASKS = [
  { id: 1, title: '감정평가 법인 선정', status: 'todo', priority: 'normal', due: '2026-08-20', assignee: '박상무' },
  { id: 2, title: 'CB 발행조건 확정', status: 'todo', priority: 'urgent', due: '2026-08-25', assignee: '이팀장' },
  { id: 3, title: '대주단 미팅 자료', status: 'todo', priority: 'urgent', due: '2026-08-16', assignee: '박상무' },
  { id: 4, title: '마감 없는 지시', status: 'todo', priority: 'normal', assignee: '최이사' },
  { id: 5, title: '현장실사 보고', status: 'doing', priority: 'normal', due: '2026-08-10', assignee: '이팀장' },
  { id: 6, title: '계약서 검토', status: 'review', priority: 'normal', due: '2026-08-30', assignee: '최이사' },
  { id: 7, title: '킥오프 준비', status: 'done', priority: 'urgent', due: '2026-08-01', doneAt: '2026-08-02', assignee: '박상무' },
  { id: 8, title: '상태값이 이상한 지시', status: 'weird-status', priority: 'normal', assignee: '박상무' },
];

test('★ 알 수 없는 상태의 카드를 버리지 않는다', () => {
  const g = B.groupByStatus(TASKS, TODAY);
  const all = g.reduce((n, c) => n + c.count, 0);
  assert.strictEqual(all, TASKS.length, '카드가 사라지면 일이 사라진다');
  assert.strictEqual(B.normalizeStatus('weird-status'), 'todo');
});

test('빈 칸도 반환한다 (옮길 곳이 없어지면 안 된다)', () => {
  const g = B.groupByStatus([], TODAY);
  assert.strictEqual(g.length, 4);
  assert.deepStrictEqual(g.map(c => c.status.id), ['todo', 'doing', 'review', 'done']);
});

test('★ 정렬: 긴급 먼저 → 마감 가까운 순 → 마감 없는 것은 맨 뒤', () => {
  const todo = B.groupByStatus(TASKS, TODAY).find(c => c.status.id === 'todo');
  assert.deepStrictEqual(todo.tasks.map(t => t.id), [3, 2, 1, 4, 8],
    '긴급 마감순(3,2) → 일반 마감있음(1) → 마감 없음(4,8 — 안정 정렬이라 원본 순서 유지)');
});

test('완료 칸은 최근 완료가 위로', () => {
  const done = B.sortTasks([
    { id: 'a', doneAt: '2026-08-01' }, { id: 'b', doneAt: '2026-08-05' }, { id: 'c', doneAt: '2026-08-03' },
  ], 'done', TODAY);
  assert.deepStrictEqual(done.map(t => t.id), ['b', 'c', 'a']);
});

test('★ 지연 지시를 잡아낸다 (완료된 것은 제외)', () => {
  const late = B.overdue(TASKS, TODAY);
  assert.deepStrictEqual(late.map(t => t.id), [5],
    '완료(7)는 마감이 지났어도 지연이 아니다');
});

test('D-Day: 오늘·미래·과거·월말', () => {
  assert.strictEqual(B.dday('2026-08-14', TODAY), 0);
  assert.strictEqual(B.dday('2026-08-20', TODAY), 6);
  assert.strictEqual(B.dday('2026-08-10', TODAY), -4);
  assert.strictEqual(B.dday('2026-09-01', '2026-08-31'), 1);
  assert.strictEqual(B.ddayLabel(0), 'D-DAY');
  assert.strictEqual(B.ddayLabel(-4), 'D+4');
});

test('D-Day: 형식이 아니면 null (지어내지 않는다)', () => {
  assert.strictEqual(B.dday(''), null);
  assert.strictEqual(B.dday(null), null);
  assert.strictEqual(B.dday('내일'), null);
});

test('KST: UTC 날짜가 아니라 서울 날짜', () => {
  // 2026-08-13T21:30:00Z = 서울 2026-08-14
  assert.strictEqual(B.kstYmd(new Date('2026-08-13T21:30:00Z')), '2026-08-14');
});

test('필터: 담당자·우선순위·검색어', () => {
  assert.deepStrictEqual(B.filterTasks(TASKS, { assignee: '박상무' }).map(t => t.id), [1, 3, 7, 8]);
  assert.deepStrictEqual(B.filterTasks(TASKS, { priority: 'urgent' }).map(t => t.id), [2, 3, 7]);
  assert.strictEqual(B.filterTasks(TASKS, { q: '대주단' }).length, 1);
  assert.strictEqual(B.filterTasks(TASKS, {}).length, TASKS.length, '빈 필터는 전체');
  assert.deepStrictEqual(B.filterTasks(TASKS, { assignee: '박상무', priority: 'urgent' }).map(t => t.id),
    [3, 7], '조건은 AND 로 걸린다');
  // 필터는 완료 카드도 포함한다 — 보드에서 완료 칸도 함께 걸러져야 한다
  assert.ok(B.filterTasks(TASKS, { assignee: '박상무' }).some(t => t.status === 'done'));
});

test('필터: 검색은 대소문자를 가리지 않고 담당자·프로젝트도 본다', () => {
  const t = [{ title: 'A', assignee: 'Kim', project: 'Solar' }];
  assert.strictEqual(B.filterTasks(t, { q: 'kim' }).length, 1);
  assert.strictEqual(B.filterTasks(t, { q: 'solar' }).length, 1);
});

test('담당자 목록은 중복 없이 정렬된다', () => {
  assert.deepStrictEqual(B.assignees(TASKS), ['박상무', '이팀장', '최이사']);
  assert.deepStrictEqual(B.assignees([]), []);
});

test('아바타 글자', () => {
  assert.strictEqual(B.initial('박상무'), '박');
  assert.strictEqual(B.initial(''), '?');
  assert.strictEqual(B.initial(null), '?');
});
