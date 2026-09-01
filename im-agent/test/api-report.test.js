/**
 * api-report.test.js — 실측 진단 요약이 **열쇠를 안 흘리는가**, 그리고 사람이 읽을 수 있는가.
 *
 * ★★★ 이 검사의 급소는 셋째 갈래다. 이 저장소는 **공개**이고(D-10), 요약 파일은
 *   **커밋된다.** 진단 원문에 열쇠가 한 번이라도 섞이면 이력에 영구히 남는다
 *   (지침서 §10). 그래서 「섞였으면 **파일을 안 쓴다**」를 글자가 아니라
 *   **실제로 돌려서** 잰다 — 파일이 정말 안 생겼는지 디스크를 본다.
 *
 * ★ 그리고 반대도 잰다: 열쇠가 없을 때 **괜히 막지 않는가.** 늘 막는 장치는
 *   막는 장치가 아니라 고장이다.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TOOL = path.join(__dirname, '..', 'tools', 'api-report.js');
const R = require(TOOL);

const SMOKE = [
  '공공데이터 실측 진단',
  '',
  '● VWorld 지오코딩',
  '  주소 → 좌표 변환 성공 (127.0276, 37.4979)',
  '',
  '✕ 건축물대장',
  '  SERVICE_KEY_IS_NOT_REGISTERED_ERROR (30)',
  '',
  '✕ 한국은행 ECOS',
  '  미설정 — 키가 없다',
  '',
  '✕ 한국거래소',
  '  HTTP 401 승인 대기',
  '',
].join('\n');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'api-report-'));
function run(text, env = {}) {
  const dir = tmp();
  const src = path.join(dir, 'smoke.txt');
  fs.writeFileSync(src, text);
  const out = path.join(dir, 'out');
  let code = 0, stderr = '';
  try {
    execFileSync(process.execPath, [TOOL, src, '--out', out],
      { env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { code = e.status; stderr = String(e.stderr || ''); }
  const md = path.join(out, '_summary.md');
  return { code, stderr, exists: fs.existsSync(md), md: fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '' };
}

test('1. 진단 줄을 읽어 살아 있음/실패를 가른다', () => {
  const items = R.parse(SMOKE);
  assert.strictEqual(items.length, 4, '항목 넷을 읽어야 한다');
  assert.strictEqual(items.filter((x) => x.ok).length, 1);
  assert.strictEqual(items[0].name, 'VWorld 지오코딩');
  assert.ok(items[1].detail.includes('SERVICE_KEY_IS_NOT_REGISTERED'), '설명 줄을 함께 들고 와야 원인을 가른다');
});

test('2. 실패 원인을 지침서 §4.2 대로 갈라 적는다', () => {
  assert.strictEqual(R.classify('SERVICE_KEY_IS_NOT_REGISTERED_ERROR (30)').label, '활용신청 안 됨');
  assert.strictEqual(R.classify('NO_OPENAPI_SERVICE_ERROR').label, '엔드포인트 없음');
  assert.strictEqual(R.classify('미설정 — 키가 없다').label, '키 없음');
  assert.strictEqual(R.classify('HTTP 401 승인 대기').label, '승인 대기');
  /* ★ 「키 없음」과 「활용신청 안 됨」은 **상태코드만 보면 같아 보인다**.
     가르지 못하면 사장님이 멀쩡한 키를 다시 발급하러 가신다 (지침서 §4.2) */
  assert.notStrictEqual(R.classify('미설정').label, R.classify('활용신청이 필요한 API').label);
});

test('3. ★ 열쇠가 섞이면 파일을 아예 안 쓴다 (공개 저장소 · §2 · D-10)', () => {
  const KEY = 'AIzaSyD-EXAMPLE-NOT-A-REAL-KEY-000000';
  const r = run(SMOKE + '\n  요청 URL: https://x/api?serviceKey=' + KEY + '\n', { DATA_GO_KR_KEY: KEY });
  assert.strictEqual(r.code, 1, '열쇠가 섞였으면 빨갛게 끝나야 한다');
  assert.strictEqual(r.exists, false, '★ 파일이 생기면 안 된다 — 커밋되면 이력에 영구히 남는다');
  assert.ok(r.stderr.includes('DATA_GO_KR_KEY'), '어느 환경변수가 걸렸는지 **이름**을 대야 한다');
  assert.ok(!r.stderr.includes(KEY), '★★ 잡았다고 말하면서 값을 찍으면 잡은 뜻이 없다');
});

test('4. 열쇠가 안 섞였으면 괜히 막지 않는다', () => {
  const r = run(SMOKE, { DATA_GO_KR_KEY: 'AIzaSyD-EXAMPLE-NOT-A-REAL-KEY-000000' });
  assert.strictEqual(r.code, 0, '늘 막는 장치는 막는 장치가 아니라 고장이다');
  assert.ok(r.exists, '요약 파일이 생겨야 한다');
});

test('5. 요약이 열쇠 값을 담지 않고 이름·들어옴만 적는다', () => {
  const KEY = 'ZZTOP-EXAMPLE-VALUE-0123456789';
  const r = run(SMOKE, { REB_API_KEY: KEY });
  assert.ok(r.exists && r.code === 0);
  assert.ok(!r.md.includes(KEY), '요약에 열쇠 값이 있으면 안 된다');
  assert.ok(r.md.includes('`REB_API_KEY`'), '이름은 적어야 어느 것이 들어왔는지 안다');
  assert.ok(/REB_API_KEY[^|]*\|[^|]*\|[^|]*\|[^|]*✅/.test(r.md.replace(/\n/g, ' ')),
    '들어온 열쇠는 ✅ 로 표시해야 한다');
});

test('6. 이름이 둘인 열쇠는 **어느 이름으로 들어왔는지** 말한다 (ECOS·LAW)', () => {
  const r = run(SMOKE, { ECOS_API_KEY: '', ECOS_BOK_KEY: 'BOK-EXAMPLE-VALUE-0123456789' });
  assert.ok(r.md.includes('`ECOS_BOK_KEY`'), '실제로 들어온 이름을 대야 한다');
  /* 2026-08-26 사고: 안내 문서와 넣으신 이름이 달라 값이 조용히 죽었다.
     어느 이름으로 들어왔는지 화면이 말해 주면 그 자리에서 갈린다 */
});

test('7. 진단이 한 항목도 못 돌았으면 그렇게 말한다 (빈 표를 초록으로 그리지 않는다)', () => {
  const r = run('✕ 진단 중단: 뭔가 터졌다\n');
  assert.ok(r.exists && r.code === 0);
  assert.ok(r.md.includes('한 항목도 못 돌았습니다'), '못 잰 것을 통과로 그리면 안 된다 (§8)');
});

test('8. 읽을 진단 출력이 없으면 2 로 끝난다 (0 으로 끝나면 「돌았다」로 읽힌다)', () => {
  let code = 0;
  try { execFileSync(process.execPath, [TOOL, '/tmp/없는파일-' + Date.now()], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  assert.strictEqual(code, 2);
});

test('9. 워크플로가 지침서 표의 열쇠를 전부 넘긴다', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'api-smoke.yml'), 'utf8');
  const passed = new Set([...wf.matchAll(/^\s+([A-Z][A-Z0-9_]+):\s+\$\{\{\s*secrets\./gm)].map((m) => m[1]));
  const missing = R.KEYS.flatMap(([n]) => n.split('|')).filter((n) => !passed.has(n));
  assert.deepStrictEqual(missing, [],
    '요약 표에는 있는데 워크플로가 안 넘기는 열쇠입니다 — 늘 「없음」으로 나옵니다: ' + missing.join(', '));
});

test('10. 워크플로 시각이 UTC 로 적혀 있다 (KST/UTC 는 이 저장소 1순위 사고 · §2)', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'api-smoke.yml'), 'utf8');
  const m = wf.match(/cron:\s*'([^']+)'/);
  assert.ok(m, 'schedule 이 없습니다');
  assert.ok(/UTC/.test(wf), 'cron 옆에 UTC 기준임을 적어야 한다');
  const hour = Number(m[1].split(/\s+/)[1]);
  assert.ok(hour >= 0 && hour <= 23 && hour !== 6,
    'UTC 21시가 06:00 KST 다 — 6 을 그대로 쓰면 오후 3시에 돈다');
});
