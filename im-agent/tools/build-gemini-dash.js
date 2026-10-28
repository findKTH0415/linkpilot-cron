'use strict';
/**
 * build-gemini-dash.js — Gemini 열쇠 여덟을 보는 화면을 만든다 (지시서 §16).
 *
 * ★★★ **파일 하나로 열린다** (CLAUDE.md §8). 서버가 있어야 열리는 것은
 *   미리보기가 아니다. 그래서 만들 때의 실측값을 **구워 넣고**, 엔진 옆에서
 *   열리면 `GET /gemini/status` 로 **살아 있는 값**을 덮어쓴다.
 *
 * ★ **값은 한 글자도 안 굽는다.** 굽는 것은 슬롯·해시 네 글자·상태·통계뿐이다
 *   (CLAUDE.md §2 · 지시서 §23).
 *
 * ★ 실측이 없으면 **없다고 화면에 박는다.** 그럴듯한 가짜 표를 그리면 그것을
 *   근거로 판단하게 된다 (CLAUDE.md §8).
 *
 * 쓰는 법:
 *   npm run gemini:dash            지금 상태를 구워 화면을 만든다
 *   npm run gemini:dash -- --live  실제로 여덟을 불러 보고 그 결과를 굽는다
 */

const fs = require('fs');
const path = require('path');
const keys = require('../core/gemini-keys');
const { kstStamp } = require('../core/kst');

const OUT_DIR = path.join(__dirname, '..', 'ui', 'dash');
const OUT = path.join(OUT_DIR, 'gemini-keys.html');

const MARK = {
  ACTIVE: ['🟢', 'ok'], VALIDATING: ['⚪', 'idle'], UNREGISTERED: ['⚪', 'idle'],
  COOLDOWN: ['🟡', 'wait'], QUOTA_LIMITED: ['🟡', 'wait'],
  TEMP_ERROR: ['🟠', 'wait'], INVALID: ['🔴', 'bad'], DISABLED: ['⚫', 'idle'],
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rows(snap) {
  if (!snap.keys.length) {
    return '<tr><td colspan="7" class="empty">등록된 열쇠가 없습니다 — '
      + '<code>GEMINI_API_KEY</code> · <code>GEMINI_API_KEY_2</code> … <code>_8</code> 을 GitHub Secrets 에 넣습니다</td></tr>';
  }
  return snap.keys.map((k) => {
    const [icon, cls] = MARK[k.status] || ['·', 'idle'];
    const cool = k.cooldownSecondsLeft ? ` · ${k.cooldownSecondsLeft}초 남음` : '';
    return `<tr class="${cls}">`
      + `<td class="mono">${esc(k.id)}</td>`
      + `<td class="mono dim">${esc(k.label)}</td>`
      + `<td>${icon} ${esc(k.status)}${esc(cool)}</td>`
      + `<td class="num">${k.totalRequests}</td>`
      + `<td class="num">${k.failedRequests}</td>`
      + `<td class="num">${k.avgLatencyMs == null ? '—' : k.avgLatencyMs + 'ms'}</td>`
      + `<td class="dim">${esc(k.lastError || k.lastSuccessAt || '—')}</td>`
      + '</tr>';
  }).join('\n');
}

function render(snap, live) {
  const alerts = snap.alerts.length
    ? `<ul class="alerts">${snap.alerts.map(a => `<li class="${a.level}">${esc(a.text)}</li>`).join('')}</ul>`
    : '<p class="fine">지금 알릴 것이 없습니다.</p>';
  const liveNote = live
    ? `<p class="fine">아래 표는 <b>실제로 여덟을 불러 본 결과</b>입니다 (${esc(live.at)}).</p>`
    : '<p class="fine warn"><b>실제 호출로 확인한 값이 아닙니다.</b> '
      + '지금까지 쌓인 통계만 보여 줍니다 — 살아 있는지 재려면 <code>npm run gemini:keys</code> 를 돌립니다.</p>';

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gemini 열쇠 여덟</title>
<style>
:root{--bg:#EEF0F4;--card:#fff;--ink:#12161D;--dim:#5A6472;--line:#D9DEE6;
--ok:#17714F;--wait:#8A6A17;--bad:#C00000;--idle:#7A8394;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0E1218;--card:#161C25;--ink:#E8ECF2;--dim:#9AA5B4;--line:#262F3C;--ok:#5BC79B;--wait:#D9AE4A;--bad:#FF6A6A;--idle:#7B879A}}
:root[data-theme="dark"]{--bg:#0E1218;--card:#161C25;--ink:#E8ECF2;--dim:#9AA5B4;--line:#262F3C;--ok:#5BC79B;--wait:#D9AE4A;--bad:#FF6A6A;--idle:#7B879A}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 15px/1.6 -apple-system,BlinkMacSystemFont,"Malgun Gothic","맑은 고딕",Arial,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:36px 20px 80px;display:flex;flex-direction:column;gap:22px}
h1{margin:0;font-size:21px;letter-spacing:-.02em}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kpi div{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:14px 16px}
.kpi b{display:block;font:600 30px/1.1 var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.kpi span{font-size:13px;color:var(--dim)}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:4px;font-size:14px}
th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
th{font:500 12px/1.4 var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--dim);white-space:nowrap}
.mono{font-family:var(--mono);font-size:13px;white-space:nowrap}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.dim{color:var(--dim);font-size:13px}
tr.ok td:nth-child(3){color:var(--ok)}
tr.wait td:nth-child(3){color:var(--wait)}
tr.bad td:nth-child(3){color:var(--bad)}
tr.idle td:nth-child(3){color:var(--idle)}
td.empty{color:var(--dim);text-align:center;padding:26px}
.alerts{margin:0;padding-left:18px}
.alerts li.red{color:var(--bad);font-weight:600}
.alerts li.yellow{color:var(--wait)}
.fine{margin:0;font-size:13.5px;color:var(--dim)}
.fine.warn{color:var(--wait)}
code{font-family:var(--mono);font-size:.92em;background:var(--bg);border:1px solid var(--line);border-radius:2px;padding:1px 5px}
footer{border-top:1px solid var(--line);padding-top:12px;font:400 12px/1.5 var(--mono);color:var(--dim)}
</style>
</head>
<body>
<div class="wrap">
  <h1>Gemini 열쇠 여덟</h1>

  <div class="kpi">
    <div><b id="k-active">${snap.active}</b><span>실제 호출 성공(ACTIVE)</span></div>
    <div><b id="k-avail">${snap.availableNow}</b><span>지금 쓸 수 있음</span></div>
    <div><b id="k-reg">${snap.registered} / ${snap.slots}</b><span>등록됨</span></div>
    <div><b id="k-req">${snap.totalRequests}</b><span>누적 요청</span></div>
    <div><b id="k-rate">${snap.successRate == null ? '—' : snap.successRate + '%'}</b><span>성공률</span></div>
  </div>

  ${liveNote}
  <div id="alerts">${alerts}</div>

  <div class="scroll">
    <table>
      <thead><tr><th>슬롯</th><th>지문</th><th>상태</th><th>요청</th><th>실패</th><th>평균</th><th>마지막</th></tr></thead>
      <tbody id="body">
${rows(snap)}
      </tbody>
    </table>
  </div>

  <p class="fine">지문은 <b>열쇠에서 해시로 뽑은 네 글자</b>입니다 — 열쇠 글자가 아닙니다.
  이 저장소와 배포 로그는 공개라, 끝 네 글자도 남기지 않습니다.</p>

  <footer>구운 시각 ${esc(snap.at)} · 읽은 곳 ${esc(snap.readFrom)}</footer>
</div>
<script>
/* ★ 엔진 옆에서 열리면 **살아 있는 값**으로 덮는다. 못 받으면 구운 값 그대로 —
 *   조용히 빈 화면이 되지 않는다 (CLAUDE.md §8). */
(function () {
  var base = (window.LINKPILOT_EMBED && window.LINKPILOT_EMBED.common && window.LINKPILOT_EMBED.common.api) || '';
  if (!base) return;
  fetch(base + '/gemini/status', { credentials: 'include' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !j.keys) return;
      document.getElementById('k-active').textContent = j.active;
      document.getElementById('k-avail').textContent = j.availableNow;
      document.getElementById('k-reg').textContent = j.registered + ' / ' + j.slots;
      document.getElementById('k-req').textContent = j.totalRequests;
      document.getElementById('k-rate').textContent = j.successRate == null ? '—' : j.successRate + '%';
    })
    .catch(function () { /* 구운 값 그대로 둔다 */ });
}());
</script>
</body>
</html>
`;
}

async function build({ live = false } = {}) {
  let liveReport = null;
  if (live) {
    const doctor = require('./gemini-doctor');
    liveReport = await doctor.checkAll();
  }
  const snap = keys.snapshot();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, render(snap, liveReport), 'utf8');
  return { file: OUT, snapshot: snap, live: liveReport, at: kstStamp() };
}

if (require.main === module) {
  build({ live: process.argv.includes('--live') }).then((r) => {
    const kb = Math.round(fs.statSync(r.file).size / 1024);
    console.log(`${r.file} (${kb}KB) · 열쇠 ${r.snapshot.registered}/${r.snapshot.slots}`
      + (r.live ? ' · 실제로 불러 본 결과를 구웠다' : ' · 통계만 구웠다 (--live 로 실측)'));
  });
}

module.exports = { build, render, OUT };
