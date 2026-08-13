'use strict';
/**
 * content.js — 기존 IM 뷰어 계약(content.json) 내보내기.
 *
 * STRUCTURE.md 의 핵심 원칙: "뷰(index.html)와 데이터(content.json) 분리 —
 * 수치 갱신은 JSON만 수정." 이 저장소는 뷰어를 다시 만들지 않고 **데이터만 생산**한다.
 * 산출된 content.json 을 기존 design_handoff_* 의 build/ 에 넣으면 그 뷰어가 그대로 렌더한다.
 *
 * ★ 뷰어·공유카드(share.php)의 UI 규칙은 이 저장소 범위 밖이다.
 *   여기서는 그 뷰어가 먹는 데이터 형태만 맞춘다.
 */

const { kstDate } = require('../core/kst');
const { grade, LABEL } = require('../core/confidence');

/**
 * @param {object} doc IM Writer 산출물 + 프로젝트 메타
 * @returns {object} content.json
 */
function build(doc) {
  const sections = doc.sections || [];

  return {
    schema: 'linkpilot-im-content/1.0',
    generatedAt: doc.generatedAt || kstDate(),
    generator: 'LinkPilot IM Agent',

    meta: {
      projectId: doc.projectId,
      title: doc.projectName || doc.projectId,
      assetType: doc.assetType || null,
      location: doc.location || null,
      currency: 'KRW',
      unit: '억원',
      confidential: 'Strictly Private and Confidential',
      scaleNotice: doc.scaleNotice || null,
    },

    // 뷰어가 챕터 단위로 렌더한다 — 절 번호·제목·본문(마크다운)
    chapters: sections.map(s => ({
      no: s.no,
      id: s.id,
      title: s.title,
      body: s.text || '',
    })),

    // §22 Source-to-IM Traceability — 수치를 클릭하면 원천으로 갈 수 있게
    sources: (doc.citations || []).map((c, i) => ({
      ref: `S${String(i + 1).padStart(3, '0')}`,
      key: c.key,
      label: c.label,
      value: c.value,
      citation: c.citation,
      verified: !!c.verified,
      grade: c.grade || null,
      gradeLabel: c.grade ? LABEL[c.grade] : null,
    })),

    qc: doc.validation ? {
      verdict: doc.validation.verdict,
      score: doc.validation.score,
      red: doc.validation.summary.red,
      yellow: doc.validation.summary.yellow,
      flags: doc.validation.flags,
    } : null,

    // 배포 게이트 상태 — 뷰어가 'DRAFT' 워터마크를 띄울지 판단한다
    approval: {
      required: true,
      approved: !!doc.approved,
      unsourcedNumbers: (doc.unsourcedNumbers || []).length,
    },

    assets: doc.assets || [],
  };
}

module.exports = { build };
