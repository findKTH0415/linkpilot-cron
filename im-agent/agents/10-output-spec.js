'use strict';
/**
 * 10 Output Specification Agent — 파이프라인의 첫 번째 관문
 *
 * ★ 순서가 핵심이다:
 *     출력 사양 확정 → 콘텐츠 생성 → 디자인 → 렌더링 → 최종 QC
 *   콘텐츠를 먼저 만들고 나중에 페이지 수·형식을 정하면, 이미 만든 것에 사양을 끼워맞추게 된다.
 *
 * ★ AI는 '제안'만 한다. 확정(LOCK)은 사람만 한다.
 *   사양이 LOCK 되지 않으면 산출물은 DRAFT 이며 배포 게이트를 통과하지 못한다.
 */

const outputspec = require('../core/outputspec');
const designState = require('../core/design-state');

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    docType: { type: 'string', nullable: true },
    overrides: { type: 'object' },
  },
};

const outputSchema = {
  type: 'object',
  required: ['spec', 'locked'],
  properties: {
    spec: { type: 'object' },
    locked: { type: 'boolean' },
    problems: { type: 'array' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

async function run(input, ctx) {
  const existing = outputspec.read(input.projectId);

  // 이미 사람이 확정한 사양이 있으면 건드리지 않는다
  if (existing && existing.locked) {
    const check = outputspec.validateSpec(existing);
    if (!check.ok) {
      ctx.warn(`확정된 사양에 문제가 있다: ${check.problems.join(' / ')}`);
    }
    return { spec: existing, locked: true, problems: check.problems, confidence: 1 };
  }

  const docType = input.docType || (existing && existing.docType) || 'im';
  const design = designState.read(input.projectId);

  const spec = outputspec.propose(input.projectId, {
    docType,
    themeId: design.themeId,
    overrides: { ...(existing || {}), ...(input.overrides || {}), docType },
  });

  const check = outputspec.validateSpec(spec);
  outputspec.save(input.projectId, spec);

  ctx.warn(`출력 사양 미확정 (DRAFT) — 사람이 확인해야 최종 산출물을 만든다: cli.js spec confirm ${input.projectId} --by "<이름>"`);
  if (!check.ok) {
    for (const p of check.problems) ctx.warn(`사양 문제: ${p}`);
  }

  return { spec, locked: false, problems: check.problems, confidence: check.ok ? 0.7 : 0.4 };
}

module.exports = { id: '10_output_spec', label: 'Output Specification Agent', inputSchema, outputSchema, run };
