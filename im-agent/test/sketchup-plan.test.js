/**
 * **평면 A — 「무엇을 어디에 만들어라」까지만 낸다.**
 *
 * ★★★ 2026-08-25 확정 · D-95 「평면 A 만 GitHub 에서 돌린다」.
 *
 *   엔진은 SketchUp 을 **안 부른다.** MCP 의 `build_model` 은 살아 있는
 *   SketchUp 앱에 파이썬을 밀어 넣는데, NAS(리눅스)에도 Actions 러너에도
 *   그런 것이 없다 — 설치할 수 있는 종류가 아니다.
 *
 * ★ 여기서 재는 것:
 *   ① **fact 를 안 내는가** — 우리가 만든 값은 근거가 아니다 (D-33 · D-96)
 *   ② **없는 값을 짐작해 채우지 않는가** — missing 에 이름을 적는다 (§4.9)
 *   ③ **근사한 것을 근사라고 적는가** — 안 적으면 실제 필지처럼 보인다
 *   ④ **가정을 가정이라고 적는가** — 층고 기본값이 설계 조건으로 읽히면 안 된다
 *   ⑤ **단위 변환이 한 곳에서만** 일어나는가 (규격 §1)
 *   ⑥ **엔진이 SketchUp 을 안 부르는가**
 *   ⑦ **함께 고쳐야 하는 다섯 곳이 다 맞는가** — 하나만 빠져도 화면이 거짓말한다
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const A = require('../agents/12-sketchup-plan.js');

/* ── ⑤ 단위 ─────────────────────────────────────────────── */

/* ★★ 〈2026-08-25 · D-101 합침〉 `mm()`·`ringToMm()` 을 재던 셋을 걷어냈다.
 *   합친 판은 계획 쪽 스키마(`model-plan/1`)를 쓰고, 그 단위 변환은
 *   `sketchup.test.js` 가 잰다. **여기서 또 재면 두 벌이 된다.** */

const { Dataset } = require('../core/facts.js');
const { FIELDS } = require('../core/dictionary.js');
const store = require('../core/store.js');
const os = require('node:os');

async function plan(facts, massing) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-plan-'));
  const before = process.env.IM_AGENT_ROOT;
  process.env.IM_AGENT_ROOT = dir;
  try {
    const pid = 'LP-RE-2026-950';
    store.createProjectDirs(pid);
    const ds = new Dataset(pid, FIELDS);
    ds.addMany(facts);
    ds.resolve();
    const logs = [];
    const out = await A.run({ projectId: pid, massing }, { dataset: ds, warn: (m) => logs.push(m), log: () => {} });
    return { out, logs, dir, pid };
  } finally {
    if (before === undefined) delete process.env.IM_AGENT_ROOT; else process.env.IM_AGENT_ROOT = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const F = (key, value, unit) => ({ key, value, unit, confidence: 0.9, source: '사업계획서.pdf' });
const MODEL = {
  floors: 12, floorHeight: 4.5, heightM: 54, footprintAreaSqm: 4000,
  footprintBasis: '필지 형상 미확보 — 건축면적 기준 직사각형으로 대체',
  /* ★ 합친 판은 09_massing 의 `footprintRing`·`parcelRing` 을 읽는다 (D-101).
   *   이름을 안 맞추면 표본이 거짓말을 하고, 잡히는 것도 거짓이 된다 (§8) */
  footprintRing: [[0, 0], [80, 0], [80, 50], [0, 50]], parcelRing: null,
};

test('★★★ fact 를 하나도 안 낸다 — 우리가 만든 값으로 우리 주장을 증명하면 안 된다 (D-33 · D-96)', async () => {
  const { out } = await plan([F('land.area_sqm', 5000, '㎡'), F('building.gfa_sqm', 24000, '㎡')], { model: MODEL });
  assert.deepStrictEqual(out.facts, [], '계획값을 Dataset 에 등록한다 — 생성물이 근거가 된다');
});

/* ★ 아래 넷은 2026-08-25(D-101)에 **합친 스키마(`model-plan/1`)** 기준으로
 *   다시 썼다. 재려는 뜻은 그대로다 — 없는 것을 짐작하지 않는가 · 근사를
 *   근사라고 적는가 · 가정을 가정이라고 적는가 · 물체에 출처가 붙는가. */

test('★★★ 없는 값을 짐작해 채우지 않는다 — 이름을 적는다 (§4.9)', async () => {
  const { out } = await plan([F('land.area_sqm', 5000, '㎡')], { model: null });
  assert.strictEqual(out.plan, null, '매스가 없는데 계획을 지어냈다');
  assert.ok(out.missing.includes('massing.model'), '무엇이 없는지 이름을 안 적는다');
  assert.ok(out.flags.some((f) => f.type === 'PLAN_MISSING'),
    '조용히 안 만들면 사람은 고장으로 읽는다');
});

test('★★★ 근사한 것을 근사라고 적는다 — 안 적으면 실제 필지처럼 보인다', async () => {
  const { out } = await plan([F('land.area_sqm', 5000, '㎡')], { model: MODEL });
  assert.strictEqual(out.plan.site.parcel_polygon_mm, null);
  assert.ok(out.plan.notes.some((n) => /지적선 미확보/.test(n)),
    '근사라는 사실을 계획서에 안 적는다');

  const real = await plan([F('land.area_sqm', 5000, '㎡')], { model: PARCEL });
  assert.strictEqual(real.out.plan.site.parcel_polygon_mm.length, 4);
  assert.ok(!real.out.plan.notes.some((n) => /지적선 미확보/.test(n)),
    '실제 필지인데 근사라고 적는다 — 헛울음이다');
});

test('★★★ 가정을 가정이라고 적는다 — 층고 기본값이 설계 조건으로 읽히면 안 된다', async () => {
  const { out } = await plan([F('land.area_sqm', 5000, '㎡')], { model: MODEL });
  assert.ok(out.plan.notes.some((n) => /ASSUMPTION/.test(n) && /층고/.test(n)),
    '층고가 통상치라는 사실을 안 적는다');

  /* ★ 자료에 높이가 있으면 가정이 아니다 */
  const told = await plan([F('land.area_sqm', 5000, '㎡'), F('building.height_m', 54, 'm')], { model: MODEL });
  assert.ok(!told.out.plan.notes.some((n) => /ASSUMPTION/.test(n) && /층고/.test(n)),
    '자료로 확인된 값을 가정이라고 적는다');
});

test('★★ 물체마다 **어디서 나왔는지**가 붙는다 (규격 §3)', async () => {
  /* 개념 배치(동)는 아파트일 때만 나온다 — 표본도 그래야 재려는 것이 재진다 */
  const { out } = await plan([
    F('land.area_sqm', 5000, '㎡'), F('building.gfa_sqm', 24000, '㎡'),
    F('project.assetType', '아파트'),
  ], { model: PARCEL });
  assert.ok(out.plan.objects.length, '아파트인데 개념 배치를 하나도 안 그렸다');
  const o = out.plan.objects[0];
  assert.ok(o.source && o.source.fact, '어느 값에서 나왔는지 안 적는다');
  assert.ok(/ASSUMPTION|설계안 아님/.test(o.source.origin || ''),
    '통상치로 그린 개념 배치라는 사실이 물체에 안 붙는다 — 설계안으로 읽힌다');
});

/* ── ⑥⑦ 엔진이 SketchUp 을 안 부르는가 · 다섯 곳이 맞는가 ── */

test('★★★ 엔진 어디에서도 SketchUp MCP 를 부르지 않는다', () => {
  const root = path.join(__dirname, '..');
  const hits = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (!/node_modules|test/.test(f)) walk(p); continue; }
      if (!/\.(js|cjs)$/.test(f)) continue;
      const t = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/build_model|mcp__Trimble/.test(t)) hits.push(path.relative(root, p));
    }
  }(root));
  assert.deepStrictEqual(hits, [],
    `엔진이 SketchUp MCP 를 부른다: ${hits.join(', ')} — NAS·러너에는 SketchUp 이 없어 반드시 깨진다`);
});

test('★★★ 함께 고쳐야 하는 다섯 곳이 다 맞는다 — 하나만 빠져도 화면이 거짓말한다', () => {
  const R = require('../core/registry.js');
  const M = require('../core/monitor.js');
  const root = path.join(__dirname, '..');
  const rd = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

  /* ① registry */
  const a = R.get('12_sketchup_plan');
  assert.ok(a, 'registry 에 없다 — 아예 안 돈다');
  const v = R.get('05_validation');
  const mass = R.get('09_massing');
  assert.ok(mass.order < a.order && a.order < v.order,
    `09_massing 뒤 · 05_validation 앞이어야 한다: ${a.order}`);
  /* ② monitor 비중 — 없으면 기본 5 로 잡혀 진행률이 슬쩍 틀어진다 */
  assert.strictEqual(M.WEIGHTS['12_sketchup_plan'], 2);
  /* ③ monitor 선행 */
  assert.deepStrictEqual(M.DEPENDS['12_sketchup_plan'], ['09_massing']);
  /* ④ 화면 단계 — 빠지면 진행 화면이 이 Agent 를 영영 안 보여 준다 */
  assert.ok(/'12_sketchup_plan', '13_sketchup_intake'\]/.test(rd('ui/platform/live-core.js')),
    'live-core 의 계산·검토 묶음에 없다 — 화면이 이 단계를 안 그린다');
  /* ⑤ pipeline — 등록만 하고 안 부르면 없는 것과 같다 (D-48) */
  assert.ok(/runAgent\('12_sketchup_plan'/.test(rd('pipeline.js')),
    'pipeline 이 안 부른다 — 만들어 두고 안 부르면 없는 것과 같다');
});

/* ── [지적도면] · [조감도] 를 SketchUp 쪽에 요청하는가 ────── */

/**
 * ★★★ 2026-08-25 사장님 지시: 「출력시 옵션이 [지적도면], [조감도] 반영할시
 *   SketchUp Engineering Agent 로부터 불러오도록 구성해줘」.
 *
 * ★ **엔진이 대신 그리지 않는다.** 엔진이 그리면 SketchUp 판과 두 벌이 되고,
 *   그때 **어느 것이 문서에 실렸는지 알 수 없게 된다.**
 * ★ **켰다고 나오는 것이 아니다.** 근거가 없으면 `blocked` 로 적고 **왜**를
 *   남긴다 — 켰는데 조용히 안 나오면 사람은 고장으로 읽는다.
 */

const PARCEL = { ...MODEL, parcelRing: [[0, 0], [90, 0], [90, 60], [0, 60]] };

test('★★★ 필지 형상이 있으면 둘 다 SketchUp 쪽에 요청한다', async () => {
  const { out } = await plan([F('land.area_sqm', 5000, '㎡')], { model: PARCEL });
  const d = out.plan.deliverables;
  assert.strictEqual(d.length, 2, JSON.stringify(d));
  const byId = Object.fromEntries(d.map((x) => [x.id, x]));
  assert.strictEqual(byId.cadastral.status, 'requested');
  assert.strictEqual(byId.birdseye.status, 'requested');
  /* ★ Scene 이름으로 부른다 (마스터 프롬프트 §23·§24) */
  assert.strictEqual(byId.cadastral.sceneId, 'SC-CAD-01');
  assert.strictEqual(byId.birdseye.sceneId, 'SC-AERIAL-01');
});

test('★★★ 필지 형상이 없으면 **막혔다고 적고 까닭을 남긴다** — 조용히 안 만들지 않는다', async () => {
  const { out } = await plan([F('land.area_sqm', 5000, '㎡')], { model: MODEL });
  const d = out.plan.deliverables;
  assert.ok(d.every((x) => x.status === 'blocked'), JSON.stringify(d));
  assert.ok(d.every((x) => x.why && x.why.length > 20), '까닭을 안 적는다');
  /* ★ 화면에도 뜬다 — 문서에만 남으면 사람이 안 본다 */
  const f = out.flags.find((x) => x.type === 'VISUAL_BLOCKED');
  assert.ok(f, '못 만드는 것을 깃발로 안 세운다');
  assert.strictEqual(f.severity, 'YELLOW');
  assert.ok(/지적도면/.test(f.message) && /조감도/.test(f.message), f.message);
});

test('★★ 끈 것은 요청하지 않는다 — 켠 것만 적는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-off-'));
  const before = process.env.IM_AGENT_ROOT;
  process.env.IM_AGENT_ROOT = dir;
  try {
    const outputspec = require('../core/outputspec.js');
    const pid = 'LP-RE-2026-961';
    store.createProjectDirs(pid);
    store.writeJson(pid, '01_Project/project.json', { id: pid, name: '시험' });
    outputspec.save(pid, { visuals: { cadastral: false, birdseye: true, massing: true } });

    const ds = new Dataset(pid, FIELDS);
    ds.addMany([F('land.area_sqm', 5000, '㎡')]);
    ds.resolve();
    const out = await A.run({ projectId: pid, massing: { model: PARCEL } },
      { dataset: ds, warn: () => {}, log: () => {} });
    const ids = out.plan.deliverables.map((x) => x.id);
    assert.deepStrictEqual(ids, ['birdseye'], `끈 것을 요청한다: ${ids.join(',')}`);
  } finally {
    if (before === undefined) delete process.env.IM_AGENT_ROOT; else process.env.IM_AGENT_ROOT = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★★★ 엔진이 지적도면·조감도를 **대신 그리지 않는다** — 요청만 한다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '12-sketchup-plan.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/toSvg|birdseye\.svg|drawCadastral/.test(src),
    '계획 Agent 가 그림을 그린다 — SketchUp 판과 두 벌이 되어 어느 것이 실렸는지 모르게 된다');
  assert.ok(/status: w\.ready \? 'requested' : 'blocked'/.test(src), '요청 상태를 안 가른다');
});

test('★★ 출력 사양에 지적도면 칸이 있다 — 조감도와 **다른 것**이라 따로 둔다', () => {
  const spec = require('../core/outputspec.js');
  assert.strictEqual(spec.VISUAL_DEFAULT.cadastral, true);
  assert.strictEqual(spec.VISUAL_DEFAULT.birdseye, true);
  /* ★ 화면에도 칸이 있어야 한다 — 사양에만 있으면 아무도 못 끈다 */
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'ui', 'platform', 'reports.html'), 'utf8');
  assert.ok(html.indexOf('지적도면 만들기') !== -1, '화면에 지적도면 칸이 없다');
  assert.ok(/visuals: \{ cadastral: state\.cadastral, birdseye: state\.birdseye \}/.test(html),
    '화면이 지적도면 선택을 서버로 안 보낸다');
});
