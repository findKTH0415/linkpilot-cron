/**
 * **특일정보를 열쇠가 있는 자리에서 받아 결과만 커밋한다** 〈2026-09-12 · D-206〉.
 *
 * 사장님 지시: 「특일정보 API 를 붙여라」.
 *
 * ★ 이 자리에는 열쇠가 없다. 그래서 **부르는 것은 못 잰다** (§4.3 — 키 없는 자리에서
 *   실키를 판정하지 않는다). 대신 **열쇠 없이도 잴 수 있는 것**을 잰다:
 *   못 받았을 때 어떻게 끝나는가 · 왜 안 되는지 갈라 말하는가 · 결과에 열쇠가
 *   섞이면 막는가 · 워크플로가 접속 자격증명을 안 들고 있는가.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const kasi = require('../connectors/kasi');
const tool = require('../tools/calendar-fetch');

test('갈래 넷을 다 읽는다 (공휴일만 받으면 절기가 통째로 빠진다)', () => {
  const want = ['holiday', 'term', 'sundry', 'anniversary'];
  assert.deepStrictEqual(Object.keys(kasi.KINDS).sort(), want.slice().sort());
  /* 지침서 v1.1 §4.6 이 요구하는 24절기가 그 안에 있어야 한다 */
  assert.strictEqual(kasi.KINDS.term.label, '24절기');
});

test('날짜를 표가 쓰는 모양으로 편다 (0 을 안 붙인다)', () => {
  assert.strictEqual(kasi.toKey('20260217'), '2026-2-17');
  assert.strictEqual(kasi.toKey('2026-09-25'), '2026-9-25');
  assert.strictEqual(kasi.toKey('엉뚱'), null);
});

test('★ 왜 안 되는지 갈라 말한다 — 「승인 전」과 「키 틀림」이 안 섞인다', () => {
  /* [왜 급소인가] 활용신청 전이면 **키가 멀쩡해도 거부**되는데 그 응답이
     「키가 틀렸다」와 똑같이 생겼다 (§4.2). 갈라 주지 않으면 사장님이
     키를 다시 발급받으시고도 같은 증상을 보신다. */
  const approval = kasi.diagnose(200, '<returnReasonCode>30</returnReasonCode>SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
  const key = kasi.diagnose(401, '');
  const quota = kasi.diagnose(200, 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR');
  const gone = kasi.diagnose(200, 'NO_OPENAPI_SERVICE_ERROR');
  assert.strictEqual(approval.kind, 'approval');
  assert.strictEqual(key.kind, 'key');
  assert.strictEqual(quota.kind, 'quota');
  assert.strictEqual(gone.kind, 'endpoint');
  const kinds = new Set([approval.kind, key.kind, quota.kind, gone.kind]);
  assert.strictEqual(kinds.size, 4, '넷이 서로 다른 판정이어야 한다');
  assert.match(approval.head, /활용신청/, '승인 안내에 무엇을 해야 하는지가 없다');
});

test('★★ 열쇠가 없으면 «못 쟀다»로 끝낸다 — 통과로도 실패로도 안 뭉갠다', () => {
  const env = { ...process.env };
  delete env.DATA_GO_KR_KEY;
  let code = 0, out = '';
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'im-agent/tools/calendar-fetch.js')],
      { env, encoding: 'utf8' });
  } catch (e) { code = e.status; out = String(e.stdout || ''); }
  assert.strictEqual(code, 2, '열쇠가 없을 때 돌아오는 값이 2(못 쟀다)가 아니다 — ' + code);
  assert.match(out, /못 받았다|미설정/, '왜 안 됐는지 안 말한다');
});

test('★★★ 결과에 열쇠 값이 섞이면 잡는다 (이 저장소는 공개다 — D-10)', () => {
  const before = process.env.LP_TEST_FAKE_KEY;
  process.env.LP_TEST_FAKE_KEY = 'abcd1234efgh5678ijkl';
  try {
    assert.deepStrictEqual(tool.leaks('아무 일 없는 본문'), []);
    assert.deepStrictEqual(tool.leaks('앞 abcd1234efgh5678ijkl 뒤'), ['LP_TEST_FAKE_KEY'],
      '본문에 열쇠 값이 있는데 못 잡는다');
  } finally {
    if (before === undefined) delete process.env.LP_TEST_FAKE_KEY; else process.env.LP_TEST_FAKE_KEY = before;
  }
});

test('★★ 수집 잡에 접속 자격증명이 없다 (규정집 2-8 · §4)', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/calendar-fetch.yml'), 'utf8');
  const code = y.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const bad of ['NAS_HOST', 'NAS_SSH', 'TAILSCALE', 'DEPLOY_KEY', 'SSH_KEY']) {
    assert.ok(code.indexOf(bad) < 0, '수집 잡에 접속 자격증명이 들어 있다: ' + bad);
  }
  assert.match(code, /DATA_GO_KR_KEY/, '데이터 열쇠를 안 넘겨준다 — 부를 수가 없다');
});

test('cron 은 UTC 로 적혀 있다 (KST 로 적으면 하루가 어긋난다 — §2)', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/calendar-fetch.yml'), 'utf8');
  const m = y.match(/cron:\s*'([^']+)'/);
  assert.ok(m, 'schedule 이 없다');
  /* 1월 2일 00:10 KST = 12월 31일 15:10 UTC — 날짜가 «앞으로» 밀린 것이 맞다 */
  assert.strictEqual(m[1], '10 15 31 12 *',
    'cron 이 UTC 변환값과 다르다 (KST 로 적었는지 본다): ' + m[1]);
});
