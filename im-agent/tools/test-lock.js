#!/usr/bin/env node
'use strict';
/**
 * test-lock.js — **시험을 두 벌 동시에 못 돌리게** 잠근다.
 *
 * ★★★ 왜 만들었나 〈2026-09-01 · 실측으로 당했다〉.
 *   `npm test` 가 시간초과로 배경에 넘어간 줄 모르고 다시 걸었다. 두 벌이 같이 돌면서
 *   **같은 시험 파일을 서로 건드려** 빨간 줄 다섯이 나왔다. 그 다섯을 원인이라 믿고
 *   한 바퀴를 돌았는데, 단독으로 돌려 보니 **실제 실패는 하나**였다.
 *
 *   ★ 없는 고장을 넷 만들어 낸 것이다. 이것이 특히 비싼 이유는 **빨간 줄이 거짓말을
 *     하면 그다음 판단이 전부 어긋나기** 때문이다 — 멀쩡한 코드를 고치러 간다.
 *
 * ★★ 잠금은 **막는 것이 목적이 아니라 말해 주는 것이 목적**이다. 이미 돌고 있으면
 *   그 사실과 **언제 시작했는지·무슨 명령인지**를 사람 말로 알려 준다.
 *   「이미 돌고 있습니다」만으로는 기다릴지 지울지 정할 수가 없다.
 *
 * ★ **죽은 잠금은 저절로 풀린다.** 시험이 중간에 죽으면 잠금 파일이 남는데, 그것이
 *   영영 막으면 잠금이 고장이 된다. 프로세스가 살아 있는지 실제로 보고(`kill 0`),
 *   없으면 조용히 걷어낸다.
 *
 * ★★★ **안 끝나는 시험을 잡는다** 〈2026-09-12 · 배포가 두 번 취소됐다〉.
 *   `api-timeout.test.js` 가 띄운 크로미움이 이벤트 루프를 붙잡고 SIGTERM 도 안 받았다.
 *   그래서 **검사는 3/3 초록인데 파일이 안 끝났고**, `npm test` 가 12분 제한에 걸려
 *   배포 잡이 통째로 잘렸다 (실행 193·194). 로그 끝은 매번
 *   `Terminate orphan process: (chrome)` 이었다.
 *
 *   ★ **이것이 특히 안 보이는 이유**는 통과/실패만 보면 **초록**이기 때문이다.
 *     「검사가 실패했다」와 「검사가 안 끝났다」는 다른 사실인데, 잡이 취소되면
 *     둘 다 그냥 빨간 X 하나로 보인다 (§8 「못 잰 것은 통과가 아니다」와 같은 결).
 *
 *   ★★ 그래서 **여기서 시간을 잰다.** 워크플로에 적지 않는 이유는 하나다 —
 *     거기 적으면 **내 자리에서 돌릴 때는 안 걸린다.** 같은 장치가 두 자리에
 *     필요한 것이 아니라, **한 자리에 있으면 양쪽 다 걸린다.**
 *
 *   재는 것은 둘이다:
 *   · **통째 제한** — 아무리 늦어도 이만큼이면 끝나야 한다 (기본 10분)
 *   · **말이 끊긴 시간** — 마지막 글자가 나온 뒤 이만큼 조용하면 매달린 것이다 (기본 3분)
 *   ★ 둘을 함께 재는 이유: 통째 제한만 두면 **정말 느린 날**과 구별이 안 되고,
 *     말 끊김만 두면 **천천히 계속 찍으며 영영 안 끝나는 것**을 못 잡는다.
 *
 * 쓰기:  node im-agent/tools/test-lock.js <돌릴 명령...>
 * 환경변수: `LP_TEST_BUDGET` 통째 제한(초) · `LP_TEST_IDLE` 말 끊김 제한(초) · 0 이면 끄기
 * 되돌아오는 값: 돌린 명령의 값 그대로 · 3 = 이미 돌고 있어 안 돌렸다 ·
 *                **124 = 안 끝나서 내가 끊었다**
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/** 환경변수에서 초 단위 제한을 읽는다. 0·음수·이상한 값이면 끈 것으로 본다 */
function budget(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const LOCK = path.join(os.tmpdir(), 'lp-npm-test.lock');

/** 잠금이 살아 있으면 그 내용, 죽었으면 걷어내고 null */
function held() {
  let raw;
  try { raw = fs.readFileSync(LOCK, 'utf8'); } catch (_) { return null; }
  let o;
  try { o = JSON.parse(raw); } catch (_) { fs.rmSync(LOCK, { force: true }); return null; }
  try {
    process.kill(o.pid, 0);            // 신호 0 = 죽이지 않고 살았는지만 묻는다
    return o;
  } catch (_) {
    fs.rmSync(LOCK, { force: true });  // ★ 죽은 잠금은 걷어낸다 — 안 그러면 영영 막힌다
    return null;
  }
}

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? s + '초' : Math.floor(s / 60) + '분 ' + (s % 60) + '초';
}

function main() {
  const cmd = process.argv.slice(2);
  if (!cmd.length) { console.error('돌릴 명령을 주십시오'); process.exit(2); }

  const cur = held();
  if (cur) {
    console.error('✕ 시험이 이미 돌고 있습니다 — 두 벌을 함께 돌리지 않습니다.');
    console.error(`  시작 ${ago(cur.at)} 전 (pid ${cur.pid}) · ${cur.cmd}`);
    console.error('');
    console.error('  ★ 왜 막습니까 — 두 벌이 같은 시험 파일을 서로 건드려 **없는 고장**을');
    console.error('    만듭니다. 2026-09-01 에 그렇게 빨간 줄 다섯을 봤는데 실제 실패는 하나였습니다.');
    console.error('  · 기다리시면 됩니다. 정말 지우려면: rm ' + LOCK);
    process.exit(3);
  }

  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), cmd: cmd.join(' ') }));
  /* ★ 무슨 일이 있어도 푼다 — 실패·예외·Ctrl-C 전부. 안 풀면 다음 사람이 막힌다 */
  const off = () => { try { fs.rmSync(LOCK, { force: true }); } catch (_) {} };
  process.on('exit', off);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { off(); process.exit(130); });

  /* ★ 아이를 «무리»로 띄운다 — 아이가 또 띄운 것(크로미움)까지 함께 끊기 위해서다.
       하나만 끊으면 손자가 남아 러너가 「orphan process」로 치운다 */
  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
    detached: true,
  });

  const TOTAL = budget('LP_TEST_BUDGET', 600);
  const IDLE = budget('LP_TEST_IDLE', 180);
  const began = Date.now();
  let spoke = Date.now();
  let tail = '';                      /* 마지막에 무슨 말을 했는지 보여 주려고 꼬리만 들고 있는다 */
  let cut = null;                     /* 내가 끊었으면 그 사유 */

  const relay = (src, dst) => src.on('data', (b) => {
    spoke = Date.now();
    tail = (tail + b.toString()).slice(-4000);
    dst.write(b);
  });
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);

  /** 무리째 끊는다. 무리가 이미 없으면 아이 하나라도 끊는다 */
  const killAll = () => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
  };

  const watch = (TOTAL || IDLE) ? setInterval(() => {
    const ranFor = Math.round((Date.now() - began) / 1000);
    const quietFor = Math.round((Date.now() - spoke) / 1000);
    if (TOTAL && ranFor >= TOTAL) cut = { why: 'total', ranFor, quietFor };
    else if (IDLE && quietFor >= IDLE) cut = { why: 'idle', ranFor, quietFor };
    if (cut) { clearInterval(watch); killAll(); }
  }, 1000) : null;
  if (watch && watch.unref) watch.unref();

  child.on('close', (code, signal) => {
    if (watch) clearInterval(watch);
    off();
    if (!cut) { process.exit(code === null ? (signal ? 1 : 0) : code); return; }

    /* ★★★ 「실패했다」가 아니라 「안 끝났다」라고 적는다 — 고칠 곳이 다르다 */
    console.error('');
    console.error('════════ 시험이 «끝나지 않아» 내가 끊었습니다 ════════');
    console.error(cut.why === 'total'
      ? `  통째 제한 ${TOTAL}초를 넘겼습니다 (${cut.ranFor}초 돌았고, 마지막 말은 ${cut.quietFor}초 전).`
      : `  마지막 글자가 나온 뒤 ${cut.quietFor}초 동안 조용했습니다 (${cut.ranFor}초 돌았습니다).`);
    console.error('');
    console.error('  ★ 이것은 **실패와 다른 사실입니다.** 검사가 전부 초록이어도 이렇게 됩니다 —');
    console.error('    2026-09-12 에 그랬습니다: 3/3 통과인데 띄운 크로미움이 이벤트 루프를');
    console.error('    붙잡아 파일이 안 끝났고, 배포 잡이 12분 제한에 걸려 통째로 취소됐습니다.');
    console.error('  ★ 찾을 곳: **마지막에 말한 검사 파일**입니다. `spawn` 한 아이를 안 끊었거나,');
    console.error('    `unref()` 를 안 했거나, 열어 둔 서버·소켓을 안 닫았을 자리입니다.');
    console.error('');
    console.error('──────── 끊기 직전에 나온 말 ────────');
    console.error(tail.split('\n').slice(-25).join('\n'));
    process.exit(124);
  });
}

if (require.main === module) main();
module.exports = { LOCK, held };
