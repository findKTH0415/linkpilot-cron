#!/usr/bin/env node
'use strict';
/**
 * build-dashboard.js — 지금 이 저장소가 **어디까지 와 있는지** 한 장으로 만든다.
 *
 *   node im-agent/ui/platform/build-dashboard.js [출력경로]
 *
 * ★ 숫자를 손으로 적지 않는다. 사전·커넥터·Agent·채움 계획·미결정 등록부를
 *   **실제로 읽어서** 센다. 손으로 적으면 코드가 바뀐 날부터 이 화면만 옛말을
 *   하고, 그때는 아무도 눈치채지 못한다 (MEMORY.md M-05).
 *
 * ★ 「아직 안 된 것」을 「한 것」과 같은 자리에 섞지 않는다. 섞으면 이미 된
 *   것으로 읽힌다 — 대시보드에서 가장 흔한 거짓말이다.
 *
 * 결과는 `<title>` + `<style>` + 본문 조각이다 (감싸는 문서는 올리는 쪽이 붙인다).
 */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..', '..');
const AGENT = path.join(HERE, '..', '..');

const dict = require(path.join(AGENT, 'core/dictionary'));
const fieldplan = require(path.join(AGENT, 'core/fieldplan'));
const ex = require(path.join(AGENT, 'agents/02-extraction'));
const F = require(HERE + '/fields-core.js');
const CH = require(HERE + '/changes.js');

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PUBLIC_KEYS = ['VWORLD_KEY', 'DATA_GO_KR_KEY', 'ECOS_API_KEY',
  'DART_API_KEY', 'KMA_APIHUB_KEY', 'REB_API_KEY'];

/** 키가 **있는** 환경을 흉내 낸다 — 키 유무로 숫자가 달라지는 것이 핵심 정보다 */
function withKeys(fn) {
  const saved = {};
  PUBLIC_KEYS.forEach((k) => { saved[k] = process.env[k]; process.env[k] = 'x'; });
  try { return fn(); } finally {
    PUBLIC_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    });
  }
}

function countFiles(rel, re) {
  try { return fs.readdirSync(path.join(AGENT, rel)).filter(f => re.test(f)).length; }
  catch (_) { return 0; }
}

/** 미결정 등록부에서 신호등별로 센다 — 문서가 단일 출처다 */
function pending() {
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, 'docs', '미결정-사항.md'), 'utf8'); }
  catch (_) { return { red: 0, orange: 0, yellow: 0, done: 0, items: [] };  }
  // ★ 이모지를 문자 집합([🔴🟠])으로 쓰면 안 된다. `u` 플래그 없이는 서로게이트
  //   반쪽들의 집합이 되어 엉뚱하게 맞는다. 게다가 일부 이모지 뒤에는 이형자
  //   선택자(U+FE0F)가 붙어 있어 뒤 공백 매칭이 어긋난다 — 그래서 표식을
  //   통째로 잡아 문자열로 비교한다.
  const heads = [...text.matchAll(/^### (\S+)\s+(D-\d+)\. (.+)$/gmu)];
  const has = (mark) => (t) => t.indexOf(mark) === 0;
  const n = (mark) => heads.filter(h => has(mark)(h[1])).length;
  return {
    red: n('🔴'), orange: n('🟠'), yellow: n('🟡'), white: n('⚪'), done: n('✅'),
    items: heads.filter(h => has('🔴')(h[1])).map(h => ({ id: h[2], title: h[3].replace(/\s*〈[^〉]*〉\s*$/, '') })),
  };
}

/** 재발 방지 기록 — 막힌 것과 규칙만 있는 것을 가른다 */
function memory() {
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, 'MEMORY.md'), 'utf8'); }
  catch (_) { return { rows: [] }; }
  const rows = [...text.matchAll(/^\| \[(M-\d+)\]\(#[^)]*\) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
    .map(m => ({ id: m[1], what: m[2].trim(), state: m[3].trim(), guard: m[4].trim() }));
  return { rows };
}

function build() {
  const fields = Object.keys(dict.FIELDS).length;
  const computed = dict.COMPUTED_KEYS.length;
  const groups = ex.readGroups();
  const noKey = fieldplan.summary('generic');
  const withK = withKeys(() => fieldplan.summary('generic'));

  const manualNow = F.autoBreakdown(dict.FIELDS, fieldplan.plan('datacenter'), 'im');
  const manualKey = withKeys(() => F.autoBreakdown(dict.FIELDS, fieldplan.plan('datacenter'), 'im'));

  const p = pending();
  const mem = memory();

  const tests = (() => {
    try {
      return fs.readdirSync(path.join(AGENT, 'test')).filter(f => /\.test\.js$/.test(f)).length;
    } catch (_) { return 0; }
  })();

  const stat = (n, label, sub) => `
    <div class="st">
      <div class="st__n">${esc(String(n))}</div>
      <div class="st__l">${esc(label)}</div>
      ${sub ? `<div class="st__s">${esc(sub)}</div>` : ''}
    </div>`;

  const fillRow = (key, label, why) => `
    <tr>
      <th>${esc(label)}</th>
      <td class="num">${noKey[key] || 0}</td>
      <td class="num on">${withK[key] || 0}</td>
      <td>${esc(why)}</td>
    </tr>`;

  const latest = CH.byDate()[0];

  return `<title>보고서 생성 엔진 현황</title>
<style>
  :root {
    --pg: #F5F6F8; --sf: #FFFFFF; --ln: #E4E7EA; --ink: #17181A; --ink2: #6E757D;
    --lime: #9ED700; --lime-soft: #EDF7DC; --lime-deep: #4F6900;
    --red: #C0392B; --red-soft: #FBEAE8; --amber: #B77500; --amber-soft: #FCF3E2;
  }
  body { margin: 0; background: var(--pg); color: var(--ink);
    font: 400 15px/1.6 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
      'Malgun Gothic', Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 26px 20px 60px; }

  .hd { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .hd h1 { font-size: 24px; font-weight: 800; margin: 0; letter-spacing: -.01em; }
  .hd .at { font: 600 12.5px/1 ui-monospace, Menlo, Consolas, monospace;
    color: var(--lime-deep); background: var(--lime-soft); padding: 6px 10px; border-radius: 7px; }
  .hd p { flex-basis: 100%; margin: 8px 0 0; font-size: 14px; color: var(--ink2); }

  .sec { margin-top: 26px; }
  .sec > h2 { font-size: 13px; font-weight: 800; letter-spacing: .04em; margin: 0 0 10px;
    color: var(--ink2); text-transform: uppercase; }

  .row { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .st { background: var(--sf); border: 1px solid var(--ln); border-radius: 14px; padding: 16px 18px; }
  .st__n { font: 800 30px/1 inherit; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .st__l { font-size: 13.5px; font-weight: 700; margin-top: 6px; }
  .st__s { font-size: 12.5px; color: var(--ink2); margin-top: 3px; line-height: 1.5; }

  .card { background: var(--sf); border: 1px solid var(--ln); border-radius: 16px;
    padding: 18px 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--ln); vertical-align: top; }
  thead th { font-size: 12px; color: var(--ink2); font-weight: 700; }
  tbody th { font-weight: 700; white-space: nowrap; }
  tr:last-child th, tr:last-child td { border-bottom: 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
  .num.on { color: var(--lime-deep); }
  td.why { color: var(--ink2); font-size: 13px; }

  .pill { display: inline-block; font: 700 11.5px/1 inherit; padding: 5px 9px; border-radius: 999px; }
  .pill--ok { background: var(--lime-soft); color: var(--lime-deep); }
  .pill--rule { background: var(--amber-soft); color: var(--amber); }

  .warn { background: var(--red-soft); border: 1px solid #F0D2CD; border-radius: 16px;
    padding: 18px 20px; }
  .warn h3 { margin: 0 0 4px; font-size: 15px; font-weight: 800; color: var(--red); }
  .warn p { margin: 0 0 12px; font-size: 13px; color: #7B3128; }
  .warn ol { margin: 0; padding-left: 20px; font-size: 13.5px; color: #5E2B24; }
  .warn li { margin-bottom: 7px; }
  .warn li b { color: var(--red); }

  .ext { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .ext span { font: 600 11.5px/1 ui-monospace, Menlo, Consolas, monospace;
    padding: 5px 8px; border-radius: 6px; background: #F1F2F4; color: var(--ink2); }
  .ext.no span { background: var(--red-soft); color: var(--red); }

  .fmt { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
  .fmt__t { font-size: 13.5px; font-weight: 800; }
  .fmt__w { font-size: 12.5px; color: var(--ink2); margin: 4px 0 0; line-height: 1.55; }

  .note { font-size: 12.5px; color: var(--ink2); margin-top: 10px; line-height: 1.6; }
  .note b { color: var(--ink); }
</style>

<div class="wrap">
  <header class="hd">
    <h1>보고서 생성 엔진 현황</h1>
    <span class="at">최근 반영 ${esc(CH.latestAt())} KST</span>
    <p>이 숫자는 손으로 적은 것이 아니라 <b>만들 때 코드를 읽어서</b> 센 것입니다 —
      사전·커넥터·채움 계획·미결정 등록부를 직접 셉니다.</p>
  </header>

  <section class="sec">
    <h2>규모</h2>
    <div class="row">
      ${stat(countFiles('agents', /\.js$/), '파이프라인 Agent', '11개 중 8개는 LLM 을 안 부른다')}
      ${stat(countFiles('connectors', /\.js$/), '커넥터', '공공데이터 · 시장 · 공시')}
      ${stat(fields, '사전 항목', `계산 전용 ${computed}개는 따로`)}
      ${stat(tests, '테스트 파일', '네트워크·키 없이 돈다')}
    </div>
  </section>

  <section class="sec">
    <h2>사람이 얼마나 치는가</h2>
    <div class="card">
      <table>
        <thead>
          <tr><th>채우는 쪽</th><th class="num">키 없음</th><th class="num">키 있음</th><th>무엇이 다른가</th></tr>
        </thead>
        <tbody>
          ${fillRow('request', '요청문', '01 Project 가 한 줄에서 뽑는다')}
          ${fillRow('public', '공공데이터', '키가 없으면 이 경로가 통째로 죽는다')}
          ${fillRow('extract', '올린 자료', '02 Extraction — 못 뽑으면 사람이 친다')}
          ${fillRow('derived', '계산', '차입금 = 총사업비 × LTC 등')}
          ${fillRow('default', '산업 통상치', '가정치로 표시된다')}
          ${fillRow('manual', '직접 입력', '아무도 못 채우는 것만 남는다')}
        </tbody>
      </table>
      <p class="note">IM 필수 <b>${manualNow.total}개</b> 중 화면이 실제로 묻는 것은
        지금 <b>${manualNow.manual.length}칸</b>입니다. 공공데이터 키를 넣으면
        <b>${manualKey.manual.length}칸</b>으로 줄어듭니다 —
        차이 한 칸이 대지면적이고, 키가 없어 사람에게 내려온 것입니다.</p>
    </div>
  </section>

  <section class="sec">
    <h2>올린 자료를 어떻게 읽는가</h2>
    <div class="fmt">
      ${groups.map(g => `
      <div class="card">
        <div class="fmt__t">${esc(g.label)}</div>
        <p class="fmt__w">${esc(g.why)}</p>
        <div class="ext${g.id === 'convert' ? ' no' : ''}">
          ${g.ext.map(e => `<span>${esc(e)}</span>`).join('')}
        </div>
      </div>`).join('')}
    </div>
  </section>

  <section class="sec">
    <h2>재발 방지 기록</h2>
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>무엇</th><th>막는 장치</th></tr></thead>
        <tbody>
          ${mem.rows.map(r => `<tr>
            <th>${esc(r.id)}</th>
            <td>${esc(r.what)}
              <span class="pill ${/막힘/.test(r.state) ? 'pill--ok' : 'pill--rule'}">${esc(r.state)}</span></td>
            <td class="why">${esc(r.guard)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="note">문제가 생기면 <b>여기를 먼저 찾습니다.</b>
        「규칙만」은 사람이 지켜야 하는 것이고, 「막힘」은 코드가 막습니다 —
        막는 장치가 없으면 해결된 것이 아닙니다.</p>
    </div>
  </section>

  <section class="sec">
    <h2>지금 막혀 있는 것 — 사용자만 할 수 있습니다</h2>
    <div class="warn">
      <h3>🔴 ${p.red}건</h3>
      <p>미결정 등록부에 ${p.red + p.orange + p.yellow + p.white}건이 열려 있고,
        그중 ${p.red}건은 시간이 갈수록 비싸집니다. ✅ 결정된 것은 ${p.done}건.</p>
      <ol>
        ${p.items.map(i => `<li><b>${esc(i.id)}</b> ${esc(i.title)}</li>`).join('')}
      </ol>
    </div>
  </section>

  <section class="sec">
    <h2>가장 최근에 바뀐 것 (${esc(latest ? latest.at : '')})</h2>
    <div class="card">
      <table>
        <thead><tr><th>무엇</th><th>전</th><th>후</th></tr></thead>
        <tbody>
          ${(latest ? latest.items : []).map(c => `<tr>
            <th>${esc(c.title)}</th>
            <td class="why">${esc(c.was)}</td>
            <td>${esc(c.now)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </section>
</div>
`;
}

if (require.main === module) {
  const out = process.argv[2] || path.join(HERE, 'dashboard-artifact.html');
  const frag = build();
  const { publishable } = require('./build-static.js');
  const bad = publishable(frag);
  if (bad.length) { console.error('올릴 수 없는 조각이다 — ' + bad.join(' / ')); process.exit(1); }
  fs.writeFileSync(out, frag);
  console.log(`${out} (${Math.round(frag.length / 1024)}KB) · 현황 대시보드`);
}

module.exports = { build, pending, memory };
