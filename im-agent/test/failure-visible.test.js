/**
 * **실패한 까닭이 사람에게 닿는가.**
 *
 * ★★★ 2026-08-24 사장님 화면: 47% 에서 「생성 중 문제가 생겼습니다」 한 줄.
 *   그 밑에 있던 것은 경고 몇 줄뿐이었고, **무엇이 왜 멈췄는지가 없었다.**
 *   사진 두 장을 받고도 원인을 못 찾은 이유가 그것이다.
 *
 *   ★ 값이 없어서 못 본 것이 아니다. monitor 는 Agent 마다 error 를 들고 있었고
 *     화면이 **안 꺼내 썼을** 뿐이다. 조용히 죽는 것과 결과가 같다 (§2).
 *
 * ★ 여기서 재는 것:
 *   ① 실패한 Agent 의 까닭이 **활동 기록(jsonl)**에 남는가
 *   ② 화면이 **어느 단계**에서 멈췄는지 말하는가 (Agent 이름이 아니라)
 *   ③ 까닭이 비어 있으면 **비었다고** 말하는가
 *   ④ 멈춘 곳이 없으면 예전처럼 조용한가 (헛울음을 안 낸다)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const L = require('../ui/platform/live-core.js');

/* ── ② ③ ④ 화면이 말하는가 ─────────────────────────────── */

function snapWith(agents, extra) {
  return Object.assign({
    overall: 47, agents: agents, activity: [], timing: {}, currentAgent: null,
  }, extra || {});
}

test('★★★ 실패하면 **어느 단계**에서 멈췄는지와 까닭을 말한다', () => {
  const v = L.viewFrom({
    snapshot: snapWith([
      { id: '10_output_spec', status: 'COMPLETED' },
      { id: '01_project', status: 'COMPLETED' },
      { id: '02_extraction', status: 'WARNING' },
      { id: '04_financial', status: 'ERROR', error: 'IRR 역산 실패: 현금흐름 부호가 한 번도 안 바뀐다' },
    ]),
  });
  assert.strictEqual(v.state, 'failed');
  assert.strictEqual(v.stopped.length, 1, '멈춘 곳을 안 모았다');
  assert.strictEqual(v.stopped[0].phase, '계산·검토');
  assert.ok(v.note.indexOf('계산·검토') !== -1, `단계 이름이 없다: ${v.note}`);
  assert.ok(v.note.indexOf('IRR 역산 실패') !== -1, `까닭이 없다: ${v.note}`);
  assert.ok(v.note.indexOf('04_financial') === -1,
    'Agent 이름을 그대로 보여 준다 — 사용자는 그것이 무엇인지 모른다');
});

test('★★★ 까닭이 비어 있으면 **비었다고** 말한다 — 침묵하지 않는다', () => {
  const v = L.viewFrom({
    snapshot: snapWith([{ id: '06_im_writer', status: 'ERROR', error: null }]),
  });
  assert.ok(v.note.indexOf('문서 만들기') !== -1, v.note);
  assert.ok(v.note.indexOf('까닭이 기록되지 않았습니다') !== -1, v.note);
});

test('★★ 멈춘 곳이 둘이면 첫 줄은 머리말 밑, 나머지는 아래에 — 같은 줄을 두 번 안 적는다', () => {
  const v = L.viewFrom({
    snapshot: snapWith([
      { id: '04_financial', status: 'ERROR', error: '가' },
      { id: '06_im_writer', status: 'ERROR', error: '나' },
    ]),
  });
  assert.strictEqual(v.stopped.length, 2);
  assert.ok(v.note.indexOf('가') !== -1);
  assert.strictEqual(v.problems.filter((p) => p.indexOf('계산·검토 에서 멈췄습니다') !== -1).length, 0,
    '첫 줄이 두 곳에 적혔다');
  assert.ok(v.problems.some((p) => p.indexOf('문서 만들기 에서 멈췄습니다') !== -1),
    '둘째 까닭이 어디에도 없다');
});

test('★★ 멀쩡히 도는 중에는 아무 말도 덧붙이지 않는다 (헛울음 금지)', () => {
  const v = L.viewFrom({
    snapshot: snapWith([{ id: '02_extraction', status: 'RUNNING' }]),
  });
  assert.strictEqual(v.state, 'running');
  assert.deepStrictEqual(v.stopped, []);
  assert.strictEqual(v.note, '올린 파일에서 값을 뽑습니다 (스캔본은 글자로 옮겨서)');
});

test('★ 실행 기록이 없을 때도 stopped 자리가 있다 — 화면이 undefined 를 만지지 않게', () => {
  const v = L.viewFrom({ snapshot: null, run: null });
  assert.deepStrictEqual(v.stopped, []);
});

/* ── ① 활동 기록에 남는가 ────────────────────────────────── */

const { runAgent } = require('../core/runtime.js');
const monitor = require('../core/monitor.js');
const store = require('../core/store.js');

test('★★★ Agent 가 죽으면 그 까닭이 **활동 기록에 한 줄로** 남는다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-fail-'));
  const before = process.env.IM_AGENT_ROOT;
  process.env.IM_AGENT_ROOT = root;
  try {
    const pid = 'LP-TEST-0001';
    fs.mkdirSync(path.join(root, pid, '01_Project'), { recursive: true });
    monitor.start(pid);
    /* 입력 스키마를 일부러 어겨 ERROR 를 만든다 — 던지는 것보다 이 길이 흔하다 */
    const r = await runAgent('06_im_writer', {}, { projectId: pid, dataset: null, log: () => {} });
    assert.strictEqual(r.status, 'error');

    const lines = monitor.readActivity(pid, { limit: 50 });
    const err = lines.filter((l) => l.level === 'ERROR');
    assert.ok(err.length >= 1,
      '까닭이 활동 기록에 없다 — 화면은 「문제가 생겼습니다」만 보여 주게 된다');
    assert.strictEqual(err[0].agent, '06_im_writer');
    assert.ok(err[0].message.indexOf('실패') === 0, err[0].message);
  } finally {
    if (before === undefined) delete process.env.IM_AGENT_ROOT;
    else process.env.IM_AGENT_ROOT = before;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── 화면이 그것을 실제로 그리는가 ───────────────────────── */

test('★★ 보고서 화면이 멈춘 까닭을 **눈에 띄게** 그린다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'ui', 'platform', 'reports.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(src.indexOf('v.stopped && v.stopped.length') !== -1,
    '멈춤 여부를 안 본다 — 까닭이 회색 안내문으로 묻힌다');
});
