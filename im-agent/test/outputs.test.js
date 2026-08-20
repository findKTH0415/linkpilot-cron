'use strict';
/**
 * outputs.test.js — 「완성 보고서」 탭 (D-63).
 *
 * 이 화면의 실패는 조용하다.
 *   ① 목록에서 빠진 산출물은 **없는 기능**이 된다 — PDF·탁상검토·법인가치가
 *      실제로 그렇게 빠져 있었다 (파일은 생기는데 화면에는 없었다)
 *   ② 분모를 잘못 잡으면 다 끝났는데도 덜 된 것처럼 보이거나, 그 반대가 된다
 *   ③ **100% 를 「보내도 된다」로 읽으면** 검증을 안 지난 문서가 나간다
 *
 * 그래서 「뜨는가」가 아니라 **「무엇을 세고 무엇을 말하는가」**를 검사한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const api = require('../ui/report-api.cjs');
const FLOW = require('../ui/platform/flow-core.js');

const SCREEN = path.join(__dirname, '..', 'ui', 'platform', 'outputs.html');
const src = fs.readFileSync(SCREEN, 'utf8');

/** 산출물 일부만 만든 프로젝트 한 벌 */
function project(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-outputs-'));
  const id = 'LP-DC-2026-001';
  const dir = path.join(root, id);
  for (const f of ['01_Project', '09_IM', '10_Teaser', '11_QC', '12_Final']) {
    fs.mkdirSync(path.join(dir, f), { recursive: true });
  }
  if (opts.spec !== null) {
    fs.writeFileSync(path.join(dir, '01_Project', 'output-spec.json'),
      JSON.stringify(opts.spec || { docType: 'im', formats: ['pdf'] }));
  }
  (opts.files || []).forEach((rel) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'x');
  });
  return { root, id, dir };
}

function handlers(root) {
  return api.createHandlers({
    agentRoot: root,
    agentModulePath: path.join(__dirname, '..'),
    authenticate: () => ({ name: '테스트', planId: 'pro', status: 'active' }),
  });
}

/* ───────────── 분모 ───────────── */

test('★ 완성 보고서: 조건부 산출물을 분모에 넣지 않는다', () => {
  // 넣으면 어떤 딜도 100% 가 되지 않아 **다 끝났는데도 덜 된 것처럼** 보인다
  const conditional = api.OUTPUTS.filter(o => o.when === 'conditional');
  assert.ok(conditional.length >= 4, '조건부 산출물이 표시되어 있지 않다');
  conditional.forEach((o) => {
    assert.equal(api.isExpected(o, { formats: ['pdf'] }), false, `${o.id} 가 분모에 들어간다`);
    assert.ok(o.why, `${o.id}: 안 나오는 이유가 없다 — 이유 없이 회색이면 고장으로 읽힌다`);
  });
});

test('★ 완성 보고서: 형식 조건은 사양에 있을 때만 분모에 넣는다', () => {
  const pdf = api.OUTPUTS.find(o => o.id === 'pdf');
  assert.equal(pdf.when, 'format:pdf');
  assert.equal(api.isExpected(pdf, { formats: ['pdf'] }), true);
  assert.equal(api.isExpected(pdf, { formats: ['html'] }), false);
  // ★ 사양을 못 읽으면 기대에 넣지 않는다 — 넣으면 진행률이 영영 100% 가 안 된다
  assert.equal(api.isExpected(pdf, null), false);
});

test('★ 완성 보고서: 서버가 분모를 준다 — 화면이 계산하지 않는다', async () => {
  const p = project({ files: ['09_IM/im.md', '12_Final/im-a4.html', '12_Final/content.json'] });
  const r = await handlers(p.root).listReports({}, p.id);
  assert.equal(r.status, 200);

  const g = r.body.progress;
  assert.equal(g.total, 7, 'always 6 + 사양의 pdf 1');
  assert.equal(g.done, 3);
  assert.equal(g.percent, 43);
  assert.equal(g.conditional, 4, '분모 밖 산출물 수를 따로 준다');
  assert.ok(g.countsWhat, '무엇을 세는지가 없다');

  // 화면은 서버가 준 값을 그대로 쓴다
  assert.match(src, /서버가 준 분모를 그대로 쓴다/);
  assert.ok(!/percent\s*=\s*Math\.round/.test(src), '화면이 진행률을 다시 계산한다');
});

test('★★ 완성 보고서: 분모가 0 이면 % 를 만들지 않는다', async () => {
  // 0/0 을 100% 로 적으면 아무것도 안 만든 프로젝트가 「다 됐다」로 보인다.
  // always 가 하나라도 있으면 분모는 0 이 안 되므로, 계산 자체를 검사한다
  assert.equal(api.OUTPUTS.filter(o => o.when === 'always').length > 0, true);
  assert.match(src, /분모가 없으면 % 를 만들지 않는다/);
  assert.match(src, /p\.percent !== null && p\.percent !== undefined/);
});

test('완성 보고서: 사양을 못 읽으면 그 사실을 화면이 말한다', async () => {
  const p = project({ spec: null, files: ['09_IM/im.md'] });
  const r = await handlers(p.root).listReports({}, p.id);
  // 사양이 없으면 pdf 는 기대에서 빠진다 (6종)
  assert.equal(r.body.progress.total, 6);
  assert.match(src, /출력 사양을 읽지 못해/);
});

/* ───────────── 목록 ───────────── */

test('★ 완성 보고서: 안 나온 것도 목록에 남는다 — 빼면 「없는 기능」이 된다', async () => {
  const p = project({ files: ['09_IM/im.md'] });
  const r = await handlers(p.root).listReports({}, p.id);

  // files 는 나온 것만 (기존 호출부 호환), all 은 전부
  assert.equal(r.body.files.length, 1);
  assert.equal(r.body.all.length, api.OUTPUTS.length);
  r.body.all.forEach((f) => {
    assert.equal(typeof f.expected, 'boolean');
    assert.ok(f.when, `${f.id}: when 이 없다`);
  });

  // 화면이 셋으로 나눈다
  assert.match(src, /나온 문서 /);
  assert.match(src, /아직 안 나온 것 /);
  assert.match(src, /이 딜에서는 안 나오는 것 /);
});

test('★ 완성 보고서: 목록 이름을 화면이 따로 적지 않는다', () => {
  // 「감정평가서」·「평가의견서」로 보이면 받는 사람이 정식 평가로 읽는다.
  // 이름은 서버(OUTPUTS)가 정하고 화면은 그대로 그린다
  api.OUTPUTS.forEach((o) => {
    assert.ok(!src.includes(`'${o.name}'`), `화면이 이름을 박아 두었다: ${o.name}`);
  });
  // 주석에는 「쓰지 않는다」는 규칙이 적혀 있다 — 떼고 본다
  const body = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/감정평가서|평가의견서/.test(body), '오해를 부르는 이름이 화면에 뜬다');
});

/* ───────────── 100% 가 뜻하는 것 ───────────── */

test('★★ 완성 보고서: 100% 를 「보내도 된다」로 말하지 않는다', () => {
  assert.match(src, /100% 는 「만들어졌다」이지 「보내도 된다」가 아닙니다/);
  assert.match(src, /배포 전 교차검증/);
});

test('★★ 완성 보고서: 배포 차단을 목록보다 위에 둔다', () => {
  // 아래에 두면 파일 목록만 보고 내보낸다
  const blocker = src.indexOf('view.appendChild(b);');
  const list = src.indexOf('view.appendChild(list(d));');
  assert.ok(blocker > 0 && list > 0 && blocker < list, '차단 표시가 목록보다 아래에 있다');
  assert.match(src, /목록보다 위/);
});

test('★ 완성 보고서: 차단 상태에서는 내려받기를 열지 않는다', () => {
  // 목록에서는 「차단」인데 파일은 열린다면 검증 GATE 가 아무 의미도 없다
  assert.match(src, /if \(blocked \|\| !C\.api\)/);
  assert.match(src, /aria-disabled/);
});

/* ───────────── 붙이기 ───────────── */

test('★ 완성 보고서: 탭 이름이 flow-core 한 곳에서 나온다', () => {
  assert.equal(FLOW.OUTPUTS_SECTION.tab, '완성 보고서');
  assert.equal(FLOW.OUTPUTS_SECTION.file, 'outputs.html');
  assert.equal(FLOW.OUTPUTS_SECTION.plan, 'pro');
  // 「새 보고서 생성」과 나란히 있어야 한다 — 흩어지면 한쪽만 고치는 날 갈린다
  assert.equal(FLOW.SECTION.file, 'report-flow.html');
});

test('★ 완성 보고서: 탭 안에서는 자체 제목을 그리지 않는다', () => {
  assert.match(src, /if \(!C\.inTab\) view\.appendChild\(el\('h1', null, '완성 보고서'\)\);/);
  assert.match(src, /inTab: false,/);   // 단독으로 열 때 켜면 이름 없는 화면이 된다
});

test('★ 완성 보고서: 서버가 없으면 목록을 지어내지 않는다', () => {
  // 「생성됨」을 화면이 기억해 두면 파일이 없어져도 있다고 말한다
  assert.match(src, /서버가 연결되어 있지 않습니다/);
  assert.match(src, /화면만으로는 만들 수 없습니다/);
});

test('★ 완성 보고서: 구성안 화면이 「있다」로 바뀌었다', () => {
  const B = require('../ui/platform/build-tabs.js');
  const done = B.TABS.find(t => t.id === 'done');
  assert.equal(done.state, 'have', '화면을 만들었는데 구성안이 「없다」로 남아 있다');
  assert.match(done.stateText, /outputs\.html/);
  assert.equal(done.name, FLOW.OUTPUTS_SECTION.tab);
});

/* ═════════ 네 갈래 — 미리보기 · 다운로드 · 공유하기 · 프로젝트 이동 ═════════
 *
 * 〈2026-08-20 사용자 지시〉 설명 바로 아래에 넷을 둔다.
 *
 * ★★ 넷 다 **대상이 있어야 뜻이 있다.** 그래서 「뜨는가」가 아니라
 *   ① 무엇에 대고 누르는지 화면이 말하는가
 *   ② 배포가 막혔을 때 **정말로 안 열리는가** (여기가 뚫리면 게이트가 무의미하다)
 *   ③ 앱이 안 받았을 때 되는 척하지 않는가
 *   를 **실제 브라우저에서** 잰다.
 */

/** 데모 값을 심은 사본을 만들어 헤드리스로 띄운다 */
function stage(reports) {
  const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-out-acts-'));
  ['gate-core.js', 'flow-core.js', 'embed-bridge.js', 'tokens.css']
    .forEach(n => fs.copyFileSync(path.join(PLATFORM, n), path.join(dir, n)));
  const cfg = `<script>Object.assign(window.LINKPILOT_OUTPUTS, ${JSON.stringify({
    api: '/api', inTab: true, projectId: 'LP-DC-2026-001',
    session: { authenticated: true, planId: 'pro', status: 'active' },
    preload: { projects: [{ id: 'LP-DC-2026-001', name: '인천 남동 데이터센터' }], reports },
  })});</script>\n`;
  const at = src.indexOf('<script src="embed-bridge.js"');
  fs.writeFileSync(path.join(dir, 'outputs.html'), src.slice(0, at) + cfg + src.slice(at));
  return dir;
}

const REPORTS = (blocked) => ({
  progress: { percent: 67, done: 2, total: 3, countsWhat: '사양에 담은 것' },
  distribution: { blocked, reasons: blocked ? ['RED FLAG 2건 미해소'] : [] },
  all: [
    { name: 'IM 본문', path: '09_IM/im.md', exists: true, bytes: 84210 },
    { name: 'A4 최종본', path: '12_Final/im-a4.html', exists: true, bytes: 210400 },
    { name: '검증 보고서', path: '11_Validation/report.pdf', exists: false, expected: true, why: '검증을 아직 안 돌렸습니다' },
  ],
});

function run(dir, body) {
  const { findBrowser, renderDom } = require('../ui/platform/build-static.js');
  const probe = `<div id="probe"></div><script>(async function () {
    var sleep = function (m) { return new Promise(function (r) { setTimeout(r, m); }); };
    var t = function (n) { return n ? (n.textContent || '').trim().replace(/\\s+/g, ' ') : null; };
    var o = {};
    await sleep(200);
    ${body}
    document.getElementById('probe').textContent = JSON.stringify(o);
  }());</script>`;
  const page = path.join(dir, 'page.html');
  const html = fs.readFileSync(path.join(dir, 'outputs.html'), 'utf8');
  fs.writeFileSync(page, html.replace('</body>', probe + '</body>'));
  const dom = renderDom(findBrowser(), page);
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 스크립트가 죽었다');
  return JSON.parse(m[1]);
}

test('★★ 네 갈래가 설명 아래에 뜨고, 무엇에 대고 누르는지 말한다', () => {
  const { findBrowser } = require('../ui/platform/build-static.js');
  if (!findBrowser()) return;
  const dir = stage(REPORTS(false));
  try {
    const r = run(dir, `
      o.acts = [].slice.call(document.querySelectorAll('.act')).map(function (b) {
        return { n: t(b), off: b.disabled || b.getAttribute('aria-disabled') === 'true' }; });
      o.on = t(document.querySelector('.acts__on'));
      // 네 갈래가 목록보다 **앞**에 있어야 한다
      var kids = [].slice.call(document.getElementById('view').children);
      o.actsAt = kids.findIndex(function (n) { return !!n.querySelector('.acts'); });
      o.listAt = kids.findIndex(function (n) { return n.className.indexOf('grp') === 0; });
      // 다른 문서를 고르면 대상이 바뀐다
      [].slice.call(document.querySelectorAll('.doc--out'))[1].click();
      await sleep(120);
      o.after = t(document.querySelector('.acts__on'));
      // 미리보기를 편다
      [].slice.call(document.querySelectorAll('.act')).filter(function (b) {
        return t(b).indexOf('미리보기') === 0; })[0].click();
      await sleep(150);
      var fr = document.querySelector('.pv iframe');
      o.pv = fr ? { src: fr.getAttribute('src'), sandbox: fr.getAttribute('sandbox') } : null;
      var dl = [].slice.call(document.querySelectorAll('.act')).filter(function (b) { return t(b) === '다운로드'; })[0];
      o.dl = dl.getAttribute('href');
    `);
    assert.deepEqual(r.acts.map(a => a.n),
      ['미리보기', '다운로드', '공유하기', '프로젝트 이동'], '네 갈래가 없다');
    assert.deepEqual(r.acts.map(a => a.off), [false, false, false, false], '멀쩡한데 잠겨 있다');
    assert.ok(r.actsAt >= 0 && r.actsAt < r.listAt, '네 갈래가 목록보다 아래에 있다');
    // ★ 무엇에 대고 누르는지 — 안 적으면 어느 문서인지 모른 채 누른다
    assert.match(r.on, /고른 문서 IM 본문/, '고른 문서를 안 적는다');
    assert.match(r.after, /A4 최종본/, '줄을 골라도 대상이 안 바뀐다');
    // ★★ 미리보기는 **그 문서**를 연다. 산출물 스크립트를 이 화면 권한으로 돌리지 않는다
    assert.match(r.pv.src, /im-a4\.html/, '고른 문서가 아닌 것을 편다');
    assert.strictEqual(r.pv.sandbox, '', '미리보기가 sandbox 없이 열린다 — 산출물 스크립트가 돈다');
    assert.match(r.dl, /im-a4\.html/, '다운로드가 고른 문서를 안 가리킨다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('★★ 배포가 막히면 미리보기·다운로드·공유가 **정말로** 안 열린다', () => {
  const { findBrowser } = require('../ui/platform/build-static.js');
  if (!findBrowser()) return;
  const dir = stage(REPORTS(true));
  try {
    const r = run(dir, `
      o.acts = [].slice.call(document.querySelectorAll('.act')).map(function (b) {
        return { n: t(b), off: b.disabled || b.getAttribute('aria-disabled') === 'true' }; });
      o.why = t(document.querySelector('.acts__why'));
      // 잠긴 채로 눌러 본다 — 눌러서 열리면 게이트가 아무 의미도 없다
      [].slice.call(document.querySelectorAll('.act')).filter(function (b) {
        return t(b).indexOf('미리보기') === 0; })[0].click();
      await sleep(150);
      o.opened = !!document.querySelector('.pv iframe');
    `);
    const off = {};
    r.acts.forEach((a) => { off[a.n] = a.off; });
    assert.strictEqual(off['미리보기'], true, '막혔는데 미리보기가 열린다');
    assert.strictEqual(off['다운로드'], true, '막혔는데 내려받기가 열린다');
    assert.strictEqual(off['공유하기'], true, '막혔는데 공유가 열린다');
    // ★ 「프로젝트 이동」은 파일을 내보내는 일이 아니다 — 막지 않는다
    assert.strictEqual(off['프로젝트 이동'], false, '옮기는 것까지 막았다');
    assert.strictEqual(r.opened, false, '눌렀더니 실제로 펴졌다 — 게이트가 뚫렸다');
    assert.match(r.why, /배포가 막혀 있어/, '왜 잠겼는지 안 적는다 — 고장으로 읽힌다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('★★ 「프로젝트 이동」은 앱이 안 받으면 되는 척하지 않는다', () => {
  const { findBrowser } = require('../ui/platform/build-static.js');
  if (!findBrowser()) return;
  const dir = stage(REPORTS(false));
  try {
    const r = run(dir, `
      var go = function () { return [].slice.call(document.querySelectorAll('.act'))
        .filter(function (b) { return t(b) === '프로젝트 이동'; })[0]; };
      go().click();
      await sleep(120);
      o.noApp = [].slice.call(document.querySelectorAll('.acts__on')).map(t).join(' | ');
      // 앱이 받으면 (preventDefault) 다른 말을 해야 한다
      document.addEventListener('lp-open-project', function (e) { e.preventDefault(); });
      go().click();
      await sleep(120);
      o.withApp = [].slice.call(document.querySelectorAll('.acts__on')).map(t).join(' | ');
    `);
    assert.match(r.noApp, /스스로 옮길 수 없습니다/, '앱이 안 받았는데 넘겼다고 한다');
    assert.match(r.withApp, /넘겼습니다/, '앱이 받았는데도 못 옮긴다고 한다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('★ 「공유하기」는 남에게 열리는 링크를 만들지 않는다 (없는 것을 있는 척 안 한다)', () => {
  // 서버에 공유 링크를 내는 길이 없다. 주소 복사까지가 사실이고, 그 사실을 적는다
  assert.match(src, /navigator\.clipboard/, '공유가 무엇을 하는지 없다');
  assert.match(src, /로그인한 사람만/, '복사한 주소가 아무나 열리는 것처럼 읽힌다');
  const W = require('../ui/report-api.cjs');
  assert.ok(!W.ROUTES.some(r => /share/i.test(r.path)),
    '공유 라우트가 생겼다 — 화면 문구를 함께 고쳐야 한다');
});

/**
 * ★★ 눌러 볼 수 있는 판이 **빈 채로 나가지 않게** 한다 (`npm run im:outputs:live`).
 *
 * ★ 미리보기·내려받기는 iframe·`<a>` 가 **주소를 직접** 연다 — `fetch` 를 안 탄다.
 *   가짜 서버가 그 주소까지 바꿔 주지 않으면 눌렀을 때 **빈 칸**이 뜨고,
 *   빈 칸은 「고장」으로 읽힌다. 그래서 blob 으로 바꾸는 코드가 있는지 본다.
 */
test('★★ 완성 보고서: 눌러 볼 수 있는 판이 실제로 설정을 받고 나온다', async () => {
  const { buildLive } = require('../ui/platform/build-outputs.js');
  const { publishableLive } = require('../ui/platform/build-files.js');
  const out = path.join(os.tmpdir(), 'lp-outputs-live-test.html');
  try {
    await buildLive(out);
    const html = fs.readFileSync(out, 'utf8');

    // ① 설정 주입이 **설정 블록보다 뒤에** 있어야 한다. 앞이면 덮어써진다
    const cfg = html.search(/^window\.LINKPILOT_OUTPUTS\s*=/m);
    const inject = html.indexOf('Object.assign(window.LINKPILOT_OUTPUTS');
    assert.ok(cfg > 0 && inject > cfg, '설정 주입이 설정 블록보다 앞에 있다 — 덮어써진다');
    assert.match(html, /"authenticated":true/, '세션이 안 들어갔다 — 로그인 화면이 뜬다');

    // ② 가짜 서버가 **화면보다 먼저** 있어야 한다. 뒤면 첫 요청을 못 가로챈다
    const fake = html.indexOf('window.fetch = function');
    const screen = html.indexOf('<div class="pv-wrap">');
    assert.ok(fake > 0 && fake < screen, '가짜 서버가 화면보다 뒤에 있다 — 목록이 빈다');

    // ③ 주소를 직접 여는 것(iframe·a)까지 바꿔 준다 — 안 그러면 빈 칸이 뜬다
    assert.match(html, /createObjectURL/, '미리보기·내려받기가 빈 칸으로 열린다');

    // ④ 막힌 판 토글이 **새로 고쳐도 살아남는다**. 처음엔 변수에만 두어
    //    새로 고치는 순간 열린 판으로 되돌아갔다 — 눌러도 안 바뀌는 것처럼 보였다
    assert.match(html, /sessionStorage\.setItem\('lp-demo-blocked'/, '토글이 새로 고침을 못 넘긴다');
    assert.match(html, /sessionStorage\.getItem\('lp-demo-blocked'/, '저장한 것을 다시 안 읽는다');

    assert.deepEqual(publishableLive(html), [], '올릴 수 없는 조각이다');
    assert.match(html, /서버는 예시입니다/, '예시라는 표시가 없다 — 실제로 오해한다');
    assert.match(html, /실제 자료가 아닙니다/, '예시 자료라는 표시가 없다');
  } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
});
