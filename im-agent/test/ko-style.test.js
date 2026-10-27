/* 한국어 AI 표현 점검 — im-agent/core/ko-style.js · CLAUDE.md §29
 * 찾기만 한다. 판단을 바꾸는 «불확실성 격상»만 MAJOR, 나머지는 MINOR. */
const test = require('node:test');
const assert = require('node:assert');
const ks = require('../core/ko-style');
const codes = (t) => ks.lint(t).findings.map((f) => f.code);

test('과장 수식어는 MINOR 로 알린다', () => {
  const f = ks.lint('당사는 혁신적인 솔루션을 제안한다.').findings;
  assert.ok(f.some((x) => x.code === 'STYLE_HYPE' && x.severity === 'MINOR'));
});

test('불확실성 격상(보장·확보·확정)은 MAJOR 다', () => {
  for (const s of ['목표 수익을 보장한다.', 'PF 를 확보했다.', '인허가 승인이 확정되었다.', '리스크가 없다.']) {
    const f = ks.lint(s).findings.find((x) => x.code === 'STYLE_UNCERTAINTY_UPGRADE');
    assert.ok(f && f.severity === 'MAJOR', s);
  }
});

test('«목표 수익률»·«협의 중»·«검토 가능»은 걸리지 않는다 (오탐 없음)', () => {
  assert.deepStrictEqual(codes('목표 수익률은 8% 이다. PF 는 협의 중이다. 인허가는 검토 가능하다.'), []);
});

test('AI 역할·작성 과정 설명은 알린다', () => {
  assert.ok(codes('본 보고서는 AI가 작성한 초안이다.').includes('STYLE_SELF_DESC'));
});

test('표·제목·인용·코드 줄은 보지 않는다', () => {
  assert.deepStrictEqual(codes('# 최고의 사업\n| 혁신적인 | 보장 수익률 |\n> 자료: 최고의 출처\n```\n무조건\n```'), []);
});

test('연결어가 한 줄에 넷 이상이면 알린다', () => {
  assert.ok(codes('또한 A 다. 아울러 B 다. 더불어 C 다. 나아가 D 다.').includes('STYLE_CONNECTOR'));
  assert.ok(!codes('또한 A 다. 아울러 B 다.').includes('STYLE_CONNECTOR'));
});

test('한다체·합니다체 섞임을 알리고, 한 형식이면 조용하다', () => {
  assert.ok(codes('가능하다. 필요하다. 진행합니다. 확인합니다.').includes('STYLE_MIXED_ENDING'));
  assert.ok(!codes('가능하다. 필요하다. 진행한다. 확인한다.').includes('STYLE_MIXED_ENDING'));
});

test('고치지 않는다 — 입력 글을 바꾼 값을 돌려주지 않는다', () => {
  const r = ks.lint('혁신적인 사업이다.');
  assert.ok(!('text' in r) && !('fixed' in r));
});
