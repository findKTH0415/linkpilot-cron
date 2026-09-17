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

/* ────────────────────────────────────────────────────────────────────
 * 렌더 실패를 «넷»으로 갈라 말한다 — 2026-09-17 실측으로 생긴 칸
 *
 * 무엇이 났나: 사장님이 `render-smoke` 의 빨간 ❌ 둘을 화면으로 주셨다.
 * 로그를 갈라 읽으니 **열쇠는 살아 있었다** — 서버가 인증을 통과시키고
 * 「`limit: 0`, free_tier」라고 답했다. 곧 **무료 등급에 이미지 모델 몫이 0**이다.
 *
 * ★ 그런데 그때 화면 마지막 줄은 「모델 이름이 다르면 GEMINI_RENDER_MODELS 로
 *   바꿔 다시 시도한다」였다 — 사장님은 **모델 이름을 고치러 가신다.**
 *   실제 원인은 결제다 (§4.6 「원인을 사람 말로 적는다」).
 * ★★ 그 뒤 `diagnose()` 가 들어와 고쳐졌는데 **재는 칸이 0개였다** —
 *   누가 조건을 건드리면 **조용히 되돌아간다.** 그래서 못박는다.
 * ────────────────────────────────────────────────────────────────── */

const bird = require(path.join(__dirname, '..', 'tools', 'render-birdseye.js'));

/* 사장님 실행(run 32843199322)에 실제로 찍힌 글이다 — 줄여 쓰지 않는다.
   ★ 표본이 고장의 «크기»를 정한다 (§12-11) — 짧게 줄이면 `limit: 0` 이 빠져
     네 갈래 중 둘이 구별되지 않는다. */
const REAL_ZERO = 'gemini-3-pro-image[interactions]: You exceeded your current quota, '
  + 'please check your plan and billing details. '
  + '* Quota exceeded for metric: generativelanguage.googleapis.com/'
  + 'generate_content_free_tier_requests, limit: 0, model: gemini-3-pro-image '
  + 'Please retry in 59.995010351s.';

test('★★★ 「몫이 0」을 결제로 가른다 — 기다려도 안 낫는 것이다', () => {
  const d = bird.diagnose([REAL_ZERO]);
  assert.strictEqual(d.kind, 'billing',
    '무료 등급 몫 0 을 결제로 안 가릅니다 — 사장님이 기다리시거나 열쇠를 다시 넣으십니다');
  const txt = [d.head, ...(d.body || [])].join(' ');
  assert.match(txt, /열쇠를 다시 넣어도 안 열린다|결제/,
    '무엇을 하면 되는지가 글에 없습니다');
  /* ★ 그리고 «엉뚱한 곳»을 가리키지 않아야 한다 — 그것이 이 고장의 본체였다. */
  assert.ok(!/GEMINI_RENDER_MODELS/.test(txt),
    '모델 이름을 고치라고 말합니다 — 고칠 것이 없는 자리로 보내는 글입니다');
});

test('★★★ 반대로도 막는다 — «진짜» 한도 초과에 「결제를 붙이세요」라고 안 적는다', () => {
  /* [왜] 결제를 이미 붙이신 뒤의 한도 초과는 **기다리면 낫는다**. 그때 결제를
     가리키면 사장님이 **이미 하신 일을 또 하신다** (M-86 · §4.6 「고치는 방향이
     반대로 가는 것도 함께 막는다」). 둘 다 429/quota 이고 서버는 둘 다
     「retry in 59s」라고 말하므로, 가르는 것은 `limit: 0` 하나다. */
  const paid = 'You exceeded your current quota. Quota exceeded for metric: '
    + 'generate_content_paid_tier_requests, limit: 1000. Please retry in 30s.';
  const d = bird.diagnose([paid]);
  assert.strictEqual(d.kind, 'quota',
    '진짜 한도 초과를 결제 문제로 적습니다 — 이미 하신 일을 또 하시게 됩니다');
  const txt = [d.head, ...(d.body || [])].join(' ');
  assert.match(txt, /그대로 두면|기다/, '기다리면 된다는 말이 없습니다');
  assert.ok(!/Set up Billing|결제를 연결/.test(txt), '결제를 붙이라고 말합니다');
});

test('★★ 열쇠·모델은 여전히 갈라진다 (넷이 서로 안 섞인다)', () => {
  const key = bird.diagnose(['API key not valid. Please pass a valid API key. 401 UNAUTHENTICATED']);
  const model = bird.diagnose(['models/gemini-x is not found for API version v1beta 404']);
  assert.strictEqual(key.kind, 'key', '열쇠 거부를 못 가릅니다');
  assert.strictEqual(model.kind, 'model', '모델 이름 문제를 못 가릅니다');
  /* ★ 넷이 «서로 다른 글»이어야 한다 — 같은 글이면 갈래가 있어도 거짓이다
     (§6-2-5 「딱지가 여섯인데 글이 같으면 그 딱지는 거짓이다」와 같은 잣대). */
  const heads = [bird.diagnose([REAL_ZERO]).head, key.head, model.head,
    bird.diagnose(['quota exceeded, limit: 1000']).head];
  assert.strictEqual(new Set(heads).size, 4, '넷 중 같은 글을 내는 갈래가 있습니다');
});

/* ────────────────────────────────────────────────────────────────────
 * 그 판정이 «사장님께 닿는 자리»에 실리는가 — 2026-09-17 실측으로 생긴 칸 셋
 *
 * 무엇이 났나: 사장님이 `render-smoke` 실패 화면을 다시 주셨다. 요약 첫 줄이
 *   여전히 「… (모델 이름은 … 로 조정)」이었다. 위 칸들이 도구를 재서 초록인데도.
 *
 * ★★★ 갈라 보니 **도구는 멀쩡했고 그 답이 요약에 한 줄도 안 왔다.** 그 도구는
 *   판정을 stderr 로 적는데 워크플로가 `| tee` 로 **stdout 만** 받았다 —
 *   실측으로 그 파일에 담긴 것은 「원본: …」 **한 줄**이었고, 사장님 화면에
 *   정확히 그 한 줄만 보였다. 판정은 Actions 로그에만 있었다.
 *   **「만들었다」와 「닿는다」는 다른 사실이다** (CLAUDE.md §8 과 같은 결).
 * ★★ 그래서 위 칸들이 «아무것도 못 막았다» — 재는 자리가 도구에서 끝났기 때문이다.
 *   한 칸에서 배운 것을 **그 값이 흘러가는 자리**에 안 대면 거기 그대로 남는다.
 * ──────────────────────────────────────────────────────────────── */

const WF_PATH = path.join(__dirname, '..', '..', '.github', 'workflows', 'render-smoke.yml');

/** ★ 주석 줄을 떼고 본다 — 이 고침의 경위를 워크플로 주석에 그대로 적었으므로,
 *  안 떼면 ①은 주석으로 통과하고 ②는 주석 때문에 빨개진다 (§8 의 함정이 양쪽으로 온다). */
function wfCode() {
  const raw = fs.readFileSync(WF_PATH, 'utf8');
  return raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

test('★★★ 워크플로가 «판정(stderr)까지» 받아 적는다 — 안 받으면 요약이 한 줄만 보인다', () => {
  const code = wfCode();
  const m = code.match(/render-birdseye\.js[^\n|]*\|\s*tee\s+\S+/);
  assert.ok(m, 'render-birdseye 를 tee 로 받는 자리를 못 찾았습니다 — 이 칸은 아무것도 안 잽니다');
  assert.match(m[0], /2>&1\s*\|\s*tee/,
    'stderr 를 안 받습니다 — 판정이 요약에 한 줄도 안 오고 「원본: …」만 보입니다');
});

test('★★★ 요약이 원인을 «스스로 단정»하지 않는다 — 가르는 일은 도구가 한다', () => {
  const code = wfCode();
  /* GITHUB_STEP_SUMMARY 로 직접 적는 줄만 본다 — 로그로 가는 것은 상관없다 */
  const lines = code.split('\n').filter((l) => /GITHUB_STEP_SUMMARY/.test(l) && /echo/.test(l));
  assert.ok(lines.length >= 2,
    `요약에 적는 줄을 ${lines.length}개밖에 못 찾았습니다 — 이 칸은 거의 아무것도 안 잽니다`);
  /* ★ 낱말이 아니라 «시키는가»를 잰다 (§4.6 의 잣대) — 처방이 요약 글 자체에 박혀 있으면
     그것이 무엇이 막았든 늘 같은 곳을 가리킨다. */
  const bad = lines.filter((l) => /GEMINI_RENDER_MODELS|모델 이름|열쇠를 다시 넣|결제를 연결/.test(l));
  assert.strictEqual(bad.length, 0,
    '요약이 스스로 처방을 적습니다 — 원인과 무관하게 늘 같은 곳을 가리킵니다:\n      '
    + bad.map((l) => l.trim().slice(0, 90)).join('\n      '));
});

test('★★★ 실어 나르는 줄 수가 «판정 최악 길이»를 덮는다 — 숫자를 손으로 안 박는다', () => {
  const code = wfCode();
  const m = code.match(/tail\s+-(\d+)\s+\S*render\.log/);
  assert.ok(m, 'render.log 를 요약으로 나르는 자리를 못 찾았습니다 — 이 칸은 아무것도 안 잽니다');
  const carried = +m[1];

  /* ★ 재는 법이 재려는 것을 다 덮게 — 갈래 넷을 «실제로 돌려» 가장 긴 출력을 센다.
     숫자를 박아 두면 body 가 늘어난 날 조용히 앞이 잘리고, 잘리는 첫 줄이
     하필 «무엇이 막았는가»다 (§6-2-6 의 46 → 105 와 같은 규칙). */
  const SAMPLES = [
    [REAL_ZERO],
    ['quota exceeded, limit: 1000. Please retry in 30s.'],
    ['API key not valid. Please pass a valid API key. 401 UNAUTHENTICATED'],
    ['models/gemini-x is not found for API version v1beta 404'],
    ['무엇인지 모를 오류'],
  ];
  let worst = 0;
  for (const s of SAMPLES) {
    const d = bird.diagnose(s);
    /* 실패 출력 = 원본 1줄 + head 1줄 + body + 빈 줄 1 + 안내 1줄 + 원문 최대 4줄 */
    worst = Math.max(worst, 1 + 1 + (d.body || []).length + 1 + 1 + 4);
  }
  assert.ok(carried >= worst,
    `${carried}줄만 나릅니다 — 판정이 최악 ${worst}줄이라 «무엇이 막았는가»가 앞에서 잘립니다`);
});
