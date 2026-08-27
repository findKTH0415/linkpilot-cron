'use strict';
/**
 * frame-loop.test.js — **한 절이 여러 틀을 띄울 때 되풀이하지 않는다** 〈2026-08-28 · D-160〉.
 *
 * D-157 부터 한 절이 여러 단계를 **함께 편다.** 1절은 `basics`·`ask` 두 틀을
 * 나란히 띄운다. 그런데 `syncFromFrame` 은 틀이 실릴 때마다 그 틀의 단계를
 * 현재 단계로 삼고 **다시 그렸다.**
 *
 *   basics 실림 → 현재=basics → 그대로
 *   ask    실림 → 현재≠ask → 현재=ask → 다시 그린다
 *   → 틀 둘이 새로 만들어지고 다시 실린다 → basics 가 현재를 되돌린다
 *   → 끝없이 되풀이한다
 *
 * ★★★ **오류가 하나도 안 난다.** 틀은 정상으로 실리고 내용도 멀쩡하다. 다만
 *   다시 그릴 때마다 틀이 부서져 **높이를 잴 겨를이 없어** 하얀 빈 칸만 남는다.
 *   화면에 원인을 짐작할 근거가 하나도 없다 — 이 저장소가 가장 비싸게 치르는
 *   종류다(「오류를 안 내는 고장」).
 *
 * ★ 그래서 **검사로만 잡힌다.** 사람 눈으로는 「빈 칸」까지밖에 안 보인다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const F = require('../ui/platform/flow-core.js');
const FLOW = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
/** 주석을 떼고 본다 — 이 파일의 주석에 단계 이름이 잔뜩 있다 (CLAUDE.md §8) */
const code = FLOW.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/**
 * ★ 되풀이가 나려면 **한 절에 단계가 둘 이상**이어야 한다. 그 조건이 실제로
 *   있는지부터 잰다 — 없으면 이 검사가 헛돈다.
 */
test('한 절이 단계를 여럿 품는다 (이 되풀이가 가능한 조건)', () => {
  const many = F.SECTIONS.filter((s) => s.steps.length > 1);
  assert.ok(many.length >= 1,
    '단계를 여럿 품은 절이 없다 — D-157 이 되돌려졌거나 이 검사가 옛말이다');
  assert.ok(many.some((s) => s.id === 'start'),
    '1절이 basics·ask 를 함께 품지 않는다');
});

test('★★★ 같은 절의 형제 틀은 현재 단계를 바꾸지 않는다 (안 그러면 끝없이 다시 그린다)', () => {
  assert.match(code, /var sameSection = false;/,
    '같은 절인지 가리는 자리가 없다');
  assert.match(code, /F\.sectionOfStep\(step\.id\)/,
    '틀의 단계가 어느 절인지 안 본다');
  assert.match(code, /F\.sectionOfStep\(state\.current\)/,
    '지금 열린 단계가 어느 절인지 안 본다');
  assert.match(code, /!sameSection/,
    '같은 절일 때 현재 단계를 그대로 두는 조건이 없다');
});

/**
 * ★ 절이 **다를 때는** 바꿔야 한다. 안 바꾸면 안쪽 화면에서 [다음] 을 눌러
 *   딴 절로 가도 바깥 아코디언이 안 따라온다.
 */
test('절이 다르면 현재 단계를 바꾼다 (진짜 이동은 막지 않는다)', () => {
  assert.match(code, /state\.current = step\.id; changed = true;/,
    '현재 단계를 바꾸는 자리가 통째로 사라졌다 — 이동이 안 된다');
});

/**
 * ★★ 판정 자체를 `flow-core` 로 재 본다. 화면 글자만 보면 규칙이 바뀐 날
 *   검사가 옛말을 한다 (M-63 과 같은 결).
 */
test('flow-core 가 실제로 같은 절이라고 답한다 — basics 와 ask', () => {
  const a = F.sectionOfStep('basics');
  const b = F.sectionOfStep('ask');
  assert.ok(a && b, '두 단계 중 하나가 어느 절에도 안 속한다');
  assert.strictEqual(a.id, b.id, 'basics 와 ask 가 다른 절이다 — 되풀이 조건이 사라졌다');
});

test('flow-core 가 다른 절이라고 답한다 — basics 와 sources', () => {
  const a = F.sectionOfStep('basics');
  const b = F.sectionOfStep('sources');
  assert.ok(a && b);
  assert.notStrictEqual(a.id, b.id, '1절과 2절이 같은 절이 되었다');
});

/**
 * ★★★ **지켜보는 틀은 여럿이다** 〈2026-08-28 · D-161 — D-157 이 남긴 둘째〉.
 *
 * 앞 판은 `watching` 이 **한 자리**였다. 새 틀을 지켜보기 시작하면 앞의 것을
 * 놓아 버렸다. 한 절에 틀이 하나뿐이던 시절에는 그것이 맞았다.
 *
 * D-157 부터 한 절이 틀을 여럿 띄운다. 그러자 **마지막 틀만 지켜보게 되고**
 * 앞의 틀은 **재기 전 임시값(320px)에 그대로 굳었다.**
 *   실측(헤드리스): 고치기 전 `basics` 320px · `ask` 468px
 *                   고친 뒤   `basics` 436px · `ask` 340px
 *
 * ★★ 굳은 틀은 내용이 잘린다. 안쪽이 늦게 그려지면(서버 대답을 받은 뒤)
 *   그 뒤로는 아무도 다시 재지 않아 **하얀 칸**으로 남는다.
 * ★★★ 여기서도 오류가 안 난다 — 틀은 멀쩡히 실렸고 높이만 틀렸다.
 */
test('★★★ 띄운 틀을 **전부** 지켜본다 (한 자리면 앞의 틀이 굳는다)', () => {
  assert.match(code, /var watching = \[\];/,
    '지켜보는 자리가 아직 하나뿐이다 — 한 절에 틀이 둘이면 앞의 것이 굳는다');
  assert.match(code, /watching\.push\(\{ fr: fr,/,
    '새 틀을 더하지 않고 덮어쓰고 있다');
  assert.ok(!/watching = \{ fr: fr,/.test(code),
    '아직 한 자리에 덮어쓰는 코드가 남아 있다');
});

test('★ 다시 그릴 때 지켜보던 것을 **한꺼번에** 놓는다 (안 놓으면 쌓인다)', () => {
  assert.match(code, /var all = watching; watching = \[\];/,
    '놓는 자리가 목록을 비우지 않는다 — 없어진 틀을 계속 재는 감시자가 쌓인다');
  assert.match(code, /all\.forEach\(function \(w\) \{ try \{ w\.stop\(\); \} catch \(e\) \{\} \}\);/,
    '하나가 죽으면 나머지를 못 놓는다');
});

test('★ 이미 지켜보는 틀에 감시자를 두 벌 걸지 않는다', () => {
  assert.match(code, /for \(var i = 0; i < watching\.length; i\+\+\) \{/,
    '이미 지켜보는 틀인지 확인하지 않는다');
  assert.match(code, /if \(watching\[i\]\.fr === fr\) \{ fit\(fr\); return; \}/,
    '이미 지켜보는 틀이면 그대로 두고 높이만 맞추는 자리가 없다');
});

/* ══════════ 1절을 한 창으로 합쳤다 〈2026-08-28 · D-163〉 ══════════
 *
 * 사장님 지시: 「무엇을 만들까요? / 밑에 발행주체를 통합병합한 아코디언 창을
 * 만들어줘」.
 *
 * ★★★ **순서가 뒤집혔다.** 발행 주체는 한 번 정하면 잘 안 바뀌는 설정이고,
 *   화면을 열 때마다 할 일은 요청문을 적는 것이다. 설정이 위에 있으면 정작
 *   할 일이 아래로 밀린다.
 */
test('★★★ 1절은 요청문이 먼저, 발행 주체가 뒤다', () => {
  const s = F.SECTIONS[0];
  assert.deepStrictEqual(s.steps, ['ask', 'basics'],
    '발행 주체가 아직 위에 있다 — 매번 회사 이름 화면을 지나쳐 내려가야 한다');
});

test('★★ 1절은 한 상자에 합쳐 그린다 (두 칸으로 쪼개지 않는다)', () => {
  assert.match(code, /function mergedStart\(sec, byId\) \{/, '합치는 자리가 없다');
  assert.match(code, /if \(sec\.id !== 'start'\) return null;/,
    '어느 절을 합치는지 못 박혀 있지 않다');
  assert.match(code, /wrap\.appendChild\(stepBody\(ask\)\);/,
    '요청문을 먼저 그리지 않는다');
});

/**
 * ★★★ **안 정했으면 펴 둔다.** 접어 두면 비어 있는 줄 모르고 넘어가고,
 *   그러면 문서에 「발행 주체 미설정」이 찍혀 대외 배포가 막힌다 —
 *   막히는 이유가 화면 어디에도 안 보이는 상태가 된다.
 */
test('★★★ 발행 주체를 아직 안 정했으면 접지 않고 펴 둔다', () => {
  assert.match(code, /var open = \(foldOpen === null\) \? !facts\.issuerSet : foldOpen;/,
    '안 정했을 때 펴 두는 규칙이 없다 — 비어 있는 줄 모르고 넘어간다');
});

/**
 * ★ 접힌 줄에 **지금 값을 그대로** 적는다. 「정해져 있습니다」보다 회사 이름이
 *   보이는 쪽이 확인이 된다 — 펴지 않고도 무엇이 찍힐지 알 수 있다.
 */
test('★ 접힌 머리줄이 지금 값을 적는다 (못 물어봤으면 그렇다고 적는다)', () => {
  assert.match(code, /function issuerLabel\(\)/, '접힌 줄에 적을 값을 만드는 자리가 없다');
  assert.match(code, /facts\.issuerName/, '회사 이름을 안 받아 둔다');
  assert.match(code, /아직 못 물어봤습니다/,
    '못 물어본 것을 「안 정했다」로 적고 있다 — 둘은 다른 사실이다 (§4.9)');
  assert.match(code, /아직 정하지 않았습니다/, '정말 안 정했을 때의 말이 없다');
});
