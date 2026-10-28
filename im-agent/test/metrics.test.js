'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../finance/metrics');

test('npv: 할인율에서 정확히 상쇄되면 0', () => {
  assert.ok(Math.abs(M.npv(0.1, [-100, 110])) < 1e-9);
});

test('npv: 0기 현금흐름은 할인하지 않는다', () => {
  assert.strictEqual(M.npv(0.5, [-100]), -100);
});

test('irr: [-100, 60, 60] = 13.07%', () => {
  const r = M.irr([-100, 60, 60]);
  assert.ok(Math.abs(r - 0.130662) < 1e-4, `실제 ${r}`);
});

test('irr: 부호변화가 없으면 null (정의되지 않음)', () => {
  assert.strictEqual(M.irr([100, 60, 60]), null);
  assert.strictEqual(M.irr([-100, -60]), null);
});

test('irr: IRR을 넣으면 NPV가 0', () => {
  const cfs = [-1000, 200, 300, 400, 500];
  const r = M.irr(cfs);
  assert.ok(Math.abs(M.npv(r, cfs)) < 1e-4);
});

test('moic: 유입/유출 배수', () => {
  assert.strictEqual(M.moic([-100, 50, 150]), 2);
  assert.strictEqual(M.moic([100, 50]), null);
});

test('annuityPayment: 원리금균등 (1000, 5%, 10년)', () => {
  const p = M.annuityPayment(1000, 0.05, 10);
  assert.ok(Math.abs(p - 129.5046) < 0.001, `실제 ${p}`);
});

test('annuityPayment: 무이자면 원금 균등분할', () => {
  assert.strictEqual(M.annuityPayment(1000, 0, 10), 100);
});

test('dscr: 상환액 0이면 null (0으로 나누지 않는다)', () => {
  const s = M.dscrSeries([100, 100], [0, 50]);
  assert.deepStrictEqual(s, [null, 2]);
  assert.strictEqual(M.minDscr(s), 2);
});

test('paybackPeriod: [-100, 50, 50, 50] = 2년', () => {
  assert.strictEqual(M.paybackPeriod([-100, 50, 50, 50]), 2);
});

test('paybackPeriod: 회수 못하면 null', () => {
  assert.strictEqual(M.paybackPeriod([-100, 10, 10]), null);
});

test('solve: 이분법으로 근을 찾는다', () => {
  const x = M.solve(v => v * v - 4, 0, 10);
  assert.ok(Math.abs(x - 2) < 1e-4);
});

test('sensitivity: 행×열 매트릭스를 만든다', () => {
  const s = M.sensitivity((a, b) => a + b, { label: 'A', values: [1, 2] }, { label: 'B', values: [10, 20] });
  assert.strictEqual(s.rows.length, 2);
  assert.deepStrictEqual(s.rows[0].cells, [11, 21]);
});
