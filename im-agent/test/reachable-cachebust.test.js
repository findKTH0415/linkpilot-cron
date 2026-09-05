'use strict';
/**
 * reachable-cachebust.test.js — **판 표시가 붙은 형제 스크립트도 「부른다」로 세는가**
 *   〈2026-08-31 · 실측으로 찾은 눈먼 자리〉.
 *
 * ★★★ 무슨 일이 있었나. `reachable.js` 의 셋째 갈래는 화면이 부르는 스크립트를
 *   `<script src="x.js">` 모양으로 찾았다. 그런데 이 저장소의 화면은 형제
 *   스크립트를 **`inapp.js?v=e66e07a5`** 로 부른다(`build-stamp.js` 가 판 표시를
 *   붙인다). 그래서 그 갈래가 **한 번도 안 맞았다.**
 *
 * ★★ 그런데도 검사는 **초록이었다.** 넷째 갈래(이름 되짚기)가 `"embed-bridge.js"`
 *   같은 글자를 아무 데서나 주워 대신 이어 줬기 때문이다. 즉 **「이 화면이 이
 *   스크립트를 부른다」는 정확한 길은 없는 채로** 통과하고 있었다.
 *   넷째를 끄고 재 보니 `embed-bridge.js` · `gate-core.js` 가 고아로 떨어졌다.
 *
 * ★ 그러니 여기서 재는 것은 **셋째 갈래 하나**다. 전체 검사가 초록인지로는
 *   이 결함이 안 잡힌다 — 넷째가 가려 주기 때문이다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { pointsTo } = require('../tools/reachable');

/** 표본을 진짜 파일로 만든다 — `pointsTo` 는 디스크에서 풀어 준다 */
function withScreen(html, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-reach-'));
  try {
    fs.writeFileSync(path.join(dir, 'sib.js'), '/* 형제 */\n');
    const page = path.join(dir, 'page.html');
    fs.writeFileSync(page, html);
    return fn(page, path.join(dir, 'sib.js'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ★ 넷째 갈래가 대신 이어 주지 못하게 **빈 색인**을 넘긴다. 이러면 셋째만 남는다. */
const NO_INDEX = new Map();

test('★★★ `?v=` 가 붙은 형제 스크립트도 「부른다」로 센다', () => {
  withScreen('<script src="sib.js?v=e66e07a5"></script>', (page, sib) => {
    const hits = pointsTo(page, NO_INDEX);
    assert.ok(hits.includes(sib),
      `판 표시가 붙으면 못 본다 — 실제로 이 상태였다. 잡힌 것: ${JSON.stringify(hits)}`);
  });
});

test('판 표시가 없는 평범한 것도 그대로 센다 — 느슨해진 것이 아니다', () => {
  withScreen('<script src="sib.js"></script>', (page, sib) => {
    assert.ok(pointsTo(page, NO_INDEX).includes(sib));
  });
});

test('★ 물음표 뒤를 파일 이름에 섞지 않는다 — 「sib.js?v=1」 이라는 파일은 없다', () => {
  withScreen('<script src="sib.js?v=abc123"></script>', (page, sib) => {
    const hits = pointsTo(page, NO_INDEX);
    assert.ok(!hits.some(h => h.includes('?')), `주소를 파일 이름으로 썼다: ${JSON.stringify(hits)}`);
    assert.deepStrictEqual(hits, [sib]);
  });
});

test('★★ 다른 이름의 스크립트를 아무거나 집지 않는다', () => {
  withScreen('<script src="딴것.js?v=e66e07a5"></script>', (page) => {
    assert.deepStrictEqual(pointsTo(page, NO_INDEX), [], '없는 파일을 닿았다고 셌다');
  });
});
