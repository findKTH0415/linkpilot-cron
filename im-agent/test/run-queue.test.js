'use strict';
/**
 * 생성 실행기(큐) 테스트.
 *
 * 여기가 새면 실제로 돈이 나간다:
 *   같은 프로젝트를 동시에 돌리면 같은 폴더에 두 프로세스가 쓰고 쿼터도 두 배로 쓴다.
 *   실패를 삼키면 사용자는 끝난 줄 모르고 계속 기다린다.
 *
 * 진짜 파이프라인 대신 가짜 CLI 를 fork 해서 종료코드·행걸림을 재현한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createQueue } = require('../ui/run-queue.cjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'im-queue-'));

/** 가짜 CLI — 인자에 따라 성공/실패/행걸림 */
function fakeCli(behavior) {
  const p = path.join(TMP, `cli-${behavior}-${Math.random().toString(36).slice(2)}.js`);
  const body = {
    ok: `console.log('done'); process.exit(0);`,
    fail: `console.error('파이프라인 폭발'); process.exit(3);`,
    hang: `setInterval(function(){}, 1000);`,
    slow: `setTimeout(function(){ process.exit(0); }, 300);`,
  }[behavior];
  fs.writeFileSync(p, body);
  return p;
}

/** 실행이 끝날 때까지 기다린다 */
function until(fn, ms) {
  const deadline = Date.now() + (ms || 8000);
  return new Promise((res, rej) => {
    (function poll() {
      let v;
      try { v = fn(); } catch (e) { return rej(e); }
      if (v) return res(v);
      if (Date.now() > deadline) return rej(new Error('타임아웃'));
      setTimeout(poll, 20);
    }());
  });
}

test('성공하면 done 으로 기록된다', async () => {
  const q = createQueue({ cliPath: fakeCli('ok'), agentRoot: TMP });
  const r = q.startRun('LP-DC-2026-001', { docType: 'im', version: 'v1.0' }, { name: '홍길동' });

  assert.match(r.runId, /^run-\d+-/);
  // 자리가 비어 있으면 바로 시작한다. 대기열에 걸리면 queued 로 돌아온다
  assert.ok(['queued', 'running'].includes(r.status), `예상 밖 상태: ${r.status}`);

  const done = await until(() => { const x = q.get(r.runId); return x && x.status === 'done' ? x : null; });
  assert.strictEqual(done.exitCode, 0);
  assert.strictEqual(done.by, '홍길동');
  assert.ok(done.startedAt && done.finishedAt);
  assert.match(done.finishedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'KST 로 찍는다');
});

test('★ 실패를 삼키지 않는다 — 종료코드와 로그가 남는다', async () => {
  const q = createQueue({ cliPath: fakeCli('fail'), agentRoot: TMP });
  const r = q.startRun('LP-DC-2026-002', {}, { name: '홍길동' });

  const failed = await until(() => { const x = q.get(r.runId); return x && x.status === 'failed' ? x : null; });
  assert.strictEqual(failed.exitCode, 3);
  assert.match(failed.error, /종료코드 3/);
  assert.match(failed.log, /파이프라인 폭발/, '원인이 로그에 남아야 다음 행동을 정한다');
});

test('★ 같은 프로젝트를 동시에 돌리지 않는다', async () => {
  const q = createQueue({ cliPath: fakeCli('hang'), agentRoot: TMP, timeoutMs: 60_000 });
  q.startRun('LP-DC-2026-003', {}, { name: '홍길동' });

  await until(() => q.stats().active === 1);
  assert.throws(() => q.startRun('LP-DC-2026-003', {}, { name: '홍길동' }), (e) => {
    assert.strictEqual(e.conflict, true, '충돌은 서버 오류가 아니라 409 여야 한다');
    assert.match(e.message, /이미 생성 중/);
    return true;
  }, '같은 폴더에 두 프로세스가 쓰면 산출물이 섞이고 쿼터도 두 배로 나간다');

  q.stop();
});

test('다른 프로젝트는 동시성 한도까지 대기한다', async () => {
  const q = createQueue({ cliPath: fakeCli('hang'), agentRoot: TMP, concurrency: 1, timeoutMs: 60_000 });
  q.startRun('LP-DC-2026-004', {}, {});
  const second = q.startRun('LP-DC-2026-005', {}, {});

  await until(() => q.stats().active === 1);
  assert.strictEqual(q.get(second.runId).status, 'queued', '동시성 1이면 두 번째는 대기한다');
  assert.strictEqual(q.stats().waiting, 1);
  q.stop();
});

test('앞 실행이 끝나면 대기하던 것이 시작된다', async () => {
  const q = createQueue({ cliPath: fakeCli('slow'), agentRoot: TMP, concurrency: 1 });
  const a = q.startRun('LP-DC-2026-006', {}, {});
  const b = q.startRun('LP-DC-2026-007', {}, {});

  const doneA = await until(() => { const x = q.get(a.runId); return x && x.status === 'done' ? x : null; });
  assert.ok(doneA);
  const doneB = await until(() => { const x = q.get(b.runId); return x && x.status === 'done' ? x : null; });
  assert.ok(doneB, '앞이 끝나면 뒤가 자동으로 돈다');
});

test('★ 행걸리면 죽이고 실패로 기록한다 (영원히 running 으로 남지 않는다)', async () => {
  const q = createQueue({ cliPath: fakeCli('hang'), agentRoot: TMP, timeoutMs: 300 });
  const r = q.startRun('LP-DC-2026-008', {}, {});

  const failed = await until(() => { const x = q.get(r.runId); return x && x.status === 'failed' ? x : null; });
  assert.strictEqual(failed.timedOut, true);
  assert.match(failed.error, /시간 초과/);
  assert.strictEqual(q.stats().active, 0, '죽은 실행이 슬롯을 물고 있으면 안 된다');
});

test('실행기 경로가 잘못되면 실행 중으로 남기지 않는다', async () => {
  const q = createQueue({ cliPath: path.join(TMP, '없는파일.js'), agentRoot: TMP });
  const r = q.startRun('LP-DC-2026-009', {}, {});
  const failed = await until(() => { const x = q.get(r.runId); return x && x.status === 'failed' ? x : null; });
  assert.ok(failed.error, '사유 없이 실패로만 남기면 원인을 못 찾는다');
  assert.strictEqual(q.stats().active, 0);
});

test('끝나면 onDone 으로 알린다', async () => {
  const seen = [];
  const q = createQueue({ cliPath: fakeCli('ok'), agentRoot: TMP, onDone: (r) => seen.push(r.status) });
  q.startRun('LP-DC-2026-010', {}, {});
  await until(() => seen.length === 1);
  assert.deepStrictEqual(seen, ['done']);
});

test('onDone 이 던져도 큐가 멈추지 않는다', async () => {
  const q = createQueue({
    cliPath: fakeCli('ok'), agentRoot: TMP, concurrency: 1,
    onDone: () => { throw new Error('알림 실패'); },
  });
  const a = q.startRun('LP-DC-2026-011', {}, {});
  const b = q.startRun('LP-DC-2026-012', {}, {});
  await until(() => { const x = q.get(a.runId); return x && x.status === 'done'; });
  await until(() => { const x = q.get(b.runId); return x && x.status === 'done'; },
    5000);
});

test('프로젝트의 최신 실행을 찾는다', async () => {
  const q = createQueue({ cliPath: fakeCli('ok'), agentRoot: TMP });
  const a = q.startRun('LP-DC-2026-013', {}, {});
  await until(() => { const x = q.get(a.runId); return x && x.status === 'done'; });
  const b = q.startRun('LP-DC-2026-013', {}, {});
  const latest = q.latestFor('LP-DC-2026-013');
  assert.strictEqual(latest.runId, b.runId);
  assert.strictEqual(q.latestFor('LP-DC-9999-999'), null);
});

test('성공한 실행의 로그는 내보내지 않는다', async () => {
  const q = createQueue({ cliPath: fakeCli('ok'), agentRoot: TMP });
  const r = q.startRun('LP-DC-2026-014', {}, {});
  const done = await until(() => { const x = q.get(r.runId); return x && x.status === 'done' ? x : null; });
  assert.strictEqual(done.log, undefined, '성공 로그를 매번 실어 보낼 이유가 없다');
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
