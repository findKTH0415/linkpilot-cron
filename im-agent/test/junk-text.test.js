'use strict';
/**
 * junk-text.test.js — **그럴듯하게 고장난 글자를 화면에서 잡는다** 〈2026-08-27〉.
 *
 * 사장님 화면에 실제로 이렇게 나왔다 — 「선정릉 → [object Object]」.
 *
 * ★★★ 이 종류는 **오류를 안 낸다.** 화면은 멀쩡히 뜨고 글자만 틀린다. 그래서
 *   「렌더가 됐는가」만 재는 검사는 **초록으로 통과한다** — 우리 교차검증이
 *   딱 그 상태였다. 값이 없어서 나는 것이 아니라 **값을 문장에 넣는 코드가
 *   틀려서** 난다 (객체를 그대로 글자로 이었다).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/** guard 가 쓰는 것과 **같은 눈**이어야 뜻이 있다 — 소스에서 떼어 온다 */
function guardPattern() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'guard.js'), 'utf8')
    // 주석을 떼고 본다 (CLAUDE.md §8 — 경위를 잘 적어 둘수록 검사가 눈이 먼다)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const m = src.match(/const junk = text\.match\((\/.+\/)\);/);
  assert.ok(m, 'guard 에서 그 검사를 못 찾았다 — 지워졌거나 모양이 바뀌었다');
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

test('★★★ 「선정릉 → [object Object]」 같은 줄을 잡는다', () => {
  const re = guardPattern();
  ['선정릉 → [object Object]', '값 undefined 원', '합계 NaN 억',
   '[object Array] 가 보인다'].forEach((s) => {
    assert.ok(re.test(s), `못 잡는다: ${s}`);
  });
});

test('★★ 멀쩡한 글자를 잡지 않는다 — 늑대야가 되면 꺼진다', () => {
  const re = guardPattern();
  ['자료가 없습니다', '미확인', '값 0 원', '보고서 만들기',
   'undefineds 라는 낱말이 아니다', 'NaNo 미터'].forEach((s) => {
    assert.ok(!re.test(s), `멀쩡한데 잡는다: ${s}`);
  });
});

test('★★ 그 검사가 **실패로 끝난다** — 적어만 두고 통과하면 없는 것과 같다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'guard.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /if \(rot\.length\) \{\s*add\('헤드리스 렌더', 'fail'/,
    '잡고도 통과로 끝나면 화면만 옛말을 한다');
});
