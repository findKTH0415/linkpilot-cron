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
