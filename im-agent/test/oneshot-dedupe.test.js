/**
 * 같은 파일을 다시 올려도 **줄이 쌓이지 않는가.**
 *
 * ★★★ 2026-08-23 사장님 화면: 「중복파일 쌓이는 문제 해결해줘」.
 *
 *   OCR 이 꺼져 있던 동안 같은 자료를 여러 번 올려 보셨다. 그때마다 장부에
 *   줄이 하나씩 붙어 **같은 이름이 여덟 줄**이 되었고, 화면은 그것을
 *   「같은 이름의 자료가 여덟 개 — 어느 판으로 만들지 고르십시오」로 보여 줬다.
 *   **고를 것이 없는데 고르라는 말**이다.
 *
 *   ★ 게다가 맥이 같은 파일을 두 번 내려받으며 붙인 `(1)`·`(2)` 때문에
 *     **이름이 서로 달랐다.** 이름으로 접었으면 그 둘은 그대로 남았다.
 *
 * ★ 여기서 재는 것:
 *   ① 지문이 같으면 접는다 — **이름이 달라도**
 *   ② 지문이 다르면 **안 접는다** (진짜 판 충돌은 남아야 한다)
 *   ③ 접어도 **몇 번·언제부터·다른 이름**이 남는다 (지운 것이 아니다)
 *   ④ 이미 쌓여 있던 장부도 **읽는 순간** 접혀 보인다
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const oneshot = require('../core/oneshot.js');

const fp = (v) => ({ value: v, algo: 'sha256' });
const row = (name, sha, at) => ({
  kind: 'oneshot', name, original: name, bytes: 10,
  fingerprint: fp(sha), readAt: at, by: null,
  retainedCopy: false, originalLocation: null,
});

const T = (h) => `2026-08-23T${h}:00:00+09:00`;

test('★★★ 같은 파일을 여러 번 올린 것이 한 줄로 접힌다', () => {
  const r = oneshot.mergeItems([
    row('a.png', 'X', T('10')), row('a.png', 'X', T('11')),
    row('a.png', 'X', T('12')), row('a.png', 'X', T('13')),
  ]);
  assert.strictEqual(r.length, 1, '네 줄이 그대로 남았다');
  assert.strictEqual(r[0].times, 4, '몇 번 올렸는지를 안 남겼다 — 접은 것이 아니라 지운 것이 된다');
  assert.strictEqual(r[0].firstReadAt, T('10'), '처음 올린 때를 잃었다');
  assert.strictEqual(r[0].readAt, T('13'), '마지막이 최신이어야 한다');
});

test('★★★ 이름이 달라도 지문이 같으면 접는다 — 맥의 (1)·(2) 가 그랬다', () => {
  const r = oneshot.mergeItems([
    row('인세티브(1).png', 'X', T('10')),
    row('인세티브(2).png', 'X', T('11')),
  ]);
  assert.strictEqual(r.length, 1, '같은 파일인데 두 줄로 남았다');
  assert.deepStrictEqual(r[0].alsoNamed, ['인세티브(2).png'],
    '다른 이름을 버렸다 — 나중에 원본을 찾을 단서가 이것뿐이다');
});

test('★★★ 지문이 다르면 **안 접는다** — 진짜 판 충돌은 남아야 한다', () => {
  const r = oneshot.mergeItems([
    row('IM.pdf', 'X', T('10')),
    row('IM.pdf', 'Y', T('11')),
  ]);
  assert.strictEqual(r.length, 2,
    '내용이 다른 두 판을 하나로 접었다 — 틀린 판으로 보고서를 만들게 된다');
});

test('★★ 지문이 없으면 접지 않는다 — 같은지 알 수 없는 것을 같다고 하지 않는다', () => {
  const r = oneshot.mergeItems([
    { name: 'x.txt' }, { name: 'x.txt' },
  ]);
  assert.strictEqual(r.length, 2);
});

test('★★ 처음 나온 자리를 지킨다 — 목록 순서가 흔들리면 딴 자료로 보인다', () => {
  const r = oneshot.mergeItems([
    row('a', 'X', T('10')), row('b', 'Y', T('11')), row('a', 'X', T('12')),
  ]);
  assert.deepStrictEqual(r.map((i) => i.name), ['a', 'b']);
});

test('★ 이미 접힌 것을 또 접어도 셈이 안 틀린다', () => {
  const once = oneshot.mergeItems([row('a', 'X', T('10')), row('a', 'X', T('11'))]);
  const twice = oneshot.mergeItems(once);
  assert.strictEqual(twice.length, 1);
  assert.strictEqual(twice[0].times, 2, '두 번 접었더니 셈이 늘었다');
});

test('★★ 출처가 「몇 번 올렸는지」와 「다른 이름」을 말한다 (§4.7)', () => {
  const r = oneshot.mergeItems([row('a(1).png', 'X', T('10')), row('a(2).png', 'X', T('11'))]);
  const c = oneshot.citation(r[0]);
  assert.ok(c.indexOf('2번 올림') !== -1, c);
  assert.ok(c.indexOf('다른 이름: a(2).png') !== -1, c);
  assert.ok(c.indexOf('원본 재확인 불가') !== -1, '1회성의 대가를 여전히 말해야 한다');
});

/* ── 장부에 실제로 붙는가 ─────────────────────────────────── */

function withProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-oneshot-t-'));
  fs.mkdirSync(path.join(dir, '01_Project'), { recursive: true });
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('★★★ 같은 파일을 두 번 올려도 장부가 한 줄이다', () => {
  withProject((dir) => {
    const buf = Buffer.from('같은 내용입니다');
    const a = oneshot.accept(dir, [{ name: 'x.pdf', buf }]);
    a.dispose();
    const b = oneshot.accept(dir, [{ name: 'x.pdf', buf }]);
    b.dispose();
    const l = oneshot.list(dir);
    assert.strictEqual(l.items.length, 1, `두 줄이 남았다: ${JSON.stringify(l.items.map((i) => i.name))}`);
    assert.strictEqual(l.items[0].times, 2);
    /* ★ 장부 파일 자체도 접혀 있어야 한다 — 안 그러면 올릴 때마다 자란다 */
    const raw = oneshot.read(dir);
    assert.strictEqual(raw.items.length, 1, '화면만 접히고 파일은 계속 자란다');
  });
});

test('★★★ 이미 쌓여 있던 장부는 **읽는 순간** 접혀 보인다 (다음 업로드를 안 기다린다)', () => {
  withProject((dir) => {
    oneshot.write(dir, {
      version: oneshot.LEDGER_VERSION,
      items: [row('a.png', 'X', T('10')), row('a.png', 'X', T('11')), row('a.png', 'X', T('12'))],
    });
    const l = oneshot.list(dir);
    assert.strictEqual(l.items.length, 1);
    assert.strictEqual(l.collapsed, 2, '몇 줄을 접었는지를 안 말한다 — 기록이 사라진 것으로 읽힌다');
  });
});

test('★★ 내용이 다르면 장부에 두 줄로 남는다', () => {
  withProject((dir) => {
    oneshot.accept(dir, [{ name: 'x.pdf', buf: Buffer.from('첫째 판') }]).dispose();
    oneshot.accept(dir, [{ name: 'x.pdf', buf: Buffer.from('둘째 판') }]).dispose();
    assert.strictEqual(oneshot.list(dir).items.length, 2);
  });
});

/* ── 화면이 그것을 말하는가 ───────────────────────────────── */

test('★★★ 화면이 **접었다고 말한다** — 말 없이 줄이 줄면 사라진 것으로 읽힌다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'ui', 'platform', 'files.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(src.indexOf('state.oneshot && state.oneshot.collapsed') !== -1,
    '접은 줄 수를 안 읽는다');
  assert.ok(src.indexOf('한 줄로 접었습니다') !== -1, '접었다는 말이 화면에 없다');
  assert.ok(src.indexOf("it.times > 1") !== -1, '몇 번 올렸는지를 줄에 안 적는다');
  assert.ok(src.indexOf('다른 이름으로도 올라왔습니다') !== -1,
    '다른 이름을 화면이 안 보여 준다');
});
