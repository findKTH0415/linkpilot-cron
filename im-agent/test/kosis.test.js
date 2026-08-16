'use strict';
/**
 * kosis.test.js — 통계청 KOSIS Connector (제조 딜의 가동률 대조).
 *
 * 이 파일에서 가장 중요한 검사는 **「지수」와 「%」를 섞지 않는가** 다.
 *
 * 광업제조업동향조사는 **가동률지수(2020=100)** 와 **제조업 평균가동률(%)** 을
 * 둘 다 낸다. 이름이 비슷하고 숫자도 같은 자리(70~110)에 있어서, 지수 102.3 을
 * 가동률로 읽으면 「가동률 102%」가 된다 — **물리적으로 불가능한데 표에서는
 * 그럴듯하다.** 뺄셈도 태연히 성립해서 「업종 대비 +17%p」라는 문장까지
 * 그대로 나오고, 그게 지수와 %의 차라는 사실은 어디에도 안 남는다.
 *
 * 두 번째는 **평균에 모수가 붙는가**다. 「업종 평균 73%」가 한 달치인지 3년치인지
 * 모르면 그 숫자로 아무것도 판단할 수 없다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const kosis = require('../connectors/kosis');
const cache = require('../connectors/cache');
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

/**
 * 응답을 갈아끼워 **해석 경로 전체**를 지나가게 한다 (M-08 의 교훈).
 *
 * ★ `body` 는 **응답 본문 하나**다. KOSIS 응답은 그 자체가 배열이라, 배열을
 *   「호출마다 하나씩」으로 해석하면 행 하나짜리 응답이 되어 버린다 —
 *   실제로 그렇게 짰다가 여섯 건이 깨졌다.
 */
function withFakeResponse(body, fn) {
  const real = http.request;
  const calls = [];
  http.request = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, body: typeof body === 'string' ? body : JSON.stringify(body), attempts: 1 };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosis-cache-'));
  return withEnv({ KOSIS_API_KEY: 'K'.repeat(40), IM_AGENT_CACHE: tmp }, () => fn(calls))
    .finally(() => {
      http.request = real;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }
    });
}

/** KOSIS 자료 한 행 */
function row(prd, dt, unit, item) {
  return {
    PRD_DE: prd, DT: String(dt), UNIT_NM: unit,
    ITM_NM: item || '제조업 평균가동률', C1_NM: '제조업', TBL_NM: '광업제조업동향조사',
  };
}

/* ═════════ ① 지수와 %를 섞지 않는다 ═════════ */

test('★ 단위 문자열에서 성격을 가른다', () => {
  assert.strictEqual(kosis.unitKind('%'), 'percent');
  assert.strictEqual(kosis.unitKind('2020=100'), 'index');
  assert.strictEqual(kosis.unitKind('2015=100'), 'index');
  assert.strictEqual(kosis.unitKind('지수'), 'index');
  // ★ 모르면 **모른다고 한다.** 짐작해서 percent 로 두면 그 순간 섞인다
  assert.strictEqual(kosis.unitKind('백만원'), 'unknown');
  assert.strictEqual(kosis.unitKind(''), 'unknown');
  assert.strictEqual(kosis.unitKind(null), 'unknown');
});

/**
 * ★ **이 파일에서 가장 중요한 검사다.**
 *   지수를 가동률과 견주면 숫자는 나온다 — 85 - 102.3 = -17.3. 그럴듯하다.
 *   그래서 거부해야 한다.
 */
test('★ 지수를 가동률(%)과 견주지 않는다 — 뺄셈은 태연히 성립한다', async () => {
  await withFakeResponse([
    row('202401', 100.0, '2020=100', '제조업 가동률지수'),
    row('202506', 102.3, '2020=100', '제조업 가동률지수'),
  ], async () => {
    const bm = await kosis.benchmark({ tblId: 'DT_X', itmId: 'T1', from: '202401', to: '202506' });
    assert.strictEqual(bm.value.kind, 'index');

    const c = kosis.compare(85, bm.value);
    assert.strictEqual(c.ok, false, '지수와 %를 견주면 「가동률 102%」가 그럴듯하게 나온다');
    assert.strictEqual(c.unitMismatch, true);
    assert.match(c.error, /2020=100/, '어떤 단위였는지 말해야 고칠 수 있다');
    assert.match(c.error, /평균가동률\(%\) 항목을 골라야/, '어떻게 고치는지도 말해야 한다');
  });
});

test('★ 단위를 모르면 견주지 않는다 (짐작해서 %로 두지 않는다)', async () => {
  await withFakeResponse([row('202401', 71.0, '', '가동률'), row('202506', 73.0, '', '가동률')], async () => {
    const bm = await kosis.benchmark({ tblId: 'DT_X', itmId: 'T1', from: '202401', to: '202506' });
    assert.strictEqual(bm.value.kind, 'unknown');
    assert.strictEqual(kosis.compare(85, bm.value).ok, false);
  });
});

test('% 끼리는 견준다 — 「높다/낮다」까지만 말한다', async () => {
  await withFakeResponse([row('202401', 71.0, '%'), row('202506', 75.0, '%')], async () => {
    const bm = await kosis.benchmark({ tblId: 'DT_X', itmId: 'T1', from: '202401', to: '202506' });
    const c = kosis.compare(85, bm.value);
    assert.strictEqual(c.ok, true, c.error);
    assert.strictEqual(c.value.industryMean, 73);
    assert.strictEqual(c.value.gap, 12);
    assert.strictEqual(c.value.direction, 'above');
    assert.match(c.value.text, /85% 는 업종 평균 73%/);
    assert.match(c.value.text, /12%p 높다/);
    // ★ 좋다/나쁘다는 이 커넥터가 판정할 것이 아니다 — 딜마다 사정이 다르다
    assert.ok(!/좋|나쁘|우수|미달/.test(c.value.text), '평가어를 넣으면 화면이 판정을 다시 하게 된다');
  });
});

/**
 * ★ 항목 목록에서 **고르는 순간** 단위를 알 수 있어야 한다. 고른 뒤에 알면
 *   이미 지수로 한 바퀴 돈 뒤다.
 */
test('★ 항목 목록이 단위 성격을 함께 준다', async () => {
  await withFakeResponse([
    { ITM_ID: 'T1', ITM_NM: '가동률지수', UNIT_NM: '2020=100' },
    { ITM_ID: 'T2', ITM_NM: '평균가동률', UNIT_NM: '%' },
  ], async () => {
    const m = await kosis.meta({ tblId: 'DT_X', type: 'ITM' });
    assert.strictEqual(m.ok, true, m.error);
    assert.deepStrictEqual(m.value.map(x => x.kind), ['index', 'percent']);
  });
});

/* ═════════ ② 표·항목을 자동으로 고르지 않는다 (§4.9) ═════════ */

test('★ 표·항목을 지정하지 않으면 거부하고, 네트워크를 아예 안 탄다', async () => {
  await withFakeResponse([], async (calls) => {
    const a = await kosis.series({ from: '202401', to: '202506' });
    assert.strictEqual(a.ok, false);
    assert.match(a.error, /자동으로 고르지 않는다/);
    assert.match(a.error, /가동률 102%/, '왜 위험한지 그 자리에서 말해야 한다');

    const b = await kosis.series({ tblId: 'DT_X', from: '202401', to: '202506' });
    assert.strictEqual(b.ok, false, '항목코드만 빠져도 거부해야 한다');

    assert.strictEqual(calls.length, 0, '거부할 요청으로 쿼터를 쓰면 안 된다');
  });
});

test('검색어 없이 표를 훑지 않는다', async () => {
  await withFakeResponse([], async (calls) => {
    const r = await kosis.tables('');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /검색어가 필요하다/);
    assert.strictEqual(calls.length, 0);
  });
});

test('후보 통계표는 「참고」로만 두고 조회에 쓰지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'kosis.js'), 'utf8');
  // ★ 후보 상수가 실제 조회 파라미터로 새어 들어가면 「고르지 않는다」가 무너진다
  assert.ok(!/tblId:\s*CANDIDATES/.test(src) && !/CANDIDATES\[0\]/.test(src),
    '후보를 그대로 조회에 쓰고 있다 — 미검증 표 ID 로 값을 만들게 된다');
  kosis.CANDIDATES.forEach((c) => {
    assert.ok(c.caution && c.caution.length > 10, `${c.key}: 무엇을 조심해야 하는지 적어야 한다`);
  });
});

/* ═════════ ③ 응답 해석 ═════════ */

test('★ 응답 순서가 뒤섞여 있어도 시점으로 정렬한다 (§4.4)', () => {
  const p = kosis.parseData(JSON.stringify([
    row('202506', 75.0, '%'), row('202401', 71.0, '%'), row('202410', 73.0, '%'),
  ]));
  assert.strictEqual(p.ok, true, p.error);
  assert.deepStrictEqual(p.rows.map(x => x.period), ['202401', '202410', '202506']);
});

/**
 * ★ `Number('')` 은 0 이고 `isFinite(0)` 은 참이다. 걸러내지 않으면 결측이
 *   **「가동률 0%」** 로 들어와 평균을 통째로 끌어내린다 — 값은 나온다.
 */
test('★ 결측을 0 으로 세지 않는다', () => {
  const p = kosis.parseData(JSON.stringify([
    row('202401', 71.0, '%'), { PRD_DE: '202402', DT: '', UNIT_NM: '%' }, row('202403', 75.0, '%'),
  ]));
  assert.strictEqual(p.rows.length, 2);
  assert.ok(!p.rows.some(x => x.value === 0), '빈 값이 0 으로 들어왔다');
});

/** ★ KOSIS 는 오류를 HTTP 200 + `{err, errMsg}` 로 준다 */
test('★ 오류가 200 으로 와도 성공으로 세지 않는다', () => {
  const p = kosis.parseData(JSON.stringify({ err: '30', errMsg: '등록되지 않은 인증키입니다' }));
  assert.strictEqual(p.ok, false);
  assert.match(p.error, /30/);
  assert.match(p.error, /인증키/);
});

test('빈 배열이면 조건을 의심하라고 한다 (조용히 성공하지 않는다)', () => {
  const p = kosis.parseData('[]');
  assert.strictEqual(p.ok, false);
  assert.match(p.error, /표 ID·항목·분류·기간 확인/);
});

test('JSON 이 아니면 키·표 ID 를 의심하라고 한다', () => {
  const p = kosis.parseData('<html>error</html>');
  assert.strictEqual(p.ok, false);
  assert.match(p.error, /JSON/);
});

/* ═════════ ④ 평균에는 모수가 붙는다 (§4.7) ═════════ */

test('★ 평균에 표본 수와 기간이 붙는다', async () => {
  await withFakeResponse([row('202401', 71.0, '%'), row('202402', 73.0, '%'), row('202403', 75.0, '%')], async () => {
    const bm = await kosis.benchmark({ tblId: 'DT_X', itmId: 'T2', from: '202401', to: '202403' });
    assert.strictEqual(bm.value.mean, 73);
    assert.strictEqual(bm.value.n, 3, '몇 개를 평균했는지 없으면 한 달치인지 3년치인지 모른다');
    assert.strictEqual(bm.value.from, '202401');
    assert.strictEqual(bm.value.to, '202403');
    assert.strictEqual(bm.value.latest, 75.0, '최근값과 평균은 다른 값이다 — 둘 다 남긴다');

    const s = bm.value.source;
    assert.strictEqual(s.provider, '통계청 KOSIS');
    assert.match(s.note, /3개 시점/);
    assert.match(s.note, /202401~202403/);
    assert.match(s.note, /개별 공장 값이 아니다/, '업종 평균이라는 성격이 출처에 남아야 한다');
  });
});

/**
 * ★ **이 커넥터는 값을 채우지 않는다.** fact 로 등록하면 「가동률 73%」가
 *   딜의 값으로 IM 에 실린다 — 업종 평균이 개별 딜의 수치로 둔갑한다.
 */
test('★ fact 를 만들지 않는다 (업종 평균이 딜 값으로 둔갑하지 않는다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'kosis.js'), 'utf8');
  assert.ok(!/facts?\.push|addMany|new Dataset/.test(src),
    'fact 를 등록하고 있다 — 업종 평균이 딜의 가동률로 실린다');
  assert.match(src, /값을 채우지 않는다|대조한다/, '무엇을 하는 커넥터인지 코드에 적어야 한다');
});

/* ═════════ ⑤ 구조 · 쿼터 · 시크릿 ═════════ */

test('기간 표기를 주기에 맞춘다', () => {
  assert.strictEqual(kosis.period('2024-01', 'M'), '202401');
  assert.strictEqual(kosis.period('202401', 'M'), '202401');
  assert.strictEqual(kosis.period('202401', 'Y'), '2024', '연간 조회에 월을 주면 연도로 줄인다');
  assert.strictEqual(kosis.period('2024', 'Y'), '2024');
  assert.strictEqual(kosis.period('2024', 'M'), '', '못 읽으면 짐작하지 않는다');
});

test('★ 캐시를 통과한다 (일일 한도 밖으로 새지 않는다)', async () => {
  await withFakeResponse([row('202401', 71.0, '%'), row('202403', 75.0, '%')], async (calls) => {
    const a = await kosis.series({ tblId: 'DT_X', itmId: 'T2', from: '202401', to: '202403' });
    const b = await kosis.series({ tblId: 'DT_X', itmId: 'T2', from: '202401', to: '202403' });
    assert.strictEqual(a.cached, false);
    assert.strictEqual(b.cached, true);
    assert.strictEqual(calls.length, 1);
  });
});

test('★ 업종·항목이 다르면 캐시가 섞이지 않는다', async () => {
  await withFakeResponse([row('202401', 71.0, '%'), row('202403', 75.0, '%')], async (calls) => {
    await kosis.series({ tblId: 'DT_X', itmId: 'T1', from: '202401', to: '202403' });
    await kosis.series({ tblId: 'DT_X', itmId: 'T2', from: '202401', to: '202403' });
    await kosis.series({ tblId: 'DT_X', itmId: 'T2', objL1: '13', from: '202401', to: '202403' });
    assert.strictEqual(calls.length, 3, '항목·업종이 캐시 키에 없으면 다른 업종 값이 나온다');
  });
});

test('연간 자료는 더 오래 붙든다 (매달 다시 부를 이유가 없다)', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'kosis.js'), 'utf8');
  assert.match(src, /prdSe === 'Y' \? 30 \* 86400 : 7 \* 86400/);
});

test('★ 기존 커넥터 구조를 그대로 쓴다 (cache + http)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'kosis.js'), 'utf8');
  assert.match(src, /require\('\.\/cache'\)/);
  assert.match(src, /require\('\.\/http'\)/);
  assert.match(src, /cache\.through\(/);
  assert.ok(!/\bfetch\(/.test(src), 'fetch 를 직접 부르면 재시도·마스킹이 빠진다');
});

/** ★ 키가 로그·오류에 평문으로 남으면 안 된다 (CLAUDE.md §2) */
test('★ 키가 SECRET_ENV 에 등록되어 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'http.js'), 'utf8');
  assert.match(src, /'KOSIS_API_KEY'/, 'SECRET_ENV 에 없으면 오류 메시지에 키가 그대로 남는다');
});

test('키가 쿼리에 실려도 로그에서는 가려진다', () => {
  const key = 'K'.repeat(40);
  withEnv({ KOSIS_API_KEY: key }, () => {
    assert.ok(!kosis.mask(`요청 실패: ${kosis.DATA_BASE}?apiKey=${key}&tblId=DT_X`).includes(key));
  });
});

test('키가 없으면 지어내지 않고 비운다', async () => {
  await withEnv({ KOSIS_API_KEY: undefined }, async () => {
    for (const r of [
      await kosis.tables('가동률'),
      await kosis.meta({ tblId: 'DT_X' }),
      await kosis.series({ tblId: 'DT_X', itmId: 'T2', from: '202401', to: '202403' }),
    ]) {
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.unavailable, true);
      assert.match(r.error, /KOSIS_API_KEY/);
    }
  });
});

test('.env.example 이 별개 키라는 사실과 단위 함정을 알려 준다', () => {
  const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');
  assert.match(env, /KOSIS_API_KEY=/);
  assert.match(env, /또 다른 별개 키/, '다른 키를 넣으면 인증 오류만 나온다 (§4.1)');
  assert.match(env, /가동률 102%/, '단위 함정을 .env 만 봐도 알 수 있어야 한다');
});

/* ═════════ ⑥ 스모크 · 등록부 ═════════ */

test('★ 스모크가 이 커넥터를 확인한다', () => {
  const smoke = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  assert.match(smoke, /KOSIS_API_KEY  :/, '키 목록에 없으면 붙인 줄도 모른다');
  assert.match(smoke, /KOSIS 통계표 검색/);
  assert.match(smoke, /--kosis-tbl/, '표를 고른 뒤 확인하는 길을 알려 줘야 한다');
  assert.match(smoke, /% 항목\*\*을 고른다|% 항목/, '스모크도 단위 함정을 말해야 한다');
});

test('★ 미검증이라는 사실이 코드와 등록부에 남아 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'kosis.js'), 'utf8');
  assert.match(src, /D-44/);
  assert.match(src, /실제 키로 검증하지 않았다/);

  const reg = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', '미결정-사항.md'), 'utf8');
  assert.match(reg, /D-44\./, '등록부에 없으면 실측 전에 잊는다');
  assert.match(reg, /KOSIS_API_KEY/, '새 키가 필요하다는 사실이 등록부에 있어야 한다');
});
