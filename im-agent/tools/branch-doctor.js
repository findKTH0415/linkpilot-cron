'use strict';
/**
 * branch-doctor.js — **다른 갈래가 같은 파일을 건드리고 있는가.**
 *
 *   npm run branch:check
 *
 * ★★★ 왜 만들었나 〈2026-08-25 · D-101〉.
 *
 *   두 작업선이 같은 갈림점에서 나와 **같은 이름의 Agent 를 각자** 만들었고,
 *   **같은 파일을 쓰고 있었다.** 파일 이름이 같으니 병합은 「한쪽을 고르는
 *   것」으로 끝나고, **진 쪽 설계는 오류 하나 없이 사라진다.**
 *
 *   그때는 사장님이 저쪽 문서를 넘겨 주셔서 알았다. **안 넘겨 주셨으면
 *   병합하는 날에야 알았을 것이고, 그날 한쪽이 조용히 지워졌을 것이다.**
 *
 * ★★ **양쪽이 새로 만든 같은 경로**가 가장 위험하다 (add/add). 그때는 git 이
 *   합칠 근거가 아예 없어서 사람이 즉석에서 하나를 고르게 된다 — 그 자리가
 *   가장 틀리기 쉽다. 그래서 그것을 따로 센다.
 *
 * ★ 원격을 못 보면 **「못 쟀다」**로 적는다 (되돌아오는 값 2). 「겹치는 것이
 *   없다」와 **다른 사실**이다 — 못 잰 것을 통과로 세지 않는다 (M-11 · M-12 · M-30).
 *
 * ★ git 만 쓴다. 새 의존성을 들이지 않는다 (CLAUDE.md §5).
 *
 * 되돌아오는 값: 0 겹치는 것이 없다 · 1 겹친다 · 2 못 쟀다
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** 어느 갈래들을 견줄 것인가 — 작업선은 전부 이 접두사를 쓴다 */
const BRANCH_PREFIX = 'refs/heads/claude/';

/**
 * ★★ **멈춘 갈래까지 외치면 늘 빨갛고, 늘 빨가면 아무도 안 본다** (M-25 와 같은 결).
 *   닫힌 PR 은 git 만으로는 안 보이므로 **마지막 커밋 나이**로 가른다 —
 *   이보다 오래 멈춘 갈래는 「참고」로만 적고 판정에 넣지 않는다.
 * ★ 가른 기준을 화면에 적는다. 안 적으면 왜 빠졌는지 알 수 없다.
 */
const LIVE_DAYS = 14;

/**
 * 문서·기록은 **원래 여러 갈래가 함께 고친다.** 그것까지 겹쳤다고 외치면
 * 매번 빨개지고, **늘 빨가면 아무도 안 본다** (M-25 와 같은 결).
 * 여기 있는 것은 「겹쳤다」가 아니라 「합칠 때 손이 간다」로만 센다.
 */
const EXPECTED = [
  'CLAUDE.md', 'MEMORY.md', 'HANDOVER.md', 'README.md', 'package.json',
];
function expected(f) {
  return EXPECTED.includes(f) || f.startsWith('docs/')
    || f.startsWith('im-agent/ui/platform/section-')
    || f.endsWith('linkpilot-platform.html');
}

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * ★★★ **git 이 한글 이름을 따옴표로 감싸 준다** 〈2026-08-26 · 실측〉.
 *
 *   `docs/미결정-사항.md` 가 `"docs/\\353\\257\\270..."` 로 나온다.
 *   그러면 아래 `expected()` 의 `f.startsWith('docs/')` 가 **안 맞고**,
 *   원래 여러 갈래가 함께 고치는 문서가 **「같이 고친 코드」로 세어진다.**
 *
 *   실측에서 `docs/미결정-사항.md` 하나 때문에 판정이 「겹친다」로 갔다 —
 *   화면에도 알아볼 수 없는 글자로 찍혔다. **늘 빨간 검사는 아무도 안 본다**
 *   (M-25 와 같은 결). 세는 자리 앞에서 푼다.
 *
 * ★ 푸는 규칙은 `merge-watch.js` 가 이미 갖고 있다 — **거기서 가져다 쓴다.**
 *   여기 다시 적으면 두 벌이 되고, 그러면 한쪽이 옛말을 한다.
 */
const { unquote } = require('./merge-watch.js');

function changed(base, ref) {
  return git(`diff --name-only ${base}...${ref}`).split('\n').filter(Boolean).map(unquote);
}

/** 그 갈래가 **새로 만든** 파일 (없던 것을 더한 것) */
function added(base, ref) {
  return git(`diff --name-only --diff-filter=A ${base}...${ref}`).split('\n').filter(Boolean).map(unquote);
}

/**
 * ★★★ **열려 있는 PR 이 있으면 그것이 진짜 답이다** 〈2026-08-25〉.
 *   git 만으로는 **닫힌 PR 을 못 본다.** 그래서 나이로 어림하면 죽은 갈래가
 *   끼어들고, 그러면 늘 빨갛고, **늘 빨가면 아무도 안 본다** (M-25).
 * ★ 열쇠가 있으면 GitHub 에 물어 **열린 PR 의 갈래만** 견준다.
 *   없으면 나이로 어림하고, **어느 쪽으로 쟀는지 화면에 적는다** — 어림한 것을
 *   물어본 것처럼 말하지 않는다.
 * ★ 못 물어봤다고 죽지 않는다. 조용히 나이 어림으로 내려간다.
 */
/**
 * ★★★ **왜 못 물어봤는지를 남긴다** 〈2026-08-26 · 실측〉.
 *
 *   앞 판은 실패를 전부 `return null` 로 삼켰다. 그래서 화면에는
 *   「열린 PR 을 못 물어봤다」만 남고 **까닭이 없었다.** 실제로 이 자리에서
 *   열쇠도 있고 `fetch` 도 있고 저장소 이름도 맞는데 **401(Bad credentials)**
 *   이 오고 있었다 — 이 환경의 열쇠는 GitHub API 열쇠가 아니다.
 *   삼키면 「열쇠가 없다」와 「열쇠가 틀렸다」가 **같은 화면**이 된다.
 *
 * ★ 마지막 까닭을 여기 담아 둔다. 값은 한 글자도 안 남긴다 (§2).
 */
let LAST_WHY = null;
function whyNoPr() { return LAST_WHY; }

/**
 * **밖에서 답을 넣어 줄 수 있다** 〈2026-08-26 · 같은 실측〉.
 *
 * 이 자리에서는 GitHub API 를 직접 못 부른다(401). 그런데 **부를 수 있는 것이
 * 따로 있다** — 대화 쪽의 GitHub 도구다. 그쪽이 물어본 답을 파일에 적어 두면
 * 이 검사가 **어림하지 않고 물어본 판**이 된다.
 *
 *   LP_OPEN_PRS=<파일>   그 파일에 열린 PR 의 갈래 이름을 JSON 배열로 적는다
 *
 * ★ 형식은 **배열 하나**다. 「언제 받았는지」를 같이 적고 싶으면
 *   `{ "at": "...", "refs": [...] }` 도 받는다 — 받는 쪽을 늘리는 편이,
 *   적는 쪽이 형식을 틀려서 조용히 빈 배열이 되는 것보다 낫다.
 */
/** 자동으로 찾는 자리 — 아무도 손대지 않아도 여기 있으면 쓴다 */
const AUTO_PRS = path.join(ROOT, '.lp-open-prs.json');
/** ★ 이보다 낡은 기록은 **안 쓴다** (아래 까닭) */
const MAX_AGE_H = 12;
let LAST_AGE_H = null;
function prAgeHours() { return LAST_AGE_H; }

function ageOf(j) {
  const at = (j && !Array.isArray(j) && j.at) ? Date.parse(j.at) : NaN;
  if (!isFinite(at)) return null;
  return (Date.now() - at) / 3600000;
}

function openPrFromFile() {
  LAST_AGE_H = null;
  /* ★★ **손으로 넣은 자리가 먼저다.** 밖에서 대 준 답은 그 사람이 지금
   *   물어본 것이므로, 나이를 따지지 않고 쓴다 (다만 나이를 화면에 적는다). */
  const given = process.env.LP_OPEN_PRS;
  const auto = !given && fs.existsSync(AUTO_PRS);
  const p = given || (auto ? AUTO_PRS : null);
  if (!p) return null;
  if (!fs.existsSync(p)) { LAST_WHY = `LP_OPEN_PRS 가 가리키는 파일이 없다: ${p}`; return null; }
  let j;
  try { j = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { LAST_WHY = `LP_OPEN_PRS 파일을 못 읽었다 — ${e.message}`; return null; }
  const refs = Array.isArray(j) ? j : (j && Array.isArray(j.refs) ? j.refs : null);
  if (!refs) { LAST_WHY = 'LP_OPEN_PRS 파일이 배열도 {refs:[…]} 도 아니다'; return null; }
  LAST_AGE_H = ageOf(j);

  /* ★★★ **자동으로 찾은 기록은 나이를 따진다** 〈2026-08-27 · D-142〉.
   *
   *   이 길이 생기기 전에는 사람이 매번 파일을 대 줘야 했고, 안 대면 검사가
   *   「나이로 어림했다」로 끝났다. 그래서 자동으로 찾게 했는데 — **그러면
   *   낡은 파일이 남아 거짓말을 한다.** 어제 답으로 「지금 물어봤다」고 적는
   *   것이 못 물어본 것보다 나쁘다: 화면에는 「물어봤다」만 남아 아무도
   *   의심하지 않는다 (M-05 「옛말 하는 화면」과 같은 결).
   *
   *   그래서 자동 자리는 **시각이 적혀 있고 ${MAX_AGE_H}시간 안쪽**일 때만 쓴다.
   *   아니면 안 쓰고 **까닭을 남긴다** — 그 까닭이 곧 「다시 받아 오라」는 말이다. */
  if (auto) {
    if (LAST_AGE_H === null) {
      LAST_WHY = `열린 PR 기록(${path.basename(AUTO_PRS)})에 **받은 시각이 없다** — 언제 것인지 모르는 답은 안 쓴다`;
      LAST_AGE_H = null;
      return null;
    }
    if (LAST_AGE_H > MAX_AGE_H) {
      LAST_WHY = `열린 PR 기록이 **${Math.round(LAST_AGE_H)}시간 전** 것이다 (한도 ${MAX_AGE_H}시간) — 낡은 답으로 「물어봤다」고 하지 않는다. \`npm run prs:write\` 로 다시 받는다`;
      LAST_AGE_H = null;
      return null;
    }
  }
  return refs.map(String).filter(Boolean);
}

async function openPrBranches() {
  LAST_WHY = null;

  // ① 밖에서 넣어 준 답이 있으면 그것이 먼저다 — 물어본 것이지 어림한 것이 아니다
  const given = openPrFromFile();
  if (given) return given;

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) { LAST_WHY = '열쇠(GH_TOKEN·GITHUB_TOKEN)가 없다'; return null; }
  if (typeof fetch !== 'function') { LAST_WHY = '이 런타임에 fetch 가 없다'; return null; }
  let slug;
  try {
    slug = (git('config --get remote.origin.url').trim()
      .replace(/\.git$/, '').match(/github\.com[/:]([^/]+\/[^/]+)$/) || [])[1];
  } catch (_) { slug = null; }
  if (!slug) { LAST_WHY = 'origin 이 GitHub 저장소가 아니다'; return null; }
  try {
    const r = await fetch(`https://api.github.com/repos/${slug}/pulls?state=open&per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) {
      // ★ 상태코드만 적는다. 본문에는 열쇠가 섞여 올 수 있다 (§2)
      LAST_WHY = r.status === 401
        ? 'GitHub 가 열쇠를 안 받았다 (401) — 이 자리의 열쇠는 GitHub API 열쇠가 아니다'
        : `GitHub 가 ${r.status} 로 답했다`;
      return null;
    }
    const j = await r.json();
    if (!Array.isArray(j)) { LAST_WHY = 'GitHub 답이 목록이 아니다'; return null; }
    return j.map((p) => p && p.head && p.head.ref).filter(Boolean);
  } catch (e) {
    LAST_WHY = `GitHub 를 못 불렀다 — ${String(e.message).split('\n')[0]}`;
    return null;
  }
}

function check(openRefs) {
  let here;
  try { here = git('rev-parse --abbrev-ref HEAD').trim(); }
  catch (e) { return { measured: false, why: 'git 을 못 불렀다' }; }

  /* 원격 목록을 받아 온다 — 여기가 막히면 잰 것이 아니다 */
  let heads;
  try {
    heads = git('ls-remote --heads origin').split('\n').filter(Boolean)
      .map((l) => l.split('\t')[1]).filter((r) => r && r.startsWith(BRANCH_PREFIX))
      .map((r) => r.slice('refs/heads/'.length));
  } catch (e) {
    return { measured: false, why: `원격 목록을 못 받았다 — ${String(e.message).split('\n')[0]}` };
  }

  /* 열린 PR 목록을 받았으면 그것으로 좁힌다 — 닫힌 갈래는 견줄 것이 아니다 */
  const byPr = Array.isArray(openRefs);
  const others = heads.filter((b) => b !== here && (!byPr || openRefs.includes(b)));
  if (!others.length) return { measured: true, here, byPr, pairs: [] };

  const pairs = [];
  for (const b of others) {
    const ref = `origin/${b}`;
    let base;
    try {
      git(`fetch --quiet origin ${b}:refs/remotes/origin/${b}`);
      base = git(`merge-base HEAD ${ref}`).trim();
    } catch (e) {
      /**
       * ★★ **「뿌리가 다르다」와 「못 읽었다」는 다른 사실이다**
       *   〈2026-08-26 · 병합 뒤에 드러났다 · D-130〉.
       *
       *   `merge-base` 는 **공통 조상이 없으면** 아무것도 못 내놓고 1 로 끝난다.
       *   앞 판은 그것을 「못 읽었다」로 적었는데, 이 저장소에는 아침 크론 시절의
       *   갈래 셋이 **족보가 아예 다른 채로** 남아 있어서 **영원히 못 읽는다.**
       *   그러면 교차검증이 **영원히 「못 잼」으로 끝나고, 늘 노란 검사는
       *   아무도 안 본다** (M-25 와 같은 결).
       *
       *   ★ 그래서 공통 조상이 없는 갈래는 **「합칠 수 없는 갈래」로 갈라 적고**
       *     판정에서 뺀다. **빼되 화면에는 남긴다** — 조용히 빼면 사라진다.
       *   ★ 진짜로 못 읽은 것(권한·네트워크)은 그대로 「못 읽었다」로 남는다.
       */
      const hasBoth = (() => {
        try { git(`rev-parse --verify --quiet ${ref}`); return true; } catch (_) { return false; }
      })();
      if (hasBoth) { pairs.push({ branch: b, unrelated: true }); continue; }
      pairs.push({ branch: b, unreadable: String(e.message).split('\n')[0] });
      continue;
    }
    /* 이미 이쪽에 다 들어와 있으면 견줄 것이 없다 */
    let ahead = 0;
    try { ahead = Number(git(`rev-list --count HEAD..${ref}`).trim()); } catch (_) { ahead = 0; }
    if (!ahead) continue;

    /* 살아 있는 갈래인가 — 마지막 커밋 나이로 가른다 */
    let ageDays = null;
    try {
      const at = Number(git(`log -1 --format=%ct ${ref}`).trim()) * 1000;
      ageDays = Math.floor((Date.now() - at) / 86400000);
    } catch (_) { ageDays = null; }
    /* 열린 PR 로 좁혔으면 그 자체가 「살아 있다」는 뜻이다 — 나이는 참고다 */
    const live = byPr || ageDays === null || ageDays <= LIVE_DAYS;

    let mine; let theirs; let myAdd; let theirAdd;
    try {
      mine = new Set(changed(base, 'HEAD'));
      theirs = changed(base, ref);
      myAdd = new Set(added(base, 'HEAD'));
      theirAdd = new Set(added(base, ref));
    } catch (e) {
      pairs.push({ branch: b, unreadable: String(e.message).split('\n')[0] });
      continue;
    }

    const both = theirs.filter((f) => mine.has(f));
    const addAdd = both.filter((f) => myAdd.has(f) && theirAdd.has(f));
    const hard = both.filter((f) => !expected(f) && !addAdd.includes(f));
    if (both.length) {
      pairs.push({ branch: b, ahead, ageDays, live, addAdd, hard,
        soft: both.length - addAdd.length - hard.length });
    }
  }
  return { measured: true, here, byPr, pairs };
}

function verdict(r) {
  if (!r.measured) return { code: 2, line: `못 쟀다 — ${r.why}` };
  const unread = r.pairs.filter((p) => p.unreadable);
  const unrelated = r.pairs.filter((p) => p.unrelated);
  const live = r.pairs.filter((p) => !p.unreadable && !p.unrelated && p.live);
  const stale = r.pairs.filter((p) => !p.unreadable && !p.unrelated && !p.live);
  // 합칠 수 없는 갈래는 판정에서 빼되 **한 줄로 남긴다** (D-130)
  const orphan = unrelated.length
    ? ` · 뿌리가 달라 합칠 수 없는 갈래 ${unrelated.length}개는 뺐다 (${unrelated.map((p) => p.branch).join(' · ')})`
    : '';
  const bad = live.filter((p) => (p.addAdd || []).length || (p.hard || []).length);
  // ★ 못 물어봤으면 **까닭까지** 적는다 — 「열쇠가 없다」와 「열쇠가 틀렸다」는
  //   고치는 방법이 다르다. 까닭이 없으면 둘이 같은 화면이 된다 (실측: 401).
  const how = r.byPr
    ? (prAgeHours() === null ? '' : ` · 열린 PR 은 **${Math.round(prAgeHours())}시간 전에 받은 기록**으로 봤다`)
    : ` · 열린 PR 을 못 물어봐 **나이로 어림했다**${whyNoPr() ? ` (${whyNoPr()})` : ''}`;
  const tail = (stale.length ? ` (멈춘 갈래 ${stale.length}개는 참고로만 뒀다 — ${LIVE_DAYS}일 넘게 조용하다)` : '') + orphan + how;
  if (!bad.length && !unread.length) {
    return { code: 0, line: (live.length
      ? `살아 있는 갈래 ${live.length}개 — 문서·기록만 겹친다 (합칠 때 손이 간다)`
      : '견줄 살아 있는 갈래가 없다') + tail };
  }
  if (unread.length && !bad.length) {
    return { code: 2, line: `못 읽은 갈래가 있다: ${unread.map((p) => p.branch).join(', ')}` };
  }
  const parts = bad.map((p) => {
    const bits = [];
    if ((p.addAdd || []).length) bits.push(`**양쪽이 새로 만든 같은 파일 ${p.addAdd.length}개** (${p.addAdd.slice(0, 3).join(' · ')})`);
    if ((p.hard || []).length) bits.push(`같이 고친 코드 ${p.hard.length}개 (${p.hard.slice(0, 3).join(' · ')})`);
    return `${p.branch}: ${bits.join(' · ')}`;
  });
  /**
   * ★★★ **어림한 것으로 빨갛게 끝내지 않는다** 〈2026-08-25 · M-25 와 같은 결〉.
   *   열린 PR 을 못 물어봤으면 **닫힌 갈래가 섞여 있을 수 있다** — 실제로
   *   이 저장소에는 닫힌 PR 의 갈래가 셋 남아 있고, 그중 하나는 나이만으로는
   *   살아 있는 것과 구분이 안 된다. 그 상태로 빨갛게 끝내면 **멀쩡한 배포가
   *   늘 빨갛고, 늘 빨가면 진짜 겹침이 났을 때도 안 보인다.**
   * ★ 그래서 어림한 판은 **「못 쟀다」(2)** 다 — 통과가 아니다. 물어본 판만
   *   치명(1)으로 끝낸다. GitHub Actions 에서는 열쇠가 있어 물어본 판이 된다.
   */
  return { code: r.byPr ? 1 : 2, line: parts.join(' / ') + tail };
}

module.exports = { check, verdict, expected, openPrBranches, openPrFromFile, whyNoPr,
  prAgeHours, AUTO_PRS, MAX_AGE_H, LIVE_DAYS };

if (require.main === module) {
  (async () => {
  const r = check(await openPrBranches());
  const v = verdict(r);
  if (r.measured) {
    process.stdout.write(r.byPr
      ? '\n견주는 기준: **열린 PR 의 갈래** (GitHub 에 물어봤다)\n'
      : `\n견주는 기준: **마지막 커밋 나이** (열린 PR 을 못 물어봤다 — ${LIVE_DAYS}일 안이면 살아 있는 것으로 본다)\n`);
  }
  if (r.measured && r.pairs && r.pairs.length) {
    process.stdout.write(`\n지금 갈래: ${r.here}\n\n`);
    r.pairs.forEach((p) => {
      if (p.unreadable) { process.stdout.write(`  ⚠️  ${p.branch} — 못 읽었다: ${p.unreadable}\n`); return; }
      // 뿌리가 다른 갈래 — 견줄 근거가 없다. 빼되 보이게 적는다 (D-130)
      if (p.unrelated) {
        process.stdout.write(`  ⊘ ${p.branch} — **뿌리가 달라 합칠 수 없다**`
          + ' (공통 조상이 없다 · 옛 아침 크론 갈래)\n');
        return;
      }
      const age = p.ageDays === null ? '나이 모름' : `${p.ageDays}일 전`;
      process.stdout.write(`  ${p.live ? '·' : '⏸'} ${p.branch} (앞선 커밋 ${p.ahead}개 · 마지막 ${age}`
        + `${p.live ? '' : ' — 멈춘 갈래로 본다'})\n`);
      if (p.addAdd.length) process.stdout.write(`      ❌ 양쪽이 새로 만든 같은 파일: ${p.addAdd.join(', ')}\n`);
      if (p.hard.length) process.stdout.write(`      ❌ 같이 고친 코드: ${p.hard.join(', ')}\n`);
      if (p.soft) process.stdout.write(`      · 문서·기록 ${p.soft}개 — 원래 함께 고치는 것들이다\n`);
    });
    process.stdout.write('\n');
  }
  process.stdout.write(`겹치는 파일: ${v.line}\n`);
  if (v.code === 1) {
    process.stdout.write('\n★ **같은 파일 이름이면 병합은 「한쪽을 고르는 것」으로 끝난다** —\n'
      + '  진 쪽 설계는 오류 하나 없이 사라진다. 합치기 전에 어느 쪽이 맞는지 먼저 정한다 (D-101).\n');
  }
  process.exit(v.code);
  })();
}
