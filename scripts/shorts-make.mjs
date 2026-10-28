// scripts/shorts-make.mjs
//
// 쇼츠 한 편을 «처음부터 끝까지» 만든다 〈2026-10-28 사장님: 「실제 쇼츠를 생산해서 배포까지 테스트해봐」〉
//
// 흐름: 승인된 대본(data/_shorts/scripts/<id>.json) → 줄마다 목소리(Typecast 먼저 · 강일→진우→서현 · 막히면 Gemini 한 목소리) →
//       소리 이어 붙이기(줄 사이 0.35초) → 줄마다 잰 길이로 자막 시각(ASS·SRT) → FFmpeg 9:16 렌더 → ffprobe 로 잰다.
// ★ 자막 시각은 «받은 소리의 바이트 수»로 잰다 — 추정하지 않는다. 그래서 자막과 목소리가 어긋날 수 없다.
// ★ 배경: 줄마다 «장면(scene)» 검색어로 Pexels 공식 API 사진을 깐다(scripts/shorts-images.mjs · 사진가 표기 · §6-2-6)
//   〈2026-10-28 사장님: 「스토리보드에 맞게 자동으로 이미지도 넣어줘」〉. 장면이 없거나 못 받은 줄은 FFmpeg 이 그린 잉크 바탕이다.
// ★ 대본은 «승인 A» 칸이 true 인 것만 읽는다 — 사실 확인 전 대본은 소리로 안 만든다 (§30).
// ★ 올리지 않는다 — 결과는 아티팩트와 요약뿐이다. 게시는 사장님이 하신다 (§10 외부 공개).
// ★ 열쇠 값은 한 글자도 안 남긴다 (§2 · 공개 저장소).
//
// 쓰는 법  node scripts/shorts-make.mjs --id linkpilot-01 [--voice Kore] [--engine auto|gemini|typecast] [--images pexels|none] [--out data/_shorts/out]
// 되돌아오는 값: 0 완성 · 2 열쇠 없음 · 3 기다리면 낫는다 · 4 거부 · 5 한도 0·크레딧 · 6 모델 없음 · 7 소리 아님 ·
//                8 렌더 실패·규격 어긋남 · 9 열쇠 샘 · 10 대본 미승인·형식 오류

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { geminiKeys } from './guide-review.mjs';
import { makeVoice, makeTypecast, VIDEO, TC_VOICES } from './shorts-voice.mjs';
import { storyboard } from './shorts-images.mjs';
import { meta, syntheticOf } from './shorts-publish.mjs';

export const GAP_S = 0.35;          // 줄 사이 쉼
export const RATE = 24000;          // 이어 붙이는 소리 — 16비트 모노 24kHz 로 맞춘다
// 자막 글꼴 — 지침 v1.3 §8.2 기본안은 페이퍼로지(Paperlogy · OFL). 워크플로가 받아 깔고 fc-match 로 «그 이름으로 쓰이는지» 잰 뒤
// SHORTS_FONT 로 알려 준다. 못 깔았으면 나눔고딕으로 그리고 그 사실을 요약에 적는다(조용히 바꿔치기하지 않는다 · §6-2-1).
export const FONT = String(process.env.SHORTS_FONT || 'Paperlogy').trim() || 'Paperlogy';
export const LEN = { min: 50, max: 58 }; // 지침 v1.3 §1·§6.1 — 기본안 50~58초. 실제 음성 길이로 판정한다(막지 않고 적는다)

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
export function toVtt(tl) { return 'WEBVTT\n\n' + tl.map((c, k) => `${k + 1}\n${srtTime(c.start).replace(',', '.')} --> ${srtTime(c.end).replace(',', '.')}\n${c.text}\n`).join('\n'); }

/** 길이 판정 — 기본안 50~58초 안인가. 밖이면 막지 않고 «몇 초 짧다/길다»를 적는다 (지침 v1.3 §6.1 · §8.6) */
export function lengthJudge(sec, len = LEN) {
  const s = +(+sec).toFixed(2);
  if (s < len.min) return { ok: false, say: `길이 ${s}초 — 기본안 ${len.min}~${len.max}초보다 ${+(len.min - s).toFixed(2)}초 짧다(대본을 늘린다)` };
  if (s > len.max) return { ok: false, say: `길이 ${s}초 — 기본안 ${len.min}~${len.max}초보다 ${+(s - len.max).toFixed(2)}초 길다(대본을 줄인다)` };
  return { ok: true, say: `길이 ${s}초 — 기본안 ${len.min}~${len.max}초 안` };
}

/** ASS — 가운데 큰 글자(잉크 바탕 위 흰 글자) · 줄 번호는 위 작은 라임 글자 */
export function toAss(tl, title = '', credits = [], emph = []) {
  const esc = (t) => String(t).replace(/[{}]/g, '').replace(/\n/g, '\\N');
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${VIDEO.w}`, `PlayResY: ${VIDEO.h}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${FONT},84,&H00FFFFFF,&H00FFFFFF,&H00191400,&H00000000,1,0,0,0,100,100,0,0,1,4,1,5,110,110,0,1`, // 테두리 4 — 사진 위에서도 읽힌다
    `Style: Num,${FONT},40,&H0006E1AA,&H0006E1AA,&H00000000,&H00000000,1,0,0,0,100,100,2,0,1,0,0,8,110,110,330,1`,
    `Style: Brand,${FONT},44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,6,0,1,0,0,8,110,110,160,1`,
    `Style: Emph,${FONT},112,&H0006E1AA,&H0006E1AA,&H00191400,&H00000000,1,0,0,0,100,100,-2,0,1,3,0,8,90,90,470,1`, // 강조 문구 — 한 화면 한 메시지(지침 v1.3 §6.2 · §8.6)
    `Style: Credit,${FONT},26,&H00D8D8D8,&H00D8D8D8,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,110,110,190,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const total = tl.length ? tl[tl.length - 1].end : 0;
  const ev = [`Dialogue: 0,${assTime(0)},${assTime(total)},Brand,,0,0,0,,${esc(title || 'LINKPILOT')}`];
  for (const c of tl) {
    ev.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Num,,0,0,0,,${pad(c.i + 1)} / ${pad(tl.length)}`);
    ev.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,{\\fad(120,120)}${esc(c.text)}`);
    if (emph[c.i]) ev.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Emph,,0,0,0,,{\\fad(160,120)}${esc(emph[c.i])}`);
    if (credits[c.i]) ev.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Credit,,0,0,0,,${esc(credits[c.i])}`); // 사진가 표기 (§6-2-6)
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

/** 줄마다 화면에 머무는 길이 — 다음 줄이 시작할 때까지(줄 사이 쉼 포함) · 마지막 줄은 끝까지 */
export function segments(tl, total) {
  return tl.map((c, k) => +(((k < tl.length - 1 ? tl[k + 1].start : total) - (k ? c.start : 0))).toFixed(3));
}

/** 렌더 — 바탕(줄마다 장면 사진 · 없으면 잉크) + 라임 진행 막대 + ASS 자막 + 목소리 */
export function render({ wav, ass, mp4, seconds, fontsDir, images = [], tl = [], captions = true }) {
  const D = seconds.toFixed(3);
  const useImg = tl.length && images.some(Boolean);
  const ins = []; let bg = '';
  if (useImg) {
    // ★ 사진은 9:16 을 채우도록 자르고 밝기를 절반으로(색은 그대로) 눌러 흰 자막이 읽히게 한다 — 사진이 없는 줄은 잉크 바탕
    const segs = segments(tl, seconds);
    const parts = segs.map((d, k) => {
      if (images[k]) { ins.push('-loop', '1', '-framerate', String(VIDEO.fps), '-t', String(d), '-i', images[k]);
        return `[${ins.filter((x) => x === '-i').length - 1}:v]scale=${VIDEO.w}:${VIDEO.h}:force_original_aspect_ratio=increase,crop=${VIDEO.w}:${VIDEO.h},setsar=1,fps=${VIDEO.fps},format=rgb24,colorchannelmixer=rr=0.5:gg=0.5:bb=0.5,format=yuv420p[s${k}]`; }
      ins.push('-f', 'lavfi', '-t', String(d), '-i', `color=c=${VIDEO.bg}:s=${VIDEO.w}x${VIDEO.h}:r=${VIDEO.fps}`);
      return `[${ins.filter((x) => x === '-i').length - 1}:v]setsar=1,format=yuv420p[s${k}]`;
    });
    bg = parts.join(';') + ';' + segs.map((_, k) => `[s${k}]`).join('') + `concat=n=${segs.length}:v=1:a=0[bg];[bg]`;
  }
  const vf = [
    `drawbox=x=110:y=1640:w=860:h=10:color=0x1E2A31:t=fill`,
    `drawbox=x=110:y=1640:w='860*min(1,t/${D})':h=10:color=0xAAE106:t=fill`,
    ...(captions ? [`ass=${ass}${fontsDir ? `:fontsdir=${fontsDir}` : ''}`] : []), // 자막 없는 판(내려받기 묶음 · 지침 v1.3 §10.4)
  ].join(',');
  const nIn = ins.filter((x) => x === '-i').length;
  const head = useImg
    ? [...ins, '-i', wav, '-filter_complex', `${bg}${vf}[v]`, '-map', '[v]', '-map', `${nIn}:a`]
    : ['-f', 'lavfi', '-i', `color=c=${VIDEO.bg}:s=${VIDEO.w}x${VIDEO.h}:r=${VIDEO.fps}:d=${D}`, '-i', wav, '-vf', vf];
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...head, '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(VIDEO.fps),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', mp4]);
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,size', '-of', 'json', mp4]).toString());
  const vs = (j.streams || []).find((s) => s.codec_type === 'video') || {};
  const as = (j.streams || []).find((s) => s.codec_type === 'audio') || {};
  const probe = { width: vs.width, height: vs.height, video: vs.codec_name, audio: as.codec_name, duration: +(+j.format.duration).toFixed(2), size: +j.format.size };
  const ok = probe.width === VIDEO.w && probe.height === VIDEO.h && probe.video === 'h264' && probe.audio === 'aac'
    && probe.size > 0 && Math.abs(probe.duration - seconds) < 0.5;
  return { ok, probe };
}

/** 한 줄을 읽는다 — 엔진 하나로만(목소리가 줄마다 바뀌지 않게) · Typecast 는 정해 둔 목소리 번호를 쓴다 */
async function speakOne(text, { use, voice, keys, tcKey, tc }) {
  if (use === 'typecast') {
    const t = await makeTypecast({ text, key: tcKey, voices: tc.id ? null : TC_VOICES, voiceId: tc.id || '' });
    if (t.ok && !tc.id) { tc.id = t.voiceId; tc.name = t.voiceName; tc.rank = t.voiceRank; }
    return t.ok ? { ok: true, engine: 'typecast', model: `${t.model}${tc.name ? ` · ${tc.name}` : ''}`, wav: t.wav } : { ok: false, code: t.code, say: t.say, names: t.names, shape: t.shape };
  }
  const g = await makeVoice({ text, voice, keys, budgetMs: 120000 });
  return g.ok ? { ok: true, engine: 'gemini', model: `${g.model} · ${voice}`, wav: g.wav } : { ok: false, code: g.code, say: g.say };
}

async function main() {
  const id = arg('id', 'linkpilot-01');
  const engine = arg('engine', 'auto'); // auto = Typecast 먼저(강일 → 진우 → 서현) · 막히면 Gemini 한 목소리
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

  // 〈2026-10-28 사장님: 「타입캐스트, 목소리 강일 1순위 · 진우 2순위 · 서현 3순위」〉 — auto 는 Typecast 먼저.
  // ★ 한 편은 «한 목소리»다: Typecast 가 어느 줄에서든 막히면 처음부터 Gemini 한 목소리로 다시 읽는다(섞지 않는다).
  const order = engine === 'gemini' ? ['gemini'] : engine === 'typecast' ? ['typecast'] : ['typecast', 'gemini'];
  let pcms = [], durs = [], used = new Set(), lineLog = [], fail = null;
  for (const use of order) {
    pcms = []; durs = []; lineLog = []; fail = null;
    const tc = {};
    for (const [i, l] of script.lines.entries()) {
      const r = await speakOne(l.text, { use, voice, keys, tcKey, tc });
      lineLog.push(`- ${pad(i + 1)} «${l.text}» — ${r.ok ? `${r.engine} \`${r.model}\`` : `판정 ${r.code} ${r.say}`}`);
      if (!r.ok) { fail = { use, i, ...r }; break; }
      const raw = `${out}/line-${pad(i + 1)}.wav`; await writeFile(raw, r.wav);
      const pcm = toPcm(raw); pcms.push(pcm); durs.push(pcm.length / (RATE * 2));
    }
    if (!fail) { used = new Set([use]); if (use === 'typecast' && tc.name) log.push(`- Typecast 목소리: ${tc.name} (${tc.rank}순위 · 순위 ${TC_VOICES.join(' → ')})`); break; }
    log.push(`- ${use} 로 ${fail.i + 1}번째 줄에서 막혔다 — 판정 ${fail.code} ${fail.say}${fail.names && fail.names.length ? ` · 목록에 있는 이름 예: ${fail.names.slice(0, 12).join(', ')}` : ''}${fail.shape ? ` · 목록 한 줄의 칸: ${fail.shape}` : ''}`);
  }
  log.push(...lineLog);
  if (fail) return finish(fail.code, `${fail.i + 1}번째 줄을 소리로 못 만들었다 — ${fail.say}`);
  const gap = Buffer.alloc(Math.round(GAP_S * RATE) * 2);
  const body = Buffer.concat(pcms.flatMap((p, i) => (i < pcms.length - 1 ? [p, gap] : [p])));
  const wav = `${out}/narration.wav`; await writeFile(wav, Buffer.concat([wavHeader(body.length), body]));
  const seconds = body.length / (RATE * 2);
  const tl = timeline(durs, script.lines.map((l) => l.text));
  await writeFile(`${out}/captions.srt`, toSrt(tl));
  await writeFile(`${out}/captions.vtt`, toVtt(tl)); // 내려받기 묶음 (지침 v1.3 §10.4)
  // 스토리보드 — 줄마다 장면 사진 (Pexels 공식 API · §6-2-6). 열쇠가 없거나 못 받으면 그 줄은 잉크 바탕
  let shots = [];
  const pxKey = String(process.env.PEXELS_API_KEY || '').trim();
  if (pxKey) secrets.push(pxKey);
  // 대본이 visual: graphic 이면 사진을 안 깐다 — 지침 v1.3 §5.3·§8.1 초기 정책(자체 그래픽 · 로고·제품 사진 없음)
  if (script.visual === 'graphic') log.push('- 장면: 자체 그래픽(강조 문구·연도 숫자·진행 막대) — 대본이 visual: graphic 이라 사진을 안 깔았다 (지침 v1.3 §5.3)');
  else if (arg('images', 'pexels') === 'pexels') {
    if (!pxKey) log.push('- 사진: PEXELS_API_KEY 가 없어 잉크 바탕으로만 그린다');
    else { shots = await storyboard({ script, key: pxKey, out, write: writeFile }); await writeFile(`${out}/_images.json`, JSON.stringify(shots.map(({ file, ...r }) => r), null, 2) + '\n'); }
  }
  const images = script.lines.map((_, k) => { const r = shots.find((x) => x.i === k); return r && r.ok ? r.file : null; });
  const credits = script.lines.map((_, k) => { const r = shots.find((x) => x.i === k); return r && r.ok && r.credit.photographer ? `사진 ${r.credit.photographer} · Pexels` : ''; });
  await writeFile(`${out}/captions.ass`, toAss(tl, script.brand || 'LINKPILOT', credits, script.lines.map((l) => l.emph || '')));
  await writeFile(`${out}/script.txt`, script.lines.map((l) => l.text).join('\n') + '\n');

  let r;
  try { r = render({ wav, ass: `${out}/captions.ass`, mp4: `${out}/final.mp4`, seconds, fontsDir: process.env.SHORTS_FONTS_DIR || '', images, tl }); }
  catch (e) { return finish(8, 'FFmpeg 렌더가 실패했다 — ' + String(e && e.message).slice(0, 200)); }
  // 내려받기 묶음 (지침 v1.3 §10.4) — 자막 없는 판 · 메타데이터 문서 · 해시. 자막 없는 판이 실패해도 본판은 살린다(그 사실만 적는다).
  let nocap = null;
  try { nocap = render({ wav, ass: `${out}/captions.ass`, mp4: `${out}/final-nocap.mp4`, seconds, fontsDir: '', images, tl, captions: false }); }
  catch (e) { nocap = { ok: false, err: String(e && e.message).slice(0, 160) }; }
  const shotsMeta = shots.map(({ file, ...x }) => x);
  const m = meta(script, shotsMeta), syn = syntheticOf(script);
  await writeFile(`${out}/metadata.md`, [`# ${m.title}`, '', `- 길이: ${r.probe.duration}초 · 9:16 · ${r.probe.width}×${r.probe.height} · ${VIDEO.fps}fps · H.264/AAC`,
    `- 합성 콘텐츠 표시(containsSyntheticMedia): ${syn.value} — ${syn.why}`, `- 태그: ${m.tags.join(', ')}`, '', '## 설명', '', m.description, ''].join('\n'));
  const bundle = ['final.mp4', ...(nocap && nocap.ok ? ['final-nocap.mp4'] : []), 'captions.srt', 'captions.vtt', 'metadata.md', 'script.txt'];
  const sums = [];
  for (const f of bundle) sums.push(`${createHash('sha256').update(await readFile(`${out}/${f}`)).digest('hex')}  ${f}`);
  await writeFile(`${out}/SHA256SUMS`, sums.join('\n') + '\n');
  const len = lengthJudge(r.probe.duration);
  log.push('', `- 목소리: ${[...used].join(' + ')} · 줄 ${tl.length}개 · 줄 사이 ${GAP_S}초 · 자막 시각은 받은 소리 길이로 잼`,
    `- 영상: ${r.probe.width}×${r.probe.height} · ${r.probe.video}/${r.probe.audio} · ${r.probe.duration}초(목소리 ${seconds.toFixed(2)}초) · ${(r.probe.size / 1048576).toFixed(2)} MB`,
    `- ${len.ok ? '' : '주의 · '}${len.say}`,
    FONT === 'Paperlogy' ? '- 자막 글꼴: 페이퍼로지(Paperlogy · OFL) — 지침 v1.3 §8.2 기본안' : `- 자막 글꼴: ${FONT} — 페이퍼로지를 못 깔아 대신 썼다(지침 v1.3 §8.2 기본안과 다르다)`,
    `- 내려받기 묶음: ${bundle.join(' · ')} · SHA256SUMS${nocap && nocap.ok ? '' : ` — 자막 없는 판은 못 만들었다(${(nocap && (nocap.err || '규격 어긋남')) || ''})`}`,
    `- 합성 콘텐츠 표시: ${syn.value} — ${syn.why}`,
    images.some(Boolean)
      ? `- 배경: 장면 사진 ${images.filter(Boolean).length}/${images.length}줄 (Pexels 공식 API · 밝기 절반 · 사진가 표기) — 나머지 줄은 잉크 바탕`
      : '- 배경: FFmpeg 이 그린 잉크 바탕·라임 진행 막대 — 남의 사진·영상·로고 없음',
    ...shots.map((x) => `  - ${pad(x.i + 1)} «${x.query || '-'}» — ${x.ok ? `${x.credit.photographer} · ${x.credit.page}` : `판정 ${x.code} ${x.say}`}`),
    '- ★ 이 단계는 올리지 않는다 — 올리기는 «쇼츠 올리기»(게시 승인 «게시»)가 한다.');
  return finish(r.ok ? 0 : 8, r.ok ? `완성 — ${r.probe.duration}초 9:16 쇼츠` : '렌더는 됐는데 규격이 어긋난다');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
