'use strict';
/**
 * decision-conflict.test.js — 「안 하기로 정한 것」 탐지가 **뒤집어 읽지 않는지** 고정한다.
 *
 * ★★ **첫 판이 정반대를 말했다** 〈2026-08-26〉.
 *   D-119 는 Platform Manager 를 **만들기로** 정한 항목인데, 제목 아래 30줄을
 *   통째로 훑다가 「결정 전 기록」의 갈래 목록(`[ ] ③ 만들지 않고 …`)을 읽고
 *   **「만들지 않는다」로 뒤집어 읽었다.**
 *
 *   **정반대를 말하는 도구는 없는 것보다 나쁘다.** 그것을 보고 「만들지 말라고
 *   했었네」라고 판단하면 결정이 조용히 뒤집힌다.
 *
 * ★★ **거짓 경고를 안 내는 것이 이 검사의 절반이다.**
 *   결정을 가리키는 줄(`D-121(외출모드 — …)`)은 어기는 것이 아니라 가리키는 것이다.
 *   기록 문서(`삭제-후보.md`)에 나오는 것도 마찬가지다. 목록이 길면 진짜를 못 본다.
 */

const test = require('node:test');
const assert = require('node:assert');

const dc = require('../tools/decision-conflict');

/* ───────────── 뒤집어 읽지 않는다 ───────────── */

test('★★ 결정 전 기록의 갈래 목록을 결정으로 읽지 않는다 — 첫 판의 사고', () => {
  const doc = [
    '### ✅ D-119. `Platform Manager` — **만든다** 〈2026-08-26 결정〉',
    '',
    '> **결정** 만든다. 이름은 Platform Manager 다.',
    '',
    '<!-- 아래는 결정 전 기록 — 지우지 않는다 -->',
    '',
    '#### (결정 전) Platform Agent 를 만들 것인가',
    '- [ ] ③ 만들지 않고 Orchestrator 가 계속 한다',
  ].join('\n');
  const found = dc.negativeDecisions(doc);
  assert.deepStrictEqual(found, [],
    '만들기로 정한 항목을 「만들지 않는다」로 읽었다 — 결정이 조용히 뒤집힌다');
});

test('★ 진짜 부정 결정은 잡는다', () => {
  const doc = [
    '### ✅ D-121. 「외출모드」 — **만들지 않는다** 〈2026-08-26 결정〉',
    '',
    '> **결정** 만들지 않는다. 모바일 지원은 남는다.',
  ].join('\n');
  const found = dc.negativeDecisions(doc);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].id, 'D-121');
  assert.strictEqual(found[0].term, '외출모드');
});

test('★ 아직 안 정한 항목(🔴)은 보지 않는다', () => {
  const doc = '### 🔴 D-999. 「무언가」 — 만들지 않는다\n\n> 아직 안 정했다.';
  assert.deepStrictEqual(dc.negativeDecisions(doc), [],
    '정하지도 않은 것을 「정했다」로 세면 안 된다');
});

/* ───────────── 낱말 뽑기 ───────────── */

test('★ 낫표 안이 낱말이다', () => {
  assert.strictEqual(dc.termOf('### ✅ D-121. 「외출모드」 — 만들지 않는다 〈2026-08-26〉'), '외출모드');
});

test('★ 마크다운이 낱말에 섞이지 않는다', () => {
  assert.strictEqual(dc.clean('**폴더 연결을 켠다'), '폴더 연결을 켠다');
  assert.strictEqual(dc.clean('`코드`'), '코드');
});

test('★ 너무 긴 제목은 낱말로 쓰지 않는다 — 목록만 어지럽힌다', () => {
  const doc = [
    '### ✅ D-59. 「법인가치를 낼 문서가 아예 없을 때 어떻게 하는가」 — 하지 않는다',
    '> **결정** 하지 않는다.',
  ].join('\n');
  assert.deepStrictEqual(dc.negativeDecisions(doc), []);
});

/* ───────────── 거짓 경고를 안 낸다 ───────────── */

test('★★ 결정을 가리키는 줄은 「봐야 할 곳」이 아니다', () => {
  const r = dc.run();
  assert.ok(r.ok);
  for (const f of r.findings) {
    assert.ok(!/D-\d+/.test(f.text),
      `결정 번호를 인용한 줄이 올라왔다 — 가리키는 것이지 어기는 것이 아니다: ${f.text}`);
  }
});

test('★ 같은 줄이 두 번 올라오지 않는다', () => {
  const r = dc.run();
  const seen = new Set();
  for (const f of r.findings) {
    const key = `${f.file}:${f.line}`;
    assert.ok(!seen.has(key), `같은 줄이 두 번 올라왔다: ${key}`);
    seen.add(key);
  }
});

test('★ 부록(내가 잰 것)은 보지 않는다', () => {
  const t = '본문에 외출모드\n\n# 부록 A. 코드와의 대조\n\n부록에 외출모드';
  const body = dc.stripAppendix(t);
  assert.ok(body.includes('본문에 외출모드'));
  assert.ok(!body.includes('부록에 외출모드'), '부록에서 결정을 언급하는 것은 정상이다');
});

/* ───────────── 실제 저장소 ───────────── */

/**
 * ★★★ **검사가 「고장이 아직 있다」를 요구하면 안 된다** 〈2026-08-26 · D-135〉.
 *
 *   앞 판은 `dc.run()` 을 돌려 **살아 있는 지침에 외출모드가 세 군데 남아
 *   있는 것**을 확인했다. 그것이 이 도구의 존재 이유였기 때문이다.
 *
 *   그런데 2026-08-26 에 사장님이 「삭제」로 정하셔서 **실제로 지웠더니
 *   이 검사가 빨개졌다.** 고쳤는데 검사가 화를 낸 것이다.
 *
 * ★★ 재려는 것은 **「지금 저장소에 외출모드가 있는가」가 아니라
 *   「이 도구가 그런 것을 잡아내는가」**다. 둘은 다르다.
 *   그래서 **표본을 만들어** 잰다 — 그러면 저장소를 고쳐도 검사는 그대로 산다.
 */
test('★★★ 「안 하기로 정한 말」이 지침에 남아 있으면 잡는다 (표본으로 잰다)', () => {
  const term = dc.termOf('### ✅ D-121. 「외출모드」 — **만들지 않는다** 〈2026-08-26 결정〉');
  assert.strictEqual(term, '외출모드',
    '제목에서 찾을 낱말을 못 뽑으면 이 도구는 아무것도 못 잡는다');

  // 「안 하기로 정했다」로 읽히는 말을 실제로 가려내는가
  assert.ok(dc.NEGATIVE.some(w => '만들지 않는다'.includes(w)));
});

test('★★★ 외출모드는 이제 지침에서 **빠져 있다** (D-135 로 실제로 지웠다)', () => {
  // ★ 위 검사와 재는 것이 다르다. 이쪽은 **저장소의 지금 상태**다.
  //   되돌아가면(누가 다시 적으면) 여기가 빨개진다.
  const r = dc.run();
  assert.ok(r.ok);
  const 외출 = r.findings.filter(f => f.term === '외출모드');
  assert.deepStrictEqual(외출.map(f => `${f.file}:${f.line}`), [],
    '지웠던 「외출모드」가 지침에 다시 나왔다 — D-121·D-124·D-135 를 다시 본다');
});

test('★ 결과의 모양이 무너지지 않는다', () => {
  const r = dc.run();
  assert.ok(Array.isArray(r.decisions) && Array.isArray(r.findings));
  for (const f of r.findings) {
    assert.ok(f.file && f.line > 0 && f.id && f.term, JSON.stringify(f));
  }
});
