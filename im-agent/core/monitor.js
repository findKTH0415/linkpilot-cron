'use strict';
/**
 * monitor.js — Project Control Tower 상태 관리.
 *
 * ★ 이 파일의 가장 중요한 설계 결정:
 *   **Agent 진행률과 프로젝트 진행률을 분리한다.**
 *
 *   Agent가 78% 끝났다고 프로젝트가 78% 끝난 것이 아니다. 재무검증이 20%면
 *   그 문서는 배포할 수 없고, 사용자가 78%를 보고 '거의 다 됐다'고 오해하면
 *   검증되지 않은 투자문서가 나간다.
 *
 *   그래서 진행률을 4개 트랙으로 나누고, 전체 진행률은 4개의 가중합이다.
 *     ① PRODUCTION  50%  Agent 실행 (문서를 만드는 일)
 *     ② VALIDATION  25%  8 GATE 검증 (문서가 맞는지 확인하는 일)
 *     ③ OUTPUT      15%  출력 사양 확정 + 실제 파일 생성
 *     ④ APPROVAL    10%  사람 승인
 *
 *   Agent를 다 돌려도 검증 전이면 프로젝트는 최대 50%다.
 */

const fs = require('fs');
const path = require('path');
const store = require('./store');
const registry = require('./registry');
const { kstStamp } = require('./kst');

const STATE_PATH = '01_Project/monitor.json';
const ACTIVITY_PATH = '01_Project/activity.jsonl';

/** Agent별 작업 비중 (사양 §6 — 개수가 아니라 중요도로 계산한다) */
const WEIGHTS = {
  '10_output_spec': 3,
  '01_project': 2,
  '02_extraction': 12,
  '07_geo': 10,
  '03_research': 6,
  '04_financial': 15,
  '08_appraisal': 8,
  /* ★★ **합계는 100 이어야 한다** 〈2026-08-25 · 검사가 잡았다〉. 계산은
   *   실제 Agent 로 정규화하지만, **뜻을 읽으려면 100 이 기준이어야 한다** —
   *   그래서 새 Agent 를 더할 때는 어디서 덜어 올지 함께 정한다.
   * ★ 매스를 세우는 일과 그것을 계획으로 적는 일은 **한 일의 앞뒤**다.
   *   그래서 09 의 몫을 반으로 나눠 가진다 (8 → 4 + 4). 다른 Agent 는 안 건드린다 */
  '09_massing': 4,
  '12_sketchup_plan': 4,
  '05_validation': 10,
  '06_im_writer': 14,
  '11_final_validation': 12,
};

/** 트랙 배분 — 합계 100 */
const TRACK_WEIGHTS = { production: 50, validation: 25, output: 15, approval: 10 };

/** Agent 선행 의존 (사양 §7) */
const DEPENDS = {
  '10_output_spec': [],
  '01_project': [],
  '02_extraction': ['01_project'],
  '07_geo': ['02_extraction'],
  '03_research': ['01_project'],
  '04_financial': ['02_extraction', '07_geo'],
  '08_appraisal': ['04_financial', '07_geo'],
  '09_massing': ['07_geo'],
  '12_sketchup_plan': ['09_massing'],
  '05_validation': ['04_financial', '08_appraisal', '09_massing'],
  '06_im_writer': ['05_validation'],
  '11_final_validation': ['06_im_writer'],
};

const STATUS = {
  WAITING: 'WAITING', QUEUED: 'QUEUED', RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED', WARNING: 'WARNING', ERROR: 'ERROR',
  BLOCKED: 'BLOCKED', SKIPPED: 'SKIPPED', APPROVED: 'APPROVED',
};

/** runtime 상태 → 모니터 상태 */
const FROM_RUNTIME = {
  complete: STATUS.COMPLETED, warning: STATUS.WARNING,
  needs_review: STATUS.WARNING, blocked: STATUS.BLOCKED,
  skipped: STATUS.SKIPPED, error: STATUS.ERROR,
};

function read(projectId) {
  return store.readJson(projectId, STATE_PATH, null);
}

function write(projectId, state) {
  store.writeJson(projectId, STATE_PATH, state);
  return state;
}

/** 실행 시작 — 모든 Agent를 WAITING 으로 초기화한다 */
function start(projectId, { runId = null } = {}) {
  const agents = {};
  for (const a of registry.list()) {
    agents[a.id] = {
      id: a.id, label: a.label, weight: WEIGHTS[a.id] || 5,
      status: a.enabled ? STATUS.WAITING : STATUS.SKIPPED,
      progress: 0, activity: null, records: 0,
      startedAt: null, completedAt: null, elapsedMs: null,
      warnings: [], error: null, depends: DEPENDS[a.id] || [],
    };
  }
  return write(projectId, {
    projectId,
    runId: runId || `run-${Date.now()}`,
    startedAt: kstStamp(),
    startedAtMs: Date.now(),
    finishedAt: null,
    agents,
    currentAgent: null,
  });
}

/** Agent 상태 갱신 */
function update(projectId, agentId, patch) {
  const state = read(projectId);
  if (!state || !state.agents[agentId]) return null;

  const a = state.agents[agentId];
  Object.assign(a, patch);

  if (patch.status === STATUS.RUNNING && !a.startedAt) {
    a.startedAt = kstStamp();
    a.startedAtMs = Date.now();
    state.currentAgent = agentId;
  }
  if ([STATUS.COMPLETED, STATUS.WARNING, STATUS.ERROR, STATUS.SKIPPED, STATUS.BLOCKED].includes(patch.status)) {
    a.completedAt = kstStamp();
    a.elapsedMs = a.startedAtMs ? Date.now() - a.startedAtMs : null;
    a.progress = patch.status === STATUS.SKIPPED ? 0 : 100;
    if (state.currentAgent === agentId) state.currentAgent = null;
  }
  return write(projectId, state);
}

/** 현재 하위 작업 보고 (사양 §4 CURRENT ACTIVITY) */
function activity(projectId, agentId, message, { records = null, level = 'INFO' } = {}) {
  const state = read(projectId);
  if (state && state.agents[agentId]) {
    state.agents[agentId].activity = message;
    if (records !== null) state.agents[agentId].records = records;
    write(projectId, state);
  }
  const line = { at: kstStamp(), agent: agentId, message, level, records };
  const full = path.join(store.projectDir(projectId), ACTIVITY_PATH);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.appendFileSync(full, JSON.stringify(line) + '\n', 'utf8');
  return line;
}

function readActivity(projectId, { limit = 50, filter = null } = {}) {
  const full = path.join(store.projectDir(projectId), ACTIVITY_PATH);
  if (!fs.existsSync(full)) return [];
  const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);
  const filtered = filter ? lines.filter(l => l.agent.includes(filter) || l.level === filter) : lines;
  return filtered.slice(-limit);
}

function finish(projectId) {
  const state = read(projectId);
  if (!state) return null;
  state.finishedAt = kstStamp();
  state.elapsedMs = Date.now() - state.startedAtMs;
  state.currentAgent = null;
  return write(projectId, state);
}

// ══ 진행률 계산 ═══════════════════════════════════════════════

/** ① PRODUCTION — Agent 가중 진행률 */
function productionProgress(state) {
  if (!state) return { pct: 0, done: 0, total: 0 };
  const agents = Object.values(state.agents).filter(a => a.status !== STATUS.SKIPPED);
  const totalWeight = agents.reduce((s, a) => s + a.weight, 0) || 1;
  const earned = agents.reduce((s, a) => s + a.weight * (a.progress / 100), 0);
  return {
    pct: Math.round((earned / totalWeight) * 100),
    done: agents.filter(a => a.progress === 100).length,
    total: agents.length,
  };
}

/** ② VALIDATION — 검증은 Agent 실행과 별개로 센다 */
function validationProgress(projectId) {
  const final = store.readJson(projectId, '11_QC/final-validation.json', null);
  const cross = store.readJson(projectId, '11_QC/validation.json', null);

  if (!final) {
    return {
      pct: cross ? 20 : 0,
      detail: cross ? '교차검증만 완료 — 독립검증 미실행' : '검증 미실행',
      gatesPassed: 0, gatesTotal: 8, score: null, status: null,
    };
  }
  // GATE 통과율 60% + 점수 40%
  const gatePct = (final.summary.gatesPassed / final.summary.gatesTotal) * 60;
  const scorePct = (final.score.total / 100) * 40;
  return {
    pct: Math.round(gatePct + scorePct),
    detail: `GATE ${final.summary.gatesPassed}/${final.summary.gatesTotal} · ${final.score.total}점`,
    gatesPassed: final.summary.gatesPassed, gatesTotal: final.summary.gatesTotal,
    score: final.score.total, status: final.status,
    critical: final.summary.critical, major: final.summary.major, minor: final.summary.minor,
  };
}

/** ③ OUTPUT — 출력 사양 확정 + 실제 파일 존재 */
function outputProgress(projectId) {
  const spec = store.readJson(projectId, '01_Project/output-spec.json', null);
  const manifest = store.readJson(projectId, '12_Final/manifest.json', null);
  const dir = store.projectDir(projectId);

  const expected = [
    { path: '09_IM/im.md', label: 'IM 원문' },
    { path: '12_Final/im-a4.html', label: 'A4 인쇄본' },
    { path: '12_Final/content.json', label: '뷰어 데이터' },
    { path: '10_Teaser/teaser.md', label: 'Teaser' },
    { path: '12_Final/theme.json', label: '디자인 테마' },
    { path: '11_QC/validation-report.md', label: '검증 보고서' },
    { path: '11_QC/red-flag-report.md', label: 'RED FLAG 보고서' },
    { path: '11_QC/traceability-report.md', label: '추적성 보고서' },
  ];
  const files = expected.map(f => ({ ...f, exists: fs.existsSync(path.join(dir, f.path)) }));
  const filePct = (files.filter(f => f.exists).length / files.length) * 70;
  const specPct = spec ? (spec.locked ? 30 : 10) : 0;

  return {
    pct: Math.round(filePct + specPct),
    detail: spec ? (spec.locked ? `사양 ${spec.version} LOCKED` : '사양 DRAFT — 사람 확정 필요') : '사양 미생성',
    specLocked: !!(spec && spec.locked),
    files,
    manifestStatus: manifest ? manifest.status : null,
  };
}

/** ④ APPROVAL — 사람 승인 */
function approvalProgress(projectId) {
  const gate = require('./gate');
  const approval = gate.readApproval(projectId);
  const check = gate.canApprove(projectId);

  if (approval && approval.decision === 'APPROVE') {
    return { pct: 100, detail: `승인 완료 (${approval.approver})`, approved: true, reasons: [] };
  }
  if (approval && approval.decision === 'REJECT') {
    return { pct: 0, detail: `반려 (${approval.approver})`, approved: false, reasons: [approval.comment || '반려됨'] };
  }
  return {
    pct: check.allowed ? 50 : 0,
    detail: check.allowed ? '승인 대기 — 사람 승인만 남았다' : `승인 불가 (${check.reasons.length}건)`,
    approved: false, reasons: check.reasons,
  };
}

/** 프로젝트 건강도 (사양 §24) */
function health(validation, production) {
  if (validation.critical > 0 || validation.status === 'DISTRIBUTION BLOCKED') {
    return { level: 'BLOCKED', mark: '🔴', reason: `CRITICAL ${validation.critical || 0}건` };
  }
  if (Object.values(production.errorAgents || []).length) {
    return { level: 'AT RISK', mark: '🟠', reason: `Agent 실패 ${production.errorAgents.length}건` };
  }
  if (validation.major > 0) return { level: 'AT RISK', mark: '🟠', reason: `MAJOR ${validation.major}건` };
  if (validation.minor > 0) return { level: 'ATTENTION', mark: '🟡', reason: `경고 ${validation.minor}건` };
  return { level: 'HEALTHY', mark: '🟢', reason: '중대 문제 없음' };
}

/** 병목 탐지 (사양 §9) — 가장 오래 걸린 Agent 중 후속 의존이 많은 것 */
function bottleneck(state) {
  if (!state) return null;
  const finished = Object.values(state.agents).filter(a => a.elapsedMs);
  if (!finished.length) return null;

  const dependents = id => Object.values(DEPENDS).filter(list => list.includes(id)).length;
  const scored = finished.map(a => ({
    id: a.id, label: a.label, elapsedMs: a.elapsedMs,
    dependents: dependents(a.id),
    impact: a.elapsedMs * (1 + dependents(a.id)),
  })).sort((a, b) => b.impact - a.impact);

  const top = scored[0];
  const totalMs = finished.reduce((s, a) => s + a.elapsedMs, 0) || 1;
  return {
    ...top,
    sharePct: Math.round((top.elapsedMs / totalMs) * 100),
    impactLevel: top.dependents >= 2 ? 'HIGH' : (top.dependents === 1 ? 'MEDIUM' : 'LOW'),
  };
}

/** 의존성 미충족으로 대기 중인 Agent */
function blockedByDependency(state) {
  if (!state) return [];
  const out = [];
  for (const a of Object.values(state.agents)) {
    if (a.status !== STATUS.WAITING) continue;
    const unmet = (a.depends || []).filter(d => {
      const dep = state.agents[d];
      return dep && ![STATUS.COMPLETED, STATUS.WARNING, STATUS.SKIPPED].includes(dep.status);
    });
    if (unmet.length) out.push({ id: a.id, label: a.label, waitingFor: unmet });
  }
  return out;
}

/**
 * Control Tower 스냅샷 — 4개 패널.
 * ★ overall 은 4개 트랙의 가중합이다. Agent만 다 돌아도 100%가 되지 않는다.
 */
function snapshot(projectId) {
  const state = read(projectId);
  const project = store.readJson(projectId, '01_Project/project.json', {});

  const production = productionProgress(state);
  production.errorAgents = state
    ? Object.values(state.agents).filter(a => a.status === STATUS.ERROR).map(a => a.id) : [];
  const validation = validationProgress(projectId);
  const output = outputProgress(projectId);
  const approval = approvalProgress(projectId);

  const overall = Math.round(
    (production.pct * TRACK_WEIGHTS.production
      + validation.pct * TRACK_WEIGHTS.validation
      + output.pct * TRACK_WEIGHTS.output
      + approval.pct * TRACK_WEIGHTS.approval) / 100,
  );

  const elapsedMs = state ? (state.elapsedMs || (Date.now() - state.startedAtMs)) : 0;
  const estimate = overall > 5 && overall < 100
    ? Math.round((elapsedMs / overall) * (100 - overall))
    : null;

  return {
    project: {
      id: projectId, name: project.name || projectId,
      assetType: project.assetType || null, status: project.status || null,
    },
    overall,
    tracks: {
      production: { ...production, weight: TRACK_WEIGHTS.production, label: 'PRODUCTION (Agent 실행)' },
      validation: { ...validation, weight: TRACK_WEIGHTS.validation, label: 'VALIDATION (검증)' },
      output: { ...output, weight: TRACK_WEIGHTS.output, label: 'OUTPUT (사양·파일)' },
      approval: { ...approval, weight: TRACK_WEIGHTS.approval, label: 'APPROVAL (사람 승인)' },
    },
    agents: state ? Object.values(state.agents).sort((a, b) => {
      const ra = registry.get(a.id), rb = registry.get(b.id);
      return (ra ? ra.order : 99) - (rb ? rb.order : 99);
    }) : [],
    currentAgent: state ? state.currentAgent : null,
    health: health(validation, production),
    bottleneck: bottleneck(state),
    waiting: blockedByDependency(state),
    timing: {
      startedAt: state ? state.startedAt : null,
      finishedAt: state ? state.finishedAt : null,
      elapsedMs,
      estimatedRemainingMs: estimate,
      note: '예상 시간은 참고값이며 확정 시간이 아니다',
    },
    activity: readActivity(projectId, { limit: 12 }),
    generatedAt: kstStamp(),
  };
}

module.exports = {
  STATUS, WEIGHTS, TRACK_WEIGHTS, DEPENDS, FROM_RUNTIME,
  start, update, activity, readActivity, finish, read, snapshot,
  productionProgress, validationProgress, outputProgress, approvalProgress,
  health, bottleneck, blockedByDependency,
};
