'use strict';
/**
 * nts-nps.test.js — 국세청 사업자등록 · 국민연금 사업장 Connector (등록부 D-60).
 *
 * 이 둘의 위험은 **경계를 흐리는 것**이다.
 *
 *  ① **번호를 섞는다.** DART 가 주는 것은 법인등록번호(13자리), 국세청이 받는
 *     것은 사업자등록번호(10자리)다. 잘라서 넣으면 **엉뚱한 사업자가 조회되고**
 *     그 결과가 문서에 실린다.
 *  ② **「없다」를 「폐업」으로 읽는다.** 조회 안 되는 것과 폐업은 전혀 다르다.
 *     어느 쪽으로 잘못 읽어도 조용히 사고가 난다.
 *  ③ **수록 범위 밖을 결함으로 읽는다.** 국민연금 자료는 3인 이상 법인사업장
 *     부터다 — **SPC 는 원래 거기 없다.** 「직원이 없으니 이상하다」로 읽으면
 *     정상적인 프로젝트 금융 구조가 결함이 된다.
 *  ④ **못 하는 것을 할 수 있는 척한다.** 납세증명·완납증명은 **법이 막고 있다**
 *     (국세기본법 §81조의13). 「API 붙이면 되겠지」로 기다리다 실사가 멈춘다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const nts = require('../connectors/nts');
const nps = require('../connectors/nps');
const http = require('../connectors/http');
const cache = require('../connectors/cache');

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
  http.request = async (url, opt) => {
    calls.push({ url, opt });
    const r = typeof responder === 'function' ? responder(url) : responder;
    if (r && r.transportError) return { ok: false, status: 500, error: r.transportError, attempts: 3 };
    return { ok: true, status: 200, body: typeof r === 'string' ? r : JSON.stringify(r), attempts: 1 };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ntsnps-'));
  return withEnv({ DATA_GO_KR_KEY: 'D'.repeat(40), IM_AGENT_CACHE: tmp }, () => fn(calls))
    .finally(() => {
      http.request = real;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }
    });
}

/* ── ① 번호를 섞지 않는다 ───────────────────────────── */

test('★ 법인등록번호(13자리)를 넣으면 **거절한다**', () => {
  const r = nts.normalizeBizNo('110111-1234567');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /법인등록번호는 사업자등록번호가 아니다/);
  // 잘라서 쓰면 엉뚱한 사업자가 조회된다 — 그 사실이 메시지에 있어야 한다
  assert.match(r.error, /jurir_no/);
});

test('★ 10자리는 구분자가 있어도 받는다', () => {
  assert.strictEqual(nts.normalizeBizNo('123-45-67890').value, '1234567890');
  assert.strictEqual(nts.normalizeBizNo('1234567890').value, '1234567890');
});

test('★ 자리수가 다르면 받지 않는다', () => {
  assert.strictEqual(nts.normalizeBizNo('12345').ok, false);
  assert.strictEqual(nts.normalizeBizNo('').ok, false);
});

/* ── ② 「없다」와 「폐업」을 가른다 ──────────────────── */

test('★ 조회되지 않으면 UNKNOWN 이다 — 폐업이 아니다', async () => {
  await withFake({ status_code: 'OK', data: [] }, async () => {
    const r = await nts.status('1234567890');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.status, nts.STATUS.UNKNOWN);
    assert.match(r.value.text, /폐업이라는 뜻이 아니다/);
  });
});

test('★ 상태를 갈래로 옮긴다', () => {
  assert.strictEqual(nts.toStatus('계속사업자'), nts.STATUS.ACTIVE);
  assert.strictEqual(nts.toStatus('휴업자'), nts.STATUS.SUSPENDED);
  assert.strictEqual(nts.toStatus('폐업자'), nts.STATUS.CLOSED);
  assert.strictEqual(nts.toStatus(''), nts.STATUS.UNKNOWN);
  assert.strictEqual(nts.toStatus('알 수 없는 말'), nts.STATUS.UNKNOWN);
});

test('★ 통과로 세는 것은 계속사업자뿐이다', () => {
  assert.deepStrictEqual(nts.CLEARED, [nts.STATUS.ACTIVE]);
  assert.ok(!nts.CLEARED.includes(nts.STATUS.UNKNOWN), '「모름」이 통과로 흡수된다');
  assert.ok(!nts.CLEARED.includes(nts.STATUS.SUSPENDED));
});

test('★ 폐업이면 폐업일과 함께 말한다', async () => {
  await withFake({ status_code: 'OK', data: [{ b_no: '1234567890', b_stt: '폐업자', end_dt: '20250310' }] }, async () => {
    const r = await nts.status('123-45-67890');
    assert.strictEqual(r.value.status, nts.STATUS.CLOSED);
    assert.match(r.value.text, /20250310/);
    assert.match(r.value.text, /사업 성립 여부/);
  });
});

test('★ 계속사업자면 과세유형까지 낸다', async () => {
  await withFake({ status_code: 'OK', data: [{ b_no: '1234567890', b_stt: '계속사업자', tax_type: '부가가치세 일반과세자' }] }, async () => {
    const r = await nts.status('1234567890');
    assert.strictEqual(r.value.status, nts.STATUS.ACTIVE);
    assert.match(r.value.text, /일반과세자/);
    // ★ 조회 시점이 곧 정보다 — 어제 계속사업자였다고 오늘도 그런 것은 아니다
    assert.match(r.value.source.note, /조회 시점의 상태/);
  });
});

test('★ 키가 없으면 unavailable — 지어내지 않는다', async () => {
  await withEnv({ DATA_GO_KR_KEY: undefined }, async () => {
    const r = await nts.status('1234567890');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.unavailable, true);
  });
});

test('★ 상태 캐시는 하루다 — 휴폐업은 하루 사이에 바뀐다', () => {
  assert.strictEqual(cache.TTL.bizstatus, 86400);
});

/* ── 진위확인 ───────────────────────────────────────── */

test('★ 진위확인에 필요한 값이 하나라도 없으면 부르지 않는다', async () => {
  await withFake({ status_code: 'OK', data: [] }, async (calls) => {
    const r = await nts.verify({ bizNo: '1234567890', startDate: '20200101' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /모두 필요하다/);
    assert.strictEqual(calls.length, 0, '값이 모자란데 호출이 나갔다');
  });
});

test('★ 불일치가 「위조」가 되지 않는다', async () => {
  await withFake({ status_code: 'OK', data: [{ b_no: '1234567890', valid: '02' }] }, async () => {
    const r = await nts.verify({ bizNo: '1234567890', startDate: '20200101', ceoName: '홍길동' });
    assert.strictEqual(r.value.valid, false);
    assert.match(r.value.text, /위조라는 뜻은 아니다/);
  });
});

test('★ 대표자 성명이 결과에도 캐시 키에도 남지 않는다 (§2)', async () => {
  await withFake({ status_code: 'OK', data: [{ b_no: '1234567890', valid: '01' }] }, async () => {
    const r = await nts.verify({ bizNo: '1234567890', startDate: '20200101', ceoName: '홍길동' });
    assert.ok(!JSON.stringify(r.value).includes('홍길동'), '성명이 결과에 남았다');
  });
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'nts.js'), 'utf8');
  const block = src.slice(src.indexOf("'bizvalidate'") - 200, src.indexOf("'bizvalidate'") + 60);
  assert.match(block, /성명을 넣지 않는다/, '캐시 키에 성명이 안 들어간다는 근거가 없다');
});

/* ── ③ 수록 범위 밖을 결함으로 읽지 않는다 ──────────── */

function npsList(items) {
  return { response: { header: { resultCode: '00' }, body: { items: { item: items } } } };
}

test('★ 국민연금에 없는 것이 「없는 회사」가 아니다', async () => {
  await withFake(npsList([]), async () => {
    const r = await nps.findWorkplace('○○개발');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.notFound, true);
    assert.match(r.error, /회사가 없다는 뜻이 아니다/);
    // SPC 가 원래 없다는 사실이 함께 있어야 한다
    assert.match(r.error, /SPC 는 원래 여기 없다/);
  });
});

test('★ 동명 사업장이 여럿이면 **고르지 않는다** (§4.9)', async () => {
  await withFake(npsList([
    { seq: '1', wkplNm: '○○개발', addr: '서울' },
    { seq: '2', wkplNm: '○○개발', addr: '부산' },
  ]), async () => {
    const r = await nps.findWorkplace('○○개발');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.ambiguous, true);
    assert.strictEqual(r.candidates.length, 2);
    assert.match(r.error, /안 싣는 것보다 나쁘다/);
  });
});

test('★ 하나면 고른다 (법인격 표기는 무시한다)', async () => {
  await withFake(npsList([{ seq: '7', wkplNm: '(주)○○개발', addr: '서울' }]), async () => {
    const r = await nps.findWorkplace('○○개발 주식회사');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.seq, '7');
  });
});

test('★ 인원·고지금액을 내되 **판정하지 않는다**', async () => {
  await withFake(npsList([{ jnngpCnt: '4', crrmmNtcAmt: '1240000', adptDt: '20210301' }]), async () => {
    const r = await nps.workplaceDetail('7');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.members, 4);
    assert.strictEqual(r.value.monthlyNoticeKrw, 1240000);
    // ★ 「적다/많다」를 말하면 그것이 근거가 된다
    assert.match(r.value.text, /결함은 아니다/);
    assert.ok(!/부실|이상하다|의심/.test(r.value.text));
  });
});

test('★ 고지금액이 급여 총액이 아니라는 사실을 출처에 남긴다 (§4.7)', async () => {
  await withFake(npsList([{ jnngpCnt: '4', crrmmNtcAmt: '1240000' }]), async () => {
    const r = await nps.workplaceDetail('7');
    assert.match(r.value.source.note, /상한/);
    assert.match(r.value.source.note, /급여 총액이 아니다/);
    assert.match(r.value.source.note, /3인 이상/);
  });
});

test('★ 빈 문자열 인원이 0명이 되지 않는다 (M-07)', async () => {
  await withFake(npsList([{ jnngpCnt: '  ', crrmmNtcAmt: '' }]), async () => {
    const r = await nps.workplaceDetail('7');
    assert.strictEqual(r.value.members, null);
    assert.strictEqual(r.value.monthlyNoticeKrw, null);
    assert.match(r.value.text, /미확인/);
  });
});

/* ── ④ 못 하는 것을 할 수 있는 척하지 않는다 ────────── */

test('★ 납세증명·체납 조회를 **거절한다** — 법이 막고 있다', () => {
  const r = nts.taxClearance();
  assert.strictEqual(r.ok, false);
  // 「아직 안 붙였다」가 아니라 **할 수 없는 것**임이 드러나야 한다
  assert.strictEqual(r.byDesign, true);
  assert.match(r.error, /제81조의13/);
  assert.match(r.error, /본인/);
  assert.match(r.error, /당사자에게 서류로 받는다/);
});

test('★ 4대보험 완납증명도 마찬가지다', () => {
  const r = nps.insuranceClearance();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.byDesign, true);
  // 가입 내역은 공개되고 납부 여부는 안 된다 — 그 구분이 있어야 한다
  assert.match(r.error, /납부 여부는 공개되지 않는다/);
});

test('★ 「받아야 하는 서류」가 사전에 있다', () => {
  const dict = require('../core/dictionary');
  assert.ok(dict.FIELDS['corp.tax_clearance']);
  assert.match(dict.FIELDS['corp.tax_clearance'].note, /API 로 조회할 수 없다/);
  assert.ok(dict.FIELDS['corp.biz_no']);
  assert.match(dict.FIELDS['corp.biz_no'].note, /10자리/);
});

test('★ 법인 보고서가 「하지 않은 조회」에 둘을 적는다', () => {
  const cr = require('../core/corpreport');
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 30 });
  const t = r.sections.find(s => s.title === '하지 않은 계산·조회').text;
  assert.match(t, /납세증명·체납 조회/);
  assert.match(t, /4대보험 완납 조회/);
  assert.match(t, /법이 막고 있기 때문/);
});

/* ── 실재 점검 절 ───────────────────────────────────── */

test('★ 실재 점검이 결론 뒤에 온다 — 값이 아니라 뒷받침이다', () => {
  const cr = require('../core/corpreport');
  const r = cr.build({ projectId: 'P1', corpName: '○○개발(주)', netAsset: 180, income1: 24, income2: 18, income3: 12, realEstatePct: 30 });
  const iConc = r.sections.findIndex(s => s.title === '결론');
  const iExist = r.sections.findIndex(s => s.title === '실재 점검');
  assert.ok(iExist > iConc);
});

test('★ 점검을 안 했으면 **무엇을 넣어야 하는지** 말한다', () => {
  const cr = require('../core/corpreport');
  const t = cr.sectionExistence(null);
  assert.match(t, /corp\.biz_no/);
  assert.match(t, /사업자등록번호\(10자리\)/);
});

test('★ 완납증명은 미제출이면 미제출이라고 적는다', () => {
  const cr = require('../core/corpreport');
  const t = cr.sectionExistence({ status: { text: '계속사업자' } });
  assert.match(t, /미제출/);
  assert.match(t, /당사자 발급분을 받아야 한다/);
});

test('★ 인원이 적은 것이 결함이 아니라는 말이 문서에 있다', () => {
  const cr = require('../core/corpreport');
  const t = cr.sectionExistence({ workplace: { text: '가입자 4명' } });
  assert.match(t, /인원이 적은 것은 결함이 아니다/);
  assert.match(t, /3인 이상/);
});

/* ── 공통 ───────────────────────────────────────────── */

test('★ 쿼터 버킷이 data.go.kr 로 합쳐져 있다 — 같은 키다', () => {
  // ★ 나누면 한도를 두 배로 쓰게 된다 (`g2b` 에서 실제로 그랬다)
  assert.strictEqual(nts.PROVIDER, 'data.go.kr');
  assert.strictEqual(nps.PROVIDER, 'data.go.kr');
});

test('★ 키가 로그에 평문으로 남지 않는다 (§2)', async () => {
  await withEnv({ DATA_GO_KR_KEY: 'D'.repeat(40) }, () => {
    assert.ok(!nts.mask(`serviceKey=${'D'.repeat(40)}`).includes('D'.repeat(40)));
    assert.ok(!nps.mask(`serviceKey=${'D'.repeat(40)}`).includes('D'.repeat(40)));
  });
});

test('★ 같은 사업자를 두 번 물어도 API 는 한 번만 탄다 (§4.5)', async () => {
  await withFake({ status_code: 'OK', data: [{ b_no: '1234567890', b_stt: '계속사업자' }] }, async (calls) => {
    await nts.status('1234567890');
    await nts.status('123-45-67890');   // 같은 번호를 다르게 적어도
    assert.strictEqual(calls.length, 1);
  });
});
