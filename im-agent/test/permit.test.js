'use strict';
/**
 * permit.test.js — 건축인허가·주택인허가 Connector.
 *
 * 이 파일에서 가장 중요한 검사는 **"기록이 없는 것을 미허가라고 적지 않는가"** 다.
 * 인허가 기록이 없는 이유는 셋이다 — 나대지 / 수록 지연 / 지번 불일치.
 * 셋을 구분하지 않고 "미허가"라고 적으면, 허가를 이미 받은 딜이 IM 에서
 * 미허가로 나간다. 조용히 틀리는 것이 아니라 **틀린 채로 대외에 나간다.**
 *
 * ★ 2026-08-16 두 작업선을 합치면서 이 파일을 다시 썼다. 인허가는 **07 Geo 가
 *   값을 채우지 않고 05 Validation 이 대조만 한다** — 한 필지에 인허가가 여러 건
 *   쌓이고(표본 11건) 과거 건물 이력이 섞여서, 최신 건을 집어 채우면 없는
 *   인허가를 있다고 적게 되기 때문이다. 검사 의도는 그대로 두고 대상만 옮겼다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const molit = require('../connectors/molit');
const geo = require('../agents/07-geo');

/* ───────────── 단계 판정 ───────────── */

test('★ 진행 단계는 뒤에서부터 본다 (사용승인 > 착공 > 허가)', () => {
  // 사용승인이 있는데 "건축허가 취득"이라고 적으면 실제보다 이른 단계로 읽힌다
  assert.deepStrictEqual(
    molit.permitStage({ archPmsDay: '20240301', realStcnsDay: '20240601', useAprDay: '20260520' }),
    { stage: '사용승인', order: 4, date: '20260520' });

  assert.deepStrictEqual(
    molit.permitStage({ archPmsDay: '20240301', realStcnsDay: '20240601' }),
    { stage: '착공', order: 3, date: '20240601' });

  assert.deepStrictEqual(
    molit.permitStage({ archPmsDay: '20240301' }),
    { stage: '건축허가', order: 2, date: '20240301' });

  assert.deepStrictEqual(
    molit.permitStage({ stcnsSchedDay: '20250101' }),
    { stage: '착공예정', order: 1, date: '20250101' });
});

test('★ 기록은 있는데 날짜가 없으면 단계를 지어내지 않는다', () => {
  const r = molit.permitStage({});
  assert.strictEqual(r.stage, '미확인');
  assert.strictEqual(r.order, 0);
  assert.strictEqual(r.date, null,
    '날짜가 없는데 단계를 붙이면 IM 이 없는 진행을 있다고 말한다');
});

test('★ 단계는 순서를 갖는다 — 뒤 단계가 앞 단계보다 크다', () => {
  const order = (p) => molit.permitStage(p).order;
  assert.ok(order({ useAprDay: '20260520' }) > order({ realStcnsDay: '20240601' }));
  assert.ok(order({ realStcnsDay: '20240601' }) > order({ archPmsDay: '20240301' }));
  assert.ok(order({ archPmsDay: '20240301' }) > order({ stcnsSchedDay: '20250101' }));
  assert.ok(order({ stcnsSchedDay: '20250101' }) > order({}));
});

/* ───────────── 주택법 트랙 ───────────── */

/**
 * ★ 30세대 이상 공동주택은 **건축허가가 아니라 사업계획승인**을 받는다.
 *   한쪽만 보면 주택 개발 딜에서 "인허가 기록 없음" 으로 오판한다.
 */
test('★ 주택인허가는 건축법과 다른 트랙이다', () => {
  assert.strictEqual(typeof molit.housingPermits, 'function', '주택법 조회 경로가 없다');
  assert.strictEqual(typeof molit.housingPermitStage, 'function');

  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '05-validation.js'), 'utf8');
  assert.match(src, /housingPermits/,
    '건축인허가만 보면 공동주택 딜에서 "기록 없음"으로 오판한다');
});

/* ───────────── 채우지 않는다 ───────────── */

test('★ 07 Geo 는 인허가를 채우지 않는다 — 05 Validation 이 대조만 한다', () => {
  const declared = [...geo.FILLS, ...Object.values(geo.CONDITIONAL_FILLS).flat()];
  assert.ok(!declared.includes('legal.permit_status'),
    '한 필지에 인허가가 여러 건 쌓인다. 최신 건을 집어 채우면 옛 건물의 허가를 '
    + '이 딜의 인허가라고 적게 된다 — 없는 인허가를 있다고 말하는 셈이다');

  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '07-geo.js'), 'utf8');
  assert.ok(!/buildingPermits?\(/.test(src), '07 이 인허가를 부르고 있다');
});

test('★ 기록 없음을 "미허가"라고 쓰지 않는다', () => {
  const molitSrc = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'molit.js'), 'utf8');
  const valSrc = fs.readFileSync(path.join(__dirname, '..', 'agents', '05-validation.js'), 'utf8');

  // 기록이 없을 때 쓰는 문구가 '자료 없음' 계열이어야 한다 — '미허가'가 아니다
  assert.match(molitSrc, /자료 없음|이력이 없는/,
    '빈 응답을 무엇이라 부르는지 코드에 적혀 있어야 한다');
  assert.ok(!/미허가/.test(molitSrc),
    'Connector 가 "미허가"라고 단정하면 나대지·수록 지연·지번 불일치가 한 덩어리가 된다');
  assert.match(valSrc, /단정|채우지 않는다|자동으로 채우지/,
    '대조하는 쪽도 단정하지 않는다는 것이 코드에 남아 있어야 한다');
});

/* ───────────── 키·쿼터 ───────────── */

test('키가 없으면 부르지 않는다', async () => {
  const saved = process.env.DATA_GO_KR_KEY;
  delete process.env.DATA_GO_KR_KEY;
  try {
    const r = await molit.buildingPermits({ sigunguCd: '11110', bjdongCd: '10100', bun: '0001', ji: '0000' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.unavailable, '키가 없으면 네트워크를 타기 전에 멈춰야 한다');
  } finally {
    if (saved === undefined) delete process.env.DATA_GO_KR_KEY; else process.env.DATA_GO_KR_KEY = saved;
  }
});

/**
 * ★ Encoding 인증키(%2F·%3D 포함)를 넣으면 인증만 실패하고 증상이 "키가 틀렸다"와
 *   똑같다. 부르기 전에 막고 무엇이 잘못됐는지 말해야 한다.
 */
test('Encoding 인증키 차단이 인허가에도 걸린다', async () => {
  const saved = process.env.DATA_GO_KR_KEY;
  process.env.DATA_GO_KR_KEY = 'abcd%2Befgh%3D';
  try {
    const r = await molit.buildingPermits({ sigunguCd: '11110', bjdongCd: '10100', bun: '0001', ji: '0000' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Decoding|Encoding/,
      '어느 쪽 키를 넣어야 하는지 말하지 않으면 같은 실수를 반복한다');
  } finally {
    if (saved === undefined) delete process.env.DATA_GO_KR_KEY; else process.env.DATA_GO_KR_KEY = saved;
  }
});

test('법정동코드가 없으면 부르지 않는다', async () => {
  const saved = process.env.DATA_GO_KR_KEY;
  process.env.DATA_GO_KR_KEY = 'test-key';
  try {
    const r = await molit.buildingPermits({ sigunguCd: '', bjdongCd: '', bun: '0001', ji: '0000' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /법정동코드/);
  } finally {
    if (saved === undefined) delete process.env.DATA_GO_KR_KEY; else process.env.DATA_GO_KR_KEY = saved;
  }
});
