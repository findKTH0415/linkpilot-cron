'use strict';
/**
 * confidence.js — Confidence 등급 (A~E).
 *
 * 요청 사양의 A~E 등급과 기존 구현의 (confidence 0~1 + verified) 를 **이중 관리하지 않는다.**
 * 등급은 기존 값에서 파생되는 표시 계층일 뿐이며, 저장되는 원본은 여전히 숫자 + verified 다.
 * 두 곳에 따로 적으면 반드시 어긋난다.
 *
 *   A = Official / Verified   공적장부·감사자료·계산결과 등 검증된 값
 *   B = Reliable External     신뢰할 수 있는 외부 출처 (단일 출처)
 *   C = Estimated             문서 기반 추정
 *   D = AI Assumption         템플릿 통상치·모델 가정
 *   E = Unverified            출처 미확인
 */

/** 출처 문자열로 공적 자료 여부를 판별한다 */
const OFFICIAL_SOURCE = /지적공부|건축물대장|공시지가|토지이용계획|국토계획법|국토교통부|VWorld|financial_model|매스 검토 Agent|등기/;
const ASSUMPTION_SOURCE = /가정|통상치|template|Agent 기본/;

/**
 * @param {object} fact Fact 또는 {source, confidence, verified, note}
 * @returns {'A'|'B'|'C'|'D'|'E'}
 */
function grade(fact) {
  if (!fact || !fact.source) return 'E';

  const source = String(fact.source);
  const note = String(fact.note || '');
  const c = Number(fact.confidence);
  const conf = Number.isFinite(c) ? c : 0;

  if (ASSUMPTION_SOURCE.test(source) || ASSUMPTION_SOURCE.test(note)) return 'D';
  if (fact.verified && OFFICIAL_SOURCE.test(source)) return 'A';
  if (fact.verified) return 'A';
  if (OFFICIAL_SOURCE.test(source)) return 'B';
  if (conf >= 0.7) return 'B';
  if (conf >= 0.45) return 'C';
  if (conf > 0) return 'D';
  return 'E';
}

const LABEL = {
  A: 'Official / Verified',
  B: 'Reliable External Source',
  C: 'Estimated',
  D: 'AI Assumption',
  E: 'Unverified',
};

/** IM 본문 표기 — A/B는 표기 없음, C/D/E는 반드시 성격을 밝힌다 */
const BODY_MARK = {
  A: '',
  B: ' [미검증]',
  C: ' [추정]',
  D: ' [가정]',
  E: ' [출처 미확인]',
};

/** IM 본문에 쓸 수 있는가 — E는 쓰지 않는다 */
function usableInBody(g) {
  return g !== 'E';
}

/** 등급 분포 요약 */
function distribution(facts) {
  const dist = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const f of facts) dist[grade(f)]++;
  const total = facts.length || 1;
  return {
    counts: dist,
    abRatio: Math.round(((dist.A + dist.B) / total) * 100) / 100,
    total: facts.length,
  };
}

module.exports = { grade, LABEL, BODY_MARK, usableInBody, distribution, OFFICIAL_SOURCE };
