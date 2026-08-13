'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Fact, Dataset } = require('../core/facts');
const { FIELDS } = require('../core/dictionary');

test('Fact: 출처 없는 값은 생성 자체가 실패한다', () => {
  assert.throws(() => new Fact({ key: 'investment.total', value: 2846 }), /source 필수/);
});

test('Fact: 빈 값은 저장하지 않는다', () => {
  assert.throws(() => new Fact({ key: 'investment.total', value: '', source: 'a.pdf' }), /value 필수/);
});

test('Fact: citation 은 출처+페이지+일자를 담는다', () => {
  const f = new Fact({ key: 'building.gfa_sqm', value: 54822, source: 'tech.pdf', page: 27, sourceDate: '2026-03-14' });
  assert.strictEqual(f.citation(), 'tech.pdf, p.27, 2026-03-14');
});

test('Dataset: 값 충돌을 폐기하지 않고 RED FLAG로 드러낸다', () => {
  const ds = new Dataset('LP-DC-2026-001', FIELDS);
  ds.add({ key: 'building.gfa_sqm', value: 54822, source: 'tech.pdf', page: 27, confidence: 0.9 });
  ds.add({ key: 'building.gfa_sqm', value: 52822, source: 'plan.pdf', page: 10, confidence: 0.8 });
  ds.resolve();

  const conflict = ds.conflicts.find(c => c.key === 'building.gfa_sqm');
  assert.ok(conflict, '충돌이 기록되어야 한다');
  assert.strictEqual(conflict.severity, 'RED');
  assert.strictEqual(conflict.values.length, 2);
  assert.strictEqual(ds.get('building.gfa_sqm').verified, false, '충돌 항목은 verified 가 될 수 없다');
});

test('Dataset: 반올림 표기 차이는 충돌이 아니다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'investment.total', value: 2846, source: 'a.pdf' });
  ds.add({ key: 'investment.total', value: 2846.5, source: 'b.pdf' }); // tolerance 0.5%
  ds.resolve();
  assert.strictEqual(ds.conflicts.length, 0);
});

test('Dataset: 독립 출처 2건이 일치하면 verified 로 승격', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'debt.rate', value: 5.8, source: 'termsheet.pdf', confidence: 0.7 });
  ds.add({ key: 'debt.rate', value: 5.8, source: 'plan.pdf', confidence: 0.7 });
  ds.resolve();
  const f = ds.get('debt.rate');
  assert.strictEqual(f.verified, true);
  assert.strictEqual(f.corroboration, 2);
});

test('Dataset: 단일 출처는 verified 가 아니다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'debt.rate', value: 5.8, source: 'plan.pdf', confidence: 0.9 });
  ds.resolve();
  assert.strictEqual(ds.get('debt.rate').verified, false);
});

test('Dataset: 문자열 충돌은 YELLOW (숫자 충돌만 RED)', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'project.location', value: '인천 남동공단', source: 'user_request' });
  ds.add({ key: 'project.location', value: '인천광역시 남동구', source: 'plan.pdf' });
  ds.resolve();
  assert.strictEqual(ds.conflicts[0].severity, 'YELLOW');
});

test('Dataset: dropSource 로 재실행 시 자기 자신과의 충돌을 막는다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'returns.equity_irr', value: 12.1, source: 'financial_model (04_financial)' });
  ds.resolve();
  ds.dropSource('financial_model (04_financial)');
  ds.add({ key: 'returns.equity_irr', value: 15.9, source: 'financial_model (04_financial)' });
  ds.resolve();
  assert.strictEqual(ds.conflicts.length, 0);
  assert.strictEqual(ds.num('returns.equity_irr'), 15.9);
});

test('Dataset: addMany 는 규칙 위반 값을 조용히 버리지 않는다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.addMany([{ key: 'investment.total', value: 100 }]); // source 없음
  assert.strictEqual(ds.conflicts.length, 1);
  assert.strictEqual(ds.conflicts[0].type, 'REJECTED');
});

test('Dataset: 직렬화 후 복원해도 값과 충돌이 유지된다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'building.gfa_sqm', value: 54822, source: 'a.pdf' });
  ds.add({ key: 'building.gfa_sqm', value: 52822, source: 'b.pdf' });
  ds.resolve();
  const restored = Dataset.fromJSON(JSON.parse(JSON.stringify(ds.toJSON())), FIELDS);
  assert.strictEqual(restored.conflicts.length, 1);
  assert.strictEqual(restored.num('building.gfa_sqm'), ds.num('building.gfa_sqm'));
});

test('Dataset: missing 은 결측 필수항목을 알려준다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'investment.total', value: 2846, source: 'a.pdf' });
  ds.resolve();
  assert.deepStrictEqual(ds.missing(['investment.total', 'revenue.annual']), ['revenue.annual']);
});
