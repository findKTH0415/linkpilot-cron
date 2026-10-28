'use strict';
/**
 * verify.js — 재무 독립 재계산 (GATE 03).
 *
 * ★ 이 파일의 존재 이유:
 *   `buildModel()` 을 다시 호출하면 같은 코드가 같은 답을 낸다. 그건 검증이 아니다.
 *   그래서 여기서는
 *     ① 모델이 **발표한 현금흐름표(periods)** 만 입력으로 받고 (모델 입력은 보지 않는다)
 *     ② IRR을 **다른 알고리즘(Newton-Raphson)** 으로 다시 푼다 (원본은 이분법)
 *     ③ 표 자체의 항등식(NOI = 매출 − 운영비, DSCR = CFADS ÷ 원리금 등)을 재검산한다
 *
 *   따라서 모델이 표와 다른 지표를 발표했거나, 표 내부가 서로 어긋나면 여기서 걸린다.
 */

const { round } = require('../core/numeric');

/** 오차 등급 (사양 §10) */
const THRESHOLD = [
  { max: 0.005, level: 'PASS' },
  { max: 0.010, level: 'MINOR' },
  { max: 0.030, level: 'WARNING' },
  { max: 0.050, level: 'MAJOR' },
  { max: Infinity, level: 'CRITICAL' },
];

function classify(reported, recomputed, { absoluteTolerance = 0 } = {}) {
  if (reported === null || reported === undefined || recomputed === null || recomputed === undefined) {
    return { level: 'UNVERIFIABLE', diff: null, diffPct: null };
  }
  const diff = recomputed - reported;
  if (Math.abs(diff) <= absoluteTolerance) return { level: 'PASS', diff: round(diff, 4), diffPct: 0 };

  const scale = Math.max(Math.abs(reported), Math.abs(recomputed));
  const rel = scale === 0 ? 0 : Math.abs(diff) / scale;
  const level = THRESHOLD.find(t => rel <= t.max).level;
  return { level, diff: round(diff, 4), diffPct: round(rel * 100, 3) };
}

/** NPV — 명시적 합산 (원본과 같은 정의지만 독립 구현) */
function npv(rate, cfs) {
  let sum = 0;
  for (let i = 0; i < cfs.length; i++) sum += cfs[i] / Math.pow(1 + rate, i);
  return sum;
}

/**
 * IRR — Newton-Raphson (원본은 이분법). 수렴 실패 시 null.
 * 같은 값이 나와야 정상이다. 다르면 둘 중 하나가 틀렸다.
 */
function irrNewton(cfs, { guess = 0.1, tol = 1e-10, maxIter = 200 } = {}) {
  if (!Array.isArray(cfs) || cfs.length < 2) return null;
  if (!cfs.some(c => c > 0) || !cfs.some(c => c < 0)) return null;

  let r = guess;
  for (let i = 0; i < maxIter; i++) {
    let f = 0, df = 0;
    for (let t = 0; t < cfs.length; t++) {
      const d = Math.pow(1 + r, t);
      f += cfs[t] / d;
      if (t > 0) df -= (t * cfs[t]) / (d * (1 + r));
    }
    if (Math.abs(df) < 1e-14) break;
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - r) < tol) return next;
    r = next;
  }
  return null;
}

function moic(cfs) {
  const inflow = cfs.filter(c => c > 0).reduce((a, b) => a + b, 0);
  const outflow = Math.abs(cfs.filter(c => c < 0).reduce((a, b) => a + b, 0));
  return outflow === 0 ? null : inflow / outflow;
}

/**
 * 발표된 현금흐름표를 독립 검산한다.
 * @param {object} scenario financial.scenarios.base ({ metrics, assumptions, periods })
 * @returns {{checks:Array, worst:string, recomputed:object}}
 */
function verifyScenario(scenario, label = 'Base') {
  const checks = [];
  if (!scenario || !Array.isArray(scenario.periods) || !scenario.periods.length) {
    return { checks: [{ item: '현금흐름표', level: 'UNVERIFIABLE', message: '검산할 현금흐름표가 없다' }], worst: 'UNVERIFIABLE', recomputed: {} };
  }

  const P = scenario.periods;
  const M = scenario.metrics || {};
  const A = scenario.assumptions || {};
  const ops = P.filter(p => p.phase === 'operation');

  const add = (item, reported, recomputed, verdict, note) => {
    checks.push({
      item, reported, recomputed,
      level: verdict.level, diff: verdict.diff, diffPct: verdict.diffPct,
      message: verdict.level === 'PASS'
        ? `${item} 일치`
        : `${item}: 발표값 ${fmtv(reported)} vs 독립계산 ${fmtv(recomputed)} (차이 ${verdict.diffPct === null ? '-' : verdict.diffPct + '%'})`,
      note: note || null,
    });
  };

  // ── 표 내부 항등식 ─────────────────────────────────────
  let noiBreaks = 0, cfadsBreaks = 0, dsBreaks = 0, negTax = 0;
  for (const p of ops) {
    if (Math.abs((p.revenue - p.opex) - p.noi) > 0.05) noiBreaks++;
    if (Math.abs((p.noi - p.tax) - p.cfads) > 0.05) cfadsBreaks++;
    if (Math.abs((p.interest + p.principal) - p.debtService) > 0.05) dsBreaks++;
    if (p.tax < -0.001) negTax++;
  }
  checks.push(identity('NOI = 매출 − 운영비', noiBreaks, ops.length));
  checks.push(identity('CFADS = NOI − 법인세', cfadsBreaks, ops.length));
  checks.push(identity('원리금 = 이자 + 원금', dsBreaks, ops.length));
  checks.push(identity('법인세 ≥ 0', negTax, ops.length));

  // 자금조달 항등식
  const fundingGap = (M.debtAmount ?? 0) + (M.equityAmount ?? 0) - (M.totalProjectCost ?? 0);
  checks.push({
    item: '차입 + 자본 = 총사업비',
    reported: M.totalProjectCost, recomputed: round((M.debtAmount ?? 0) + (M.equityAmount ?? 0), 2),
    ...classify(M.totalProjectCost, (M.debtAmount ?? 0) + (M.equityAmount ?? 0), { absoluteTolerance: 0.05 }),
    message: Math.abs(fundingGap) <= 0.05
      ? '자금조달 합계가 총사업비와 일치한다'
      : `자금조달 합계가 총사업비와 ${round(fundingGap, 2)}억원 어긋난다`,
  });

  // ── 지표 독립 재계산 ───────────────────────────────────
  const projectCFs = [0, ...P.map(p => p.projectCF)];
  const equityCFs = [0, ...P.map(p => p.equityCF)];

  const rProjectIRR = irrNewton(projectCFs);
  const rEquityIRR = irrNewton(equityCFs);
  const rEquityMoic = moic(equityCFs);
  const rProjectMoic = moic(projectCFs);
  const discount = (A.discountRate ?? M.npvDiscountRate ?? 8) / 100;
  const rNpv = npv(discount, equityCFs);

  add('Project IRR', M.projectIRR, pctOrNull(rProjectIRR), classify(M.projectIRR, pctOrNull(rProjectIRR), { absoluteTolerance: 0.02 }),
    'Newton-Raphson 으로 재계산 (원본은 이분법)');
  add('Equity IRR', M.equityIRR, pctOrNull(rEquityIRR), classify(M.equityIRR, pctOrNull(rEquityIRR), { absoluteTolerance: 0.02 }),
    'Newton-Raphson 으로 재계산 (원본은 이분법)');
  add('Equity MOIC', M.equityMOIC, roundOrNull(rEquityMoic, 2), classify(M.equityMOIC, roundOrNull(rEquityMoic, 2), { absoluteTolerance: 0.01 }));
  add('Project MOIC', M.projectMOIC, roundOrNull(rProjectMoic, 2), classify(M.projectMOIC, roundOrNull(rProjectMoic, 2), { absoluteTolerance: 0.01 }));
  add('NPV', M.npv, roundOrNull(rNpv, 2), classify(M.npv, roundOrNull(rNpv, 2), { absoluteTolerance: 0.5 }));

  // DSCR — 표에서 직접 재계산
  const dscrSeries = ops.filter(p => p.debtService > 0).map(p => p.cfads / p.debtService);
  const rMinDscr = dscrSeries.length ? Math.min(...dscrSeries) : null;
  const rAvgDscr = dscrSeries.length ? dscrSeries.reduce((a, b) => a + b, 0) / dscrSeries.length : null;
  add('최소 DSCR', M.minDSCR, roundOrNull(rMinDscr, 2), classify(M.minDSCR, roundOrNull(rMinDscr, 2), { absoluteTolerance: 0.01 }));
  add('평균 DSCR', M.avgDSCR, roundOrNull(rAvgDscr, 2), classify(M.avgDSCR, roundOrNull(rAvgDscr, 2), { absoluteTolerance: 0.01 }));

  // LTV / Debt Yield
  if (M.exitValue) {
    const rLtv = (M.debtBalanceAtExit ?? 0) / M.exitValue * 100;
    add('Exit 시점 LTV', M.ltvAtExit, roundOrNull(rLtv, 2), classify(M.ltvAtExit, roundOrNull(rLtv, 2), { absoluteTolerance: 0.05 }));
  }
  if (M.debtAmount) {
    const rDy = (M.noiStabilized / M.debtAmount) * 100;
    add('Debt Yield', M.debtYield, roundOrNull(rDy, 2), classify(M.debtYield, roundOrNull(rDy, 2), { absoluteTolerance: 0.05 }));
  }

  const order = ['CRITICAL', 'MAJOR', 'WARNING', 'MINOR', 'UNVERIFIABLE', 'PASS'];
  const worst = order.find(l => checks.some(c => c.level === l)) || 'PASS';

  return {
    label, checks, worst,
    recomputed: {
      projectIRR: pctOrNull(rProjectIRR), equityIRR: pctOrNull(rEquityIRR),
      equityMOIC: roundOrNull(rEquityMoic, 2), npv: roundOrNull(rNpv, 2),
      minDSCR: roundOrNull(rMinDscr, 2),
    },
  };
}

function identity(item, breaks, total) {
  return {
    item, reported: null, recomputed: null,
    level: breaks === 0 ? 'PASS' : 'CRITICAL',
    diff: breaks, diffPct: null,
    message: breaks === 0
      ? `${item} — ${total}개 기간 전부 성립`
      : `${item} — ${breaks}/${total}개 기간에서 항등식이 깨졌다`,
  };
}

function fmtv(v) {
  return v === null || v === undefined ? '-' : String(v);
}
function pctOrNull(rate) {
  return rate === null || !Number.isFinite(rate) ? null : round(rate * 100, 2);
}
function roundOrNull(v, d) {
  return v === null || !Number.isFinite(v) ? null : round(v, d);
}

module.exports = { verifyScenario, irrNewton, npv, moic, classify, THRESHOLD };
