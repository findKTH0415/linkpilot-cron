'use strict';
/**
 * customs.test.js — 관세청 수출입무역통계 Connector (단가 실거래 대조).
 *
 * 이 커넥터는 **단가를 만든다.** 그래서 검사가 다른 커넥터와 성격이 다르다 —
 * 「안 만든다」를 못 박는 것이 아니라 **「어디까지 만들어도 되는가」의 경계**를
 * 못 박는다.
 *
 *   허용   금액 ÷ 중량 — 둘 다 공표 값이고 가정계수가 없다 (g2b 의 낙찰률과 같은 자리)
 *   금지   원화 환산 — 어느 시점 환율을 쓸지가 가정이다 (D-25 와 같은 자리)
 *   금지   내수 딜과 견주기 — 수출단가는 FOB 기준이라 기준 자체가 다르다
 *   금지   개당 단가로 환산 — 개당 무게가 가정이다
 *
 * 그리고 이 셋은 전부 **막지 않으면 숫자가 그냥 나온다.** 그게 위험한 이유다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const customs = require('../connectors/customs');
const http = require('../connectors/http');

function withEnv(env, fn) {
  const saved = {};
  Object.keys(env).forEach((k) => { saved[k] = process.env[k]; });
  Object.keys(env).forEach((k) => {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  });
  const done = () => Object.keys(saved).forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
  const r = fn();
  return (r && typeof r.then === 'function') ? r.finally(done) : (done(), r);
}

function withFakeResponse(body, fn) {
  const real = http.request;
  const calls = [];
  http.request = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, body: typeof body === 'string' ? body : JSON.stringify(body), attempts: 1 };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'customs-cache-'));
  return withEnv({ DATA_GO_KR_KEY: 'D'.repeat(40), IM_AGENT_CACHE: tmp }, () => fn(calls))
    .finally(() => {
      http.request = real;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }
    });
}

function payload(items) {
  return {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' },
      body: { totalCount: items.length, items: { item: items } },
    },
  };
}

/** 무역통계 한 달 */
function mo(year, month, expDlr, expWgt, over) {
  return Object.assign({
    year: String(year), month: String(month).padStart(2, '0'),
    hsSgn: '847989', statKor: '기타 기계류',
    expDlr: String(expDlr), expWgt: String(expWgt),
    impDlr: '0', impWgt: '0',
  }, over || {});
}

/* ═════════ ① 나눗셈이 허용되는 경계 ═════════ */

/**
 * ★ **합계의 비로 낸다. 월별 단가의 평균이 아니다.**
 *   평균을 내면 물량 100kg 인 달이 물량 10,000kg 인 달과 같은 무게로 들어가
 *   실제 거래 단가에서 벗어난다 — 값은 그럴듯하게 나온다.
 */
test('★ 단가는 합계의 비다 (월별 단가의 평균이 아니다)', async () => {
  await withFakeResponse(payload([
    mo(2025, 1, 1000, 100),      // 이 달만 보면 10 USD/kg
    mo(2025, 2, 10000, 9900),    // 이 달만 보면 약 1.01 USD/kg
  ]), async () => {
    const r = await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202502' });
    assert.strictEqual(r.ok, true, r.error);
    // 합계: 11000 USD / 10000 kg = 1.1
    assert.strictEqual(r.value.usdPerKg, 1.1);
    // 월별 평균이면 (10 + 1.0101)/2 ≈ 5.5 — 다섯 배 차이다
    assert.ok(Math.abs(r.value.usdPerKg - 5.5) > 4, '월별 평균으로 내고 있다');
    assert.match(r.value.source.note, /월별 단가의 평균이 아니라 합계의 비/);
  });
});

/** ★ 단위를 값에 붙여 둔다 — 떼면 「단가 1.1」이 되고 무엇당인지 사라진다 */
test('★ 단가에 단위가 붙어 있다', async () => {
  await withFakeResponse(payload([mo(2025, 1, 1000, 100)]), async () => {
    const r = await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202501' });
    assert.strictEqual(r.value.unit, 'USD/kg');
  });
});

/**
 * ★ **원화로 바꾸지 않는다** (§4.8). 기간 평균 단가를 어느 날 환율로 바꾸는가가
 *   가정이다 — 태양광에서 일사량까지만 내고 발전량을 안 낸 것과 같은 자리다.
 */
test('★ 원화로 환산하지 않는다', async () => {
  await withFakeResponse(payload([mo(2025, 1, 1000, 100)]), async () => {
    const r = await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202501' });
    const keys = Object.keys(r.value).join(' ');
    assert.ok(!/krw|won|원화|wonPer/i.test(keys), '원화 필드가 생겼다 — 환율 시점이 가정이 된다');
    assert.match(r.value.source.note, /원화 환산은 하지 않는다/);
  });

  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'customs.js'), 'utf8');
  assert.ok(!/exchangeRate|환율로 나눈|\* *fxRate/.test(src), '환율을 곱하거나 나누고 있다');
});

/**
 * ★ **중량이 0 이면 만들지 않는다.** 0 으로 나누면 Infinity 가 나오는데
 *   화면에서는 그냥 아주 큰 수로 보인다 — 아무도 못 알아본다.
 */
test('★ 중량이 없거나 0 이면 단가를 만들지 않는다', async () => {
  await withFakeResponse(payload([mo(2025, 1, 1000, 0), mo(2025, 2, 2000, 0)]), async () => {
    const r = await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202502' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.noWeight, true);
    assert.match(r.error, /무게로 팔지 않는 품목/, '왜 그런지 말해야 다음 판단을 한다');
    assert.ok(!/Infinity/.test(JSON.stringify(r)), '무한대가 새어 나갔다');
  });
});

/**
 * ★ 금액만 있고 중량이 없는 달을 **0 으로 채우면 합계가 조용히 어긋난다** —
 *   단가가 그만큼 높아지고, 출처 표시는 멀쩡하다.
 */
test('★ 한쪽만 있는 달은 세지 않고, 몇 개를 뺐는지 남긴다', async () => {
  await withFakeResponse(payload([
    mo(2025, 1, 1000, 100),
    mo(2025, 2, 5000, ''),        // 중량 없음 — 세면 단가가 6배로 뛴다
    mo(2025, 3, 1000, 100),
  ]), async () => {
    const r = await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202503' });
    assert.strictEqual(r.value.usdPerKg, 10, '2000USD / 200kg = 10');
    assert.strictEqual(r.value.months, 2);
    assert.strictEqual(r.value.skippedMonths, 1);
    assert.match(r.value.source.note, /1개월 제외/, '뺀 사실을 안 적으면 모수를 잘못 읽는다');
  });
});

/* ═════════ ② 견줄 수 있는 것과 없는 것 ═════════ */

/**
 * ★ **내수 딜을 수출단가로 견주면 숫자는 나온다.** 그래서 거부해야 한다.
 */
test('★ 내수 딜은 수출단가와 견주지 않는다', async () => {
  await withFakeResponse(payload([mo(2025, 1, 1000, 100)]), async () => {
    const bm = (await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202501' })).value;
    const c = customs.compare({ price: 8, unit: 'USD/kg', channel: 'domestic' }, bm);
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.channelMismatch, true);
    assert.match(c.error, /FOB/, '왜 기준이 다른지 말해야 한다');
  });
});

test('★ 판로를 안 밝히면 견주지 않는다 (기본값을 두지 않는다)', async () => {
  await withFakeResponse(payload([mo(2025, 1, 1000, 100)]), async () => {
    const bm = (await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202501' })).value;
    const c = customs.compare({ price: 8, unit: 'USD/kg' }, bm);
    assert.strictEqual(c.ok, false);
    assert.match(c.error, /판로를 밝혀야 한다/);
  });
});

/** ★ 톤은 순수 환산이라 해 준다. **개당은 개당 무게가 가정이라 못 한다** */
test('★ 톤은 환산하고 개당은 거부한다', async () => {
  await withFakeResponse(payload([mo(2025, 1, 1000, 100)]), async () => {
    const bm = (await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202501' })).value;
    assert.strictEqual(bm.usdPerKg, 10);

    const t = customs.compare({ price: 12000, unit: 'USD/ton', channel: 'export' }, bm);
    assert.strictEqual(t.ok, true, t.error);
    assert.strictEqual(t.value.dealUsdPerKg, 12, '12000 USD/ton = 12 USD/kg');
    assert.strictEqual(t.value.gapPercent, 20);

    const each = customs.compare({ price: 30, unit: 'USD/개', channel: 'export' }, bm);
    assert.strictEqual(each.ok, false);
    assert.strictEqual(each.unitMismatch, true);
    assert.match(each.error, /개당 무게가 가정/);
  });
});

test('견주기는 「높다/낮다」까지만 말한다', async () => {
  await withFakeResponse(payload([mo(2025, 1, 1000, 100)]), async () => {
    const bm = (await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202501' })).value;
    const c = customs.compare({ price: 8, unit: 'USD/kg', channel: 'export' }, bm);
    assert.strictEqual(c.value.gapPercent, -20);
    assert.strictEqual(c.value.direction, 'below');
    assert.match(c.value.text, /20% 낮다/);
    assert.match(c.value.text, /1개월 합계 기준/, '모수를 문장에 넣어야 읽는 사람이 무게를 안다');
    assert.ok(!/좋|나쁘|경쟁력|우수/.test(c.value.text), '평가어를 넣으면 화면이 판정을 다시 하게 된다');
  });
});

/* ═════════ ③ HS 코드를 자동으로 고르지 않는다 (§4.9) ═════════ */

test('★ HS 코드가 없으면 거부하고 네트워크를 안 탄다', async () => {
  await withFakeResponse(payload([]), async (calls) => {
    const r = await customs.trade({ from: '202501', to: '202512' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /자동으로 추정하지 않는다/);
    assert.match(r.error, /틀린 품목의 단가는 그럴듯하게 나오고/);
    assert.strictEqual(calls.length, 0);
  });
});

test('HS 코드는 4·6·10단위만 받는다 (그 밖은 짐작하지 않는다)', () => {
  assert.strictEqual(customs.hs('8479'), '8479');
  assert.strictEqual(customs.hs('8479.89'), '847989');
  assert.strictEqual(customs.hs('8479890000'), '8479890000');
  assert.strictEqual(customs.hs('84798'), '', '5단위는 없는 체계다');
  assert.strictEqual(customs.hs(''), '');
});

test('★ 실적 없음을 「코드가 틀렸다」와 뭉치지 않는다', async () => {
  await withFakeResponse(payload([]), async () => {
    const r = await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202503' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.noData, true);
    assert.match(r.error, /거래가 없다는 뜻일 수도, 코드가 틀렸다는 뜻일 수도/);
  });
});

/* ═════════ ④ 응답 해석 ═════════ */

test('★ 응답 순서가 뒤섞여 있어도 시점으로 정렬한다 (§4.4)', () => {
  const p = customs.parseTrade(JSON.stringify(payload([
    mo(2025, 6, 100, 10), mo(2025, 1, 100, 10), mo(2025, 3, 100, 10),
  ])));
  assert.strictEqual(p.ok, true, p.error);
  assert.deepStrictEqual(p.rows.map(x => x.period), ['202501', '202503', '202506']);
});

test('★ 오류가 200 으로 와도 성공으로 세지 않는다', () => {
  const p = customs.parseTrade(JSON.stringify({
    response: {
      header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' },
      body: { items: {} },
    },
  }));
  assert.strictEqual(p.ok, false);
  assert.match(p.error, /수출입무역통계/);
});

test('수입 방향도 같은 규칙으로 낸다', async () => {
  await withFakeResponse(payload([
    mo(2025, 1, 0, 0, { impDlr: '5000', impWgt: '1000' }),
  ]), async () => {
    const r = await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202501', direction: 'import' });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.value.usdPerKg, 5);
    assert.strictEqual(r.value.directionLabel, '수입');
  });
});

test('모르는 방향은 조용히 수출로 넘어가지 않는다', async () => {
  const r = await customs.unitPrice({ hsCode: '847989', from: '202501', to: '202501', direction: '반출' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /수출·수입 중 하나/);
});

/* ═════════ ⑤ 성격 · 구조 · 시크릿 ═════════ */

/**
 * ★ **HS 코드 안에 등급·사양이 다른 제품이 섞인다.** 그래서 이 단가는
 *   딜의 단가가 아니라 대조값이다 — fact 로 등록하면 딜 값으로 실린다.
 */
test('★ fact 를 만들지 않는다 (대조값이 딜 단가로 둔갑하지 않는다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'customs.js'), 'utf8');
  assert.ok(!/facts?\.push|addMany|new Dataset/.test(src));
  assert.match(src, /딜의 단가가 아니다|대조용이지 채우는 값이 아니다/);
});

test('★ data.go.kr 쿼터 버킷을 공유한다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'customs.js'), 'utf8');
  const m = src.match(/^const PROVIDER = '([^']+)'/m);
  assert.strictEqual(m && m[1], 'data.go.kr', '한도는 API 별이 아니라 인증키 전체에 걸린다');
});

test('★ 기존 커넥터 구조를 그대로 쓴다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'customs.js'), 'utf8');
  assert.match(src, /require\('\.\/cache'\)/);
  assert.match(src, /require\('\.\/http'\)/);
  assert.match(src, /require\('\.\/xml'\)/);
  assert.match(src, /cache\.through\(/);
  assert.ok(!/\bfetch\(/.test(src));
});

test('★ 캐시를 통과하고 품목이 다르면 섞이지 않는다', async () => {
  await withFakeResponse(payload([mo(2025, 1, 1000, 100)]), async (calls) => {
    await customs.trade({ hsCode: '847989', from: '202501', to: '202501' });
    await customs.trade({ hsCode: '847989', from: '202501', to: '202501' });
    assert.strictEqual(calls.length, 1, '같은 조회를 두 번 부르면 안 된다');
    await customs.trade({ hsCode: '730890', from: '202501', to: '202501' });
    assert.strictEqual(calls.length, 2, '품목이 캐시 키에 없으면 다른 품목 값이 나온다');
  });
});

test('★ Encoding 키를 넣으면 부르기 전에 말해 준다', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'customs-cache-'));
  await withEnv({ DATA_GO_KR_KEY: 'abc%2Fdef%3D'.repeat(4), IM_AGENT_CACHE: tmp }, async () => {
    const r = await customs.trade({ hsCode: '847989', from: '202501', to: '202501' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Decoding\(일반\)/);
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }
});

test('키가 없으면 지어내지 않고 비운다', async () => {
  await withEnv({ DATA_GO_KR_KEY: undefined }, async () => {
    const r = await customs.trade({ hsCode: '847989', from: '202501', to: '202501' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.unavailable, true);
  });
});

/* ═════════ ⑥ 스모크 · 등록부 ═════════ */

test('★ 스모크가 이 커넥터를 확인한다', () => {
  const smoke = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  assert.match(smoke, /수출입 단가|수출입무역통계/);
  assert.match(smoke, /--hs/, 'HS 코드를 주는 길을 알려 줘야 한다');
  assert.match(smoke, /단월인지|누적/, '스모크가 누적 여부를 확인하게 해야 한다');
});

/**
 * ★ **누적 여부가 이 커넥터의 가장 조용한 위험이다.** 월별 값이 연초 누적이면
 *   합계가 크게 부풀지만 **단가는 거의 맞게 나온다**(분자·분모가 같이 부푼다) —
 *   그래서 눈으로는 안 잡히고 물량만 틀린다.
 */
test('★ 미검증이라는 사실이 코드와 등록부에 남아 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'customs.js'), 'utf8');
  assert.match(src, /D-46/);
  assert.match(src, /단월인지 연초 누적인지/, '누적 함정을 코드에 적어야 한다');

  const reg = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', '미결정-사항.md'), 'utf8');
  assert.match(reg, /D-46\./);
  assert.match(reg, /누적/, '누적 여부 확인이 등록부에 있어야 한다');
});
