'use strict';
/* mcp-servers.test.js — **MCP 등록부가 규칙을 지키는가** (D-83).

   MCP 서버는 붙이기가 너무 쉽다 — 설정 네 줄이면 대화가 그 도구를 부른다.
   그래서 「붙였는데 아무도 분류 안 한 서버」가 생기기 쉽고, 그 상태에서
   출처 없는 값 하나가 IM 에 들어가면 **문서만 봐서는 안 잡힌다.**

   여기서 고정하는 것 넷:
   ① 값을 바로 주는 MCP 를 값으로 쓰지 않는다
   ② 막아 뒀으면 무엇 때문에 막혔는지 적혀 있다
   ③ 짝지은 Agent id 가 실제로 있는 id 다 (베껴 적기 방지)
   ④ 붙어 있는 서버가 등록부에 빠지지 않는다 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const S = require('../mcp/servers.js');
const registry = require('../core/registry');

test('★ 등록부가 스스로 규칙을 통과한다', () => {
  assert.deepStrictEqual(S.check(), [], '등록부 위반이 있다');
});

test('★ 값을 바로 주는 MCP 는 하나도 값 등급이 아니다 (D-83)', () => {
  const leaked = S.SERVERS.filter(s => s.lane === S.LANE.IN_VALUES && s.grade === S.GRADE.VALUE);
  assert.deepStrictEqual(leaked.map(s => s.id), [],
    '값을 바로 주는 MCP 가 값으로 쓰이고 있다 — 기관·기준시점·모수가 문장 속으로 녹는다');
});

test('★ 막아 둔 서버는 전부 미결정 번호를 달고 있다', () => {
  S.SERVERS.filter(s => s.grade === S.GRADE.BLOCKED).forEach((s) => {
    assert.match(String(s.blockedBy), /^D-\d+$/, `${s.id} 에 미결정 번호가 없다`);
  });
});

test('막아 둔 사유가 등록부(docs)에 실제로 있는 항목을 가리킨다', () => {
  const reg = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', '미결정-사항.md'), 'utf8');
  S.SERVERS.filter(s => s.blockedBy).forEach((s) => {
    // ★ 번호만 맞추지 않고 **머리말로** 찾는다 — 본문에 스친 번호는 그 항목이 아니다
    const head = new RegExp(`^### .*\\s${s.blockedBy}\\.`, 'm');
    assert.match(reg, head, `${s.id} 이 가리키는 ${s.blockedBy} 가 등록부에 없다`);
  });
});

test('★ 짝지은 Agent id 는 registry.js 에 실제로 있다 — 손으로 옮겨 적지 않는다', () => {
  const known = new Set(registry.list().map(a => a.id).concat(Object.keys(registry.PLANNED)));
  S.SERVERS.forEach(s => (s.agents || []).forEach((id) => {
    assert.ok(known.has(id), `${s.id} 이 모르는 Agent ${id} 를 가리킨다`);
  }));
});

/**
 * ★★ 배포 엔진은 Agent 13 · 커넥터 23 인데 이 갈래는 11 · 21 이다.
 *   그 차이를 **숫자로 박아 둔다** — 병합으로 수가 바뀌면 여기서 빨개지고,
 *   그때 MCP 짝을 다시 본다. 안 박아 두면 새 Agent 가 MCP 없이 조용히 늘어난다.
 */
test('★ 이 갈래의 Agent·커넥터 수를 고정한다 (배포 엔진과의 차이를 잊지 않게)', () => {
  assert.strictEqual(registry.list().length, 11,
    'Agent 수가 바뀌었다 — mcp/servers.js 의 짝과 ENGINE 을 다시 보라');

  const dir = path.join(__dirname, '..', 'connectors');
  const infra = new Set(['cache.js', 'http.js', 'xml.js']);
  const n = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !infra.has(f)).length;
  assert.strictEqual(n, 21, '커넥터 수가 바뀌었다 — 새 커넥터가 MCP 로 들어온 것은 아닌지 보라');

  assert.strictEqual(S.ENGINE.agents, 13);
  assert.strictEqual(S.ENGINE.connectors, 23);
});

test('★ 아직 이 갈래에 없는 Agent 짝은 병합되는 순간 빨개진다', () => {
  const known = new Set(registry.list().map(a => a.id).concat(Object.keys(registry.PLANNED)));
  const pending = S.SERVERS.flatMap(s => s.agentsPending || []);
  assert.ok(pending.length > 0, 'SketchUp Agent 둘을 기다리는 표시가 사라졌다');
  pending.forEach((id) => {
    assert.ok(!known.has(id),
      `${id} 가 이 갈래에 들어왔다 — mcp/servers.js 에서 agentsPending → agents 로 옮겨라`);
  });
});

test('★ 이 세션에 붙은 서버가 등록부에 빠지지 않는다', () => {
  // 붙어 있는 것을 **손으로 세지 않는다** — 빠뜨린 것이 있으면 이 목록을 고치게 되고
  // 그 순간 「무엇이 붙어 있었나」가 기록으로 남는다
  const attached = [
    'Adobe_for_creativity', 'Box', 'Gmail', 'Google_Calendar', 'Google_Drive',
    'Mermaid_Chart', 'PlayMCP', 'Trimble_SketchUp', 'TomTom_Maps',
    'github', 'Claude_Code_Remote',
  ];
  const have = new Set(S.SERVERS.map(s => s.id));
  attached.forEach(id => assert.ok(have.has(id), `${id} 가 붙어 있는데 등록부에 없다`));
});

test('길은 넷뿐이고, 자료를 들여오는 길과 값을 들여오는 길이 갈려 있다', () => {
  assert.deepStrictEqual(Object.values(S.LANE).sort(), ['in.files', 'in.values', 'out', 'side']);
  const files = S.byLane()['in.files'];
  assert.ok(files.length >= 2, '자료를 들여오는 길이 비었다');
  files.forEach(s => assert.strictEqual(s.grade, S.GRADE.NONE,
    `${s.id}: 파일을 들여오는 길은 값 등급을 갖지 않는다 — 값은 02_extraction 이 만든다`));
});

test('사람이 손봐야 하는 것을 셀 수 있다', () => {
  const need = S.needsHuman().map(s => s.id);
  assert.ok(need.includes('TomTom_Maps'), '인증 대기가 안 잡힌다');
  assert.ok(need.includes('PlayMCP'), '막아 둔 것이 안 잡힌다');
});

test('Agent 하나에 붙은 서버를 물어볼 수 있다', () => {
  assert.deepStrictEqual(S.forAgent('02_extraction').map(s => s.id), ['Box', 'Google_Drive']);
  assert.deepStrictEqual(S.forAgent('없는에이전트'), []);
});
