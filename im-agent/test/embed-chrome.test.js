'use strict';
/**
 * embed-chrome.test.js — **틀 안에 얹힌 화면은 제 껍데기를 감춘다** 〈2026-09-07〉.
 *
 * ★★★ 왜 있나. 사장님 화면의 단계 카드 **안에** `LINK PILOT` 줄과 단계 칩줄이
 *   한 벌 더 떴고, 5번 카드에는 **앱 아래 탭줄까지** 들어가 있었다 — 전부
 *   `href="#"` 인 죽은 링크에 이모지 아이콘이었다. 오류는 하나도 안 났다.
 *
 * ★ 원인이 둘이었다.
 *   ① `selfPlaced()` 가 **주소의 파일 이름만** 봤다. 흐름은 이 화면을 **제 주소
 *      그대로** 틀에 넣으므로(`reports.html` 을 `reports.html` 로) 「혼자 열렸다」로
 *      읽고 껍데기를 다 그렸다 — 감추는 장치가 아예 안 켜졌다.
 *   ② 감추는 목록(`EMBED_CSS`)에 **아래 탭줄(`.bot`)이 없었다.**
 *
 * ★★ 둘은 **서로를 가려 준다.** ①만 고치면 `.bot` 이 남고, ②만 고치면 규칙이
 *   얹히지 않아 아무 일도 안 일어난다. 그래서 한 파일에서 **둘 다** 잰다.
 *
 * ★★★ **화면이 실제로 그 껍데기를 그리는지도 함께 잰다.** 안 그러면 화면에서
 *   `.bot` 이 사라진 날 이 검사는 **아무것도 안 재면서 초록**이 된다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'ui', 'platform');
const FLOW = require(path.join(P, 'flow-core.js'));
const SRC = fs.readFileSync(path.join(P, 'flow-core.js'), 'utf8');

/** `selfPlaced()` 만 떼어 내 가짜 window 로 돌린다 — 브라우저 없이 판정을 직접 잰다 */
function selfPlacedWith(win, file) {
  const m = SRC.match(/function selfPlaced\(file\)[\s\S]*?\n {2}\}/);
  assert.ok(m, 'selfPlaced 를 못 찾았다 — 이름이 바뀌었으면 이 검사부터 고친다');
  return new Function('window', 'file', m[0] + '; return selfPlaced(file);')(win, file);
}

const alone = () => { const w = { location: { pathname: '/im-flow/reports.html' } }; w.top = w; w.self = w; return w; };
const framed = () => { const w = { location: { pathname: '/im-flow/reports.html' } }; w.self = w; w.top = {}; return w; };
const crossFramed = () => {
  const w = { location: { pathname: '/im-flow/reports.html' } }; w.self = w;
  Object.defineProperty(w, 'top', { get() { throw new Error('cross-origin'); } });
  return w;
};

test('혼자 열리면 제 껍데기를 그린다 — 감추면 화면이 통째로 빈 것처럼 보인다', () => {
  assert.strictEqual(selfPlacedWith(alone(), 'reports.html'), true);
});

test('★★★ 틀 안이면 감춘다 — 주소가 제 이름 그대로여도', () => {
  assert.strictEqual(selfPlacedWith(framed(), 'reports.html'), false,
    '틀 안인데 「제 주소」로 판정했다 — 껍데기가 두 벌로 보인다 (사장님 화면)');
});

test('★★ 다른 출처의 틀이어도 감춘다 — window.top 을 못 읽어도 틀 안인 것은 확실하다', () => {
  assert.strictEqual(selfPlacedWith(crossFramed(), 'reports.html'), false);
});

test('앱이 문서를 통째로 갈아끼운 자리도 감춘다 (D-173 — 이 판정은 그대로 산다)', () => {
  const w = { location: { pathname: '/linkpilot-platform.html' } }; w.top = w; w.self = w;
  assert.strictEqual(selfPlacedWith(w, 'reports.html'), false);
});

test('브라우저가 아니면 아무것도 안 건드린다', () => {
  assert.strictEqual(selfPlacedWith(undefined, 'reports.html'), true);
});

test('★★ 감추는 목록이 앱 껍데기 **넷**을 모두 덮는다', () => {
  for (const sel of ['.side', '.top', '.steps', '.bot']) {
    assert.ok(FLOW.EMBED_CSS.includes(sel + '{display:none'),
      `${sel} 이 감추는 목록에 없다 — 그 껍데기가 단계 카드 안에 한 벌 더 뜬다`);
  }
});

test('★★★ 화면이 실제로 그 껍데기를 그린다 — 안 그러면 위 칸이 헛돈다', () => {
  const bot = fs.readFileSync(path.join(P, 'reports.html'), 'utf8');
  assert.ok(/class="bot"/.test(bot),
    'reports.html 이 아래 탭줄을 안 그린다면 `.bot` 규칙은 재는 것이 없다 — 규칙을 지우거나 이 검사를 고친다');
  for (const f of ['reports.html', 'fields.html', 'intake.html']) {
    const s = fs.readFileSync(path.join(P, f), 'utf8');
    assert.ok(/class="top"/.test(s) && /class="side"/.test(s), `${f} 이 제 껍데기를 안 그린다`);
  }
});

/* ★★★ **머리도 탭 줄도 감추지 않는다** 〈2026-09-07 · 같은 날 두 번 고침〉.
 *
 *   [1차 사고] 캐시를 비우고 새 판을 보시자 **탭 줄이 두 벌**로 떴다 — 앱의
 *     「보고서 만들기 / 완성 보고서」 아래에 이 화면이 그린 같은 것이 한 벌 더.
 *     그때 나는 「탭은 앱 것」이라 읽고 **이쪽 탭을 감췄다.**
 *
 *   [2차 — 그 답이 틀렸다] 저쪽 앱은 그 전날(2026-09-06 · S-39) **배너와 탭 줄을
 *     함께 지우고**, 대신 **이쪽이 보내는 탭 신호를 듣도록** 바꿨다. 그러니 앱
 *     안에서 탭을 그리는 자리는 **이쪽 하나뿐**이다 — 감추면 [완성 보고서] 로 갈
 *     길이 양쪽 다 없어진다.
 *   ★ 사장님이 보신 두 벌은 **앱이 옛 판이어서**였다 (M-77 — 여드레 옛 화면).
 *     고칠 곳은 이쪽이 아니라 저쪽을 새 판으로 올리는 것이었다. 증상만 보고
 *     이쪽에서 덮으면, 저쪽이 새 판이 되는 순간 **아무 탭도 안 남는다.**
 *
 *   [지금 규칙] **머리(제목·부제)와 탭 줄은 둘 다 이쪽 화면이 단다.** 둘 다 안 감춘다.
 *     감추는 것은 앱이 제 것으로 그리는 넷뿐이다 — 사이드바·로고·단계칩·아래탭줄.
 */
test('★★★ 머리(`.head`)는 **안 감춘다** — 감추면 앱 안에서 화면이 제 이름을 잃는다', () => {
  assert.ok(!FLOW.EMBED_CSS.includes('.head{display:none'),
    '★ 머리를 감추고 있다. §8-2 는 **머리는 이쪽 화면이 단다**로 못박았다 — '
    + '저쪽 앱은 그래서 제 배너를 지운다. 여기서도 감추면 아무도 안 그린다');
});

test('★★★ 탭 줄(`.tabs`)도 **안 감춘다** — 앱이 이미 제 탭을 지웠다', () => {
  assert.ok(!FLOW.EMBED_CSS.includes('.tabs{display:none'),
    '★ 탭 줄을 감추고 있다. 저쪽 앱은 S-39 로 제 탭 줄을 지우고 **이쪽 탭 신호를 듣는다** — '
    + '여기서 감추면 앱 안에서 아무 탭도 안 보이고 [완성 보고서] 로 갈 길이 사라진다. '
    + '2026-09-07 에 실제로 그렇게 넣었다가 같은 날 되돌렸다');
});

test('★★★ 화면이 실제로 머리와 탭을 만든다 — 안 그러면 위 두 칸이 헛돈다', () => {
  /* ★ 머리와 탭은 **스크립트가 만든다** — 마크업에 글자로 없다. 그래서 만드는 자리를 본다.
     ★★ **미리 그려 넣은 판(`section-artifact.html`)을 보지 않는다** 〈2026-09-07 · CI 가 잡았다〉.
        그 파일은 **git 에 없다**(빌드 산출물). 내 자리에는 있어서 초록이었는데
        CI 에서 ENOENT 로 빨갰다 — **없는 파일을 근거로 삼은 검사**였다.
        추적되는 소스에서 재면 어디서 돌리든 같은 답이 나온다. */
  const src = fs.readFileSync(path.join(P, 'report-flow.html'), 'utf8');
  assert.match(src, /el\('div',\s*'head'\)/,
    "★ report-flow 가 머리를 안 만든다 — 앱은 §8-2 대로 제 배너를 지우므로 아무도 이름을 안 단다");
  assert.match(src, /el\('div',\s*'tabs'\)/,
    "★ report-flow 가 탭 줄을 안 만든다면 `.tabs` 규칙은 재는 것이 없다 — 규칙을 지우거나 이 검사를 고친다");
});

test('★ 앱 껍데기의 이모지는 감춰서 없앤다 — 화면에 남기지 않는다 (§6-3)', () => {
  const s = fs.readFileSync(path.join(P, 'reports.html'), 'utf8');
  const nav = (s.match(/<nav class="bot"[\s\S]*?<\/nav>/) || [''])[0];
  assert.ok(/[\u{1F300}-\u{1FAFF}]/u.test(nav),
    '아래 탭줄에 이모지가 없다면 이 칸의 전제가 바뀐 것이다 — 확인하고 고친다');
  assert.ok(FLOW.EMBED_CSS.includes('.bot{display:none'),
    '그 이모지가 앱 안에서 그대로 보인다');
});
