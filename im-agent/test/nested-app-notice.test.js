'use strict';
/**
 * nested-app-notice.test.js — **앱이 앱 안에 겹쳐 있으면 화면이 말한다**
 * 〈2026-08-28 · D-164〉.
 *
 * 사장님 신고: 「오류 이중 배너」 — 사진 배너와 탭 줄이 두 벌로 보였다.
 *
 * ★★★ 그 배너·탭 문자열(`REPORT STUDIO` 등)은 **이 저장소에 하나도 없다.**
 *   그러니 두 벌 다 앱이 그린 것이고, 앱이 자기 페이지를 자기 안에 또 넣었다는
 *   뜻이다. **이 저장소는 그것을 못 고친다** (CLAUDE.md §8-2).
 *
 * ★ 그래도 잠자코 있지 않는다. 겹쳐 보이는 것만도 나쁘지만 **더 나쁜 것은
 *   원인이 안 보이는 것**이다 — 그러면 엉뚱한 곳을 고치게 된다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const F = require('../ui/platform/flow-core.js');
const FLOW = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
const code = FLOW.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/**
 * ★★★ 이 검사가 이 진단의 **근거**다. 배너 글자가 이 저장소에 생기는 날
 *   「앱이 그린 것」이라는 판정이 통째로 틀려진다.
 */
test('★★★ 배너·탭 글자가 이 저장소에 없다 (그래서 두 벌은 앱이 그린 것이다)', () => {
  const screens = ['report-flow.html', 'intake.html', 'fields.html',
    'reports.html', 'outputs.html', 'files.html'];
  screens.forEach((f) => {
    const t = fs.readFileSync(path.join(PLATFORM, f), 'utf8');
    assert.ok(t.indexOf('REPORT STUDIO') === -1,
      `${f} 이 배너 글자를 그린다 — 두 벌의 한쪽이 우리 것일 수 있다`);
  });
});

test('겹친 앱을 세는 자리가 있다', () => {
  assert.strictEqual(typeof F.appDepth, 'function', 'appDepth 가 없다');
  assert.strictEqual(typeof F.nestedAppNote, 'function', 'nestedAppNote 가 없다');
});

test('한 겹이면 아무 말도 안 한다 (없는 고장을 만들지 않는다)', () => {
  assert.strictEqual(F.nestedAppNote({ apps: 0, hops: 0, blocked: false }), null);
  assert.strictEqual(F.nestedAppNote({ apps: 1, hops: 1, blocked: false }), null,
    '앱 안에 정상으로 얹힌 것을 겹쳤다고 말한다');
});

test('두 겹부터 말하고, 몇 겹인지 적는다', () => {
  const t = F.nestedAppNote({ apps: 2, hops: 3, blocked: false });
  assert.ok(t, '두 겹인데 아무 말도 안 한다');
  assert.match(t, /2겹/, '몇 겹인지 안 적는다');
  assert.match(t, /report-flow\.html/, '무엇을 넣어야 하는지 안 적는다');
  assert.match(t, /lp:base/, '고치는 법이 어디 있는지 안 가리킨다');
  assert.match(t, /이 화면이 만든 것이 아닙니다/,
    '누구 탓인지 안 적으면 이 화면을 고치러 온다');
});

/**
 * ★ 다른 출처를 만나면 **거기까지가 아는 전부**다. 「겹치지 않았다」로
 *   단정하지 않는다 — 못 본 것과 없는 것은 다른 사실이다 (§4.9).
 */
test('★ 다른 출처를 만나면 그때까지 센 것과 「못 봤다」를 함께 낸다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'flow-core.js'), 'utf8');
  assert.match(src, /blocked: true/, '못 본 것을 표시하지 않는다');
  assert.match(src, /return \{ apps: apps, hops: hops, blocked: true \};/,
    '예외가 나면 센 값을 버리고 있다');
});

test('화면이 그 말을 실제로 띄운다', () => {
  /* ★ 〈2026-08-29 · D-179〉 이 화면은 앱이 **바로** 틀에 넣는 자리라
   *   `direct: true` 로 묻는다 — 나와 맨 위 사이에 문서가 있으면 앱이 자기
   *   페이지를 한 겹 더 넣은 것이다. 앞 판은 `LINKPILOT_EMBED` 만 세다가
   *   실제 화면에서 **한 줄도 안 떴다.** */
  assert.match(code, /F\.nestedAppNote && F\.nestedAppNote\(null, \{ direct: true \}\)/,
    '화면이 겹침을 물어보지 않거나, 바로 넣히는 자리로 안 묻는다');
  assert.match(code, /배너와 탭이 두 벌로 보입니다/, '띄우는 제목이 없다');
  assert.match(code, /notice\('note--bad'/, '빨간 안내로 띄우지 않는다');
});

/**
 * ★★★ **세는 자가 그 모양을 못 쟀다** 〈2026-08-29 사장님 화면 「잘못된 케이스」 · D-179〉.
 *
 *   배너·탭이 두 벌로 보이는 화면에서 **경고가 한 줄도 안 떴다.** `appDepth()` 는
 *   위쪽 창이 `LINKPILOT_EMBED` 를 들고 있는지로 셌는데, 그 전역은 앱이
 *   **우리 화면에 넣어 주는 것**이라 사이에 낀 것이 **앱 자신의 페이지**면
 *   그 칸이 비어 있다.
 *
 * ★ 그래서 「나와 맨 위 사이에 문서가 있는가」를 따로 잰다. 무엇인지 몰라도
 *   **있다는 사실**은 잴 수 있고, 그것만으로 원인을 가리키기에 충분하다.
 */
test('★★★ 위쪽이 전역을 안 들고 있어도 사이에 낀 문서를 잡는다 (direct)', () => {
  const F = require(path.join(PLATFORM, 'flow-core.js'));

  /* 앱(맨 위) → 앱(가운데, 전역 없음) → 이 화면 */
  const top = {};
  const mid = {};
  const me = {};
  top.parent = top; top.top = top;
  mid.parent = top; mid.top = top;
  me.parent = mid;  me.top = top;

  const d = F.appDepth(me);
  assert.strictEqual(d.apps, 0,
    '표본이 재려는 모양이 아니다 — 가운데가 전역을 들고 있으면 앞 판도 잡는다');

  const seen = F.midFrames(me);
  assert.strictEqual(seen.mid, 1, '사이에 낀 문서를 못 셌다');
  assert.strictEqual(seen.blocked, false, '못 본 것으로 잘못 적었다');

  /* 맨 위에 바로 붙어 있으면 겹친 것이 아니다 */
  const flat = { top: top };
  flat.parent = top;
  assert.strictEqual(F.midFrames(flat).mid, 0, '겹치지 않았는데 겹쳤다고 한다');

  /* 맨 위 그 자체면 틀 안이 아니다 */
  assert.strictEqual(F.midFrames(top).mid, 0, '맨 위인데 겹쳤다고 한다');
  assert.strictEqual(F.midFrames(top).top, true, '맨 위인 것을 안 적는다');
});

/**
 * ★★ **단계 화면에는 이 셈을 쓰지 않는다.** `basics` 같은 화면은 보고서 생성
 *   흐름이 틀에 넣으므로 **사이에 하나가 정상으로** 있다. 그것을 겹침으로
 *   세면 멀쩡한 화면마다 빨간 띠가 뜬다 — 그러면 진짜일 때 아무도 안 본다.
 */
test('★★ 바로 넣히는 자리가 아니면 사이에 낀 문서로 판정하지 않는다', () => {
  const F = require(path.join(PLATFORM, 'flow-core.js'));
  const top = {}; const mid = {}; const me = {};
  top.parent = top; top.top = top;
  mid.parent = top; mid.top = top;
  me.parent = mid;  me.top = top;

  const d = F.appDepth(me);
  assert.strictEqual(F.nestedAppNote(d), null,
    '단계 화면인데 겹쳤다고 말한다 — 멀쩡한 화면마다 빨간 띠가 뜬다');
});
