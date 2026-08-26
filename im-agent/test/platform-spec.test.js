'use strict';
/**
 * platform-spec.test.js — 화면 작업지시서(T22)의 **착수 판정**을 고정한다.
 *
 * 지침 §5 마지막 줄이 「입력값·완료조건·제외범위가 없으면 구현을 시작하지
 * 않고 `NEEDS_INPUT` 으로 보고한다」이다. 이 검사가 지키는 것은 **그 판정이
 * 실제로 막는가**이지 「칸이 있는가」가 아니다.
 *
 * ★★ 가장 중요한 검사는 `null` 과 `[]` 를 가르는 것이다. 그 둘이 같아지면
 *   게이트는 살아 있는 척하면서 아무것도 안 막는다 — 그리고 **통과 로그가
 *   초록이라 아무도 눈치채지 못한다.** 이 저장소가 M-26 에서 겪은 모양이다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'im-pspec-'));
process.env.IM_AGENT_ROOT = ROOT;
process.env.IM_AGENT_OFFLINE = '1';

const platformspec = require('../core/platformspec');
const agent = require('../agents/20-platform-spec');
const registry = require('../core/registry');
const router = require('../core/router');
const store = require('../core/store');

/** 온전히 채워진 지시서 — 여기서 하나씩 빼면서 막히는지 본다 */
function fullSpec() {
  return {
    task_id: 'T22',
    spec_doc: 'docs/플랫폼-자동완성-지침.md §5',
    input_data: ['GET /api/linkpilot/projects — 프로젝트 목록'],
    scope_in: ['보고서 목록 화면에 진행률 칸을 붙인다'],
    scope_out: ['외출모드 (D-121 로 범위에서 뺐다)'],
    acceptance_criteria: [
      { must: '진행률이 실제 Task 상태에서 나온다', shows: 'section-preview.html 의 [눈으로 확인] 패널' },
    ],
  };
}

// ── ★★ null 과 [] 는 다르다 ──────────────────────────────────

test('★★ null 은 「안 정했다」 — 막는다', () => {
  for (const f of platformspec.REQUIRED_FIELDS) {
    const s = platformspec.normalize(fullSpec());
    s[f] = null;
    const v = platformspec.judge(s);
    assert.strictEqual(v.status, 'NEEDS_INPUT', `${f} 이(가) null 인데 통과했다`);
    assert.ok(v.missing.includes(f), `${f} 이(가) missing 에 안 잡혔다`);
  }
});

test('★★ [] 는 「정말 없다」 — scope_out 은 통과한다', () => {
  for (const f of ['scope_out']) {
    const s = platformspec.normalize(fullSpec());
    s[f] = [];
    const v = platformspec.judge(s);
    assert.strictEqual(v.status, 'READY',
      `${f} 은(는) 비어도 되는 칸인데 막혔다: ${v.reasons.join(' / ')}`);
  }
});

test('★ 만들 것이 없는 지시서는 지시서가 아니다 — scope_in 이 []이면 막는다', () => {
  const s = platformspec.normalize(fullSpec());
  s.scope_in = [];
  const v = platformspec.judge(s);
  assert.strictEqual(v.status, 'NEEDS_INPUT');
  assert.match(v.reasons.join(' '), /만들 것이 없는/);
});

test('★ 완료조건이 []이면 막는다 — 끝을 모르는 채로 시작하지 않는다', () => {
  const s = platformspec.normalize(fullSpec());
  s.acceptance_criteria = [];
  assert.strictEqual(platformspec.judge(s).status, 'NEEDS_INPUT');
});

// ── ★ 완료조건은 확인할 수 있어야 한다 (CLAUDE.md §8) ──────────

test('★ shows 없는 완료조건은 완료조건이 아니다', () => {
  const s = platformspec.normalize(fullSpec());
  s.acceptance_criteria = [{ must: '진행률이 나온다' }]; // shows 없음
  const v = platformspec.judge(s);
  assert.strictEqual(v.status, 'NEEDS_INPUT');
  assert.match(v.reasons.join(' '), /shows/);
});

test('★ must 없는 완료조건도 막는다', () => {
  const s = platformspec.normalize(fullSpec());
  s.acceptance_criteria = [{ shows: '어딘가' }];
  assert.strictEqual(platformspec.judge(s).status, 'NEEDS_INPUT');
});

// ── ★ 지어내지 않는다 ────────────────────────────────────────

test('★★ normalize 가 빈 칸을 []로 메우지 않는다 — null 이 그대로 남는다', () => {
  const s = platformspec.normalize({ task_id: 'T22' });
  for (const f of [...platformspec.REQUIRED_FIELDS, ...platformspec.ADVISORY_FIELDS]) {
    assert.strictEqual(s[f], null, `${f} 이(가) 조용히 채워졌다: ${JSON.stringify(s[f])}`);
  }
  // 메웠다면 이 판정이 초록이 되어 게이트가 죽는다
  assert.strictEqual(platformspec.judge(s).status, 'NEEDS_INPUT');
});

test('★ 배열이 아닌 값은 받지 않는다 — 문자열도 length 를 갖는다', () => {
  const s = platformspec.normalize({ scope_in: '진행률 붙이기' });
  assert.strictEqual(s.scope_in, null, '문자열이 목록으로 들어갔다');
});

test('빈 지시서는 모든 칸이 null 이고 근거 문서도 null 이다', () => {
  const b = platformspec.blank('T22');
  assert.strictEqual(b.spec_doc, null);
  assert.strictEqual(b.schema, platformspec.SCHEMA);
});

test('★★ 게이트는 셋이다 — 결정(D-122)을 말없이 넓히지 않았다', () => {
  assert.deepStrictEqual(platformspec.REQUIRED_FIELDS,
    ['scope_in', 'scope_out', 'acceptance_criteria']);
  assert.deepStrictEqual(platformspec.ADVISORY_FIELDS, ['input_data']);
});

test('★ 입력값이 비면 막지는 않되 말은 한다 (D-131)', () => {
  const s = platformspec.normalize(fullSpec());
  s.input_data = null;
  const v = platformspec.judge(s);
  assert.strictEqual(v.status, 'READY', '입력값이 게이트가 됐다 — D-122 결정을 넓혔다');
  assert.ok(v.advisory.length > 0, '비었는데 아무 말도 안 했다');
});

test('온전히 채우면 통과한다 — 막기만 하는 게이트는 곧 꺼진다', () => {
  const v = platformspec.judge(platformspec.normalize(fullSpec()));
  assert.strictEqual(v.status, 'READY', v.reasons.join(' / '));
  assert.deepStrictEqual(v.missing, []);
});

// ── ★ Agent 배선 ────────────────────────────────────────────

test('★ Agent 는 빈 지시서에 NEEDS_INPUT 을 돌려주고 RED 를 남긴다', async () => {
  const pid = store.nextProjectId('generic');
  store.createProjectDirs(pid, 'generic');
  const warned = [];
  const out = await agent.run({ projectId: pid }, { warn: m => warned.push(m) });

  assert.strictEqual(out.status, 'NEEDS_INPUT');
  assert.ok(out.flags.some(f => f.severity === 'RED' && f.type === 'NEEDS_INPUT'),
    'RED NEEDS_INPUT 플래그가 없다 — 조용히 넘어갔다');
  assert.ok(warned.length > 0, '경고 로그가 하나도 안 남았다');
  // 판정 결과가 파일로도 남아야 한다 — 대화에만 있으면 다음 Task 가 못 읽는다
  const saved = store.readJson(pid, agent.SPEC_PATH, null);
  assert.ok(saved && saved.status === 'NEEDS_INPUT', 'spec.json 이 안 남았다');
  assert.ok(saved.updatedAt, '갱신시각이 없다 (CLAUDE.md §8)');
});

test('★ Agent 는 채워진 지시서에 READY 를 돌려준다', async () => {
  const pid = store.nextProjectId('generic');
  store.createProjectDirs(pid, 'generic');
  const out = await agent.run({ projectId: pid, spec: fullSpec() }, { warn: () => {} });
  assert.strictEqual(out.status, 'READY');
  assert.ok(!out.flags.some(f => f.severity === 'RED'), 'RED 가 남았다');
});

test('★ facts 는 항상 비어 있다 (D-96) — 작업지시서는 자료원이 아니다', async () => {
  const pid = store.nextProjectId('generic');
  store.createProjectDirs(pid, 'generic');
  const out = await agent.run({ projectId: pid, spec: fullSpec() }, { warn: () => {} });
  assert.deepStrictEqual(out.facts, []);
});

test('★ 근거 문서를 모르면 그 사실이 남는다 (§4.7)', async () => {
  const pid = store.nextProjectId('generic');
  store.createProjectDirs(pid, 'generic');
  const s = fullSpec(); s.spec_doc = null;
  const out = await agent.run({ projectId: pid, spec: s }, { warn: () => {} });
  assert.ok(out.flags.some(f => f.type === 'SPEC_DOC_UNKNOWN'),
    '근거 문서가 비었는데 아무 말도 안 했다');
});

test('★ 사람이 방금 준 지시서가 저장된 것을 이긴다', async () => {
  const pid = store.nextProjectId('generic');
  store.createProjectDirs(pid, 'generic');
  await agent.run({ projectId: pid }, { warn: () => {} });          // 빈 것이 저장된다
  const out = await agent.run({ projectId: pid, spec: fullSpec() }, { warn: () => {} });
  assert.strictEqual(out.status, 'READY', '저장된 빈 지시서가 새 것을 덮었다');
});

// ── ★ 등록 상태 ─────────────────────────────────────────────

test('★ 20_platform_spec 이 registry 에 있고 켜져 있다', () => {
  // ★ AGENTS 가 아니라 TASK_AGENTS 다 (D-130) — IM 파이프라인이 아니라 Task 그래프다
  const a = registry.TASK_AGENTS['20_platform_spec'];
  assert.ok(a, 'registry 에 없다');
  assert.strictEqual(a.enabled, true);
  assert.strictEqual(a.approvalRule, 'human', '지시서 확정은 사람이 한다');
});

test('★ 도착했으므로 INCOMING 에서 지워져 있다', () => {
  assert.ok(!('20_platform_spec' in router.INCOMING),
    '도착했는데 「오는 중」에 남아 있다 — 그러면 계획에서 PLANNED 로 굳는다');
});

test('★ 아직 안 온 둘은 「오는 중」에 그대로 있다 — 지어내지 않는다', () => {
  assert.ok('21_platform_build' in router.INCOMING);
  assert.ok('22_platform_verify' in router.INCOMING);
});

test('★ T22 는 배정되고 T23 은 아직 미구현이다', () => {
  assert.strictEqual(router.assign('PLATFORM_SPEC').implemented, true);
  assert.strictEqual(router.assign('PLATFORM_BUILD').implemented, false);
});

// ── ★★ 갈래를 둘로 나눈 것이 「검사를 피하는 문」이 되지 않는가 (D-130) ──

const doctor = require('../tools/agent-doctor.js');

test('★★ Task 전용 갈래도 배선 점검을 받는다 — 지금은 빠진 곳이 0 이다', () => {
  const { problems, rows } = doctor.check();
  assert.deepStrictEqual(problems, [], problems.join('\n  '));
  assert.ok(rows.some(r => r.id === '20_platform_spec'),
    'Task Agent 가 점검 표에 아예 안 나온다 — 갈래를 나눈 것이 면제가 됐다');
});

test('★★ 능력을 안 적으면 잡는다 — 아무도 안 부르는 Agent 가 되기 때문이다', () => {
  const kept = registry.TASK_AGENTS['20_platform_spec'].capability;
  try {
    delete registry.TASK_AGENTS['20_platform_spec'].capability;
    const { problems } = doctor.check();
    assert.ok(problems.some(p => p.includes('20_platform_spec') && p.includes('능력')),
      '능력을 빼도 안 잡는다 — 재는 것이 없는 검사다');
  } finally {
    registry.TASK_AGENTS['20_platform_spec'].capability = kept;
  }
  assert.deepStrictEqual(doctor.check().problems, [], '되돌린 뒤에도 빨갛다');
});

test('★★ IM 진행률(WEIGHTS)에 끼어들지 않는다 — 끼면 「IM 이 몇 %」가 뜻을 잃는다', () => {
  const monitor = require('../core/monitor');
  assert.strictEqual(monitor.WEIGHTS['20_platform_spec'], undefined,
    '화면 작업지시서가 IM 진행률을 나눠 갖고 있다');
  const total = Object.values(monitor.WEIGHTS).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 100);
});

test('★ registry.list() 는 IM 파이프라인만 돌려준다 — 세는 검사들의 뜻이 안 바뀐다', () => {
  assert.ok(!registry.list().some(a => a.id === '20_platform_spec'));
  assert.ok(registry.listTaskAgents().some(a => a.id === '20_platform_spec'));
  assert.strictEqual(registry.get('20_platform_spec').id, '20_platform_spec',
    'get() 이 Task Agent 를 못 찾는다 — router 가 「미구현」으로 잡는다');
});
