'use strict';
/**
 * agent-merge.test.js — 병합 절차가 **한 벌뿐인지** 지킨다.
 *
 * 이 저장소가 반복해서 겪은 사고는 「같은 절차를 두 곳이 갖고 있다가 한쪽만
 * 고쳐진 것」이다 (D-68 추출 경로 · workorder 14 대 16). 그래서 검사가
 * **pipeline.js 안에 병합 코드가 다시 생기는 것**을 막는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'im-merge-'));
process.env.IM_AGENT_ROOT = ROOT;
process.env.IM_AGENT_OFFLINE = '1';

const agentMerge = require('../core/agent-merge');
const store = require('../core/store');
const { Dataset } = require('../core/facts');
const { FIELDS } = require('../core/dictionary');

const PIPELINE = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');

test('★ pipeline.js 는 병합 절차를 다시 갖지 않는다 — agent-merge 가 단일 출처다', () => {
  // dropSource 를 직접 부르는 자리는 **추출(mergeExtraction)과 재무 계산값 정리**뿐이어야 한다.
  // 여기가 늘어나면 두 벌이 된 것이다.
  //   유일한 예외는 추출(mergeExtraction)이다 — 그쪽은 D-68 에서 이미 한 벌로 모았고
  //   문서 이름이 인자라 표로 적을 수 없다.
  const calls = PIPELINE.split('\n')
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter(x => x.line.includes('dataset.dropSource('))
    .filter(x => !x.line.includes('doc.name'));
  assert.strictEqual(calls.length, 0,
    `pipeline.js 에 병합 코드가 ${calls.length}곳 다시 생겼다 — agent-merge 로 옮긴다:\n`
    + calls.map(c => `  ${c.no}: ${c.line}`).join('\n'));
});

test('다섯 Agent 의 병합은 agent-merge 를 탄다', () => {
  for (const id of ['07_geo', '04_financial', '08_appraisal', '09_massing', '03_research']) {
    assert.ok(PIPELINE.includes(`agentMerge.apply(projectId, '${id}'`), `${id} 가 agent-merge 를 안 쓴다`);
    assert.ok(agentMerge.mutatesDataset(id), `${id} 가 표에 없다`);
  }
});

test('버릴 출처 이름이 비어 있지 않다 — 비면 옛 값이 남아 자기 자신과 충돌한다', () => {
  for (const [id, spec] of Object.entries(agentMerge.MERGE)) {
    assert.ok(Array.isArray(spec.drop) && spec.drop.length > 0, `${id} 의 drop 이 비었다`);
    assert.ok(spec.write && spec.write.includes('/'), `${id} 의 write 경로가 이상하다`);
  }
});

test('apply() 는 옛 값을 버리고 새 값을 넣는다', () => {
  const pid = 'LP-DC-2026-901';
  store.createProjectDirs(pid);
  const ds = new Dataset(pid, FIELDS);

  const fact = (value) => ({
    key: 'investment.total', value, unit: '억원',
    source: '매스 검토 Agent (09_massing)', sourceDate: '2026-08-25', confidence: 0.9,
  });

  agentMerge.apply(pid, '09_massing', { facts: [fact(100)] }, ds);
  assert.strictEqual(ds.get('investment.total').value, 100);

  // 같은 출처로 다시 — 옛 값이 남으면 후보가 둘이 되어 충돌로 잡힌다
  agentMerge.apply(pid, '09_massing', { facts: [fact(200)] }, ds);
  assert.strictEqual(ds.get('investment.total').value, 200, '새 값으로 갈리지 않았다');
  const candidates = ds.toJSON().candidates['investment.total'] || [];
  assert.strictEqual(candidates.length, 1, `옛 값이 남았다 (후보 ${candidates.length}건)`);
});

test('output 이 없으면 아무것도 하지 않는다 — 빈 파일을 만들지 않는다', () => {
  const pid = 'LP-DC-2026-902';
  store.createProjectDirs(pid);
  const r = agentMerge.apply(pid, '07_geo', null, new Dataset(pid, FIELDS));
  assert.strictEqual(r.wrote, null);
  assert.ok(!fs.existsSync(path.join(store.projectDir(pid), '04_Property/geo.json')));
});

test('모르는 Agent 는 조용히 넘기지 않고 던진다', () => {
  assert.throws(() => agentMerge.apply('X', '99_nope', {}, null), /agent-merge 에 없는/);
});
