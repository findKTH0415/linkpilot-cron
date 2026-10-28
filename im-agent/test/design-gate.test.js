'use strict';
/**
 * design-gate — **디자인 게이트 7단계** (지시서 §8.4 · 감사 H-4 · 2026-08-26 사장님 지시)
 *
 * ★★★ 이 검사가 지키는 것은 셋이다.
 *   ① **한 칸씩만 간다** — 건너뛸 수 있으면 게이트는 장식이다
 *   ② **기계가 스스로 승인하지 못한다** — 기계가 승인하면 그것은 승인이 아니다
 *   ③ **뒤로 갈 수 있다** — 앞으로만 가는 게이트는 한 번 틀리면 끝까지 거짓말한다
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const gate = require('../core/design-gate.js');

/* ───────────── 일곱이 지시서와 같은가 ───────────── */

test('★★ 일곱 칸이 지시서 §8.4 와 **글자까지** 같다', () => {
  // 코드와 문서가 갈리면 「어느 쪽이 맞는가」부터 다시 해야 한다 (CLAUDE.md §9)
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', '디자인-Agent-지시서.md'), 'utf8');
  const block = doc.slice(doc.indexOf('### 8.4'), doc.indexOf('### 8.4') + 400);
  for (const id of gate.IDS) {
    assert.ok(block.includes(id), `지시서 §8.4 에 ${id} 가 없다 — 코드가 앞서갔다`);
  }
  assert.strictEqual(gate.IDS.length, 7);
  assert.strictEqual(gate.IDS[0], 'DESIGN_BRIEF');
  assert.strictEqual(gate.IDS[6], 'READY_TO_DEPLOY');
});

test('★ 칸마다 「무엇이 참이면 넘어가는가」가 적혀 있다', () => {
  for (const s of gate.STAGES) {
    assert.ok(s.needs && s.needs.length > 5, `${s.id} 에 넘어갈 조건이 없다`);
    assert.ok(['agent', 'human'].includes(s.by), `${s.id} 의 넘기는 주체가 이상하다`);
  }
});

/* ───────────── ① 한 칸씩만 간다 ───────────── */

test('★★★ 건너뛰기를 막는다 — 막지 않으면 「기능은 됐으니 바로 배포」가 된다', () => {
  const r = gate.canMove('DESIGN_BRIEF', 'READY_TO_DEPLOY');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.kind, 'skip');
  assert.match(r.why, /5칸을 건너뛴다/);
  // 한 칸은 된다
  assert.strictEqual(gate.canMove('DESIGN_BRIEF', 'WIREFRAME_APPROVED').ok, true);
  // 시작 전에는 첫 칸만
  assert.strictEqual(gate.canMove(null, 'DESIGN_BRIEF').ok, true);
  assert.strictEqual(gate.canMove(null, 'DESIGN_READY').ok, false);
});

test('★★★ 뒤로는 갈 수 있다 — 앞으로만 가면 한 번 틀리고 끝까지 거짓말한다', () => {
  const r = gate.canMove('DESIGN_VERIFIED', 'DEVELOPING');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.kind, 'back');
});

test('★ 모르는 칸 이름은 거부한다 — 오타가 조용히 지나가면 안 된다', () => {
  const r = gate.canMove('DESIGN_BRIEF', 'DESIGN_DONE');
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /모르는 칸/);
});

/* ───────────── ② 기계가 승인하지 못한다 ───────────── */

test('★★★ 승인 칸 둘은 **사람만** 넘긴다', () => {
  assert.strictEqual(gate.canAgentEnter('WIREFRAME_APPROVED'), false, '뼈대 승인은 사람 몫이다');
  assert.strictEqual(gate.canAgentEnter('READY_TO_DEPLOY'), false, '내보내기는 사람이 정한다');
  // 나머지 다섯은 기계가 판정으로 넘긴다
  for (const id of ['DESIGN_BRIEF', 'DESIGN_READY', 'DEVELOPING', 'FUNCTION_VERIFIED', 'DESIGN_VERIFIED']) {
    assert.strictEqual(gate.canAgentEnter(id), true, `${id} 는 기계가 넘길 수 있어야 한다`);
  }
});

test('★★ 승인 칸의 수가 둘이다 (늘거나 줄면 알아야 한다)', () => {
  const human = gate.STAGES.filter((s) => s.by === 'human').map((s) => s.id);
  assert.deepStrictEqual(human, ['WIREFRAME_APPROVED', 'READY_TO_DEPLOY']);
});

/* ───────────── 실제로 걷는가 (임시 프로젝트) ───────────── */

const os = require('os');

test('★★★ 일곱을 순서대로 걷고, 마지막은 사람이 넘긴다', () => {
  /* ★★ **진짜 프로젝트 폴더에 쓰지 않는다.** 처음에 환경변수 이름을 틀려
   *   (`IM_AGENT_PROJECTS` ← 실제는 `IM_AGENT_ROOT`) `im-projects/` 안에
   *   시험용 프로젝트가 만들어졌고, 다음 판에서 **앞 판이 남긴 상태를 읽어**
   *   「새 프로젝트인데 이미 7/7」이 나왔다. 검사가 자기 쓰레기에 걸린 것이다. */
  const savedRoot = process.env.IM_AGENT_ROOT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-gate-proj-'));
  process.env.IM_AGENT_ROOT = dir;
  const g = gate;
  const P = 'LP-GATE-TEST';
  try {
    require('../core/store.js').createProjectDirs(P);

    assert.strictEqual(g.read(P).stage, null, '새 프로젝트는 아무 칸도 안 지났다');

    assert.strictEqual(g.move(P, 'DESIGN_BRIEF', { actor: 'agent' }).ok, true);

    // ★ 기계는 여기서 막힌다 — 이것이 이 게이트의 값이다
    const blocked = g.move(P, 'WIREFRAME_APPROVED', { actor: 'agent' });
    assert.strictEqual(blocked.ok, false);
    assert.match(blocked.why, /사람이 넘기는 칸/);
    assert.strictEqual(g.read(P).stage, 'DESIGN_BRIEF', '막혔는데 상태가 움직였다');

    // 사람이 넘긴다
    assert.strictEqual(g.move(P, 'WIREFRAME_APPROVED', { actor: '김대표' }).ok, true);
    for (const id of ['DESIGN_READY', 'DEVELOPING', 'FUNCTION_VERIFIED', 'DESIGN_VERIFIED']) {
      assert.strictEqual(g.move(P, id, { actor: 'agent' }).ok, true, `${id} 에서 막혔다`);
    }
    assert.strictEqual(g.readyToDeploy(P), false, '아직 배포 준비가 아니다');
    assert.strictEqual(g.move(P, 'READY_TO_DEPLOY', { actor: 'agent' }).ok, false);
    assert.strictEqual(g.move(P, 'READY_TO_DEPLOY', { actor: '김대표' }).ok, true);
    assert.strictEqual(g.readyToDeploy(P), true);

    // 이력이 남는다 — 되돌아볼 때 이것만 남는다
    const h = g.read(P).history;
    assert.strictEqual(h.length, 7);
    assert.strictEqual(h[1].by, '김대표', '누가 승인했는지가 안 남았다');
  } finally {
    if (savedRoot === undefined) delete process.env.IM_AGENT_ROOT;
    else process.env.IM_AGENT_ROOT = savedRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★★ 시험이 진짜 프로젝트 폴더에 쓰지 않는다 (자기 쓰레기에 걸리지 않게)', () => {
  const real = path.join(__dirname, '..', '..', 'im-projects', 'LP-GATE-TEST');
  assert.ok(!fs.existsSync(real),
    '시험용 프로젝트가 진짜 폴더에 남았다 — 다음 판이 앞 판의 상태를 읽는다');
});

/* ───────────── 배선 — 파이프라인이 실제로 돌리는가 ───────────── */

test('★★★ 파이프라인이 게이트를 **실제로 움직인다** — 만들어만 두면 장식이다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8')
    // 주석을 떼고 본다 (CLAUDE.md §8)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /require\('\.\/core\/design-gate'\)/, '파이프라인이 게이트를 안 부른다');
  for (const id of ['DESIGN_BRIEF', 'DESIGN_READY', 'DEVELOPING', 'FUNCTION_VERIFIED', 'DESIGN_VERIFIED']) {
    assert.ok(src.includes(id), `파이프라인이 ${id} 를 안 넘긴다`);
  }
});

test('★★★ 뼈대 승인을 **새로 만들지 않고 출력 사양 확정을 읽는다**', () => {
  // 승인 절차를 하나 더 만들면 사람이 두 번 승인해야 하고, 그러면 둘 중
  // 하나는 반드시 형식이 된다. 그리고 그 형식이 된 쪽이 게이트다.
  const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /outputspec\.read\(projectId\)/, '출력 사양을 안 읽는다');
  assert.match(src, /actor: lockedSpec\.confirmedBy/,
    '승인자를 사양을 잠근 사람으로 안 적으면, 기계가 스스로 승인한 것이 된다');
});

test('★★ 못 지난 것을 **말한다** — 조용히 건너뛰면 게이트가 장식이 된다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /못 지남/, '막힌 것을 로그에 안 적으면 아무도 모른다');
  assert.match(src, /WIREFRAME_APPROVED 대기/, '승인 대기라는 사실이 안 보인다');
});

/* ───────────── 시각은 한 곳에서 ───────────── */

test('★ 시각을 kstStamp() 한 곳에서만 만든다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'design-gate.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /kstStamp\(\)/);
  assert.ok(!/new Date\(|Date\.now\(\)/.test(src),
    '시각을 직접 만들면 서버 로컬타임에 기댄다 (CLAUDE.md §5)');
});
