'use strict';
/* platform-watch.test.js — platform 배포 감시(D-289)를 «가짜 GitHub 를 끼워 실제로 돌려서» 잰다.
 *   ① 열쇠가 없으면 2 로 끝나고 값을 한 글자도 안 찍는다
 *   ② 러너를 못 받은 실행(단계 0 · 러너 이름 빈칸 · 2초)이면 3 — deploy-why 한 벌의 판정 그대로
 *   ③ 성공한 실행이면 0
 *   ④ 실행 목록을 못 받으면(401) 2 — 「못 쟀다」이지 통과가 아니다
 *   ⑤ 워크플로가 변수로 무장된다(vars.PLATFORM_WATCH_ON) · 판 v5 · 값은 하나도 안 찍는다 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'platform-deploy-watch.mjs');
const TOKEN = 'ghp_FAKE_TOKEN_DO_NOT_PRINT_1234567890';

function serve(kind) {
  const now = '2026-09-24T11:00:00Z';
  const run = { id: 777, head_sha: 'abcdef1234567890', status: 'completed', conclusion: kind === 'ok' ? 'success' : 'failure', created_at: now, run_started_at: now, updated_at: '2026-09-24T11:00:02Z', html_url: 'https://example.invalid/run/777' };
  const jobs = kind === 'ok'
    ? { jobs: [{ id: 1, name: 'deploy', conclusion: 'success', runner_name: 'GitHub Actions 3', steps: [{ name: 'a', conclusion: 'success' }], created_at: now, started_at: now }] }
    : { jobs: [{ id: 1, name: 'deploy', conclusion: 'failure', runner_name: '', steps: [], created_at: now, started_at: now }] };
  return http.createServer((req, res) => {
    const auth = req.headers.authorization || '';
    if (kind === 'unauth' || auth !== 'Bearer ' + TOKEN) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ message: 'Bad credentials' })); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (/\/actions\/workflows\//.test(req.url)) return res.end(JSON.stringify({ workflow_runs: [run] }));
    if (/\/actions\/runs\/777\/jobs/.test(req.url)) return res.end(JSON.stringify(jobs));
    if (/\/check-runs\/1\/annotations/.test(req.url)) return res.end(JSON.stringify([{ message: 'The job was not started because recent account payments have failed or your spending limit needs to be increased.' }]));
    res.end('{}');
  });
}
/* ★ spawnSync 를 쓰면 안 된다 — 가짜 서버가 «같은 프로세스»라 부모가 막히는 동안 답을 못 해 자식이 영영 기다린다(실측: 첫 판이 그렇게 매달렸다). */
const run = (env) => new Promise((resolve) => {
  const c = spawn(process.execPath, [SCRIPT], { env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...env } });
  let stdout = '', stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch (_) {} }, 20000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});
const withServer = async (kind, fn) => { const s = serve(kind); await new Promise((r) => s.listen(0, '127.0.0.1', r)); try { return await fn('http://127.0.0.1:' + s.address().port); } finally { s.close(); } };

test('① 열쇠가 없으면 2 · 값을 안 찍는다', async () => {
  const r = await run({ PLATFORM_WATCH_TOKEN: '' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /못 쟀다/);
});

test('② 러너를 못 받은 실행이면 3 (deploy-why 한 벌) · 출력에 열쇠 값이 없다', async () => {
  await withServer('stalled', async (base) => {
    const r = await run({ PLATFORM_WATCH_TOKEN: TOKEN, PLATFORM_WATCH_API: base });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /시작조차 못 했/);
    assert.ok(!(r.stdout + r.stderr).includes(TOKEN), '열쇠 값이 출력에 있다 (§2)');
    assert.match(r.stderr, /판정 3/);
  });
});

test('③ 성공한 실행이면 0', async () => {
  await withServer('ok', async (base) => {
    const r = await run({ PLATFORM_WATCH_TOKEN: TOKEN, PLATFORM_WATCH_API: base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /성공/);
  });
});

test('④ 실행 목록을 못 받으면 2 — 못 쟀다 (통과가 아니다)', async () => {
  await withServer('unauth', async (base) => {
    const r = await run({ PLATFORM_WATCH_TOKEN: TOKEN, PLATFORM_WATCH_API: base });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /HTTP 401/);
    assert.ok(!(r.stdout + r.stderr).includes(TOKEN), '열쇠 값이 출력에 있다 (§2)');
  });
});

test('⑤ 워크플로 — 변수로 무장 · v5 · 스크립트를 부른다', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'platform-deploy-watch.yml'), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(y, /if:\s*vars\.PLATFORM_WATCH_ON\s*==\s*'1'/, '변수로 무장되지 않았다 — 열쇠 없이 시간마다 빨개진다');
  assert.match(y, /actions\/checkout@v5/); assert.match(y, /actions\/setup-node@v5/);
  assert.match(y, /node scripts\/platform-deploy-watch\.mjs/);
  assert.match(y, /PLATFORM_WATCH_TOKEN:\s*\$\{\{\s*secrets\.PLATFORM_WATCH_TOKEN\s*\}\}/);
});
