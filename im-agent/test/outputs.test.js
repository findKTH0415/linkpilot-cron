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
