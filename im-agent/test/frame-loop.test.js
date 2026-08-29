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
/**
 * ★★★ **조건이 사라졌다 — 그래도 장치는 남긴다** 〈2026-08-29 · D-172〉.
 *
 *   절이 여섯이 되면서 **한 절에 한 단계**가 되었다. 그러니 형제 틀이 서로
 *   현재 단계를 뺏는 되풀이는 **지금 구조에서는 일어날 수 없다.**
 *
 *   ★ 그렇다고 막는 장치를 걷어내지 않는다. 절 구성은 오늘만도 다섯 번
 *     바뀌었고(D-157·D-162·D-163·D-169·D-172), **다음에 또 합치는 날** 이
 *     되풀이가 그대로 돌아온다. 그때 다시 하루를 쓰지 않으려고 남긴다.
 *   ★★ 그래서 이 검사는 「지금 여럿인가」가 아니라 **「막는 장치가 있는가」**를
 *     잰다 — 전제가 사라져도 검사가 헛돌지 않는다.
 */
test('지금은 한 절에 한 단계다 (되풀이 조건이 없다)', () => {
  F.SECTIONS.forEach((s) => {
    assert.strictEqual(s.steps.length, 1,
      `절 「${s.name}」 이 단계를 ${s.steps.length}개 품는다 — 아래 장치가 다시 필요해진다`);
  });
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
test('★ 절을 되짚는 자리가 옳게 답한다', () => {
  /* ★ 절이 여섯이 되면서 basics 와 ask 가 **다른 절**이 되었다 〈D-172〉.
     앞 판은 둘이 한 절이었고, 이 검사가 그것을 잰다는 사실 자체가 구조가
     바뀌었음을 알려 준다 — 검사가 옛말을 하지 않게 여기서 고친다. */
  assert.strictEqual(F.sectionOfStep('basics').id, 'basics');
  assert.strictEqual(F.sectionOfStep('ask').id, 'ask');
  assert.strictEqual(F.sectionOfStep('fields').id, 'make');
  assert.strictEqual(F.sectionOfStep('spec').id, 'spec');
  assert.strictEqual(F.sectionOfStep('없는단계'), null, '모르는 단계를 아는 척한다');
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

/* ══════════ 절 여섯 · 펼침을 사람이 정한다 〈2026-08-29 · D-172〉 ══════════
 *
 * 사장님 지시: 「1.기본정보 입력 → 펼치기 [완료] … 6.완성결과물」.
 *
 * ★★★ D-163(1절 합치기)·D-169(2절 접기) 검사는 **여기서 없앴다.** 그 둘은
 *   「한 칸에 여러 일이 겹친 것」을 다루는 장치였는데, 절이 여섯이 되면서
 *   겹칠 일 자체가 사라졌다. **없어진 것을 지키는 검사는 다음 사람을 헷갈리게
 *   한다** — 그래서 남기지 않고 지웠다는 사실을 여기 적어 둔다.
 */

test('★★★ 잠기지 않은 칸은 아무 때나 펴고 접는다', () => {
  assert.match(code, /function isOpen\(sec\)/, '펴짐을 가리는 자리가 없다');
  assert.match(code, /if \(sec\.locked\) return false;/, '잠긴 칸이 펴진다');
  assert.match(code, /openBy\[sec\.id\] = !open;/, '눌러도 안 펴진다');
});

/**
 * ★★ **「안 눌렀다」와 「눌러서 접었다」는 다른 사실이다** (§4.9 와 같은 결).
 *   `false` 를 못 담으면 접은 칸이 다시 그릴 때마다 펴진다.
 */
test('★★ 눌러서 접은 것도 기억한다', () => {
  assert.match(code, /Object\.prototype\.hasOwnProperty\.call\(openBy, sec\.id\)/,
    '안 눌렀는지와 접었는지를 못 가른다');
  assert.match(code, /return !!sec\.current;/, '아무것도 안 눌렀을 때 지금 칸을 안 편다');
});

/**
 * ★★★ **보는 일과 나아가는 일을 가른다** 〈D-172〉.
 *   앞 판은 머리를 누르면 「지금 칸」이 그리로 옮겨 갔다. 그래서 지나온 칸을
 *   잠깐 보려고 눌렀다가 **앞으로 가던 자리를 잃었다.**
 */
test('★★★ 머리를 눌러도 「지금 칸」이 멋대로 옮겨 가지 않는다', () => {
  const near = code.slice(code.indexOf("if (!sec.locked && sec.steps.length) {"),
    code.indexOf('box.appendChild(h);'));
  assert.ok(near.length > 50, '머리 누름 자리를 못 찾았다 — 검사가 헛돈다');
  assert.ok(!/go\(sec\.opensTo\)/.test(near),
    '머리를 누르면 지금 칸이 옮겨 간다 — 보려고 눌렀다가 자리를 잃는다');
});

test('꼬리표가 펼치기·접기를 그대로 말한다', () => {
  assert.match(code, /tag = open \? '접기' : '펼치기';/,
    '눌러도 되는지를 꼬리표가 안 알려 준다');
});

/**
 * ★ 단추 이름은 **[완료]** 다 — 사장님이 적으신 그대로. 「확인 — 다음 칸으로」는
 *   **가는 일**을 말하는데, 사장님이 뜻하신 것은 **끝냈다는 표시**다.
 */
test('★ [완료] 를 누르면 그 칸을 접고 다음 칸을 편다', () => {
  assert.match(code, /el\('button', 'okrow__b', '완료'\)/, '단추 이름이 [완료] 가 아니다');
  assert.match(code, /openBy\[sec\.id\] = false;/, '끝낸 칸을 안 접는다');
  assert.match(code, /openBy\[next\.id\] = true;/, '다음 칸을 안 편다');
  assert.match(code, /'다음: ' \+ next\.no \+ '\. ' \+ next\.name/,
    '어디로 가는지 안 적는다');
});
