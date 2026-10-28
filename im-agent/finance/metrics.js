'use strict';
/**
 * metrics.js — 투자지표 계산. 전부 결정적(deterministic) 함수다.
 *
 * ★ 이 파일의 어떤 값도 LLM이 생성하지 않는다. IM에 실리는 모든 숫자는
 *   여기서 계산되거나 출처 있는 Fact에서만 나온다.
 *
 * 규약: 현금흐름 배열은 기말(end-of-period) 기준, index 0 = 0기(착수시점).
 */

/** 순현재가치. rate는 소수(0.08 = 8%) */
function npv(rate, cashflows) {
  if (!Array.isArray(cashflows) || !cashflows.length) return null;
  if (rate <= -1) return null;
  return cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i), 0);
}

/**
 * 내부수익률. 이분법(bisection) — 수렴 실패 시 null 을 반환한다.
 * 부호변화가 없으면(전부 +거나 전부 -) IRR은 정의되지 않으므로 null.
 */
/*
 * tol = 1e-9: 이율 자체의 오차 한계. 1e-7 로 두면 현금흐름 규모가 클 때
 * NPV 잔차가 1e-4 수준으로 남아 지표 검산이 어긋난다.
 */
function irr(cashflows, { lo = -0.9999, hi = 10, tol = 1e-9, maxIter = 300 } = {}) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) return null;
  const hasPos = cashflows.some(c => c > 0);
  const hasNeg = cashflows.some(c => c < 0);
  if (!hasPos || !hasNeg) return null;

  let fLo = npv(lo, cashflows);
  let fHi = npv(hi, cashflows);
  if (fLo === null || fHi === null) return null;
  if (fLo * fHi > 0) return null; // 구간 내 해 없음

  let a = lo, b = hi;
  for (let i = 0; i < maxIter; i++) {
    const mid = (a + b) / 2;
    const fMid = npv(mid, cashflows);
    if (fMid === null) return null;
    if (Math.abs(fMid) < tol || (b - a) / 2 < tol) return mid;
    if (fLo * fMid < 0) { b = mid; } else { a = mid; fLo = fMid; }
  }
  return (a + b) / 2;
}

/** 배수(MOIC): 유입합 / 유출합 */
function moic(cashflows) {
  const inflow = cashflows.filter(c => c > 0).reduce((a, b) => a + b, 0);
  const outflow = Math.abs(cashflows.filter(c => c < 0).reduce((a, b) => a + b, 0));
  if (outflow === 0) return null;
  return inflow / outflow;
}

/** 기간별 DSCR = CFADS / 원리금상환액 */
function dscrSeries(cfads, debtService) {
  return cfads.map((cf, i) => {
    const ds = debtService[i];
    if (!ds || ds <= 0) return null;
    return cf / ds;
  });
}

function minDscr(series) {
  const vals = series.filter(v => v !== null && Number.isFinite(v));
  return vals.length ? Math.min(...vals) : null;
}

function avgDscr(series) {
  const vals = series.filter(v => v !== null && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** 원리금균등상환(annuity) 연간 상환액 */
function annuityPayment(principal, rate, years) {
  if (principal <= 0 || years <= 0) return 0;
  if (rate === 0) return principal / years;
  const r = rate;
  return (principal * r) / (1 - Math.pow(1 + r, -years));
}

/** 회수기간(년). 누적현금흐름이 0을 넘는 시점을 선형보간 */
function paybackPeriod(cashflows) {
  let cum = 0;
  for (let i = 0; i < cashflows.length; i++) {
    const prev = cum;
    cum += cashflows[i];
    if (prev < 0 && cum >= 0) {
      const frac = cashflows[i] === 0 ? 0 : -prev / cashflows[i];
      return i - 1 + frac;
    }
  }
  return null;
}

/**
 * 민감도 매트릭스.
 * @param {(a:number,b:number)=>number} fn 두 변수를 받아 지표를 반환
 * @param {{label:string, values:number[]}} varA 행
 * @param {{label:string, values:number[]}} varB 열
 */
function sensitivity(fn, varA, varB) {
  const rows = varA.values.map(a => ({
    a,
    cells: varB.values.map(b => {
      try {
        const v = fn(a, b);
        return Number.isFinite(v) ? v : null;
      } catch (_) {
        return null;
      }
    }),
  }));
  return { rowLabel: varA.label, colLabel: varB.label, cols: varB.values, rows };
}

/**
 * 손익분기점 탐색: f(x) = 0 이 되는 x를 이분법으로 찾는다.
 * (예: 매출 배수 x에 대해 Equity IRR - 목표 = 0)
 */
function solve(f, lo, hi, { tol = 1e-6, maxIter = 200 } = {}) {
  let fLo = f(lo);
  let fHi = f(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  let a = lo, b = hi;
  for (let i = 0; i < maxIter; i++) {
    const mid = (a + b) / 2;
    const fMid = f(mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < tol || (b - a) / 2 < tol) return mid;
    if (fLo * fMid < 0) { b = mid; } else { a = mid; fLo = fMid; }
  }
  return (a + b) / 2;
}

module.exports = {
  npv, irr, moic, dscrSeries, minDscr, avgDscr,
  annuityPayment, paybackPeriod, sensitivity, solve,
};
