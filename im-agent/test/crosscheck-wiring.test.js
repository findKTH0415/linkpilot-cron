'use strict';
/**
 * crosscheck-wiring.test.js — 가이드 필드 → 커넥터 배선 (등록부 D-48).
 *
 * 왜 이 파일이 있는가: 커넥터 다섯을 만들어 놓고 **파이프라인에서 한 번도
 * 부르지 않고 있었다.** 2026-08-16 교차검증에서 나왔다 — 스모크에서만 돌았고,
 * 보고서 생성 경로에는 배선 자체가 없었다. 「붙였다」는 말이 사실이 아니었던 것이다.
 *
 * 그래서 여기서 못 박는 것은 셋이다.
 *
 *   ① **실제로 불리는가** — 가짜 상대를 세워 두고 값이 흘러가는지 본다.
 *      「키가 없어 건너뛴다」 분기만 타면 이 테스트는 아무것도 확인하지 못한다 (M-08).
 *   ② **안 고르면 안 부르는가** — 업종·상호를 짐작해서 부르면 틀린 대상의 값이
 *      그럴듯하게 나온다 (§4.9).
 *   ③ **건너뛴 것이 결과에 남는가** — 조용히 빠지면 「대조했는데 문제 없었다」로 읽힌다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const research = require('../agents/03-research');
const dict = require('../core/dictionary');
const assetclass = require('../core/assetclass');
const http = require('../connectors/http');

/** dataset 흉내 — 가이드 필드 값만 돌려준다 */
function datasetOf(values) {
  return { get: k => (values[k] !== undefined ? { value: values[k] } : null) };
}

function withFake(responder, fn) {
  const real = http.request;
  const calls = [];
  http.request = async (url) => { calls.push(url); return responder(url); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-'));
  const saved = {
    ECOS_API_KEY: process.env.ECOS_API_KEY,
    DATA_GO_KR_KEY: process.env.DATA_GO_KR_KEY,
    KOSIS_API_KEY: process.env.KOSIS_API_KEY,
    KEPCO_BIGDATA_KEY: process.env.KEPCO_BIGDATA_KEY,
    IM_AGENT_CACHE: process.env.IM_AGENT_CACHE,
  };
  process.env.ECOS_API_KEY = 'K'.repeat(20);
  process.env.DATA_GO_KR_KEY = 'D'.repeat(40);
  process.env.KOSIS_API_KEY = 'S'.repeat(40);
  // ★ **data.go.kr 키와 별개다.** 여기서 안 세우면 계통 대조가 unavailable 분기로
  //   빠져, 배선이 끊겨 있어도 테스트가 통과한다 (M-08 과 같은 자리)
  process.env.KEPCO_BIGDATA_KEY = 'P'.repeat(40);
  process.env.IM_AGENT_CACHE = tmp;
  return Promise.resolve(fn(calls)).finally(() => {
    http.request = real;
    Object.keys(saved).forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }
  });
}

const ok = b => ({ ok: true, status: 200, attempts: 1, body: JSON.stringify(b) });
const EMPTY_GOKR = ok({ response: { header: { resultCode: '00' }, body: { items: { item: [] } } } });

function responder(url) {
  if (/StatisticSearch/.test(url)) {
    return ok({ StatisticSearch: { row: [
      { TIME: '202409', DATA_VALUE: '100.0', ITEM_NAME1: '기타 기계 및 장비', UNIT_NAME: '2020=100' },
      { TIME: '202608', DATA_VALUE: '108.0', ITEM_NAME1: '기타 기계 및 장비', UNIT_NAME: '2020=100' },
    ] } });
  }
  if (/statisticsParameterData/.test(url)) {
    return ok([
      { PRD_DE: '202409', DT: '71.0', UNIT_NM: '%', ITM_NM: '제조업 평균가동률', C1_NM: '제조업', TBL_NM: '광업제조업동향조사' },
      { PRD_DE: '202608', DT: '75.0', UNIT_NM: '%', ITM_NM: '제조업 평균가동률', C1_NM: '제조업', TBL_NM: '광업제조업동향조사' },
    ]);
  }
  if (/nitemtrade/.test(url)) {
    return ok({ response: { header: { resultCode: '00' }, body: { items: { item: [
      { year: '2025', month: '03', hsSgn: '847989', statKor: '기타 기계류', expDlr: '1200000', expWgt: '100000', impDlr: '0', impWgt: '0' },
    ] } } } });
  }
  if (/kicoxFactory/.test(url)) {
    return ok({ response: { header: { resultCode: '00' }, body: { items: { item: [
      { factrNo: 'F-1', fctryNm: '한빛정밀', fctryAddr: '경기도 화성시', lndarNm: '12000', manufAr: '3800', regstrDe: '20190312' },
    ] } } } });
  }
  if (/distributionCapacity/.test(url)) {
    return ok({ response: { header: { resultCode: '00' }, body: { items: { item: [
      { subst_nm: '○○변전소', mtr_nm: '#1 M.Tr', dl_nm: 'DL-01', subst_cap: '50', mtr_cap: '40', dl_cap: '30', base_ym: '202608' },
    ] } } } });
  }
  return EMPTY_GOKR;   // 환경 인허가 — 기록 없음
}

const FULL = {
  'crosscheck.ppi_item': '*AA',
  'crosscheck.kosis_table': 'DT_1F31502',
  'crosscheck.kosis_item': 'T20',
  'crosscheck.factory_name': '한빛정밀',
  'crosscheck.hs_code': '847989',
  'crosscheck.sales_channel': '수출',
  'crosscheck.enviro_name': '한빛정밀',
  // 전력계통 (D-54) — 지역만 조회로 나가고 나머지 셋은 사람이 넣는 값이다
  'crosscheck.grid_region': '충청남도 보령시',
  'crosscheck.substation_name': '○○변전소',
  'crosscheck.substation_km': 4.5,
  'crosscheck.substation_km_basis': '선로',
  'crosscheck.grid_reviewed_at': '2026-07-30',
  'capacity.power_mw': 20,
};

/* ═════════ ① 실제로 불린다 ═════════ */

/**
 * ★ **이 테스트가 D-48 의 본체다.** 값을 넣으면 커넥터가 실제로 돌아
 *   결과가 나와야 한다 — 「키가 없어 건너뛴다」 분기만 타면 아무것도 확인 못 한다 (M-08).
 */
test('★ 가이드 필드에 값을 넣으면 커넥터가 실제로 불린다', async () => {
  await withFake(responder, async (calls) => {
    const out = await research.crosschecks({ dataset: datasetOf(FULL), warn: () => {} });
    assert.strictEqual(out.length, research.CROSSCHECKS.length);
    assert.ok(calls.length >= 5, `외부 호출이 ${calls.length}건뿐이다 — 배선이 안 됐다`);
    assert.ok(!out.some(c => c.status === 'skipped'), '값을 다 넣었는데 건너뛰었다');
  });
});

test('★ 시점수정 계수가 값까지 나온다 (지수의 비)', async () => {
  await withFake(responder, async () => {
    const out = await research.crosschecks({ dataset: datasetOf(FULL), warn: () => {} });
    const ppi = out.find(c => c.id === 'ppi');
    assert.strictEqual(ppi.status, 'ok', ppi.reason);
    assert.match(ppi.text, /계수 1\.08/);
    // ★ 계수는 공표 통계라 가정이 아니지만 **적용은 사람이 정한다** (두 번 보정 위험)
    assert.strictEqual(ppi.apply, 'human');
    assert.ok(ppi.source && ppi.source.note, '출처가 안 붙었다');
  });
});

test('★ 가동률은 딜 값이 있으면 견주고, 없으면 업종 평균만 낸다', async () => {
  await withFake(responder, async () => {
    const withDeal = await research.crosschecks({
      dataset: datasetOf({ ...FULL, 'revenue.occupancy': 85 }), warn: () => {},
    });
    assert.match(withDeal.find(c => c.id === 'utilization').text, /85% 는 업종 평균 73%/);

    const noDeal = await research.crosschecks({ dataset: datasetOf(FULL), warn: () => {} });
    const u = noDeal.find(c => c.id === 'utilization');
    assert.match(u.text, /업종 평균 73/);
    assert.ok(!/높다|낮다/.test(u.text), '딜 값이 없는데 견준 척했다');
  });
});

/** ★ 공부끼리 어긋나면 드러낸다 — 어느 쪽이 맞다고 말하지 않는다 */
test('★ 공장등록 용지면적과 대지면적이 어긋나면 그 사실이 나온다', async () => {
  await withFake(responder, async () => {
    const out = await research.crosschecks({
      dataset: datasetOf({ ...FULL, 'land.area_sqm': 10800 }), warn: () => {},
    });
    const f = out.find(c => c.id === 'factory');
    assert.strictEqual(f.status, 'ok', f.reason);
    assert.match(f.text, /제조시설면적 3800㎡/, '생산능력은 제조시설면적으로 논한다');
    assert.match(f.text, /어긋난다/);
    assert.match(f.text, /사람이 확인한다/);
  });
});

/**
 * ★ 환경 인허가가 전부 「기록 없음」으로 와도 **통과가 아니다.**
 *   여기서 ok 가 나오면 딜브레이커 점검이 무력화된다.
 */
test('★ 환경 인허가는 기록이 없으면 통과로 세지 않는다', async () => {
  await withFake(responder, async () => {
    const out = await research.crosschecks({ dataset: datasetOf(FULL), warn: () => {} });
    const e = out.find(c => c.id === 'enviro');
    assert.strictEqual(e.status, 'needs_review', '「모름」이 통과로 셌다');
    assert.match(e.text, /「확인되지 않음」은 「문제 없음」이 아니다/);
    assert.strictEqual(e.items.length, 4, '항목이 사라졌다');
  });
});

/* ═════════ ② 안 고르면 안 부른다 (§4.9) ═════════ */

test('★ 값이 없으면 아예 부르지 않는다', async () => {
  await withFake(responder, async (calls) => {
    const out = await research.crosschecks({ dataset: datasetOf({}), warn: () => {} });
    assert.ok(out.every(c => c.status === 'skipped'), '고르지도 않았는데 불렀다');
    assert.strictEqual(calls.length, 0, '짐작해서 외부를 불렀다 — 틀린 대상의 값이 그럴듯하게 나온다');
  });
});

test('★ 전제 중 하나만 빠져도 부르지 않는다 (통계표만 있고 항목이 없을 때)', async () => {
  await withFake(responder, async (calls) => {
    const out = await research.crosschecks({
      dataset: datasetOf({ 'crosscheck.kosis_table': 'DT_1F31502' }), warn: () => {},
    });
    const u = out.find(c => c.id === 'utilization');
    assert.strictEqual(u.status, 'skipped');
    assert.deepStrictEqual(u.missing, ['crosscheck.kosis_item']);
    assert.strictEqual(calls.length, 0, '항목코드 없이 불렀다 — 지수를 가동률로 읽게 된다');
  });
});

test('빈 문자열은 「없는 것」으로 본다 (공백만 넣고 고른 것으로 세지 않는다)', () => {
  assert.strictEqual(research.pick(datasetOf({ 'crosscheck.hs_code': '   ' }), 'crosscheck.hs_code'), null);
  assert.strictEqual(research.pick(datasetOf({ 'crosscheck.hs_code': '847989' }), 'crosscheck.hs_code'), '847989');
  assert.strictEqual(research.pick(null, 'crosscheck.hs_code'), null);
});

/* ═════════ ③ 건너뛴 것이 남는다 ═════════ */

/**
 * ★ 조용히 빠지면 **「대조했는데 문제 없었다」로 읽힌다.** 안 한 것과 해서
 *   괜찮은 것은 다르다.
 */
test('★ 건너뛴 대조도 결과에 남고, 무엇을 넣어야 하는지 말한다', async () => {
  await withFake(responder, async () => {
    const out = await research.crosschecks({ dataset: datasetOf({}), warn: () => {} });
    out.forEach((c) => {
      assert.strictEqual(c.status, 'skipped');
      assert.ok(c.reason && /고르지 않았다/.test(c.reason), `${c.id}: 왜 안 했는지 없다`);
      assert.ok(c.needs && c.needs.length, `${c.id}: 무엇을 넣어야 하는지 없다`);
    });
  });
});

/**
 * ★ **자산군이 안 정해지는 것이 정상인 경우가 있다.** 「제조」와 「공장」이 함께
 *   읽히면 고르지 않는다(§4.9) — 실제로 제조 딜을 만들면 `assetClass` 가 null 이다.
 *   그때 자산군만 보고 판단하면 **제조 딜인데 안내가 통째로 빠진다.**
 *   재무 템플릿은 그때도 정해져 있으므로 함께 본다.
 */
test('★ 자산군이 안 정해져도 제조 템플릿이면 대조를 묻는 딜로 본다', () => {
  assert.strictEqual(assetclass.asksCrosschecks(null, 'manufacturing'), true,
    '제조 딜인데 안내가 빠진다 — 자산군은 일부러 안 정해질 수 있다');
  assert.strictEqual(assetclass.asksCrosschecks('manufacturing', null), true);
  // 묻지 않는 딜에서 매번 5줄이 뜨면 소음이고, 소음이 쌓이면 진짜 경고도 안 읽힌다
  assert.strictEqual(assetclass.asksCrosschecks(null, 'realestate'), false);
  assert.strictEqual(assetclass.asksCrosschecks(null, null), false);
});

/**
 * ★ **자산군이 안 정해지는 경우가 정상이다** (§4.9). 육상·해상 풍력은 앱에서
 *   섹터가 같고, 태양광도 요청문에 「발전사업」처럼만 적혀 오면 안 잡힌다.
 *   그때도 재무 템플릿은 정해져 있으므로 **템플릿에도 같은 대조를 단다** —
 *   없으면 정작 계통이 가장 중요한 딜에서 안내가 통째로 빠진다 (등록부 D-54).
 *
 * ★ 넷 다 **자산군에도** 같은 목록이 달려 있다. 한 벌(`GRID_CROSSCHECKS`)을
 *   양쪽이 참조하므로 갈리지 않는다 — 그 사실을 아래에서 함께 본다.
 */
test('★ 발전·저장 딜은 자산군이 안 정해져도 템플릿으로 계통 대조를 묻는다', () => {
  ['solar', 'datacenter', 'wind_onshore', 'wind_offshore', 'ess'].forEach((t) => {
    assert.strictEqual(assetclass.asksCrosschecks(null, t), true, `${t}: 계통 안내가 빠진다`);
    assert.ok(assetclass.crosschecksFor(null, t).some(r => r.key === 'crosscheck.grid_region'));
    // 제조 대조(HS 코드 등)가 딸려 오면 안 된다
    assert.ok(!assetclass.crosschecksFor(null, t).some(r => r.key === 'crosscheck.hs_code'), `${t}: 제조 대조가 딸려 왔다`);
  });
});

test('★ 자산군과 템플릿이 **같은 한 벌**을 본다 (두 벌이면 갈린다)', () => {
  [['solar', 'solar'], ['wind_onshore', 'wind_onshore'],
    ['wind_offshore', 'wind_offshore'], ['ess', 'ess'], ['datacenter', 'datacenter']]
    .forEach(([cls, t]) => {
      assert.deepStrictEqual(
        assetclass.crosscheckKeys(cls).slice().sort(),
        assetclass.templateCrosscheckKeys(t).slice().sort(),
        `${cls}: 자산군과 템플릿의 대조 목록이 다르다`,
      );
    });
});

test('상관없는 템플릿은 계통 대조를 묻지 않는다', () => {
  // 소음이 쌓이면 진짜 경고도 안 읽힌다
  assert.strictEqual(assetclass.asksCrosschecks(null, 'realestate'), false);
  assert.strictEqual(assetclass.asksCrosschecks(null, 'generic'), false);
  // 존재하지 않는 템플릿 id 에 걸리지 않는다
  assert.strictEqual(assetclass.asksCrosschecks(null, 'wind'), false);
});

/* ═════════ 전력계통 (D-54) ═════════ */

test('★ 계통 여유가 실제로 조회되고 수전용량과 견준다', async () => {
  await withFake(responder, async (calls) => {
    const out = await research.crosschecks({ dataset: datasetOf(FULL), warn: () => {} });
    const g = out.find(c => c.id === 'grid');
    assert.strictEqual(g.status, 'ok', g.reason);
    assert.match(g.text, /요구 20MW/);
    // ★ 「접속 가능」으로 읽히면 안 된다 — 대기열은 이 자료에 없다
    assert.match(g.text, /접속 가능을 뜻하지 않는다/);
    assert.strictEqual(g.apply, 'human');
    assert.ok(calls.some(u => /distributionCapacity/.test(u)), '계통 조회가 안 나갔다');
  });
});

test('★ 여유가 모자라면 **실패가 아니라 needs_review** 다', async () => {
  await withFake(responder, async () => {
    const out = await research.crosschecks({
      // 요구 100MW — 조회된 선로의 최소 여유는 30MW 다
      dataset: datasetOf({ ...FULL, 'capacity.power_mw': 100 }), warn: () => {},
    });
    const g = out.find(c => c.id === 'grid');
    // ★ failed 로 두면 딜브레이커가 **통신 오류처럼** 보인다
    assert.strictEqual(g.status, 'needs_review');
    assert.match(g.reason, /모자라다/);
  });
});

test('★ 거리 기준을 안 밝히면 그 대조가 needs_review 로 남는다', async () => {
  await withFake(responder, async () => {
    const v = { ...FULL };
    delete v['crosscheck.substation_km_basis'];
    const out = await research.crosschecks({ dataset: datasetOf(v), warn: () => {} });
    const s = out.find(c => c.id === 'substation');
    // 기준 필드가 `needs` 에 있으므로 애초에 건너뛴다 — 어느 쪽이든 ok 가 아니어야 한다
    assert.notStrictEqual(s.status, 'ok');
  });
});

test('★ 지역만 넣고 거리를 안 넣어도 **여유용량 조회는 나간다**', async () => {
  await withFake(responder, async (calls) => {
    const out = await research.crosschecks({
      dataset: datasetOf({ 'crosscheck.grid_region': '충청남도 보령시', 'capacity.power_mw': 20 }),
      warn: () => {},
    });
    assert.strictEqual(out.find(c => c.id === 'grid').status, 'ok');
    // 거리는 못 넣었다는 사실이 그대로 남는다
    assert.strictEqual(out.find(c => c.id === 'substation').status, 'skipped');
    assert.ok(calls.some(u => /distributionCapacity/.test(u)),
      '거리를 못 넣었다고 여유용량 조회까지 건너뛰면 안 된다');
  });
});

test('★ 사람이 넣은 거리는 **사람이 넣었다고 표시된다**', async () => {
  await withFake(responder, async () => {
    const out = await research.crosschecks({ dataset: datasetOf(FULL), warn: () => {} });
    const s = out.find(c => c.id === 'substation');
    assert.strictEqual(s.status, 'ok', s.reason);
    assert.strictEqual(s.byHuman, true);
    assert.match(s.source.note, /사람이 회신받아 입력했다/);
    assert.match(s.note, /가정/);   // 인입 공사비를 안 낸다는 사실 (§4.8)
  });
});

test('★ 파이프라인이 건너뛴 건수를 로그에 낸다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  assert.match(src, /미선택 \$\{skipped\.length\}건/, '건너뛴 건수를 안 세면 다 한 것처럼 보인다');
  assert.match(src, /crosschecks\.json/, '대조 결과를 파일로 남겨야 한다');
});

/* ═════════ 대조는 fact 가 아니다 ═════════ */

/**
 * ★ **Dataset 에 넣으면 대조값이 딜의 값으로 IM 에 실린다.**
 *   업종 평균 가동률 73% 가 「이 공장의 가동률」이 되는 순간이다.
 */
test('★ 대조 결과를 Dataset 에 넣지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  // ★ 이유를 적은 주석이 **선언 위**에 있다 — 블록을 선언부터 자르면 그 주석을
  //   놓치고, 「적혀 있는데 없다」고 잘못 실패한다 (실제로 그렇게 짰다)
  const block = src.match(/\/\/ ★ 대조는[\s\S]*?\n  \}/)[0];
  assert.ok(!/dataset\.addMany|dataset\.add\(/.test(block),
    '대조값을 Dataset 에 넣고 있다 — 업종 평균이 딜의 값으로 실린다');
  assert.match(block, /facts 가 아니다/, '왜 안 넣는지 코드에 적어야 한다');
});

test('★ 대조 항목이 facts 로 새지 않는다', async () => {
  await withFake(responder, async () => {
    const out = await research.crosschecks({ dataset: datasetOf(FULL), warn: () => {} });
    out.forEach((c) => {
      assert.ok(!('key' in c), `${c.id}: fact 모양(key)을 하고 있다`);
      assert.ok(!('value' in c), `${c.id}: fact 모양(value)을 하고 있다`);
    });
  });
});

/* ═════════ 가이드 필드가 화면에 실제로 뜨는가 ═════════ */

test('★ 대조 선택값이 사전에 있다 (없으면 입력란이 안 생긴다)', () => {
  assetclass.crosscheckKeys('manufacturing').forEach((k) => {
    assert.ok(dict.FIELDS[k], `${k} 가 사전에 없다 — 화면에 입력란이 안 생긴다`);
    assert.strictEqual(dict.FIELDS[k].category, 'Crosscheck');
    assert.deepStrictEqual(dict.FIELDS[k].requiredFor || [], [],
      '대조값을 필수로 두면 진행률이 안 차서 사람이 모르는 값을 지어내 채운다');
    assert.deepStrictEqual(dict.FIELDS[k].aliases, [],
      '별칭이 있으면 「자료 추출」로 분류돼 안 물어본다');
  });
});

test('★ 에이전트가 쓰는 키와 자산군·템플릿이 내놓는 키가 같다', () => {
  const used = research.CROSSCHECKS.reduce((a, c) => a.concat(c.needs), []);
  // ★ 자산군만 보면 안 된다 — 계통 대조는 **템플릿에도 붙는다**(태양광).
  //   한쪽만 세면 「에이전트는 쓰는데 화면에서 안 묻는」 키가 생긴다
  const offered = new Set();
  assetclass.CLASSES.forEach(c => assetclass.crosscheckKeys(c.id).forEach(k => offered.add(k)));
  Object.keys(assetclass.TEMPLATE_CROSSCHECKS)
    .forEach(t => assetclass.templateCrosscheckKeys(t).forEach(k => offered.add(k)));
  used.forEach(k => assert.ok(offered.has(k),
    `${k} 를 에이전트가 쓰는데 화면에서 안 묻는다 — 영원히 건너뛴다`));
});

test('★ 계통 대조 선택값도 사전에 있다 (없으면 입력란이 안 생긴다)', () => {
  assetclass.templateCrosscheckKeys('solar').forEach((k) => {
    assert.ok(dict.FIELDS[k], `${k} 가 사전에 없다 — 화면에 입력란이 안 생긴다`);
    assert.strictEqual(dict.FIELDS[k].category, 'Crosscheck');
    assert.deepStrictEqual(dict.FIELDS[k].requiredFor || [], [],
      '대조값을 필수로 두면 진행률이 안 차서 사람이 모르는 값을 지어내 채운다');
    assert.deepStrictEqual(dict.FIELDS[k].aliases, [],
      '별칭이 있으면 「자료 추출」로 분류돼 안 물어본다');
    assert.ok((assetclass.whyOf('datacenter', k, 'solar') || '').length > 10,
      `${k}: 이유 없이 늘어난 입력란은 대충 채워진다`);
  });
});

test('★ 대조값이 필수에 섞이지 않는다 (진행률을 막지 않는다)', () => {
  const req = assetclass.requiredKeys('manufacturing');
  assetclass.crosscheckKeys('manufacturing').forEach(k => assert.ok(req.indexOf(k) === -1,
    `${k} 가 필수에 들어갔다 — 안 넣으면 보고서가 막힌다`));
});

test('대조값마다 왜 묻는지가 붙어 있다', () => {
  assetclass.crosscheckKeys('manufacturing').forEach((k) => {
    const why = assetclass.whyOf('manufacturing', k);
    assert.ok(why && why.length > 10, `${k}: 이유 없이 늘어난 입력란은 대충 채워진다`);
  });
});

test('상관없는 자산군에는 대조값을 묻지 않는다', () => {
  ['hotel', 'apartment', 'office', 'logistics'].forEach((id) => {
    assert.deepStrictEqual(assetclass.crosscheckKeys(id), [],
      `${id}: 쓰지도 않을 입력란이 생긴다`);
  });
});

test('데이터센터는 **계통만** 묻는다 — 제조 대조가 딸려 오지 않는다', () => {
  const keys = assetclass.crosscheckKeys('datacenter');
  assert.ok(keys.includes('crosscheck.grid_region'));
  assert.ok(!keys.includes('crosscheck.hs_code'), '데이터센터에 HS 코드를 물으면 안 된다');
  assert.ok(!keys.includes('crosscheck.kosis_table'));
});

/* ═════════ 실패 격리 ═════════ */

test('★ 한 대조가 죽어도 나머지가 돈다', async () => {
  await withFake((url) => {
    if (/StatisticSearch/.test(url)) return { ok: false, status: 500, error: 'HTTP 500', attempts: 3 };
    return responder(url);
  }, async () => {
    const out = await research.crosschecks({ dataset: datasetOf(FULL), warn: () => {} });
    assert.strictEqual(out.find(c => c.id === 'ppi').status, 'failed');
    assert.strictEqual(out.find(c => c.id === 'unitprice').status, 'ok', '하나가 죽어서 나머지가 멈췄다');
  });
});

test('★ 실패는 경고로도 남는다 (조용히 사라지지 않는다)', async () => {
  const warned = [];
  await withFake((url) => {
    if (/StatisticSearch/.test(url)) return { ok: false, status: 500, error: 'HTTP 500', attempts: 3 };
    return responder(url);
  }, async () => {
    await research.crosschecks({ dataset: datasetOf(FULL), warn: m => warned.push(m) });
  });
  assert.ok(warned.some(m => /단가 시점수정/.test(m)), '실패가 경고에 안 남았다');
});

test('★ 키가 없으면 unavailable 로 남는다 (「문제 없음」이 아니다)', async () => {
  const saved = process.env.ECOS_API_KEY;
  delete process.env.ECOS_API_KEY;
  try {
    const out = await research.crosschecks({
      dataset: datasetOf({ 'crosscheck.ppi_item': '*AA' }), warn: () => {},
    });
    const ppi = out.find(c => c.id === 'ppi');
    assert.strictEqual(ppi.status, 'unavailable');
    assert.match(ppi.reason, /ECOS_API_KEY/);
  } finally {
    if (saved === undefined) delete process.env.ECOS_API_KEY; else process.env.ECOS_API_KEY = saved;
  }
});
