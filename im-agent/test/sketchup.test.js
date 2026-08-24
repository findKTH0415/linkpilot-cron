'use strict';
/**
 * sketchup.test.js — 12 SketchUp Plan / 13 Intake
 *
 * 작업지시서 인수조건을 그대로 잰다:
 *   단계 2 — 필수값이 있으면 계획이 나오고, 없으면 **내지 않는다**
 *   단계 4 — **일부러 어긋난 결과를 넣으면 검증이 빨개진다**
 * 그리고 D-96 을 코드로 고정한다 — facts 는 어느 경로로도 비어 있어야 한다.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const plan = require('../agents/12-sketchup-plan');
const intake = require('../agents/13-sketchup-intake');
const store = require('../core/store');
const { Dataset } = require('../core/facts');
const { FIELDS } = require('../core/dictionary');

const PID = 'LP-TEST-SKETCHUP';
const noop = { warn: () => {} };

function ds(values) {
  const d = new Dataset(PID, FIELDS);
  for (const [key, value] of Object.entries(values)) {
    d.add({ key, value, unit: '', confidence: 0.9, source: '시험 픽스처', sourceDate: '2026-08-24' });
  }
  d.resolve();
  return d;
}

function propertyDir() {
  return path.join(store.projectDir(PID), '04_Property');
}

test.beforeEach(() => { fs.rmSync(store.projectDir(PID), { recursive: true, force: true }); });
test.after(() => { fs.rmSync(store.projectDir(PID), { recursive: true, force: true }); });

// ── 단계 2 · 계획 ──────────────────────────────────────────

test('필수값이 있으면 계획이 나온다 — mm 로, facts 는 빈 배열로 (D-96)', async () => {
  const out = await plan.run({ projectId: PID }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600, 'building.floors': 4, 'building.height_m': 18 }),
    warn: noop.warn,
  });
  assert.deepStrictEqual(out.facts, [], 'D-96 — 모델 값은 fact 가 되지 않는다');
  assert.ok(out.plan, '계획이 나와야 한다');
  assert.strictEqual(out.plan.units, 'mm');
  assert.strictEqual(out.plan.building.floors, 4);
  assert.strictEqual(out.plan.building.floor_height_mm, 4500, '18m / 4층 → 4500mm');
  assert.ok(out.plan.building.footprint.width_mm > 1000, '길이가 mm 단위여야 한다 — m 로 남으면 천 배 작다');
  assert.strictEqual(out.plan.scale_status, 'VERIFIED');
  // 파일이 실제로 남는다
  const onDisk = JSON.parse(fs.readFileSync(path.join(propertyDir(), 'model-plan.json'), 'utf8'));
  assert.strictEqual(onDisk.created, out.plan.created);
});

test('대지면적이 없으면 계획을 내지 않는다 — MISSING 으로 적는다', async () => {
  const out = await plan.run({ projectId: PID }, {
    dataset: ds({ 'building.floors': 4 }),
    warn: noop.warn,
  });
  assert.strictEqual(out.plan, null);
  assert.ok(out.missing.includes('land.area_sqm'));
  assert.ok(!fs.existsSync(path.join(propertyDir(), 'model-plan.json')), '반쪽 계획 파일이 남으면 안 된다');
  assert.ok(out.flags.some(f => f.type === 'PLAN_MISSING'));
});

test('매스가 RED(용적률 초과)면 계획을 내지 않는다 — 성립하지 않는 계획은 모델이 되지 않는다', async () => {
  const out = await plan.run({
    projectId: PID,
    massing: { flags: [{ severity: 'RED', type: 'FAR_EXCEEDED', message: '초과' }] },
  }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 96000, 'building.floors': 4, 'building.height_m': 18 }),
    warn: noop.warn,
  });
  assert.strictEqual(out.plan, null);
  assert.ok(out.flags.some(f => f.type === 'PLAN_SKIPPED'));
});

// ── 단계 4 · 수령 ──────────────────────────────────────────

function writeResult(result) {
  fs.mkdirSync(propertyDir(), { recursive: true });
  fs.writeFileSync(path.join(propertyDir(), 'model-result.json'), JSON.stringify(result));
}

async function planThenIntake(result) {
  const out = await plan.run({ projectId: PID }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600, 'building.floors': 4, 'building.height_m': 18 }),
    warn: noop.warn,
  });
  writeResult({ plan_created: out.plan.created, ...result });
  return intake.run({ projectId: PID, plan: out.plan }, { warn: noop.warn });
}

test('결과가 없으면 unavailable — 지어내지도, 빨개지지도 않는다', async () => {
  const out = await intake.run({ projectId: PID, plan: null }, { warn: noop.warn });
  assert.strictEqual(out.status, 'unavailable');
  assert.deepStrictEqual(out.facts, []);
  assert.deepStrictEqual(out.flags, []);
});

test('★ 일부러 어긋난 결과를 넣으면 검증이 빨개진다 (인수조건)', async () => {
  const out = await planThenIntake({
    model: { floors: 7, gfa_m2: 20000, objects_count: 3 },
    validation: { solid: 'FAIL' },
    files: [],
  });
  assert.strictEqual(out.status, 'received');
  assert.deepStrictEqual(out.facts, [], 'D-96');
  const red = out.flags.filter(f => f.severity === 'RED');
  assert.ok(red.some(f => f.type === 'PLAN_MISMATCH' && /층수/.test(f.message)), '층수 어긋남은 RED');
  assert.ok(red.some(f => f.type === 'PLAN_MISMATCH' && /연면적/.test(f.message)), '연면적 어긋남은 RED');
  assert.ok(red.some(f => f.type === 'SOLID_FAIL'), 'Solid FAIL 은 RED');
  assert.ok(out.flags.some(f => f.type === 'OBJECT_COUNT'), '객체 수 어긋남은 YELLOW');
});

test('계획과 맞는 결과는 조용히 통과한다', async () => {
  const out = await planThenIntake({
    model: { floors: 4, gfa_m2: 9600, objects_count: 0 },
    validation: { solid: 'SKIPPED_MASSING' },
    files: [],
  });
  assert.strictEqual(out.flags.filter(f => f.severity === 'RED').length, 0);
});

test('AI 렌더에 disclaimer 가 없으면 YELLOW — 「실제 설계안이 아님」 없이는 싣지 않는다 (규격 §3-1)', async () => {
  const out = await planThenIntake({
    model: { floors: 4, gfa_m2: 9600, objects_count: 0 },
    validation: { solid: 'SKIPPED_MASSING' },
    files: [],
    renders: [
      { file: 'render_SC-001_veras_01.png', tool: 'veras', based_on: 'SC-001', ai_generated: true, disclaimer: 'AI 렌더 — 실제 설계안이 아님' },
      { file: 'render_SC-002_gemini_01.png', tool: 'gemini' },
    ],
  });
  const y = out.flags.filter(f => f.type === 'RENDER_DISCLAIMER');
  assert.strictEqual(y.length, 1, '표기가 온전한 렌더는 잡지 않고, 없는 것만 잡는다');
  assert.ok(/render_SC-002_gemini_01/.test(y[0].message));
});

test('결과가 적은 파일이 폴더에 없으면 YELLOW — 있다는 사실만 확인하고 파싱하지 않는다', async () => {
  const out = await planThenIntake({
    model: { floors: 4, gfa_m2: 9600, objects_count: 0 },
    validation: { solid: 'PASS' },
    files: ['project.skp'],
  });
  assert.ok(out.flags.some(f => f.type === 'FILE_MISSING' && /project\.skp/.test(f.message)));
});

test('옛 계획의 결과면 YELLOW — plan_created 가 지문이다', async () => {
  const out = await plan.run({ projectId: PID }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600, 'building.floors': 4, 'building.height_m': 18 }),
    warn: noop.warn,
  });
  writeResult({ plan_created: '2026-01-01T00:00:00+09:00', model: { floors: 4, gfa_m2: 9600 }, files: [] });
  const got = await intake.run({ projectId: PID, plan: out.plan }, { warn: noop.warn });
  assert.ok(got.flags.some(f => f.type === 'STALE_RESULT'));
});
