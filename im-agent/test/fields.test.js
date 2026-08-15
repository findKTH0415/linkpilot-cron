'use strict';
/**
 * 가이드 필드 입력 테스트.
 *
 * 여기가 새면 출처 없는 숫자가 보고서에 들어간다 — 이 저장소가 막으려는 단 하나다.
 *
 * 검사하는 것:
 *   ① 화면이 필드 목록을 복사해 두지 않았는가 (사전이 단일 출처)
 *   ② 출처 없는 값이 저장되지 않는가 (화면·서버 양쪽)
 *   ③ 계산 항목이 입력되지 않는가
 *   ④ 범위 위반이 '경고'로 남는가 (막으면 진짜 이상값이 사라진다)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const F = require('../ui/platform/fields-core.js');
const dict = require('../core/dictionary');
const { createHandlers: readHandlers } = require('../ui/api-router.cjs');
const { createHandlers: writeHandlers } = require('../ui/report-api.cjs');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');

const PRO = { authenticated: true, planId: 'pro', status: 'active', name: '홍길동' };

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'im-fields-'));
}

/** 프로젝트 폴더를 만들고 핸들러를 돌려준다 */
function setup(user) {
  const root = tmpRoot();
  process.env.IM_AGENT_ROOT = root;
  const store = require('../core/store');
  const id = 'LP-DC-2026-001';
  store.createProjectDirs(id);
  const h = writeHandlers({ agentRoot: root, authenticate: () => (user === undefined ? PRO : user) });
  return { root, id, h };
}

// ── ① 단일 출처 ──────────────────────────────────────────────

test('★ 화면이 필드 목록을 복사해 두지 않는다', () => {
  const core = read('fields-core.js');
  // 사전에만 있어야 하는 문자열이 화면 로직에 박혀 있으면 사전이 바뀔 때 갈린다
  ['land.area_sqm', 'building.gfa_sqm', 'investment.total', '연면적', '총사업비'].forEach((needle) => {
    assert.ok(!core.includes(needle),
      `fields-core.js 에 '${needle}' 이 들어 있다 — 사전(core/dictionary.js)이 단일 출처여야 한다`);
  });
  const html = read('fields.html');
  assert.ok(!html.includes('land.area_sqm'), 'fields.html 에도 필드를 박아 두면 안 된다');
});

test('GET /fields 가 사전을 그대로 내려준다', async () => {
  const h = readHandlers({ agentModulePath: path.join(__dirname, '..') });
  const r = await h.fields();
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(Object.keys(r.body.fields).sort(), Object.keys(dict.FIELDS).sort(),
    '사전에 항목이 추가되면 화면도 즉시 따라와야 한다');
  assert.deepStrictEqual(r.body.computedKeys, dict.COMPUTED_KEYS);
});

test('계산 항목은 입력 대상 목록에 섞이지 않는다', async () => {
  const h = readHandlers({ agentModulePath: path.join(__dirname, '..') });
  const r = await h.fields();
  dict.COMPUTED_KEYS.forEach((k) => {
    assert.ok(!r.body.fields[k], `${k} 는 계산 항목인데 입력 필드로 나왔다`);
  });
});

// ── ② 출처 강제 (화면) ───────────────────────────────────────

test('★ 출처가 없으면 저장할 수 없다', () => {
  const fields = { 'land.area_sqm': { label: '대지면적', category: 'Land', unit: '㎡', type: 'number' } };
  const v = F.validateAll(fields, { 'land.area_sqm': { value: 5000, source: '' } }, []);
  assert.strictEqual(v.canSave, false);
  assert.match(v.errors[0], /출처/);
});

test('값이 비어 있으면 입력하지 않은 것으로 본다 (오류가 아니다)', () => {
  const fields = { 'land.area_sqm': { label: '대지면적', category: 'Land', type: 'number' } };
  const v = F.validateAll(fields, { 'land.area_sqm': { value: '', source: '' } }, []);
  assert.strictEqual(v.canSave, true, '빈 칸까지 오류로 만들면 아무것도 저장할 수 없다');
});

test('출처만 적고 값이 없으면 잡아낸다', () => {
  const fields = { 'land.area_sqm': { label: '대지면적', category: 'Land', type: 'number' } };
  const v = F.validateAll(fields, { 'land.area_sqm': { value: '', source: '사업계획서.pdf' } }, []);
  assert.strictEqual(v.canSave, false);
  assert.match(v.errors[0], /값이 없다/);
});

test('진행률은 값과 출처가 모두 있을 때만 센다', () => {
  const fields = {
    a: { label: 'A', category: 'Project', requiredFor: ['im'] },
    b: { label: 'B', category: 'Project', requiredFor: ['im'] },
  };
  const c = F.completeness(fields, { a: { value: 1, source: 'x.pdf' }, b: { value: 2, source: '' } }, 'im');
  assert.strictEqual(c.total, 2);
  assert.strictEqual(c.filled, 1, '출처 없는 값을 세면 다 됐다고 착각한다');
  assert.deepStrictEqual(c.missing, ['b']);
  assert.strictEqual(c.percent, 50);
});

// ── ③ 계산 항목 (화면) ───────────────────────────────────────

test('★ 계산 항목은 입력을 거부한다', () => {
  const v = F.validateEntry('returns.project_irr', { label: 'Project IRR', type: 'number' },
    { value: 15.9, source: '재무모델' }, ['returns.project_irr']);
  assert.strictEqual(v.errors.length, 1);
  assert.match(v.errors[0], /계산/);
});

test('사전에 없는 key 는 거부한다', () => {
  const v = F.validateEntry('made.up', null, { value: 1, source: 'x' }, []);
  assert.match(v.errors[0], /사전에 없는/);
});

// ── ④ 범위 (화면) ────────────────────────────────────────────

test('★ 범위를 벗어나도 막지 않고 경고만 한다', () => {
  const def = { label: 'PUE', category: 'Capacity', type: 'number', min: 1.0, max: 2.5 };
  const v = F.validateEntry('capacity.pue', def, { value: 3.4, source: '설계도서.pdf' }, []);
  assert.strictEqual(v.errors.length, 0, '막으면 05 Validation 이 잡을 이상값이 화면에서 사라진다');
  assert.strictEqual(v.warnings.length, 1);
  assert.match(v.warnings[0], /초과/);
});

test('숫자 칸에 글자를 넣으면 오류다', () => {
  const def = { label: '대지면적', category: 'Land', type: 'number' };
  const v = F.validateEntry('land.area_sqm', def, { value: '오천', source: 'x.pdf' }, []);
  assert.match(v.errors[0], /숫자가 아니다/);
});

test('쉼표가 있는 숫자는 받아들인다', () => {
  assert.strictEqual(F.parseNumber('2,846'), 2846);
  assert.ok(Number.isNaN(F.parseNumber('')));
});

test('출처일 형식과 페이지 번호를 검사한다', () => {
  const def = { label: 'A', category: 'Project', type: 'string' };
  assert.match(F.validateEntry('a.b', def, { value: 'x', source: 's', sourceDate: '2026/08/14' }, []).errors[0], /YYYY-MM-DD/);
  assert.match(F.validateEntry('a.b', def, { value: 'x', source: 's', page: '0' }, []).errors[0], /1 이상/);
});

// ── 단위 환산 ────────────────────────────────────────────────

test('★ 단위 환산은 값을 돌려줄 뿐 자동 적용하지 않는다', () => {
  assert.strictEqual(F.toEokwon('284600000000', '원'), 2846);
  assert.strictEqual(F.toEokwon('2846', '억원'), 2846);
  assert.strictEqual(F.toEokwon('100', '백만원'), 1);
  assert.strictEqual(F.toEokwon('123', '달러'), null, '모르는 단위는 짐작하지 않는다');
});

// ── 그룹·필수 ────────────────────────────────────────────────

test('사전에 새 카테고리가 생겨도 항목을 버리지 않는다', () => {
  const g = F.groupByCategory({
    a: { label: 'A', category: 'Project' },
    z: { label: 'Z', category: '신규카테고리' },
  });
  const cats = g.map(x => x.category);
  assert.ok(cats.includes('신규카테고리'), '모르는 카테고리를 버리면 입력할 방법이 없어진다');
  assert.strictEqual(cats[0], 'Project', '알려진 카테고리가 먼저 온다');
});

// ── 필터 ─────────────────────────────────────────────────────

test('★ 문제 있는 줄은 필터·검색과 무관하게 항상 보인다', () => {
  // PUE 는 어떤 보고서에도 필수가 아니다 — '필수만' 필터에서 사라지는 항목이다
  const values = { 'capacity.pue': { value: 9.9, source: '설계도서.pdf' } };
  const opts = { filter: 'required', q: '', docType: 'im' };
  assert.strictEqual(F.isVisible('capacity.pue', dict.FIELDS, values, dict.COMPUTED_KEYS, opts), true,
    '"경고 1건"이라고 띄워 놓고 그 줄이 필터에 가려 있으면 고칠 방법이 없다');

  // 검색어와 무관해도 마찬가지다
  assert.strictEqual(F.isVisible('capacity.pue', dict.FIELDS, values, dict.COMPUTED_KEYS,
    { filter: 'all', q: '전혀다른말', docType: 'im' }), true);
});

test('문제가 없으면 필터가 정상 동작한다', () => {
  const values = { 'capacity.pue': { value: 1.4, source: '설계도서.pdf' } };
  assert.strictEqual(
    F.isVisible('capacity.pue', dict.FIELDS, values, dict.COMPUTED_KEYS,
      { filter: 'required', q: '', docType: 'im' }),
    false, '필수가 아닌 정상 항목은 "필수만"에서 빠진다');
  assert.strictEqual(
    F.isVisible('investment.total', dict.FIELDS, {}, dict.COMPUTED_KEYS,
      { filter: 'required', q: '', docType: 'im' }),
    true);
});

test('별칭으로도 검색된다 (GFA → 연면적)', () => {
  const opts = { filter: 'all', q: 'gfa', docType: 'im' };
  assert.strictEqual(F.isVisible('building.gfa_sqm', dict.FIELDS, {}, dict.COMPUTED_KEYS, opts), true,
    '문서에 쓰인 표기로 찾을 수 있어야 한다');
  assert.strictEqual(F.isVisible('debt.rate', dict.FIELDS, {}, dict.COMPUTED_KEYS, opts), false);
});

test('"미입력만" 은 값이 있는 항목을 숨긴다', () => {
  const values = { 'investment.total': { value: 2846, source: 'a.pdf' } };
  const opts = { filter: 'empty', q: '', docType: 'im' };
  assert.strictEqual(F.isVisible('investment.total', dict.FIELDS, values, dict.COMPUTED_KEYS, opts), false);
  assert.strictEqual(F.isVisible('investment.land', dict.FIELDS, values, dict.COMPUTED_KEYS, opts), true);
});

test('보고서 종류마다 필수 항목이 다르다', () => {
  const teaser = F.requiredKeys(dict.FIELDS, 'teaser');
  const im = F.requiredKeys(dict.FIELDS, 'im');
  assert.ok(teaser.length > 0 && im.length > teaser.length, '티저가 IM 보다 요구가 적어야 한다');
  assert.ok(im.includes('investment.total'));
});

// ── ⑤ 서버 ───────────────────────────────────────────────────

test('★ 서버도 출처 없는 값을 저장하지 않는다', async () => {
  const { h, id } = setup();
  const r = await h.saveFacts({}, id, { facts: [{ key: 'land.area_sqm', value: 5000 }] });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.rejected[0].reason, /출처/);
});

test('★ 서버도 계산 항목을 받지 않는다', async () => {
  const { h, id } = setup();
  const r = await h.saveFacts({}, id, {
    facts: [{ key: 'returns.project_irr', value: 15.9, source: '내 계산' }],
  });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.rejected[0].reason, /계산/);
});

test('정상 입력은 저장되고 다시 읽힌다', async () => {
  const { h, id } = setup();
  const w = await h.saveFacts({}, id, {
    facts: [
      { key: 'land.area_sqm', value: '5,000', source: '사업계획서.pdf', page: 10, sourceDate: '2026-07-01' },
      { key: 'project.name', value: '용인 데이터센터', source: '사업계획서.pdf' },
    ],
  });
  assert.strictEqual(w.status, 200);
  assert.strictEqual(w.body.saved, 2);

  const r = await h.getFacts({}, id);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.values['land.area_sqm'].value, 5000, '쉼표를 떼고 숫자로 저장한다');
  assert.strictEqual(r.body.values['land.area_sqm'].page, 10);
  assert.strictEqual(r.body.values['project.name'].value, '용인 데이터센터');
});

test('★ 값을 고치면 고친 값이 남는다 (옛 값이 이기지 않는다)', async () => {
  const { h, id } = setup();
  await h.saveFacts({}, id, { facts: [{ key: 'land.area_sqm', value: 5000, source: '사업계획서.pdf', page: 10 }] });
  await h.saveFacts({}, id, { facts: [{ key: 'land.area_sqm', value: 5500, source: '사업계획서.pdf', page: 10 }] });

  const r = await h.getFacts({}, id);
  assert.strictEqual(r.body.values['land.area_sqm'].value, 5500,
    '고친 값이 후보로만 쌓이면 저장은 성공했다는데 화면 값은 그대로다 — 가장 나쁜 실패다');
});

test('★ 화면 입력을 고쳐도 다른 출처의 값은 지우지 않는다', async () => {
  const { root, h, id } = setup();
  const store = require('../core/store');
  const { Dataset } = require('../core/facts');

  await h.saveFacts({}, id, { facts: [{ key: 'land.area_sqm', value: 5000, source: '사업계획서.pdf', page: 10 }] });

  // 추출 Agent 가 다른 문서에서 뽑은 값
  const ds = Dataset.fromJSON(store.readJson(id, '01_Project/dataset.json'), dict.FIELDS);
  ds.add({ key: 'land.area_sqm', value: 9999, source: '기술제안서.pdf', page: 3, confidence: 0.8 });
  ds.resolve();
  store.writeJson(id, '01_Project/dataset.json', ds.toJSON());

  await h.saveFacts({}, id, { facts: [{ key: 'land.area_sqm', value: 5600, source: '사업계획서.pdf', page: 10 }] });

  const saved = store.readJson(id, '01_Project/dataset.json');
  const sources = (saved.candidates['land.area_sqm'] || []).map(c => c.source).sort();
  assert.deepStrictEqual(sources, ['기술제안서.pdf', '사업계획서.pdf'],
    '출처가 다른 값이 갈리는 것은 버그가 아니라 잡아내야 할 신호다 — 지우면 안 된다');
  assert.ok(saved.conflicts.some(c => c.key === 'land.area_sqm'), '충돌은 그대로 기록되어야 한다');
  assert.ok(root);
});

test('★ 값이 갈리면 화면에도 알려준다 (이긴 값만 보여주지 않는다)', async () => {
  const { h, id } = setup();
  const store = require('../core/store');
  const { Dataset } = require('../core/facts');

  await h.saveFacts({}, id, { facts: [{ key: 'building.gfa_sqm', value: 52822, source: '사업계획서.pdf', page: 10 }] });
  const ds = Dataset.fromJSON(store.readJson(id, '01_Project/dataset.json'), dict.FIELDS);
  ds.add({ key: 'building.gfa_sqm', value: 54822, source: '기술제안서.pdf', page: 10, confidence: 0.9 });
  ds.resolve();
  store.writeJson(id, '01_Project/dataset.json', ds.toJSON());

  const r = await h.getFacts({}, id);
  const v = r.body.values['building.gfa_sqm'];
  assert.ok(v.alternatives && v.alternatives.length,
    '이긴 값만 내보내면 화면에서는 멀쩡해 보이고 충돌은 검증 단계에 가서야 드러난다');
  assert.ok(v.alternatives.some(a => a.value === 54822 || a.value === 52822));
});

test('갈리지 않는 값에는 대안 목록을 달지 않는다', async () => {
  const { h, id } = setup();
  await h.saveFacts({}, id, { facts: [{ key: 'building.gfa_sqm', value: 52822, source: 'a.pdf' }] });
  const r = await h.getFacts({}, id);
  assert.strictEqual(r.body.values['building.gfa_sqm'].alternatives, null);
});

test('dropWhere 는 조건에 맞는 후보만 지운다', () => {
  const { Dataset } = require('../core/facts');
  const ds = new Dataset('LP-DC-2026-001', dict.FIELDS);
  ds.add({ key: 'land.area_sqm', value: 1, source: 'a.pdf', note: 'user_input' });
  ds.add({ key: 'land.area_sqm', value: 2, source: 'b.pdf' });
  ds.add({ key: 'project.name', value: 'X', source: 'a.pdf', note: 'user_input' });

  const removed = ds.dropWhere((f, key) => key === 'land.area_sqm' && f.note === 'user_input');
  assert.strictEqual(removed, 1);
  ds.resolve();
  assert.strictEqual(ds.get('land.area_sqm').value, 2);
  assert.strictEqual(ds.get('project.name').value, 'X', '조건 밖 항목은 건드리지 않는다');
});

test('사람이 넣은 값이 verified 로 올라가지 않는다', async () => {
  const { h, id } = setup();
  await h.saveFacts({}, id, { facts: [{ key: 'land.area_sqm', value: 5000, source: 'a.pdf' }] });
  const r = await h.getFacts({}, id);
  assert.strictEqual(r.body.values['land.area_sqm'].verified, false,
    '적어 넣었다고 검증된 것이 아니다 — 독립 출처 2건이 일치해야 승격된다');
});

test('★ 범위를 벗어난 값은 저장하되 경고를 돌려준다', async () => {
  const { h, id } = setup();
  const r = await h.saveFacts({}, id, { facts: [{ key: 'capacity.pue', value: 3.4, source: '설계도서.pdf' }] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.saved, 1);
  assert.strictEqual(r.body.warnings.length, 1);
  assert.match(r.body.warnings[0], /PUE/);
});

test('★ 생성 중에는 값을 고칠 수 없다', async () => {
  const root = tmpRoot();
  process.env.IM_AGENT_ROOT = root;
  const store = require('../core/store');
  const id = 'LP-DC-2026-002';
  store.createProjectDirs(id);
  const h = writeHandlers({
    agentRoot: root,
    authenticate: () => PRO,
    runningFor: () => ({ runId: 'run-1-abc' }),
  });
  const r = await h.saveFacts({}, id, { facts: [{ key: 'land.area_sqm', value: 1, source: 'a.pdf' }] });
  assert.strictEqual(r.status, 409, '파이프라인이 읽는 중에 바뀌면 산출물과 데이터가 어긋난다');
  assert.match(r.body.error, /진행 중/);
});

test('미인증·무료 회원은 값을 볼 수도 저장할 수도 없다', async () => {
  const anon = writeHandlers({ agentRoot: tmpRoot(), authenticate: () => null });
  assert.strictEqual((await anon.getFacts({}, 'LP-DC-2026-001')).status, 401);
  assert.strictEqual((await anon.saveFacts({}, 'LP-DC-2026-001', { facts: [] })).status, 401);

  const free = writeHandlers({ agentRoot: tmpRoot(), authenticate: () => ({ planId: 'free', status: 'active' }) });
  assert.strictEqual((await free.getFacts({}, 'LP-DC-2026-001')).status, 403);
});

test('잘못된 프로젝트 ID 는 파일을 건드리기 전에 막는다', async () => {
  const { h } = setup();
  assert.strictEqual((await h.saveFacts({}, '../../etc', { facts: [] })).status, 400);
  assert.strictEqual((await h.getFacts({}, 'nope')).status, 400);
});

test('값이 없는 프로젝트도 빈 목록으로 정상 응답한다', async () => {
  const { h, id } = setup();
  const r = await h.getFacts({}, id);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.values, {});
  assert.strictEqual(r.body.hasDataset, false, '"없다"와 "못 읽었다"를 화면이 구분할 수 있어야 한다');
});

// ── 화면 규약 ────────────────────────────────────────────────

test('화면이 script 태그 짝을 맞춘다 (인라인 시 조기 종료 방지)', () => {
  const html = read('fields.html');
  const open = (html.match(/<script\b/g) || []).length;
  const close = (html.match(/<\/script>/g) || []).length;
  assert.strictEqual(open, close, '주석 안의 닫는 태그 하나로 화면이 통째로 빈다');
});

test('화면에 내부 호스트가 들어가지 않는다', () => {
  const html = read('fields.html');
  assert.ok(!/\.ts\.net|synologynas|192\.168\./.test(html), '공개 저장소다');
});

test('화면이 innerHTML 을 쓰지 않는다 (입력값이 그대로 들어온다)', () => {
  const html = read('fields.html');
  assert.ok(!/\.innerHTML\s*=/.test(html), '자료명·값은 사용자 입력이다');
});

test('★ 커밋된 단일 HTML 이 소스와 같다 (빌드 산출물 최신 여부)', () => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const committed = read('linkpilot-platform.html');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'im-build-')), 'out.html');

  execFileSync(process.execPath, [path.join(PLATFORM, 'build.js'), '--out', tmp], { stdio: 'ignore' });
  const fresh = fs.readFileSync(tmp, 'utf8');

  assert.strictEqual(fresh, committed,
    '커밋된 linkpilot-platform.html 이 소스와 다르다 — `npm run im:platform` 로 다시 만들어라. '
    + '산출물이 소스와 갈리면 화면에서만 옛 동작이 계속 살아 있고 아무도 눈치채지 못한다');
});
