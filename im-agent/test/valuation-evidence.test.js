'use strict';
/**
 * valuation-evidence.test.js — 가치평가 근거 대장 (지침 v1.0 §2 · D-333).
 *
 * 못 박는 것 다섯:
 *  ① 없는 값을 «해당 없음»으로 읽지 않는다 — UNVERIFIED + 그 말
 *  ② 값이 갈린 항목은 CONFLICTED — 하나로 고르지 않는다
 *  ③ 계산값은 VERIFIED 가 아니다 — PARTIAL
 *  ④ 권리 여덟은 문서 확인 전이라 전부 UNVERIFIED, G0 은 그래서 보류
 *  ⑤ 보고서에서 대장이 «가격보다 먼저» 오고, 대장이 없으면 그 절이 안 생긴다
 */
const test = require('node:test');
const assert = require('node:assert');

const { Dataset } = require('../core/facts');
const ve = require('../core/valuation-evidence');
const da = require('../core/deskappraisal');

function ds(facts) {
  const d = new Dataset('p1');
  for (const f of facts) d.add(f);
  return d.resolve();
}

const BASE = [
  { key: 'project.location', value: '서울 서초구 방배동 997', source: 'plan.pdf', page: 3, origin: 'document' },
  { key: 'geo.pnu', value: '1165010100109970000', source: 'VWorld 지오코딩', verified: true, origin: 'public', sourceDate: '2026-09-26' },
  { key: 'land.area_sqm', value: 12480, unit: '㎡', source: 'plan.pdf', page: 4, origin: 'document' },
  { key: 'land.official_price', value: 1200000, unit: '원/㎡', source: '개별공시지가(2026년 고시)', verified: true, origin: 'public', sourceDate: '2026-09-26' },
];

const APPRAISAL = {
  methods: {
    official: { label: '공시지가 기준', valueEok: 100, valueType: 'current', assumption: '현실화계수 1.6 은 가정' },
    income: { label: '수익환원법', valueEok: 300, valueType: 'residual', assumption: '공사비로 대체' },
  },
  concluded: { valueEok: 100, status: 'provisional' },
  facts: [], flags: [], comparables: [], disclaimer: 'x',
};

const row = (ev, key) => ev.items.find(r => r.key === key);

test('① 없는 값은 UNVERIFIED 이고 «해당 없음»으로 읽지 말라고 적는다', () => {
  const ev = ve.build({ assetId: 'p1', dataset: ds(BASE), appraisal: APPRAISAL });
  const own = row(ev, 'land.ownership');
  assert.strictEqual(own.status, 'UNVERIFIED');
  assert.strictEqual(own.value, null);
  assert.match(own.note, /해당 없음.*읽지 않는다/);
});

test('① 공공 원자료로 확정된 값은 VERIFIED · 문서 값 하나는 UNVERIFIED · 수집방식을 옮긴다', () => {
  const ev = ve.build({ assetId: 'p1', dataset: ds(BASE), appraisal: APPRAISAL });
  assert.strictEqual(row(ev, 'land.official_price').status, 'VERIFIED');
  assert.strictEqual(row(ev, 'land.official_price').method, '공공 API');
  assert.strictEqual(row(ev, 'land.official_price').asOf, '2026-09-26');
  assert.strictEqual(row(ev, 'land.area_sqm').status, 'UNVERIFIED');
  assert.strictEqual(row(ev, 'land.area_sqm').method, '제출 문서');
});

test('② 같은 항목에 값이 둘이면 CONFLICTED 이고 G0 은 면적 미확정으로 보류한다', () => {
  const d = ds([...BASE, { key: 'land.area_sqm', value: 11000, unit: '㎡', source: '토지대장', origin: 'public', verified: true }]);
  const ev = ve.build({ assetId: 'p1', dataset: d, appraisal: APPRAISAL });
  assert.strictEqual(row(ev, 'land.area_sqm').status, 'CONFLICTED');
  assert.match(row(ev, 'land.area_sqm').note, /하나로 고르지 않는다/);
  assert.ok(ev.gate.reasons.includes('대지면적 미확정'));
});

test('③ 방식별 값과 결론은 계산값이라 PARTIAL — VERIFIED 로 적지 않는다', () => {
  const ev = ve.build({ assetId: 'p1', dataset: ds(BASE), appraisal: APPRAISAL });
  const calc = ev.items.filter(r => r.key.startsWith('appraisal.'));
  assert.strictEqual(calc.length, 3);
  assert.ok(calc.every(r => r.status === 'PARTIAL'), JSON.stringify(calc.map(r => r.status)));
  assert.match(row(ev, 'appraisal.method.income').label, /조건부/);
});

test('④ 권리 여덟은 전부 UNVERIFIED · G0 보류 · 없는 칸은 지어내지 않는다', () => {
  const ev = ve.build({ assetId: 'p1', dataset: ds(BASE), appraisal: APPRAISAL });
  assert.strictEqual(ev.rights.length, 8);
  assert.ok(ev.rights.every(r => r.status === 'UNVERIFIED' && r.finding === null));
  assert.strictEqual(ev.gate.status, 'HOLD');
  assert.ok(ev.gate.reasons.some(x => /권리·점유 8건/.test(x)));
  assert.ok(ev.gate.reasons.includes('소유·지분 문서 확인 전'));
  assert.ok(ev.items.every(r => r.url === null && r.owner === null && r.renewBy === null));
  const total = Object.values(ev.counts).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, ev.items.length + ev.rights.length);
});

test('④ 대상이 비면 G0 이 그 까닭을 센다 (asset_id · PNU · 소재지)', () => {
  const ev = ve.build({ dataset: ds([]), appraisal: null });
  for (const why of ['asset_id 없음', '필지(PNU) 미확인', '소재지 미확인']) assert.ok(ev.gate.reasons.includes(why), why);
  assert.ok(ev.items.every(r => r.status === 'UNVERIFIED'));
});

test('⑤ 보고서에서 근거 대장은 결론보다 먼저 오고, 번호가 차례대로다', () => {
  const ev = ve.build({ assetId: 'p1', dataset: ds(BASE), appraisal: APPRAISAL });
  const r = da.build({ projectId: 'p1', appraisal: APPRAISAL, evidence: ev });
  const titles = r.sections.map(s => s.title);
  const iEv = titles.indexOf('근거 대장');
  assert.ok(iEv > 0 && iEv < titles.indexOf('평가 방식별 결과') && iEv < titles.indexOf('결론'), titles.join(','));
  assert.deepStrictEqual(r.sections.map(s => s.no), r.sections.map((_, i) => String(i + 1).padStart(2, '0')));
  assert.match(r.sections[iEv].text, /G0 대상·권리 게이트: 보류/);
  assert.match(r.markdown, /## 04\. 근거 대장/);
});

test('⑤ 대장이 없는 옛 호출은 그 절을 만들지 않는다 (빈 절을 그리지 않는다)', () => {
  const r = da.build({ projectId: 'p1', appraisal: APPRAISAL });
  assert.ok(!r.sections.some(s => s.title === '근거 대장'));
  assert.strictEqual(r.sections.length, 8);
  assert.strictEqual(r.evidence, null);
});
