// scripts/shorts-make.mjs
//
// 쇼츠 한 편을 «처음부터 끝까지» 만든다 〈2026-10-28 사장님: 「실제 쇼츠를 생산해서 배포까지 테스트해봐」〉
//
// 흐름: 승인된 대본(data/_shorts/scripts/<id>.json) → 줄마다 목소리(Gemini 먼저 · 막히면 Typecast) →
//       소리 이어 붙이기(줄 사이 0.35초) → 줄마다 잰 길이로 자막 시각(ASS·SRT) → FFmpeg 9:16 렌더 → ffprobe 로 잰다.
// ★ 자막 시각은 «받은 소리의 바이트 수»로 잰다 — 추정하지 않는다. 그래서 자막과 목소리가 어긋날 수 없다.
// ★ 배경은 FFmpeg 이 그린다(잉크 바탕 · 라임 진행 막대 · 글자) — 남의 사진·영상·로고를 안 쓰니 권리 문제가 없다 (§6-2-6 · §30).
// ★ 대본은 «승인 A» 칸이 true 인 것만 읽는다 — 사실 확인 전 대본은 소리로 안 만든다 (§30).
// ★ 올리지 않는다 — 결과는 아티팩트와 요약뿐이다. 게시는 사장님이 하신다 (§10 외부 공개).
// ★ 열쇠 값은 한 글자도 안 남긴다 (§2 · 공개 저장소).
//
// 쓰는 법  node scripts/shorts-make.mjs --id linkpilot-01 [--voice Kore] [--engine auto|gemini|typecast] [--out data/_shorts/out]
// 되돌아오는 값: 0 완성 · 2 열쇠 없음 · 3 기다리면 낫는다 · 4 거부 · 5 한도 0·크레딧 · 6 모델 없음 · 7 소리 아님 ·
//                8 렌더 실패·규격 어긋남 · 9 열쇠 샘 · 10 대본 미승인·형식 오류

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { geminiKeys } from './guide-review.mjs';
import { makeVoice, makeTypecast, VIDEO } from './shorts-voice.mjs';

export const GAP_S = 0.35;          // 줄 사이 쉼
export const RATE = 24000;          // 이어 붙이는 소리 — 16비트 모노 24kHz 로 맞춘다
export const FONT = 'NanumGothic';  // 러너에 fonts-nanum 을 깐다(OFL) — 플랫폼 화면 글꼴(페이퍼로지)과 다르다는 사실을 요약에 적는다

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] != null ? process.argv[i + 1] : d; }

/** 대본 검사 — 승인 A 가 아니면 소리로 안 만든다 */
export function checkScript(s) {
  if (!s || !Array.isArray(s.lines) || !s.lines.length) return '대본에 줄이 없다';
  if (s.approvedA !== true) return '사실 확인(승인 A)이 안 된 대본이다 — 소리로 만들지 않는다';
  for (const [i, l] of s.lines.entries()) {
    if (!l || typeof l.text !== 'string' || !l.text.trim()) return `${i + 1}번째 줄이 비었다`;
    if (l.text.length > 60) return `${i + 1}번째 줄이 60자를 넘는다 — 쇼츠 자막 한 장에 안 들어간다`;
  }
  return null;
}

/** 줄마다 잰 길이로 자막 시각을 매긴다 — [{ i, text, start, end }] (초) */
export function timeline(durations, texts, gap = GAP_S) {
  const out = []; let t = 0;
  durations.forEach((d, i) => { out.push({ i, text: texts[i], start: t, end: t + d }); t += d + (i < durations.length - 1 ? gap : 0); });
  return out;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function srtTime(s) { const ms = Math.round(s * 1000); return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`; }
export function assTime(s) { const cs = Math.round(s * 100); return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`; }

export function toSrt(tl) { return tl.map((c, k) => `${k + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'); }

/** ASS — 가운데 큰 글자(잉크 바탕 위 흰 글자) · 줄 번호는 위 작은 라임 글자 */
export function toAss(tl, title = '') {
  const esc = (t) => String(t).replace(/[{}]/g, '').replace(/\n/g, '\\N');
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${VIDEO.w}`, `PlayResY: ${VIDEO.h}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${FONT},84,&H00FFFFFF,&H00FFFFFF,&H00191400,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,110,110,0,1`,
    `Style: Num,${FONT},40,&H0006E1AA,&H0006E1AA,&H00000000,&H00000000,1,0,0,0,100,100,2,0,1,0,0,8,110,110,330,1`,
    `Style: Brand,${FONT},44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,6,0,1,0,0,8,110,110,160,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const total = tl.length ? tl[tl.length - 1].end : 0;
  const ev = [`Dialogue: 0,${assTime(0)},${assTime(total)},Brand,,0,0,0,,${esc(title || 'LINKPILOT')}`];
  for (const c of tl) {
    ev.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Num,,0,0,0,,${pad(c.i + 1)} / ${pad(tl.length)}`);
    ev.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,{\\fad(120,120)}${esc(c.text)}`);
  }
  return head.concat(ev).join('\n') + '\n';
}

/** 받은 소리(어떤 형식이든)를 16비트 모노 24kHz PCM 으로 바꾼다 */
function toPcm(inPath) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', inPath, '-ar', String(RATE), '-ac', '1', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
}

function wavHeader(len) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + len, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(len, 40); return h;
}

/** 렌더 — 잉크 바탕 + 라임 진행 막대 + ASS 자막 + 목소리 */
export function render({ wav, ass, mp4, seconds, fontsDir }) {
  const D = seconds.toFixed(3);
  const vf = [
    `drawbox=x=110:y=1640:w=860:h=10:color=0x1E2A31:t=fill`,
    `drawbox=x=110:y=1640:w='860*min(1,t/${D})':h=10:color=0xAAE106:t=fill`,
    `ass=${ass}${fontsDir ? `:fontsdir=${fontsDir}` : ''}`,
  ].join(',');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${VIDEO.bg}:s=${VIDEO.w}x${VIDEO.h}:r=${VIDEO.fps}:d=${D}`, '-i', wav,
    '-vf', vf, '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(VIDEO.fps),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', mp4]);
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,size', '-of', 'json', mp4]).toString());
  const vs = (j.streams || []).find((s) => s.codec_type === 'video') || {};
  const as = (j.streams || []).find((s) => s.codec_type === 'audio') || {};
  const probe = { width: vs.width, height: vs.height, video: vs.codec_name, audio: as.codec_name, duration: +(+j.format.duration).toFixed(2), size: +j.format.size };
  const ok = probe.width === VIDEO.w && probe.height === VIDEO.h && probe.video === 'h264' && probe.audio === 'aac'
    && probe.size > 0 && Math.abs(probe.duration - seconds) < 0.5;
  return { ok, probe };
}

/** 한 줄을 읽는다 — auto 면 Gemini 먼저, 막히면 Typecast */
async function speak(text, { engine, voice, keys, tcKey }) {
  const tried = [];
  if (engine !== 'typecast') {
    const g = await makeVoice({ text, voice, keys, budgetMs: 120000 });
    tried.push({ engine: 'gemini', code: g.code, say: g.say });
    if (g.ok) return { ok: true, engine: 'gemini', model: g.model, wav: g.wav, tried };
    if (engine === 'gemini') return { ok: false, code: g.code, say: g.say, tried };
  }
  const t = await makeTypecast({ text, key: tcKey });
  tried.push({ engine: 'typecast', code: t.code, say: t.say });
  if (t.ok) return { ok: true, engine: 'typecast', model: t.model, wav: t.wav, tried };
  return { ok: false, code: t.code, say: t.say, tried };
}

async function main() {
  const id = arg('id', 'linkpilot-01');
  const engine = arg('engine', 'auto');
  const voice = arg('voice', 'Kore');
  const out = `${arg('out', 'data/_shorts/out')}/${id}`;
  await mkdir(out, { recursive: true });
  const at = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); // Asia/Seoul (§5)
  const keys = geminiKeys();
  const tcKey = String(process.env.STUDIO_TYPECAST_AI || '').trim();
  const secrets = [...keys, tcKey].filter(Boolean);

  let script;
  try { script = JSON.parse(await readFile(`data/_shorts/scripts/${id}.json`, 'utf8')); } catch (e) { script = null; }
  const bad = checkScript(script);
  const log = [];
  const finish = async (code, head) => {
    log.unshift(`# 쇼츠 만들기 — ${id} · ${at} KST`, '', `판정 ${code} — ${head}`, ''); // 판정은 요약 맨 앞 (§6-3 ①)
    const md = log.join('\n') + '\n';
    if (secrets.some((k) => md.includes(k))) { console.error('✗ 요약에 열쇠 값이 섞였다 — 안 쓴다'); process.exit(9); }
    await writeFile(`${out}/_summary.md`, md); console.log(md); process.exit(code);
  };
  if (bad) return finish(10, bad);

  const pcms = []; const durs = []; const used = new Set();
  for (const [i, l] of script.lines.entries()) {
    const r = await speak(l.text, { engine, voice, keys, tcKey });
    log.push(`- ${pad(i + 1)} «${l.text}» — ${r.ok ? `${r.engine} \`${r.model}\`` : `판정 ${r.code} ${r.say}`}${r.tried.length > 1 ? ` (앞 길: ${r.tried[0].engine} 판정 ${r.tried[0].code})` : ''}`);
    if (!r.ok) return finish(r.code, `${i + 1}번째 줄을 소리로 못 만들었다 — ${r.say}`);
    used.add(r.engine);
    const raw = `${out}/line-${pad(i + 1)}.wav`; await writeFile(raw, r.wav);
    const pcm = toPcm(raw); pcms.push(pcm); durs.push(pcm.length / (RATE * 2));
  }
  const gap = Buffer.alloc(Math.round(GAP_S * RATE) * 2);
  const body = Buffer.concat(pcms.flatMap((p, i) => (i < pcms.length - 1 ? [p, gap] : [p])));
  const wav = `${out}/narration.wav`; await writeFile(wav, Buffer.concat([wavHeader(body.length), body]));
  const seconds = body.length / (RATE * 2);
  const tl = timeline(durs, script.lines.map((l) => l.text));
  await writeFile(`${out}/captions.srt`, toSrt(tl));
  await writeFile(`${out}/captions.ass`, toAss(tl, script.brand || 'LINKPILOT'));
  await writeFile(`${out}/script.txt`, script.lines.map((l) => l.text).join('\n') + '\n');

  let r;
  try { r = render({ wav, ass: `${out}/captions.ass`, mp4: `${out}/final.mp4`, seconds, fontsDir: process.env.SHORTS_FONTS_DIR || '' }); }
  catch (e) { return finish(8, 'FFmpeg 렌더가 실패했다 — ' + String(e && e.message).slice(0, 200)); }
  log.push('', `- 목소리: ${[...used].join(' + ')} · 줄 ${tl.length}개 · 줄 사이 ${GAP_S}초 · 자막 시각은 받은 소리 길이로 잼`,
    `- 영상: ${r.probe.width}×${r.probe.height} · ${r.probe.video}/${r.probe.audio} · ${r.probe.duration}초(목소리 ${seconds.toFixed(2)}초) · ${(r.probe.size / 1048576).toFixed(2)} MB`,
    `- 글꼴: ${FONT}(OFL) — 플랫폼 화면 글꼴 페이퍼로지와 다르다`,
    '- 배경: FFmpeg 이 그린 잉크 바탕·라임 진행 막대 — 남의 사진·영상·로고 없음',
    '- ★ 올리지 않았다 — 영상은 이 실행의 아티팩트(shorts-final)로만 받는다. 게시는 사장님이 하신다.');
  return finish(r.ok ? 0 : 8, r.ok ? `완성 — ${r.probe.duration}초 9:16 쇼츠` : '렌더는 됐는데 규격이 어긋난다');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
