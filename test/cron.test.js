'use strict';
/**
 * 아침 크론 회귀 테스트 — 네트워크·시크릿 없이 돈다.
 *
 * 지키려는 두 규칙 (CLAUDE.md §2, §4):
 *   ① 발송 실패 시 조용히 죽지 않는다 → 실패 알림 경로가 항상 살아 있어야 한다
 *   ② NAS 실패가 브리핑 전체를 죽이지 않는다 → 3회 재시도 후 누락 배너를 달고 발송
 */
const test = require('node:test');
const assert = require('node:assert');

const alert = require('../alert-failure');
const brief = require('../send-morning-brief');

// ── ① 실패 알림 ───────────────────────────────────────────────────

test('알림: 실패 시각을 KST 로 찍는다 (러너는 UTC 로 돈다)', () => {
  // 2026-08-13T21:30:00Z = 2026-08-14 06:30 KST — 날짜가 넘어가는 시각으로 잡는다
  const stamp = alert.kstStamp(new Date('2026-08-13T21:30:00Z'));
  assert.match(stamp, /^2026-08-14 06:30:00 KST$/,
    'UTC 로 찍히면 날짜가 하루 어긋나 실패 시점을 잘못 읽는다');
});

test('알림: 이슈 제목이 워크플로마다 고정된다 (연속 실패 시 이슈 폭증 방지)', () => {
  const a = alert.issueTitle('morning-brief');
  const b = alert.issueTitle('morning-brief');
  assert.strictEqual(a, b, '제목에 시각이 섞이면 매일 새 이슈가 쌓인다');
  assert.notStrictEqual(a, alert.issueTitle('morning-card'), '워크플로가 다르면 이슈도 달라야 한다');
});

test('알림: 본문에 워크플로명·실행 URL·KST 시각이 모두 들어간다', () => {
  const a = alert.buildAlert({
    workflow: 'morning-brief',
    runUrl: 'https://github.com/o/r/actions/runs/123',
    now: new Date('2026-08-13T21:30:00Z'),
  });
  assert.match(a.body, /morning-brief/);
  assert.match(a.body, /actions\/runs\/123/);
  assert.match(a.body, /2026-08-14 06:30:00 KST/);
  assert.match(a.sms, /morning-brief/, 'SMS 만 봐도 어느 크론인지 알아야 한다');
});

test('알림: 로그에 전화번호를 그대로 남기지 않는다', () => {
  // ★ 이 검사에는 **실제 번호를 쓰지 않는다** 〈2026-08-26 · D-130 정리〉.
  //   앞 판은 사장님 실제 번호를 그대로 적어 두고 그 자릿수로 검사했다.
  //   저장소가 공개(D-10)라 그 자체가 §2 위반이고, 검사가 「그 번호」에
  //   묶여 있으면 지우는 순간 빨개져서 **못 지운다.**
  const masked = alert.maskPhone('01012345678');
  assert.ok(!masked.includes('1234'), '가운데 자리가 그대로 남아 있다');
  assert.match(masked, /5678$/, '식별용 뒷자리는 남긴다');
  assert.strictEqual(masked, '010****5678');
});

test('알림: DRY RUN 은 네트워크를 타지 않는다', async () => {
  const saved = process.env.ALERT_DRY_RUN;
  process.env.ALERT_DRY_RUN = '1';
  delete require.cache[require.resolve('../alert-failure')];
  const dry = require('../alert-failure');
  // 모듈 로드 시점에 DRY_RUN 이 고정되므로 재로드해서 확인한다
  assert.ok(dry.buildAlert({ workflow: 'x' }).title);
  if (saved) process.env.ALERT_DRY_RUN = saved; else delete process.env.ALERT_DRY_RUN;
  delete require.cache[require.resolve('../alert-failure')];
});

// ── ② NAS 실패 시 발송 계속 ────────────────────────────────────────

test('NAS: 조회 실패해도 예외를 던지지 않는다 (브리핑을 죽이지 않는다)', async () => {
  const savedFetch = global.fetch;
  const savedBase = process.env.NAS_BASE_URL;
  process.env.NAS_BASE_URL = 'https://nas.invalid';

  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('ECONNREFUSED'); };

  const r = await brief.fetchData();

  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.data, {}, '실패 시 빈 객체를 줘야 buildPayload 가 돈다');
  assert.match(r.error, /ECONNREFUSED/);
  assert.strictEqual(calls, 3, 'CLAUDE.md §4 — 3회 재시도');

  global.fetch = savedFetch;
  if (savedBase) process.env.NAS_BASE_URL = savedBase; else delete process.env.NAS_BASE_URL;
});

test('NAS: 첫 시도가 실패해도 재시도해서 성공하면 정상 데이터', async () => {
  const savedFetch = global.fetch;
  const savedBase = process.env.NAS_BASE_URL;
  process.env.NAS_BASE_URL = 'https://nas.invalid';

  let calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls === 1) throw new Error('일시적 오류');
    return { ok: true, json: async () => ({ projects: [{ title: 'A', status: '진행' }] }) };
  };

  const r = await brief.fetchData();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.projects.length, 1);
  assert.strictEqual(calls, 2);

  global.fetch = savedFetch;
  if (savedBase) process.env.NAS_BASE_URL = savedBase; else delete process.env.NAS_BASE_URL;
});

test('NAS: HTTP 오류 응답도 실패로 처리한다', async () => {
  const savedFetch = global.fetch;
  const savedBase = process.env.NAS_BASE_URL;
  process.env.NAS_BASE_URL = 'https://nas.invalid';

  global.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  const r = await brief.fetchData();

  assert.strictEqual(r.ok, false);
  assert.match(r.error, /502/);

  global.fetch = savedFetch;
  if (savedBase) process.env.NAS_BASE_URL = savedBase; else delete process.env.NAS_BASE_URL;
});

test('NAS: NAS_BASE_URL 이 없으면 즉시 실패 (호출하지 않는다)', async () => {
  const savedFetch = global.fetch;
  const saved = { n: process.env.NAS_BASE_URL, f: process.env.FRIENDS_URL };
  delete process.env.NAS_BASE_URL;
  delete process.env.FRIENDS_URL;

  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({}) }; };

  const r = await brief.fetchData();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(calls, 0);
  assert.match(r.error, /NAS_BASE_URL/);

  global.fetch = savedFetch;
  if (saved.n) process.env.NAS_BASE_URL = saved.n;
  if (saved.f) process.env.FRIENDS_URL = saved.f;
});

test('★ 배너: 데이터 누락을 "없음"으로 위장하지 않는다', () => {
  const banner = brief.degradedBanner({ ok: false, error: 'sync.php HTTP 502' });
  assert.match(banner, /조회 실패/);
  assert.match(banner, /502/, '사유가 없으면 복구 판단을 못 한다');
  assert.match(banner, /실제로 없는 것이 아니라/,
    '"일정 없음"과 "일정을 못 가져왔음"의 구분이 사라지면 CEO가 오판한다');
});

test('배너: 정상 조회면 아무것도 붙이지 않는다', () => {
  assert.strictEqual(brief.degradedBanner({ ok: true, data: {} }), '');
});

test('빈 데이터로도 payload 가 만들어진다 (NAS 실패 후 발송 경로)', () => {
  const p = brief.buildPayload({});
  assert.ok(p.날짜, '날짜는 NAS 없이도 나와야 한다');
  assert.deepStrictEqual(p.오늘일정, []);
  assert.deepStrictEqual(p.프로젝트현황_진행, []);
});
