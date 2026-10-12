'use strict';
/* key-presence — 사장님 목록의 열쇠 «이름»이 들어 있는지 세는 진단 〈2026-10-12〉.
   ① 이름 목록(scripts/key-presence.mjs 의 NAMES)과 워크플로 env 가 같은가 — 두 벌이 갈리면 그 이름은 늘 «없음»으로 적힌다
   ② 값을 한 글자도 안 찍는가 (§2 · 공개 저장소) — 미끼 값으로 센다
   ③ 대조 비밀이 안 읽히면 «없음»이 아니라 «못 쟀다»로 끝나는가 (§8) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'scripts', 'key-presence.mjs');

test('이름 목록과 워크플로 env 가 같다', async () => {
  const m = await import(SRC);
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'api-smoke.yml'), 'utf8');
  const a = wf.indexOf('- name: 열쇠 이름이 들어 있는지 센다'); assert.ok(a > 0, '그 단계가 없다');
  const b = wf.indexOf('run:', a); const env = wf.slice(a, b);
  const want = [...new Set([...m.NAMES.map((x) => x[1]), ...m.CONTROL])];
  const got = [...env.matchAll(/^\s+([A-Z0-9_]+): \$\{\{ secrets\.\1 \}\}/gm)].map((x) => x[1]);
  assert.deepStrictEqual(want.filter((n) => !got.includes(n)), [], 'env 에 빠진 이름');
  assert.deepStrictEqual(got.filter((n) => !want.includes(n)), [], '목록에 없는 env');
  assert.ok(m.NAMES.length >= 49, '목록이 줄었다 ' + m.NAMES.length);
  assert.ok(m.NAMES.every(([, n]) => /^[A-Z0-9_]+$/.test(n)), 'GitHub 비밀 이름은 대문자로 저장된다');
});

function run(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-'));
  const r = spawnSync(process.execPath, [SRC], { cwd: dir, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  const md = fs.existsSync(path.join(dir, 'data', '_api', 'key-presence.md')) ? fs.readFileSync(path.join(dir, 'data', '_api', 'key-presence.md'), 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: (r.stdout || '') + md };
}

test('값은 안 찍고 길이만 · 있음/없음을 가른다', () => {
  const BAIT = 'BAITVALUE-0123456789-zzz';
  const r = run({ DATA_GO_KR_KEY: 'x'.repeat(64), FSC_API: BAIT, ECOC_API: '  ' });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.out.includes(BAIT), '값이 찍혔다');
  assert.match(r.out, /`FSC_API` \| 기금대출정보 \| ✅ 있음 \(길이 24\)/);
  assert.match(r.out, /`ECOC_API` \| 한국은행 \| — 없음/, '빈칸만 있는 값을 «있음»으로 세면 안 된다');
});

test('대조 비밀도 안 읽히면 «못 쟀다»로 끝난다', () => {
  const r = run({});
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /못 쟀다/);
  assert.ok(!/— 없음/.test(r.out), '못 잰 것을 «없음»으로 적었다');
});
