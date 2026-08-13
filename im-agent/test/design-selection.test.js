'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'im-design-'));
process.env.IM_AGENT_ROOT = ROOT;

const themes = require('../design/themes');
const { recommend, assetKey } = require('../design/recommend');
const layouts = require('../design/layouts');
const a4 = require('../design/a4');
const check = require('../design/check');
const designState = require('../core/design-state');
const store = require('../core/store');

test('테마 13종이 모두 등록되어 있다', () => {
  const list = themes.list();
  assert.strictEqual(list.length, 13);
  assert.ok(list.every(t => t.id && t.label && t.labelKr && t.purpose));
});

test('모든 테마가 필수 토큰을 갖는다 (렌더러가 색을 하드코딩하지 않으려면)', () => {
  for (const t of themes.list()) {
    const th = themes.resolve(t.id);
    for (const key of ['primary', 'primaryMid', 'accent', 'accentLight', 'onPrimary', 'surfaceAlt', 'serif', 'sans']) {
      assert.ok(th[key], `${t.id} 테마에 ${key} 누락`);
    }
    assert.strictEqual(th.chart.length, 5, `${t.id} 차트 팔레트는 5색`);
  }
});

test('구조 토큰은 테마가 바꾸지 않는다 (문서가 서로 다른 시스템처럼 보이면 안 된다)', () => {
  const a = themes.resolve('institutional');
  const b = themes.resolve('luxury');
  assert.strictEqual(a.ruleStrong, b.ruleStrong);
  assert.strictEqual(a.negative, b.negative);
  assert.strictEqual(a.brandRed, b.brandRed);
});

test('institutional 은 PDI 핸드오프 정본 팔레트다', () => {
  const t = themes.resolve('institutional');
  assert.strictEqual(t.primary, '#10233C');
  assert.strictEqual(t.accent, '#A6813C');
  assert.strictEqual(t.onPrimary, '#F3E3C4');
});

test('문서유형이 테마를 통째로 바꾸지 않는다 — 밀도·표지만 보정한다 (사양 §9)', () => {
  const im = themes.resolve('real_estate', { docType: 'im' });
  const teaser = themes.resolve('real_estate', { docType: 'teaser' });
  assert.strictEqual(im.primary, teaser.primary, 'Brand Identity 는 유지된다');
  assert.strictEqual(teaser.density, 'airy');
  assert.notStrictEqual(im.spacing.section, teaser.spacing.section);
});

test('Brand Kit 이 테마 색을 덮어쓴다 (사양 §8)', () => {
  const t = themes.resolve('corporate', {
    brandKit: { company: 'PDI', primaryColor: '#123456', accentColor: '#ABCDEF', logo: 'logo.png' },
  });
  assert.strictEqual(t.primary, '#123456');
  assert.strictEqual(t.accent, '#ABCDEF');
  assert.strictEqual(t.brandKit.company, 'PDI');
});

test('테마 → CSS 변수 (PPT·Dashboard 가 같은 값을 읽는다)', () => {
  const css = themes.toCss(themes.resolve('technology'));
  assert.match(css, /--lp-primary:\s*#0E1A2B/);
  assert.match(css, /--lp-chart-5:/);
});

// ── AI 추천 ────────────────────────────────────────────────
test('추천은 결정적이다 — 같은 입력이면 같은 결과', () => {
  const ctx = { assetType: '데이터센터', docType: 'im', investorType: 'global' };
  assert.deepStrictEqual(recommend(ctx), recommend(ctx));
});

test('추천은 최대 3개, 신뢰도는 100%를 쓰지 않는다', () => {
  const r = recommend({ assetType: '부동산 개발', docType: 'im', investorType: 'institutional' });
  assert.ok(r.recommendations.length <= 3);
  assert.ok(r.recommendations.every(x => x.confidence > 0 && x.confidence <= 98));
  assert.ok(r.recommendations[0].confidence >= r.recommendations[1].confidence);
});

test('추천에는 근거가 붙는다 (왜 그 테마인지 설명할 수 있어야 한다)', () => {
  const r = recommend({ assetType: '태양광', docType: 'im', investorType: 'institutional' });
  assert.ok(r.recommendations[0].reasons.length > 0);
  assert.ok(r.signals.assetType === 'solar');
});

test('자산유형별 추천이 사양 예시와 맞는다', () => {
  const pick = (ctx) => recommend(ctx).recommendations.map(x => x.themeId);
  assert.ok(pick({ assetType: '부동산 개발사업', docType: 'im' }).includes('real_estate'));
  assert.ok(pick({ assetType: '태양광 발전', docType: 'im' }).includes('renewable'));
  assert.ok(pick({ assetType: '호텔 인수', docType: 'im' }).includes('luxury'));
  assert.ok(pick({ assetType: '데이터센터', docType: 'im' }).includes('technology'));
  assert.ok(pick({ assetType: '물류센터', docType: 'pf_proposal' }).includes('institutional'));
});

test('자산유형 판별', () => {
  assert.strictEqual(assetKey('인천 6.5MW 데이터센터 개발사업'), 'datacenter');
  assert.strictEqual(assetKey('태양광 발전소'), 'solar');
  assert.strictEqual(assetKey('알 수 없는 무언가'), 'generic');
});

// ── 레이아웃 자동 선택 ─────────────────────────────────────
test('레이아웃은 절 내용으로 결정된다', () => {
  assert.strictEqual(layouts.pick({ id: 'x', text: '| a | b |\n|---|---|\n| 1 | 2 |' }).id, 'L06');
  assert.strictEqual(layouts.pick({ id: 'x', text: '[지도에서 보기](http://x) 좌표 37.5' }).id, 'L07');
  assert.strictEqual(layouts.pick({ id: 'x', text: '| 구분 |\n[RED] 위험' }).id, 'L11');
  assert.strictEqual(layouts.pick({ id: 'x', text: '짧음' }).id, 'L12');
});

test('테마 지정 레이아웃이 자동 판별보다 우선한다', () => {
  const t = themes.resolve('real_estate');
  const l = layouts.pick({ id: 'location', text: '아무 내용' }, t);
  assert.strictEqual(l.id, 'L07');
  assert.match(l.reason, /테마/);
});

test('같은 절이면 항상 같은 레이아웃 (규칙 기반)', () => {
  const s = { id: 'financial', text: '| IRR |\n|---:|\n| 12% |' };
  assert.strictEqual(layouts.pick(s).id, layouts.pick(s).id);
});

// ── 렌더 · 일관성 ──────────────────────────────────────────
test('13개 테마 전부 A4 규칙과 테마 일관성을 통과한다', () => {
  for (const t of themes.list()) {
    const theme = themes.resolve(t.id);
    const html = a4.preview(t.id);
    const rules = check.checkHtml(html);
    const consistency = check.checkThemeConsistency(html, theme);
    assert.strictEqual(rules.ok, true, `${t.id}: ${JSON.stringify(rules.violations)}`);
    assert.deepStrictEqual(consistency.violations, [], `${t.id} 테마 외 색·서체 혼입`);
  }
});

test('테마를 바꾸면 색이 실제로 바뀐다', () => {
  const inst = a4.preview('institutional');
  const lux = a4.preview('luxury');
  assert.ok(inst.includes('#10233C'));
  assert.ok(lux.includes('#1B1410'));
  assert.ok(!lux.includes('#10233C'));
});

test('미리보기는 실제 값이 아님을 명시한다', () => {
  assert.match(a4.preview('premium'), /디자인 확인용 예시이며 실제 프로젝트 값이 아니다/);
});

// ── 선택 상태 · 버전 이력 ──────────────────────────────────
test('디자인 선택과 버전 이력 (사양 §15)', () => {
  const pid = 'LP-RE-2026-777';
  store.createProjectDirs(pid);

  const v1 = designState.select(pid, { themeId: 'institutional', by: '김대표' });
  assert.strictEqual(v1.themeId, 'institutional');

  const v2 = designState.select(pid, { themeId: 'real_estate', by: '김대표' });
  assert.strictEqual(v2.themeId, 'real_estate');
  assert.ok(v2.history.some(h => h.themeId === 'institutional'), '이전 선택이 이력에 남는다');

  const back = designState.revert(pid, v1.version, '김대표');
  assert.strictEqual(back.themeId, 'institutional', '이전 디자인으로 되돌릴 수 있다');
});

test('알 수 없는 테마는 거부한다', () => {
  const pid = 'LP-RE-2026-778';
  store.createProjectDirs(pid);
  assert.throws(() => designState.select(pid, { themeId: 'nonexistent' }), /알 수 없는 디자인 테마/);
});

test('테마 산출물(theme.json / theme.css)이 프로젝트에 기록된다', () => {
  const pid = 'LP-RE-2026-779';
  store.createProjectDirs(pid);
  designState.writeThemeAssets(pid, themes.resolve('renewable'));
  const t = store.readJson(pid, '12_Final/theme.json');
  assert.strictEqual(t.id, 'renewable');
  assert.strictEqual(t.chart.length, 5);
  assert.ok(fs.existsSync(path.join(store.projectDir(pid), '12_Final/theme.css')));
});

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
