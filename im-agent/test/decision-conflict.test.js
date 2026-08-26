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

test('★★ 오늘 실제로 문제가 됐던 세 줄을 잡는다', () => {
  const r = dc.run();
  assert.ok(r.ok);
  const 외출 = r.findings.filter(f => f.term === '외출모드');
  assert.ok(외출.length >= 3,
    `외출모드가 지침에 남아 있는 곳을 못 잡았다 (${외출.length}군데) — 이 도구의 존재 이유다`);
  const files = new Set(외출.map(f => f.file));
  assert.ok(files.has('docs/디자인-Agent-지시서.md'));
  assert.ok(files.has('docs/플랫폼-자동완성-지침.md'));
});

test('★ 결과의 모양이 무너지지 않는다', () => {
  const r = dc.run();
  assert.ok(Array.isArray(r.decisions) && Array.isArray(r.findings));
  for (const f of r.findings) {
    assert.ok(f.file && f.line > 0 && f.id && f.term, JSON.stringify(f));
  }
});
