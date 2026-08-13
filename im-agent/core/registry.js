'use strict';
/**
 * registry.js — Agent Control Center의 설정 원본.
 *
 * Agent마다 다음을 선언한다:
 *   enabled / model / confidenceThreshold / approvalRule / inputSchema / outputSchema
 *
 * approvalRule:
 *   'auto'      — 결과를 그대로 다음 Agent로 넘긴다
 *   'threshold' — 평균 confidence 가 임계치 미만이면 human 검토 대기(status=needs_review)
 *   'human'     — 항상 사람 승인 필요 (배포계열)
 *
 * 환경변수로 개별 ON/OFF 가능: IM_AGENT_DISABLE="03_research,05_validation"
 */

const AGENTS = {
  '01_project':    { order: 1, label: 'Project Manager Agent',  enabled: true,  confidenceThreshold: 0.5, approvalRule: 'auto',      module: '../agents/01-project' },
  '02_extraction': { order: 2, label: 'Data Extraction Agent',  enabled: true,  confidenceThreshold: 0.6, approvalRule: 'threshold', module: '../agents/02-extraction' },
  '03_research':   { order: 3, label: 'Market Research Agent',  enabled: true,  confidenceThreshold: 0.5, approvalRule: 'threshold', module: '../agents/03-research' },
  '04_financial':  { order: 4, label: 'Financial Agent',        enabled: true,  confidenceThreshold: 0.9, approvalRule: 'auto',      module: '../agents/04-financial' },
  '05_validation': { order: 5, label: 'Cross Validation Agent', enabled: true,  confidenceThreshold: 0.7, approvalRule: 'auto',      module: '../agents/05-validation' },
  '06_im_writer':  { order: 6, label: 'IM Writer Agent',        enabled: true,  confidenceThreshold: 0.7, approvalRule: 'human',     module: '../agents/06-im-writer' },
};

/** Phase 2/3 — 아직 구현하지 않은 Agent (Control Center에 '미구현'으로 노출) */
const PLANNED = {
  '07_legal':        { label: 'Legal & Permit Agent', phase: 2 },
  '08_technical':    { label: 'Technical Agent', phase: 2 },
  '09_risk':         { label: 'Risk Agent', phase: 2, note: '현재는 05_validation 이 RED/YELLOW/GREEN 을 겸한다' },
  '10_design':       { label: 'Design Agent (PDF/PPT)', phase: 2 },
  '11_reviewer':     { label: 'Reviewer Agent (QC Score)', phase: 2, note: '현재는 05_validation 의 score 로 대체' },
  '12_distribution': { label: 'Distribution Agent', phase: 3, note: '외부 발송 — 사람 승인 없이는 절대 실행하지 않는다' },
};

function disabledFromEnv() {
  return (process.env.IM_AGENT_DISABLE || '').split(',').map(s => s.trim()).filter(Boolean);
}

function list() {
  const off = disabledFromEnv();
  return Object.entries(AGENTS)
    .map(([id, a]) => ({ id, ...a, enabled: a.enabled && !off.includes(id) }))
    .sort((a, b) => a.order - b.order);
}

function get(id) {
  const off = disabledFromEnv();
  const a = AGENTS[id];
  if (!a) return null;
  return { id, ...a, enabled: a.enabled && !off.includes(id) };
}

function load(id) {
  const a = get(id);
  if (!a) throw new Error(`알 수 없는 Agent: ${id}`);
  return require(a.module);
}

module.exports = { AGENTS, PLANNED, list, get, load };
