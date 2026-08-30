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
  const rot = [];
  pages.forEach((f) => {
    let dom = '';
    try { dom = renderDom(b, path.join(P, f), 30000, 430) || ''; }
    catch (e) { thin.push(`${f}(렌더 실패)`); return; }
    const body = (dom.match(/<body[\s\S]*<\/body>/) || [''])[0]
      .replace(/<script[\s\S]*?<\/script>/g, '');
    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 80) thin.push(`${f}(${text.length}자)`);
    if (/화면에 필요한 파일을 못 받았습니다|화면을 그리다 멈췄습니다/.test(body)) crying.push(f);
    /* ★★★ **그럴듯하게 고장난 글자** 〈2026-08-27 · 사장님 화면에서 실제로 나왔다:
     *   「선정릉 → [object Object]」〉.
     *
     *   이 셋은 오류를 안 낸다 — 화면은 멀쩡히 뜨고 **글자만 틀린다.** 그래서
     *   렌더가 성공했는지만 보면 통과한다. 사람이 읽는 자리에 나오면
     *   「값이 없다」가 아니라 **「값을 문장에 넣는 코드가 틀렸다」**는 뜻이다.
     *   ★ 낱말 경계로 본다 — `undefined` 가 다른 낱말 안에 들어간 것은 아니다. */
    const junk = text.match(/\[object [A-Z]\w+\]|\bundefined\b|\bNaN\b/);
    if (junk) rot.push(`${f}(${junk[0]})`);
  });

  if (rot.length) {
    add('헤드리스 렌더', 'fail',
      `화면에 **그럴듯하게 고장난 글자**가 그려졌다: ${rot.join(' · ')} — 오류는 안 나고 글자만 틀린다`);
    return;
  }

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
  /* ★★ **마지막 줄이 판정 줄이 아니다** 〈2026-08-26 · 실측〉.
   *   겹침이 있으면 `branch-doctor` 가 판정 줄 뒤에 **왜 위험한지**를 한 문단
   *   더 적는다. 그냥 마지막 줄을 집으면 화면에 「진 쪽 설계는 오류 하나 없이
   *   사라진다」만 뜨고 **어느 파일이 겹쳤는지가 사라진다.**
   * ★ 그래서 **판정 줄을 이름으로 찾는다.** 못 찾으면 마지막 줄로 내려간다. */
  const lines = out.trim().split('\n').filter(Boolean);
  const verdictLine = [...lines].reverse().find((l) => /^(겹치는 파일|살아 있는 갈래|견줄|못 |못읽)/.test(l.trim()));
  const line = (verdictLine || lines[lines.length - 1] || '').trim().replace(/^겹치는 파일: /, '');
  add('다른 갈래와 겹침', code === 0 ? 'ok' : (code === 2 ? 'unknown' : 'fail'),
    line || '결과를 못 읽었다');
}

/* ── ⑨ 보고서 화면 사본이 옛 판인가 ────────────────────── */
/**
 * ★★★ **D-120 이 정한 경계에서 나온 칸이다** 〈2026-08-26 사장님 결정〉.
 *   `linkpilot-platform` 은 유저 접촉, `linkpilot-cron` 은 보고서 요청·생산.
 *   그래서 보고서 화면 16개는 **이쪽이 본체**이고 저쪽 `im-flow/` 는 **사본**이다.
 *
 * ★★ **어긋나는 것이 예외가 아니라 기본값이다.** 화면마다 판 지문이 박혀 있어
 *   이쪽이 한 번만 바뀌어도 16개 전부에 새 지문이 찍힌다. 실측에서 하루 만에
 *   15개가 어긋났다. 그러니 「가끔 확인」으로는 못 잡는다.
 *
 * ★ 여기서 재는 것은 **「보냈다고 적은 기록이 지금 화면과 같은가」**다.
 *   저쪽에 실제로 닿았는지는 이 저장소에서 잴 수 없다 — 그것까지 안다고
 *   적으면 「닿았다」와 「적었다」가 섞인다 (M-25 와 같은 결).
 */
function imflow() {
  let out = '';
  let code = 0;
  try {
    out = sh('node im-agent/tools/sync-im-flow.js 2>&1');
  } catch (e) {
    out = String((e.stdout || '') + (e.stderr || ''));
    code = e.status === undefined ? 1 : e.status;
  }
  const line = out.trim().split('\n').filter(Boolean).pop().replace(/^\s*[●✕]\s*/, '');
  add('보고서 화면 사본', code === 0 ? 'ok' : (code === 2 ? 'unknown' : 'fail'),
    line || '결과를 못 읽었다');
}

/* ── ⑩ 문서가 요청한 활자로 그려지는가 ──────────────────── */
/**
 * ★★★ **재는 장치는 있었는데 아무도 안 봤다** 〈2026-08-26 · 인수인계 감사에서 드러났다〉.
 *
 *   `core/fonts.js` 가 「요청한 글꼴이 실제로 쓰이는가」를 fontconfig 에게
 *   직접 물어 본다 — 이미 정확하다. 그런데 그 답이 **경고 한 줄로 흘러갔다.**
 *   `im:demo` 로그 한가운데에 ⚠ 로 찍히고 그대로 지나간다.
 *
 *   그래서 감사에서 **PDF 24쪽이 중국어 글꼴로 그려진 채** 「9/9 통과」로
 *   보고될 뻔했다. 교차검증이 초록인데 산출물의 활자가 다른 상태다 —
 *   M-25 가 막으려던 「고쳤다고 말하는데 다른 것을 보고 있는」 꼴과 같다.
 *
 * ★★ **실패(1)가 아니라 「못 잼」(2)으로 둔다.** 이 개발 자리에는 한글 글꼴이
 *   없는 것이 정상이고, 여기서 빨갛게 끝내면 **늘 빨갛고 아무도 안 본다**.
 *   문서를 실제로 만드는 자리(CI·NAS)는 `fonts-noto-cjk` 를 설치하므로
 *   거기서는 초록이 된다 — 배포 문턱은 그대로 지켜진다.
 *
 * ★ 요청 글꼴은 **`design/tokens.js` 한 곳에서 온다.** 여기 다시 적으면
 *   두 벌이 되고, 그러면 토큰을 바꾼 날부터 이 칸이 옛말을 한다.
 */
function typeface() {
  let r;
  try {
    const fonts = require('../core/fonts.js');
    r = fonts.check(require('../design/tokens.js').FONT);
    if (r.ok) {
      add('문서 활자', 'ok', require('../core/fonts.js').summarize(r));
      return;
    }
  } catch (e) {
    add('문서 활자', 'unknown', `못 쟀다 — ${String(e.message).split('\n')[0]}`);
    return;
  }
  const sub = Object.entries(r.substitutes || {})
    .map(([want, got]) => `${want} → ${got}`).join(' · ');
  add('문서 활자', 'unknown',
    `요청한 글꼴이 이 자리에 없다 (${sub || r.missing.join(', ')})`
    + ' — 여기서 만든 PDF 는 **다른 활자로** 그려진다. 문서를 실제로 내보내는'
    + ' 자리(CI·NAS)에는 fonts-noto-cjk 가 설치된다');
}

/**
 * ★★★ **재기만 하고 아무도 안 보는 숫자는 없는 숫자다** 〈2026-08-26 · D-118 후속〉.
 *
 *   `rights:count` 는 「비밀 검사를 경고에서 막기로 올릴 때」를 정하는 근거를
 *   쌓는다. 그런데 **손으로 돌려야 세어졌다.** 그러면 20번을 넘기는 날이
 *   **와도 아무도 모른다** — 「몇 주 뒤에 정하자」가 영원히 안 정해지는
 *   바로 그 꼴이다 (D-118 이 막으려던 것).
 *
 * ★ 그래서 **교차검증을 돌 때마다 한 줄로 찍는다.** 배포는 `guard` 를 지나므로
 *   나갈 때마다 세어지고, 때가 되면 그 줄이 스스로 「이제 올려도 된다」로 바뀐다.
 *
 * ★★ **칸(통과/실패)으로 만들지 않는다.** 이것은 재는 도구이지 막는 장치가
 *   아니다. 칸으로 넣으면 「걸린 것이 있다」가 배포를 막게 되는데, 그것이
 *   바로 D-118 이 **아직 하지 않기로 정한 일**이다. 표 아래 한 줄로만 적는다.
 */
function rightsNote() {
  try {
    const r = require('./rights-count.js').count();
    const rate = r.falseRate === null ? '' : ` · 오탐 ${Math.round(r.falseRate * 100)}%`;
    return `  · 비밀 검사(D-118) ${r.ran}번 돌았다 · 걸린 것 ${r.hits}건${rate}`
      + ` — ${r.ready ? '**이제 막기로 올려도 된다**' : r.why}\n`;
  } catch (e) {
    // 못 셌으면 **못 셌다고** 적는다. 조용히 빠지면 「0건」과 구분이 안 된다
    return `  · 비밀 검사(D-118) 못 셌다 — ${String(e.message).split('\n')[0]}\n`;
  }
}

/**
 * ★★★ **복원시험도 나갈 때마다 눈에 띄어야 한다** 〈2026-08-26 · 감사 H-1〉.
 *
 *   감사 지침 §11-4 — 「백업의 **존재가 아니라** 실제 복원시험에 성공해야 한다」.
 *   그래서 `backup.js` 를 만들었는데, **손으로 돌려야 도는 장치는 안 돈다**
 *   (D-88 에서 이미 겪었다: 눌러야 도는 배포는 아무도 안 눌러서 NAS 가 옛 판으로 남았다).
 *
 * ★★ 여기서는 **떠 둔 것이 지금 자료와 같은지**만 잰다 — 그것은 빠르다.
 *   빈 자리에 되살리는 진짜 시험은 `npm run backup:drill` 이다.
 *   교차검증마다 전체를 되살리면 느려지고, 느린 검사는 꺼진다.
 *
 * ★ 칸(통과/실패)으로 만들지 않는다. 백업이 아직 없는 자리에서 배포를 막으면
 *   그것은 이 도구가 정할 일이 아니다 — 사람이 정한다.
 */
function backupNote() {
  try {
    const b = require('./backup.js');
    const fs2 = require('fs');
    /* ★★★ **여기서 재는 것은 「이 자리」다 — 운영 자리가 아니다**
     *   〈2026-08-30 · D-184〉.
     *
     *   앞 판은 이 줄이 「아직 한 벌도 안 떴다」로만 끝났다. 그런데 이 자리는
     *   개발 컨테이너라, 여기에 백업이 없는 것은 **당연한 일**이다 — 사장님
     *   자료는 NAS 에 있다. 그 말만 보고 「백업이 없다」고 읽으면 **운영 자리에
     *   실제로 있는지 없는지와 무관한 말**을 매번 하게 된다.
     *
     * ★ 그래서 **어디를 잰 것인지**를 함께 적고, 운영 자리는 배포가 잰다는
     *   사실을 가리킨다 (`deploy-nas` 의 「Back up project data」). */
    if (!fs2.existsSync(b.DEST)) {
      return '  · 자료 백업(H-1) **이 자리엔 한 벌도 없다** (개발 컨테이너 —'
        + ' 사장님 자료는 NAS 에 있다). **운영 자리는 배포가 잰다** —'
        + ' 배포 요약의 「자료 백업」 줄을 본다. 여기서 재 보려면'
        + ' `npm run backup:write` · `npm run backup:drill`\n';
    }
    const v = b.verify();
    return `  · 자료 백업(H-1) ${v.ok ? '뜬 것이 지금 자료와 같다' : v.line}`
      + ' (이 자리 기준 — 운영 자리는 배포가 잰다)\n';
  } catch (e) {
    return `  · 자료 백업(H-1) 못 쟀다 — ${String(e.message).split('\n')[0]}\n`;
  }
}


/**
 * ★★★ **채워지지 않은 장부는 배포마다 보여야 한다** 〈2026-08-26 · 감사 게이트 13〉.
 *
 *   지침 §6 — 「인계자 또는 인수자가 지정되지 않은 항목은 완료로 판정하지 않는다」.
 *   그런데 **비어 있다는 사실 자체가 안 보이면** 아무도 안 채운다.
 *   그것이 「몇 주 뒤에 정하자」가 영원히 안 정해지는 꼴이다 (D-118 과 같은 결).
 *
 * ★ 칸으로 만들지 않는다 — 사람 이름이 없다고 배포를 막는 것은 이 도구가
 *   정할 일이 아니다. 표 아래 한 줄로 **세어서 보인다.**
 */
function ledgerNote() {
  try {
    const L = require('./handover-ledger.js');
    const fs2 = require('fs');
    if (!fs2.existsSync(L.LEDGER)) return '';
    const rows = L.parse();
    if (!rows) return '  · 인수인계 관리대장 표를 못 읽었다 — 머리글이 바뀌었는지 본다\n';
    return `  · ${L.line(L.count(rows))}\n`;
  } catch (e) {
    return `  · 인수인계 관리대장 못 쟀다 — ${String(e.message).split('\n')[0]}\n`;
  }
}

/* ── 내보내기 ──────────────────────────────────────────── */

function main() {
  tests(); stamp(); previews(); render(); saveBar(); openFile(); agents(); branches(); imflow(); typeface();

  const mark = { ok: '✅', fail: '❌', unknown: '⚠️ ' };
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));
  process.stdout.write('\n배포·전달 전 교차검증 (CLAUDE.md §8)\n\n');
  rows.forEach((r) => {
    process.stdout.write(`  ${mark[r.state]} ${pad(r.name, 16)} ${r.note}\n`);
  });

  const bad = rows.filter((r) => r.state === 'fail').length;
  const unk = rows.filter((r) => r.state === 'unknown').length;
  process.stdout.write(`\n  통과 ${rows.length - bad - unk} · 실패 ${bad} · 못 잼 ${unk}`
    + '  ← 못 잰 것은 통과가 아니다\n');
  process.stdout.write(rightsNote() + backupNote() + ledgerNote() + '\n');

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
module.exports = { tests, stamp, previews, render, saveBar, openFile, agents, branches, typeface, rightsNote, backupNote, ledgerNote, rows };
