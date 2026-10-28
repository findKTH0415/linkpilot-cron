'use strict';
/**
 * embed-out.test.js — **낼 곳을 잘못 준 사람에게 무슨 말을 하는가**
 * 〈2026-08-21 · 실제 신고로 만들었다〉.
 *
 * ★★ 무슨 일이 있었나: 안내문에 이렇게 적어 보냈다.
 *
 *     npm run im:embed -- --out <앱 폴더>/im-flow
 *
 *   `<앱 폴더>` 는 **「여기에 당신의 경로를 넣으세요」**라는 자리표시였는데,
 *   받은 사람은 그대로 붙여 넣었다. 셸이 꺾쇠를 먹고 `앱 폴더` 를 찾다 죽었고,
 *   그 뒤 두 줄까지 줄줄이 죽었다.
 *
 * ★★ **자리표시인 줄 몰랐던 것이 사용자 잘못이 아니다.** 안내가 그 말을 안 한
 *   것이고, 도구도 아무 도움을 안 줬다 — 그냥 셸 오류만 났다.
 *
 * ★ 그래서 도구가 **알아보고 말한다.** 그리고 **엉뚱한 곳에 만들지 않는다** —
 *   16개를 잘못된 곳에 쏟아 놓으면 되찾는 것이 훨씬 비싸다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const embed = require('../ui/platform/build-embed.js');
const R = (args, env) => embed.resolveOut(['node', 'build-embed.js'].concat(args), env || {});

/* ═════════ ① 자리표시를 알아본다 ═════════ */

test('★★ 자리표시를 그대로 붙여 넣으면 **그렇다고 말한다** (신고된 자리)', () => {
  // 꺾쇠가 살아 있을 때
  const a = R(['--out', '<앱 폴더>/im-flow']);
  assert.ok(a.error, '자리표시를 그대로 받았는데 통과시켰다');
  assert.match(a.error, /자리표시/, '무엇이 잘못됐는지 안 말한다');
  assert.match(a.error, /당신의 앱 저장소 경로/, '무슨 뜻인지 안 풀어 준다');
  assert.match(a.error, /LP_APP_DIR/, '어떻게 하면 되는지 예를 안 준다');

  // ★ zsh 는 꺾쇠를 리디렉션으로 먹는다 — 그때는 「앱 폴더」만 남는다.
  //   실제 신고가 이 모양이었다
  const b = R(['--out', '앱 폴더/im-flow']);
  assert.ok(b.error, '꺾쇠가 사라진 자리표시를 못 알아본다 — 실제로 이 모양으로 왔다');
  assert.match(b.error, /자리표시/);

  // 영문 자리표시도 흔하다
  ['<path-to-app>/im-flow', 'your-app/im-flow'].forEach((raw) => {
    assert.ok(R(['--out', raw]).error, `자리표시를 못 알아본다: ${raw}`);
  });
});

/* ═════════ ② 없는 곳에 만들지 않는다 ═════════ */

test('★★ 상위 폴더가 없으면 만들지 않고 말한다 (엉뚱한 곳에 16개를 쏟지 않는다)', () => {
  const gone = path.join(os.tmpdir(), 'lp-없는곳-' + process.pid, 'im-flow');
  const r = R(['--out', gone]);
  assert.ok(r.error, '없는 곳인데 통과시켰다');
  assert.match(r.error, /상위 폴더가 없습니다/, '무엇이 없는지 안 말한다');
  // ★ **정말 안 만들었는지** 본다. 말만 하고 만들어 버리면 소용없다
  assert.equal(fs.existsSync(gone), false, '오류라면서 폴더를 만들어 놨다');
});

/* ═════════ ③ im-flow 가 아니면 안 만든다 ═════════ */

test('★★ 낼 곳이 im-flow 가 아니면 거절하고 **고친 경로를 보여 준다**', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-out-'));
  try {
    const r = R(['--out', dir]);
    assert.ok(r.error, '앱 웹루트에 그대로 쏟을 뻔했다');
    assert.match(r.error, /im-flow 가 아닙니다/);
    // 「안 됩니다」만으로는 다음 수가 없다 — 고친 경로를 그대로 준다
    assert.ok(r.error.indexOf(path.join(dir, 'im-flow')) > -1,
      `어떻게 고치면 되는지 안 보여 준다: ${r.error}`);
    assert.equal(fs.readdirSync(dir).length, 0, '거절했는데 뭔가 만들었다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ═════════ ④ 제대로 준 경우 ═════════ */

test('★ 제대로 된 경로면 통과하고, 없으면 그 폴더만 만든다', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-ok-'));
  try {
    const want = path.join(base, 'im-flow');
    const r = R(['--out', want]);
    assert.ok(!r.error, `제대로 된 경로를 거절했다: ${r.error}`);
    assert.equal(r.out, want);
    assert.ok(fs.existsSync(want), 'im-flow 폴더를 안 만들었다');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

/* ═════════ ⑤ 환경변수로도 준다 ═════════ */

/**
 * ★ 경로를 **매번 손으로 치게 하지 않는다.** 한 번 정해 두면 그 뒤로는
 *   `npm run im:embed` 만 치면 된다 — 손으로 칠 때마다 틀릴 기회가 생긴다.
 */
test('★ --out 이 없으면 LP_APP_DIR 을 본다', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-env-'));
  try {
    const want = path.join(base, 'im-flow');
    const r = R([], { LP_APP_DIR: want });
    assert.ok(!r.error, `LP_APP_DIR 을 안 본다: ${r.error}`);
    assert.equal(r.out, want);
    // --out 이 있으면 그쪽이 이긴다 (한 번만 정한 값보다 그때 지정한 것이 우선)
    const other = path.join(base, 'im-flow');
    assert.equal(R(['--out', other], { LP_APP_DIR: '/어딘가/im-flow' }).out, other);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('★ 아무것도 안 주면 만들지 않고 확인만 한다 (지금까지와 같다)', () => {
  const r = R([], {});
  assert.ok(!r.error);
  assert.equal(r.out, null, '아무것도 안 줬는데 어딘가에 내려 한다');
});
