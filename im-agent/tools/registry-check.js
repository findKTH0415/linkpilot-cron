'use strict';
/**
 * registry-check.js — 미결정 번호(D-번호)를 **한 곳에서 발급**하고 갈래 간 충돌을 잡는다.
 *
 *   npm run d:check              이 갈래만 본다 (중복·형식)
 *   npm run d:check -- --all     원격 갈래 전부와 대조한다 (충돌·다음 빈 번호)
 *   npm run d:next               다음 빈 번호 하나만 찍는다
 *
 * ★ **번호를 붙이는 장부가 둘이다.** 미결정(D-)과 사고기록(M-). 같은 병이 양쪽에
 *   있다 — 2026-08-25 실측으로 D 4건·M 6건이 겹쳤다. 그래서 한 도구가 둘 다 본다.
 *   `--registry d` · `--registry m` 으로 하나만 볼 수 있다 (기본은 둘 다).
 *
 * ★★ 왜 만들었나 — 2026-08-25 에 **실제로 났다.**
 *
 *   갈래 넷이 각자 D-번호를 붙였고, 세 벌이 겹쳤다:
 *     D-85   Engine·SketchUp 「조달청 기초금액」   ↔  Orchestrator 「pipeline 대체」
 *     D-86   Engine·SketchUp 「앱이 읽는 화면 폴더」 ↔  Orchestrator 「담당 없는 검토 넷」
 *     D-104  Engine 「Gemini 열쇠」               ↔  SketchUp 「개념 동 GFA」
 *     D-105  Engine 「관리자 구분」               ↔  SketchUp 「도로필지 동봉」
 *
 *   ★ 왜 이것이 비싼가 — **병합해도 조용하다.** 등록부는 사람이 읽는 마크다운이라
 *     같은 번호의 서로 다른 항목이 나란히 남고, git 은 그것을 충돌로 보지 않는
 *     경우가 있다. 그러면 코드 주석이 「D-85 참조」라고 가리키는데 등록부에는
 *     **다른 뜻의 D-85 가 있다.** 반년 뒤 아무도 못 되짚는다.
 *
 *   D-77 이 「두 저장소의 D-번호가 서로 다른 것을 가리킨다」로 이미 경고했는데
 *   같은 병이 **한 저장소 안의 갈래들 사이에서** 재발했다.
 *
 * ★ 이 스크립트는 **아무것도 고치지 않는다.** 재기만 한다 (verify-nas.js 와 같은 규칙).
 *
 * ★ 원격을 못 물어보면 **통과로 세지 않는다.** `못 잼` 으로 낸다 — 초록이 아닌데
 *   초록으로 보이는 것이 가장 나쁘다.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const DOC = path.join('docs', '미결정-사항.md');

/**
 * 번호를 붙이는 장부들.
 *   doc      저장소 안 경로
 *   head     머리말 정규식 — 1군=상태(있으면) 2군=번호 3군=제목
 *   prefix   번호 앞머리
 *
 * ★ **M- 은 상태 표시가 없다.** D- 처럼 ✅ 로 진도를 나타내지 않는다 —
 *   사고는 「결정」되는 것이 아니라 일어난 것이기 때문이다. 그래서 상태 비교를
 *   하지 않고 제목만 본다.
 */
const REGISTRIES = {
  d: { key: 'd', doc: DOC, prefix: 'D',
    head: /^###\s+(?:([🔴🟠🟡⚪✅]+)\s*)?(D-\d+)\.\s*(.*)$/, label: '미결정' },
  m: { key: 'm', doc: 'MEMORY.md', prefix: 'M',
    head: /^##\s+()(M-\d+)\.\s*(.*)$/, label: '사고기록' },
};

/** 이 저장소에서 동시에 도는 작업 갈래 — 원격 이름으로 찾는다 */
function remoteBranches() {
  try {
    const out = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'],
      { cwd: REPO, encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean).filter(b => b !== 'origin/HEAD');
  } catch (_) {
    return null;   // git 이 없거나 원격이 없다 — 못 잰 것으로 둔다
  }
}

function readAt(ref, doc = DOC) {
  if (ref === null) {
    const full = path.join(REPO, doc);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  }
  try {
    return execFileSync('git', ['show', `${ref}:${doc}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (_) {
    return null;
  }
}

/**
 * 등록부에서 항목을 뽑는다.
 * 머리말 모양: `### 🔴 D-84. 제목 …`  (상태 이모지는 있을 수도 없을 수도)
 */
function parse(text, reg = REGISTRIES.d) {
  if (!text) return [];
  const out = [];
  text.split('\n').forEach((line, i) => {
    const m = line.match(reg.head);
    if (m) out.push({ id: m[2], status: m[1] || null, title: m[3].trim(), line: i + 1 });
  });
  return out;
}

/** 제목이 「같은 것을 가리키는가」 — 앞 18자로 본다. 개정하면서 뒤가 늘어나기 때문 */
function sameSubject(a, b) {
  const norm = s => String(s).replace(/[*`〈〉<>·\s]/g, '').slice(0, 18);
  return norm(a) === norm(b);
}

function num(id) { return Number(id.slice(2)); }

/** 이 갈래 안에서 같은 번호를 두 번 쓰지 않았는가 */
function localDuplicates(items) {
  const seen = new Map();
  const dups = [];
  for (const it of items) {
    if (seen.has(it.id)) dups.push({ id: it.id, first: seen.get(it.id), second: it });
    else seen.set(it.id, it);
  }
  return dups;
}

/**
 * 갈래들 사이에서 **같은 번호가 다른 뜻**인 곳.
 *
 * ★★ 「충돌」과 「개정」을 가르는 기준은 **뿌리(main)에 그 번호가 있느냐**다.
 *
 *   뿌리에 있다 → 두 갈래가 **같은 항목을 각자 고친 것**이다. 제목이 달라져도
 *                 (「할 것인가」 → 「하나」) 가리키는 것은 하나다. **개정**이다.
 *   뿌리에 없다 → 두 갈래가 **각자 새 번호를 붙였다.** 같은 번호에 서로 다른
 *                 항목이 생겼다. **충돌**이다.
 *
 *   ★ 제목 비교만으로는 못 가른다 — 실제로 D-84(개정)와 D-85(충돌)가 제목
 *     비교에서 똑같이 「다르다」로 나왔다. 오탐이 섞이면 아무도 이 도구를 안 본다.
 *
 * @param {object} byBranch  갈래 → 항목 배열
 * @param {Array}  baseItems 뿌리(main)의 항목 — 없으면 제목으로만 가른다(정확도 떨어짐)
 */
function crossConflicts(byBranch, baseItems) {
  const baseIds = baseItems ? new Set(baseItems.map(i => i.id)) : null;
  const byId = new Map();
  for (const [branch, items] of Object.entries(byBranch)) {
    for (const it of items) {
      if (!byId.has(it.id)) byId.set(it.id, []);
      byId.get(it.id).push({ branch, ...it });
    }
  }
  const conflicts = [];
  const revisions = [];
  for (const [id, rows] of byId) {
    if (rows.length < 2) continue;
    const groups = [];
    for (const r of rows) {
      const g = groups.find(x => sameSubject(x[0].title, r.title));
      if (g) g.push(r); else groups.push([r]);
    }
    const inBase = baseIds ? baseIds.has(id) : false;
    if (groups.length > 1 && !inBase) conflicts.push({ id, groups });
    else if (groups.length > 1 || new Set(rows.map(r => r.status)).size > 1) revisions.push({ id, rows, groups });
  }
  conflicts.sort((a, b) => num(a.id) - num(b.id));
  return { conflicts, revisions };
}

/** 어느 갈래에서도 쓰이지 않은 가장 작은 번호 — 다음에 붙일 것 */
function nextFree(byBranch) {
  const used = new Set();
  for (const items of Object.values(byBranch)) for (const it of items) used.add(num(it.id));
  let n = 1;
  while (used.has(n)) n += 1;
  const max = used.size ? Math.max(...used) : 0;
  // ★ 빈 구멍을 재활용하지 않는다. 옛 대화·커밋이 그 번호를 다른 뜻으로 부른다
  return { next: max + 1, holes: [], maxUsed: max, firstUnused: n };
}

/** 장부 하나를 본다 — 화면에 찍고 충돌 수를 돌려준다 */
function checkOne(reg, argv) {
  const all = argv.includes('--all');
  const byBranch = {};
  const notes = [];

  byBranch['(작업본)'] = parse(readAt(null, reg.doc), reg);

  if (all) {
    const branches = remoteBranches();
    if (!branches) notes.push('원격 갈래를 못 물어봤다 — 이 결과는 이 갈래만 본 것이다');
    else {
      for (const b of branches) {
        const items = parse(readAt(b, reg.doc), reg);
        if (items.length) byBranch[b.replace(/^origin\//, '')] = items;
        else notes.push(`${b} 에서 ${reg.doc} 을 못 읽었다`);
      }
    }
  }

  const free = nextFree(byBranch);
  const dups = localDuplicates(byBranch['(작업본)']);
  const baseItems = all ? parse(readAt('origin/main', reg.doc), reg) : null;
  if (all && baseItems && !baseItems.length) notes.push('main 을 못 읽어 충돌·개정을 제목으로만 갈랐다 (오탐이 섞인다)');
  const { conflicts, revisions } = all ? crossConflicts(byBranch, baseItems) : { conflicts: [], revisions: [] };

  console.log(`\n─ ${reg.label} 번호 대조 (${reg.doc}) ─`);
  for (const [b, items] of Object.entries(byBranch)) {
    console.log(`  ${String(b).slice(0, 44).padEnd(44)} ${String(items.length).padStart(3)}건`);
  }

  if (dups.length) {
    console.log(`\n✕ 같은 갈래 안에서 번호가 겹친다 — ${dups.length}건`);
    for (const d of dups) {
      console.log(`   ${d.id}  ${d.first.line}줄 「${d.first.title.slice(0, 34)}」`);
      console.log(`   ${' '.repeat(d.id.length)}  ${d.second.line}줄 「${d.second.title.slice(0, 34)}」`);
    }
  }

  if (conflicts.length) {
    console.log(`\n✕ 갈래마다 같은 번호를 다른 뜻으로 쓴다 — ${conflicts.length}건`);
    for (const c of conflicts) {
      console.log(`   ${c.id}`);
      for (const g of c.groups) {
        console.log(`      ${g.map(r => r.branch).join(' · ')}`);
        console.log(`        └ ${g[0].title.slice(0, 62)}`);
      }
    }
  }

  if (revisions.length) {
    console.log(`\n· 같은 항목인데 갈래마다 상태가 다르다 — ${revisions.length}건 (충돌 아님 · 진도 차이)`);
    for (const r of revisions.slice(0, 8)) {
      const ahead = r.rows.filter(x => x.status === '✅');
      console.log(`   ${r.id}  ${r.rows[0].title.slice(0, 40)}`);
      console.log(`         진도 앞선 갈래: ${ahead.length ? ahead.map(x => x.branch.slice(0, 30)).join(' · ') : '—'}`);
    }
    if (revisions.length > 8) console.log(`   … 외 ${revisions.length - 8}건`);
  }

  for (const n of notes) console.log(`\n⚠ 못 잼 — ${n}`);

  const bad = dups.length + conflicts.length;
  console.log(`\n  ${reg.prefix}-${free.maxUsed} 까지 씀 · 다음 발급 **${reg.prefix}-${free.next}**`
    + ` · 충돌 ${bad}${notes.length ? ` · 못 잼 ${notes.length}` : ''}`);
  if (!bad) console.log('  겹치는 번호 없음');
  return { bad, next: free.next, reg };
}

function pickRegistries(argv) {
  const i = argv.indexOf('--registry');
  const want = i > -1 ? String(argv[i + 1] || '').toLowerCase() : null;
  if (want && REGISTRIES[want]) return [REGISTRIES[want]];
  return [REGISTRIES.d, REGISTRIES.m];
}

function run(argv) {
  const regs = pickRegistries(argv);

  // `--next` 는 번호 하나만 찍는다 — 스크립트가 받아 쓰기 좋게
  if (argv.includes('--next')) {
    for (const reg of regs) {
      const byBranch = { '(작업본)': parse(readAt(null, reg.doc), reg) };

      /**
       * ★★★ **`origin/main` 은 늘 함께 본다** 〈2026-08-29 · D-181〉.
       *
       *   하루에 **세 번** 겹쳤다 — D-164 · D-165 · D-169 를 main 이
       *   먼저 썼고, 그때마다 여섯 자리를 손으로 옮겼다.
       *
       * ★ 앞 판은 `--all` 을 줘야만 남의 갈래를 봤다. 그런데 번호를 딸
       *   때는 `--all` 을 안 준다 — 빠르니까. 그러면 **자기 갈래만 보고**
       *   이미 쓰인 번호를 또 딴다.
       *
       * ★★ 갈래 전부를 보는 것과는 다르다. main 은 **모두가 합치는
       *   줄기**라 거기 있는 번호는 예외 없이 이미 쓰인 것이다. 열려 있는
       *   남의 갈래는 안 합쳐질 수도 있지만 main 은 그럴 일이 없다.
       *
       * ★ 못 읽어도 멈추지 않는다 — 네트워크가 없는 자리가 있다. 그때는
       *   앞 판과 같은 답이 나오고, 그것이 **정확히 지금까지의 위험**이다.
       *   그래서 조용히 넘기지 않고 한 줄로 알린다 (§4.6 과 같은 결).
       */
      const trunk = parse(readAt('origin/main', reg.doc), reg);
      if (trunk.length) byBranch['origin/main'] = trunk;
      else if (!argv.includes('--quiet')) {
        console.error('※ origin/main 을 못 읽었다 — 이 번호는 내 갈래만 보고 낸 것이다 (겹칠 수 있다)');
      }

      if (argv.includes('--all')) {
        for (const b of (remoteBranches() || [])) {
          const items = parse(readAt(b, reg.doc), reg);
          if (items.length) byBranch[b] = items;
        }
      }
      console.log(`${reg.prefix}-${nextFree(byBranch).next}`);
    }
    return 0;
  }

  let bad = 0;
  for (const reg of regs) bad += checkOne(reg, argv).bad;

  if (bad) {
    console.log('\n★ 푸는 법 — **가장 늦게 붙인 쪽이 양보한다.** 먼저 붙인 번호를 코드·');
    console.log('  커밋·다른 문서가 이미 가리키고 있을 수 있다. 옮긴 쪽은 옛 번호를 지우지');
    console.log('  말고 「…에서 옮김」을 남긴다.');
    console.log('  ★ **한쪽이 늘 양보하는 것이 아니다** — 번호마다 선후가 다르다.');
    console.log('    실측: D-104 는 SketchUp 이 먼저였고 M-41 은 Engine 이 먼저였다.');
    console.log('    `git log -S"### 🔴 D-104." <갈래> -- <장부>` 로 각각 잰다.');
  }
  console.log('');
  return bad ? 1 : 0;
}

module.exports = {
  parse, localDuplicates, crossConflicts, nextFree, sameSubject, run,
  checkOne, pickRegistries, REGISTRIES, DOC,
};

if (require.main === module) process.exit(run(process.argv.slice(2)));
