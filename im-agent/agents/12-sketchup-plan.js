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
 * ★ **계산 자리는 09_massing 하나다** 〈2026-08-24 사장님 확인〉. 층수·층고·
 *   건축면적을 여기서 다시 계산하지 않는다 — 같은 수를 두 곳에서 만들면
 *   두 공식이 갈라지는 날이 오고, 그날 계획과 매스가 서로 다른 건물을 말한다.
 *   이 Agent 는 09_massing 모델을 **계획 파일로 옮겨 적을 뿐이다.**
 *
 * ★ 거절 규칙 (규격 §2): 매스 모델이 없으면 계획도 없다. 매스가 용적률 상한을
 *   넘겨도(RED) 내지 않는다 — 성립하지 않는 계획은 모델이 되어선 안 된다.
 *
 * 결정적 변환이다. LLM 미사용. 단위 변환(m→mm)은 여기 한 곳에서만 한다.
 */

const fs = require('fs');
const path = require('path');
const store = require('../core/store');
const { round } = require('../core/numeric');
const { kstStamp } = require('../core/kst');

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

  // ── 원천은 09_massing 모델이다 — 없으면 계획도 없다 ───────
  const m = input.massing && input.massing.model;
  if (!m || typeof m.floors !== 'number' || typeof m.floorHeight !== 'number' || typeof m.footprintAreaSqm !== 'number') {
    missing.push('massing.model');
    ctx.warn('매스 모델 없음 — 계획을 내지 않는다 (계산 자리는 09_massing 하나다)');
    flags.push(flag('YELLOW', 'PLAN_MISSING', '09_massing 모델이 없어 계획 파일을 만들지 않았다 — 층수·층고·건축면적을 여기서 다시 계산하지 않는다', { keys: ['land.area_sqm'] }));
    return { facts, flags, plan: null, files: [], missing, confidence: 0 };
  }

  const floors = m.floors;
  const floorHeightM = m.floorHeight;
  const footprintArea = m.footprintAreaSqm;
  const landArea = ds.num('land.area_sqm');
  const gfa = ds.num('building.gfa_sqm');
  const bcrLimit = ds.num('land.bcr_limit');

  // ── 계획 조립 — 길이는 여기서 한 번만 m→mm ────────────────
  const notes = [
    '층수·층고·건축면적은 09_massing 모델에서 그대로 옮겼다 — 같은 수를 두 곳에서 계산하지 않는다',
    '매스만 만든다 — 도면 인식(D-98) 전이므로 objects 는 비어 있다',
  ];
  const side = round(Math.sqrt(footprintArea), 2); // 직사각형 근사 — 형상은 매스(SVG)가 갖는다
  if (m.footprintBasis) notes.push(`건축면적 근거: ${m.footprintBasis}`);
  notes.push('footprint 는 건축면적 기준 정사각 근사 — 실제 필지 형상은 04_Property/massing.svg 를 본다');
  if (ds.num('building.height_m') === null) notes.push(`층고 ${floorHeightM}m 는 통상치(ASSUMPTION)다 — 도서로 확인되면 갱신한다`);

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

  flags.push(flag('GREEN', 'PLAN', `모델 계획 생성 — 지상 ${floors}층 · 층고 ${floorHeightM}m · 건축면적 ${footprintArea}㎡ (원천: 09_massing)`));
  const conf = typeof input.massing.confidence === 'number' ? input.massing.confidence : 0.6;
  return { facts, flags, plan, files, missing, confidence: conf };
}

module.exports = { id: '12_sketchup_plan', inputSchema, outputSchema, run };
