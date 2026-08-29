'use strict';
/**
 * oneshot-rescue.test.js — **못 읽은 것은 지우지 않는다** 〈2026-08-28 · D-174〉.
 *
 * ★★ 실제 신고(사장님 화면): 13개를 올렸는데 9개가 `GEMINI_ALL_KEYS_UNAVAILABLE`
 *   로 실패했고, 화면이 「이 9건은 남아 있지 않습니다」라고 적었다. 사실이었다 —
 *   `oneshotUpload` 가 읽기 성공·실패를 안 가리고 임시 폴더를 통째로 지웠다.
 *   **얻은 것은 없고 파일만 사라졌다.**
 *
 * ★ 1회성의 「안 보관한다」는 **읽은 것**에 대한 약속이다. 못 읽은 것까지
 *   버리면 그것은 보관 정책이 아니라 **일한 것을 버리는 것**이다.
 *
 * ★★★ 임시 폴더에 그냥 두는 것으로는 모자란다 — 거기는 OS 임시 폴더라 재부팅에
 *   없어지고, 무엇보다 **다시 읽을 길이 없다.** 보관 자료(02_Source_Data)로
 *   옮겨야 화면의 「다시 읽기」(/scan)가 집는다. 그래서 이 시험은 「안 지웠다」가
 *   아니라 **「보관 자료에 실제로 있다」**를 잰다.
 *
 * ★ 그리고 화면이 옛말을 하지 않는지도 함께 잰다. 남아 있는데 「남아 있지
 *   않습니다」라고 하면 같은 파일을 다시 올리게 되고 두 벌이 된다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const AGENT = path.join(__dirname, '..');
const oneshot = require(path.join(AGENT, 'core', 'oneshot'));
const vault = require(path.join(AGENT, 'core', 'vault'));

/** 프로젝트 폴더 하나를 만든다 (`store.projectDir` 이 만드는 모양) */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-rescue-'));
  for (const sub of ['01_Project', '02_Source_Data']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  return dir;
}

/**
 * `report-api.cjs` 의 oneshotUpload 가 하는 일 중 **이 결정에 해당하는 부분만**
 * 그대로 옮겨 온다. 서버 전체를 띄우지 않고 규칙만 잰다.
 */
function acceptThenDispose(projectDir, files, unsupportedNames) {
  const r = oneshot.accept(projectDir, files);
  assert.ok(r.ok, r.reason);

  const failed = new Set(unsupportedNames);
  const rescued = [];
  for (const f of r.files) {
    if (!failed.has(f.name)) continue;
    const put = vault.put(projectDir, f.name, fs.readFileSync(f.path), {});
    if (put.ok) rescued.push(put.name);
  }
  const removed = r.dispose().removed;
  return { rescued, removed, dir: r.dir };
}

const B = (s) => Buffer.from(s, 'utf8');

test('★★★ 못 읽은 파일은 보관 자료에 남는다 — 지우지 않는다', () => {
  const p = project();
  const out = acceptThenDispose(p, [
    { name: '읽힌다.pdf', buf: B('토지가액 120억원') },
    { name: '못읽는다.png', buf: B('PNG 인 척하는 바이트') },
  ], ['못읽는다.png']);

  assert.deepStrictEqual(out.rescued, ['못읽는다.png'],
    '못 읽은 것을 보관으로 옮기지 않았다 — 이 한 줄이 D-174 의 전부다');

  const kept = fs.readdirSync(path.join(p, '02_Source_Data'));
  assert.ok(kept.indexOf('못읽는다.png') !== -1,
    `보관 자료에 없다 (${kept.join(' · ')}) — 옮겼다고만 적고 실제로는 사라졌다면 그것이 가장 나쁘다`);

  assert.ok(kept.indexOf('읽힌다.pdf') === -1,
    '읽은 것까지 남겼다 — 1회성 약속이 통째로 깨진다');
});

test('★★ 임시 폴더는 그래도 비운다 — 두 곳에 두지 않는다', () => {
  const p = project();
  const out = acceptThenDispose(p, [
    { name: '못읽는다.png', buf: B('바이트') },
  ], ['못읽는다.png']);

  assert.ok(!fs.existsSync(out.dir),
    '임시 폴더가 남았다 — 같은 파일이 두 곳에 있으면 어느 쪽이 정본인지 아무도 모른다');
  assert.strictEqual(out.rescued.length, 1);
});

test('전부 읽혔으면 아무것도 안 남긴다 (옛 동작 그대로)', () => {
  const p = project();
  const out = acceptThenDispose(p, [
    { name: 'a.pdf', buf: B('가') },
    { name: 'b.pdf', buf: B('나') },
  ], []);

  assert.deepStrictEqual(out.rescued, []);
  assert.deepStrictEqual(fs.readdirSync(path.join(p, '02_Source_Data')), [],
    '읽은 것을 남기면 「안 보관한다」가 거짓이 된다');
});

/* ── 화면이 옛말을 하지 않는가 ─────────────────────────── */

test('★★ 화면이 `rescued` 를 보고 말을 바꾼다', () => {
  const src = fs.readFileSync(path.join(AGENT, 'ui', 'platform', 'files.html'), 'utf8');

  assert.match(src, /state\.result\.rescued/,
    '화면이 rescued 를 안 본다 — 서버가 남겼는데 화면은 「남아 있지 않습니다」라고 한다');
  assert.match(src, /다시 읽기/,
    '무엇을 하면 되는지 안 적었다 — 사유만 주면 같은 파일을 또 올린다');

  /* ★ 옛 문구를 지우지는 않는다. 정말로 못 옮긴 경우(보관 실패)에는 그 말이
   *   맞기 때문이다. 다만 **rescued 가 있을 때는 안 나와야** 한다. */
  assert.match(src, /남아 있지 않습니다/,
    '못 옮긴 경우에 할 말까지 지웠다 — 그때는 정말로 안 남는다');
});

test('★ 서버가 rescued 를 응답에 담는다', () => {
  const src = fs.readFileSync(path.join(AGENT, 'ui', 'report-api.cjs'), 'utf8');
  const body = src.split('\n').filter(l => !/^\s*[/*]/.test(l)).join('\n');

  assert.match(body, /rescued/,
    'oneshotUpload 응답에 rescued 가 없다 — 화면이 알 방법이 없다');
  assert.match(body, /vault\.put\(dirOf, f\.name/,
    '못 읽은 것을 보관으로 옮기는 줄이 없다');
});
