'use strict';
/**
 * issuer-mark.test.js — **로고 자리 이니셜** 〈2026-08-23 사장님 지적으로 만들었다〉.
 *
 * ★★★ 무슨 일이 있었나. 사장님이 발행 주체를 채우셨는데 로고 자리에
 *   **`PGIS`** 가 떴다. 그 회사의 표시는 **`PDI`** 다.
 *   같은 규칙으로 다른 이름들을 재 보니 더 나왔다:
 *
 *       주식회사 대한개발 → **식대**
 *       전주도시개발      → **전도**
 *       제주에너지        → **제에**
 *
 *   원인은 둘이었다:
 *   ① `[(주)㈜]` 가 **문자 클래스**였다. `(주)` 라는 **낱말**을 떼려던 것인데
 *      `(` · `주` · `)` 를 **글자 단위로 아무 데서나** 지웠다. 한글 회사명에
 *      「주」는 흔하다(전주·제주·주식회사) — 그래서 **조용히** 틀렸다.
 *   ② 이미 약칭인 `PDI` 를 낱말로 세어 첫 글자만 떴다.
 *
 * ★★ **이 값은 보고서 표지·서명부에 찍힌다.** 틀려도 오류가 안 나고 문서가
 *   그대로 나간다 — 대외 문서에서 가장 비싼 종류다.
 *
 * ★ 규칙 사본이 **둘**이다(서버 `core/issuer.js` · 화면 `intake.html` 의
 *   `autoMark`). 여기서 **같은 표로 둘 다** 잰다 — 갈리면 화면과 문서가
 *   다른 글자를 말하는데, 그건 문서를 받아 본 뒤에야 안다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { markFrom } = require('../core/issuer.js');
const INTAKE = path.join(__dirname, '..', 'ui', 'platform', 'intake.html');

/** 화면 사본을 **실제로 꺼내 돌린다** — 읽어서 눈으로 맞추는 것은 검사가 아니다 */
function screenMark() {
  const src = fs.readFileSync(INTAKE, 'utf8');
  const at = src.indexOf('function autoMark(name)');
  assert.ok(at > 0, '화면에서 autoMark 를 못 찾았다');
  const end = src.indexOf('\n  }', at);
  assert.ok(end > at, 'autoMark 의 끝을 못 찾았다');
  // eslint-disable-next-line no-new-func
  return new Function(src.slice(at, end + 4) + '; return autoMark;')();
}

/* 이름 → 나와야 하는 표시. **틀렸던 것을 전부 넣는다** */
const TABLE = [
  ['PDI Global Infra Structure Development Co.,ltd', 'PDI'],  // ← 사장님 화면 (앞 판 PGIS)
  ['PDI GID', 'PDI'],                                          // 앞 판 PG
  ['SK E&S', 'SK'],                                            // 앞 판 SE
  ['주식회사 대한개발', '대한개발'],                              // 앞 판 식대
  ['전주도시개발', '전주도시'],                                   // 앞 판 전도
  ['제주에너지', '제주에너'],                                     // 앞 판 제에
  ['(주)한국전력', '한국전력'],
  ['Acme Capital Partners Co.,Ltd', 'ACP'],
  ['', ''],
];

test('★★★ 로고 자리 이니셜 — 틀렸던 이름들이 다시 안 틀린다', () => {
  TABLE.forEach(([name, want]) => {
    assert.strictEqual(markFrom(name), want,
      `${name || '(빈 이름)'} 의 표시가 틀렸다 — 이 값은 보고서 표지에 찍힌다`);
  });
});

test('★★★ 「주」를 낱말 안에서 지우지 않는다 (문자 클래스가 아니다)', () => {
  /* ★ 통과가 아니라 **실패했던 것**을 잰다. 이 셋이 앞 판에서 깨졌다 */
  assert.ok(markFrom('전주도시개발').startsWith('전주'), '전주에서 주가 사라진다');
  assert.ok(markFrom('제주에너지').startsWith('제주'), '제주에서 주가 사라진다');
  assert.strictEqual(markFrom('주식회사 대한개발'), '대한개발', '주식회사를 낱말로 안 뗀다');
  /* ★ 반대쪽 — 뗄 것은 떼야 한다 */
  assert.ok(!/[()㈜]/.test(markFrom('(주)한국전력')), '(주) 가 표시에 남는다');
});

test('★★★ 화면 사본과 서버 규칙이 같은 답을 낸다 (갈리면 문서와 화면이 다른 글자를 말한다)', () => {
  const auto = screenMark();
  TABLE.forEach(([name, want]) => {
    assert.strictEqual(auto(name), want,
      `화면 사본이 ${name || '(빈 이름)'} 을 다르게 읽는다`);
    assert.strictEqual(auto(name), markFrom(name), '화면과 서버가 갈렸다');
  });
});
