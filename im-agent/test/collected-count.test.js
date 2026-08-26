/**
 * **「0개 수집자료」가 왜 0 이었나 — 실제 프로젝트 하나로 끝까지 따라간다**
 * 〈2026-08-25 · 사장님 권고 ③〉.
 *
 * ★★★ 경위. 사장님 화면에 **「0개 수집자료 + 3개 자체분석자료」**가 떴다.
 *   그때 셋은 전부 요청문에서 뽑은 값이었다 — 자료를 한 글자도 못 읽은
 *   상태였다. 값의 `origin` 이 안 오면 화면은 **어느 쪽에도 못 세고**,
 *   숫자는 틀리지 않았는데 **아무 뜻이 없다.**
 *
 * ★★ 그래서 여기서는 **파이프라인을 실제로 돌려** 저장된 값이 화면까지
 *   그대로 오는지를 잰다. 화면 소스를 글자로 대조하는 것으로는 이 결을
 *   못 잡는다 — 갈리는 자리가 **저장된 값 안**이기 때문이다.
 *
 * ★ 여기서 재는 것:
 *   ① 문서에서 읽은 값이 `origin: 'document'` 로 **저장되는가**
 *   ② 그것이 `GET …/facts` 를 지나 **그대로 오는가** (조용히 빠지지 않는가)
 *   ③ 옛 판이 저장한 값(`origin` 없음)도 **버리지 않고 되짚는가**
 *   ④ 읽은 시각이 **사람이 읽는 꼴**로 오는가
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function handlers() {
  const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-cnt-'));
  process.env.IM_AGENT_ROOT = agentRoot;
  process.env.IM_AGENT_OFFLINE = '1';
  const api = require(path.join(ROOT, 'ui/report-api.cjs'));
  const h = api.createHandlers({
    agentRoot,
    agentModulePath: ROOT,
    authenticate: () => ({ name: '검증', planId: 'pro', status: 'active' }),
  });
  return { h, agentRoot };
}

/** 실제로 값이 나오는 자료를 넣고 진짜 추출기를 돌린다 */
async function readInto(id) {
  const store = require(path.join(ROOT, 'core/store'));
  const dir = path.join(store.projectDir(id), '02_Source_Data');
  fs.mkdirSync(dir, { recursive: true });
  /* ★ 표본은 **재려는 성질을 지켜야 한다** (§8). 실제 파서가 읽는 꼴로 적는다 —
   *   안 읽히는 표본으로 재면 「0 이 맞다」와 「0 이 사고다」를 못 가른다 */
  fs.writeFileSync(path.join(dir, '사업계획서.md'), [
    '# 표본 사업계획서',
    '',
    '- 연면적 : 52,822㎡',
    '- 대지면적 : 18,400㎡',
    '- 총사업비 : 2,846억원',
    '',
  ].join('\n'), 'utf8');
  const pipeline = require(path.join(ROOT, 'pipeline.js'));
  return pipeline.extractInto(id, null, { log: () => {} });
}

async function project() {
  const store = require(path.join(ROOT, 'core/store'));
  const id = store.nextProjectId('datacenter');
  store.createProjectDirs(id);
  return id;
}

test('★★★ 문서에서 읽은 값이 화면까지 「수집자료」로 온다', async () => {
  const { h } = handlers();
  const id = await project();
  const got = await readInto(id);
  assert.ok(got.facts.length > 0, '추출기가 값을 하나도 못 만들었다 — 표본이 거짓말을 한다');

  const r = await h.getFacts({}, id);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const values = r.body.values || {};
  const doc = Object.keys(values).filter((k) => values[k].origin === 'document');
  assert.ok(doc.length > 0,
    `수집자료가 0 이다 — 저장은 ${got.facts.length}건인데 화면 쪽에는 안 온다`);

  /* ★ 「갈리지 않은 값」이 남으면 화면이 어느 쪽에도 못 센다 */
  const unknown = Object.keys(values).filter((k) => !values[k].origin);
  assert.strictEqual(unknown.length, 0,
    `출처 등급이 안 붙은 값이 ${unknown.length}개다 — 화면이 어느 쪽에도 못 센다`);

  /* ★ 올린 자료 이름도 함께 와야 「올렸는데 값이 안 나온 것」을 셀 수 있다 */
  assert.ok((r.body.sources || []).indexOf('사업계획서.md') !== -1,
    '읽은 자료 이름이 안 온다');
});

/**
 * ★★★ **옛 판이 저장한 값에는 `origin` 이 없다.** 그것을 버리면 화면에
 *   「갈리지 않은 값 52개」만 뜬다 — 고장으로 읽힌다. 출처로 되짚어 채운다.
 */
test('★★★ 옛 판이 저장한 값도 출처로 되짚어 센다', async () => {
  const { h } = handlers();
  const id = await project();
  await readInto(id);

  const store = require(path.join(ROOT, 'core/store'));
  const ds = store.readJson(id, '01_Project/dataset.json', null);
  assert.ok(ds && ds.facts, 'dataset 을 못 읽었다');
  Object.keys(ds.facts).forEach((k) => { delete ds.facts[k].origin; });   // 옛 판 흉내
  store.writeJson(id, '01_Project/dataset.json', ds);

  const values = (await h.getFacts({}, id)).body.values || {};
  const unknown = Object.keys(values).filter((k) => !values[k].origin);
  assert.strictEqual(unknown.length, 0, '옛 값을 통째로 「모름」으로 버린다');
  assert.ok(Object.keys(values).some((k) => values[k].origin === 'document'),
    '파일명이 붙은 값을 「수집자료」로 안 되짚는다');
});

test('★★ 읽은 시각이 사람이 읽는 꼴로 온다', async () => {
  const { h } = handlers();
  const id = await project();
  await readInto(id);
  const at = (await h.getFacts({}, id)).body.readAt;
  assert.ok(at, '읽은 시각이 안 온다');
  assert.match(String(at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    `화면이 그대로 찍는 값이다 — 「${at}」 는 사람이 읽는 글이 아니다`);
});

/** ★ 자료가 없으면 0 이 맞다. **0 을 못 내면 「없다」를 말할 수 없다** */
test('★★ 자료가 없으면 수집자료 0 이고, 그것이 사실이다', async () => {
  const { h } = handlers();
  const id = await project();
  const values = (await h.getFacts({}, id)).body.values || {};
  const doc = Object.keys(values).filter((k) => values[k].origin === 'document');
  assert.strictEqual(doc.length, 0);
});

/**
 * ★★★ **빈 목록을 「읽을 것이 없다」로 넘기면 조용히 0 이 된다**
 *   〈2026-08-25 · 「0개 수집자료」를 따라가다 잡은 진짜 버그〉.
 *
 *   `extractInto(id, null)` 이 빈 배열을 넘기고 있었고, 받는 쪽은
 *   **빈 배열도 참**이라 프로젝트 폴더를 안 훑었다. 결과는
 *   **「추출: 0건 / 문서 0건 / 미지원 0건」 — 성공으로 끝난다.**
 *   자료가 폴더에 그대로 있는데 한 글자도 안 읽고 오류도 안 났다.
 */
test('★★★ 목록을 안 주면 프로젝트의 원본자료를 훑는다 (조용히 0 이 되지 않는다)', async () => {
  handlers();
  const id = await project();
  await readInto(id);   // 파일을 넣고 목록 없이 부른다

  const store = require(path.join(ROOT, 'core/store'));
  const ex = store.readJson(id, '01_Project/extraction.json', null);
  assert.ok(ex, '읽은 기록이 아예 없다');
  assert.ok((ex.documents || []).length > 0,
    '폴더에 자료가 있는데 문서 0건이다 — 빈 목록이 그대로 넘어갔다');
});

/** ★ 빈 배열을 준 것은 **부른 쪽의 실수일 수 있다.** 조용히 넘어가지 않는다 */
test('★★ 빈 목록이 오면 그 사실을 말한다', async () => {
  handlers();
  const id = await project();
  const store = require(path.join(ROOT, 'core/store'));
  const dir = path.join(store.projectDir(id), '02_Source_Data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '사업계획서.md'), '- 연면적 : 52,822㎡\n', 'utf8');

  const said = [];
  const pipeline = require(path.join(ROOT, 'pipeline.js'));
  await pipeline.extractInto(id, [], { log: (m) => said.push(String(m)) });
  assert.ok(said.some((m) => /빈 목록/.test(m)),
    '빈 목록이 온 것을 안 말한다 — 「0건인데 값이 나왔다」로 보여 더 헷갈린다');
});
