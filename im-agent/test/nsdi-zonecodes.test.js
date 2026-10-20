'use strict';
// 지역지구 «코드»를 버리지 않는가 — LUR 행위제한 조회의 ucodeList 를 지어 넣지 않으려면 이 값이 필요하다 (CLAUDE.md §4.3).
// ★ 돌려서 잰다: http·cache 를 가짜로 바꿔 끼우고 landUse() 가 내는 값을 본다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const dir = path.join(__dirname, '..', 'connectors');
function load(body) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(dir)) delete require.cache[k];
  const http = require(path.join(dir, 'http'));
  const cache = require(path.join(dir, 'cache'));
  http.request = async () => ({ ok: true, body: JSON.stringify(body) });
  cache.through = async (_p, _n, _c, fn) => fn();
  return require(path.join(dir, 'nsdi'));
}

test('지역지구 코드와 이름을 짝으로 남긴다', async () => {
  process.env.VWORLD_KEY = 'test-key-only';
  const nsdi = load({ landUses: { field: [
    { prposAreaDstrcCodeNm: '제2종일반주거지역', prposAreaDstrcCode: 'UQA122' },
    { prposAreaDstrcCodeNm: '가축사육제한구역' },
  ] } });
  const r = await nsdi.landUse('5211313000108930000');
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.value.zoneCodes, [
    { name: '제2종일반주거지역', code: 'UQA122' },
    { name: '가축사육제한구역', code: null },
  ], '코드가 없으면 null — 지어 넣지 않는다');
  assert.deepStrictEqual(r.value.allZones, ['제2종일반주거지역', '가축사육제한구역'], '앞 판 값은 그대로다');
});
