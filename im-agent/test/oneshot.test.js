'use strict';
/**
 * oneshot.test.js — **한 번 읽고 버리는** 직접 업로드 (D-66)와
 * **폴더까지만** 받는 저장소 범위 (D-66).
 *
 * 1회성의 위험은 연결보다 크다. 연결 자료는 원본이 사용자 저장소에 남아 나중에
 * 대조할 수 있지만, 1회성은 **우리도 원본을 안 갖고 어디 있는지도 모른다.**
 * 그래서 「올라갔는가」가 아니라 **「못 하는 것을 말하는가」**를 검사한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const oneshot = require('../core/oneshot');
const storage = require('../connectors/storage');
const api = require('../ui/report-api.cjs');

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-oneshot-p-'));
  fs.mkdirSync(path.join(dir, '01_Project'), { recursive: true });
  fs.mkdirSync(path.join(dir, '02_Source_Data'), { recursive: true });
  return dir;
}
const F = (name, body) => ({ name, buf: Buffer.from(body, 'utf8') });

/* ───────────── 폴더까지만 ───────────── */

test('★ 범위: 드라이브 전체를 요구하는 범위는 거절한다', () => {
  // 넓게 받아도 동작은 똑같아서 잘못 등록한 것이 증상으로 안 드러난다
  const wide = storage.checkScope('gdrive', 'https://www.googleapis.com/auth/drive.readonly');
  assert.equal(wide.ok, false);
  assert.match(wide.reason, /폴더를 넘습니다/);

  const narrow = storage.checkScope('gdrive', 'https://www.googleapis.com/auth/drive.file');
  assert.equal(narrow.ok, true);
  assert.equal(narrow.verifiable, true);
});

test('★ 범위: OneDrive 도 조직 전체 범위를 거절한다', () => {
  assert.equal(storage.checkScope('onedrive', 'Files.Read.All offline_access').ok, false);
  assert.equal(storage.checkScope('onedrive', 'Files.Read.Selected offline_access').ok, true);
  assert.equal(storage.checkScope('onedrive', ['Sites.Read.All']).ok, false);
});

test('★★ 범위: 코드로 확인할 수 없는 것은 「확인했다」로 넘어가지 않는다', () => {
  // Dropbox 는 앱 타입(App folder / Full)이 범위를 정하는데 토큰 응답에 안 실린다.
  // Box 도 폴더 제한은 협업자 초대라 스코프에 안 나타난다
  ['dropbox', 'box'].forEach((id) => {
    const r = storage.checkScope(id, 'files.metadata.read files.content.read');
    assert.equal(r.verifiable, false, `${id}: 확인 가능하다고 되어 있다`);
    assert.match(r.reason, /사람이 확인/, `${id}: 못 막는다는 것을 안 말한다`);
  });
});

test('★ 범위: 콘솔에서 사람이 할 일을 목록으로 들고 있다', () => {
  assert.equal(storage.REGISTRATION.length, storage.PROVIDER_IDS.length);
  storage.REGISTRATION.forEach((r) => {
    assert.ok(r.checklist && r.checklist.length > 15, `${r.provider}: 체크리스트가 없다`);
    assert.equal(typeof r.verifiable, 'boolean');
  });
  assert.match(storage.SCOPES.dropbox.checklist, /App folder/);
  assert.match(storage.SCOPES.gdrive.checklist, /drive\.file/);
});

test('범위: 모르는 저장소는 통과시키지 않는다', () => {
  assert.equal(storage.checkScope('mega', 'anything').ok, false);
});

/* ───────────── 1회성 ───────────── */

test('★ 1회성: 받아서 지문만 남기고 파일은 버린다', () => {
  const p = tmpProject();
  const r = oneshot.accept(p, [F('사업계획서.pdf', '총사업비 2,846억원')]);
  assert.equal(r.ok, true);
  assert.equal(r.accepted.length, 1);
  assert.match(r.accepted[0].sha256, /^[0-9a-f]{64}$/);

  // 작업 사본은 프로젝트 폴더 밖이다
  assert.ok(!r.dir.startsWith(p), '작업 사본이 프로젝트 폴더 안에 있다');
  assert.deepEqual(fs.readdirSync(path.join(p, '02_Source_Data')), []);

  r.dispose();
  assert.equal(fs.existsSync(r.dir), false, '작업 폴더가 남았다');

  // 장부에는 남는다 — 「그 자료가 있었다」는 유일한 기록이다
  const l = oneshot.list(p);
  assert.equal(l.items.length, 1);
  assert.equal(l.items[0].retainedCopy, false);
  assert.equal(l.items[0].originalLocation, null);
});

test('★ 1회성: 다시 쓸 수 없다는 것을 목록이 말한다', () => {
  const p = tmpProject();
  oneshot.accept(p, [F('a.txt', 'x')]).dispose();
  assert.equal(oneshot.list(p).reusable, false,
    '화면이 「다시 올려야 합니다」를 띄울 근거가 없다');
});

test('★★ 1회성: 대조 함수를 만들지 않고 거절한다', () => {
  // verify() 가 있으면 「이상 없음」이 나오고 그것이 대조를 통과한 뜻으로 읽힌다
  assert.equal(typeof oneshot.verify, 'undefined', 'verify() 가 생겼다');
  const r = oneshot.cannotVerify();
  assert.equal(r.ok, false);
  assert.equal(r.byDesign, true);
  assert.match(r.reason, /어디 있는지도 모릅니다/);
  assert.ok(r.insteadDo, '못 한다고만 하고 무엇을 하면 되는지 안 적었다');
});

test('★ 1회성: 다시 쓰기를 코드가 거절한다', () => {
  const r = oneshot.cannotReuse();
  assert.equal(r.ok, false);
  assert.equal(r.byDesign, true);
  assert.match(r.insteadDo, /다시 올리거나|연결/);
});

test('★ 1회성: 출처가 연결 자료와 한눈에 갈린다', () => {
  const p = tmpProject();
  oneshot.accept(p, [F('감정평가서.pdf', 'x')]).dispose();
  const c = oneshot.citation(oneshot.list(p).items[0]);
  assert.match(c, /직접 올림 \(1회성\)/);
  assert.match(c, /sha256/);
  // ★ 연결 자료의 출처는 「사본 보관 안 함」까지만 적는다. 이쪽은 한 가지가 더 있다
  assert.match(c, /원본 재확인 불가/);

  const linkedCite = require('../core/linked').citation({
    provider: 'dropbox', name: 'a.pdf', rev: 'r1', readAt: '2026-08-17T00:00:00+09:00',
    fingerprint: { value: 'a'.repeat(64) },
  });
  assert.ok(!linkedCite.includes('원본 재확인 불가'), '연결 자료와 구분이 안 된다');
});

test('1회성: 이름이 겹쳐도 덮어쓰지 않는다', () => {
  const p = tmpProject();
  const r = oneshot.accept(p, [F('같은이름.txt', '첫째'), F('같은이름.txt', '둘째')]);
  assert.equal(r.files.length, 2);
  assert.notEqual(r.files[0].name, r.files[1].name);
  assert.notEqual(r.accepted[0].sha256, r.accepted[1].sha256);
  r.dispose();
});

test('1회성: 이름이 올바르지 않으면 받지 않는다', () => {
  const p = tmpProject();
  const r = oneshot.accept(p, [F('../../etc/passwd', 'x'), F('.hidden', 'y')]);
  // 경로 조작은 이름을 잘라 받고, 숨김 이름은 거절한다
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].name, 'passwd');
  assert.equal(r.rejected.length, 1);
  r.dispose();
});

test('1회성: 빈 파일은 받지 않는다', () => {
  const p = tmpProject();
  const r = oneshot.accept(p, [{ name: 'a.txt', buf: Buffer.alloc(0) }]);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected.length, 1);
  r.dispose();
});

test('★ 1회성: 지웠다는 것을 기록에 남긴다', () => {
  const p = tmpProject();
  oneshot.accept(p, [F('a.txt', 'x')]).dispose();
  const log = fs.readFileSync(path.join(p, '01_Project', 'oneshot-log.jsonl'), 'utf8');
  assert.match(log, /"action":"accept"/);
  assert.match(log, /"action":"dispose"/);
});

/* ───────────── 등급 ───────────── */

test('★ 등급: 자료(연결·1회성)는 무료다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'report-api.cjs'), 'utf8');
  assert.match(src, /const FILES_PLAN = 'free';/);
  // 연결·1회성 핸들러가 전부 그 상수를 쓴다 — 하나만 pro 로 남으면
  // 「무료인데 403」이 되고 원인이 화면에 안 뜬다
  /* ★ 〈2026-08-22 · D-82〉 넣는 길 셋은 로그인도 안 묻게 되어 `ANON` 이 붙었다.
     재는 것은 그대로다 — **전부 FILES_PLAN 을 쓰는가.** 하나만 pro 로 남으면
     「무료인데 403」이 되고 원인이 화면에 안 뜬다. */
  ['listLinked', 'linkSource', 'unlinkSource', 'verifyLinked', 'oneshotUpload', 'listOneshot']
    .forEach((fn) => {
      const at = src.indexOf(`async ${fn}(ctx`);
      assert.ok(at > 0, `${fn} 이 없다`);
      const head = src.slice(at, at + 260);
      assert.match(head, /gate\(ctx, FILES_PLAN[,)]/, `${fn}: 무료로 열려 있지 않다`);
    });
});

test('★ 등급: 자료를 잠그지 않는 이유가 코드에 적혀 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'report-api.cjs'), 'utf8');
  // 자료를 못 넣으면 보고서를 만들 수도 없다 — 잠그면 유료 전환을 막는 쪽이 된다
  assert.match(src, /자료를 못 넣으면 보고서를 만들 수도 없다/);
  assert.match(src, /보관을 하지 않으므로 잴 것이 없다/);
});

/* ───────────── ★ 붙지 않은 경로를 조용히 성공시키지 않는다 ───────────── */

function bareProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-guard-'));
  const id = 'LP-DC-2026-001';
  fs.mkdirSync(path.join(root, id, '01_Project'), { recursive: true });
  fs.mkdirSync(path.join(root, id, '02_Source_Data'), { recursive: true });
  return { root, id };
}
function h(root, extra) {
  return api.createHandlers(Object.assign({
    agentRoot: root, agentModulePath: path.join(__dirname, '..'),
    authenticate: () => ({ name: '테스트', planId: 'pro', status: 'active' }),
  }, extra || {}));
}

test('★★ 1회성: 읽는 경로가 없으면 받지 않는다 (501)', async () => {
  // 받아서 지문만 남기고 버리면 사용자는 올렸는데 보고서에 아무것도 안 실린다.
  // 그리고 보관하지 않으므로 **다시 쓸 수도 없다** — 자료를 잃는 것과 같다
  const p = bareProject();
  const r = await h(p.root).oneshotUpload({}, p.id, {
    files: [{ name: 'a.txt', contentBase64: Buffer.from('x').toString('base64') }],
  });
  assert.equal(r.status, 501);
  assert.match(r.body.error, /읽는 경로가 붙어 있지 않습니다/);
});

test('★★ 연결: **읽을 수단 없이** 연결을 받지 않는다', async () => {
  // 연결만 되고 읽히지 않으면 사용자는 자료를 넣었다고 믿는데 보고서에는 안 실린다.
  //
  // ★ 전에는 「내려받기 함수가 붙어 있나」로 봤다. 이제 엔진 기본 구현이 늘
  //   있으므로 그 검사는 **항상 통과한다** — 그대로 두면 안전장치가 죽는다.
  //   지금 재는 것은 **그 파일에 대한 접근권**이다.
  const p = bareProject();
  const r = await h(p.root).linkSource({}, p.id, {
    ref: { provider: 'dropbox', fileId: 'id:A', name: 'a.pdf', rev: 'r1' },
  });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /접근권이 없습니다/);
});

test('★★ 연결: 접근권이 오면 받고, **장부에는 안 남긴다**', async () => {
  const p = bareProject();
  const r = await h(p.root).linkSource({}, p.id, {
    ref: { provider: 'dropbox', fileId: 'id:A', name: 'a.pdf', rev: 'r1' },
    access: { url: 'https://example.invalid/tmp/abc' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.access && r.body.access.expiresAt, '언제까지 쓸 수 있는지 안 알려 준다');

  // ★★ 장부 파일 어디에도 주소가 없어야 한다. 장부는 오래 남는다
  const fs2 = require('fs');
  const path2 = require('path');
  const ledger = path2.join(p.root, p.id, '02_Source_Data', '.linked.json');
  const raw = fs2.existsSync(ledger) ? fs2.readFileSync(ledger, 'utf8') : '';
  assert.ok(!raw.includes('example.invalid'), '장부에 접근 주소가 남았다');
  assert.ok(!/access|token|secret/i.test(raw), '장부에 열쇠 비슷한 것이 남았다');
});

test('★ 1회성: 읽는 경로가 붙어 있으면 **읽고 나서** 지운다', async () => {
  const p = bareProject();
  let sawFiles = null;
  const r = await h(p.root, {
    extractOneshot: async (id, files) => {
      // 지우기 **전에** 불려야 한다 — 지우고 읽을 수는 없다
      sawFiles = files.map(f => ({ name: f.name, exists: fs.existsSync(f.path) }));
      return { facts: 3 };
    },
  }).oneshotUpload({}, p.id, {
    files: [{ name: '계획서.txt', contentBase64: Buffer.from('총사업비 2,846억원').toString('base64') }],
  });

  assert.equal(r.status, 200);
  assert.deepEqual(sawFiles, [{ name: '계획서.txt', exists: true }], '읽기 전에 파일이 지워졌다');
  assert.equal(r.body.removed, 1, '읽은 뒤 지우지 않았다');
  assert.deepEqual(r.body.read, { facts: 3 }, '읽은 결과를 안 돌려준다');
  assert.equal(r.body.reusable, false);
});

test('★ 1회성: 읽다가 실패해도 파일은 지운다', async () => {
  const p = bareProject();
  const r = await h(p.root, {
    extractOneshot: async () => { throw new Error('OCR 키가 없습니다'); },
  }).oneshotUpload({}, p.id, {
    files: [{ name: 'a.txt', contentBase64: Buffer.from('x').toString('base64') }],
  });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /OCR 키가 없습니다/);
  // 임시 폴더가 남으면 「보관하지 않는다」가 거짓이 된다
  const left = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('lp-oneshot-'));
  left.forEach((n) => {
    const d = path.join(os.tmpdir(), n);
    try { assert.equal(fs.readdirSync(d).length, 0, `작업 사본이 남았다: ${n}`); } catch (_) { /* 이미 지워졌다 */ }
  });
});
