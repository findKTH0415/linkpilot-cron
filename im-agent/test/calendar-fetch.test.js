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

test('★★★ 「못 닿은 것」을 「승인 안 된 것」으로 말하지 않는다', () => {
  /* [사고 2026-09-12 · 실측] 첫 실행에서 5년 × 4갈래 **스무 칸 전부**가
     「판정하지 못했다 (HTTP undefined)」로 나왔다. 상태코드가 없다는 것은
     **응답이 아예 안 온 것**인데, 그 글은 「승인이 안 됐나」로 읽힌다 —
     사장님이 **이미 하신 활용신청을 또 하시게 된다.**
     ★ 실제 원인은 자리였다: 같은 날 진단에서 data.go.kr 계열이 전부 `fetch failed` 였고
       한국은행·부동산원은 살아 있었다. 열쇠가 있는 자리가 곧 «닿는 자리»는 아니다. */
  const unreachable = kasi.diagnose(undefined, undefined, 'fetch failed (4회 시도 실패)');
  assert.strictEqual(unreachable.kind, 'unreachable', '응답이 없는 것을 따로 갈라야 한다');
  assert.match(unreachable.head, /못 닿았다/, '무엇이 일어난 것인지 말하지 않는다');
  assert.match(unreachable.head, /fetch failed/, '실제 이유를 그대로 옮기지 않는다');
  assert.doesNotMatch(unreachable.head, /HTTP undefined/, '「HTTP undefined」를 사람에게 보이면 안 된다');
  /* ★ 승인 문제와 «다른 판정»이어야 한다 — 섞이면 갈라 둔 뜻이 없다 */
  const approval2 = kasi.diagnose(200, 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
  assert.notStrictEqual(unreachable.kind, approval2.kind);
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

/* ── 국내 자리(NAS) 수집 ─────────────────────────────────────────── */

test('★★★ 도는 자리가 있다 — `deploy/calendar-nas.sh` (Actions 에서는 못 닿는다 · D-206)', () => {
  /* ★ 왜 이 칸이 있나. 앞 판은 「NAS 에서 돈다」를 **규칙으로만** 적어 두었다.
     그러면 그 규칙이 사람의 기억에 얹힌다 — 부를 것이 실제로 없어도 아무 오류가 안 난다
     (M-31 과 같은 결). 그래서 **부를 것이 있는지**를 잰다. */
  const sh = path.join(ROOT, 'deploy', 'calendar-nas.sh');
  assert.ok(fs.existsSync(sh), 'deploy/calendar-nas.sh 가 없습니다 — 「NAS 에서 돈다」를 적어 두고 부를 것이 없습니다');
  const code = fs.readFileSync(sh, 'utf8');

  /* ① 수집을 실제로 부르는가 — 규칙만 적고 안 부르는 상태가 가장 잡기 어렵다 */
  assert.match(code, /calendar-fetch\.js/,
    'calendar-nas.sh 가 수집 도구를 안 부릅니다 — 껍데기입니다');

  /* ② 「돌았다」와 「채워졌다」를 갈라 세는가 (§8 「걸었다 ≠ 닿았다」) */
  assert.match(code, /exit 4/, '받은 해가 0 개일 때 빨갛게 끝나는 길이 없습니다');
  assert.match(code, /exit 5/, '앱이 읽을 자리로 못 옮긴 것을 따로 가르는 길이 없습니다');

  /* ③ ★★ 접속 자격증명도 데이터 열쇠도 없는가 (규정집 2-8 · §2) */
  const noComment = code.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const bad of ['ssh ', 'scp ', 'id_deploy', 'DATA_GO_KR_KEY=', 'PRIVATE KEY']) {
    assert.ok(noComment.indexOf(bad) < 0,
      'calendar-nas.sh 에 「' + bad.trim() + '」 가 있습니다 — 수집이 도는 자리에는 자격증명을 두지 않습니다');
  }

  /* ④ npm 으로도 같은 것이 도는가 — 손으로 경로를 치게 만들지 않는다 */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(String(pkg.scripts['calendar:nas'] || '').includes('calendar-nas.sh'),
    'package.json 에 calendar:nas 가 없습니다');
});

test('★★ Actions 워크플로가 「여기서는 못 돈다」를 적어 두었다 (지운 것과 다른 사실이다)', () => {
  /* ★★★ 이것이 없으면 다음 사람이 그 단추를 눌러 보고 실패를 **승인 문제로 읽는다** —
     실제로 그랬고, 그 글이 이미 하신 활용신청을 또 하시게 만들었다. */
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'calendar-fetch.yml'), 'utf8');
  const head = wf.slice(0, wf.indexOf('\non:\n'));
  assert.match(head, /calendar-nas\.sh/,
    '워크플로 머리가 진짜 도는 자리를 안 가리킵니다 — 눌러 본 사람이 어디로 가야 할지 모릅니다');
  assert.match(head, /못 닿음/,
    '워크플로 머리에 「못 닿음」과 「승인 안 됨」을 가르는 말이 없습니다');
});
