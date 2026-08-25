'use strict';
/**
 * factory.test.js — 공장등록 Connector (제조 딜의 물리적 상한).
 *
 * 이 파일에서 가장 중요한 검사는 **면적을 뭉치지 않는가** 다.
 *
 * 공장등록에는 면적이 넷 실린다 — 용지(부지)·건축·제조시설·부대시설.
 * 「공장면적 12,000㎡」로 뭉치면 어느 면적인지 사라지는데, 생산능력을 논해야
 * 하는 것은 **제조시설면적**이고 용지면적은 보통 그 두세 배다. 섞으면 상한이
 * 세 배로 부풀고 **문서에는 「공장등록 기준」이라고만 남는다.**
 *
 * 두 번째는 **사업장을 자동으로 특정하지 않는가**, 세 번째는 **공부끼리
 * 어긋날 때 한쪽을 고르지 않는가** 다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const factory = require('../connectors/factory');
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

/** 응답을 갈아끼워 **해석 경로 전체**를 지나가게 한다 (M-08 의 교훈) */
function withFakeResponse(body, fn) {
  const real = http.request;
  const calls = [];
  http.request = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, body: typeof body === 'string' ? body : JSON.stringify(body), attempts: 1 };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-cache-'));
  return withEnv({ DATA_GO_KR_KEY: 'D'.repeat(40), IM_AGENT_CACHE: tmp }, () => fn(calls))
    .finally(() => {
      http.request = real;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }
    });
}

/** data.go.kr JSON 응답 한 벌 */
function payload(items) {
  return {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' },
      body: { totalCount: items.length, items: { item: items } },
    },
  };
}

/** 공장등록 한 건 — 면적 넷이 다 다르다 (이 파일의 전제) */
function plant(over) {
  return Object.assign({
    factrNo: 'F-001', fctryNm: '한빛정밀', fctryAddr: '경기도 화성시 향남읍 1',
    induty: '29294', indutyNm: '기타 기계 및 장비 제조업',
    lndarNm: '12000', bldgAr: '5200', manufAr: '3800', auxAr: '1400',
    regstrDe: '20190312', chgDe: '20230704', emplyCnt: '86',
  }, over || {});
}

/* ═════════ ① 면적을 뭉치지 않는다 ═════════ */

/**
 * ★ **이 파일에서 가장 중요한 검사다.** 최상위에 `area` 가 생기는 순간
 *   부르는 쪽이 그걸 집어 쓰고, 어느 면적인지가 사라진다.
 */
test('★ 「면적」이라는 뭉뚱그린 필드를 만들지 않는다', () => {
  const r = factory.toRecord(plant());
  assert.ok(!('area' in r), '뭉뚱그린 area 필드가 생겼다 — 용지를 제조시설로 쓰게 된다');
  assert.ok(!('areaSqm' in r) && !('totalArea' in r));
  assert.deepStrictEqual(Object.keys(r.areas).sort(), ['auxiliary', 'building', 'land', 'manufacturing']);
  assert.strictEqual(r.areas.land, 12000);
  assert.strictEqual(r.areas.manufacturing, 3800);
});

/** ★ 종류를 안 주면 거부한다. 기본값을 두면 그게 곧 「모르는 값」이 된다 */
test('★ 면적 종류를 지정하지 않으면 꺼내 주지 않는다', () => {
  const r = factory.toRecord(plant());
  const bad = factory.areaOf(r);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /면적 종류를 지정해야 한다/);
  assert.match(bad.error, /두세 배/, '왜 위험한지 그 자리에서 말해야 한다');
  assert.strictEqual(factory.areaOf(r, '면적').ok, false, '모르는 종류도 거부해야 한다');
});

/**
 * ★ 용지면적과 제조시설면적은 **세 배 넘게 차이 난다.** 둘을 바꿔 쓰면
 *   생산능력 상한이 그만큼 부풀고, 출처 표시는 멀쩡하다.
 */
test('★ 용지면적과 제조시설면적이 서로 다른 값으로 나온다', () => {
  const r = factory.toRecord(plant());
  const land = factory.areaOf(r, 'land');
  const mfg = factory.areaOf(r, 'manufacturing');

  assert.strictEqual(land.value.sqm, 12000);
  assert.strictEqual(mfg.value.sqm, 3800);
  assert.ok(land.value.sqm / mfg.value.sqm > 3, '전제가 깨졌다 — 두 면적은 크게 다르다');
  assert.match(land.value.caution, /생산능력의 근거로 쓰면 안 된다/);
  assert.match(mfg.value.caution, /이 값/, '어느 것을 봐야 하는지 말해야 한다');
});

/** ★ 없는 면적을 0 으로 그리지 않는다 — 0㎡ 는 「없다」가 아니라 「0 이다」로 읽힌다 */
test('★ 없는 면적은 0 이 아니라 「없다」로 돌려준다', () => {
  const r = factory.toRecord(plant({ manufAr: '', mnfctFcltyAr: undefined }));
  const got = factory.areaOf(r, 'manufacturing');
  assert.strictEqual(got.ok, false);
  assert.strictEqual(got.missing, true);
  assert.match(got.error, /제조시설면적/);
  assert.strictEqual(factory.hasAnyArea(r), true, '다른 면적은 남아 있다');

  const empty = factory.toRecord({ fctryNm: 'X' });
  assert.strictEqual(factory.hasAnyArea(empty), false, '하나도 없으면 그렇게 말해야 한다');
});

/**
 * ★ 공장등록은 변경신고가 없으면 갱신되지 않는다. **날짜 없는 면적은
 *   「지금 그렇다」로 읽히고**, 그게 틀렸을 때 아무도 모른다 (§4.7).
 */
test('★ 면적에 등록일·변경일이 따라붙는다', () => {
  const r = factory.toRecord(plant());
  const s = factory.areaOf(r, 'manufacturing').value.source;
  assert.match(s.note, /등록 2019-03-12/);
  assert.match(s.note, /변경 2023-07-04/);
  assert.match(s.note, /변경신고가 없으면 갱신되지 않는다/);
});

test('날짜를 못 읽으면 짐작하지 않는다', () => {
  assert.strictEqual(factory.ymd('20190312'), '2019-03-12');
  assert.strictEqual(factory.ymd('2019-03-12'), '2019-03-12');
  assert.strictEqual(factory.ymd('201903'), null);
  assert.strictEqual(factory.ymd(''), null);
  assert.strictEqual(factory.toRecord(plant({ regstrDe: '', rgstDt: '' })).registeredAt, null);
});

/* ═════════ ② 사업장을 자동으로 특정하지 않는다 (§4.9) ═════════ */

test('★ 후보가 여럿이면 고르지 않는다', async () => {
  await withFakeResponse(payload([
    plant({ factrNo: 'F-001', fctryAddr: '경기도 화성시 향남읍 1' }),
    plant({ factrNo: 'F-002', fctryAddr: '충청북도 음성군 대소면 9' }),
  ]), async () => {
    const r = await factory.resolve({ name: '한빛정밀' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.ambiguous, true);
    assert.strictEqual(r.candidates.length, 2, '후보는 그대로 보여 줘야 사람이 고른다');
    assert.match(r.error, /2건/);
    assert.match(r.error, /엉뚱한 사업장의 면적/, '왜 안 고르는지 말해야 한다');
  });
});

/** ★ 「없다」와 「공장이 없다」는 다르다 — dart 의 공시대상회사와 같은 함정 */
test('★ 조회 결과 없음을 「공장이 없다」로 말하지 않는다', async () => {
  await withFakeResponse(payload([]), async () => {
    const r = await factory.resolve({ name: '없는공장' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /사업장이 없다/);
    assert.ok(/공장이 없다는 뜻은 아니다|미등록/.test(r.error),
      '미등록·소규모·자료 미갱신일 수 있다 — 단정하면 안 된다');
  });
});

test('하나로 좁혀지면 그것을 쓴다', async () => {
  await withFakeResponse(payload([plant()]), async () => {
    const r = await factory.resolve({ name: '한빛정밀' });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.value.name, '한빛정밀');
    assert.strictEqual(r.value.industryCode, '29294');
  });
});

test('★ 상호·주소가 없으면 전체 목록을 훑지 않는다', async () => {
  await withFakeResponse(payload([]), async (calls) => {
    const r = await factory.search({});
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /전체 목록을 훑지 않는다/);
    assert.strictEqual(calls.length, 0, '거부할 요청으로 쿼터를 쓰면 안 된다');
  });
});

/* ═════════ ③ 공부끼리 어긋날 때 고르지 않는다 ═════════ */

/**
 * ★ **어긋난다는 사실 자체가 결과다** (§4 첫머리). 자동으로 큰 쪽·작은 쪽을
 *   고르면 문서에는 「대지면적 12,000㎡」만 남고 두 공부가 다르다는 것이 사라진다.
 */
test('★ 공장등록과 건축물대장이 다르면 한쪽을 고르지 않는다', () => {
  const r = factory.crossCheckLand(12000, 10800);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.agree, false);
  assert.strictEqual(r.value.diffSqm, 1200);
  assert.strictEqual(r.value.diffPercent, 10);
  assert.match(r.value.text, /어느 쪽이 맞는지는 사람이 확인한다/);
  // ★ 「맞다/틀리다」로 판정하지 않는다
  assert.ok(!/올바른|정확한|맞는 값은/.test(r.value.text), '한쪽을 정답으로 세우면 안 된다');
});

test('오차 안이면 일치로 본다', () => {
  const r = factory.crossCheckLand(12000, 11950);
  assert.strictEqual(r.value.agree, true, '측량 반올림 수준의 차이까지 경고하면 경고가 무뎌진다');
  assert.match(r.value.text, /일치한다/);
});

test('★ 한쪽이 없으면 0 으로 세지 않는다', () => {
  for (const [a, b] of [[12000, null], [null, 10800], [12000, 0], [0, 0]]) {
    const r = factory.crossCheckLand(a, b);
    assert.strictEqual(r.ok, false, `${a}/${b}: 없는 값을 0 으로 세면 100% 차이가 난다`);
  }
});

/* ═════════ ④ 응답 해석 ═════════ */

test('★ 오류가 200 으로 와도 성공으로 세지 않는다', () => {
  const p = factory.parseList(JSON.stringify({
    response: {
      header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' },
      body: { items: {} },
    },
  }));
  assert.strictEqual(p.ok, false);
  assert.match(p.error, /공장등록/);
});

/**
 * ★ **빈 결과는 오류가 아니다.** 오류로 두면 「조회가 실패했다」와 「등록이 없다」가
 *   한 덩어리가 되는데, 둘은 다음에 할 일이 정반대다 — 전자는 엔드포인트를 고치고,
 *   후자는 미등록 가능성을 사람이 판단한다. (실제로 그렇게 짰다가 `resolve` 의
 *   「공장이 없다는 뜻은 아니다」 안내가 영영 안 나오는 상태였다)
 */
test('★ 빈 목록을 조회 실패로 세지 않는다', () => {
  const p = factory.parseList(JSON.stringify(payload([])));
  assert.strictEqual(p.ok, true, '빈 결과는 정상 응답이다');
  assert.deepStrictEqual(p.rows, []);
});

test('XML 로 와도 읽는다 (data.go.kr 은 형식이 섞인다)', () => {
  const xml = '<response><header><resultCode>00</resultCode></header><body><items>'
    + '<item><fctryNm>한빛정밀</fctryNm><lndarNm>12000</lndarNm><manufAr>3800</manufAr></item>'
    + '</items><totalCount>1</totalCount></body></response>';
  const p = factory.parseList(xml);
  assert.strictEqual(p.ok, true, p.error);
  assert.strictEqual(p.rows[0].areas.manufacturing, 3800);
});

test('업종코드를 남긴다 (KOSIS 업종을 고를 근거가 된다)', () => {
  const r = factory.toRecord(plant());
  assert.strictEqual(r.industryCode, '29294');
  assert.strictEqual(r.industryName, '기타 기계 및 장비 제조업');

  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'factory.js'), 'utf8');
  // ★ 근거일 뿐 **자동 연결은 안 한다** — KOSIS 업종 선택은 사람이 한다 (D-44)
  assert.ok(!/require\('\.\/kosis'\)/.test(src), 'KOSIS 업종을 자동으로 골라 버리면 D-44 가 무너진다');
});

/* ═════════ ⑤ 구조 · 쿼터 · 시크릿 ═════════ */

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
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'factory.js'), 'utf8');
  const m = src.match(/^const PROVIDER = '([^']+)'/m);
  assert.strictEqual(m && m[1], 'data.go.kr:factory',
    '한 통으로 되돌리면 아홉 커넥터가 한꺼번에 막힌다');
});

test('★ 캐시를 통과한다', async () => {
  await withFakeResponse(payload([plant()]), async (calls) => {
    const a = await factory.search({ name: '한빛정밀' });
    const b = await factory.search({ name: '한빛정밀' });
    assert.strictEqual(a.cached, false);
    assert.strictEqual(b.cached, true);
    assert.strictEqual(calls.length, 1);
  });
});

test('★ 상호가 다르면 캐시가 섞이지 않는다', async () => {
  await withFakeResponse(payload([plant()]), async (calls) => {
    await factory.search({ name: '한빛정밀' });
    await factory.search({ name: '대성기계' });
    await factory.search({ name: '한빛정밀', sido: '경기도' });
    assert.strictEqual(calls.length, 3);
  });
});

test('★ 기존 커넥터 구조를 그대로 쓴다 (cache + http + xml)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'factory.js'), 'utf8');
  assert.match(src, /require\('\.\/cache'\)/);
  assert.match(src, /require\('\.\/http'\)/);
  assert.match(src, /require\('\.\/xml'\)/, 'data.go.kr 은 XML·JSON 이 섞인다 — 공통 파서를 쓴다');
  assert.match(src, /cache\.through\(/);
  assert.ok(!/\bfetch\(/.test(src));
});

/** ★ Encoding 키는 인증만 실패하고 증상이 「키가 틀렸다」와 구분되지 않는다 (§4.1) */
test('★ Encoding 키를 넣으면 부르기 전에 말해 준다', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-cache-'));
  await withEnv({ DATA_GO_KR_KEY: 'abc%2Fdef%3D'.repeat(4), IM_AGENT_CACHE: tmp }, async () => {
    const r = await factory.search({ name: '한빛정밀' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Decoding\(일반\)/);
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }
});

test('키가 없으면 지어내지 않고 비운다', async () => {
  await withEnv({ DATA_GO_KR_KEY: undefined }, async () => {
    const r = await factory.search({ name: '한빛정밀' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.unavailable, true);
    assert.match(r.error, /DATA_GO_KR_KEY/);
  });
});

test('키가 로그에서 가려진다', () => {
  const key = 'D'.repeat(40);
  withEnv({ DATA_GO_KR_KEY: key }, () => {
    assert.ok(!factory.mask(`요청 실패: ${factory.BASE}?serviceKey=${key}`).includes(key));
  });
});

/* ═════════ ⑥ 스모크 · 등록부 ═════════ */

test('★ 스모크가 이 커넥터를 확인한다', () => {
  const smoke = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  assert.match(smoke, /공장등록/, '붙였는데 확인할 방법이 없다');
  assert.match(smoke, /--factory-name/, '상호를 주는 길을 알려 줘야 한다');
  assert.match(smoke, /제조시설면적/, '스모크도 어느 면적을 봐야 하는지 말해야 한다');
});

test('★ 미검증이라는 사실이 코드와 등록부에 남아 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'factory.js'), 'utf8');
  assert.match(src, /D-45/);
  assert.match(src, /검증되지 않았다/);
  assert.match(src, /활용신청/, '키가 있어도 이 API 신청이 따로 필요하다 (§4.2)');

  const reg = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', '미결정-사항.md'), 'utf8');
  assert.match(reg, /D-45\./, '등록부에 없으면 실측 전에 잊는다');
  assert.match(reg, /팩토리온|공장설립온라인지원시스템/, '어느 기관인지가 미확정이라는 사실을 적어야 한다');
});
