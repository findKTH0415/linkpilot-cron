'use strict';
/**
 * linked-pipeline.test.js — 연결 자료가 **실제로 보고서 생성에 읽히는가** (플랫폼-연결-지시서 §6).
 *
 * 배포-지시서 §2 8번이 잡은 실패: `linked.materialize` 를 만들어 두고 아무도 안 불렀다.
 * 이 저장소에 같은 실패가 두 번 있었다(D-48 · D-62). 그래서 「함수가 있다」가 아니라
 * **「파이프라인이 그 함수를 부르고, 읽은 뒤 지우고, 못 읽은 것을 말하는가」**를 검사한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'im-linked-pipe-'));
process.env.IM_AGENT_ROOT = ROOT;
process.env.IM_AGENT_OFFLINE = '1';

const store = require('../core/store');
const linked = require('../core/linked');
const pipeline = require('../pipeline');

const REF = (name, rev) => ({
  provider: 'dropbox', fileId: 'id:' + name, name, rev,
  path: '/Deals/x/' + name, bytes: 100,
});

async function freshProject() {
  const r = await pipeline.run({ request: '연결 자료 파이프라인 시험 IM 작성', log: () => {} });
  return { projectId: r.projectId, dir: store.projectDir(r.projectId) };
}

test('§6-1 파이프라인이 연결 자료를 실제로 가져와 읽고, 끝나면 지운다', async () => {
  const { projectId, dir } = await freshProject();
  assert.ok(linked.link(dir, REF('연결자료.txt', 'r1')).ok);
  assert.ok(linked.link(dir, REF('사라진자료.txt', 'r2')).ok);

  const calls = [];
  let tmpDirSeen = null;
  const fetchLinked = async (item) => {
    calls.push(item.name);
    if (item.name === '사라진자료.txt') return { ok: false, reason: '원본이 지워졌습니다' };
    return { ok: true, buf: Buffer.from('총사업비 1,234억원\n연면적 52,822㎡\n', 'utf8') };
  };
  const logs = [];
  const r = await pipeline.run({ projectId, fetchLinked, log: (m) => { logs.push(m); const mm = /임시 (\S+)\)/.exec(m); if (mm) tmpDirSeen = mm[1]; } });

  // ① 불렸다 — 장부의 두 건 모두
  assert.deepStrictEqual(calls.sort(), ['사라진자료.txt', '연결자료.txt'], 'fetchLinked 가 장부의 각 항목으로 불려야 한다');
  // ② 읽혔다 — 추출 문서 목록에 연결 자료 이름이 있다
  const ext = store.readJson(projectId, '01_Project/extraction.json', null);
  assert.ok(ext && ext.documents.some(d => d.name === '연결자료.txt'), '연결 자료가 추출 문서에 있어야 한다: ' + JSON.stringify(ext && ext.documents));
  // ③ 못 가져온 것은 조용히 빠지지 않는다 — unsupported 에 사유와 함께 선다
  assert.ok(ext.unsupported.some(u => u.name === '사라진자료.txt' && /원본이 지워졌습니다/.test(u.reason)),
    '실패한 연결 자료가 unsupported 에 사유와 함께 있어야 한다: ' + JSON.stringify(ext.unsupported));
  const exRes = r.results['02_extraction'];
  assert.ok(exRes.warnings.some(w => /사라진자료\.txt/.test(w)), '추출 Agent 경고에 실패가 있어야 한다');
  // ④ 지웠다 — 임시 폴더가 없고, 장부 로그에 dispose 가 있다
  assert.ok(tmpDirSeen, '임시 폴더 경로가 로그에 있어야 한다');
  assert.ok(!fs.existsSync(tmpDirSeen), '생성이 끝나면 임시 폴더가 비워져야 한다(보관 금지)');
  const logTxt = fs.readFileSync(path.join(dir, '01_Project', 'linked-log.jsonl'), 'utf8');
  assert.ok(/"action":"materialize"/.test(logTxt) && /"action":"dispose"/.test(logTxt), 'materialize·dispose 가 장부 로그에 남아야 한다');
  // ⑤ 장부에 읽은 지문이 남는다 (원본 판을 확인할 근거)
  const item = linked.list(dir).items.find(i => i.name === '연결자료.txt');
  assert.ok(item.fingerprint && item.fingerprint.value, '읽은 자료의 지문이 장부에 남아야 한다');
});

test('§6-1 내려받기가 없으면 연결 자료를 읽지 않고 — 그 사실을 경고로 세운다', async () => {
  const { projectId, dir } = await freshProject();
  assert.ok(linked.link(dir, REF('연결만됨.pdf', 'r9')).ok);
  const r = await pipeline.run({ projectId, log: () => {} });
  const ext = store.readJson(projectId, '01_Project/extraction.json', null);
  assert.ok(ext.unsupported.some(u => u.name === '연결만됨.pdf' && /fetchLinked/.test(u.reason)),
    '내려받기가 없을 때 연결 자료가 「붙어 있지 않다」는 사유로 unsupported 에 서야 한다: ' + JSON.stringify(ext.unsupported));
  assert.ok(r.results['02_extraction'].warnings.some(w => /연결만됨\.pdf/.test(w)));
});

test('IM_LINKED_FETCHER — 모듈 경로로도 붙는다(자식 프로세스용) · 모양이 틀리면 조용히 넘어가지 않는다', () => {
  const good = path.join(ROOT, 'fetcher-good.cjs');
  fs.writeFileSync(good, "module.exports = { fetchLinked: async () => ({ ok: false, reason: 'x' }) };\n");
  const bad = path.join(ROOT, 'fetcher-bad.cjs');
  fs.writeFileSync(bad, 'module.exports = { nope: 1 };\n');
  const prev = process.env.IM_LINKED_FETCHER;
  try {
    delete process.env.IM_LINKED_FETCHER;
    assert.strictEqual(pipeline.resolveLinkedFetcher({}), null);
    process.env.IM_LINKED_FETCHER = good;
    assert.strictEqual(typeof pipeline.resolveLinkedFetcher({}), 'function');
    process.env.IM_LINKED_FETCHER = bad;
    assert.throws(() => pipeline.resolveLinkedFetcher({}), /fetchLinked 함수가 없다/);
    process.env.IM_LINKED_FETCHER = path.join(ROOT, 'no-such.cjs');
    assert.throws(() => pipeline.resolveLinkedFetcher({}), /읽을 수 없다/);
    // 함수 인자가 우선한다
    const fn = async () => ({ ok: false, reason: 'y' });
    assert.strictEqual(pipeline.resolveLinkedFetcher({ fetchLinked: fn }), fn);
  } finally {
    if (prev === undefined) delete process.env.IM_LINKED_FETCHER; else process.env.IM_LINKED_FETCHER = prev;
  }
});

test('§6-2 extractInto — 파일 목록을 읽어 dataset 에 넣고, 이전 추출 목록을 지우지 않는다', async () => {
  const { projectId } = await freshProject();
  // 먼저 정상 실행으로 extraction.json 을 만든다
  const dest = path.join(store.projectDir(projectId), '02_Source_Data');
  fs.writeFileSync(path.join(dest, '기존자료.txt'), '연면적 10,000㎡\n', 'utf8');
  await pipeline.run({ projectId, log: () => {} });
  const before = store.readJson(projectId, '01_Project/extraction.json', null);
  assert.ok(before.documents.some(d => d.name === '기존자료.txt'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-oneshot-'));
  const f = path.join(tmp, '감정평가서.txt');
  fs.writeFileSync(f, '총사업비 999억원\n', 'utf8');
  const out = await pipeline.extractInto(projectId, [{ name: '감정평가서.txt', path: f, size: fs.statSync(f).size, ext: '.txt' }], { log: () => {} });
  assert.ok(Array.isArray(out.facts) && Array.isArray(out.documents) && Array.isArray(out.unsupported), '{facts, documents, unsupported} 모양');
  assert.ok(out.documents.some(d => d.name === '감정평가서.txt'));
  assert.ok(out.facts.length >= 1, '값이 잡혀야 한다: ' + JSON.stringify(out.facts.slice(0, 2)));

  // dataset 에 들어갔다
  const ds = pipeline.loadDataset(projectId);
  assert.ok(JSON.stringify(ds.toJSON()).includes('감정평가서.txt'), 'dataset 에 그 문서 출처의 값이 있어야 한다');
  // extraction.json 은 **병합** — 기존 문서가 남고 새 문서가 더해진다
  const after = store.readJson(projectId, '01_Project/extraction.json', null);
  assert.ok(after.documents.some(d => d.name === '기존자료.txt') && after.documents.some(d => d.name === '감정평가서.txt'),
    '이전 문서 목록이 지워지면 안 된다: ' + JSON.stringify(after.documents.map(d => d.name)));
  // 파일은 여기서 지우지 않는다(부른 쪽이 dispose 한다)
  assert.ok(fs.existsSync(f), 'extractInto 는 파일을 지우지 않는다');
  // 없는 프로젝트는 던진다
  await assert.rejects(() => pipeline.extractInto('LP-NOPE-0000-000', []), /프로젝트 없음/);
});
