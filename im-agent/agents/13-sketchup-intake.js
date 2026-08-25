'use strict';
/**
 * 13 SketchUp Intake Agent — 평면 A 의 수령 쪽 절반
 *
 * 평면 B(사람 자리)가 만들어 04_Property/ 에 넣은 결과(`model-result.json` ·
 * `.skp` · PNG)를 **되받아 계획과 대조한다.** 이것이 없으면 최종 교차검증이
 * 반쪽이다 — 계획과 다른 모델이 조용히 문서에 실린다.
 *
 * ★ 결과가 없으면 `unavailable` 로 그 절을 비운다. 지어내지 않는다 (§4.6).
 * ★ `.skp`·PNG 는 **있다는 사실만** 기록한다 — 파싱하지 않는다 (D-38 과 같은 규칙).
 * ★ facts 는 **항상 빈 배열이다** (D-96).
 * ★ AI 렌더는 disclaimer 가 없으면 YELLOW 다 (규격 §3-1) — AI 그림이
 *   설계안으로 읽히는 것이 이 파일에서 막아야 할 사고다.
 *
 * 전부 결정적 대조다. LLM 미사용.
 */

const fs = require('fs');
const path = require('path');
const store = require('../core/store');
const { RENDER_STANDARD } = require('../core/outputspec');

const GFA_TOLERANCE = 0.01; // 연면적 1% — 반올림·단위 변환 오차까지만 허용한다

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    plan: { type: 'object', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['facts', 'flags', 'status'],
  properties: {
    facts: { type: 'array', maxItems: 0 }, // D-96
    flags: { type: 'array' },
    status: { type: 'string', enum: ['received', 'unavailable'] },
    result: { type: 'object', nullable: true },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

function flag(severity, type, message, extra = {}) {
  return { severity, type, message, ...extra };
}

async function run(input, ctx) {
  const facts = [];   // D-96 — 항상 비어 있다
  const flags = [];

  const result = store.readJson(input.projectId, '04_Property/model-result.json', null);
  if (!result) {
    // 아직 안 만든 것은 오류가 아니다 — 평면 B 는 사람의 시간으로 돈다
    return { facts, flags, status: 'unavailable', result: null, confidence: 1 };
  }

  const plan = (input.plan && input.plan.schema === 'model-plan/1')
    ? input.plan
    : store.readJson(input.projectId, '04_Property/model-plan.json', null);

  // ── 계획 ↔ 결과 대조 ──────────────────────────────────────
  if (!plan) {
    flags.push(flag('YELLOW', 'NO_PLAN', '모델 결과는 왔는데 대조할 계획(model-plan.json)이 없다 — 어느 계획의 결과인지 확인할 수 없다'));
  } else {
    if (result.plan_created !== plan.created) {
      flags.push(flag('YELLOW', 'STALE_RESULT',
        `결과가 가리키는 계획(${result.plan_created || '미기재'})이 현재 계획(${plan.created})과 다르다 — 옛 계획의 결과일 수 있다`));
    }
    const m = result.model || {};
    if (typeof m.floors === 'number' && m.floors !== plan.building.floors) {
      flags.push(flag('RED', 'PLAN_MISMATCH',
        `층수가 계획과 다르다 — 계획 ${plan.building.floors}층 vs 모델 ${m.floors}층`, { keys: ['building.floors'] }));
    }
    if (typeof m.gfa_m2 === 'number' && typeof plan.building.gfa_m2 === 'number' && plan.building.gfa_m2 > 0) {
      const diff = Math.abs(m.gfa_m2 - plan.building.gfa_m2) / plan.building.gfa_m2;
      if (diff > GFA_TOLERANCE) {
        flags.push(flag('RED', 'PLAN_MISMATCH',
          `연면적이 계획과 ${(diff * 100).toFixed(1)}% 다르다 — 계획 ${plan.building.gfa_m2}㎡ vs 모델 ${m.gfa_m2}㎡`, { keys: ['building.gfa_sqm'] }));
      }
    }
    if (typeof m.objects_count === 'number' && m.objects_count !== plan.objects.length) {
      flags.push(flag('YELLOW', 'OBJECT_COUNT',
        `객체 수가 계획과 다르다 — 계획 ${plan.objects.length}개 vs 모델 ${m.objects_count}개`));
    }
  }

  // ── 모델 쪽 자체 검증 상태 ────────────────────────────────
  const v = result.validation || {};
  if (v.solid === 'FAIL') {
    flags.push(flag('RED', 'SOLID_FAIL', '모델의 Solid 검증이 FAIL 이다 — 엔지니어링 객체가 닫혀 있지 않다'));
  }
  if (result.status === 'BLOCKED') {
    flags.push(flag('YELLOW', 'RESULT_BLOCKED', `모델 세션이 스스로 BLOCKED 로 보고했다${(result.unresolved || []).length ? ` — 미해결 ${result.unresolved.length}건` : ''}`));
  }

  // ── 파일은 있다는 사실만 — 파싱하지 않는다 ─────────────────
  const dir = path.join(store.projectDir(input.projectId), '04_Property');
  const missingFiles = (result.files || []).filter(f => !fs.existsSync(path.join(dir, path.basename(f))));
  if (missingFiles.length) {
    flags.push(flag('YELLOW', 'FILE_MISSING', `결과가 적은 파일이 폴더에 없다: ${missingFiles.join(', ')}`));
  }

  // ── AI 렌더 — disclaimer 없으면 받지 않은 것과 같다 (규격 §3-1) ──
  for (const r of result.renders || []) {
    if (r.ai_generated !== true || !r.disclaimer) {
      flags.push(flag('YELLOW', 'RENDER_DISCLAIMER',
        `AI 렌더 ${r.file || '(이름 없음)'} 에 ai_generated/disclaimer 표기가 없다 — 「실제 설계안이 아님」 없이는 문서에 싣지 않는다`));
    }
    if (!r.based_on) {
      flags.push(flag('YELLOW', 'RENDER_NO_SCENE', `AI 렌더 ${r.file || '(이름 없음)'} 의 원본 장면(based_on)이 없다 — 어느 뷰에서 나온 그림인지가 출처다`));
    }
    if (!r.tool || !r.tool_version) {
      flags.push(flag('YELLOW', 'RENDER_TOOL_UNKNOWN',
        `AI 렌더 ${r.file || '(이름 없음)'} 에 도구·버전(tool/tool_version) 기록이 없다 — 세대(예: ${RENDER_STANDARD.label})마다 그림이 달라, 어느 도구가 만들었는지가 출처 표기다 (§4.7)`));
    } else {
      // ★ 표준 도구 강제 〈2026-08-25 사장님 지시 — 「반드시」〉.
      //   기록이 있는 렌더만 여기서 가른다 — 기록이 없으면 위 UNKNOWN 이 이미 잡았다.
      //   무료 경로 예외: gemini 라도 기반 모델이 표준과 같으면 통과 (규격 §3-1).
      const tool = String(r.tool).toLowerCase();
      const standardVeras = tool === RENDER_STANDARD.tool
        && String(r.tool_version) === RENDER_STANDARD.tool_version
        && (!r.engine || r.engine === RENDER_STANDARD.engine);
      const geminiSameEngine = tool === 'gemini' && r.engine === RENDER_STANDARD.engine;
      if (!standardVeras && !geminiSameEngine) {
        flags.push(flag('YELLOW', 'RENDER_TOOL_NONSTANDARD',
          `AI 렌더 ${r.file || '(이름 없음)'} 의 도구가 표준이 아니다 — ${r.tool} ${r.tool_version}${r.engine ? ` (${r.engine})` : ''}. 표준은 ${RENDER_STANDARD.label}이고, 무료 경로는 gemini + 같은 기반 모델만 받는다`));
      }
    }
  }

  const red = flags.filter(f => f.severity === 'RED').length;
  return {
    facts, flags, status: 'received',
    result: {
      created: result.created || null,
      plan_created: result.plan_created || null,
      files: (result.files || []).length,
      renders: (result.renders || []).length,
      solid: v.solid || null,
    },
    confidence: red ? 0.3 : 0.8,
  };
}

module.exports = { id: '13_sketchup_intake', inputSchema, outputSchema, run };
