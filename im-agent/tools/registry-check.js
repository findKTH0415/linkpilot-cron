'use strict';
/**
 * registry-check.js — 미결정 번호(D-번호)를 **한 곳에서 발급**하고 갈래 간 충돌을 잡는다.
 *
 *   npm run d:check              이 갈래만 본다 (중복·형식)
 *   npm run d:check -- --all     원격 갈래 전부와 대조한다 (충돌·다음 빈 번호)
 *   npm run d:next               다음 빈 번호 하나만 찍는다
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

function readAt(ref) {
  if (ref === null) {
    const full = path.join(REPO, DOC);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  }
  try {
    return execFileSync('git', ['show', `${ref}:${DOC}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (_) {
    return null;
  }
}

/**
 * 등록부에서 항목을 뽑는다.
 * 머리말 모양: `### 🔴 D-84. 제목 …`  (상태 이모지는 있을 수도 없을 수도)
 */
function parse(text) {
  if (!text) return [];
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/^###\s+(?:([🔴🟠🟡⚪✅]+)\s*)?(D-\d+)\.\s*(.*)$/);
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

function run(argv) {
  const all = argv.includes('--all');
  const quiet = argv.includes('--next');

  const byBranch = {};
  const notes = [];

  const localItems = parse(readAt(null));
  byBranch['(작업본)'] = localItems;

  let branches = null;
  if (all) {
    branches = remoteBranches();
    if (!branches) notes.push('원격 갈래를 못 물어봤다 — 이 결과는 이 갈래만 본 것이다');
    else {
      for (const b of branches) {
        const items = parse(readAt(b));
        if (items.length) byBranch[b.replace(/^origin\//, '')] = items;
        else notes.push(`${b} 에서 등록부를 못 읽었다`);
      }
    }
  }

  const free = nextFree(byBranch);
  if (quiet) { console.log(`D-${free.next}`); return 0; }

  const dups = localDuplicates(localItems);
  // 뿌리는 main — 「새로 붙인 번호」와 「원래 있던 항목을 고친 것」을 가르는 기준
  const baseItems = all ? parse(readAt('origin/main')) : null;
  if (all && !baseItems.length) notes.push('main 을 못 읽어 충돌·개정을 제목으로만 갈랐다 (오탐이 섞인다)');
  const { conflicts, revisions } = all ? crossConflicts(byBranch, baseItems) : { conflicts: [], revisions: [] };

  console.log('\n─ 미결정 번호 대조 ─');
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
    console.log('\n   ★ 푸는 법 — **가장 늦게 붙인 쪽이 양보한다.** 먼저 붙인 번호를 코드·');
    console.log('     커밋·다른 문서가 이미 가리키고 있을 수 있다. 옮긴 쪽은 옛 번호를 지우지');
    console.log(`     말고 「D-xx 로 옮김」을 남긴다. 다음 빈 번호는 **D-${free.next}** 다.`);
  }

  if (revisions.length) {
    console.log(`\n· 같은 항목인데 갈래마다 상태가 다르다 — ${revisions.length}건 (충돌 아님 · 진도 차이)`);
    for (const r of revisions.slice(0, 12)) {
      const ahead = r.rows.filter(x => x.status === '✅');
      const who = ahead.length ? ahead.map(x => x.branch.slice(0, 30)).join(' · ') : '—';
      console.log(`   ${r.id}  ${r.rows[0].title.slice(0, 40)}`);
      console.log(`         진도 앞선 갈래: ${who}`);
    }
    if (revisions.length > 12) console.log(`   … 외 ${revisions.length - 12}건`);
    console.log('   ★ 병합할 때 **진도가 앞선 쪽(✅ 이 붙은 쪽)이 이긴다.** 결정을 되돌리지 않는다.');
  }

  for (const n of notes) console.log(`\n⚠ 못 잼 — ${n}`);

  const bad = dups.length + conflicts.length;
  console.log(`\n  번호 ${free.maxUsed}까지 씀 · 다음 발급 **D-${free.next}**`
    + ` · 충돌 ${bad}${notes.length ? ` · 못 잼 ${notes.length}` : ''}`);
  if (!bad) console.log('  겹치는 번호 없음');
  console.log('');
  return bad ? 1 : 0;
}

module.exports = { parse, localDuplicates, crossConflicts, nextFree, sameSubject, run, DOC };

if (require.main === module) process.exit(run(process.argv.slice(2)));
