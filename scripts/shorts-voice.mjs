// scripts/shorts-voice.mjs
//
// 쇼츠 자동화의 «목소리»와 «영상 묶기»를 무료로 잰다 〈2026-10-28 사장님: 「무료로 너가 직접 연결해」 · 「쇼츠 채널은 홍보용 · 링크파일럿」 ·
//   「Gemini 음성으로」〉
//
// ★ 왜 Gemini 음성인가 — 채널이 LinkPilot 홍보용(상업 이용)이다. ElevenLabs 무료 판은 상업 이용이 안 되고,
//   OpenAI·Runway 는 API 무료 판이 없다. 이미 넣어 둔 무료 Gemini 열쇠 묶음으로 읽는다 (CLAUDE.md §11 — 새 유료 API 는 사장님 승인).
// ★ 진단부터 짠다 (§4.3) — 첫 판은 «응답이 무엇으로 오는지»를 남긴다: 모델 이름 · HTTP · 받은 소리 형식(mimeType) · 길이.
//   모델 이름은 확정값이 아니다 — 없으면(404) 다음 모델로 가고 그 사실을 적는다. 바꾸려면 GEMINI_TTS_MODELS.
// ★ 영상 묶기는 FFmpeg(무료) — 받은 목소리에 9:16(1080×1920 · 30fps) 바탕을 얹어 H.264/AAC · faststart 로 묶고 ffprobe 로 잰다.
// ★ 열쇠 값은 한 글자도 안 남긴다 (§2 · 공개 저장소) — 결과 글에 열쇠가 섞였으면 파일을 안 쓰고 빨갛게 끝난다.
//
// ★ Typecast(STUDIO_TYPECAST_AI)가 있으면 같은 글을 그것으로도 읽어 나란히 적는다 〈2026-10-28 사장님: 「STUDIO_TYPECAST_AI 키넣었어」〉.
// 쓰는 법  node scripts/shorts-voice.mjs [--text "읽을 글"] [--voice Kore] [--out data/_shorts/probe]
// 되돌아오는 값: 0 목소리·영상 둘 다 됨 · 2 열쇠 없음 · 3 기다리면 낫는다(못 닿음·시간 초과·한도) · 4 열쇠 거부 ·
//                5 무료 한도 0(결제 연결 필요) · 6 모델 없음 · 7 받은 것이 소리가 아니다 · 8 목소리는 됐는데 영상 묶기 실패

import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { geminiKeys, redact } from './guide-review.mjs';

export const TTS_MODELS = (process.env.GEMINI_TTS_MODELS || 'gemini-2.5-flash-preview-tts,gemini-2.5-pro-preview-tts').split(',').map((s) => s.trim()).filter(Boolean);
export const SAMPLE = '세계의 작은 가게들이 어떻게 국경을 넘었을까요. 링크파일럿이 그 이야기를 들려드립니다.';
export const VIDEO = { w: 1080, h: 1920, fps: 30, bg: '0x0A1419' };

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] != null ? process.argv[i + 1] : d; }

/** PCM(16비트 · 모노) 바이트에 WAV 머리를 붙인다 — 받은 소리가 «머리 없는 PCM»으로 오기 때문이다 */
export function pcmToWav(pcm, rate = 24000, ch = 1, bits = 16) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * bits / 8, 28); h.writeUInt16LE(ch * bits / 8, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** «audio/L16;codec=pcm;rate=24000» 에서 표본 빈도를 읽는다 — 못 읽으면 null(지어내지 않는다) */
export function rateOf(mime) { const m = /rate=(\d+)/i.exec(String(mime || '')); return m ? +m[1] : null; }

/** 한 번 읽는다 — { ok, code, say, model, mime, wav, seconds, tried } */
/* ★ 전체 예산 — 열쇠 × 모델이 다 시간 초과로 끝나도 Typecast·결과 쓰기 몫이 남게 한다(일의 한도 15분 · Codex #327).
 *   호출마다 남은 예산만 기다리고, 예산이 다 되면 남은 열쇠를 안 부르고 «기다리면 낫는다(3)»로 끝낸다. */
export const VOICE_BUDGET_MS = 6 * 60 * 1000;
export async function makeVoice({ text = SAMPLE, voice = 'Kore', keys = geminiKeys(), models = TTS_MODELS, fetchImpl = fetch, timeoutMs = 90000, budgetMs = VOICE_BUDGET_MS, now = Date.now } = {}) {
  if (!keys.length) return { ok: false, code: 2, say: 'Gemini 열쇠가 이 자리에 없다 — 열쇠가 있는 자리(Actions)에서 돌린다', tried: [] };
  const tried = [];
  const end = now() + budgetMs;
  let last = { ok: false, code: 3, say: '아무 대답도 못 받았다' };
  for (const model of models) {
    let quota0 = 0;
    for (const key of keys) {
      const left = end - now();
      if (left < 1000) return { ok: false, code: 3, say: `정해 둔 전체 시간(${Math.round(budgetMs / 1000)}초)이 다 됐다 — 남은 열쇠는 안 불렀다 · 기다리면 낫는다`, tried, budgetOut: true };
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), Math.min(timeoutMs, left));
      let r, body = '';
      try {
        r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ parts: [{ text }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
        });
        body = await r.text();
      } catch (e) {
        clearTimeout(t);
        tried.push({ model, status: null, note: ctl.signal.aborted ? 'timeout' : 'unreachable' });
        last = { ok: false, code: 3, say: ctl.signal.aborted ? `${model} 이 정해 둔 시간 안에 대답하지 않았다` : 'Gemini 에 닿지 못했다 — 열쇠 문제가 아니다' };
        continue;
      }
      clearTimeout(t);
      const head = redact(body.slice(0, 300), keys);
      tried.push({ model, status: r.status, body: head });
      if (r.status === 404) { last = { ok: false, code: 6, say: `모델 ${model} 이 없다 — 다음 모델로 간다`, detail: head }; break; }
      if (r.status === 429) {
        if (/limit:\s*0\b/.test(body)) { quota0++; last = { ok: false, code: 5, say: `${model} 의 무료 한도가 0 이다 — 이 모델은 결제 연결이 있어야 열린다`, detail: head }; }
        else last = { ok: false, code: 3, say: `${model} 의 오늘 몫을 다 썼다 — 기다리면 낫는다`, detail: head };
        continue;
      }
      if (r.status === 401 || r.status === 403) { last = { ok: false, code: 4, say: `열쇠가 거부됐다 (HTTP ${r.status})`, detail: head }; continue; }
      if (!r.ok) { last = { ok: false, code: 3, say: `HTTP ${r.status}`, detail: head }; continue; }
      let part = null;
      try { part = JSON.parse(body).candidates[0].content.parts.find((p) => p.inlineData && p.inlineData.data); } catch { /* 아래 */ }
      if (!part) { last = { ok: false, code: 7, say: '대답은 왔는데 소리가 아니다', detail: head }; break; }
      const mime = part.inlineData.mimeType || '';
      const raw = Buffer.from(part.inlineData.data, 'base64');
      const isWav = raw.slice(0, 4).toString() === 'RIFF';
      const rate = rateOf(mime) || (isWav ? null : 24000);
      const wav = isWav ? raw : pcmToWav(raw, rate);
      const seconds = isWav ? null : Math.round((raw.length / (rate * 2)) * 100) / 100;
      return { ok: true, code: 0, model, mime, wav, seconds, rateAssumed: !rateOf(mime) && !isWav, tried };
    }
    if (quota0 && quota0 === keys.length) continue; // 이 모델은 모든 열쇠가 한도 0 — 다음 모델로
  }
  return { ...last, tried };
}

/** 받은 목소리를 9:16 영상으로 묶고 ffprobe 로 잰다 — { ok, say, probe } */
export function makeVideo(wavPath, mp4Path, v = VIDEO) {
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${v.bg}:s=${v.w}x${v.h}:r=${v.fps}`, '-i', wavPath,
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(v.fps), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4Path]);
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration', '-of', 'json', mp4Path]).toString());
    const vs = (j.streams || []).find((s) => s.codec_type === 'video') || {};
    const as = (j.streams || []).find((s) => s.codec_type === 'audio') || {};
    const probe = { width: vs.width, height: vs.height, fps: vs.r_frame_rate, video: vs.codec_name, audio: as.codec_name, duration: +(+j.format.duration).toFixed(2) };
    const ok = probe.width === v.w && probe.height === v.h && probe.video === 'h264' && probe.audio === 'aac';
    return { ok, say: ok ? '9:16 영상으로 묶였다' : '묶이긴 했는데 규격이 다르다', probe };
  } catch (e) { return { ok: false, say: 'FFmpeg 로 못 묶었다 — ' + String(e && e.message).slice(0, 160) }; }
}

/** Typecast(네오사피엔스) 음성 — 열쇠 STUDIO_TYPECAST_AI 〈2026-10-28 사장님이 넣으셨다〉
 *  ★ 규격을 확정하지 않는다 — 목소리 목록(GET)부터 받아 «무엇이 오는지» 남기고, 한국어 목소리 하나로 짧게 읽어 본다.
 *  주소·인증 머리·몸통 칸은 제가 아는 공개 문서 기준이라 «확인 필요»다. 어긋나면 응답 앞머리가 그 사실을 말한다. */
/* 〈2026-10-28 대조〉 공식 스킬 neosapience/typecast-skills(커밋 4909ee1)의 api-reference: 목소리 목록은 GET /v3/voices(V1·V2 는 폐기) ·
 *  권장 모델 ssfm-v30 · 402 = 크레딧 부족 · 429 = 동시 요청 한도(무료 2) — 기다리면 낫는다 · 422 TEXT_NOT_SYNTHESIZABLE = 글을 고친다 */
export const TYPECAST = { base: 'https://api.typecast.ai', model: 'ssfm-v30' };
// 〈2026-10-28 사장님: 「타입캐스트(Typecast), 목소리 강일 — 1순위 · 진우 — 2순위 · 서현 — 3순위 자동으로」〉
// ★ 목록에서 «이름»으로 찾는다 — 셋 다 없으면 아무 목소리나 고르지 않는다(§4.9). 영문 표기도 함께 본다.
export const TC_VOICES = (process.env.TYPECAST_VOICES || '강일,진우,서현').split(',').map((x) => x.trim()).filter(Boolean);
const TC_ALIAS = { 강일: ['kangil', 'kang-il', 'gangil', 'kang il'], 진우: ['jinwoo', 'jin-woo', 'jinu', 'jin woo'], 서현: ['seohyun', 'seo-hyun', 'seohyeon', 'seo hyun'] };
// ★ 이름 칸이 글자가 아니라 묶음({ko,en} 따위)으로 올 수 있다 — 2026-10-28 실측: 608개 목록이 «[object Object]» 로 읽혀 셋 다 못 찾았다.
//   그래서 이름 칸 안의 글자를 «모두» 꺼내 맞춘다. 화면에는 한글이 든 것을 먼저 적는다.
const strs = (v, d = 0) => (typeof v === 'string' ? [v] : v && typeof v === 'object' && d < 2 ? Object.values(v).flatMap((x) => strs(x, d + 1)) : []);
const vNames = (x) => (x ? ['voice_name', 'name', 'actor_name', 'display_name', 'names'].flatMap((k) => strs(x[k])).filter(Boolean) : []);
const vName = (x) => { const a = vNames(x); return a.find((t) => /[가-힣]/.test(t)) || a[0] || ''; };
export function pickVoice(list, names = TC_VOICES) {
  for (const [rank, n] of names.entries()) {
    const keys = [n, ...(TC_ALIAS[n] || [])].map((k) => k.toLowerCase().replace(/\s+/g, ''));
    const hit = (list || []).find((x) => vNames(x).some((t) => { const v = t.toLowerCase().replace(/\s+/g, ''); return v && keys.some((k) => v === k || v.startsWith(k) || v.includes(k)); }));
    if (hit) return { id: hit.voice_id || hit.id || hit.actor_id, name: vName(hit), rank: rank + 1, want: n };
  }
  return null;
}
/** 못 찾았을 때 «이름 칸 모양»만 적는다 — 값 대신 칸 이름 · 빈 줄이면 무엇이 있는지 (열쇠·개인정보 없음) */
export const voiceShape = (list) => { const x = (list || [])[0]; if (!x || typeof x !== 'object') return ''; return Object.keys(x).map((k) => (x[k] && typeof x[k] === 'object' && !Array.isArray(x[k]) ? `${k}{${Object.keys(x[k]).join(',')}}` : k)).join(' · ').slice(0, 200); };
export async function makeTypecast({ text = SAMPLE, key = String(process.env.STUDIO_TYPECAST_AI || '').trim(), fetchImpl = fetch, timeoutMs = 60000, voices = null, voiceId: fixedId = '' } = {}) {
  if (!key) return { ok: false, code: 2, say: 'STUDIO_TYPECAST_AI 열쇠가 이 자리에 없다', tried: [] };
  const tried = [];
  const call = async (url, opt) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try { const r = await fetchImpl(url, { ...opt, signal: ctl.signal }); const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, ok: r.ok, ct, buf };
    } catch (e) { return { status: null, note: ctl.signal.aborted ? 'timeout' : 'unreachable' }; } finally { clearTimeout(t); }
  };
  const H = { 'X-API-KEY': key };
  let chosen = fixedId ? { id: fixedId } : null; let list = [];
  const v = fixedId ? { status: 200, ok: true, buf: Buffer.from('[]') } : await call(`${TYPECAST.base}/v3/voices?model=${TYPECAST.model}`, { headers: H });
  tried.push({ model: 'GET /v3/voices', status: v.status ?? v.note, body: v.buf ? redact(v.buf.slice(0, 300).toString(), [key]) : '' });
  if (v.status == null) return { ok: false, code: 3, say: 'Typecast 에 닿지 못했다 — 열쇠 문제가 아니다', tried };
  if (v.status === 401 || v.status === 403) return { ok: false, code: 4, say: `Typecast 가 열쇠를 거부했다 (HTTP ${v.status})`, tried };
  if (!v.ok) return { ok: false, code: v.status === 404 ? 6 : 3, say: `Typecast 목소리 목록이 HTTP ${v.status}`, tried };
  try { const j = JSON.parse(v.buf.toString()); list = Array.isArray(j) ? j : (j.result || j.voices || j.data || []); } catch { /* 아래 */ }
  if (!chosen && voices) {
    chosen = pickVoice(list, voices);
    if (!chosen) return { ok: false, code: 7, say: `목소리 ${voices.join(' · ')} 를 목록(${list.length}개)에서 못 찾았다 — 아무 목소리나 고르지 않는다`, tried, count: list.length, names: list.slice(0, 40).map(vName).filter(Boolean), shape: voiceShape(list) };
  }
  if (!chosen) { const pick = list.find((x) => /ko|kor/i.test(JSON.stringify(x.language || x.languages || x.lang || ''))) || list[0]; chosen = pick && { id: pick.voice_id || pick.id || pick.actor_id, name: vName(pick) }; }
  const voiceId = chosen && chosen.id;
  if (!voiceId) return { ok: false, code: 7, say: '목소리 목록은 왔는데 목소리 번호를 못 읽었다 — 응답 모양을 보고 고친다', tried, count: list.length };
  const s = await call(`${TYPECAST.base}/v1/text-to-speech`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ voice_id: voiceId, text, model: TYPECAST.model, language: 'kor', output: { audio_format: 'wav' } }) });
  const isAudio = s.buf && (/audio/i.test(s.ct) || s.buf.slice(0, 4).toString() === 'RIFF');
  tried.push({ model: 'POST /v1/text-to-speech', status: s.status ?? s.note, body: s.buf && !isAudio ? redact(s.buf.slice(0, 300).toString(), [key]) : (isAudio ? `(소리 ${s.buf.length} 바이트 · ${s.ct || '형식 안 적힘'})` : '') });
  if (s.status == null) return { ok: false, code: 3, say: 'Typecast 읽기에 닿지 못했다', tried, count: list.length };
  if (s.status === 401 || s.status === 403) return { ok: false, code: 4, say: `Typecast 가 읽기를 거부했다 (HTTP ${s.status})`, tried, count: list.length };
  if (s.status === 402) return { ok: false, code: 5, say: 'Typecast 크레딧이 모자라다 (HTTP 402) — 요금제·충전이 사람 몫이다', tried, count: list.length };
  if (s.status === 429) return { ok: false, code: 3, say: 'Typecast 동시 요청 한도에 걸렸다 (HTTP 429) — 기다리면 낫는다', tried, count: list.length };
  if (s.status === 422) return { ok: false, code: 7, say: 'Typecast 가 이 글을 소리로 못 바꾼다 (HTTP 422) — 같은 글로 다시 부르지 말고 글을 고친다', tried, count: list.length };
  if (!s.ok) return { ok: false, code: 3, say: `Typecast 읽기가 HTTP ${s.status}`, tried, count: list.length };
  if (!isAudio) return { ok: false, code: 7, say: '대답은 왔는데 소리가 아니다', tried, count: list.length };
  return { ok: true, code: 0, model: `typecast ${TYPECAST.model}`, voiceId, voiceName: chosen.name || '', voiceRank: chosen.rank || null, mime: s.ct, wav: s.buf, seconds: null, tried, count: list.length };
}

/** 요약 — 첫 줄 판정은 앞에 올린다 (§6-3 ①) */
export function summary(at, voice, video, tc = null, tcVideo = null) {
  const log = [];
  const sec = (title, v, vid) => {
    log.push('', `## ${title}`);
    if (v.ok) log.push(`- 모델: \`${v.model}\`${v.voiceId ? ` · 목소리 \`${v.voiceId}\`` : ''}${v.count != null ? ` · 목록 ${v.count}개` : ''}`, `- 받은 형식: \`${v.mime || '(적혀 오지 않음)'}\`${v.rateAssumed ? ' — 빈도가 적혀 오지 않아 24000 으로 놓았다(확인 필요)' : ''}`);
    else log.push(`- 판정 ${v.code} — ${v.say}`);
    log.push('', '| 부른 곳 | HTTP | 응답 앞머리(열쇠 가림) |', '|---|---|---|');
    for (const t of v.tried || []) log.push(`| ${t.model} | ${t.status ?? t.note} | ${String(t.body || '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 160)} |`);
    if (vid) { log.push(`- 영상 묶기: ${vid.say}`); if (vid.probe) log.push(`- ${vid.probe.width}×${vid.probe.height} · ${vid.probe.fps} fps · ${vid.probe.video}/${vid.probe.audio} · ${vid.probe.duration}초`); }
  };
  sec('목소리 ① Gemini 음성 (무료 열쇠 묶음)', voice, video);
  if (tc) sec('목소리 ② Typecast (STUDIO_TYPECAST_AI)', tc, tcVideo);
  log.push('', '★ 소리·영상 파일은 저장소에 안 올리고 이 실행의 아티팩트로만 남긴다.');
  const code = verdict(voice, video, tc, tcVideo);
  log.unshift(`# 쇼츠 목소리·영상 진단 — ${at} KST`, '', `판정 ${code} — Gemini ${voice.ok ? '됨' : '안 됨(' + voice.code + ')'}${tc ? ` · Typecast ${tc.ok ? '됨' : '안 됨(' + tc.code + ')'}` : ''} · 영상 ${(video && video.ok) || (tcVideo && tcVideo.ok) ? '됨' : '안 됨'}`);
  return log.join('\n') + '\n';
}

/** 판정 — 0 목소리 하나 이상 + 영상 됨 · 8 목소리는 됐는데 영상 실패 · 그 밖에는 Gemini 쪽 갈래(2 열쇠 없음 …) */
export function verdict(voice, video, tc = null, tcVideo = null) {
  const anyVoice = voice.ok || (tc && tc.ok);
  if (!anyVoice) return voice.code;
  return (video && video.ok) || (tcVideo && tcVideo.ok) ? 0 : 8;
}

async function main() {
  const out = arg('out', 'data/_shorts/probe');
  await mkdir(out, { recursive: true });
  const keys = geminiKeys();
  const tcKey = String(process.env.STUDIO_TYPECAST_AI || '').trim();
  const at = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); // Asia/Seoul (§5)
  const text = arg('text', SAMPLE);
  const voice = await makeVoice({ text, voice: arg('voice', 'Kore'), keys });
  let video = null;
  if (voice.ok) { await writeFile(`${out}/gemini.wav`, voice.wav); video = makeVideo(`${out}/gemini.wav`, `${out}/gemini.mp4`); }
  const tc = await makeTypecast({ text, key: tcKey });
  let tcVideo = null;
  if (tc.ok) { await writeFile(`${out}/typecast.wav`, tc.wav); tcVideo = makeVideo(`${out}/typecast.wav`, `${out}/typecast.mp4`); }
  const md = summary(at, voice, video, tc, tcVideo);
  const json = JSON.stringify({ at, voice: { ...voice, wav: undefined }, video, typecast: { ...tc, wav: undefined }, typecastVideo: tcVideo }, null, 2);
  for (const k of [...keys, tcKey].filter(Boolean)) if (md.includes(k) || json.includes(k)) { console.error('✗ 결과에 열쇠 값이 섞였다 — 파일을 안 쓴다'); process.exit(9); }
  await writeFile(`${out}/_summary.md`, md); await writeFile(`${out}/result.json`, json);
  console.log(md);
  const code = verdict(voice, video, tc, tcVideo);
  process.exit(code);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
