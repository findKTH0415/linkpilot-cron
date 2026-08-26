'use strict';
/**
 * orchestrator.test.js — Task 그래프·배정·재작업.
 *
 * 여기서 지키는 것은 「돌아간다」가 아니라 **「조용히 틀리지 않는다」**다.
 *   · 미구현 Agent 를 비슷한 것으로 대신 태우지 않는가
 *   · 계획에서 사라져 「원래 안 하는 일」이 되지 않는가
 *   · 같은 답이 나올 실패를 재시도해 호출만 쓰지 않는가
 *   · 무한회전으로 「도는 중」처럼 보이지 않는가
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'im-orch-'));
process.env.IM_AGENT_ROOT = ROOT;
process.env.IM_AGENT_OFFLINE = '1';

const tasks = require('../core/tasks');
const taskplan = require('../core/taskplan');
const router = require('../core/router');
const artifacts = require('../core/artifacts');
const orchestrator = require('../core/orchestrator');
const registry = require('../core/registry');
const store = require('../core/store');

const T = (id, deps = [], patch = {}) => Object.assign(
  tasks.makeTask({ id, name: id, dependsOn: deps }), patch,
);

// ══ 상태기계 ═════════════════════════════════════════════════

test('허용되지 않는 전이는 던진다 — QUEUED 는 바로 RUNNING 이 될 수 없다', () => {
  const t = T('A');
  assert.throws(() => tasks.advance(t, tasks.STATUS.RUNNING), /허용되지 않는 전이/);
  tasks.advance(t, tasks.STATUS.READY);
  tasks.advance(t, tasks.STATUS.RUNNING);
  assert.strictEqual(t.status, 'RUNNING');
});

test('전이는 전부 history 에 남는다 — 어떻게 여기까지 왔는지가 사라지지 않는다', () => {
  const t = T('A');
  tasks.advance(t, tasks.STATUS.READY);
  tasks.advance(t, tasks.STATUS.RUNNING);
  tasks.advance(t, tasks.STATUS.FAILED, { reason: '조회 실패' });
  assert.deepStrictEqual(t.history.map(h => `${h.from}>${h.to}`), ['QUEUED>READY', 'READY>RUNNING', 'RUNNING>FAILED']);
  assert.strictEqual(t.history[2].reason, '조회 실패');
});

test('REWORK 로 가면 지난 판정을 지운다 — 옛 판정이 새 결과의 것처럼 읽히지 않게', () => {
  const t = T('A', [], { status: 'COMPLETED', validationStatus: 'PASSED', validationDetail: '점수 91' });
  tasks.advance(t, tasks.STATUS.REWORK);
  assert.strictEqual(t.validationStatus, null);
  assert.strictEqual(t.validationDetail, null);
  assert.strictEqual(t.retryCount, 1);
});

// ══ 그래프 ═══════════════════════════════════════════════════

test('선행이 안 끝나면 readySet 에 안 나온다', () => {
  const list = [T('A'), T('B', ['A'])];
  assert.deepStrictEqual(tasks.readySet(list).map(t => t.id), ['A']);
});

test('★ 의존이 없으면 자동으로 같이 돈다 — 병렬을 사람이 적지 않는다', () => {
  const list = [T('A'), T('B'), T('C', ['A']), T('D', ['A'])];
  assert.deepStrictEqual(tasks.readySet(list).map(t => t.id).sort(), ['A', 'B']);
  for (const id of ['A']) {
    const t = list.find(x => x.id === id);
    t.status = 'COMPLETED';
  }
  assert.deepStrictEqual(tasks.readySet(list).map(t => t.id).sort(), ['B', 'C', 'D']);
});

test('순환 의존을 잡는다 — 못 잡으면 실행기가 「할 일이 없다」로 조용히 끝난다', () => {
  const list = [T('A', ['C']), T('B', ['A']), T('C', ['B'])];
  const cycles = tasks.findCycles(list);
  assert.ok(cycles.length >= 1, '순환을 못 잡았다');
});

test('없는 선행을 가리키면 잡는다 — 오타 하나로 Task 가 영원히 안 돈다', () => {
  const list = [T('A', ['NOPE'])];
  assert.deepStrictEqual(tasks.danglingDeps(list), [{ task: 'A', missing: 'NOPE' }]);
});

test('막힌 선행은 후행까지 번진다 — QUEUED 로 남으면 「순서가 안 왔다」로 읽힌다', () => {
  const list = [T('A', [], { status: 'BLOCKED' }), T('B', ['A']), T('C', ['B'])];
  // taskplan 이 쓰는 것과 같은 반복
  for (let i = 0; i < list.length + 1; i += 1) {
    const round = tasks.blockedSet(list);
    if (!round.length) break;
    for (const b of round) tasks.advance(b.task, tasks.STATUS.BLOCKED, { reason: 'dep' });
  }
  assert.deepStrictEqual(list.map(t => t.status), ['BLOCKED', 'BLOCKED', 'BLOCKED']);
});

test('진행률의 분모는 돌 수 있는 Task 다 — 미구현을 넣으면 영원히 100% 가 안 된다', () => {
  const list = [T('A', [], { status: 'COMPLETED' }), T('B', [], { status: 'PLANNED' })];
  const s = tasks.summary(list);
  assert.strictEqual(s.pct, 100);
  assert.strictEqual(s.planned, 1, '미구현 건수는 항상 함께 낸다');
});

// ══ 계획 ═════════════════════════════════════════════════════

test('★ 계획이 가리키는 Agent 는 전부 registry 에 있다 — 오타를 잡는다', () => {
  assert.deepStrictEqual(taskplan.unknownAgents(), []);
});

test('★★ 「오는 중」이라 적은 Agent 가 도착하면 일부러 빨개진다', () => {
  // 도착했는데 표를 안 지우면, 이미 와 있는 것을 아직 안 왔다고 말하는 표가 된다.
  // 이 검사가 빨개지면 router.INCOMING 에서 그 줄을 지우면 된다 — 그것이 할 일이다.
  assert.deepStrictEqual(taskplan.arrivedIncoming(), [],
    '이 Agent 들이 registry 에 들어왔다 — router.INCOMING 에서 지워라');
});

test('★ 「오는 중」은 이름과 출처를 함께 적는다 — 어디서 오는지 모르면 못 기다린다', () => {
  for (const [id, from] of Object.entries(router.INCOMING)) {
    assert.match(id, /^\d{2}_[a-z_]+$/, `Agent id 모양이 아니다: ${id}`);
    assert.ok(String(from).length > 4, `${id} 의 출처가 비었다`);
  }
});

test('★ 미구현 Agent 의 Task 는 지워지지 않고 PLANNED 로 남는다 (D-20)', () => {
  const p = taskplan.plan({ request: '평택 물류창고 개발' });
  const legal = p.tasks.find(t => t.id === 'T16');
  assert.ok(legal, '인허가 Task 가 계획에서 사라졌다');
  assert.strictEqual(legal.status, 'PLANNED');
  assert.match(legal.reason, /미구현/);
});

test('★ 미구현을 비슷한 Agent 로 대신 태우지 않는다', () => {
  const p = taskplan.plan({ request: '평택 물류창고 개발' });
  for (const id of ['T16', 'T17', 'T18', 'T19']) {
    const t = p.tasks.find(x => x.id === id);
    assert.strictEqual(t.agentType, null, `${id} 에 엉뚱한 Agent 가 배정됐다: ${t.agentType}`);
  }
});

test('자산군을 특정 못 하면 전용 Task 를 넣지 않고 그 사실을 말한다', () => {
  const p = taskplan.plan({ request: '무언가 검토해줘' });
  assert.strictEqual(p.assetClass, null);
  assert.ok(p.notes.some(n => n.includes('자산군')), '자산군을 못 잡았다는 말이 없다');
  assert.ok(!p.tasks.find(t => t.id === 'T13'), '자산군 미상인데 일사량 Task 가 들어갔다');
});

test('태양광이면 일사량 Task 가 들어가고, 데이터센터면 안 들어간다', () => {
  const solar = taskplan.plan({ request: '전남 태양광 100MW' });
  const dc = taskplan.plan({ request: '인천 데이터센터 개발' });
  assert.ok(solar.tasks.find(t => t.id === 'T13'), '태양광인데 일사량이 빠졌다');
  assert.ok(!dc.tasks.find(t => t.id === 'T13'), '데이터센터에 일사량이 들어갔다');
});

test('★ 다른 Agent 안에서 이미 도는 것은 또 부르지 않는다 — 같은 API 를 두 번 안 쓴다', () => {
  const p = taskplan.plan({ request: '전남 태양광 100MW' });
  const solarTask = p.tasks.find(t => t.id === 'T13');
  assert.strictEqual(solarTask.status, 'SKIPPED');
  assert.match(solarTask.reason, /07-geo/);
  assert.deepStrictEqual(solarTask.expectedOutputs, [], '남의 산출물을 자기 것으로 적으면 「끝났다」로 뒤집힌다');
});

test('계획 그래프에 순환·끊긴 선행이 없다', () => {
  for (const req of ['전남 태양광 100MW', '평택 물류창고', '인천 데이터센터', '남해 해상풍력']) {
    const p = taskplan.plan({ request: req });
    assert.deepStrictEqual(tasks.findCycles(p.tasks), [], `${req} 에 순환`);
    assert.deepStrictEqual(tasks.danglingDeps(p.tasks), [], `${req} 에 끊긴 선행`);
  }
});

// ══ 배정 (Router) ════════════════════════════════════════════

test('★ 키가 없으면 실행 전에 말한다 — 401 로 죽고 나서 알게 하지 않는다', () => {
  const saved = process.env.VWORLD_KEY;
  delete process.env.VWORLD_KEY;
  const a = router.assign('GEO_CADASTRE');
  assert.ok(a.toolsBlocked, '키가 없는데 쓸 수 있다고 한다');
  assert.match(a.reason, /VWORLD_KEY/);
  if (saved) process.env.VWORLD_KEY = saved;
});

test('★ 키 값은 어디에도 나오지 않는다 — 이름만 낸다 (CLAUDE.md §2)', () => {
  process.env.DART_API_KEY = 'SECRET-VALUE-1234567890';
  const dump = JSON.stringify(router.toolStatus()) + JSON.stringify(router.assign('CORPORATE_FINANCIALS'));
  assert.ok(!dump.includes('SECRET-VALUE'), '키 값이 새어 나왔다');
  assert.ok(dump.includes('DART_API_KEY'), '키 이름은 나와야 어느 키인지 안다');
  delete process.env.DART_API_KEY;
});

test('능력이 가리키는 커넥터는 전부 키 표에 있다', () => {
  for (const [id, cap] of Object.entries(router.CAPABILITIES)) {
    for (const name of [...(cap.tools || []), ...(cap.optional || [])]) {
      assert.ok(router.CONNECTOR_KEYS[name], `${id} 가 모르는 커넥터를 가리킨다: ${name}`);
    }
  }
});

test('구현된 Agent 를 가리키는 능력은 실제로 배정된다', () => {
  for (const id of Object.keys(registry.AGENTS)) {
    const cap = Object.entries(router.CAPABILITIES).find(([, c]) => (c.agents || []).includes(id));
    assert.ok(cap, `${id} 를 가리키는 능력이 없다 — 계획에서 영영 안 돈다`);
  }
});

// ══ Artifact Registry ════════════════════════════════════════

test('내용이 같으면 판이 안 오른다 — 「바뀌었다」가 거짓이 되지 않게', () => {
  const pid = 'LP-DC-2026-910';
  store.createProjectDirs(pid);
  store.writeText(pid, '09_IM/im.md', '# 안녕');
  const a = artifacts.register(pid, { relPath: '09_IM/im.md', taskId: 'T10', agentId: '06_im_writer' });
  const b = artifacts.register(pid, { relPath: '09_IM/im.md', taskId: 'T10', agentId: '06_im_writer' });
  assert.strictEqual(b.version, 1);
  assert.strictEqual(b.changed, false);
  assert.strictEqual(a.sha, b.sha);

  store.writeText(pid, '09_IM/im.md', '# 안녕 2');
  const c = artifacts.register(pid, { relPath: '09_IM/im.md', taskId: 'T10', agentId: '06_im_writer' });
  assert.strictEqual(c.version, 2);
  assert.strictEqual(c.changed, true);
});

test('등록 뒤 파일이 바뀌면 drift 로 잡는다 — 갈린 줄 모르는 것이 사고다', () => {
  const pid = 'LP-DC-2026-911';
  store.createProjectDirs(pid);
  store.writeText(pid, '09_IM/im.md', 'v1');
  artifacts.register(pid, { relPath: '09_IM/im.md', taskId: 'T10' });
  assert.deepStrictEqual(artifacts.drift(pid), []);
  store.writeText(pid, '09_IM/im.md', '누가 몰래 고쳤다');
  assert.strictEqual(artifacts.drift(pid).length, 1);
});

test('파일이 없으면 등록은 되지만 present=false 로 남는다', () => {
  const pid = 'LP-DC-2026-912';
  store.createProjectDirs(pid);
  const r = artifacts.register(pid, { relPath: '12_Final/deck.pptx', taskId: 'T19' });
  assert.strictEqual(artifacts.get(pid, r.artifactId).present, false);
  assert.strictEqual(artifacts.summary(pid).missing, 1);
});

test('근거를 거슬러 올라간다 — 기록이 없으면 「추적 불가」로 둔다', () => {
  const pid = 'LP-DC-2026-913';
  store.createProjectDirs(pid);
  store.writeText(pid, '07_Financial/financial.json', '{}');
  const fin = artifacts.register(pid, { relPath: '07_Financial/financial.json', taskId: 'T06' });
  store.writeText(pid, '09_IM/im.md', 'im');
  const im = artifacts.register(pid, { relPath: '09_IM/im.md', taskId: 'T10', parents: [fin.artifactId] });
  const tree = artifacts.ancestry(pid, im.artifactId);
  assert.strictEqual(tree.parents[0].relPath, '07_Financial/financial.json');
  assert.strictEqual(artifacts.ancestry(pid, '없는:것@v1').found, false);
});

// ══ 재작업 엔진 ══════════════════════════════════════════════

test('★ 총사업비를 바꾸면 영향받는 Task 만 REWORK — 추출·입지는 건드리지 않는다', () => {
  const pid = 'LP-DC-2026-920';
  store.createProjectDirs(pid);
  store.writeJson(pid, '01_Project/project.json', { name: '테스트', assetClass: 'datacenter' });
  const p = taskplan.plan({ request: '데이터센터', projectId: pid });
  for (const t of p.tasks) {
    if (['T03', 'T04', 'T06', 'T07', 'T09', 'T10', 'T11'].includes(t.id)) {
      t.status = 'COMPLETED'; t.reason = null;
    }
  }
  tasks.save(pid, p.tasks);

  const r = orchestrator.markRework(pid, 'investment.total');
  const marked = r.marked.map(m => m.taskId).sort();
  assert.deepStrictEqual(marked, ['T06', 'T07', 'T09', 'T10', 'T11'],
    `재작업 대상이 다르다: ${marked.join(',')}`);

  const after = tasks.index(tasks.load(pid).tasks);
  assert.strictEqual(after.T03.status, 'COMPLETED', '추출이 다시 돌게 표시됐다');
  assert.strictEqual(after.T04.status, 'COMPLETED', '입지가 다시 돌게 표시됐다');
});

test('재작업 순서는 lineage 의 순서를 그대로 따른다 — 재무 → 감정 → 검증 → 문서', () => {
  const pid = 'LP-DC-2026-921';
  store.createProjectDirs(pid);
  const p = taskplan.plan({ request: '데이터센터', projectId: pid });
  tasks.save(pid, p.tasks);
  const r = orchestrator.markRework(pid, 'investment.total', { apply: false });
  assert.deepStrictEqual(r.rerunOrder,
    ['04_financial', '08_appraisal', '05_validation', '06_im_writer', '11_final_validation']);
});

test('재작업 상한을 넘긴 것은 REWORK 로 표시하지 않는다', () => {
  const pid = 'LP-DC-2026-922';
  store.createProjectDirs(pid);
  const p = taskplan.plan({ request: '데이터센터', projectId: pid });
  const fin = p.tasks.find(t => t.id === 'T06');
  fin.status = 'COMPLETED'; fin.retryCount = fin.maxRetry;
  tasks.save(pid, p.tasks);
  const r = orchestrator.markRework(pid, 'investment.total');
  assert.ok(r.notFound.some(x => String(x).includes('04_financial')), '상한 초과를 말하지 않는다');
});

// ══ 실행기 ═══════════════════════════════════════════════════

test('★ 계획이 없으면 던진다 — 조용히 아무것도 안 하지 않는다', async () => {
  const pid = 'LP-DC-2026-930';
  store.createProjectDirs(pid);
  await assert.rejects(() => orchestrator.execute(pid, { log: () => {} }), /계획이 없다/);
});

test('★ 사람 입력이 필요한 Task 는 WAITING 으로 서고, 그 사실을 말한다', async () => {
  const pid = 'LP-DC-2026-931';
  store.createProjectDirs(pid);
  store.writeJson(pid, '01_Project/project.json', { name: 'T' });
  const one = tasks.makeTask({ id: 'H1', name: '사람 입력', humanInput: true });
  tasks.save(pid, [one]);
  const r = await orchestrator.execute(pid, { log: () => {} });
  assert.strictEqual(r.tasks[0].status, 'WAITING');
  assert.match(r.stoppedBecause, /사람 입력 대기/);
});

test('★ 검증 탈락은 재시도하지 않는다 — 같은 답이 또 나오고 호출만 쓴다', async () => {
  const pid = 'LP-DC-2026-932';
  store.createProjectDirs(pid);
  store.writeJson(pid, '01_Project/project.json', { name: 'T' });
  // Agent 는 정상으로 끝나지만 **약속한 산출물이 없는** Task — 검증에서 탈락한다
  const t = tasks.makeTask({ id: 'V1', name: '약속만 한 Task', agentType: '10_output_spec' });
  t.expectedOutputs = ['99_Nowhere/none.json'];
  tasks.save(pid, [t]);
  const r = await orchestrator.execute(pid, { log: () => {}, request: 'x' });
  assert.strictEqual(r.tasks[0].validationStatus, 'FAILED',
    `검증까지 못 갔다 — 실행 단계에서 죽었다: ${r.tasks[0].error || r.tasks[0].reason}`);
  assert.strictEqual(r.tasks[0].status, 'BLOCKED');
  assert.strictEqual(r.tasks[0].retryCount, 0, `재시도했다 (${r.tasks[0].retryCount}회)`);
  assert.match(r.tasks[0].reason, /다시 돌려도 같은 결과/);
});

test('★ 진전이 없으면 회전을 멈춘다 — 무한회전은 실패보다 나쁘다', async () => {
  const pid = 'LP-DC-2026-933';
  store.createProjectDirs(pid);
  store.writeJson(pid, '01_Project/project.json', { name: 'T' });
  const t = tasks.makeTask({ id: 'X1', name: '담당 없는 Task' });
  t.agentType = null; t.humanInput = false;
  tasks.save(pid, [t]);
  const r = await orchestrator.execute(pid, { log: () => {} });
  assert.ok(r.waves.length <= 3, `회전이 ${r.waves.length}번 돌았다 — 멈추지 않는다`);
});

test('dry run 은 아무것도 실행하지 않고 순서만 보여준다', async () => {
  const pid = 'LP-DC-2026-934';
  store.createProjectDirs(pid);
  store.writeJson(pid, '01_Project/project.json', { name: 'T' });
  const p = taskplan.plan({ request: '데이터센터', projectId: pid });
  tasks.save(pid, p.tasks);
  const r = await orchestrator.execute(pid, { log: () => {}, dryRun: true });
  assert.ok(r.waves.length >= 2, '회전이 안 나왔다');
  assert.ok(!fs.existsSync(path.join(store.projectDir(pid), '04_Property/geo.json')), 'dry run 인데 파일이 생겼다');
});

test('snapshot 은 Task 진행률과 프로젝트 진행률을 따로 낸다', () => {
  const pid = 'LP-DC-2026-935';
  store.createProjectDirs(pid);
  const p = taskplan.plan({ request: '데이터센터', projectId: pid });
  tasks.save(pid, p.tasks);
  const s = orchestrator.snapshot(pid);
  assert.ok(s.summary && typeof s.summary.pct === 'number');
  assert.ok(Array.isArray(s.waves) && s.waves.length > 1);
  assert.ok(Array.isArray(s.tools) && s.tools.length > 5, '도구 상태가 안 나온다');
  assert.ok('project' in s, 'Task 진행률만 내면 「거의 다 됐다」로 읽힌다');
});
