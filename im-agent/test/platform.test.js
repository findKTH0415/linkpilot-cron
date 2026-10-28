'use strict';
/**
 * 플랫폼 화면 로직 테스트 — DOM 없이 순수 함수만 검증한다.
 *
 * 여기가 틀리면 CEO 가 잘못된 '오늘'을 본다:
 *   - 시간대가 어긋나면 해외 출장 중 오늘 일정이 통째로 사라진다
 *   - 못 가져온 것을 '없음'으로 표시하면 일정이 없는 날로 오해한다
 *   - 멤버십이 만료됐는데 이용 중으로 보이면 결제 문의가 들어온다
 */
const test = require('node:test');
const assert = require('node:assert');

const app = require('../ui/platform/app.js');

// ── 날짜 (KST) ────────────────────────────────────────────────────

test('KST: UTC 날짜가 아니라 서울 날짜를 쓴다', () => {
  // 2026-08-13T21:30:00Z = 서울 2026-08-14 06:30
  const d = new Date('2026-08-13T21:30:00Z');
  assert.strictEqual(app.kstYmd(d), '2026-08-14',
    'UTC 로 계산하면 하루 전으로 나와 오늘 일정이 전부 사라진다');
  assert.match(app.kstLabel(d), /^2026년 08월 14일 금요일$/);
});

test('KST: 자정 직전도 같은 날로 본다', () => {
  // 2026-08-14T14:59:00Z = 서울 23:59
  assert.strictEqual(app.kstYmd(new Date('2026-08-14T14:59:00Z')), '2026-08-14');
  // 2026-08-14T15:00:00Z = 서울 다음날 00:00
  assert.strictEqual(app.kstYmd(new Date('2026-08-14T15:00:00Z')), '2026-08-15');
});

test('D-Day: 오늘·미래·과거', () => {
  assert.strictEqual(app.dday('2026-08-14', '2026-08-14'), 0);
  assert.strictEqual(app.dday('2026-08-20', '2026-08-14'), 6);
  assert.strictEqual(app.dday('2026-08-10', '2026-08-14'), -4);
  assert.strictEqual(app.ddayLabel(0), 'D-DAY');
  assert.strictEqual(app.ddayLabel(6), 'D-6');
  assert.strictEqual(app.ddayLabel(-4), 'D+4');
});

test('D-Day: 월말·연말을 넘어가도 맞는다', () => {
  assert.strictEqual(app.dday('2026-09-01', '2026-08-31'), 1);
  assert.strictEqual(app.dday('2027-01-01', '2026-12-31'), 1);
  assert.strictEqual(app.dday('2026-03-01', '2026-02-28'), 1);   // 2026 은 평년
});

test('D-Day: 형식이 아니면 null (지어내지 않는다)', () => {
  assert.strictEqual(app.dday(''), null);
  assert.strictEqual(app.dday(null), null);
  assert.strictEqual(app.dday('내일'), null);
  assert.strictEqual(app.dday('2026/08/14'), null);
});

// ── 데이터 정리 ───────────────────────────────────────────────────

test('단계 표준화는 아침 브리핑과 같은 규칙이다', () => {
  assert.strictEqual(app.mapToStage('완료'), '완료');
  assert.strictEqual(app.mapToStage('해외'), '진행');
  assert.strictEqual(app.mapToStage('진행'), '진행');
  assert.strictEqual(app.mapToStage('타진'), '타진');
  assert.strictEqual(app.mapToStage('검토'), '접수');
  assert.strictEqual(app.mapToStage(''), '접수');
  assert.strictEqual(app.mapToStage(undefined), '접수');
});

test('오늘 일정: 날짜가 맞는 것만, 시간순으로', () => {
  const evs = [
    { date: '2026-08-14', time: '15:00', title: 'C' },
    { startDate: '2026-08-14', time: '09:00', title: 'A' },
    { date: '2026-08-15', time: '08:00', title: '내일' },
    { date: '2026-08-14', title: '시간없음' },
  ];
  const r = app.todayEvents(evs, '2026-08-14');
  assert.deepStrictEqual(r.map(e => e.title), ['A', 'C', '시간없음'],
    '시간 없는 일정은 맨 뒤로');
});

test('할일: 완료는 제외, 긴급/보통이 겹치지 않는다', () => {
  const todos = [
    { text: 'a', priority: '긴급' },
    { text: 'b', priority: '보통' },
    { text: 'c', priority: '긴급', status: '완료' },
    { text: 'd' },
  ];
  assert.deepStrictEqual(app.openTodos(todos, '긴급').map(t => t.text), ['a']);
  assert.deepStrictEqual(app.openTodos(todos, '보통').map(t => t.text), ['b', 'd']);
});

test('신규 접수: 15일 경계', () => {
  const projects = [
    { title: '경계안', status: '접수', updatedAt: '2026-07-31' },   // 15일 전 = 포함
    { title: '경계밖', status: '접수', updatedAt: '2026-07-30' },
    { title: '진행중', status: '진행', updatedAt: '2026-08-14' },
    { title: '최근', status: '접수', updatedAt: '2026-08-14' },
  ];
  const r = app.recentIntake(projects, 15, '2026-08-15');
  assert.deepStrictEqual(r.map(p => p.title), ['최근', '경계안'],
    '접수 단계만, 최신순으로');
});

test('검색: 제목·고객·메모를 함께 본다', () => {
  const ps = [
    { title: '새만금 태양광', client: 'A사', memo: '' },
    { title: '데이터센터', client: '', memo: '남동공단 부지' },
  ];
  assert.strictEqual(app.searchProjects(ps, '태양광').length, 1);
  assert.strictEqual(app.searchProjects(ps, '남동').length, 1);
  assert.strictEqual(app.searchProjects(ps, 'a사').length, 1, '대소문자 무시');
  assert.strictEqual(app.searchProjects(ps, '').length, 2, '빈 검색어는 전체');
});

test('전화번호: 필드명이 달라도 찾고, 짧으면 만들지 않는다', () => {
  assert.strictEqual(app.phoneOf({ phone: '010-1234-5678' }), '01012345678');
  assert.strictEqual(app.phoneOf({ mobile: '010 9876 5432' }), '01098765432');
  assert.strictEqual(app.phoneOf({ hp: '02-123-4567' }), '021234567');
  assert.strictEqual(app.phoneOf({ phone: '1234' }), null, '자릿수가 모자라면 링크를 만들지 않는다');
  assert.strictEqual(app.phoneOf({}), null);
});

// ── 멤버십 ────────────────────────────────────────────────────────

test('★ 멤버십: 정보가 없으면 Free 로 단정하지 않는다', () => {
  const m = app.membership({}, '2026-08-14');
  assert.strictEqual(m.linked, false);
  assert.strictEqual(m.planName, '연동 전');
  assert.strictEqual(m.planId, null,
    '유료 회원인데 화면이 Free 로 보이면 문의가 들어온다');
});

test('멤버십: 갱신일이 지나면 만료로 본다', () => {
  const m = app.membership({ membership: { planId: 'pro', until: '2026-08-01' } }, '2026-08-14');
  assert.strictEqual(m.status, 'expired');
  assert.strictEqual(m.daysLeft, -13);
});

test('멤버십: 14일 이내면 임박 표시', () => {
  const near = app.membership({ membership: { planId: 'pro', until: '2026-08-25' } }, '2026-08-14');
  assert.strictEqual(near.expiringSoon, true);
  assert.strictEqual(near.daysLeft, 11);

  const far = app.membership({ membership: { planId: 'pro', until: '2026-10-01' } }, '2026-08-14');
  assert.strictEqual(far.expiringSoon, false);
});

test('멤버십: 서버가 준 status 를 덮어쓰지 않는다', () => {
  const m = app.membership({ membership: { planId: 'pro', status: 'trial', until: '2026-12-01' } }, '2026-08-14');
  assert.strictEqual(m.status, 'trial');
});

test('★ 가격: 설정에 없으면 지어내지 않고 문의로 표시한다', () => {
  assert.strictEqual(app.formatPrice(null), '문의');
  assert.strictEqual(app.formatPrice(undefined), '문의');
  assert.strictEqual(app.formatPrice(''), '문의');
  assert.strictEqual(app.formatPrice(49000), '49,000원');
  assert.strictEqual(app.formatPrice('월 49,000원~'), '월 49,000원~');
  app.DEFAULT_PLANS.forEach(p => {
    assert.strictEqual(p.price, null, '기본 플랜에 가격을 박아두면 안 된다');
  });
});

test('멤버십: 플랜 목록을 설정으로 바꿀 수 있다', () => {
  const m = app.membership({
    plans: [{ id: 'solo', name: 'Solo', price: 19000, features: ['1인'] }],
    membership: { planId: 'solo' },
  }, '2026-08-14');
  assert.strictEqual(m.planName, 'Solo');
  assert.strictEqual(m.plans.length, 1);
});

test('★ 결제 화면에서 카드정보를 받지 않는다', () => {
  const fs = require('fs');
  const path = require('path');
  const raw = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'app.js'), 'utf8');
  // 주석은 제외하고 실제 코드만 본다 (주석에는 '카드번호를 받지 않는다'고 적혀 있다)
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.ok(!/card(number|Number)|cvc|cvv|expiry|카드번호/i.test(code),
    '카드정보를 직접 받으면 PCI 범위에 들어간다 — 결제대행사로 보낸다');

  // 입력창은 검색용만 있어야 한다. 결제·인증 입력이 생기면 여기서 걸린다
  const types = [...code.matchAll(/\.type\s*=\s*'([a-z]+)'/g)].map(m => m[1]);
  assert.deepStrictEqual([...new Set(types)].sort(), ['button', 'search'],
    `허용되지 않은 input type 이 있다: ${types.join(', ')}`);
});
