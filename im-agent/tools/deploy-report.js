'use strict';
/**
 * deploy-report.js — **배포본이 반영됐는지를 한 장으로 보여 준다** 〈2026-08-27 · D-147〉.
 *
 * 사장님 지침: 「작업이 끝나면 배포본에 반영이 잘 되었는지 오류가 없는지 **즉시
 * 교차검증**하고 **HTML 파일로 URL 로 열어서** 보여줘」.
 *
 * ★★★ 왜 도구로 만드나. 같은 확인을 말로만 하면 **바쁜 날 빠진다** — 이 저장소가
 *   그 결로 여러 번 당했다(M-31: 손으로 챙기다 하루 반에 여섯 번 빠뜨렸다).
 *   한 줄로 만들어야 안 빠진다.
 *
 * ★★ **못 잰 것을 통과로 그리지 않는다.** 이 자리에서 NAS 를 직접 못 본다 —
 *   근거는 배포가 NAS 안에서 잰 결과다. 그 사실을 페이지에 그대로 적는다.
 *
 * 쓰는 법
 *   node im-agent/tools/deploy-report.js \
 *     --deploy <배포단계.json> --guard <guard출력.txt> --out <낼파일.html> \
 *     [--sha <커밋>] [--run <실행주소>]
 *
 *   배포단계.json 은 GitHub 도구가 준 답에서 뽑는다:
 *     [{ "name": "Verify deployed", "conclusion": "success" }, …]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PLAT = path.join(ROOT, 'im-agent', 'ui', 'platform');

function arg(n, d) { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; }

/** 판 지문 — **읽어서** 쓴다. 손으로 박으면 그날부터 이 장이 옛말을 한다 (M-25) */
function stamp() {
  try {
    const s = fs.readFileSync(path.join(PLAT, 'linkpilot-platform.html'), 'utf8');
    return (s.match(/LP_BUILD = '([0-9a-f]+)'/) || [])[1] || null;
  } catch (_) { return null; }
}

/**
 * guard 출력에서 칸을 뽑는다. 형식이 바뀌면 **빈 표가 아니라 그렇다고 말한다**.
 *
 * ★★ **띄어쓰기로 가르지 않는다** 〈2026-08-27 · 처음에 그렇게 했다가 열 칸 중
 *   일곱만 잡았다〉. guard 는 이름을 **칸 너비 16**으로 맞춰 찍는데(`pad(name,16)`),
 *   「[저장] 막대 자리」처럼 이름 안에 공백이 있는 칸은 「두 칸 이상 띄면 거기가
 *   경계」라는 규칙에 안 걸린다. 그러면 **말없이 세 칸이 빠진 표**가 된다 —
 *   빠진 줄은 화면에서 안 보이므로 아무도 눈치채지 못한다.
 * ★ 그래서 **같은 규칙(칸 너비)** 으로 가른다. 한글은 두 칸으로 센다.
 */
function width(s) {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return w;
}

function guardRows(txt) {
  if (!txt) return null;
  const rows = [];
  txt.split('\n').forEach((l) => {
    /* ★ 맨 앞 두 칸 들여쓰기까지 본다 — 마지막 판정 줄(「❌ **내보내지 않는다**」)은
     *   들여쓰기가 없다. 안 가르면 그 줄이 **열한 번째 칸**으로 표에 들어온다 */
    const m = l.match(/^ {2}(✅|❌|⚠️)\s(.*)$/);
    if (!m) return;
    const rest = m[2];
    let name = '', i = 0;
    while (i < rest.length && width(name) < 16) { name += rest[i]; i += 1; }
    const note = rest.slice(i).trim();
    if (!name.trim() || !note) return;
    rows.push({ mark: m[1], name: name.trim(), note });
  });
  const tally = (txt.match(/통과 (\d+) · 실패 (\d+) · 못 잼 (\d+)/) || []).slice(1);
  return rows.length ? { rows, tally } : null;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 이 배포가 **닿은 곳**과 **사람 손**을 가르는 자리 (D-143 과 같은 말) */
const BY_HAND = [
  ['NAS 의 보고서 화면 16개', '이 배포', 'ok'],
  ['NAS 의 엔진', '이 배포', 'ok'],
  ['앱 저장소 <code>im-flow/</code> 사본', '사람', 'hand'],
  ['앱 자체 화면(브리핑·대시보드 등)', '앱 저장소', 'other'],
];

function render(o) {
  const g = o.guard;
  const bad = (o.steps || []).filter((s) => s.conclusion === 'failure');
  const verdict = bad.length ? '반영되지 않았다'
    : (g && g.tally && Number(g.tally[1]) > 0) ? '내보내면 안 된다'
    : '반영됐다';
  const vClass = verdict === '반영됐다' ? 'ok' : 'bad';
  const step = (s) => `<tr><td>${esc(s.name)}</td><td class="${
    s.conclusion === 'success' ? 'ok' : s.conclusion === 'skipped' ? 'dim' : 'bad'}">${
    s.conclusion === 'success' ? '통과' : s.conclusion === 'skipped' ? '건너뜀' : esc(s.conclusion)}</td></tr>`;

  /* ★ 제목에 판 지문을 넣지 않는다 — 발행할 때마다 이름이 바뀌면 사장님이
   *   목록에서 **같은 장을 못 알아본다.** 지문은 첫 줄에 크게 있다 */
  return `<title>배포 확인</title>
<style>
  :root{--bg:#FFFFFF;--ink:#12161F;--dim:#6B7280;--line:rgba(60,60,67,.16);
        --ok:#2F7A2F;--bad:#C0392B;--warn:#8A6100;--soft:#F2F2F7;--lime:#B5E01F}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
        --bg:#12161F;--ink:#F4F5F7;--dim:#9AA1AC;--line:rgba(255,255,255,.16);
        --ok:#7FD07F;--bad:#FF8A7A;--warn:#E8C06A;--soft:rgba(255,255,255,.06)}}
  :root[data-theme="dark"]{--bg:#12161F;--ink:#F4F5F7;--dim:#9AA1AC;--line:rgba(255,255,255,.16);
        --ok:#7FD07F;--bad:#FF8A7A;--warn:#E8C06A;--soft:rgba(255,255,255,.06)}
  body{background:var(--bg);color:var(--ink);margin:0;padding:28px 20px 64px;
       font:15px/1.6 -apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;
       font-variant-numeric:tabular-nums}
  .wrap{max-width:860px;margin:0 auto}
  .v{font-size:clamp(30px,7vw,46px);font-weight:800;letter-spacing:-.03em;margin:0 0 6px}
  .v.ok{color:var(--ok)} .v.bad{color:var(--bad)}
  .sub{color:var(--dim);margin:0 0 26px}
  h2{font-size:15px;letter-spacing:.02em;margin:30px 0 10px;padding-bottom:6px;
     border-bottom:1px solid var(--line)}
  .scroll{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:14px}
  td,th{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
  th{color:var(--dim);font-weight:600;font-size:12.5px}
  td.note{white-space:normal;color:var(--dim);font-size:13px}
  .ok{color:var(--ok);font-weight:700} .bad{color:var(--bad);font-weight:700}
  .warn{color:var(--warn);font-weight:700} .dim{color:var(--dim)}
  .chip{display:inline-block;background:var(--soft);border-radius:8px;padding:3px 9px;
        font-size:13px;margin-right:6px}
  .stamp{font-weight:800;letter-spacing:.06em}
  .cant{background:var(--soft);border-left:3px solid var(--warn);padding:12px 14px;
        border-radius:0 10px 10px 0;margin:14px 0;font-size:13.5px}
  code{background:var(--soft);padding:1px 5px;border-radius:5px;font-size:13px}
  footer{margin-top:34px;color:var(--dim);font-size:12px}
</style>
<div class="wrap">
  <p class="v ${vClass}">${verdict}</p>
  <p class="sub">판 <span class="stamp">${esc(o.stamp || '모름')}</span>
    · 커밋 <code>${esc((o.sha || '').slice(0, 7) || '모름')}</code>
    · ${esc(o.at)}</p>

  <div class="cant"><b>이 장이 무엇을 근거로 삼는가</b> — 이 자리(작업 컨테이너)에서는
    NAS 를 직접 못 봅니다. 아래 「배포가 NAS 안에서 잰 것」은 배포가 NAS 에 들어가
    직접 재고 돌려준 결과이고, 「내 자리에서 잰 것」은 코드·화면을 여기서 잰 결과입니다.
    <b>못 잰 것은 통과로 적지 않습니다.</b></div>

  <h2>배포가 NAS 안에서 잰 것</h2>
  <div class="scroll"><table><tr><th>단계</th><th>결과</th></tr>
  ${(o.steps || []).map(step).join('\n  ')}
  </table></div>

  <h2>내 자리에서 잰 것 (교차검증)</h2>
  ${g ? `<p>${g.tally.length ? `<span class="chip">통과 <b class="ok">${esc(g.tally[0])}</b></span>
    <span class="chip">실패 <b class="${Number(g.tally[1]) ? 'bad' : 'dim'}">${esc(g.tally[1])}</b></span>
    <span class="chip">못 잼 <b class="warn">${esc(g.tally[2])}</b></span>` : ''}</p>
  <div class="scroll"><table><tr><th>칸</th><th>결과</th><th>말</th></tr>
  ${g.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="${
      r.mark === '✅' ? 'ok' : r.mark === '❌' ? 'bad' : 'warn'}">${
      r.mark === '✅' ? '통과' : r.mark === '❌' ? '실패' : '못 쟀다'}</td><td class="note">${esc(r.note)}</td></tr>`).join('\n  ')}
  </table></div>`
  : '<p class="bad">교차검증 결과를 못 읽었다 — 이 장은 그만큼 덜 잰 것이다</p>'}

  <h2>어디까지가 이 배포이고, 어디부터 사람 손인가</h2>
  <div class="scroll"><table><tr><th>무엇</th><th>누가</th></tr>
  ${BY_HAND.map(([w, who, k]) => `<tr><td>${w}</td><td class="${
      k === 'ok' ? 'ok' : k === 'hand' ? 'warn' : 'dim'}">${esc(who)}</td></tr>`).join('\n  ')}
  </table></div>
  <p class="sub" style="margin-top:10px">앱에서 「보고서 만들기」를 열고 화면 맨 아래
    여덟 글자가 <span class="stamp">${esc(o.stamp || '')}</span> 인지 보면 사본이 최신인지 갈립니다.</p>

  <footer>${esc(o.run ? '실행: ' + o.run : '')}</footer>
</div>`;
}

function main() {
  const out = arg('--out', path.join(ROOT, 'deploy-report.html'));
  let steps = [];
  const dj = arg('--deploy', null);
  if (dj && fs.existsSync(dj)) {
    try { steps = JSON.parse(fs.readFileSync(dj, 'utf8')); } catch (e) {
      console.error('배포 단계를 못 읽었다 —', e.message); return 2;
    }
  }
  const gf = arg('--guard', null);
  const guard = guardRows(gf && fs.existsSync(gf) ? fs.readFileSync(gf, 'utf8') : null);
  if (!steps.length) console.error('★ 배포 단계가 비었다 — 「배포가 NAS 안에서 잰 것」이 빈 표가 된다');
  if (!guard) console.error('★ 교차검증 출력을 못 읽었다 — 그 사실을 페이지에 적는다');

  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString()
    .replace('T', ' ').slice(0, 16) + ' (KST)';
  fs.writeFileSync(out, render({
    stamp: stamp(), sha: arg('--sha', ''), run: arg('--run', ''), at: kst, steps, guard,
  }));
  console.log(`${out} · 판 ${stamp() || '모름'} · 배포 단계 ${steps.length}개`
    + ` · 교차검증 ${guard ? guard.rows.length + '칸' : '못 읽음'}`);
  return guard && guard.tally.length && Number(guard.tally[1]) > 0 ? 1 : 0;
}

if (require.main === module) process.exit(main());
module.exports = { render, guardRows, stamp };
