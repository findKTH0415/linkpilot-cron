'use strict';
/**
 * model.js — 프로젝트 현금흐름 모델 (결정적 계산, LLM 미사용).
 *
 * 모델 규약 (IM 본문의 '가정' 절에 그대로 노출된다):
 *  - 연 단위, 기말 현금흐름. 0기 = 착공 직전.
 *  - 금액 단위: 억원.
 *  - 자기자본 선투입(equity-first) → 소진 후 차입 인출.
 *  - 건설기간 이자(IDC)는 자본화하여 총사업비에 가산 → 차입금 재계산(고정점 반복 5회).
 *  - 감가상각: 정액법, 상각대상 = 총사업비 − 토지비.
 *  - 세무상 결손금은 이월(NOL carryforward)한다.
 *  - Exit: 매각연도 다음 해 NOI ÷ Cap Rate, 매각부대비용 차감.
 *  - 운전자본, 부가세, 준공 후 추가 CAPEX는 반영하지 않는다.
 */

const M = require('./metrics');
const { round } = require('../core/numeric');

const DEFAULTS = {
  contingencyPct: 0,
  otherCost: 0,
  revenueEscalation: 2,
  opexEscalation: 2,
  opexRatio: null,
  opexAnnual: null,
  rampYears: 1,
  taxRate: 22,
  depreciationYears: 30,
  graceYears: 2,
  tenorYears: 10,
  feePct: 0,
  ltc: 60,
  exitCapRate: 6,
  sellingCostPct: 1.5,
  discountRate: 8,
};

function pctToRate(p) { return (Number(p) || 0) / 100; }

/**
 * @param {object} inp 정규화된 모델 입력 (억원 / % / 년)
 * @returns {object} { assumptions, periods, metrics }
 */
function buildModel(input) {
  const inp = { ...DEFAULTS, ...input };

  const C = Math.max(0, Math.round(Number(inp.constructionYears) || 0));
  const O = Math.max(1, Math.round(Number(inp.opsYears) || 1));
  const exitYear = Math.min(O, Math.max(1, Math.round(Number(inp.exitYear) || O)));

  const hardCost = num(inp.landCost) + num(inp.constructionCost) + num(inp.otherCost);
  const contingency = hardCost * pctToRate(inp.contingencyPct);
  const baseCost = num(inp.totalCost) > 0 && !inp.forceComponentSum
    ? num(inp.totalCost)
    : hardCost + contingency;

  const rate = pctToRate(inp.debtRate);

  // ── 1) IDC 고정점 반복: 차입금 → IDC → 총사업비 → 차입금 ──
  let idc = 0;
  let debt = 0;
  let totalCost = baseCost;
  let equity = 0;
  let capexSchedule = [];
  let drawSchedule = null;

  for (let iter = 0; iter < 5; iter++) {
    totalCost = baseCost + idc;
    debt = num(inp.debtAmount) > 0 ? num(inp.debtAmount) : totalCost * pctToRate(inp.ltc);
    debt = Math.min(debt, totalCost);
    equity = totalCost - debt;

    capexSchedule = spreadCapex(baseCost, C, inp.capexCurve);
    drawSchedule = drawEquityFirst(capexSchedule, equity);
    idc = computeIdc(drawSchedule.debtDraws, rate);
    if (C === 0) { idc = 0; break; }
  }

  const fee = debt * pctToRate(inp.feePct);
  totalCost = baseCost + idc + fee;
  debt = num(inp.debtAmount) > 0 ? num(inp.debtAmount) : totalCost * pctToRate(inp.ltc);
  debt = Math.min(debt, totalCost);
  equity = totalCost - debt;
  capexSchedule = spreadCapex(baseCost, C, inp.capexCurve);
  drawSchedule = drawEquityFirst(capexSchedule, equity);

  // ── 2) 운영기 매출/비용 ──
  const revEsc = pctToRate(inp.revenueEscalation);
  const opexEsc = pctToRate(inp.opexEscalation);
  const ramp = buildRamp(Math.round(Number(inp.rampYears) || 0), O);
  const stabilizedRevenue = num(inp.annualRevenue);

  // ── 3) 차입금 상환 스케줄 ──
  const grace = Math.min(Math.max(0, Math.round(Number(inp.graceYears) || 0)), O);
  const tenor = Math.max(1, Math.round(Number(inp.tenorYears) || 1));
  const amortYears = Math.max(1, tenor - grace);
  const payment = M.annuityPayment(debt, rate, amortYears);

  const depBase = Math.max(0, totalCost - num(inp.landCost));
  const depYears = Math.max(1, Math.round(Number(inp.depreciationYears) || 1));
  const annualDep = depBase / depYears;
  const taxRate = pctToRate(inp.taxRate);

  const periods = [];

  // 건설기
  for (let y = 1; y <= C; y++) {
    periods.push({
      year: y, phase: 'construction',
      capex: round(capexSchedule[y - 1], 2),
      equityDraw: round(drawSchedule.equityDraws[y - 1], 2),
      debtDraw: round(drawSchedule.debtDraws[y - 1], 2),
      revenue: 0, opex: 0, noi: 0,
      interest: 0, principal: 0, debtService: 0,
      depreciation: 0, taxableIncome: 0, tax: 0,
      cfads: 0, equityCF: round(-drawSchedule.equityDraws[y - 1], 2),
      projectCF: round(-capexSchedule[y - 1], 2),
      debtBalance: round(drawSchedule.debtDraws.slice(0, y).reduce((a, b) => a + b, 0), 2),
    });
  }

  // 운영기
  let balance = debt;
  let nolLevered = 0;
  let nolUnlevered = 0;
  let stabilizedNoiAtExit = 0;
  let debtBalanceAtExit = 0;

  for (let y = 1; y <= exitYear; y++) {
    const idx = C + y;
    const revenue = stabilizedRevenue * ramp[y - 1] * Math.pow(1 + revEsc, y - 1);
    const opex = inp.opexRatio !== null && inp.opexRatio !== undefined
      ? revenue * pctToRate(inp.opexRatio)
      : num(inp.opexAnnual) * Math.pow(1 + opexEsc, y - 1);
    const noi = revenue - opex;

    const interest = balance * rate;
    const principal = y <= grace ? 0 : Math.max(0, Math.min(balance, payment - interest));
    const debtService = interest + principal;

    const depreciation = y <= depYears ? annualDep : 0;

    // 레버리지 기준 과세
    let taxableL = noi - depreciation - interest - nolLevered;
    let taxL = 0;
    if (taxableL > 0) { taxL = taxableL * taxRate; nolLevered = 0; }
    else { nolLevered = -taxableL; taxableL = 0; }

    // 무레버리지(프로젝트) 기준 과세
    let taxableU = noi - depreciation - nolUnlevered;
    let taxU = 0;
    if (taxableU > 0) { taxU = taxableU * taxRate; nolUnlevered = 0; }
    else { nolUnlevered = -taxableU; taxableU = 0; }

    const cfads = noi - taxL;
    let equityCF = cfads - debtService;
    let projectCF = noi - taxU;

    balance = Math.max(0, balance - principal);

    if (y === exitYear) {
      // Exit: 다음 해 NOI 기준 (안정화 가정)
      debtBalanceAtExit = balance;
      const nextRevenue = stabilizedRevenue * ramp[Math.min(y, ramp.length - 1)] * Math.pow(1 + revEsc, y);
      const nextOpex = inp.opexRatio !== null && inp.opexRatio !== undefined
        ? nextRevenue * pctToRate(inp.opexRatio)
        : num(inp.opexAnnual) * Math.pow(1 + opexEsc, y);
      stabilizedNoiAtExit = nextRevenue - nextOpex;
      const exitValue = pctToRate(inp.exitCapRate) > 0 ? stabilizedNoiAtExit / pctToRate(inp.exitCapRate) : 0;
      const exitNet = exitValue * (1 - pctToRate(inp.sellingCostPct));
      projectCF += exitNet;
      equityCF += exitNet - balance;
      periods.push(mkOps(idx, y, { revenue, opex, noi, interest, principal, debtService, depreciation, taxableL, taxL, cfads, equityCF, projectCF, balance: 0, exitValue, exitNet }));
      balance = 0;
      break;
    }

    periods.push(mkOps(idx, y, { revenue, opex, noi, interest, principal, debtService, depreciation, taxableL, taxL, cfads, equityCF, projectCF, balance }));
  }

  // ── 4) 지표 ──
  const projectCFs = [0, ...periods.map(p => p.projectCF)];
  const equityCFs = [0, ...periods.map(p => p.equityCF)];
  const opsPeriods = periods.filter(p => p.phase === 'operation');
  const dscr = M.dscrSeries(opsPeriods.map(p => p.cfads), opsPeriods.map(p => p.debtService));

  const firstStabilized = opsPeriods.find(p => p.revenue >= stabilizedRevenue * 0.99);
  const noiStabilized = firstStabilized ? firstStabilized.noi : (opsPeriods.length ? opsPeriods[opsPeriods.length - 1].noi : 0);
  const exitPeriod = periods[periods.length - 1];

  const metrics = {
    totalProjectCost: round(totalCost, 2),
    idc: round(idc, 2),
    arrangementFee: round(fee, 2),
    debtAmount: round(debt, 2),
    equityAmount: round(equity, 2),
    ltc: round(totalCost ? (debt / totalCost) * 100 : 0, 2),
    projectIRR: pctOrNull(M.irr(projectCFs)),
    equityIRR: pctOrNull(M.irr(equityCFs)),
    projectMOIC: roundOrNull(M.moic(projectCFs), 2),
    equityMOIC: roundOrNull(M.moic(equityCFs), 2),
    npv: roundOrNull(M.npv(pctToRate(inp.discountRate), equityCFs), 2),
    npvDiscountRate: Number(inp.discountRate),
    minDSCR: roundOrNull(M.minDscr(dscr), 2),
    avgDSCR: roundOrNull(M.avgDscr(dscr), 2),
    dscrSeries: dscr.map(v => roundOrNull(v, 2)),
    noiStabilized: round(noiStabilized, 2),
    exitValue: exitPeriod && exitPeriod.exitValue ? round(exitPeriod.exitValue, 2) : null,
    exitNet: exitPeriod && exitPeriod.exitNet ? round(exitPeriod.exitNet, 2) : null,
    capRateOnCost: round(totalCost ? (noiStabilized / totalCost) * 100 : 0, 2),
    debtYield: round(debt ? (noiStabilized / debt) * 100 : 0, 2),
    debtBalanceAtExit: round(debtBalanceAtExit, 2),
    ltvAtExit: exitPeriod && exitPeriod.exitValue ? round((debtBalanceAtExit / exitPeriod.exitValue) * 100, 2) : null,
    paybackYears: roundOrNull(M.paybackPeriod(equityCFs), 1),
  };

  const assumptions = {
    constructionYears: C, opsYears: O, exitYear,
    landCost: round(num(inp.landCost), 2),
    constructionCost: round(num(inp.constructionCost), 2),
    otherCost: round(num(inp.otherCost), 2),
    contingencyPct: Number(inp.contingencyPct),
    annualRevenue: round(stabilizedRevenue, 2),
    revenueEscalation: Number(inp.revenueEscalation),
    opexRatio: inp.opexRatio ?? null,
    opexAnnual: inp.opexAnnual ?? null,
    opexEscalation: Number(inp.opexEscalation),
    debtRate: Number(inp.debtRate),
    ltc: round(totalCost ? (debt / totalCost) * 100 : 0, 2),
    tenorYears: tenor, graceYears: grace, feePct: Number(inp.feePct),
    taxRate: Number(inp.taxRate), depreciationYears: depYears,
    exitCapRate: Number(inp.exitCapRate), sellingCostPct: Number(inp.sellingCostPct),
    discountRate: Number(inp.discountRate),
    rampYears: Number(inp.rampYears),
  };

  return { assumptions, periods, metrics, _input: inp };
}

function mkOps(idx, y, o) {
  return {
    year: idx, opsYear: y, phase: 'operation',
    capex: 0, equityDraw: 0, debtDraw: 0,
    revenue: round(o.revenue, 2), opex: round(o.opex, 2), noi: round(o.noi, 2),
    interest: round(o.interest, 2), principal: round(o.principal, 2), debtService: round(o.debtService, 2),
    depreciation: round(o.depreciation, 2), taxableIncome: round(o.taxableL, 2), tax: round(o.taxL, 2),
    cfads: round(o.cfads, 2), equityCF: round(o.equityCF, 2), projectCF: round(o.projectCF, 2),
    debtBalance: round(o.balance, 2),
    ...(o.exitValue !== undefined ? { exitValue: round(o.exitValue, 2), exitNet: round(o.exitNet, 2) } : {}),
  };
}

/** 건설비 연차 배분. curve 미지정 시 균등 */
function spreadCapex(total, years, curve) {
  if (years <= 0) return [];
  if (Array.isArray(curve) && curve.length === years) {
    const sum = curve.reduce((a, b) => a + b, 0) || 1;
    return curve.map(w => (total * w) / sum);
  }
  return Array.from({ length: years }, () => total / years);
}

/** 자기자본 선투입 → 소진 후 차입 */
function drawEquityFirst(capexSchedule, equity) {
  let remainingEquity = equity;
  const equityDraws = [];
  const debtDraws = [];
  for (const capex of capexSchedule) {
    const e = Math.min(remainingEquity, capex);
    remainingEquity -= e;
    equityDraws.push(e);
    debtDraws.push(capex - e);
  }
  return { equityDraws, debtDraws };
}

/** 건설기간 이자: 각 연도 인출액은 연중 균등 인출로 보아 절반만 이자 부담 */
function computeIdc(debtDraws, rate) {
  let balance = 0;
  let idc = 0;
  for (const draw of debtDraws) {
    idc += (balance + draw / 2) * rate;
    balance += draw;
  }
  return idc;
}

/**
 * 매출 ramp 계수 배열.
 *   rampYears=0 → [1, 1, 1, ...]        (즉시 안정화)
 *   rampYears=1 → [0.5, 1, 1, ...]
 *   rampYears=2 → [0.33, 0.67, 1, ...]  (선형 증가)
 * 안전을 위해 opsYears + 1 개를 만든다 (Exit 연도 다음 해 NOI 산정에 사용).
 */
function buildRamp(rampYears, opsYears) {
  const n = Math.max(1, opsYears) + 1;
  const r = Math.max(0, rampYears);
  return Array.from({ length: n }, (_, i) => {
    const y = i + 1;
    if (r <= 0) return 1;
    return y > r ? 1 : y / (r + 1);
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pctOrNull(rate) {
  return rate === null || !Number.isFinite(rate) ? null : round(rate * 100, 2);
}

function roundOrNull(v, d) {
  return v === null || !Number.isFinite(v) ? null : round(v, d);
}

module.exports = { buildModel, DEFAULTS, spreadCapex, drawEquityFirst, computeIdc, buildRamp };
