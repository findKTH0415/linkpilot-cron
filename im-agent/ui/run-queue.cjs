'use strict';
/**
 * run-queue.cjs — 보고서 생성 실행기. report-api.cjs 의 startRun 에 꽂는다.
 *
 * 왜 큐인가:
 *   파이프라인은 LLM 을 부르고 공공데이터 쿼터를 쓰고 파일을 쓴다.
 *   요청이 겹치면 돈이 두 배로 나가고, 같은 프로젝트를 동시에 돌리면
 *   같은 폴더에 두 프로세스가 써서 산출물이 섞인다.
 *
 * 왜 자식 프로세스인가:
 *   파이프라인은 대부분 동기 계산·파일 작업이다. API 서버와 같은 프로세스에서
 *   돌리면 실행 중 웹 서버가 통째로 멈춘다. cli.js 를 fork 해서 분리한다.
 *   진행 상황은 이미 monitor.js 가 control-tower.json 에 쓰므로
 *   대시보드가 그대로 읽는다 — 별도 통로를 만들지 않는다.
 *
 * ★ 실패를 삼키지 않는다. 종료코드·stderr 를 실행 기록에 남기고,
 *   onDone 콜백으로 알린다. 조용히 사라지면 사용자는 계속 기다린다.
 */

const { fork } = require('child_process');
const path = require('path');

const DEFAULTS = {
  concurrency: 1,          // 동시 실행 수. 늘리면 LLM 비용도 같이 는다
  timeoutMs: 20 * 60_000,  // 20분. 넘으면 죽이고 실패로 기록한다
  keepRuns: 100,           // 기록 보관 개수
};

/** KST 로 찍는다 (서버가 UTC 로 돌 수 있다) */
function kstStamp(d) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d || new Date());
}

function createQueue(options) {
  const o = Object.assign({}, DEFAULTS, options || {});
  const cliPath = o.cliPath || path.join(__dirname, '..', 'cli.js');
  const agentRoot = o.agentRoot || process.env.IM_AGENT_ROOT;

  const runs = new Map();      // runId → record
  const children = new Map();  // runId → 자식 프로세스 (종료 시 정리하려면 붙들고 있어야 한다)
  const waiting = [];          // 대기열
  const active = new Map();    // projectId → runId (프로젝트당 1개)
  let seq = 0;

  function record(r) {
    runs.set(r.runId, r);
    // 오래된 기록부터 버린다. 진행 중인 것은 버리지 않는다
    if (runs.size > o.keepRuns) {
      for (const [id, x] of runs) {
        if (x.status === 'queued' || x.status === 'running') continue;
        runs.delete(id);
        if (runs.size <= o.keepRuns) break;
      }
    }
    return r;
  }

  function finish(r, status, extra) {
    children.delete(r.runId);
    Object.assign(r, extra || {});
    r.status = status;
    r.finishedAt = kstStamp();
    active.delete(r.projectId);
    if (typeof o.onDone === 'function') {
      // 알림이 터져도 큐는 계속 돈다
      try { o.onDone(r); } catch (_) { /* 무시 */ }
    }
    pump();
  }

  function pump() {
    if (active.size >= o.concurrency) return;
    const idx = waiting.findIndex(r => !active.has(r.projectId));
    if (idx === -1) return;
    const r = waiting.splice(idx, 1)[0];
    start(r);
  }

  function start(r) {
    active.set(r.projectId, r.runId);
    r.status = 'running';
    r.startedAt = kstStamp();

    let child;
    try {
      child = fork(cliPath, ['run', r.projectId], {
        env: Object.assign({}, process.env, agentRoot ? { IM_AGENT_ROOT: agentRoot } : {}),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
    } catch (e) {
      // fork 자체가 실패하면 여기서 끝낸다 (실행 중으로 남겨두지 않는다)
      return finish(r, 'failed', { error: `실행기 시작 실패: ${e.message}` });
    }

    r.pid = child.pid;
    children.set(r.runId, child);
    let tail = '';
    const keepTail = (buf) => {
      tail = (tail + String(buf)).slice(-4000);   // 실패 원인은 보통 끝에 있다
    };
    if (child.stdout) child.stdout.on('data', keepTail);
    if (child.stderr) child.stderr.on('data', keepTail);

    const timer = setTimeout(() => {
      r.timedOut = true;
      try { child.kill('SIGTERM'); } catch (_) { /* 이미 죽었을 수 있다 */ }
      // SIGTERM 을 무시하면 강제 종료한다
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 10_000);
    }, o.timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      finish(r, 'failed', { error: `실행 오류: ${e.message}`, log: tail });
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (r.timedOut) {
        return finish(r, 'failed', {
          error: `시간 초과 — ${Math.round(o.timeoutMs / 60000)}분 안에 끝나지 않아 중단했다`,
          exitCode: code, signal, log: tail,
        });
      }
      if (code === 0) return finish(r, 'done', { exitCode: 0, log: tail });
      finish(r, 'failed', {
        error: `생성 실패 (종료코드 ${code}${signal ? ', 신호 ' + signal : ''})`,
        exitCode: code, signal, log: tail,
      });
    });
  }

  return {
    /**
     * report-api.cjs 의 startRun 시그니처.
     * @returns {{runId, status, position}} 즉시 반환한다 — 끝날 때까지 기다리지 않는다
     */
    startRun(projectId, spec, user) {
      // ★ 같은 프로젝트를 동시에 돌리지 않는다.
      //   같은 폴더에 두 프로세스가 쓰면 산출물이 섞이고 쿼터도 두 배로 나간다.
      const runningId = active.get(projectId);
      if (runningId) {
        const cur = runs.get(runningId);
        const err = new Error(`이미 생성 중입니다 (실행 ${runningId}, 시작 ${cur ? cur.startedAt : '?'})`);
        err.conflict = true;
        throw err;
      }
      const queuedSame = waiting.find(w => w.projectId === projectId);
      if (queuedSame) {
        const err = new Error(`이미 대기열에 있습니다 (실행 ${queuedSame.runId})`);
        err.conflict = true;
        throw err;
      }

      const r = record({
        runId: 'run-' + (++seq) + '-' + Date.now().toString(36),
        projectId,
        docType: (spec && spec.docType) || null,
        specVersion: (spec && spec.version) || null,
        by: (user && user.name) || null,
        status: 'queued',
        queuedAt: kstStamp(),
        startedAt: null, finishedAt: null,
        exitCode: null, error: null, log: '',
      });
      waiting.push(r);
      pump();
      return { runId: r.runId, status: r.status, position: waiting.indexOf(r) + 1 };
    },

    /** 실행 기록 조회 — 화면이 진행 상황을 물어볼 때 쓴다 */
    get(runId) {
      const r = runs.get(runId);
      if (!r) return null;
      // 로그 전문을 그대로 내보내지 않는다. 실패 원인만 짧게
      return Object.assign({}, r, { log: r.status === 'failed' ? String(r.log || '').slice(-1200) : undefined });
    },

    /** 프로젝트의 최신 실행 */
    latestFor(projectId) {
      let best = null;
      for (const r of runs.values()) {
        if (r.projectId !== projectId) continue;
        if (!best || r.runId > best.runId) best = r;
      }
      return best ? this.get(best.runId) : null;
    },

    stats() {
      return { active: active.size, waiting: waiting.length, total: runs.size };
    },

    /**
     * 서버 종료 시 정리.
     * ★ 대기열만 비우면 실행 중인 자식이 남아 프로세스가 안 죽는다.
     *   운영에서는 배포 때마다 고아 프로세스가 쌓이고, 같은 프로젝트를
     *   다시 돌릴 때 파일이 섞인다.
     */
    stop() {
      waiting.length = 0;
      for (const [runId, child] of children) {
        try { child.kill('SIGTERM'); } catch (_) { /* 이미 죽었을 수 있다 */ }
        const r = runs.get(runId);
        if (r && (r.status === 'running' || r.status === 'queued')) {
          r.status = 'failed';
          r.error = '서버 종료로 중단됨';
          r.finishedAt = kstStamp();
        }
      }
      children.clear();
      active.clear();
    },
  };
}

module.exports = { createQueue, kstStamp, DEFAULTS };
