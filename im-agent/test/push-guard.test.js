'use strict';
/**
 * push-guard.test.js — **「되돌리면 무엇이 사라지는가」를 재는 자리** 〈2026-09-21 · D-251〉
 *   〈사장님 「권하는 개선안 대로 진행해」 — 제가 올린 권장 ①〉
 *
 * ★★★ **왜 이 칸이 있나.** 내 손이 세 번 작업분을 날렸다 (§12-35 `git reset --hard` ·
 *   §12-37 `git checkout` · 2026-09-21 `git checkout -B` + force-push). 세 번 다
 *   잡아 준 것은 «규칙»이 아니라 **우연히 `git status` 를 세어 본 것**이라,
 *   그 규칙이 사람의 기억에 얹혀 있었다 (§8 · M-31 이 그 자리다).
 *
 * ★★ **「파일이 있는가」로는 아무것도 안 잰다** (§8). 그래서
 *   ① 도구는 **임시 저장소를 만들어 실제로 돌리고**
 *   ② 훅은 **가짜 원격에 진짜 push 를 해서** 막는지 본다.
 *
 * ★ **반대로도 막는다** — 보통 push 까지 막으면 그 훅은 쓸 수 없는 것이 되고,
 *   그때 「훅을 꺼 버릴까」가 된다 (§4.6 의 그 잣대).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'im-agent', 'tools', 'push-guard.js');
const HOOK = path.join(ROOT, '.githooks', 'pre-push');
const read = (p) => fs.readFileSync(p, 'utf8');

/** git 을 조용히 부른다 — 실패해도 던지지 않는다 */
function git(dir, args, env) {
  return spawnSync('git', ['-C', dir].concat(args), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, env || {}),
  });
}

/** 도구를 실제로 돌린다 — 되돌아오는 값과 화면 글을 둘 다 준다 */
function runTool(dir, extra) {
  const r = spawnSync(process.execPath, [TOOL, '--dir', dir].concat(extra || []), { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/**
 * 임시 저장소 한 벌 — 작업 저장소 + 가짜 «원격».
 * ★ 표본이 재려는 성질을 지켜야 한다 (§8) — 원격이 없으면 「덮이는 커밋」 갈래를
 *   영영 못 잰다. 그래서 진짜 bare 저장소를 만들어 진짜로 민다.
 */
function mkRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-pg-'));
  const remote = path.join(base, 'remote.git');
  const work = path.join(base, 'work');
  spawnSync('git', ['init', '--bare', '-b', 'main', remote], { encoding: 'utf8' });
  fs.mkdirSync(work);
  git(work, ['init', '-b', 'main']);
  git(work, ['config', 'user.email', 'a@b.c']);
  git(work, ['config', 'user.name', 't']);
  git(work, ['remote', 'add', 'origin', remote]);
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-m', 'one']);
  git(work, ['push', '-u', 'origin', 'main']);
  return { base, remote, work };
}

function rm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }

// ── ① 깨끗하면 0, 더러우면 1 — 갈래가 «갈린다» ────────────────────────────
test('깨끗한 트리는 값 0 · 커밋 안 된 변경이 있으면 값 1 이고 그 파일 이름을 적는다', () => {
  const R = mkRepo();
  try {
    const clean = runTool(R.work);
    assert.strictEqual(clean.code, 0, `깨끗한데 0 이 아닙니다 — 늘 빨개지면 그 빨강이 뜻을 잃습니다\n${clean.out}`);

    fs.writeFileSync(path.join(R.work, 'b.txt'), 'two\n');
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'one-edited\n');
    const dirty = runTool(R.work);
    assert.strictEqual(dirty.code, 1, `커밋 안 된 변경이 있는데 막지 않습니다\n${dirty.out}`);
    assert.match(dirty.out, /b\.txt/, '새로 만든 파일을 안 셉니다 — 추적 안 되는 파일이 가장 위험합니다');
    assert.match(dirty.out, /a\.txt/, '고친 파일을 안 셉니다');
  } finally { rm(R.base); }
});

// ── ② 이름은 적고 «내용»은 한 글자도 안 적는다 (§2) ───────────────────────
test('화면에 파일 «이름»만 적고 «내용»은 안 적는다 — 미끼 비밀로 잰다', () => {
  const R = mkRepo();
  const BAIT = 'lp-bait-secret-9d3f7a21c4';
  try {
    fs.writeFileSync(path.join(R.work, 'linkpilot.env'), `KEY=${BAIT}\n`);
    const r = runTool(R.work, ['--save']);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /linkpilot\.env/, '파일 이름을 안 적으면 어디를 고칠지 안 보입니다');
    assert.ok(!r.out.includes(BAIT), '★ 파일 «내용»이 화면에 샙니다 (§2) — 이 저장소는 공개입니다');
  } finally { rm(R.base); }
});

// ── ③ --save 가 «실제로» 베껴 둔다 · 자리가 .git 안이다 ──────────────────
test('--save 는 사라질 파일을 .git/lp-safety 아래에 실제로 베껴 둔다', () => {
  const R = mkRepo();
  try {
    fs.mkdirSync(path.join(R.work, 'deep'), { recursive: true });
    fs.writeFileSync(path.join(R.work, 'deep', 'c.txt'), 'three\n');
    const r = runTool(R.work, ['--save']);
    assert.strictEqual(r.code, 1);

    const safety = path.join(R.work, '.git', 'lp-safety');
    assert.ok(fs.existsSync(safety), '★ 베껴 두겠다고 적어 놓고 아무것도 안 베낍니다');
    const stamps = fs.readdirSync(safety);
    assert.ok(stamps.length >= 1, '베낀 자리가 비어 있습니다');
    const copied = path.join(safety, stamps[0], 'deep', 'c.txt');
    assert.ok(fs.existsSync(copied), '★ 경로를 살려 베끼지 않습니다 — 되살릴 때 어디로 돌려놓을지 사라집니다');
    assert.strictEqual(read(copied), 'three\n', '베낀 내용이 원본과 다릅니다');
  } finally { rm(R.base); }
});

// ── ④ 「못 쟀다」를 0 으로도 1 로도 뭉개지 않는다 (§8) ────────────────────
test('git 저장소가 아니면 값 2 «못 쟀다» — 0(안전)으로도 1(위험)로도 안 적는다', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-nogit-'));
  try {
    const r = runTool(d);
    assert.strictEqual(r.code, 2, `못 잰 것을 ${r.code} 로 적습니다 — 통과가 아닙니다 (§8)\n${r.out}`);
    assert.match(r.out, /못 쟀|안전하다는 뜻이 아닙니다/, '못 쟀다는 사실을 사람 말로 안 적습니다');
  } finally { rm(d); }
});

// ── ⑤ 원격에 없는 커밋을 센다 — 지문을 남긴다 ────────────────────────────
test('origin 에 없는 커밋을 세고, --save 가 그 지문을 COMMITS.txt 에 남긴다', () => {
  const R = mkRepo();
  try {
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'two\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-only-here-marker']);

    const r = runTool(R.work, ['--save']);
    assert.strictEqual(r.code, 1, `원격에 없는 커밋이 있는데 안전하다고 합니다\n${r.out}`);
    assert.match(r.out, /lp-only-here-marker/, '어느 커밋이 사라지는지 안 적습니다');

    const safety = path.join(R.work, '.git', 'lp-safety');
    const stamps = fs.readdirSync(safety);
    const notes = path.join(safety, stamps[0], 'COMMITS.txt');
    assert.ok(fs.existsSync(notes), '★ 커밋은 베낄 수 없으니 «지문»이라도 남겨야 합니다');
    assert.match(read(notes), /lp-only-here-marker/, '지문 파일에 그 커밋이 없습니다');
  } finally { rm(R.base); }
});

// ── ⑤-2 기준에 «이미 합쳐진» 커밋은 사라진다고 안 센다 ──────────────────
test('스쿼시로 기준에 이미 들어간 커밋을 «사라진다»로 안 센다 — 늘 빨가면 그 빨강이 뜻을 잃는다', () => {
  const R = mkRepo();
  try {
    /* ★★★ **이 도구가 «제 고장»을 찾아 준 자리다** 〈2026-09-21 · 실측〉.
         앞 판은 `origin/<이 가지>` 에만 없으면 「사라진다」고 적어 **12개를 잃는다고 했고
         그 대부분이 이미 합쳐진 것**이었다. 스쿼시 병합이면 늘 그렇다.
       ★ 잣대는 **「되돌리면 정말 사라지는가」**다 — 기준에 있으면 안 사라진다. */
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'squashed-change\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-squash-source']);

    /* ★★★ **표본이 재려는 성질을 지켜야 한다** 〈실측 · 사보타주가 한 번 빠져나갔다〉.
         처음에 원격 «작업가지»를 안 만들었더니 볼 ref 가 `origin/main` 하나뿐이라,
         「ref 마다 따로 돌리는가」를 무디게 해도 **수가 같아 안 잡혔다.**
       ★ 그래서 작업가지를 **X 가 들어가기 «전» 상태로** 원격에 밀어 둔다 —
         그러면 두 ref 의 답이 갈리고 그 갈래가 재진다 (§8). */
    git(R.work, ['checkout', '-q', '-b', 'lp-work']);
    git(R.work, ['push', '-q', '-u', 'origin', 'HEAD~1:refs/heads/lp-work']);
    git(R.work, ['branch', '-q', '--set-upstream-to=origin/lp-work']);
    git(R.work, ['checkout', '-q', 'main']);
    git(R.work, ['reset', '--hard', '-q', 'HEAD~1']);
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'squashed-change\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-squashed-into-main (#1)']);
    git(R.work, ['push', '-f', '-q', 'origin', 'main']);
    git(R.work, ['checkout', '-q', 'lp-work']);

    const r = runTool(R.work, ['--base', 'main']);
    assert.strictEqual(r.code, 0,
      `★ 기준에 이미 합쳐진 커밋을 「사라진다」로 셌습니다 — 늘 빨가면 아무도 안 봅니다\n${r.out}`);
    assert.ok(!/lp-squash-source/.test(r.out), '그 커밋을 목록에 적습니다');
  } finally { rm(R.base); }
});

test('기준에도 원격에도 «없는» 커밋은 여전히 센다 — 반대로도 막는다', () => {
  const R = mkRepo();
  try {
    git(R.work, ['checkout', '-q', '-b', 'lp-work2']);
    fs.writeFileSync(path.join(R.work, 'z.txt'), 'only-here\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-nowhere-else']);
    const r = runTool(R.work, ['--base', 'main']);
    assert.strictEqual(r.code, 1,
      `★ 어디에도 없는 커밋을 놓쳤습니다 — 그러면 이 도구가 없는 것과 같습니다\n${r.out}`);
    assert.match(r.out, /lp-nowhere-else/, '어느 커밋이 사라지는지 안 적습니다');
  } finally { rm(R.base); }
});

// ── ⑤-3 «여럿이 하나로» 스쿼시돼도 내용이 같으면 0 개다 ─────────────────
test('여러 커밋이 «하나로» 스쿼시돼도 내용이 같으면 «사라진다»로 안 센다', () => {
  const R = mkRepo();
  try {
    /* ★★★ **patch-id 로는 이것을 못 거른다** 〈2026-09-21 · 실측 · 두 번째〉.
         `--cherry-pick` 은 커밋 하나하나를 견준다. PR 의 커밋 «여럿»이 스쿼시로
         **한 커밋**이 되면 그 지문이 어느 쪽과도 안 맞아 **전부 「사라진다」**로 세졌다.
       ★ 잣대는 **내용**이다 — 이미 그 ref 에 다 있으면 잃을 것이 없다. */
    git(R.work, ['checkout', '-q', '-b', 'lp-multi']);
    for (const n of ['p', 'q', 'r']) {
      fs.writeFileSync(path.join(R.work, `${n}.txt`), n + '\n');
      git(R.work, ['add', '-A']);
      git(R.work, ['commit', '-m', `lp-part-${n}`]);
    }
    git(R.work, ['push', '-q', '-u', 'origin', 'lp-multi']);

    // main 에 «셋을 하나로» 합친 커밋이 들어간 상태 — 그것이 스쿼시 병합이다
    git(R.work, ['checkout', '-q', 'main']);
    for (const n of ['p', 'q', 'r']) fs.writeFileSync(path.join(R.work, `${n}.txt`), n + '\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-squashed-three (#9)']);
    git(R.work, ['push', '-q', 'origin', 'main']);
    git(R.work, ['checkout', '-q', 'lp-multi']);

    const r = runTool(R.work, ['--base', 'main']);
    assert.strictEqual(r.code, 0,
      `★ 스쿼시로 이미 들어간 셋을 「사라진다」로 셌습니다 — 늘 빨가면 아무도 안 봅니다\n${r.out}`);
  } finally { rm(R.base); }
});

test('내용이 «한 줄이라도» 다르면 여전히 센다 — 반대로도 막는다', () => {
  const R = mkRepo();
  try {
    git(R.work, ['checkout', '-q', '-b', 'lp-diff']);
    fs.writeFileSync(path.join(R.work, 'p.txt'), 'p\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-part-p']);
    git(R.work, ['push', '-q', '-u', 'origin', 'lp-diff']);
    /* 원격에 없는 «다른» 내용을 얹는다 — 이것은 정말 사라진다 */
    fs.writeFileSync(path.join(R.work, 'p.txt'), 'p-changed\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-really-new']);
    const r = runTool(R.work, ['--base', 'main']);
    assert.strictEqual(r.code, 1,
      `★ 정말 사라질 것을 놓쳤습니다 — 그러면 이 도구가 없는 것과 같습니다\n${r.out}`);
    assert.match(r.out, /lp-really-new/, '어느 커밋이 사라지는지 안 적습니다');
  } finally { rm(R.base); }
});

// ── ⑥ 훅이 «실제로» force-push 를 막는다 ─────────────────────────────────
test('훅이 원격 커밋을 덮는 push 를 실제로 막고, 덮일 지문을 먼저 적어 둔다', () => {
  const R = mkRepo();
  try {
    git(R.work, ['config', 'core.hooksPath', path.join(ROOT, '.githooks')]);
    // 원격에만 있는 커밋을 만든다
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'remote-side\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-will-be-overwritten']);
    git(R.work, ['push', 'origin', 'main']);
    // 그 커밋을 버리고 다른 것을 얹는다 — 이것이 2026-09-21 에 실제로 한 일이다
    git(R.work, ['reset', '--hard', 'HEAD~1']);
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'other\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'other']);

    const blocked = git(R.work, ['push', '--force', 'origin', 'main']);
    const out = (blocked.stdout || '') + (blocked.stderr || '');
    assert.notStrictEqual(blocked.status, 0, `★ 원격 커밋을 덮는 push 를 그냥 통과시킵니다\n${out}`);
    assert.match(out, /lp-will-be-overwritten/, '무엇이 덮이는지 안 적습니다 — 그러면 막기만 하고 고칠 자리가 안 보입니다');

    const safety = path.join(R.work, '.git', 'lp-safety');
    assert.ok(fs.existsSync(safety), '★ 막기 «전에» 지문을 적어 둬야 뚫고 미셔도 되돌릴 길이 남습니다');
    const forced = fs.readdirSync(safety).filter((s) => /-force$/.test(s));
    assert.ok(forced.length >= 1, '덮일 커밋을 적은 자리가 없습니다');
    assert.match(read(path.join(safety, forced[0], 'OVERWRITTEN.txt')), /lp-will-be-overwritten/, '적어 둔 파일에 그 커밋이 없습니다');

    // ★ 뚫는 길이 실제로 통해야 한다 — 막다른 길을 안 만든다 (§6-3 ⑥)
    const forcedOk = git(R.work, ['push', '--force', 'origin', 'main'], { LP_FORCE_OK: '1' });
    assert.strictEqual(forcedOk.status, 0,
      `★ LP_FORCE_OK=1 로도 못 밉니다 — 막다른 길입니다\n${(forcedOk.stdout || '') + (forcedOk.stderr || '')}`);
  } finally { rm(R.base); }
});

// ── ⑦ 반대로도 막는다 — 보통 push 는 «조용히» 통과한다 ───────────────────
test('앞으로 감는 보통 push 는 훅이 막지 않는다 (막으면 훅을 꺼 버리게 된다)', () => {
  const R = mkRepo();
  try {
    git(R.work, ['config', 'core.hooksPath', path.join(ROOT, '.githooks')]);
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'forward\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'forward']);
    const r = git(R.work, ['push', 'origin', 'main']);
    assert.strictEqual(r.status, 0,
      `★ 보통 push 까지 막습니다 — 그러면 이 훅은 쓸 수 없는 것이 됩니다\n${(r.stdout || '') + (r.stderr || '')}`);
  } finally { rm(R.base); }
});

// ── ⑧ 훅이 «조상인가»로 가른다 · 켜는 길이 있다 ──────────────────────────
test('훅은 «원격 머리가 내 것의 조상인가»로 가르고, 켜는 길과 뚫는 길이 글에 있다', () => {
  const h = read(HOOK);
  assert.match(h, /merge-base\s+--is-ancestor/,
    '★ force 를 «조상인가»로 안 가릅니다 — 다른 잣대는 보통 push 까지 막거나 아무것도 안 막습니다');
  assert.match(h, /LP_FORCE_OK/, '뚫는 길이 없으면 막다른 길입니다 (§6-3 ⑥)');
  assert.match(h, /hooks:on|core\.hooksPath/, '켜는 법이 글에 없으면 아무도 못 켭니다 (§5)');

  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
  assert.ok(pkg.scripts && pkg.scripts['hooks:on'], '★ `npm run hooks:on` 이 없습니다 — 켜는 길이 기억에 얹힙니다');
  assert.match(pkg.scripts['hooks:on'], /core\.hooksPath/, 'hooks:on 이 훅 자리를 안 잡습니다');
  assert.ok(pkg.scripts['push:guard'], '`npm run push:guard` 가 없습니다');
});

// ── ⑨ 잣대 자기검사 — 이 칸이 «무디어지면» 그 자리에서 빨개진다 ──────────
test('잣대 자기검사 — 추적 안 되는 파일을 안 세도록 무디게 하면 갈래가 무너진다', () => {
  const src = read(TOOL);
  // 지금 잣대: status 를 --untracked-files=all 로 묻는다
  assert.match(src, /--untracked-files=all/,
    '★ 추적 안 되는 파일을 안 셉니다 — 새로 만든 파일이 가장 위험한데 «0 개»로 보입니다 (§12-12)');
  // 지금 잣대: 베끼는 자리가 .git 안이다
  assert.match(src, /lp-safety/, '베끼는 자리 이름이 사라졌습니다');
  assert.match(src, /absolute-git-dir|\.git/, '★ 베끼는 자리가 `.git` 밖이면 `clean` 이 그것까지 지웁니다');
  // 지금 잣대: 「못 쟀다」가 따로 있다
  assert.match(src, /process\.exit\(2\)/, '★ 「못 쟀다」 갈래가 없으면 0 이나 1 로 뭉개집니다 (§8)');
  // 상한을 적어 두었는가 — 다 베낀 척하지 않는다
  assert.match(src, /truncated/, '★ 일부만 베낀 것을 다 베낀 것처럼 적으면 그 백업이 거짓말을 합니다 (§8)');
});

// ── ⑩ 기준 가지를 «짐작»하지 않는다 — 원격 어디에든 닿으면 안 사라진다 ──
test('기준 가지가 실제와 다른 저장소에서도 0 개다 — 기준을 짐작하면 늘 빨개진다', () => {
  const R = mkRepo();
  try {
    /* ★★★ **기준 가지를 «하나로 박으면» 저장소마다 틀린다** 〈2026-09-21 · 실측 · D-255〉.
         `linkpilot-platform` 에 새 가지를 처음 밀 때 **703 개를 잃는다**고 적었다.
         그 저장소의 일은 `platform` 가지에서 도는데 이 도구의 기준 기본값이 `main` 이고,
         거기 `origin/main` 은 703 커밋 뒤처진 다른 가지였다.
         잰 값: `origin/main` 703 · `origin/platform` 1 · **원격 전체 0**.
       ★ 표본이 그 성질을 지켜야 한다 — 기준(`main`)을 **일부러 뒤처지게** 두고
         진짜 일은 다른 원격 가지에서 돌린다. 그래야 「기준만 보는가」가 갈린다. */
    /* ★★★ **표본이 실제 고장 조건을 지켜야 한다** 〈실측 · 사보타주가 한 번 빠져나갔다〉.
         처음에 `origin/lp-real` 을 만들어 두었더니 **upstream ref 가 있어** 옛 코드도
         0 을 냈다 — 거르개를 꺼도 15칸이 전부 초록이었다.
       ★ 실제로 난 자리는 **upstream ref 가 아직 없고**(새 가지) 그 커밋이
         **«다른» 원격 가지에 있는** 경우다. 그때 옛 코드는 기준(main)만 보고 빨개졌다. */
    git(R.work, ['checkout', '-q', '-b', 'lp-real']);
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'real-work\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-real-1']);
    git(R.work, ['push', '-q', 'origin', 'HEAD:refs/heads/lp-archive']);  // «다른» 가지에 있다
    // origin/lp-real 은 «없다»(새 가지) · main 은 뒤처져 있다 → 기준만 보면 빨개진다
    const r = runTool(R.work, ['--base', 'main']);
    assert.strictEqual(r.code, 0,
      `★ 원격에 «있는» 커밋을 기준(main)에 없다는 이유로 「사라진다」로 셌습니다.\n`
      + `  새 가지를 밀 때마다 빨개지면 그 빨강이 뜻을 잃습니다 (§4).\n${r.out}`);
    assert.ok(!/lp-real-1/.test(r.out), '★ 그 커밋을 목록에 적습니다 — 원격에 멀쩡히 있습니다');
  } finally { rm(R.base); }
});

test('원격 어디에도 «안 닿는» 커밋은 여전히 센다 — 반대로도 막는다', () => {
  const R = mkRepo();
  try {
    git(R.work, ['checkout', '-q', '-b', 'lp-real']);
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'real-work\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-real-1']);
    git(R.work, ['push', '-q', 'origin', 'HEAD:refs/heads/lp-archive']);
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'never-pushed\n');   // 이것만 안 민다
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-never-pushed']);
    const r = runTool(R.work, ['--base', 'main']);
    assert.strictEqual(r.code, 1,
      `★ 어디에도 없는 커밋을 못 셉니다 — 넓게 고치면 이 도구가 없는 것과 같아집니다\n${r.out}`);
    assert.match(r.out, /lp-never-pushed/, '그 커밋의 지문을 안 적습니다');
    assert.ok(!/lp-real-1/.test(r.out), '★ 원격에 있는 커밋까지 함께 셌습니다');
  } finally { rm(R.base); }
});

// ── 원격을 «다 못 보는» 자리 — 「못 쟀다」를 「잃는다」로 안 적는다 (D-257) ────
/**
 * ★★★ **실측으로 잡았다** 〈2026-09-21〉. 이 개발 컨테이너의 `linkpilot-platform`
 *   클론은 `remote.origin.fetch` 가 `+refs/heads/main:refs/remotes/origin/main`
 *   **하나**였다. 그래서 방금 민 가지의 `origin/<가지>` 가 안 생기고, 이 도구가
 *   **「원격 어디에도 없는 커밋 1 개」**라고 적었다 — 그 커밋은 **이미 밀린 뒤**였다.
 * ★ 곧 **「못 쟀다」를 「잃는다」로 적은 것**이고, 이 도구가 제 머리말에 적어 둔
 *   §12-12 를 **스스로 어긴 자리**다. 늘 빨간 경고는 그 빨강이 뜻을 잃는다 (§4).
 */
test('원격을 다 못 보는 자리에서는 값 2(못 쟀다)다 — 1(잃는다)로 안 적는다', () => {
  const R = mkRepo();
  try {
    // refspec 을 «좁힌다» — 이 컨테이너가 실제로 그런 모양이었다
    git(R.work, ['config', '--unset-all', 'remote.origin.fetch']);
    git(R.work, ['config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main']);

    git(R.work, ['checkout', '-q', '-b', 'lp-narrow']);
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'pushed-but-unseen\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-pushed-1']);
    git(R.work, ['push', '-q', 'origin', 'HEAD:refs/heads/lp-narrow']);   // 진짜로 밀었다
    git(R.work, ['fetch', '-q', 'origin']);                               // 좁은 규칙이라 ref 가 안 생긴다

    assert.strictEqual(
      git(R.work, ['rev-parse', '--verify', '--quiet', 'origin/lp-narrow']).status !== 0, true,
      '★ 표본이 재려는 성질을 안 지킵니다 — 추적 ref 가 «없어야» 이 갈래를 잽니다 (§8)');

    const r = runTool(R.work, ['--base', 'main']);
    assert.strictEqual(r.code, 2,
      `★ 원격을 다 못 보는데 «잃는다(1)»로 적었습니다.\n`
      + `  그 커밋은 이미 밀려 있습니다 — 「못 쟀다」와 「없다」가 같은 값이면\n`
      + `  이 도구가 멀쩡한 push 마다 빨개집니다 (§12-12 · §4).\n${r.out}`);
    assert.match(r.out, /remote\.origin\.fetch/,
      '★ 무엇이 막았는지를 안 적습니다 — 사장님이 고칠 자리를 못 찾으십니다 (§4.6)');
    assert.match(r.out, /refs\/heads\/\*/,
      '★ 넓히는 법을 안 적습니다 — 막다른 길입니다 (§6-3 ⑥)');
  } finally { rm(R.base); }
});

/** ★ **반대로도 막는다** — 좁은 자리여도 «커밋 안 된 변경»은 로컬 사실이라 여전히 1 이다. */
test('원격을 다 못 봐도 커밋 안 된 변경은 여전히 값 1 이다 — 로컬 사실은 못 쟀다가 아니다', () => {
  const R = mkRepo();
  try {
    git(R.work, ['config', '--unset-all', 'remote.origin.fetch']);
    git(R.work, ['config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main']);
    git(R.work, ['checkout', '-q', '-b', 'lp-narrow2']);
    fs.writeFileSync(path.join(R.work, 'a.txt'), 'x\n');
    git(R.work, ['add', '-A']);
    git(R.work, ['commit', '-m', 'lp-c1']);
    git(R.work, ['push', '-q', 'origin', 'HEAD:refs/heads/lp-narrow2']);
    fs.writeFileSync(path.join(R.work, 'b.txt'), 'uncommitted\n');        // 이것이 진짜 위험이다
    const r = runTool(R.work, ['--base', 'main']);
    assert.strictEqual(r.code, 1,
      `★ 커밋 안 된 변경이 있는데 «못 쟀다(2)»로 넘겼습니다 — 그것은 원격과 무관한 로컬 사실입니다\n${r.out}`);
    assert.match(r.out, /b\.txt/, '그 파일 이름을 안 적습니다');
  } finally { rm(R.base); }
});
