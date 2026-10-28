'use strict';
/**
 * sync-im-flow.js — **보낸 것과 받은 것이 같은가.**
 *
 *   npm run imflow:manifest        내가 보낸 것을 적는다 (매니페스트를 다시 만든다)
 *   npm run imflow:check           커밋된 매니페스트가 지금 파일과 같은가
 *   node …/sync-im-flow.js --verify <manifest.json>   받은 쪽 매니페스트와 견준다
 *
 * ★★★ **왜 만들었나** 〈2026-08-26 사장님 결정 · D-120〉.
 *
 *   경계가 정해졌다 —
 *     `linkpilot-platform` → 유저 접촉
 *     `linkpilot-cron`     → 유저가 보고서 요청 및 생산
 *
 *   그래서 **보고서 화면 16개는 이쪽이 본체**이고, 저쪽 `im-flow/` 는 **사본**이다.
 *   그런데 지금까지 **맞는지 재는 장치가 없었다.** 지침 §6 이 말한
 *   `sync-im-flow.js` 는 두 저장소 어디에도 없었고, 16개가 같은 것은
 *   **약속이 아니라 우연**이었다.
 *
 * ★★ **어긋나는 것이 예외가 아니라 기본값이다** 〈같은 날 실측〉.
 *   화면마다 **판 지문**(`LP_BUILD`)이 박혀 있어서, 이쪽이 한 번만 바뀌어도
 *   **16개 전부에 새 지문이 찍힌다.** 실제로 오늘 Agent 둘을 붙였더니
 *   사본 기준으로 **15개가 다름**으로 나왔다 — 내용은 그대로이고 지문만 바뀐 것이다.
 *
 *   ★ 그러니 「가끔 확인」으로는 안 된다. **이쪽이 나갈 때마다 사본도 나가야 하고,
 *     그 사실을 잴 수 있어야 한다.** 그것이 이 도구다.
 *
 * ★ **목록을 새로 적지 않는다.** 사본 16개는 배포 묶음 16개와 **같은 목록**이라
 *   `build-embed.js` 의 `required()` 를 그대로 쓴다. 여기 다시 적으면 두 벌이 되고,
 *   그러면 한쪽이 옛말을 한다.
 *
 * ★ **받는 쪽 형식을 따랐다.** 저쪽이 이미 `im-flow/manifest.json` 을
 *   `{at, files:{name:{bytes, sha256}}}` 로 만들고 있었다. 내가 새 형식을
 *   들이면 저쪽이 못 읽는다 — 맞추는 쪽이 이쪽이다.
 *
 * 되돌아오는 값: 0 같다 · 1 어긋났다 · 2 못 쟀다
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO, 'im-agent', 'ui', 'platform');
/** 이쪽이 「보냈다」고 적어 두는 곳 — 저쪽 `im-flow/manifest.json` 과 같은 형식 */
const OUT = path.join(SRC_DIR, 'im-flow.manifest.json');

/** 보내는 파일 목록. **한 곳에서만 온다** (build-embed 의 묶음과 같다) */
function files() {
  const embed = require('../ui/platform/build-embed');
  return embed.required()
    .map(p => path.basename(String(p)))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();
}

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/**
 * 지금 파일들로 매니페스트를 만든다.
 *
 * ★ `at` 은 **주어진 값만 쓴다.** 여기서 시각을 찍으면 내용이 안 바뀌어도
 *   매니페스트가 매번 달라져서, 「어긋났다」와 「다시 만들었다」를 못 가른다.
 */
function build({ at = null } = {}) {
  const out = { at, files: {} };
  const missing = [];
  for (const f of files()) {
    const p = path.join(SRC_DIR, f);
    if (!fs.existsSync(p)) { missing.push(f); continue; }
    out.files[f] = { bytes: fs.statSync(p).size, sha256: sha256(p) };
  }
  return { manifest: out, missing };
}

/**
 * 매니페스트 하나를 지금 파일과 견준다.
 *
 * ★ **셋으로 가른다.** 「다름」과 「없음」을 한 덩어리로 세면 무엇을 해야 하는지
 *   알 수 없다 — 다름은 다시 보내는 일이고, 없음은 목록이 갈린 일이다.
 */
function compare(manifest) {
  const now = build().manifest.files;
  const theirs = (manifest && manifest.files) || {};
  const same = [];
  const diff = [];
  const missingHere = [];   // 저쪽에는 있는데 이쪽에 없다 — 목록이 갈렸다
  const extraHere = [];     // 이쪽에는 있는데 저쪽에 없다 — 아직 안 보냈다

  for (const [f, m] of Object.entries(theirs)) {
    if (!now[f]) { missingHere.push(f); continue; }
    if (now[f].sha256 === m.sha256) same.push(f);
    else diff.push({ file: f, ours: now[f].sha256.slice(0, 8), theirs: String(m.sha256).slice(0, 8) });
  }
  for (const f of Object.keys(now)) if (!theirs[f]) extraHere.push(f);

  return { same, diff, missingHere, extraHere, ok: !diff.length && !missingHere.length && !extraHere.length };
}

/** 커밋된 매니페스트가 지금 파일과 같은가 */
function checkCommitted() {
  if (!fs.existsSync(OUT)) {
    return { ok: false, code: 2, line: `보낸 기록이 없다 — \`npm run imflow:manifest\` 로 만든다 (${path.relative(REPO, OUT)})` };
  }
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch (e) {
    return { ok: false, code: 2, line: `보낸 기록을 못 읽었다 — ${e.message}` };
  }
  const r = compare(saved);
  if (r.ok) {
    return { ok: true, code: 0, line: `보낸 기록이 지금 화면 ${r.same.length}개와 같다`, result: r };
  }
  const bits = [];
  if (r.diff.length) bits.push(`내용이 바뀐 화면 ${r.diff.length}개`);
  if (r.extraHere.length) bits.push(`기록에 없는 화면 ${r.extraHere.length}개`);
  if (r.missingHere.length) bits.push(`기록에만 있는 화면 ${r.missingHere.length}개`);
  return {
    ok: false, code: 1, result: r,
    line: `${bits.join(' · ')} — 사본(linkpilot-platform 의 im-flow/)이 옛 판이다. \`npm run imflow:manifest\` 로 기록을 갱신하고 사본도 함께 보낸다`,
  };
}

/* ───────────────────────── 사람이 읽는 표 ───────────────────────── */

function render(r, title) {
  const L = ['', `  ${title}`, ''];
  if (r.ok) {
    L.push(`  ● 같다 — 화면 ${r.same.length}개`);
    L.push('');
    return L.join('\n');
  }
  if (r.diff.length) {
    L.push(`  ✕ 내용이 다른 화면 ${r.diff.length}개 (앞 여덟 글자)`);
    for (const d of r.diff) L.push(`     ${d.file.padEnd(20)} 이쪽 ${d.ours}  ↔  사본 ${d.theirs}`);
    L.push('');
    L.push('     ★ 대개 **판 지문**만 다르다 — 이쪽이 한 번 바뀌면 화면 16개에');
    L.push('       전부 새 지문이 찍히기 때문이다. 그래도 **다른 것은 다른 것이다**:');
    L.push('       사본이 옛 지문을 달고 있으면 사장님이 화면 아래 여덟 글자로');
    L.push('       판을 가리실 때 **틀린 답**을 보신다.');
  }
  if (r.extraHere.length) {
    L.push('');
    L.push(`  ✕ 이쪽에만 있는 화면 ${r.extraHere.length}개 — 아직 사본에 안 보냈다`);
    for (const f of r.extraHere) L.push(`     ${f}`);
  }
  if (r.missingHere.length) {
    L.push('');
    L.push(`  ✕ 사본에만 있는 화면 ${r.missingHere.length}개 — 목록이 갈렸다`);
    for (const f of r.missingHere) L.push(`     ${f}`);
    L.push('     ★ 이쪽에서 지웠는데 저쪽에 남았거나, 저쪽이 따로 만든 것이다.');
    L.push('       **저쪽에서 따로 만든 것이면 그것은 사본이 아니다** — D-120 경계를 다시 본다.');
  }
  L.push('');
  return L.join('\n');
}

/* ───────────────────────── 실행 ───────────────────────── */

function main(argv) {
  // ① 받은 쪽 매니페스트와 견준다
  const vi = argv.indexOf('--verify');
  if (vi !== -1) {
    const p = argv[vi + 1];
    if (!p || !fs.existsSync(p)) {
      console.log(`\n  ✕ 견줄 매니페스트를 못 찾았다: ${p || '(경로 없음)'}\n`);
      return 2;
    }
    let their;
    try { their = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
      console.log(`\n  ✕ 매니페스트를 못 읽었다 — ${e.message}\n`);
      return 2;
    }
    const r = compare(their);
    console.log(render(r, `사본과 견줌 · ${path.basename(p)}${their.at ? ` (사본 만든 때 ${their.at})` : ''}`));
    return r.ok ? 0 : 1;
  }

  // ② 매니페스트를 다시 만든다
  if (argv.includes('--write')) {
    const { manifest, missing } = build({ at: null });
    if (missing.length) {
      console.log(`\n  ✕ 보낼 화면이 없다: ${missing.join(' ')}\n`);
      return 2;
    }
    fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`\n  ${path.relative(REPO, OUT)} · 화면 ${Object.keys(manifest.files).length}개를 적었다`);
    console.log('  ★ 이 기록을 갱신했으면 **사본도 함께 보낸다** — 기록만 갱신하면');
    console.log('    「보냈다」고 적힌 채 안 보낸 것이 된다.\n');
    return 0;
  }

  // ③ 커밋된 기록이 지금 파일과 같은가 (기본)
  const c = checkCommitted();
  if (c.result) console.log(render(c.result, '보낸 기록 ↔ 지금 화면'));
  console.log(`  ${c.ok ? '●' : '✕'} ${c.line}\n`);
  return c.code;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { files, build, compare, checkCommitted, render, OUT, SRC_DIR };
