'use strict';
/**
 * enviro.test.js — 환경 인허가 Connector (딜브레이커 점검).
 *
 * 이 커넥터의 위험은 **앞의 넷과 반대 방향**이다.
 *
 * 숫자는 없으면 비우면 된다 — 빈칸은 빈칸으로 보인다.
 * 딜브레이커는 **없는 것이 「문제 없음」처럼 보인다.** 조회 결과가 비었을 때
 * 그것을 통과로 읽으면 진짜 결격을 놓치고, 결격으로 읽으면 멀쩡한 딜을 죽인다.
 * **둘 다 조용히 일어난다.**
 *
 * 그래서 여기서 못 박는 것은 하나다 — **「확인되지 않음」이 어느 쪽으로도
 * 흡수되지 않는가.**
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const enviro = require('../connectors/enviro');
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

function withFake(responder, fn) {
  const real = http.request;
  const calls = [];
  http.request = async (url) => {
    calls.push(url);
    const r = typeof responder === 'function' ? responder(url, calls.length) : responder;
    if (r && r.transportError) return { ok: false, status: 500, error: r.transportError, attempts: 3 };
    return { ok: true, status: 200, body: typeof r === 'string' ? r : JSON.stringify(r), attempts: 1 };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enviro-cache-'));
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

const PERMIT = { bplcNm: '한빛정밀', addr: '경기도 화성시 향남읍 1', prmisnNo: '2021-대기-0037', emsnGrade: '4종', prmisnDe: '20210415' };

/* ═════════ ① 「없음」과 「모름」이 흡수되지 않는다 ═════════ */

/**
 * ★ **이 파일에서 가장 중요한 검사다.** 판정이 넷이어야 한다.
 *   셋으로 줄이면 「확인되지 않음」이 어딘가로 흡수되는데, 어느 쪽으로 흡수되든
 *   조용히 틀린다 — 통과 쪽이면 결격을 놓치고, 결격 쪽이면 멀쩡한 딜을 죽인다.
 */
test('★ 판정이 넷이고, 통과로 세는 것은 둘뿐이다', () => {
  assert.deepStrictEqual(Object.keys(enviro.STATUS).sort(),
    ['ABSENT', 'CONFIRMED', 'NOT_APPLICABLE', 'UNKNOWN']);
  assert.deepStrictEqual(enviro.CLEARED.sort(), ['confirmed', 'n/a']);
  assert.ok(!enviro.CLEARED.includes(enviro.STATUS.ABSENT), '「없음」을 통과로 세고 있다');
  assert.ok(!enviro.CLEARED.includes(enviro.STATUS.UNKNOWN), '「모름」을 통과로 세고 있다');
});

/**
 * ★ 조회 결과가 비는 이유가 넷인데 우리는 가리지 못한다. 그래서 **매번 함께
 *   낸다** — 한 번 적어 둔 주석은 화면까지 따라오지 않는다.
 */
test('★ 「조회 결과 없음」을 「허가 없음」이라고 말하지 않는다', async () => {
  await withFake(payload([]), async () => {
    const r = await enviro.check('air', { name: '한빛정밀' });
    assert.strictEqual(r.status, enviro.STATUS.ABSENT);
    assert.match(r.reason, /미허가라는 뜻이 아니다/);
    assert.match(r.reason, /대상이 아님/, '왜 빌 수 있는지 매번 함께 내야 한다');
    assert.match(r.reason, /사람이 확인한다/);
  });
});

/** ★ 조회 실패가 「없음」으로 둔갑하면 진짜 결격을 놓친다 */
test('★ 조회 실패는 UNKNOWN 으로 남고 사라지지 않는다', async () => {
  await withFake({ transportError: 'HTTP 500 (3회 시도)' }, async () => {
    const r = await enviro.check('water', { name: '한빛정밀' });
    assert.strictEqual(r.status, enviro.STATUS.UNKNOWN);
    assert.notStrictEqual(r.status, enviro.STATUS.ABSENT, '실패가 「없음」으로 둔갑했다');
    assert.match(r.reason, /500/);
  });
});

test('키가 없어도 항목이 사라지지 않는다 (UNKNOWN 으로 남는다)', async () => {
  await withEnv({ DATA_GO_KR_KEY: undefined }, async () => {
    const r = await enviro.check('integrated', { name: '한빛정밀' });
    assert.strictEqual(r.status, enviro.STATUS.UNKNOWN);
    assert.strictEqual(r.label, '통합환경허가', '항목 이름은 남아야 무엇을 못 봤는지 안다');
    assert.match(r.reason, /DATA_GO_KR_KEY/);
  });
});

test('사업장을 특정하지 못하면 UNKNOWN 이다 (조회하지 않는다)', async () => {
  await withFake(payload([PERMIT]), async (calls) => {
    const r = await enviro.check('air', {});
    assert.strictEqual(r.status, enviro.STATUS.UNKNOWN);
    assert.match(r.reason, /상호가 필요하다/);
    assert.strictEqual(calls.length, 0);
  });
});

/* ═════════ ② 종합 판정이 함부로 통과시키지 않는다 ═════════ */

/**
 * ★ **딜브레이커에서 「모름」은 「괜찮음」이 아니다.** 한 항목이라도 확인 안 되면
 *   통과가 아니다.
 */
test('★ 한 항목이라도 확인 안 되면 통과가 아니다', () => {
  const v = enviro.verdict([
    { kind: 'integrated', label: '통합환경허가', status: enviro.STATUS.CONFIRMED },
    { kind: 'air', label: '대기배출시설 신고·허가', status: enviro.STATUS.CONFIRMED },
    { kind: 'ets', label: '배출권 할당대상 여부 (K-ETS)', status: enviro.STATUS.UNKNOWN, reason: '명단이 고시로만 나온다' },
  ]);
  assert.strictEqual(v.cleared, false, '「모름」이 하나 있는데 통과로 셌다');
  assert.strictEqual(v.mustConfirm.length, 1);
  assert.match(v.text, /「확인되지 않음」은 「문제 없음」이 아니다/);
});

test('★ 「없음」도 통과가 아니다', () => {
  const v = enviro.verdict([
    { kind: 'air', label: '대기', status: enviro.STATUS.ABSENT, reason: '기록 없음' },
  ]);
  assert.strictEqual(v.cleared, false);
  assert.strictEqual(v.mustConfirm.length, 1);
});

/**
 * ★ 그렇다고 **「결격」이라고도 말하지 않는다.** 미허가인지 대상이 아닌지 우리는
 *   가리지 못한다 — 낼 수 있는 말은 「사람이 확인해야 한다」까지다.
 */
test('★ 결격이라고 단정하지 않는다', () => {
  const v = enviro.verdict([
    { kind: 'integrated', label: '통합환경허가', status: enviro.STATUS.ABSENT, reason: '기록 없음' },
  ]);
  assert.ok(!/결격|불가|부적격|무허가입니다/.test(v.text),
    '단정하면 멀쩡한 딜을 죽인다 — 대상이 아닐 수도 있다');
  assert.match(v.text, /사람이 확인/);
});

test('전부 확인됐을 때만 통과라고 말한다', () => {
  const v = enviro.verdict([
    { kind: 'air', label: '대기', status: enviro.STATUS.CONFIRMED },
    { kind: 'water', label: '수질', status: enviro.STATUS.NOT_APPLICABLE, byHuman: true },
  ]);
  assert.strictEqual(v.cleared, true);
  assert.deepStrictEqual(v.autoNotApplicable, []);
});

/** ★ 빈 목록을 통과로 세면 「점검 안 함」이 「문제 없음」이 된다 */
test('★ 점검한 것이 없으면 통과가 아니다', () => {
  const v = enviro.verdict([]);
  assert.strictEqual(v.cleared, false, '아무것도 안 봤는데 통과로 셌다');
  assert.match(v.text, /점검한 항목이 없다/);
});

/* ═════════ ③ 「대상 아님」은 사람만 붙인다 ═════════ */

/**
 * ★ 통합환경허가 대상 여부는 **업종과 규모**로 정해진다. 그 판단을 이 커넥터가
 *   할 수 없는데 자동으로 붙이면, 대상인 업체가 「대상 아님」으로 통과한다.
 */
test('★ 코드가 「대상 아님」을 붙이는 경로가 없다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'enviro.js'), 'utf8');
  const auto = src.match(/status:\s*STATUS\.NOT_APPLICABLE/g) || [];
  assert.strictEqual(auto.length, 1, '「대상 아님」을 붙이는 곳이 둘 이상이다');
  // 그 하나는 사람이 부르는 함수 안이어야 한다
  const inHuman = /function markNotApplicable[\s\S]*?status: STATUS\.NOT_APPLICABLE/.test(src);
  assert.ok(inHuman, '사람이 부르는 함수 밖에서 「대상 아님」이 붙는다');

  Object.values(enviro.CHECKS).forEach((c) => {
    assert.strictEqual(c.applicabilityByHuman, true, `${c.label}: 대상 여부를 자동 판단하고 있다`);
  });
});

test('★ 근거와 확인자 없이는 「대상 아님」을 못 붙인다', () => {
  const item = { kind: 'water', label: '수질', status: enviro.STATUS.ABSENT };
  assert.strictEqual(enviro.markNotApplicable(item).ok, false);
  assert.strictEqual(enviro.markNotApplicable(item, '홍길동').ok, false, '근거가 없다');

  const ok = enviro.markNotApplicable(item, '검토역', '폐수 배출 공정이 없는 조립 공정만');
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.value.status, enviro.STATUS.NOT_APPLICABLE);
  assert.strictEqual(ok.value.byHuman, true);
  assert.match(ok.value.reason, /조립 공정만/);
  assert.match(ok.value.reason, /검토역/);
});

/** ★ 사람이 안 붙인 「대상 아님」이 있으면 그것 자체를 드러낸다 */
test('★ 사람 손을 안 거친 「대상 아님」을 잡아낸다', () => {
  const v = enviro.verdict([
    { kind: 'water', label: '수질', status: enviro.STATUS.NOT_APPLICABLE },   // byHuman 없음
  ]);
  assert.deepStrictEqual(v.autoNotApplicable, ['water'],
    '코드가 붙인 「대상 아님」이 조용히 통과하고 있다');
});

/* ═════════ ④ 한 항목이 죽어도 나머지를 본다 (§4.6) ═════════ */

test('★ 한 항목이 실패해도 나머지 점검을 계속한다', async () => {
  await withFake((url, n) => (n === 2 ? { transportError: 'HTTP 503' } : payload([PERMIT])), async () => {
    const s = await enviro.screen({ name: '한빛정밀' });
    assert.strictEqual(s.items.length, Object.keys(enviro.CHECKS).length,
      '하나가 죽어서 나머지를 못 본 것이 가장 나쁜 결과다');
    assert.ok(s.items.some(x => x.status === enviro.STATUS.UNKNOWN));
    assert.ok(s.items.some(x => x.status === enviro.STATUS.CONFIRMED));
    assert.strictEqual(s.verdict.cleared, false);
  });
});

test('항목마다 「없으면 무슨 일이 벌어지는지」가 붙는다', async () => {
  await withFake(payload([]), async () => {
    const s = await enviro.screen({ name: '한빛정밀' });
    s.items.forEach((x) => {
      assert.ok(x.why && x.why.length > 10, `${x.kind}: 왜 보는 항목인지 없다`);
    });
    assert.match(enviro.CHECKS.ets.why, /재무모델이 통째로 낙관적/);
    assert.match(enviro.CHECKS.integrated.why, /가동을 못 한다/);
  });
});

/* ═════════ ⑤ 확인된 경우에도 단정하지 않는다 ═════════ */

test('확인되면 기록을 보여 주되 동명 가능성을 남긴다', async () => {
  await withFake(payload([PERMIT]), async () => {
    const r = await enviro.check('air', { name: '한빛정밀' });
    assert.strictEqual(r.status, enviro.STATUS.CONFIRMED);
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.records[0].permitNo, '2021-대기-0037');
    assert.strictEqual(r.records[0].grade, '4종', '종별은 증설 시 바뀐다 — 남겨야 한다');
    assert.match(r.source.note, /같은 이름의 다른 사업장일 수 있다/);
  });
});

/**
 * ★ 배출권은 **「할당대상이다」까지만** 낸다. 비용 = 부족분 × 배출권 가격인데
 *   둘 다 가정이다 (§4.8 · D-25 와 같은 자리).
 */
test('★ 배출권 비용을 계산하지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'enviro.js'), 'utf8');
  assert.ok(!/배출권 *가격 *\*|allowancePrice|carbonCost|tCO2 *\*/.test(src),
    '배출권 비용을 만들고 있다 — 부족분과 가격이 둘 다 가정이다');
  assert.match(src, /비용은 내지 않는다/);
});

/** ★ fact 로 등록하면 사람 확인 없이 IM 에 실린다 */
test('★ fact 를 만들지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'enviro.js'), 'utf8');
  assert.ok(!/facts?\.push|addMany|new Dataset/.test(src));
});

/* ═════════ ⑥ 구조 · 쿼터 · 시크릿 ═════════ */

/**
 * ★★★ **쿼터 통을 갈래로 나눴다** 〈2026-08-23 실측 · D-85〉.
 *
 *   앞 판의 이 검사는 「한도는 API 별이 아니라 **인증키 전체**에 걸린다」는 믿음
 *   위에 서 있었다. **틀렸다.** data.go.kr 활용신청 화면이 「일일 트래픽」을
 *   **상세기능(오퍼레이션)마다** 1,000 으로 적어 준다.
 *
 *   ★ 한 통으로 두면 계량기가 거짓말을 한다 — 우리가 「여유 있다」고 말하는 동안
 *     상대는 이미 끊는다. 그리고 아홉 커넥터가 **한꺼번에** 막힌다.
 *   ★ 그래서 `data.go.kr:<갈래>` 로 나눈다. 앞부분이 같으므로 기관 단위 설정
 *     (`IM_AGENT_QUOTA_DATA_GO_KR`)은 그대로 먹는다.
 */
test('★★ 쿼터 통이 data.go.kr 갈래로 나뉘어 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'enviro.js'), 'utf8');
  const m = src.match(/^const PROVIDER = '([^']+)'/m);
  assert.strictEqual(m && m[1], 'data.go.kr:enviro',
    '한 통으로 되돌리면 아홉 커넥터가 한꺼번에 막힌다');
});

test('★ 기존 커넥터 구조를 그대로 쓴다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'enviro.js'), 'utf8');
  assert.match(src, /require\('\.\/cache'\)/);
  assert.match(src, /require\('\.\/http'\)/);
  assert.match(src, /require\('\.\/xml'\)/);
  assert.match(src, /cache\.through\(/);
  assert.ok(!/\bfetch\(/.test(src));
});

test('★ 항목·사업장이 다르면 캐시가 섞이지 않는다', async () => {
  await withFake(payload([PERMIT]), async (calls) => {
    await enviro.check('air', { name: '한빛정밀' });
    await enviro.check('air', { name: '한빛정밀' });
    assert.strictEqual(calls.length, 1, '같은 조회를 두 번 부르면 안 된다');
    await enviro.check('water', { name: '한빛정밀' });
    await enviro.check('air', { name: '대성기계' });
    assert.strictEqual(calls.length, 3, '항목·사업장이 캐시 키에 없으면 남의 허가가 나온다');
  });
});

test('키가 로그에서 가려진다', () => {
  const key = 'D'.repeat(40);
  withEnv({ DATA_GO_KR_KEY: key }, () => {
    assert.ok(!enviro.mask(`요청 실패: ${enviro.BASE}?serviceKey=${key}`).includes(key));
  });
});

/* ═════════ ⑦ 스모크 · 등록부 ═════════ */

test('★ 스모크가 이 커넥터를 확인한다', () => {
  const smoke = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  assert.match(smoke, /환경 인허가/);
  assert.match(smoke, /--enviro-name/);
  assert.match(smoke, /문제 없음/, '스모크도 「모름」이 통과가 아님을 말해야 한다');
});

/**
 * ★ 배출권 명단이 **고시로만** 나오면 이 항목은 영구히 UNKNOWN 이다.
 *   그것을 모른 채 두면 「왜 항상 모름이지」를 반복해서 조사하게 된다.
 */
test('★ 미검증·API 부재 가능성이 코드와 등록부에 남아 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'enviro.js'), 'utf8');
  assert.match(src, /D-47/);
  assert.match(src, /고시/, '명단이 API 가 아닐 수 있다는 사실을 적어야 한다');
  assert.strictEqual(enviro.CHECKS.ets.mayNotHaveApi, true);

  const reg = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', '미결정-사항.md'), 'utf8');
  assert.match(reg, /D-47\./);
  assert.match(reg, /고시/, 'API 가 없을 가능성이 등록부에 있어야 한다');
});
