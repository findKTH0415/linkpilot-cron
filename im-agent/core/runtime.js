'use strict';
/**
 * runtime.js — Agent 실행기.
 *
 * 모든 Agent는 동일 계약을 따른다:
 *   module.exports = { id, label, inputSchema, outputSchema, run(input, ctx) }
 *
 * runtime이 강제하는 것:
 *   ① 입력 스키마 검증 → 위반 시 실행 안 함
 *   ② 출력 스키마 검증 → 위반 시 error 로 격리 (다음 Agent에 오염 전달 금지)
 *   ③ confidence 임계 미달 시 needs_review 로 표시
 *   ④ approvalRule='human' 이면 승인 전까지 downstream 진행 차단
 *   ⑤ 실패는 격리한다 — 한 Agent가 죽어도 파이프라인 전체를 죽이지 않는다
 */

const { assertValid } = require('./schema');
const { kstStamp } = require('./kst');
const registry = require('./registry');
const store = require('./store');

const STATUS = {
  COMPLETE: 'complete',
  WARNING: 'warning',
  NEEDS_REVIEW: 'needs_review',
  BLOCKED: 'blocked',
  SKIPPED: 'skipped',
  ERROR: 'error',
};

/**
 * @param {string} agentId
 * @param {object} input
 * @param {object} ctx { projectId, dataset, log }
 * @returns {Promise<{agentId,status,output,warnings,error,elapsedMs}>}
 */
async function runAgent(agentId, input, ctx) {
  const meta = registry.get(agentId);
  const started = Date.now();

  const record = (status, extra = {}) => {
    const result = {
      agentId, label: meta ? meta.label : agentId, status,
      output: null, warnings: [], error: null,
      elapsedMs: Date.now() - started, at: kstStamp(), ...extra,
    };
    if (ctx && ctx.projectId) {
      store.appendRunLog(ctx.projectId, {
        agent: agentId, status: result.status,
        warnings: result.warnings, error: result.error, elapsedMs: result.elapsedMs,
      });
    }
    if (ctx && typeof ctx.log === 'function') {
      const icon = { complete: '●', warning: '▲', needs_review: '◐', blocked: '■', skipped: '○', error: '✕' }[status] || '·';
      ctx.log(`${icon} ${agentId} ${meta ? meta.label : ''} — ${status}${result.error ? ` (${result.error})` : ''}`);
    }
    return result;
  };

  if (!meta) return record(STATUS.ERROR, { error: `등록되지 않은 Agent: ${agentId}` });
  if (!meta.enabled) return record(STATUS.SKIPPED, { warnings: ['Agent OFF'] });

  let agent;
  try {
    agent = registry.load(agentId);
  } catch (e) {
    return record(STATUS.ERROR, { error: `모듈 로드 실패: ${e.message}` });
  }

  try {
    if (agent.inputSchema) assertValid(input, agent.inputSchema, `${agentId} 입력`);
  } catch (e) {
    return record(STATUS.ERROR, { error: e.message });
  }

  let output;
  const warnings = [];
  try {
    output = await agent.run(input, { ...ctx, warn: m => warnings.push(m) });
  } catch (e) {
    return record(STATUS.ERROR, { error: e.message, warnings });
  }

  try {
    if (agent.outputSchema) assertValid(output, agent.outputSchema, `${agentId} 출력`);
  } catch (e) {
    return record(STATUS.ERROR, { error: e.message, warnings });
  }

  // confidence 판정
  const confidence = typeof output?.confidence === 'number' ? output.confidence : null;
  let status = warnings.length ? STATUS.WARNING : STATUS.COMPLETE;

  if (meta.approvalRule === 'threshold' && confidence !== null && confidence < meta.confidenceThreshold) {
    status = STATUS.NEEDS_REVIEW;
    warnings.push(`신뢰도 ${confidence.toFixed(2)} < 임계 ${meta.confidenceThreshold} — 사람 검토 필요`);
  }
  if (meta.approvalRule === 'human') {
    warnings.push('사람 승인 필요 — 승인 전 배포 불가');
  }

  return record(status, { output, warnings });
}

module.exports = { runAgent, STATUS };
