'use strict';
/**
 * 04 Financial Agent
 *
 * ★ LLM을 단 한 번도 호출하지 않는다. IM에 실리는 모든 투자지표는 여기서만 나온다.
 *
 * 입력: Dataset(검증 대상 Fact) + 자산유형 Template
 * 출력: Base/Upside/Downside 3개 시나리오 현금흐름 + 지표 + 민감도 + 가정치 목록
 */

const { buildModel } = require('../finance/model');
const { getTemplate, buildInput, applyScenario, BASE_SCENARIOS } = require('../finance/templates');
const { sensitivity } = require('../finance/metrics');
const { requiredFor } = require('../core/dictionary');
const { round } = require('../core/numeric');

const inputSchema = {
  type: 'object',
  required: ['projectId', 'templateId'],
  properties: {
    projectId: { type: 'string' },
    templateId: { type: 'string' },
  },
};

const outputSchema = {
  type: 'object',
  required: ['scenarios', 'assumed', 'missing'],
  properties: {
    scenarios: { type: 'object' },
    assumed: { type: 'array' },
    missing: { type: 'array' },
    sensitivity: { type: 'object', nullable: true },
    computedFacts: { type: 'array' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

async function run(input, ctx) {
  const dataset = ctx.dataset;
  if (!dataset) throw new Error('ctx.dataset 필요 — Financial Agent는 Dataset에서만 값을 읽는다');

  const template = getTemplate(input.templateId);
  const { input: baseInput, sourced, assumed } = buildInput(template, dataset);

  const missing = dataset.missing(requiredFor('financial'));
  if (missing.length) {
    ctx.warn(`재무모델 필수 항목 ${missing.length}건 미확인 → 통상치로 대체됨: ${missing.join(', ')}`);
  }
  if (dataset.num('revenue.annual') === null) {
    ctx.warn('연간 매출이 원본자료에서 확인되지 않았다 — 모든 수익성 지표는 가정 기반이며 IM 사용 전 반드시 확인이 필요하다');
  }

  // ── 3개 시나리오 ──
  const scenarios = {};
  for (const [key, sc] of Object.entries(BASE_SCENARIOS)) {
    const scInput = applyScenario(baseInput, sc);
    const model = buildModel(scInput);
    scenarios[key] = {
      label: sc.label,
      deltas: sc.deltas,
      metrics: model.metrics,
      assumptions: model.assumptions,
      periods: model.periods,
    };
  }

  // ── 민감도 (Base 기준, Equity IRR) ──
  let sens = null;
  try {
    const [axisA, axisB] = template.sensitivity;
    sens = sensitivity(
      (a, b) => {
        const trial = { ...baseInput };
        trial[axisA.key] = axisA.key.endsWith('Rate') || axisA.label.includes('pp')
          ? baseInput[axisA.key] + a
          : baseInput[axisA.key] * (1 + a / 100);
        trial[axisB.key] = axisB.label.includes('pp')
          ? baseInput[axisB.key] + b
          : baseInput[axisB.key] * (1 + b / 100);
        const m = buildModel(trial).metrics;
        return m.equityIRR;
      },
      { label: axisA.label, values: axisA.values },
      { label: axisB.label, values: axisB.values },
    );
    sens.metric = 'Equity IRR (%)';
  } catch (e) {
    ctx.warn(`민감도 계산 실패: ${e.message}`);
  }

  // ── 계산된 지표를 Fact로 되돌린다 (출처 = 재무모델, verified=true) ──
  const base = scenarios.base.metrics;
  const computedFacts = [
    ['returns.project_irr', base.projectIRR, '%'],
    ['returns.equity_irr', base.equityIRR, '%'],
    ['returns.project_moic', base.projectMOIC, 'x'],
    ['returns.equity_moic', base.equityMOIC, 'x'],
    ['returns.npv', base.npv, '억원'],
    ['returns.min_dscr', base.minDSCR, 'x'],
    ['returns.avg_dscr', base.avgDSCR, 'x'],
    ['returns.debt_yield', base.debtYield, '%'],
    ['returns.exit_value', base.exitValue, '억원'],
    ['returns.noi_stabilized', base.noiStabilized, '억원'],
    ['returns.payback_years', base.paybackYears, '년'],
  ].filter(([, v]) => v !== null && v !== undefined)
    .map(([key, value, unit]) => ({
      key, value, unit,
      source: 'financial_model (04_financial)',
      page: null,
      confidence: 0.95,
      verified: true, // 계산값은 재현 가능하므로 검증됨으로 본다
      note: `Base 시나리오 · 가정치 ${assumed.length}건 포함`,
    }));

  // 신뢰도 = 출처 있는 입력의 비율
  const totalFields = sourced.length + assumed.length;
  const confidence = totalFields ? round(sourced.length / totalFields, 3) : 0;

  if (confidence < 0.5) {
    ctx.warn(`재무모델 입력의 ${Math.round((1 - confidence) * 100)}%가 가정치다 — IM에 '가정 기반'임을 명시해야 한다`);
  }

  return {
    scenarios, assumed, missing, sensitivity: sens, computedFacts,
    sourcedFields: sourced, confidence,
  };
}

module.exports = { id: '04_financial', label: 'Financial Agent', inputSchema, outputSchema, run };
