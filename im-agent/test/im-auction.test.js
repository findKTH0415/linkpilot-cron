'use strict';
// IM 시장 분석 절의 «공매 낙찰가율» 칸 — 03 Research 가 내고 06 IM Writer 가 그 절 아래 따로 싣는다 (2026-10-21 사장님).
// ★ 돌려서 잰다: kamco 를 가짜로 바꿔 끼운다. 망을 안 탄다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const kamcoPath = require.resolve('../connectors/kamco');
function research(fake) {
  delete require.cache[require.resolve('../agents/03-research')];
  const real = require(kamcoPath);
  require.cache[kamcoPath].exports = Object.assign({}, real, fake);
  const r = require('../agents/03-research');
  require.cache[kamcoPath].exports = real;
  return r;
}
const ROWS = [
  { sido: '경기도', sgg: '성남시 분당구', item: '공동주택', ym: '202503', ratio: 80 },
  { sido: '경기도', sgg: '성남시 분당구', item: '공동주택', ym: '202511', ratio: 70 },
  { sido: '경기도', sgg: '수원시', item: '토지', ym: '202507', ratio: 50 },
  { sido: '경상북도', sgg: '포항시 남구', item: '공동주택', ym: '202510', ratio: 62.53 },
];
const ok = { isAvailable: () => true, auctionRates: async () => ({ ok: true, value: ROWS, summary: { asOf: '20261019' } }) };

test('주소의 시군구 자료로 종류별 표본·중앙값을 낸다 — 값을 채우지 않는다', async () => {
  const r = research(ok);
  const a = await r.auctionRef({ location: '경기도 성남시 분당구 금곡동 1' }, { warn() {} });
  assert.strictEqual(a.status, 'ok');
  assert.strictEqual(a.region, '경기도 성남시 분당구'); assert.strictEqual(a.level, 'sgg');
  assert.deepStrictEqual(a.items, [{ item: '공동주택', n: 2, median: 75, from: '202503', to: '202511' }]);
  assert.ok(/15126398/.test(a.source));
});

test('시군구 자료가 없으면 시도 단위로 내고 그 사실을 적는다 · 시도를 못 정하면 전국으로 대체하지 않는다', async () => {
  const r = research(ok);
  const a = await r.auctionRef({ location: '경기도 용인시 수지구' }, { warn() {} });
  assert.strictEqual(a.level, 'sido'); assert.ok(/시도 단위/.test(a.note));
  const b = await r.auctionRef({ location: '강원특별자치도 원주시 신림면' }, { warn() {} });
  assert.strictEqual(b.status, 'skipped'); assert.ok(/전국 값으로 대체하지 않는다/.test(b.reason));
  const c = await r.auctionRef({ location: null }, { warn() {} });
  assert.strictEqual(c.status, 'skipped');
});

test('열쇠가 없거나 조회가 실패하면 그 상태를 남긴다', async () => {
  let r = research({ isAvailable: () => false });
  assert.strictEqual((await r.auctionRef({ location: '경기도' }, { warn() {} })).status, 'unavailable');
  const warned = [];
  r = research({ isAvailable: () => true, auctionRates: async () => ({ ok: false, error: 'HTTP 500' }) });
  const a = await r.auctionRef({ location: '경기도' }, { warn: m => warned.push(m) });
  assert.strictEqual(a.status, 'failed'); assert.ok(warned.some(m => /공매 낙찰가율/.test(m)));
});

test('IM 시장 분석 절 아래 별도 칸 — 표 · 출처 · «시세가 아니다» · 못 냈으면 까닭 한 줄', () => {
  const w = require('../agents/06-im-writer');
  const t = w.auctionTable({ status: 'ok', region: '경기도 성남시 분당구', items: [{ item: '공동주택', n: 2, median: 75, from: '202503', to: '202511' }], source: '한국자산관리공사 온비드 압류재산 공매 낙찰가율(공공데이터포털 15126398)', asOf: '20261019' });
  assert.ok(t.startsWith('### 공매 낙찰가율 (온비드 · 참고)'));
  assert.ok(t.includes('| 공동주택 | 2건 | 75% | 2025.03 ~ 2025.11 |'));
  assert.ok(/자료출처: 한국자산관리공사/.test(t) && /시세·평가액이 아니다/.test(t));
  assert.ok(/전국 값으로/.test(w.auctionTable({ status: 'skipped', reason: '지역을 정하지 못했다 — 전국 값으로 대체하지 않는다' })));
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '06-im-writer.js'), 'utf8');
  assert.ok(/section\.id === 'market' && research && research\.auction/.test(src), '시장 분석 절에만 붙인다');
});
