'use strict';
/**
 * tasks.js — Task 레코드와 상태기계.
 *
 * 이 시스템의 실행 단위를 **Agent 가 아니라 Task 로** 바꾸는 파일이다.
 *
 *   Agent 중심   "SketchUp Agent 에게 시켜라"      ← 사람이 담당자를 고른다
 *   Task 중심    "남해 풍력 투자검토를 만들어라"   ← 오케스트레이터가 쪼개고 배정한다
 *
 * ★ 왜 상태를 이렇게 많이 두는가
 *   RUNNING 과 WAITING 을 합치면 **「도는 중」과 「사람을 기다리는 중」이 같아 보인다.**
 *   그러면 밤새 돌려 놓고 아침에 와서야 "3시간 전부터 내 승인을 기다리고 있었다"를 안다.
 *   VALIDATING 과 PASSED 를 합치면 **검증을 건너뛴 것과 통과한 것이 같아 보인다** —
 *   이 저장소가 가장 경계하는 종류의 착시다 (monitor.js 의 4트랙과 같은 이유).
 *
 * ★ 상태 전이는 반드시 advance() 를 거친다. 직접 status 를 대입하지 않는다.
 *   전이표에 없는 이동은 던진다 — 조용히 허용하면 「어떻게 여기까지 왔는지」가 사라진다.
 */

const store = require('./store');
const { kstStamp } = require('./kst');

const TASKS_PATH = '01_Project/tasks.json';

/**
 * 상태.
 *
 * 정상 흐름   QUEUED → READY → RUNNING → VALIDATING → PASSED → COMPLETED
 * 사람 대기   RUNNING → WAITING → RUNNING
 * 재작업      VALIDATING → FAILED → REWORK → RUNNING
 * 못 함       QUEUED → BLOCKED (선행이 죽었다) · QUEUED → PLANNED (담당이 없다)
 */
const STATUS = {
  QUEUED: 'QUEUED',          // 만들어졌다. 선행이 아직 안 끝났다
  READY: 'READY',            // 선행이 전부 끝났다. 지금 돌 수 있다
  RUNNING: 'RUNNING',        // 도는 중
  WAITING: 'WAITING',        // 사람의 입력·승인을 기다린다 (기계는 놀고 있다)
  VALIDATING: 'VALIDATING',  // 결과가 나왔고 검증 중
  PASSED: 'PASSED',          // 검증 통과
  COMPLETED: 'COMPLETED',    // 산출물이 Artifact Registry 에 등록됐다
  FAILED: 'FAILED',          // 실행 실패 또는 검증 탈락
  REWORK: 'REWORK',          // 다시 돌리기로 정해졌다 (retry 여유가 있다)
  BLOCKED: 'BLOCKED',        // 선행이 영구 실패해 이 Task 는 돌 수 없다
  PLANNED: 'PLANNED',        // 담당 Agent 가 아직 구현되지 않았다 — 지어내지 않는다
  SKIPPED: 'SKIPPED',        // 이 자산군/이 딜에는 해당 없음
};

/** 끝난 것으로 치는 상태 — 후행 Task 의 선행 판정에 쓴다 */
const TERMINAL = [STATUS.COMPLETED, STATUS.SKIPPED];

/** 더 이상 진행할 수 없는 상태 — 후행은 BLOCKED 가 된다 */
const DEAD = [STATUS.BLOCKED, STATUS.PLANNED];

/**
 * 허용 전이표.
 * ★ 여기에 없는 이동은 예외다. "어쩌다 보니" 상태가 바뀌는 길을 남기지 않는다.
 */
const TRANSITIONS = {
  QUEUED: [STATUS.READY, STATUS.BLOCKED, STATUS.PLANNED, STATUS.SKIPPED],
  READY: [STATUS.RUNNING, STATUS.BLOCKED, STATUS.SKIPPED],
  RUNNING: [STATUS.VALIDATING, STATUS.WAITING, STATUS.FAILED],
  WAITING: [STATUS.RUNNING, STATUS.FAILED, STATUS.SKIPPED],
  VALIDATING: [STATUS.PASSED, STATUS.FAILED],
  PASSED: [STATUS.COMPLETED, STATUS.REWORK],
  COMPLETED: [STATUS.REWORK],          // 상류 값이 바뀌면 끝난 Task 도 다시 돈다
  FAILED: [STATUS.REWORK, STATUS.BLOCKED],
  REWORK: [STATUS.RUNNING, STATUS.BLOCKED],
  BLOCKED: [STATUS.QUEUED],            // 선행이 되살아나면 다시 줄을 선다
  PLANNED: [STATUS.QUEUED],            // 담당 Agent 가 구현되면 줄을 선다
  SKIPPED: [STATUS.QUEUED],
};

/**
 * Task 하나를 만든다.
 *
 * @param {object} spec
 *   id                    T01 처럼 프로젝트 안에서 유일한 값
 *   name                  사람이 읽는 이름 ("재무모델 작성")
 *   description           무엇을 하는 일인지 한 줄
 *   agentType             담당 Agent id (registry.js 의 키) 또는 null
 *   capability            필요한 능력 — router 가 이것으로 Agent·도구를 고른다
 *   dependsOn             선행 Task id 배열
 *   priority              작을수록 먼저 (같은 wave 안의 표시 순서)
 *   maxRetry              재작업 상한 (기본 2)
 *   requiredQualityScore  검증 통과 최저점 (0~100, null 이면 점수를 안 본다)
 *   humanInput            true 면 사람 입력이 필요한 Task (WAITING 으로 간다)
 */
function makeTask(spec) {
  if (!spec || !spec.id) throw new Error('Task 에 id 가 없다');
  if (!spec.name) throw new Error(`Task ${spec.id} 에 name 이 없다`);
  return {
    id: String(spec.id),
    projectId: spec.projectId || null,
    parentTaskId: spec.parentTaskId || null,
    name: spec.name,
    description: spec.description || '',
    agentType: spec.agentType || null,
    capability: spec.capability || null,
    requiredTools: Array.isArray(spec.requiredTools) ? spec.requiredTools.slice() : [],
    priority: Number.isFinite(spec.priority) ? spec.priority : 50,
    status: STATUS.QUEUED,
    dependsOn: Array.isArray(spec.dependsOn) ? spec.dependsOn.slice() : [],
    inputArtifacts: [],
    outputArtifacts: [],
    requiredQualityScore: Number.isFinite(spec.requiredQualityScore) ? spec.requiredQualityScore : null,
    validationStatus: null,
    validationDetail: null,
    retryCount: 0,
    maxRetry: Number.isFinite(spec.maxRetry) ? spec.maxRetry : 2,
    humanInput: Boolean(spec.humanInput),
    // 왜 못 도는지 — BLOCKED·PLANNED·SKIPPED 는 이유 없이 두지 않는다
    reason: spec.reason || null,
    warnings: [],
    error: null,
    history: [],
    createdAt: kstStamp(),
    startedAt: null,
    completedAt: null,
    elapsedMs: null,
  };
}

/** 상태 전이가 허용되는가 */
function canAdvance(from, to) {
  if (from === to) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

/**
 * 상태를 바꾼다. **이 함수 밖에서 task.status 에 대입하지 않는다.**
 * @param {object} task
 * @param {string} to
 * @param {object} patch  같이 기록할 것 (reason, error, warnings, validationStatus …)
 */
function advance(task, to, patch = {}) {
  const from = task.status;
  if (!Object.values(STATUS).includes(to)) throw new Error(`알 수 없는 상태: ${to}`);
  if (!canAdvance(from, to)) throw new Error(`허용되지 않는 전이: ${task.id} ${from} → ${to}`);

  task.status = to;
  Object.assign(task, patch);

  if (to === STATUS.RUNNING && !task.startedAt) {
    task.startedAt = kstStamp();
    task.startedAtMs = Date.now();
  }
  if (to === STATUS.COMPLETED || to === STATUS.BLOCKED || to === STATUS.SKIPPED) {
    task.completedAt = kstStamp();
    task.elapsedMs = task.startedAtMs ? Date.now() - task.startedAtMs : null;
  }
  if (to === STATUS.REWORK) {
    task.retryCount += 1;
    // 다시 도는 Task 는 지난 판정을 지운다 — 남겨 두면 옛 판정이 새 결과의 것처럼 읽힌다
    task.validationStatus = null;
    task.validationDetail = null;
    task.error = null;
    task.completedAt = null;
  }
  task.history.push({ at: kstStamp(), from, to, reason: patch.reason || null });
  return task;
}

/** 재작업 여유가 남았는가 */
function canRework(task) {
  return task.retryCount < task.maxRetry;
}

// ══ 그래프 ═══════════════════════════════════════════════════

/**
 * 지금 돌 수 있는 Task 들 — 선행이 전부 끝난 QUEUED/READY/REWORK.
 *
 * ★ 이것이 **병렬 실행의 전부**다. 「무엇과 무엇을 동시에 돌릴까」를 사람이
 *   정하지 않는다. 의존이 없으면 자동으로 같은 wave 에 들어간다.
 */
function readySet(tasks) {
  const byId = index(tasks);
  const out = [];
  for (const t of tasks) {
    if (![STATUS.QUEUED, STATUS.READY, STATUS.REWORK].includes(t.status)) continue;
    const deps = t.dependsOn.map(id => byId[id]).filter(Boolean);
    if (deps.some(d => !TERMINAL.includes(d.status))) continue;
    out.push(t);
  }
  return out.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

/**
 * 선행이 죽어서 영원히 못 도는 Task 들 — QUEUED 인 채로 남겨 두면
 * 「아직 순서가 안 왔다」로 읽힌다. 실제로는 영영 오지 않는다.
 */
function blockedSet(tasks) {
  const byId = index(tasks);
  const out = [];
  for (const t of tasks) {
    if (t.status !== STATUS.QUEUED) continue;
    const dead = t.dependsOn.map(id => byId[id]).filter(d => d && DEAD.includes(d.status));
    if (dead.length) out.push({ task: t, because: dead.map(d => d.id) });
  }
  return out;
}

/** id → task */
function index(tasks) {
  const m = {};
  for (const t of tasks) m[t.id] = t;
  return m;
}

/**
 * 의존 그래프에 순환이 있는가 — 있으면 readySet 이 영원히 비고, 실행기는
 * 「할 일이 없다」로 끝난다. **조용히 끝나는 것이 가장 나쁘다.**
 * @returns {string[][]} 순환 경로들 (없으면 빈 배열)
 */
function findCycles(tasks) {
  const byId = index(tasks);
  const state = {};   // 0=미방문 1=방문중 2=끝
  const cycles = [];
  const stack = [];

  const visit = id => {
    if (state[id] === 2) return;
    if (state[id] === 1) {
      cycles.push(stack.slice(stack.indexOf(id)).concat(id));
      return;
    }
    state[id] = 1;
    stack.push(id);
    for (const dep of (byId[id] ? byId[id].dependsOn : [])) {
      if (byId[dep]) visit(dep);
    }
    stack.pop();
    state[id] = 2;
  };

  for (const t of tasks) visit(t.id);
  return cycles;
}

/**
 * 선행 id 중 그래프에 없는 것 — 오타 하나로 Task 가 영원히 안 도는 것을 막는다.
 */
function danglingDeps(tasks) {
  const byId = index(tasks);
  const out = [];
  for (const t of tasks) {
    for (const d of t.dependsOn) if (!byId[d]) out.push({ task: t.id, missing: d });
  }
  return out;
}

/**
 * wave 별로 늘어놓는다 — 화면과 로그에서 「무엇이 동시에 도는가」를 보여줄 때 쓴다.
 * 실행기는 이 값을 쓰지 않는다 (실행은 매번 readySet 을 다시 계산한다 —
 * 도중에 실패·재작업이 생기면 wave 가 달라지기 때문이다).
 */
function waves(tasks) {
  const byId = index(tasks);
  const depth = {};
  const of = id => {
    if (depth[id] !== undefined) return depth[id];
    depth[id] = 0;   // 순환이 있어도 무한재귀에 빠지지 않게 먼저 심는다
    const t = byId[id];
    const deps = t ? t.dependsOn.filter(d => byId[d]) : [];
    depth[id] = deps.length ? Math.max(...deps.map(of)) + 1 : 0;
    return depth[id];
  };
  const out = [];
  for (const t of tasks) {
    const d = of(t.id);
    (out[d] = out[d] || []).push(t);
  }
  return out.map(w => (w || []).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)));
}

// ══ 저장 ═════════════════════════════════════════════════════

function save(projectId, tasks, meta = {}) {
  const prev = store.readJson(projectId, TASKS_PATH, null) || {};
  const doc = {
    projectId,
    planId: meta.planId || prev.planId || null,
    template: meta.template || prev.template || null,
    assetClass: meta.assetClass !== undefined ? meta.assetClass : (prev.assetClass || null),
    request: meta.request !== undefined ? meta.request : (prev.request || null),
    createdAt: prev.createdAt || kstStamp(),
    updatedAt: kstStamp(),
    tasks,
  };
  store.writeJson(projectId, TASKS_PATH, doc);
  return doc;
}

function load(projectId) {
  return store.readJson(projectId, TASKS_PATH, null);
}

/** 요약 — 상태별 개수. 화면·CLI 가 같은 값을 쓰게 한 곳에서 만든다 */
function summary(tasks) {
  const counts = {};
  for (const s of Object.values(STATUS)) counts[s] = 0;
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  const runnable = tasks.filter(t => !DEAD.includes(t.status) && t.status !== STATUS.SKIPPED);
  const done = runnable.filter(t => t.status === STATUS.COMPLETED);
  return {
    total: tasks.length,
    runnable: runnable.length,
    done: done.length,
    // ★ 진행률은 **돌 수 있는 Task** 를 분모로 한다. 미구현(PLANNED)을 분모에
    //   넣으면 영원히 100% 가 안 되고, 빼고 세면 「다 됐다」로 읽힌다 —
    //   그래서 아래 planned 를 항상 함께 낸다.
    pct: runnable.length ? Math.round((done.length / runnable.length) * 100) : 0,
    planned: counts[STATUS.PLANNED],
    blocked: counts[STATUS.BLOCKED],
    failed: counts[STATUS.FAILED],
    waiting: counts[STATUS.WAITING],
    counts,
  };
}

module.exports = {
  STATUS, TERMINAL, DEAD, TRANSITIONS, TASKS_PATH,
  makeTask, canAdvance, advance, canRework,
  readySet, blockedSet, index, findCycles, danglingDeps, waves,
  save, load, summary,
};
