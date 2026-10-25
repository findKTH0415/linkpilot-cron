'use strict';
/**
 * report-v2.test.js — **보고서 만들기 v2 · 1단계 «배치»** 〈2026-10-25 사장님: 「단계별로 다시 짓기」 · 「디자인 레이아웃 반영해줘」〉
 *
 * 재는 것 아홉:
 *   ① 엔진 카드의 장·쪽·표지 글자가 **엔진에서 온 값**인가 (im-outline · outputspec · 06-im-writer 와 대 본다)
 *   ② 분류 3칸을 누르면 문서 양식 카드 묶음이 바뀌는가 (그려서 누른다)
 *   ③ 준비 중 카드는 «준비 중»이고, 눌러도 만들 종류(docType)가 안 바뀌는가
 *   ④ 사실 표의 이름표가 **서버 값(origin·source)** 에서 나오는가 — 표본 값이 아니라
 *   ⑤ 되묻기 카드 — 선택지 셋 + 보류, 숫자 키로 고르는가
 *   ⑥ 10칸 — 지금 흐름이 덮는 여섯만 «열림», 넷은 «준비 중»이고 끝난 것으로 안 칠한다
 *   ⑦ 진행 % 가 상수가 아니다 — 잰 사실이 바뀌면 바뀐다
 *   ⑧ 기능 옵션 — 엔진이 못 만드는 형식은 눌리지 않는다
 *   ⑨ 폰(390) 폭에서 한 칸으로 쌓이고 가로로 안 넘친다
 *   ⑩ [출력디자인] 칩을 바꾸면 기능 옵션의 분량과 썸네일이 «같이» 바뀐다 — 상태 하나 (사장님 추가 지시)
 *   ⑪ [크게 보기] 가 만든 문서가 있으면 실제 파일 주소(…/file?rel=)를 연다 — 가짜 창이 아니다
 *   ⑫ 디자인·레이아웃 10종 — 지침 §3 글자 그대로 · 컬러 참조 넷이 부록 A 값 · [이 디자인 사용] 이 진행 카드와 같은 상태
 * ★ 디자인 파일의 예시 값(안산 데이터센터 …)이 화면 소스에 없다는 것도 함께 잰다 (§8).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const AGENT = path.join(__dirname, '..');
const PLATFORM = path.join(AGENT, 'ui', 'platform');
const F = require(path.join(PLATFORM, 'flow-core.js'));
const { findBrowser } = require(path.join(PLATFORM, 'build-static.js'));

/* ── ① 엔진 값 ───────────────────────────────────────── */
test('① 엔진 카드의 장·쪽·표지 글자가 엔진 값과 같다', () => {
  const { IM_SECTIONS, TEASER_ITEMS } = require(path.join(AGENT, 'templates', 'im-outline.js'));
  const { PRESETS } = require(path.join(AGENT, 'core', 'outputspec.js'));
  const writer = fs.readFileSync(path.join(AGENT, 'agents', '06-im-writer.js'), 'utf8');
  assert.strictEqual(F.ENGINE_DOCS.im.chapters, IM_SECTIONS.length, 'IM 장 수가 im-outline 과 다르다');
  assert.strictEqual(F.ENGINE_DOCS.teaser.items, TEASER_ITEMS.length, '티저 항목 수가 im-outline 과 다르다');
  ['im', 'teaser', 'summary'].forEach((k) => {
    assert.strictEqual(F.ENGINE_DOCS[k].pages, PRESETS[k].targetPages, `${k} 쪽수가 outputspec 과 다르다`);
    assert.ok(writer.includes('# ' + F.ENGINE_DOCS[k].cover), `${k} 표지 글자 «${F.ENGINE_DOCS[k].cover}» 를 06-im-writer 가 안 쓴다`);
  });
  /* 엔진 카드는 엔진 종류를 가리키고, 그 밖은 «예정» 으로만 적힌다 */
  F.V2_DOCS.forEach((d) => {
    if (d.engine) assert.ok(F.ENGINE_DOCS[d.engine], `${d.id}: 모르는 엔진 종류 ${d.engine}`);
    else {
      assert.match(F.v2DocMeta(d), /예정$/, `${d.id}: 준비 중 카드의 장·쪽이 «예정» 이 아니다`);
      assert.doesNotMatch(F.v2DocMeta(d, true), /예정/, `${d.id}: 카드 겉모습은 견본 글자 그대로여야 한다`);
    }
  });
  assert.deepStrictEqual(F.V2_DOCS.filter((d) => d.engine).map((d) => d.id).sort(), ['im', 'so', 'teaser']);
});

test('★ 디자인 파일의 예시 값이 화면 소스에 없다', () => {
  ['report-flow.html', 'flow-core.js'].forEach((f) => {
    const s = fs.readFileSync(path.join(PLATFORM, f), 'utf8');
    ['안산', '데이터센터 개발사업', '12,180', '임차의향서', 'PDI Global Infra'].forEach((w) => {
      assert.ok(!s.includes(w), `${f}: 예시 값 «${w}» 가 들어 있다`);
    });
  });
});

/* ── ⑥ ⑦ 순수 셈 ─────────────────────────────────────── */
function secs(overrides) {
  return ['basics', 'ask', 'sources', 'make', 'spec', 'done'].map((id) => Object.assign({ id, locked: false, hidden: false }, (overrides || {})[id]));
}
test('⑥ 10칸 — 열림 여섯 · 준비 중 넷, 준비 중은 끝난 것으로 안 칠한다', () => {
  const all = { basics: { known: true, done: true }, ask: { known: true, done: true }, sources: { known: true, done: true },
    make: { known: true, done: true }, spec: { known: true, done: true }, done: { known: false, done: false } };
  const st = F.v2Steps({ progress: all, sections: secs(), made: 3, current: 'done', specLocked: true });
  assert.strictEqual(st.length, 10);
  assert.deepStrictEqual(st.filter((s) => s.live).map((s) => s.no), [1, 2, 5, 6, 8, 10]);
  assert.deepStrictEqual(st.filter((s) => !s.live).map((s) => s.no), [3, 4, 7, 9]);
  st.filter((s) => !s.live).forEach((s) => {
    assert.strictEqual(s.done, false, `${s.no}: 준비 중 칸이 끝난 것으로 칠해졌다`);
    assert.ok(s.locked && s.why, `${s.no}: 준비 중 칸에 이유가 없다`);
  });
  assert.strictEqual(st[9].done, null, '내려받았는지는 못 잰다 — null 이어야 한다');
  assert.strictEqual(st.filter((s) => s.current)[0].no, 10);
  assert.strictEqual(F.v2StepOf('spec', false), 6);
  assert.strictEqual(F.v2StepOf('spec', true), 8);
});

test('⑦ 진행 % 는 잰 사실에서 나온다 — 상수가 아니다', () => {
  const none = F.v2Progress(F.v2Steps({ progress: {}, sections: secs(), made: null, current: 'basics' }));
  const some = F.v2Progress(F.v2Steps({ progress: { basics: { known: true, done: true }, ask: { known: true, done: true },
    sources: { known: true, done: true } }, sections: secs(), made: 0, current: 'sources' }));
  const most = F.v2Progress(F.v2Steps({ progress: { basics: { known: true, done: true }, ask: { known: true, done: true },
    sources: { known: true, done: true }, make: { known: true, done: true }, spec: { known: true, done: true } },
  sections: secs(), made: 2, current: 'spec', specLocked: true }));
  assert.deepStrictEqual([none.pct, some.pct, most.pct], [0, 20, 50]);
  assert.ok(most.pct <= 60, '준비 중 넷은 셀 수 없으니 상한은 60 이다');
});

test('④ 이름표는 서버가 넘긴 origin·source 에서 나온다', () => {
  assert.deepStrictEqual(F.v2Tag({ value: 1, source: '사업계획서.pdf, p.6', page: 6, origin: 'document' }),
    { kind: 'doc', text: '올린 자료 · 사업계획서 6쪽' });
  assert.deepStrictEqual(F.v2Tag({ value: 'x', source: '토지이음', origin: 'public' }), { kind: 'public', text: '공공자료 · 토지이음' });
  assert.strictEqual(F.v2Tag(null).kind, 'need');
  assert.strictEqual(F.v2Tag({ value: 1, source: 'a.pdf', origin: 'document', alternatives: [{ value: 2 }] }).kind, 'split');
  assert.strictEqual(F.v2FactRows(null), null, '못 쟀으면 줄을 만들지 않는다');
  assert.strictEqual(F.v2FactRows({}).every((r) => r.tag.kind === 'need'), true);
  assert.strictEqual(F.v2Tag({ value: 1, source: 'a.pdf', origin: 'document', alternatives: [{ value: 2 }] }).text, '자료 필요', '견본 397 — 값이 갈린 줄도 «자료 필요»');
});

test('⑫ 디자인·레이아웃 10종 — 지침 §3 글자 · 부록 A 값', () => {
  const guide = path.join(AGENT, '..', 'docs', '운영지침-보고서-디자인레이아웃10종-v1.0.md');
  assert.strictEqual(F.V2_DS.length, 10);
  assert.deepStrictEqual(F.V2_DS.map((t) => t.id), Array.from({ length: 10 }, (_, i) => 'LP-DS-' + String(i + 1).padStart(2, '0')));
  const md = fs.readFileSync(guide, 'utf8');
  F.V2_DS.forEach((t) => {
    assert.ok(md.includes(`| ${t.id} | ${t.name} | ${t.layout} | ${t.use} | ${t.latin} |`), `${t.id}: §3 표 글자와 다르다`);
    t.refs.forEach((r) => {
      const m = new RegExp('\\| `' + r.replace(/[-]/g, '\\-') + '` \\| `([^`]+)`').exec(md);
      assert.ok(m, `${r}: 부록 A 에 없다`);
      assert.strictEqual(F.V2_DS_TOKENS[r], m[1], `${r}: 부록 A 값과 다르다`);
    });
  });
  assert.deepStrictEqual(F.V2_IM_SIZES.map((x) => x[1]), [18, 14, 10, 12, 10, 8, 7]);
});

/* ── 그려서 재는 칸 ───────────────────────────────────── */
const PRE = {
  issuerSet: true, issuerName: '시험 발행사',
  fields: { 'land.area_sqm': { label: '대지면적', unit: '㎡' }, 'building.gfa_sqm': { label: '연면적', unit: '㎡' } },
  values: {
    'project.name': { value: '시험 사업', source: '계획서.pdf', page: 1, origin: 'document' },
    'land.zoning': { value: '준공업지역', source: '토지이음', origin: 'public' },
    'land.area_sqm': { value: 100, source: '계획서.pdf', page: 2, origin: 'document', alternatives: [{ value: 90, sources: ['대장.pdf, p.1'] }] },
  },
  sourceFiles: ['계획서.pdf', '대장.pdf'],
  spec: { locked: false, targetPages: 40, formats: ['pdf'], pageSize: 'A4', orientation: 'portrait', language: 'ko' },
};

/* 화면 안에서 누르고 결과를 문서 뿌리의 속성으로 남긴다 — dump-dom 이 그것을 돌려준다 */
const ACT = `
<script>
window.addEventListener('load', function () { setTimeout(function () {
  var R = {}, q = function (s) { return document.querySelector(s); }, qa = function (s) { return [].slice.call(document.querySelectorAll(s)); };
  function docs() { return qa('[data-lp-rv2-doc]').map(function (n) { return n.getAttribute('data-lp-rv2-doc') + ':' + n.getAttribute('data-lp-rv2-ready'); }); }
  R.cats = qa('[data-lp-rv2-cat]').length;
  ['plan', 'invest', 'finance'].forEach(function (c) { q('[data-lp-rv2-cat="' + c + '"]').click(); R[c] = docs(); });
  var title0 = (q('.rv2-prog__t') || {}).textContent;
  q('[data-lp-rv2-doc="la"]').click();
  R.afterSoon = { title: (q('.rv2-prog__t') || {}).textContent, same: (q('.rv2-prog__t') || {}).textContent === title0,
    pressed: q('[data-lp-rv2-doc="la"]').getAttribute('aria-pressed'),
    kinds: qa('[data-lp-rv2-kinds="la"] button').map(function (b) { return b.getAttribute('aria-disabled'); }) };
  q('[data-lp-rv2-cat="invest"]').click();
  R.tags = qa('[data-lp-rv2-fact]').map(function (li) { var t = li.querySelector('[data-lp-rv2-tag]'); return li.getAttribute('data-lp-rv2-fact') + '|' + (t ? t.getAttribute('data-lp-rv2-tag') + '|' + t.textContent : '-'); });
  R.opts = qa('[data-lp-rv2-opt]').map(function (b) { return b.getAttribute('data-lp-rv2-opt'); });
  R.optText = qa('[data-lp-rv2-opt]').map(function (b) { return b.textContent; });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
  R.picked = qa('[data-lp-rv2-opt][aria-pressed="true"]').map(function (b) { return b.getAttribute('data-lp-rv2-opt'); });
  R.prog = q('[data-lp-rv2-prog]') ? q('[data-lp-rv2-prog]').getAttribute('data-lp-rv2-prog') : null;
  R.steps = qa('[data-lp-rv2-step]').map(function (b) { return b.getAttribute('data-lp-rv2-step'); });
  R.formats = qa('[data-lp-rv2-format]').map(function (b) { return b.getAttribute('data-lp-rv2-format') + ':' + (b.getAttribute('aria-disabled') === 'true' ? 'off' : 'on'); });
  R.font = (q('[data-lp-rv2-font]') || {}).textContent || '';
  R.big = q('[data-lp-rv2-big]') ? { kind: q('[data-lp-rv2-big]').getAttribute('data-lp-rv2-big'), href: q('[data-lp-rv2-big]').getAttribute('href') } : null;
  /* ⑩ 한 상태 — 출력디자인에서 60쪽·English 를 고르면 기능 옵션의 분량과 썸네일이 같이 바뀐다 */
  R.thumb0 = q('[data-lp-rv2-thumb]').getAttribute('data-lp-rv2-thumb');
  q('[data-lp-rv2-ptab="design"]').click();
  q('[data-lp-rv2-out="pages:60"]').click();
  q('[data-lp-rv2-out="lang:en"]').click();
  R.lenAfter = qa('[data-lp-rv2-len]').filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; }).map(function (b) { return b.getAttribute('data-lp-rv2-len'); });
  /* 기능 옵션의 분량을 누르면 진행 카드 쪽도 같이 바뀐다 */
  q('[data-lp-rv2-len="20"]').click();
  R.designAfter = qa('[data-lp-rv2-out^="pages:"]').filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; }).map(function (b) { return b.getAttribute('data-lp-rv2-out'); });
  /* ⑫ 10종 — [이 디자인 사용] 이 출력디자인·옵션·썸네일과 같은 상태 */
  R.dsCount = qa('[data-lp-rv2-dstype]').length;
  q('[data-lp-rv2-dsuse="LP-DS-02"]').click();
  R.dsPressed = qa('[data-lp-rv2-out^="ds:"]').filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; }).map(function (b) { return b.getAttribute('data-lp-rv2-out'); });
  R.dsOpt = (q('.rv2-pick b') || {}).textContent;
  q('[data-lp-rv2-ptab="view"]').click();
  R.thumb1 = q('[data-lp-rv2-thumb]').getAttribute('data-lp-rv2-thumb');
  R.coverDs = q('[data-lp-rv2-ds]') ? q('[data-lp-rv2-ds]').getAttribute('data-lp-rv2-ds') : null;
  R.text = document.body.innerText;
  R.w = { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  var L = q('.rf-left'), M = q('.rf-main');
  if (L && M) R.stack = { leftBottom: Math.round(L.getBoundingClientRect().bottom), mainTop: Math.round(M.getBoundingClientRect().top) };
  R.vw = window.innerWidth;
  document.documentElement.setAttribute('data-rv2-test', JSON.stringify(R));
  try { parent.postMessage({ rv2: R }, '*'); } catch (_) {}
}, 400); });
</script>`;

function build(pre) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-rv2-'));
  require(path.join(PLATFORM, 'build-embed.js')).build(dir);
  let html = fs.readFileSync(path.join(dir, 'report-flow.html'), 'utf8');
  const stub = '<script>window.LINKPILOT_PREVIEW_DOCS=' + JSON.stringify(Object.fromEntries(F.STEPS.map((s) => [s.id,
    '<!doctype html><html><head><meta charset="utf-8"></head><body><p>대역</p></body></html>']))).replace(/<\//g, '<\\/') + ';'
    + (pre ? 'window.__RV2PRE=' + JSON.stringify(pre) + ';' : '') + '</script>';
  html = html.replace('<head>', '<head>' + stub);
  if (pre) {
    assert.ok(/\n  preload: null,/.test(html), '설정의 preload 자리를 못 찾았다');
    html = html.replace(/\n  preload: null,/, '\n  preload: window.__RV2PRE,');
  }
  const at = html.lastIndexOf('</body>');
  html = html.slice(0, at) + ACT + html.slice(at);
  fs.writeFileSync(path.join(dir, 'rv2.html'), html);
  return dir;
}
function run(browser, file, width) {
  const out = execFileSync(browser, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=' + (width || 1366) + ',900', '--virtual-time-budget=8000', '--dump-dom', 'file://' + file],
  { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const m = /data-rv2-test="([^"]*)"/.exec(out);
  if (!m) return null;
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}

test('②③④⑤⑦⑧ 그려서 누른다 — 분류·카드·이름표·되묻기·진행·형식', (t) => {
  const browser = findBrowser();
  if (!browser) { t.skip('크로미움이 없다 — 못 쟀다'); return; }
  const dir = build(PRE);
  const R = run(browser, path.join(dir, 'rv2.html'), 1366);
  assert.ok(R, '화면이 결과를 남기지 않았다 — 그리다 멈췄다');
  // ② 분류 3칸 → 카드 묶음 (준비 중도 겉모습은 같고, 표시만 갈린다)
  assert.strictEqual(R.cats, 3);
  assert.deepStrictEqual(R.plan, ['so:engine', 'bp:soon', 'fs:soon']);
  assert.deepStrictEqual(R.invest, ['teaser:engine', 'im:engine', 'ts:soon', 'ir:soon']);
  assert.deepStrictEqual(R.finance, ['la:soon', 'imf:soon', 'cp:soon', 'dd:soon']);
  // ③ 준비 중 카드는 고를 수는 있어도 만들 종류를 안 바꾼다 · 종류 칩은 동작 없음
  assert.strictEqual(R.afterSoon.pressed, 'true');
  assert.ok(R.afterSoon.same, '준비 중 카드를 눌렀더니 진행 카드의 문서가 바뀌었다: ' + R.afterSoon.title);
  assert.deepStrictEqual(R.afterSoon.kinds, ['true', 'true', 'true', 'true']);
  // ④ 이름표
  assert.ok(R.tags.includes('project.name|doc|올린 자료 · 계획서 1쪽'), R.tags.join(' / '));
  assert.ok(R.tags.includes('land.zoning|public|공공자료 · 토지이음'), R.tags.join(' / '));
  assert.ok(R.tags.some((x) => /^land\.area_sqm\|split\|자료 필요/.test(x)), R.tags.join(' / '));
  assert.ok(R.tags.some((x) => /^investment\.total\|need\|자료 필요/.test(x)), R.tags.join(' / '));
  // ⑤ 되묻기 — 견본 차례(다른 자료 → 지금 값 → 둘 다)
  assert.deepStrictEqual(R.opts, ['1', '2', '3', 'hold']);
  assert.match(R.optText[0], /^1대장 값 90㎡를 씁니다$/);
  assert.match(R.optText[1], /^2계획서 값 100㎡를 씁니다$/);
  assert.deepStrictEqual(R.picked, ['2'], '숫자 키 2 가 안 먹었다');
  // ⑥ 10칸
  assert.strictEqual(R.steps.length, 10);
  assert.deepStrictEqual(R.steps.map((s, i) => [i + 1, s]).filter((x) => x[1] === 'soon').map((x) => x[0]), [3, 4, 7, 9]);
  // ⑧ 형식
  assert.deepStrictEqual(R.formats, ['pdf:on', 'hwp:off', 'docx:off', 'pptx:off', 'html:on', 'mhtml:off']);
  assert.match(R.font, /페이퍼로지/);
  // ⑩ 한 상태
  assert.notStrictEqual(R.thumb0, R.thumb1, '칩을 바꿨는데 썸네일이 그대로다');
  assert.deepStrictEqual(R.lenAfter, ['60'], '출력디자인에서 60쪽을 골랐는데 기능 옵션의 분량이 안 따라왔다');
  assert.deepStrictEqual(R.designAfter, ['pages:20'], '기능 옵션에서 20쪽을 골랐는데 출력디자인이 안 따라왔다');
  assert.match(R.thumb1, /^20\|LP-DS-02\|en$/, '썸네일이 상태 하나를 안 읽는다: ' + R.thumb1);
  // ⑫ 10종
  assert.strictEqual(R.dsCount, 10);
  assert.deepStrictEqual(R.dsPressed, ['ds:LP-DS-02']);
  assert.strictEqual(R.dsOpt, '부동산·투자 IM형');
  assert.strictEqual(R.coverDs, 'LP-DS-02');
  // ⑪ 만든 문서가 없으면 [크게 보기] 는 아무 데도 안 간다
  assert.strictEqual(R.big.kind, 'none');
  // 견본 표본 글자 0
  ['안산', '데이터센터 개발사업', 'PDI GLOBAL', '임차의향서'].forEach((w) => assert.ok(!R.text.includes(w), '견본 표본 글자 «' + w + '» 가 화면에 있다'));
  //    프로젝트가 있으면(주소 ?project=) 1·2칸이 끝나 20 이 된다 — 같은 화면, 다른 사실
  const R1 = run(browser, path.join(dir, 'rv2.html') + '?project=LP-TEST-1', 1366);
  assert.ok(R1, '프로젝트 판이 결과를 안 남겼다');
  assert.strictEqual(R.prog, '0', '프로젝트 없음 — 끝난 칸이 없어야 한다');
  assert.strictEqual(R1.prog, '20', '프로젝트 있음 — 1·2칸이 끝나 20 이어야 한다');
  // ⑪ 만든 문서가 있으면 [크게 보기] 가 실제 파일 주소를 연다
  const dir2 = build(Object.assign({}, PRE, { reports: { files: [{ exists: true, path: '12_Final/im-a4.pdf' }] } }));
  const R2 = run(browser, path.join(dir2, 'rv2.html') + '?project=LP-TEST-1', 1366);
  assert.ok(R2 && R2.big, '문서 판이 결과를 안 남겼다');
  assert.strictEqual(R2.big.kind, 'file');
  assert.match(R2.big.href, /\/projects\/LP-TEST-1\/file\?rel=12_Final%2Fim-a4\.pdf$/);
});

test('⑨ 폰(390) 폭에서 한 칸으로 쌓이고 가로로 안 넘친다', (t) => {
  const browser = findBrowser();
  if (!browser) { t.skip('크로미움이 없다 — 못 쟀다'); return; }
  const dir = build(PRE);
  /* 헤드리스 창은 390 으로 안 줄어든다(CLAUDE.md §8-1 · 실측 485) — 폭이 정확한 틀에 넣고 잰다 */
  fs.writeFileSync(path.join(dir, 'frame.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">'
    + '<iframe src="rv2.html" style="width:390px;height:2400px;border:0"></iframe>'
    + '<script>addEventListener("message",function(e){if(e.data&&e.data.rv2)document.documentElement.setAttribute("data-rv2-test",JSON.stringify(e.data.rv2));});</script>'
    + '</body></html>');
  const R = run(browser, path.join(dir, 'frame.html'), 1000);
  assert.ok(R, '틀 안 화면이 결과를 안 보냈다 — 못 쟀다');
  assert.strictEqual(R.vw, 390, '390 폭으로 못 쟀다 (' + R.vw + ')');
  assert.ok(R.w.sw <= R.w.cw, '가로로 넘친다: ' + JSON.stringify(R.w));
  assert.ok(R.stack && R.stack.leftBottom <= R.stack.mainTop, '왼쪽 칸과 오른쪽 칸이 나란히 섰다 — 한 칸으로 안 쌓였다: ' + JSON.stringify(R.stack));
});

/* ── ⑬⑭⑮ Codex P2 #571 — 저장 겹침 · 열린 틀 보존 · 문서 종류 = 서버 사양 한 벌 ── */
const FAKE = `<script>
window.__posts = []; window.__open = 0; window.__maxOpen = 0;
window.fetch = function (u, o) {
  u = String(u);
  if (o && o.method === 'POST' && /\\/spec$/.test(u)) {
    var b = JSON.parse(o.body); var n = window.__posts.push(b);
    window.__open++; window.__maxOpen = Math.max(window.__maxOpen, window.__open);
    var delay = n === 1 ? 300 : 30;   /* 첫 대답이 늦게 온다 — 옛 판은 둘째 뒤에 첫째가 도착해 화면을 되돌렸다 */
    return new Promise(function (res) { setTimeout(function () { window.__open--;
      res(new Response(JSON.stringify({ spec: Object.assign({ locked: false }, b) }), { status: 200, headers: { 'Content-Type': 'application/json' } })); }, delay); });
  }
  return Promise.reject(new Error('no net'));
};
</script>`;
const ACT2 = `
<script>
window.addEventListener('load', function () { setTimeout(function () {
  var R = {}, q = function (s) { return document.querySelector(s); }, qa = function (s) { return [].slice.call(document.querySelectorAll(s)); };
  var fr = q('iframe[name="lp-flow-basics"]');
  try { fr.contentDocument.getElementById('t').value = 'typed'; } catch (_) { R.cantType = true; }
  fr.__mark = 1;
  q('[data-lp-rv2-ptab="design"]').click();
  q('[data-lp-rv2-out="pages:60"]').click();
  q('[data-lp-rv2-len="20"]').click();
  setTimeout(function () {
    R.maxOpen = window.__maxOpen;
    R.posts = window.__posts.map(function (b) { return b.docType + ':' + b.targetPages; });
    R.len = qa('[data-lp-rv2-len]').filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; }).map(function (b) { return b.getAttribute('data-lp-rv2-len'); });
    q('[data-lp-rv2-ptab="view"]').click();
    R.thumb = q('[data-lp-rv2-thumb]').getAttribute('data-lp-rv2-thumb');
    var fr2 = q('iframe[name="lp-flow-basics"]');
    R.sameFrame = fr2 === fr && fr2.__mark === 1;
    try { R.typed = fr2.contentDocument.getElementById('t').value; } catch (_) { R.typed = null; }
    q('[data-lp-rv2-doc="im"]').click();
    setTimeout(function () {
      R.postsAfter = window.__posts.map(function (b) { return b.docType + ':' + b.targetPages; });
      try { R.specGot = q('iframe[name="lp-flow-spec"]').contentDocument.body.getAttribute('data-got'); } catch (_) { R.specGot = null; }
      R.progTitle = (q('.rv2-prog__t') || {}).textContent;
      document.documentElement.setAttribute('data-rv2-test', JSON.stringify(R));
    }, 300);
  }, 700);
}, 400); });
</script>`;

function build2(pre) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-rv2b-'));
  require(path.join(PLATFORM, 'build-embed.js')).build(dir);
  let html = fs.readFileSync(path.join(dir, 'report-flow.html'), 'utf8');
  const stub = (id) => '<!doctype html><html><head><meta charset="utf-8"></head><body><input id="t">'
    + (id === 'spec' ? '<script>addEventListener("message",function(e){document.body.setAttribute("data-got",JSON.stringify(e.data));});<\/script>' : '')
    + '</body></html>';
  const docs = Object.fromEntries(F.STEPS.map((s) => [s.id, stub(s.id)]));
  html = html.replace('<head>', '<head>' + FAKE + '<script>window.LINKPILOT_PREVIEW_DOCS=' + JSON.stringify(docs).replace(/<\//g, '<\\/')
    + ';window.__RV2PRE=' + JSON.stringify(pre) + ';</script>');
  html = html.replace(/\n  preload: null,/, '\n  preload: window.__RV2PRE,');
  const at = html.lastIndexOf('</body>');
  html = html.slice(0, at) + ACT2 + html.slice(at);
  fs.writeFileSync(path.join(dir, 'rv2b.html'), html);
  return path.join(dir, 'rv2b.html');
}

test('⑬⑭⑮ 저장이 한 줄로 · 열린 틀이 안 사라진다 · 문서 종류가 서버 사양과 한 벌', (t) => {
  const browser = findBrowser();
  if (!browser) { t.skip('크로미움이 없다 — 못 쟀다'); return; }
  const pre = Object.assign({}, PRE, { spec: Object.assign({}, PRE.spec, { docType: 'teaser', targetPages: 3 }) });
  const R = run(browser, build2(pre) + '?project=LP-TEST-2', 1366);
  assert.ok(R, '화면이 결과를 안 남겼다');
  // ⑬ 겹침 — 한 번에 하나만 돌고, 늦은 옛 대답이 새 고침을 못 지운다
  assert.strictEqual(R.maxOpen, 1, '사양 저장 요청이 동시에 ' + R.maxOpen + '개 돌았다');
  assert.deepStrictEqual(R.len, ['20'], '늦게 온 옛 대답이 화면을 옛 쪽수로 되돌렸다: ' + JSON.stringify(R));
  assert.match(R.thumb, /^20\|/);
  assert.strictEqual(R.posts[R.posts.length - 1], 'teaser:20', '마지막으로 보낸 값이 마지막 고침이 아니다: ' + R.posts.join(' / '));
  // ⑮-1 쪽수만 바꿀 때 사양의 문서 종류(teaser)를 화면 기본(im)으로 덮지 않는다
  R.posts.forEach((p) => assert.match(p, /^teaser:/, '쪽수만 바꿨는데 문서 종류를 덮었다: ' + R.posts.join(' / ')));
  // ⑭ 열린 틀(iframe)과 쳐 둔 글이 그대로다
  assert.ok(!R.cantType, '틀 안 입력칸을 못 만졌다 — 못 쟀다');
  assert.ok(R.sameFrame, '출력 옵션을 바꿨더니 열린 단계 틀이 새로 만들어졌다');
  assert.strictEqual(R.typed, 'typed', '쳐 둔 글이 사라졌다');
  // ⑮-2 문서 카드를 고르면 서버 사양에 적히고 «출력정보 입력» 칸에 알린다
  assert.match(R.postsAfter[R.postsAfter.length - 1], /^im:/, '카드를 골랐는데 사양에 안 적혔다: ' + R.postsAfter.join(' / '));
  assert.ok(R.specGot && /"type":"lp-spec-changed"/.test(R.specGot) && /"docType":"im"/.test(R.specGot), '출력정보 입력 칸에 안 알렸다: ' + R.specGot);
  assert.match(R.progTitle, /^IM 풀버전/);
  // ⑮-1b 카드가 없는 종류(validation)의 사양도 쪽수만 바꿀 때 화면 기본(im)으로 안 덮인다
  const pv = Object.assign({}, PRE, { spec: Object.assign({}, PRE.spec, { docType: 'validation', targetPages: 12 }) });
  const Rv = run(browser, build2(pv) + '?project=LP-TEST-3', 1366);
  assert.ok(Rv, '두 번째 판이 결과를 안 남겼다');
  Rv.posts.forEach((p) => assert.match(p, /^validation:/, '쪽수만 바꿨는데 사양의 문서 종류를 덮었다: ' + Rv.posts.join(' / ')));
});

test('⑮-3 «출력정보 입력» 칸이 바깥의 사양 변경을 받아 종류를 맞추고, 확정을 바깥에 알린다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'reports.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = src.indexOf("d.type !== 'lp-spec-changed'");
  assert.ok(at > 0, 'lp-spec-changed 를 안 듣는다');
  const win = src.slice(at, src.indexOf('});', at));
  assert.match(win, /state\.kindId\s*=\s*s\.docType/, '받은 사양의 문서 종류로 맞추지 않는다');
  assert.match(src.slice(at - 40, at + 120), /state\.locked\)\s*return/, '확정된 사양도 덮는다');
  assert.match(src, /tellParent\(j\.spec\)/, '확정한 뒤 바깥에 안 알린다');
});
