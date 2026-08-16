'use strict';
/**
 * wind.test.js — 풍력 자산군·재무 템플릿 (등록부 D-55).
 *
 * 풍력에서 조용히 틀릴 수 있는 자리는 셋이다. 셋 다 **결과가 그럴듯해서**
 * 문서만 봐서는 안 잡힌다.
 *
 *  ① **해상이 육상으로 잡힌다.** 키워드 포함으로 찾는데 「해상풍력」 안에
 *     「풍력」이 들어 있다. 그러면 사업비가 배로 다른 사업이 육상 금융조건으로
 *     돌아간다 — 숫자는 나오고 어디에도 경고가 안 뜬다.
 *  ② **풍력이 태양광으로 잡힌다.** 태양광 템플릿이 `발전소` 를 키워드로 갖고
 *     있어 「해상풍력 발전소」가 태양광으로 갔다. 실제로 그랬다.
 *  ③ **풍속이 높이를 잃는다.** 기상청 관측은 10m, 허브는 80~140m다. 환산하면
 *     그럴듯한 값이 나오는데 전단지수가 가정이고, 발전량은 풍속의 **세제곱**이다.
 */
const test = require('node:test');
const assert = require('node:assert');

const A = require('../core/assetclass');
const tpl = require('../finance/templates');
const dict = require('../core/dictionary');
const kma = require('../connectors/kma');

/* ── ① 해상과 육상이 갈린다 ──────────────────────────── */

test('★ 「해상풍력」이 육상으로 잡히지 않는다', () => {
  assert.strictEqual(tpl.pickTemplate('서남권 400MW 해상풍력 개발사업').id, 'wind_offshore');
  assert.strictEqual(tpl.pickTemplate('offshore wind 105MW').id, 'wind_offshore');
  assert.strictEqual(tpl.pickTemplate('부유식 해상풍력').id, 'wind_offshore');
  // 육상은 육상으로
  assert.strictEqual(tpl.pickTemplate('강원 60MW 육상풍력').id, 'wind_onshore');
  assert.strictEqual(tpl.pickTemplate('풍력 발전단지 조성').id, 'wind_onshore');
});

test('★ 자산군 탐지도 해상이 먼저다', () => {
  const off = A.detect('서남권 해상풍력 시범단지');
  assert.ok(off && (off.id === 'wind_offshore' || (off.candidates || []).includes('wind_offshore')),
    `해상풍력이 ${JSON.stringify(off)} 로 잡혔다`);
});

test('★ 육상과 해상은 재무 가정이 실제로 다르다 — 같으면 나눌 뜻이 없다', () => {
  const on = tpl.getTemplate('wind_onshore').defaults;
  const off = tpl.getTemplate('wind_offshore').defaults;
  assert.ok(off.constructionYears > on.constructionYears,
    '해상 공사기간이 육상보다 길지 않다 — 인허가·해상공사·계통연계가 길다');
  assert.ok(off.contingencyPct > on.contingencyPct, '해상 예비비가 육상보다 크지 않다');
  assert.ok(off.debtRate > on.debtRate, '해상 금리가 육상보다 높지 않다');
});

/* ── ② 태양광으로 새지 않는다 ────────────────────────── */

test('★ 「발전소」 하나로 태양광이 되지 않는다', () => {
  // 이 한 줄이 실제 사고였다 — 「해상풍력 발전소」가 태양광 템플릿으로 갔다
  assert.strictEqual(tpl.pickTemplate('해상풍력 발전소').id, 'wind_offshore');
  // 자산군을 안 밝힌 발전소는 **generic 이다.** 태양광으로 짐작하지 않는다
  // (「개발사업」을 붙이면 부동산으로 간다 — 그건 이 변경과 무관한 기존 규칙이다)
  assert.strictEqual(tpl.pickTemplate('100MW 발전소').id, 'generic');
  // 태양광이라고 밝히면 태양광이다
  assert.strictEqual(tpl.pickTemplate('새만금 태양광').id, 'solar');
});

/* ── ③ 풍속은 높이를 잃지 않는다 ─────────────────────── */

test('★ 관측 풍속을 허브 높이로 환산하지 않는다', () => {
  const r = kma.hubWindSpeed();
  assert.strictEqual(r.ok, false);
  // ★ 「아직 안 붙였다」가 아니라 **안 하는 것**임이 드러나야 한다
  assert.strictEqual(r.byDesign, true);
  assert.match(r.error, /세제곱/);
  assert.match(r.error, /사람이 넣는다/);
});

test('★ 풍속과 허브 높이를 **짝으로** 받는다', () => {
  ['wind_onshore', 'wind_offshore'].forEach((id) => {
    const keys = A.requiredKeys(id);
    assert.ok(keys.includes('site.wind_speed'), `${id}: 풍속을 안 받는다`);
    assert.ok(keys.includes('site.hub_height_m'),
      `${id}: 높이 없는 풍속은 어느 높이의 값인지 알 수 없어 쓸 수 없다`);
  });
});

test('★ 발전량·이용률을 자동으로 내지 않는다 (D-25 와 같은 자리)', () => {
  // 사전에 발전량·이용률 항목이 아예 없어야 한다 — 있으면 언젠가 채워진다
  const keys = Object.keys(dict.FIELDS);
  assert.ok(!keys.some(k => /capacity_factor|이용률|generation_mwh/.test(k)),
    '이용률·발전량 항목이 생겼다 — 가정계수가 IM 에 들어가는 문이다');
});

/* ── 해상 전용 값 ────────────────────────────────────── */

test('★ 해상은 수심·이안거리를 받고, 육상은 안 받는다', () => {
  const off = A.requiredKeys('wind_offshore');
  assert.ok(off.includes('site.water_depth_m'));
  assert.ok(off.includes('site.distance_to_shore_km'));

  const on = A.requiredKeys('wind_onshore');
  assert.ok(!on.includes('site.water_depth_m'), '육상 딜에 수심을 물으면 무엇을 넣을지 헷갈린다');
  assert.ok(!on.includes('site.distance_to_shore_km'));
});

test('★ 육상은 입지 규제를 받는다 — 육상풍력은 입지가 성립 여부다', () => {
  assert.ok(A.requiredKeys('wind_onshore').includes('land.use_districts'));
});

/* ── 사전·화면 ───────────────────────────────────────── */

test('★ 풍력 필수값이 전부 사전에 있다 (없으면 입력란이 안 생긴다)', () => {
  ['wind_onshore', 'wind_offshore'].forEach((id) => {
    A.requiredKeys(id).forEach((k) => {
      assert.ok(dict.FIELDS[k], `${k} 가 사전에 없다 — 화면에 입력란이 안 생긴다`);
      assert.ok((A.whyOf(id, k) || '').length > 10, `${k}: 이유 없이 늘어난 입력란은 대충 채워진다`);
    });
  });
});

test('★ 풍력 딜에서 계통 대조를 묻는다 (D-54)', () => {
  ['wind_onshore', 'wind_offshore'].forEach((id) => {
    assert.ok(A.crosscheckKeys(id).includes('crosscheck.grid_region'),
      `${id}: 계통 여유를 안 묻는다 — 계통이 안 받아 주면 설비용량은 종이 위의 숫자다`);
    // 자산군이 안 정해져도 (육상·해상이 앱에서 섹터가 같다) 템플릿으로 뜬다
    assert.strictEqual(A.asksCrosschecks(null, id), true);
  });
});

test('★ 풍력에 제조·데이터센터 값이 딸려 오지 않는다', () => {
  ['wind_onshore', 'wind_offshore'].forEach((id) => {
    const keys = A.requiredKeys(id).concat(A.crosscheckKeys(id));
    assert.ok(!keys.includes('capacity.pue'), `${id}: PUE 는 데이터센터 값이다`);
    assert.ok(!keys.includes('crosscheck.hs_code'), `${id}: HS 코드는 제조 값이다`);
    assert.ok(!keys.includes('capacity.dc_kw'), `${id}: DC 용량은 태양광 값이다`);
  });
});

test('★ 다른 자산군에 풍력 값이 새지 않는다', () => {
  ['datacenter', 'hotel', 'apartment'].forEach((id) => {
    const keys = A.requiredKeys(id);
    assert.ok(!keys.includes('site.wind_speed'), `${id}: 풍속을 물으면 안 된다`);
    assert.ok(!keys.includes('site.water_depth_m'));
  });
});

/* ── 기본값이 추측임을 감추지 않는다 ──────────────────── */

test('★ 기본값이 추측이라는 사실이 코드에 적혀 있다 (D-55)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'finance', 'templates.js'), 'utf8');
  const block = src.slice(src.indexOf('wind_offshore:'), src.indexOf('solar: {'));
  assert.match(block, /〈추측〉/, '추측값에 표시가 없으면 확인된 값처럼 읽힌다');
});

test('★ 규모 구간이 육상·해상 따로 있다', () => {
  const on = tpl.SCALE_BANDS ? tpl.SCALE_BANDS.wind_onshore : null;
  const off = tpl.SCALE_BANDS ? tpl.SCALE_BANDS.wind_offshore : null;
  if (on && off) {
    assert.ok(off.max > on.max, '해상이 육상보다 크게 잡혀 있지 않다');
    assert.strictEqual(on.key, 'capacity.wind_mw');
  }
});
