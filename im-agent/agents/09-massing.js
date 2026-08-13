'use strict';
/**
 * 09 Massing Agent — 건축 3D 매스 모델 + 법정 한도 검토
 *
 * ★ 이 Agent의 목적은 예쁜 3D가 아니라 **계획안이 법적으로 성립하는지 확인**하는 것이다.
 *   사업계획서의 연면적이 용적률 상한을 넘으면 그 사업계획은 성립하지 않는다.
 *   이것은 IM 배포 전에 반드시 잡아야 할 RED FLAG다.
 *
 * 산출물 (04_Property/):
 *   massing.obj    범용 3D (스케치업·라이노·블렌더)
 *   massing.gltf   웹/파워포인트 3D 삽입용 (버퍼 내장 단일 파일)
 *   massing.svg    IM 삽입용 아이소메트릭 프리뷰
 *
 * 전부 결정적 기하 계산이다. LLM 미사용.
 */

const fs = require('fs');
const path = require('path');
const geometry = require('../geo/geometry');
const mass = require('../geo/mass');
const nsdi = require('../connectors/nsdi');
const store = require('../core/store');
const { round, fmt } = require('../core/numeric');
const { kstDate } = require('../core/kst');

const DEFAULT_FLOOR_HEIGHT = 4.5; // 데이터센터·물류 기준. 주거/오피스는 3.0~3.3

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    geo: { type: 'object', nullable: true },
    floorHeight: { type: 'number' },
  },
};

const outputSchema = {
  type: 'object',
  required: ['facts', 'flags', 'model'],
  properties: {
    facts: { type: 'array' },
    flags: { type: 'array' },
    model: { type: 'object', nullable: true },
    files: { type: 'array' },
    inputs: { type: 'object' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

function flag(severity, type, message, extra = {}) {
  return { severity, type, message, ...extra };
}

async function run(input, ctx) {
  const ds = ctx.dataset;
  if (!ds) throw new Error('ctx.dataset 필요');

  const today = kstDate();
  const facts = [];
  const flags = [];
  const files = [];

  const landArea = ds.num('land.area_sqm');
  const gfa = ds.num('building.gfa_sqm');
  const floorsFact = ds.num('building.floors');
  const footprintFact = ds.num('building.footprint_sqm');
  const heightFact = ds.num('building.height_m');

  if (!landArea) {
    ctx.warn('대지면적 미확인 — 매스 모델 생성 불가');
    return { facts, flags, model: null, files, inputs: {}, confidence: 0 };
  }

  // ── 법정 한도 ────────────────────────────────────────────
  let farLimit = ds.num('land.far_limit');
  let bcrLimit = ds.num('land.bcr_limit');
  let limitSource = farLimit !== null ? ds.get('land.far_limit').source : null;

  if (farLimit === null) {
    // 문서에서 뽑은 용도지역 문자열만으로도 상한을 알 수 있다 (API 불필요)
    const zoning = ds.get('land.zoning');
    const limits = zoning ? nsdi.limitsForZone(String(zoning.value)) : null;
    if (limits) {
      farLimit = limits.far;
      bcrLimit = limits.bcr;
      limitSource = `국토계획법 시행령(용도지역: ${limits.zone})`;
      facts.push({ key: 'land.far_limit', value: farLimit, unit: '%', confidence: 0.7, source: limitSource, sourceDate: today, note: '지자체 조례 확인 필요' });
      facts.push({ key: 'land.bcr_limit', value: bcrLimit, unit: '%', confidence: 0.7, source: limitSource, sourceDate: today, note: '지자체 조례 확인 필요' });
    }
  }

  // ── 계획 지표 산정 ───────────────────────────────────────
  const bcrForMass = bcrLimit !== null ? bcrLimit : 60;
  const footprintArea = footprintFact !== null
    ? footprintFact
    : round(landArea * (bcrForMass / 100), 1);

  const floors = floorsFact !== null
    ? Math.max(1, Math.round(floorsFact))
    : (gfa && footprintArea ? Math.max(1, Math.ceil(gfa / footprintArea)) : 1);

  const floorHeight = input.floorHeight
    || (heightFact && floors ? round(heightFact / floors, 2) : DEFAULT_FLOOR_HEIGHT);

  const farPlanned = gfa ? round((gfa / landArea) * 100, 1) : null;
  const bcrPlanned = footprintArea ? round((footprintArea / landArea) * 100, 1) : null;
  const gfaAllowed = farLimit !== null ? round(landArea * (farLimit / 100), 1) : null;

  // ── 법정 한도 검토 (이 Agent의 핵심) ──────────────────────
  if (farPlanned !== null && farLimit !== null) {
    if (farPlanned > farLimit * 1.001) {
      flags.push(flag('RED', 'FAR_EXCEEDED',
        `계획 용적률 ${farPlanned}% 가 법정 상한 ${farLimit}% 를 초과한다 (계획 연면적 ${fmt(gfa, 0)}㎡ vs 허용 ${fmt(gfaAllowed, 0)}㎡, 초과 ${fmt(round(gfa - gfaAllowed, 0), 0)}㎡) — 근거: ${limitSource}`,
        { keys: ['building.gfa_sqm', 'land.far_limit'] }));
    } else if (farPlanned > farLimit * 0.95) {
      flags.push(flag('YELLOW', 'FAR_TIGHT',
        `계획 용적률 ${farPlanned}% 가 법정 상한 ${farLimit}% 에 근접한다 — 설계 변경 여지가 거의 없다`,
        { keys: ['building.gfa_sqm', 'land.far_limit'] }));
    } else {
      flags.push(flag('GREEN', 'FAR', `계획 용적률 ${farPlanned}% ≤ 법정 상한 ${farLimit}%`));
    }
  } else if (farPlanned !== null) {
    flags.push(flag('YELLOW', 'FAR_UNKNOWN', '용도지역/용적률 상한 미확인 — 계획안의 법적 성립 여부를 검증하지 못했다', { keys: ['land.zoning'] }));
  }

  if (bcrPlanned !== null && bcrLimit !== null && footprintFact !== null && bcrPlanned > bcrLimit * 1.001) {
    flags.push(flag('RED', 'BCR_EXCEEDED',
      `계획 건폐율 ${bcrPlanned}% 가 법정 상한 ${bcrLimit}% 를 초과한다`,
      { keys: ['building.footprint_sqm', 'land.bcr_limit'] }));
  }

  // ── 3D 매스 생성 ─────────────────────────────────────────
  const polygon = input.geo && input.geo.parcel && Array.isArray(input.geo.parcel.polygon) && input.geo.parcel.polygon.length >= 3
    ? input.geo.parcel.polygon
    : null;

  let footprint;
  let footprintBasis;
  if (polygon) {
    const local = geometry.toLocalMeters(polygon).slice(0, -1);
    const parcelArea = geometry.planarArea(local);
    const shrink = parcelArea > 0 ? Math.min(1, footprintArea / parcelArea) : 1;
    footprint = geometry.scaleAboutCentroid(local, shrink);
    footprintBasis = `지적도 필지 형상을 건축면적 비율(${round(shrink * 100, 1)}%)로 축소 — 정확한 이격거리 오프셋이 아니다`;
  } else {
    footprint = geometry.squareFootprint(footprintArea);
    footprintBasis = '필지 형상 미확보 — 건축면적 기준 직사각형으로 대체';
    flags.push(flag('YELLOW', 'MASS_APPROX', '지적도 폴리곤이 없어 매스를 직사각형으로 근사했다 (VWORLD_KEY 설정 시 실제 필지 형상 사용)'));
  }

  if (!footprint) {
    ctx.warn('건축면적 산정 불가 — 매스 생성 생략');
    return { facts, flags, model: null, files, inputs: { landArea, gfa, floors }, confidence: 0.2 };
  }

  let model = null;
  try {
    const built = mass.buildMass(footprint, { floors, floorHeight, basementFloors: 0 });
    const dir = path.join(store.projectDir(input.projectId), '04_Property');
    fs.mkdirSync(dir, { recursive: true });

    const label = `${ds.get('project.name') ? ds.get('project.name').value : input.projectId} · 지상 ${floors}층 · 건축면적 ${fmt(footprintArea, 0)}㎡ · 연면적 ${gfa ? fmt(gfa, 0) : '미확인'}㎡`;

    const written = [
      ['massing.obj', mass.toObj(built)],
      ['massing.gltf', mass.toGltf(built)],
      ['massing.svg', mass.toSvg(built, { label })],
    ];
    for (const [name, content] of written) {
      fs.writeFileSync(path.join(dir, name), content, 'utf8');
      files.push(`04_Property/${name}`);
    }

    model = {
      floors, floorHeight,
      heightM: round(built.height, 2),
      footprintAreaSqm: round(geometry.planarArea(footprint), 1),
      footprintBasis,
      vertices: built.meta.vertices,
      triangles: built.meta.triangles,
      note: '용적률·건폐율 검토용 매스이며 설계안이 아니다',
    };
  } catch (e) {
    ctx.warn(`매스 모델 생성 실패: ${e.message}`);
  }

  // ── 계산값 등록 ──────────────────────────────────────────
  const src = { source: '매스 검토 Agent (09_massing)', sourceDate: today, page: null, confidence: 0.9, verified: true };
  if (gfaAllowed !== null) facts.push({ key: 'massing.gfa_allowed_sqm', value: gfaAllowed, unit: '㎡', ...src, note: `근거: ${limitSource}` });
  if (farPlanned !== null) facts.push({ key: 'massing.far_planned', value: farPlanned, unit: '%', ...src });
  if (bcrPlanned !== null) facts.push({ key: 'massing.bcr_planned', value: bcrPlanned, unit: '%', ...src });

  const confidence = polygon && farLimit !== null ? 0.9 : (farLimit !== null ? 0.7 : 0.45);
  return {
    facts, flags, model, files,
    inputs: {
      landAreaSqm: landArea, gfaSqm: gfa, floors, floorHeight,
      footprintAreaSqm: footprintArea, farLimit, bcrLimit, limitSource,
      farPlanned, bcrPlanned, gfaAllowedSqm: gfaAllowed,
    },
    confidence,
  };
}

module.exports = { id: '09_massing', label: 'Massing / 3D Agent', inputSchema, outputSchema, run, DEFAULT_FLOOR_HEIGHT };
