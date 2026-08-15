'use strict';
/**
 * board-api.test.js — 업무지시 보드 저장. 〈B-7〉
 *
 * 이 화면의 가장 나쁜 실패는 **옮겼다고 믿은 채로 옮겨지지 않는 것**이다.
 * 새로고침해야 알 수 있는 실패는 아무도 눈치채지 못한다 — 그래서
 * 저장 실패·경합·잘못된 값이 전부 눈에 보이는 사유로 나와야 한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const API = require('../ui/board-api.cjs');

const PRO = { name: '홍길동', planId: 'pro', status: 'active' };
const FREE = { name: '홍길동', planId: 'free', status: 'active' };

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lp-board-')); }
function handlers(root, user) {
  return API.createHandlers({ agentRoot: root, authenticate: () => user });
}
const DRAFT = { title: '감정평가 법인 선정', assignee: '박상무', detail: '3곳 견적', project: '남동공단' };

/* ───────────── 열리기 전에 막는다 ───────────── */

test('★ 인증 함수가 없으면 마운트 시점에 예외 (fail closed)', () => {
  assert.throws(() => API.createHandlers({ agentRoot: '/tmp' }), /authenticate/);
});

test('미인증 401 · 무료 회원 403', async () => {
  const root = tmpRoot();
  assert.strictEqual((await handlers(root, null).get({})).status, 401);
  assert.strictEqual((await handlers(root, FREE).get({})).status, 403);
  assert.strictEqual((await handlers(root, FREE).create({}, DRAFT)).status, 403);
  fs.rmSync(root, { recursive: true, force: true });
});

test('모르는 플랜 코드를 통과시키지 않는다', async () => {
  const root = tmpRoot();
  const h = handlers(root, { name: 'x', planId: 'platinum', status: 'active' });
  assert.strictEqual((await h.get({})).status, 403);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ───────────── 저장된다 ───────────── */

test('★ 등록한 지시가 새로고침해도 남는다', async () => {
  const root = tmpRoot();
  const h = handlers(root, PRO);
  const c = await h.create({}, DRAFT);
  assert.strictEqual(c.status, 201);

  // 새 핸들러(= 새로고침)로 읽어도 있어야 한다
  const g = await handlers(root, PRO).get({});
  assert.strictEqual(g.body.tasks.length, 1);
  assert.strictEqual(g.body.tasks[0].title, '감정평가 법인 선정');
  assert.strictEqual(g.body.tasks[0].status, 'todo');
  assert.ok(g.body.people.includes('박상무'), '담당자가 목록에 더해져야 다음 등록에서 고를 수 있다');
  fs.rmSync(root, { recursive: true, force: true });
});

test('★ id 는 서버가 만든다 (화면이 준 id 를 믿지 않는다)', async () => {
  const root = tmpRoot();
  const h = handlers(root, PRO);
  const a = await h.create({}, Object.assign({ id: 'n1' }, DRAFT));
  const b = await h.create({}, Object.assign({ id: 'n1' }, DRAFT, { title: '다른 지시' }));
  assert.notStrictEqual(a.body.task.id, b.body.task.id,
    'id 가 겹치면 카드 하나를 옮겼는데 다른 지시가 따라 움직인다');
  fs.rmSync(root, { recursive: true, force: true });
});

test('필수값이 비면 사유를 말한다', async () => {
  const root = tmpRoot();
  const h = handlers(root, PRO);
  assert.match((await h.create({}, { assignee: '박상무' })).body.error, /지시 내용/);
  assert.match((await h.create({}, { title: 'x' })).body.error, /담당자/);
  assert.match((await h.create({}, Object.assign({}, DRAFT, { due: '2026/08/20' }))).body.error, /YYYY-MM-DD/);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ───────────── 이동 ───────────── */

test('★ 완료일은 서버가 KST 로 찍는다 (브라우저 시계를 믿지 않는다)', async () => {
  const root = tmpRoot();
  const h = handlers(root, PRO);
  const id = (await h.create({}, DRAFT)).body.task.id;

  const r = await h.update({}, id, { status: 'done', doneAt: '1999-01-01' });
  assert.strictEqual(r.status, 200);
  assert.match(r.body.task.doneAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.notStrictEqual(r.body.task.doneAt, '1999-01-01',
    '시간대가 다른 곳에서 열면 완료일이 하루 어긋난다');

  // 완료에서 되돌리면 완료일도 사라진다
  const back = await h.update({}, id, { status: 'doing', rev: r.body.rev });
  assert.strictEqual(back.body.task.doneAt, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test('모르는 상태·우선순위를 받지 않는다', async () => {
  const root = tmpRoot();
  const h = handlers(root, PRO);
  const id = (await h.create({}, DRAFT)).body.task.id;
  assert.match((await h.update({}, id, { status: 'archived' })).body.error, /모르는 상태/);
  assert.match((await h.update({}, id, { priority: 'later' })).body.error, /모르는 우선순위/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('없는 지시는 404', async () => {
  const root = tmpRoot();
  assert.strictEqual((await handlers(root, PRO).update({}, 'T99', { status: 'done' })).status, 404);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ───────────── 경합 ───────────── */

test('★ 마지막에 저장한 사람이 이기게 두지 않는다', async () => {
  const root = tmpRoot();
  const h = handlers(root, PRO);
  const created = await h.create({}, DRAFT);
  const id = created.body.task.id;
  const staleRev = created.body.rev;

  // 다른 사람이 먼저 옮긴다
  await h.update({}, id, { status: 'doing', rev: staleRev });

  // 옛 rev 를 들고 온 요청은 막힌다
  const r = await h.update({}, id, { status: 'done', rev: staleRev });
  assert.strictEqual(r.status, 409);
  assert.match(r.body.error, /다른 사람이 먼저/);
  assert.ok(r.body.board, '화면이 되돌릴 수 있도록 현재 보드를 함께 준다');
  assert.strictEqual(r.body.board.tasks[0].status, 'doing', '남이 옮긴 결과가 유지된다');
  fs.rmSync(root, { recursive: true, force: true });
});

test('rev 를 안 보내면 막지 않는다 (단일 사용자 경로를 깨지 않는다)', async () => {
  const root = tmpRoot();
  const h = handlers(root, PRO);
  const id = (await h.create({}, DRAFT)).body.task.id;
  await h.update({}, id, { status: 'doing' });
  assert.strictEqual((await h.update({}, id, { status: 'done' })).status, 200);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ───────────── 파일 취급 ───────────── */

test('★ 읽을 수 없는 보드를 빈 보드로 덮지 않는다', async () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, API.FILE), '{ 깨진 JSON');
  const h = handlers(root, PRO);

  const g = await h.get({});
  assert.strictEqual(g.status, 500);
  assert.match(g.body.error, /덮어쓰지 않았습니다/);

  assert.strictEqual((await h.create({}, DRAFT)).status, 500,
    '깨진 파일 위에 새로 쓰면 그때까지의 일이 통째로 사라진다');
  assert.strictEqual(fs.readFileSync(path.join(root, API.FILE), 'utf8'), '{ 깨진 JSON');
  fs.rmSync(root, { recursive: true, force: true });
});

test('보드가 없으면 빈 보드로 시작한다 (오류가 아니다)', async () => {
  const root = tmpRoot();
  const g = await handlers(root, PRO).get({});
  assert.strictEqual(g.status, 200);
  assert.deepStrictEqual(g.body.tasks, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('쓰다가 죽어도 반쯤 쓰인 보드가 남지 않는다 (임시파일 → 바꿔치기)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'board-api.cjs'), 'utf8');
  assert.match(src, /renameSync/, '바로 덮어쓰면 쓰는 도중에 죽었을 때 보드가 깨진다');
});

test('삭제된다', async () => {
  const root = tmpRoot();
  const h = handlers(root, PRO);
  const c = await h.create({}, DRAFT);
  const r = await h.remove({}, c.body.task.id, { rev: c.body.rev });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await h.get({})).body.tasks, []);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ───────────── 화면과의 약속 ───────────── */

test('★ 저장이 실패하면 화면을 되돌린다', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'board.html'), 'utf8');
  assert.match(html, /task\.status = before\.status/,
    '실패했는데 카드가 옮겨진 채로 남으면 "옮겼다고 믿은 채로 안 옮겨진" 상태가 된다');
  assert.match(html, /saveFailed/, '실패를 화면에 적어야 한다');
  assert.ok(!/화면에만 추가되었습니다 — 서버 저장은 본체 API 연결이 필요합니다/.test(html),
    '이제 서버에 저장된다');
  assert.match(html, /req\('POST', '\/board\/tasks'/);
  assert.match(html, /req\('PATCH', '\/board\/tasks\//);
});

test('화면과 서버가 같은 상태·우선순위·플랜을 안다', () => {
  const B = require('../ui/platform/board-core.js');
  assert.deepStrictEqual(API.STATUSES, B.STATUSES.map(s => s.id));
  assert.deepStrictEqual(API.PRIORITIES.slice().sort(), B.PRIORITIES.map(p => p.id).sort());

  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'board.html'), 'utf8');
  assert.match(html, new RegExp(`requiredPlan: '${API.REQUIRED_PLAN}'`),
    '화면과 서버가 다른 플랜을 요구하면 화면은 열리는데 데이터가 안 온다');
});
