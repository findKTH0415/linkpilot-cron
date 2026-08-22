'use strict';
/**
 * build-stamp.test.js — **화면이 「어느 판인지」를 정직하게 말하는가** 〈2026-08-22〉.
 *
 * ★★★ 왜 있나. 같은 신고가 세 번 왔는데 그때마다 셋 중 무엇인지 알 수 없었다:
 *
 *     ① 안 올라갔다   ② 브라우저가 옛것을 들고 있다   ③ 코드가 틀렸다
 *
 *   **셋은 화면에서 똑같이 보인다.** 그래서 「새로고침해 보십시오」를 반복했고,
 *   사용자는 같은 화면을 다시 찍어 보냈다. 사진 한 장으로 판이 갈렸으면
 *   첫 번째에 끝났다 (M-24).
 *
 * ★★ 그런데 **지문이 옛것이면 없느니만 못하다.** 「31152290 입니다」라고 자신
 *   있게 말하는데 그게 세 판 전 값이면, 나는 그 값을 믿고 엉뚱한 결론을 낸다.
 *   그래서 이 검사가 **찍힌 값과 실제 내용이 같은지**를 잰다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const stampMod = require(path.join(PLATFORM, 'build-stamp.js'));

test('★★★ 화면에 찍힌 판 지문이 실제 묶음 내용과 같다', () => {
  const want = stampMod.bundleHash();
  const pages = stampMod.pages();
  assert.ok(pages.length >= 5,
    `지문을 박을 화면을 못 찾았다 (${pages.length}개) — 검사가 아무것도 재지 못했다`);

  const stale = pages
    .map((n) => ({ n, at: stampMod.stampedAt(n) }))
    .filter((x) => x.at !== want);

  assert.deepStrictEqual(stale.map((x) => `${x.n}=${x.at || '없음'}`), [],
    `판 지문이 옛것이다 (지금 내용은 ${want}) — 화면이 자신 있게 틀린 값을 말한다.`
    + '\n  → npm run im:stamp 로 다시 찍고 커밋한다');
});

test('★★ 화면 여섯이 **같은** 지문을 말한다 (묶음은 하나다)', () => {
  const vals = stampMod.pages().map((n) => stampMod.stampedAt(n));
  const uniq = Array.from(new Set(vals));
  assert.strictEqual(uniq.length, 1,
    `화면마다 지문이 다르다: ${uniq.join(' · ')} — 어느 것이 진짜인지 알 수 없다`);
});

/**
 * ★★ **시계를 넣지 않는다** (M-10). 날짜를 박으면 아무도 안 고친 날에도 산출물이
 *   달라져 자정에 CI 가 빨개진다. 두 번 세어 같은 값이 나오는지 본다.
 */
test('★★ 지문은 내용에서만 나온다 (두 번 세면 같다)', () => {
  assert.strictEqual(stampMod.bundleHash(), stampMod.bundleHash(),
    '같은 내용인데 지문이 달라진다 — 시계나 무작위가 섞였다');
});

/**
 * ★★ 자기 자신을 세는 문제. 지문을 써 넣으면 파일 내용이 바뀐다.
 *   **재기 전에 지문을 지운 상태**로 재야 값이 안정된다.
 */
test('★★ 지문을 다시 찍어도 값이 흔들리지 않는다 (자기 자신을 세지 않는다)', () => {
  const before = stampMod.bundleHash();
  const withAttr = ' ' + stampMod.ATTR + '="deadbeef"';
  assert.strictEqual(stampMod.bare('<html lang="ko"' + withAttr + '>'), '<html lang="ko">',
    '지문을 지우는 규칙이 실제로 안 지운다 — 찍을 때마다 값이 바뀐다');
  assert.strictEqual(before, stampMod.bundleHash());
});

/** ★ 화면이 그 값을 **실제로 그리는지** 본다. 박아만 두고 안 보이면 소용이 없다 */
test('★★ 자료 화면이 판 지문을 눈에 보이게 그린다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'files.html'), 'utf8');
  assert.match(src, /getAttribute\('data-lp-build'\)/,
    '화면이 판 지문을 읽지 않는다 — 박아 두기만 하면 사진에 안 나온다');
  assert.match(src, /'판 ' \+ build/, '판 지문을 그리지 않는다');
});
