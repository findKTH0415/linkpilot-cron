// scripts/gemini-figure.mjs
//
// Figma 가 막히면 구글 제미나이로 그림을 짓는다 〈2026-10-26 사장님: 「이미지, 도표, 조감도등등 위해 작업시
//   Figma 소진되면 자동으로 구글 제미나이로 변경해서 작업이 되도록 만들어줘」〉
//
// ★★ 갈래가 둘이다 — 무엇을 그리느냐에 따라 부르는 모델이 다르다.
//   · 도식·도표(diagram · chart) → 제미나이 «글» 모델이 SVG 코드를 짓는다. 무료 열쇠로도 돈다.
//   · 사진형 그림·조감도(image · aerial) → 제미나이 «그림» 모델. ★ 무료 티어는 그림 한도가 0 이다
//     (2026-08-25 실측 · render-birdseye.js 머리글 «free_tier_requests, limit: 0») — 그때는 «결제 연결 필요(5)»로 적고 멈춘다.
// ★ 숫자를 지어내지 않는다 — 지시문에 «주어진 값만 쓴다 · 없으면 빈 칸»을 싣는다 (CLAUDE.md §4.6).
// ★ 열쇠 값은 한 글자도 안 남긴다 (§2 · 공개 저장소) — 결과에 열쇠가 섞였으면 파일을 안 쓰고 빨갛게 끝난다.
//
// 쓰는 법  node scripts/gemini-figure.mjs --name 이름 --kind diagram|chart|image|aerial --brief "무엇을 그리나" [--w 1600 --h 900]
// 되돌아오는 값: 0 그렸다 · 2 열쇠 없음 · 3 기다리면 낫는다(못 닿음·시간 초과) · 4 열쇠 거부 · 5 그림 한도 0(결제 연결 필요) · 6 모델 없음 · 7 받은 것이 그림이 아니다

import { mkdir, writeFile } from 'node:fs/promises';
import { geminiKeys, GEMINI_MODELS } from './guide-review.mjs';

export const OUT = 'data/_figures';
export const IMAGE_MODELS = (process.env.GEMINI_RENDER_MODELS || 'gemini-3-pro-image,gemini-2.5-flash-image').split(',').map((s) => s.trim()).filter(Boolean);
export const KINDS = { diagram: '도식', chart: '도표', image: '사진형 그림', aerial: '조감도' };
/* LinkPilot 디자인 값 — 화면과 같은 토큰(§6-3-0 · 대비 4.5 판) */
const PALETTE = 'ink #0A1419 · 본문 #2E3949 · 보조 글자 rgba(60,60,67,.73) · 강조 #577508 · 옅은 강조 #F0FAD8 · 정보 #0063CC · 주의 #B25000 · 선 #D8D2C6 · 배경 #FFFFFF';

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] != null ? process.argv[i + 1] : d; }

export function svgPrompt({ kind, brief, w, h }) {
  return [
    `너는 투자제안서(IM)의 ${KINDS[kind]}를 그리는 디자이너다. 아래 요청을 SVG 한 장으로 그린다.`,
    `규칙: ① <svg> 로 시작해 </svg> 로 끝나는 코드만 낸다(설명·코드블록 표시 없음). ② viewBox="0 0 ${w} ${h}" · xmlns 를 적는다.`,
    `③ <script>·on* 속성·외부 주소(http)·<image>·<foreignObject> 를 쓰지 않는다. ④ 글꼴은 font-family="Paperlogy, Cambria, sans-serif".`,
    `⑤ 색은 이것만: ${PALETTE}. 그라데이션·그림자·이모지를 쓰지 않는다. ⑥ 글자는 왼쪽 정렬 · 서로 겹치지 않게.`,
    `⑦ 숫자·이름은 요청에 적힌 것만 쓴다. 요청에 없는 값은 지어내지 말고 «확인 필요»로 비운다.`,
    '', `요청: ${brief}`,
  ].join('\n');
}

/** 문자 참조(&#x73; · &#115; · &colon; …)를 풀어 «보는 쪽이 읽을 글자»로 만든다 — 날 글자로만 보면 java&#x73;cript: 가 빠져나간다 (Codex #318) */
function decodeRefs(v) {
  const named = { colon: ':', tab: '\t', newline: '\n', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", sol: '/', lpar: '(', rpar: ')' };
  return String(v).replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(+d || 32))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

/** 받은 글에서 SVG 만 꺼내고 위험한 것을 걷는다 — 걸러진 것이 있으면 그 사실을 돌려준다
 *  ★ 주소 칸(href · xlink:href · src)은 «푼 뒤»에 본다 — 같은 문서 안 조각(#이름)만 남기고 나머지는 칸째 뺀다.
 *    <a>·<animate>·<set> 은 주소를 나중에 바꿔 넣을 수 있어 통째로 뺀다(안의 글은 남긴다). style 의 url( 도 같은 잣대. */
export function cleanSvg(text) {
  const m = /<svg[\s\S]*<\/svg>/i.exec(String(text || ''));
  if (!m) return null;
  let s = m[0];
  const dropped = new Set();
  const cut = (re, name, rep = '') => { s = s.replace(re, (...a) => { const out = typeof rep === 'function' ? rep(...a) : rep; if (out !== a[0]) dropped.add(name); return out; }); };
  cut(/<script[\s\S]*?<\/script>/gi, 'script');
  cut(/<script\b[^>]*\/?>/gi, 'script');
  cut(/<foreignObject[\s\S]*?<\/foreignObject>/gi, 'foreignObject');
  cut(/<image\b[^>]*>/gi, 'image');
  cut(/<(animate|animateTransform|animateMotion|set)\b[^>]*?(\/>|>[\s\S]*?<\/\1>)/gi, 'animate');
  cut(/<\/?a\b[^>]*>/gi, 'a');
  cut(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, 'on*');
  cut(/\s((?:xlink:)?href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, '외부 주소', (all, _n, _q, a, b, c) => {
    const v = decodeRefs(a ?? b ?? c ?? '').replace(/[\s\u0000-\u001f]/g, '');
    if (/^#[\w.-]+$/.test(v)) return all;
    return '';
  });
  cut(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, 'style url', (all, _q, a, b) => {
    const v = decodeRefs(a ?? b ?? '').replace(/\s/g, '').toLowerCase();
    if (!/url\(|expression\(|javascript:/.test(v)) return all;
    return '';
  });
  if (!/viewBox=/.test(s)) return null;
  return { svg: s, dropped: [...dropped] };
}

async function call(url, key, body, ms = 120000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
  } catch (e) { return { status: null, text: ctl.signal.aborted ? 'timeout' : String(e && e.message) }; } finally { clearTimeout(t); }
}

/** 한 장을 짓는다 — { ok, code, say, model, svg|png, dropped } */
export async function makeFigure({ kind, brief, w = 1600, h = 900, keys = geminiKeys() }) {
  if (!keys.length) return { ok: false, code: 2, say: '제미나이 열쇠가 이 자리에 없다 — 열쇠가 있는 자리(Actions)에서 돌린다' };
  const svgKind = kind === 'diagram' || kind === 'chart';
  const models = svgKind ? GEMINI_MODELS : IMAGE_MODELS;
  let last = { ok: false, code: 3, say: '아무 대답도 못 받았다' };
  for (const model of models) {
    for (const key of keys) {
      const body = svgKind
        ? { contents: [{ role: 'user', parts: [{ text: svgPrompt({ kind, brief, w, h }) }] }], generationConfig: { maxOutputTokens: 16384 } }
        : { contents: [{ role: 'user', parts: [{ text: `${KINDS[kind]}. ${brief}. 글자·로고·워터마크를 넣지 않는다. 사실적인 사진처럼. 가로 ${w} 세로 ${h} 비율.` }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } };
      const r = await call(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, key, body);
      if (r.status == null) { last = { ok: false, code: 3, say: r.text === 'timeout' ? `${model} 이 시간 안에 대답하지 않았다` : '제미나이에 닿지 못했다 — 열쇠 문제가 아니다' }; if (r.text === 'timeout') break; continue; }
      if (r.status === 404) { last = { ok: false, code: 6, say: `모델 ${model} 이 없다 — 다음 모델로` }; break; }
      /* 판정 5 는 «그림» 요청이 «한도 0» 을 받았을 때만 — 그 밖의 무료 한도 소진(limit: 20 등)은 기다리면 낫는 3이다 (Codex #318) */
      if (!svgKind && r.status === 429 && /limit:\s*0(?!\d)/.test(r.text)) { last = { ok: false, code: 5, say: '무료 열쇠는 그림 한도가 0 이다 — 결제 연결(Google AI Studio 의 유료 등급)이 있어야 그림이 나온다', model }; continue; }
      if (r.status === 401 || r.status === 403) { last = { ok: false, code: 4, say: `열쇠가 거부됐다(HTTP ${r.status}) — 다음 열쇠로` }; continue; }
      if (r.status !== 200) { last = { ok: false, code: 3, say: `HTTP ${r.status} — 한도·과부하일 수 있다. 다음 열쇠로` }; continue; }
      let parts = [];
      try { parts = JSON.parse(r.text).candidates[0].content.parts || []; } catch { /* 아래 */ }
      if (svgKind) {
        const c = cleanSvg(parts.map((p) => p.text || '').join(''));
        if (!c) { last = { ok: false, code: 7, say: `${model} 대답에서 SVG 를 못 꺼냈다 — 다음 모델로`, model }; break; }
        return { ok: true, code: 0, model, svg: c.svg, dropped: c.dropped };
      }
      const img = parts.find((p) => p.inlineData && p.inlineData.data);
      if (!img) { last = { ok: false, code: 7, say: `${model} 이 그림을 돌려주지 않았다`, model }; break; }
      return { ok: true, code: 0, model, png: Buffer.from(img.inlineData.data, 'base64'), mime: img.inlineData.mimeType || 'image/png' };
    }
  }
  return last;
}

async function main() {
  const name = String(arg('name', '') || '').replace(/[^0-9A-Za-z가-힣_-]/g, '').slice(0, 60);
  const kind = arg('kind', 'diagram'), brief = String(arg('brief', '') || '').trim();
  const w = Math.max(200, Math.min(4000, +arg('w', 1600) || 1600)), h = Math.max(200, Math.min(4000, +arg('h', 900) || 900));
  if (!name || !KINDS[kind] || !brief) { console.error('--name · --kind(diagram|chart|image|aerial) · --brief 가 있어야 한다'); process.exit(1); }
  const keys = geminiKeys();
  const r = await makeFigure({ kind, brief, w, h, keys });
  await mkdir(OUT, { recursive: true });
  const at = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' KST';
  const lines = [`# 제미나이 그림 — ${name}`, '', `${at} · 갈래 ${KINDS[kind]} · ${w}×${h}`, '', `> 판정 ${r.code} — ${r.ok ? '그렸다' : r.say}`, ''];
  if (r.ok) {
    const file = `${name}.${r.svg ? 'svg' : (r.mime === 'image/jpeg' ? 'jpg' : 'png')}`;
    const data = r.svg || r.png;
    const str = r.svg || '';
    if (keys.some((k) => k && (str.includes(k) || (r.png && r.png.includes(Buffer.from(k)))))) { console.error('결과에 열쇠 값이 섞였다 — 쓰지 않는다'); process.exit(4); }
    await writeFile(`${OUT}/${file}`, data);
    await writeFile(`${OUT}/${name}.json`, JSON.stringify({ name, file, kind, brief, w, h, tool: 'gemini', model: r.model, ai_generated: true,
      disclaimer: kind === 'aerial' ? 'AI 렌더 — 실제 설계안이 아님' : 'AI 가 지은 그림 — 숫자·이름은 요청에 적힌 것만', dropped: r.dropped || [], at }, null, 1));
    lines.push(`- 파일 \`${OUT}/${file}\` · 모델 \`${r.model}\``);
    if (r.dropped && r.dropped.length) lines.push(`- 걷어 낸 것: ${r.dropped.join(' · ')} (안전 규칙)`);
    lines.push('- ★ 문서에 싣기 전에 사람이 눈으로 본다 — 글자 겹침·지어낸 숫자가 없는지 (§6-1-1 «도면은 오류를 안 내고 틀린다»)');
  }
  await writeFile(`${OUT}/_summary.md`, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  process.exit(r.code);
}

if (process.argv[1] && process.argv[1].endsWith('gemini-figure.mjs')) await main();
