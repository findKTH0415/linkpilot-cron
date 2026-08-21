'use strict';
/**
 * no-browser.test.js — **크롬이 없는 서버**에서 산출물 목록이 무슨 말을 하는가
 * 〈2026-08-21 · 본체 종합 인수인계 교차검증에서 나왔다〉.
 *
 * ★★ 운영 NAS 에는 크롬이 없다(본체 문서 §1 사양). 그러면 PDF 세 종은
 *   **원리상 안 나온다** — 기다려도 안 나온다.
 *
 * ★★ 그런데 화면은 그것을 「아직 안 나왔다」로 그리고 있었다. 둘의 차이가
 *   사용자에게는 전부다:
 *     「아직」  → 기다린다
 *     「여기서는 못 만든다」 → 다른 길을 찾는다 (최종본 HTML 을 인쇄한다)
 *   구분해 말하지 않으면 사용자는 **나올 때까지 기다린다.**
 *
 * ★★ 그리고 분모에 두면 **어떤 딜도 100% 가 되지 않는다.** 다 끝났는데
 *   덜 된 것처럼 보이는 화면은 「거의 다 됐나 보다」로 읽혀서, 정작 진짜로
 *   덜 된 딜과 구분이 안 된다.
 *
 * ★ 반대쪽도 지킨다: **모르는 것을 「없다」로 그리지 않는다.** 브라우저를
 *   못 찾겠으면 `null` 이고, 그때는 아무것도 빼지 않는다 — 되는 서버에서
 *   PDF 가 목록에서 사라지는 쪽이 더 나쁘다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const api = require('../ui/report-api.cjs');

function bareProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-nb-'));
  const id = 'LP-DC-2026-001';
  fs.mkdirSync(path.join(root, id, '01_Project'), { recursive: true });
  fs.mkdirSync(path.join(root, id, '12_Final'), { recursive: true });
  return { root, id, dir: path.join(root, id) };
}

function h(root, extra) {
  return api.createHandlers(Object.assign({
    agentRoot: root, agentModulePath: path.join(__dirname, '..'),
    authenticate: () => ({ name: '테스트', planId: 'pro', status: 'active' }),
  }, extra || {}));
}

/* ═════════ ① 표가 무엇이 브라우저를 요구하는지 알고 있다 ═════════ */

test('★ 브라우저가 필요한 산출물이 표에 표시돼 있다', () => {
  const need = api.OUTPUTS.filter(o => o.needsBrowser).map(o => o.id).sort();
  // 크롬으로 인쇄해서 만드는 것 셋. 늘거나 줄면 여기도 같이 고친다
  assert.deepStrictEqual(need, ['corp_pdf', 'desk_pdf', 'pdf'],
    `브라우저가 필요한 산출물 목록이 달라졌다: ${need.join(' · ')}`);
  // ★ 모든 PDF 가 표시돼 있는가 — 하나 빠지면 그것만 영영 분모에 남는다
  api.OUTPUTS.filter(o => /\.pdf$/.test(o.rel)).forEach((o) => {
    assert.ok(o.needsBrowser, `${o.id} 는 PDF 인데 needsBrowser 표시가 없다`);
  });
});

/* ═════════ ② 분모 판정 ═════════ */

test('★★ 브라우저가 없으면 PDF 를 분모에서 뺀다 (안 그러면 영영 100% 가 안 된다)', () => {
  const pdf = api.OUTPUTS.find(o => o.id === 'pdf');
  const spec = { formats: ['pdf', 'html'] };

  // 사양에 PDF 가 있어도 **서버가 못 만들면** 기대하지 않는다
  assert.equal(api.isExpected(pdf, spec, false), false, '브라우저가 없는데 분모에 넣는다');
  // 있으면 사양대로 판정한다
  assert.equal(api.isExpected(pdf, spec, true), true, '브라우저가 있는데 분모에서 뺐다');
  // ★★ **모르면 빼지 않는다** — 되는 서버에서 PDF 가 사라지는 쪽이 더 나쁘다
  assert.equal(api.isExpected(pdf, spec, null), true, '판정 못 한 것을 「없다」로 다뤘다');
  assert.equal(api.isExpected(pdf, spec, undefined), true, '판정 못 한 것을 「없다」로 다뤘다');

  // 브라우저와 무관한 것은 영향을 안 받는다
  const im = api.OUTPUTS.find(o => o.id === 'im');
  assert.equal(api.isExpected(im, spec, false), true, '브라우저와 무관한 것까지 뺐다');
});

/* ═════════ ③ 목록은 남기고 **이유를 바꿔 말한다** ═════════ */

test('★★ 크롬이 없는 서버: PDF 가 목록에 남되 「여기서는 못 만든다」고 말한다', async () => {
  const p = bareProject();
  // 브라우저 못 찾는 상황을 그대로 만든다 (실제 NAS 와 같은 조건)
  const raster = require('../core/raster');
  const real = raster.findBrowser;
  raster.findBrowser = () => null;
  try {
    const r = await h(p.root).listReports({}, p.id);
    assert.equal(r.status, 200);
    assert.equal(r.body.hasBrowser, false, '서버가 못 하는 것을 화면에 안 알린다');

    const by = {};
    r.body.all.forEach((f) => { by[f.id] = f; });

    // ① 목록에서 **지우지 않는다** — 지우면 「나올 수 있었다」는 사실까지 사라진다
    assert.ok(by.pdf, 'PDF 가 목록에서 통째로 사라졌다');
    // ② 분모 밖
    assert.equal(by.pdf.expected, false, 'PDF 가 분모에 남아 있다');
    // ③ **왜** 못 나오는지, 그리고 **대신 무엇이 있는지**
    assert.equal(by.pdf.impossible, true, '「기다리면 나온다」와 구분해 주지 않는다');
    assert.match(by.pdf.why, /브라우저가 없어/, '못 만드는 이유를 안 말한다');
    assert.match(by.pdf.why, /im-a4\.html/, '대신 무엇을 보면 되는지 안 말한다');

    // ④ 브라우저와 무관한 것은 그대로다
    assert.equal(by.im.impossible, false, '무관한 산출물까지 못 만든다고 한다');
    assert.equal(by.im.expected, true);
  } finally { raster.findBrowser = real; fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('★ 브라우저가 있는 서버에서는 아무것도 달라지지 않는다', async () => {
  const p = bareProject();
  const raster = require('../core/raster');
  const real = raster.findBrowser;
  raster.findBrowser = () => '/어딘가/chrome';
  try {
    const r = await h(p.root).listReports({}, p.id);
    assert.equal(r.body.hasBrowser, true);
    const pdf = r.body.all.find(f => f.id === 'pdf');
    assert.equal(pdf.impossible, false, '브라우저가 있는데 못 만든다고 한다');
    // 사양을 못 읽었으므로 format:pdf 는 분모 밖이다 — 그건 원래 규칙이다
    assert.match(pdf.why || '', /출력 사양/, '원래 안내가 사라졌다');
  } finally { raster.findBrowser = real; fs.rmSync(p.root, { recursive: true, force: true }); }
});

/* ═════════ ④ 진행률이 실제로 100% 에 닿는가 ═════════ */

/**
 * ★★ 이 검사가 이 파일의 **본론**이다. 위의 것들이 다 맞아도 진행률이 안 차면
 *   사용자 눈에는 아무것도 안 고쳐진 것이다.
 */
test('★★ 크롬 없는 서버에서도 다 만들면 진행률이 100% 가 된다', async () => {
  const p = bareProject();
  const raster = require('../core/raster');
  const real = raster.findBrowser;
  raster.findBrowser = () => null;
  try {
    // 브라우저 없이 나올 수 있는 것을 전부 만들어 둔다
    api.OUTPUTS.filter(o => o.when === 'always' && !o.needsBrowser).forEach((o) => {
      const full = path.join(p.dir, o.rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, 'x');
    });
    const r = await h(p.root).listReports({}, p.id);
    assert.equal(r.body.progress.percent, 100,
      `다 만들었는데 ${r.body.progress.percent}% 다 — 못 나오는 것이 분모에 남아 있다`);
    assert.equal(r.body.progress.done, r.body.progress.total);
  } finally { raster.findBrowser = real; fs.rmSync(p.root, { recursive: true, force: true }); }
});
