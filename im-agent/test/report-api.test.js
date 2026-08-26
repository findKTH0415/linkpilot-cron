'use strict';
/**
 * 보고서 생성 API 테스트.
 *
 * 이 API 는 파일을 쓰고, LLM 을 호출하고, 공공데이터 쿼터를 소모한다.
 * 인증·플랜·사양확정 중 하나라도 새면 돈이 나가거나 검증 안 된 문서가 만들어진다.
 * 화면(reports.html)이 막는 것과 별개로 여기서 다시 막아야 한다 —
 * 화면은 사용자가 고칠 수 있다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const API = require('../ui/report-api.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'im-reports-'));
}
function makeProject(root, id) {
  const dir = path.join(root, id, '01_Project');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'),
    JSON.stringify({ name: '테스트 프로젝트', assetType: '데이터센터', status: 'draft' }));
  return path.join(root, id);
}

const PRO = { name: '홍길동', planId: 'pro', status: 'active' };
const FREE = { name: '홍길동', planId: 'free', status: 'active' };
const ID = 'LP-DC-2026-001';

function handlers(root, user, extra) {
  return API.createHandlers(Object.assign({
    agentRoot: root,
    authenticate: () => user,
  }, extra || {}));
}

// ── 마운트 자체가 막힌다 ──────────────────────────────────────────

test('★ 인증 함수가 없으면 마운트 시점에 예외 (fail closed)', () => {
  assert.throws(() => API.createHandlers({ agentRoot: '/tmp' }), /authenticate/,
    '생성 시점이 아니라 마운트 시점에 막아야 한다 — "나중에 붙이지"가 그대로 배포된다');
  assert.throws(() => API.createHandlers({}), /인증 없이/);
});

// ── 인증·플랜 ─────────────────────────────────────────────────────

test('미인증은 401', async () => {
  const root = tmpRoot();
  const h = handlers(root, null);
  assert.strictEqual((await h.listReports({}, ID)).status, 401);
  assert.strictEqual((await h.generate({}, ID, {})).status, 401);
  fs.rmSync(root, { recursive: true, force: true });
});

test('무료 회원은 403', async () => {
  const root = tmpRoot();
  const h = handlers(root, FREE);
  const r = await h.listReports({}, ID);
  assert.strictEqual(r.status, 403);
  /* ★ D-71 결정(2026-08-22) 문구를 지킨다 — 「무엇이 되고 무엇이 안 되는가」와
   *   「어디로 가면 되는가」가 한 줄에 다 있어야 한다. 앞 판은 등급 이름만
   *   말해서, 무료로 무엇을 할 수 있는지가 화면 어디에도 없었다. */
  assert.match(r.body.error, /무료 계정은 테스트만/);
  assert.match(r.body.error, /Pro 플랜부터/);
  assert.match(r.body.error, /멤버십/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('만료된 유료 회원도 403', async () => {
  const root = tmpRoot();
  const h = handlers(root, { name: '홍길동', planId: 'pro', status: 'expired' });
  assert.strictEqual((await h.listReports({}, ID)).status, 403);
  fs.rmSync(root, { recursive: true, force: true });
});

test('★ 모르는 플랜 코드·정보 없음은 통과시키지 않는다', async () => {
  const root = tmpRoot();
  for (const planId of ['enterprise-v2', undefined, null, '']) {
    const h = handlers(root, { name: '홍길동', planId, status: 'active' });
    const r = await h.listReports({}, ID);
    assert.strictEqual(r.status, 403, `planId=${planId} 가 통과했다`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('★ 종류별 플랜을 서버에서 다시 본다', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  const h = handlers(root, { name: '홍길동', planId: 'basic', status: 'active' },
    { startRun: () => ({ runId: 'r1' }) });
  const r = await h.generate({}, ID, { docType: 'validation' });
  assert.strictEqual(r.status, 403, 'Basic 은 보고서를 만들 수 없다');
  assert.match(r.body.error, /pro/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('★ 어떤 보고서도 Pro 를 넘겨 요구하지 않는다 (외부 업무지침 §2)', () => {
  // 지침이 '보고서 생성 (Pro)' 로 협력사에 배포되어 있다.
  // 한 종류라도 Business 를 요구하면 Pro 회원이 문서대로 눌렀다가 403 을 받는다.
  const rank = API.PLAN_RANK;
  for (const [docType, need] of Object.entries(API.DOC_PLANS)) {
    assert.ok(rank[need] <= rank.pro,
      `${docType} 이 ${need} 를 요구한다 — 지침(§2 보고서 생성 = Pro)과 어긋난다`);
  }
});

test('경로 조작을 막는다', async () => {
  const root = tmpRoot();
  const h = handlers(root, PRO);
  for (const bad of ['../../etc/passwd', 'LP-DC-2026-001/../..', 'x']) {
    assert.strictEqual((await h.listReports({}, bad)).status, 400);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

// ── 사양 ──────────────────────────────────────────────────────────

test('★ 만들 수 없는 형식은 저장 단계에서 거부한다', async () => {
  // ★★ **PDF 는 이제 통과한다** 〈2026-08-26 · D-128〉.
  //   이 검사는 「PDF 생성 불가」를 굳혀 두고 있었는데, 그 사실이 바뀌었다.
  //   `core/pdf.js`(D-53)가 헤드리스 크로미움으로 만들고 `pipeline.js` 가 부르고
  //   데모 산출물에 `12_Final/im-a4.pdf` 가 실제로 있다.
  //   **검사가 옛 사실을 지키고 있으면, 고친 사람이 검사를 의심하게 된다.**
  //   그래서 여기서 「PDF 는 통과한다」를 함께 고정한다 — 누가 다시
  //   `supported: false` 로 되돌리면 이 줄이 빨개진다.
  const root = tmpRoot(); makeProject(root, ID);
  const h = handlers(root, PRO);

  const pdf = await h.saveSpec({}, ID, { docType: 'im', formats: ['html', 'pdf'] });
  assert.notStrictEqual(pdf.status, 400,
    'PDF 는 실제로 만들어진다 — 거부하면 되는 기능을 못 쓰게 된다 (D-128)');

  const hwp = await h.saveSpec({}, ID, { docType: 'im', formats: ['hwp'] });
  assert.match(hwp.body.error, /HWP/);

  const unknown = await h.saveSpec({}, ID, { docType: 'im', formats: ['doc'] });
  assert.match(unknown.body.error, /알 수 없는 형식/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('지원 형식은 저장된다', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  const h = handlers(root, PRO);
  const r = await h.saveSpec({}, ID, { docType: 'im', formats: ['html', 'md'], targetPages: 40, pageSize: 'A4' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.spec.targetPages, 40);
  assert.strictEqual(r.body.spec.locked, false, '저장만으로 확정되지 않는다');
  assert.strictEqual(r.body.spec.confirmed, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('★ 확정은 인증된 사람 이름으로만 — AI 이름은 거부된다', async () => {
  const root = tmpRoot(); makeProject(root, ID);

  await handlers(root, PRO).saveSpec({}, ID, { docType: 'im', formats: ['html'], targetPages: 40 });

  // 서비스 계정 이름으로는 확정할 수 없다
  const bot = handlers(root, { name: 'claude-agent', planId: 'pro', status: 'active' });
  const r = await bot.confirmSpec({}, ID, {});
  assert.strictEqual(r.status, 409);
  assert.match(r.body.error, /사람만/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('사람이 확정하면 LOCKED', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  const h = handlers(root, PRO);
  await h.saveSpec({}, ID, { docType: 'im', formats: ['html'], targetPages: 40 });
  const r = await h.confirmSpec({}, ID, {});
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.spec.locked, true);
  assert.strictEqual(r.body.spec.confirmedBy, '홍길동');
  fs.rmSync(root, { recursive: true, force: true });
});

// ── 생성 ──────────────────────────────────────────────────────────

test('★ 사양 확정 전에는 생성하지 않는다 (화면과 별개로 서버가 막는다)', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  let started = 0;
  const h = handlers(root, PRO, { startRun: () => { started++; return { runId: 'r1' }; } });

  const noSpec = await h.generate({}, ID, { docType: 'im' });
  assert.strictEqual(noSpec.status, 409);
  assert.match(noSpec.body.error, /사양이 없습니다/);

  await h.saveSpec({}, ID, { docType: 'im', formats: ['html'], targetPages: 40 });
  const notLocked = await h.generate({}, ID, { docType: 'im' });
  assert.strictEqual(notLocked.status, 409);
  assert.match(notLocked.body.error, /확정되지 않았습니다/);

  assert.strictEqual(started, 0, '확정 전에는 실행기를 부르지 않는다 — 돈이 나간다');
  fs.rmSync(root, { recursive: true, force: true });
});

test('확정 후 생성은 202 로 접수된다', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  const calls = [];
  const h = handlers(root, PRO, { startRun: (id, spec, user) => { calls.push({ id, by: user.name }); return { runId: 'r9' }; } });

  await h.saveSpec({}, ID, { docType: 'im', formats: ['html'], targetPages: 40 });
  await h.confirmSpec({}, ID, {});
  const r = await h.generate({}, ID, { docType: 'im' });

  assert.strictEqual(r.status, 202);
  assert.strictEqual(r.body.run.runId, 'r9');
  assert.deepStrictEqual(calls, [{ id: ID, by: '홍길동' }]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('★ 실행기가 없으면 501 — 없는 기능을 있는 척하지 않는다', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  const h = handlers(root, PRO);   // startRun 미주입
  await h.saveSpec({}, ID, { docType: 'im', formats: ['html'], targetPages: 40 });
  await h.confirmSpec({}, ID, {});
  const r = await h.generate({}, ID, { docType: 'im' });
  assert.strictEqual(r.status, 501);
  assert.match(r.body.error, /연결되지 않았습니다/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('실행기가 던져도 500 으로 감싸고 죽지 않는다', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  const h = handlers(root, PRO, { startRun: () => { throw new Error('큐 연결 실패'); } });
  await h.saveSpec({}, ID, { docType: 'im', formats: ['html'], targetPages: 40 });
  await h.confirmSpec({}, ID, {});
  const r = await h.generate({}, ID, { docType: 'im' });
  assert.strictEqual(r.status, 500);
  assert.match(r.body.error, /큐 연결 실패/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── 산출물 목록 ───────────────────────────────────────────────────

test('★ 산출물은 파일이 실제로 있는 것만 낸다', async () => {
  const root = tmpRoot();
  const dir = makeProject(root, ID);
  fs.mkdirSync(path.join(dir, '09_IM'), { recursive: true });
  fs.writeFileSync(path.join(dir, '09_IM/im.md'), '# IM');

  const h = handlers(root, PRO);
  const r = await h.listReports({}, ID);

  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.files.map(f => f.id), ['im'],
    '없는 파일을 목록에 넣으면 "완료"로 보인다');
  assert.ok(r.body.files[0].at, '생성 시각이 있어야 한다');
  assert.match(r.body.files[0].at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.ok(r.body.files[0].bytes > 0);

  fs.rmSync(root, { recursive: true, force: true });
});

test('산출물이 하나도 없어도 죽지 않는다', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  const r = await handlers(root, PRO).listReports({}, ID);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.files, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('배포 차단 여부를 목록과 함께 준다', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  const r = await handlers(root, PRO).listReports({}, ID);
  assert.ok(r.body.distribution, '차단 상태가 없으면 화면이 전부 완료로 보인다');
  assert.strictEqual(typeof r.body.distribution.blocked, 'boolean');
  fs.rmSync(root, { recursive: true, force: true });
});

// ── 읽기 전용 라우터와의 분리 ─────────────────────────────────────

test('★ 읽기 전용 라우터는 여전히 쓰기가 없다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'api-router.cjs'), 'utf8');
  assert.ok(!/router\.(post|put|patch|delete)/.test(src),
    '생성 API 를 대시보드 라우터에 얹으면 읽기와 같은 권한으로 돈 드는 동작이 열린다');
});

// ── 산출물 파일 내려주기 (B-8) ────────────────────────────────────
//
// 지침 §7-3 이 [인쇄 · PDF 저장]을 안내하므로 협력사 눈에는 이미 있는 기능이다.
// 여는 경로가 없어서 안내만 뜨던 것을 열었다 — 그래서 여기가 새면 안 된다.

function withOutput(root, id, rel, body) {
  const file = path.join(root, id, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

test('산출물 파일을 내려준다', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  withOutput(root, ID, '12_Final/im-a4.html', '<h1>IM</h1>');
  const r = await handlers(root, PRO).getFile({}, ID, '12_Final/im-a4.html');
  assert.strictEqual(r.status, 200);
  assert.ok(r.file.endsWith(path.join('12_Final', 'im-a4.html')));
  assert.match(r.contentType, /text\/html/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('★ 목록에 없는 경로는 내려주지 않는다 (경로를 조립하지 않는다)', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  const h = handlers(root, PRO);
  for (const rel of [
    '../../etc/passwd', '12_Final/../../../etc/passwd', '01_Project/issuer.json',
    '12_Final/im-a4.html/../../../secret', '', null,
  ]) {
    const r = await h.getFile({}, ID, rel);
    assert.strictEqual(r.status, 400, `${rel} 가 통과했다`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('★ HTML 을 그냥 서빙하지 않는다 (업로드 문서에서 온 글자가 실행되면 안 된다)', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  withOutput(root, ID, '12_Final/im-a4.html', '<script>fetch("/api/steal")</script>');
  const r = await handlers(root, PRO).getFile({}, ID, '12_Final/im-a4.html');
  assert.match(r.headers['Content-Security-Policy'], /sandbox/,
    'IM 본문은 업로드된 문서에서 온 글자를 담는다 — 이용자 세션 권한으로 스크립트가 돌면 안 된다');
  assert.strictEqual(r.headers['X-Content-Type-Options'], 'nosniff');
});

test('아직 없는 파일은 404', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  const r = await handlers(root, PRO).getFile({}, ID, '09_IM/im.md');
  assert.strictEqual(r.status, 404);
  fs.rmSync(root, { recursive: true, force: true });
});

test('미인증·무료 회원은 파일도 못 받는다', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  withOutput(root, ID, '09_IM/im.md', '# IM');
  assert.strictEqual((await handlers(root, null).getFile({}, ID, '09_IM/im.md')).status, 401);
  assert.strictEqual((await handlers(root, FREE).getFile({}, ID, '09_IM/im.md')).status, 403);
  fs.rmSync(root, { recursive: true, force: true });
});

test('★ 배포가 막힌 산출물은 파일도 막는다', async () => {
  const root = tmpRoot(); makeProject(root, ID);
  withOutput(root, ID, '09_IM/im.md', '# IM');
  const h = API.createHandlers({
    agentRoot: root,
    authenticate: () => PRO,
    agentModulePath: path.join(__dirname, '..'),
  });
  // GATE 를 차단으로 만든다 — 목록에서는 '배포 차단'인데 파일은 열리면
  // 검증 GATE 가 아무 의미도 없다
  const gate = require('../core/gate');
  const real = gate.check;
  gate.check = () => ({ blocked: true, reasons: ['테스트 차단'] });
  try {
    const r = await h.getFile({}, ID, '09_IM/im.md');
    assert.strictEqual(r.status, 403);
    assert.match(r.body.error, /검증/);
  } finally {
    gate.check = real;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('★ 화면이 서버 경로로 되돌아간다 (fileUrl 이 없어도 열린다)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'reports.html'), 'utf8');
  assert.match(html, /function fileUrlFor/, '본체가 fileUrl 을 안 줘도 열려야 한다');
  assert.match(html, /\/file\?rel=/, 'API 경로를 쓴다');
  assert.ok(!/여는 경로를 본체에 연결하세요/.test(html),
    '지침이 약속한 기능이 "연결하세요" 안내로 끝나면 협력사 눈에는 고장이다');
});
