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
 * 쓰기:  node im-agent/tools/test-lock.js <돌릴 명령...>
 * 되돌아오는 값: 돌린 명령의 값 그대로 · 3 = 이미 돌고 있어 안 돌렸다
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: false });
  off();
  process.exit(r.status === null ? 1 : r.status);
}

if (require.main === module) main();
module.exports = { LOCK, held };
