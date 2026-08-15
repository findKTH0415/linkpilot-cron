'use strict';
/**
 * build-result.js — 보고서 생성 **결과** 화면 미리보기.
 *
 *   node im-agent/ui/platform/build-result.js [--root <im-projects>] [--id <LP-...>] [--out <경로>] [--fragment]
 *
 * CLAUDE.md §8 — 화면 작업은 미리보기까지가 완성이다.
 *
 * ★ 여기 들어가는 것은 **실제로 돌린 파이프라인의 산출물**이다. 화면을 채우려고
 *   숫자를 지어내지 않는다. 진행률·RED FLAG·IM 본문 모두 프로젝트 폴더에서 읽는다.
 *   그래서 이 미리보기는 프로젝트가 있어야 만들어진다 (없으면 만들지 않는다).
 *
 * ★ 제작현황은 `ui/vanilla/control-tower.js` 를 그대로 쓴다. 렌더 로직을 복사하면
 *   실제 화면과 미리보기가 갈리고, 갈린 쪽이 어느 쪽인지 알 수 없게 된다.
 *   데이터는 mount(el, { fetch }) 로 넣는다 — 서버 없이 실제 스냅샷을 먹인다.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const UI = path.join(HERE, '..');
const AGENT = path.join(UI, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inlineSafe = (js) => js.replace(/<\/(script)/gi, '<\\/$1');
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 산출물 — report-api 가 보는 것과 같은 목록을 쓴다 (한쪽만 늘어나면 갈린다) */
const { OUTPUTS } = require(path.join(UI, 'report-api.cjs'));

function kst(d) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

function build(opts) {
  const root = opts.root;
  const id = opts.id;
  const dir = path.join(root, id);
  if (!fs.existsSync(dir)) throw new Error(`프로젝트를 찾을 수 없다: ${dir}`);

  process.env.IM_AGENT_ROOT = root;
  const monitor = require(path.join(AGENT, 'core', 'monitor'));
  const snapshot = monitor.snapshot(id);
  if (!snapshot.agents.length) throw new Error('실행 기록이 없다 — 먼저 파이프라인을 돌려라');

  const readIf = (rel) => {
    const p = path.join(dir, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };

  // ── 산출물 목록 (파일이 실제로 있는지로 판정한다) ──────────
  const files = OUTPUTS.map((o) => {
    const full = path.join(dir, o.rel);
    let st = null;
    try { st = fs.statSync(full); } catch (_) { st = null; }
    return { ...o, exists: !!st, bytes: st ? st.size : 0, at: st ? kst(st.mtime) : null };
  });

  const a4 = readIf('12_Final/im-a4.html');
  const redflag = readIf('11_QC/red-flag-report.md');
  const validation = readIf('11_QC/validation-report.md');
  const project = JSON.parse(readIf('01_Project/project.json') || '{}');

  // ── 조각 ──────────────────────────────────────────────────
  const towerCss = fs.readFileSync(path.join(UI, 'controlTower.css'), 'utf8');
  const towerJs = fs.readFileSync(path.join(UI, 'vanilla', 'control-tower.js'), 'utf8');

  const fileRows = files.map((f) => `
    <div class="out${f.exists ? '' : ' out--no'}">
      <div class="out__ic">${f.exists ? '📄' : '·'}</div>
      <div>
        <div class="out__n">${esc(f.name)}</div>
        <div class="out__m">${esc(f.rel)}${f.exists ? ` · ${(f.bytes / 1024).toFixed(1)}KB · ${f.at}` : ' · 만들어지지 않음'}</div>
      </div>
    </div>`).join('');

  // 승인 정보는 tracks.approval 에 있다. 최상위 approval 로 잘못 읽으면
  // 배너가 조용히 사라지고 '차단 아님'처럼 보인다 — 가장 나쁜 실패다
  const approval = (snapshot.tracks && snapshot.tracks.approval) || {};
  const reasons = approval.reasons || [];
  const blocked = approval.approved === false || reasons.length > 0;
  if (!snapshot.tracks || !snapshot.tracks.approval) {
    throw new Error('snapshot.tracks.approval 이 없다 — monitor 스냅샷 구조가 바뀌었다');
  }

  const mdBlock = (title, text, tone) => text ? `
  <section class="sec">
    <h2 class="sec__t">${esc(title)}</h2>
    <pre class="md ${tone || ''}">${esc(text.trim())}</pre>
  </section>` : '';

  return `<title>보고서 생성 결과</title>
<style>
  :root {
    --ink: #17181A; --ink2: #6B7280; --line: #E5E7EB; --bg: #FAFAFA;
    --surface: #FFFFFF; --lime: #9ED700; --lime-deep: #4F6A00;
    --bad: #B42318; --bad-soft: #FEF3F2; --warn-soft: #FDF3E3; --warn-ink: #8A5A10;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 400 15px/1.6 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
          'Malgun Gothic', Arial, sans-serif; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; letter-spacing: -.01em; }
  .sub { color: var(--ink2); font-size: 14.5px; margin: 0 0 4px; }
  .pid { font: 600 13px/1 ui-monospace, Menlo, Consolas, monospace; color: var(--ink2); }
  .banner { margin: 18px 0 26px; padding: 14px 17px; border-radius: 12px;
    font-size: 13.5px; line-height: 1.65; max-width: 72ch; }
  .banner--blocked { background: var(--bad-soft); color: var(--bad); border: 1px solid #FDA29B; }
  .banner--note { background: var(--warn-soft); color: var(--warn-ink); }
  .banner b { font-weight: 800; }
  .banner ul { margin: 9px 0 0; padding-left: 18px; }
  .banner li { margin: 3px 0; }
  .sec { margin: 0 0 34px; }
  .sec__t { font-size: 17px; font-weight: 800; margin: 0 0 6px; }
  .sec__d { font-size: 13.5px; color: var(--ink2); margin: 0 0 13px; max-width: 74ch; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
  .out { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-top: 1px solid var(--line); }
  .out:first-child { border-top: 0; }
  .out--no { opacity: .5; }
  .out__ic { width: 32px; height: 32px; border-radius: 8px; background: #F3F4F6;
    display: grid; place-items: center; font-size: 14px; flex: none; }
  .out__n { font-size: 14px; font-weight: 700; }
  .out__m { font-size: 12px; color: var(--ink2); margin-top: 2px;
    font-variant-numeric: tabular-nums; font-family: ui-monospace, Menlo, Consolas, monospace; }
  .md { white-space: pre-wrap; word-break: break-word; font: 400 13px/1.7 ui-monospace, Menlo, Consolas, monospace;
    background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
    padding: 16px; margin: 0; max-height: 460px; overflow: auto; }
  .md.bad { border-color: #FDA29B; background: var(--bad-soft); color: #7A271A; }
  .frame { width: 100%; height: 900px; border: 1px solid var(--line); border-radius: 14px;
    background: #fff; display: block; }
  #tower { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 6px; }
  @media (max-width: 700px) { .frame { height: 620px; } }
${towerCss}
</style>
<div class="wrap">
  <h1>보고서 생성 결과</h1>
  <p class="sub">${esc(project.name || id)}</p>
  <p class="pid">${esc(id)} · ${esc(project.templateId || '')}</p>

  <div class="banner banner--note">
    <b>실제로 돌린 파이프라인의 산출물입니다.</b> 진행률·검증 결과·IM 본문 모두
    프로젝트 폴더에서 그대로 읽었습니다 — 화면을 채우려고 지어낸 숫자가 없습니다.
    표본 자료로 돌린 것이므로 <b>내용은 예시</b>이고, 아래 배포 차단도 그 자료에서
    실제로 나온 결과입니다.
  </div>

  ${blocked ? `<div class="banner banner--blocked">
    <b>배포 차단</b> — 아래가 해소되기 전에는 산출물을 내보낼 수 없습니다.
    <ul>${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
  </div>` : ''}

  <section class="sec">
    <h2 class="sec__t">제작 현황</h2>
    <p class="sec__d">4트랙(제작·검증·산출·승인) 진행률. 제작이 100%여도 승인이 0%면
      전체는 올라가지 않습니다 — <b>Agent 진행률을 프로젝트 진행률처럼 보이게 하지 않습니다.</b></p>
    <div id="tower"></div>
  </section>

  <section class="sec">
    <h2 class="sec__t">산출물</h2>
    <p class="sec__d">'생성됨' 표시를 믿지 않고 <b>파일이 실제로 있는지</b>로 판정합니다.</p>
    <div class="card">${fileRows}</div>
  </section>

  <section class="sec">
    <h2 class="sec__t">생성된 IM (A4 인쇄본)</h2>
    <p class="sec__d">파이프라인이 만든 <code>12_Final/im-a4.html</code> 원본입니다.
      본문 수치에는 전부 출처가 붙어 있고, 출처가 확인되지 않은 값은 본문에 쓰이지 않습니다.</p>
    ${a4 ? `<iframe class="frame" title="생성된 IM" srcdoc="${a4.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`
      : '<div class="card">IM 이 만들어지지 않았습니다.</div>'}
  </section>

  ${mdBlock('RED FLAG 보고서', redflag, 'bad')}
  ${mdBlock('검증 보고서', validation)}
</div>
<script>${inlineSafe(towerJs)}</script>
<script>
(function () {
  'use strict';
  // ★ 실제 스냅샷을 주입한다. 렌더는 화면과 같은 control-tower.js 가 한다 —
  //   복사하면 실제 화면과 미리보기가 갈리고 어느 쪽이 맞는지 알 수 없다.
  var SNAPSHOT = ${JSON.stringify(snapshot)};
  var stub = function (url) {
    return Promise.resolve({
      ok: true, status: 200,
      json: function () { return Promise.resolve(SNAPSHOT); },
    });
  };
  window.LinkPilotControlTower.mount(document.getElementById('tower'), {
    projectId: ${JSON.stringify(id)},
    fetch: stub,
    pollMs: 0,
  });
}());
</script>`;
}

function main() {
  const root = arg('--root', process.env.IM_AGENT_ROOT || path.join(process.cwd(), 'im-projects'));
  let id = arg('--id', null);
  if (!id) {
    const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter(n => /^LP-[A-Z]+-\d{4}-\d{3}$/.test(n)) : [];
    if (!dirs.length) {
      console.error(`프로젝트가 없다: ${root}\n먼저 파이프라인을 돌려라 — IM_AGENT_OFFLINE=1 npm run im:demo`);
      process.exit(1);
    }
    id = dirs.sort().pop();
  }
  const frag = build({ root, id });
  const html = process.argv.includes('--fragment') ? frag
    : `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n`
      + `<meta name="viewport" content="width=device-width, initial-scale=1">\n`
      + frag.slice(0, frag.indexOf('</style>') + 8)
      + `\n</head>\n<body>\n` + frag.slice(frag.indexOf('</style>') + 8) + `\n</body>\n</html>\n`;
  const out = arg('--out', path.join(HERE, 'result.html'));
  fs.writeFileSync(out, html);
  console.log(`${out} (${Math.round(html.length / 1024)}KB) · ${id}`);
}

if (require.main === module) main();

module.exports = { build };
