// key-add.test.js — 새 열쇠 이름을 «따라가는 자리 일곱»에 한 번에 다는 도구 〈2026-10-17 · 반복 패턴의 지침화 · CLAUDE.md §7〉
// ★ 사본에서 돌린다 — 저장소 파일을 건드리지 않는다. 가짜 이름이 일곱 자리에 다 들어가는지 · 두 번 돌리면 아무것도 안 바뀌는지를 잰다.
'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const FILES = ['im-agent/connectors/http.js', '.github/workflows/api-smoke.yml', '.github/workflows/deploy-nas.yml', 'scripts/fsc-probe.mjs', 'scripts/key-presence.mjs', 'docs/운영지침-공공API-활용.md', 'docs/미결정-사항.md'];
const NAME = 'ZZ_KEYADD_PROBE_NAME';
function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'keyadd-'));
  for (const f of FILES) { fs.mkdirSync(path.join(d, path.dirname(f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(d, f)); }
  return d;
}
const run = (d, extra = []) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/key-add.mjs'), '--name', NAME, '--org', '시험기관', '--service', '시험기관_시험서비스', '--use', '시험', ...extra], { cwd: d, encoding: 'utf8' });

test('★★ 새 이름이 일곱 자리에 다 들어간다 — 하나도 손으로 안 단다', () => {
  const d = sandbox(); const r = run(d);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  for (const f of FILES) assert.ok(fs.readFileSync(path.join(d, f), 'utf8').includes(NAME), f + ' 에 이름이 안 들어갔다');
  const smoke = fs.readFileSync(path.join(d, '.github/workflows/api-smoke.yml'), 'utf8');
  const anchors = (smoke.match(/^\s+KOTRA_KOREA_FDI_BY_INDUSTRY:/gm) || []).length;
  assert.strictEqual((smoke.match(new RegExp('^\\s+' + NAME + ':', 'gm')) || []).length, anchors, '진단 잡마다 env 가 들어가야 한다');
  const deploy = fs.readFileSync(path.join(d, '.github/workflows/deploy-nas.yml'), 'utf8');
  assert.match(deploy, new RegExp('NAMES="GEMINI_API_KEY [^"]*\\b' + NAME + '\\b'), '배포 NAMES 에 안 들어갔다 — 그러면 NAS 로 안 간다');
  const probe = fs.readFileSync(path.join(d, 'scripts/fsc-probe.mjs'), 'utf8');
  assert.match(probe, new RegExp("^  for \\(const n of \\[[^\\n]*'" + NAME + "'", 'm'), '진단의 이름 목록에 안 들어갔다');
  assert.match(probe, new RegExp("key: '" + NAME + "', keyword:"), '번호를 모르면 포털 검색 줄로 달아야 한다');
});

test('★ 두 번 돌려도 같다 — 이미 있는 자리는 건너뛴다', () => {
  const d = sandbox(); run(d);
  const before = FILES.map(f => fs.readFileSync(path.join(d, f), 'utf8'));
  const r = run(d); assert.strictEqual(r.status, 0, r.stdout);
  FILES.forEach((f, i) => assert.strictEqual(fs.readFileSync(path.join(d, f), 'utf8'), before[i], f + ' 가 두 번째에 또 바뀌었다'));
});

test('★ 서비스 번호를 알면 서비스 줄로 단다 · 이름 모양이 아니면 아무것도 안 고친다', () => {
  const d = sandbox(); run(d, ['--id', '15000001']);
  assert.match(fs.readFileSync(path.join(d, 'scripts/fsc-probe.mjs'), 'utf8'), new RegExp("key: '" + NAME + "', id: '15000001'"));
  const d2 = sandbox(); const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts/key-add.mjs'), '--name', 'bad name', '--org', 'a', '--service', 'b', '--use', 'c'], { cwd: d2, encoding: 'utf8' });
  assert.notStrictEqual(bad.status, 0);
  for (const f of FILES) assert.strictEqual(fs.readFileSync(path.join(d2, f), 'utf8'), fs.readFileSync(path.join(ROOT, f), 'utf8'));
});

test('★ 반쯤 된 상태도 채운다 — 한 잡에만 env 가 있거나, 서비스 줄만 있고 이름 목록이 없을 때 (Codex #241)', () => {
  const d = sandbox();
  const smokeP = path.join(d, '.github/workflows/api-smoke.yml');
  /* 첫 닻 뒤에만 손으로 단 상태 */
  fs.writeFileSync(smokeP, fs.readFileSync(smokeP, 'utf8').replace(/^( +)KOTRA_KOREA_FDI_BY_INDUSTRY:[^\n]*$/m, (m, sp) => m + '\n' + sp + NAME + ': ${{ secrets.' + NAME + ' }}'));
  const probeP = path.join(d, 'scripts/fsc-probe.mjs');
  /* 서비스 줄만 손으로 단 상태 (이름 목록에는 없다) */
  fs.writeFileSync(probeP, fs.readFileSync(probeP, 'utf8').replace(/^(  \{ key: 'FSC_AMC_API', id: '15139266'[^\n]*)$/m, "$1\n  { key: '" + NAME + "', id: '15000002', name: 'x', use: 'y' },"));
  const r = run(d); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const smoke = fs.readFileSync(smokeP, 'utf8');
  const anchors = (smoke.match(/^\s+KOTRA_KOREA_FDI_BY_INDUSTRY:/gm) || []).length;
  assert.strictEqual((smoke.match(new RegExp('^\\s+' + NAME + ':', 'gm')) || []).length, anchors, '남은 잡에도 env 가 들어가야 한다 (두 번 들어가지도 않는다)');
  const probe = fs.readFileSync(probeP, 'utf8');
  assert.match(probe, new RegExp("^  for \\(const n of \\[[^\\n]*'" + NAME + "'", 'm'), '서비스 줄만 있던 상태에서 이름 목록이 채워지지 않았다');
  assert.strictEqual((probe.match(new RegExp("key: '" + NAME + "'", 'g')) || []).length, 1, '서비스 줄이 두 벌이 됐다');
});
