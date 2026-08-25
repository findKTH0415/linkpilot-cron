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
 * ★★★ **두 갈래가 같은 이름으로 각자 만든 것을 합친 판이다** 〈2026-08-25 · D-101〉.
 *   한쪽은 「무엇을 만들 수 있는가」(계획)를, 다른 쪽은 「무엇을 만들어 달라고
 *   적는가」(요청 = `deliverables`)를 만들고 있었다. **같은 파일을 쓰고 있었으므로**
 *   하나를 고르면 나머지가 오류 없이 사라진다 — 그래서 한 파일의 두 절로 합쳤다.
 *   계획 쪽 스키마(`model-plan/1`)가 규격 문서와 13_sketchup_intake 의 계약이라
 *   그쪽을 그대로 두고, 요청 절을 얹었다.
 *
 * ★ **요청은 거절 규칙보다 먼저 정한다.** 매스가 없거나 RED 라 계획을 안 낼 때도
 *   「켜 두신 시각자료를 못 만든다」는 말해야 한다 — 켰는데 조용히 빠지면
 *   사람은 고장으로 읽고, 없는 고장을 찾으러 간다.
 *
 * 결정적 변환이다. LLM 미사용. 단위 변환(m→mm)은 여기 한 곳에서만 한다.
 */

const fs = require('fs');
const path = require('path');
const store = require('../core/store');
const { round } = require('../core/numeric');
const { kstStamp } = require('../core/kst');
const outputspec = require('../core/outputspec');

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
    /** 켠 시각자료를 SketchUp 쪽에 요청한 목록 — 계획을 못 내도 이것은 남는다 */
    deliverables: { type: 'array' },
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

/**
 * ★★★ **출력 옵션이 켜지면 SketchUp 쪽에 만들어 달라고 적는다**
 *   〈2026-08-25 사장님 지시: 「출력시 옵션이 [지적도면]·[조감도] 반영할시
 *   SketchUp Engineering Agent 로부터 불러오도록」〉.
 *
 * ★ **엔진이 대신 그리지 않는다.** 엔진이 그리면 SketchUp 판과 두 벌이 되고,
 *   그때 **어느 것이 문서에 실렸는지 알 수 없게 된다.** 하나만 만든다.
 * ★★ **켰다고 나오는 것이 아니다.** 근거(필지 형상)가 없으면 `blocked` 로 적고
 *   **왜 못 만드는지**를 함께 남긴다.
 * ★ 마스터 프롬프트 §23·§24 의 Scene 규격을 따른다 — `sceneId` 로 부른다.
 */
function askVisuals(projectId, { hasParcel, hasMass }) {
  const spec = outputspec.read(projectId) || {};
  const visuals = spec.visuals || outputspec.VISUAL_DEFAULT;
  const WANTED = [
    {
      id: 'cadastral', label: '지적도면', sceneId: 'SC-CAD-01',
      on: visuals.cadastral !== false,
      needs: '지적 필지 형상',
      ready: hasParcel,
      why: '필지 경계·지번·면적을 그린다. 필지 형상이 없으면 **땅 모양을 지어내야 하므로** 만들지 않는다',
    },
    {
      id: 'birdseye', label: '조감도', sceneId: 'SC-AERIAL-01',
      on: visuals.birdseye !== false,
      needs: '지적 필지 형상 + 매스',
      ready: hasParcel && hasMass,
      why: '필지 위에 매스를 얹어 내려다본 그림. 근사한 대지로 그리면 **실제 필지처럼 보이는 그림**이 된다',
    },
  ];
  return WANTED.filter((w) => w.on).map((w) => ({
    id: w.id,
    label: w.label,
    sceneId: w.sceneId,
    status: w.ready ? 'requested' : 'blocked',
    needs: w.needs,
    why: w.ready ? null : `${w.needs}을 못 받았다 — ${w.why}`,
  }));
}

/** 켰는데 못 만드는 것이 있으면 그것부터 말한다 — 조용히 빠지면 고장으로 읽힌다 */
function blockedFlag(deliverables) {
  const blocked = deliverables.filter((d) => d.status === 'blocked');
  if (!blocked.length) return null;
  return flag('YELLOW', 'VISUAL_BLOCKED',
    `켜 두신 시각자료를 못 만든다: ${blocked.map((b) => `${b.label}(${b.why})`).join(' · ')}`,
    { keys: ['land.area_sqm'] });
}

async function run(input, ctx) {
  const ds = ctx.dataset;
  if (!ds) throw new Error('ctx.dataset 필요');

  const facts = [];           // D-96 — 항상 비어 있다
  const flags = [];
  const missing = [];

  const mm0 = input.massing && input.massing.model;

  /* ★★★ **요청을 거절 규칙보다 먼저 정한다** (D-101 합침).
   *   계획을 못 내는 날에도 「켜 두신 시각자료를 못 만든다」는 말해야 한다 —
   *   켰는데 조용히 빠지면 사람은 고장으로 읽고, 없는 고장을 찾으러 간다. */
  const deliverables = askVisuals(input.projectId, {
    hasParcel: !!(mm0 && mm0.parcelRing),
    hasMass: !!(mm0 && mm0.footprintRing),
  });
  const vb = blockedFlag(deliverables);
  if (vb) flags.push(vb);

  // ── 매스가 이미 RED 면 계획을 내지 않는다 ─────────────────
  const massFlags = (input.massing && input.massing.flags) || [];
  const farRed = massFlags.find(f => f.severity === 'RED' && /FAR|BCR/.test(f.type || ''));
  if (farRed) {
    ctx.warn(`법정 한도 초과 상태 — 모델 계획을 내지 않는다 (${farRed.type})`);
    flags.push(flag('YELLOW', 'PLAN_SKIPPED', `매스 검토가 RED 라 모델 계획을 내지 않았다: ${farRed.message}`));
    return { facts, flags, plan: null, deliverables, files: [], missing, confidence: 0 };
  }

  // ── 원천은 09_massing 모델이다 — 없으면 계획도 없다 ───────
  const m = mm0;
  if (!m || typeof m.floors !== 'number' || typeof m.floorHeight !== 'number' || typeof m.footprintAreaSqm !== 'number') {
    missing.push('massing.model');
    ctx.warn('매스 모델 없음 — 계획을 내지 않는다 (계산 자리는 09_massing 하나다)');
    flags.push(flag('YELLOW', 'PLAN_MISSING', '09_massing 모델이 없어 계획 파일을 만들지 않았다 — 층수·층고·건축면적을 여기서 다시 계산하지 않는다', { keys: ['land.area_sqm'] }));
    return { facts, flags, plan: null, deliverables, files: [], missing, confidence: 0 };
  }

  const floors = m.floors;
  const floorHeightM = m.floorHeight;
  const footprintArea = m.footprintAreaSqm;
  const landArea = ds.num('land.area_sqm');
  const gfa = ds.num('building.gfa_sqm');
  const bcrLimit = ds.num('land.bcr_limit');
  const mi = input.massing.inputs || {};

  // ── 계획 조립 — 길이는 여기서 한 번만 m→mm ────────────────
  const notes = [
    '층수·층고·건축면적은 09_massing 모델에서 그대로 옮겼다 — 같은 수를 두 곳에서 계산하지 않는다',
    '매스만 만든다 — 도면 인식(D-98) 전이므로 objects 는 비어 있다',
  ];
  const side = round(Math.sqrt(footprintArea), 2); // 직사각형 근사 — 형상은 매스(SVG)가 갖는다
  if (m.footprintBasis) notes.push(`건축면적 근거: ${m.footprintBasis}`);
  notes.push('footprint 는 건축면적 기준 정사각 근사 — 실제 필지 형상은 04_Property/massing.svg 를 본다');
  if (ds.num('building.height_m') === null) notes.push(`층고 ${floorHeightM}m 는 통상치(ASSUMPTION)다 — 도서로 확인되면 갱신한다`);

  // ── 지적도형 — 매스가 옮겨 준 링을 mm 로 (바닥은 이 형상 그대로 그린다) ──
  const ringMm = (ring) => ring.map(([x, y]) => [Math.round(x * 1000), Math.round(y * 1000)]);
  const parcelPoly = m.parcelRing ? ringMm(m.parcelRing) : null;
  const footprintPoly = m.footprintRing ? ringMm(m.footprintRing) : null;
  if (!parcelPoly) {
    notes.push('지적선 미확보 — 바닥은 부지 근사 형상이다 (VWORLD_KEY 설정 시 실제 필지 형상)');
  }

  // ── 법정 분석 — 09_massing 이 검토한 값을 동봉한다 (fact 아님, 표기용) ──
  const legal = {
    far_limit_pct: mi.farLimit !== undefined ? mi.farLimit : ds.num('land.far_limit'),
    bcr_limit_pct: mi.bcrLimit !== undefined ? mi.bcrLimit : bcrLimit,
    far_planned_pct: mi.farPlanned !== undefined ? mi.farPlanned : null,
    bcr_planned_pct: mi.bcrPlanned !== undefined ? mi.bcrPlanned : null,
    gfa_allowed_m2: mi.gfaAllowedSqm !== undefined ? mi.gfaAllowedSqm : null,
    basis: mi.limitSource || null,
    // RED 였으면 계획 자체를 안 냈으므로(위) 여기 오면 초과는 아니다
    verdict: mi.farLimit !== null && mi.farLimit !== undefined ? 'WITHIN_LIMITS' : 'LIMIT_UNVERIFIED',
  };

  // ── 자산군 개념 배치 — 아파트면 요즘 판상형 배치를 그린다 〈2026-08-25 사장님 지시〉
  // ★ 설계안이 아니다. 통상치(ASSUMPTION)로 그리는 개념 배치이고 fact 가 되지 않는다.
  //   가정 파라미터 확정은 D-100. 통상치: 판상형 깊이 13m · 인동계수 0.8 · 폭 사용률 0.8
  const objects = [];
  const assetFact = ds.get('project.assetType');
  const asset = assetFact ? String(assetFact.value) : '';
  const isApt = /아파트|주거|공동주택|apartment|residential/i.test(asset);
  if (isApt && footprintPoly && footprintPoly.length >= 3) {
    const xs = footprintPoly.map(p => p[0]);
    const ys = footprintPoly.map(p => p[1]);
    const bbW = Math.max(...xs) - Math.min(...xs);
    const bbH = Math.max(...ys) - Math.min(...ys);
    const barDepth = 13000;                               // 판상형 통상 깊이 13m (ASSUMPTION)
    const barLen = Math.round(bbW * 0.8);                 // 폭 사용률 0.8 (ASSUMPTION)
    const spacing = Math.round(floors * floorHeightM * 1000 * 0.8); // 인동계수 0.8 (ASSUMPTION — 조례 확인 필요)
    const byHeight = Math.max(1, Math.floor((bbH - barDepth) / (barDepth + spacing)) + 1);
    const byArea = Math.max(1, Math.floor((footprintArea * 1e6) / (barDepth * barLen)));
    const nBars = Math.max(1, Math.min(byHeight, byArea));
    const x0 = Math.min(...xs) + Math.round((bbW - barLen) / 2);
    for (let i = 0; i < nBars; i++) {
      objects.push({
        object_id: `BAR-${String(i + 1).padStart(3, '0')}`,
        type: 'building_bar',
        name: `판상형 ${String.fromCharCode(65 + i)}동 (개념 배치)`,
        floor: 0,
        x: x0, y: Math.min(...ys) + i * (barDepth + spacing), z: 0,
        width: barLen, depth: barDepth, height: Math.round(floors * floorHeightM * 1000),
        source: { fact: 'project.assetType', origin: '개념 배치 — 통상치(ASSUMPTION), 설계안 아님 (D-100)' },
      });
    }
    notes.push(`아파트 개념 배치 ${nBars}개 동 — 판상형 깊이 13m·인동계수 0.8·폭 사용률 0.8 은 전부 통상치(ASSUMPTION)다. 설계안이 아니다 (D-100)`);
    notes.push('objects 가 있으면 3D 는 단일 매스 대신 objects(동 배치)를 올린다. building 블록은 법정 총량 검토값이다');
  }

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
      parcel_polygon_mm: parcelPoly,
      source: srcOf(ds, 'land.area_sqm'),
    },
    building: {
      floors,
      basement_floors: 0,
      floor_height_mm: Math.round(floorHeightM * 1000),
      footprint: { width_mm: Math.round(side * 1000), depth_mm: Math.round(side * 1000) },
      footprint_polygon_mm: footprintPoly,
      gfa_m2: gfa,
      source: srcOf(ds, gfa !== null ? 'building.gfa_sqm' : 'land.area_sqm'),
    },
    legal,
    objects,
    /* ★★★ **SketchUp 쪽에 만들어 달라고 적는 목록.** 이것이 「불러오도록」의
     *   실체다 — 엔진은 요청만 하고, 만드는 것은 평면 B 다 (D-95) */
    deliverables,
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

  const req = deliverables.filter((d) => d.status === 'requested').map((d) => d.label);
  flags.push(flag('GREEN', 'PLAN', `모델 계획 생성 — 지상 ${floors}층 · 층고 ${floorHeightM}m · 건축면적 ${footprintArea}㎡ (원천: 09_massing)`
    + `${req.length ? ` · 요청 ${req.join('·')}` : ''}`));
  const conf = typeof input.massing.confidence === 'number' ? input.massing.confidence : 0.6;
  return { facts, flags, plan, deliverables, files, missing, confidence: conf };
}

module.exports = { id: '12_sketchup_plan', label: 'SketchUp Plan Agent',
  inputSchema, outputSchema, run, askVisuals };
