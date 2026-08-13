'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'im-final-'));
process.env.IM_AGENT_ROOT = ROOT;
process.env.IM_AGENT_OFFLINE = '1';

const { verifyScenario, irrNewton, npv, moic, classify } = require('../finance/verify');
const { buildModel } = require('../finance/model');
const outputspec = require('../core/outputspec');
const store = require('../core/store');
const finalAgent = require('../agents/11-final-validation');
const reports = require('../core/reports');

let PIPELINE_PID = null;

const SAMPLE = {
  landCost: 480, constructionCost: 2180, otherCost: 186, totalCost: 2846,
  annualRevenue: 420, opexAnnual: 126, opexRatio: null, rampYears: 2,
  debtAmount: 1850, debtRate: 5.8, tenorYears: 12, graceYears: 3, feePct: 1,
  taxRate: 22, depreciationYears: 30,
  constructionYears: 3, opsYears: 15, exitYear: 10,
  exitCapRate: 5.5, sellingCostPct: 1.5, discountRate: 8,
};

// ── GATE 03 독립 재계산 ────────────────────────────────────
test('Newton-Raphson IRR 이 이분법과 같은 답을 낸다 (알고리즘 교차검증)', () => {
  const cfs = [-1000, 200, 300, 400, 500];
  const r = irrNewton(cfs);
  assert.ok(Math.abs(r - 0.128257) < 1e-4, `실제 ${r}`);
  assert.ok(Math.abs(npv(r, cfs)) < 1e-6, 'IRR을 넣으면 NPV가 0');
});

test('Newton-Raphson: 부호변화 없으면 null', () => {
  assert.strictEqual(irrNewton([100, 200]), null);
});

test('정상 모델은 독립 재계산에서 전부 PASS', () => {
  const model = buildModel(SAMPLE);
  const r = verifyScenario(model);
  assert.strictEqual(r.worst, 'PASS', JSON.stringify(r.checks.filter(c => c.level !== 'PASS')));
  assert.ok(r.checks.length >= 12);
});

test('발표값을 조작하면 CRITICAL 로 잡힌다 — 이것이 독립검증의 존재 이유', () => {
  const model = buildModel(SAMPLE);
  const tampered = JSON.parse(JSON.stringify(model));
  tampered.metrics.equityIRR = 22.5;

  const r = verifyScenario(tampered);
  const c = r.checks.find(x => x.item === 'Equity IRR');
  assert.strictEqual(c.level, 'CRITICAL');
  assert.ok(c.diffPct > 5);
  assert.strictEqual(r.worst, 'CRITICAL');
});

test('현금흐름표 내부 항등식이 깨지면 잡힌다', () => {
  const model = buildModel(SAMPLE);
  const broken = JSON.parse(JSON.stringify(model));
  const ops = broken.periods.find(p => p.phase === 'operation');
  ops.noi = ops.noi + 50; // NOI ≠ 매출 − 운영비

  const r = verifyScenario(broken);
  const c = r.checks.find(x => x.item === 'NOI = 매출 − 운영비');
  assert.strictEqual(c.level, 'CRITICAL');
});

test('자금조달 항등식 위반 검출', () => {
  const model = buildModel(SAMPLE);
  const broken = JSON.parse(JSON.stringify(model));
  broken.metrics.equityAmount = broken.metrics.equityAmount + 300;

  const r = verifyScenario(broken);
  const c = r.checks.find(x => x.item === '차입 + 자본 = 총사업비');
  assert.ok(['CRITICAL', 'MAJOR', 'WARNING'].includes(c.level));
});

test('오차 등급 (사양 §10)', () => {
  assert.strictEqual(classify(100, 100.3).level, 'PASS');      // 0.3%
  assert.strictEqual(classify(100, 100.8).level, 'MINOR');     // 0.8%
  assert.strictEqual(classify(100, 102).level, 'WARNING');     // 2%
  assert.strictEqual(classify(100, 104).level, 'MAJOR');       // 4%
  assert.strictEqual(classify(100, 120).level, 'CRITICAL');    // 20%
  assert.strictEqual(classify(null, 100).level, 'UNVERIFIABLE');
});

// ── 출력 사양 ──────────────────────────────────────────────
test('출력 사양은 문서유형별 기본값에서 제안된다 (AI가 확정하지 않는다)', () => {
  const pid = 'LP-DC-2026-901';
  store.createProjectDirs(pid);
  const spec = outputspec.propose(pid, { docType: 'teaser' });
  assert.strictEqual(spec.pageSize, 'A4');
  assert.strictEqual(spec.targetPages, 3);
  assert.strictEqual(spec.confirmed, false, 'AI 제안은 확정이 아니다');
  assert.strictEqual(spec.locked, false);
});

test('출력 사양 확정은 사람만 할 수 있다', () => {
  const pid = 'LP-DC-2026-902';
  store.createProjectDirs(pid);
  outputspec.save(pid, outputspec.propose(pid, { docType: 'im', overrides: { formats: ['html', 'json'] } }));
  assert.throws(() => outputspec.confirm(pid, { by: 'writer-agent' }), /사람만/);
  const locked = outputspec.confirm(pid, { by: '김대표' });
  assert.strictEqual(locked.locked, true);
  assert.strictEqual(locked.confirmedBy, '김대표');
});

test('생성 불가 형식은 사양 단계에서 막는다 (HWP를 만들 수 있는 척하지 않는다)', () => {
  const pid = 'LP-DC-2026-903';
  store.createProjectDirs(pid);
  const spec = outputspec.propose(pid, { docType: 'im', overrides: { formats: ['hwp'] } });
  const check = outputspec.validateSpec(spec);
  assert.strictEqual(check.ok, false);
  assert.ok(check.problems.some(p => /HWP 생성 불가/.test(p)));
  outputspec.save(pid, spec);
  assert.throws(() => outputspec.confirm(pid, { by: '김대표' }), /불완전/);
});

test('확정 후 중대 변경은 확정을 해제하고 버전을 올린다 (사양 §27)', () => {
  const pid = 'LP-DC-2026-904';
  store.createProjectDirs(pid);
  outputspec.save(pid, outputspec.propose(pid, { docType: 'im', overrides: { formats: ['html'] } }));
  const locked = outputspec.confirm(pid, { by: '김대표' });
  assert.strictEqual(locked.version, 'v1.0');

  const r = outputspec.change(pid, { orientation: 'landscape' }, { by: '김대표', reason: '투자자 요청' });
  assert.ok(r.materialChanges.includes('orientation'));
  assert.strictEqual(r.versionBumped, true);
  assert.strictEqual(r.spec.version, 'v1.1');
  assert.strictEqual(r.spec.locked, false, '중대 변경 후에는 다시 확정해야 한다');
});

test('경미한 변경은 버전을 올리지 않는다', () => {
  const pid = 'LP-DC-2026-905';
  store.createProjectDirs(pid);
  outputspec.save(pid, outputspec.propose(pid, { docType: 'im', overrides: { formats: ['html'] } }));
  outputspec.confirm(pid, { by: '김대표' });
  const r = outputspec.change(pid, { watermark: true }, { by: '김대표' });
  assert.strictEqual(r.versionBumped, false);
  assert.strictEqual(r.spec.locked, true);
});

test('페이지 예산은 절별로 배분되고 목표에 맞춘다 ("약 30페이지" 라고 쓰지 않는다)', () => {
  const sections = Array.from({ length: 20 }, (_, i) => ({
    no: String(i + 1).padStart(2, '0'), id: `s${i}`, title: `Section ${i}`,
    text: '내용\n'.repeat(10 + i * 3),
  }));
  const budget = outputspec.buildPageBudget(sections, 40, { coverIncluded: true });
  assert.strictEqual(budget.sections.length, 20);
  assert.ok(budget.sections.every(s => s.pages >= 1), '모든 절은 최소 1페이지');
  assert.ok(Math.abs(budget.total - 40) <= 2, `예산 ${budget.total} 이 목표 40 근처여야 한다`);
});

test('파일명 규칙 (사양 §22)', () => {
  const n = outputspec.fileName({ projectName: '인천 남동공단 데이터센터', docType: 'im', language: 'ko', version: 'v1.0', date: '2026-08-13' });
  assert.match(n, /^인천남동공단데이터센터_im_KO_v1\.0_20260813$/);
  assert.ok(!/[^\wㄱ-ㅎ가-힣.]/.test(n.replace(/_/g, '')), '특수문자 없음');
});

// ── 교차 대조 ──────────────────────────────────────────────
test('IM ↔ Teaser 수치 불일치 검출 (사양 §15)', () => {
  const im = '| Equity IRR | 16.7% |';
  const teaser = '| Equity IRR | 18.2% |';
  const r = finalAgent.crossCheckImTeaser(im, teaser);
  assert.strictEqual(r.mismatches.length, 1);
  assert.match(r.mismatches[0], /16\.7%.*18\.2%/);
});

test('IM ↔ Teaser 일치하면 통과', () => {
  const doc = '| Equity IRR | 16.7% |';
  assert.strictEqual(finalAgent.crossCheckImTeaser(doc, doc).mismatches.length, 0);
});

test('IM 데이터셋 ↔ 재무모델 불일치 검출 (사양 §14)', () => {
  const { Dataset } = require('../core/facts');
  const { FIELDS } = require('../core/dictionary');
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'returns.equity_irr', value: 20.0, unit: '%', source: 'stale' });
  ds.resolve();

  const financial = { scenarios: { base: { metrics: { equityIRR: 15.92, projectIRR: null, minDSCR: null, npv: null, exitValue: null, noiStabilized: null } } } };
  const r = finalAgent.crossCheckImFinancial(ds, financial);
  assert.strictEqual(r.mismatches.length, 1);
  assert.match(r.mismatches[0], /Equity IRR/);
});

// ── 점수 · 판정 ────────────────────────────────────────────
test('CRITICAL 이 하나라도 있으면 배포 차단 (사양 §41)', () => {
  assert.ok(finalAgent.BLOCKING.has('IRR_CALCULATION_ERROR'));
  assert.ok(finalAgent.BLOCKING.has('UNRESOLVED_DATA_CONFLICT'));
  assert.ok(finalAgent.BLOCKING.has('TEASER_IM_MISMATCH'));
});

test('배점 합계는 100점', () => {
  const total = Object.values(finalAgent.WEIGHTS).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 100);
});

// ── 통합 ───────────────────────────────────────────────────
test('파이프라인 통합: 8개 GATE + 4종 보고서 + manifest', async () => {
  const pipeline = require('../pipeline');
  const r = await pipeline.run({ request: '인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성', log: () => {} });

  const dest = path.join(store.projectDir(r.projectId), '02_Source_Data');
  const sampleDir = path.join(__dirname, '..', 'samples');
  for (const f of fs.readdirSync(sampleDir)) fs.copyFileSync(path.join(sampleDir, f), path.join(dest, f));
  const r2 = await pipeline.run({ projectId: r.projectId, log: () => {} });

  PIPELINE_PID = r.projectId;
  const final = r2.finalValidation;
  assert.ok(final, '최종검증이 실행되어야 한다');
  assert.strictEqual(final.gates.length, 8, '8개 GATE');
  assert.ok(final.score.total >= 0 && final.score.total <= 100);
  assert.strictEqual(final.calculation.worst, 'PASS', '실제 모델은 독립 재계산을 통과해야 한다');
  assert.strictEqual(final.traceability.coverage, 1, '핵심 수치 전부 추적 가능');

  const dir = store.projectDir(r.projectId);
  for (const f of ['11_QC/validation-report.md', '11_QC/red-flag-report.md', '11_QC/traceability-report.md', '12_Final/manifest.json']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} 미생성`);
  }
  const manifest = store.readJson(r.projectId, '12_Final/manifest.json');
  assert.match(manifest.status, /DRAFT|BLOCKED/, '사양 미확정이면 최종본이 아니다');
});

test('출력 사양이 확정되지 않으면 승인이 차단된다', () => {
  const gate = require('../core/gate');
  assert.ok(PIPELINE_PID, '앞 테스트에서 파이프라인이 실행되어야 한다');
  const c = gate.canApprove(PIPELINE_PID);
  assert.strictEqual(c.allowed, false);
  assert.ok(c.reasons.some(r => /출력 사양 미확정/.test(r)));
});

test('보고서는 자료출처 캡션 규칙을 지킨다', () => {
  const md = fs.readFileSync(path.join(store.projectDir(PIPELINE_PID), '11_QC/validation-report.md'), 'utf8');
  assert.ok(md.includes('자료출처:'));
  assert.ok(md.includes('Strictly Private and Confidential'));
  assert.ok(md.includes('독립 재계산'));
});

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
