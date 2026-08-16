'use strict';
/**
 * kepco.test.js — 전력계통 여유 Connector (등록부 D-54).
 *
 * 이 커넥터에서 조용히 틀릴 수 있는 자리는 넷이다.
 *
 *  ① **거리를 지어낸다.** 변전소 좌표는 공개되지 않는데, 언젠가 누가 좌표를
 *     짐작해 채우면 그 거리는 문서에서 진짜 거리와 구분되지 않는다.
 *  ② **직선/선로 기준을 잃는다.** 실무상 1.3~2배 갈리는데 「3.2km」만 남으면
 *     어느 쪽인지 알 수 없다.
 *  ③ **셋 중 하나만 본다.** 변전소·주변압기·배전선로가 모두 여유가 있어야
 *     접속이 되는데, 가장 큰 것만 보면 통과처럼 보인다.
 *  ④ **여유가 「접속 가능」이 된다.** 대기열이 이 자료에 없다.
 *
 * 넷 다 **결과가 그럴듯해서** 문서만 봐서는 안 잡힌다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const kepco = require('../connectors/kepco');
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kepco-cache-'));
  return withEnv({ KEPCO_BIGDATA_KEY: 'K'.repeat(40), IM_AGENT_CACHE: tmp }, () => fn(calls))
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

const LINE = (o) => Object.assign({
  subst_nm: '○○변전소', mtr_nm: '#1 M.Tr', dl_nm: 'DL-01',
  subst_cap: '50', mtr_cap: '30', dl_cap: '10', base_ym: '202608',
}, o);

/* ── ① 거리는 짓지 않는다 ─────────────────────────────── */

test('변전소 거리 자동 산출을 **거절한다** — 좌표가 공개되지 않는다', () => {
  const r = kepco.substationDistance();
  assert.equal(r.ok, false);
  // ★ 「아직 안 붙였다」가 아니라 **못 하는 것**임이 드러나야 한다.
  //   byDesign 이 없으면 다음 사람이 "구현하면 되겠네" 하고 좌표를 짐작한다
  assert.equal(r.byDesign, true);
  assert.match(r.error, /비식별/);
  assert.match(r.error, /사람이 넣는다/);
});

/* ── ② 거리 기준을 잃지 않는다 ────────────────────────── */

test('기준(직선/선로)을 안 밝히면 거리를 받지 않는다', () => {
  const r = kepco.humanDistance({ substation: '○○변전소', km: 3.2 });
  assert.equal(r.ok, false);
  assert.match(r.error, /1\.3~2배/);
});

test('직선거리로 받으면 **선로거리가 더 길다는 사실**을 함께 낸다', () => {
  const r = kepco.humanDistance({ substation: '○○변전소', km: 3.2, basis: '직선' });
  assert.equal(r.ok, true);
  assert.equal(r.value.basis, kepco.BASIS.STRAIGHT);
  assert.match(r.value.text, /1\.3~2배/);
});

test('선로거리로 받으면 그 경고를 붙이지 않는다 — 이미 선로 기준이다', () => {
  const r = kepco.humanDistance({ substation: '○○변전소', km: 4.5, basis: '선로', reviewedAt: '2026-07-30' });
  assert.equal(r.ok, true);
  assert.equal(r.value.basis, kepco.BASIS.ROUTE);
  assert.ok(!/1\.3~2배/.test(r.value.text));
  assert.match(r.value.text, /2026-07-30/);
});

test('회신일이 없으면 **없다고 적는다** — 언제 기준인지 모른다', () => {
  const r = kepco.humanDistance({ substation: '○○변전소', km: 4.5, basis: 'route' });
  assert.equal(r.ok, true);
  assert.equal(r.value.reviewedAt, null);
  assert.match(r.value.text, /회신일 미상/);
  assert.match(r.value.source.note, /언제 기준인지 모른다/);
});

test('사람이 넣은 값임이 출처에 남는다 — 자동 조회값과 섞이면 안 된다', () => {
  const r = kepco.humanDistance({ substation: '○○변전소', km: 4.5, basis: 'route' });
  assert.match(r.value.source.note, /사람이 회신받아 입력했다/);
});

test('**인입 공사비를 내지 않는다** (§4.8) — 단가가 가정이다', () => {
  const r = kepco.humanDistance({ substation: '○○변전소', km: 4.5, basis: 'route' });
  assert.equal(r.value.cost, null);
  assert.match(r.value.costNote, /가정/);
});

test('변전소명 없이 거리만 적을 수 없다', () => {
  const r = kepco.humanDistance({ km: 3.2, basis: '직선' });
  assert.equal(r.ok, false);
});

/* ── ③ 셋을 모두 본다 ────────────────────────────────── */

test('셋 중 **가장 작은 것**이 기준이다 — 큰 것만 보면 통과로 보인다', () => {
  // 변전소 50MW · 주변압기 30MW · 배전선로 10MW → 실제로 앉는 것은 10MW 까지다
  const rows = [{ substation: 'A', transformer: '#1', line: 'DL-01', substationMw: 50, transformerMw: 30, lineMw: 10 }];
  const r = kepco.headroom(rows, 20);
  assert.equal(r.ok, true);
  assert.equal(r.value.status, kepco.STATUS.SHORT);
  assert.equal(r.value.bestMw, 10);
});

test('여유가 요구를 넘으면 확인으로 세되 **접속 가능이라 말하지 않는다**', () => {
  const rows = [{ substation: 'A', transformer: '#1', line: 'DL-01', substationMw: 50, transformerMw: 40, lineMw: 30 }];
  const r = kepco.headroom(rows, 20);
  assert.equal(r.value.status, kepco.STATUS.CONFIRMED);
  // ★ 이 문장이 빠지면 「여유 있음」이 「접속 가능」으로 읽힌다 — 대기열은 이 자료에 없다
  assert.match(r.value.text, /접속 가능을 뜻하지 않는다/);
  assert.match(r.value.text, /대기열/);
});

test('수전용량이 없으면 견주지 않는다 — 0 으로 두지 않는다', () => {
  const rows = [{ substationMw: 50, transformerMw: 40, lineMw: 30 }];
  assert.equal(kepco.headroom(rows, null).ok, false);
  assert.equal(kepco.headroom(rows, '').ok, false);   // Number('') === 0 (M-07)
});

test('여유 수치가 통째로 비면 견주지 못했다고 한다 — 0 으로 보지 않는다', () => {
  const rows = [{ substation: 'A', substationMw: null, transformerMw: null, lineMw: null }];
  const r = kepco.headroom(rows, 20);
  assert.equal(r.ok, false);
});

/* ── ④ 판정이 「모름」을 통과로 세지 않는다 ─────────────── */

test('SHORT·UNKNOWN 은 통과 목록에 없다', () => {
  assert.ok(!kepco.CLEARED.includes(kepco.STATUS.SHORT));
  assert.ok(!kepco.CLEARED.includes(kepco.STATUS.UNKNOWN));
  assert.deepEqual(kepco.CLEARED, [kepco.STATUS.CONFIRMED, kepco.STATUS.NOT_APPLICABLE]);
});

test('하나라도 확인 안 되면 cleared 가 아니다', () => {
  const v = kepco.verdict([
    { kind: 'a', label: '여유용량', status: kepco.STATUS.CONFIRMED },
    { kind: 'b', label: '변전소 거리', status: kepco.STATUS.UNKNOWN },
  ]);
  assert.equal(v.cleared, false);
  assert.match(v.text, /「확인되지 않음」은 「문제 없음」이 아니다/);
});

test('전부 확인돼도 **접속 가능이라 말하지 않는다**', () => {
  const v = kepco.verdict([{ kind: 'a', label: '여유용량', status: kepco.STATUS.CONFIRMED }]);
  assert.equal(v.cleared, true);
  assert.match(v.text, /접속 가능을 뜻하지 않는다/);
});

test('빈 목록은 통과가 아니다', () => {
  assert.equal(kepco.verdict([]).cleared, false);
});

/* ── 조회 ────────────────────────────────────────────── */

test('지역을 특정하지 못하면 **부르지 않는다** — 전국 값으로 대체하지 않는다', async () => {
  await withFake(payload([LINE()]), async (calls) => {
    const r = await kepco.capacity({ region: '' });
    assert.equal(r.ok, false);
    assert.match(r.error, /전국 값으로 대체하지 않는다/);
    assert.equal(calls.length, 0);   // 호출 자체가 없어야 한다 (§4.5)
  });
});

test('키가 없으면 unavailable — 지어내지 않는다 (§4.6)', async () => {
  await withEnv({ KEPCO_BIGDATA_KEY: undefined }, async () => {
    const r = await kepco.capacity({ region: '충청남도 보령시' });
    assert.equal(r.ok, false);
    assert.equal(r.unavailable, true);
    // ★ data.go.kr 키와 헷갈리면 「키 있는데 왜 안 되지」로 몇 시간이 간다
    assert.match(r.error, /data\.go\.kr 키가 아니다/);
  });
});

test('조회 결과가 비면 **「여유가 없다」고 말하지 않는다**', async () => {
  await withFake(payload([]), async () => {
    const r = await kepco.capacity({ region: '충청남도 보령시' });
    assert.equal(r.ok, false);
    assert.equal(r.noData, true);
    assert.match(r.error, /여유가 없다는 뜻이 아니다/);
  });
});

test('선로를 파싱하고 **모수와 스냅샷임을 출처에 남긴다** (§4.7)', async () => {
  await withFake(payload([LINE(), LINE({ dl_nm: 'DL-02', dl_cap: '25' })]), async () => {
    const r = await kepco.capacity({ region: '충청남도 보령시' });
    assert.equal(r.ok, true);
    assert.equal(r.value.rows.length, 2);
    assert.equal(r.value.rows[0].lineMw, 10);
    assert.equal(r.value.rows[1].lineMw, 25);
    assert.match(r.value.source.note, /2개 선로/);
    assert.match(r.value.source.note, /스냅샷/);
    assert.match(r.value.source.note, /대기열/);
  });
});

test('빈 문자열 용량이 0MW 가 되지 않는다 (M-07)', async () => {
  await withFake(payload([LINE({ dl_cap: '  ' })]), async () => {
    const r = await kepco.capacity({ region: '충청남도 보령시' });
    assert.equal(r.value.rows[0].lineMw, null);
  });
});

test('같은 지역을 두 번 불러도 API 는 한 번만 탄다 (§4.5)', async () => {
  await withFake(payload([LINE()]), async (calls) => {
    await kepco.capacity({ region: '충청남도 보령시' });
    await kepco.capacity({ region: '충청남도 보령시' });
    assert.equal(calls.length, 1);
  });
});

test('쿼터 버킷이 data.go.kr 과 **분리되어 있다** — 다른 포털·다른 키다', () => {
  assert.equal(kepco.PROVIDER, 'kepco');
  assert.notEqual(kepco.PROVIDER, 'data.go.kr');
});

test('여유용량 캐시는 **하루**다 — 접속 신청이 들어오면 줄어든다', () => {
  const cache = require('../connectors/cache');
  assert.equal(cache.TTL.grid, 86400);
});

test('키가 로그에 평문으로 남지 않는다 (§2)', async () => {
  await withEnv({ KEPCO_BIGDATA_KEY: 'K'.repeat(40) }, () => {
    assert.ok(!kepco.mask(`apiKey=${'K'.repeat(40)}&x=1`).includes('K'.repeat(40)));
  });
});

test('SECRET_ENV 에 등록되어 있다 — 빠지면 이 키만 조용히 평문으로 남는다', () => {
  assert.ok(http.SECRET_ENV.includes('KEPCO_BIGDATA_KEY'));
});
