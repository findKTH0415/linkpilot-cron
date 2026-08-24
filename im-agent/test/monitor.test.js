'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'im-monitor-'));
process.env.IM_AGENT_ROOT = ROOT;
process.env.IM_AGENT_OFFLINE = '1';

const monitor = require('../core/monitor');
const lineage = require('../core/lineage');
const store = require('../core/store');

let PID = null;

test('작업 비중 합계는 100 (개수가 아니라 중요도로 계산한다)', () => {
  const total = Object.values(monitor.WEIGHTS).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 100);
});

test('트랙 배분 합계는 100', () => {
  const total = Object.values(monitor.TRACK_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 100);
});

test('★ Agent 를 다 돌려도 검증 전이면 프로젝트는 최대 50% — 이 시스템의 핵심 규칙', () => {
  const pid = 'LP-DC-2026-801';
  store.createProjectDirs(pid);
  store.writeJson(pid, '01_Project/project.json', { name: 'T' });
  monitor.start(pid);

  // 모든 Agent 완료 처리
  for (const id of Object.keys(monitor.WEIGHTS)) {
    monitor.update(pid, id, { status: monitor.STATUS.COMPLETED, progress: 100 });
  }

  const snap = monitor.snapshot(pid);
  assert.strictEqual(snap.tracks.production.pct, 100, 'Agent 는 100%');
  assert.strictEqual(snap.tracks.validation.pct, 0, '검증은 아직 0%');
  assert.ok(snap.overall <= 50, `전체 진행률 ${snap.overall}% — Agent 100% 여도 50% 이하여야 한다`);
});

test('검증이 붙으면 전체 진행률이 오른다', () => {
  const pid = 'LP-DC-2026-801';
  const before = monitor.snapshot(pid).overall;
  store.writeJson(pid, '11_QC/final-validation.json', {
    status: 'APPROVED FOR DISTRIBUTION',
    score: { total: 96 },
    summary: { gatesPassed: 8, gatesTotal: 8, critical: 0, major: 0, minor: 0 },
  });
  const after = monitor.snapshot(pid).overall;
  assert.ok(after > before, `검증 반영 후 ${after}% > ${before}%`);
});

test('건강도: CRITICAL 이면 BLOCKED', () => {
  assert.strictEqual(monitor.health({ critical: 1, major: 0, minor: 0 }, {}).level, 'BLOCKED');
  assert.strictEqual(monitor.health({ critical: 0, major: 2, minor: 0 }, {}).level, 'AT RISK');
  assert.strictEqual(monitor.health({ critical: 0, major: 0, minor: 3 }, {}).level, 'ATTENTION');
  assert.strictEqual(monitor.health({ critical: 0, major: 0, minor: 0 }, {}).level, 'HEALTHY');
});

test('의존성 미충족 Agent 는 대기로 표시된다', () => {
  const pid = 'LP-DC-2026-802';
  store.createProjectDirs(pid);
  monitor.start(pid);
  const waiting = monitor.blockedByDependency(monitor.read(pid));
  const financial = waiting.find(w => w.id === '04_financial');
  assert.ok(financial, '재무모델은 선행 Agent 를 기다려야 한다');
  assert.ok(financial.waitingFor.includes('02_extraction'));
});

test('활동 로그가 시간순으로 쌓인다', () => {
  const pid = 'LP-DC-2026-803';
  store.createProjectDirs(pid);
  monitor.start(pid);
  monitor.activity(pid, '07_geo', '토지경계 분석 시작', { records: 12 });
  monitor.activity(pid, '07_geo', '도로접면 분석', { records: 128 });
  monitor.activity(pid, '04_financial', 'CAPEX 재계산', { level: 'WARN' });

  const log = monitor.readActivity(pid);
  assert.strictEqual(log.length, 3);
  assert.strictEqual(log[2].agent, '04_financial');
  assert.strictEqual(log[1].records, 128);
  assert.strictEqual(monitor.read(pid).agents['07_geo'].records, 128);
});

test('모니터 실패가 Agent 실행을 막지 않는다', async () => {
  const { runAgent } = require('../core/runtime');
  // 모니터 상태 파일이 없는 프로젝트에서도 Agent 는 돌아야 한다
  const pid = 'LP-DC-2026-804';
  store.createProjectDirs(pid);
  const r = await runAgent('10_output_spec', { projectId: pid }, { projectId: pid, log: () => {} });
  assert.notStrictEqual(r.status, 'error');
});

// ── 통합 ───────────────────────────────────────────────────
test('파이프라인 실행 후 Control Tower 4개 트랙이 채워진다', async () => {
  const pipeline = require('../pipeline');
  const r = await pipeline.run({ request: '인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성', log: () => {} });
  const dest = path.join(store.projectDir(r.projectId), '02_Source_Data');
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'samples'))) {
    fs.copyFileSync(path.join(__dirname, '..', 'samples', f), path.join(dest, f));
  }
  await pipeline.run({ projectId: r.projectId, log: () => {} });
  PID = r.projectId;

  const snap = monitor.snapshot(PID);
  assert.ok(snap.tracks.production.pct >= 90, '제작 트랙');
  assert.ok(snap.tracks.validation.pct > 0, '검증 트랙');
  assert.ok(snap.tracks.output.pct > 0, '산출 트랙');
  assert.strictEqual(snap.tracks.approval.pct, 0, '승인 전');
  assert.ok(snap.overall < snap.tracks.production.pct, '전체는 제작 진행률보다 낮아야 한다');
  assert.strictEqual(snap.agents.length, 13);
  assert.ok(snap.bottleneck, '병목이 탐지된다');
  assert.ok(fs.existsSync(path.join(store.projectDir(PID), '01_Project/control-tower.json')));
});

test('재실행 시 기존 프로젝트의 01_project 가 진행률을 왜곡하지 않는다', () => {
  const snap = monitor.snapshot(PID);
  const proj = snap.agents.find(a => a.id === '01_project');
  assert.strictEqual(proj.status, monitor.STATUS.COMPLETED);
  assert.strictEqual(snap.tracks.production.pct, 100);
});

// ── 데이터 계보 ────────────────────────────────────────────
test('데이터 계보: 원천자료 → 확정값 → 문서까지 추적된다', () => {
  const r = lineage.trace(PID, 'building.gfa_sqm');
  assert.strictEqual(r.found, true);

  const stages = r.chain.map(c => c.stage);
  assert.ok(stages.includes('SOURCE'));
  assert.ok(stages.includes('RESOLVED'));
  assert.ok(stages.includes('DOCUMENT'));

  // 채택되지 않은 후보도 보여준다 — 어느 값이 버려졌는지 알아야 한다
  const rejected = r.chain.filter(c => c.stage === 'SOURCE' && !c.adopted);
  assert.strictEqual(rejected.length, 1);
  assert.strictEqual(rejected[0].value, 54822);
  assert.strictEqual(r.conflicted, true);
});

test('데이터 계보: 계산에 쓰인 값은 CALCULATION 단계를 가진다', () => {
  const r = lineage.trace(PID, 'revenue.annual');
  assert.ok(r.chain.some(c => c.stage === 'CALCULATION'), '재무모델 입력임이 드러나야 한다');
  assert.ok(r.consumers.some(c => c.stage === 'FINANCIAL MODEL'));
});

test('데이터 계보: 없는 값은 지어내지 않는다', () => {
  const r = lineage.trace(PID, 'capacity.leasable_sqm');
  assert.strictEqual(r.found, false);
  assert.match(r.reason, /데이터셋에 없다/);
});

test('변경 영향: 매출을 바꾸면 재무·감정평가·검증·문서가 다시 돈다', () => {
  const r = lineage.impact(PID, 'revenue.annual');
  assert.ok(r.rerunOrder.includes('04_financial'));
  assert.ok(r.rerunOrder.includes('08_appraisal'));
  assert.ok(r.rerunOrder.includes('11_final_validation'));
  assert.ok(r.affectedValues.some(v => v.key === 'returns.equity_irr'));
  assert.ok(r.totalAffected > 15);
});

test('변경 영향: 재실행 순서는 의존 순서를 따른다', () => {
  const r = lineage.impact(PID, 'land.area_sqm');
  const fin = r.rerunOrder.indexOf('04_financial');
  const val = r.rerunOrder.indexOf('05_validation');
  const wri = r.rerunOrder.indexOf('06_im_writer');
  const fnl = r.rerunOrder.indexOf('11_final_validation');
  assert.ok(val > fin && wri > val && fnl > wri, `순서 위반: ${r.rerunOrder.join(' → ')}`);
});

test('변경 영향: 어떤 값이든 검증·문서는 항상 다시 돈다', () => {
  const r = lineage.impact(PID, 'project.sponsor');
  assert.ok(r.affectedAgents.includes('05_validation'));
  assert.ok(r.affectedAgents.includes('06_im_writer'));
  assert.ok(r.affectedAgents.includes('11_final_validation'));
});

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
