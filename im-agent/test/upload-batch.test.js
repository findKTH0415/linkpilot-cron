'use strict';
/**
 * upload-batch.test.js — **한 요청에 몰아 보내지 않는다** 〈2026-08-29 · D-174〉.
 *
 * 사장님 화면: 파일 여덟을 올리는데 **본문 28.4MB 한 덩어리**가 나갔고 서버가
 * 그 하나를 `HTTP 401` 로 거절했다. 같은 화면에서 **목록 읽기는 통과했다** —
 * 즉 로그인이 아니라 **그 요청 하나**가 거절된 것이다.
 *
 * ★★★ 왜 나누나 — 이유가 셋:
 *   ① 큰 본문 하나는 **거절될 자리가 많다** (앞단·프록시·본문 파서가 저마다
 *      한도를 갖고, 넘으면 401·413·끊김 등 저마다 다른 말로 실패한다).
 *      이 저장소는 이미 한 번 당했다 — 64MB 에서 끊겼다 (D-81).
 *   ② **전부 아니면 전무**가 된다. 여덟 중 하나가 커도 여덟이 다 실패한다.
 *   ③ 실패했을 때 **어느 파일에서 막혔는지** 알 수 있다.
 *
 * ★ 이 검사는 **진짜로 올리지 않는다.** 묶는 규칙과 화면의 말만 잰다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const U = require('../ui/platform/upload-core.js');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const mk = (name, mb) => ({ name: name, contentBase64: 'x'.repeat(mb * 1024 * 1024) });

test('나누는 자리가 있다', () => {
  assert.strictEqual(typeof U.sendAll, 'function');
  assert.strictEqual(typeof U.batches, 'function');
  assert.ok(U.BATCH_BYTES > 0 && U.BATCH_BYTES < 20 * 1024 * 1024,
    `한 묶음 상한이 ${U.BATCH_BYTES} 다 — 너무 크면 나눈 뜻이 없다`);
});

test('크기로 묶는다 — 상한을 넘기 전까지 함께 간다', () => {
  const g = U.batches([mk('a', 3), mk('b', 3), mk('c', 3)]);
  assert.deepStrictEqual(g.map(x => x.map(f => f.name)),
    [['a', 'b'], ['c']], '8MB 상한에서 3+3 은 함께, 3 은 다음 묶음이어야 한다');
});

/**
 * ★★ **한 개가 상한을 넘으면 그 하나로 한 묶음.** 억지로 쪼개지 않는다 —
 *   서버가 파일 단위로 받으므로 쪼개면 그건 다른 파일이 된다.
 */
test('★★ 큰 파일 하나는 혼자 보낸다 (쪼개지 않는다)', () => {
  const g = U.batches([mk('a', 3), mk('big', 20), mk('c', 1)]);
  assert.deepStrictEqual(g.map(x => x.map(f => f.name)),
    [['a'], ['big'], ['c']], '큰 파일이 다른 것과 묶였거나 쪼개졌다');
  g.forEach((x) => assert.ok(x.length >= 1, '빈 묶음이 생겼다'));
});

test('파일이 없으면 묶음도 없다 (빈 요청을 보내지 않는다)', () => {
  assert.deepStrictEqual(U.batches([]), []);
  assert.deepStrictEqual(U.batches(null), []);
});

test('모든 파일이 정확히 한 묶음에만 들어간다', () => {
  const files = [mk('a', 2), mk('b', 5), mk('c', 4), mk('d', 9), mk('e', 1)];
  const flat = U.batches(files).flat().map(f => f.name).sort();
  assert.deepStrictEqual(flat, ['a', 'b', 'c', 'd', 'e'],
    '빠지거나 두 번 실린 파일이 있다');
});

// ══ 화면 ═══════════════════════════════════════════════════

test('★★★ 화면이 나눠 보낸다 (한 덩어리로 안 보낸다)', () => {
  const c = bare(read('files.html'));
  assert.match(c, /UP\.sendAll\(\{/, '아직 한 요청에 몰아 보낸다');
  assert.ok(!/UP\.send\(\{/.test(c), '옛 길이 남아 있다 — 둘 중 어느 것이 도는지 모른다');
});

/**
 * ★★★ 나눠 보내면 막혀도 **앞 묶음은 이미 올라가 있다.** 그 사실을 안 적으면
 *   같은 파일을 처음부터 다시 올리게 되고, **같은 자료가 두 벌** 생긴다.
 *   실패보다 이것이 되돌리기 어렵다.
 */
test('★★★ 막히면 어디까지 갔는지 말한다', () => {
  const c = bare(read('files.html'));
  assert.match(c, /onFail: function \(why, status, partial, at\)/,
    '어디까지 갔는지 받지 않는다');
  assert.match(c, /state\.partial = at;/, '어디까지 갔는지 안 남긴다');
  assert.match(read('files.html'), /여기까지는 올라갔습니다/, '화면이 그 말을 안 한다');
  assert.match(read('files.html'), /이미 올라간 것은 다시 안 올리셔도 됩니다/,
    '다시 올려야 하는지를 안 알려 준다 — 두 벌이 생긴다');
});

/**
 * ★ 진행률은 **전체 기준**이라야 한다. 묶음마다 0→100 을 되풀이하면
 *   「되돌아갔다」로 보인다.
 */
test('★ 진행률을 전체 기준으로 다시 센다', () => {
  const src = bare(read('upload-core.js'));
  assert.match(src, /doneFiles \+ \(group\.length \* within \/ 100\)/,
    '묶음 안의 진행률을 그대로 내보낸다 — 0→100 이 되풀이된다');
  assert.match(src, /files: total/, '전체 개수를 안 알려 준다');
});

/**
 * ★★ 하나라도 실패하면 **거기서 멈춘다.** 이어서 보내면 「반은 올라갔는데
 *   어디까지인지 모르는」 상태가 되고, 그것이 가장 되돌리기 어렵다.
 */
test('★★ 실패하면 다음 묶음을 보내지 않는다', () => {
  const src = bare(read('upload-core.js'));
  const at = src.indexOf('onFail: function (why, status, j) {');
  const tail = src.slice(at, at + 400);
  assert.ok(!/step\(i \+ 1\)/.test(tail),
    '실패했는데 다음 묶음을 이어 보낸다 — 어디까지 갔는지 알 수 없게 된다');
});

test('된 것을 결과에 모아 준다', () => {
  const src = bare(read('upload-core.js'));
  assert.match(src, /\['saved', 'accepted', 'rejected', 'replaced'\]/,
    '묶음별 결과를 안 합친다 — 마지막 묶음 것만 남는다');
});

/**
 * ★★★ **빈 배열이 진짜 값을 가렸다** 〈2026-08-29 · 스스로 잡았다〉.
 *
 * 처음 판은 합칠 통을 `{ saved: [], accepted: [], … }` 로 만들어 두었다.
 * 그런데 **빈 배열도 참**이라, 결과를 읽는 쪽의 `j.saved || j.accepted` 가
 * **빈 `saved` 를 골라** 「0개를 올렸습니다」가 됐다 — 실제로는 `accepted` 에
 * 다 들어 있었다.
 *
 * ★ **화면은 멀쩡히 뜨고 숫자만 0 이라** 눈으로는 안 잡힌다. 검사 둘이
 *   빨개져서 알았다.
 */
test('★★★ 안 온 칸을 빈 배열로 만들어 두지 않는다', () => {
  const src = bare(read('upload-core.js'));
  assert.match(src, /var merged = \{ batches: groups\.length \};/,
    '빈 배열로 통을 미리 만든다 — 빈 배열이 진짜 값을 가린다');
  assert.match(src, /merged\[k\] = \(merged\[k\] \|\| \[\]\)\.concat\(j\[k\]\);/,
    '온 것만 담지 않는다');
});

test('★ summary 가 accepted 만 온 결과도 옳게 센다', () => {
  assert.strictEqual(U.summary({ batches: 1, accepted: ['a', 'b'] }), '2개를 올렸습니다');
  assert.strictEqual(U.summary({ batches: 1, saved: ['a'] }), '1개를 올렸습니다');
  assert.match(U.summary({ saved: ['a'], rejected: ['b'] }), /1개를 올렸습니다 · 1개는 거절/);
});
