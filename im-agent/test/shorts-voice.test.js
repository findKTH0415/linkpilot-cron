/* 쇼츠 목소리 — scripts/shorts-voice.mjs 〈2026-10-28 사장님: 「Gemini 음성으로」〉
 * 가짜 응답으로 갈래를 잰다: 소리를 받으면 WAV 머리를 붙이고 길이를 센다 · 모델 없음(404)은 다음 모델 ·
 * 한도 0(limit: 0)은 «결제 연결 필요(5)» · 열쇠 없으면 2 · 소리가 아니면 7 · 열쇠 값은 요약에 안 남는다.
 * 실제 Gemini 는 Actions 의 «쇼츠 목소리 진단»에서 잰다(여기엔 열쇠가 없다). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const load = () => import(path.join(__dirname, '..', '..', 'scripts', 'shorts-voice.mjs'));
const reply = (status, obj) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });
const audio = (bytes, mime = 'audio/L16;codec=pcm;rate=24000') => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: mime, data: Buffer.alloc(bytes, 1).toString('base64') } }] } }] });
const K = ['k'.repeat(30), 'j'.repeat(30)];

test('소리를 받으면 WAV 머리를 붙이고 길이를 센다 — 목소리 이름과 AUDIO 를 실어 보낸다', async () => {
  const m = await load();
  let sent;
  const r = await m.makeVoice({ keys: K, models: ['tts-a'], fetchImpl: async (u, o) => { sent = JSON.parse(o.body); return reply(200, audio(48000)); } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(sent.generationConfig.responseModalities, ['AUDIO']);
  assert.strictEqual(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
  assert.strictEqual(r.wav.slice(0, 4).toString(), 'RIFF');
  assert.strictEqual(r.wav.readUInt32LE(24), 24000, '표본 빈도는 mimeType 에서 읽는다');
  assert.strictEqual(r.seconds, 1, '48,000 바이트 = 16비트 24kHz 1초');
});

test('모델 없음(404)은 다음 모델로 간다 — 시도한 줄을 남긴다', async () => {
  const m = await load();
  const urls = [];
  const r = await m.makeVoice({ keys: K, models: ['old-tts', 'new-tts'], fetchImpl: async (u) => { urls.push(u); return /old-tts/.test(u) ? reply(404, { error: { message: 'not found' } }) : reply(200, audio(4800)); } });
  assert.ok(r.ok);
  assert.strictEqual(r.model, 'new-tts');
  assert.strictEqual(urls.filter((u) => /old-tts/.test(u)).length, 1, '없는 모델을 열쇠마다 다시 묻지 않는다');
  assert.deepStrictEqual(r.tried.map((t) => t.status), [404, 200]);
});

test('무료 한도 0(limit: 0)은 «결제 연결 필요(5)» — 모든 열쇠가 같으면 5 로 끝난다', async () => {
  const m = await load();
  const r = await m.makeVoice({ keys: K, models: ['tts-a'], fetchImpl: async () => reply(429, { error: { message: 'Quota exceeded … free_tier_requests, limit: 0' } }) });
  assert.strictEqual(r.code, 5);
  assert.strictEqual(r.tried.length, 2, '열쇠 둘을 다 물어봤다');
});

test('오늘 몫 소진(한도가 0 이 아닌 429)은 «기다리면 낫는다(3)»', async () => {
  const m = await load();
  const r = await m.makeVoice({ keys: K, models: ['tts-a'], fetchImpl: async () => reply(429, { error: { message: 'Quota exceeded, limit: 15' } }) });
  assert.strictEqual(r.code, 3);
});

test('열쇠 없음 2 · 소리가 아님 7', async () => {
  const m = await load();
  assert.strictEqual((await m.makeVoice({ keys: [] })).code, 2);
  const r = await m.makeVoice({ keys: K, models: ['tts-a'], fetchImpl: async () => reply(200, { candidates: [{ content: { parts: [{ text: '안녕' }] } }] }) });
  assert.strictEqual(r.code, 7);
});

test('열쇠 값은 요약에 안 남는다 — 응답 본문에 섞여 와도 가린다', async () => {
  const m = await load();
  const r = await m.makeVoice({ keys: K, models: ['tts-a'], fetchImpl: async () => reply(403, `bad key ${K[0]}`) });
  assert.strictEqual(r.code, 4);
  const md = m.summary('2026-10-28 23:00', r, null);
  assert.ok(!md.includes(K[0]) && !md.includes(K[1]), md);
  assert.match(md, /^# 쇼츠 목소리·영상 진단/);
  assert.match(md, /판정 4/);
});

/* Typecast(STUDIO_TYPECAST_AI) — 목록부터 받고 한국어 목소리로 읽는다 · 거부·크레딧·소리 아님을 갈라 적는다 */
const res = (status, body, ct = 'application/json') => ({ status, ok: status >= 200 && status < 300, headers: { get: () => ct },
  arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });
const TK = 't'.repeat(32);

test('Typecast — 목록에서 한국어 목소리를 골라 읽고, 소리를 받는다', async () => {
  const m = await load();
  const seen = [];
  const r = await m.makeTypecast({ key: TK, fetchImpl: async (u, o) => {
    seen.push([u, o.headers['X-API-KEY'] === TK, o.body && JSON.parse(o.body)]);
    if (/voices/.test(u)) return res(200, [{ voice_id: 'en1', language: ['eng'] }, { voice_id: 'ko1', language: ['kor'] }]);
    return res(200, Buffer.from('RIFF0000WAVE'), 'audio/wav');
  } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.voiceId, 'ko1');
  assert.ok(seen.every((s) => s[1]), '열쇠를 머리에 싣는다');
  assert.strictEqual(seen[1][2].voice_id, 'ko1');
});

test('Typecast — 열쇠 없음 2 · 거부 4 · 크레딧 5 · 소리 아님 7 · 응답의 열쇠 값은 가린다', async () => {
  const m = await load();
  assert.strictEqual((await m.makeTypecast({ key: '' })).code, 2);
  const r4 = await m.makeTypecast({ key: TK, fetchImpl: async () => res(401, `bad ${TK}`) });
  assert.strictEqual(r4.code, 4);
  assert.ok(!JSON.stringify(r4.tried).includes(TK), '응답에 섞인 열쇠 값이 남았다');
  const voices = async (u) => (/voices/.test(u) ? res(200, [{ voice_id: 'ko1', language: 'kor' }]) : null);
  assert.strictEqual((await m.makeTypecast({ key: TK, fetchImpl: async (u) => (await voices(u)) || res(402, { message: 'no credit' }) })).code, 5);
  assert.strictEqual((await m.makeTypecast({ key: TK, fetchImpl: async (u) => (await voices(u)) || res(200, { message: 'ok' }) })).code, 7);
});

test('판정 — Gemini 가 막혀도 Typecast 목소리 + 영상이 되면 0', async () => {
  const m = await load();
  assert.strictEqual(m.verdict({ ok: false, code: 5 }, null, { ok: true }, { ok: true }), 0);
  assert.strictEqual(m.verdict({ ok: false, code: 5 }, null, { ok: false, code: 4 }, null), 5);
  assert.strictEqual(m.verdict({ ok: true }, { ok: false }, null, null), 8);
});

test('전체 예산 — 열쇠가 여럿이고 전부 시간 초과여도 예산 안에서 멈춘다(Typecast 몫을 남긴다)', async () => {
  const m = await load();
  let clock = 0; const calls = [];
  const keys = Array.from({ length: 8 }, (_, i) => String(i).repeat(30));
  const r = await m.makeVoice({ keys, models: ['a', 'b'], budgetMs: 200000, timeoutMs: 90000, now: () => clock,
    fetchImpl: async () => { calls.push(clock); clock += 90000; const e = new Error('abort'); throw e; } });
  assert.strictEqual(r.code, 3);
  assert.ok(r.budgetOut, '예산이 다 됐다는 사실을 남긴다');
  assert.ok(calls.length <= 3, `예산 200초에 90초짜리를 ${calls.length}번 불렀다`);
});

test('Typecast — 공식 문서대로 /v3/voices · ssfm-v30 · 429 는 기다리면 낫는다(3) · 422 는 글을 고친다(7)', async () => {
  const m = await load();
  const urls = []; let body;
  const voices = (u) => res(200, [{ voice_id: 'ko1', language: 'kor' }]);
  await m.makeTypecast({ key: TK, fetchImpl: async (u, o) => { urls.push(u); if (/voices/.test(u)) return voices(u); body = JSON.parse(o.body); return res(200, Buffer.from('RIFF0000WAVE'), 'audio/wav'); } });
  assert.match(urls[0], /\/v3\/voices\?model=ssfm-v30$/);
  assert.strictEqual(body.model, 'ssfm-v30');
  assert.strictEqual((await m.makeTypecast({ key: TK, fetchImpl: async (u) => (/voices/.test(u) ? voices(u) : res(429, { message: 'busy' })) })).code, 3);
  assert.strictEqual((await m.makeTypecast({ key: TK, fetchImpl: async (u) => (/voices/.test(u) ? voices(u) : res(422, { error_code: 'TEXT_NOT_SYNTHESIZABLE' })) })).code, 7);
});

/* 쇼츠 만들기 — scripts/shorts-make.mjs */
const loadMake = () => import(path.join(__dirname, '..', '..', 'scripts', 'shorts-make.mjs'));
test('쇼츠 만들기 — 승인 A 없는 대본은 소리로 안 만든다 · 60자 넘는 줄은 막는다', async () => {
  const m = await loadMake();
  assert.match(m.checkScript({ approvedA: false, lines: [{ text: '안녕' }] }), /승인 A/);
  assert.match(m.checkScript({ approvedA: true, lines: [{ text: '가'.repeat(61) }] }), /60자/);
  assert.strictEqual(m.checkScript({ approvedA: true, lines: [{ text: '안녕' }] }), null);
  const real = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', '..', 'data', '_shorts', 'scripts', 'linkpilot-01.json'), 'utf8'));
  assert.strictEqual(m.checkScript(real), null, '첫 대본이 검사를 지난다');
  for (const l of real.lines.slice(0, 6)) assert.ok(Array.isArray(l.src) && l.src.length >= 2, `사실 줄은 출처 둘: ${l.text}`);
});
test('쇼츠 만들기 — 자막 시각은 받은 소리 길이로 이어지고 줄 사이에만 쉰다', async () => {
  const m = await loadMake();
  const tl = m.timeline([1.5, 2, 1], ['a', 'b', 'c'], 0.5);
  assert.deepStrictEqual(tl.map((c) => [c.start, c.end]), [[0, 1.5], [2, 4], [4.5, 5.5]]);
  assert.match(m.toSrt(tl), /00:00:02,000 --> 00:00:04,000\nb/);
  assert.strictEqual(m.assTime(65.5), '0:01:05.50');
  assert.match(m.toAss(tl, '브랜드'), /Dialogue: 0,0:00:04.50,0:00:05.50,Cap,,0,0,0,,\{\\fad\(120,120\)\}c/);
});
