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

/**
 * order = 파이프라인 실행 순서.
 *   07_geo 는 03/04 보다 먼저 돈다 — 지적·공시지가가 다른 Agent의 입력이 되기 때문이다.
 *   08_appraisal 은 04_financial 뒤 — 수익환원법에 안정화 NOI가 필요하다.
 *   05_validation 은 모든 산출물이 나온 뒤 마지막에서 두 번째.
 */
const AGENTS = {
  '10_output_spec': { order: 0, label: 'Output Specification Agent', enabled: true, confidenceThreshold: 0.7, approvalRule: 'human', module: '../agents/10-output-spec' },
  '01_project':    { order: 1, label: 'Project Manager Agent',    enabled: true,  confidenceThreshold: 0.5, approvalRule: 'auto',      module: '../agents/01-project' },
  '02_extraction': { order: 2, label: 'Data Extraction Agent',    enabled: true,  confidenceThreshold: 0.6, approvalRule: 'threshold', module: '../agents/02-extraction' },
  '07_geo':        { order: 3, label: 'Geo / Satellite Agent',    enabled: true,  confidenceThreshold: 0.5, approvalRule: 'auto',      module: '../agents/07-geo' },
  '03_research':   { order: 4, label: 'Market Research Agent',    enabled: true,  confidenceThreshold: 0.5, approvalRule: 'threshold', module: '../agents/03-research' },
  '04_financial':  { order: 5, label: 'Financial Agent',          enabled: true,  confidenceThreshold: 0.9, approvalRule: 'auto',      module: '../agents/04-financial' },
  '08_appraisal':  { order: 6, label: 'Appraisal Agent (감정평가)', enabled: true,  confidenceThreshold: 0.6, approvalRule: 'threshold', module: '../agents/08-appraisal' },
  '09_massing':    { order: 7, label: 'Massing / 3D Agent',       enabled: true,  confidenceThreshold: 0.5, approvalRule: 'auto',      module: '../agents/09-massing' },
  '05_validation': { order: 8, label: 'Cross Validation Agent',   enabled: true,  confidenceThreshold: 0.7, approvalRule: 'auto',      module: '../agents/05-validation' },
  '06_im_writer':  { order: 9, label: 'IM Writer Agent',          enabled: true,  confidenceThreshold: 0.7, approvalRule: 'human',     module: '../agents/06-im-writer' },
  '11_final_validation': { order: 10, label: 'Final Validation Agent (독립 검증)', enabled: true, confidenceThreshold: 0.9, approvalRule: 'human', module: '../agents/11-final-validation' },
};

/** 부동산개발 전용 Agent — 다른 자산유형에서는 데이터가 없어 자동으로 건너뛴다 */
const REAL_ESTATE_AGENTS = ['07_geo', '08_appraisal', '09_massing'];

/** Phase 2/3 — 아직 구현하지 않은 Agent (Control Center에 '미구현'으로 노출) */
const PLANNED = {
  '12_legal':        { label: 'Legal & Permit Agent', phase: 2 },
  '13_technical':    { label: 'Technical Agent', phase: 2 },
  '14_risk':         { label: 'Risk Agent', phase: 2, note: '현재는 05_validation 이 RED/YELLOW/GREEN 을 겸한다' },
  '15_design':       { label: 'Design Agent (PDF/PPT)', phase: 2, note: '3D 매스 SVG/glTF는 09_massing 이 이미 생성한다' },
  '16_reviewer':     { label: 'Reviewer Agent (QC Score)', phase: 2, note: '11_final_validation 이 대체 — 별도 구현 불필요' },
  '17_distribution': { label: 'Distribution Agent', phase: 3, note: '외부 발송 — 사람 승인 없이는 절대 실행하지 않는다' },
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

module.exports = { AGENTS, PLANNED, REAL_ESTATE_AGENTS, list, get, load };
