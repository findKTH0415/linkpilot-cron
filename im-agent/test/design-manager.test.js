'use strict';
/**
 * 15_design — Design Manager 를 재는 검사 (D-123)
 *
 * ★★ 이 Agent 는 **만드는 자리가 아니라 막는 자리**다. 그래서 가장 위험한
 *   고장은 「빨개져야 하는데 초록인 것」이다. 검사도 그쪽을 잰다.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const design = require('../agents/15-design');

/* ───────────── 아무것도 안 봤으면 통과가 아니다 ───────────── */

test('★★★ 검사할 산출물이 없으면 verified 가 false 다 — 「못 쟀다」는 통과가 아니다', async () => {
  const out = await design.run({ projectId: 'TEST-EMPTY' }, {});
  assert.strictEqual(out.verified, false,
    '문서가 안 만들어진 딜이 「디자인 검증 통과」로 남으면, 통과 표시가 아무 뜻이 없어진다');
  assert.ok(out.flags.some(f => f.type === 'DESIGN_NOTHING_CHECKED'),
    '왜 통과가 아닌지를 말하지 않으면 고장으로 읽힌다');
  assert.deepStrictEqual(out.facts, [], '판정을 내는 Agent 는 값을 내지 않는다');
});

test('★ 대상 없는 모드는 「통과」가 아니라 「대상 없음」으로 적는다 (M-37)', async () => {
  const out = await design.run({ projectId: 'TEST-EMPTY' }, {});
  const product = out.modes.find(m => m.mode === 'product');
  assert.strictEqual(product.checked, 0);
  assert.ok(product.note && product.note.includes('통과가 아니다'),
    '0 옆에 왜 0 인지가 없으면 화면이 「화면 검사도 돌았다」로 읽힌다');
});

test('★ 네 모드가 전부 결과를 낸다 — 하나가 빠지면 그 갈래를 아무도 안 본다', async () => {
  const out = await design.run({ projectId: 'TEST-EMPTY' }, {});
  assert.deepStrictEqual(out.modes.map(m => m.mode).sort(), design.MODES.slice().sort());
});

/* ───────────── 실제로 규칙을 댄다 ───────────── */

test('★★ 이모지가 든 본문은 RED 로 걸린다 — 규칙을 정말 대고 있다', async () => {
  const out = await design.run({
    projectId: 'TEST-EMOJI',
    writer: { im: '# 사업개요 🎉\n\n내용', teaser: '요약' },
  }, {});
  assert.ok(out.flags.some(f => f.severity === 'RED' && /이모지/.test(f.message)),
    'design/rules.json 의 D3 가 대외 문서 이모지를 RED 로 정했는데 안 걸리면 규칙을 안 대고 있는 것이다');
  assert.strictEqual(out.verified, false, 'RED 가 있으면 DESIGN_VERIFIED 가 아니다');
});

test('★★ 표기 없는 AI 렌더는 RED 다 — AI 그림이 설계안으로 읽히는 것을 막는다 (D-34)', async () => {
  const out = await design.run({
    projectId: 'TEST-RENDER',
    writer: { im: '본문' },
    intake: { bodyRenders: [{ file: 'birdseye.jpg' }] },   // disclaimer·based_on 없음
  }, {});
  assert.ok(out.flags.some(f => f.type === 'DESIGN_RENDER_UNLABELED' && f.severity === 'RED'));
  assert.strictEqual(out.verified, false);
});

test('★ 표기가 온전한 렌더는 안 걸린다 — 늑대야가 되면 아무도 안 본다', async () => {
  const out = await design.run({
    projectId: 'TEST-RENDER-OK',
    writer: { im: '본문' },
    intake: { bodyRenders: [{ file: 'b.jpg', disclaimer: 'AI 렌더 — 실제 설계안이 아님', based_on: 'massing.svg' }] },
  }, {});
  assert.ok(!out.flags.some(f => f.type === 'DESIGN_RENDER_UNLABELED'));
});

test('★ SVG 만 있고 짝 JPEG 이 없으면 YELLOW (CLAUDE.md §6-1)', async () => {
  const out = await design.run({
    projectId: 'TEST-SVG',
    writer: { im: '본문' },
    massing: { files: [{ path: '04_Property/massing.svg' }] },
  }, {});
  assert.ok(out.flags.some(f => f.type === 'DESIGN_SVG_WITHOUT_RASTER'),
    'SVG 는 카카오톡·메일 미리보기·PPT 에서 빈 칸이 된다 — 그림을 보라고 보냈는데 빈 칸이면 고장으로 읽힌다');
});

test('★★ 짝 JPEG 이 있으면 안 걸린다 — 막는 장치를 빼고 돌려 빨개지는지 (지침 §5-④)', async () => {
  const out = await design.run({
    projectId: 'TEST-SVG-OK',
    writer: { im: '본문' },
    massing: { files: [{ path: '04_Property/massing.svg' }, { path: '04_Property/massing.jpg' }] },
  }, {});
  assert.ok(!out.flags.some(f => f.type === 'DESIGN_SVG_WITHOUT_RASTER'));
});

/* ───────────── 규칙을 두 벌로 두지 않는다 ───────────── */

test('★★ 규칙 본문을 이 파일에 옮겨 적지 않았다 — 두 벌이 되면 한쪽이 옛말을 한다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '15-design.js'), 'utf8')
    // 주석을 떼고 본다 — 경위를 잘 적어 둘수록 글자 대조가 눈이 먼다 (CLAUDE.md §8)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(src.includes("require('../design/check')"),
    '규칙은 design/check.js 한 곳에서 온다');
  assert.ok(!/FORBIDDEN_COLORS\s*=/.test(src) && !/severity:\s*'RED'.*이모지/.test(src),
    '규칙 값을 여기 다시 적으면 rules.json 과 갈라진다');
});

/* ───────────── 배선 ───────────── */

test('★ 배선 다섯 곳에 전부 있다', () => {
  const reg = require('../core/registry');
  const mon = require('../core/monitor');
  assert.ok(reg.AGENTS['15_design'], '① registry');
  assert.ok(mon.WEIGHTS['15_design'] > 0, '② WEIGHTS');
  assert.ok(Array.isArray(mon.DEPENDS['15_design']), '③ DEPENDS');

  const pipe = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  assert.ok(pipe.includes("runAgent('15_design'"), '④ pipeline 에서 실제로 부른다 (D-48)');

  const live = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'live-core.js'), 'utf8');
  assert.ok(live.includes("'15_design'"), '⑤ 화면의 단계 묶음');
});

test('★★ 최종검증이 디자인 검증을 기다린다 — 지시서 §8.4', () => {
  const mon = require('../core/monitor');
  const reg = require('../core/registry');
  assert.ok(mon.DEPENDS['11_final_validation'].includes('15_design'),
    '기다리지 않으면 「기능은 되는데 디자인은 안 본」 문서가 완료로 나간다');
  assert.ok(reg.AGENTS['15_design'].order < reg.AGENTS['11_final_validation'].order);
  assert.ok(reg.AGENTS['06_im_writer'].order < reg.AGENTS['15_design'].order,
    '문서가 나오기 전에 디자인을 재면 늘 「대상 없음」이 된다');
});

test('★ registry 의 PLANNED 에서 빠졌다 — 구현됐는데 계획에 남아 있으면 두 뜻이 된다', () => {
  const reg = require('../core/registry');
  for (const id of ['15_design', '18_legal']) {
    assert.ok(!reg.PLANNED[id], `${id} 가 AGENTS 와 PLANNED 양쪽에 있다`);
    assert.ok(reg.AGENTS[id], `${id} 가 AGENTS 에 있어야 한다`);
  }
});
