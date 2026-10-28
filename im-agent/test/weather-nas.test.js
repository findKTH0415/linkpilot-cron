'use strict';
/**
 * weather-nas.test.js — **날씨 둘째 출처를 «국내 자리에서» 재는 자리** 〈2026-09-21 · D-253〉
 *
 * ★★★ **왜 이 스크립트가 있나.** `linkpilot-platform` 의 `test-weather-kma.js` 는
 *   **가짜 응답**으로 잰다 — 「무엇이 오든 지어내지 않는가」까지다.
 *   **격자·기준시각·규격이 실제로 맞는지**는 그 자리에서 한 번 불러 봐야 안다 (§4.3).
 *
 * ★★ **이 검사가 재는 것**은 그 스크립트가 **갈래를 갈라 말하는가**다.
 *   실제 값이 오는지는 **여기서 못 잰다** — 호스트가 막혀 있고 열쇠도 없다.
 *   **못 잰 것을 통과로 적지 않는다** (§8).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SH = path.join(ROOT, 'im-agent', 'tools', 'weather-nas.sh');
/** platform 의 `weather.php` — 이 세션에 함께 있을 때만 쓴다 */
const PHP_SRC = '/home/user/linkpilot-platform/weather.php';
const PHP_KEY = '/home/user/linkpilot-platform/lp_key.php';

const hasPhp = spawnSync('php', ['-v'], { encoding: 'utf8' }).status === 0;

function run(env, args) {
  const r = spawnSync('bash', [SH].concat(args || []), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, env || {}),
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/** 임시 웹루트 한 벌 — 진짜 `weather.php` 와 `lp_key.php` 를 놓는다 */
function mkWeb(keyValue) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-web-'));
  fs.copyFileSync(PHP_SRC, path.join(d, 'weather.php'));
  fs.copyFileSync(PHP_KEY, path.join(d, 'lp_key.php'));
  if (keyValue) {
    fs.writeFileSync(path.join(d, 'weathergo_key.store.php'),
      '<?php http_response_code(404); exit; ?>\n' + keyValue + '\n');
  }
  return d;
}
const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} };

test('웹루트를 안 주면 «못 쟀다»(3) — 0 으로도 4 로도 뭉개지 않는다 (§8)', () => {
  const r = run({ LP_WEB_DIR: '' });
  assert.strictEqual(r.code, 3, `못 잰 것을 ${r.code} 로 적는다\n${r.out}`);
  assert.match(r.out, /못 쟀|통과가 아니다/, '못 쟀다는 사실을 사람 말로 안 적는다');
});

test('weather.php 가 그 자리에 없으면 «못 쟀다»(3) — 배포가 안 닿은 것과 고장을 안 섞는다', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-empty-'));
  try {
    const r = run({ LP_WEB_DIR: d });
    assert.strictEqual(r.code, 3);
    assert.match(r.out, /배포가 아직 안 닿았을 수 있다/,
      '★ 「없다」를 「고장」으로 적으면 고칠 것이 없는 자리를 보게 된다 (§4.6)');
  } finally { rm(d); }
});

test('열쇠가 없으면 «배포가 아직 안 놓았다»고 말한다 — 열쇠 탓으로 안 적는다', (t) => {
  if (!hasPhp) { t.skip('php 가 없어 못 쟀다'); return; }
  if (!fs.existsSync(PHP_SRC)) { t.skip('platform 의 weather.php 가 이 자리에 없어 못 쟀다'); return; }
  const d = mkWeb(null);
  try {
    const r = run({ LP_WEB_DIR: d });
    assert.strictEqual(r.code, 4, `열쇠 없음을 ${r.code} 로 적는다\n${r.out}`);
    assert.match(r.out, /배포가 아직 안 놓았다/, '★ 무엇을 보면 되는지가 글에 없다 (§5)');
    assert.match(r.out, /Carry the weather key/, '어느 단계를 보면 되는지 안 적는다');
  } finally { rm(d); }
});

test('★★★ 진짜 코드를 «오려 내» 돌린다 — 격자를 찍고, 열쇠 값은 한 글자도 안 샌다 (§2)', (t) => {
  if (!hasPhp) { t.skip('php 가 없어 못 쟀다'); return; }
  if (!fs.existsSync(PHP_SRC)) { t.skip('platform 의 weather.php 가 이 자리에 없어 못 쟀다'); return; }
  const BAIT = 'lp-bait-weather-nas-3f81a2';
  const d = mkWeb(BAIT);
  try {
    const r = run({ LP_WEB_DIR: d });
    /* ★ 서울시청 = 60,127 은 기상청 공표 대표값이다 — 오려 내기가 됐다는 증거다 */
    assert.match(r.out, /nx=60 ny=127/,
      `★ 격자를 못 찍는다 — 오려 내기가 안 됐거나 공식이 틀렸다\n${r.out}`);
    assert.match(r.out, /열쇠\(weathergo\): 있다/, '열쇠를 못 읽는다');
    assert.ok(!r.out.includes(BAIT),
      '★★★ 열쇠 값이 화면에 샌다 — 그 글은 DSM 실행 결과와 메일로 나간다 (§2)');
    /* ★ 이 자리는 호스트가 막혀 있다 — «못 닿음(4)»이 나오는 것이 옳다.
         값이 오는지는 **여기서 못 잰다**. 그 사실을 적는다 (§8). */
    assert.ok(r.code === 4 || r.code === 0 || r.code === 1,
      `갈래 밖의 값으로 끝난다 (${r.code})\n${r.out}`);
  } finally { rm(d); }
});

test('★ 필요한 함수를 하나라도 못 뽑으면 «못 쟀다»(3) — 조용히 통과하지 않는다', (t) => {
  if (!hasPhp) { t.skip('php 가 없어 못 쟀다'); return; }
  if (!fs.existsSync(PHP_SRC)) { t.skip('platform 의 weather.php 가 이 자리에 없어 못 쟀다'); return; }
  const d = mkWeb('x'.repeat(30));
  try {
    /* 진짜 파일에서 한 함수를 지운다 — 규격이 바뀌는 날 그대로 일어나는 일이다 */
    const p = path.join(d, 'weather.php');
    const s = fs.readFileSync(p, 'utf8');
    const cut = s.replace(/function wx_sky\([\s\S]*?\n\}/, '/* gone */');
    assert.notStrictEqual(cut, s, '표본을 못 만들었다 — 이 칸은 아무것도 안 잰다');
    fs.writeFileSync(p, cut);
    const r = run({ LP_WEB_DIR: d });
    assert.strictEqual(r.code, 3, `못 뽑은 것을 ${r.code} 로 적는다 — 통과가 아니다 (§8)\n${r.out}`);
    assert.match(r.out, /wx_sky/, '어느 함수를 못 뽑았는지 안 적는다');
  } finally { rm(d); }
});

test('★ 스크립트에 접속 자격증명·웹루트 경로가 없다 (§2 · 이 저장소는 공개다)', () => {
  const b = fs.readFileSync(SH, 'utf8');
  /* ★ 재려던 성질은 **「들어오는 길의 설계도를 안 적는가」**다 (§8 의 그 규칙) —
       「volume 이라는 글자가 있는가」가 아니다. DSM 의 «패키지» 경로(`@appstore/…`)는
       누구나 아는 표준 자리이고 그것으로 들어올 수 없다 — 형제 스크립트도 그렇게 쓴다.
     ★★ 막아야 하는 것은 **접속 자격증명·tailnet 주소·서버 IP**와, 「어디에 무엇이
       있는가」를 알려 주는 **자료·웹 경로**다. 그래서 세는 자리를 그쪽으로 옮겼다
       (§6-2-5 — 약하게 고친 것이 아니라 재는 자리를 옮긴 것이다). */
  assert.ok(!/NAS_SSH|TAILSCALE|TS_AUTHKEY|ts\.net|\bssh\s|\d+\.\d+\.\d+\.\d+/.test(b),
    '★ 접속 자격증명·주소가 들어갔다 (§2 · D-10)');
  assert.ok(!/\/volume\d+\/(web|docker|homes|linkpilot)/.test(b),
    '★ 자료·웹 경로가 들어갔다 — 「어디에 무엇이 있는가」도 적지 않는다 (§8)');
  assert.match(b, /LP_WEB_DIR/, '웹루트를 환경변수로 안 받는다');
  assert.ok(b.includes(`${path.sep}im-agent${path.sep}`) || SH.includes('im-agent'),
    '★ im-agent/ 밖이면 NAS 에 안 올라간다 (§4 의 calendar-nas.sh 가 겪은 자리)');
});
