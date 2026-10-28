/**
 * **[저장] 막대가 표에서 한참 떨어져 섰다** 〈2026-08-25 사장님 화면 · 판 c760f626〉.
 *
 * ★★★ 경위. 이 화면은 앱 안의 **틀(iframe)** 에서 돌고, 틀은 내용 높이만큼
 *   늘어난다. 그 안에서 `position: fixed; bottom: 0` 은 「보이는 화면의 아래」가
 *   아니라 **「틀의 아래」**다. 실제로 재 보니 막대 아래로 **1946px** 이 더
 *   있었다 — 사장님이 보신 그 빈칸이다. 그 아래로 앱의 다음 카드(5.출력조건)가
 *   이어져 더 어색해졌다.
 *
 * ★ **두 겹이었다.** 붙박이를 떼는 것만으로는 안 됐다 — `.app` 이
 *   `min-height: 100%` 라 **항상 한 화면을 채우므로**, `body` 끝에 붙인 막대는
 *   붙박이를 떼어도 그대로 저 아래에 선다. 그래서 넣는 자리도 `.main` 안으로
 *   옮겼다.
 *
 * ★ 여기서 재는 것 — **글자로 잴 수 있는 것만** 잰다.
 *   ① 틀인지를 **그리기 전에** 정하는가 (나중이면 자리가 한 번 튄다)
 *   ② 틀 안에서 흐름 안에 두는가
 *   ③ 막대를 `.main` 안에 넣는가
 *   ④ 혼자 뜬 판은 붙박이 그대로인가 (긴 표에서 [저장]이 늘 보여야 한다)
 *
 * ★★ **좌표는 여기서 안 잰다.** `position: fixed` 는 어느 쪽에서도 똑같이
 *   생겨서 글자 대조로는 안 갈린다. 실제로 그려서 재는 것은
 *   `im-agent/tools/probe-save-bar.js` 이고 `npm run guard` 가 부른다.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const P = path.join(__dirname, '..', 'ui', 'platform');
const SRC = fs.readFileSync(path.join(P, 'fields.html'), 'utf8');
/** ★ 주석을 떼고 본다 — 경위를 잘 적어 둘수록 검사가 눈이 먼다 (CLAUDE.md §8) */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('★★★ 틀 안인지를 **그리기 전에** 정한다', () => {
  const mark = CODE.indexOf("setAttribute('data-lp-inframe'");
  const style = CODE.indexOf('<style>');
  assert.ok(mark !== -1, '틀인지 알아채는 곳이 없다');
  assert.ok(style !== -1 && mark < style,
    '스타일보다 늦게 정한다 — 막대가 아래에 한 번 붙었다가 올라온다');
});

test('★★★ 교차출처로 막혀도 **틀로 본다**', () => {
  assert.ok(/try \{ framed = window\.top !== window\.self; \} catch \(_\) \{ framed = true; \}/
    .test(CODE), '읽다 막히면 혼자 뜬 판으로 본다 — 그때가 바로 틀 안이다');
});

test('★★★ 틀 안에서는 흐름 안에 둔다', () => {
  const at = CODE.indexOf(':root[data-lp-inframe] .save');
  assert.ok(at !== -1, '틀 안을 위한 자리 규칙이 없다');
  const block = CODE.slice(at, at + 260);
  assert.ok(/position: static/.test(block), '틀 안에서도 붙박이다 — 틀의 아래에 선다');
  assert.ok(/max-width: 1028px/.test(block), '표와 오른쪽 끝이 안 맞는다');
});

/**
 * ★★★ **이것이 진짜 원인이었다.** 붙박이만 떼고 `body` 끝에 그대로 두면
 *   `.app { min-height: 100% }` 때문에 막대가 여전히 저 아래에 선다.
 */
test('★★★ 막대를 `.main` 안에 넣는다 (`body` 끝이 아니다)', () => {
  assert.ok(/\(document\.querySelector\('\.main'\) \|\| document\.body\)\.appendChild\(footer\(\)\)/
    .test(CODE), 'body 끝에 붙인다 — `.app` 이 한 화면을 채우므로 그대로 저 아래다');
  assert.ok(CODE.indexOf('document.body.appendChild(footer())') === -1,
    '옛 길이 남아 있다');
});

test('★★ 붙박이 자리로 비워 둔 여백을 걷어 낸다', () => {
  assert.ok(/:root\[data-lp-inframe\] \.body \{ padding-bottom: 0; \}/.test(CODE),
    '130px 을 그대로 두면 표 끝과 막대 사이가 한 화면만큼 벌어진다');
});

test('★★ 혼자 뜬 판은 붙박이 그대로다', () => {
  assert.ok(/\.save \{ position: fixed; left: var\(--side\); right: 0; bottom: 0;/.test(CODE),
    '브라우저에서 직접 연 판에서는 긴 표를 내려도 [저장]이 보여야 한다');
});

/* ── 좌표로 재는 쪽이 실제로 있는가 ────────────────────── */

test('★★★ 좌표로 재는 검사가 있고, 교차검증이 그것을 부른다', () => {
  const probe = fs.readFileSync(path.join(__dirname, '..', 'tools', 'probe-save-bar.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/getBoundingClientRect/.test(probe), '좌표를 안 잰다');
  assert.ok(/<iframe/.test(probe),
    '틀을 흉내내면 「틀인지 알아채는 부분」이 통째로 시험에서 빠진다');
  assert.ok(/parent\.postMessage/.test(probe),
    '틀 안에서 잰 값을 밖으로 안 넘긴다 — --dump-dom 은 틀 안을 안 준다');

  const guard = fs.readFileSync(path.join(__dirname, '..', 'tools', 'guard.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/probe-save-bar\.js/.test(guard), '교차검증이 안 부른다 — 없는 것과 같다');
});
