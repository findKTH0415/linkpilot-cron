'use strict';
/**
 * ds-engine.test.js — 디자인 시스템 엔진(ds-engine/, 2026-10-25 사장님 제공)을 «npm test» 안에서 돌린다.
 *
 * 엔진 자체 검사 둘(엔진 규칙 · 실제 브라우저)은 받은 그대로 두고, 여기서는 그 둘을 부르고
 * 화면(flow-core.js 의 디자인 10종 카드)과 엔진의 10종이 같은 값을 쓰는지 대 본다 —
 * 두 벌이 갈리면 카드와 출력이 서로 다른 색을 말한다(§8-1).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'ds-engine');

function run(script) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-engine-'));
  const r = spawnSync(process.execPath, [path.join(DIR, script)], { cwd, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('엔진 규칙 검사 — 받은 검사 전부 통과', () => {
  const r = run('test-design-system-engine.mjs');
  assert.strictEqual(r.code, 0, r.out.split('\n').filter((l) => /FAIL|결과/.test(l)).join('\n'));
});

test('실제 브라우저 검사 — 플랫폼 글꼴 강제 규칙과 함께 그려도 통과', (t) => {
  let ok = true;
  try { require.resolve('playwright'); } catch (_) { ok = false; }
  if (!ok) { t.skip('playwright 없음 — 못 쟀다'); return; }
  const r = run('test-browser.mjs');
  assert.strictEqual(r.code, 0, r.out.split('\n').filter((l) => /FAIL|브라우저 확인/.test(l)).join('\n'));
});

test('화면 10종 카드와 엔진 10종이 같은 ID·이름·컬러 참조를 쓴다', async () => {
  const E = await import(path.join(DIR, 'design-system-engine.js'));
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'flow-core.js'), 'utf8');
  const rows = [...src.matchAll(/\{ id: '(LP-DS-\d\d)', name: '([^']+)'[^\n]*?refs: \[([^\]]*)\]/g)];
  assert.strictEqual(rows.length, 10, '화면에서 10종 카드를 못 읽었다 — 이 칸은 아무것도 안 잰다');
  for (const [, id, name, refs] of rows) {
    const ty = E.getDesignType(id);
    assert.strictEqual(ty.name, name, id + ' 이름');
    const want = [...new Set(Object.values(ty.colorRefs))].sort();
    const got = refs.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort();
    assert.deepStrictEqual(got, want, id + ' 컬러 참조');
  }
});
