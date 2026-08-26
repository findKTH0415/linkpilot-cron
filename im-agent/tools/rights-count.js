'use strict';
/**
 * rights-count.js — **권리 검사가 몇 번 걸렸고 그중 몇 건이 오탐인가.**
 *
 *   npm run rights:count           사람이 읽는 표
 *   npm run rights:count -- --json 기계가 읽는 JSON
 *
 * ★★★ **왜 만들었나** 〈2026-08-26 사장님 「권고안대로 확정」 · D-118〉.
 *
 *   지침 §8 이 「개인정보·계약정보·API 키 노출」을 배포 전 필수 검사로 정했고,
 *   `15_design` 의 brand 모드가 그것을 실제로 훑는다. 지금은 **YELLOW**(경고)다.
 *
 *   물음은 하나 — **RED 로 올려서 실제로 막을 것인가.**
 *
 * ★★ **지금 올리지 않는다.** 올리는 것 자체는 한 줄이지만(`rules.json` 의
 *   severity), **오탐 하나에 문서가 아예 안 나가면 사람들은 검사를 꺼 버린다.**
 *   그러면 막는 장치가 아니라 없는 장치가 된다.
 *
 * ★★★ **그래서 「나중에 보자」로 두지 않고 세는 장치를 만든다.**
 *   「몇 주 뒤에 정하자」는 세는 것이 없으면 **영원히 안 정해진다** — 그날이 와도
 *   무엇을 근거로 정할지가 없기 때문이다. 이 도구가 그 근거를 쌓는다.
 *
 * ★ **오탐인지는 사람이 적는다.** 기계가 「이건 오탐」을 정할 수 있으면 애초에
 *   안 걸렸을 것이다. `docs/권리검사-오탐.json` 에 적으면 여기서 빼고 센다.
 *
 * 되돌아오는 값: 0 (세는 도구다 — 걸린 것이 있어도 실패가 아니다)
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const PROJECTS = path.join(REPO, 'im-projects');
/** 사람이 「이건 오탐이다」라고 적어 두는 곳 */
const FALSE_POSITIVES = path.join(REPO, 'docs', '권리검사-오탐.json');
/** 올릴지 말지를 정하는 기준 — 여기 한 곳에만 적는다 */
const THRESHOLD = { minRuns: 20, maxFalseRate: 0.1 };

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}

/** 사람이 적어 둔 오탐 목록 (`규칙 → [본문 조각…]`) */
function falsePositives() {
  const d = readJson(FALSE_POSITIVES, null);
  return (d && d.오탐) || {};
}

/**
 * 프로젝트마다 남은 디자인 검증 결과에서 **brand 모드 깃발**만 모은다.
 *
 * ★ 파일이 없는 프로젝트는 **「0건」이 아니라 「안 돌았다」**다. 둘을 섞으면
 *   「걸린 적 없다」와 「재 본 적 없다」가 같은 숫자가 된다 (M-37 과 같은 결).
 */
function collect() {
  const runs = [];
  if (!fs.existsSync(PROJECTS)) return runs;
  for (const id of fs.readdirSync(PROJECTS).sort()) {
    const p = path.join(PROJECTS, id, '11_QC', 'design-verified.json');
    if (!fs.existsSync(p)) { runs.push({ id, ran: false, flags: [] }); continue; }
    const d = readJson(p, null);
    if (!d) { runs.push({ id, ran: false, flags: [] }); continue; }
    const flags = (d.flags || []).filter(f => (f.mode === 'brand') || /D1[234]/.test(f.rule || ''));
    runs.push({ id, ran: true, flags });
  }
  return runs;
}

function count() {
  const runs = collect();
  const fp = falsePositives();
  const byRule = new Map();
  let hits = 0;
  let falseHits = 0;

  for (const r of runs) {
    for (const f of r.flags) {
      const rule = f.rule || f.type || '(이름 없음)';
      if (!byRule.has(rule)) byRule.set(rule, { rule, hits: 0, false: 0, samples: [] });
      const row = byRule.get(rule);
      row.hits += 1; hits += 1;
      const known = (fp[rule] || []).some(frag => String(f.message || '').includes(frag));
      if (known) { row.false += 1; falseHits += 1; }
      if (row.samples.length < 3) row.samples.push({ project: r.id, message: String(f.message || '').slice(0, 90), false: known });
    }
  }

  const ran = runs.filter(r => r.ran).length;
  const rows = [...byRule.values()].sort((a, b) => b.hits - a.hits);
  const trueHits = hits - falseHits;
  const falseRate = hits ? falseHits / hits : null;

  /* ★ 「올려도 되는가」는 **둘 다** 채워야 참이다 —
   *   ① 충분히 돌아 봤는가 ② 오탐 비율이 낮은가.
   *   하나만 보면 「세 번 돌렸는데 오탐 0」으로 올리게 된다. */
  const enough = ran >= THRESHOLD.minRuns;
  const clean = falseRate !== null && falseRate <= THRESHOLD.maxFalseRate;
  return {
    runs: runs.length, ran, notRan: runs.length - ran,
    hits, trueHits, falseHits, falseRate, rows,
    threshold: THRESHOLD,
    ready: enough && clean,
    why: !enough
      ? `아직 ${ran}번 돌았다 — ${THRESHOLD.minRuns}번은 넘겨야 비율에 뜻이 생긴다`
      : (!clean
        ? `오탐 비율 ${(falseRate * 100).toFixed(0)}% — ${THRESHOLD.maxFalseRate * 100}% 이하여야 한다`
        : '기준 둘을 다 채웠다 — 올릴지 사장님이 정하실 때다'),
  };
}

function render(r) {
  const L = ['', '  권리 검사(비밀·개인정보·저작권) — 얼마나 걸렸나', ''];
  L.push(`  돌아 본 프로젝트 ${r.ran}개` + (r.notRan ? ` · 아직 안 돌린 것 ${r.notRan}개` : ''));
  if (!r.ran) {
    L.push('');
    L.push('  ⚠️  아직 한 번도 안 돌았다 — **「걸린 적 없다」가 아니다.**');
    L.push('     `npm run im:demo` 나 실제 보고서를 돌리면 여기 쌓인다.');
    L.push('');
    return L.join('\n');
  }
  L.push(`  걸린 것 ${r.hits}건 (진짜 ${r.trueHits} · 오탐 ${r.falseHits})`);
  L.push('');
  if (r.rows.length) {
    L.push('  규칙별');
    for (const x of r.rows) {
      L.push(`   ${x.rule.padEnd(22)} ${String(x.hits).padStart(3)}건` + (x.false ? ` (오탐 ${x.false})` : ''));
      for (const s of x.samples) L.push(`      ${s.false ? '·오탐' : '·   '} [${s.project}] ${s.message}`);
    }
    L.push('');
  }
  L.push(`  ${r.ready ? '●' : '✕'} ${r.why}`);
  L.push('');
  L.push('  ★ RED 로 올리는 법 — `im-agent/design/rules.json` 의 D12·D13·D14 severity 를');
  L.push('    YELLOW → RED 로 바꾼다. **한 줄씩 셋이다.** 되돌리기도 같다.');
  L.push('  ★ 오탐을 적는 곳 — `docs/권리검사-오탐.json` 의 `오탐` 에');
  L.push('    `"규칙아이디": ["본문에 들어 있는 조각"]` 으로 적는다. 여기서 빼고 센다.');
  L.push('');
  return L.join('\n');
}

if (require.main === module) {
  const r = count();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else console.log(render(r));
  process.exit(0);
}

module.exports = { collect, count, render, falsePositives, THRESHOLD, FALSE_POSITIVES };
