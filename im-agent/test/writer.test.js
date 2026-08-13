'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findUnsourcedNumbers, substitute, displayValue } = require('../agents/06-im-writer');
const { Dataset } = require('../core/facts');
const { FIELDS } = require('../core/dictionary');

test('환각 검출: 자리표시자 안의 숫자는 정상으로 본다', () => {
  const hits = findUnsourcedNumbers('총사업비는 {{investment.total}} 규모이며 안정적이다.');
  assert.strictEqual(hits.length, 0);
});

test('환각 검출: 본문에 직접 쓴 숫자는 잡아낸다', () => {
  const hits = findUnsourcedNumbers('본 사업의 IRR은 18.5% 수준으로 추정된다.');
  assert.strictEqual(hits.length, 1);
  assert.ok(hits[0].token.includes('18.5'));
});

test('환각 검출: 금액을 지어낸 경우도 잡아낸다', () => {
  const hits = findUnsourcedNumbers('총사업비 3,200억원이 투입된다.');
  assert.ok(hits.length >= 1);
});

test('환각 검출: 연도 표기는 허용한다', () => {
  assert.strictEqual(findUnsourcedNumbers('2026년 착공 예정이다.').length, 0);
});

test('치환: 값과 출처가 인용목록에 쌓인다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'investment.total', value: 2846, unit: '억원', source: 'plan.pdf', page: 20, confidence: 0.9 });
  ds.add({ key: 'investment.total', value: 2846, unit: '억원', source: 'ic-memo.pdf', page: 3, confidence: 0.9 });
  ds.resolve();

  const citations = [];
  const out = substitute('총사업비는 {{investment.total}}이다.', ds, citations);
  assert.ok(out.includes('2,846억원'));
  assert.strictEqual(citations.length, 1);
  assert.strictEqual(citations[0].verified, true);
});

test('치환: 미검증 값에는 [미검증] 표시가 붙는다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'revenue.annual', value: 420, unit: '억원', source: 'plan.pdf' });
  ds.resolve();
  const out = substitute('매출은 {{revenue.annual}}이다.', ds, []);
  assert.ok(out.includes('[미검증]'));
});

test('치환: 없는 key는 지어내지 않고 [미확인]으로 남긴다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.resolve();
  assert.strictEqual(substitute('{{revenue.annual}}', ds, []), '[미확인]');
});

test('표시형식: 단위별 포맷', () => {
  assert.strictEqual(displayValue('investment.total', { value: 2846, unit: '억원' }), '2,846억원');
  assert.strictEqual(displayValue('investment.total', { value: 12000, unit: '억원' }), '1조 2,000억원');
  assert.strictEqual(displayValue('debt.rate', { value: 5.8, unit: '%' }), '5.80%');
  assert.strictEqual(displayValue('capacity.it_load_mw', { value: 6.5, unit: 'MW' }), '6.5MW');
});
