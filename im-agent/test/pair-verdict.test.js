'use strict';
/**
 * pair-verdict.test.js — **「둘 중 하나」로 끝내지 않는다** 〈2026-08-27 사장님 화면〉.
 *
 * 빨간 띠가 「서버에 두 판이 섞여 있을 수 있습니다」로 끝났다. 그 말은 **읽는
 * 사람이 할 수 있는 일이 없다** — 캐시를 지워야 하는지, 배포가 안 된 것인지
 * 갈리지 않기 때문이다. 오늘 그 갈림에서 세 번 헤맸다.
 *
 * ★ 가르는 법: 이 화면의 주소를 **캐시를 쓰지 말고 다시 받아** 거기 적힌 판을 본다.
 *     같으면 → 서버가 옛 화면을 준다 (캐시 지워도 소용없다)
 *     다르면 → 브라우저가 옛것을 들고 있다 (캐시를 지우면 된다)
 * ★ 못 받으면 **못 쟀다고 적는다.** 「둘 중 하나」로 되돌아가지 않는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
/** 배포되는 화면 — 목록을 손으로 적지 않는다 */
const SCREENS = require(path.join(PLATFORM, 'build-embed.js')).required()
  .filter((f) => f.endsWith('.html'));

/**
 * ★ **주석을 떼고 본다** (CLAUDE.md §8). 이 저장소는 주석에 경위를 길게 적어
 *   두므로, 안 떼면 **경위를 잘 적어 둔 자리일수록 검사가 눈이 먼다** —
 *   실제로 이 검사가 처음에 주석 속 옛 문구를 코드로 읽고 빨개졌다.
 */
function block(file) {
  const s = fs.readFileSync(path.join(PLATFORM, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const i = s.indexOf('화면과 스크립트의 판이 다릅니다');
  return i < 0 ? '' : s.slice(i, i + 2600);
}

test('★★ 배포되는 화면이 하나도 안 빠졌다 — 한 곳만 고치면 그 화면만 옛말을 한다', () => {
  assert.ok(SCREENS.length >= 6, `화면이 ${SCREENS.length}개뿐이다 — 목록을 잘못 받았다`);
  SCREENS.forEach((f) => {
    assert.ok(block(f).length > 500, `${f}: 짝 확인 띠가 없다`);
  });
});

test('★★★ 띠가 **캐시를 쓰지 않고 다시 받아** 가른다', () => {
  SCREENS.forEach((f) => {
    const b = block(f);
    assert.match(b, /cache: 'no-store'/, `${f}: 캐시를 쓰지 않고 받는 자리가 없다`);
    assert.match(b, /data-lp-build="\(\[0-9a-f\]\+\)"/, `${f}: 받은 글에서 판을 안 읽는다`);
  });
});

test('★★★ **두 답이 서로 다른 할 일을 말한다** — 「둘 중 하나」가 아니다', () => {
  SCREENS.forEach((f) => {
    const b = block(f);
    assert.match(b, /서버가 옛 화면을 주고 있습니다/, `${f}: 서버 쪽 답이 없다`);
    assert.match(b, /캐시를 지우셔도 그대로입니다/, `${f}: 서버 쪽일 때 할 일이 없다`);
    assert.match(b, /브라우저가 옛 화면을 들고 있습니다/, `${f}: 브라우저 쪽 답이 없다`);
    assert.match(b, /캐시 삭제/, `${f}: 브라우저 쪽일 때 할 일이 없다`);
  });
});

test('★★★ 못 받으면 **못 쟀다고 적는다** — 「둘 중 하나」로 되돌아가지 않는다', () => {
  SCREENS.forEach((f) => {
    const b = block(f);
    assert.match(b, /다시 받아 보지 못했습니다/, `${f}: 못 받았을 때 말이 없다`);
    assert.match(b, /판을 읽지 못했습니다/, `${f}: 판을 못 읽었을 때 말이 없다`);
    /* ★ 옛 문구가 남아 있으면 두 벌이 된다 — 한쪽만 고치는 날이 온다 */
    assert.ok(!/서버에 두 판이 섞여 있을 수 있습니다/.test(b),
      `${f}: 「둘 중 하나」 문구가 그대로 남아 있다`);
  });
});
