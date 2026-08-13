'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildModel, spreadCapex, drawEquityFirst, computeIdc, buildRamp } = require('../finance/model');
const { getTemplate, buildInput, applyScenario, BASE_SCENARIOS } = require('../finance/templates');
const { Dataset } = require('../core/facts');
const { FIELDS } = require('../core/dictionary');

const SAMPLE = {
  landCost: 480, constructionCost: 2180, otherCost: 186,
  totalCost: 2846, contingencyPct: 0,
  annualRevenue: 420, opexAnnual: 126, opexRatio: null,
  revenueEscalation: 2, opexEscalation: 2, rampYears: 2,
  debtAmount: 1850, debtRate: 5.8, tenorYears: 12, graceYears: 3, feePct: 1,
  taxRate: 22, depreciationYears: 30,
  constructionYears: 3, opsYears: 15, exitYear: 10,
  exitCapRate: 5.5, sellingCostPct: 1.5, discountRate: 8,
};

test('capex 배분: 합계가 보존된다', () => {
  const s = spreadCapex(3000, 3);
  assert.strictEqual(s.length, 3);
  assert.ok(Math.abs(s.reduce((a, b) => a + b, 0) - 3000) < 1e-9);
});

test('capex 배분: curve 지정 시 비율대로', () => {
  const s = spreadCapex(1000, 2, [3, 7]);
  assert.deepStrictEqual(s, [300, 700]);
});

test('자기자본 선투입: 자본 소진 후 차입이 인출된다', () => {
  const d = drawEquityFirst([100, 100, 100], 150);
  assert.deepStrictEqual(d.equityDraws, [100, 50, 0]);
  assert.deepStrictEqual(d.debtDraws, [0, 50, 100]);
});

test('IDC: 인출이 없으면 0', () => {
  assert.strictEqual(computeIdc([0, 0], 0.058), 0);
});

test('IDC: 연중 균등인출 가정으로 첫해는 절반만 부담', () => {
  assert.ok(Math.abs(computeIdc([100], 0.1) - 5) < 1e-9);
});

test('ramp: rampYears=2 면 1/3, 2/3, 1 로 오른다', () => {
  const r = buildRamp(2, 5);
  assert.ok(Math.abs(r[0] - 1 / 3) < 1e-9);
  assert.ok(Math.abs(r[1] - 2 / 3) < 1e-9);
  assert.strictEqual(r[2], 1);
});

test('ramp: 0이면 즉시 안정화', () => {
  assert.deepStrictEqual(buildRamp(0, 3), [1, 1, 1, 1]);
});

test('모델: 자금조달 합계 = 총사업비', () => {
  const m = buildModel(SAMPLE).metrics;
  assert.ok(Math.abs(m.debtAmount + m.equityAmount - m.totalProjectCost) < 0.05);
});

test('모델: 건설이자가 총사업비에 자본화된다', () => {
  const m = buildModel(SAMPLE).metrics;
  assert.ok(m.idc > 0, 'IDC가 계산되어야 한다');
  assert.ok(m.totalProjectCost > 2846, '문서 총사업비 + IDC + 수수료');
});

test('모델: 기간 수 = 공사기간 + Exit 연도', () => {
  const model = buildModel(SAMPLE);
  assert.strictEqual(model.periods.length, SAMPLE.constructionYears + SAMPLE.exitYear);
  assert.strictEqual(model.periods.filter(p => p.phase === 'construction').length, 3);
});

test('모델: Exit 시점에 차입잔액이 상환된다', () => {
  const model = buildModel(SAMPLE);
  const last = model.periods[model.periods.length - 1];
  assert.strictEqual(last.debtBalance, 0);
  assert.ok(last.exitValue > 0);
});

test('모델: 거치기간 중에는 원금상환이 없다', () => {
  const model = buildModel(SAMPLE);
  const ops = model.periods.filter(p => p.phase === 'operation');
  assert.strictEqual(ops[0].principal, 0);
  assert.strictEqual(ops[2].principal, 0);
  assert.ok(ops[3].principal > 0);
});

test('모델: 레버리지가 걸리면 Equity IRR > Project IRR (수익률 > 금리 구간)', () => {
  const m = buildModel(SAMPLE).metrics;
  assert.ok(m.projectIRR !== null && m.equityIRR !== null);
  assert.ok(m.equityIRR > m.projectIRR, `equity ${m.equityIRR} vs project ${m.projectIRR}`);
});

test('모델: Cap Rate가 낮아지면 Exit Value가 커진다', () => {
  const a = buildModel({ ...SAMPLE, exitCapRate: 5.0 }).metrics.exitValue;
  const b = buildModel({ ...SAMPLE, exitCapRate: 6.0 }).metrics.exitValue;
  assert.ok(a > b);
});

test('모델: 매출이 오르면 DSCR도 오른다', () => {
  const low = buildModel({ ...SAMPLE, annualRevenue: 400 }).metrics.minDSCR;
  const high = buildModel({ ...SAMPLE, annualRevenue: 500 }).metrics.minDSCR;
  assert.ok(high > low);
});

test('모델: 세금은 음수가 되지 않는다 (결손금은 이월)', () => {
  const model = buildModel({ ...SAMPLE, annualRevenue: 150 });
  assert.ok(model.periods.every(p => p.tax >= 0));
});

test('시나리오: Downside 는 Base 보다 Equity IRR 이 낮다', () => {
  const base = buildModel(applyScenario(SAMPLE, BASE_SCENARIOS.base)).metrics;
  const down = buildModel(applyScenario(SAMPLE, BASE_SCENARIOS.downside)).metrics;
  const up = buildModel(applyScenario(SAMPLE, BASE_SCENARIOS.upside)).metrics;
  assert.ok(down.equityIRR < base.equityIRR);
  assert.ok(up.equityIRR > base.equityIRR);
});

test('Template: 문서에 없는 입력은 가정치로 표시된다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'investment.total', value: 2846, source: 'plan.pdf' });
  ds.resolve();

  const { input, sourced, assumed } = buildInput(getTemplate('datacenter'), ds);
  assert.ok(sourced.some(s => s.includes('investment.total')));
  assert.ok(assumed.some(a => a.field === 'debtRate'), '금리는 가정치여야 한다');
  assert.ok(assumed.every(a => a.reason), '가정치에는 반드시 근거 설명이 붙는다');
  assert.strictEqual(input.totalCost, 2846);
});

test('Template: 문서에 운영비가 있으면 비율가정을 쓰지 않는다', () => {
  const ds = new Dataset('P', FIELDS);
  ds.add({ key: 'opex.annual', value: 126, source: 'plan.pdf' });
  ds.resolve();
  const { input } = buildInput(getTemplate('datacenter'), ds);
  assert.strictEqual(input.opexRatio, null);
  assert.strictEqual(input.opexAnnual, 126);
});
