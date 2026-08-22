'use strict';
/**
 * solar.test.js — 태양광 자산군과 고유 셈 (등록부 D-58).
 *
 * 재무 템플릿 `solar` 는 처음부터 있었는데 **자산군이 없었다.** 그래서 태양광
 * 딜에서 전용 필수값이 통째로 안 떴다 — 일사량도, DC/AC 도, 이격거리도 묻지
 * 않았다. **화면은 「필수 다 채웠다」라고 말했다.**
 *
 * 태양광에서 조용히 틀릴 수 있는 자리는 넷이다. 넷 다 **결과가 그럴듯하다.**
 *
 *  ① **DC 만 받는다.** DC 1.3MW/AC 1.0MW 는 맑은 날 정오에 인버터가 잘라 낸다.
 *     DC 로 발전량을 곱해 두면 그만큼 부풀려지는데 표에는 안 보인다.
 *  ② **수평면 일사량을 경사면으로 옮긴다.** 모델 선택이 결과를 몇 %씩 흔들고,
 *     나온 값은 실측값과 문서에서 구분되지 않는다.
 *  ③ **발전량을 만든다.** PR 이 가정이다 (D-25 — 결정은 있었는데 코드에 자리가 없었다).
 *  ④ **REC 가중치를 박는다.** 고시가 정하고 개정된다 — 박으면 개정된 날부터
 *     조용히 틀리고, 문서에는 「가중치 적용됨」만 남는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const A = require('../core/assetclass');
const tpl = require('../finance/templates');
const dict = require('../core/dictionary');
const solar = require('../core/solar');

/* ── 자산군이 생겼다 ─────────────────────────────────── */

test('★ 태양광이 자산군으로 잡힌다 (전에는 없었다)', () => {
  assert.strictEqual(A.detect('새만금 100MW 태양광').id, 'solar');
  assert.strictEqual(A.detect('영농형 태양광').id, 'solar');
  assert.strictEqual(A.templateOf('solar'), 'solar');
});

test('★ 전용 필수값이 실제로 뜬다', () => {
  const keys = A.requiredKeys('solar');
  ['capacity.dc_kw', 'capacity.ac_kw', 'site.solar_irradiance',
    'site.land_category', 'legal.setback_m'].forEach((k) => {
    assert.ok(keys.includes(k), `${k} 를 안 묻는다`);
    assert.ok(dict.FIELDS[k], `${k} 가 사전에 없다 — 화면에 입력란이 안 생긴다`);
    assert.ok((A.whyOf('solar', k) || '').length > 10, `${k}: 이유가 없다`);
  });
});

test('★ 태양광 딜에서 계통 대조를 묻는다 (D-54)', () => {
  assert.ok(A.crosscheckKeys('solar').includes('crosscheck.grid_region'));
  assert.strictEqual(A.asksCrosschecks('solar', null), true);
  // 자산군이 안 잡혀도 템플릿으로 걸린다 — 한 벌을 양쪽이 참조한다
  assert.strictEqual(A.asksCrosschecks(null, 'solar'), true);
});

test('★ 태양광에 다른 자산군 값이 딸려 오지 않는다', () => {
  const keys = A.requiredKeys('solar');
  ['site.wind_speed', 'site.hub_height_m', 'capacity.ess_mwh', 'capacity.pue']
    .forEach(k => assert.ok(!keys.includes(k), `${k} 는 태양광 값이 아니다`));
});

test('★ 다른 자산군에 태양광 값이 새지 않는다', () => {
  ['wind_onshore', 'ess', 'datacenter'].forEach((id) => {
    const keys = A.requiredKeys(id);
    assert.ok(!keys.includes('site.land_category'), `${id}: 부지 유형을 물으면 안 된다`);
    assert.ok(!keys.includes('legal.setback_m'));
  });
});

test('★ 「ESS 연계 태양광」은 자동으로 고르지 않는다 (§4.9)', () => {
  // 둘 다 실제로 걸린 딜이다 — 하나를 짐작하면 받아야 할 값이 통째로 갈린다
  const r = A.detect('ESS 연계 태양광 발전사업');
  assert.strictEqual(r.id, null);
  assert.deepStrictEqual(r.candidates.sort(), ['ess', 'solar']);
});

/* ── ① DC 와 AC 는 짝이다 ───────────────────────────── */

test('★ AC 가 없으면 과적률을 내지 않는다', () => {
  const r = solar.overloadRatio(1300, null);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /사업이 특정되지 않는다/);
});

test('★ 과적이면 **잘린다는 사실**을 말한다 — 적정 여부는 말하지 않는다', () => {
  const r = solar.overloadRatio(1300, 1000);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.ratio, 1.3);
  assert.strictEqual(r.value.clipping, true);
  assert.match(r.value.text, /클리핑/);
  assert.match(r.value.text, /부풀려진다/);
  // ★ 「적정/부적정」은 설계 선택이라 우리가 판정하지 않는다
  assert.ok(!/적정|부적절|권장/.test(r.value.text));
});

test('★ 과적이 아니면 클리핑이라고 하지 않는다', () => {
  const same = solar.overloadRatio(1000, 1000);
  assert.strictEqual(same.value.clipping, false);
  const under = solar.overloadRatio(900, 1000);
  assert.strictEqual(under.value.clipping, false);
  assert.match(under.value.text, /인버터가 모듈보다 크다/);
});

test('★ 빈 문자열 용량이 0 이 되지 않는다 (M-07)', () => {
  assert.strictEqual(solar.overloadRatio('', 1000).ok, false);
  assert.strictEqual(solar.overloadRatio(1000, '  ').ok, false);
});

/* ── ② 경사면 일사량으로 옮기지 않는다 ───────────────── */

test('★ 수평면 일사량을 경사면으로 변환하지 않는다', () => {
  const r = solar.planeOfArrayIrradiance();
  assert.strictEqual(r.ok, false);
  // 「아직 안 붙였다」가 아니라 **안 하는 것**임이 드러나야 한다
  assert.strictEqual(r.byDesign, true);
  assert.match(r.error, /모델 선택이 결과를/);
  assert.match(r.error, /사람이 넣는다/);
});

/* ── ③ 발전량을 만들지 않는다 (D-25) ────────────────── */

test('★ 발전량을 자동으로 내지 않는다 — 결정이 코드에도 있어야 한다', () => {
  const r = solar.generation();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.byDesign, true);
  assert.match(r.error, /D-25/);
  assert.match(r.error, /시스템효율/);
});

/* ── ④ REC 가중치를 박지 않는다 ─────────────────────── */

test('★ 가중치 **값**을 내지 않는다 — 고시가 정하고 개정된다', () => {
  const r = solar.recWeightAxes({ landCategory: '임야', dcKw: 1000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.weight, null, '가중치 숫자가 박히면 개정된 날부터 조용히 틀린다');
  assert.match(r.value.text, /고시가 정하고 개정된다/);
});

test('★ 그렇다고 아무 말도 안 하지는 않는다 — 갈리는 축을 말한다', () => {
  const r = solar.recWeightAxes({ landCategory: '임야', dcKw: 1000 });
  const axes = r.value.axes.map(a => a.axis);
  assert.deepStrictEqual(axes, ['부지 유형', '설비 용량', '설치 형태']);
  // 임야는 불리한 유형이라는 사실이 빠지면 유리한 가중치로 계산된 채 넘어간다
  assert.match(r.value.text, /임야/);
});

test('★ 부지 유형을 안 밝히면 **고르지 않는다** (§4.9)', () => {
  assert.strictEqual(solar.landKind(''), null);
  assert.strictEqual(solar.landKind('태양광 부지'), null);
  const r = solar.recWeightAxes({ landCategory: '', dcKw: 1000 });
  assert.match(r.value.axes[0].note, /가중치를 가르는 첫 축/);
});

test('★ 아는 유형은 읽는다', () => {
  assert.strictEqual(solar.landKind('임야').id, 'forest');
  assert.strictEqual(solar.landKind('농지 전용').id, 'farm');
  assert.strictEqual(solar.landKind('공장 지붕').id, 'building');
  assert.strictEqual(solar.landKind('저수지 수상').id, 'water');
});

test('★ 부지 유형마다 무엇이 따라오는지 적혀 있다', () => {
  solar.LAND_KINDS.filter(k => k.id !== 'etc').forEach((k) => {
    assert.ok(k.caution && k.caution.length > 10, `${k.label}: 주의사항이 없다`);
  });
});

/* ── 면적 ────────────────────────────────────────────── */

test('★ 면적은 kW당 몇 ㎡ 까지만 말한다 — 가능 여부는 판정하지 않는다', () => {
  const r = solar.areaPerKw(15000, 1000);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.sqmPerKw, 15);
  assert.match(r.value.text, /사람이 한다/);
  assert.ok(!/가능하다|불가능|부족하다/.test(r.value.text));
});

/* ── 이 파일이 지키는 규칙 ──────────────────────────── */

test('★ LLM 을 쓰지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'solar.js'), 'utf8');
  assert.ok(!/require\(.*llm/.test(src));
});

test('★ REC 가중치 숫자가 코드에 박혀 있지 않다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'solar.js'), 'utf8');
  // 0.7·1.2·1.5 같은 가중치 값을 상수로 두면 고시 개정에 뒤처진다
  assert.ok(!/weight\s*[:=]\s*[0-9]/.test(src), '가중치 값이 박혀 있다');
});

/* ── 파이프라인에서 실제로 불리는가 (D-62) ─────────────── */

/**
 * ★ **D-48 과 같은 실패를 막는 테스트다.** `core/solar.js` 를 만들어 놓고
 *   파이프라인에서 한 번도 부르지 않고 있었다 — 교차검증에서 잡았다.
 *   「붙였다」가 사실이려면 **검증 결과에 실제로 떠야 한다.**
 */
test('★ DC/AC 짝 검사가 05 Validation 에서 실제로 돈다', () => {
  const V = require('../agents/05-validation');
  const { Dataset } = require('../core/facts');
  const ds = new Dataset('T', dict.FIELDS);
  ds.addMany([
    { key: 'capacity.dc_kw', value: 1300, source: 'x', confidence: 1 },
    { key: 'capacity.ac_kw', value: 1000, source: 'x', confidence: 1 },
  ]);
  ds.resolve();

  const flags = V.checkCapacityPairs(ds);
  assert.ok(flags.some(f => /클리핑/.test(f.message)), '과적인데 검증에 안 뜬다');
  // checkConsistency 를 통해서도 나와야 한다 — 거기가 실제 호출 경로다
  assert.ok(V.checkConsistency(ds).some(f => f.type === 'CAPACITY_PAIR'),
    'checkConsistency 에서 안 불린다 — 만들어 놓고 안 부르는 자리다');
});

test('★ 태양광 값이 없는 딜에는 아무것도 안 뜬다 (소음을 만들지 않는다)', () => {
  const V = require('../agents/05-validation');
  const { Dataset } = require('../core/facts');
  const ds = new Dataset('T', dict.FIELDS);
  ds.addMany([{ key: 'land.area_sqm', value: 1000, source: 'x', confidence: 1 }]);
  ds.resolve();
  assert.strictEqual(V.checkCapacityPairs(ds).length, 0);
});
