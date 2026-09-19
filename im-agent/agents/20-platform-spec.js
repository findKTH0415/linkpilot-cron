'use strict';
/**
 * 20 Platform Spec Agent — 화면 작업지시서 (T22)
 *
 * **무엇을 만들지 정한다.** 만들지는 않는다 — 그것은 T23(`21_platform_build`)다.
 *
 * ★★ **왜 이것이 먼저인가.** 플랫폼 자동완성 지침 §5 마지막 줄이
 *   「입력값·완료조건·제외범위가 없으면 구현을 시작하지 않고 `NEEDS_INPUT`
 *   으로 보고한다」이다. 지시서 없이 만들기 시작하면 **무엇이 끝인지 아무도
 *   모른다** — 그래서 `taskplan.js` 에서 T22 가 T23 의 선행이다.
 *
 * ★ **이 Agent 는 빈 칸을 메우지 않는다.** 판정만 하고, 모자라면 무엇이
 *   모자란지 사람 말로 적어 `NEEDS_INPUT` 으로 돌려준다. 메우기 시작하면
 *   누가 정했는지 모르는 값이 지시서에 들어가고, **문서에는 「적용됨」만
 *   남아 무엇이 빠졌는지 사라진다** (CLAUDE.md §4.9).
 *
 * ★ **`facts` 는 항상 빈 배열이다** (D-96). 작업지시서는 자료원이 아니다 —
 *   여기서 나온 것이 IM 본문의 숫자가 되는 일은 없어야 한다.
 *
 * ★ `spec_doc` 은 기본값이 `null` 이고, 비어 있으면 YELLOW 플래그가 남는다 —
 *   **어느 지침의 몇 절을 근거로 썼는지가 지시서 안에 적혀 있어야 한다** (§4.7).
 *   지침 원문은 `docs/플랫폼-자동완성-지침.md` 다 (2026-08-26 병합으로 들어왔다).
 *
 * 전부 결정적 판정이다. LLM 미사용.
 */

const store = require('../core/store');
const platformspec = require('../core/platformspec');
const { kstStamp } = require('../core/kst');

const SPEC_PATH = '14_Platform/spec.json';

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    /** 사람이 채워 넣은 지시서. 없으면 저장된 것을 읽고, 그것도 없으면 빈 지시서다 */
    spec: { type: 'object', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['facts', 'flags', 'status', 'spec'],
  properties: {
    facts: { type: 'array', maxItems: 0 }, // D-96
    flags: { type: 'array' },
    status: { type: 'string', enum: ['READY', 'NEEDS_INPUT'] },
    spec: { type: 'object' },
    missing: { type: 'array' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

function flag(severity, type, message, extra = {}) {
  return { severity, type, message, ...extra };
}

async function run(input, ctx) {
  const facts = []; // D-96 — 항상 비어 있다
  const flags = [];

  // 들어온 것 → 저장된 것 → 빈 지시서. **이 순서다** — 사람이 방금 준 것이 이긴다.
  const raw = input.spec || store.readJson(input.projectId, SPEC_PATH, null);
  const spec = platformspec.normalize(raw, 'T22');

  const verdict = platformspec.judge(spec);

  // ★ 근거 문서를 모르면 그 사실을 남긴다. 조용히 넘어가면 반년 뒤
  //   「이 지시서는 무엇을 근거로 썼나」에 아무도 답할 수 없다.
  if (!spec.spec_doc) {
    flags.push(flag('YELLOW', 'SPEC_DOC_UNKNOWN',
      '작업지시서의 근거 문서(spec_doc)가 비어 있다 — 어느 지침의 몇 절을 근거로 썼는지 모른 채 쓴 지시서다'));
  }

  // ★ 막지 않는 칸이 비면 **말은 한다** (D-133). 조용히 넘어가면 T23 이
  //   시작한 뒤에야 「어느 API 를 부르라는 거였지」가 나온다.
  for (const a of (verdict.advisory || [])) {
    ctx.warn(`작업지시서 권고: ${a}`);
    flags.push(flag('YELLOW', 'SPEC_ADVISORY', a));
  }

  if (verdict.status === 'NEEDS_INPUT') {
    // ★ **막는 것이 이 Agent 의 일이다.** 여기서 통과시키면 T23 이
    //   무엇이 끝인지 모른 채 화면을 만들기 시작한다.
    flags.push(flag('RED', 'NEEDS_INPUT',
      `착수할 수 없다 — 지침 §5 가 요구하는 칸이 ${verdict.missing.length}개 비어 있다`,
      { keys: verdict.missing }));
    for (const r of verdict.reasons) {
      ctx.warn(`작업지시서 미비: ${r}`);
      flags.push(flag('YELLOW', 'SPEC_GAP', r));
    }
  }

  const record = {
    ...spec,
    status: verdict.status,
    missing: verdict.missing,
    reasons: verdict.reasons,
    advisory: verdict.advisory || [],
    // ★ 갱신시각은 한 곳에서만 만든다 (CLAUDE.md §8 · core/kst.js)
    updatedAt: kstStamp(),
  };
  store.writeJson(input.projectId, SPEC_PATH, record);

  return {
    facts,
    flags,
    status: verdict.status,
    spec: record,
    missing: verdict.missing,
    // 판정 자체는 결정적이라 신뢰도가 흔들리지 않는다. 못 채운 칸은 status 가 말한다.
    confidence: 1,
  };
}

module.exports = { id: '20_platform_spec', label: 'Platform Spec Agent (화면 작업지시서)', inputSchema, outputSchema, run, SPEC_PATH };
