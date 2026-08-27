'use strict';
/**
 * evidence.test.js — **분모가 틀리면 좋은 숫자가 거짓말이 된다** 〈2026-08-27 · D-152〉.
 *
 * 사장님 지시: 「확보된 자료를 근거로 값들의 **100% 를 놓고** 정보기여도와 품질을
 * 측정하고 그 근원으로 보고서 생성을 완성해줘」.
 *
 * ★ 이 검사가 지키는 것 넷:
 *     ① 분모는 **필요한 항목 전부**다 — 채워진 것만 세면 셋 중 셋이 「100%」가 된다
 *     ② 기여도와 품질을 **한 숫자로 섞지 않는다**
 *     ③ 계산 항목은 분모에 안 들어간다 (입력이 아니라 결과다)
 *     ④ 가정은 계산과 **다른 칸**이다 (§4.8)
 */
const test = require('node:test');
const assert = require('node:assert');
const E = require('../ui/platform/evidence-core.js');

const FIELDS = {
  'land.area_sqm': { label: '대지면적', category: 'Land' },
  'land.zoning': { label: '용도지역', category: 'Land' },
  'debt.amount': { label: '차입금', category: 'Debt' },
  'debt.rate': { label: '차입금리', category: 'Debt' },
};
const KEYS = Object.keys(FIELDS);

test('★★★ 분모는 **필요한 항목 전부**다 — 채워진 것만 세면 「100%」가 거짓이 된다', () => {
  const m = E.measure({
    keys: KEYS, fields: FIELDS,
    facts: { 'land.area_sqm': { origin: 'document', source: '사업계획서.pdf', sourceDate: '2026-01' } },
  });
  assert.strictEqual(m.total, 4, '분모가 요청한 항목 수와 다르다');
  assert.strictEqual(m.evidencePct, 25, '하나만 채웠는데 25% 가 아니다 — 채워진 것만 세고 있다');
  const missing = m.contribution.find((c) => c.id === 'missing');
  assert.strictEqual(missing.n, 3, '미확보를 갈래로 안 세고 있다');
});

test('★★★ **기여도와 품질을 한 숫자로 섞지 않는다** — 할 일이 정반대다', () => {
  // 반쯤 채웠는데 아주 좋다 / 다 채웠는데 근거가 약하다
  const half = E.measure({
    keys: KEYS, fields: FIELDS,
    facts: {
      'land.area_sqm': { origin: 'document', source: 'a.pdf', sourceDate: '2026-01', verified: true },
      'land.zoning': { origin: 'document', source: 'a.pdf', sourceDate: '2026-01', verified: true },
    },
  });
  const all = E.measure({
    keys: KEYS, fields: FIELDS,
    plan: { 'debt.rate': { fill: 'default' }, 'debt.amount': { fill: 'default' } },
    facts: {
      'land.area_sqm': { origin: 'derived', source: '04_financial' },
      'land.zoning': { origin: 'derived', source: '04_financial' },
      'debt.amount': { origin: 'derived', source: '04_financial' },
      'debt.rate': { origin: 'derived', source: '04_financial' },
    },
  });
  assert.strictEqual(half.evidencePct, 50);
  assert.strictEqual(all.evidencePct, 0, '계산·가정이 근거로 세어졌다');
  assert.ok(half.quality.score > all.quality.score,
    '반쯤 채운 좋은 근거가 다 채운 가정보다 품질이 낮게 나온다');
  // ★ 두 수가 **따로** 나온다 — 하나로 합쳐진 점수가 없어야 한다
  assert.ok(half.quality.score !== half.evidencePct, '두 수가 같은 값으로 뭉개졌다');
});

test('★★ 품질은 **채워진 것에 대해서만** 낸다 — 빈 칸을 0점으로 섞지 않는다', () => {
  const m = E.measure({
    keys: KEYS, fields: FIELDS,
    facts: { 'land.area_sqm': { origin: 'document', source: 'a.pdf', sourceDate: '2026-01', verified: true } },
  });
  assert.strictEqual(m.quality.filled, 1);
  assert.strictEqual(m.quality.score, 100, '빈 세 칸이 점수를 끌어내렸다 — 채움률과 품질이 뭉개진다');
});

test('★★★ **가정은 계산과 다른 칸이다** (§4.8) — 한 칸에 두면 「계산이니 괜찮다」로 읽힌다', () => {
  const m = E.measure({
    keys: KEYS, fields: FIELDS,
    plan: { 'debt.rate': { fill: 'default' } },
    facts: {
      'debt.amount': { origin: 'derived', source: '04_financial' },
      'debt.rate': { origin: 'derived', source: '산업 통상치' },
    },
  });
  const byId = {};
  m.contribution.forEach((c) => { byId[c.id] = c.n; });
  assert.strictEqual(byId.derived, 1, '계산이 1건이 아니다');
  assert.strictEqual(byId.assumed, 1, '가정이 따로 안 세어졌다');
});

test('★★ 계산 항목은 **분모에 안 들어간다** — 입력이 아니라 결과다', () => {
  const m = E.measure({
    keys: KEYS, fields: FIELDS, facts: { 'returns.equity_irr': { origin: 'derived', source: 'x' } },
    computedKeys: ['returns.equity_irr', 'returns.min_dscr'],
  });
  assert.strictEqual(m.total, 4, '계산 항목이 분모에 섞였다');
  assert.deepStrictEqual(m.computed, { total: 2, ready: 1 }, '계산 항목을 따로 안 세고 있다');
});

test('★★★ 값이 갈리면 **0점**이고 빨갛게 말한다 — 그대로 내보내면 안 된다', () => {
  const m = E.measure({
    keys: KEYS, fields: FIELDS,
    facts: { 'land.area_sqm': { origin: 'document', source: 'a.pdf', sourceDate: '2026-01', verified: true } },
    conflicts: [{ key: 'land.area_sqm', severity: 'RED' }],
  });
  assert.strictEqual(m.byKey['land.area_sqm'].grade, 'conflict');
  assert.strictEqual(m.quality.score, 0, '충돌난 값이 점수를 그대로 받았다');
  const v = E.verdict(m);
  assert.ok(v.some((x) => x.code === 'EVIDENCE_CONFLICT' && x.level === 'RED'), '충돌을 안 말한다');
});

test('★★ 비어 있으면 **무엇을 하면 채워지는지** 적는다 — 「없음」만 적으면 지어내서 채운다', () => {
  const m = E.measure({
    keys: KEYS, fields: FIELDS,
    plan: { 'land.zoning': { fill: 'public', why: '공공데이터에서 가져옵니다' } },
  });
  assert.strictEqual(m.byKey['land.zoning'].howToFill, '공공데이터에서 가져옵니다');
});

test('★★ **어느 자료가 몇 칸을 냈는지** 센다 — 자료별 기여도', () => {
  const m = E.measure({
    keys: KEYS, fields: FIELDS,
    facts: {
      'land.area_sqm': { origin: 'document', source: '사업계획서.pdf' },
      'land.zoning': { origin: 'document', source: '사업계획서.pdf' },
      'debt.amount': { origin: 'public', source: 'ECOS' },
    },
  });
  assert.deepStrictEqual(m.bySource.map((s) => [s.source, s.n]),
    [['사업계획서.pdf', 2], ['ECOS', 1]], '자료별 기여도가 안 나온다');
});

test('★★★ 근거가 절반 미만이면 **빨갛게 말한다** — 다만 막지는 않는다 (D-127 과 같은 결)', () => {
  const m = E.measure({ keys: KEYS, fields: FIELDS, facts: {} });
  const v = E.verdict(m);
  const thin = v.find((x) => x.code === 'EVIDENCE_THIN');
  assert.ok(thin && thin.level === 'RED', '근거가 얇은 것을 안 말한다');
  assert.ok(!/막았|생성 중단/.test(JSON.stringify(v)), '막는다고 적혀 있다 — 막으면 검사를 끈다');
});

test('★★ 갈래(사전 category)별로 묶어 준다 — 화면이 「Land 12개 중 …」로 쓴다', () => {
  const m = E.measure({
    keys: KEYS, fields: FIELDS,
    facts: { 'land.area_sqm': { origin: 'document', source: 'a.pdf', sourceDate: '2026-01' } },
  });
  const land = m.byCategory.find((c) => c.name === 'Land');
  assert.strictEqual(land.total, 2);
  assert.strictEqual(land.fromEvidence, 1);
  assert.strictEqual(land.pct, 50);
});

test('★★ 점수를 말로 옮길 때 **문턱을 함께 적는다** — 안 적으면 숫자를 못 믿는다', () => {
  assert.match(E.band(90).why, /85/);
  assert.match(E.band(70).why, /65/);
  assert.match(E.band(10).why, /65/);
  assert.strictEqual(E.band(null).id, 'none');
});

test('★★ 자동으로 못 채우는 갈래는 **왜 늘 0%인지** 적는다 — 안 적으면 채우려 든다', () => {
  const m = E.measure({
    keys: ['crosscheck.industry'], fields: { 'crosscheck.industry': { label: '업종', category: 'Crosscheck' } },
  });
  const c = m.byCategory[0];
  assert.match(c.note || '', /사람이 고릅니다/, 'Crosscheck 가 왜 비는지 안 적었다');
  // ★ 그래도 **분모에는 들어간다** — 사장님이 세신 100% 에 들어 있다
  assert.strictEqual(m.total, 1);
});
