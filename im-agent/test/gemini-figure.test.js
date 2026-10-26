/* Figma 대신 제미나이로 그림 짓기 — scripts/gemini-figure.mjs 〈2026-10-26 사장님 지시〉
 * 가짜 응답으로 판정 갈래를 잰다: 도식은 글 모델 SVG · 사진형은 그림 모델 · 무료 한도 0 은 «결제 연결 필요(5)» ·
 * 모델 없음(404)은 다음 모델 · 위험한 SVG 조각은 걷는다 · 열쇠 없으면 2. 실제 제미나이는 Actions 에서 잰다(여기엔 열쇠가 없다). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const MOD = path.join(__dirname, '..', '..', 'scripts', 'gemini-figure.mjs');
const load = () => import(MOD);
const reply = (status, obj) => ({ status, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });
const parts = (p) => ({ candidates: [{ content: { parts: p } }] });

async function withFetch(fn, impl) {
  const old = globalThis.fetch; globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = old; }
}

test('도식은 글 모델이 지은 SVG 를 받고, 위험한 조각(script·on*·외부 주소)을 걷는다', async () => {
  const m = await load();
  const seen = [];
  const r = await withFetch(() => m.makeFigure({ kind: 'diagram', brief: '자금 흐름', keys: ['k'.repeat(30)] }), async (url, o) => {
    seen.push(url); const b = JSON.parse(o.body);
    assert.match(b.contents[0].parts[0].text, /지어내지 말고/, '숫자를 지어내지 말라는 지시가 없다');
    assert.match(b.contents[0].parts[0].text, /Paperlogy/);
    return reply(200, parts([{ text: '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" onload="x()"><script>alert(1)</script><text>자금</text></svg>\n```' }]));
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.match(seen[0], /models\/gemini-[^/]*flash[^/]*:generateContent/, '도식은 글 모델로 가야 한다');
  assert.ok(!/script|onload/.test(r.svg));
  assert.deepStrictEqual(r.dropped.sort(), ['on*', 'script'].sort());
});

test('사진형·조감도는 그림 모델 — 무료 한도 0 이면 «결제 연결 필요(5)»로 적고, 다른 열쇠도 같으면 그대로 5', async () => {
  const m = await load();
  const urls = [];
  const r = await withFetch(() => m.makeFigure({ kind: 'aerial', brief: '지붕 태양광', keys: ['a'.repeat(30), 'b'.repeat(30)] }), async (url) => {
    urls.push(url);
    return reply(429, { error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0' } });
  });
  assert.strictEqual(r.code, 5); assert.match(r.say, /결제 연결/);
  assert.ok(urls.every((u) => /image/.test(u)), '조감도가 그림 모델이 아닌 곳으로 갔다');
});

test('모델이 없으면(404) 다음 모델로 — 그림이 오면 PNG 를 돌려준다', async () => {
  const m = await load();
  let n = 0;
  const r = await withFetch(() => m.makeFigure({ kind: 'image', brief: '현장 사진', keys: ['c'.repeat(30)] }), async () => {
    n++;
    if (n === 1) return reply(404, { error: { message: 'not found' } });
    return reply(200, parts([{ inlineData: { mimeType: 'image/png', data: Buffer.from('PNGDATA').toString('base64') } }]));
  });
  assert.ok(r.ok); assert.strictEqual(String(r.png), 'PNGDATA'); assert.strictEqual(n, 2);
  assert.strictEqual(r.model, m.IMAGE_MODELS[1]);
});

test('열쇠가 없으면 2 · SVG 가 없는 대답은 7(그림이 아니다)', async () => {
  const m = await load();
  assert.strictEqual((await m.makeFigure({ kind: 'chart', brief: 'x', keys: [] })).code, 2);
  const r = await withFetch(() => m.makeFigure({ kind: 'chart', brief: 'x', keys: ['d'.repeat(30)] }), async () => reply(200, parts([{ text: '그릴 수 없습니다' }])));
  assert.strictEqual(r.code, 7);
});

test('워크플로가 열쇠 묶음을 배포·교차검증과 같은 이름으로 넘기고, 접속 자격증명은 안 넣는다 (§4 규정집 2-8)', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'figure-gemini.yml'), 'utf8');
  const gr = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'guideline-review.yml'), 'utf8');
  const names = (s) => [...new Set([...s.matchAll(/secrets\.(GEMINI_[A-Z0-9_]+)/g)].map((x) => x[1]))].sort();
  assert.deepStrictEqual(names(wf), names(gr));
  assert.ok(!/NAS_|SSH|TAILSCALE|TS_AUTH/.test(wf), '그림 잡에 접속 자격증명이 들어갔다');
  assert.match(wf, /node scripts\/gemini-figure\.mjs/);
});

test('문자 참조로 숨긴 주소(java&#x73;cript:)·<a>·<animate>·style url( 도 걷고, 같은 문서 조각(#id)은 남긴다 (Codex #318)', async () => {
  const m = await load();
  const r = m.cleanSvg('<svg viewBox="0 0 10 10"><a href="java&#x73;cript:alert(1)"><text>x</text></a>'
    + '<rect xlink:href="&#106;avascript:1" style="fill:u&#114;l(http://e)"/><set attributeName="href" to="javascript:1"/>'
    + '<use href="#m"/></svg>');
  assert.ok(!/javascript|java&#|&#106;|<a\b|<set|url\(|u&#114;l/i.test(r.svg), r.svg);
  assert.match(r.svg, /<use href="#m"\/>/);
  assert.match(r.svg, /<text>x<\/text>/);
  for (const k of ['a', 'animate', '외부 주소', 'style url']) assert.ok(r.dropped.includes(k), k);
});

test('도식 요청의 무료 한도 소진(limit: 20)은 «결제 필요(5)»가 아니라 기다리면 낫는 3 (Codex #318)', async () => {
  const m = await load();
  const r = await withFetch(() => m.makeFigure({ kind: 'diagram', brief: 'x', keys: ['e'.repeat(30)] }), async () =>
    reply(429, { error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20' } }));
  assert.strictEqual(r.code, 3, JSON.stringify(r));
});
