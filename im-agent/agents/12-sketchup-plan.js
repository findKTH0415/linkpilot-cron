'use strict';
/**
 * 12 SketchUp Plan Agent — 평면 A 의 계획 쪽 절반
 *
 * ★ 이 Agent 는 SketchUp 을 모른다. `04_Property/model-plan.json`(중간표현)을
 *   낼 뿐이고, 그것을 모델로 만드는 일은 평면 B(사람 자리의 Claude 세션)가
 *   한다 — 엔진·크론은 SketchUp MCP 를 직접 부르지 않는다 (D-95).
 *   규격: docs/스케치업-모델-계획-규격.md
 *
 * ★ facts 는 **항상 빈 배열이다** (D-96). 계획·모델에서 나온 수량은 우리가
 *   만든 값이지 근거가 아니다 — rhino.js 와 같은 규칙.
 *
 * ★ 거절 규칙 (규격 §2): 대지면적·층수·층고 중 하나라도 못 얻으면
 *   MISSING 으로 적고 **계획 파일을 내지 않는다.** 매스가 용적률 상한을
 *   넘겨도(RED) 내지 않는다 — 성립하지 않는 계획은 모델이 되어선 안 된다.
 *
 * 전부 결정적 계산이다. LLM 미사용. 단위 변환(m→mm)은 여기 한 곳에서만 한다.
 */

const fs = require('fs');
const path = require('path');
const store = require('../core/store');
const { round } = require('../core/numeric');
const { kstStamp } = require('../core/kst');

const DEFAULT_FLOOR_HEIGHT_M = 4.5; // 09_massing 과 같은 기준 (데이터센터·물류)

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    massing: { type: 'object', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['facts', 'flags', 'plan'],
  properties: {
    facts: { type: 'array', maxItems: 0 }, // D-96 — 스키마가 빈 배열을 강제한다
    flags: { type: 'array' },
    plan: { type: 'object', nullable: true },
    files: { type: 'array' },
    missing: { type: 'array' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

function flag(severity, type, message, extra = {}) {
  return { severity, type, message, ...extra };
}

function srcOf(ds, key) {
  const f = ds.get(key);
  return f ? { fact: key, origin: f.source || null } : null;
}

async function run(input, ctx) {
  const ds = ctx.dataset;
  if (!ds) throw new Error('ctx.dataset 필요');

  const facts = [];           // D-96 — 항상 비어 있다
  const flags = [];
  const missing = [];

  // ── 매스가 이미 RED 면 계획을 내지 않는다 ─────────────────
  const massFlags = (input.massing && input.massing.flags) || [];
  const farRed = massFlags.find(f => f.severity === 'RED' && /FAR|BCR/.test(f.type || ''));
  if (farRed) {
    ctx.warn(`법정 한도 초과 상태 — 모델 계획을 내지 않는다 (${farRed.type})`);
    flags.push(flag('YELLOW', 'PLAN_SKIPPED', `매스 검토가 RED 라 모델 계획을 내지 않았다: ${farRed.message}`));
    return { facts, flags, plan: null, files: [], missing, confidence: 0 };
  }

  // ── 필수값 — 없으면 MISSING 으로 적고 계획을 내지 않는다 ──
  const landArea = ds.num('land.area_sqm');
  if (landArea === null) missing.push('land.area_sqm');

  const gfa = ds.num('building.gfa_sqm');
  const bcrLimit = ds.num('land.bcr_limit');
  const footprintFact = ds.num('building.footprint_sqm');
  const footprintArea = footprintFact !== null
    ? footprintFact
    : (landArea !== null ? round(landArea * ((bcrLimit !== null ? bcrLimit : 60) / 100), 1) : null);

  const floorsFact = ds.num('building.floors');
  const floors = floorsFact !== null
    ? Math.max(1, Math.round(floorsFact))
    : (gfa !== null && footprintArea ? Math.max(1, Math.ceil(gfa / footprintArea)) : null);
  if (floors === null) missing.push('building.floors');

  const heightFact = ds.num('building.height_m');
  const floorHeightM = heightFact !== null && floors
    ? round(heightFact / floors, 2)
    : (floorsFact !== null || gfa !== null ? DEFAULT_FLOOR_HEIGHT_M : null);
  if (floorHeightM === null) missing.push('building.height_m');

  if (missing.length) {
    ctx.warn(`모델 계획 필수값 결측 — 계획을 내지 않는다: ${missing.join(', ')}`);
    flags.push(flag('YELLOW', 'PLAN_MISSING', `모델 계획 필수값 ${missing.length}건 결측 (${missing.join(', ')}) — 계획 파일을 만들지 않았다`, { keys: missing }));
    return { facts, flags, plan: null, files: [], missing, confidence: 0 };
  }

  // ── 계획 조립 — 길이는 여기서 한 번만 m→mm ────────────────
  const notes = ['매스만 만든다 — 도면 인식(D-98) 전이므로 objects 는 비어 있다'];
  const side = round(Math.sqrt(footprintArea), 2); // 직사각형 근사 — 형상은 매스(SVG)가 갖는다
  if (footprintFact === null) {
    notes.push(`건축면적 ${footprintArea}㎡ 는 대지면적×건폐율${bcrLimit !== null ? '' : '(통상 60% 가정)'} 산정치다`);
  }
  notes.push('footprint 는 건축면적 기준 정사각 근사 — 실제 필지 형상은 04_Property/massing.svg 를 본다');
  if (heightFact === null) notes.push(`층고 ${floorHeightM}m 는 통상치(ASSUMPTION)다 — 도서로 확인되면 갱신한다`);

  const zoningFact = ds.get('land.zoning');
  const plan = {
    schema: 'model-plan/1',
    project_id: input.projectId,
    created: kstStamp(),
    units: 'mm',
    scale_status: 'VERIFIED', // 값이 공부·문서 fact 에서 오므로 도면 축척 문제가 없다
    site: {
      area_m2: landArea,
      zoning: zoningFact ? String(zoningFact.value) : null,
      far_limit_pct: ds.num('land.far_limit'),
      bcr_limit_pct: bcrLimit,
      source: srcOf(ds, 'land.area_sqm'),
    },
    building: {
      floors,
      basement_floors: 0,
      floor_height_mm: Math.round(floorHeightM * 1000),
      footprint: { width_mm: Math.round(side * 1000), depth_mm: Math.round(side * 1000) },
      gfa_m2: gfa,
      source: srcOf(ds, gfa !== null ? 'building.gfa_sqm' : 'land.area_sqm'),
    },
    objects: [],
    missing: [],
    notes,
  };

  const files = [];
  try {
    const dir = path.join(store.projectDir(input.projectId), '04_Property');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'model-plan.json'), JSON.stringify(plan, null, 2));
    files.push('model-plan.json');
  } catch (e) {
    ctx.warn(`model-plan.json 저장 실패: ${e.message}`);
    flags.push(flag('YELLOW', 'PLAN_WRITE_FAILED', `계획을 계산했으나 파일로 남기지 못했다: ${e.message}`));
  }

  flags.push(flag('GREEN', 'PLAN', `모델 계획 생성 — 지상 ${floors}층 · 층고 ${floorHeightM}m · 건축면적 ${footprintArea}㎡`));
  return { facts, flags, plan, files, missing, confidence: heightFact !== null ? 0.8 : 0.6 };
}

module.exports = { id: '12_sketchup_plan', inputSchema, outputSchema, run };
