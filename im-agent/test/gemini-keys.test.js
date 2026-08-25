'use strict';
/**
 * gemini-keys.test.js — 열쇠 여섯을 다루는 규칙을 고정한다 (D-104 · 지시서 §26).
 *
 * ★★★ **여기서 진짜 Gemini 를 부르지 않는다.** 시험이 그물을 타면
 *   ① CI 가 열쇠를 갖게 되고 ② 재는 행위가 곧 한도 소모가 되며
 *   ③ 구글이 느린 날 우리 시험이 빨개진다. `fetch` 를 갈아 끼워 잰다.
 *
 * ★ 실제로 살아 있는지는 **사람이 `npm run gemini:keys` 로** 잰다. 그것과
 *   이것은 다른 일이다 — 하나는 규칙, 하나는 사실이다.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

/* ★ 상태 파일이 저장소를 더럽히지 않게 — **읽기 전에** 정한다 */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-gemkeys-'));
process.env.LP_STATE_DIR = TMP;
process.env.GEMINI_MODELS = 'test-model';
delete process.env.IM_AGENT_OFFLINE;

const keys = require('../core/gemini-keys');

/** 열쇠 n 개를 넣고 풀을 다시 세운다 */
function setKeys(list) {
  for (let i = 1; i <= 8; i++) {
    delete process.env[`GEMINI_KEY_${String(i).padStart(2, '0')}`];
    if (i > 1) delete process.env[`GEMINI_API_KEY_${i}`];
  }
  delete process.env.GEMINI_API_KEY;
  list.forEach((v, i) => { process.env[`GEMINI_KEY_${String(i + 1).padStart(2, '0')}`] = v; });
  try { fs.unlinkSync(keys.statePath()); } catch (_) { /* 없으면 그만 */ }
  return keys.reload();
}

/* ═════════ ① 슬롯 읽기 ═════════ */

test('★ 여덟 슬롯을 읽는다 — 아홉째는 안 받는다', () => {
  const pool = setKeys(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  assert.strictEqual(pool.length, 8, '아홉째가 들어왔거나 여덟이 안 찼다');
  assert.deepStrictEqual(pool.map(k => k.slot), [1, 2, 3, 4, 5, 6, 7, 8]);
});

/**
 * ★★★ **사장님이 실제로 넣으신 이름을 읽는다** 〈2026-08-25 · 실제로 어긋났다〉.
 *   나는 `GEMINI_KEY_01` 로 안내해 놓고 사장님은 `GEMINI_API_KEY_2` … `_8` 로
 *   넣으셨다. 그 상태로 두면 여덟 개가 Secrets 에 멀쩡히 있는데 엔진은
 *   **하나만** 본다 — 넣은 사람은 넣었다고 알고, 배포는 초록이다 (M-40 의 결).
 */
test('★★★ GEMINI_API_KEY_2 … _8 도 슬롯으로 읽는다 (다시 넣게 하지 않는다)', () => {
  setKeys([]);
  process.env.GEMINI_API_KEY = 'one';
  for (let i = 2; i <= 8; i++) process.env[`GEMINI_API_KEY_${i}`] = `k${i}`;
  const pool = keys.reload();
  assert.strictEqual(pool.length, 8, `여덟이 아니다: ${pool.map(k => k.from).join(',')}`);
  assert.strictEqual(pool[1].from, 'GEMINI_API_KEY_2');
  assert.strictEqual(pool[7].from, 'GEMINI_API_KEY_8');
  setKeys([]);
});

/**
 * ★★★ **옛 이름을 버리지 않는다.** 지금 NAS 에 들어 있는 열쇠는
 *   `GEMINI_API_KEY` 하나다. 새 이름으로 옮기기 전에 이것이 안 읽히면
 *   **배포하는 순간 OCR 이 꺼진다** — 그리고 화면은 초록이다 (M-40 의 결).
 */
test('★★★ 옛 이름(GEMINI_API_KEY)도 슬롯에 들어간다', () => {
  setKeys([]);
  process.env.GEMINI_API_KEY = 'old-one';
  const pool = keys.reload();
  assert.strictEqual(pool.length, 1);
  assert.strictEqual(pool[0].from, 'GEMINI_API_KEY');
  delete process.env.GEMINI_API_KEY;
});

test('★ 옛 이름의 쉼표 목록이 남은 슬롯을 채운다 · 같은 열쇠는 두 번 안 들어간다', () => {
  setKeys(['a']);
  process.env.GEMINI_API_KEY = 'a, b , c';
  const pool = keys.reload();
  assert.strictEqual(pool.length, 3, 'a 는 이미 슬롯 1 에 있으므로 b·c 만 더해진다');
  assert.strictEqual(new Set(pool.map(k => k.fp)).size, 3);
  delete process.env.GEMINI_API_KEY;
});

/* ═════════ ② 지문 — 보안 ═════════ */

/**
 * ★★★ **열쇠 글자가 밖으로 안 나간다** (지시서 §19·§23·§24 · CLAUDE.md §2).
 *   이 저장소는 public 이고 응답은 브라우저 개발자도구에 그대로 보인다.
 */
test('★★★ 내보내는 어디에도 열쇠 글자가 없다', () => {
  const secret = 'AIzaSyTOTALLY-NOT-A-REAL-KEY-0123456789';
  setKeys([secret]);
  const snap = keys.snapshot();
  const asText = JSON.stringify(snap);
  assert.ok(!asText.includes(secret), '요약에 열쇠가 통째로 들어 있다');
  assert.ok(!asText.includes(secret.slice(-4)), '요약에 열쇠 끝 네 글자가 들어 있다');
  assert.ok(!asText.includes(secret.slice(0, 8)), '요약에 열쇠 앞머리가 들어 있다');
  assert.match(snap.keys[0].fingerprint, /^[0-9a-f]{12}$/, '지문이 해시가 아니다');
});

test('★★ 적어 두는 파일에도 열쇠가 없다', () => {
  const secret = 'AIzaSy-file-check-0123456789abcdef';
  setKeys([secret]);
  keys.recordSuccess(keys.ensure()[0], 10);
  const raw = fs.readFileSync(keys.statePath(), 'utf8');
  assert.ok(!raw.includes(secret), '상태 파일에 열쇠가 평문으로 적혔다');
  assert.ok(raw.includes('"fp"'), '지문조차 안 적혀 무엇이 무엇인지 못 잇는다');
});

/* ═════════ ③ 돌아가며 쓰기 ═════════ */

test('★★ 돌아가며 쓴다 — 한 열쇠에 몰리지 않는다', () => {
  setKeys(['a', 'b', 'c']);
  const seen = [];
  for (let i = 0; i < 9; i++) seen.push(keys.selectNext().slot);
  const counts = [1, 2, 3].map(s => seen.filter(x => x === s).length);
  assert.deepStrictEqual(counts, [3, 3, 3], `고르게 안 돈다: ${seen.join(',')}`);
});

test('★ 한 요청 안에서 같은 열쇠를 두 번 집지 않는다', () => {
  setKeys(['a', 'b', 'c']);
  const skip = new Set();
  const got = [];
  for (let i = 0; i < 3; i++) {
    const k = keys.selectNext(skip);
    skip.add(k.fp);
    got.push(k.slot);
  }
  assert.strictEqual(new Set(got).size, 3);
  assert.strictEqual(keys.selectNext(skip), null, '넷째를 내놓았다 — 셋뿐인데');
});

/* ═════════ ④ 429 · 쉬기 · 되살리기 ═════════ */

test('★★★ 429 를 맞은 열쇠는 **곧바로 고르기에서 빠진다**', () => {
  setKeys(['a', 'b', 'c']);
  const first = keys.ensure()[0];
  keys.recordRateLimit(first);
  assert.strictEqual(first.status, keys.STATE.COOLDOWN);
  const seen = new Set();
  for (let i = 0; i < 6; i++) seen.add(keys.selectNext().slot);
  assert.ok(!seen.has(1), '쉬는 중인 열쇠를 또 집었다 — 앞 판이 이랬다');
});

test('★ 연달아 맞을수록 더 오래 쉰다 (60 → 120 → 300 → 600)', () => {
  setKeys(['a']);
  const k = keys.ensure()[0];
  const got = [1, 2, 3, 4, 5].map(() => keys.recordRateLimit(k));
  assert.deepStrictEqual(got, [60, 120, 300, 600, 600], '사다리가 다르다');
});

/**
 * ★★★ **식었다고 곧바로 ACTIVE 로 두지 않는다** (지시서 §11).
 *   아직 아무것도 확인하지 않았다. `ACTIVE` 로 적으면 화면이
 *   「살아 있다」고 말하는데 그것을 뒷받침하는 호출이 하나도 없다.
 */
test('★★★ 쉼이 끝나면 ACTIVE 가 아니라 「다시 물어봐야 함」이 된다', () => {
  setKeys(['a']);
  const k = keys.ensure()[0];
  keys.recordRateLimit(k);
  k.cooldownUntil = Date.now() - 1;          // 시간이 지난 셈 친다
  const list = keys.available();
  assert.strictEqual(list.length, 1, '식었는데도 못 고른다');
  assert.strictEqual(k.status, keys.STATE.VALIDATING, 'ACTIVE 로 건너뛰었다');
});

test('★ 성공하면 ACTIVE 가 되고 쉼이 풀린다', () => {
  setKeys(['a']);
  const k = keys.ensure()[0];
  keys.recordRateLimit(k);
  keys.recordSuccess(k, 120);
  assert.strictEqual(k.status, keys.STATE.ACTIVE);
  assert.strictEqual(k.cooldownUntil, 0);
  assert.strictEqual(keys.snapshot().keys[0].avgLatencyMs, 120);
});

/* ═════════ ⑤ 401 · 403 ═════════ */

test('★★★ 401·403 은 풀에서 아주 빠진다 — 사람이 되살릴 수 있다', () => {
  setKeys(['a', 'b']);
  const k = keys.ensure()[0];
  keys.recordAuthError(k, 403);
  assert.strictEqual(k.status, keys.STATE.INVALID);
  assert.ok(!keys.available().some(x => x.slot === 1), '거부된 열쇠를 또 고른다');
  keys.revalidate(1);
  assert.ok(keys.available().some(x => x.slot === 1), '사람이 되살릴 길이 없다');
});

/* ═════════ ⑥ 5xx — 열쇠를 버리지 않는다 ═════════ */

test('★★ 5xx 는 열쇠를 폐기하지 않는다 (구글 쪽 일이다)', () => {
  setKeys(['a']);
  const k = keys.ensure()[0];
  keys.recordServerError(k, 503);
  assert.strictEqual(k.status, keys.STATE.TEMP_ERROR);
  assert.ok(keys.available().some(x => x.slot === 1), '구글이 아픈 날 우리 열쇠를 버렸다');
});

/* ═════════ ⑦ 다시 켜기 · 통계 ═════════ */

test('★ 사람이 끄면 안 골라진다', () => {
  setKeys(['a', 'b']);
  keys.setEnabled(1, false);
  assert.ok(!keys.available().some(x => x.slot === 1));
  keys.setEnabled(1, true);
  assert.ok(keys.available().some(x => x.slot === 1));
});

/**
 * ★★★ **껐다 켜도 이력이 남는다** (지시서 §「서버 재시작 후 상태 복구」).
 *   그리고 **지문으로 잇는다** — 슬롯 번호로 이으면 사람이 열쇠를 옮긴 날
 *   3번의 실패 이력이 5번에 붙고, 멀쩡한 열쇠를 버리게 된다.
 */
test('★★★ 다시 시작해도 통계가 이어진다 — 슬롯을 옮겨도 따라간다', () => {
  setKeys(['aaa', 'bbb']);
  const k = keys.ensure()[0];
  keys.recordRateLimit(k);
  keys.recordRateLimit(k);
  const fp = k.fp;

  /* 슬롯을 맞바꾼다 — 사람이 흔히 하는 일이다 */
  process.env.GEMINI_KEY_01 = 'bbb';
  process.env.GEMINI_KEY_02 = 'aaa';
  const again = keys.reload();
  const moved = again.find(x => x.fp === fp);
  assert.strictEqual(moved.slot, 2, '옮긴 열쇠를 못 찾았다');
  assert.strictEqual(moved.rateLimitCount, 2, '이력이 슬롯을 따라갔다 — 열쇠를 따라가야 한다');
  assert.strictEqual(again.find(x => x.slot === 1).rateLimitCount, 0,
    '남의 이력이 붙었다 — 이 상태로는 멀쩡한 열쇠를 버리게 된다');
});

test('★ 통계 지우기는 상태를 안 건드린다', () => {
  setKeys(['a']);
  const k = keys.ensure()[0];
  keys.recordAuthError(k, 401);
  keys.resetStats();
  assert.strictEqual(k.authErrorCount, 0);
  assert.strictEqual(k.status, keys.STATE.INVALID, '통계를 지우면서 폐기까지 풀었다');
});

/* ═════════ ⑧ 알림 ═════════ */

test('★★ 쓸 수 있는 열쇠가 셋 아래로 내려가면 알린다 (지시서 §27)', () => {
  setKeys(['a', 'b', 'c', 'd']);
  keys.recordAuthError(keys.ensure()[0], 401);
  keys.recordAuthError(keys.ensure()[1], 401);
  const snap = keys.snapshot();
  assert.ok(snap.alerts.some(a => /셋 아래/.test(a.text)), `알림이 없다: ${JSON.stringify(snap.alerts)}`);
  assert.ok(snap.alerts.some(a => a.level === 'red'), '거부된 열쇠를 빨갛게 안 알린다');
});

test('★★ 열쇠가 하나도 없으면 그렇게 말한다 (「전부 죽었다」와 다른 말이다)', () => {
  setKeys([]);
  const snap = keys.snapshot();
  assert.strictEqual(snap.registered, 0);
  assert.ok(snap.alerts.some(a => /등록된 Gemini 열쇠가 없습니다/.test(a.text)));
});

/* ═════════ ⑨ 동시 요청 ═════════ */

/**
 * ★★ 지시서 §14 — 동시에 여러 요청이 들어와도 한 열쇠에 몰리지 않아야 한다.
 *   ★ 이 엔진은 **한 프로세스**로 돈다. 그래서 정수 하나를 올리는 것으로
 *     충분하고, 아래가 그것을 잰다. 프로세스를 늘리는 날에는 이 검사가
 *     **먼저 빨개져야** 한다 — 고르는 곳이 한 곳이므로 거기만 고치면 된다.
 */
test('★★ 동시에 100번 골라도 고르게 퍼진다', async () => {
  setKeys(['a', 'b', 'c', 'd']);
  const got = await Promise.all(
    Array.from({ length: 100 }, () => Promise.resolve().then(() => keys.selectNext().slot)),
  );
  const counts = [1, 2, 3, 4].map(s => got.filter(x => x === s).length);
  assert.deepStrictEqual(counts, [25, 25, 25, 25], `쏠렸다: ${counts.join(',')}`);
});

/* ═════════ ⑩ llm.js — 실제 갈아타기 ═════════ */

/** `fetch` 를 갈아 끼운다. 열쇠(헤더)마다 다른 답을 준다 */
function stubFetch(byKey) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const key = (opts && opts.headers && opts.headers['x-goog-api-key'])
      || String(url).split('key=')[1] || '';
    calls.push(key);
    const want = byKey[key];
    if (typeof want === 'number') {
      return { ok: false, status: want, json: async () => ({ error: { message: `HTTP ${want}` } }), text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'text', text: want }] }] }),
      text: async () => '',
    };
  };
  return calls;
}

test('★★★ 429 를 맞으면 **다음 열쇠로 넘어가 사용자는 정상 응답을 받는다**', async () => {
  setKeys(['k1', 'k2', 'k3']);
  const real = global.fetch;
  const calls = stubFetch({ k1: 429, k2: '됐습니다', k3: '됐습니다' });
  try {
    const llm = require('../core/llm');
    const out = await llm.generate({ prompt: '안녕' });
    /* ★ 재는 것은 **차례가 아니라 결과**다. 어느 열쇠가 이어받는지는 고르기
     *   차례에 달렸고 그것은 여기서 중요한 것이 아니다. 중요한 것은 셋이다 —
     *   ① 사용자에게 정상 응답이 갔다 ② 첫 열쇠부터 썼다 ③ 그것을 재웠다. */
    assert.strictEqual(out, '됐습니다');
    assert.strictEqual(calls[0], 'k1', '첫 열쇠를 안 썼다');
    assert.strictEqual(calls.length, 2, `두 번이면 끝나야 한다: ${calls.join(',')}`);
    assert.strictEqual(keys.ensure()[0].status, keys.STATE.COOLDOWN, '429 열쇠를 안 재웠다');
  } finally { global.fetch = real; }
});

test('★★ 401 을 맞은 열쇠는 그 자리에서 빠지고 다음 열쇠가 답한다', async () => {
  setKeys(['k1', 'k2']);
  const real = global.fetch;
  stubFetch({ k1: 401, k2: '됐습니다' });
  try {
    const llm = require('../core/llm');
    assert.strictEqual(await llm.generate({ prompt: '안녕' }), '됐습니다');
    assert.strictEqual(keys.ensure()[0].status, keys.STATE.INVALID);
  } finally { global.fetch = real; }
});

test('★★★ 여섯이 다 안 되면 GEMINI_ALL_KEYS_UNAVAILABLE 로 끝난다', async () => {
  setKeys(['k1', 'k2', 'k3']);
  const real = global.fetch;
  stubFetch({ k1: 429, k2: 429, k3: 429 });
  try {
    const llm = require('../core/llm');
    await assert.rejects(
      () => llm.generate({ prompt: '안녕' }),
      (e) => e.code === 'GEMINI_ALL_KEYS_UNAVAILABLE',
      '전부 실패했는데 다른 오류로 끝났다 — 무엇을 고쳐야 하는지가 사라진다',
    );
  } finally { global.fetch = real; }
});

/**
 * ★★★ **404 는 열쇠 탓이 아니다.** 모델 목록에는 이 계정에 없는 것이 섞여
 *   있다(경위는 `llm.js` 머리말). 그것을 열쇠 실패로 세면 **멀쩡한 열쇠
 *   여섯이 첫 모델에서 전부 죽는다.**
 */
test('★★★ 모델이 없어서 난 404 로 열쇠를 버리지 않는다', async () => {
  setKeys(['k1']);
  const real = global.fetch;
  stubFetch({ k1: 404 });
  try {
    const llm = require('../core/llm');
    await assert.rejects(() => llm.generate({ prompt: '안녕' }));
    assert.notStrictEqual(keys.ensure()[0].status, keys.STATE.INVALID,
      '모델이 없다는 404 로 열쇠를 폐기했다');
    assert.strictEqual(keys.ensure()[0].authErrorCount, 0);
  } finally { global.fetch = real; }
});

test('★ 열쇠가 하나도 없으면 오프라인이다 (전부 쉬는 것과 다른 말이다)', () => {
  setKeys([]);
  const llm = require('../core/llm');
  assert.strictEqual(llm.isOffline(), true);
  setKeys(['k1']);
  assert.strictEqual(llm.isOffline(), false);
  keys.recordRateLimit(keys.ensure()[0]);
  assert.strictEqual(llm.isOffline(), false, '전부 쉬는 것을 「열쇠 없음」으로 말한다');
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 그만 */ } });
