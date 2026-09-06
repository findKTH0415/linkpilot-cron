/**
 * test-lock.test.js — 시험 잠금이 **막아야 할 때 막고, 막으면 안 될 때 안 막는가.**
 *
 * ★★★ 2026-09-01 실측: `npm test` 를 두 벌 동시에 돌려 **빨간 줄 다섯**을 봤다.
 *   단독으로 돌리니 실제 실패는 **하나**였다 — 없는 고장을 넷 만들어 낸 것이다.
 *   빨간 줄이 거짓말을 하면 그다음 판단이 전부 어긋난다(멀쩡한 코드를 고치러 간다).
 *
 * ★★ 잠금은 **고장이 되기 쉬운 장치**다. 죽은 잠금이 안 풀리면 영영 막히고,
 *   그러면 사람이 잠금을 지우는 습관이 들어 장치가 무력해진다. 그래서 여기서
 *   **풀리는 쪽을 더 세게 잰다.**
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'im-agent', 'tools', 'test-lock.js');
const { LOCK } = require(TOOL);

const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd: ROOT });
const clear = () => { try { fs.rmSync(LOCK, { force: true }); } catch (_) {} };

test('1. 아무도 안 돌고 있으면 그냥 돌린다', () => {
  clear();
  const r = run(['node', '-e', 'process.exit(0)']);
  assert.strictEqual(r.status, 0);
});

test('2. 돌린 명령의 되돌아온 값을 그대로 넘긴다 (실패를 삼키지 않는다)', () => {
  clear();
  const r = run(['node', '-e', 'process.exit(7)']);
  assert.strictEqual(r.status, 7, '★ 잠금이 실패를 0 으로 바꾸면 빨간 시험이 초록으로 보인다');
});

test('3. 끝나면 잠금을 푼다 — 실패로 끝나도 푼다', () => {
  clear();
  run(['node', '-e', 'process.exit(1)']);
  assert.ok(!fs.existsSync(LOCK), '실패로 끝났다고 잠금이 남으면 다음 사람이 영영 막힌다');
});

test('4. ★ 이미 돌고 있으면 막고, 3 으로 끝난다 (0 이면 「돌았다」로 읽힌다)', () => {
  clear();
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), cmd: 'npm test' }));
  const r = run(['node', '-e', 'process.exit(0)']);
  clear();
  assert.strictEqual(r.status, 3, '막았으면 0 이 아니어야 한다');
  assert.ok(/이미 돌고 있습니다/.test(r.stderr), '왜 안 돌렸는지 말해야 한다');
  assert.ok(/npm test/.test(r.stderr) && /pid/.test(r.stderr),
    '★ 무슨 명령이 언제부터 도는지 말해야 기다릴지 지울지 정할 수 있다');
});

test('5. ★★ 죽은 잠금은 저절로 풀린다 (안 그러면 잠금이 고장이 된다)', () => {
  clear();
  /* 확실히 죽은 pid — 방금 끝난 프로세스의 번호를 쓴다 */
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  const pid = Number(String(dead.stdout).trim());
  assert.ok(pid > 0);
  fs.writeFileSync(LOCK, JSON.stringify({ pid, at: new Date().toISOString(), cmd: '죽은 시험' }));
  const r = run(['node', '-e', 'process.exit(0)']);
  assert.strictEqual(r.status, 0, '죽은 잠금이 막으면 사람이 잠금을 지우는 습관이 들어 장치가 무력해진다');
});

test('6. 망가진 잠금 파일도 저절로 걷힌다', () => {
  clear();
  fs.writeFileSync(LOCK, '이건 JSON 이 아니다');
  const r = run(['node', '-e', 'process.exit(0)']);
  assert.strictEqual(r.status, 0);
});

test('7. npm test 가 잠금을 거쳐 돈다 (걸어 두고 안 쓰면 없는 것과 같다)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(/test-lock\.js/.test(pkg.scripts.test),
    '★ npm test 가 잠금을 안 거치면 이 장치는 아무것도 안 막는다');
  assert.ok(/--test/.test(pkg.scripts.test), '시험은 여전히 돌아야 한다');
  assert.ok(pkg.scripts['test:nolock'], '잠금을 우회할 길도 하나 남긴다 (CI 처럼 혼자 도는 자리)');
});
