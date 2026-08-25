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
const monitor = require('./monitor');

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
    if (ctx && ctx.projectId) {
      try {
        monitor.update(ctx.projectId, agentId, {
          status: monitor.FROM_RUNTIME[status] || monitor.STATUS.WARNING,
          warnings: result.warnings, error: result.error,
          activity: result.error || (result.warnings.length ? result.warnings[0] : '완료'),
        });
      } catch (_) { /* 모니터 실패가 실행을 막지 않는다 */ }
      /**
       * ★★★ **실패한 까닭을 활동 기록에도 남긴다** 〈2026-08-24 · 실제로 당했다〉.
       *
       *   화면의 활동 기록은 `activity.jsonl` 만 읽는다. 그런데 여기 쌓이는 것은
       *   ctx.warn 과 ctx.activity 뿐이었다 — **죽은 까닭은 한 줄도 안 들어갔다.**
       *   그래서 사장님 화면에는 「생성 중 문제가 생겼습니다」만 뜨고, 로그에는
       *   경고 몇 줄만 남아 **무엇이 멈췄는지 아무도 알 수 없었다.**
       *
       * ★ 상태는 monitor 안에 있었다. 없어서 못 본 것이 아니라 **안 옮겨서**
       *   못 본 것이다 — 조용히 죽는 것과 결과가 같다.
       */
      if (status === STATUS.ERROR || status === STATUS.BLOCKED) {
        try {
          monitor.activity(ctx.projectId, agentId,
            `${status === STATUS.ERROR ? '실패' : '막힘'}: ${result.error || '까닭이 기록되지 않았다'}`,
            { level: 'ERROR' });
        } catch (_) { /* 기록 실패가 실행을 막지 않는다 */ }
      }
    }
    if (ctx && typeof ctx.log === 'function') {
      const icon = { complete: '●', warning: '▲', needs_review: '◐', blocked: '■', skipped: '○', error: '✕' }[status] || '·';
      ctx.log(`${icon} ${agentId} ${meta ? meta.label : ''} — ${status}${result.error ? ` (${result.error})` : ''}`);
    }
    return result;
  };

  if (!meta) return record(STATUS.ERROR, { error: `등록되지 않은 Agent: ${agentId}` });
  if (!meta.enabled) return record(STATUS.SKIPPED, { warnings: ['Agent OFF'] });

  // Control Tower — 실행 시작 알림
  if (ctx && ctx.projectId) {
    try { monitor.update(ctx.projectId, agentId, { status: monitor.STATUS.RUNNING, progress: 5, activity: '시작' }); } catch (_) { /* 모니터 실패가 실행을 막지 않는다 */ }
  }

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
  const report = (message, opts) => {
    if (ctx && ctx.projectId) {
      try { monitor.activity(ctx.projectId, agentId, message, opts); } catch (_) { /* 무시 */ }
    }
  };
  try {
    output = await agent.run(input, {
      ...ctx,
      warn: m => { warnings.push(m); report(m, { level: 'WARN' }); },
      activity: report,
    });
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
