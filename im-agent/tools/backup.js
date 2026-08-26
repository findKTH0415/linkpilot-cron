'use strict';
/**
 * backup.js — **되살릴 수 있는가.** 백업이 있는지가 아니다.
 *
 *   npm run backup:write   프로젝트 자료를 한 벌 떠 둔다
 *   npm run backup:drill   **복원시험** — 떠서·빈 자리에 되살리고·같은지 잰다
 *                          `-- --max-mb 500` 을 주면 그보다 크면 **못 쟀다**로 끝낸다
 *   npm run backup:verify  떠 둔 것이 지금 자료와 같은지만 잰다
 *
 * ★★★ **왜 만들었나** 〈2026-08-26 · 인수인계 완료검증 감사 H-1〉.
 *
 *   감사 지침 §11-4 가 이렇게 못 박았다 —
 *   **「백업의 존재가 아니라 실제 복원시험에 성공해야 한다」**.
 *
 *   재 보니 이 저장소에는 **백업 자체의 증빙도 없었다.** `core/vault.js` 는
 *   프로젝트가 받은 **자료를 보관**하는 곳이지 시스템 백업이 아니다.
 *   `deploy/engine.sh` 는 **엔진 코드**를 되돌릴 자리를 만들지만
 *   **프로젝트 자료(`im-projects/`)는 아무도 안 뜬다.**
 *
 *   지금 그 디스크가 죽으면 **무엇을 어떻게 되살리는지 아무도 모른다.**
 *
 * ★★ **「떴다」와 「되살아난다」는 다른 사실이다.** 이 저장소가 하루 종일
 *   부딪힌 결과 그대로다 — 「커밋했다 / 배포를 걸었다 / NAS 에 닿았다」가
 *   셋 다 다른 사실이었듯이(M-31), 「백업 파일이 있다」와 「그것으로 돌아온다」도
 *   다르다. 그래서 이 도구의 중심은 `--drill` 이다: **빈 자리에 실제로
 *   되살려 보고, 바이트가 같은지 센다.**
 *
 * ★ **라이브러리를 들이지 않는다** (§5). `tar` 도 안 쓴다 — 자리마다 판이 달라서
 *   「우리 기계에서는 되는데」가 생긴다. node 의 `fs` 와 `crypto` 만 쓴다.
 *
 * ★ **지문은 내용에서 나온다.** 시각을 섞지 않는다 — 섞으면 내용이 안 바뀌어도
 *   매번 달라져서 「어긋났다」와 「다시 떴다」를 못 가른다 (sync-im-flow 와 같은 규칙).
 *
 * 되돌아오는 값: 0 되살아난다 · 1 안 되살아난다 · 2 못 쟀다
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..', '..');

/**
 * 무엇을 지키는가 — **자료**다. 코드는 git 이 지킨다.
 *
 * ★★★ **프로젝트 폴더가 어디인지는 `store` 가 정한다** 〈2026-08-26 · D-137〉.
 *   운영 자리(NAS)는 `IM_AGENT_ROOT` 로 그 자리를 따로 가리킨다. 여기서
 *   `<저장소>/im-projects` 를 박아 두면 **NAS 에서 빈 폴더를 뜨고
 *   「되살아난다」**고 말한다 — 값도 형식도 멀쩡한 거짓말이다.
 *   그러니 **세는 자리와 같은 곳**에서 온다.
 */
const SOURCE = process.env.LP_BACKUP_SOURCE || require('../core/store').root();
/** 어디에 뜨는가 */
const DEST = process.env.LP_BACKUP_DEST || path.join(REPO, '.backup', 'im-projects');

/**
 * 뜨지 않는 것.
 *
 * ★ **다시 만들 수 있는 것은 안 뜬다.** 뜰수록 복원이 느려지고, 느린 복원은
 *   급할 때 안 쓰인다. 다만 **뺀 것을 목록에 적는다** — 조용히 빼면
 *   되살린 뒤에 「왜 이게 없지」가 된다.
 */
const SKIP = [/(^|\/)\.git(\/|$)/, /(^|\/)node_modules(\/|$)/, /(^|\/)\.DS_Store$/];

function skipped(rel) {
  return SKIP.some((re) => re.test(rel));
}

/** 한 폴더 아래 모든 파일을 상대경로로 (정렬해서 — 순서가 지문을 바꾸면 안 된다) */
function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const go = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (skipped(rel)) continue;
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) go(abs);
      else if (st.isFile()) out.push(rel);
      // ★ 심볼릭 링크는 따라가지 않는다. 따라가면 바깥 자료를 뜨거나 고리에 빠진다
    }
  };
  go(root);
  return out.sort();
}

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/** 폴더 하나의 목록과 지문 */
function inventory(root) {
  const files = {};
  for (const rel of walk(root)) {
    const abs = path.join(root, rel);
    files[rel] = { bytes: fs.statSync(abs).size, sha256: sha256(abs) };
  }
  return files;
}

/** 폴더 전체의 지문 하나 — 「같은가」를 한 값으로 묻고 싶을 때 */
function digestOf(files) {
  const h = crypto.createHash('sha256');
  for (const rel of Object.keys(files).sort()) {
    h.update(rel); h.update('\0'); h.update(files[rel].sha256); h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

function copyTree(from, to) {
  for (const rel of walk(from)) {
    const src = path.join(from, rel);
    const dst = path.join(to, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

/* ───────────────────────── 뜨기 ───────────────────────── */

/**
 * 한 벌 뜬다.
 *
 * ★ **먼저 옆에 만들고 마지막에 바꿔 단다.** 바로 덮으면 뜨는 도중에 죽었을 때
 *   **반쯤 뜬 백업**이 남는데, 그것은 없느니만 못하다 — 있다고 믿고 안 뜬다.
 */
function write({ source = SOURCE, dest = DEST } = {}) {
  if (!fs.existsSync(source)) {
    return { ok: false, code: 2, line: `뜰 자료가 없다: ${path.relative(REPO, source)}` };
  }
  const files = inventory(source);
  const staging = `${dest}.new`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  copyTree(source, staging);

  const manifest = { source: path.relative(REPO, source), digest: digestOf(files), files };
  fs.writeFileSync(path.join(staging, 'BACKUP-MANIFEST.json'),
    `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  fs.rmSync(`${dest}.old`, { recursive: true, force: true });
  if (fs.existsSync(dest)) fs.renameSync(dest, `${dest}.old`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(staging, dest);
  fs.rmSync(`${dest}.old`, { recursive: true, force: true });

  const n = Object.keys(files).length;
  const bytes = Object.values(files).reduce((a, f) => a + f.bytes, 0);
  return {
    ok: true, code: 0, digest: manifest.digest, count: n, bytes,
    line: `${n}개 파일 · ${Math.round(bytes / 1024)}KB · 지문 ${manifest.digest}`,
  };
}

/* ───────────────────────── 되살리기 ───────────────────────── */

/**
 * 뜬 것을 **빈 자리에** 되살린다.
 *
 * ★ 있는 자리에 덮어쓰지 않는다. 되살리기가 **지우는 일**이 되면 급할 때 못 쓴다 —
 *   무엇이 지워질지 몰라서 아무도 안 누른다.
 */
function restore({ from = DEST, to } = {}) {
  if (!fs.existsSync(from)) return { ok: false, code: 2, line: `뜬 것이 없다: ${from}` };
  if (!to) return { ok: false, code: 2, line: '되살릴 자리를 안 줬다' };
  if (fs.existsSync(to) && fs.readdirSync(to).length) {
    return { ok: false, code: 2, line: `되살릴 자리가 비어 있지 않다: ${to}` };
  }
  fs.mkdirSync(to, { recursive: true });
  copyTree(from, to);
  fs.rmSync(path.join(to, 'BACKUP-MANIFEST.json'), { force: true });
  return { ok: true, code: 0, line: `${walk(to).length}개 파일을 되살렸다` };
}

/**
 * ★★★ **복원시험.** 이것이 이 도구의 전부다.
 *
 *   ① 지금 자료를 뜬다  ② **빈 임시 자리**에 되살린다  ③ 바이트가 같은지 센다
 *
 * 「백업이 있다」로 끝내지 않고 **실제로 되살아나는 것**을 본다 (지침 §11-4).
 */
function drill({ source = SOURCE, maxMb = null } = {}) {
  if (!fs.existsSync(source)) {
    return { ok: false, code: 2, line: `잴 자료가 없다: ${source}` };
  }
  /**
   * ★★ **너무 크면 조용히 줄이지 않는다** 〈2026-08-26 · D-137〉.
   *   복원시험은 뜬 것과 되살린 것 **두 벌**을 임시 자리에 만든다. 자리가
   *   모자랄 때 **반쯤 하고 통과**하는 것이 가장 나쁘다 — 화면에는
   *   「되살아난다」만 남는다.
   * ★ 그래서 넘치면 **「못 쟀다」(2)** 로 끝낸다. 표본을 몰래 줄이지 않는다.
   */
  if (maxMb) {
    const bytes = Object.values(inventory(source)).reduce((a, f) => a + f.bytes, 0);
    const mb = bytes / (1024 * 1024);
    if (mb > maxMb) {
      return {
        ok: false, code: 2,
        line: `자료가 ${Math.round(mb)}MB 로 한도(${maxMb}MB)를 넘는다 — **못 쟀다.**`
          + ' 표본을 몰래 줄이면 「되살아난다」가 거짓이 된다. 한도를 올리거나'
          + ' 자리를 비우고 다시 잰다',
      };
    }
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-drill-'));
  try {
    const dest = path.join(tmp, 'backup');
    const back = path.join(tmp, 'restored');

    const w = write({ source, dest });
    if (!w.ok) return w;

    const r = restore({ from: dest, to: back });
    if (!r.ok) return r;

    const before = inventory(source);
    const after = inventory(back);

    const missing = Object.keys(before).filter((f) => !after[f]);
    const extra = Object.keys(after).filter((f) => !before[f]);
    const differ = Object.keys(before)
      .filter((f) => after[f] && after[f].sha256 !== before[f].sha256);

    const same = !missing.length && !extra.length && !differ.length;
    return {
      ok: same,
      code: same ? 0 : 1,
      count: Object.keys(before).length,
      digest: digestOf(before),
      missing, extra, differ,
      line: same
        ? `되살아난다 — ${Object.keys(before).length}개 파일이 바이트까지 같다 (지문 ${digestOf(before)})`
        : `**안 되살아난다** — 빠짐 ${missing.length} · 더 생김 ${extra.length} · 내용 다름 ${differ.length}`,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 떠 둔 것이 지금 자료와 같은가 (되살리지는 않는다) */
function verify({ source = SOURCE, dest = DEST } = {}) {
  const mp = path.join(dest, 'BACKUP-MANIFEST.json');
  if (!fs.existsSync(mp)) {
    return { ok: false, code: 2, line: '뜬 기록이 없다 — `npm run backup:write` 로 한 벌 뜬다' };
  }
  let saved;
  try { saved = JSON.parse(fs.readFileSync(mp, 'utf8')); }
  catch (e) { return { ok: false, code: 2, line: `뜬 기록을 못 읽었다 — ${e.message}` }; }

  const now = inventory(source);
  const nowDigest = digestOf(now);
  if (nowDigest === saved.digest) {
    return { ok: true, code: 0, line: `뜬 것이 지금 자료와 같다 (지문 ${nowDigest})` };
  }
  const added = Object.keys(now).filter((f) => !saved.files[f]).length;
  const gone = Object.keys(saved.files).filter((f) => !now[f]).length;
  return {
    ok: false, code: 1,
    line: `뜬 뒤로 자료가 바뀌었다 — 새 파일 ${added} · 사라진 파일 ${gone}`
      + ` (뜬 것 ${saved.digest} ↔ 지금 ${nowDigest}) · \`npm run backup:write\` 로 다시 뜬다`,
  };
}

/* ───────────────────────── 실행 ───────────────────────── */

function main(argv) {
  const mode = argv.find((a) => !a.startsWith('-')) || 'drill';
  const mi = argv.indexOf('--max-mb');
  const maxMb = mi !== -1 ? Number(argv[mi + 1]) || null : null;
  const r = mode === 'write' ? write()
    : mode === 'verify' ? verify()
      : drill({ maxMb });

  const mark = r.code === 0 ? '●' : (r.code === 2 ? '?' : '✕');
  process.stdout.write(`\n  ${mark} ${mode === 'write' ? '떴다' : mode === 'verify' ? '견줌' : '복원시험'} — ${r.line}\n`);

  if (mode === 'drill' && r.ok) {
    process.stdout.write('    ★ 「뜬 파일이 있다」가 아니라 **빈 자리에 되살려 바이트까지 대 봤다** (지침 §11-4)\n');
  }
  if (r.missing && r.missing.length) {
    process.stdout.write(`    빠진 것: ${r.missing.slice(0, 5).join(' · ')}${r.missing.length > 5 ? ' …' : ''}\n`);
  }
  if (r.differ && r.differ.length) {
    process.stdout.write(`    내용이 다른 것: ${r.differ.slice(0, 5).join(' · ')}${r.differ.length > 5 ? ' …' : ''}\n`);
  }
  process.stdout.write('\n');
  return r.code;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  SOURCE, DEST, SKIP, walk, inventory, digestOf, write, restore, drill, verify,
};
