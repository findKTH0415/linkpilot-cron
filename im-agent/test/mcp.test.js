'use strict';
/* mcp.test.js — LinkPilot 을 **내보내는** MCP 서버 (D-83)

   여기서 지키는 것은 셋이다.
   ① **쓰기가 새지 않는가** — 도구 표가 읽기 라우트 위에만 서 있는지 실제로 대조한다.
      손으로 옮겨 적으면 라우트가 늘어난 날 조용히 쓰기가 섞인다 (`routes.cjs` 머리말).
   ② **출처가 따라오는가** — 숫자만 나가면 §4.7 이 통째로 무너진다.
   ③ **stdout 에 사람 말이 안 섞이는가** — 섞이면 증상은 「서버가 안 뜬다」로만 보인다. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tools = require('../mcp/tools.js');
const { createServer, PROTOCOL, DEFAULT_PROTOCOL } = require('../mcp/server.js');
const api = require('../ui/api-router.cjs');
const write = require('../ui/report-api.cjs');

const SERVER = path.join(__dirname, '..', 'mcp', 'server.js');
const ID = 'LP-DC-2026-001';

/** 합성 프로젝트 하나. 실제 딜 자료는 이 저장소에 없다 (public 이다) */
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  fs.mkdirSync(path.join(root, ID, '01_Project'), { recursive: true });
  fs.writeFileSync(path.join(root, ID, '01_Project', 'project.json'), JSON.stringify({
    name: '합성 예시 데이터센터', assetType: 'datacenter', status: 'draft', externalId: 'DEAL-77',
  }));
  fs.writeFileSync(path.join(root, ID, '01_Project', 'dataset.json'), JSON.stringify({
    facts: {
      'property.site_area': {
        value: 12345, unit: '㎡', source: '사업계획서.pdf', sourceDate: '2026-03-01',
        page: 12, confidence: 0.8, verified: true, corroboration: 2,
      },
    },
    candidates: {
      'property.site_area': [
        { value: 12345, source: '사업계획서.pdf', page: 12, sourceDate: '2026-03-01', quote: '대지면적 12,345㎡' },
        { value: 12300, source: '토지대장.pdf', page: 1, sourceDate: '2026-02-10', quote: '대지면적 12,300㎡' },
      ],
    },
  }));
  return root;
}

const call = (s, name, args) => s.handle({
  jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} },
});

/* ───────────── ① 쓰기가 새지 않는가 ───────────── */

test('★ 도구는 전부 읽기(GET) 라우트 위에 선다 — 표를 베껴 적지 않는다', () => {
  assert.ok(tools.TOOLS.length > 0, '도구가 하나도 없다');
  tools.TOOLS.forEach((t) => {
    const route = tools.backingRoute(t.name);
    assert.ok(route, `${t.name} 의 핸들러 ${t.handler} 가 읽기 라우트 표에 없다`);
    assert.equal(route.method, 'GET', `${t.name} 이 ${route.method} 라우트를 물고 있다 — 읽기 전용이 깨졌다`);
  });
});

test('★ 쓰기 라우트(report-api)의 핸들러는 하나도 노출되지 않는다', () => {
  const writeHandlers = new Set(write.ROUTES.map(r => r.handler));
  tools.TOOLS.forEach((t) => {
    assert.ok(!writeHandlers.has(t.handler),
      `${t.name} 이 쓰기 핸들러 ${t.handler} 를 부른다 — 대화가 남의 프로젝트를 고치게 된다`);
  });
});

test('★ 읽기 라우트가 늘면 도구를 붙일지 정해야 한다 (개수를 고정한다)', () => {
  // 이 숫자가 틀리면 라우트가 늘었거나 줄었다는 뜻이다. 그때 **고르고** 이 값을 고친다.
  // 자동으로 따라가게 두면 새 읽기 라우트가 검토 없이 대화에 열린다
  assert.equal(api.ROUTES.length, 6, '읽기 라우트 수가 바뀌었다 — 새 라우트를 도구로 열지 정하라');
});

test('모든 도구가 readOnlyHint 를 달고 나간다', () => {
  tools.listForMcp().forEach((t) => {
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} 에 읽기 표시가 없다`);
    assert.equal(t.annotations.destructiveHint, false);
    assert.ok(t.inputSchema && t.inputSchema.type === 'object', `${t.name} 의 inputSchema 가 없다`);
  });
});

/* ───────────── ② 출처가 따라오는가 ───────────── */

test('★ 계보는 채택값과 **탈락한 후보를 함께** 낸다 — 이긴 값만 주면 충돌이 사라진다', async () => {
  const s = createServer({ agentRoot: makeRoot(), env: {} });
  const r = await call(s, 'linkpilot_lineage', { projectId: ID, key: 'property.site_area' });
  const text = r.result.content[0].text;

  assert.match(text, /12345/, '채택값이 없다');
  assert.match(text, /12300/, '탈락한 후보가 사라졌다 — 값이 갈리는 것을 못 보게 된다');
  assert.match(text, /후보\(탈락\)/);
});

test('★ 숫자에 출처가 따라붙는다 (§4.7) — 기관·기준시점·페이지', async () => {
  const s = createServer({ agentRoot: makeRoot(), env: {} });
  const r = await call(s, 'linkpilot_lineage', { projectId: ID, key: 'property.site_area' });
  const text = r.result.content[0].text;

  assert.match(text, /사업계획서\.pdf/, '출처 이름이 없다');
  assert.match(text, /2026-03-01/, '기준시점이 없다');
  assert.match(text, /p\.12/, '페이지가 없다');
});

test('원본 JSON 이 같은 답 안에 함께 실린다 — 요약만 주면 출처가 문장 속으로 녹는다', async () => {
  const s = createServer({ agentRoot: makeRoot(), env: {} });
  const r = await call(s, 'linkpilot_lineage', { projectId: ID, key: 'property.site_area' });
  const text = r.result.content[0].text;
  const at = text.indexOf('```json');
  assert.ok(at > 0, '원본 블록이 없다');
  const raw = text.slice(at + 7, text.lastIndexOf('```'));
  assert.doesNotThrow(() => JSON.parse(raw), '원본 블록이 JSON 이 아니다');
});

test('원본이 너무 크면 **잘랐다고 적는다** — 조용히 자르면 그만큼이 전부로 읽힌다', async () => {
  const s = createServer({ agentRoot: makeRoot(), env: {} });
  // 사전 전체는 상한보다 크다. query 없이 부르면 요약만 나오므로 넓은 query 로 부른다
  const r = await call(s, 'linkpilot_fields', { query: '' });
  const text = r.result.content[0].text;
  if (text.includes('잘랐습니다')) {
    assert.match(text, /좁혀서 다시 부르십시오/);
  } else {
    assert.ok(text.length < tools.MAX_JSON_CHARS * 2, '상한을 넘겼는데 아무 말이 없다');
  }
});

/* ───────────── 실패를 격리한다 ───────────── */

test('실행 기록이 없는 프로젝트는 「0%」가 아니라 사유를 낸다', async () => {
  const s = createServer({ agentRoot: makeRoot(), env: {} });
  const r = await call(s, 'linkpilot_progress', { projectId: ID });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /실행 기록이 없는/);
});

test('모르는 도구·잘못된 ID 는 예외가 아니라 사유로 돌아온다 (대화를 끊지 않는다)', async () => {
  const s = createServer({ agentRoot: makeRoot(), env: {} });
  const a = await call(s, 'linkpilot_없는도구', {});
  assert.equal(a.result.isError, true);
  const b = await call(s, 'linkpilot_lineage', { projectId: '../etc', key: 'a.b' });
  assert.equal(b.result.isError, true);
  assert.match(b.result.content[0].text, /잘못된 프로젝트 ID/);
});

test('★ LINKPILOT_MCP_PROJECTS 를 주면 그 밖은 목록에도 안 뜨고 열리지도 않는다', async () => {
  const root = makeRoot();
  const s = createServer({ agentRoot: root, env: { LINKPILOT_MCP_PROJECTS: 'LP-DC-2026-999' } });

  const list = await call(s, 'linkpilot_projects', {});
  assert.ok(!list.result.content[0].text.includes(ID), '좁혔는데 목록에 남았다');

  const one = await call(s, 'linkpilot_lineage', { projectId: ID, key: 'property.site_area' });
  assert.equal(one.result.isError, true, '좁혔는데 열렸다');
});

test('안 주면 제한하지 않는다 (표준입출력이라 부를 수 있는 사람이 이미 디스크를 읽는다)', () => {
  assert.equal(tools.allowedProjects({}), null);
  assert.equal(tools.allowedProjects({ LINKPILOT_MCP_PROJECTS: '  ' }), null);
  assert.deepEqual(tools.allowedProjects({ LINKPILOT_MCP_PROJECTS: 'A, B ' }), ['A', 'B']);
});

/* ───────────── 규약 ───────────── */

test('initialize 는 상대가 말한 판을 되돌려주고, 모르는 판이면 우리 판을 말한다', async () => {
  const s = createServer({ agentRoot: makeRoot(), env: {} });
  const known = await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL[1] } });
  assert.equal(known.result.protocolVersion, PROTOCOL[1]);

  const odd = await s.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(odd.result.protocolVersion, DEFAULT_PROTOCOL);
  assert.equal(odd.result.capabilities.tools.listChanged, false);
});

test('알림(id 없음)에는 답하지 않는다 — 답하면 규약 위반이다', async () => {
  const s = createServer({ agentRoot: makeRoot(), env: {} });
  assert.equal(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await s.handle({ jsonrpc: '2.0', method: '모르는알림' }), null);
});

test('모르는 method 는 -32601 로 답한다 (조용한 빈 값을 주지 않는다)', async () => {
  const s = createServer({ agentRoot: makeRoot(), env: {} });
  const r = await s.handle({ jsonrpc: '2.0', id: 9, method: 'resources/list' });
  assert.equal(r.error.code, -32601);
});

test('안내문이 「출처를 함께 옮기라」고 적는다 — 이 서버의 존재 이유다', async () => {
  const s = createServer({ agentRoot: makeRoot(), env: {} });
  const r = await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.match(r.result.instructions, /출처/);
});

/* ───────────── ③ stdout 에 사람 말이 안 섞이는가 ───────────── */

test('★ 진짜 프로세스를 띄워 본다 — stdout 은 JSON 뿐이고 안내는 stderr 로 간다', async () => {
  const root = makeRoot();
  const child = spawn(process.execPath, [SERVER], {
    env: Object.assign({}, process.env, { IM_AGENT_ROOT: root }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'linkpilot_projects', arguments: {} },
  }) + '\n');
  child.stdin.end();

  await new Promise((res) => child.on('close', res));

  const lines = out.split('\n').filter(Boolean);
  assert.equal(lines.length, 3, `stdout 줄 수가 3이 아니다 (알림에 답했거나 사람 말이 섞였다)\n${out}`);
  lines.forEach(l => assert.doesNotThrow(() => JSON.parse(l), `stdout 에 JSON 이 아닌 줄이 있다: ${l}`));

  const listed = JSON.parse(lines[1]);
  assert.equal(listed.result.tools.length, tools.TOOLS.length);

  const called = JSON.parse(lines[2]);
  assert.match(called.result.content[0].text, /합성 예시 데이터센터/);

  assert.match(err, /읽기 전용/, '안내가 stderr 로 안 갔다');
  assert.match(err, /포트 안 엽니다/);
});

test('읽을 수 없는 JSON 한 줄에 서버가 죽지 않는다', async () => {
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => { out += d; });
  child.stdin.write('이건 JSON 이 아니다\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }) + '\n');
  child.stdin.end();
  await new Promise(res => child.on('close', res));

  const lines = out.split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(lines[0].error.code, -32700);
  assert.deepEqual(lines[1], { jsonrpc: '2.0', id: 7, result: {} });
});
