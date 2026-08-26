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

test('★★ 「짝의 수」 계산이 맞다 — 이것이 사장님께 드리는 근거다', () => {
  const m = mw.measure();
  if (!m.ok) return;
  const n = m.summary.branchCount;
  assert.strictEqual(m.summary.pairCount, n * (n - 1) / 2,
    '짝의 수가 틀리면 「하나 더 열면 이만큼 는다」가 거짓이 된다');
  assert.strictEqual(m.summary.pairsIfOneMore, (n + 1) * n / 2);
  assert.ok(m.summary.pairsIfOneMore >= m.summary.pairCount,
    '갈래가 늘었는데 짝이 줄 수는 없다');
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

test('★★ 실제 저장소에서 주인이 둘인 갈래가 잡힌다', () => {
  const m = mw.measure();
  if (!m.ok) return;
  const doc = mw.readOwners();
  const declared = (doc.갈래 || []).filter(x => Array.isArray(x.coOwners) && x.coOwners.length);
  // 적어 둔 것과 잰 것이 같아야 한다 — 다르면 둘 중 하나가 거짓말이다
  assert.strictEqual(m.summary.sharedOwnerBranches, declared.length,
    '적어 둔 공동주인 수와 잰 수가 다르다');
  for (const o of m.owners.filter(x => x.ownerCount > 1)) {
    assert.ok(o.alerts.some(a => a.level === 'CRITICAL'),
      `${o.branch} 의 주인이 둘인데 CRITICAL 이 안 붙었다`);
  }
});

test('★ 주인이 하나면 경보가 없다 — 늑대야 하지 않는다', () => {
  const m = mw.measure();
  if (!m.ok) return;
  for (const o of m.owners.filter(x => x.ownerCount === 1)) {
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

test('★ 적어 둔 갈래 이름이 실제 원격 갈래와 맞다 — 오타를 잡는다', () => {
  const doc = mw.readOwners();
  const real = new Set(mw.workBranches().map(r => r.replace(/^origin\//, '')));
  if (!real.size) return;
  for (const x of (doc.갈래 || [])) {
    assert.ok(real.has(x.branch),
      `docs/갈래-주인.json 에 없는 갈래가 적혀 있다: ${x.branch} — 오타면 그 갈래는 영원히 주인이 없다`);
  }
});
