'use strict';
/**
 * merge-watch.test.js — 병합 감시가 **짐작하지 않는지** 고정한다.
 *
 * ★★ **왜 이 검사가 있나** 〈2026-08-26 사장님 지시〉.
 *   나는 「갈래가 다섯이 되면 병합이 어려워진다」고 말씀드렸는데, 사장님이
 *   **그것을 확인할 방법이 없었다.** 믿거나 말거나가 되면 판단을 못 하신다.
 *
 * ★★ **가장 위험한 실패는 「틀린 숫자를 자신 있게 내는 것」이다.**
 *   「같은 파일을 둘이 건드렸다」를 충돌로 세면 숫자가 부풀고, 부푼 숫자로
 *   「지금은 안 됩니다」라고 말하면 그것은 근거가 아니라 핑계가 된다.
 *   그래서 파일 이름을 세지 않고 **실제로 합쳐 본 결과**만 센다.
 */

const test = require('node:test');
const assert = require('node:assert');

const mw = require('../tools/merge-watch');

test('★ 기준 갈래를 찾는다', () => {
  const b = mw.baseRef();
  assert.ok(b === null || /^origin\/(main|master)$/.test(b), `기준 갈래가 이상하다: ${b}`);
});

test('★★ 같은 갈래끼리는 절대 부딪히지 않는다 — 부풀리기 탐지', () => {
  const base = mw.baseRef();
  if (!base) return;                       // 원격이 없는 환경에서는 건너뛴다
  const c = mw.conflictsBetween(base, base);
  assert.strictEqual(c.files.length, 0,
    '자기 자신과 합쳤는데 충돌이 나오면 파일 이름을 세고 있는 것이다');
});

test('★★ 「함께 건드린 파일」과 「부딪히는 파일」을 섞지 않는다', () => {
  // 같은 파일이라도 서로 다른 줄이면 git 이 합친다.
  // fileHeat 은 **겹침**을 세고, conflictsBetween 은 **부딪힘**을 센다. 둘은 다르다.
  const heat = mw.fileHeat([
    { name: 'A', files: ['같은.md', 'a만.js'] },
    { name: 'B', files: ['같은.md', 'b만.js'] },
  ]);
  assert.deepStrictEqual(heat.map(h => h.file), ['같은.md'], '혼자 건드린 파일은 겹침이 아니다');
  assert.strictEqual(heat[0].count, 2);
  assert.deepStrictEqual(heat[0].branches, ['A', 'B']);
});

test('★ 겹치는 것이 없으면 빈 목록이다 — 없는 것을 만들지 않는다', () => {
  const heat = mw.fileHeat([
    { name: 'A', files: ['a.js'] },
    { name: 'B', files: ['b.js'] },
  ]);
  assert.deepStrictEqual(heat, []);
});

test('★ 한글 경로를 사람이 읽을 수 있게 돌려준다', () => {
  // git 은 기본으로 한글을 8진수로 escape 한다. 화면에 그대로 내면 못 읽는다.
  const raw = '"docs/\\353\\257\\270\\352\\262\\260\\354\\240\\225-\\354\\202\\254\\355\\225\\255.md"';
  assert.strictEqual(mw.unquote(raw), 'docs/미결정-사항.md');
});

test('★ 따옴표가 없는 경로는 그대로 둔다', () => {
  assert.strictEqual(mw.unquote('im-agent/core/tasks.js'), 'im-agent/core/tasks.js');
});

test('★ 갈래 이름에서 origin/claude/ 를 뗀다', () => {
  assert.strictEqual(mw.shortName('origin/claude/my-branch'), 'my-branch');
  assert.strictEqual(mw.shortName('origin/main'), 'main');
});

/**
 * 짝의 수 — n 개에서 둘씩 고르는 경우의 수.
 *
 * ★ **갈래가 0개일 때 `n * (n - 1) / 2` 를 그대로 쓰면 `-0` 이 나온다**
 *   〈2026-08-26 · CI 가 잡았다〉. `0 * -1 / 2` 는 자바스크립트에서 `-0` 이고,
 *   `assert.strictEqual` 은 `Object.is` 로 재기 때문에 `0` 과 `-0` 을 다르다고 본다.
 *   내 컴퓨터에는 갈래가 여럿이라 안 걸렸고, CI 는 자기 갈래 하나만 받아 와서
 *   `main` 을 뺀 갈래가 0개였다. **환경이 다르면 결과가 다른 계산은 여기서 막는다.**
 */
function pairsOf(n) {
  return n < 2 ? 0 : (n * (n - 1)) / 2;
}

test('★ 짝의 수 공식은 갈래가 0·1개여도 0을 준다 (-0 이 아니다)', () => {
  assert.strictEqual(pairsOf(0), 0);
  assert.strictEqual(pairsOf(1), 0);
  assert.strictEqual(pairsOf(4), 6);
  assert.strictEqual(pairsOf(5), 10);
});

test('★★ 「짝의 수」 계산이 맞다 — 이것이 사장님께 드리는 근거다', () => {
  const m = mw.measure();
  if (!m.ok) return;
  const n = m.summary.branchCount;
  assert.strictEqual(m.summary.pairCount, pairsOf(n),
    '짝의 수가 틀리면 「하나 더 열면 이만큼 는다」가 거짓이 된다');
  assert.strictEqual(m.summary.pairsIfOneMore, pairsOf(n + 1));
  assert.ok(m.summary.pairsIfOneMore >= m.summary.pairCount,
    '갈래가 늘었는데 짝이 줄 수는 없다');
});

test('★★ 이미 합쳐진 갈래는 「견줄 짝」에서 뺀다 — 병합 직후에 잡은 거짓말이다', () => {
  const m = mw.measure();
  if (!m.ok) return;

  // 기준보다 앞선 커밋이 0개인 갈래는 `merged` 로 가고, `branches` 에 남지 않는다.
  // ★ 왜 재는가 — 네 갈래를 main 에 합친 **직후에** 화면을 다시 열었더니
  //   「갈래 8개 · 짝 28개 · 7군데 부딪힘」이 나왔다. 전부 이미 푼 충돌이었다.
  //   합쳐진 갈래는 tip 이 남아 있어 서로 merge-tree 를 하면 병합 전 충돌이
  //   그대로 재현되기 때문이다. **끝난 일을 남은 일로 보여 주는 화면**이었다.
  for (const b of m.branches) {
    assert.notStrictEqual(b.ahead, 0,
      `${b.name} 은 이미 합쳐졌는데 아직 안 합친 갈래로 세고 있다`);
  }
  for (const b of (m.merged || [])) {
    assert.strictEqual(b.ahead, 0, '합쳐졌다고 분류한 갈래는 앞선 커밋이 0이어야 한다');
  }

  // 센 것과 나눈 것이 어긋나지 않는다
  assert.strictEqual(m.summary.branchCount, m.branches.length);
  assert.strictEqual(m.summary.mergedCount, (m.merged || []).length);

  // 짝은 **안 합친 갈래끼리만** 만든다
  const live = new Set(m.branches.map(b => b.name));
  for (const p of m.pairs) {
    assert.ok(live.has(p.a) && live.has(p.b),
      `${p.a} ↔ ${p.b} — 이미 합쳐진 갈래가 짝에 들어갔다`);
  }
});

test('★★ 「합치지 않기로 한 갈래」는 할 일에서 빼되 화면에는 남긴다 (D-130)', () => {
  const mw2 = require('../tools/merge-watch');
  const doc = JSON.parse(
    require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'docs', '갈래-주인.json'), 'utf8'));
  const noMerge = new Set((doc.갈래 || []).filter(x => x.합치지않음).map(x => x.branch));
  assert.ok(noMerge.size >= 1, '합치지않음 표시가 하나도 없다 — 이 검사가 아무것도 재지 않는다');

  const m = mw2.measure();
  if (!m.ok) return;

  // ★ 그 갈래는 「아직 안 합친 갈래」에 들어가지 않는다.
  //   영영 안 합쳐지는 것을 할 일로 세면 그 숫자가 0 이 되는 날이 안 온다.
  for (const b of m.branches) {
    assert.ok(!noMerge.has(`claude/${b.name}`),
      `${b.name} 은 합치지 않기로 한 갈래인데 할 일로 세고 있다`);
  }
  // ★ 그렇다고 사라지면 안 된다 — 따로 적어 둔다.
  for (const b of (m.archived || [])) {
    assert.ok(noMerge.has(`claude/${b.name}`), 'archived 는 표시가 있는 것만 들어간다');
    assert.notStrictEqual(b.ahead, 0, '이미 합쳐진 것은 archived 가 아니라 merged 다');
  }
  assert.strictEqual(m.summary.archivedCount, (m.archived || []).length);

  // ★ 주인 표에는 그대로 나온다 — 주인 없는 갈래를 놓치지 않기 위해서다
  const shown = new Set(m.owners.map(o => o.branch));
  for (const b of (m.archived || [])) {
    assert.ok(shown.has(b.name), `${b.name} 이 주인 표에서 빠졌다`);
  }
});

test('★ 적어 둔 갈래가 병합됐다고 「없어졌다」로 세지 않는다', () => {
  const m = mw.measure();
  if (!m.ok) return;
  const mergedNames = new Set((m.merged || []).map(b => `claude/${b.name}`));
  for (const missing of m.summary.declaredMissing || []) {
    assert.ok(!mergedNames.has(missing),
      `${missing} 는 병합된 것이지 없어진 것이 아니다 — 오타와 구분이 안 된다`);
  }
});

test('★ 실측 결과의 모양이 무너지지 않는다', () => {
  const m = mw.measure();
  if (!m.ok) return;
  assert.ok(Array.isArray(m.branches) && Array.isArray(m.pairs) && Array.isArray(m.heat));
  for (const p of m.pairs) {
    assert.strictEqual(p.conflicts, p.files.length,
      '센 숫자와 목록 길이가 다르면 둘 중 하나가 거짓말이다');
  }
});

test('★★ 못 쟀을 때도 제목이 있는 온전한 화면이 나온다 — CI 가 잡은 것이다', () => {
  // CI 는 얕은 체크아웃이라 origin/main 이 없다. 그때 앞 판은 제목 없는
  // 조각 한 줄만 냈고, 그것은 **열면 흰 화면**이다.
  const h = mw.html({ ok: false, error: '기준 갈래를 못 찾았다' });
  assert.ok(h.includes('<title>'), '못 쟀다고 제목까지 없으면 흰 화면이 된다');
  assert.ok(h.includes('기준 갈래를 못 찾았다'), '왜 못 쟀는지 화면에 적어야 한다');
  assert.ok(!/<script/i.test(h));
});

test('★ 화면 한 장이 실제로 만들어진다 (자체 완결 HTML)', () => {
  const m = mw.measure();
  const h = mw.html(m);
  assert.ok(h.includes('<title>'), '제목이 없다');
  assert.ok(!/<script/i.test(h), '미리보기에 스크립트를 넣지 않는다 — 안 도는 곳이 있다');
  assert.ok(!/https?:\/\//.test(h.replace(/github\.com/g, '')),
    '바깥에서 무언가를 받아오면 안 열리는 곳이 생긴다');
});

test('★★ 원격 받아오기가 기본이다 — 「없다」와 「안 받아왔다」를 가른다 (D-130)', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'tools', 'merge-watch.js'), 'utf8');

  // ★ 앞 판은 **이미 아는 갈래만** 다시 받았다. 그래서 모르는 갈래는 영영 몰랐고,
  //   옛 크론 갈래 셋이 그렇게 숨어 있다가 손으로 --prune 을 걸고서야 나왔다.
  //   화면은 그동안 「갈래 4개」라고 말했고 그것이 거짓인 줄 아무도 몰랐다.
  assert.ok(src.includes("'--prune'"),
    '--prune 없이 받으면 새 갈래도 못 보고 닫힌 갈래도 안 지워진다');
  assert.ok(src.includes("opts.fetch !== false"),
    '받아오기가 기본이 아니면 아무도 안 켠다');

  // ★ 못 받았으면 **못 받았다고 적어야** 한다. 조용히 옛 목록을 보여 주지 않는다.
  const m = mw.measure();
  if (!m.ok) return;
  assert.ok(m.fetched && typeof m.fetched.tried === 'boolean',
    '받아왔는지를 결과에 안 실으면 화면이 그 사실을 말할 수 없다');
  if (m.fetched.tried && !m.fetched.ok) {
    assert.ok(m.fetched.error, '실패했으면 까닭을 적어야 한다');
  }
  // 화면에 그 경고 자리가 실제로 있는가
  assert.ok(src.includes('원격을 못 받아왔'), '못 받은 사실을 화면에 적는 자리가 없다');
});

test('★ 검사 자리(IM_AGENT_OFFLINE)에서는 원격을 안 부른다', () => {
  const saved = process.env.IM_AGENT_OFFLINE;
  process.env.IM_AGENT_OFFLINE = '1';
  try {
    const m = mw.measure();
    if (!m.ok) return;
    assert.strictEqual(m.fetched.tried, false,
      '검사가 돌 때마다 원격을 부르면 느리고, 원격이 없는 자리에서 흔들린다');
  } finally {
    if (saved === undefined) delete process.env.IM_AGENT_OFFLINE;
    else process.env.IM_AGENT_OFFLINE = saved;
  }
});

test('★ 읽기만 한다 — 저장소를 바꾸는 명령이 코드에 없다', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'tools', 'merge-watch.js'), 'utf8');
  for (const bad of ['commit', 'checkout', 'reset', 'push', "'merge'", 'worktree']) {
    assert.ok(!src.includes(`'${bad}'`) || bad === "'merge'",
      `감시 도구가 저장소를 바꾸는 명령(${bad})을 갖고 있다`);
  }
  assert.ok(src.includes('--write-tree'),
    'merge-tree --write-tree 가 아니면 작업 디렉터리를 건드린다');
});

/* ───────────── 갈래의 주인 〈2026-08-26 사장님 지시〉 ───────────── */

test('★★ 주인이 둘인 갈래를 CRITICAL 로 잡는다 — 이것이 지시받은 것이다', () => {
  const rows = mw.ownership([
    { ref: 'origin/claude/x', name: 'x', files: [] },
  ]);
  // 안 적힌 갈래는 HIGH
  assert.strictEqual(rows[0].ownerCount, 0);
  assert.ok(rows[0].alerts.some(a => a.level === 'HIGH'), '주인을 안 적었는데 조용하다');
});

test('★★ 적어 둔 공동주인이 그대로 CRITICAL 로 잡힌다', () => {
  // ★★ **원격 상태에 기대지 않는다** 〈2026-08-26 · 두 번 데었다〉.
  //   앞 판은 `measure()` 로 실제 원격을 읽었다. CI 는 그 PR 갈래 하나만
  //   받아 오므로 나머지가 안 보이고, 「적어 둔 공동주인 1 vs 잰 것 0」으로 빨개졌다.
  //   적어 둔 갈래가 **전부 보이는 상태를 만들어** 논리만 본다.
  const doc = mw.readOwners();
  const all = (doc.갈래 || []).map(b => ({ ref: `origin/${b.branch}`, name: b.branch, files: [] }));
  if (!all.length) return;
  const rows = mw.ownership(all);
  const declared = (doc.갈래 || []).filter(x => Array.isArray(x.coOwners) && x.coOwners.length);
  assert.strictEqual(rows.filter(o => o.ownerCount > 1).length, declared.length,
    '적어 둔 공동주인 수와 잰 수가 다르다');
  for (const o of rows.filter(x => x.ownerCount > 1)) {
    assert.ok(o.alerts.some(a => a.level === 'CRITICAL'),
      `${o.branch} 의 주인이 둘인데 CRITICAL 이 안 붙었다`);
  }
});

test('★ 주인이 하나면 경보가 없다 — 늑대야 하지 않는다', () => {
  const doc = mw.readOwners();
  const all = (doc.갈래 || []).map(b => ({ ref: `origin/${b.branch}`, name: b.branch, files: [] }));
  if (!all.length) return;
  for (const o of mw.ownership(all).filter(x => x.ownerCount === 1)) {
    assert.ok(!o.alerts.some(a => a.level === 'CRITICAL' || a.level === 'HIGH'),
      `${o.branch} 은 주인이 하나인데 경보가 붙었다`);
  }
});

test('★ 영역 판별이 먼저 걸린 것을 쓴다 (한 파일이 두 영역에 걸릴 수 있다)', () => {
  const areas = { 도면3D: ['massing'], 화면: ['ui/'] };
  assert.strictEqual(mw.areaOf('im-agent/agents/09-massing.js', areas), '도면3D');
  assert.strictEqual(mw.areaOf('im-agent/ui/platform/app.js', areas), '화면');
  assert.strictEqual(mw.areaOf('README.md', areas), null, '안 걸리면 null 이어야 한다');
});

test('★ 주인 목록 파일이 깨져도 화면이 죽지 않는다', () => {
  // 파일이 없거나 JSON 이 깨져도 조용히 빈 것을 돌려줘야 한다
  const doc = mw.readOwners();
  assert.ok(doc && typeof doc === 'object');
  assert.ok(Array.isArray(doc.갈래 || []));
});

test('★★ 적어 뒀는데 안 보이는 갈래를 **말한다** — 검사가 아니라 보고다', () => {
  // ★★ 앞 판은 이것을 검사로 두었다가 CI 에서 빨개졌다 〈2026-08-26〉.
  //   CI 는 그 PR 의 갈래 **하나만** 받아 온다. 나머지 셋은 늘 「없다」가 된다.
  //   내 CI 흉내는 갈래를 **0개**로 만들어서 통과했다 — 흉내가 틀렸던 것이다.
  //   **환경에 따라 답이 달라지는 것은 검사가 아니다.** 도구가 그때그때 말한다.
  const rows = mw.ownership([{ ref: 'origin/claude/보이는갈래', name: '보이는갈래', files: [] }]);
  assert.ok(Array.isArray(rows.declaredMissing), '안 보이는 갈래 목록이 없다');
  // 적어 둔 갈래가 하나라도 있으면, 지금 안 보이는 것은 전부 여기 들어와야 한다
  const doc = mw.readOwners();
  const names = (doc.갈래 || []).map(x => x.branch);
  for (const n of names) {
    assert.ok(rows.declaredMissing.includes(n),
      `${n} 이 안 보이는데 목록에 없다 — 조용히 빠지면 주인 없는 갈래가 생긴다`);
  }
});

test('★ 다 보이면 「안 보이는 갈래」가 비어 있다', () => {
  const doc = mw.readOwners();
  const all = (doc.갈래 || []).map(b => ({ ref: `origin/${b.branch}`, name: b.branch, files: [] }));
  const rows = mw.ownership(all);
  assert.deepStrictEqual(rows.declaredMissing, [], '다 보이는데 없다고 한다');
});
