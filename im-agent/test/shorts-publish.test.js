/* 쇼츠 올리기 — scripts/shorts-publish.mjs 〈2026-10-28 사장님: 「인스타그램, YouTube, 쇼츠 배포자동화까지 자동화 해줘」〉
 * 가짜 응답으로 갈래를 잰다: 게시 승인(승인 A + «게시») 없으면 안 올린다 · 열쇠 없으면 2 · 유튜브 이어 올리기(시작 → 바이트) ·
 * 합성 콘텐츠 표시 · 유튜브가 비공개로 잠그면 그 사실을 적는다 · 인스타 릴스(그릇 → rupload → 처리 → 게시) · 만료 열쇠는 4.
 * 실제 올리기는 Actions «쇼츠 올리기»에서만 돈다(여기엔 열쇠가 없다). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const load = () => import(path.join(__dirname, '..', '..', 'scripts', 'shorts-publish.mjs'));
const reply = (status, obj, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] || null }, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });
const SCRIPT = {
  company: '3M', brand: '글로벌 비즈니스 성공스토리', hiddenContributor: '스펜서 실버 — 3M 연구원', approvedA: true,
  lines: [{ text: '첫 줄입니다.', src: ['invent.org/a', 'en.wikipedia.org/b'] }, { text: '맺음입니다.', src: ['맺음말'] }],
};
const VIDEO = Buffer.alloc(5000, 7);
const YENV = { YOUTUBE_CLIENT_ID: 'cid-123456', YOUTUBE_CLIENT_SECRET: 'sec-123456', YOUTUBE_REFRESH_TOKEN: 'rt-1234567' };
const IENV = { INSTAGRAM_USER_ID: '1789', INSTAGRAM_ACCESS_TOKEN: 'EAAtoken123456' };

test('게시 승인이 없으면 안 올린다 — 승인 A · 확인 글자 «게시» 둘 다', async () => {
  const m = await load();
  assert.strictEqual(m.checkPublish(SCRIPT, '게시'), null);
  assert.strictEqual(m.checkPublish(SCRIPT, '').code, 6);
  assert.strictEqual(m.checkPublish(SCRIPT, 'yes').code, 6);
  assert.strictEqual(m.checkPublish({ ...SCRIPT, approvedA: false }, '게시').code, 6);
  assert.strictEqual(m.checkPublish(null, '게시').code, 10);
});

test('글은 대본에서만 만든다 — 제목 100자 · #Shorts · 출처는 주소 모양만 · AI 목소리 표기', async () => {
  const m = await load();
  const x = m.meta(SCRIPT);
  assert.ok(x.title.includes('3M') && x.title.includes('스펜서 실버') && /#Shorts/.test(x.title));
  assert.ok([...x.title].length <= 100);
  assert.ok(x.description.includes('invent.org/a') && !x.description.includes('- 맺음말'), '«맺음말» 같은 설명 글은 출처로 안 싣는다');
  assert.ok(/AI\(합성 음성\)/.test(x.description) && /AI\(합성 음성\)/.test(x.caption));
  assert.ok([...x.caption].length <= 2100);
});

test('유튜브 열쇠가 비면 2 — 부르지 않는다', async () => {
  const m = await load();
  let n = 0;
  const r = await m.youtube({ video: VIDEO, script: SCRIPT, env: {}, fetchImpl: async () => { n++; return reply(200, {}); } });
  assert.strictEqual(r.code, 2); assert.strictEqual(n, 0);
});

test('유튜브 이어 올리기 — 접속 열쇠 → 시작(합성 콘텐츠·비공개) → 바이트 · 비공개로 잠기면 그 사실을 적는다', async () => {
  const m = await load();
  const calls = [];
  const fetchImpl = async (u, o = {}) => {
    calls.push({ u, o });
    if (u === m.YT.token) return reply(200, { access_token: 'acc-1' });
    if (u.startsWith(m.YT.upload)) return reply(200, {}, { location: 'https://upload.example/session-1' });
    if (u === 'https://upload.example/session-1') return reply(200, { id: 'vid1', status: { privacyStatus: 'private', uploadStatus: 'uploaded' } });
    return reply(404, {});
  };
  const r = await m.youtube({ video: VIDEO, script: SCRIPT, privacy: 'public', env: YENV, fetchImpl });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.url, 'https://www.youtube.com/shorts/vid1');
  const init = JSON.parse(calls[1].o.body);
  assert.strictEqual(init.status.containsSyntheticMedia, true, 'AI 목소리 — 합성 콘텐츠 표시');
  assert.strictEqual(init.status.selfDeclaredMadeForKids, false);
  assert.strictEqual(init.status.privacyStatus, 'public');
  assert.strictEqual(calls[1].o.headers['X-Upload-Content-Length'], String(VIDEO.length));
  assert.strictEqual(calls[2].o.method, 'PUT'); assert.strictEqual(calls[2].o.body, VIDEO);
  assert.ok(/잠갔다/.test(r.note), '고른 public 인데 private 로 돌아오면 «공개됨»으로 안 적는다');
});

test('유튜브 갱신 열쇠 거부(invalid_grant)는 4 · 하루 몫(quotaExceeded)은 3', async () => {
  const m = await load();
  const a = await m.youtube({ video: VIDEO, script: SCRIPT, env: YENV, fetchImpl: async () => reply(400, { error: 'invalid_grant' }) });
  assert.strictEqual(a.code, 4);
  const b = await m.youtube({ video: VIDEO, script: SCRIPT, env: YENV, fetchImpl: async (u) => (u === m.YT.token ? reply(200, { access_token: 'x' }) : reply(403, { error: { errors: [{ reason: 'quotaExceeded' }] } })) });
  assert.strictEqual(b.code, 3);
});

test('인스타 릴스 — 그릇 → rupload → 처리 기다림 → 게시 · 열쇠 모양으로 주소를 고른다', async () => {
  const m = await load();
  assert.strictEqual(m.igHost('IGAAxyz'), 'https://graph.instagram.com');
  assert.strictEqual(m.igHost('EAAxyz'), 'https://graph.facebook.com');
  const calls = []; let polls = 0;
  const fetchImpl = async (u, o = {}) => {
    calls.push({ u, o });
    if (/\/1789\/media$/.test(u)) return reply(200, { id: 'box9' });
    if (u.startsWith('https://rupload.facebook.com/')) return reply(200, { success: true });
    if (/\/box9\?fields=status_code/.test(u)) return reply(200, { status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' });
    if (/\/1789\/media_publish$/.test(u)) return reply(200, { id: 'm55' });
    if (/\/m55\?fields=permalink/.test(u)) return reply(200, { permalink: 'https://www.instagram.com/reel/abc/' });
    return reply(404, {});
  };
  const r = await m.instagram({ video: VIDEO, script: SCRIPT, env: IENV, fetchImpl, sleep: async () => {} });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.url, 'https://www.instagram.com/reel/abc/');
  const box = new URLSearchParams(calls[0].o.body);
  assert.strictEqual(box.get('media_type'), 'REELS'); assert.strictEqual(box.get('upload_type'), 'resumable');
  assert.strictEqual(calls[1].o.headers.file_size, String(VIDEO.length));
  assert.strictEqual(calls[1].o.headers.Authorization, 'OAuth EAAtoken123456');
  assert.strictEqual(polls, 2);
});

test('인스타 만료 열쇠(190)는 4 · 처리 실패(ERROR)는 7 · 열쇠 없으면 2', async () => {
  const m = await load();
  const a = await m.instagram({ video: VIDEO, script: SCRIPT, env: IENV, fetchImpl: async () => reply(400, { error: { code: 190, message: 'expired' } }) });
  assert.strictEqual(a.code, 4);
  const b = await m.instagram({ video: VIDEO, script: SCRIPT, env: IENV, sleep: async () => {}, fetchImpl: async (u) => (/media$/.test(u) ? reply(200, { id: 'b' }) : /rupload/.test(u) ? reply(200, {}) : reply(200, { status_code: 'ERROR' })) });
  assert.strictEqual(b.code, 7);
  const c = await m.instagram({ video: VIDEO, script: SCRIPT, env: {} });
  assert.strictEqual(c.code, 2);
});

test('올리기 열쇠 다섯은 엔진(NAS)으로 안 퍼진다 — 이 잡에만 있고, 스크립트가 기록에 값이 섞였는지 직접 센다 (§2 · §4)', async () => {
  const m = await load();
  const fs = require('fs');
  const http = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'http.js'), 'utf8');
  const deploy = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'deploy-nas.yml'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'shorts-publish.mjs'), 'utf8');
  for (const k of m.SECRET_NAMES) {
    assert.ok(!http.includes(`'${k}'`), k + ' 를 엔진 가림 목록에 넣으면 배포가 NAS 로 싣게 된다');
    assert.ok(!deploy.includes(k), k + ' 가 배포 잡에 있다');
  }
  assert.ok(/secrets\.some\(\(k\) => md\.includes\(k\) \|\| js\.includes\(k\)\)/.test(src), '기록을 쓰기 전에 열쇠 값이 섞였는지 센다');
});

test('올리기는 «같은 판»의 사진 출처와 «지금» 본가지의 올린 기록을 읽는다 — 체크아웃의 옛 판으로 판단하지 않는다 (Codex #329)', () => {
  const fs = require('fs');
  const wf = (n) => fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', n), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const pub = wf('shorts-publish.yml');
  const make = wf('shorts-make.yml');
  assert.ok(/origin\/shorts-preview:\$IN_ID\/_images\.json/.test(pub), '영상과 같은 자리의 사진 출처를 가져온다');
  assert.ok(/git fetch -q origin "\$DEFAULT_BRANCH"/.test(pub) && /origin\/\$DEFAULT_BRANCH:data\/_shorts\/out\/\$IN_ID\/\$f/.test(pub), '올린 기록은 본가지 최신을 읽는다');
  assert.ok(pub.indexOf('origin/$DEFAULT_BRANCH:data/_shorts') < pub.indexOf('node scripts/shorts-publish.mjs'), '올리기 전에 읽는다');
  assert.ok(/cp "\$src\/_images\.json" "\$tmp\/"/.test(make) && /_images\\\.json\)\$/.test(make), '만들기가 사진 출처를 미리보기 가지에 함께 둔다');
});
