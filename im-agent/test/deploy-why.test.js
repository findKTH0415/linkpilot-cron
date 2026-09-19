'use strict';
/**
 * deploy-why.test.js — **배포 실패의 «갈래»를 갈라 읽는가**
 *   〈2026-09-17 사장님: 「권하는 개선안 진행해」 — 권장 ①〉
 *
 * ★★★ [왜 이 칸이 생겼나] platform #122 가 합쳐진 뒤 배포가 **3초 만에** 실패했다.
 *   나는 로그를 열고(404 였다) 잡 JSON 을 뜯어 **주석**까지 가서야 사유를 찾았다 —
 *   「recent account payments have failed or your spending limit needs to be increased」.
 *   **코드 실패가 아니라 «일이 시작조차 못 한 것»**이고, 할 일이 **정반대**다
 *   (CLAUDE.md §4.6 · §12-4 · §12-13 과 같은 규칙).
 *
 * ★★ [급소] 「실패했다」로 뭉뚱그리면 사장님이 **고칠 것이 없는 코드**를 보러 가신다.
 *   그래서 이 칸은 **돌려서** 잰다 — 실제 GitHub 응답 모양을 먹인다.
 *
 * ★ [반대로 가는 것도 막는다] 단계가 돌다 멈춘 «진짜 코드 실패»를 「결제 자리」로
 *   적으면 그때는 결제를 보러 가시게 된다. **두 갈래를 각각** 잰다 (§4.6 과 같은 결).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOOL = path.join(__dirname, '..', 'tools', 'deploy-why.js');
const W = require(TOOL);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
const put = (n, o) => { const p = path.join(tmp, n); fs.writeFileSync(p, JSON.stringify(o)); return p; };

/** 도구를 **돌려서** 되돌아오는 값과 화면 글을 함께 본다 */
function run(args) {
  try {
    const out = execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

const RUN_BASE = {
  id: 1, head_sha: 'abcdef1234567890',
  run_started_at: '2026-09-17T10:48:57Z', updated_at: '2026-09-17T10:49:00Z',
};

test('★★★ 일이 «시작조차 못 한 것»을 코드 실패와 갈라 적는다', () => {
  const r = put('run.json', { ...RUN_BASE, status: 'completed', conclusion: 'failure' });
  const j = put('jobs.json', { jobs: [{ name: 'deploy', conclusion: 'failure', steps: [], runner_id: 0, runner_name: '' }] });
  const a = put('ann.json', [{ annotation_level: 'failure', message: 'The job was not started because recent account payments have failed or your spending limit needs to be increased.' }]);
  const { code, out } = run(['--run', r, '--jobs', j, '--ann', a]);
  assert.strictEqual(code, 3, '되돌아오는 값이 3(못 시작)이어야 한다 — 실제 값 ' + code);
  assert.match(out, /시작조차 못 했습니다/, '무슨 일인지 사람 말로 안 적는다');
  assert.match(out, /코드 문제가 아닙니다/, '「코드 문제가 아니다」를 «부정으로» 안 적는다 — 그러면 코드를 보러 가신다');
  assert.match(out, /결제 자리/, '어디를 보셔야 하는지 안 가리킨다');
  assert.match(out, /①\s*어디서/, '어디서·무엇을·어떻게·그러면 넷을 안 적는다 (§5)');
  assert.match(out, /3초/, '몇 초 만에 끝났는지 안 적는다 — 그것이 이 갈래의 강한 신호다');
});

test('★★★ 반대로도 안 간다 — 단계가 «돌다 멈춘» 것은 코드 쪽이라 적는다', () => {
  const r = put('run2.json', { ...RUN_BASE, id: 2, status: 'completed', conclusion: 'failure', updated_at: '2026-09-17T11:00:00Z' });
  const j = put('jobs2.json', {
    jobs: [{
      name: 'deploy', conclusion: 'failure', runner_id: 7, runner_name: 'GitHub Actions 7',
      steps: [
        { number: 1, name: 'Checkout', conclusion: 'success' },
        { number: 2, name: 'Upload to NAS', conclusion: 'failure' },
        { number: 3, name: 'Verify deployed', conclusion: 'skipped' },
      ],
    }],
  });
  const { code, out } = run(['--run', r, '--jobs', j]);
  assert.strictEqual(code, 1, '되돌아오는 값이 1(코드)이어야 한다 — 실제 값 ' + code);
  assert.match(out, /돌다가 멈췄습니다/, '무슨 일인지 안 적는다');
  assert.match(out, /Upload to NAS/, '멈춘 «단계 이름»을 안 적는다 — 「실패했다」만으로는 못 고친다');
  assert.match(out, /결제 자리가 아닙니다/, '이쪽에서 결제를 가리키면 엉뚱한 곳을 보시게 된다');
  assert.ok(!/시작조차 못 했습니다/.test(out), '두 갈래가 섞였다');
});

test('★★ 「비켜난 것」을 실패로 안 적는다', () => {
  const r = put('run3.json', { ...RUN_BASE, id: 3, status: 'completed', conclusion: 'cancelled' });
  const j = put('jobs3.json', { jobs: [] });
  const { code, out } = run(['--run', r, '--jobs', j]);
  assert.strictEqual(code, 0, 'cancelled 은 실패가 아니다 — 실제 값 ' + code);
  assert.match(out, /실패가 아닙니다/, '「실패가 아니다」를 안 적으면 빨간 줄로 읽힌다');
});

test('★ 성공은 성공이라 적되 «화면이 새 판인가»와 갈라 적는다', () => {
  const r = put('run4.json', { ...RUN_BASE, id: 4, status: 'completed', conclusion: 'success' });
  const j = put('jobs4.json', { jobs: [{ name: 'deploy', conclusion: 'success', steps: [{ number: 1, name: 'x', conclusion: 'success' }], runner_name: 'r' }] });
  const { code, out } = run(['--run', r, '--jobs', j]);
  assert.strictEqual(code, 0);
  assert.match(out, /다른 사실/, '「배포 성공」과 「화면이 새 판」을 안 가르면 M-25 가 되살아난다');
});

test('★★★ 못 읽으면 «못 쟀다»로 끝낸다 — 통과도 실패도 아니다 (§8)', () => {
  const { code, out } = run(['--run', path.join(tmp, '없다.json')]);
  assert.strictEqual(code, 2, '못 잰 것은 되돌아오는 값 2 여야 한다 — 실제 값 ' + code);
  assert.match(out, /아무것도 안 쟀다/, '못 쟀다고 소리 내어 안 말한다');
});

test('★★ 「단계 0개」와 「러너 없음」이 «함께»일 때만 그 갈래다', () => {
  /* 단계는 있는데 러너 이름만 빈 경우 — 시작은 한 것이다 */
  assert.strictEqual(W.neverStarted({ steps: [{ number: 1 }], runner_name: '', runner_id: 0 }), false);
  /* 러너는 있는데 단계가 빈 경우 — 스킵 등 다른 사정이다 */
  assert.strictEqual(W.neverStarted({ steps: [], runner_name: 'GitHub Actions 3', runner_id: 3 }), false);
  /* 둘 다일 때만 */
  assert.strictEqual(W.neverStarted({ steps: [], runner_name: '', runner_id: 0 }), true);
});

test('★★★ 사유를 못 받아도 «못 받았다»고 적는다 — 지어내지 않는다', () => {
  const r = put('run5.json', { ...RUN_BASE, id: 5, status: 'completed', conclusion: 'failure' });
  const j = put('jobs5.json', { jobs: [{ name: 'deploy', conclusion: 'failure', steps: [], runner_id: 0, runner_name: '' }] });
  const { code, out } = run(['--run', r, '--jobs', j]);
  assert.strictEqual(code, 3);
  assert.match(out, /사유를 못 받았습니다/, '사유가 없는데 결제라고 단정하면 엉뚱한 곳을 가리킨다');
  assert.ok(!/결제 자리를 보셔야/.test(out), '사유 없이 결제를 가리켰다');
});

test('★ 아직 도는 중인 것을 실패로 안 적는다', () => {
  const r = put('run6.json', { ...RUN_BASE, id: 6, status: 'in_progress', conclusion: null });
  const j = put('jobs6.json', { jobs: [] });
  const { code, out } = run(['--run', r, '--jobs', j]);
  assert.strictEqual(code, 0);
  assert.match(out, /도는 중/, '도는 중인 것을 그렇다고 안 적는다');
});

/* ────────────────────────────────────────────────────────────────────
 * 넷째 갈래 — 「워크플로 파일 자체가 거부된 것」 〈2026-09-17 실측〉
 *
 * 사장님 화면: `.github/workflows/deploy-im.yml` 이 **1초**에 ❌ 였고
 * GitHub 의 결론은 `startup_failure` — 잡도 단계도 **안 만들어졌다.**
 *
 * ★ 앞 판은 이것을 「코드 쪽(값 1)」으로 적고 **「멈춘 단계의 로그를 열어
 *   보십시오」**라고 말했다. **열 로그가 없다** — 404 다. 사장님이 없는
 *   자리를 찾아 헤매신다 (§12-14 가 겪은 그 자리 · §4.6 과 같은 결).
 * ★★ 고칠 자리가 **정반대**다: 실패한 단계가 아니라 **그 `.yml` 파일**이다.
 * ────────────────────────────────────────────────────────────────── */

test('★★★ startup_failure 를 「코드 쪽」과 갈라 적는다 (값 4)', () => {
  const r = put('run_sf.json', {
    id: 35231206888, status: 'completed', conclusion: 'startup_failure',
    path: '.github/workflows/deploy-im.yml',
    head_sha: 'fe9bf4ca0cbeb3176ed9b87ac357add132455a64',
  });
  const j = put('jobs_sf.json', { jobs: [] });
  const { code, out } = run(['--run', r, '--jobs', j]);
  assert.strictEqual(code, 4, '값 1(코드 쪽)·3(러너)과 뭉뚱그립니다 — 할 일이 정반대입니다');
  /* ★ 이 고장의 본체는 «엉뚱한 곳을 가리키는 글»이었다 — 낱말이 아니라
       «시키는가»를 잰다 (§4.6 의 그 잣대). */
  assert.ok(!/멈춘 단계의 로그를 열/.test(out),
    '없는 로그를 열어 보라고 말합니다 — 사장님이 404 를 보십니다');
  assert.match(out, /로그가 없습니다|로그 자체가 없/, '로그가 없다는 사실을 안 적습니다');
  assert.match(out, /결제 자리도.*아닙니다|결제 자리가 아닙/,
    '결제 자리가 아니라는 것을 안 적습니다 — 그쪽을 보러 가십니다');
});

test('★★ 고칠 «그 파일»을 이름으로 짚는다 (못 받으면 못 받았다고 적는다)', () => {
  const r = put('run_sf2.json', {
    id: 1, status: 'completed', conclusion: 'startup_failure',
    path: '.github/workflows/deploy-im.yml', head_sha: 'abc1234',
  });
  const j = put('jobs_sf2.json', { jobs: [] });
  const { out } = run(['--run', r, '--jobs', j]);
  assert.match(out, /\.github\/workflows\/deploy-im\.yml/,
    '어느 파일을 고쳐야 하는지 안 적습니다');
  /* ★ 경로를 못 받은 경우 — 지어내지 않는다 (§4.7) */
  const r2 = put('run_sf3.json', { id: 2, status: 'completed', conclusion: 'startup_failure' });
  const { out: out2 } = run(['--run', r2, '--jobs', j]);
  assert.match(out2, /경로를 못 받았습니다/, '경로가 없는데 있는 척 적습니다');
});

test('★★★ 사유를 못 받으면 «무엇이 틀렸는지 지어내지 않는다»', () => {
  const r = put('run_sf4.json', {
    id: 3, status: 'completed', conclusion: 'startup_failure',
    path: '.github/workflows/x.yml',
  });
  const j = put('jobs_sf4.json', { jobs: [] });
  const { out } = run(['--run', r, '--jobs', j]);
  assert.match(out, /사유를 못 받았습니다/, '사유가 없는데 있는 것처럼 적습니다');
  /* ★★ 그리고 «YAML 이 맞으면 괜찮다»로 넘어가지 않게 적어야 한다 —
     실측에서 이 파일은 YAML 로는 멀쩡히 파싱됐다. */
  assert.match(out, /스키마|YAML 문법이 맞아도/,
    'YAML 이 맞으면 괜찮다고 읽힙니다 — 실측에서 그 파일은 YAML 로는 멀쩡했습니다');
  /* ★ 사유를 받은 경우에는 그대로 싣는다 */
  const a = put('ann_sf.json', [{ message: 'Invalid workflow file: line 42, col 7' }]);
  const { out: out2 } = run(['--run', r, '--jobs', j, '--ann', a]);
  assert.match(out2, /line 42/, '받은 사유를 안 싣습니다');
  assert.ok(!/사유를 못 받았습니다/.test(out2), '사유를 받았는데 못 받았다고 적습니다');
});
