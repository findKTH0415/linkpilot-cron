'use strict';
/**
 * orchestrator.js — Task 그래프를 실제로 돌리는 실행기.
 *
 *   계획(taskplan) → 배정(router) → **병렬 실행** → 검증 → 실패한 것만 재작업
 *
 * ★ 병렬이 어떻게 정해지는가
 *   사람이 "이것과 이것을 같이 돌려라"를 적지 않는다. 매 회전마다
 *   `tasks.readySet()` 이 **선행이 전부 끝난 Task 를 전부** 집어 한 번에 돌린다.
 *   그래서 하나가 느려도 다른 갈래는 기다리지 않는다.
 *
 *   ⚠️ 여기서 말하는 병렬은 **CPU 병렬이 아니다.** Node 한 프로세스 안의
 *      `Promise.all` 이다. 공공데이터 조회처럼 **기다리는 시간이 대부분인 일**은
 *      실제로 겹쳐 돌아 빨라지고, 순수 계산은 거의 안 빨라진다. 그 차이를
 *      숨기지 않으려고 이 줄을 적어 둔다.
 *
 * ★★ 경계 — 이 파일이 **하지 않는 것**
 *   Agent 결과를 dataset 에 병합하는 코드는 `pipeline.js` 가 갖고 있다.
 *   **여기로 베껴 오지 않는다.** 두 벌이 되면 엔진이 바뀌는 날 한쪽만 옛말을 하고,
 *   그 사실은 아무도 모른다 (D-68 에서 실제로 겪은 종류다).
 *
 *   따라서 지금 이 실행기의 결과는 **「Agent 를 순서·병렬로 돌리고 산출물을
 *   등록한 것」**까지다. IM 을 끝까지 만드는 정식 경로는 여전히 `pipeline.run()` 이다.
 *   둘을 하나로 합치는 문제는 등록부 **D-112** 에 올려 두었다
 *   (2026-08-25 에 D-85 에서 옮겼다 — 다른 갈래와 번호가 겹쳤다).
 */

const { runAgent, STATUS: RUN } = require('./runtime');
const tasks = require('./tasks');
const taskplan = require('./taskplan');
const artifacts = require('./artifacts');
const router = require('./router');
const lineage = require('./lineage');
const store = require('./store');
const monitor = require('./monitor');
const agentMerge = require('./agent-merge');
const { kstStamp } = require('./kst');

/**
 * Task 별 Agent 입력. **pipeline.js 가 주는 것과 같은 모양으로 준다.**
 * 여기에 없는 Agent 는 `{ projectId }` 만 받는다.
 */
const INPUT = {
  '10_output_spec': (ctx) => ({ projectId: ctx.projectId, docType: ctx.docType || null }),
  '01_project': (ctx) => ({ request: ctx.request || ctx.projectId, projectName: ctx.projectName, assetType: ctx.assetType }),
  '02_extraction': (ctx) => ({ projectId: ctx.projectId, useLlm: ctx.useLlm !== false }),
  '07_geo': (ctx) => ({ projectId: ctx.projectId, templateId: ctx.templateId || null }),
  '03_research': (ctx) => ({
    projectId: ctx.projectId,
    assetType: ctx.assetType || ctx.templateId || 'generic',
    templateId: ctx.templateId || null,
    location: ctx.fact('project.location'),
    projectName: ctx.fact('project.name') || ctx.projectId,
  }),
  '04_financial': (ctx) => ({ projectId: ctx.projectId, templateId: ctx.templateId || 'generic' }),
  '08_appraisal': (ctx) => ({ projectId: ctx.projectId, financial: ctx.outputs['04_financial'] || null }),
  '09_massing': (ctx) => ({ projectId: ctx.projectId, geo: ctx.outputs['07_geo'] || null }),
  '05_validation': (ctx) => ({
    projectId: ctx.projectId,
    financial: ctx.outputs['04_financial'] || null, research: ctx.outputs['03_research'] || null,
    geo: ctx.outputs['07_geo'] || null, appraisal: ctx.outputs['08_appraisal'] || null,
    massing: ctx.outputs['09_massing'] || null,
  }),
  '06_im_writer': (ctx) => ({
    projectId: ctx.projectId, docType: ctx.docType || null,
    financial: ctx.outputs['04_financial'] || null, research: ctx.outputs['03_research'] || null,
    validation: ctx.outputs['05_validation'] || null, geo: ctx.outputs['07_geo'] || null,
    appraisal: ctx.outputs['08_appraisal'] || null, massing: ctx.outputs['09_massing'] || null,
  }),
  '11_final_validation': (ctx) => ({
    projectId: ctx.projectId,
    financial: ctx.outputs['04_financial'] || null, validation: ctx.outputs['05_validation'] || null,
    writer: ctx.outputs['06_im_writer'] || null, geo: ctx.outputs['07_geo'] || null,
    appraisal: ctx.outputs['08_appraisal'] || null, massing: ctx.outputs['09_massing'] || null,
    research: ctx.outputs['03_research'] || null,
  }),
};

/** runtime 상태 → 이 Task 가 성공인가 */
const OK_STATUS = [RUN.COMPLETE, RUN.WARNING, RUN.NEEDS_REVIEW];

/**
 * 디스크에 이미 있는 것과 계획을 맞춘다.
 *
 * ★ 왜 필요한가 — `pipeline.run()` 으로 이미 다 만든 프로젝트에 계획을 붙일 때
 *   이것이 없으면 `01_project` 가 **프로젝트를 하나 더 만든다.** 그리고 이미
 *   나와 있는 IM 이 「막힘」으로 표시된다 — 사장님은 만들어진 문서를 보면서
 *   화면에서는 「안 됐다」를 읽게 된다.
 *
 * ★ 세 번 훑는다. 한 번만 훑으면 안 되는 이유가 각각 있다.
 *   ① 산출물이 다 있으면 끝난 것으로 — **막힘(BLOCKED)이어도** 그렇다.
 *      키가 지금 없는 것과, 그 값이 이미 나와 있는 것은 별개다.
 *   ② 선행 때문에 막혔던 것 중 선행이 살아난 것을 줄에 되돌린다.
 *   ③ 그러고도 못 도는 것을 다시 막는다.
 */
function reconcile(projectId, list) {
  const path = require('path');
  const present = t => (t.expectedOutputs || []).length
    && t.expectedOutputs.every(rel => artifacts.fingerprint(path.join(store.projectDir(projectId), rel)));

  // ① 산출물이 다 있는 Task → COMPLETED
  for (const t of list) {
    if (t.status === tasks.STATUS.COMPLETED) continue;
    // ★ 다른 Agent 안에서 도는 Task(handledBy)와 미구현 Task 는 건드리지 않는다.
    //   파일이 있다는 것이 「이 Task 가 돌았다」를 뜻하지 않는다 —
    //   실제로 계통 대조가 research.json 하나 때문에 「완료」로 뒤집힌 적이 있다
    if (t.handledBy || t.status === tasks.STATUS.PLANNED) continue;
    if (!present(t)) continue;
    if (t.status === tasks.STATUS.BLOCKED || t.status === tasks.STATUS.PLANNED || t.status === tasks.STATUS.SKIPPED) {
      tasks.advance(t, tasks.STATUS.QUEUED, { reason: null });
    }
    if (t.status !== tasks.STATUS.QUEUED) continue;
    tasks.advance(t, tasks.STATUS.READY);
    tasks.advance(t, tasks.STATUS.RUNNING);
    tasks.advance(t, tasks.STATUS.VALIDATING);
    tasks.advance(t, tasks.STATUS.PASSED, { validationStatus: 'PASSED', validationDetail: '산출물이 이미 있다' });
    tasks.advance(t, tasks.STATUS.COMPLETED, { reason: '앞선 실행의 산출물이 그대로 있다 — 다시 돌리지 않는다' });
    t.outputArtifacts = [];
    for (const rel of t.expectedOutputs) {
      const reg = artifacts.register(projectId, {
        relPath: rel, taskId: t.id, agentId: t.agentType,
        kind: rel.endsWith('.json') ? 'dataset' : 'document',
        note: '앞선 실행의 산출물 — 오케스트레이터가 등록만 했다',
      });
      t.outputArtifacts.push(reg.artifactId);
    }
  }

  // ② 선행 때문에 막혔던 것 중 선행이 살아난 것 → 다시 줄로
  const byId = tasks.index(list);
  for (const t of list) {
    if (t.status !== tasks.STATUS.BLOCKED) continue;
    if (!String(t.reason || '').startsWith('선행')) continue;   // 키 없음으로 막힌 것은 건드리지 않는다
    const deps = t.dependsOn.map(id => byId[id]).filter(Boolean);
    if (deps.every(d => tasks.TERMINAL.includes(d.status))) {
      tasks.advance(t, tasks.STATUS.QUEUED, { reason: null });
    }
  }

  // ③ 그러고도 못 도는 것을 다시 막는다 (번질 때까지)
  for (let i = 0; i < list.length + 1; i += 1) {
    const round = tasks.blockedSet(list);
    if (!round.length) break;
    for (const b of round) {
      tasks.advance(b.task, tasks.STATUS.BLOCKED, { reason: `선행 ${b.because.join(', ')} 이(가) 돌 수 없다` });
    }
  }
  return list;
}

/**
 * 계획을 세워 저장한다.
 * @returns {{doc, plan}}
 */
function planProject(projectId, opts = {}) {
  if (!store.exists(projectId)) throw new Error(`프로젝트 없음: ${projectId}`);
  const project = store.readJson(projectId, '01_Project/project.json', {}) || {};
  const p = taskplan.plan({
    request: opts.request || project.request || project.name || null,
    assetType: opts.assetType || (project.assetClass || null),
    templateId: opts.templateId || project.templateId || null,
    projectId,
  });
  for (const t of p.tasks) t.projectId = projectId;

  // 이미 끝난 것은 다시 QUEUED 로 돌리지 않는다 — 계획을 다시 세워도
  // 「어제 끝낸 일」이 오늘 미완료로 보이면 진행률이 거짓말을 한다
  const prev = tasks.load(projectId);
  if (prev && Array.isArray(prev.tasks)) {
    const byId = tasks.index(prev.tasks);
    for (const t of p.tasks) {
      const old = byId[t.id];
      if (!old) continue;
      if (old.status === tasks.STATUS.COMPLETED && t.status === tasks.STATUS.QUEUED) {
        t.status = tasks.STATUS.COMPLETED;
        t.startedAt = old.startedAt; t.completedAt = old.completedAt; t.elapsedMs = old.elapsedMs;
        t.outputArtifacts = old.outputArtifacts || [];
        t.validationStatus = old.validationStatus;
        t.retryCount = old.retryCount || 0;
        t.history = (old.history || []).concat([{ at: kstStamp(), from: 'QUEUED', to: 'COMPLETED', reason: '앞선 실행에서 이미 끝났다' }]);
      }
    }
  }

  reconcile(projectId, p.tasks);

  const doc = tasks.save(projectId, p.tasks, {
    planId: `plan-${Date.now()}`,
    template: p.template,
    assetClass: p.assetClass,
    request: opts.request || project.request || null,
  });
  return { doc, plan: p };
}

/**
 * Task 하나를 돌린다.
 * @returns {Promise<object>} 갱신된 task
 */
async function runOne(projectId, task, ctx) {
  const log = ctx.log || (() => {});

  // ★ QUEUED 는 바로 RUNNING 이 될 수 없다 (tasks.TRANSITIONS). READY 를 거친다.
  //   이 한 줄이 없어서 advance() 가 던졌고, 아래 catch 가 상태를 QUEUED 로 되돌려
  //   **같은 Task 가 영원히 다시 줄을 섰다.** 조용히 도는 무한회전이 가장 찾기 어렵다.
  if (task.status === tasks.STATUS.QUEUED) tasks.advance(task, tasks.STATUS.READY);

  // ① 사람이 넣어야 하는 Task — 기계가 대신 채우지 않는다
  if (task.humanInput && !ctx.humanProvided?.[task.id]) {
    tasks.advance(task, tasks.STATUS.RUNNING);
    tasks.advance(task, tasks.STATUS.WAITING, {
      reason: '사람이 값을 넣어야 진행된다 — 기계는 여기서 기다린다',
    });
    log(`◐ ${task.id} ${task.name} — 사람 입력 대기`);
    return task;
  }

  if (!task.agentType) {
    tasks.advance(task, tasks.STATUS.RUNNING);
    tasks.advance(task, tasks.STATUS.FAILED, { reason: '담당 Agent 가 배정되지 않았다' });
    return task;
  }

  tasks.advance(task, tasks.STATUS.RUNNING);

  const build = INPUT[task.agentType] || (c => ({ projectId: c.projectId }));
  const input = build(ctx);

  // ★ Dataset 은 **여기서 새로 만들지 않는다.** pipeline 이 가진 읽기/쓰기를 그대로 쓴다.
  //   여러 Task 가 동시에 도는 중이므로 **매번 새로 읽는다** — 한 번 읽어 돌려쓰면
  //   앞 Task 가 넣은 값이 뒤 Task 에 안 보이거나, 반대로 서로의 저장이 서로를 덮는다
  const pipeline = require('../pipeline');
  const dataset = pipeline.loadDataset(projectId);

  const r = await runAgent(task.agentType, input, {
    projectId,
    dataset,
    log,
    // ★ 이 Task 가 부를 수 있는 도구를 **내려보낸다.** Agent 가 스스로 고르지 않는다
    allowedTools: task.requiredTools,
  });
  ctx.results[task.id] = r;
  if (r.output) ctx.outputs[task.agentType] = r.output;

  // ★ 병합 절차는 core/agent-merge.js 한 벌뿐이다 — pipeline 과 **같은 코드**를 탄다.
  //   여기에 베껴 오면 엔진이 바뀌는 날 한쪽만 옛말을 한다 (D-68)
  if (r.output && agentMerge.mutatesDataset(task.agentType)) {
    agentMerge.apply(projectId, task.agentType, r.output, dataset, { save: pipeline.saveDataset });
    // ★ 병합은 dataset.json 을 바꾼다. 다시 등록하지 않으면 등록부와 디스크가 갈리고
    //   `artifacts.drift()` 가 그것을 「누가 몰래 고쳤다」로 잡는다 — 실제로 1건 떴다
    artifacts.register(projectId, {
      relPath: '01_Project/dataset.json', taskId: task.id, agentId: task.agentType,
      kind: 'dataset', note: `${task.agentType} 병합 결과`,
    });
  }

  task.warnings = r.warnings || [];

  if (!OK_STATUS.includes(r.status)) {
    tasks.advance(task, tasks.STATUS.FAILED, {
      error: r.error || `Agent 상태 ${r.status}`,
      reason: r.error || `Agent 상태 ${r.status}`,
      // 실행이 죽은 것 — 다시 돌리면 나을 수 있다 (조회 실패·일시 오류)
      failureKind: 'execution',
    });
    return task;
  }

  // ② 검증 — 「돌았다」와 「맞다」를 구분한다
  tasks.advance(task, tasks.STATUS.VALIDATING);
  const v = validate(projectId, task, r);
  if (!v.ok) {
    tasks.advance(task, tasks.STATUS.FAILED, {
      validationStatus: 'FAILED', validationDetail: v.detail, reason: v.detail,
      // ★ 검증 탈락은 **다시 돌려도 같은 답이 나온다.** 자료가 바뀌어야 낫는다.
      //   이것을 재시도로 돌리면 공공데이터 호출만 두 배로 쓴다 (CLAUDE.md §4.5)
      failureKind: 'validation',
    });
    return task;
  }
  tasks.advance(task, tasks.STATUS.PASSED, { validationStatus: 'PASSED', validationDetail: v.detail });

  // ③ 산출물 등록 — 여기서부터 다른 Task 가 이것을 입력으로 집을 수 있다
  const registered = [];
  for (const rel of (task.expectedOutputs || [])) {
    const reg = artifacts.register(projectId, {
      relPath: rel, taskId: task.id, agentId: task.agentType,
      kind: rel.endsWith('.json') ? 'dataset' : 'document',
      parents: task.inputArtifacts,
      validationScore: v.score,
    });
    registered.push(reg.artifactId);
    // ★ 파일이 실제로 없으면 경고로 남긴다. 「등록됐다」가 「있다」를 뜻하지 않는다
    const a = artifacts.get(projectId, reg.artifactId);
    if (a && !a.present) task.warnings.push(`산출물이 없다: ${rel}`);
  }
  task.outputArtifacts = registered;

  tasks.advance(task, tasks.STATUS.COMPLETED);
  return task;
}

/**
 * Task 결과 검증.
 *
 * ★ 여기서 새 검증을 발명하지 않는다. 이 저장소의 검증은 이미 두 Agent 가 한다
 *   (`05_validation` 교차검증 · `11_final_validation` 8 GATE). 여기서 보는 것은
 *   **「이 Task 가 자기 약속을 지켰는가」** 뿐이다 —
 *     ① 약속한 산출물이 실제로 생겼는가
 *     ② requiredQualityScore 가 있으면 그 점수를 넘겼는가
 */
function validate(projectId, task, result) {
  const missing = (task.expectedOutputs || []).filter(rel => !artifacts.fingerprint(
    require('path').join(store.projectDir(projectId), rel)
  ));

  // 산출물이 하나도 안 생겼으면 실패다. 일부만 없으면 경고로 둔다 —
  // Agent 가 자료 부족으로 그 절을 비우는 것은 정상이기 때문이다 (CLAUDE.md §4.6)
  if ((task.expectedOutputs || []).length && missing.length === task.expectedOutputs.length) {
    return { ok: false, score: null, detail: `약속한 산출물이 하나도 없다: ${missing.join(', ')}` };
  }

  let score = null;
  const out = result.output || {};
  if (typeof out.confidence === 'number') score = Math.round(out.confidence * 100);
  const final = store.readJson(projectId, '11_QC/final-validation.json', null);
  if (task.agentType === '11_final_validation' && final && final.score) score = final.score.total;

  // ★ 합격선을 여기서 새로 정하지 않는다. Agent 별 임계는 `registry.confidenceThreshold`
  //   가 이미 갖고 있고, 그것을 적용할지 말지도 `approvalRule` 이 정한다.
  //   임계 미달은 runtime 이 `needs_review` 로 내려보내며 — 그것은 **실패가 아니라
  //   사람 검토 대기**다. 여기서 또 자르면 정상 완료된 Agent 가 막힌다 (실제로 그랬다).
  if (Number.isFinite(task.requiredQualityScore) && score !== null && score < task.requiredQualityScore) {
    return { ok: false, score, detail: `품질점수 ${score} < 요구 ${task.requiredQualityScore}` };
  }
  if (result.status === RUN.NEEDS_REVIEW) {
    return { ok: true, score, detail: `사람 검토 필요 — ${(result.warnings || []).join(' / ') || '신뢰도 임계 미달'}` };
  }

  return {
    ok: true, score,
    detail: missing.length ? `산출물 일부 없음: ${missing.join(', ')}` : (score !== null ? `점수 ${score}` : '산출물 확인'),
  };
}

/**
 * 그래프를 끝까지 돌린다.
 *
 * @param {string} projectId
 * @param {object} opts { log, request, templateId, useLlm, humanProvided, maxWaves, dryRun }
 * @returns {Promise<{waves, summary, tasks, results, stoppedBecause}>}
 */
async function execute(projectId, opts = {}) {
  const log = opts.log || (m => console.log(m));
  const doc = tasks.load(projectId);
  if (!doc) throw new Error(`계획이 없다: ${projectId} — 먼저 plan 을 만든다`);
  const list = doc.tasks;

  const ctx = {
    projectId,
    request: opts.request || doc.request || null,
    templateId: opts.templateId || doc.template || null,
    assetType: doc.assetClass ? doc.assetClass.id : null,
    useLlm: opts.useLlm,
    docType: opts.docType || null,
    humanProvided: opts.humanProvided || {},
    results: {}, outputs: {}, log,
    // dataset 을 여기서 다시 만들지 않는다 — pipeline 이 가진 것을 그대로 읽는다 (D-68)
    fact: key => {
      try {
        const ds = require('../pipeline').loadDataset(projectId);
        const f = ds.get(key);
        return f ? String(f.value) : null;
      } catch (_) { return null; }
    },
  };

  const waveLog = [];
  const maxWaves = Number.isFinite(opts.maxWaves) ? opts.maxWaves : list.length + 5;
  let stoppedBecause = '할 일이 없다';

  const seenStates = () => list.map(t => `${t.id}:${t.status}:${t.retryCount}`).join('|');

  for (let w = 0; w < maxWaves; w += 1) {
    const ready = tasks.readySet(list);
    if (!ready.length) break;
    const before = seenStates();

    log(`\n── wave ${w + 1} — ${ready.length}건 동시 실행: ${ready.map(t => t.id).join(' ')}`);
    waveLog.push({ wave: w + 1, taskIds: ready.map(t => t.id), at: kstStamp() });

    if (opts.dryRun) {
      // 계획만 본다 — 무엇이 언제 도는지 보여주고 아무것도 실행하지 않는다
      for (const t of ready) tasks.advance(t, tasks.STATUS.SKIPPED, { reason: 'dry run' });
      continue;
    }

    // ★ 병렬. 한 Task 가 던져도 나머지 결과를 잃지 않는다 (실패 격리)
    await Promise.all(ready.map(async t => {
      try {
        await runOne(projectId, t, ctx);
      } catch (e) {
        if (t.status === tasks.STATUS.RUNNING || t.status === tasks.STATUS.VALIDATING) {
          tasks.advance(t, tasks.STATUS.FAILED, { error: e.message, reason: e.message });
        } else {
          t.error = e.message;
        }
      }
    }));

    // ── 실패한 것 중 여유가 남은 것은 재작업 줄에 다시 세운다 ──
    for (const t of list) {
      if (t.status !== tasks.STATUS.FAILED) continue;
      if (t.failureKind === 'validation') {
        // 같은 입력으로 다시 돌려도 같은 결과다 — 자료나 사람의 결정이 바뀌어야 한다
        tasks.advance(t, tasks.STATUS.BLOCKED, {
          reason: `검증 탈락 — 다시 돌려도 같은 결과다. 자료를 고쳐야 한다: ${t.validationDetail || t.reason || ''}`,
        });
        log(`✕ ${t.id} ${t.name} — 검증 탈락 (재시도하지 않는다)`);
      } else if (tasks.canRework(t)) {
        tasks.advance(t, tasks.STATUS.REWORK, { reason: `재작업 ${t.retryCount + 1}/${t.maxRetry}` });
        log(`↻ ${t.id} ${t.name} — 재작업 (${t.retryCount}/${t.maxRetry})`);
      } else {
        // ★ 상한을 넘긴 실패는 **조용히 두지 않는다.** 후행을 막아 「진행 중」으로
        //   보이지 않게 한다
        tasks.advance(t, tasks.STATUS.BLOCKED, { reason: `재작업 상한(${t.maxRetry}) 초과 — ${t.error || t.reason || '실패'}` });
        log(`✕ ${t.id} ${t.name} — 재작업 상한 초과`);
      }
    }
    for (const b of tasks.blockedSet(list)) {
      tasks.advance(b.task, tasks.STATUS.BLOCKED, { reason: `선행 ${b.because.join(', ')} 이(가) 돌 수 없다` });
    }

    tasks.save(projectId, list);   // 회전마다 저장 — 중간에 죽어도 어디까지 갔는지 남는다

    // ★ **한 회전에서 아무것도 안 바뀌었으면 멈춘다.** 안 그러면 같은 Task 가
    //   조용히 계속 돌면서 「도는 중」으로 보인다. 무한회전은 실패보다 나쁘다 —
    //   실패는 빨갛게 보이지만 회전은 안 보인다.
    if (seenStates() === before) {
      stoppedBecause = `회전이 진전을 못 냈다 (wave ${w + 1}) — ${ready.map(t => t.id).join(', ')} 이(가) 상태를 바꾸지 못했다`;
      log(`✕ ${stoppedBecause}`);
      break;
    }
  }

  const waiting = list.filter(t => t.status === tasks.STATUS.WAITING);
  if (waiting.length) stoppedBecause = `사람 입력 대기 ${waiting.length}건: ${waiting.map(t => t.id).join(', ')}`;

  tasks.save(projectId, list);
  const sum = tasks.summary(list);
  log(`\n계획 ${sum.total}건 · 완료 ${sum.done}/${sum.runnable} (${sum.pct}%)`
    + ` · 대기 ${sum.waiting} · 막힘 ${sum.blocked} · 미구현 ${sum.planned}`);

  return { waves: waveLog, summary: sum, tasks: list, results: ctx.results, stoppedBecause };
}

/**
 * ⑦ 재작업 엔진 — 값 하나가 바뀌었을 때 **영향받는 Task 만** 다시 돌린다.
 *
 * ★ 보고서를 처음부터 다시 만들지 않는다. `lineage.impact()` 가 이미
 *   「이 값을 바꾸면 어떤 Agent 가 다시 돌아야 하는가」를 알고 있다 —
 *   그 답을 Task 그래프에 옮겨 심는 것이 이 함수다.
 *
 * @param {string} projectId
 * @param {string} key  바뀐 값의 키 ('investment.total')
 * @param {object} opts { apply: true 면 표시까지, execute 는 부르는 쪽이 한다 }
 * @returns {{key, rerunOrder, marked, notFound, requiresNewVersion}}
 */
function markRework(projectId, key, opts = {}) {
  const imp = lineage.impact(projectId, key);
  const doc = tasks.load(projectId);
  if (!doc) throw new Error(`계획이 없다: ${projectId}`);
  const list = doc.tasks;

  // Agent id → Task (한 Agent 가 한 Task 를 맡는다)
  const byAgent = {};
  for (const t of list) if (t.agentType) byAgent[t.agentType] = t;

  const marked = [];
  const notFound = [];
  for (const agentId of imp.rerunOrder) {
    const t = byAgent[agentId];
    if (!t) { notFound.push(agentId); continue; }
    // 끝났거나 통과한 것만 되돌린다. 아직 안 돈 것은 어차피 곧 돈다
    if (![tasks.STATUS.COMPLETED, tasks.STATUS.PASSED, tasks.STATUS.FAILED].includes(t.status)) continue;
    if (!tasks.canRework(t)) { notFound.push(`${agentId}(재작업 상한)`); continue; }
    if (opts.apply !== false) {
      tasks.advance(t, tasks.STATUS.REWORK, { reason: `${imp.label || key} 변경 — 상류 값이 바뀌었다` });
    }
    marked.push({ taskId: t.id, name: t.name, agentId });
  }

  if (opts.apply !== false) tasks.save(projectId, list);

  return {
    key, label: imp.label,
    rerunOrder: imp.rerunOrder,
    marked, notFound,
    affectedDocuments: imp.affectedDocuments,
    // ★ 승인이 걸린 뒤의 변경은 **새 버전**이다. 조용히 덮으면 승인 기록이 거짓이 된다
    requiresNewVersion: imp.requiresNewVersion,
  };
}

/**
 * 화면·CLI 가 함께 읽는 요약. **한 곳에서만 만든다** (CLAUDE.md §8).
 */
function snapshot(projectId) {
  const doc = tasks.load(projectId);
  if (!doc) return null;
  const list = doc.tasks;
  const sum = tasks.summary(list);
  const ready = tasks.readySet(list);
  return {
    projectId, planId: doc.planId, template: doc.template, assetClass: doc.assetClass,
    summary: sum,
    waves: tasks.waves(list).map((w, i) => ({ wave: i + 1, tasks: w.map(t => ({ id: t.id, name: t.name, status: t.status })) })),
    ready: ready.map(t => ({ id: t.id, name: t.name, agent: t.agentLabel || t.agentType })),
    waiting: list.filter(t => t.status === tasks.STATUS.WAITING).map(t => ({ id: t.id, name: t.name, reason: t.reason })),
    blocked: list.filter(t => t.status === tasks.STATUS.BLOCKED).map(t => ({ id: t.id, name: t.name, reason: t.reason })),
    planned: list.filter(t => t.status === tasks.STATUS.PLANNED).map(t => ({ id: t.id, name: t.name, reason: t.reason })),
    elsewhere: list.filter(t => t.handledBy).map(t => ({ id: t.id, name: t.name, handledBy: t.handledBy })),
    artifacts: artifacts.summary(projectId),
    tools: router.toolStatus(),
    // ★ Task 진행률과 프로젝트 진행률을 같은 것으로 말하지 않는다 (monitor.js 와 같은 규칙)
    project: monitor.read(projectId) ? monitor.snapshot(projectId) : null,
    generatedAt: kstStamp(),
  };
}

module.exports = { planProject, execute, markRework, snapshot, runOne, validate, reconcile, INPUT };
