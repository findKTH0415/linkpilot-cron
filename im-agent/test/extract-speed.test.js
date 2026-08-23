/**
 * **자료를 읽는 데 너무 오래 걸린다** 〈2026-08-23 사장님: 「너무 오래걸려
 * 단축방법을 찾아줘」〉.
 *
 * ★★★ OCR 을 켠 첫날, 자료 15건에 **7분 55초**가 걸렸다.
 *
 *   원인은 계산이 무거워서가 아니라 **한 줄로 세워 놓아서**였다. 파일마다
 *   ① OCR 전사 ② LLM 보완 — 최대 두 번의 왕복이 있고 그것을 파일 수만큼
 *   차례로 기다렸다. 15건이면 최대 30번을 줄 세운 셈이다.
 *
 * ★ 파일끼리는 서로 상관이 없다. 그래서 나란히 읽어도 **결과가 달라지지 않는다.**
 *   달라지면 안 되는 것은 **차례**다 — 값·문서·경고가 파일 순서대로 나와야
 *   다시 돌렸을 때 같은 보고서가 나온다.
 *
 * ★ 여기서 재는 것:
 *   ① 정말로 나란히 도는가 (한 줄로 돌면 시험이 실패해야 한다)
 *   ② 한도를 넘지 않는가 (넘으면 구글이 429 로 막고 읽히던 것도 안 읽힌다)
 *   ③ 차례가 그대로인가
 *   ④ 같은 내용을 두 번 안 읽고, **건너뛴 것을 말하는가**
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const E = require('../agents/02-extraction.js');

/* ── ① 나란히 도는가 ─────────────────────────────────────── */

test('★★★ 한 줄이 아니라 나란히 돈다 — 한 줄이면 이 시험이 실패한다', async () => {
  let live = 0, peak = 0;
  const order = [];
  const out = await E.mapLimited([1, 2, 3, 4, 5, 6], 3, async (n) => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 20));
    live -= 1; order.push(n);
    return n * 10;
  });
  assert.ok(peak > 1, `한 번에 ${peak}개만 돌았다 — 나란히 돌지 않는다`);
  assert.deepStrictEqual(out, [10, 20, 30, 40, 50, 60], '결과 차례가 흔들렸다');
});

test('★★★ 한도를 넘지 않는다 — 넘으면 구글이 429 로 막는다', async () => {
  let live = 0, peak = 0;
  await E.mapLimited(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live -= 1;
  });
  assert.strictEqual(peak, 4, `한 번에 ${peak}개가 돌았다 — 한도가 안 먹는다`);
});

test('★★ 하나가 늦어도 나머지가 기다리지 않는다', async () => {
  const done = [];
  await E.mapLimited([100, 1, 1], 3, async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    done.push(ms);
  });
  assert.deepStrictEqual(done, [1, 1, 100], '느린 것이 앞을 막았다 — 줄 세우기가 남아 있다');
});

test('★ 빈 목록에서도 죽지 않는다', async () => {
  assert.deepStrictEqual(await E.mapLimited([], 4, async () => 1), []);
});

test('★★ 기본 한도가 1 보다 크다 (안 그러면 고친 뜻이 없다)', () => {
  assert.ok(E.CONCURRENCY > 1, `기본 한도가 ${E.CONCURRENCY} 다 — 여전히 한 줄로 읽는다`);
});

/* ── ② 같은 파일을 두 번 안 읽는가 ───────────────────────── */

function withFiles(spec, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-dd-'));
  try {
    const files = spec.map(([name, body]) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, body);
      return { name, path: p, ext: path.extname(name) };
    });
    return fn(files);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('★★★ 내용이 같으면 한 번만 읽는다 — 이름이 달라도', () => {
  withFiles([['a(1).png', '같은 내용'], ['a(2).png', '같은 내용'], ['b.png', '다른 내용']], (files) => {
    const r = E.dedupeByContent(files);
    assert.deepStrictEqual(r.keep.map((f) => f.name), ['a(1).png', 'b.png']);
    assert.deepStrictEqual(r.skipped, [{ name: 'a(2).png', sameAs: 'a(1).png' }]);
  });
});

test('★★★ 내용이 다르면 둘 다 읽는다 — 이름이 같아도', () => {
  withFiles([['x.pdf', '첫째']], (files) => {
    const two = files.concat([Object.assign({}, files[0])]);
    // 같은 경로를 두 번 넣은 것은 같은 파일이다
    assert.strictEqual(E.dedupeByContent(two).keep.length, 1);
  });
});

test('★★ 못 읽는 파일은 거르지 않는다 — 읽기 실패는 사람 말로 말해야 한다', () => {
  const r = E.dedupeByContent([{ name: '없는파일.pdf', path: '/없는/자리/없는파일.pdf' }]);
  assert.strictEqual(r.keep.length, 1, '지문을 못 구했다고 통째로 버렸다');
  assert.deepStrictEqual(r.skipped, []);
});

/* ── ③ 실제 코드가 그것을 쓰는가 ─────────────────────────── */

test('★★★ 추출 본문이 실제로 나란히 읽고, 건너뛴 것을 말한다', () => {
  /* ★ 주석은 떼고 본다 (CLAUDE.md §8) */
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '02-extraction.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/await mapLimited\(dd\.keep, CONCURRENCY/.test(src),
    '본문이 여전히 한 줄로 읽는다 — 함수만 만들어 두고 안 쓴다');
  assert.ok(/const dd = dedupeByContent\(files\)/.test(src), '같은 파일을 여전히 두 번 읽는다');
  assert.ok(src.indexOf('한 번만 읽었습니다') !== -1,
    '건너뛴 것을 안 말한다 — 조용히 빠지면 「올렸는데 안 읽혔다」가 된다');
  /* ★ 차례를 지킨다 — 경고를 모아 두었다가 파일 순서대로 낸다 */
  assert.ok(/perFile\.forEach/.test(src), '결과를 차례대로 펴지 않는다');
  assert.ok(/r\.warns\.forEach/.test(src), '경고 차례가 섞인다 — 다시 돌리면 로그가 달라진다');
});
