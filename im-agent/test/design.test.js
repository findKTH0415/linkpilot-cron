'use strict';
/**
 * 디자인 게이트 시험 — 게이트를 만들었으면 게이트를 시험해야 한다.
 * 일부러 위반을 만들어 실제로 검출되는지 확인한다 (핸드오프 test-im-rules.js 와 같은 취지).
 */
const test = require('node:test');
const assert = require('node:assert');
const a4 = require('../design/a4');
const check = require('../design/check');
const tokens = require('../design/tokens');
const content = require('../design/content');
const { grade, distribution } = require('../core/confidence');
const { scaleNotice, getTemplate } = require('../finance/templates');
const { Dataset } = require('../core/facts');
const { FIELDS } = require('../core/dictionary');

const DOC = {
  projectId: 'LP-RE-2026-001',
  projectName: '테스트 개발사업',
  location: '서울특별시 중구',
  assetType: '부동산 개발 (PF)',
  kpis: [{ value: '2,846억원', label: 'Total Project Cost' }],
  disclaimers: ['본 자료는 산출·추정치를 포함하며 [미검증] 표기가 붙은 값은 단일 출처로만 확인되었다.'],
  sections: [
    { no: '01', id: 'a', title: 'Executive Summary', text: '- 총사업비: 2,846억원 [미검증] (출처: plan.pdf, p.20)' },
    { no: '02', id: 'b', title: 'Financial', text: '| 항목 | 값 |\n|---|---:|\n| IRR | 12.1% |\n\n자료출처: 본 자료 재무모델 산출치.' },
  ],
};

test('금액 표기: 억원/조원 규칙과 음수 △ (핸드오프 규칙)', () => {
  assert.strictEqual(tokens.eok(1634.3), '1,634.3억원');
  assert.strictEqual(tokens.eok(10762.4), '1조762.4억원');
  assert.strictEqual(tokens.eok(10000), '1조원');
  assert.strictEqual(tokens.eok(-355), '△355.0억원');
  assert.strictEqual(tokens.eok(null), '-');
});

test('금액 표기: 태양광 리포트 규칙(억+만원)은 별도 포맷터', () => {
  assert.strictEqual(tokens.eokManwon(28.9173), '28억 9,173만원');
});

test('캡션은 항상 자료출처: 로 시작한다', () => {
  assert.strictEqual(tokens.caption('한국은행'), '자료출처: 한국은행');
  assert.strictEqual(tokens.caption('자료출처: 한국은행'), '자료출처: 한국은행');
});

test('A4 렌더: 정상 문서는 규칙을 모두 통과한다', () => {
  const html = a4.render(DOC);
  const r = check.checkHtml(html, { chapterCount: 2 });
  assert.strictEqual(r.ok, true, JSON.stringify(r.violations));
});

test('A4 렌더: A4 기하·인쇄색상·챕터 페이지 분리가 들어간다', () => {
  const html = a4.render(DOC);
  assert.match(html, /@page\s*\{[^}]*A4/);
  assert.match(html, /margin:\s*17mm/);
  assert.match(html, /print-color-adjust:\s*exact/);
  assert.strictEqual((html.match(/break-before:\s*page/g) || []).length >= 2, true);
});

test('게이트 검출: 이모지 (D3)', () => {
  const r = check.checkHtml(a4.render(DOC).replace('Executive Summary', 'Executive Summary 🚀'));
  assert.ok(r.violations.some(v => v.rule === 'D3-no-emoji'));
  assert.strictEqual(r.ok, false);
});

test('게이트 검출: 아침 브리핑 팔레트 혼입 (D5) — 실제 발생했던 사고', () => {
  const r = check.checkHtml(a4.render(DOC).replace('#10233C', '#C00000'));
  assert.ok(r.violations.some(v => v.rule === 'D5-palette'));
  assert.strictEqual(r.ok, false);
});

test('게이트 검출: 인쇄 색상 누락 (D6)', () => {
  const r = check.checkHtml(a4.render(DOC).replace(/print-color-adjust:\s*exact;?/g, ''));
  assert.ok(r.violations.some(v => v.rule === 'D6-print-color'));
});

test('게이트 검출: 표는 있는데 자료출처 캡션이 없음 (D2)', () => {
  const r = check.checkHtml(a4.render(DOC).replace(/자료출처:/g, '출처:'));
  assert.ok(r.violations.some(v => v.rule === 'D2-caption-prefix'));
});

test('게이트 검출: 챕터 수 불일치 (D1)', () => {
  const r = check.checkHtml(a4.render(DOC), { chapterCount: 5 });
  assert.ok(r.violations.some(v => v.rule === 'D1-chapter-break'));
});

test('매스 SVG 는 IM 팔레트를 쓴다 (브리핑 팔레트 금지)', () => {
  const mass = require('../geo/mass');
  const m = mass.buildMass([[0, 0], [30, 0], [30, 20], [0, 20]], { floors: 5 });
  const svg = mass.toSvg(m, { label: '테스트' });
  assert.strictEqual(check.checkAsset(svg).ok, true);
  assert.ok(svg.includes(tokens.COLOR.navy));
  assert.ok(!svg.includes('#C00000'));
});

test('Confidence 등급: 공적장부·계산결과는 A, 가정치는 D, 출처없음은 E', () => {
  assert.strictEqual(grade({ source: '지적공부(VWorld)', confidence: 0.95, verified: true }), 'A');
  assert.strictEqual(grade({ source: 'financial_model (04_financial)', confidence: 0.95, verified: true }), 'A');
  assert.strictEqual(grade({ source: '건축물대장(국토교통부)', confidence: 0.9, verified: false }), 'B');
  assert.strictEqual(grade({ source: 'plan.pdf', confidence: 0.5, verified: false }), 'C');
  assert.strictEqual(grade({ source: 'plan.pdf', confidence: 0.5, verified: false, note: '통상치 적용' }), 'D');
  assert.strictEqual(grade({}), 'E');
});

test('Confidence 등급은 파생값이다 — 원본은 숫자+verified 하나뿐', () => {
  const facts = [
    { source: '지적공부(VWorld)', confidence: 0.95, verified: true },
    { source: 'plan.pdf', confidence: 0.5, verified: false },
  ];
  const d = distribution(facts);
  assert.strictEqual(d.total, 2);
  assert.strictEqual(d.counts.A, 1);
  assert.strictEqual(d.abRatio, 0.5);
});

test('서식 적용 구간: 구간 안이면 안내문이 없다 (문서가 달라지지 않는다)', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'capacity.it_load_mw', value: 6.5, unit: 'MW', source: 'plan.pdf' });
  ds.resolve();
  assert.strictEqual(scaleNotice(getTemplate('datacenter'), ds), '');
});

test('서식 적용 구간: 벗어나면 사실을 밝힌다 (태양광 스펙 §10)', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'capacity.it_load_mw', value: 300, unit: 'MW', source: 'plan.pdf' });
  ds.resolve();
  const notice = scaleNotice(getTemplate('datacenter'), ds);
  assert.match(notice, /크다/);
  assert.match(notice, /별도 확인이 필요/);
});

test('content.json: 기존 뷰어 계약(챕터+출처+승인상태)을 만족한다', () => {
  const c = content.build({ ...DOC, citations: [{ key: 'investment.total', label: '총사업비', value: '2,846억원', citation: 'plan.pdf, p.20', verified: false, grade: 'B' }], unsourcedNumbers: [] });
  assert.strictEqual(c.schema, 'linkpilot-im-content/1.0');
  assert.strictEqual(c.chapters.length, 2);
  assert.strictEqual(c.meta.currency, 'KRW');
  assert.strictEqual(c.sources[0].ref, 'S001');
  assert.strictEqual(c.approval.required, true);
  assert.strictEqual(c.approval.approved, false);
});

test('규칙 목록은 rules.json 단일 소스에서 나온다', () => {
  const list = check.list();
  assert.ok(list.length >= 10);
  assert.ok(list.every(r => r.id && r.label && r.why && r.severity));
});
