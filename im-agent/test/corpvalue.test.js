'use strict';
/**
 * corpvalue.test.js — 법인가치 계산과 보고서 (등록부 D-59).
 *
 * 탁상검토(D-57)와 위험이 같다 — **틀리지 않아도 사고가 난다.** 형식이
 * 그럴듯하면 받는 사람이 **평가의견서로 읽는다.** 외부평가는 외부평가기관만,
 * 세무 목적 평가는 세무대리인만 할 수 있다.
 *
 * 계산 쪽에서 조용히 틀릴 수 있는 자리는 넷이다.
 *
 *  ① **없는 해를 0 으로 센다.** 순손익 3개 연도 중 하나가 비면 가중평균이
 *     조용히 낮아진다 — 0 은 「이익이 없었다」는 값이고 자료 없음과 다르다.
 *  ② **가중치를 짐작한다.** 부동산과다보유 여부 하나로 법령 가중치가 3:2 에서
 *     2:3 으로 **뒤집힌다.** 짐작하면 결과는 그럴듯한데 근거가 없다.
 *  ③ **하한을 잊는다.** 순자산가치의 일정 비율이 하한인데, 안 걸면 손실 법인의
 *     평가액이 실제보다 낮게 나온다.
 *  ④ **법령 산식을 결과로만 남긴다.** 법령은 개정된다 — 산식을 안 적으면
 *     개정된 날부터 조용히 틀리고 「보충적 평가방법 적용」만 남는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const cv = require('../core/corpvalue');
const cr = require('../core/corpreport');
const outputspec = require('../core/outputspec');

/* ── ① 없는 해를 0 으로 세지 않는다 ─────────────────── */

test('★ 순손익 3개 연도가 다 있어야 가중평균을 낸다', () => {
  const r = cv.weightedIncome([24, 18, null]);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /직전 3년차가 없다/);
  assert.match(r.error, /0 으로 세면 평균이 조용히 낮아진다/);
});

test('★ 빈 문자열이 0 이 되지 않는다 (M-07)', () => {
  assert.strictEqual(cv.weightedIncome([24, 18, '']).ok, false);
  assert.strictEqual(cv.assetValue('').ok, false);
});

test('★ 가중치는 직전 1·2·3년 3:2:1 이다', () => {
  const r = cv.weightedIncome([30, 18, 6]);
  assert.strictEqual(r.ok, true);
  // (30*3 + 18*2 + 6*1) / 6 = 132/6 = 22
  assert.strictEqual(r.value.avg, 22);
  assert.deepStrictEqual(r.value.weights, [3, 2, 1]);
});

test('★ 가중평균이 손실이면 **그 사실을 들고 간다**', () => {
  const r = cv.weightedIncome([-30, -12, 6]);
  assert.strictEqual(r.value.negative, true);
  const iv = cv.incomeValue([-30, -12, 6]);
  assert.strictEqual(iv.value.negative, true);
  assert.match(iv.value.text, /음수다/);
});

test('★ 환원율이 법령값이라는 사실이 근거에 남는다', () => {
  const r = cv.incomeValue([30, 18, 6]);
  // 22 / 0.10 = 220
  assert.strictEqual(r.value.valueEok, 220);
  assert.match(r.value.basis, /상속세 및 증여세법 시행령/);
  assert.match(r.value.basis, /환원율 10%/);
});

/* ── ② 가중치를 짐작하지 않는다 ─────────────────────── */

test('★ 부동산 비율을 모르면 **계산 자체를 하지 않는다**', () => {
  const r = cv.statutoryValue({ netAsset: 180, income1: 24, income2: 18, income3: 12 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.unknownWeights, true);
  assert.match(r.error, /뒤집힌다/);
});

test('★ 부동산 50% 이상이면 가중치가 뒤집힌다', () => {
  const normal = cv.realEstateHeavy(30);
  assert.strictEqual(normal.value.heavy, false);
  assert.deepStrictEqual(normal.value.weights, { income: 3, asset: 2 });

  const heavy = cv.realEstateHeavy(62);
  assert.strictEqual(heavy.value.heavy, true);
  assert.deepStrictEqual(heavy.value.weights, { income: 2, asset: 3 });

  // 경계값도 부동산과다보유다
  assert.strictEqual(cv.realEstateHeavy(50).value.heavy, true);
});

test('★ 뒤집힌 가중치가 실제 계산에 반영된다', () => {
  const a = cv.statutoryValue({ netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 30 });
  const b = cv.statutoryValue({ netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 62 });
  assert.notStrictEqual(a.value.valueEok, b.value.valueEok, '가중치를 뒤집었는데 값이 같다');
  assert.deepStrictEqual(a.value.weights, { income: 3, asset: 2 });
  assert.deepStrictEqual(b.value.weights, { income: 2, asset: 3 });
});

/* ── ③ 하한을 건다 ──────────────────────────────────── */

test('★ 순자산가치의 80% 가 하한이다 — 손실 법인에서 걸린다', () => {
  // 순손익가치가 음수라 산식값이 하한 아래로 내려간다
  const r = cv.statutoryValue({ netAsset: 200, income1: -30, income2: -20, income3: -10, realEstatePct: 10 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.floorApplied, true);
  assert.strictEqual(r.value.floorEok, 160);
  assert.strictEqual(r.value.valueEok, 160);
  assert.ok(r.value.rawEok < r.value.floorEok);
  assert.match(r.value.text, /하한이 적용됐다/);
});

test('★ 하한이 안 걸리면 「적용됨」이라고 하지 않는다', () => {
  const r = cv.statutoryValue({ netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 62 });
  assert.strictEqual(r.value.floorApplied, false);
  assert.ok(!/하한이 적용됐다/.test(r.value.text));
});

/* ── ④ 법령 산식을 그대로 인쇄한다 ──────────────────── */

test('★ 적용한 산식이 결과에 실려 있다', () => {
  const r = cv.statutoryValue({ netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 62 });
  assert.match(r.value.basis, /제54조/);
  assert.match(r.value.basis, /순손익가치 × 2 \+ 순자산가치 × 3/);
  assert.match(r.value.basis, /80% 하한/);
});

test('★ 보고서가 법령 산식을 인쇄한다 — 개정 대조가 가능해야 한다', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 62 });
  const s = r.sections.find(x => x.title === '적용한 법령 산식');
  assert.ok(s, '법령 산식 절이 없다');
  assert.match(s.text, /개정된 날부터/);
  assert.match(s.text, /환원율 \| 10%/);
  assert.match(s.text, /이 건에 적용된 산식/);
});

test('★ 법령 상수에 근거 조문이 붙어 있다', () => {
  assert.match(cv.STATUTE.basis, /상속세 및 증여세법 시행령 제54조/);
  assert.ok(cv.STATUTE.asOf, '개정 확인 문구가 없다');
});

/* ── 하지 않는 계산 ─────────────────────────────────── */

test('★ 유사기업 배수법을 자동으로 내지 않는다', () => {
  const r = cv.marketMultipleValue();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.byDesign, true);
  assert.match(r.error, /누가 고르느냐가 결과를 정한다/);
});

test('★ 최대주주 할증을 자동으로 적용하지 않는다', () => {
  const r = cv.controlPremium();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.byDesign, true);
  assert.match(r.error, /사람이 적용 여부를 정한다/);
});

test('★ 하지 않은 계산이 **문서에 절로 남는다**', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 30 });
  const s = r.sections.find(x => x.title === '하지 않은 계산·조회');
  assert.ok(s);
  assert.match(s.text, /해서는 안 되거나/);
  assert.match(s.text, /유사기업 배수법/);
  assert.match(s.text, /최대주주 할증/);
});

/* ── 평가의견서가 아니다 ────────────────────────────── */

test('★ 「평가의견서가 아니다」가 **여러 곳**에 들어간다', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 30 });
  assert.match(r.markdown.split('## 01')[0], /평가의견서가 아니며/);         // 머리말
  assert.match(r.sections[0].text, /평가의견서가 아니며/);                    // 1장
  assert.match(r.sections.find(s => s.title === '결론').text, /평가의견서가 아니며/);
  assert.match(r.markdown.trim().split('\n').slice(-1)[0], /평가의견서가 아니며/); // 꼬리말
});

test('★ 고지에 **누가 안 했는지·무엇을 했는지**가 함께 있다', () => {
  assert.match(cr.NOT_AN_OPINION, /외부평가기관·세무대리인이 작성한 것이 아니고/);
  assert.match(cr.NOT_AN_OPINION, /법령이 정한 산식에 넣어 계산한/);
  assert.match(cr.NOT_AN_OPINION, /평가가 필요하다/);
});

test('★ 문서 사양이 「평가의견서」를 이름에 쓰지 않는다', () => {
  const p = outputspec.PRESETS.corp_valuation;
  assert.ok(p);
  assert.ok(!/opinion|평가의견/i.test(p.label), `label: ${p.label}`);
  assert.strictEqual(p.watermark, true);
});

/* ── 확인하지 않은 것 ───────────────────────────────── */

test('★ 확인하지 않은 것이 결론보다 앞에 있다', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 30 });
  const iNot = r.sections.findIndex(s => s.title === '확인하지 않은 것');
  const iConc = r.sections.findIndex(s => s.title === '결론');
  assert.ok(iNot >= 0 && iNot < iConc);
});

test('★ 장부가와 시가의 차이를 적는다 — 안 적으면 장부가가 평가액이 된다', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 30 });
  assert.match(r.sections.find(s => s.title === '가치별 산정').text, /시가로 평가한 값/);
  assert.ok(cv.assetValue(180).value.caution.length > 20);
});

test('★ 감사 여부·우발채무가 확인 안 한 목록에 있다', () => {
  const items = cr.NOT_CHECKED.map(x => x.item).join(' ');
  ['감사', '시가', '우발채무', '특수관계자'].forEach(k => assert.ok(items.includes(k), `${k} 가 빠졌다`));
  cr.NOT_CHECKED.forEach(x => assert.ok(x.why && x.why.length > 10, `${x.item}: 이유가 없다`));
});

/* ── 값을 안 내는 경우 ──────────────────────────────── */

test('★ 대상 법인이 없으면 문서를 만들지 않는다', () => {
  const r = cr.build({ projectId: 'P1' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /평가대상 법인/);
});

test('★ 재무자료가 하나도 없으면 만들지 않되 **DART 사정을 함께 적는다**', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)' });
  assert.strictEqual(r.ok, false);
  // 「미확인」이 결함으로 읽히면 안 된다 — SPC 가 DART 에 없는 것이 정상이다
  assert.match(r.reason, /공시대상회사만/);
});

test('★ 가중치가 안 정해지면 표지에 값을 올리지 않는다', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12 });
  assert.strictEqual(r.ok, true);            // 문서는 나온다
  assert.strictEqual(r.conclusion.mode, 'blocked');
  assert.strictEqual(cr.coverValue(r.conclusion), null, '표지 숫자는 그것만 읽힌다');
  assert.match(r.sections.find(s => s.title === '결론').text, /값을 제시하지 않는다/);
});

test('★ 순손익가치가 음수면 표지에 값을 올리지 않는다', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 200, income1: -30, income2: -20, income3: -10, realEstatePct: 10 });
  assert.strictEqual(r.conclusion.mode, 'negative');
  assert.strictEqual(cr.coverValue(r.conclusion), null);
  assert.match(r.conclusion.text, /수익성이 확인된 것이 아니다/);
});

test('★ SPC 가 DART 에 없는 것이 정상이라고 문서가 말한다', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 30 });
  assert.match(r.sections.find(s => s.title === '평가대상').text, /법인이 없다는 뜻이 아니다/);
});

/* ── 1주당 ──────────────────────────────────────────── */

test('★ 주식수가 없으면 1주당을 만들지 않는다', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 62 });
  assert.strictEqual(r.valuation.value.perShare, undefined);
  assert.ok(!/1주당/.test(r.sections.find(s => s.title === '결론').text));
});

test('★ 주식수가 있으면 1주당을 낸다', () => {
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', shares: 200000, netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 62 });
  assert.strictEqual(r.valuation.value.perShare, 94000);
});

/* ── 지어내지 않는다 ────────────────────────────────── */

test('★ LLM 을 쓰지 않는다', () => {
  ['corpvalue.js', 'corpreport.js'].forEach((f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'core', f), 'utf8');
    assert.ok(!/require\(.*llm/.test(src), `${f}: LLM 을 부르고 있다`);
  });
});

test('★ 파이프라인이 「만들지 않았다」도 로그에 낸다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  assert.match(src, /법인검토: 만들지 않았다/);
  assert.match(src, /corp-review\.md/);
  assert.match(src, /평가의견서가 아님/);
});
