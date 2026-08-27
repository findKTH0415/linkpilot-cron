'use strict';
/**
 * flow-tools.test.js — 절 맨 아래의 **도구줄**을 고정한다 〈2026-08-28 · D-158〉.
 *
 * 사장님이 그리신 아코디언 넷의 마지막 두 칸에는 단추가 붙어 있었다 —
 *   「3. …보고서 생성 · **미리보기 · 수정요구** → [확인클릭]」
 *   「4. 완성보고서 → **[다운로드]**」
 * D-157 은 칸만 넷으로 묶고 이 셋을 안 붙였다. 여기서 다시 빠지는 것을 막는다.
 *
 * ★ 검사가 재는 것은 **약속**이다:
 *   ① 세 단추가 화면에 있는가
 *   ② 「수정 요구」가 **없는 창구로 보내는 척**하지 않는가 (고치는 자리로 데려간다)
 *   ③ 문서 주소를 두 벌로 만들지 않았는가 (`outputs.html` 과 같은 창구)
 *   ④ 못 쟀을 때 「없다」로 말하지 않는가
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const FLOW = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
const OUT = fs.readFileSync(path.join(PLATFORM, 'outputs.html'), 'utf8');

/**
 * ★★ **주석을 떼고 본다** (CLAUDE.md §8 — 하루에 네 번 걸린 함정).
 *   이 파일의 주석에는 단추 이름이 잔뜩 적혀 있어, 안 떼면 코드가 없어도 통과한다.
 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}
const C = code(FLOW);

test('3절에 [미리보기] 와 [수정 요구] 가 있다', () => {
  assert.match(C, /toolBtn\('미리보기'\)/, '[미리보기] 단추가 없다');
  assert.match(C, /toolBtn\('수정 요구'\)/, '[수정 요구] 단추가 없다');
});

test('4절에 [다운로드] 가 있다', () => {
  assert.match(C, /'다운로드'/, '[다운로드] 단추가 없다');
  assert.match(C, /setAttribute\('download', ''\)/,
    '내려받기 표시가 없다 — 브라우저가 새 탭에서 열어 버린다');
});

test('도구줄은 make · done 두 절에만 붙는다', () => {
  assert.match(C, /sec\.id !== 'make' && sec\.id !== 'done'/,
    '어느 절에 붙는지 못 박혀 있지 않다 — 빈 줄이 다른 절에도 생긴다');
});

/**
 * ★★★ 가장 중요한 칸. 서버에 「수정 요구 접수」 창구가 **없다.**
 *   보내는 척하면 사용자는 보냈다고 믿고 아무도 받지 않는다.
 */
test('「수정 요구」는 요청을 보내지 않고 고치는 자리로 데려간다', () => {
  assert.match(C, /go\('fields'\)|go\(pair\[1\]\)/,
    '고치는 자리로 가는 길이 없다');
  assert.match(C, /\['값을 고친다[^']*', 'fields'\]/, '값을 고치는 갈래가 없다');
  assert.match(C, /\['쪽수·형식을 고친다[^']*', 'spec'\]/, '사양을 고치는 갈래가 없다');
  // 접수하는 척하는 호출이 없어야 한다
  assert.ok(!/\/revision|\/fixes|\/requests/.test(C),
    '없는 접수 창구를 부르고 있다 — 서버에 그런 길이 없다');
  assert.match(FLOW, /누구에게 요청을 보내지 않습니다/,
    '보내지 않는다는 사실을 화면이 말하지 않는다');
});

test('문서 주소를 두 벌로 만들지 않는다 — outputs.html 과 같은 창구', () => {
  const shape = "'/file?rel=' + encodeURIComponent(";
  assert.ok(C.indexOf(shape) !== -1, 'report-flow 이 파일 창구를 안 쓴다');
  assert.ok(code(OUT).indexOf(shape) !== -1, 'outputs 쪽 창구 모양이 바뀌었다 — 둘이 갈렸다');
});

/**
 * ★ 「못 쟀다」와 「없다」는 다른 사실이다 (CLAUDE.md §4.9).
 */
test('문서 목록을 못 받으면 「없다」고 말하지 않는다', () => {
  assert.match(C, /if \(facts\.reports === null\) return null;/,
    '못 쟀을 때 빈 목록으로 떨어뜨리고 있다');
  assert.match(FLOW, /만들어진 문서를 아직 못 물어봤습니다/,
    '못 쟀을 때의 안내가 없다');
  assert.match(FLOW, /아직 만들어진 문서가 없습니다/,
    '정말 없을 때의 안내가 없다');
});

test('배포가 막힌 문서는 열지 않는다', () => {
  assert.match(C, /facts\.reportsBlocked/, '배포 차단을 보지 않는다');
  assert.match(C, /!facts\.reportsBlocked/, '차단인데도 단추가 열린다');
});

test('도구줄은 [확인] 보다 **앞**에 그린다', () => {
  const t = C.indexOf('var tw = toolRow(sec);');
  const g = C.indexOf('var go = confirmRow(sec);');
  assert.ok(t !== -1 && g !== -1, '두 줄을 찾지 못했다 — 검사가 헛돈다');
  assert.ok(t < g, '[확인] 이 도구줄보다 먼저 그려진다 — 순서가 뜻을 잃는다');
});
