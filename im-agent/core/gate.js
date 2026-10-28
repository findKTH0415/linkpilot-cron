'use strict';
/**
 * gate.js — Human-in-the-Loop 승인 게이트.
 *
 * 원칙: AI prepares → Human approves.
 * 사람 승인 기록 없이는 12_Final / 13_Distribution 단계로 넘어갈 수 없다.
 * 승인 기록은 프로젝트 폴더에 남으며(감사 추적), RED FLAG가 있으면 승인 자체가 거부된다.
 */

const store = require('./store');
const issuer = require('./issuer');
const pexels = require('../connectors/pexels');
const { kstStamp } = require('./kst');

const APPROVAL_PATH = '11_QC/approval.json';

function readApproval(projectId) {
  return store.readJson(projectId, APPROVAL_PATH, null);
}

/**
 * 승인 가능 여부 판정. RED FLAG가 하나라도 있으면 승인 불가.
 * @returns {{allowed:boolean, reasons:string[]}}
 */
function canApprove(projectId) {
  const validation = store.readJson(projectId, '11_QC/validation.json', null);
  const reasons = [];

  if (!validation) {
    reasons.push('Cross Validation 미실행 — 검증 없이 승인할 수 없다');
    return { allowed: false, reasons };
  }
  const red = (validation.flags || []).filter(f => f.severity === 'RED');
  if (red.length) {
    reasons.push(`RED FLAG ${red.length}건 미해소: ${red.slice(0, 3).map(f => f.message).join(' / ')}`);
  }
  const im = store.readJson(projectId, '09_IM/im.json', null);
  if (!im) reasons.push('IM 미생성');
  else if ((im.unsourcedNumbers || []).length) {
    reasons.push(`출처 미확인 숫자 ${im.unsourcedNumbers.length}건이 본문에 존재`);
  }

  // 디자인 규칙 RED 위반도 배포를 막는다 (핸드오프 게이트와 같은 취급)
  const designRed = ((im && im.designViolations) || []).filter(v => v.severity === 'RED');
  if (designRed.length) {
    reasons.push(`디자인 규칙 위반 ${designRed.length}건: ${designRed.slice(0, 2).map(v => v.rule).join(', ')}`);
  }

  // 최종 독립검증(11_final_validation) — 앞선 검증을 통과했어도 여기서 막힐 수 있다
  const final = store.readJson(projectId, '11_QC/final-validation.json', null);
  if (!final) {
    reasons.push('최종 독립검증 미실행 — 재계산·교차대조 없이 승인할 수 없다');
  } else {
    if (final.status === 'DISTRIBUTION BLOCKED') {
      const codes = [...new Set(final.issues.filter(i => i.severity === 'CRITICAL').map(i => i.code))];
      reasons.push(`최종검증 배포차단 (${final.score.total}/100): ${codes.join(', ')}`);
    } else if (final.score.total < 90) {
      reasons.push(`최종검증 점수 ${final.score.total}/100 — 90점 미만은 수정이 필요하다`);
    }
  }

  // 출력 사양이 확정되지 않으면 최종 산출물이 아니라 초안이다
  const spec = store.readJson(projectId, '01_Project/output-spec.json', null);
  if (!spec || !spec.locked) {
    reasons.push('출력 사양 미확정 (DRAFT) — 페이지 수·형식·언어를 사람이 확정해야 한다');
  }

  // 발행 주체가 없으면 누가 낸 문서인지 알 수 없다. 대외 배포 문서라
  // 잘못 나가면 회수할 수 없다 — 여기서 막는다 (core/issuer.js)
  if (!issuer.read(projectId)) {
    reasons.push('발행 주체 미설정 — issuer.json 에 회사 정보를 넣어야 대외 배포할 수 있다');
  }

  // ★ 참고 이미지(스톡 사진)는 **내부 검토본까지만** 쓴다 (2026-08-16 결정 · D-50).
  //   캡션이 붙어 있어도 대외 문서에 남의 사진이 실리는 것은 다른 문제다.
  //   **파일이 남아 있기만 해도 막는다** — 「문서에 안 넣었다」를 코드가 알 방법이
  //   없고, 사람이 「안 넣었다」고 믿는 것이 바로 사고가 나는 자리다.
  reasons.push(...pexels.externalBlockers(store.projectDir(projectId)));

  return { allowed: reasons.length === 0, reasons };
}

/**
 * 승인 기록. approver 는 사람 식별자여야 한다 (AI 자동승인 금지).
 */
function approve(projectId, { approver, decision = 'APPROVE', comment = '' }) {
  if (!approver || /agent|ai|auto|claude|gemini/i.test(approver)) {
    throw new Error('approver 는 사람이어야 한다 — AI 자동 승인은 금지된다');
  }
  const check = canApprove(projectId);
  if (decision === 'APPROVE' && !check.allowed) {
    throw new Error(`승인 불가: ${check.reasons.join(' / ')}`);
  }
  const record = {
    projectId, decision, approver, comment,
    at: kstStamp(),
    checkedReasons: check.reasons,
  };
  store.writeJson(projectId, APPROVAL_PATH, record);
  store.appendRunLog(projectId, { agent: 'human_approval', status: decision.toLowerCase(), approver });
  return record;
}

/** 배포 허용 여부 — Distribution Agent(Phase 3)가 반드시 이 함수를 통과해야 한다 */
function distributionAllowed(projectId) {
  const a = readApproval(projectId);
  if (!a) return { allowed: false, reason: '사람 승인 기록 없음' };
  if (a.decision !== 'APPROVE') return { allowed: false, reason: `승인 상태: ${a.decision}` };
  return { allowed: true, reason: `승인자 ${a.approver} (${a.at})` };
}

module.exports = { canApprove, approve, readApproval, distributionAllowed, APPROVAL_PATH };
