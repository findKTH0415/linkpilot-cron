/**
 * **목록에서 접어 두기** 〈2026-08-24 사장님: 「지난 리스트는 삭제해줘
 * 목록에서 혼란스러움」〉.
 *
 * ★★★ 고르는 목록에 스무 개가 넘게 쌓여 있었다 — 시험하며 만든 것과
 *   앱에서 가져온 **실제 딜**(서창산업/CB발행 · 금호클래식카 …)이 섞여 있다.
 *
 * ★ 여쭤 보고 **「숨기기」**로 정했다. 지우면 그 안의 자료와 만든 보고서까지
 *   함께 사라지고 **되돌릴 수 없다.** 접기는 되돌릴 수 있다.
 *
 * ★ 여기서 재는 것:
 *   ① 접고 펴는 것이 실제로 남는가
 *   ② 목록이 접힘을 **빼지 않고 표시**하는가 (빼면 되돌릴 길이 없다)
 *   ③ 파일이 깨져도 **안 접힌 것으로** 보는가 (접히는 것보다 보이는 쪽이 안전)
 *   ④ 화면이 **「지운 것이 아니다」**를 말하는가
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MOD = path.join(__dirname, '..', 'core', 'hidden.js');

function withRoot(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-hidden-'));
  const before = process.env.IM_AGENT_ROOT;
  process.env.IM_AGENT_ROOT = dir;
  delete require.cache[require.resolve(MOD)];
  const H = require(MOD);
  try { return fn(H, dir); } finally {
    if (before === undefined) delete process.env.IM_AGENT_ROOT;
    else process.env.IM_AGENT_ROOT = before;
    delete require.cache[require.resolve(MOD)];
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('★★★ 접고 펴는 것이 남는다', () => {
  withRoot((H) => {
    assert.deepStrictEqual(H.list(), []);
    assert.strictEqual(H.set('LP-GEN-2026-001', true), true);
    assert.strictEqual(H.isHidden('LP-GEN-2026-001'), true);
    assert.deepStrictEqual(H.list(), ['LP-GEN-2026-001']);
    assert.strictEqual(H.set('LP-GEN-2026-001', false), true);
    assert.strictEqual(H.isHidden('LP-GEN-2026-001'), false);
  });
});

test('★★ 같은 것을 두 번 접어도 셈이 안 늘어난다', () => {
  withRoot((H) => {
    H.set('A', true);
    assert.strictEqual(H.set('A', true), false, '두 번째는 바뀐 것이 없다');
    assert.deepStrictEqual(H.list(), ['A']);
  });
});

test('★★ 접은 시각을 남긴다 — 언제 접었는지 모르면 되돌릴 판단이 안 선다', () => {
  withRoot((H) => {
    H.set('A', true);
    assert.match(String(H.map().A), /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('★★★ 파일이 깨져도 던지지 않고 **아무것도 안 접힌 것으로** 본다', () => {
  withRoot((H, dir) => {
    fs.writeFileSync(path.join(dir, H.FILE), '{ 이건 JSON 이 아니다');
    assert.deepStrictEqual(H.list(), [],
      '깨진 파일 때문에 화면이 죽으면 안 된다 — 접히는 것보다 보이는 쪽이 안전하다');
    assert.strictEqual(H.set('A', true), true, '깨진 것 위에 새로 쓴다');
  });
});

test('★ 빈 id 는 안 받는다', () => {
  withRoot((H) => {
    assert.strictEqual(H.set('', true), false);
    assert.strictEqual(H.set(null, true), false);
  });
});

/* ── 서버가 사실을 그대로 주는가 ─────────────────────────── */

test('★★★ 목록이 접힘을 **빼지 않고 표시한다** (빼면 되돌릴 길이 없다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'api-router.cjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/hidden: Object\.prototype\.hasOwnProperty\.call\(folded, p\.id\)/.test(src),
    '접힘을 안 알려 준다 — 화면이 몇 개를 접었는지도 모른다');
  /* ★ **거르지 않고 통째로** 준다. 여기서 빼면 화면이 되돌릴 길이 없다.
   *   (`hiddenCount` 를 세는 filter 는 세는 것이지 빼는 것이 아니다) */
  assert.ok(/body: \{ projects: rows, hiddenCount/.test(src),
    '서버가 접힌 것을 빼 버린다 — 그러면 되돌릴 길이 없다');
  assert.ok(src.indexOf('hiddenCount') !== -1, '몇 개를 접었는지 안 센다');
  /* ★ 접고 펴는 것은 **쓰기**다 — 읽기 라우터가 아니라 report-api 에 있다 */
  const w = fs.readFileSync(path.join(__dirname, '..', 'ui', 'report-api.cjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/path: '\/projects\/:id\/hidden'/.test(w), '접고 펴는 길이 없다');
  assert.ok(!/path: '\/projects\/:id\/hidden'/.test(src),
    '쓰기 길을 읽기 라우터에 걸었다 — 읽기·쓰기 표가 갈린다');
});

/* ── 화면이 그것을 말하는가 ───────────────────────────────── */

test('★★★ 화면이 **「지운 것이 아니다」**를 말한다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'ui', 'platform', 'outputs.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(src.indexOf('지운 것이 아닙니다') !== -1,
    '접었다고만 하면 사라진 줄 알고 다시 만든다');
  assert.ok(src.indexOf('지난 것 보기') !== -1, '되돌려 볼 길이 화면에 없다');
  assert.ok(src.indexOf('목록에 다시 펴기') !== -1, '되돌리는 단추가 없다');
  assert.ok(src.indexOf('이 프로젝트를 목록에서 숨기기') !== -1, '접는 단추가 없다');
});

test('★★★ 서버에 못 닿아도 이 브라우저에서는 접힌다 (눌러도 아무 일 없으면 안 된다)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'ui', 'platform', 'outputs.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/function setLocalFold/.test(src), '브라우저 쪽 기억이 없다');
  assert.ok(/setLocalFold\(id, on\);\s*\n/.test(src),
    '서버 응답을 기다린 뒤에 접는다 — 못 닿으면 눌러도 아무 일이 안 난다');
  /* ★ 서버가 말한 것이 먼저다 — 기기를 바꿔도 접힘이 따라와야 한다 */
  assert.ok(/if \(p && p\.hidden === true\) return true;/.test(src),
    '서버가 말한 접힘을 안 본다');
});
