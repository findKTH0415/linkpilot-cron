'use strict';
/**
 * source_id — **출처를 세는 이름** (D-117)
 *
 * ★★★ 이 검사가 지키는 것은 하나다 —
 *   **「독립된 두 출처가 같은 값을 말한다」가 참이어야 한다.**
 *
 *   그 문장이 이 시스템의 근거다. 같은 곳을 다르게 적어서 둘로 세면
 *   **없는 근거를 만든다.** 값도 출처 표시도 멀쩡해서 문서만 봐서는 안 잡힌다.
 */

const test = require('node:test');
const assert = require('node:assert');
const { sourceId, Fact, Dataset } = require('../core/facts');

/* ───────────── 같은 곳은 같게 ───────────── */

test('★★ 같은 기관을 다르게 적어도 하나로 센다', () => {
  assert.strictEqual(sourceId('국토교통부 실거래가'), sourceId('MOLIT 실거래가'));
  assert.strictEqual(sourceId('한국은행 기준금리'), sourceId('ECOS 기준금리'));
  assert.strictEqual(sourceId('한국부동산원 지가지수'), sourceId('REB 지가지수'));
});

test('★★ 조회 조건이 다른 것은 같은 출처다 — 법령은 하나다', () => {
  assert.strictEqual(
    sourceId('국토계획법 시행령(용도지역: 일반공업지역)'),
    sourceId('국토계획법 시행령(용도지역: 준공업지역)'),
    '같은 시행령을 조건만 달리해 두 번 부른 것이다 — 독립 출처가 아니다');
});

test('★★★ 같은 Agent 가 방법만 달리한 것은 독립 출처가 아니다', () => {
  // 실제 자료에 있던 꼴이다. 우리 Agent 가 **자기 자신과 일치**한 것을
  // 「독립 출처 2건」으로 세고 있었다.
  assert.strictEqual(
    sourceId('감정평가 Agent · 수익환원법'),
    sourceId('감정평가 Agent · 1방식 가중평균'));
});

test('★ 대소문자·공백은 같은 것으로 본다', () => {
  assert.strictEqual(sourceId('  MOLIT   실거래가 '), sourceId('molit 실거래가'));
});

/* ───────────── 다른 곳은 다르게 ───────────── */

test('★★★ 진짜로 다른 출처를 합치지 않는다 — 합치면 진짜 근거를 잃는다', () => {
  assert.notStrictEqual(sourceId('business-plan.md'), sourceId('technical-proposal.md'));
  assert.notStrictEqual(sourceId('건축물대장'), sourceId('토지특성'));
  assert.notStrictEqual(sourceId('국토교통부 실거래가'), sourceId('한국은행 기준금리'));
  assert.notStrictEqual(sourceId('한국부동산원 지가지수'), sourceId('통계청 가동률'));
});

test('★ 표에 없는 기관은 합치지 않는다 — 짐작으로 합치면 근거를 잃는다', () => {
  assert.notStrictEqual(sourceId('어느 기관 A'), sourceId('어느 기관 B'));
});

test('★ 빈 출처는 빈 이름이다 (Fact 는 애초에 빈 출처를 안 받는다)', () => {
  assert.strictEqual(sourceId(''), '');
  assert.strictEqual(sourceId(null), '');
  assert.throws(() => new Fact({ key: 'a', value: 1 }), /source 필수/);
});

/* ───────────── 저장하지 않고 파생한다 (D-116 과 같은 규칙) ───────────── */

test('★★ sourceId 는 저장되지 않는다 — 두 곳에 적으면 반드시 어긋난다', () => {
  const f = new Fact({ key: 'k', value: 1, source: 'MOLIT 실거래가' });
  assert.strictEqual(f.sourceId, 'molit');
  assert.ok(!Object.prototype.hasOwnProperty.call(f.toJSON(), 'sourceId'),
    '저장하면 source 를 고쳤을 때 따라오지 않고 조용히 갈린다 (confidence.js 와 같은 규칙)');
  // source 를 바꾸면 파생값도 따라온다
  f.source = '한국은행 기준금리';
  assert.strictEqual(f.sourceId, 'ecos');
});

/* ───────────── ★ 실제로 판정이 달라지는가 ───────────── */

test('★★★ 같은 곳 둘이 「검증됨」을 만들지 못한다 — 이것이 이 작업의 전부다', () => {
  const ds = new Dataset('T');
  ds.add({ key: 'valuation.value', value: 1000, source: '감정평가 Agent · 수익환원법', confidence: 0.6 });
  ds.add({ key: 'valuation.value', value: 1000, source: '감정평가 Agent · 1방식 가중평균', confidence: 0.6 });
  ds.resolve();
  const f = ds.get('valuation.value');
  assert.strictEqual(f.corroboration, 1, '같은 Agent 두 방법을 독립 출처 2건으로 셌다');
  assert.strictEqual(f.verified, false, '우리 Agent 가 자기 자신과 일치한 것으로 「검증됨」이 됐다');
});

test('★★★ 진짜 독립 두 기관은 그대로 「검증됨」이 된다 — 늑대야가 되면 안 된다', () => {
  const ds = new Dataset('T2');
  ds.add({ key: 'land.price', value: 500, source: '국토교통부 실거래가', confidence: 0.6 });
  ds.add({ key: 'land.price', value: 500, source: '한국부동산원 지가지수', confidence: 0.6 });
  ds.resolve();
  const f = ds.get('land.price');
  assert.strictEqual(f.corroboration, 2);
  assert.strictEqual(f.verified, true,
    '너무 많이 합치면 진짜 근거까지 잃는다 — 그러면 이 장치가 해가 된다');
});

test('★★ 세는 자리가 글자가 아니라 「세는 이름」을 쓴다 (되돌아가면 잡힌다)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'facts.js'), 'utf8')
    // 주석을 떼고 본다 — 경위를 잘 적어 둘수록 글자 대조가 눈이 먼다 (CLAUDE.md §8)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /new Set\(winnerGroup\.facts\.map\(f => f\.sourceId\)\)/,
    '독립 출처를 f.source(글자)로 세면 같은 곳이 둘로 세어진다');
  assert.ok(!/new Set\(g\.facts\.map\(f => f\.source\)\)/.test(src),
    '무리 점수도 같은 이유로 세는 이름을 써야 한다');
});
