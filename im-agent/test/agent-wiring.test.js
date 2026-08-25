/**
 * **Agent 를 붙일 때 다섯 곳을 함께 고쳤는가** 〈2026-08-25 · D-48 · D-101〉.
 *
 * ★★★ 왜 이 검사가 필요한가. Agent 하나를 붙이려면 **다섯 곳**을 함께 고쳐야
 *   하는데, 하나를 빠뜨려도 **아무 오류가 안 난다.** 그냥 조용히 안 돌거나,
 *   진행률만 슬쩍 틀어지거나, 화면이 그 단계를 영영 안 그린다.
 *
 *   실제로 두 번 났다:
 *     · D-48  커넥터 여섯이 등록만 되고 **한 번도 안 불렸다**
 *     · D-101 두 작업선이 같은 이름의 Agent 를 각자 만들었다
 *
 * ★★ **앞 판은 이 검사가 `12_sketchup_plan` 한 개에만 있었다.** 그러면
 *   다음에 붙는 Agent 는 또 아무도 안 센다 — 그것이 D-48 이 났던 자리다.
 *   그래서 **등록된 전부**를 센다.
 *
 * ★ 여기서 재는 것은 **배선**이지 그 Agent 가 옳은 일을 하는지가 아니다.
 *   무엇을 하는지는 각 Agent 의 자기 검사가 잰다.
 *
 * 규칙 문서: `docs/업무지침-Agent-붙이는-규칙.md`
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const doctor = require('../tools/agent-doctor.js');

test('★★★ 등록된 Agent 전부가 다섯 곳에 배선돼 있다', () => {
  const { rows, problems } = doctor.check();
  assert.ok(rows.length >= 13, `Agent 가 ${rows.length}개다 — 등록이 통째로 안 읽혔다`);
  assert.deepStrictEqual(problems, [],
    `배선이 빠진 곳이 있다 — **오류는 안 나지만 조용히 안 돈다**:\n  ${problems.join('\n  ')}`);
});

/**
 * ★★ **합계 100 은 뜻을 읽기 위한 기준이다.** 진행률은 실제 Agent 로
 *   정규화되지만, 100 이 아니면 「이 Agent 가 전체의 몇 퍼센트인가」를
 *   사람이 읽을 수가 없다. 새 Agent 를 더할 때 **어디서 덜어 올지 함께 정한다.**
 */
test('★★★ 진행률 비중 합계가 100 이다', () => {
  const { weightTotal } = doctor.check();
  assert.strictEqual(weightTotal, doctor.WEIGHT_TOTAL);
});

/** ★ 차례가 겹치면 어느 쪽이 먼저인지 **코드가 정하게 된다** */
test('★★ 실행 차례(order)가 겹치지 않는다', () => {
  const orders = doctor.check().rows.map((r) => r.order);
  const dup = orders.filter((o, i) => orders.indexOf(o) !== i);
  assert.deepStrictEqual(dup, [], `차례가 겹친다: ${dup.join(', ')}`);
});

/**
 * ★★★ **막는 장치는 빼고 돌려 빨개지는 것까지 확인한다** (CLAUDE.md §8).
 *   통과가 아니라 **실패를 잰다** — 안 그러면 아무것도 안 재는 검사가
 *   초록으로 앉아 있게 된다.
 */
test('★★★ 배선이 빠지면 실제로 잡는다 (일부러 어긋내 본다)', () => {
  const monitor = require('../core/monitor.js');
  const id = '13_sketchup_intake';
  const kept = monitor.WEIGHTS[id];
  assert.ok(kept !== undefined, '표본이 거짓말을 한다 — 뺄 것이 없다');
  try {
    delete monitor.WEIGHTS[id];
    const { problems } = doctor.check();
    assert.ok(problems.some((p) => p.includes(id) && p.includes('비중')),
      '비중을 빼도 안 잡는다 — 재는 것이 없는 검사다');
    assert.ok(problems.some((p) => p.includes('합계')), '합계가 깨진 것도 안 잡는다');
  } finally {
    monitor.WEIGHTS[id] = kept;
  }
  assert.deepStrictEqual(doctor.check().problems, [], '되돌린 뒤에도 빨갛다');
});

/* ── 규칙이 문서로도 있는가 ─────────────────────────────── */

/**
 * ★ 검사는 **기계로 잴 수 있는 것**만 잡는다. 「번호를 다른 갈래와 함께 본다」
 *   같은 것은 사람이 읽어야 하므로, 문서가 실재하는지까지만 잰다.
 */
test('★★ 규칙 문서가 있고, 기계가 못 재는 것을 담고 있다', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', '업무지침-Agent-붙이는-규칙.md'), 'utf8');
  ['다섯 곳', '합계 100', 'D-101', 'D-48'].forEach((k) => {
    assert.ok(doc.includes(k), `규칙 문서에 「${k}」 가 없다`);
  });
  assert.ok(/agent:check|agent-doctor/.test(doc),
    '문서가 검사 도구를 안 가리킨다 — 규칙만 적으면 사람의 기억에 얹힌다 (M-31)');
});

/** ★ 만들어 놓고 안 부르면 없는 것과 같다 — 부르는 길이 실재하는지 본다 */
test('★★ `npm run agent:check` 로 부를 수 있다', () => {
  const pkg = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['agent:check'], 'node im-agent/tools/agent-doctor.js');
});
