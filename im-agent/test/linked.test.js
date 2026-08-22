'use strict';
/**
 * linked.test.js — 자료를 **보관하지 않고 연결해서** 쓸 때 무엇을 잃지 않는가.
 *
 * 보관하지 않으면 잃는 것이 둘이다.
 *   ① 원본이 바뀌거나 지워져도 **문서는 그대로 멀쩡하다** — 근거만 사라진다
 *   ② 파일 대신 **열쇠(토큰)** 를 갖게 되는데, 그쪽이 새면 자료 한 건이 아니라
 *      드라이브 전체가 샌다
 *
 * 그래서 「연결이 되는가」가 아니라 **「무엇을 남기고 무엇을 안 남기는가」**를 검사한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const linked = require('../core/linked');
const storage = require('../connectors/storage');

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-linked-p-'));
  fs.mkdirSync(path.join(dir, '01_Project'), { recursive: true });
  fs.mkdirSync(path.join(dir, '02_Source_Data'), { recursive: true });
  return dir;
}
const REF = {
  provider: 'dropbox', fileId: 'id:AAA1', name: '사업계획서.pdf',
  rev: '0123456789ab', path: '/Deals/인천남동/사업계획서.pdf', bytes: 12,
};

/* ───────────── 참조 ───────────── */

test('연결: 판(rev)이 없으면 받지 않는다', () => {
  // 파일 ID 만 있으면 「그 파일」은 가리켜도 「그때 그 판」은 못 가리킨다.
  // 사용자가 나중에 고치면 근거가 조용히 달라지고 문서에는 표시가 안 남는다
  const r = storage.normalizeRef({ ...REF, rev: '' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /판\(rev\/version\)/);
});

test('연결: 모르는 저장소는 받지 않는다', () => {
  assert.equal(storage.normalizeRef({ ...REF, provider: 'mega' }).ok, false);
  storage.PROVIDER_IDS.forEach((id) => {
    assert.equal(storage.normalizeRef({ ...REF, provider: id }).ok, true, id);
  });
});

test('★ 연결: 참조에 토큰이 섞여 오면 거절한다', () => {
  for (const k of ['accessToken', 'refreshToken', 'token', 'authorization', 'secret']) {
    const r = storage.normalizeRef({ ...REF, [k]: 'sl.AbCdEf...' });
    assert.equal(r.ok, false, `${k} 가 통과했다`);
    assert.match(r.reason, /토큰/);
  }
});

test('★ 연결: 장부에 토큰이 절대 들어가지 않는다', () => {
  const p = tmpProject();
  linked.link(p, REF);
  // 장부를 손으로 오염시켜도 저장이 막혀야 한다
  const led = linked.read(p);
  led.items[0].refreshToken = 'sl.SECRET';
  assert.throws(() => linked.write(p, led), /refreshToken/);

  const raw = fs.readFileSync(path.join(p, '01_Project', 'linked.json'), 'utf8');
  linked.FORBIDDEN.forEach(k => assert.ok(!raw.includes(`"${k}"`), `장부에 ${k} 가 있다`));
});

/* ───────────── 보관하지 않는다 ───────────── */

test('★ 연결: 연결만으로는 아무것도 가져오지 않는다', () => {
  const p = tmpProject();
  const r = linked.link(p, REF);
  assert.equal(r.ok, true);
  // 프로젝트 폴더 어디에도 파일이 생기면 안 된다
  assert.deepEqual(fs.readdirSync(path.join(p, '02_Source_Data')), []);
  // 아직 읽지 않았으므로 지문이 없다 — **지금 지문을 지어내지 않는다**
  assert.equal(r.item.fingerprint, null);
  assert.deepEqual(linked.list(p).unread, ['dropbox:id:AAA1']);
});

test('★ 연결: 가져온 작업 사본은 프로젝트 폴더 밖에 있고, dispose 로 사라진다', async () => {
  const p = tmpProject();
  linked.link(p, REF);

  const m = await linked.materialize(p, async () => ({ ok: true, buf: Buffer.from('총사업비 2,846억원') }));
  assert.equal(m.files.length, 1);

  // ★ 프로젝트 폴더 안에 두면 지우는 것을 잊었을 때 **그대로 보관이 된다**
  assert.ok(!m.dir.startsWith(p), '작업 사본이 프로젝트 폴더 안에 있다');
  assert.equal(fs.existsSync(m.files[0].path), true);
  assert.deepEqual(fs.readdirSync(path.join(p, '02_Source_Data')), []);

  m.dispose();
  assert.equal(fs.existsSync(m.files[0].path), false, '작업 사본이 남았다');
  assert.equal(fs.existsSync(m.dir), false, '작업 폴더가 남았다');
});

test('★ 연결: 지웠다는 것을 기록에 남긴다', async () => {
  const p = tmpProject();
  linked.link(p, REF);
  const m = await linked.materialize(p, async () => ({ ok: true, buf: Buffer.from('x') }));
  m.dispose();
  // 「보관하지 않는다」는 확인할 수 있어야 하는 말이다
  const log = fs.readFileSync(path.join(p, '01_Project', 'linked-log.jsonl'), 'utf8');
  assert.match(log, /"action":"dispose"/);
});

test('연결: dispose 를 두 번 불러도 문제 없다', async () => {
  const p = tmpProject();
  linked.link(p, REF);
  const m = await linked.materialize(p, async () => ({ ok: true, buf: Buffer.from('x') }));
  assert.equal(m.dispose().removed, 1);
  assert.equal(m.dispose().removed, 0);
});

test('★ 연결: 사본을 남겨 두는 길을 코드가 거절한다', () => {
  const r = storage.keepCopy();
  assert.equal(r.ok, false);
  assert.equal(r.byDesign, true);
  // 「빠르니까 캐시해 두자」가 곧 보관이 된다
  assert.match(r.reason, /보관하지 않습니다/);
});

test('★ 연결: 남의 드라이브 원본을 우리가 재배포하지 않는다', () => {
  const r = storage.shareOutward();
  assert.equal(r.ok, false);
  assert.match(r.reason, /읽을 권한만/);
});

/* ───────────── 지문 ───────────── */

test('★ 연결: 제공자 해시를 그대로 믿지 않고 우리가 계산한다', async () => {
  // Dropbox content_hash · Box sha1 · Google md5 · OneDrive quickXor — 넷이 다르다.
  // 종류가 다르면 비교가 아예 안 되고, 구글 네이티브 문서는 해시가 없다
  const kinds = storage.PROVIDER_IDS.map(id => storage.PROVIDERS[id].hashKind);
  assert.ok(new Set(kinds).size > 1, '제공자 해시가 다 같다고 적혀 있다');

  const p = tmpProject();
  linked.link(p, { ...REF, providerHash: '믿지 않는 값' });
  const m = await linked.materialize(p, async () => ({ ok: true, buf: Buffer.from('내용') }));
  const item = linked.list(p).items[0];
  assert.equal(item.fingerprint.algo, 'sha256');
  assert.match(item.fingerprint.value, /^[0-9a-f]{64}$/);
  assert.notEqual(item.fingerprint.value, '믿지 않는 값');
  m.dispose();
});

test('★ 연결: 같은 판인데 내용이 달라지면 그 사실을 남긴다', async () => {
  const p = tmpProject();
  linked.link(p, REF);
  let body = '처음';
  const fetchOne = async () => ({ ok: true, buf: Buffer.from(body) });

  (await linked.materialize(p, fetchOne)).dispose();
  body = '바뀐 내용';                       // 판(rev)은 그대로인데 내용만 바뀌었다
  (await linked.materialize(p, fetchOne)).dispose();

  const item = linked.list(p).items[0];
  assert.ok(item.fingerprintChanged, '판이 같은데 내용이 바뀐 것을 못 잡았다');
  assert.notEqual(item.fingerprintChanged.was, item.fingerprintChanged.now);
});

/* ───────────── 원본이 바뀌거나 사라지면 ───────────── */

test('★ 연결: 원본이 바뀌면 대조에서 잡힌다', async () => {
  const p = tmpProject();
  linked.link(p, REF);
  (await linked.materialize(p, async () => ({ ok: true, buf: Buffer.from('x') }))).dispose();

  const same = await linked.verify(p, async () => ({ ok: true, rev: REF.rev }));
  assert.equal(same.ok, true);

  const moved = await linked.verify(p, async () => ({ ok: true, rev: 'ffffffffffff' }));
  assert.equal(moved.ok, false);
  assert.equal(moved.changed.length, 1);
  assert.equal(moved.changed[0].was, REF.rev);
});

test('★ 연결: 원본이 사라진 것과 확인 실패를 구분한다', async () => {
  const p = tmpProject();
  linked.link(p, REF);
  (await linked.materialize(p, async () => ({ ok: true, buf: Buffer.from('x') }))).dispose();

  const gone = await linked.verify(p, async () => ({ ok: false, missing: true }));
  assert.equal(gone.missing.length, 1);
  assert.equal(gone.errors.length, 0);

  // 권한 만료·네트워크 실패는 「없어졌다」가 아니다. 섞으면 멀쩡한 자료를 잃은 것으로 읽는다
  const down = await linked.verify(p, async () => ({ ok: false, reason: '토큰이 만료되었습니다' }));
  assert.equal(down.missing.length, 0);
  assert.equal(down.errors.length, 1);
});

/**
 * ★★ **모르는 것을 「바뀌었다」로 만들지 않는다** 〈2026-08-22 · 실측으로 잡았다〉.
 *
 * 위 시험들은 전부 `rev` 를 넣어 주는 가짜 함수를 쓴다. 그런데 **실제로 실려
 * 나가는 구현(`core/linked-fetch.js` `headLinked`)은 rev 를 안 준다** — 임시
 * 내려받기 주소로 HEAD 를 칠 뿐이라 알 방법이 없고, 그래서 일부러 `null` 을
 * 돌려준다("모르면 지어내지 않는다").
 *
 * 그 조합만 아무 시험도 안 밟고 있었다. 실제로 돌려 보니 `String(null)` 과
 * `String('r2')` 를 비교해서 **아무것도 안 바뀐 자료가 「바뀌었다」로** 나왔다.
 * 화면은 「원본이 달라졌으니 다시 검증하라」고 말했을 것이고, 사용자는 멀쩡한
 * 파일을 들여다봤을 것이다. **거짓 경보는 침묵보다 나쁘다** — 두어 번 겪으면
 * 확인 자체를 안 믿는다.
 */
test('★★ 연결: 판을 모르면 「바뀌었다」가 아니라 「확인 못 함」이다', async () => {
  const p = tmpProject();
  linked.link(p, REF);
  (await linked.materialize(p, async () => ({ ok: true, buf: Buffer.from('x') }))).dispose();

  // 실려 나가는 구현이 실제로 돌려주는 모양 그대로다
  const v = await linked.verify(p, async () => ({ ok: true, rev: null }));

  assert.equal(v.changed.length, 0,
    '판을 모르는 것을 「바뀌었다」로 냈다 — 멀쩡한 자료에 거짓 경보가 뜬다');
  assert.equal(v.unread.length, 1, '「확인 못 함」으로 안 갔다');
  assert.match(v.unread[0].reason || '', /판|rev/,
    '왜 확인 못 했는지를 안 적었다 — 사용자가 할 일을 정할 수 없다');
  assert.equal(v.ok, false, '확인 못 한 것을 통과로 냈다 — 그것이 가장 나쁘다');

  // 빈 문자열·undefined 도 같은 취급이다 (제공자마다 「없음」을 달리 준다)
  for (const empty of [undefined, '']) {
    const e = await linked.verify(p, async () => ({ ok: true, rev: empty }));
    assert.equal(e.changed.length, 0, `rev=${JSON.stringify(empty)} 를 「바뀌었다」로 냈다`);
    assert.equal(e.unread.length, 1, `rev=${JSON.stringify(empty)} 가 「확인 못 함」으로 안 갔다`);
  }
});

test('★★ 화면이 「확인 못 함」의 두 가지를 뭉치지 않는다', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const html = fs2.readFileSync(
    path2.join(__dirname, '..', 'ui', 'platform', 'files.html'), 'utf8');
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(code, /\(c\.unread \|\| \[\]\)[\s\S]{0,240}x\.reason/,
    '화면이 서버가 준 사유를 안 쓴다 — 방금 읽은 사람에게 「안 읽었다」고 말하게 된다');
});

test('★ 연결: 한 번도 안 읽은 자료는 통과시키지 않는다', async () => {
  const p = tmpProject();
  linked.link(p, REF);
  const v = await linked.verify(p, async () => ({ ok: true, rev: REF.rev }));
  assert.equal(v.ok, false, '지문이 없는 자료가 통과했다');
  assert.deepEqual(v.unread.map(u => u.key), ['dropbox:id:AAA1']);
});

test('★ 연결: 못 가져온 것을 조용히 건너뛰지 않는다', async () => {
  const p = tmpProject();
  linked.link(p, REF);
  linked.link(p, { ...REF, fileId: 'id:BBB2', name: '감정평가서.pdf' });

  const m = await linked.materialize(p, async (item) =>
    (item.fileId === 'id:BBB2' ? { ok: false, reason: '권한이 없습니다' } : { ok: true, buf: Buffer.from('x') }));

  assert.equal(m.files.length, 1);
  assert.equal(m.failed.length, 1, '실패가 사라지면 값이 조용히 빠지고 문서는 멀쩡해 보인다');
  assert.match(m.failed[0].reason, /권한/);
  m.dispose();
});

/* ───────────── 판이 올라가면 ───────────── */

test('★ 연결: 새 판이 와도 이전 판 기록을 지우지 않는다', () => {
  const p = tmpProject();
  linked.link(p, REF);
  const r = linked.link(p, { ...REF, rev: 'ffffffffffff' });
  assert.equal(r.replacedRev, REF.rev);

  const l = linked.list(p);
  assert.equal(l.items.length, 1, '지금 걸린 것은 새 판 하나여야 한다');
  assert.equal(l.items[0].rev, 'ffffffffffff');
  // 「그때는 이 판을 보고 썼다」가 남아야 한다
  assert.equal(l.history.length, 1);
  assert.equal(l.history[0].rev, REF.rev);
});

test('연결: 같은 판을 다시 연결해도 늘지 않는다', () => {
  const p = tmpProject();
  linked.link(p, REF);
  const again = linked.link(p, REF);
  assert.equal(again.already, true);
  assert.equal(linked.list(p).items.length, 1);
});

test('★ 연결: 연결을 끊는 것과 원본을 지우는 것은 다르다', () => {
  const p = tmpProject();
  linked.link(p, REF);
  const r = linked.unlink(p, 'dropbox:id:AAA1');
  assert.equal(r.ok, true);
  assert.equal(r.deletedOriginal, false, '남의 드라이브 파일을 지우지 않는다');
  assert.equal(linked.list(p).items.length, 0);
  assert.equal(linked.list(p).history.length, 1);
});

/* ───────────── 출처 ───────────── */

test('★ 연결: 출처가 「사본 보관 안 함」을 말한다', async () => {
  const p = tmpProject();
  linked.link(p, REF);
  (await linked.materialize(p, async () => ({ ok: true, buf: Buffer.from('x') }))).dispose();

  const c = linked.citation(linked.list(p).items[0]);
  assert.match(c, /Dropbox/);
  assert.match(c, /판 /);
  assert.match(c, /sha256/);
  // 원본이 사라졌을 때 「우리한테 있겠지」로 시간을 버리지 않게 한다
  assert.match(c, /사본 보관 안 함/);
});

test('★ 연결: 원본 바이트가 없는 문서는 그렇다고 적는다', () => {
  // 구글 문서·스프레드시트는 내보내야 바이트가 생기고, 다시 내보내면 달라질 수 있다
  const n = storage.normalizeRef({ ...REF, provider: 'gdrive', exported: true });
  assert.equal(n.value.exported, true);
  assert.match(storage.exportedNote(n.value), /재현되지 않습니다/);
  assert.equal(storage.exportedNote({ exported: false }), null);
});

/* ───────────── 열쇠 ───────────── */

test('★ 연결: 토큰을 안 갖는 길을 먼저 권한다', () => {
  assert.equal(storage.MODES.chooser.keepsToken, false);
  assert.equal(storage.MODES.folder.keepsToken, true);
  // 편한 쪽의 대가를 적어 둔다 — 안 적으면 편한 쪽만 고른다
  assert.match(storage.MODES.folder.bad, /드라이브 전체|범위 전체/);
});

test('★ 연결: 제공자마다 범위를 좁히는 법을 적어 둔다', () => {
  storage.PROVIDER_IDS.forEach((id) => {
    assert.ok(storage.SCOPE_NOTE[id] && storage.SCOPE_NOTE[id].length > 20, `${id}: 범위 안내가 없다`);
  });
  assert.match(storage.SCOPE_NOTE.gdrive, /drive\.file/);
  assert.match(storage.SCOPE_NOTE.dropbox, /App folder/);
});

test('★ 연결: 제공자 키가 로그 가리개 목록에 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'http.js'), 'utf8');
  storage.PROVIDER_IDS.forEach((id) => {
    const env = storage.PROVIDERS[id].tokenEnv;
    assert.ok(src.includes(env), `${env} 가 SECRET_ENV 에 없다 — 로그에 평문으로 남는다 (§2)`);
  });
});
