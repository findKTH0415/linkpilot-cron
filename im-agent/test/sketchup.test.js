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

/** 09_massing 이 낸 것과 같은 모양의 모델 — 계산 자리는 09 하나다 */
function massingOut(over = {}) {
  return {
    model: { floors: 4, floorHeight: 4.5, footprintAreaSqm: 3200, footprintBasis: '시험 픽스처', ...over },
    flags: [],
    confidence: 0.9,
  };
}

test('매스 모델이 있으면 계획이 나온다 — mm 로, facts 는 빈 배열로 (D-96)', async () => {
  const out = await plan.run({ projectId: PID, massing: massingOut() }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600, 'building.height_m': 18 }),
    warn: noop.warn,
  });
  assert.deepStrictEqual(out.facts, [], 'D-96 — 모델 값은 fact 가 되지 않는다');
  assert.ok(out.plan, '계획이 나와야 한다');
  assert.strictEqual(out.plan.units, 'mm');
  assert.strictEqual(out.plan.building.floors, 4, '층수는 매스 모델에서 그대로 온다');
  assert.strictEqual(out.plan.building.floor_height_mm, 4500, '4.5m → 4500mm');
  assert.ok(out.plan.building.footprint.width_mm > 1000, '길이가 mm 단위여야 한다 — m 로 남으면 천 배 작다');
  assert.strictEqual(out.plan.scale_status, 'VERIFIED');
  // 파일이 실제로 남는다
  const onDisk = JSON.parse(fs.readFileSync(path.join(propertyDir(), 'model-plan.json'), 'utf8'));
  assert.strictEqual(onDisk.created, out.plan.created);
});

test('매스 모델이 없으면 계획을 내지 않는다 — 층수·건축면적을 여기서 다시 계산하지 않는다', async () => {
  const out = await plan.run({ projectId: PID, massing: null }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600, 'building.floors': 4 }),
    warn: noop.warn,
  });
  assert.strictEqual(out.plan, null, 'dataset 에 값이 다 있어도 매스 없이는 계획을 만들지 않는다');
  assert.ok(out.missing.includes('massing.model'));
  assert.ok(!fs.existsSync(path.join(propertyDir(), 'model-plan.json')), '반쪽 계획 파일이 남으면 안 된다');
  assert.ok(out.flags.some(f => f.type === 'PLAN_MISSING'));
});

test('매스가 RED(용적률 초과)면 계획을 내지 않는다 — 성립하지 않는 계획은 모델이 되지 않는다', async () => {
  const out = await plan.run({
    projectId: PID,
    massing: { ...massingOut(), flags: [{ severity: 'RED', type: 'FAR_EXCEEDED', message: '초과' }] },
  }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 96000 }),
    warn: noop.warn,
  });
  assert.strictEqual(out.plan, null);
  assert.ok(out.flags.some(f => f.type === 'PLAN_SKIPPED'));
});

test('지적 링과 법정 분석이 계획에 옮겨진다 — mm 폴리곤·legal 블록 (2026-08-25 지시)', async () => {
  const out = await plan.run({
    projectId: PID,
    massing: {
      ...massingOut({
        footprintRing: [[0, 0], [56.57, 0], [56.57, 56.57], [0, 56.57]],
        parcelRing: [[-10, -5], [140, -10], [150, 80], [70, 120], [-15, 90]],
      }),
      inputs: { farLimit: 350, bcrLimit: 70, farPlanned: 76.8, bcrPlanned: 25.6, gfaAllowedSqm: 43750, limitSource: '국토계획법 시행령(일반공업지역)' },
    },
  }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600, 'building.height_m': 18 }),
    warn: noop.warn,
  });
  assert.ok(out.plan.site.parcel_polygon_mm, '지적선이 계획에 실려야 한다');
  assert.deepStrictEqual(out.plan.site.parcel_polygon_mm[1], [140000, -10000], 'm → mm 변환');
  assert.strictEqual(out.plan.building.footprint_polygon_mm.length, 4);
  assert.strictEqual(out.plan.legal.verdict, 'WITHIN_LIMITS');
  assert.strictEqual(out.plan.legal.far_planned_pct, 76.8);
  assert.deepStrictEqual(out.plan.objects, [], '데이터센터(자산유형 미지정)에는 개념 배치를 그리지 않는다');
});

test('아파트면 판상형 개념 배치가 나온다 — ASSUMPTION 표기와 함께, fact 는 여전히 빈 배열 (D-100)', async () => {
  const out = await plan.run({
    projectId: PID,
    massing: massingOut({
      floors: 20, floorHeight: 2.9,
      footprintAreaSqm: 5000,
      footprintRing: [[0, 0], [100, 0], [100, 180], [0, 180]],
      parcelRing: [[-5, -5], [110, -5], [110, 190], [-5, 190]],
    }),
  }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 60000, 'project.assetType': '아파트' }),
    warn: noop.warn,
  });
  assert.deepStrictEqual(out.facts, [], 'D-96 — 개념 배치도 fact 가 아니다');
  assert.ok(out.plan.objects.length >= 1, '판상형 동이 최소 하나');
  const bar = out.plan.objects[0];
  assert.strictEqual(bar.type, 'building_bar');
  assert.strictEqual(bar.depth, 13000, '판상형 통상 깊이 13m');
  assert.ok(/ASSUMPTION/.test(bar.source.origin), '통상치임이 출처에 박혀야 한다');
  assert.ok(out.plan.notes.some(n => /설계안이 아니다/.test(n)), '설계안 아님 표기');
});

test('동 길이는 GFA 를 넘겨 그리지 않는다 — 건폐율 기준이 넘치면 GFA 로 자른다 (D-104)', async () => {
  const gfa = 39000;
  const out = await plan.run({
    projectId: PID,
    massing: massingOut({
      floors: 20, floorHeight: 2.9,
      footprintAreaSqm: 5530,
      // bbW 122.7m → 건폐율 기준 동 길이 98.2m. 다 채우면 연면적이 GFA 를 한참 넘는다
      footprintRing: [[0, 0], [122.72, 0], [122.72, 90], [0, 90]],
    }),
  }, {
    dataset: ds({ 'land.area_sqm': 15800, 'building.gfa_sqm': gfa, 'project.assetType': '아파트' }),
    warn: noop.warn,
  });
  const bars = out.plan.objects.filter(o => o.type === 'building_bar');
  assert.ok(bars.length >= 1);
  const totalGfaSqm = bars.reduce((s, b) => s + (b.width / 1000) * (b.depth / 1000), 0) * 20;
  assert.ok(totalGfaSqm <= gfa * 1.001,
    `동을 다 채운 연면적(${Math.round(totalGfaSqm)}㎡)이 문서 GFA(${gfa}㎡)를 넘으면 안 된다`);
  assert.ok(bars[0].width < Math.round(122720 * 0.8), '건폐율 기준 길이가 GFA 상한으로 잘려야 한다');
  assert.ok(out.plan.notes.some(n => /GFA 로 제한/.test(n)), '자른 사실이 notes 에 남아야 한다');
});

test('도로필지가 있으면 지적선과 같은 좌표계로 계획에 실린다 (D-105)', async () => {
  const out = await plan.run({
    projectId: PID,
    massing: massingOut({
      parcelRing: [[-10, -5], [140, -10], [150, 80], [70, 120], [-15, 90]],
      roadRings: [
        { pnu: '1111000000000000000', jibun: '10도', category: '도로', ring: [[-10, -13], [140, -18], [140, -10], [-10, -5]] },
      ],
    }),
  }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600 }),
    warn: noop.warn,
  });
  const roads = out.plan.site.road_polygons_mm;
  assert.ok(Array.isArray(roads) && roads.length === 1, '도로필지가 계획에 실려야 한다');
  assert.strictEqual(roads[0].category, '도로');
  assert.deepStrictEqual(roads[0].polygon_mm[1], [140000, -18000], 'm → mm 변환 (지적선과 같은 원점)');
  assert.ok(out.plan.notes.some(n => /도로필지 1필지 동봉/.test(n)));
  assert.deepStrictEqual(out.facts, [], 'D-96 — 도로 형상도 fact 가 아니다');
});

test('도로필지가 없으면 null 이고 그 사실이 notes 에 남는다 — 지어내지 않는다 (D-105)', async () => {
  const out = await plan.run({
    projectId: PID,
    massing: massingOut({ parcelRing: [[-10, -5], [140, -10], [150, 80], [70, 120], [-15, 90]] }),
  }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600 }),
    warn: noop.warn,
  });
  assert.strictEqual(out.plan.site.road_polygons_mm, null);
  assert.ok(out.plan.notes.some(n => /도로필지 미확보/.test(n)));
});

// ── 단계 4 · 수령 ──────────────────────────────────────────

function writeResult(result) {
  fs.mkdirSync(propertyDir(), { recursive: true });
  fs.writeFileSync(path.join(propertyDir(), 'model-result.json'), JSON.stringify(result));
}

async function planThenIntake(result) {
  const out = await plan.run({ projectId: PID, massing: massingOut() }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600, 'building.height_m': 18 }),
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
      { file: 'render_SC-001_veras_01.png', tool: 'veras', tool_version: '4.0', engine: 'Nano Banana Pro', based_on: 'SC-001', ai_generated: true, disclaimer: 'AI 렌더 — 실제 설계안이 아님' },
      { file: 'render_SC-002_gemini_01.png', tool: 'gemini' },
    ],
  });
  const y = out.flags.filter(f => f.type === 'RENDER_DISCLAIMER');
  assert.strictEqual(y.length, 1, '표기가 온전한 렌더는 잡지 않고, 없는 것만 잡는다');
  assert.ok(/render_SC-002_gemini_01/.test(y[0].message));
});

test('AI 렌더에 도구·버전 기록이 없으면 YELLOW — 세대(Veras 4.0 = Nano Banana Pro)마다 그림이 달라 출처 표기다 (규격 §3-1)', async () => {
  const out = await planThenIntake({
    model: { floors: 4, gfa_m2: 9600, objects_count: 0 },
    validation: { solid: 'SKIPPED_MASSING' },
    files: [],
    renders: [
      { file: 'render_SC-001_veras_01.png', tool: 'veras', tool_version: '4.0', engine: 'Nano Banana Pro', based_on: 'SC-001', ai_generated: true, disclaimer: 'AI 렌더 — 실제 설계안이 아님' },
      { file: 'render_SC-003_veras_02.png', tool: 'veras', based_on: 'SC-003', ai_generated: true, disclaimer: 'AI 렌더 — 실제 설계안이 아님' },
    ],
  });
  const y = out.flags.filter(f => f.type === 'RENDER_TOOL_UNKNOWN');
  assert.strictEqual(y.length, 1, 'tool_version 이 빠진 렌더만 잡는다');
  assert.ok(/render_SC-003_veras_02/.test(y[0].message));
});

test('표준(Veras 4.0)이 아닌 렌더는 RENDER_TOOL_NONSTANDARD YELLOW — 2026-08-25 사장님 지시 「반드시」', async () => {
  const out = await planThenIntake({
    model: { floors: 4, gfa_m2: 9600, objects_count: 0 },
    validation: { solid: 'SKIPPED_MASSING' },
    files: [],
    renders: [
      // 표준 그대로 — 잡지 않는다
      { file: 'render_SC-001_veras_01.png', tool: 'veras', tool_version: '4.0', engine: 'Nano Banana Pro', based_on: 'SC-001', ai_generated: true, disclaimer: 'AI 렌더 — 실제 설계안이 아님' },
      // 무료 경로: gemini + 같은 기반 모델 — 잡지 않는다 (규격 §3-1)
      { file: 'render_SC-001_gemini_01.png', tool: 'gemini', tool_version: 'app', engine: 'Nano Banana Pro', based_on: 'SC-001', ai_generated: true, disclaimer: 'AI 렌더 — 실제 설계안이 아님' },
      // 구세대 Veras — 잡는다
      { file: 'render_SC-002_veras_01.png', tool: 'veras', tool_version: '3.1', based_on: 'SC-002', ai_generated: true, disclaimer: 'AI 렌더 — 실제 설계안이 아님' },
      // 다른 도구 — 잡는다
      { file: 'render_SC-002_mj_01.png', tool: 'midjourney', tool_version: '7', based_on: 'SC-002', ai_generated: true, disclaimer: 'AI 렌더 — 실제 설계안이 아님' },
    ],
  });
  const y = out.flags.filter(f => f.type === 'RENDER_TOOL_NONSTANDARD');
  assert.strictEqual(y.length, 2, '표준·무료 경로는 통과하고 구세대·다른 도구만 잡는다');
  assert.ok(y.every(f => /Veras 4\.0 \(Nano Banana Pro 기반\)/.test(f.message)), '메시지가 표준을 이름으로 말한다');
  assert.ok(y.some(f => /render_SC-002_veras_01/.test(f.message)));
  assert.ok(y.some(f => /render_SC-002_mj_01/.test(f.message)));
});

test('계획 파일의 조감도 항목이 렌더 표준을 나른다 — render_standard (한 곳: outputspec.RENDER_STANDARD)', async () => {
  const out = await plan.run({ projectId: PID, massing: massingOut() }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600, 'building.height_m': 18 }),
    warn: noop.warn,
  });
  const bird = (out.deliverables || []).find(d => d.id === 'birdseye');
  assert.ok(bird, '조감도 항목이 있다');
  assert.strictEqual(bird.render_standard, 'Veras 4.0 (Nano Banana Pro 기반)');
  const cad = (out.deliverables || []).find(d => d.id === 'cadastral');
  assert.ok(cad && cad.render_standard === undefined, '지적도면에는 렌더 표준을 달지 않는다 — 실사 렌더 대상이 아니다');
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
  const out = await plan.run({ projectId: PID, massing: massingOut() }, {
    dataset: ds({ 'land.area_sqm': 12500, 'building.gfa_sqm': 9600, 'building.height_m': 18 }),
    warn: noop.warn,
  });
  writeResult({ plan_created: '2026-01-01T00:00:00+09:00', model: { floors: 4, gfa_m2: 9600 }, files: [] });
  const got = await intake.run({ projectId: PID, plan: out.plan }, { warn: noop.warn });
  assert.ok(got.flags.some(f => f.type === 'STALE_RESULT'));
});
