/* 단위세대 평면 «디자인 A·B·C» — im-agent/core/arch-plan.js · CLAUDE.md §28
 * 세 모양은 같은 세대 자료를 그린다: 모양을 바꿔도 면적·실 배치는 같다. 참고 그림의 상표는 옮기지 않는다. */
const test = require('node:test');
const assert = require('node:assert');
const plan = require('../core/arch-plan');
const eng = require('../core/arch-engine');

test('템플릿: 방이 겹치지 않고 외곽을 빈틈없이 덮으며 면적이 타입과 맞는다', () => {
  for (const [type, t] of Object.entries(plan.TEMPLATES)) {
    const a = plan.audit(t);
    assert.ok(a.tiled, `${type}㎡형 템플릿이 외곽을 덮지 않는다`);
    assert.ok(Math.abs(a.sum - Number(type)) <= 1, `${type}㎡형 면적 ${a.sum}`);
  }
});

test('겹친 방은 audit 가 잡는다 (고의 고장)', () => {
  const t = JSON.parse(JSON.stringify(plan.TEMPLATES[84]));
  t.rooms[0].w += 500;
  assert.strictEqual(plan.audit(t).tiled, false);
});

test('디자인 A·B·C 는 서로 다른 그림이고, 같은 면적 합계 · «설계도서 아님» 을 싣는다', () => {
  for (const t of Object.values(plan.TEMPLATES)) {
    const svgs = ['A', 'B', 'C'].map((s) => plan.render(t, s));
    assert.strictEqual(new Set(svgs).size, 3);
    const total = plan.audit(t).sum.toFixed(2);
    for (const s of svgs) {
      assert.ok(s.startsWith('<svg'), 'SVG 가 아니다');
      assert.ok(s.includes(`전용 합계 ${total}㎡`), '면적 합계가 디자인마다 다르다');
      assert.ok(s.includes('설계도서 아님'), '«설계도서 아님» 이 빠졌다');
      assert.ok(!/liSQUARE|NHN|NEWSIS|래미안/i.test(s), '참고 그림의 상표가 들어갔다');
    }
    assert.ok(/㎡ · [\d.]+평/.test(svgs[1]), 'B 는 실마다 ㎡·평을 적는다');
    assert.ok(!/㎡ · [\d.]+평/.test(svgs[0]) && !/㎡ · [\d.]+평/.test(svgs[2]), 'A·C 에 실별 면적이 새었다');
  }
});

test('pickStyles: 고른 것만 · 기본은 ABC · 모르는 글자는 버린다', () => {
  assert.deepStrictEqual(plan.pickStyles(), ['A', 'B', 'C']);
  assert.deepStrictEqual(plan.pickStyles('b'), ['B']);
  assert.deepStrictEqual(plan.pickStyles('CAx'), ['C', 'A']);
});

test('엔진 보고서: 고른 디자인이 실리고 템플릿 없는 타입은 미확인', () => {
  const c = { title: 't', project_id: 'X', plan_style: 'B', plan: { unit_mix: [{ type: 84, count: 1 }, { type: 46, count: 1 }] }, env: {} };
  const r = eng.report(c, null);
  assert.deepStrictEqual(r.plans.styles.map((x) => x.id), ['B']);
  assert.strictEqual(r.checks.find((x) => x.id === 'E-84').status, 'PASS');
  assert.strictEqual(r.checks.find((x) => x.id === 'E-46').status, 'UNVERIFIED');
  assert.ok(eng.toMarkdown(r, c).includes('디자인 B'));
});
