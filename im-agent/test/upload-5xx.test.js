'use strict';
/**
 * upload-5xx.test.js — **잠깐 나는 고장을 사람에게 떠넘기지 않는다** 〈2026-08-27 · M-58〉.
 *
 * 실제 신고: 화면에 「올리지 못했습니다 · HTTP 502」만 떴고, 사장님은 **같은
 * 자료를 처음부터 다시** 올리셨다. 502 는 앞단이 엔진에 못 붙었다는 뜻이라
 * 보낸 파일과 상관이 없는데, 화면이 그 말을 안 했다.
 *
 * ★ 이 검사는 **소스를 본다.** 실제로 502 를 내는 가짜 서버까지는 아직 안 세웠다 —
 *   그 사실을 여기 적어 둔다. 소스 검사는 「그리기는 하는데 그 자리까지 안 간다」를
 *   못 잡는다 (upload-unread.test.js 가 그래서 눌러 본다).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/** 주석을 떼고 본다 — 이 저장소는 주석이 길어 검사가 눈이 멀기 쉽다 (CLAUDE.md §8) */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'files.html'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('★★★ 5xx 를 **일시적**이라고 말한다 — 이름만 적으면 사람은 처음부터 다시 한다', () => {
  assert.match(SRC, /uf\.status >= 500 && uf\.status <= 599/,
    '5xx 를 따로 가르는 자리가 없다 — 401 만 갈라 적고 5xx 는 이름 한 줄로 끝난다');
  assert.match(SRC, /보내신 파일이 크거나 틀려서가 아니라/,
    '「내 파일 탓이 아니다」를 안 적으면 사용자는 자기 쪽을 의심한다');
});

test('★★★ 고른 파일을 둔 채 **[다시 보내기]** 를 그 자리에 둔다', () => {
  assert.match(SRC, /'다시 보내기'/, '다시 보내기 단추가 없다 — 처음부터 다시 하게 된다');
  assert.match(SRC, /again\.onclick = function \(\) \{ state\.uploadFail = null; doUpload\(\); \}/,
    '단추가 실제로 다시 보내지 않는다');
  // onDone 에서만 고른 파일을 비운다 — 실패했을 때 비우면 다시 고르게 된다
  assert.match(SRC, /state\.busy = false; state\.result = j; state\.picked = \[\];/,
    '성공했을 때 비우는 자리가 없다');
  const fail = SRC.slice(SRC.indexOf('onFail: function'), SRC.indexOf('onFail: function') + 600);
  assert.ok(!/state\.picked = \[\]/.test(fail),
    '실패했을 때 고른 파일을 비운다 — 그러면 다시 고르는 수고가 그대로 남는다');
});

test('★★★ **자동으로 다시 보내지 않는다** — 같은 자료가 두 벌 생긴다', () => {
  // 502 는 엔진이 이미 받아 읽다가 끊긴 것일 수도 있다. 누르는 것은 사람이 정한다
  const box = SRC.slice(SRC.indexOf('uf.status >= 500'), SRC.indexOf('uf.status >= 500') + 1400);
  assert.ok(!/setTimeout\([^)]*doUpload/.test(box), '자동 재시도가 들어갔다');
  assert.ok(!/retry\s*\(/.test(box), '자동 재시도가 들어갔다');
});

test('★★ 5xx 갈래가 401 갈래보다 **먼저** 온다 — 뒤에 두면 영영 안 걸린다', () => {
  const five = SRC.indexOf('uf.status >= 500');
  const four = SRC.indexOf('uf.status === 401');
  assert.ok(five > 0 && four > 0 && five < four,
    '차례가 뒤바뀌면 5xx 가 「로그인 문제」로 읽힌다');
});
