'use strict';
/**
 * gpt-review.test.js — 업무지침 교차검증 (ChatGPT·Gemini) (D-428 · CLAUDE.md §18)
 *
 * 망 호출만 가짜로 끼우고 판정은 진짜를 돌린다 (§12-30). 갈래마다 하실 일이 다르므로
 * 「대답이 왔다」와 「판정이 왔다」·「열쇠 거부」와 「결제 한도」를 각각 잰다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'gpt-review.mjs');
const load = () => import(SCRIPT);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const okBody = (j) => ({ choices: [{ message: { content: JSON.stringify(j) } }] });
const KEY = 'sk-test-ABCDEFGHIJKLMNOPQRSTUVWX';

test('갈래 — 상태코드와 본문으로 하실 일을 가른다', async () => {
  const m = await load();
  assert.strictEqual(m.classify(undefined).code, 3);
  assert.strictEqual(m.classify(401, '').code, 4);
  assert.strictEqual(m.classify(429, '{"error":{"code":"insufficient_quota"}}').code, 5, '결제 한도는 기다려도 안 낫는다 — 3 으로 뭉개지 않는다');
  assert.strictEqual(m.classify(429, 'rate limit').code, 3, '잠깐 한도는 기다리면 낫는다 — 5 로 적지 않는다');
  assert.strictEqual(m.classify(404, 'The model `x` does not exist').code, 6);
  assert.strictEqual(m.classify(503, '').code, 3);
  assert.ok(!/열쇠를 다시/.test(m.classify(undefined).say), '못 닿음이 열쇠를 가리키면 안 된다 (M-86)');
});

test('검토 한 건 — 통과·거부·한도·모델·못 닿음·형식 아님', async () => {
  const m = await load();
  const base = { name: 'a.md', text: '지침', criteria: '', key: KEY, model: 'm' };
  let r = await m.reviewOne({ ...base, fetchImpl: async () => res(200, okBody({ verdict: 'PASS', summary: 's', issues: [] })) });
  assert.ok(r.ok && r.review.verdict === 'PASS');
  r = await m.reviewOne({ ...base, fetchImpl: async () => res(200, okBody({ verdict: 'PASS', summary: 's', issues: [{ severity: 'HIGH', problem: 'x' }] })) });
  assert.strictEqual(r.review.verdict, 'BLOCK', 'HIGH 가 있으면 반영 보류다 — 통과·보완 필요라 적어도 믿지 않는다');
  r = await m.reviewOne({ ...base, fetchImpl: async () => res(401, `Incorrect API key provided: ${KEY}`) });
  assert.strictEqual(r.code, 4);
  assert.ok(!r.detail.includes(KEY), '되비춘 열쇠를 가린다 (§2)');
  r = await m.reviewOne({ ...base, fetchImpl: async () => res(429, '{"error":{"code":"insufficient_quota"}}') });
  assert.strictEqual(r.code, 5);
  r = await m.reviewOne({ ...base, fetchImpl: async () => res(404, 'model_not_found: model does not exist') });
  assert.strictEqual(r.code, 6);
  r = await m.reviewOne({ ...base, fetchImpl: async () => { throw new Error('fetch failed'); } });
  assert.strictEqual(r.code, 3);
  r = await m.reviewOne({ ...base, fetchImpl: async () => res(200, okBody({ hello: 1 })) });
  assert.ok(!r.ok && r.kind === 'unparsed', '판정을 못 읽은 대답을 통과로 적지 않는다 (§8)');
});

test('공개 저장소 — 열쇠·전화번호가 든 지침은 보내지 않는다', async () => {
  const m = await load();
  assert.ok(m.leakCheck(`키는 ${KEY} 입니다`).length);
  assert.ok(m.leakCheck('연락 010-1234-5678').length);
  assert.strictEqual(m.leakCheck('평범한 지침입니다').length, 0, '멀쩡한 글은 안 막는다');
});

function tmpBox(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-'));
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(d, k), v);
  return d;
}
const run = (dir, args = [], env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GEMINI_|CLAUDE_|CLODE_|ANTHROPIC_)/.test(k))), GUIDE_DIR: dir, OPENAI_API_KEY: '', ...env },
});

test('현황표 — 지문이 같아야 «검토됨», 반영기록에 지문이 있어야 «반영 완료»', async () => {
  const m = await load();
  const text = '# 지침\n내용';
  const h = m.hashOf(text);
  const d = tmpBox({
    'a.md': text, 'b.md': '# 다른 지침',
    'a.gpt-review.md': `<!-- gpt-review: hash=${h} verdict=PASS model=m at=x -->\n`,
    'b.gpt-review.md': '<!-- gpt-review: hash=000000000000 verdict=PASS model=m at=x -->\n',
    '반영기록.md': `- a.md · ${h} · 2026-10-10\n`, 'README.md': '안내', '_검증기준.md': '기준',
  });
  const s = m.renderStatus(d, 'T');
  assert.match(s, /\| a\.md \| `[0-9a-f]{12}` \| 검토 대기 \| 통과 \| 검토 대기 \| 송부 대기 \| 반영 완료 \|/);
  assert.match(s, /\| b\.md \|[^\n]*옛 판을 검토함[^\n]*미반영 \|/, '옛 지문의 검토를 새 판에 이어 붙이지 않는다');
  assert.ok(!/README|_검증기준/.test(s.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| 지침')).join('\n')), '안내 파일을 지침으로 세지 않는다');
  assert.match(s, /미반영 1건/);
});

test('열쇠가 없으면 «판정 2» 로 빨갛게 끝나고, 검토할 것이 없으면 0 이다', () => {
  const d = tmpBox({ 'a.md': '# 지침' });
  const r = run(d);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout.split('\n')[0], /^판정 2/, '판정을 맨 앞에 적는다 (§6-3 ①)');
  assert.ok(fs.existsSync(path.join(d, '_검증현황.md')), '못 해도 현황표는 남긴다');
  const e = tmpBox({ 'README.md': '안내' });
  assert.strictEqual(run(e).status, 0);
  const leak = tmpBox({ 'a.md': `키 ${KEY}` });
  const rl = run(leak, [], { OPENAI_API_KEY: 'sk-real-should-not-be-used-000000' });
  assert.strictEqual(rl.status, 4, '열쇠 모양이 든 지침은 보내지 않고 4 로 끝낸다');
  assert.match(rl.stdout, /공개 저장소에 둘 수 없는 글/, '4 의 까닭이 «보내지 않았다»여야 한다 — 거부된 4 와 섞이면 안 된다');
  assert.ok(!rl.stdout.includes('sk-real-should-not-be-used'), '열쇠 값을 찍지 않는다');
});

test('워크플로 — 지침함이 바뀌면 돌고, 판정이 맨 끝이며, 열쇠는 비밀에서만 온다', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'guideline-review.yml'), 'utf8');
  assert.match(y, /docs\/지침함\/\*\*/);
  assert.match(y, /OPENAI_API_KEY:\s*\$\{\{\s*secrets\.OPENAI_API_KEY\s*\}\}/);
  const names = [...y.matchAll(/^\s*- name:\s*(.+)$/gm)].map((x) => x[1].trim());
  assert.strictEqual(names[names.length - 1], '판정', '판정이 맨 끝이 아니면 빨갈 때 받을 것이 안 남는다');
  assert.ok(fs.existsSync(path.join(ROOT, '.claude', 'commands', 'guideline-inbox.md')), 'Orchestrator 가 칠 명령이 있다');
});

/* 둘째 검증자 Gemini — D-430 */
const gBody = (j) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(j) }] } }] });
const GK = ['AIzaFAKEKEY_one_000000000000000', 'AIzaFAKEKEY_two_000000000000000'];

test('Gemini — 열쇠 묶음을 읽고, 거부·한도는 다음 열쇠로 · 모델 없음은 다음 모델로', async () => {
  const m = await load();
  assert.deepStrictEqual(m.geminiKeys({ GEMINI_API_KEY: GK[0], GEMINI_KEY_01: GK[1], GEMINI_KEY_02: GK[1], OTHER: 'x', GEMINI_API_KEY_3: '<빈칸>' }), GK, '중복·꺾쇠는 빼고, 이름 둘을 다 읽는다');
  const base = { name: 'a.md', text: '지침', criteria: '', keys: GK, models: ['m1', 'm2'] };
  const seen = [];
  let r = await m.reviewGemini({ ...base, fetchImpl: async (u, o) => { seen.push(u.split('/models/')[1].split(':')[0] + '/' + o.headers['x-goog-api-key'].slice(-18, -15)); return seen.length === 1 ? res(403, 'denied') : res(200, gBody({ verdict: 'REVISE', summary: 's', issues: [] })); } });
  assert.ok(r.ok && r.review.verdict === 'REVISE' && r.model === 'm1', JSON.stringify(r));
  assert.strictEqual(seen.length, 2, '거부되면 같은 모델의 다음 열쇠로 간다');
  seen.length = 0;
  r = await m.reviewGemini({ ...base, fetchImpl: async (u) => { seen.push(u); return /m1/.test(u) ? res(404, 'not found') : res(200, gBody({ verdict: 'PASS', summary: 's', issues: [] })); } });
  assert.ok(r.ok && r.model === 'm2');
  assert.strictEqual(seen.filter((u) => /m1/.test(u)).length, 1, '모델이 없으면 열쇠를 돌지 않고 다음 모델로 간다');
  r = await m.reviewGemini({ ...base, fetchImpl: async () => res(403, `bad key ${GK[0]}`) });
  assert.ok(!r.ok && !String(r.detail).includes(GK[0]), '되비춘 열쇠를 가린다 (§2)');
  r = await m.reviewGemini({ ...base, fetchImpl: async () => res(200, gBody({ hello: 1 })) });
  assert.ok(!r.ok && r.kind === 'unparsed', '판정을 못 읽은 대답을 통과로 적지 않는다');
});

test('Gemini 검토 파일 — 현황표의 Gemini 칸이 읽고, 지침으로 세지 않는다', async () => {
  const m = await load();
  const text = '# 지침'; const h = m.hashOf(text);
  const d = tmpBox({ 'a.md': text, 'a.gemini-review.md': `<!-- gemini-review: hash=${h} verdict=BLOCK model=g at=x -->\n` });
  const s = m.renderStatus(d, 'T');
  assert.match(s, /\| a\.md \| `[0-9a-f]{12}` \| 반영 보류 \| 검토 대기 \| 검토 대기 \| 송부 대기 \| 미반영 \|/);
  assert.match(s, /지침 1건/, 'gemini-review 파일을 지침으로 세지 않는다');
  const doc = m.renderReview('a.md', h, 'g', { verdict: 'PASS', summary: '', issues: [], conflicts: [] }, 'T', 'gemini');
  assert.match(doc, /^<!-- gemini-review: hash=/);
  assert.match(doc, /# Gemini 교차검증/);
});

test('차례 — Gemini 가 먼저 돌고, ChatGPT 는 같은 지문의 Gemini 의견을 받아 본다 (사장님 지시 2026-10-10)', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const g = src.indexOf('const r = await reviewGemini('), c = src.indexOf('const r = await reviewOne(');
  assert.ok(g > 0 && c > 0 && g < c, 'Gemini 호출이 ChatGPT 호출보다 앞이어야 한다');
  assert.match(src, /reviewedHash\(DIR, f, 'gemini'\) === hashOf\(text\)[^\n]*readFileSync/, '옛 지문의 Gemini 의견을 싣지 않는다');
  assert.match(src, /reviewOne\(\{ name: f, text, criteria: crit,/, 'ChatGPT 에 Gemini 의견을 실어 보낸다');
});

test('Claude(3번) — 앞 두 의견을 받아 정리하고, 잔액 부족을 열쇠 문제로 적지 않는다', async () => {
  const m = await load();
  const CK = ['sk-ant-FAKE_one_00000000000000000', 'sk-ant-FAKE_two_00000000000000000'];
  assert.deepStrictEqual(m.claudeKeys({ CLODE_API_KEY2: CK[0], ANTHROPIC_API_KEY: CK[1], CLAUDE_API_KEY: CK[0] }), CK, '옛 철자(CLODE)도 읽고 중복은 뺀다');
  const base = { name: 'a.md', text: '지침', criteria: '', keys: CK };
  const cb = (j) => ({ content: [{ type: 'text', text: '정리합니다\n' + JSON.stringify(j) }] });
  let n = 0;
  let r = await m.reviewClaude({ ...base, fetchImpl: async () => (++n === 1 ? res(401, 'bad') : res(200, cb({ verdict: 'PASS', summary: 's', issues: [] }))) });
  assert.ok(r.ok && n === 2, '거부되면 다음 열쇠로 간다 · 앞뒤 글이 붙은 JSON 도 읽는다');
  r = await m.reviewClaude({ ...base, fetchImpl: async () => res(400, 'Your credit balance is too low') });
  assert.strictEqual(r.code, 5);
  assert.ok(!/열쇠를 다시/.test(r.say));
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const g = src.indexOf('await reviewGemini('), c = src.indexOf('await reviewOne('), k = src.indexOf('await reviewClaude(');
  assert.ok(g < c && c < k, '차례는 Gemini → ChatGPT → Claude');
  assert.match(src, /filter\(\(k\) => reviewedHash\(DIR, f, k\) === h\)/, '같은 지문의 앞 의견만 싣는다');
});

test('송부 — 「송부기록」에 지문이 있어야 «송부됨», 고치면 다시 «송부 대기» (2026-10-10 사장님 지시)', async () => {
  const m = await load();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-send-'));
  fs.writeFileSync(path.join(d, 'a.md'), '# 가\n본문');
  fs.writeFileSync(path.join(d, 'b.md'), '# 나\n본문');
  fs.writeFileSync(path.join(d, '송부기록.md'), `- a.md · ${m.hashOf('# 가\n본문')} · 2026-10-10 16:30\n`);
  let s = m.renderStatus(d, 'T');
  assert.match(s, /\| a\.md \|[^\n]*\| 송부됨 \| 미반영 \|/);
  assert.match(s, /\| b\.md \|[^\n]*\| 송부 대기 \| 미반영 \|/);
  assert.match(s, /송부 대기 1건/);
  assert.ok(!/\| 송부기록\.md/.test(s), '송부기록 자체를 지침으로 세지 않는다');
  fs.writeFileSync(path.join(d, 'a.md'), '# 가\n고친 본문');
  s = m.renderStatus(d, 'T');
  assert.match(s, /\| a\.md \|[^\n]*\| 송부 대기 \| 미반영 \|/, '송부 뒤에 고친 판은 다시 송부 대기다');
});

test('Claude(3번) — 워크스페이스 번호를 요구하는 400 을 «열쇠가 틀렸다»로 적지 않고, 번호가 있으면 함께 보낸다', async () => {
  const m = await load();
  const CK = ['sk-ant-FAKE_one_00000000000000000'];
  const W400 = '{"type":"error","error":{"type":"invalid_request_error","message":"This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header."}}';
  const base = { name: 'a.md', text: '지침', criteria: '', keys: CK };
  let r = await m.reviewClaude({ ...base, workspaceId: '', fetchImpl: async () => res(400, W400) });
  assert.strictEqual(r.kind, 'workspace', '워크스페이스 갈래로 가른다');
  assert.ok(/ANTHROPIC_WORKSPACE_ID/.test(r.say) && /잔액·모델 문제가 아닙니다/.test(r.say), '할 일(변수 이름)을 적고 엉뚱한 곳을 가리키지 않는다');
  let seen = null;
  r = await m.reviewClaude({ ...base, workspaceId: 'wrkspc_FAKE01', fetchImpl: async (u, o) => { seen = o.headers['anthropic-workspace-id']; return res(200, { content: [{ type: 'text', text: JSON.stringify({ verdict: 'PASS', summary: 's', issues: [] }) }] }); } });
  assert.ok(r.ok && seen === 'wrkspc_FAKE01', '번호가 있으면 머리에 싣는다');
  seen = 'x';
  await m.reviewClaude({ ...base, workspaceId: '', fetchImpl: async (u, o) => { seen = o.headers['anthropic-workspace-id']; return res(400, W400); } });
  assert.strictEqual(seen, undefined, '번호가 없으면 빈 머리를 보내지 않는다');
});
