'use strict';
/**
 * merge-watch.js — 갈래들이 **실제로** 어디서 부딪히는지 잰다.
 *
 * ★★ **왜 만들었나** 〈2026-08-26 사장님 지시〉.
 *   나는 「갈래가 다섯이 되면 병합이 어려워진다」고 말씀드렸는데, 그것은
 *   **사장님이 확인할 수 없는 말**이었다. 믿거나 말거나가 되면 판단을 못 하신다.
 *   그래서 재는 장치를 붙인다 — 「어렵다」가 아니라 「지금 12군데서 부딪힌다」로.
 *
 * ★★ **짐작하지 않는다.** 「같은 파일을 둘이 건드렸다」는 충돌이 아니다.
 *   서로 다른 줄을 고쳤으면 git 이 알아서 합친다. 그래서 파일 이름을 세지 않고
 *   `git merge-tree --write-tree` 로 **실제로 합쳐 보고** 부딪힌 것만 센다.
 *   체크아웃도 worktree 도 만들지 않으므로 몇 초면 끝난다.
 *
 * ★ **읽기만 한다.** 커밋·체크아웃·병합을 하지 않는다. 아무것도 바꾸지 않는다.
 *
 * 쓰는 법
 *   node im-agent/tools/merge-watch.js            사람이 읽는 표
 *   node im-agent/tools/merge-watch.js --json     기계가 읽는 JSON
 *   node im-agent/tools/merge-watch.js --html P   화면 한 장을 P 에 쓴다
 *   node im-agent/tools/merge-watch.js --no-fetch 원격을 안 받고 이 컴퓨터가 아는 것만 잰다
 *
 * ★ **원격 받아오기가 기본이다** (D-130). 안 받으면 「모르는 갈래」를 영영 모른다.
 *   못 받았으면 화면에 그렇게 적는다 — 조용히 옛 목록을 보여 주지 않는다.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

/** git 을 부른다. 실패해도 예외로 죽지 않고 {ok,out} 을 돌려준다 */
function git(args, opts = {}) {
  try {
    // ★ **한글 경로를 8진수로 escape 하지 않게 한다.** 기본값이 켜져 있어
    //   `docs/미결정-사항.md` 가 `"docs/\353\257\270..."` 로 나온다 — 화면에 그대로
    //   내면 사장님이 무슨 파일인지 못 읽으신다 (2026-08-26 실측).
    const out = execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    return { ok: true, out: out.trim(), code: 0 };
  } catch (e) {
    // merge-tree 는 **충돌이 있으면 1 로 끝난다** — 실패가 아니라 결과다
    return { ok: false, out: String(e.stdout || '').trim(), err: String(e.stderr || '').trim(), code: e.status };
  }
}

/** 기준 갈래 이름. main 이 없으면 master 를 본다 */
function baseRef() {
  for (const r of ['origin/main', 'origin/master']) {
    if (git(['rev-parse', '--verify', '--quiet', r]).ok) return r;
  }
  return null;
}

/** 작업 갈래 목록 (원격의 claude/*) */
function workBranches() {
  const r = git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']);
  if (!r.ok) return [];
  return r.out.split('\n')
    .map(s => s.trim())
    .filter(s => s.startsWith('origin/claude/'));
}

/** 짧은 이름 — 화면에 origin/claude/ 를 반복해 적지 않는다 */
function shortName(ref) {
  return ref.replace(/^origin\/claude\//, '').replace(/^origin\//, '');
}

/** 갈래 하나의 크기 */
function branchInfo(ref, base) {
  const ahead = git(['rev-list', '--count', `${base}..${ref}`]);
  const files = git(['diff', '--name-only', base, ref]);
  const last = git(['log', '-1', '--format=%h|%cI|%s', ref]);
  const [sha, at, subject] = (last.ok ? last.out : '||').split('|');
  return {
    ref,
    name: shortName(ref),
    ahead: ahead.ok ? Number(ahead.out) : null,
    files: files.ok && files.out ? files.out.split('\n') : [],
    head: sha || null,
    lastCommitAt: at || null,
    lastSubject: subject || null,
  };
}

/**
 * 두 갈래를 **실제로 합쳐 보고** 부딪힌 파일을 센다.
 *
 * ★ `--write-tree` 는 트리만 만들고 작업 디렉터리를 건드리지 않는다.
 *   충돌이 있으면 종료코드 1 이고, 출력의 둘째 줄부터 충돌 항목이 나온다.
 */
function conflictsBetween(a, b) {
  const r = git(['merge-tree', '--write-tree', '--name-only', a, b]);
  // 종료코드 0 = 깨끗이 합쳐짐 / 1 = 충돌 / 그 밖 = 잴 수 없음
  if (r.code === 0) return { ok: true, files: [] };
  if (r.code !== 1) {
    return { ok: false, files: [], error: r.err || `merge-tree 종료코드 ${r.code}` };
  }
  const lines = r.out.split('\n');
  // 첫 줄은 트리 OID, 그 다음 빈 줄까지가 충돌 파일 목록
  const files = [];
  for (let i = 1; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s) break;
    files.push(unquote(s));
  }
  return { ok: true, files };
}

/** git 이 한글 경로를 "\355\224..." 로 내놓는 것을 되돌린다 */
function unquote(s) {
  if (!(s.startsWith('"') && s.endsWith('"'))) return s;
  const body = s.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && /[0-7]/.test(body[i + 1] || '')) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else if (body[i] === '\\') {
      bytes.push(body.charCodeAt(i + 1)); i += 1;
    } else {
      bytes.push(body.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** 한 파일을 몇 갈래가 건드렸나 */
function fileHeat(branches) {
  const map = new Map();
  for (const b of branches) {
    for (const f of b.files) {
      if (!map.has(f)) map.set(f, []);
      map.get(f).push(b.name);
    }
  }
  return [...map.entries()]
    .map(([file, names]) => ({ file, count: names.length, branches: names }))
    .filter(x => x.count >= 2)
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

/* ───────────────────────── 갈래의 주인 ───────────────────────── */

const OWNERS_DOC = path.join(REPO, 'docs', '갈래-주인.json');

/** 적어 둔 주인 목록을 읽는다. 없으면 조용히 빈 것을 돌려준다 */
function readOwners() {
  try {
    return JSON.parse(fs.readFileSync(OWNERS_DOC, 'utf8'));
  } catch (e) {
    return { 갈래: [], _영역: {} };
  }
}

/** 파일 하나가 어느 영역인가. 여러 곳에 걸리면 **먼저 걸린 것**을 쓴다 */
function areaOf(file, areas) {
  for (const [name, pats] of Object.entries(areas || {})) {
    if (pats.some(p => file.includes(p))) return name;
  }
  return null;
}

/**
 * 갈래마다 **주인이 하나인가**, 그리고 **자기 영역 밖을 얼마나 건드렸나**.
 *
 * ★★ **왜 재는가** 〈2026-08-26 사장님 지시〉.
 *   Engineering Agent 와 SketchUp 트랙이 **한 갈래를 함께 쓰고 있다.**
 *   병합하고 나면 어느 커밋이 누구 것인지 못 가른다 — 그때는 이미 늦다.
 *   「나중에 문제가 되면」이 아니라 **지금 보이게** 한다.
 *
 * ★ **경계를 넘은 것이 곧 잘못은 아니다.** 공용 파일은 누구나 건드린다.
 *   다만 넘은 사실을 보이게 해서 사장님이 판단하실 수 있게 한다.
 */
function ownership(branches, allBranches) {
  const doc = readOwners();
  const areas = doc._영역 || {};
  const byBranch = new Map((doc.갈래 || []).map(x => [x.branch, x]));
  const rows = [];
  // ★★ **적어 뒀는데 원격에 없는 갈래** — 오타이거나, 이미 병합돼 사라진 것이다.
  //   오타면 그 갈래는 **영원히 주인이 없다.** 다만 이것을 검사(test)로 두면
  //   안 된다 — CI 는 그 PR 의 갈래 하나만 받아 오므로 나머지 셋이 늘 「없다」가 된다.
  //   **환경에 따라 답이 달라지는 것은 검사가 아니라 그때그때 말할 일이다** (2026-08-26 실측).
  //   ★ **이미 합쳐진 갈래는 「없다」가 아니다** 〈2026-08-26 · 병합 직후〉.
  //     `branches` 는 아직 안 합친 것만 담으므로, 그것만 보면 방금 합친 넷이
  //     통째로 「적어 뒀는데 안 보인다」로 뜬다. 그래서 **원격에 있는 전부**
  //     (`allBranches`)와 견준다. 진짜 없는 것만 남는다.
  const scope = allBranches || branches;
  const present = new Set(scope.map(b => b.ref.replace(/^origin\//, '')));
  const declaredMissing = (doc.갈래 || [])
    .map(x => x.branch)
    .filter(name => !present.has(name));

  for (const b of branches) {
    const full = b.ref.replace(/^origin\//, '');
    const dec = byBranch.get(full) || null;
    const co = dec && Array.isArray(dec.coOwners) ? dec.coOwners : [];
    const scope = dec && Array.isArray(dec.scope) ? dec.scope : null;

    // 영역별로 몇 파일을 건드렸나
    const counts = {};
    let outside = [];
    for (const f of b.files) {
      const a = areaOf(f, areas) || '그 밖';
      counts[a] = (counts[a] || 0) + 1;
      if (scope && a !== '그 밖' && !scope.includes(a)) outside.push({ file: f, area: a });
    }

    rows.push({
      branch: b.name,
      owner: dec ? dec.owner : null,
      coOwners: co,
      ownerCount: dec ? 1 + co.length : 0,
      scope,
      areas: counts,
      outside: outside.slice(0, 40),
      outsideCount: outside.length,
      note: dec ? dec.note || null : null,
      // ★ 세 가지만 경보로 올린다 — 그 밖은 판단이지 사실이 아니다
      alerts: [
        ...(!dec ? [{ level: 'HIGH', text: '주인을 적어 두지 않았다 — 누구 책임인지 알 수 없다' }] : []),
        ...(dec && 1 + co.length > 1
          ? [{ level: 'CRITICAL', text: `주인이 ${1 + co.length}입니다 (${[dec.owner, ...co].join(' · ')}) — 병합 뒤 누가 무엇을 했는지 못 가른다` }]
          : []),
        ...(outside.length
          ? [{ level: 'MEDIUM', text: `자기 영역 밖 ${outside.length}파일을 건드렸다` }]
          : []),
      ],
    });
  }
  rows.declaredMissing = declaredMissing;
  return rows;
}

/** 전부 잰다 */
function measure(opts = {}) {
  const base = baseRef();
  if (!base) return { ok: false, error: '기준 갈래(origin/main)를 못 찾았다' };

  /**
   * ★★ **먼저 원격을 통째로 받아온다** 〈2026-08-26 사장님 지시 · 권고 ③〉.
   *
   *   앞 판은 `opts.fetch` 일 때만, 그것도 **이미 아는 갈래만** 다시 받았다.
   *   그러면 **모르는 갈래는 영영 모른다** — 실제로 옛 크론 갈래 셋이 그렇게
   *   숨어 있다가, 내가 손으로 `--prune` 을 걸고 나서야 나타났다 (D-130).
   *   그때까지 화면은 「갈래 4개」라고 말하고 있었고, **그것이 거짓인 줄
   *   아무도 몰랐다.**
   *
   *   ★ **「없다」와 「안 받아왔다」는 다른 사실이다** (M-11 · M-12 와 같은 결).
   *     그래서 받아오기를 기본으로 돌리되, **성공했는지를 결과에 싣고**
   *     실패하면 화면에 그대로 적는다. 조용히 옛 목록을 보여 주지 않는다.
   *   ★ CI 처럼 원격에 못 닿는 자리가 있다. 거기서도 **죽지 않는다** —
   *     못 받았다고 적고 아는 것만으로 잰다.
   *   ★ `--prune` 은 **원격에서 사라진 이름을 이쪽에서도 지운다.** 안 지우면
   *     닫힌 갈래가 영원히 목록에 남아 짝 수를 부풀린다.
   */
  let fetched = { tried: false, ok: false, error: null };
  // ★ 검사·CI 자리(IM_AGENT_OFFLINE)에서는 원격을 안 부른다. 이 저장소가
  //   이미 쓰는 표시라 새 약속을 만들지 않는다. 안 불렀다는 사실은
  //   `tried:false` 로 남으므로 「없다」와 헷갈리지 않는다.
  const offline = String(process.env.IM_AGENT_OFFLINE || '').trim() !== '';
  if (opts.fetch !== false && !offline) {
    fetched.tried = true;
    const r = git(['fetch', '--prune', '--quiet', 'origin']);
    fetched.ok = r.ok;
    if (!r.ok) fetched.error = (r.err || '').split('\n')[0] || `종료코드 ${r.code}`;
  }

  const refs = workBranches();
  const all = refs.map(r => branchInfo(r, base));

  // ★★ **이미 합쳐진 갈래를 위험으로 세지 않는다** 〈2026-08-26 · 병합 직후 실측〉.
  //   네 갈래를 main 에 합친 **직후에 이 화면을 다시 열었더니** 「갈래 8개 ·
  //   견줄 짝 28개 · 7군데 부딪힘」이 나왔다. 전부 거짓이다 —
  //   합쳐진 갈래는 tip 이 그대로 남아 있어서 서로 merge-tree 를 하면 **병합 전의
  //   충돌이 그대로 재현된다.** 이미 푼 충돌을 아직 남은 것처럼 보여 준 것이다.
  //
  //   ★ 그래서 **기준(main)보다 앞선 커밋이 0개인 갈래는 「합쳐짐」으로 빼고**
  //     남은 것끼리만 견준다. 뺐다는 사실은 화면에 그대로 적는다 —
  //     조용히 빼면 「갈래가 사라졌다」로 읽힌다.
  //   ★ `ahead` 를 못 잰 갈래(null)는 **뺴지 않는다.** 모르는 것을 안전한
  //     쪽으로 짐작하면 진짜 위험이 사라진다.
  //   ★★ **「영원히 안 합칠 갈래」도 뺀다** 〈2026-08-26 사장님 지시 · D-130〉.
  //     옛 아침 크론 갈래 셋은 main 과 **뿌리가 다르다** — git 이 합치기를
  //     거절하므로 손으로 파일을 옮기지 않는 한 영영 안 합쳐진다. 그것을
  //     「아직 안 합친 갈래」로 세면 **그 숫자가 0 이 되는 날이 안 오고,
  //     0 이 안 되는 숫자는 아무도 안 본다.**
  //     `docs/갈래-주인.json` 에 `합치지않음: true` 로 적어 둔 것을 뺀다.
  const noMerge = new Set(
    (readOwners().갈래 || []).filter(x => x.합치지않음).map(x => x.branch)
  );
  const nameOf = b => b.ref.replace(/^origin\//, '');
  const branches = all.filter(b => b.ahead !== 0 && !noMerge.has(nameOf(b)));
  const merged = all.filter(b => b.ahead === 0);
  const archived = all.filter(b => b.ahead !== 0 && noMerge.has(nameOf(b)));

  // ── 두 갈래씩 전부 — 갈래가 하나 늘면 견줄 짝이 몇 개 느는지 그대로 보인다
  const pairs = [];
  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      const c = conflictsBetween(branches[i].ref, branches[j].ref);
      pairs.push({
        a: branches[i].name, b: branches[j].name,
        conflicts: c.files.length, files: c.files,
        error: c.error || null,
      });
    }
  }

  const heat = fileHeat(branches);
  const owners = ownership([...branches, ...archived], all);
  const totalConflicts = pairs.reduce((n, p) => n + p.conflicts, 0);
  const conflictedFiles = new Set(pairs.flatMap(p => p.files));

  return {
    ok: true,
    base,
    fetched,
    measuredAt: new Date().toISOString(),
    branches,
    merged,
    archived,
    pairs,
    heat,
    owners,
    summary: {
      branchCount: branches.length,
      mergedCount: merged.length,
      archivedCount: archived.length,
      pairCount: pairs.length,
      totalConflicts,
      distinctConflictedFiles: conflictedFiles.size,
      // ★ 갈래가 하나 늘면 견줄 짝이 몇 개 되는가 — n(n-1)/2 다.
      //   n 이 0 이면 `(0+1)*0/2` 라 +0 이 나온다 (`0*-1/2` 와 달리 -0 이 아니다).
      pairsIfOneMore: (branches.length + 1) * branches.length / 2,
      // ★ 주인이 둘인 갈래 · 주인이 없는 갈래 — 사장님이 가장 먼저 보실 숫자다
      sharedOwnerBranches: owners.filter(o => o.ownerCount > 1).length,
      unownedBranches: owners.filter(o => o.ownerCount === 0).length,
      // ★ 적어 뒀는데 지금 안 보이는 갈래. 오타일 수도, 병합돼 사라진 것일 수도 있다
      declaredMissing: owners.declaredMissing || [],
    },
  };
}

/* ───────────────────────── 사람이 읽는 표 ───────────────────────── */

function pad(s, n) {
  s = String(s == null ? '' : s);
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
}

function render(m) {
  if (!m.ok) return `✕ ${m.error}`;
  const L = [];
  L.push('');
  if (m.fetched && m.fetched.tried && !m.fetched.ok) {
    L.push('  ⚠️  **원격을 못 받아왔다** — 아래는 이 컴퓨터가 아는 것만이다.');
    L.push(`     ${m.fetched.error || '까닭 모름'}`);
    L.push('     「갈래가 없다」가 아니라 「못 받았다」다. 둘은 다른 사실이다.');
    L.push('');
  }
  L.push(`  아직 안 합친 갈래 ${m.summary.branchCount}개 · 견줄 짝 ${m.summary.pairCount}개`);
  L.push(`  ★ 실제로 부딪히는 곳 — 서로 다른 파일 ${m.summary.distinctConflictedFiles}개`);
  L.push('');
  L.push('  아직 안 합친 갈래');
  if (!m.branches.length) L.push('   (없다 — 열려 있는 갈래가 전부 기준에 들어가 있다)');
  for (const b of m.branches) {
    L.push(`   ${pad(b.name, 40)} ${String(b.ahead).padStart(4)}커밋  ${String(b.files.length).padStart(4)}파일  ${b.head || ''}`);
  }
  if ((m.archived || []).length) {
    L.push('');
    L.push(`  합치지 않기로 한 갈래 ${m.archived.length}개 — 아래 셈에서 뺐다 (D-130)`);
    for (const b of m.archived) {
      L.push(`   ⊘ ${pad(b.name, 40)} ${String(b.ahead).padStart(4)}커밋  ${b.head || ''}`);
    }
    L.push(`   (${shortName(m.base)} 과 뿌리가 달라 git 이 합치기를 거절한다 — 옛 아침 크론)`);
  }
  if ((m.merged || []).length) {
    L.push('');
    L.push(`  이미 ${shortName(m.base)} 에 들어간 갈래 ${m.merged.length}개 — 아래 셈에서 뺐다`);
    for (const b of m.merged) L.push(`   ● ${pad(b.name, 40)} ${b.head || ''}`);
    L.push('   (tip 이 남아 있어 서로 견주면 **병합 전 충돌이 그대로 재현된다** — 이미 푼 것이다)');
  }
  L.push('');
  L.push('  두 갈래씩 실제로 합쳐 본 결과 (0 이면 git 이 알아서 합친다)');
  for (const p of m.pairs.slice().sort((x, y) => y.conflicts - x.conflicts)) {
    const mark = p.error ? '?' : p.conflicts ? '✕' : '●';
    L.push(`   ${mark} ${pad(p.a, 34)} ↔ ${pad(p.b, 34)} ${String(p.conflicts).padStart(3)}군데`
      + (p.error ? `  (${p.error})` : ''));
  }
  const bad = m.owners.filter(o => o.alerts.some(a => a.level !== 'MEDIUM'));
  L.push('');
  L.push('  갈래의 주인 (하나여야 한다)');
  for (const o of m.owners) {
    const mark = o.ownerCount === 1 ? '●' : '✕';
    L.push(`   ${mark} ${pad(o.branch, 40)} ${o.owner || '(안 적음)'}`
      + (o.coOwners.length ? ` + ${o.coOwners.join(' · ')}` : '')
      + (o.outsideCount ? `   영역 밖 ${o.outsideCount}파일` : ''));
  }
  if ((m.summary.declaredMissing || []).length) {
    L.push('');
    L.push(`   ? 적어 뒀는데 지금 안 보이는 갈래 ${m.summary.declaredMissing.length}개`);
    for (const n of m.summary.declaredMissing) L.push(`     ${n}`);
    L.push('     (오타이거나, 이미 병합돼 사라진 것이다 — 원격을 다 받아왔는지 먼저 보라)');
  }
  if (bad.length) {
    L.push('');
    for (const o of bad) {
      for (const a of o.alerts.filter(x => x.level !== 'MEDIUM')) {
        L.push(`   ★ [${a.level}] ${o.branch} — ${a.text}`);
      }
    }
  }

  if (m.heat.length) {
    L.push('');
    L.push('  여러 갈래가 함께 건드린 파일 (부딪힌다는 뜻은 아니다 — 같은 줄일 때만 부딪힌다)');
    for (const h of m.heat.slice(0, 12)) {
      L.push(`   ${String(h.count)}갈래  ${pad(h.file, 48)} ${h.branches.join(' · ')}`);
    }
    if (m.heat.length > 12) L.push(`   … 그 밖 ${m.heat.length - 12}개`);
  }
  L.push('');
  L.push(`  ★ 갈래를 하나 더 열면 견줄 짝이 ${m.summary.pairCount} → ${m.summary.pairsIfOneMore} 개가 된다.`);
  L.push('    짝이 느는 만큼 손으로 풀 자리도 는다 — 이것이 「병합이 어려워진다」의 실제 내용이다.');
  L.push('');
  return L.join('\n');
}

/* ───────────────────────── 화면 한 장 ───────────────────────── */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function html(m) {
  // ★★ **못 쟀을 때도 제목이 있는 온전한 화면을 낸다** 〈2026-08-26 · CI 가 잡았다〉.
  //   앞 판은 `<p>✕ …</p>` 한 줄만 냈다. CI 는 얕은 체크아웃이라 `origin/main` 이
  //   없고, 그래서 제목 없는 조각이 나왔다 — **열어 보면 흰 화면이다.**
  //   못 잰 것과 「빈 화면」은 다르다. 못 잰 이유를 화면에 적는다.
  if (!m.ok) {
    return `<title>병합 감시</title>
<style>body{margin:0;font:400 15px/1.6 "IBM Plex Sans KR","Apple SD Gothic Neo",sans-serif;
 background:#F2F2F7;color:#0A1419}
@media(prefers-color-scheme:dark){body{background:#0C1114;color:#E9EEF1}}
.wrap{max-width:640px;margin:0 auto;padding:64px 20px}
h1{font-size:26px;letter-spacing:-.02em;margin:0 0 12px}
code{font-family:ui-monospace,Menlo,monospace;font-size:.9em}</style>
<div class="wrap">
<h1>재지 못했습니다</h1>
<p>${esc(m.error || '알 수 없는 이유')}</p>
<p>원격 갈래를 먼저 받아온 뒤 다시 재십시오 — <code>npm run merge:watch:html</code></p>
</div>`;
  }
  const worst = Math.max(0, ...m.pairs.map(p => p.conflicts));
  const rows = m.pairs.slice().sort((x, y) => y.conflicts - x.conflicts).map(p => `
    <tr>
      <td>${esc(p.a)}</td><td>${esc(p.b)}</td>
      <td class="n ${p.conflicts ? 'bad' : 'good'}">${p.conflicts}</td>
      <td class="f">${p.files.slice(0, 4).map(esc).join('<br>') || '<span class="dim">깨끗이 합쳐진다</span>'}${p.files.length > 4 ? `<br><span class="dim">… ${p.files.length - 4}개 더</span>` : ''}</td>
    </tr>`).join('');
  const heat = m.heat.slice(0, 14).map(h => `
    <tr><td class="n">${h.count}</td><td><code>${esc(h.file)}</code></td><td class="dim">${esc(h.branches.join(' · '))}</td></tr>`).join('');
  const brs = m.branches.map(b => `
    <tr><td>${esc(b.name)}</td><td class="n">${b.ahead}</td><td class="n">${b.files.length}</td>
        <td><code>${esc(b.head || '')}</code></td><td class="dim">${esc((b.lastCommitAt || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('');

  return `<title>병합 감시</title>
<style>
:root{--pg:#F2F2F7;--sf:#fff;--sf2:#FAFAFC;--ink:#0A1419;--ink2:#5C666E;--ink3:#8A939A;
 --ln:#E2E5E9;--lime:#AAE106;--limeInk:#3F5400;--red:#C0392B;--redBg:#FCEDEB;--ok:#1F7A4D;--okBg:#E9F5EE}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;
 --pg:#0C1114;--sf:#141A1E;--sf2:#101619;--ink:#E9EEF1;--ink2:#9AA5AD;--ink3:#6E797F;
 --ln:#242D33;--lime:#C2F13B;--limeInk:#0C1114;--red:#F08476;--redBg:#2A1614;--ok:#66C795;--okBg:#0F2419}}
:root[data-theme="dark"]{color-scheme:dark;--pg:#0C1114;--sf:#141A1E;--sf2:#101619;--ink:#E9EEF1;
 --ink2:#9AA5AD;--ink3:#6E797F;--ln:#242D33;--lime:#C2F13B;--limeInk:#0C1114;--red:#F08476;--redBg:#2A1614;--ok:#66C795;--okBg:#0F2419}
*{box-sizing:border-box}
body{margin:0;background:var(--pg);color:var(--ink);
 font:400 15px/1.6 "IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:44px 20px 80px}
.eyebrow{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
h1{margin:16px 0 0;font-size:clamp(28px,5vw,44px);font-weight:700;letter-spacing:-.03em;line-height:1.14}
h1 em{font-style:normal;border-bottom:5px solid var(--lime);padding-bottom:1px}
.sub{margin:14px 0 0;max-width:60ch;color:var(--ink2)}
h2{margin:44px 0 10px;font-size:19px;font-weight:700;letter-spacing:-.02em}
.scroll{overflow-x:auto;border:1px solid var(--ln);border-radius:12px;background:var(--sf)}
table{border-collapse:collapse;width:100%;min-width:560px;font-size:13.5px}
th,td{padding:10px 13px;text-align:left;vertical-align:top;border-bottom:1px solid var(--ln)}
tr:last-child td{border-bottom:0}
th{font:600 10.5px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase;
 color:var(--ink3);background:var(--sf2);white-space:nowrap}
td.n{font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}
td.n.bad{color:var(--red)}td.n.good{color:var(--ok)}
td.f{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--ink2)}
.dim{color:var(--ink3)}
code{font-family:ui-monospace,Menlo,monospace;font-size:.88em;background:var(--sf2);
 border:1px solid var(--ln);border-radius:4px;padding:1px 5px}
.cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin:26px 0 0}
.card{background:var(--sf);border:1px solid var(--ln);border-radius:12px;padding:16px 17px}
.card h3{margin:0 0 2px;font-size:13.5px;font-weight:600}
.card .big{font:600 32px/1.1 ui-monospace,Menlo,monospace;letter-spacing:-.03em;margin:2px 0 0}
.card p{margin:6px 0 0;font-size:13px;color:var(--ink2)}
.note{margin:20px 0 0;padding:14px 16px;border-radius:10px;background:var(--sf2);
 border:1px solid var(--ln);font-size:13.5px;color:var(--ink2)}
.note b{color:var(--ink)}
.foot{margin:52px 0 0;padding-top:18px;border-top:1px solid var(--ln);
 font:400 12px/1.7 ui-monospace,Menlo,monospace;color:var(--ink3)}
</style>
<div class="wrap">
<div class="eyebrow">병합 감시 · 실측 · ${esc(m.measuredAt.slice(0, 16).replace('T', ' '))} UTC</div>
${m.fetched && m.fetched.tried && !m.fetched.ok ? `<div class="note" style="border-color:var(--red);background:var(--redBg)">
  <b>⚠️ 원격을 못 받아왔습니다.</b> 아래 숫자는 <b>이 컴퓨터가 아는 것만</b>입니다 —
  그 사이에 새로 생긴 갈래는 여기에 없습니다.
  <br><span class="dim">${esc(m.fetched.error || '까닭 모름')}</span>
  <br><b>「갈래가 없다」가 아니라 「못 받았다」입니다.</b> 둘은 다른 사실입니다.
</div>` : ''}
<h1>지금 손으로 풀어야 할 곳은 <em>${m.summary.distinctConflictedFiles}개 파일</em>입니다.</h1>
<p class="sub">「같은 파일을 둘이 건드렸다」는 부딪힘이 아닙니다 — 서로 다른 줄이면 git 이 알아서 합칩니다.
그래서 파일 이름을 세지 않고 <b>실제로 합쳐 보고</b> 부딪힌 것만 셌습니다.
아무것도 바꾸지 않습니다(읽기만 합니다).</p>

<div class="cards">
  <div class="card"><h3>아직 안 합친 갈래</h3><div class="big" style="color:${m.summary.branchCount ? 'var(--ink)' : 'var(--ok)'}">${m.summary.branchCount}</div><p>기준 <code>${esc(m.base)}</code> · 이미 들어간 <b>${m.summary.mergedCount}</b>개와 합치지 않기로 한 <b>${m.summary.archivedCount}</b>개는 뺐습니다</p></div>
  <div class="card"><h3>견줄 짝</h3><div class="big">${m.summary.pairCount}</div><p>하나 더 열면 <b>${m.summary.pairsIfOneMore}</b> 개가 됩니다</p></div>
  <div class="card"><h3>실제로 부딪히는 파일</h3><div class="big" style="color:${m.summary.distinctConflictedFiles ? 'var(--red)' : 'var(--ok)'}">${m.summary.distinctConflictedFiles}</div><p>손으로 풀어야 하는 곳</p></div>
  <div class="card"><h3>가장 나쁜 짝</h3><div class="big">${worst}</div><p>한 번에 풀 곳이 가장 많은 조합</p></div>
  <div class="card"><h3>주인이 둘인 갈래</h3><div class="big" style="color:${m.summary.sharedOwnerBranches ? 'var(--red)' : 'var(--ok)'}">${m.summary.sharedOwnerBranches}</div><p>병합 뒤에는 누가 무엇을 했는지 못 가릅니다</p></div>
</div>

<h2>두 갈래씩 실제로 합쳐 본 결과</h2>
<div class="scroll"><table>
<tr><th>갈래 A</th><th>갈래 B</th><th>부딪힘</th><th>어디서</th></tr>
${rows}
</table></div>

<h2>갈래의 주인 — 하나여야 합니다</h2>
<div class="scroll"><table>
<tr><th></th><th>갈래</th><th>주인</th><th>맡은 영역</th><th>영역 밖</th></tr>
${m.owners.map(o => `<tr>
  <td class="n ${o.ownerCount === 1 ? 'good' : 'bad'}">${o.ownerCount === 1 ? '●' : '✕'}</td>
  <td>${esc(o.branch)}</td>
  <td>${esc(o.owner || '(안 적음)')}${o.coOwners.length ? `<br><span style="color:var(--red);font-weight:600">+ ${esc(o.coOwners.join(' · '))}</span>` : ''}</td>
  <td class="dim">${esc((o.scope || []).join(' · ') || '—')}</td>
  <td class="n">${o.outsideCount}</td>
</tr>`).join('')}
</table></div>
${m.owners.flatMap(o => o.alerts.filter(a => a.level !== 'MEDIUM').map(a =>
  `<div class="note"><b>[${a.level}] ${esc(o.branch)}</b> — ${esc(a.text)}${o.note ? `<br><span class="dim">${esc(o.note)}</span>` : ''}</div>`)).join('')}
<div class="note">
  <b>「영역 밖」이 곧 잘못은 아닙니다.</b> 문서·검사·설정 같은 공용 파일은 누구나 건드립니다.
  <b>보이게 해서 사장님이 판단하시게 하는 것</b>이 이 표의 목적입니다.
  <br>주인은 <code>docs/갈래-주인.json</code> 에 적혀 있고, 고치면 이 표가 따라옵니다.
</div>

${(m.archived || []).length ? `<h2>합치지 않기로 한 갈래 — 위 셈에서 뺐습니다 (D-130)</h2>
<div class="scroll"><table>
<tr><th>갈래</th><th>커밋</th><th>맨 위</th><th>마지막 커밋</th></tr>
${m.archived.map(b => `<tr><td>${esc(b.name)}</td><td class="n">${b.ahead}</td><td class="dim">${esc(b.head || '')}</td><td class="dim">${esc(b.lastSubject || '')}</td></tr>`).join('')}
</table></div>
<div class="note">
  <b>이 셋은 <code>${esc(shortName(m.base))}</code> 과 뿌리가 다릅니다.</b> 족보가 아예 달라서 git 이
  「뿌리가 다른 것은 안 합친다」며 거절합니다 — 손으로 파일을 옮기지 않는 한 <b>영원히 안 합쳐집니다.</b>
  옛 아침 크론 갈래이고, 크론을 다른 저장소로 옮길 때 통째로 가져갈 원재료입니다.
  <br><b>위 숫자에서 뺀 이유</b> — 영영 안 합쳐지는 것을 「할 일」로 세면 그 숫자가 0 이 되는 날이
  오지 않습니다. 0 이 안 되는 숫자는 아무도 안 봅니다. 뺐다는 사실은 여기 적어 둡니다.
  <br>표시는 <code>docs/갈래-주인.json</code> 의 <code>합치지않음</code> 에 있습니다.
</div>` : ''}

${(m.merged || []).length ? `<h2>이미 ${esc(shortName(m.base))} 에 들어간 갈래 — 위 셈에서 뺐습니다</h2>
<div class="scroll"><table>
<tr><th>갈래</th><th>맨 위</th><th>마지막 커밋</th></tr>
${m.merged.map(b => `<tr><td>${esc(b.name)}</td><td class="dim">${esc(b.head || '')}</td><td class="dim">${esc(b.lastSubject || '')}</td></tr>`).join('')}
</table></div>
<div class="note">
  <b>합쳐진 뒤에도 갈래의 맨 위(tip)는 그대로 남습니다.</b> 그 상태로 둘을 서로 견주면
  <b>병합 전의 충돌이 그대로 다시 나옵니다</b> — 이미 손으로 푼 것인데도 그렇습니다.
  그래서 기준보다 앞선 커밋이 0개인 갈래는 위 셈에서 뺍니다.
  뺐다는 사실을 여기 적어 두는 이유는, 조용히 빼면 「갈래가 사라졌다」로 읽히기 때문입니다.
</div>` : ''}

<h2>갈래별 크기</h2>
<div class="scroll"><table>
<tr><th>갈래</th><th>커밋</th><th>파일</th><th>맨 위</th><th>마지막 커밋</th></tr>
${brs}
</table></div>

<h2>여러 갈래가 함께 건드린 파일</h2>
<div class="scroll"><table>
<tr><th>갈래 수</th><th>파일</th><th>누가</th></tr>
${heat || '<tr><td colspan="3" class="dim">겹치는 파일이 없습니다</td></tr>'}
</table></div>
<div class="note">
  이 표는 <b>부딪힌다는 뜻이 아닙니다.</b> 같은 파일이라도 서로 다른 줄을 고쳤으면 git 이 합칩니다.
  <b>부딪히는 것은 위의 표</b>입니다. 이 표는 「앞으로 부딪힐 만한 자리」를 미리 보는 용도입니다.
</div>

<div class="note">
  <b>「갈래가 늘면 병합이 어려워진다」의 실제 내용.</b> 갈래가 ${m.summary.branchCount}개면 견줄 짝이
  ${m.summary.pairCount}개이고, 하나만 더 열면 <b>${m.summary.pairsIfOneMore}개</b>가 됩니다.
  짝이 느는 만큼 손으로 풀 자리도 늡니다. 어려워지는 것은 <b>갈래 수가 아니라 짝의 수</b>입니다.
</div>

<div class="foot">
  잰 방법 · <code>git merge-tree --write-tree</code> — 체크아웃도 worktree 도 만들지 않고 실제로 합쳐 본다<br>
  다시 재려면 · <code>npm run merge:watch</code>
</div>
</div>`;
}

/* ───────────────────────── 실행 ───────────────────────── */

function main(argv) {
  const opts = {
    json: argv.includes('--json'),
    // 받아오기가 **기본**이다 (D-130). `--no-fetch` 로만 끈다.
    // `--fetch` 는 앞 판의 습관이라 그대로 받아 준다 — 같은 뜻이다.
    fetch: argv.includes('--no-fetch') ? false : true,
    html: null,
  };
  const hi = argv.indexOf('--html');
  if (hi !== -1 && argv[hi + 1]) opts.html = argv[hi + 1];

  const m = measure(opts);

  if (opts.html) {
    fs.mkdirSync(path.dirname(opts.html), { recursive: true });
    fs.writeFileSync(opts.html, html(m), 'utf8');
    console.log(`${opts.html} · 병합 감시 화면`);
  }
  if (opts.json) {
    console.log(JSON.stringify(m, null, 2));
  } else if (!opts.html) {
    console.log(render(m));
  }
  return m.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { measure, render, html, conflictsBetween, fileHeat, unquote, shortName, workBranches, baseRef, ownership, readOwners, areaOf };
