/**
 * **읽었다는 기록을 빈 실행이 덮고 있었다.**
 *
 * ★★★ 2026-08-25. 사장님 화면에 「자료에서 읽은 값」이 요청문 셋뿐이었고,
 *   파이프라인 로그에는 늘 `02_Source_Data 에 원본자료가 없다` 가 떴다.
 *   나는 **「1회성이라 원본을 지워서 값이 사라진다」**고 짐작했다.
 *
 *   ★ **짐작이 틀렸다.** 실측해 보니 값은 `dataset.json` 에 그대로 남는다 —
 *     3개를 뽑고 원본을 지운 뒤에도 셋 다 살아 있었다.
 *
 * ★★ 사라지는 것은 **읽었다는 기록**이었다. 보고서를 생성하면 02 가
 *   빈 폴더에서 0건을 돌려주고, 그 0 이 `extraction.json` 을
 *   **`factCount: 0` 으로 덮어썼다.** 그러면 화면이 「자료 N건을 읽어 값 M개를
 *   뽑았다」를 못 말한다 — **값은 멀쩡히 있는데 화면은 읽은 적 없다고 한다.**
 *   M-32(실패 사유) · M-34(출처 등급)와 똑같은 결이다.
 *
 * ★ 지울 것이 없는데 기록만 지운 것이다. **이번 실행이 아무것도 안 읽었으면
 *   그대로 둔다.**
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** ★ **async 를 안 기다리면 finally 가 먼저 돈다** — 임시 폴더가 시험 도중에
 *   지워져 「프로젝트 없음」이 난다. 실제로 그렇게 빨개졌다 */
async function withRoot(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-keep-'));
  const before = process.env.IM_AGENT_ROOT;
  const offline = process.env.IM_AGENT_OFFLINE;
  process.env.IM_AGENT_ROOT = dir;
  process.env.IM_AGENT_OFFLINE = '1';
  /* ★ 모듈이 루트를 기억하므로 캐시를 비운다 */
  Object.keys(require.cache).forEach((k) => { if (/im-agent/.test(k)) delete require.cache[k]; });
  try { return await fn(dir); } finally {
    if (before === undefined) delete process.env.IM_AGENT_ROOT; else process.env.IM_AGENT_ROOT = before;
    if (offline === undefined) delete process.env.IM_AGENT_OFFLINE; else process.env.IM_AGENT_OFFLINE = offline;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('★★★ 빈 실행이 앞서 읽은 기록을 안 덮는다', async () => {
  await withRoot(async (root) => {
    const store = require('../core/store.js');
    const pipe = require('../pipeline.js');
    const pid = 'LP-RE-2026-901';
    store.createProjectDirs(pid);
    store.writeJson(pid, '01_Project/project.json',
      { id: pid, name: '시험', assetType: '부동산', templateId: 'office' });
    store.writeJson(pid, '01_Project/dataset.json', { projectId: pid, facts: [] });

    /* ① 1회성 업로드처럼 임시 파일을 읽히고 원본을 지운다 */
    const tmp = path.join(root, 'tmp.md');
    fs.writeFileSync(tmp, '# 사업개요\n대지면적 5,000㎡\n연면적 24,000㎡\n총사업비 500억원\n');
    await pipe.extractInto(pid, [{ name: 'tmp.md', path: tmp, size: 100, ext: '.md' }], { log: () => {} });
    fs.rmSync(tmp, { force: true });

    const a = store.readJson(pid, '01_Project/extraction.json', {});
    assert.ok(a.factCount > 0, `스캔이 값을 안 적었다: ${JSON.stringify(a)}`);
    assert.strictEqual(a.documents.length, 1);

    /* ② 그 뒤 보고서 생성 — 원본 폴더는 비어 있다 */
    await pipe.run({ projectId: pid, log: () => {} });

    const b = store.readJson(pid, '01_Project/extraction.json', {});
    assert.strictEqual(b.factCount, a.factCount,
      '빈 실행이 「읽은 값 개수」를 0 으로 덮었다 — 화면이 「읽은 적 없다」고 말하게 된다');
    assert.strictEqual(b.documents.length, 1,
      '빈 실행이 「읽은 자료 목록」을 비웠다');
  });
});

test('★★★ 값 자체는 원본을 지워도 남는다 — 「1회성이라 사라진다」는 사실이 아니다', async () => {
  await withRoot(async (root) => {
    const store = require('../core/store.js');
    const pipe = require('../pipeline.js');
    const pid = 'LP-RE-2026-902';
    store.createProjectDirs(pid);
    store.writeJson(pid, '01_Project/project.json',
      { id: pid, name: '시험', assetType: '부동산', templateId: 'office' });
    store.writeJson(pid, '01_Project/dataset.json', { projectId: pid, facts: [] });

    const tmp = path.join(root, 'tmp.md');
    fs.writeFileSync(tmp, '# 사업개요\n대지면적 5,000㎡\n연면적 24,000㎡\n');
    await pipe.extractInto(pid, [{ name: 'tmp.md', path: tmp, size: 100, ext: '.md' }], { log: () => {} });
    fs.rmSync(tmp, { force: true });
    await pipe.run({ projectId: pid, log: () => {} });

    const ds = store.readJson(pid, '01_Project/dataset.json', {});
    const list = Array.isArray(ds.facts) ? ds.facts : Object.values(ds.facts || {}).flat();
    const fromDoc = list.filter((f) => String(f.source || '').includes('tmp.md'));
    assert.ok(fromDoc.length >= 2,
      `원본을 지웠더니 값까지 사라졌다 (${fromDoc.length}개) — 그러면 1회성 설계가 통째로 틀린 것이다`);
  });
});

test('★★ 실제로 읽은 것이 있으면 기록을 갱신한다 — 안 덮으면 옛말을 한다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/const readNothing = !out\.documents\.length && !out\.facts\.length;/.test(src),
    '「아무것도 안 읽었는가」를 안 본다');
  /* ★ 앞서 읽은 기록이 **있을 때만** 지킨다. 없으면 처음 쓰는 것이라 그대로 쓴다 */
  assert.ok(/const kept = readNothing \? store\.readJson\(projectId, '01_Project\/extraction\.json', null\) : null;/.test(src),
    '기록이 없을 때까지 건너뛰면 처음 실행에서 파일이 안 생긴다');
  /* ★★ 그래도 **못 읽은 것은 새로 적는다** — 「연결 자료가 안 붙어 있다」는
   *   이번 실행의 사실이다. 조기 반환으로 이것까지 삼켰다가 검사가 잡았다 */
  assert.ok(/unsupported: out\.unsupported,/.test(src),
    '못 읽은 목록까지 앞 판 것을 그대로 둔다 — 이번 실행의 경고가 사라진다');
  assert.ok(/그대로 둔다/.test(fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8')),
    '건너뛴 사실을 로그에 안 남긴다');
});
