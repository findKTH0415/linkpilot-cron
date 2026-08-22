'use strict';
/**
 * ess.test.js — ESS 자산군·재무 템플릿·고유 셈 (등록부 D-56).
 *
 * ESS 에서 조용히 틀릴 수 있는 자리는 셋이다. 셋 다 **결과가 그럴듯하다.**
 *
 *  ① **MWh 만 받는다.** 「100MWh ESS」는 사업을 특정하지 못한다 —
 *     100MWh/100MW(1시간)와 100MWh/25MW(4시간)는 수익모델도 사업비도 다르다.
 *     하나만 받으면 나머지를 가정으로 메우게 되고, 어느 사업인지 모른 채 모델이 돈다.
 *  ② **열화를 잊는다.** 배터리는 해마다 준다. 초기 용량으로 전 기간 매출을 깔면
 *     후반이 통째로 부풀려지는데, 매출표는 매년 같은 숫자라 멀쩡해 보인다.
 *  ③ **매출을 만들어 낸다.** 사이클 수 × 왕복효율 × 단가차 — 셋 다 가정이라
 *     곱하면 **어떤 숫자든 나온다.**
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const A = require('../core/assetclass');
const tpl = require('../finance/templates');
const dict = require('../core/dictionary');
const ess = require('../core/ess');

/* ── ① 두 용량은 짝이다 ──────────────────────────────── */

test('★ MWh 만으로는 지속시간을 내지 않는다', () => {
  const r = ess.duration(100, null);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /사업이 특정되지 않는다/);
});

test('★ 둘이 다 있으면 지속시간과 C-rate 를 낸다', () => {
  const a = ess.duration(100, 25);
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.value.hours, 4);
  assert.strictEqual(a.value.cRate, 0.25);

  const b = ess.duration(100, 100);
  assert.strictEqual(b.value.hours, 1);
  assert.strictEqual(b.value.cRate, 1);
});

test('★ 자산군이 둘을 모두 필수로 받는다', () => {
  const keys = A.requiredKeys('ess');
  assert.ok(keys.includes('capacity.ess_mwh'));
  assert.ok(keys.includes('capacity.ess_mw'), '출력을 안 받으면 몇 시간짜리인지 모른다');
});

test('★ 빈 문자열 용량이 0 이 되지 않는다 (M-07)', () => {
  assert.strictEqual(ess.duration('', 25).ok, false);
  assert.strictEqual(ess.duration(100, '  ').ok, false);
});

/* ── ② 열화를 잊지 않는다 ────────────────────────────── */

test('★ 열화율이 없으면 남은 용량을 내지 않는다 — 0 으로 두지 않는다', () => {
  const r = ess.capacityAfter(100, null, 10);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /20년 내내 새 배터리가 된다/);
});

test('★ 열화율이 있으면 남은 용량을 낸다 (보증서 값이라 가정이 아니다)', () => {
  const r = ess.capacityAfter(100, 2.5, 10);
  assert.strictEqual(r.ok, true);
  // 100 × 0.975^10 ≈ 77.6
  assert.ok(r.value.mwh > 77 && r.value.mwh < 78, `${r.value.mwh}MWh`);
  assert.ok(r.value.ratio < 80);
  // ★ 용량이 준 것과 매출이 준 것은 다르다 — 그 구분이 결과에 남아야 한다
  assert.match(r.value.note, /계약이 정한다/);
});

test('★ 운영기간 전체 곡선을 내고, 초기 용량으로 깔면 안 된다고 말한다', () => {
  const r = ess.degradationCurve(100, 2.5, 15);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.rows.length, 16);   // 0년차 포함
  assert.strictEqual(r.value.rows[0].mwh, 100);
  assert.ok(r.value.rows[15].mwh < 70);
  assert.match(r.value.text, /후반이 부풀려진다/);
});

test('★ 자산군이 열화율을 필수로 받는다', () => {
  assert.ok(A.requiredKeys('ess').includes('capacity.ess_degradation'));
});

/* ── ③ 매출을 만들지 않는다 ─────────────────────────── */

test('★ ESS 매출을 자동으로 내지 않는다 (§4.8 · D-25 와 같은 자리)', () => {
  const r = ess.revenue();
  assert.strictEqual(r.ok, false);
  // ★ 「아직 안 붙였다」가 아니라 **안 하는 것**임이 드러나야 한다
  assert.strictEqual(r.byDesign, true);
  assert.match(r.error, /어떤 숫자든 나온다/);
});

test('★ 대신 **몇 회 돌아야 하는지**만 말한다 — 가능 여부는 판단하지 않는다', () => {
  const r = ess.cyclesNeeded({ mwh: 100, annualMwhSold: 36500 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.cyclesPerYear, 365);
  assert.strictEqual(r.value.cyclesPerDay, 1);
  assert.match(r.value.text, /사람이 한다/);
  // ★ 「가능하다/불가능하다」로 판정하면 그것이 근거가 된다
  assert.ok(!/가능하다|불가능/.test(r.value.text));
});

/* ── SOC 상한 ────────────────────────────────────────── */

test('★ SOC 상한을 모르면 100% 로 치지 않는다', () => {
  const r = ess.usable(100, null);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.unknownLimit, true);
  assert.match(r.error, /제한이 없다는 뜻이 아니다/);
});

test('★ SOC 상한이 있으면 실효 용량을 낸다', () => {
  const r = ess.usable(100, 90);
  assert.strictEqual(r.value.mwh, 90);
  assert.strictEqual(r.value.ratedMwh, 100);
  assert.match(r.value.text, /정격 100MWh 의 90%/);
});

/* ── 수익모델 ───────────────────────────────────────── */

test('★ 수익모델을 자동으로 고르지 않는다 (§4.9)', () => {
  assert.strictEqual(ess.modelOf(''), null);
  assert.strictEqual(ess.modelOf('미정'), null);
  // 밝혀져 있으면 읽는다
  assert.strictEqual(ess.modelOf('주파수조정').id, 'fr');
  assert.strictEqual(ess.modelOf('피크저감').id, 'peak');
  assert.strictEqual(ess.modelOf('태양광 연계').id, 'renewable');
});

test('★ 자산군이 수익모델을 필수로 받는다', () => {
  assert.ok(A.requiredKeys('ess').includes('revenue.ess_model'),
    '무엇으로 버는 사업인지 모르면 매출의 성격 자체를 모른다');
});

/* ── 자산군·템플릿 ──────────────────────────────────── */

test('★ ESS 가 발전 자산군으로 잡히지 않는다', () => {
  assert.strictEqual(tpl.pickTemplate('100MWh ESS 구축사업').id, 'ess');
  assert.strictEqual(tpl.pickTemplate('BESS 200MWh').id, 'ess');
  // 「재생연계 ESS」에서 재생에너지 말이 먼저 걸리면 발전 템플릿으로 간다
  assert.strictEqual(tpl.pickTemplate('재생에너지 연계 ESS').id, 'ess');
  assert.strictEqual(A.detect('100MWh ESS 구축사업').id, 'ess');
});

test('★ ESS 운영기간이 발전보다 짧다 — 배터리 수명이 상한이다', () => {
  const e = tpl.getTemplate('ess').defaults;
  const s = tpl.getTemplate('solar').defaults;
  assert.ok(e.opsYears < s.opsYears,
    '태양광(20년)을 그대로 쓰면 교체 없이 20년 도는 모델이 된다');
  assert.ok(e.depreciationYears <= e.opsYears);
});

test('★ 규모 구간을 **저장용량(MWh)** 으로 잡는다', () => {
  const band = tpl.SCALE_BANDS.ess;
  assert.strictEqual(band.key, 'capacity.ess_mwh',
    '출력(MW)으로 잡으면 1시간짜리와 4시간짜리가 같은 규모로 읽힌다');
});

test('★ ESS 딜에서 계통 대조를 묻는다 (D-54)', () => {
  assert.ok(A.crosscheckKeys('ess').includes('crosscheck.grid_region'));
  assert.strictEqual(A.asksCrosschecks(null, 'ess'), true);
});

test('★ ESS 에 발전 자산의 값이 딸려 오지 않는다', () => {
  const keys = A.requiredKeys('ess');
  ['site.wind_speed', 'site.hub_height_m', 'capacity.dc_kw', 'capacity.pue'].forEach((k) => {
    assert.ok(!keys.includes(k), `${k} 는 ESS 값이 아니다`);
  });
});

test('★ 다른 자산군에 ESS 값이 새지 않는다', () => {
  ['wind_onshore', 'datacenter', 'hotel'].forEach((id) => {
    const keys = A.requiredKeys(id);
    assert.ok(!keys.includes('capacity.ess_mwh'), `${id}: ESS 용량을 물으면 안 된다`);
    assert.ok(!keys.includes('capacity.ess_degradation'));
  });
});

test('★ ESS 필수값이 전부 사전에 있다 (없으면 입력란이 안 생긴다)', () => {
  A.requiredKeys('ess').forEach((k) => {
    assert.ok(dict.FIELDS[k], `${k} 가 사전에 없다`);
    assert.ok((A.whyOf('ess', k) || '').length > 10, `${k}: 이유가 없다`);
  });
});

test('★ 기본값이 추측이라는 사실이 코드에 적혀 있다 (D-56)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'finance', 'templates.js'), 'utf8');
  const block = src.slice(src.indexOf('  ess: {'), src.indexOf('  solar: {'));
  assert.match(block, /〈추측〉/, '추측값에 표시가 없으면 확인된 값처럼 읽힌다');
});

/* ── 탐지 규칙 자체 ─────────────────────────────────── */

test('★ 「해상풍력」이 육상과 함께 걸려 미결로 남지 않는다', () => {
  // 이 규칙이 없으면 「여러 자산군이 함께 읽힙니다」가 떠서 사람이 고르게 되는데,
  // **고를 것이 없다.** 그리고 자산군이 null 이면 수심·이안거리가 화면에서 빠진다
  assert.strictEqual(A.detect('서남권 해상풍력 시범단지').id, 'wind_offshore');
  assert.strictEqual(A.detect('강원 육상풍력').id, 'wind_onshore');
});

test('★ 진짜 모호한 것은 그대로 후보로 남는다 (§4.9)', () => {
  // 포함 관계가 아닌 **서로 다른 말**이 함께 나온 경우다 — 고르지 않는다
  const r = A.detect('주상복합 아파트 개발');
  assert.strictEqual(r.id, null);
  assert.ok(r.candidates.length > 1);
});

/* ── 파이프라인에서 실제로 불리는가 (D-62) ─────────────── */

test('★ MWh/MW 짝과 열화가 05 Validation 에서 실제로 돈다', () => {
  const V = require('../agents/05-validation');
  const { Dataset } = require('../core/facts');
  const dict = require('../core/dictionary');
  const ds = new Dataset('T', dict.FIELDS);
  ds.addMany([
    { key: 'capacity.ess_mwh', value: 100, source: 'x', confidence: 1 },
    { key: 'capacity.ess_mw', value: 25, source: 'x', confidence: 1 },
    { key: 'capacity.ess_degradation', value: 2.5, source: 'x', confidence: 1 },
    { key: 'schedule.ops_years', value: 15, source: 'x', confidence: 1 },
  ]);
  ds.resolve();

  const flags = V.checkCapacityPairs(ds);
  assert.ok(flags.some(f => /4시간/.test(f.message)), '지속시간이 검증에 안 뜬다');
  assert.ok(flags.some(f => /후반이 부풀려진다/.test(f.message)), '열화 경고가 안 뜬다');
});

test('★ 열화율을 안 넣으면 **그 사실이 경고로 뜬다**', () => {
  const V = require('../agents/05-validation');
  const { Dataset } = require('../core/facts');
  const dict = require('../core/dictionary');
  const ds = new Dataset('T', dict.FIELDS);
  ds.addMany([
    { key: 'capacity.ess_mwh', value: 100, source: 'x', confidence: 1 },
    { key: 'capacity.ess_mw', value: 25, source: 'x', confidence: 1 },
  ]);
  ds.resolve();
  assert.ok(V.checkCapacityPairs(ds).some(f => /새 배터리가 된다/.test(f.message)));
});
