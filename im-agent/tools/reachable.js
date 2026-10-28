'use strict';
/**
 * reachable.js — **만들어 놓고 아무도 안 부르는 것**을 찾는다 (2026-08-19).
 *
 *   npm run check:reachable
 *
 * ★★ 왜 만들었나: 실제로 세 번 났다 (D-48 · D-62 · `materialize`). 코드는 멀쩡히
 *   있고 테스트도 통과하는데 **어디서도 부르지 않는다.** 이 상태는 아무 오류도
 *   내지 않는다 — 기능이 「있다」고 적혀 있고 실제로는 안 도는 것이 전부다.
 *   고장보다 나쁘다. 고장은 티가 나지만 이건 안 난다.
 *
 * ★ 「닿는다」의 기준은 **부르는 길이 실제로 있는가**다. 그래서 요구 방식을
 *   네 가지 다 따라간다 — 한 가지만 보면 멀쩡한 모듈을 고아로 잘못 잡는다:
 *     ① CommonJS `require('./x')`      ② ESM `import … from './x.js'`
 *     ③ 화면의 `<script src="x.js">`   ④ 표에 적힌 모듈 경로 (registry·fieldplan)
 *
 * ★ 출발점은 **사람이 실제로 부르는 것**뿐이다 — `package.json` 의 스크립트와
 *   테스트. 「어딘가에서 require 되니 닿는다」로 세면 고아 둘이 서로를 부르는
 *   섬도 닿은 것이 된다.
 *
 * ★ 이 파일도 스스로 걸리지 않게 `package.json` 과 테스트가 부른다 (그러라고
 *   만든 검사가 정작 아무도 안 부르면 웃기는 일이 된다).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');          // im-agent/
const REPO = path.resolve(ROOT, '..');

/** 훑지 않는 곳 — 산출물·고정물은 소스가 아니다 */
const SKIP_DIR = /^(node_modules|fixtures|out|\.git|projects)$/;

function allModules() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(path.join(dir, e.name)); continue; }
      if (/\.(js|cjs|mjs)$/.test(e.name)) out.push(path.join(dir, e.name));
    }
  }(ROOT));
  return out;
}

/** `./x` → 실제 파일 하나 (확장자 생략·index 를 다 본다) */
function resolveFrom(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, base + '.js', base + '.cjs', base + '.mjs', path.join(base, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * 파일 하나가 **가리키는 것들**. 네 방식을 한자리에서 뽑는다.
 *
 * ★ `require(dir + '/x.js')` 처럼 붙여 만드는 경로가 실제로 있다. 정적으로는
 *   못 풀므로 **파일 이름으로 찾아 잇는다** — 놓쳐서 고아로 잘못 잡는 것보다
 *   조금 넉넉하게 잇는 쪽이 낫다. 이 검사는 「없는 것을 찾는」 검사라
 *   헛울음 한 번이면 아무도 안 믿게 된다.
 */
function pointsTo(file, byBasename) {
  /**
   * ★★★ **읽는 사이에 사라질 수 있다** 〈2026-08-26 · CI 에서 났다〉.
   *
   *   이 스캔은 **살아 있는 폴더**를 걷는다. 그런데 검사들이 같은 폴더에
   *   임시 표본을 만들었다 지운다 — `files-tab.test.js` 의 탐침이 그렇다.
   *   `node --test` 는 파일마다 프로세스를 띄우므로 **목록을 잡은 순간과
   *   읽는 순간 사이**에 그 파일이 사라진다.
   *
   *   그러면 여기서 `ENOENT` 로 죽고, 죽는 자리가 `guardPanel` → 미리보기
   *   생성이라 **엉뚱한 검사가 빨개진다.** 실제로 CI 가 그렇게 났고,
   *   같은 자리를 혼자 돌리면 통과해서 **원인이 안 보인다.**
   *
   * ★ 없어진 파일은 **가리키는 것이 없다**로 본다. 그것이 참이다 —
   *   지어내는 것이 아니라, 없는 것에서 나올 것이 없을 뿐이다.
   */
  let s;
  try { s = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return new Set(); throw e; }
  const hits = new Set();
  const rel = (spec) => { const f = resolveFrom(file, spec); if (f) hits.add(f); };

  // ① CommonJS · ② ESM — 상대경로만 (패키지는 볼 것이 없다)
  for (const m of s.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) rel(m[1]);
  for (const m of s.matchAll(/(?:^|\s)(?:import|export)[^;'"]*from\s*['"](\.[^'"]+)['"]/g)) rel(m[1]);
  for (const m of s.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) rel(m[1]);

  /* ③ 화면이 부르는 스크립트 — HTML 은 require 를 쓰지 않는다.
   *
   * ★★★ **판 표시(`?v=`)를 안 봐 주어 이 줄이 통째로 죽어 있었다**
   *   〈2026-08-31 · 실측〉. 화면은 형제 스크립트를 `inapp.js?v=e66e07a5` 로
   *   부른다(`build-stamp.js`). 그런데 여기는 `.js` 뒤에 바로 따옴표가 와야
   *   맞는 모양이라 **한 번도 안 맞았다.**
   *
   *   그런데도 검사는 **초록이었다** — 아래 ④ 의 이름 되짚기가 `"embed-bridge.js"`
   *   같은 글자를 아무 데서나 주워 대신 이어 줬기 때문이다. 즉 「이 화면이 이
   *   스크립트를 부른다」는 **정확한 길은 없는 채로** 통과하고 있었다.
   *   ④ 를 잠깐 끄고 재 보니 `embed-bridge.js` · `gate-core.js` 가 고아로 떨어졌다.
   *
   * ★ 같은 결의 눈먼 자리를 앱 저장소 `verify-build.js` 에서도 같은 날 찾았다.
   *   **`?v=` 는 파일 이름이 아니다** (MEMORY M-25) — 주소에서 파일을 찾는
   *   자리는 전부 떼고 본다. */
  for (const m of s.matchAll(/<script src="([^"?]+\.js)(?:\?[^"]*)?"/g)) rel(m[1]);

  // ④ 표에 적힌 모듈 경로 · 이어 붙인 경로 — 이름으로 잇는다
  for (const m of s.matchAll(/['"]([\w.-]+\/)*([\w.-]+)\.(?:js|cjs|mjs)['"]/g)) {
    (byBasename.get(m[2] + '.' + m[0].split('.').pop().replace(/['"]/g, '')) || []).forEach(f => hits.add(f));
  }
  for (const m of s.matchAll(/module:\s*['"]([^'"]+)['"]/g)) rel(m[1]);
  for (const m of s.matchAll(/agent:\s*['"]([^'"]+)['"]/g)) rel(m[1]);

  // ★ 확장자 **없이** 부르는 것도 따라간다 — `load('core/linked-fetch')` 처럼
  //   모듈 루트를 붙여 부르는 자리가 실제로 있다. 이걸 빼면 멀쩡히 불리는
  //   모듈이 고아로 잡히고, 그러면 검사를 믿지 않게 된다
  for (const m of s.matchAll(/['"]([\w-]+\/[\w./-]+)['"]/g)) {
    const leaf = m[1].split('/').pop();
    if (!leaf || leaf.includes('.')) continue;      // 확장자가 있으면 위에서 이미 봤다
    ['.js', '.cjs', '.mjs'].forEach((ext) => {
      (byBasename.get(leaf + ext) || []).forEach(f => hits.add(f));
    });
  }

  return [...hits];
}

/** 사람이 실제로 부르는 것 — 스크립트와 테스트 */
function entrypoints(mods) {
  const set = new Set();
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  for (const cmd of Object.values(pkg.scripts || {})) {
    for (const m of String(cmd).matchAll(/([\w./-]+\.(?:js|cjs|mjs))/g)) {
      const f = path.resolve(REPO, m[1]);
      if (fs.existsSync(f)) set.add(f);
    }
  }
  mods.filter(f => /[\\/]test[\\/]/.test(f)).forEach(f => set.add(f));
  return [...set];
}

function scan() {
  const mods = allModules();
  const byBasename = new Map();
  mods.forEach((f) => {
    const k = path.basename(f);
    if (!byBasename.has(k)) byBasename.set(k, []);
    byBasename.get(k).push(f);
  });
  // 화면도 출발점이다 — HTML 이 `<script src>` 로만 부르는 것, React 판(.jsx)이
  // `import` 로만 부르는 것이 실제로 있다. 이것들을 빼면 멀쩡한 모듈이 고아로 잡힌다
  const screens = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(path.join(dir, e.name)); continue; }
      // ★ 숨은 이름(`.` 으로 시작)은 **검사가 만들었다 지우는 임시 표본**이다.
      //   출발점으로 셀 것도 아니고, 세는 사이에 사라져 스캔을 죽인다 (위 주석).
      if (e.name.startsWith('.')) continue;
      if (/\.(html|jsx|tsx)$/.test(e.name)) screens.push(path.join(dir, e.name));
    }
  }(ROOT));

  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    pointsTo(f, byBasename).forEach(walk);
  };
  entrypoints(mods).forEach(walk);
  screens.forEach(h => pointsTo(h, byBasename).forEach(walk));

  const orphans = mods.filter(f => !seen.has(f)).map(f => path.relative(REPO, f)).sort();
  return { total: mods.length, reached: mods.length - orphans.length, orphans };
}

if (require.main === module) {
  const r = scan();
  console.log(`모듈 ${r.total}개 · 닿음 ${r.reached}개 · 안 닿음 ${r.orphans.length}개`);
  r.orphans.forEach(f => console.log('  ✗ ' + f));
  if (r.orphans.length) {
    console.log('\n만들어 놓고 아무도 안 부르는 것이다. 부르게 하거나, 지운다.');
    console.log('정말 부를 곳이 없는데 남겨야 하면 docs/미결정-사항.md 에 이유를 적는다.');
  }
  process.exit(r.orphans.length ? 1 : 0);
}

module.exports = { scan, allModules, resolveFrom, pointsTo };
