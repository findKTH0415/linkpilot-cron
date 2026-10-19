'use strict';
/**
 * country-fetch.test.js — 해외 국가 개황 수집에 «외교부 우리나라와의 관계»가 실리는가 〈2026-10-19 사장님: 「외교부_국가·지역별 우리나라와의 관계 키넣었어」〉
 *
 * ★ 실호출은 여기서 못 잰다(호스트가 막혀 있고 열쇠도 없다) — 진단(api-smoke · 러너)이 판정 0 을 냈다(15099539).
 *   여기서 재는 것은 셋이다: ① 받은 목록에서 고른 나라의 칸이 `countries[iso].korel` 에 실리는가
 *   ② 그 쪽만 못 받은 날 앞 결과의 korel 을 덮지 않는가(§4.6 — 빈 것으로 덮지 않는다) ③ 열쇠 값이 요약에 안 남는가(§2).
 * ★ 스크립트를 그대로 돌린다 — `fetch` 만 가짜로 바꿔 끼운다(--import).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const SRC = path.resolve(__dirname, '..', '..', 'scripts', 'country-fetch.mjs');
const KEY = 'TESTKEY-0123456789-abcdef';

function run(dir, relOk) {
  const stub = path.join(dir, 'stub.mjs');
  fs.writeFileSync(stub, `
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
const items = (a) => ({ response: { header: { resultCode: '00' }, body: { items: { item: a } } } });
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s.includes('OverviewPoliticService')) return J(items([{ country_iso_alp2: 'BD', country_nm: '방글라데시', government_form: '의원내각제' }]));
  if (s.includes('OverviewKorRelationService') && ${relOk === 'partial'}) return s.includes('pageNo=1&') ? J(items([{ country_iso_alp2: 'BD', country_nm: '방글라데시', diplomatic_relations: '쪽1' }, ...Array.from({ length: 99 }, (_, i) => ({ country_iso_alp2: 'X' + i }))])) : new Response('', { status: 200 });
  if (s.includes('OverviewKorRelationService')) return ${relOk ? "J(items([{ country_iso_alp2: 'BD', country_nm: '방글라데시', diplomatic_relations: '1973.12.18. 수교', export_amount: '1,000,000', investment_status: '투자 표본' }, { country_iso_alp2: 'ZZ', country_nm: '고르지 않은 나라' }]))" : "new Response('SERVICE_KEY_IS_NOT_REGISTERED_ERROR', { status: 200 })"};
  if (s.includes('kotra_nationalInformation')) return J(items([{ korCompNm: '표본기업' }]));
  return new Response('?', { status: 404 });
};`);
  return spawnSync(process.execPath, ['--import', stub, SRC], { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { COUNTRIES: 'BD', DATA_GO_KR_KEY: KEY, MOFA_RELATIONS_WITH_KOREA_BY_COUNTRY: KEY }) });
}

test('외교부 우리나라와의 관계 — 고른 나라 칸이 korel 에 실리고, 못 받은 날은 앞 결과를 지키고, 열쇠 값은 안 남는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-ctry-'));
  try {
    const r1 = run(dir, true);
    assert.strictEqual(r1.status, 0, '셋 다 받으면 판정 0 — ' + (r1.stderr || '').slice(-200));
    const j1 = JSON.parse(fs.readFileSync(path.join(dir, 'data/country/latest.json'), 'utf8'));
    assert.strictEqual(j1.countries.BD.korel.diplomatic_relations, '1973.12.18. 수교', '고른 나라의 관계 칸이 실린다');
    assert.ok(!('ZZ' in j1.countries), '고르지 않은 나라는 안 싣는다');
    assert.deepStrictEqual([j1.sources.korel.id, j1.sources.korel.ok, j1.sources.korel.count], ['15099539', true, 2]);
    const r2 = run(dir, false);
    assert.strictEqual(r2.status, 1, '관계만 못 받으면 판정 1(일부)');
    const j2 = JSON.parse(fs.readFileSync(path.join(dir, 'data/country/latest.json'), 'utf8'));
    assert.strictEqual(j2.countries.BD.korel && j2.countries.BD.korel.diplomatic_relations, '1973.12.18. 수교', '못 받은 날 앞 결과의 korel 을 덮지 않는다');
    assert.strictEqual(j2.sources.korel.ok, false);
    const sum = fs.readFileSync(path.join(dir, 'data/country/_summary.md'), 'utf8');
    assert.ok(!sum.includes(KEY) && !(r1.stdout + r2.stdout + r1.stderr + r2.stderr).includes(KEY), '열쇠 값이 요약·로그에 안 남는다');
    assert.ok(/우리나라와의 관계/.test(sum) && /인증 거부/.test(sum), '요약 표에 관계 칸과 못 받은 사유가 있다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('외교부 관계 — 첫 쪽은 왔는데 뒤 쪽이 끊기면 «다 받았다»로 적지 않는다 (Codex #254)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-ctry-'));
  try {
    const r = run(dir, 'partial');
    assert.strictEqual(r.status, 1, '뒤 쪽이 끊기면 판정 1(일부) — ' + (r.stderr || '').slice(-200));
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'data/country/latest.json'), 'utf8'));
    assert.strictEqual(j.sources.korel.ok, false, '덜 받은 날은 ok 가 아니다');
    assert.ok(/2쪽에서 끊김/.test(fs.readFileSync(path.join(dir, 'data/country/_summary.md'), 'utf8')), '요약에 몇 쪽에서 끊겼는지 적는다');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
