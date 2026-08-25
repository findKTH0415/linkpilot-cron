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
/**
 * ★★★ **속성은 사진에 안 찍힌다** 〈2026-08-23 · 다섯 번째 왕복에서 잡았다〉.
 *
 *   앞 판 이 검사는 `files.html` **하나만**, 그것도 **소스를 문자열로 훑어서**
 *   봤다. 그래서 나머지 다섯 화면이 지문을 **속성에만** 두고 있는 것을
 *   여섯 달 동안 아무도 몰랐다 — 그리고 그 다섯 중 하나가 사장님이 실제로
 *   찍어 보내시는 화면(`report-flow.html`)이었다.
 *
 *   ★ 그동안 나는 「판 b76a7fb3 입니다」라고 적고, 사장님은 그 값을 화면 어디에서도
 *     찾을 수 없으셨다. **판을 가리라고 만든 장치를 아무도 못 보고 있었다.**
 *
 * ★ 그래서 **실제로 그려 본다.** 소스에 그리는 코드가 있는 것과 화면에 글자가
 *   뜨는 것은 다른 말이다 — 이 저장소는 그 차이로 여러 번 속았다.
 */
test('★★★ 배포되는 화면 전부가 판 지문을 눈에 보이게 그린다', () => {
  const os = require('os');
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;   // 크로미움이 없는 서버가 실제로 있다

  const want = stampMod.bundleHash();
  const missing = [];

  stampMod.pages().forEach((name) => {
    /* ★ 미리보기 산출물은 빼고 **배포되는 화면**만 본다 */
    if (/-(preview|static|artifact|inline|live)\.html$/.test(name)) return;
    const dom = renderDom(findBrowser(), path.join(PLATFORM, name), 60000);
    /* 스크립트 안의 글자가 아니라 **화면에 뜬 글자**를 본다 */
    const body = dom.replace(/<script[\s\S]*?<\/script>/g, '');
    if (body.indexOf('판 ' + want) === -1) missing.push(name);
  });

  assert.deepStrictEqual(missing, [],
    `이 화면들이 판 지문을 화면에 안 보여 준다 — 사진으로 판을 가릴 수가 없다: ${missing.join(' · ')}`);
});

/**
 * ★ 적는 말은 **한 곳에서만 만든다.** 두 벌이면 화면마다 다르게 적히고,
 *   그러면 사장님이 두 화면을 비교하실 때 같은 판인지도 헷갈린다.
 */
test('★★ 지문 문구가 한 곳에서 나온다 (flow-core)', () => {
  const F = require(path.join(PLATFORM, 'flow-core.js'));
  assert.strictEqual(F.buildLabel('deadbeef'), '판 deadbeef');
  assert.strictEqual(F.buildLabel(null), null, '지문이 없으면 아무 말도 하지 않는다');

  /* ★ 화면들은 제 손으로 문구를 적지 않는다 — `stampInto` 한 곳을 거친다 */
  ['files.html', 'report-flow.html', 'intake.html', 'fields.html', 'reports.html', 'outputs.html']
    .forEach((n) => {
      const src = fs.readFileSync(path.join(PLATFORM, n), 'utf8');
      assert.match(src, /stampInto\(/, `${n} 이 판 지문을 안 찍는다`);
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
      assert.ok(!/'판 ' \+/.test(code),
        `${n} 이 제 문구를 따로 적는다 — 두 벌이면 화면마다 다르게 적힌다`);
    });
});

/**
 * ★★ **지문은 한 화면에 하나여야 한다** 〈2026-08-23 · 사장님 화면에서 둘로 보였다〉.
 *
 *   `report-flow` 가 찍고 그 안의 `intake` 도 찍어서 같은 값이 둘이었다.
 *   같은 값이 둘이면 「왜 둘이지」부터 보게 된다 — 판을 가리라고 둔 것이
 *   되레 한 번 멈추게 한다.
 *
 * ★ 그렇다고 「창 안이면 안 찍는다」로 두면 안 된다. `report-flow` 자체가
 *   **앱 셸의 창 안**에 들어 있어서 지문이 통째로 사라진다 — 그것이 오늘
 *   우리를 구한 그 여덟 글자다. 그래서 **부모가 우리 화면인지**로 가른다.
 */
test('★★ 지문은 한 화면에 하나다 (우리 화면 안에서는 안 찍는다)', () => {
  const F = require(path.join(PLATFORM, 'flow-core.js'));
  const src = fs.readFileSync(path.join(PLATFORM, 'flow-core.js'), 'utf8');

  assert.strictEqual(typeof F.insideLinkPilot, 'function', '겹치는지 가리는 길이 없다');

  /* ★ 가리는 기준이 「창 안인가」가 아니라 「부모가 우리 화면인가」여야 한다 */
  const fn = src.slice(src.indexOf('function insideLinkPilot'),
    src.indexOf('function stampInto'));
  assert.match(fn, /window\.parent\.LinkPilotFlow/,
    '부모가 우리 화면인지 안 본다 — 앱 셸 안에서도 지문이 사라진다');

  /* ★ 못 읽으면(다른 출처) **찍는 쪽**이다. 없는 것보다 둘이 낫다 */
  assert.match(fn, /catch \(_\) \{ return false; \}/,
    '다른 출처일 때 안 찍는 쪽으로 기운다 — 앱 셸에서 지문이 사라진다');

  /* ★ `stampInto` 가 실제로 그 판단을 쓴다 */
  const st = src.slice(src.indexOf('function stampInto'), src.indexOf('function stampInto') + 500);
  assert.match(st, /insideLinkPilot\(\)/, '판단해 놓고 안 쓴다');
});
