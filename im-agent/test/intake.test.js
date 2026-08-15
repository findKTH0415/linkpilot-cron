'use strict';
/**
 * 보고서 생성 입력(접수) 테스트.
 *
 * 여기가 새면 두 가지가 터진다:
 *   ① 파일명 하나로 프로젝트 폴더 밖에 파일을 쓴다 (`../../`)
 *   ② 지원하지 않는 형식을 올려 놓고 추출 단계에서야 안 된다는 걸 안다
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AGENT = path.join(__dirname, '..');
const { createHandlers: readHandlers } = require('../ui/api-router.cjs');
const { createHandlers: writeHandlers, MAX_FILE_BYTES } = require('../ui/report-api.cjs');
const ext02 = require('../agents/02-extraction');

const PLATFORM = path.join(AGENT, 'ui', 'platform');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');
const PRO = { name: '홍길동', planId: 'pro', status: 'active' };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function setup(user) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-intake-'));
  process.env.IM_AGENT_ROOT = root;
  const h = writeHandlers({
    agentRoot: root, agentModulePath: AGENT,
    authenticate: () => (user === undefined ? PRO : user),
  });
  return { root, h };
}

// ── 지원 형식은 단일 출처 ────────────────────────────────────

test('★ 화면이 지원 형식 목록을 복사해 두지 않는다', () => {
  const html = read('intake.html');
  // 확장자 목록이 화면에 박혀 있으면 추출기가 바뀌는 날부터 갈린다
  ['.docx', '.xlsx', '.pptx', '.hwp'].forEach((e) => {
    assert.ok(!html.includes("'" + e + "'"),
      `intake.html 에 '${e}' 이 박혀 있다 — GET /intake 로 받아야 한다`);
  });
});

test('GET /intake 가 추출기의 목록을 그대로 내려준다', async () => {
  const h = readHandlers({ agentModulePath: AGENT });
  const r = await h.intake();
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.supported.text, [...ext02.TEXT_EXT].sort());
  assert.deepStrictEqual(r.body.supported.office, Object.keys(ext02.ZIP_EXT).sort());
  assert.deepStrictEqual(r.body.unsupported, [...ext02.UNSUPPORTED_EXT].sort());
  assert.ok(r.body.assetTypes.some(t => t.id === 'datacenter'));
  assert.ok(r.body.maxBytesPerFile > 0 && r.body.maxBytesPerRequest > r.body.maxBytesPerFile);
});

test('PDF 가 "읽을 수 있음"으로 분류되지 않는다', async () => {
  const h = readHandlers({ agentModulePath: AGENT });
  const r = await h.intake();
  assert.ok(!r.body.supported.text.includes('.pdf'));
  assert.ok(!r.body.supported.office.includes('.pdf'));
  assert.ok(r.body.unsupported.includes('.pdf'), 'PDF 는 본문을 읽지 못한다고 알려야 한다');
});

// ── 프로젝트 생성 ────────────────────────────────────────────

test('요청문으로 프로젝트가 만들어진다', async () => {
  const { h, root } = setup();
  const r = await h.createProject({}, { request: '인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성' });
  assert.strictEqual(r.status, 201);
  assert.match(r.body.projectId, /^LP-DC-\d{4}-\d{3}$/, '자산유형이 프로젝트 번호에 반영된다');
  assert.strictEqual(r.body.templateId, 'datacenter');
  assert.ok(fs.existsSync(path.join(root, r.body.projectId, '02_Source_Data')));
});

test('★ 요청문에서 뽑은 값은 전부 미확인이다', async () => {
  const { h } = setup();
  const r = await h.createProject({}, { request: '인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성' });
  assert.ok(r.body.seeded.length > 0);
  r.body.seeded.forEach((f) => {
    assert.strictEqual(f.verified, false, '사용자가 말했다는 것은 문서로 확인됐다는 뜻이 아니다');
    assert.strictEqual(f.source, 'user_request');
  });
  assert.ok(r.body.seeded.some(f => f.key === 'capacity.it_load_mw' && f.value === 6.5));
});

test('★ 접수 단계에서 파이프라인을 돌리지 않는다', async () => {
  const { h, root } = setup();
  const r = await h.createProject({}, { request: '인천 남동공단 6.5MW 데이터센터 IM' });
  const dir = path.join(root, r.body.projectId);
  // 산출물이 만들어졌다면 자료도 없이 파이프라인이 돈 것이다
  assert.ok(!fs.existsSync(path.join(dir, '09_IM', 'im.md')),
    '자료가 없는데 IM 이 만들어지면 빈 값으로 채워진 문서가 나오고 비용만 나간다');
  assert.ok(!fs.existsSync(path.join(dir, '12_Final', 'im-a4.html')));
});

test('빈 요청문·너무 긴 요청문을 거부한다', async () => {
  const { h } = setup();
  assert.strictEqual((await h.createProject({}, { request: '' })).status, 400);
  assert.strictEqual((await h.createProject({}, { request: '짧음' })).status, 400);
  assert.strictEqual((await h.createProject({}, { request: 'x'.repeat(2001) })).status, 400);
});

test('자산유형을 직접 고르면 그대로 쓴다', async () => {
  const { h } = setup();
  const r = await h.createProject({}, { request: '새만금 100MW 태양광 발전사업 IM', assetType: 'solar' });
  assert.strictEqual(r.body.templateId, 'solar');
  assert.match(r.body.projectId, /^LP-SOL-/);
});

// ── 업로드 ───────────────────────────────────────────────────

test('★ 파일명으로 프로젝트 폴더 밖에 쓸 수 없다', async () => {
  const { h, root } = setup();
  const c = await h.createProject({}, { request: '인천 남동공단 6.5MW 데이터센터 IM' });
  const id = c.body.projectId;

  const r = await h.uploadSources({}, id, {
    files: [
      { name: '../../../etc/passwd', contentBase64: b64('hack') },
      { name: '/etc/shadow', contentBase64: b64('hack') },
      { name: 'a/../../b.txt', contentBase64: b64('hack') },
    ],
  });
  assert.strictEqual(r.status, 200);

  const dir = path.join(root, id, '02_Source_Data');
  const written = fs.readdirSync(dir);
  written.forEach((n) => {
    assert.ok(!n.includes('..') && !n.includes('/'), `폴더 밖으로 나가는 이름이 저장됐다: ${n}`);
  });
  // 프로젝트 폴더 바깥에 아무것도 생기지 않았다
  assert.deepStrictEqual(fs.readdirSync(root).filter(n => n !== id), []);
});

test('빈 파일명·점으로 시작하는 이름을 거부한다', async () => {
  const { h } = setup();
  const c = await h.createProject({}, { request: '인천 남동공단 6.5MW 데이터센터 IM' });
  const r = await h.uploadSources({}, c.body.projectId, {
    files: [{ name: '', contentBase64: b64('x') }, { name: '.env', contentBase64: b64('SECRET=1') }],
  });
  assert.strictEqual(r.body.saved.length, 0);
  assert.strictEqual(r.body.rejected.length, 2);
});

test('★ 읽지 못하는 형식도 저장하되 그렇다고 말한다', async () => {
  const { h } = setup();
  const c = await h.createProject({}, { request: '인천 남동공단 6.5MW 데이터센터 IM' });
  const r = await h.uploadSources({}, c.body.projectId, {
    files: [
      { name: '사업계획서.md', contentBase64: b64('연면적 : 52822 ㎡') },
      { name: '감정평가서.pdf', contentBase64: b64('%PDF fake') },
    ],
  });
  const md = r.body.saved.find(f => f.name === '사업계획서.md');
  const pdf = r.body.saved.find(f => f.name === '감정평가서.pdf');
  assert.strictEqual(md.readable, true);
  assert.strictEqual(md.note, null);
  assert.strictEqual(pdf.readable, false);
  assert.match(pdf.note, /본문을 읽지 못합니다/,
    '추출 단계에서야 알면 늦다 — 올린 직후에 말해야 한다');
});

test('빈 파일과 한도 초과 파일을 거부한다', async () => {
  const { h } = setup();
  const c = await h.createProject({}, { request: '인천 남동공단 6.5MW 데이터센터 IM' });
  const big = Buffer.alloc(MAX_FILE_BYTES + 1, 0x61).toString('base64');
  const r = await h.uploadSources({}, c.body.projectId, {
    files: [{ name: '빈파일.txt', contentBase64: '' }, { name: '큰파일.txt', contentBase64: big }],
  });
  assert.strictEqual(r.body.saved.length, 0);
  assert.match(r.body.rejected[0].reason, /빈 파일/);
  assert.match(r.body.rejected[1].reason, /너무 큽니다/);
});

test('없는 프로젝트에는 올릴 수 없다', async () => {
  const { h } = setup();
  const r = await h.uploadSources({}, 'LP-DC-2026-999', { files: [{ name: 'a.txt', contentBase64: b64('x') }] });
  assert.strictEqual(r.status, 404);
});

test('잘못된 프로젝트 ID 는 파일을 건드리기 전에 막는다', async () => {
  const { h } = setup();
  assert.strictEqual((await h.uploadSources({}, '../../etc', { files: [] })).status, 400);
});

// ── 권한 ─────────────────────────────────────────────────────

test('미인증·무료 회원은 접수할 수 없다', async () => {
  const anon = writeHandlers({ agentRoot: os.tmpdir(), agentModulePath: AGENT, authenticate: () => null });
  assert.strictEqual((await anon.createProject({}, { request: '데이터센터 IM 작성' })).status, 401);
  assert.strictEqual((await anon.uploadSources({}, 'LP-DC-2026-001', { files: [] })).status, 401);

  const free = writeHandlers({
    agentRoot: os.tmpdir(), agentModulePath: AGENT,
    authenticate: () => ({ planId: 'free', status: 'active' }),
  });
  assert.strictEqual((await free.createProject({}, { request: '데이터센터 IM 작성' })).status, 403);
});

// ── 화면 규약 ────────────────────────────────────────────────

test('화면이 script 태그 짝을 맞춘다', () => {
  const html = read('intake.html');
  assert.strictEqual((html.match(/<script\b/g) || []).length, (html.match(/<\/script>/g) || []).length);
});

test('화면이 innerHTML 을 쓰지 않는다 (파일명은 사용자 입력이다)', () => {
  const html = read('intake.html');
  assert.ok(!/\.innerHTML\s*=/.test(html));
});

test('화면에 내부 호스트가 들어가지 않는다', () => {
  assert.ok(!/\.ts\.net|synologynas|192\.168\./.test(read('intake.html')));
});

test('★ 읽기 라우터는 여전히 쓰기가 없다', () => {
  const src = fs.readFileSync(path.join(AGENT, 'ui', 'api-router.cjs'), 'utf8');
  assert.ok(!/router\.(post|put|patch|delete)\b/.test(src),
    '접수용 GET /intake 를 더하면서 쓰기가 섞이면 안 된다');
});

// ── 발행 주체 입력 ───────────────────────────────────────────

test('접수 화면이 현재 발행 주체를 받아 온다', async () => {
  const h = readHandlers({ agentModulePath: AGENT });
  const r = await h.intake();
  assert.ok(r.body.issuer, '화면이 폼을 채우려면 현재 값이 필요하다');
  assert.ok(r.body.issuerLimits && r.body.issuerLimits.en > 0, '길이 한도를 화면과 서버가 같이 본다');
});

test('★ 접수할 때 넣은 발행 주체가 프로젝트에 저장된다', async () => {
  const { h, root } = setup();
  const r = await h.createProject({}, {
    request: '인천 남동공단 6.5MW 데이터센터 IM',
    issuer: { en: 'Acme Capital Partners Co.,Ltd', kr: '(주)에이스캐피탈' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.issuerSaved, true);
  assert.strictEqual(r.body.issuer.en, 'Acme Capital Partners Co.,Ltd');

  const saved = JSON.parse(fs.readFileSync(
    path.join(root, r.body.projectId, '01_Project', 'issuer.json'), 'utf8'));
  assert.strictEqual(saved.kr, '(주)에이스캐피탈');
  assert.ok(saved.mark, '이니셜이 자동으로 만들어진다');
});

test('기본값으로 저장하면 다음 프로젝트가 물려받는다', async () => {
  const { h, root } = setup();
  await h.createProject({}, {
    request: '인천 남동공단 6.5MW 데이터센터 IM',
    issuer: { en: 'Acme Capital Partners Co.,Ltd' },
    issuerAsDefault: true,
  });
  assert.ok(fs.existsSync(path.join(root, 'issuer.json')), '저장소 기본값이 생겨야 한다');

  const second = await h.createProject({}, { request: '새만금 100MW 태양광 IM' });
  assert.strictEqual(second.body.issuerSaved, false, '두 번째는 따로 저장하지 않는다');
  assert.strictEqual(second.body.issuer.en, 'Acme Capital Partners Co.,Ltd', '기본값을 물려받는다');
});

test('★ 발행 주체를 안 넣으면 미설정으로 남는다 (지어내지 않는다)', async () => {
  const { h } = setup();
  const r = await h.createProject({}, { request: '인천 남동공단 6.5MW 데이터센터 IM' });
  assert.strictEqual(r.body.issuerSaved, false);
  assert.strictEqual(r.body.issuer.unset, true, '화면이 경고를 띄울 수 있어야 한다');
});

test('★ 회사명 없는 발행 주체는 거부하고 프로젝트도 만들지 않는다', async () => {
  const { h, root } = setup();
  const r = await h.createProject({}, {
    request: '인천 남동공단 6.5MW 데이터센터 IM',
    issuer: { kr: '국문만 있음' },
  });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /회사명/);

  // 400 을 돌려주면서 프로젝트 폴더는 남아 있으면, 사용자는 실패한 줄 아는데
  // 번호는 하나 소모되어 있다. 다음 성공 요청이 001 이 아니라 002 를 받는다
  assert.deepStrictEqual(fs.readdirSync(root).filter(n => n.startsWith('LP-')), [],
    '검증에 걸린 요청이 프로젝트를 남기면 안 된다');

  const ok = await h.createProject({}, {
    request: '인천 남동공단 6.5MW 데이터센터 IM',
    issuer: { en: 'Acme Capital Partners Co.,Ltd' },
  });
  assert.match(ok.body.projectId, /-001$/, '번호가 건너뛰지 않는다');
});

test('나중에 발행 주체를 고칠 수 있다', async () => {
  const { h, root } = setup();
  const c = await h.createProject({}, { request: '인천 남동공단 6.5MW 데이터센터 IM' });
  const id = c.body.projectId;

  const r = await h.saveIssuer({}, id, { issuer: { en: 'New Owner Co.,Ltd' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.issuer.en, 'New Owner Co.,Ltd');
  assert.strictEqual(r.body.needsRegenerate, false, '아직 문서가 없으면 다시 만들 것도 없다');

  const saved = JSON.parse(fs.readFileSync(path.join(root, id, '01_Project', 'issuer.json'), 'utf8'));
  assert.strictEqual(saved.en, 'New Owner Co.,Ltd');
});

test('★ 이미 만든 문서가 있으면 다시 만들어야 한다고 알린다', async () => {
  const { h, root } = setup();
  const c = await h.createProject({}, { request: '인천 남동공단 6.5MW 데이터센터 IM' });
  const id = c.body.projectId;
  fs.mkdirSync(path.join(root, id, '12_Final'), { recursive: true });
  fs.writeFileSync(path.join(root, id, '12_Final', 'im-a4.html'), '<html>옛 이름</html>');

  const r = await h.saveIssuer({}, id, { issuer: { en: 'New Owner Co.,Ltd' } });
  assert.strictEqual(r.body.needsRegenerate, true,
    '고쳤는데 옛 문서가 그대로면 고친 줄 안다');
});

test('미인증은 발행 주체를 고칠 수 없다', async () => {
  const anon = writeHandlers({ agentRoot: os.tmpdir(), agentModulePath: AGENT, authenticate: () => null });
  assert.strictEqual((await anon.saveIssuer({}, 'LP-DC-2026-001', { issuer: { en: 'X Co' } })).status, 401);
});

test('★ 화면이 회사명 입력란을 제공한다', () => {
  const html = read('intake.html');
  assert.match(html, /회사명 \(영문\)/, '발행 주체를 넣을 곳이 있어야 한다');
  assert.match(html, /국문 상호/);
  assert.match(html, /로고 이니셜/);
  assert.match(html, /앞으로 만드는 보고서에도/, '기본값으로 저장하는 선택지');
  assert.match(html, /대외 배포가 막힙니다/, '안 넣으면 어떻게 되는지 미리 알린다');
});
