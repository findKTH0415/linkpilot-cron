'use strict';
/**
 * guard.js — **배포·전달 전 교차검증을 한 번에 돈다** 〈2026-08-24 사장님:
 * 「다시 재교차검증하고 다시는 오류가 발생되지 않도록 기록하고 개선해줘」〉.
 *
 *   npm run guard
 *
 * ★★★ 왜 만들었나. CLAUDE.md §8 이 넷을 요구한다 — 테스트 · 지문 · 미리보기
 *   재생성 · 헤드리스 렌더. 그런데 **넷을 손으로 챙기고 있었다.** 그래서
 *   2026-08-23~24 에 실제로 이렇게 빠졌다:
 *
 *     · 미리보기 재생성을 잊어 `section-preview.html` 이 소스와 갈렸다 (세 번)
 *     · 지문 다시 찍기를 잊어 짝 확인이 빨개졌다 (두 번)
 *     · 헤드리스 렌더를 안 해서 **흰 화면**을 사장님이 먼저 보셨다
 *
 *   ★ 셋 다 「할 줄 몰라서」가 아니라 **「빠뜨려서」**다. 사람이 넷을 기억하는
 *     것으로는 안 된다 — 한 줄로 만들어야 안 빠진다.
 *
 * ★★ **못 잰 것을 통과로 세지 않는다** (M-11 · M-12 · M-30). 크로미움이 없는
 *   서버가 실제로 있다. 그때는 「못 쟀다」로 적고 **초록으로 끝내지 않는다** —
 *   재지 못한 것과 통과한 것은 다른 사실이다.
 *
 * ★★ **넷으로 끝나지 않는다.** §8 이 요구한 넷이 바닥이고, 같은 결로 두 번
 *   당한 것은 여기 한 칸으로 들어온다. 2026-08-25 에 [저장] 막대 자리가
 *   그렇게 들어왔다 — 글자 대조로는 못 잡고 **좌표로만** 잡히는 결이었다.
 *
 * ★ 되돌아오는 값: 0 전부 통과 · 1 실패 있음 · 2 못 잰 것이 있음
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const P = path.join(__dirname, '..', 'ui', 'platform');

const rows = [];
const add = (name, state, note) => rows.push({ name, state, note: note || '' });

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/* ── ① 테스트 전부 ─────────────────────────────────────── */
function tests() {
  try {
    const out = sh('npm test 2>&1 | tail -20');
    const pass = (out.match(/# pass (\d+)/) || [])[1];
    const fail = (out.match(/# fail (\d+)/) || [])[1];
    const skip = (out.match(/# skipped (\d+)/) || [])[1];
    if (fail === undefined) { add('테스트', 'unknown', '결과를 못 읽었다'); return; }
    add('테스트', Number(fail) === 0 ? 'ok' : 'fail',
      `${pass} 통과 · ${skip} skip · ${fail} 실패`);
  } catch (e) {
    const out = String((e.stdout || '') + (e.stderr || ''));
    const fail = (out.match(/# fail (\d+)/) || [])[1];
    add('테스트', 'fail', fail ? `${fail} 실패` : '돌다가 죽었다');
  }
}

/* ── ② 화면 지문 ───────────────────────────────────────── */
function stamp() {
  try {
    const out = sh('npm run --silent im:stamp -- --check 2>&1');
    add('화면 지문', /모두 최신/.test(out) ? 'ok' : 'fail', out.trim().split('\n').pop());
  } catch (e) {
    add('화면 지문', 'fail', '어긋났다 — `npm run im:stamp` 로 다시 찍는다');
  }
}

/* ── ③ 미리보기가 소스와 같은가 ────────────────────────── */
/**
 * ★ **다시 만들어 보고 달라지는지** 본다. 「만들 수 있다」가 아니라
 *   「커밋된 것이 지금 소스에서 나오는 것과 같다」를 재는 것이다.
 */
function previews() {
  const targets = ['im:section', 'im:static', 'im:artifact', 'im:platform'];
  const made = [
    'section-preview.html', 'section-static.html', 'section-artifact.html',
    'linkpilot-platform.html',
  ];
  /* ★★ **git 을 안 본다** 〈2026-08-24 · 첫 판이 헛울음을 냈다〉.
   *   `git status` 로 재면 **아직 커밋 안 한 작업**까지 「갈렸다」로 잡는다 —
   *   고칠 것이 없는데 빨갛게 끝난다. 재려는 것은 그것이 아니라
   *   **「다시 만들었을 때 달라지는가」**다. 그래서 만들기 전후의 지문을 댄다. */
  const crypto = require('crypto');
  const sha = (f) => {
    try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(P, f))).digest('hex'); }
    catch (_) { return null; }
  };
  const before = {};
  made.forEach((f) => { before[f] = sha(f); });

  try {
    targets.forEach((t) => sh(`npm run --silent ${t} >/dev/null 2>&1`));
  } catch (_) {
    add('미리보기 재생성', 'fail', '다시 만들다가 죽었다');
    return;
  }

  const changed = made.filter((f) => sha(f) !== before[f]);
  const missing = made.filter((f) => sha(f) === null);
  if (missing.length) {
    add('미리보기 재생성', 'fail', `안 만들어진 것이 있다: ${missing.join(' · ')}`);
    return;
  }
  if (changed.length) {
    add('미리보기 재생성', 'fail',
      `**소스와 갈려 있었다** — 다시 만드니 달라졌다: ${changed.join(' · ')} (이대로 커밋한다)`);
    return;
  }
  add('미리보기 재생성', 'ok', `${made.length}개가 소스와 같다`);
}

/* ── ④ 헤드리스로 실제 렌더 ────────────────────────────── */
/**
 * ★★ 화면이 **실제로 그려지는지** 본다. DOM 이 비었는데 오류가 안 뜨는 경우가
 *   있다 — 그때 사람이 먼저 흰 화면을 본다 (2026-08-24 에 실제로 그랬다).
 * ★ 빈 화면뿐 아니라 **헛울음**도 잡는다: 멀쩡한 화면에 고장 딱지가 붙으면
 *   진짜 고장이 안 보이게 된다.
 */
function render() {
  let findBrowser, renderDom;
  try { ({ findBrowser, renderDom } = require(path.join(P, 'build-static.js'))); }
  catch (_) { add('헤드리스 렌더', 'unknown', '빌더를 못 불렀다'); return; }

  const b = findBrowser();
  if (!b) { add('헤드리스 렌더', 'unknown', '크로미움이 없다 — **못 쟀다**'); return; }

  const { required } = require(path.join(P, 'build-embed.js'));
  const pages = required().filter((f) => f.endsWith('.html'));
  const thin = [];
  const crying = [];
  pages.forEach((f) => {
    let dom = '';
    try { dom = renderDom(b, path.join(P, f), 30000, 430) || ''; }
    catch (e) { thin.push(`${f}(렌더 실패)`); return; }
    const body = (dom.match(/<body[\s\S]*<\/body>/) || [''])[0]
      .replace(/<script[\s\S]*?<\/script>/g, '');
    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 80) thin.push(`${f}(${text.length}자)`);
    if (/화면에 필요한 파일을 못 받았습니다|화면을 그리다 멈췄습니다/.test(body)) crying.push(f);
  });

  if (thin.length) { add('헤드리스 렌더', 'fail', `거의 빈 화면: ${thin.join(' · ')}`); return; }
  if (crying.length) {
    add('헤드리스 렌더', 'fail', `멀쩡한 화면에 고장 딱지가 붙었다: ${crying.join(' · ')}`);
    return;
  }
  add('헤드리스 렌더', 'ok', `화면 ${pages.length}개 전부 그려진다`);
}

/* ── ⑤ [저장] 막대가 제자리에 서는가 ───────────────────── */
/**
 * ★★★ **좌표로 잰다** 〈2026-08-25 사장님 화면: 「[저장] 배치가 너무 아래
 *   동떨어져 배치됨」〉.
 *
 *   글자 대조로는 못 잡는 결이다 — `position: fixed` 는 어느 쪽에서도 똑같이
 *   생겼고, **틀(iframe) 안에서만** 자리가 틀린다. 재 보니 막대 아래로
 *   1946px 이 더 있었다. 그래서 진짜 틀에 넣고 그려서 잰다.
 */
function saveBar() {
  let out = '';
  let code = 0;
  try {
    out = sh('node im-agent/tools/probe-save-bar.js 2>&1');
  } catch (e) {
    out = String((e.stdout || '') + (e.stderr || ''));
    code = e.status === undefined ? 1 : e.status;
  }
  const line = out.trim().split('\n').pop().replace(/^\[저장\] 막대 자리: /, '');
  add('[저장] 막대 자리', code === 0 ? 'ok' : (code === 2 ? 'unknown' : 'fail'), line || '결과를 못 읽었다');
}

/* ── ⑥ [열기]로 연 것이 실제로 읽히는가 ────────────────── */
/**
 * ★★★ **§8 은 「헤드리스로 실제 렌더를 확인한다」인데 파일 여는 길에는 그 검사가
 *   없었다** 〈2026-08-25 · M-35〉. 그래서 내가 고친 자리에서 IM 본문이 통째로
 *   깨져 나갔고, 사장님은 **엔진이 잘못 만든 줄로** 읽으셨다.
 * ★ 소스 대조로는 못 잡는다 — 딱지가 무엇으로 붙는지는 **돌려 봐야** 안다.
 */
function openFile() {
  let out = '';
  let code = 0;
  try {
    out = sh('node im-agent/tools/probe-open-file.js 2>&1');
  } catch (e) {
    out = String((e.stdout || '') + (e.stderr || ''));
    code = e.status === undefined ? 1 : e.status;
  }
  const line = out.trim().split('\n').pop().replace(/^\[열기\] 열어서 읽히는가: /, '');
  add('[열기] 읽히는가', code === 0 ? 'ok' : (code === 2 ? 'unknown' : 'fail'), line || '결과를 못 읽었다');
}

/* ── ⑦ Agent 배선이 다섯 곳에 다 있는가 ────────────────── */
/**
 * ★★ **`npm test` 안에서도 돌지만 여기 한 줄로 세운다** 〈2026-08-25 사장님 지시〉.
 *   막고는 있었는데 **표에 안 보여서** 사람이 「배선은 봤나?」를 따로 떠올려야
 *   했다. 규칙을 기억에 얹지 않는 것이 이 도구의 존재 이유다 (M-31).
 */
function agents() {
  let out = '';
  let code = 0;
  try {
    out = sh('npm run --silent agent:check 2>&1');
  } catch (e) {
    out = String((e.stdout || '') + (e.stderr || ''));
    code = e.status === undefined ? 1 : e.status;
  }
  const n = (out.match(/Agent (\d+)개 · 진행률 비중 합계 (\d+)/) || []);
  if (!n.length) { add('Agent 배선', 'unknown', '결과를 못 읽었다'); return; }
  const bad = (out.match(/❌ /g) || []).length;
  add('Agent 배선', code === 0 && !bad ? 'ok' : 'fail',
    code === 0 && !bad ? `${n[1]}개 전부 다섯 곳에 있다 · 비중 합계 ${n[2]}`
      : `${bad}곳이 빠졌다 — **오류는 안 나지만 조용히 안 돈다**`);
}

/* ── ⑧ 다른 갈래와 같은 파일을 건드리고 있는가 ─────────── */
/**
 * ★★★ **D-101 이 난 자리다** 〈2026-08-25〉. 두 작업선이 같은 갈림점에서 나와
 *   **같은 이름의 Agent 를 각자** 만들었고 같은 파일을 쓰고 있었다. 파일 이름이
 *   같으니 병합은 「한쪽을 고르는 것」으로 끝나고, **진 쪽 설계는 오류 하나 없이
 *   사라진다.** 그때는 사장님이 남의 문서를 넘겨 주셔서 알았다 — 안 넘겨
 *   주셨으면 병합하는 날에야 알았을 것이다.
 * ★ 원격을 못 보면 **「못 쟀다」**로 적는다. 없는 것과 다른 사실이다.
 */
function branches() {
  let out = '';
  let code = 0;
  try {
    out = sh('node im-agent/tools/branch-doctor.js 2>&1');
  } catch (e) {
    out = String((e.stdout || '') + (e.stderr || ''));
    code = e.status === undefined ? 1 : e.status;
  }
  const line = out.trim().split('\n').pop().replace(/^겹치는 파일: /, '');
  add('다른 갈래와 겹침', code === 0 ? 'ok' : (code === 2 ? 'unknown' : 'fail'),
    line || '결과를 못 읽었다');
}

/* ── 내보내기 ──────────────────────────────────────────── */

function main() {
  tests(); stamp(); previews(); render(); saveBar(); openFile(); agents(); branches();

  const mark = { ok: '✅', fail: '❌', unknown: '⚠️ ' };
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));
  process.stdout.write('\n배포·전달 전 교차검증 (CLAUDE.md §8)\n\n');
  rows.forEach((r) => {
    process.stdout.write(`  ${mark[r.state]} ${pad(r.name, 16)} ${r.note}\n`);
  });

  const bad = rows.filter((r) => r.state === 'fail').length;
  const unk = rows.filter((r) => r.state === 'unknown').length;
  process.stdout.write(`\n  통과 ${rows.length - bad - unk} · 실패 ${bad} · 못 잼 ${unk}`
    + '  ← 못 잰 것은 통과가 아니다\n\n');

  if (bad) {
    process.stdout.write('❌ **내보내지 않는다.** 위 실패를 먼저 고친다.\n');
    return 1;
  }
  if (unk) {
    process.stdout.write('⚠️  못 잰 것이 있다. 내보낼 때 **무엇을 못 쟀는지 말한다** (§8).\n');
    return 2;
  }
  process.stdout.write(`✅ ${rows.length} 가지 다 통과 — 내보내도 된다.\n`);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { tests, stamp, previews, render, saveBar, openFile, agents, branches, rows };
