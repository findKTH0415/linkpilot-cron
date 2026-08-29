'use strict';
/**
 * gemini-recover.test.js — **열쇠 여덟이 통째로 굳지 않는다** 〈2026-08-29 · D-166〉.
 *
 * 사장님 화면: `GEMINI_ALL_KEYS_UNAVAILABLE — 지금 고를 수 있는 열쇠가 없다
 * (전부 쉬는 중이거나 폐기됨)` → **PDF 를 한 건도 못 읽었다.**
 * 같은 시각 NAS 진단: **「열쇠 확인: 살아 있다 — 구글이 받아들였다」.**
 * 둘 다 사실이었다.
 *
 * 원인 둘:
 *   ① `403` 을 `401` 과 같이 다뤄 **영구 폐기**했다. 구글은 한도·권한·지역
 *      차단에도 403 을 준다 — OCR 은 문서 한 건에도 요청을 여러 번 쓰므로
 *      한도에 닿는 순간 **여덟이 줄줄이 폐기되고 굳었다.**
 *   ② 폐기된 열쇠를 **자동으로 다시 물어보는 길이 없었다.** 사람이 손으로
 *      깨워야 했는데 **아무도 그것을 눌러야 하는 줄 모른다.**
 *
 * ★ 이 검사는 **진짜 Gemini 를 부르지 않는다.** 고르고 적는 규칙만 잰다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** 열쇠와 상태 파일을 시험용 자리로 돌린다 — 운영 상태 파일을 건드리지 않는다 */
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-keys-'));
  process.env.LP_STATE_DIR = dir;
  for (let i = 1; i <= 8; i++) {
    process.env[i === 1 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${i}`] = 'AIza-test-key-' + i;
  }
  delete require.cache[require.resolve('../core/gemini-keys.js')];
  const keys = require('../core/gemini-keys.js');
  keys.reload();
  return { keys, dir };
}

test('403 은 열쇠를 버리지 않는다 — 쉬게 할 뿐이다', () => {
  const { keys } = fresh();
  const k = keys.selectNext();
  assert.ok(k, '고를 열쇠가 없다 — 준비가 잘못됐다');
  const rest = keys.recordForbidden(k, 403, 'RESOURCE_EXHAUSTED');
  assert.strictEqual(k.status, keys.STATE.QUOTA_LIMITED,
    '403 으로 폐기했다 — 한도가 풀려도 아무도 안 쓰게 된다');
  assert.notStrictEqual(k.status, keys.STATE.INVALID);
  assert.strictEqual(rest, keys.FORBIDDEN_REST_SECONDS);
  assert.ok(k.cooldownUntil > Date.now(), '쉬는 시각을 안 정했다');
});

test('401 은 그대로 폐기한다 — 다만 다시 물어볼 시각을 남긴다', () => {
  const { keys } = fresh();
  const k = keys.selectNext();
  keys.recordAuthError(k, 401);
  assert.strictEqual(k.status, keys.STATE.INVALID, '401 인데 안 버린다');
  assert.ok(k.revalidateAt > Date.now(),
    '다시 물어볼 시각이 없다 — 영원히 죽은 열쇠가 된다');
});

/**
 * ★★★ 이 검사가 이번 사고의 **핵심**이다. 여덟이 다 죽어도 **다음 요청이
 *   하나를 깨워** 써 본다. 그래야 「한도가 풀렸는지」를 알 방법이 생긴다.
 */
test('★★★ 여덟이 다 죽어도 하나를 깨워서 써 본다', () => {
  const { keys } = fresh();
  const all = keys.ensure();
  all.forEach((k) => keys.recordForbidden(k, 403, 'quota'));
  assert.strictEqual(keys.available().length, 0, '준비가 잘못됐다 — 아직 쓸 것이 남았다');

  const k = keys.selectNext();
  assert.ok(k, '전부 잠기자 아무도 안 깨웠다 — 사람이 누르기 전까지 서비스가 멈춘다');
  assert.strictEqual(k.status, keys.STATE.VALIDATING,
    '깨웠는데 「아직 못 믿는다」로 두지 않았다');
});

test('★★ 쓸 수 있는 것이 하나라도 있으면 깨우지 않는다', () => {
  const { keys } = fresh();
  const all = keys.ensure();
  all.slice(1).forEach((k) => keys.recordForbidden(k, 403, 'quota'));
  const before = all.slice(1).map((k) => k.status);
  keys.selectNext();
  assert.deepStrictEqual(all.slice(1).map((k) => k.status), before,
    '멀쩡한 열쇠를 두고 쉬는 것을 깨웠다 — 쉬게 한 뜻이 사라진다');
});

/**
 * ★★★ 사람이 끈 것은 **한도가 아니라 결정**이다. 깨우면 그 결정을 뒤집는다.
 */
test('★★★ 사람이 끈 열쇠는 깨우지 않는다', () => {
  const { keys } = fresh();
  const all = keys.ensure();
  all.forEach((k) => keys.setEnabled(k.slot, false));
  assert.strictEqual(keys.selectNext(), null, '사람이 끈 열쇠를 깨웠다');
});

test('403 으로 쉰 열쇠는 시간이 지나면 스스로 깨어난다', () => {
  const { keys } = fresh();
  const k = keys.selectNext();
  keys.recordForbidden(k, 403, 'quota');
  k.cooldownUntil = Date.now() - 1;          // 쉴 시간이 끝난 것으로 둔다
  const ok = keys.available().some((x) => x.fp === k.fp);
  assert.ok(ok, '403 으로 쉰 열쇠가 영원히 안 깨어난다 — 429 만 깨우고 있다');
});

/**
 * ★★★ **다시 떠도 굳어 있으면 안 된다.** 앞 판은 상태 파일의 `INVALID` 를
 *   그대로 되살렸고 다시 물어볼 계획이 없어서, 배포를 해도 죽은 채였다.
 */
test('★★★ 다시 떠도 폐기가 영원히 이어지지 않는다', () => {
  const { keys } = fresh();
  const k = keys.selectNext();
  keys.recordAuthError(k, 401);
  k.revalidateAt = Date.now() - 1;           // 기한이 지난 것으로 둔다
  keys.recordSuccess(keys.ensure()[1], 10);  // 파일에 다시 적히게 한다
  const again = keys.reload();
  const same = again.find((x) => x.fp === k.fp);
  assert.notStrictEqual(same.status, keys.STATE.INVALID,
    '기한이 지났는데도 폐기로 되살렸다 — 배포를 해도 죽은 채로 남는다');
});

test('아직 기한이 안 지난 폐기는 그대로 잇는다 (매번 헛되이 두드리지 않는다)', () => {
  const { keys } = fresh();
  const k = keys.selectNext();
  keys.recordAuthError(k, 401);
  const again = keys.reload();
  const same = again.find((x) => x.fp === k.fp);
  assert.strictEqual(same.status, keys.STATE.INVALID);
  assert.ok(same.revalidateAt > Date.now(), '다시 물어볼 시각을 안 이었다');
});

/**
 * ★★★ **한 요청에 하나만 깨운다** 〈D-166 · 스스로 잡은 결함〉.
 *
 * 부르는 쪽(`llm.js`)은 실패할 때마다 `skip` 을 늘려 가며 `selectNext` 를 다시
 * 부른다. 그대로 두면 **한 요청이 여덟을 전부 깨워** 쉬게 한 뜻이 사라진다 —
 * 한도가 안 풀렸는데 여덟 번 더 두드리는 셈이다.
 */
test('★★★ 한 요청에 하나만 깨운다 (여덟을 줄줄이 깨우지 않는다)', () => {
  const { keys } = fresh();
  keys.ensure().forEach((k) => keys.recordForbidden(k, 403, 'quota'));

  const first = keys.selectNext();               // 첫 시도 — 하나 깨운다
  assert.ok(first, '첫 시도에서 아무도 안 깨웠다');

  const skip = new Set([first.fp]);
  const second = keys.selectNext(skip);          // 같은 요청의 두 번째 시도
  assert.strictEqual(second, null,
    '같은 요청에서 또 깨웠다 — 한도가 안 풀렸는데 여덟 번 더 두드린다');

  // 깨어난 것은 정확히 하나여야 한다
  const awake = keys.ensure().filter((k) => k.status === keys.STATE.VALIDATING);
  assert.strictEqual(awake.length, 1, `깨어난 열쇠가 ${awake.length}개다`);
});
