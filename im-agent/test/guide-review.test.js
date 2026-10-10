'use strict';
/**
 * guide-review.test.js — 업무지침 교차검증 (Gemini) (D-428 · D-437 · CLAUDE.md §18)
 *
 * 망 호출만 가짜로 끼우고 판정은 진짜를 돌린다 (§12-30).
 * ★ 2026-10-11 사장님: 「ChatGPT, Claude API 검증은 빼줘」 — 그 두 길이 «되살아나지 않는지»도 잰다 (D-437).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'guide-review.mjs');
const load = () => import(SCRIPT);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const KEY = 'sk-test-ABCDEFGHIJKLMNOPQRSTUVWX';

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
  encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GEMINI_|CLAUDE_|CLODE_|ANTHROPIC_|OPENAI_)/.test(k))), GUIDE_DIR: dir, ...env },
});

test('현황표 — 지문이 같아야 «검토됨», 반영기록에 지문이 있어야 «반영 완료»', async () => {
  const m = await load();
  const text = '# 지침\n내용';
  const h = m.hashOf(text);
  const d = tmpBox({
    'a.md': text, 'b.md': '# 다른 지침',
    'a.gemini-review.md': `<!-- gemini-review: hash=${h} verdict=PASS model=m at=x -->\n`,
    'b.gemini-review.md': '<!-- gemini-review: hash=000000000000 verdict=PASS model=m at=x -->\n',
    'a.gpt-review.md': `<!-- gpt-review: hash=${h} verdict=BLOCK model=m at=x -->\n`,
    '반영기록.md': `- a.md · ${h} · 2026-10-10\n`, 'README.md': '안내', '_검증기준.md': '기준',
  });
  const s = m.renderStatus(d, 'T');
  assert.match(s, /\| a\.md \| `[0-9a-f]{12}` \| 통과 \| 송부 대기 \| 반영 완료 \|/, '남아 있는 옛 ChatGPT 검토 파일(BLOCK)을 안 읽는다');
  assert.ok(!/ChatGPT|Claude 정리/.test(s), '현황표에 빠진 검증자 칸이 남지 않는다');
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
  const rl = run(leak, [], { GEMINI_API_KEY: 'AIzaREAL_should_not_be_used_00000000' });
  assert.strictEqual(rl.status, 4, '열쇠 모양이 든 지침은 보내지 않고 4 로 끝낸다');
  assert.match(rl.stdout, /공개 저장소에 둘 수 없는 글/, '4 의 까닭이 «보내지 않았다»여야 한다 — 거부된 4 와 섞이면 안 된다');
  assert.ok(!rl.stdout.includes('AIzaREAL_should_not_be_used'), '열쇠 값을 찍지 않는다');
});

test('워크플로 — 지침함이 바뀌면 돌고, 판정이 맨 끝이며, 열쇠는 비밀에서만 온다', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'guideline-review.yml'), 'utf8');
  assert.match(y, /docs\/지침함\/\*\*/);
  assert.match(y, /GEMINI_API_KEY:\s*\$\{\{\s*secrets\.GEMINI_API_KEY\s*\}\}/);
  const body = y.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/OPENAI_|CLAUDE_|CLODE_|ANTHROPIC_/.test(body), 'ChatGPT·Claude 열쇠를 받지 않는다 (2026-10-11 사장님 지시 · D-437)');
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
  assert.match(s, /\| a\.md \| `[0-9a-f]{12}` \| 반영 보류 \| 송부 대기 \| 미반영 \|/);
  assert.match(s, /지침 1건/, 'gemini-review 파일을 지침으로 세지 않는다');
  const doc = m.renderReview('a.md', h, 'g', { verdict: 'PASS', summary: '', issues: [], conflicts: [] }, 'T', 'gemini');
  assert.match(doc, /^<!-- gemini-review: hash=/);
  assert.match(doc, /# Gemini 교차검증/);
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

test('빠진 검증자 — ChatGPT·Claude API 를 부르는 길이 «지워졌다» (2026-10-11 사장님 지시 · D-437)', async () => {
  const m = await load();
  for (const n of ['reviewOne', 'reviewClaude', 'claudeKeys', 'classify']) assert.strictEqual(m[n], undefined, `${n} 가 남아 있다 — 끈 것이 아니라 지워야 한다 (§6-2-6)`);
  const src = fs.readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/api\.openai\.com|api\.anthropic\.com|OPENAI_API_KEY|CLAUDE_API_KEY|ANTHROPIC/.test(src), '코드에 OpenAI·Anthropic 호출이 남지 않는다');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-only-'));
  fs.writeFileSync(path.join(d, 'a.md'), '# 지침');
  const r = run(d, [], { OPENAI_API_KEY: 'sk-real-must-not-matter-000000000', CLAUDE_API_KEY: 'sk-ant-must-not-matter-000000000' });
  assert.strictEqual(r.status, 2, 'Gemini 열쇠가 없으면 ChatGPT·Claude 열쇠가 있어도 «판정 2» 다 — 대신 부르지 않는다');
  assert.match(r.stdout, /Gemini 열쇠/);
  assert.match(r.stdout, /프로젝트 세션의 Claude 가 스스로 교차검증/, '못 한 지침은 세션 Claude 가 검증한다고 적는다');
});
