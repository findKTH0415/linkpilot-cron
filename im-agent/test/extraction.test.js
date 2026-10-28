'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractFromLine, findAliasPos, unitCompatible } = require('../agents/02-extraction');
const { parseMoneyToEok, normalize } = require('../core/numeric');

function pick(line, key) {
  return extractFromLine(line).find(f => f.key === key) || null;
}

test('금액: 억원 단위로 정규화된다', () => {
  assert.strictEqual(parseMoneyToEok('2,846억원'), 2846);
  assert.strictEqual(parseMoneyToEok('1조 2,000억원'), 12000);
  assert.strictEqual(parseMoneyToEok('284,600백만원'), 2846);
  assert.strictEqual(parseMoneyToEok('1조원'), 10000);
});

test('면적: 평 → ㎡ 변환', () => {
  assert.ok(Math.abs(normalize(100, '평', '㎡') - 330.5785) < 0.01);
});

test('alias 경계: 기타사업비를 총사업비로 오인하지 않는다', () => {
  assert.strictEqual(findAliasPos('기타사업비 : 186억원', '사업비'), -1);
  assert.strictEqual(pick('기타사업비 : 186억원', 'investment.total'), null);
  assert.strictEqual(pick('기타사업비 : 186억원', 'investment.other').value, 186);
});

test('alias 경계: 총사업비는 정상 추출된다', () => {
  assert.strictEqual(pick('총사업비 : 2,846억원', 'investment.total').value, 2846);
});

test('alias 경계: 차입금리를 금리로 이중 추출하지 않는다', () => {
  const facts = extractFromLine('차입금리 : 5.8%');
  assert.strictEqual(facts.filter(f => f.key === 'debt.rate').length, 1);
  assert.strictEqual(facts.find(f => f.key === 'debt.rate').value, 5.8);
});

test('전력: MW 추출', () => {
  assert.strictEqual(pick('IT Load : 6.5MW', 'capacity.it_load_mw').value, 6.5);
});

test('전력: kW로 적힌 값을 MW 필드에 넣을 때 환산한다', () => {
  assert.strictEqual(pick('IT Load : 6500kW', 'capacity.it_load_mw').value, 6.5);
});

test('면적: 연면적 + 단위기호', () => {
  assert.strictEqual(pick('연면적 : 54,822㎡', 'building.gfa_sqm').value, 54822);
});

test('문자열 필드: 인허가 상태를 그대로 담는다', () => {
  const f = pick('인허가 : 건축허가 완료', 'legal.permit_status');
  assert.strictEqual(f.value, '건축허가 완료');
});

test('근거 문구(quote)가 항상 함께 저장된다', () => {
  const f = pick('총사업비 : 2,846억원', 'investment.total');
  assert.ok(f.quote.includes('2,846'));
});

test('구분자(:)가 있으면 신뢰도가 더 높다', () => {
  const withSep = pick('총사업비 : 2,846억원', 'investment.total');
  const withoutSep = pick('총사업비 2,846억원 규모다', 'investment.total');
  assert.ok(withSep.confidence > withoutSep.confidence);
});

test('단위 호환성 판정', () => {
  assert.strictEqual(unitCompatible('억원', '억원'), true);
  assert.strictEqual(unitCompatible('㎡', '억원'), false);
  assert.strictEqual(unitCompatible('평', '㎡'), true);
});

test('빈 줄/과도하게 긴 줄은 건너뛴다', () => {
  assert.deepStrictEqual(extractFromLine(''), []);
  assert.deepStrictEqual(extractFromLine('총사업비 : 1억원'.padEnd(2100, ' ')), []);
});
