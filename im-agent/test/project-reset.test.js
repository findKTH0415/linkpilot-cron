'use strict';
/**
 * project-reset.test.js — **그 프로젝트 것이 아닌 것은 화면에 안 남는다**
 * 〈2026-08-29 사장님 지시 · D-175: 「리셋기능같은 프로젝트에 등록된 아닌
 * 목록은 노출되지 않도록 해줘」〉.
 *
 * 앞 판은 프로젝트를 바꿀 때 목록(`linked`·`oneshot`)만 버렸다. 그런데
 * **올리다 만 것들**은 그대로 남았다 — 고른 파일·올리기 결과·어디까지
 * 갔는지·실패 안내·진행 그래프. 그것들은 **어느 프로젝트 것도 아니다**
 * (아직 안 붙었거나 거절됐다).
 *
 * ★★★ 그대로 두면 다른 프로젝트를 골라도 **앞 프로젝트에서 하던 일이 그대로
 *   보인다** — 그럴듯하게 틀린 화면이라 아무도 눈치채지 못한다.
 *
 * ★ **지우는 것이 아니라 화면에서 내리는 것이다.** 서버에 올라간 자료는
 *   그대로 있고, 프로젝트를 다시 고르면 그 프로젝트 것이 다시 뜬다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const RAW = fs.readFileSync(path.join(PLATFORM, 'files.html'), 'utf8');
/** 주석을 떼고 본다 — 이 파일의 주석에 같은 낱말이 잔뜩 있다 (CLAUDE.md §8) */
const code = RAW.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/** 프로젝트를 바꾸는 자리만 떼어 본다 */
const SWITCH = (function () {
  const i = code.indexOf('state.restored = false;');
  return i < 0 ? '' : code.slice(i, i + 900);
}());

test('프로젝트를 바꾸는 자리를 찾을 수 있다', () => {
  assert.ok(SWITCH.length > 200, '바꾸는 자리가 없다 — 검사가 헛돈다');
});

/**
 * ★★★ 이 일곱이 남으면 앞 프로젝트의 일이 새 프로젝트 화면에 그대로 뜬다.
 */
test('★★★ 프로젝트를 바꾸면 그 프로젝트 것이 아닌 것을 전부 내린다', () => {
  [['state.picked = []', '고른 파일'],
    ['state.result = null', '올리기 결과'],
    ['state.partial = null', '어디까지 갔는지'],
    ['state.upload = null', '진행 상태'],
    ['state.trace = []', '진행 그래프'],
    ['state.uploadFail = null', '실패 안내'],
    ['state.busy = false', '보내는 중 표시']].forEach(([line, what]) => {
    assert.ok(SWITCH.indexOf(line) !== -1,
      `${what}(${line})가 안 내려간다 — 앞 프로젝트의 일이 그대로 보인다`);
  });
});

test('목록도 함께 내린다 (앞 판이 하던 것을 안 잃었다)', () => {
  assert.match(SWITCH, /state\.linked = state\.oneshot = state\.kept = null;/,
    '목록을 안 버린다');
  assert.match(SWITCH, /state\.closed = \{ kept: null, linked: null, oneshot: null \};/,
    '닫힘 사유를 안 버린다 — 앞 프로젝트의 사유가 남는다');
});

/**
 * ★ 스캔 결과를 버리는 것과 **같은 이유**다. 그 줄이 사라지면 이 고침도
 *   반쪽이 되므로 함께 지킨다.
 */
test('★ 스캔 결과도 여전히 버린다', () => {
  assert.match(code, /state\.scan = \{ busy: false, stage: -1/,
    '스캔 결과를 안 버린다 — 앞 프로젝트의 「값 12개」가 그대로 뜬다');
});

/**
 * ★★★ **반만 만들어진 자리를 지우지 않고 채웠다** 〈2026-08-29 · D-175〉.
 *
 *   `state.kept`(보관 목록)는 **어디서도 값이 안 들어갔다** — 늘 `null` 인데
 *   목록을 그리는 자리·로그인 판정·개수 세기 세 곳이 그것을 읽고 있었다.
 *   그래서 「같은 이름 찾기」가 **보관 자료를 한 번도 못 봤다**: 같은 문서가
 *   「보관」과 「1회성 기록」 양쪽에 남아도 두 자료로 보여 줬다.
 *
 *   ★ 처음엔 죽은 자리로 보고 **지웠는데**, 검사 둘이 빨개져서 알았다 —
 *     죽은 것이 아니라 **반만 된 것**이었다. 지우면 그 의도까지 사라진다.
 *     그래서 지우는 대신 **받아 오는 곳을 만들었다.**
 */
test('★★★ 보관 목록을 실제로 받아 온다 (자리만 만들어 두지 않는다)', () => {
  assert.match(code, /call\('GET', base \+ '\/sources', null, LG\)/,
    '보관 목록을 안 받아 온다 — 자리만 있고 늘 비어 있다');
  assert.match(code, /state\.kept = r\.body;/, '받아 온 것을 안 담는다');
  assert.match(code, /state\.linked = state\.oneshot = state\.kept = null;/,
    '프로젝트를 바꿔도 보관 목록이 앞것으로 남는다');
});

test('★★ 「같은 이름 찾기」가 보관 자료를 본다', () => {
  const at = code.indexOf('function versionBox');
  const fn = code.slice(at, code.indexOf('\n  }', at));
  assert.match(fn, /state\.kept && state\.kept\.files/,
    '보관 자료를 안 본다 — 보관본과 1회성 기록이 겹쳐도 못 잡는다');
});

/**
 * ★ **지우는 것이 아니다.** 서버 자료를 없애는 호출이 늘지 않았는지 본다 —
 *   사장님이 고르신 것은 「안 보이게」이지 「지우기」가 아니다.
 */
test('★ 서버 자료를 지우는 호출을 만들지 않았다', () => {
  assert.ok(!/'DELETE'/.test(code) && !/method: 'DELETE'/.test(code),
    '자료를 지우는 호출이 생겼다 — 고르신 것은 「안 보이게」다');
});
