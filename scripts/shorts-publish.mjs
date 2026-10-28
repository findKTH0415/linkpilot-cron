// scripts/shorts-publish.mjs
//
// 완성한 쇼츠 한 편을 유튜브(Shorts)·인스타그램(릴스)에 올린다 〈2026-10-28 사장님: 「인스타그램, YouTube, 쇼츠 배포자동화까지 자동화 해줘」〉
//
// 흐름: 승인 A 를 지난 대본 + 게시 승인(confirm «게시») → 영상(shorts-preview 가지의 <id>/final.mp4) →
//       유튜브: 갱신 열쇠로 접속 열쇠 받기 → 이어 올리기(resumable) 시작 → 영상 바이트 보내기 → 공개 범위 확인
//       인스타그램: 릴스 그릇 만들기(upload_type=resumable) → rupload 로 바이트 보내기 → 처리 끝날 때까지 묻기 → 게시
// ★ 공식 API 만 쓴다 — 화면 긁기·자동 로그인·남의 계정 없음 (§6-2-7).
// ★ 게시는 «외부 공개»라 사장님 승인이 있어야 돈다 (§10): 대본의 승인 A + 실행 때 확인 글자 «게시». 둘 중 하나라도 없으면 안 올린다.
// ★ 같은 편을 같은 곳에 두 번 올리지 않는다 — 기록(_publish.json)에 있으면 건너뛴다(--again yes 일 때만 다시).
// ★ 유튜브는 처음엔 «비공개(private)»가 기본이다 — 공개는 실행 때 고른다. 그리고 검수 안 받은 API 프로젝트는
//   유튜브가 강제로 비공개로 잠근다 — 돌려받은 공개 범위가 고른 것과 다르면 그 사실을 적는다(못 바꾼 것을 «공개됨»으로 안 적는다).
// ★ AI 목소리로 읽었으니 유튜브에는 «합성 콘텐츠»(containsSyntheticMedia)를 켠다.
// ★ 열쇠 값은 한 글자도 안 남긴다 (§2 · 공개 저장소).
//
// 쓰는 법  node scripts/shorts-publish.mjs --id linkpilot-01 --video <final.mp4> --targets youtube,instagram
//                 --confirm 게시 [--privacy private|unlisted|public] [--again no|yes] [--out data/_shorts/out]
// 되돌아오는 값: 0 모두 올림(또는 이미 올림) · 2 열쇠 없음 · 3 기다리면 낫는다 · 4 열쇠 거부·만료 · 5 영상 없음 ·
//                6 승인 없음 · 7 그쪽이 영상을 거부 · 9 열쇠 샘 · 10 대본 형식 오류

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { creditLines } from './shorts-images.mjs';

export const YT = { token: 'https://oauth2.googleapis.com/token', upload: 'https://www.googleapis.com/upload/youtube/v3/videos' };
export const IG_VER = 'v21.0';
export const CONFIRM = '게시';
export const TARGETS = ['youtube', 'instagram'];
export const PRIVACY = ['private', 'unlisted', 'public'];

const clip = (s, n) => { const a = [...String(s)]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const uniq = (a) => [...new Set(a)];

// 게시 승인 — 승인 A(사실 확인)와 실행 때 확인 글자 둘 다 있어야 한다.
export function checkPublish(script, confirm) {
  if (!script || !Array.isArray(script.lines) || !script.lines.length) return { code: 10, say: '대본을 못 읽었다(형식 오류)' };
  if (script.approvedA !== true) return { code: 6, say: '대본의 승인 A(사실 확인)가 없다 — 올리지 않는다' };
  if (String(confirm || '').trim() !== CONFIRM) return { code: 6, say: `게시 승인이 없다 — 실행 때 확인 칸에 «${CONFIRM}» 을 적어야 올린다` };
  return null;
}

// 올릴 때 쓸 글 — 대본에서만 만든다(지어내지 않는다). 대본에 title·description 이 있으면 그것이 이긴다.
export function meta(script, images = []) {
  const who = String(script.hiddenContributor || '').split(' — ')[0].trim();
  const title = clip(script.title || `${script.company} · 숨은 공로자 ${who}`.trim() + ' #Shorts', 100);
  const srcs = uniq(script.lines.flatMap((l) => (Array.isArray(l.src) ? l.src : [])).filter((s) => /\./.test(s) && !/\s/.test(s)));
  const body = script.description || script.lines.map((l) => l.text).join('\n');
  const tail = [
    '',
    srcs.length ? '출처\n' + srcs.map((s) => '- ' + s).join('\n') : '',
    creditLines(images).length ? '사진 (Pexels)\n' + creditLines(images).join('\n') : '',
    '',
    '목소리는 AI(합성 음성)로 읽었습니다.',
    `#Shorts #${String(script.brand || '').replace(/\s+/g, '')} #링크파일럿`,
  ].filter((x, i, a) => !(x === '' && a[i - 1] === ''));
  const description = clip([body, ...tail].join('\n'), 4900);
  const photo = creditLines(images).map((x) => x.replace(/ https?:\S+$/, '').replace(/^- /, '')).join(', ');
  const caption = clip([body, '', '목소리는 AI(합성 음성)로 읽었습니다.', photo ? `사진: ${photo}` : '', `#${String(script.brand || '').replace(/\s+/g, '')} #링크파일럿 #비즈니스`].join('\n'), 2100);
  const tags = uniq(['Shorts', script.company, script.brand, '링크파일럿', '비즈니스'].filter(Boolean)).slice(0, 10);
  return { title, description, caption, tags };
}

const say4 = (status, txt) => {
  if (status === 429 || status >= 500) return 3;
  if (status === 401 || status === 403) return 4;
  return 7;
};

// ── 유튜브 ───────────────────────────────────────────────
export async function youtube({ video, script, images = [], privacy = 'private', env = process.env, fetchImpl = fetch }) {
  const id = String(env.YOUTUBE_CLIENT_ID || '').trim(), sec = String(env.YOUTUBE_CLIENT_SECRET || '').trim(), rt = String(env.YOUTUBE_REFRESH_TOKEN || '').trim();
  if (!id || !sec || !rt) return { ok: false, code: 2, say: '유튜브 열쇠 셋(YOUTUBE_CLIENT_ID · YOUTUBE_CLIENT_SECRET · YOUTUBE_REFRESH_TOKEN) 중 비어 있는 것이 있다' };
  let r = await fetchImpl(YT.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: sec, refresh_token: rt, grant_type: 'refresh_token' }).toString() });
  let t = await r.text();
  if (!r.ok) {
    const bad = /invalid_grant|invalid_client|unauthorized_client/.test(t);
    return { ok: false, code: bad ? 4 : say4(r.status), say: bad ? '유튜브 갱신 열쇠가 거부됐다(만료·철회·다른 앱) — 다시 받아 넣어야 한다' : `접속 열쇠를 못 받았다 (HTTP ${r.status})` };
  }
  const access = JSON.parse(t).access_token;
  if (!access) return { ok: false, code: 4, say: '접속 열쇠가 비어 왔다' };
  const m = meta(script, images);
  const body = { snippet: { title: m.title, description: m.description, tags: m.tags, categoryId: '27', defaultLanguage: 'ko', defaultAudioLanguage: 'ko' },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: true } };
  r = await fetchImpl(`${YT.upload}?uploadType=resumable&part=snippet,status`, { method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(video.length) },
    body: JSON.stringify(body) });
  t = await r.text();
  const loc = r.headers && (typeof r.headers.get === 'function' ? r.headers.get('location') : r.headers.location);
  if (!r.ok || !loc) {
    const q = /quotaExceeded|uploadLimitExceeded/.test(t);
    const ch = /youtubeSignupRequired|channelNotFound/.test(t);
    return { ok: false, code: q ? 3 : ch ? 7 : say4(r.status), say: q ? '유튜브 하루 올리기 몫을 다 썼다 — 내일 다시' : ch ? '그 계정에 유튜브 채널이 없다' : `올리기를 시작하지 못했다 (HTTP ${r.status})` };
  }
  r = await fetchImpl(loc, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.length) }, body: video });
  t = await r.text();
  if (!r.ok) return { ok: false, code: say4(r.status), say: `영상 바이트를 못 보냈다 (HTTP ${r.status})` };
  const v = JSON.parse(t);
  const got = v.status && v.status.privacyStatus;
  return { ok: true, code: 0, id: v.id, url: `https://www.youtube.com/shorts/${v.id}`, privacyAsked: privacy, privacy: got || '',
    note: got && got !== privacy ? `고른 공개 범위는 ${privacy} 인데 유튜브가 ${got} 로 잠갔다 — 검수 안 받은 API 프로젝트의 영상은 비공개로 잠긴다(유튜브 정책). 유튜브 스튜디오에서 바꾸거나 API 검수를 받아야 한다` : '' };
}

// ── 인스타그램(릴스) ─────────────────────────────────────
export function igHost(token) { return /^IG/.test(token) ? 'https://graph.instagram.com' : 'https://graph.facebook.com'; }

const igErr = (t) => { try { return JSON.parse(t).error || {}; } catch (_) { return {}; } };
const igCode = (status, e) => {
  if (e.code === 190 || e.code === 102) return 4;
  if ([4, 17, 32, 613].includes(e.code) || e.is_transient || status === 429 || status >= 500) return 3;
  if (status === 401 || status === 403) return 4;
  return 7;
};

export async function instagram({ video, script, images = [], env = process.env, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = 300000, stepMs = 5000 }) {
  const user = String(env.INSTAGRAM_USER_ID || '').trim(), tok = String(env.INSTAGRAM_ACCESS_TOKEN || '').trim();
  if (!user || !tok) return { ok: false, code: 2, say: '인스타그램 열쇠 둘(INSTAGRAM_USER_ID · INSTAGRAM_ACCESS_TOKEN) 중 비어 있는 것이 있다' };
  const host = igHost(tok), m = meta(script, images);
  const fail = (status, t, what) => { const e = igErr(t); const c = igCode(status, e); return { ok: false, code: c, say: c === 4 ? '인스타그램 열쇠가 거부됐다(만료·권한 없음) — 다시 받아 넣어야 한다' : `${what} (HTTP ${status}${e.code ? ` · 오류 ${e.code}` : ''})` }; };
  let r = await fetchImpl(`${host}/${IG_VER}/${user}/media`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ media_type: 'REELS', upload_type: 'resumable', caption: m.caption, share_to_feed: 'true', access_token: tok }).toString() });
  let t = await r.text();
  if (!r.ok) return fail(r.status, t, '릴스 그릇을 못 만들었다');
  const box = JSON.parse(t).id;
  r = await fetchImpl(`https://rupload.facebook.com/ig-api-upload/${IG_VER}/${box}`, { method: 'POST',
    headers: { Authorization: `OAuth ${tok}`, offset: '0', file_size: String(video.length) }, body: video });
  t = await r.text();
  if (!r.ok) return fail(r.status, t, '영상 바이트를 못 보냈다');
  const until = Date.now() + waitMs;
  let st = '';
  for (;;) {
    r = await fetchImpl(`${host}/${IG_VER}/${box}?fields=status_code,status&access_token=${encodeURIComponent(tok)}`);
    t = await r.text();
    if (!r.ok) return fail(r.status, t, '처리 상태를 못 물었다');
    st = JSON.parse(t).status_code || '';
    if (st === 'FINISHED') break;
    if (st === 'ERROR' || st === 'EXPIRED') return { ok: false, code: 7, say: `인스타그램이 영상을 처리하지 못했다 (${st}) — 길이·비율·코덱을 본다` };
    if (Date.now() >= until) return { ok: false, code: 3, say: `처리가 ${Math.round(waitMs / 60000)}분 안에 안 끝났다 (마지막 상태 ${st || '없음'}) — 그릇 ${box} 는 남아 있다` };
    await sleep(stepMs);
  }
  r = await fetchImpl(`${host}/${IG_VER}/${user}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: box, access_token: tok }).toString() });
  t = await r.text();
  if (!r.ok) return fail(r.status, t, '게시를 못 했다');
  const mid = JSON.parse(t).id;
  let url = '';
  try { r = await fetchImpl(`${host}/${IG_VER}/${mid}?fields=permalink&access_token=${encodeURIComponent(tok)}`); if (r.ok) url = JSON.parse(await r.text()).permalink || ''; } catch (_) {}
  return { ok: true, code: 0, id: mid, url };
}

// ── 묶음 ────────────────────────────────────────────────
export const SECRET_NAMES = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'INSTAGRAM_USER_ID', 'INSTAGRAM_ACCESS_TOKEN'];

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };

async function main() {
  const id = arg('id', 'linkpilot-01');
  const out = `${arg('out', 'data/_shorts/out')}/${id}`;
  const targets = uniq(String(arg('targets', 'youtube,instagram')).split(/[,\s]+/).filter((x) => TARGETS.includes(x)));
  const privacy = PRIVACY.includes(arg('privacy', 'private')) ? arg('privacy', 'private') : 'private';
  const again = arg('again', 'no') === 'yes';
  await mkdir(out, { recursive: true });
  const at = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); // Asia/Seoul (§5)
  const secrets = SECRET_NAMES.map((k) => String(process.env[k] || '').trim()).filter((v) => v.length >= 6);
  const log = [];
  let rec = {};
  try { rec = JSON.parse(await readFile(`${out}/_publish.json`, 'utf8')); } catch (_) {}
  const finish = async (code, head) => {
    log.unshift(`# 쇼츠 올리기 — ${id} · ${at} KST`, '', `판정 ${code} — ${head}`, '');
    const md = log.join('\n') + '\n', js = JSON.stringify(rec, null, 2) + '\n';
    if (secrets.some((k) => md.includes(k) || js.includes(k))) { console.error('✗ 기록에 열쇠 값이 섞였다 — 안 쓴다'); process.exit(9); }
    await writeFile(`${out}/_publish.md`, md); await writeFile(`${out}/_publish.json`, js); console.log(md); process.exit(code);
  };

  let script = null;
  try { script = JSON.parse(await readFile(`data/_shorts/scripts/${id}.json`, 'utf8')); } catch (_) {}
  const bad = checkPublish(script, arg('confirm', ''));
  if (bad) return finish(bad.code, bad.say);
  if (!targets.length) return finish(10, '올릴 곳이 없다 — youtube · instagram 중에서 고른다');
  let video;
  try { video = await readFile(arg('video', `${out}/final.mp4`)); } catch (_) { return finish(5, '영상 파일이 없다 — 먼저 «쇼츠 만들기»를 돌린다'); }
  if (video.length < 1000) return finish(5, '영상 파일이 비었다');

  let images = [];
  try { images = JSON.parse(await readFile(`${out}/_images.json`, 'utf8')); } catch (_) {}
  const m = meta(script, images);
  log.push(`- 제목: ${m.title}`, `- 영상: ${(video.length / 1048576).toFixed(2)} MB`, '');
  const codes = [];
  for (const tg of targets) {
    if (rec[tg] && rec[tg].id && !again) { log.push(`- ${tg}: 이미 올렸다 (${rec[tg].at} · ${rec[tg].url || rec[tg].id}) — 건너뛴다`); codes.push(0); continue; }
    let r;
    try { r = tg === 'youtube' ? await youtube({ video, script, images, privacy }) : await instagram({ video, script, images }); }
    catch (e) { r = { ok: false, code: 3, say: '부르다 끊겼다 — ' + clip(String(e && e.message), 120) }; }
    codes.push(r.code);
    if (r.ok) {
      rec[tg] = { id: r.id, url: r.url, at: `${at} KST`, ...(tg === 'youtube' ? { privacyAsked: r.privacyAsked, privacy: r.privacy } : {}) };
      log.push(`- ${tg}: 올렸다 — ${r.url || r.id}${tg === 'youtube' ? ` · 공개 범위 ${r.privacy || '모름'}` : ''}`);
      if (r.note) log.push(`  - ★ ${r.note}`);
    } else log.push(`- ${tg}: 판정 ${r.code} — ${r.say}`);
  }
  const worst = codes.find((c) => c !== 0) ?? 0;
  const done = targets.filter((t) => rec[t] && rec[t].id).length;
  return finish(worst, worst === 0 ? `올림 ${done}/${targets.length}` : `올림 ${done}/${targets.length} — 못 올린 곳의 까닭을 아래에 적었다`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
