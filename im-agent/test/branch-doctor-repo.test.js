'use strict';
/**
 * branch-doctor-repo.test.js — **다른 저장소도 볼 수 있는가** 〈2026-09-01 · M-70〉.
 *
 * ★★★ 무슨 일이 있었나. 이 검사는 여태 **이 저장소만** 봤다. 그런데 실제 사고는
 *   저쪽(`linkpilot-platform`)에서 났다 — 열려 있던 PR 이 이미 한 일을 다른 PR 에서
 *   하루 뒤에 다시 했고, 파일 스무 개가 겹쳤는데 **아무것도 말해 주지 않았다.**
 *   장치는 다 있었고 **돌린 자리가 한 곳뿐이었다.**
 *
 * ★★ 여기서 재는 것은 셋이다 —
 *   ① 준 저장소를 실제로 본다 (이 저장소로 조용히 되돌아가지 않는다)
 *   ② **양쪽이 새로 만든 같은 파일**을 잡는다 (그 사고의 모양이다)
 *   ③ 열린 PR 기록도 **그 저장소 것**을 본다 (이쪽 목록으로 저쪽을 좁히면
 *      저쪽 갈래가 전부 빠져 「안 겹친다」로 보인다 — 조용히 틀리는 자리)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const D = require('../tools/branch-doctor');

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * 두 갈래가 **같은 새 파일**을 각자 만든 저장소를 짓는다.
 *
 * ★ 표본이 재려는 성질을 지켜야 한다 (CLAUDE.md §8). 여기서 지킬 성질은
 *   「두 갈래가 같은 경로를 **새로** 만들었다」이다. 내용까지 같을 필요는 없다 —
 *   오히려 달라야 진짜 사고와 같은 모양이다.
 */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bd-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bd-origin-'));
  git(bare, ['init', '--bare', '-q', '--initial-branch=main']);
  git(dir, ['init', '-q', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'a@b.c']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['remote', 'add', 'origin', bare]);

  fs.writeFileSync(path.join(dir, 'base.js'), '// 뿌리\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'base']);
  git(dir, ['push', '-q', 'origin', 'main']);

  // 저쪽 갈래 — 새 파일 하나를 만든다
  git(dir, ['checkout', '-q', '-b', 'claude/theirs']);
  fs.writeFileSync(path.join(dir, 'same-new.js'), '// 저쪽이 만든 것\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'theirs']);
  git(dir, ['push', '-q', 'origin', 'claude/theirs']);

  // 이쪽 갈래 — **같은 경로**를 따로 만든다 (진짜 사고의 모양)
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['checkout', '-q', '-b', 'claude/mine']);
  fs.writeFileSync(path.join(dir, 'same-new.js'), '// 이쪽이 만든 것\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'mine']);
  git(dir, ['push', '-q', 'origin', 'claude/mine']);

  return { dir, bare };
}

function cleanup(r) {
  fs.rmSync(r.dir, { recursive: true, force: true });
  fs.rmSync(r.bare, { recursive: true, force: true });
}

test('★★★ 다른 저장소의 두 갈래가 같은 새 파일을 만든 것을 잡는다', () => {
  const r = makeRepo();
  try {
    D.setRepo(r.dir);
    const res = D.check(['claude/theirs', 'claude/mine']);   // 열린 PR 을 물어본 판
    assert.ok(res.measured, `못 쟀다: ${res.why}`);
    const hit = res.pairs.find(p => p.branch === 'claude/theirs');
    assert.ok(hit, `저쪽 갈래를 못 봤다: ${JSON.stringify(res.pairs)}`);
    assert.deepStrictEqual(hit.addAdd, ['same-new.js'],
      '양쪽이 새로 만든 같은 파일을 못 잡았다 — 이것이 그 사고의 모양이다');
    assert.strictEqual(D.verdict(res).code, 1, '물어본 판인데 치명으로 안 끝냈다');
  } finally { D.setRepo(null); cleanup(r); }
});

test('★★ 겹치는 것이 없으면 초록이다 — 늘 빨간 검사는 아무도 안 본다', () => {
  const r = makeRepo();
  try {
    // 저쪽 갈래를 다른 파일로 바꿔 둔다
    git(r.dir, ['checkout', '-q', 'claude/theirs']);
    fs.rmSync(path.join(r.dir, 'same-new.js'));
    fs.writeFileSync(path.join(r.dir, 'other-new.js'), '// 다른 것\n');
    git(r.dir, ['add', '-A']); git(r.dir, ['commit', '-qm', '딴 파일로']);
    git(r.dir, ['push', '-qf', 'origin', 'claude/theirs']);
    git(r.dir, ['checkout', '-q', 'claude/mine']);

    D.setRepo(r.dir);
    const res = D.check(['claude/theirs', 'claude/mine']);
    assert.strictEqual(D.verdict(res).code, 0, `겹치지 않는데 빨갛다: ${D.verdict(res).line}`);
  } finally { D.setRepo(null); cleanup(r); }
});

test('★ 열린 PR 기록은 **그 저장소 것**을 읽는다 — 이쪽 목록으로 저쪽을 좁히지 않는다', () => {
  /* ★★ 앞 판의 이 시험은 `check()` 에 목록을 **직접 넘겨** 놓고 「그 저장소 것을
   *   본다」고 적었다. 그러면 읽는 자리를 아예 안 지나가므로 **무엇을 고쳐도
   *   초록이었다** — 실제로 자리를 되돌려 보고 알았다 (CLAUDE.md §8 「표본이
   *   거짓말을 하면 잡히는 것도 거짓이다」). 읽는 함수를 직접 부른다. */
  const r = makeRepo();
  try {
    const mark = ['claude/저쪽에만-있는-갈래'];
    fs.writeFileSync(path.join(r.dir, '.lp-open-prs.json'),
      JSON.stringify({ at: new Date().toISOString(), refs: mark }));
    D.setRepo(r.dir);
    const got = D.openPrFromFile();
    assert.deepStrictEqual(got, mark,
      `그 저장소의 기록을 안 읽었다 (읽은 것: ${JSON.stringify(got)}) — 이쪽 자리에 고정돼 있다`);
  } finally { D.setRepo(null); cleanup(r); }
});

test('setRepo(null) 이면 이 저장소로 돌아온다', () => {
  D.setRepo('/nowhere');
  D.setRepo(null);
  assert.ok(D.repo().endsWith('linkpilot-cron') || fs.existsSync(path.join(D.repo(), 'package.json')),
    `되돌아오지 않았다: ${D.repo()}`);
});
