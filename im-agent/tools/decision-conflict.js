'use strict';
/**
 * decision-conflict.js — **안 하기로 정한 것**이 새 문서에 다시 나오는지 본다.
 *
 * ★★ **왜 만들었나** 〈2026-08-26 · 실제로 났다〉.
 *   같은 날 오전에 사장님이 「외출모드는 만들지 않는다」를 정하셨는데(D-121),
 *   오후에 받은 디자인 Agent 지시서에 외출모드가 **두 번** 나왔다.
 *   지침을 쓰는 사람이 등록부를 안 볼 수 있다 — 당연하다. 등록부는 60건이 넘는다.
 *
 *   **규칙으로 적어 두는 것으로는 안 막힌다.** 그래서 재는 장치를 붙인다.
 *
 * ★★ **짐작하지 않는다.** 「나왔다」와 「어긴다」는 다르다.
 *   - 결정 자체를 적은 곳(등록부·부록·결정 기록)은 **나와야 정상이다** — 뺀다.
 *   - 그 밖의 문서에 나오면 **사람에게 보여 주고 판단은 사람이 한다.**
 *   찾은 것을 「위반」이라고 부르지 않는다. 「봐야 할 곳」이라고 부른다.
 *
 * ★ 어떻게 고르나 — ✅ 결정 항목 중 **부정 결정**만 본다.
 *   「만들지 않는다 · 하지 않는다 · 빼기로 · 삭제 · 쓰지 않는다」
 *   그 제목에서 낱말(「외출모드」)을 뽑아 다른 문서에서 찾는다.
 *
 * 쓰는 법
 *   node im-agent/tools/decision-conflict.js          사람이 읽는 표
 *   node im-agent/tools/decision-conflict.js --json   기계가 읽는 JSON
 *   종료코드 — 볼 곳이 있으면 1, 없으면 0
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const REGISTRY = path.join(REPO, 'docs', '미결정-사항.md');

/**
 * 결정 자체를 적는 곳 — 여기 나오는 것은 정상이다.
 * ★ `삭제-후보.md` 는 **무엇을 지웠는지 남긴 기록**이다. 지운 것이 거기 적혀
 *   있는 것은 어기는 것이 아니라 **기록하는 것**이다. 빼지 않으면 목록이
 *   과거 기록으로 가득 차고, 그러면 진짜 새 위반을 못 본다.
 */
const SKIP_FILES = new Set(['미결정-사항.md', '삭제-후보.md']);

/** 「안 하기로 정했다」로 읽히는 말 */
const NEGATIVE = [
  '만들지 않는다', '하지 않는다', '넣지 않는다', '쓰지 않는다',
  '빼기로', '삭제', '없앤다', '범위에서 뺀다', '만들지 않기로',
];

/**
 * 제목에서 **찾을 낱말**을 뽑는다.
 *
 * ★ 제목은 `### ✅ D-121. 「외출모드」 — 만들지 않는다 〈…〉` 꼴이다.
 *   낫표(「」) 안이 있으면 그것이 가장 정확하다. 없으면 첫 명사구를 쓴다.
 * ★ **두 글자 미만은 버린다.** 짧은 말은 아무 데나 걸려 늑대야가 된다.
 */
function clean(t) {
  // ★ `**폴더 연결을 켠다` 처럼 마크다운이 낱말에 섞여 들어온다. 떼어 낸다
  return String(t).replace(/[*`_~]/g, '').trim();
}

function termOf(title) {
  const quoted = title.match(/[「『]([^」』]+)[」』]/);
  if (quoted) return clean(quoted[1]);
  // 낫표가 없으면 번호 뒤 ~ 첫 구분자까지
  const m = title.replace(/^#+\s*\S+\s*D-\d+\.\s*/, '').split(/\s+[—·(〈]/)[0];
  return clean(m || '');
}

/**
 * 등록부에서 **부정 결정**을 뽑는다.
 *
 * ★★ **결정 문단만 본다** 〈2026-08-26 · 첫 판이 틀렸다〉.
 *   앞 판은 제목 아래 30줄을 통째로 훑었다. 그러면 「결정 전 기록」에 남아 있는
 *   갈래 목록(`[ ] ③ 만들지 않고 …`)까지 읽어서, **만들기로 정한 D-119 를
 *   「만들지 않는다」로 뒤집어 읽었다.** 정반대를 말하는 도구는 없는 것보다 나쁘다.
 *
 *   그래서 `### ✅` 다음부터 `<!-- 아래는 결정 전 기록` 까지, 그리고 인용부호(`>`)로
 *   시작하는 **결정 문단만** 본다. 결정 전 기록은 보지 않는다.
 */
function negativeDecisions(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^###\s+✅\s+(D-\d+)\.\s*(.+)$/);
    if (!m) continue;
    const [, id, rest] = m;

    // 결정 문단 — 다음 ### 이나 「결정 전 기록」 표시 전까지
    const block = [];
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      if (/^###\s/.test(lines[j])) break;
      if (lines[j].includes('결정 전 기록')) break;
      block.push(lines[j]);
    }
    const hay = `${rest}\n${block.join('\n')}`;
    const hit = NEGATIVE.find(w => hay.includes(w));
    if (!hit) continue;

    const term = termOf(`### ✅ ${id}. ${rest}`);
    // ★ 너무 길면 제목(질문)이지 낱말이 아니다 — 다른 문서에서 걸릴 리 없고 목록만 어지럽힌다
    if (!term || term.length < 2 || term.length > 20) continue;
    out.push({ id, title: rest.trim(), term, marker: hit });
  }
  return out;
}

/** docs/ 아래 마크다운을 전부 읽는다 (등록부는 뺀다) */
function docFiles() {
  const dir = path.join(REPO, 'docs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && !SKIP_FILES.has(f))
    .map(f => path.join(dir, f));
}

/**
 * 부록(내가 잰 것)은 뺀다 — 거기서 결정을 언급하는 것은 정상이다.
 * `# 부록 A.` 같은 줄부터 파일 끝까지를 잘라낸다.
 */
function stripAppendix(text) {
  const m = text.match(/^#\s*부록\s/m);
  return m ? text.slice(0, m.index) : text;
}

function run() {
  if (!fs.existsSync(REGISTRY)) {
    return { ok: false, error: '등록부(docs/미결정-사항.md)를 못 찾았다' };
  }
  const decisions = negativeDecisions(fs.readFileSync(REGISTRY, 'utf8'));
  const findings = [];

  for (const file of docFiles()) {
    const raw = fs.readFileSync(file, 'utf8');
    const body = stripAppendix(raw);
    const lines = body.split('\n');
    for (const d of decisions) {
      lines.forEach((line, n) => {
        if (!line.includes(d.term)) return;
        // ★ **그 결정을 가리키는 줄은 뺀다.** 「D-121(외출모드 — 만들지 않기로 결정)」
        //   같은 줄은 어기는 것이 아니라 **가리키는 것**이다. 남겨 두면 목록만 길어지고,
        //   목록이 길면 진짜를 못 본다.
        if (/D-\d+/.test(line)) return;
        // 같은 줄이 두 결정에 걸릴 수 있다 (D-121·D-124 가 둘 다 「외출모드」) — 한 번만
        if (findings.some(f => f.file === path.relative(REPO, file) && f.line === n + 1)) return;
        findings.push({
          file: path.relative(REPO, file),
          line: n + 1,
          id: d.id,
          term: d.term,
          decision: d.title,
          text: line.trim().slice(0, 160),
        });
      });
    }
  }
  return { ok: true, decisions, findings };
}

function render(r) {
  if (!r.ok) return `✕ ${r.error}`;
  const L = [''];
  L.push(`  안 하기로 정한 것 ${r.decisions.length}건을 다른 문서에서 찾았다`);
  for (const d of r.decisions) L.push(`   · ${d.id}  「${d.term}」  ${d.marker}`);
  L.push('');
  if (!r.findings.length) {
    L.push('  ● 다시 나온 곳 없음');
    L.push('');
    return L.join('\n');
  }
  L.push(`  ★ 봐야 할 곳 ${r.findings.length}군데`);
  L.push('    (나왔다고 어긴 것은 아니다 — 사람이 본다)');
  L.push('');
  const byFile = new Map();
  for (const f of r.findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, rows] of byFile) {
    L.push(`   ${file}`);
    for (const f of rows) L.push(`     ${String(f.line).padStart(4)}행  [${f.id} 「${f.term}」]  ${f.text}`);
  }
  L.push('');
  L.push('  → 지침 원문은 고치지 않는다. 등록부에 **읽는 법**을 적는다 (D-124 가 그 예다).');
  L.push('');
  return L.join('\n');
}

if (require.main === module) {
  const r = run();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else console.log(render(r));
  process.exit(r.ok && r.findings.length ? 1 : (r.ok ? 0 : 2));
}

module.exports = { run, render, negativeDecisions, termOf, stripAppendix, clean, NEGATIVE };
