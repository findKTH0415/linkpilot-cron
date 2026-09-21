'use strict';
/**
 * push-guard.js — **되돌리기 전에 「무엇이 사라지는가」를 재고, 사라질 것을 먼저 베껴 둔다**
 *   〈2026-09-21 사장님: 「권하는 개선안 대로 진행해」 — 제가 올린 권장 ① · D-251〉
 *
 * ## 왜 만드나 — 내 손이 «세 번» 작업분을 날렸다
 *
 *   §12-35  `git reset --hard origin/main`        → 손으로 고친 검사 둘이 사라졌다
 *   §12-37  `git checkout <검사 파일>`             → 커밋 안 된 이번 작업분이 통째로
 *   2026-09-21 `git checkout -B <가지> origin/main` → PR #89 의 커밋이 사라졌고
 *                                                     그 뒤 force-push 가 원격까지 덮었다
 *
 * ★★★ **세 번 다 잡아 준 것은 «규칙»이 아니라 우연히 세어 본 것**이다
 *   (§8-2 의 「커밋 전에 `git status --short` 로 눈으로 센다」). 그러면 그 규칙이
 *   **사람의 기억에 얹힌다** — 바쁜 날 빠진다 (§8 · M-31 이 그 자리다).
 *
 * ★★ **되돌리는 명령들의 공통 모양은 하나다 — 「무엇을 되돌리는가」를 안 보고 실행된다.**
 *   `git reset --hard` · `git checkout <파일>` · `git checkout -B` · `git clean` ·
 *   force-push. 앞 넷은 **커밋 안 된 변경**을 지우고(reflog 로도 못 되살린다),
 *   마지막은 **원격의 커밋**을 덮는다.
 *
 * ## 갈래 — 셋
 *
 *   안전    사라질 것이 없다                          → 되돌아오는 값 0
 *   잃는다  커밋 안 된 변경 · 원격/기준에 없는 커밋    → 1
 *   못 쟀다 git 이 아니거나 가지를 못 읽었다           → 2  (통과가 아니다 · §8)
 *
 * ★ **「못 쟀다」를 0 으로도 1 로도 뭉개지 않는다** — 그러면 못 잰 것이 통과나
 *   실패로 바뀐다 (§8 · `deploy-why.js` · `run-gate.js` 와 같은 잣대).
 *
 * ## 베끼는 자리 — `.git/lp-safety/<시각>/`
 *
 * ★★★ **`.git/` 안이라는 것이 규격이다.** `git checkout`·`reset`·`clean` 이
 *   그 안을 **안 건드리고**, push 에도 **안 간다** — 그러니 되돌릴 길이 남고
 *   비밀이 밖으로 새지도 않는다 (§2 · 이 저장소는 공개다 · D-10).
 *   스크래치에 두면 컨테이너가 바뀌는 날 함께 사라진다.
 *
 * ★★ **파일 «이름»만 화면에 적고 «내용»은 한 글자도 안 적는다** (§2).
 *   자료 파일 이름에는 사람 이름이 섞일 수 있어 폴더까지만 적는 규칙이 이미 있는데
 *   (§12-24), 여기는 저장소 안 소스라 이름까지 적는다 — 그 이름이 곧 고칠 자리다.
 *
 * ## 쓰는 법
 *
 *   node im-agent/tools/push-guard.js              # 재기만 한다
 *   node im-agent/tools/push-guard.js --save       # 잃을 것이 있으면 베껴 둔다
 *   node im-agent/tools/push-guard.js --base main  # 기준 가지 (기본 main)
 *   node im-agent/tools/push-guard.js --dir <경로>  # 다른 저장소를 잰다 (검사가 쓴다)
 *
 * ★ `.githooks/pre-push` 가 이것을 부른다 — **밀기 전에 스스로 돈다.**
 *   켜는 법은 `npm run hooks:on` 한 줄이다.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** 베끼는 양의 상한 — 넘으면 «일부만 베꼈다»고 적는다 (§8 — 다 베낀 척하지 않는다) */
const MAX_FILES = 300;
const MAX_BYTES = 20 * 1024 * 1024;

function arg(n, d) { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; }
function has(n) { return process.argv.indexOf(n) > 0; }

/**
 * git 을 부른다. **실패를 던지지 않고 `null` 로 돌려준다** —
 * 부르는 쪽이 「못 쟀다」와 「없다」를 가를 수 있어야 한다 (§12-12 의 그 잣대).
 */
function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir].concat(args), {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).replace(/\n+$/, '');
  } catch (_) { return null; }
}

/** 커밋 안 된 변경 — 고친 것 · 새로 만든 것(추적 안 됨) 둘 다 센다 */
function dirty(dir) {
  const out = git(dir, ['status', '--porcelain', '--untracked-files=all']);
  if (out == null) return null;
  if (!out) return [];
  return out.split('\n').map((l) => {
    const code = l.slice(0, 2);
    let p = l.slice(3);
    // 이름이 바뀐 것은 "옛 -> 새" 로 온다 — 새 이름을 쓴다
    const arrow = p.indexOf(' -> ');
    if (arrow > 0) p = p.slice(arrow + 4);
    // 빈칸이 든 이름은 따옴표로 온다
    if (p.startsWith('"') && p.endsWith('"')) { try { p = JSON.parse(p); } catch (_) {} }
    return { code: code.trim() || '??', path: p };
  });
}

/**
 * **주어진 ref 들 «어디에도» 없는** 커밋. 하나도 못 읽으면 null(못 쟀다).
 * ★ 스쿼시 병합이면 같은 일이 «다른 지문»으로 기준에 들어간다 — 그래서
 *   지문만으로는 「이미 합쳐졌다」를 못 본다. `--cherry-pick` 이 그것을 걸러 준다.
 */
function aheadNone(dir, refs) {
  const live = refs.filter((r) => r && git(dir, ['rev-parse', '--verify', '--quiet', r]) != null);
  if (!live.length) return null;
  /* ★★★ **`A...HEAD` 는 ref 를 «하나»만 받는다** 〈2026-09-21 · 실측으로 잡았다〉.
       처음에 `${live[0]}...HEAD ^${live[1]}` 로 섞어 썼더니 **patch-id 가 같은데도
       안 걸러졌다**(재 보니 두 지문의 patch-id 가 글자 하나 안 달랐다).
     ★ 그래서 **ref 마다 따로 돌려 «전부에서 빠진 것»만 남긴다** — 하나라도
       「이미 있다」고 하면 그 커밋은 안 사라진다. */
  let keep = null;
  for (const r of live) {
    const out = git(dir, ['rev-list', '--oneline', '--right-only', '--cherry-pick', `${r}...HEAD`]);
    if (out == null) continue;                       // 이 ref 는 못 쟀다 — 건너뛴다
    const set = out ? out.split('\n') : [];
    const ids = new Set(set.map((l) => l.split(' ')[0]));
    keep = keep === null ? set : keep.filter((l) => ids.has(l.split(' ')[0]));
  }
  return keep;                                       // null = 한 ref 도 못 쟀다
}

/** `<ref>` 에 없는 이 가지의 커밋 — 없는 ref 는 «못 쟀다»(null)로 돌려준다 */
function ahead(dir, ref) {
  if (git(dir, ['rev-parse', '--verify', '--quiet', ref]) == null) return null;
  const out = git(dir, ['rev-list', '--oneline', `${ref}..HEAD`]);
  if (out == null) return null;
  return out ? out.split('\n') : [];
}

/**
 * 잰다. 되돌아오는 것은 **사실만** — 무엇을 하라는 말은 부르는 쪽이 적는다
 * (§12-19 — 나르는 자리가 스스로 처방을 적지 않는다).
 */
function survey(dir, base) {
  const root = git(dir, ['rev-parse', '--show-toplevel']);
  if (root == null) return { ok: false, why: 'not-a-repo' };
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch == null) return { ok: false, why: 'no-branch' };

  const d = dirty(dir);
  if (d == null) return { ok: false, why: 'no-status' };

  const upstream = branch === 'HEAD' ? null : `origin/${branch}`;
  return {
    ok: true,
    root,
    branch,
    dirty: d,
    // ★ null 은 「그 ref 가 없다」이지 「앞선 커밋이 0개」가 아니다 (§12-12)
    aheadRemote: upstream ? ahead(dir, upstream) : null,
    aheadBase: ahead(dir, `origin/${base}`),
    /* ★★★ **«어디에도 없는» 커밋만 잃는다** 〈2026-09-21 · 이 도구가 제 고장을 찾았다〉.
         앞 판은 `origin/<이 가지>` 에만 없으면 「사라진다」고 적었는데, 그 커밋이
         **기준 가지에 이미 합쳐져 있으면 안 사라진다** — 스쿼시 병합이면 늘 그렇다.
         실측에서 **12개를 잃는다고 적었고 그 대부분이 이미 합쳐진 것**이었다.
       ★ 늘 빨간 경고는 **그 빨강이 뜻을 잃는다** (§4 의 그 결). 그러니
         **원격에도 없고 기준에도 없는 것**만 센다. */
    aheadBoth: aheadNone(dir, [upstream, `origin/${base}`]),
    base,
  };
}

/** 잃을 것이 있는가 — **커밋 안 된 변경**과 **어디에도 없는 커밋** 둘을 본다 */
function atRisk(s) {
  if (!s.ok) return null;
  const unsaved = s.dirty.length;
  /* ★ **어디에도 없는 것**만 센다 — 기준에 합쳐진 것은 되돌려도 안 사라진다.
       못 쟀으면(null) 예전 잣대로 물러난다 — 「못 쟀다」를 「없다」로 안 적는다 (§12-12). */
  const only = s.aheadBoth != null ? s.aheadBoth
    : (s.aheadRemote == null ? (s.aheadBase || []) : s.aheadRemote);
  const onlyHere = only.length;
  return { unsaved, onlyHere, any: unsaved > 0 || onlyHere > 0 };
}

/**
 * 베낀다. **`.git/lp-safety/<시각>/`** 아래에 경로를 그대로 살려 둔다.
 * 돌려주는 것: 어디에 · 몇 개 · 잘렸는가.
 */
function save(s) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const gitdir = git(s.root, ['rev-parse', '--absolute-git-dir']);
  if (gitdir == null) return { ok: false, why: 'no-gitdir' };
  const out = path.join(gitdir, 'lp-safety', stamp);

  let n = 0; let bytes = 0; let truncated = false;
  try {
    fs.mkdirSync(out, { recursive: true });
    for (const f of s.dirty) {
      if (n >= MAX_FILES || bytes >= MAX_BYTES) { truncated = true; break; }
      const src = path.join(s.root, f.path);
      let st;
      try { st = fs.statSync(src); } catch (_) { continue; }   // 지워진 파일은 벨 것이 없다
      if (!st.isFile()) continue;
      if (bytes + st.size > MAX_BYTES) { truncated = true; break; }
      const dst = path.join(out, f.path);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      n += 1; bytes += st.size;
    }
    // ★ 커밋은 베낄 수 없다 — **그 지문을 적어 둔다.** reflog 가 지워져도 이 글이 남는다
    const notes = [];
    if (s.aheadBoth && s.aheadBoth.length) notes.push(`어디에도 없는 커밋:\n` + s.aheadBoth.join('\n'));
    if (s.aheadRemote && s.aheadRemote.length) notes.push(`origin/${s.branch} 에 없는 커밋:\n` + s.aheadRemote.join('\n'));
    if (s.aheadBase && s.aheadBase.length) notes.push(`origin/${s.base} 에 없는 커밋:\n` + s.aheadBase.join('\n'));
    if (notes.length) fs.writeFileSync(path.join(out, 'COMMITS.txt'), notes.join('\n\n') + '\n', 'utf8');
  } catch (e) {
    return { ok: false, why: 'copy-failed', dir: out, files: n, error: String(e && e.message || e) };
  }
  return { ok: true, dir: out, files: n, bytes, truncated };
}

function main() {
  const dir = arg('--dir', process.cwd());
  const base = arg('--base', 'main');
  const s = survey(dir, base);

  if (!s.ok) {
    console.log('  ⚠ **못 쟀습니다** — 이 자리는 통과가 아닙니다.');
    console.log(`     (사유: ${s.why})`);
    console.log('  ★ git 저장소가 아니거나 가지를 못 읽었습니다. **안전하다는 뜻이 아닙니다.**');
    process.exit(2);
  }

  const r = atRisk(s);
  if (!r.any) {
    console.log(`  ✓ 사라질 것이 없습니다 — 가지 \`${s.branch}\``);
    if (s.aheadRemote == null) console.log(`  ★ 다만 \`origin/${s.branch}\` 를 못 읽었습니다 — 원격에 아직 없는 가지일 수 있습니다.`);
    process.exit(0);
  }

  console.log('  ❌ **되돌리면 사라지는 것이 있습니다.**');
  console.log('');
  if (r.unsaved) {
    console.log(`  · 커밋 안 된 변경 **${r.unsaved} 개 파일** — \`reset --hard\`·\`checkout\`·\`clean\` 이 지우면 **reflog 로도 못 되살립니다.**`);
    // ★ 이름만 적는다 — 내용은 한 글자도 안 적는다 (§2)
    s.dirty.slice(0, 20).forEach((f) => console.log(`      ${f.code}  ${f.path}`));
    if (s.dirty.length > 20) console.log(`      … 그리고 ${s.dirty.length - 20} 개 더`);
    console.log('');
  }
  if (r.onlyHere) {
    const list = s.aheadBoth != null ? s.aheadBoth
      : (s.aheadRemote == null ? s.aheadBase : s.aheadRemote);
    const where = s.aheadBoth != null ? `origin/${s.branch} 에도 origin/${s.base}`
      : (s.aheadRemote == null ? `origin/${s.base}` : `origin/${s.branch}`);
    console.log(`  · \`${where}\` 에도 없는 커밋 **${r.onlyHere} 개** — 가지를 옮기거나 force-push 하면 덮입니다.`);
    list.slice(0, 10).forEach((l) => console.log(`      ${l}`));
    if (list.length > 10) console.log(`      … 그리고 ${list.length - 10} 개 더`);
    console.log('');
  }

  if (has('--save')) {
    const k = save(s);
    if (k.ok) {
      console.log(`  ✓ **먼저 베껴 뒀습니다** — \`${path.relative(s.root, k.dir)}\` (파일 ${k.files} 개)`);
      if (k.truncated) console.log(`  ★ 양이 많아 **일부만** 베꼈습니다 — 상한 ${MAX_FILES} 개 · ${Math.round(MAX_BYTES / 1024 / 1024)} MB. 다 베낀 것이 아닙니다.`);
      console.log('  ★ 그 자리는 `.git/` 안이라 `checkout`·`reset`·`clean` 이 안 건드리고 push 에도 안 갑니다.');
    } else {
      console.log(`  ❌ **베끼지 못했습니다** (사유: ${k.why}) — 그러니 지금 되돌리면 **정말로 사라집니다.**`);
    }
    console.log('');
  } else {
    console.log('  ★ `--save` 를 주면 사라질 파일을 `.git/lp-safety/` 에 **먼저 베껴 둡니다.**');
    console.log('');
  }

  console.log('  ★★ 되돌리실 것이면 **무엇이 되돌아가는지** 위 목록을 먼저 보십시오.');
  console.log('     사보타주 한 줄을 되돌리는 것은 **그 한 줄**이고, `checkout`·`reset` 은 **그 파일 전체**입니다.');
  process.exit(1);
}

if (require.main === module) main();
module.exports = { survey, atRisk, save, dirty, ahead, MAX_FILES, MAX_BYTES };
