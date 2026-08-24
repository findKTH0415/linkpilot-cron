'use strict';
/**
 * 12 SketchUp Plan Agent — **「무엇을 어디에 만들어라」까지만 낸다.**
 *
 * 〈2026-08-25 확정 · D-95 「평면 A 만 GitHub 에서 돌린다」〉
 *
 * ★★★ **엔진은 SketchUp 을 부르지 않는다.** 부르면 반드시 깨진다 —
 *   MCP 의 `build_model` 은 **살아 있는 SketchUp 앱**에 파이썬을 밀어 넣는데,
 *   NAS(리눅스·8181)에도 GitHub Actions 러너에도 그런 것이 없다. 설치할 수
 *   있는 종류가 아니고 라이선스도 필요하다.
 *
 * ★ 그래서 평면을 둘로 가른다. 이 Agent 는 **평면 A** 다 —
 *   대지·용적률·층수로 **중간표현**(`04_Property/model-plan.json`)을 낸다.
 *   실제 3D 는 SketchUp 이 켜진 사람 자리(평면 B)에서 만든다.
 *   이건 D-38(Rhino 서버를 안 세우고 결과만 받는다)의 선례를 그대로 따른 것이다.
 *
 * ★★ **평면 B 는 아직 자리가 없다.** 그래도 계획은 만든다 — 나중에 자리가
 *   생기면 그날 바로 쓰이고, 그때 규격을 정하면 이미 만들어 둔 것과 안 맞는다.
 *
 * ★★★ **fact 를 등록하지 않는다** (D-33 · D-96 권고). 이 계획의 숫자는
 *   **우리가 만든 값**이지 근거가 아니다. `connectors/rhino.js` 가 같은 이유로
 *   fact 를 안 낸다 — 우리가 만든 것으로 우리 주장을 증명하면 안 된다.
 *
 * ★ **없는 값을 짐작해 채우지 않는다.** `missing` 에 이름을 적는다. 비어 있는
 *   것이 좋은 것이 아니라 **무엇이 없는지가 보이는 것**이 그 칸의 일이다 (§4.9).
 *
 * ★ **LLM 을 쓰지 않는다.** 09_massing 과 같이 결정적 계산뿐이다.
 *
 * 규격: `docs/스케치업-모델-계획-규격.md`
 */

const fs = require('fs');
const path = require('path');
const store = require('../core/store');
const outputspec = require('../core/outputspec');
const { kstStamp } = require('../core/kst');
const { round } = require('../core/numeric');

const PLAN_VERSION = 1;
const REL = '04_Property/model-plan.json';

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    geo: { type: 'object', nullable: true },
    massing: { type: 'object', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['facts', 'flags', 'plan'],
  properties: {
    facts: { type: 'array' },
    flags: { type: 'array' },
    plan: { type: 'object', nullable: true },
    files: { type: 'array' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

function flag(severity, type, message, extra = {}) {
  return { severity, type, message, ...extra };
}

/** m → mm 정수. **변환은 여기 한 곳에서만** 한다 (규격 §1) */
function mm(metres) {
  return Math.round(Number(metres) * 1000);
}

/** 고리(ring)를 mm 로. 원점은 왼쪽 아래 모서리로 옮긴다 */
function ringToMm(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return ring.map((p) => [mm(p[0] - x0), mm(p[1] - y0)]);
}

async function run(input, ctx) {
  const ds = ctx.dataset;
  if (!ds) throw new Error('ctx.dataset 필요');

  const flags = [];
  const missing = [];
  const assumptions = [];
  const objects = [];

  const need = (key) => {
    const f = ds.get(key);
    if (!f) { missing.push(key); return null; }
    return f;
  };

  const landArea = need('land.area_sqm');
  const gfa = need('building.gfa_sqm');
  const model = (input.massing && input.massing.model) || null;

  /* ★ 매스가 없으면 계획도 없다. **그래도 파일은 낸다** — 「계획을 못 냈다」와
   *   「계획이 없다」는 다른 사실이고, missing 이 그 이유를 말한다 (규격 §3) */
  if (!model) {
    missing.push('09_massing.model');
    ctx.warn('매스 모델이 없어 계획을 만들지 못했다 — 무엇이 없는지는 model-plan.json 의 missing 에 적었다');
  }

  const site = {
    areaSqm: landArea ? landArea.value : null,
    polygonMm: model && model.parcelM ? ringToMm(model.parcelM) : null,
    polygonSource: model && model.parcelM ? '지적공부(VWorld) 연속지적도' : null,
    /* ★ 근사한 것을 근사라고 적지 않으면 **실제 필지처럼 보이는 계획**이 된다 */
    polygonIsApproximate: !(model && model.parcelM),
  };

  const building = model ? {
    floors: model.floors,
    floorHeightMm: mm(model.floorHeight),
    heightMm: mm(model.heightM),
    footprintAreaSqm: model.footprintAreaSqm,
    gfaSqm: gfa ? gfa.value : null,
  } : {
    floors: null, floorHeightMm: null, heightMm: null,
    footprintAreaSqm: null, gfaSqm: gfa ? gfa.value : null,
  };

  /* ★ 층고가 자료에서 안 나왔으면 **가정이라고 적는다.** 09_massing 이
   *   자산군 기본값을 쓰는데, 그 사실이 계획서에 안 적히면 설계 조건으로 읽힌다 */
  if (model && !ds.get('building.height_m')) {
    assumptions.push({
      what: 'floorHeightMm',
      value: mm(model.floorHeight),
      why: '층고가 자료에 없어 자산군 기본값을 썼다 (09_massing)',
    });
  }

  /**
   * ★★★ **출력 옵션이 켜지면 SketchUp 쪽에 만들어 달라고 적는다**
   *   〈2026-08-25 사장님 지시: 「출력시 옵션이 [지적도면], [조감도] 반영할시
   *   SketchUp Engineering Agent 로부터 불러오도록」〉.
   *
   * ★ **엔진이 대신 그리지 않는다.** 엔진이 그리면 SketchUp 판과 두 벌이 되고,
   *   그때 **어느 것이 문서에 실렸는지 알 수 없게 된다.** 하나만 만든다.
   *
   * ★★ **켰다고 나오는 것이 아니다.** 근거(필지 형상)가 없으면 `blocked` 로
   *   적고 **왜 못 만드는지**를 함께 남긴다 — 켰는데 조용히 안 나오면
   *   사람은 고장으로 읽는다. 그리고 그 사유가 문서에도 남아야 한다.
   *
   * ★ 마스터 프롬프트 §23·§24 의 Scene 규격을 따른다 — `sceneId` 로 부른다.
   */
  /* ★ 매스가 실제로 설 수 있는지 — deliverables 판정에 쓴다 */
  const objectsReady = !!(model && model.footprintM);

  const spec = outputspec.read(input.projectId) || {};
  const visuals = spec.visuals || outputspec.VISUAL_DEFAULT;
  const hasParcel = !!(model && model.parcelM);

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
      ready: hasParcel && !!objectsReady,
      why: '필지 위에 매스를 얹어 내려다본 그림. 근사한 대지로 그리면 **실제 필지처럼 보이는 그림**이 된다',
    },
  ];

  const deliverables = WANTED.filter((w) => w.on).map((w) => ({
    id: w.id,
    label: w.label,
    sceneId: w.sceneId,
    status: w.ready ? 'requested' : 'blocked',
    needs: w.needs,
    why: w.ready ? null : `${w.needs}을 못 받았다 — ${w.why}`,
  }));

  const footprintMm = model && model.footprintM ? ringToMm(model.footprintM) : null;
  if (model && footprintMm) {
    objects.push({
      objectId: 'MASS-01',
      type: 'mass',
      name: '본동 매스',
      originMm: [0, 0, 0],
      footprintMm,
      heightMm: mm(model.heightM),
      /* ★ **어느 값에서 나왔는지가 없으면 물체를 만들지 않는다** (규격 §3) */
      source: { keys: ['land.area_sqm', 'building.gfa_sqm'], from: '09_massing', basis: model.footprintBasis },
    });
  }

  const plan = {
    version: PLAN_VERSION,
    projectId: input.projectId,
    generatedAt: kstStamp(),
    unit: 'mm',
    purpose: 'massing',
    site,
    building,
    objects,
    /* ★★★ **SketchUp 쪽에 만들어 달라고 적는 목록.** 이것이 「불러오도록」의
     *   실체다 — 엔진은 요청만 하고, 만드는 것은 평면 B 다 (D-95) */
    deliverables,
    missing,
    assumptions,
    notes: '용적률·건폐율 검토용 매스이며 설계안이 아니다. '
      + '실제 3D 는 SketchUp 이 켜진 자리에서 만든다 (D-95 · 평면 B)',
  };

  const dir = path.join(store.projectDir(input.projectId), '04_Property');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'model-plan.json'), JSON.stringify(plan, null, 2), 'utf8');

  /* ★ 켰는데 못 만드는 것이 있으면 **그것부터 말한다.** 조용히 빠지면
   *   사람은 고장으로 읽고, 없는 고장을 찾으러 간다 */
  const blocked = deliverables.filter((d) => d.status === 'blocked');
  if (blocked.length) {
    flags.push(flag('YELLOW', 'VISUAL_BLOCKED',
      `켜 두신 시각자료를 못 만든다: ${blocked.map((b) => `${b.label}(${b.why})`).join(' · ')}`,
      { keys: ['land.area_sqm'] }));
  }

  if (objects.length) {
    flags.push(flag('GREEN', 'MODEL_PLAN',
      `3D 계획: 매스 ${objects.length}개 · 지상 ${building.floors}층 · 높이 ${round(building.heightMm / 1000, 1)}m`
      + `${site.polygonIsApproximate ? ' (필지 형상 미확보 — 근사)' : ' (실제 필지 형상)'}`
      + `${missing.length ? ` · 못 채운 값 ${missing.length}개` : ''}`));
  } else {
    flags.push(flag('YELLOW', 'MODEL_PLAN',
      `3D 계획을 만들지 못했다 — 없는 값: ${missing.join(', ') || '알 수 없음'}`));
  }

  const req = deliverables.filter((d) => d.status === 'requested').map((d) => d.label);
  ctx.log && ctx.log(`  3D 계획: 물체 ${objects.length}개 · 요청 ${req.length}건${req.length ? ` (${req.join('·')})` : ''}`
    + `${blocked.length ? ` · 못 만드는 것 ${blocked.length}건` : ''} · 못 채운 값 ${missing.length}개 → ${REL}`);

  return {
    /* ★★★ **fact 를 안 낸다** (D-33 · D-96). 우리가 만든 값이지 근거가 아니다 */
    facts: [],
    flags,
    plan,
    files: [REL],
    confidence: objects.length ? 0.8 : 0.3,
  };
}

module.exports = { id: '12_sketchup_plan', label: 'SketchUp Plan Agent', inputSchema, outputSchema, run, mm, ringToMm, PLAN_VERSION, REL };
