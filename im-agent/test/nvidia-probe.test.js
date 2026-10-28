/* NVIDIA AI 열쇠 진단 — scripts/nvidia-probe.mjs 〈2026-10-28 사장님: 「NVDIA_TAST_KEY 넣었어」〉
 * 가짜 응답으로 갈래를 잰다: 열쇠 없음 2 · 넣으신 이름 먼저 · 거부 4 · 한도 3 · 목록 모양 아님 7 · 갈래 나누기. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const load = () => import(path.join(__dirname, '..', '..', 'scripts', 'nvidia-probe.mjs'));
const reply = (status, obj) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });

test('NVIDIA 진단 — 넣으신 이름 먼저 · 갈래 2/3/4/7/0', async () => {
  const m = await load();
  assert.strictEqual((await m.probe({ env: {} })).code, 2);
  assert.strictEqual(m.pickKey({ NVDIA_TAST_KEY: 'nvapi-aaaaaaaa', NVIDIA_API_KEY: 'nvapi-bbbbbbbb' }).name, 'NVDIA_TAST_KEY');
  const env = { NVDIA_TAST_KEY: 'nvapi-secret-123' };
  assert.strictEqual((await m.probe({ env, fetchImpl: async () => reply(401, 'no') })).code, 4);
  assert.strictEqual((await m.probe({ env, fetchImpl: async () => reply(429, 'slow') })).code, 3);
  assert.strictEqual((await m.probe({ env, fetchImpl: async () => reply(200, '<html>') })).code, 7);
  let auth = '';
  const r = await m.probe({ env, fetchImpl: async (u, o) => { auth = o.headers.Authorization; return reply(200, { data: [{ id: 'black-forest-labs/flux.1-dev' }, { id: 'nvidia/magpie-tts-multilingual' }, { id: 'meta/llama-3.1-8b-instruct' }, { id: 'x/y' }] }); } });
  assert.strictEqual(r.code, 0); assert.strictEqual(auth, 'Bearer nvapi-secret-123');
  assert.deepStrictEqual([r.groups.image.length, r.groups.speech.length, r.groups.text.length, r.groups.other.length], [1, 1, 1, 1]);
  assert.ok(!JSON.stringify({ say: r.say, head: r.head }).includes('nvapi-secret-123'), '결과에 열쇠 값이 안 섞인다');
});
