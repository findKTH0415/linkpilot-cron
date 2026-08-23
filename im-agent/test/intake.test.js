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

/**
 * ★ 2026-08-16 부터 PDF·한글·옛 오피스는 본문을 읽는다 (pdftext/ole).
 *   못 읽는 것은 gif/tif/tiff 뿐이다 — **이 목록이 길어지면 그때 다시 본다.**
 */
test('읽는 방법이 형식마다 정해져 있다', async () => {
  const h = readHandlers({ agentModulePath: AGENT });
  const r = await h.intake();
  const by = {};
  r.body.formats.forEach((g) => g.ext.forEach((e) => { by[e] = g.id; }));

  assert.strictEqual(by['.pdf'], 'direct', 'PDF 는 텍스트 레이어를 직접 읽는다');
  assert.strictEqual(by['.hwp'], 'direct');
  assert.strictEqual(by['.hwpx'], 'direct', 'hwpx 는 ZIP 이라 docx 와 같은 방법으로 읽힌다');
  ['.doc', '.xls', '.ppt'].forEach(e => assert.strictEqual(by[e], 'direct', `${e} 가 direct 가 아니다`));
  ['.jpg', '.jpeg', '.png'].forEach(e => assert.strictEqual(by[e], 'scan', `${e} 가 scan 이 아니다`));
  ['.gif', '.tif', '.tiff'].forEach(e => assert.strictEqual(by[e], 'convert', `${e} 가 convert 가 아니다`));

  assert.deepStrictEqual(r.body.unsupported, ['.gif', '.tif', '.tiff'],
    '못 읽는 형식이 늘었다 — 늘릴 때는 왜인지 적는다');
});

test('★ 변환해야 하는 형식은 무엇으로 바꿀지까지 말한다', async () => {
  const h = readHandlers({ agentModulePath: AGENT });
  const r = await h.intake();
  const convert = r.body.formats.find(g => g.id === 'convert');
  assert.ok(convert.hint, '"못 읽습니다"만 말하면 사람은 무엇을 해야 할지 모른다');
  convert.ext.forEach((e) => {
    assert.match(convert.hint[e], /PNG|PDF/, `${e}: 무엇으로 바꿀지 안 적혀 있다`);
  });
});

test('★ 스캔 묶음은 키가 있어야 동작한다고 밝힌다', async () => {
  const h = readHandlers({ agentModulePath: AGENT });
  const before = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const r = await h.intake();
    const scan = r.body.formats.find(g => g.id === 'scan');
    assert.strictEqual(scan.needsKey, 'GEMINI_API_KEY');
    assert.strictEqual(r.body.ocrReady, false,
      '키가 없는데 "스캔도 읽습니다"라고만 하면 올려 놓고 값이 안 나온 이유를 모른다');
  } finally {
    if (before === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = before;
  }
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
  assert.strictEqual(pdf.readable, true, 'PDF 는 이제 본문을 읽는다');
  assert.strictEqual(pdf.how, 'pdf');
  assert.match(pdf.note, /스캔본이면/, '스캔본이면 어떻게 되는지 올린 직후에 말한다');

  const r2 = await h.uploadSources({}, c.body.projectId, {
    files: [{ name: '현장사진.tiff', contentBase64: b64('II*') }],
  });
  const tif = r2.body.saved[0];
  assert.strictEqual(tif.readable, false);
  assert.strictEqual(tif.how, 'convert');
  assert.match(tif.note, /PDF 나 PNG/, '못 읽으면 무엇으로 바꿀지까지 말한다');
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
  /* 2026-08-16 — 이니셜 입력란은 없앴다. 제출자 **로고 업로드**가 그 자리를 대신하고,
     이니셜은 로고가 없을 때의 자동 폴백이다(입력 안 받음). */
  assert.doesNotMatch(html, /로고 이니셜/, '이니셜 입력란은 없어야 한다 — 로고 업로드로 바뀌었다');
  assert.match(html, /로고 업로드/, '제출자 로고를 올릴 수 있어야 한다');
  /* 2026-08-17 — 어떤 이미지든 받아 자동 정규화(여백 트림·512px·200KB)해 서버 규칙에 맞춘다.
     그래서 accept 는 image/* 이고, 한도는 거부가 아니라 **맞추는 목표**다. */
  assert.match(html, /file\.accept = 'image\/\*'/, '어떤 이미지든 받는다 — 형식은 화면이 맞춘다');
  assert.match(html, /LOGO_MAX_BYTES = 200 \* 1024/, '서버 한도(200KB)를 목표로 줄인다');
  assert.match(html, /function trimBox/, '여백을 자동으로 잘라낸다');
  assert.match(html, /LOGO_MAX_EDGE = 512/, '긴 변을 512px 로 맞춘다');
  assert.doesNotMatch(html, /'파일을 읽지 못했습니다'/, '실패는 사유를 말해야 한다 — 뭉뚱그린 문구 금지');
  assert.match(html, /앞으로 만드는 보고서에도/, '기본값으로 저장하는 선택지');
  assert.match(html, /대외 배포가 막힙니다/, '안 넣으면 어떻게 되는지 미리 알린다');
});

/* ═════════ 발행 주체를 기억한다 〈2026-08-23 사장님 지시〉 ═════════ */

/**
 * ★★★ 사장님 지시 그대로:
 *   「1.발행 주체 입력은 신규 기본정보 입력시 삭제하지 않는 한 기억
 *     기존 발행주체는 목록 만들어 사용 반영될수 있도록 만들어줘」
 *
 * ★ 여기서 지키는 것 셋:
 *   ① 적다 만 것이 단계를 오가도 남는가 (초안)
 *   ② 서버 값을 받는 순간 그것이 지워지지 않는가 — **순서가 함정이다**
 *   ③ 쓴 것만 목록에 남는가. 적다 만 것을 넣으면 목록이 쓰레기가 된다
 */
test('★★★ 발행 주체를 초안에 남기고, 서버 값이 그것을 지우지 않는다', () => {
  const src = read('intake.html');

  /* ① 초안에 발행 주체가 들어간다 */
  const save = src.slice(src.indexOf('function saveDraft'), src.indexOf('function loadDraft'));
  assert.match(save, /issuer:/, '초안에 발행 주체를 안 남긴다 — 단계를 오가면 적은 것이 사라진다');

  /* ② ★★ **서버 값을 받은 뒤에 얹는다.** `adoptIssuer()` 가 `state.issuer` 를
     통째로 새로 만들므로, 그 전에 얹으면 대답이 오는 순간 사라진다 */
  const adopt = src.slice(src.indexOf('function adoptIssuer'), src.indexOf('function applyDraftIssuer'));
  assert.match(adopt, /applyDraftIssuer\(\)/,
    '서버 값을 채운 뒤 초안을 안 얹는다 — 적어 둔 것이 대답이 오는 순간 사라진다');

  /* ③ 빈 칸으로 서버 값을 덮지 않는다 — 안 적은 것과 지운 것은 다르다 */
  const apply = src.slice(src.indexOf('function applyDraftIssuer'), src.indexOf('function applyDraftIssuer') + 900);
  assert.match(apply, /!==\s*''/, '빈 칸으로 서버 값을 덮는다');

  /* ④ **쓴 것만** 기억한다 — 프로젝트를 만든 그 자리에서 */
  const create = src.slice(src.indexOf('function createProject'), src.indexOf('function createProject') + 1400);
  assert.match(create, /rememberIssuer\(/, '쓴 발행 주체를 목록에 안 남긴다');
});

test('★★ 쓰던 발행 주체 목록이 실제로 뜨고, 누르면 칸이 채워진다', () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;   // 크로미움이 없는 서버가 실제로 있다

  /* ★★★ **`file://` 에서는 `localStorage` 가 막혀 있다** 〈2026-08-23 · 두 번 헛돌았다〉.
   *   ① 그냥 재면 목록이 **늘 비어서** 검사가 아무것도 안 재고 초록이 된다.
   *   ② http 로 띄워 보려 했더니 `execFileSync` 가 이벤트 루프를 막아 그 서버가
   *      영영 응답을 못 하고 **검사가 멈췄다.**
   *   ★ 그래서 **저장소를 가짜로 세워 준다.** 재려는 것은 브라우저의 저장소가
   *     아니라 **화면이 그 값을 어떻게 쓰는가**이므로 이것으로 충분하다. */
  const store = {
    'lp.intake.issuers': JSON.stringify([
      { en: 'Acme Capital Partners Co.,Ltd', kr: '(주)에이스', tag: 'REAL ASSET', logo: '' },
    ]),
    'lp.intake.draft': JSON.stringify({
      request: '', assetType: '', issuer: { en: '적다 만 회사', kr: '', tag: '' },
    }),
  };

  const seed = `<script>
    (function () {
      var m = ${JSON.stringify(store)};
      var fake = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
        setItem: function (k, v) { m[k] = String(v); },
        removeItem: function (k) { delete m[k]; },
      };
      try { Object.defineProperty(window, 'localStorage', { value: fake, configurable: true }); } catch (e) {}
    }());
  </script>`;

  const probe = `
    <div id="lpprobe"></div>
    <script>
    setTimeout(function () {
      var o = {}, val = function () {
        return [].slice.call(document.querySelectorAll('input[type=text]'))
          .map(function (n) { return n.value; }).filter(Boolean);
      };
      o.before = val();
      var chip = document.querySelector('.iss-chip__b');
      o.chip = chip ? chip.textContent : null;
      o.forget = !!document.querySelector('.iss-chip__x');
      if (!chip) { document.getElementById('lpprobe').textContent = JSON.stringify(o); return; }
      chip.click();
      setTimeout(function () {
        o.after = val();
        document.getElementById('lpprobe').textContent = JSON.stringify(o);
      }, 250);
    }, 500);
    </script>`;

  const src = read('intake.html');
  const i = src.indexOf('<script');
  let page = src.slice(0, i) + seed + src.slice(i);
  /* 서버 없이도 카드가 그려지게 심는다 — 값을 지어내는 것이 아니라 **빈 판**이다 */
  page = page.replace('window.LINKPILOT_INTAKE = {',
    'window.LINKPILOT_INTAKE = {\n  preload: { formats: [], issuer: { unset: true }, issuerLimits: {},'
    + ' maxBytesPerFile: 52428800, maxBytesPerRequest: 104857600, assetTypes: [] },');
  page = page.replace('</body>', probe + '</body>');

  /* ★ 화면 폴더 안에 쓴다 — 옆의 `.js` 를 상대경로로 부르기 때문이다 */
  const name = '.lp-issuer-probe.html';
  const at = path.join(PLATFORM, name);
  fs.writeFileSync(at, page);
  try {
    const dom = renderDom(findBrowser(), at, 60000);
    const m = /<div id="lpprobe">([^<]*)<\/div>/.exec(dom);
    assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 화면이 그려지지 않았다');
    const r = JSON.parse(m[1]);

    /* ① 적다 만 것이 살아 있다 — 단계를 오가도 사라지지 않는다 */
    assert.deepStrictEqual(r.before, ['적다 만 회사'],
      `단계를 오가면 적은 것이 사라진다 — 본 것: ${JSON.stringify(r.before)}`);

    /* ② 목록이 실제로 뜬다 */
    assert.match(String(r.chip), /Acme Capital Partners/, '쓰던 발행 주체 목록이 안 뜬다');
    assert.ok(r.forget, '목록에서 지우는 길이 없다 — 잘못 적은 것이 영영 남는다');

    /* ③ 누르면 **세 칸이 다** 채워진다. 회사명만 채우면 국문·태그를 다시 쳐야 한다 */
    assert.deepStrictEqual(r.after,
      ['Acme Capital Partners Co.,Ltd', '(주)에이스', 'REAL ASSET'],
      `골랐는데 칸이 다 안 채워진다 — 본 것: ${JSON.stringify(r.after)}`);
  } finally {
    fs.rmSync(at, { force: true });
  }
});

test('★ 2단계에서 「올릴 수 있는 자료」 카드를 뺐다 (사장님 지시)', () => {
  const src = read('intake.html');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/function formatCard/.test(code), '「올릴 수 있는 자료」 카드가 아직 있다');
  assert.ok(!/formatCard\(\)/.test(code), '아직 그 카드를 부른다');
});
