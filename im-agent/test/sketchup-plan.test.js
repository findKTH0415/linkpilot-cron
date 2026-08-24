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

test('★★ m → mm 는 정수다 — 소수가 남으면 SketchUp 쪽에서 반올림이 두 번 일어난다', () => {
  assert.strictEqual(A.mm(4.5), 4500);
  assert.strictEqual(A.mm(36), 36000);
  assert.strictEqual(A.mm(0.0005), 1);
});

test('★★ 고리를 mm 로 옮기고 원점을 왼쪽 아래로 맞춘다', () => {
  const r = A.ringToMm([[10, 20], [30, 20], [30, 45]]);
  assert.deepStrictEqual(r, [[0, 0], [20000, 0], [20000, 25000]]);
});

test('★ 점이 셋보다 적으면 고리가 아니다 — null 을 돌려준다', () => {
  assert.strictEqual(A.ringToMm([[0, 0], [1, 1]]), null);
  assert.strictEqual(A.ringToMm(null), null);
});

/* ── ①②③④ 계획 자체 ──────────────────────────────────── */

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
  footprintM: [[0, 0], [80, 0], [80, 50], [0, 50]], parcelM: null,
};

test('★★★ fact 를 하나도 안 낸다 — 우리가 만든 값으로 우리 주장을 증명하면 안 된다 (D-33 · D-96)', async () => {
  const { out } = await plan([F('land.area_sqm', 5000, '㎡'), F('building.gfa_sqm', 24000, '㎡')], { model: MODEL });
  assert.deepStrictEqual(out.facts, [], '계획값을 Dataset 에 등록한다 — 생성물이 근거가 된다');
});

test('★★★ 없는 값을 짐작해 채우지 않는다 — 이름을 적는다 (§4.9)', async () => {
  const { out, logs } = await plan([], null);
  assert.ok(out.plan.missing.includes('land.area_sqm'), out.plan.missing.join(','));
  assert.ok(out.plan.missing.includes('building.gfa_sqm'));
  assert.ok(out.plan.missing.includes('09_massing.model'));
  assert.strictEqual(out.plan.objects.length, 0, '없는 값으로 물체를 만들었다');
  assert.ok(logs.some((m) => /매스 모델이 없어/.test(m)), '못 만든 사실을 말하지 않는다');
  /* ★ **그래도 파일은 낸다** — 「못 냈다」와 「없다」는 다른 사실이다 */
  assert.ok(out.plan, '계획을 못 만들면 파일도 안 낸다');
});

test('★★★ 근사한 것을 근사라고 적는다 — 안 적으면 실제 필지처럼 보인다', async () => {
  const { out } = await plan([F('land.area_sqm', 5000, '㎡')], { model: MODEL });
  assert.strictEqual(out.plan.site.polygonIsApproximate, true);
  assert.strictEqual(out.plan.site.polygonMm, null);

  const real = await plan([F('land.area_sqm', 5000, '㎡')],
    { model: { ...MODEL, parcelM: [[0, 0], [90, 0], [90, 60], [0, 60]] } });
  assert.strictEqual(real.out.plan.site.polygonIsApproximate, false);
  assert.ok(real.out.plan.site.polygonMm.length === 4);
  assert.ok(/VWorld/.test(real.out.plan.site.polygonSource));
});

test('★★★ 가정을 가정이라고 적는다 — 층고 기본값이 설계 조건으로 읽히면 안 된다', async () => {
  const { out } = await plan([F('land.area_sqm', 5000, '㎡')], { model: MODEL });
  assert.strictEqual(out.plan.assumptions.length, 1);
  assert.strictEqual(out.plan.assumptions[0].what, 'floorHeightMm');
  assert.ok(/자산군 기본값/.test(out.plan.assumptions[0].why));

  /* ★ 자료에 높이가 있으면 가정이 아니다 */
  const told = await plan([F('land.area_sqm', 5000, '㎡'), F('building.height_m', 54, 'm')], { model: MODEL });
  assert.deepStrictEqual(told.out.plan.assumptions, []);
});

test('★★ 물체마다 **어디서 나왔는지**가 붙는다 (규격 §3)', async () => {
  const { out } = await plan([F('land.area_sqm', 5000, '㎡'), F('building.gfa_sqm', 24000, '㎡')], { model: MODEL });
  const o = out.plan.objects[0];
  assert.ok(o.source && Array.isArray(o.source.keys) && o.source.keys.length);
  assert.strictEqual(o.source.from, '09_massing');
  assert.ok(o.source.basis, '어떻게 만든 바닥인지 안 적는다');
  assert.strictEqual(o.heightMm, 54000);
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
  assert.ok(a.order > 7 && a.order < 8, `09_massing 뒤 · 05_validation 앞이어야 한다: ${a.order}`);
  /* ② monitor 비중 — 없으면 기본 5 로 잡혀 진행률이 슬쩍 틀어진다 */
  assert.strictEqual(M.WEIGHTS['12_sketchup_plan'], 4);
  /* ③ monitor 선행 */
  assert.deepStrictEqual(M.DEPENDS['12_sketchup_plan'], ['09_massing']);
  /* ④ 화면 단계 — 빠지면 진행 화면이 이 Agent 를 영영 안 보여 준다 */
  assert.ok(/'09_massing', '12_sketchup_plan'\]/.test(rd('ui/platform/live-core.js')),
    'live-core 의 계산·검토 묶음에 없다 — 화면이 이 단계를 안 그린다');
  /* ⑤ pipeline — 등록만 하고 안 부르면 없는 것과 같다 (D-48) */
  assert.ok(/runAgent\('12_sketchup_plan'/.test(rd('pipeline.js')),
    'pipeline 이 안 부른다 — 만들어 두고 안 부르면 없는 것과 같다');
});
