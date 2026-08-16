'use strict';
/**
 * g2b.test.js — 조달청 공사 낙찰 Connector.
 *
 * 이 커넥터의 위험은 **그럴듯한 단가**다. 낙찰금액을 아무 면적으로 나누면
 * 「출처 있는 금액 ÷ 짐작한 면적」이 되는데 결과는 정상적인 ㎡당 단가로 보인다.
 * 그래서 나눗셈을 하지 않는다는 것을 테스트로 못 박는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const g2b = require('../connectors/g2b');

function withoutKey(fn) {
  const saved = process.env.DATA_GO_KR_KEY;
  delete process.env.DATA_GO_KR_KEY;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.DATA_GO_KR_KEY;
    else process.env.DATA_GO_KR_KEY = saved;
  }
}

test('★ 키가 없으면 지어내지 않고 unavailable 을 돌려준다', async () => {
  const r = await withoutKey(() => g2b.benchmark({ region: '인천' }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.unavailable, true);
  assert.match(r.error, /DATA_GO_KR_KEY/);
  assert.strictEqual(r.medianAwardEok, undefined, '값을 만들어 두면 안 된다');
});

/** ★ Encoding 키는 **부르기 전에** 막는다 — 증상이 "키가 틀렸다"와 구분되지 않는다 */
test('★ Encoding 인증키를 부르기 전에 막는다', async () => {
  const saved = process.env.DATA_GO_KR_KEY;
  process.env.DATA_GO_KR_KEY = 'abcd%2FefgH%2BijklMNOP1234567890';
  try {
    const r = await g2b.benchmark({});
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Decoding\(일반\) 인증키/);
  } finally {
    if (saved === undefined) delete process.env.DATA_GO_KR_KEY;
    else process.env.DATA_GO_KR_KEY = saved;
  }
});

/**
 * ★ **㎡당 단가를 자동으로 만들지 않는다.** 공고에 연면적이 없어서 면적을
 *   짐작해야 하는데, 짐작이 들어간 값은 IM 에 들어갈 수 없다 (§4.8).
 */
test('★ ㎡당 단가를 만들지 않는다 — 이유와 함께 비워 둔다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');
  assert.match(src, /unitPrice: null/, 'unitPrice 를 만들고 있다');
  assert.match(src, /unitPriceReason/, '왜 안 내는지 적어야 한다 — 없으면 버그로 읽힌다');
  // 면적으로 나누는 코드가 없어야 한다
  assert.ok(!/awardEok\s*\/\s*\w*[Aa]rea/.test(src), '낙찰금액을 면적으로 나누고 있다');
});

/** ★ 낙찰률은 출처 있는 두 값의 비라 계산해도 된다 (가정계수가 없다) */
test('★ 낙찰률은 낙찰금액 ÷ 기초금액이다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');
  assert.match(src, /awardRate:.*award \/ base/s);
});

/**
 * ★ 평균이 아니라 중앙값. 관급공사는 몇백만 원 보수와 수백억 신축이 한 목록에
 *   섞여 평균이 한 건에 끌려간다.
 */
test('★ 중앙값을 쓴다 (짝수 개면 가운데 둘의 평균)', () => {
  assert.strictEqual(g2b.median([1, 5, 3]), 3);
  assert.strictEqual(g2b.median([1, 3, 5, 7]), 4);
  assert.strictEqual(g2b.median([]), null, '표본이 없으면 0 이 아니라 null 이다');
  assert.strictEqual(g2b.median([2, NaN, 4]), 3, '숫자가 아닌 값은 세지 않는다');

  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');
  assert.ok(!/reduce\([^)]*\+[^)]*\)\s*\/\s*\w+\.length/.test(src), '평균을 내고 있다');
});

/** ★ 조회 기간을 명시한다 — 정렬 방향이 문서에 없어 앞에서 집으면 옛날 값을 쓴다 (§4.4) */
test('★ 조회 구간을 명시하고 받은 뒤 직접 정렬한다', () => {
  const w = g2b.windowOf(12, new Date('2026-08-16T00:00:00Z'));
  assert.strictEqual(w.from, '202508160000');
  assert.strictEqual(w.to, '202608162359');
  assert.strictEqual(g2b.windowOf(0).from.length, 12, '개월 수가 0 이어도 구간을 만든다');

  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');
  assert.match(src, /rows\.sort\(/, '응답 순서를 그대로 믿으면 안 된다');
});

/** ★ 모수와 기간을 값에서 떼지 않는다 (§4.7) */
test('★ 출처에 건수와 기간이 함께 붙는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');
  assert.match(src, /label: `공사 낙찰금액 중앙값 \(\$\{period\} · \$\{r\.count\}건\)`/,
    '「47억」만 남고 몇 건 중 중앙값인지 사라지면 안 된다');
  assert.match(src, /관급공사 낙찰 실적이다/,
    '민간 공사비와 다르다는 것을 출처에 적어야 한다 — 그대로 옮겨 쓰면 안 되는 값이다');
});

test('★ 원 → 억원으로 정규화한다', () => {
  assert.strictEqual(g2b.toEok('12345678900'), 123.456789);
  assert.strictEqual(g2b.toEok(''), null);
  assert.strictEqual(g2b.toEok(null), null);
});

/** ★ 오퍼레이션 이름을 두 곳에 적지 않는다 */
test('★ 엔드포인트가 한 곳에만 있다', () => {
  assert.ok(g2b.OPS.award.path && g2b.OPS.notice.path);
  const smoke = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  assert.ok(!smoke.includes(g2b.OPS.award.path), '스모크가 경로를 베껴 적고 있다');
});

/**
 * ★ 아직 실제 키로 대조하지 못했다는 사실을 **코드에 남긴다.**
 *   지우면 검증된 커넥터와 구분이 안 되고, 값이 비어도 아무도 의심하지 않는다.
 */
test('★ 미검증이라는 사실이 코드와 스모크에 적혀 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');
  assert.match(src, /검증되지 않았다/, '미검증 표시가 사라졌다');
  assert.match(src, /D-36/, '등록부 번호가 있어야 어디서 닫는지 알 수 있다');

  const smoke = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  assert.match(smoke, /공사 낙찰 \(조달청\)/, '스모크에 항목이 없다 — 붙였는데 확인할 방법이 없다');
});

/** ★ 조회는 됐는데 값이 없는 경우와, 못 부른 경우를 가른다 */
test('★ 「조건에 맞는 건이 없다」와 「못 불렀다」를 가른다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');
  assert.match(src, /조회는 됐지만 조건에 맞는 낙찰 건이 없다/);
  assert.match(src, /응답 필드명을 확인해야 한다/,
    '필드명이 달라 빈 것일 수도 있다 — 그 가능성을 적어야 추적이 된다');
});
