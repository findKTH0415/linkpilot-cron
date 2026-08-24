'use strict';
/**
 * birdseye.test.js — 조감도.
 *
 * 이 그림의 위험은 **그럴듯함**이다. 대지 모양을 사각형으로 근사해서 그려도
 * 그림은 멀쩡해 보이고, 보는 사람은 그것을 실제 필지로 읽는다. 축척이 없으면
 * 같은 그림이 20m 건물로도 200m 건물로도 읽힌다. 그래서 「안 그리는 조건」과
 * 「반드시 들어가야 할 것」을 테스트로 고정한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const birdseye = require('../geo/birdseye');
const geometry = require('../geo/geometry');
const mass = require('../geo/mass');
const outputspec = require('../core/outputspec');

/** 실제 지적 필지처럼 직각이 아닌 오각형 */
const PARCEL = [[0, 0], [40, 0], [52, 26], [18, 38], [-6, 20]];

function builtMass() {
  return mass.buildMass(geometry.scaleAboutCentroid(PARCEL, 0.6),
    { floors: 8, floorHeight: 4.2, basementFloors: 0 });
}

test('★ 지적선 위에 매스를 얹어 그린다', () => {
  const r = birdseye.render({ parcel: PARCEL, mass: builtMass(), label: '표본' });
  assert.strictEqual(r.ok, true);
  assert.match(r.svg, /^<svg /);
  assert.match(r.svg, /<\/svg>\s*$/);
  assert.strictEqual(r.meta.parcelPoints, 5, '필지 꼭짓점을 줄이면 다른 땅이 된다');
  assert.strictEqual(r.meta.hasMass, true);
});

/**
 * ★ **필지 형상이 없으면 그리지 않는다.** 매스 검토는 사각형으로 근사해도
 *   뜻이 있지만(면적·층수 검증), 조감도는 부지 형상 자체가 정보다.
 */
test('★ 지적 필지가 없으면 그리지 않고 사유를 남긴다', () => {
  [[], [[0, 0]], [[0, 0], [1, 1]], null].forEach((p) => {
    const r = birdseye.render({ parcel: p, mass: builtMass() });
    assert.strictEqual(r.ok, false, `${JSON.stringify(p)}: 그리면 안 된다`);
    assert.strictEqual(r.svg, null, '반쯤 그린 그림을 돌려주면 안 된다');
    assert.match(r.reason, /그럴듯하게 틀린다|실제 필지처럼/,
      '왜 안 그리는지 적어야 한다 — 안 적으면 고장으로 읽힌다');
    assert.match(r.reason, /VWORLD_KEY/, '무엇을 하면 그려지는지도 적어야 한다');
  });
});

/** ★ 축척이 없으면 같은 그림이 20m 건물로도 200m 건물로도 읽힌다 */
test('★ 축척 막대와 방위를 반드시 넣는다', () => {
  const r = birdseye.render({ parcel: PARCEL, mass: builtMass() });
  assert.ok(r.meta.scaleBarMeters > 0, '축척 눈금이 없다');
  assert.match(r.svg, new RegExp(`>${r.meta.scaleBarMeters}m<`), '축척 숫자가 그림에 없다');
  assert.match(r.svg, />N</, '방위 표시가 없다');
});

/** ★ 눈금은 사람이 읽는 수여야 한다 (37m 막대는 아무도 안 읽는다) */
test('★ 축척 눈금은 1·2·5 계열로 고른다', () => {
  [[0.1, 120], [0.5, 120], [3, 120], [0.02, 120]].forEach(([mpp, px]) => {
    const v = birdseye.niceScale(mpp, px);
    const norm = v / Math.pow(10, Math.floor(Math.log10(v)));
    assert.ok([1, 2, 5, 10].some(x => Math.abs(x - norm) < 1e-9),
      `${mpp}m/px → ${v}m 는 읽기 좋은 수가 아니다`);
  });
});

/**
 * ★ 이 그림이 설계도면으로 오해되면 그게 사고다 (건축사법 — 등록부 D-32).
 *   AI 로 그린 이미지가 아니라는 것도 함께 밝힌다.
 */
test('★ 「설계도면이 아님」과 근거가 그림 안에 박혀 있다', () => {
  const r = birdseye.render({
    parcel: PARCEL, mass: builtMass(),
    sources: ['연속지적도(VWorld)', '건축물대장(국토부)'],
  });
  assert.match(r.svg, /설계도면이 아님/);
  assert.match(r.svg, /근거: 연속지적도\(VWorld\) · 건축물대장\(국토부\)/,
    '무엇으로 그렸는지가 그림에 없으면 실측인지 근사인지 알 수 없다');
  assert.match(r.meta.note, /주변 건물·수목·차량은 그리지 않았다/,
    '없는 것을 그리면 있는 것처럼 보인다 — 안 그렸다고 밝혀야 한다');
});

/** ★ 두 그림이 다른 투영을 쓰면 같은 건물이 다르게 보인다 */
test('★ 매스 SVG 와 같은 투영식을 쓴다', () => {
  const [x1, y1] = birdseye.iso(10, 4, 7);
  const expect = [(10 - 4) * Math.cos(Math.PI / 6), 7 - (10 + 4) * Math.sin(Math.PI / 6)];
  assert.ok(Math.abs(x1 - expect[0]) < 1e-9 && Math.abs(y1 - expect[1]) < 1e-9);
});

test('★ 매스가 없으면 필지만 그린다 (빈 그림을 내지 않는다)', () => {
  const r = birdseye.render({ parcel: PARCEL, mass: null });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.meta.hasMass, false);
  assert.match(r.svg, /polygon/, '필지선은 그려야 한다');
});

test('★ 라벨의 <,& 가 그림을 깨뜨리지 않는다', () => {
  const r = birdseye.render({ parcel: PARCEL, mass: builtMass(), label: '<A&B> "표본"' });
  assert.ok(r.svg.indexOf('<A&B>') === -1, 'XML 이스케이프가 빠졌다');
  assert.match(r.svg, /&lt;A&amp;B&gt;/);
});

/* ───────────── 사양 토글 ───────────── */

test('★ 조감도 여부는 출력 사양에 있다', () => {
  assert.strictEqual(outputspec.VISUAL_DEFAULT.birdseye, true);
  assert.strictEqual(outputspec.VISUAL_DEFAULT.massing, true);
});

/**
 * ★ 하나만 보내도 나머지가 사라지면 안 된다. 통째로 덮어쓰면 birdseye 를
 *   끄는 순간 massing 이 없어진다.
 */
test('★ 사양을 항목별로 얹는다 (통째로 덮어쓰지 않는다)', () => {
  const before = process.env.IM_AGENT_ROOT;
  process.env.IM_AGENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'be-spec-'));
  try {
    const store = require('../core/store');
    const id = store.nextProjectId('realestate');
    store.createProjectDirs(id);

    outputspec.save(id, outputspec.propose(id, { docType: 'im' }));
    const off = outputspec.propose(id, { docType: 'im', overrides: { visuals: { birdseye: false } } });
    assert.strictEqual(off.visuals.birdseye, false);
    assert.strictEqual(off.visuals.massing, true, 'massing 이 사라졌다');

    // 끈 것은 유지되어야 한다 — 다시 열 때마다 되살아나면 끌 수가 없다
    outputspec.save(id, off);
    assert.strictEqual(outputspec.propose(id, { docType: 'im' }).visuals.birdseye, false);
  } finally {
    if (before === undefined) delete process.env.IM_AGENT_ROOT;
    else process.env.IM_AGENT_ROOT = before;
  }
});

/** ★ 확정 뒤에 바꾸면 새 버전이어야 한다 — 같은 버전의 산출물이 서로 달라진다 */
test('★ 시각자료 변경은 중대 변경이다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'outputspec.js'), 'utf8');
  const at = src.indexOf('const MATERIAL =');
  assert.ok(src.slice(at, at + 200).includes("'visuals'"),
    '확정 뒤 조감도를 껐다 켜도 버전이 안 오르면 v1.0 이 두 벌이 된다');
});

/* ───────────── Agent · 화면 ───────────── */

test('★ 09 Massing 이 사양이 켜졌을 때만 그린다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '09-massing.js'), 'utf8');
  assert.match(src, /const wantBirdseye = !\(\(spec\.visuals \|\| \{\}\)\.birdseye === false\)/,
    '사양을 안 보고 항상 만들면 「무엇을 만들지」를 사람이 정하는 뜻이 없다');
  assert.match(src, /ctx\.warn\(`조감도 생략/, '건너뛴 이유를 안 남기면 고장으로 읽힌다');
  assert.match(src, /BIRDSEYE_SKIPPED/, '검증 플래그로도 남겨야 화면에 뜬다');
  // 조감도는 축소하지 않은 지적선을 쓴다 — 매스와 같은 축소본을 쓰면 대지가 사라진다
  assert.match(src, /parcelLocal = local;/);
  assert.match(src, /parcel: parcelLocal/);
});

test('★ 3단계 화면에 조감도 선택이 있다', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'reports.html'), 'utf8');
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(code, /조감도 만들기/);
  /* ★ 2026-08-25: 지적도면이 옆에 붙었다. **둘 다 보내야 한다** — 하나만
   *   보내면 안 보낸 쪽이 서버 기본값으로 되살아난다 */
  assert.match(code, /visuals: \{ cadastral: state\.cadastral, birdseye: state\.birdseye \}/,
    '저장할 때 안 보내면 선택이 사라진다');
  assert.match(code, /bchk\.disabled = state\.locked/, '확정된 사양을 화면에서 고칠 수 있으면 안 된다');
  // ★ 서버 값이 있으면 그것이 이긴다. `|| true` 로 쓰면 false 가 되살아난다
  assert.match(code, /typeof s\.visuals\.birdseye === 'boolean'/);
});

/** ★ 아무 값이나 통과시키면 문자열 'false' 가 참이 되어 끈 줄 알았던 것이 만들어진다 */
test('★ 서버가 참거짓만 받는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'report-api.cjs'), 'utf8');
  const at = src.indexOf('b.visuals && typeof b.visuals');
  assert.ok(at !== -1, '시각자료를 안 받고 있다');
  assert.match(src.slice(at, at + 400), /typeof b\.visuals\[k\] === 'boolean'/);
  /* ★★★ **목록을 손으로 적지 않는다** 〈2026-08-25 · 실제로 갈렸다〉.
   *   여기 이름을 따로 적어 두는 바람에 화면이 보낸 `cadastral` 이 조용히
   *   버려졌다 — 켰는데 안 켜지고 오류도 안 났다. 사양이 아는 이름을 쓴다 */
  assert.match(src.slice(at, at + 400), /Object\.keys\(outputspec\.VISUAL_DEFAULT\)/,
    '시각자료 이름을 손으로 적어 두면 새 칸이 조용히 버려진다');
});
