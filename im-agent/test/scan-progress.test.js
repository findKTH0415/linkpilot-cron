/**
 * **「몇 개 중 몇 개」를 실제로 흘리는가** 〈2026-08-24 사장님: 「서버가 읽고,
 * 스캔하는데 너무 오래걸림 / 그런데 결국 읽은 값은 0」〉.
 *
 * ★★★ 경위. 스캔은 요청 하나로 돌고 **다 읽어야 답한다.** 그동안 화면이 아는
 *   것은 「몇 초 지났나」뿐이라, 진행률을 **걸린 시간으로 어림**하고 있었다.
 *   자료가 30개든 1개든 같은 속도로 차올랐고, 다 읽고 값이 0 이면 **어디서
 *   0 이 됐는지** 알 길이 없었다.
 *
 * ★★ **배선 함정.** 처음에는 화면 서버가 진행을 적게 하려 했다. 그런데 읽는
 *   함수는 본체가 배선하고, 그 배선은 「인자 둘을 받아 그대로 넘기는 한 줄」이라
 *   **셋째 인자를 조용히 버린다.** 그러면 진행이 한 줄도 안 적히는데 화면은
 *   아무 말도 안 한다. 그래서 **읽는 쪽이 직접 적는다** — 여기서 그것을 잰다.
 *
 * ★ 여기서 재는 것:
 *   ① **본체 배선이 인자 둘짜리여도** 진행이 적히는가 ← 이것이 핵심이다
 *   ② 분모가 **읽기 전에** 서는가 (나중에 세면 못 읽은 파일이 빠진다)
 *   ③ 끝났다는 사실이 적히는가 (안 적으면 화면이 영원히 돈다)
 *   ④ 안 돌린 프로젝트에 0% 로 답하지 않는가 (모르는 것과 다르다)
 *   ⑤ 화면이 **센 수와 어림을 섞지 않는가**
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const api = require(path.join(ROOT, 'ui/report-api.cjs'));

function handlers() {
  const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-prog-'));
  process.env.IM_AGENT_ROOT = agentRoot;
  process.env.IM_AGENT_OFFLINE = '1';
  const pipeline = require(path.join(ROOT, 'pipeline.js'));
  const h = api.createHandlers({
    agentRoot,
    agentModulePath: ROOT,
    authenticate: () => ({ name: '검증', planId: 'pro', status: 'active' }),
    /* ★★★ **본체가 실제로 쓰는 배선 그대로다** — 인자 둘. 셋째를 조용히 버린다.
     *   여기를 셋으로 고치면 이 검사는 **재려는 것을 안 재게 된다** */
    extractFiles: (id, files) => pipeline.extractInto(id, files, { log: () => {} }),
  });
  return { h, agentRoot };
}

/** 값이 실제로 나오는 자료 두 건을 넣는다 */
function seed(agentRoot, id) {
  const store = require(path.join(ROOT, 'core/store'));
  const dir = path.join(store.projectDir(id), '02_Source_Data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '사업계획서.txt'),
    '사업명: 인천 남동 데이터센터\n대지면적: 12,000 m2\n연면적: 52,822 m2\n', 'utf8');
  fs.writeFileSync(path.join(dir, '자금계획.txt'),
    '총사업비: 3,200 억원\n자기자본: 800 억원\n', 'utf8');
}

async function project(h) {
  const store = require(path.join(ROOT, 'core/store'));
  const id = store.nextProjectId('datacenter');
  store.createProjectDirs(id);
  return id;
}

test('★★★ 인자 둘짜리 배선에서도 진행이 적힌다 — 여기가 조용히 빠지던 자리다', async () => {
  const { h, agentRoot } = handlers();
  const id = await project(h);
  seed(agentRoot, id);

  const r = await h.scanSources({}, id, {});
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));

  const p = await h.scanProgress({}, id);
  assert.strictEqual(p.status, 200);
  const v = p.body;
  assert.strictEqual(v.known, true, '진행이 한 줄도 안 적혔다 — 셋째 인자가 버려졌다');
  assert.strictEqual(v.total, 2, `분모가 ${v.total} 이다 — 넣은 자료는 2건이다`);
  assert.strictEqual(v.done, 2, '읽은 수가 안 맞는다');
  assert.strictEqual(v.pct, 100);
  assert.ok(v.facts > 0, '값을 하나도 못 셌다');
});

test('★★★ 끝났다는 사실을 적는다 — 안 적으면 화면이 영원히 돈다', async () => {
  const { h, agentRoot } = handlers();
  const id = await project(h);
  seed(agentRoot, id);
  await h.scanSources({}, id, {});
  const v = (await h.scanProgress({}, id)).body;
  assert.strictEqual(v.running, false);
  assert.strictEqual(v.finished, true);
});

test('★★★ 안 돌린 프로젝트에 0% 로 답하지 않는다 — 「모른다」와 다르다', async () => {
  const { h } = handlers();
  const id = await project(h);
  const v = (await h.scanProgress({}, id)).body;
  assert.strictEqual(v.known, false, '한 번도 안 돌렸는데 아는 척한다');
  assert.strictEqual(v.pct, undefined, '0% 로 답하면 「돌고 있는데 안 는다」로 읽힌다');
});

test('★★ 없는 프로젝트는 404 다', async () => {
  const { h } = handlers();
  const r = await h.scanProgress({}, 'LP-DC-2026-999');
  assert.strictEqual(r.status, 404);
});

test('★★ 파일마다 결과를 적는다 — 못 읽은 것도 한 줄로 선다', async () => {
  const { h, agentRoot } = handlers();
  const id = await project(h);
  seed(agentRoot, id);
  // 못 읽는 형식 하나를 더 넣는다
  const store = require(path.join(ROOT, 'core/store'));
  fs.writeFileSync(path.join(store.projectDir(id), '02_Source_Data', '옛문서.gif'), 'x');

  await h.scanSources({}, id, {});
  const v = (await h.scanProgress({}, id)).body;
  assert.strictEqual(v.total, 3);
  assert.strictEqual(v.done, 3, '못 읽은 파일이 분모에서만 빠지면 100% 가 안 된다');
  assert.ok(v.failed >= 1, '못 읽은 것을 안 셌다');
  const bad = v.rows.filter((x) => !x.ok);
  assert.ok(bad.length && bad[0].why, '왜 못 읽었는지 안 적혀 있다');
});

/* ── 화면 ─────────────────────────────────────────────── */

const SCREEN = fs.readFileSync(path.join(ROOT, 'ui/platform/files.html'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('★★★ 화면이 **센 수와 어림을 섞지 않는다**', () => {
  assert.ok(/scan\/progress/.test(SCREEN), '진행을 물어보지 않는다 — 어림 그대로다');
  assert.ok(/var counted = !!\(pg && pg\.total > 0/.test(SCREEN),
    '센 수가 있는지 가르지 않는다');
  assert.ok(/if \(sc\.busy && counted\) \{/.test(SCREEN),
    '센 수가 있어도 어림을 그린다 — 화면이 두 수를 말하게 된다');
  assert.ok(/\*\*센 수입니다\*\*/.test(SCREEN), '어느 쪽인지 사람에게 안 밝힌다');
});

test('★★ 겹쳐 묻지 않는다 — 느린 서버에 물음만 쌓이면 더 느려진다', () => {
  assert.ok(/if \(!sc \|\| !sc\.busy \|\| sc\.asking\) return;/.test(SCREEN),
    '앞의 물음이 안 왔는데 또 묻는다');
  assert.ok(/cur\.asking = false/.test(SCREEN) && /state\.scan\.asking = false/.test(SCREEN),
    '물음이 끝났다고 안 적으면 한 번 묻고 만다 — 성공·실패 양쪽에서 풀어야 한다');
});

test('★★ 못 물어본 것을 실패로 그리지 않는다', () => {
  const at = SCREEN.indexOf('function askProgress');
  const fn = SCREEN.slice(at, at + 900);
  assert.ok(/\}, function \(\) \{\s*if \(state\.scan\) state\.scan\.asking = false;/.test(fn),
    '물음이 실패하면 스캔까지 고장으로 그린다');
  assert.ok(!/dead = true/.test(fn), '진행을 못 물어본 것과 스캔이 죽은 것은 다른 사실이다');
});
