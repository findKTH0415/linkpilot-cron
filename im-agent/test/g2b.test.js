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
/**
 * ★★★ **셋을 가른다** 〈2026-08-23 실측으로 하나 늘었다〉.
 *
 *   ① 못 불렀다  ② 불렀는데 조건에 맞는 건이 없다  ③ **건은 왔는데 금액 필드가
 *   아예 없다**(오퍼레이션이 다른 것). 앞 판은 ②와 ③을 한 문장에 뭉쳐
 *   「조건을 넓히거나 응답 필드명을 확인」이라고 했다. 그러면 사람은 **기간부터
 *   넓힌다** — 그쪽이 만만하다. 그런데 ③ 은 기간을 아무리 넓혀도 안 나온다.
 */
test('★★★ 「건이 없다」와 「금액 필드가 없다」를 가른다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');

  assert.match(src, /조회는 됐지만 조건에 맞는 낙찰 건이 없다/, '② 를 말하지 않는다');
  assert.match(src, /금액 필드가 하나도 없다/, '③ 을 말하지 않는다 — 기간만 넓히게 된다');
  assert.match(src, /fieldMismatch/, '③ 을 코드가 구분해서 들고 다니지 않는다');

  /* ★ ③ 일 때는 **받은 필드 이름을 그대로 적는다.** 그것이 다음에 무엇을 볼지를
     정해 준다 — 「필드명을 확인하라」는 말만으로는 어디를 볼지 알 수 없다 */
  assert.match(src, /받은 필드/, '받은 필드 이름을 안 적는다');
});

/**
 * ★★★ **추정가격으로 기초금액을 메우지 않는다** 〈2026-08-23 실측〉.
 *
 *   낙찰률 = 낙찰금액 ÷ **기초금액**이다. 기초금액에는 부가세가 들어 있고
 *   추정가격에는 없다. 분모에 추정가격을 넣으면 **분모가 작아져 낙찰률이
 *   부풀려지는데, 나온 값은 그럴듯하고 출처 표시도 멀쩡하다** — 문서만 봐서는
 *   못 잡는다. 그래서 대체하지 않고 **안 낸다** (§4.9).
 */
test('★★★ 기초금액이 없으면 낙찰률을 내지 않는다 (추정가격으로 메우지 않는다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

  /* ① 분모를 만드는 자리에 추정가격이 섞이지 않는다 */
  const m = /const base = toEok\(([^)]*)\);/.exec(code);
  assert.ok(m, '기초금액을 만드는 줄을 못 찾았다 — 이 검사가 아무것도 안 재게 됐다');
  ['presmptPrce', 'bdgtAmt', 'govsplyAmt'].forEach((k) => {
    assert.ok(m[1].indexOf(k) === -1,
      `분모에 「${k}」 가 섞였다 — 낙찰률이 부풀려지고, 그 값은 그럴듯하게 나온다`);
  });
  assert.match(m[1], /bssamt/, '기초금액 필드를 아예 안 본다');

  /* ② 못 냈으면 **왜 못 냈는지**가 값 옆에 붙는다 (§4.7) */
  assert.match(code, /rateReason/,
    '낙찰률을 못 낸 사유가 없다 — null 만 두면 「0 이다」와 「못 냈다」가 같아 보인다');
});

/**
 * ★★★ **낙찰률은 받아 쓴다. 우리가 나누지 않는다** 〈2026-08-23 실측〉.
 *
 *   실측으로 고른 오퍼레이션(`getScsbidListSttusCnstwkPPSSrch`)이 `sucsfbidRate`
 *   를 실어 준다(90.089). 조달청이 낸 값이므로 **분모를 우리가 고를 일이 없다**
 *   — 기초금액이냐 추정가격이냐로 헤맨 자리가 통째로 사라진다.
 *
 *   ★ 여기서 지키는 것은 **되돌아가지 않는 것**이다. 앞 판들은 금액이 아예 없는
 *     오퍼레이션(`getOpengResultListInfo…`)을 부르고 있었고, 그것은 `resultCode
 *     00` 으로 통과하기 때문에 아무 검사에도 안 걸렸다.
 */
test('★★★ 낙찰 오퍼레이션과 낙찰률 출처가 실측에 고정되어 있다', () => {
  const g = require('../connectors/g2b');
  assert.match(g.OPS.award.path, /getScsbidListSttusCnstwkPPSSrch/,
    '금액이 실리는 오퍼레이션이 아니다 — getOpengResultListInfo… 는 200 인데 금액이 없다');

  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

  assert.match(code, /sucsfbidRate/, '응답이 주는 낙찰률을 안 쓴다');
  assert.match(code, /rateFrom/, '낙찰률을 어디서 얻었는지가 값과 함께 안 다닌다 (§4.7)');

  /* ★ 빈 값을 0 으로 세지 않는다 — 결측을 0 으로 세면 중앙값이 조용히 내려앉는다 */
  assert.match(code, /n > 0/, '0·빈 값을 낙찰률로 받아들인다');

  /* ★ 거르는 칸이 비었을 때를 「조건에 맞는 건이 없다」와 섞지 않는다 */
  assert.match(src, /공고명·수요기관이 전부 비어 있다/,
    '필드가 비어 0건인 경우를 조건 문제와 섞는다 — 사람이 조건만 넓히게 된다');
});

/**
 * ★★★ **필드 이름을 실측에 고정한다** 〈2026-08-23 · 한 건 전체를 떠서 대조〉.
 *
 *   앞 판은 낙찰업체를 `opengCorpNm ?? sucsfbidCorpNm` 에서 찾았다. **둘 다 없는
 *   이름**이라 업체명이 늘 빈칸으로 나갔다 — 빈칸은 오류가 안 나서 화면만 봐서는
 *   안 잡힌다. 실제 이름은 `bidwinnrNm` 이다.
 */
test('★★★ 낙찰 응답의 필드 이름이 실측과 같다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'g2b.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

  /* 실측한 한 건에 실제로 있던 이름들 */
  ['bidNtceNm', 'dminsttNm', 'sucsfbidAmt', 'sucsfbidRate', 'rlOpengDt', 'bidwinnrNm']
    .forEach((k) => assert.match(code, new RegExp(k), `실측에 있는 「${k}」 를 안 읽는다`));

  /* ★ 낙찰업체는 **첫 자리**가 실측 이름이어야 한다. 뒤로 밀면 없는 이름을
     먼저 보게 되고, 그건 빈칸으로 조용히 지나간다 */
  const w = /winner: txt\(x\.(\w+)/.exec(code);
  assert.ok(w, 'winner 를 만드는 줄을 못 찾았다');
  assert.strictEqual(w[1], 'bidwinnrNm', `낙찰업체를 ${w[1]} 에서 먼저 찾는다 — 실측엔 없는 이름이다`);

  /* ★ 지역은 업체 주소로 거르지 않는다 — 서울 업체가 여수 공사를 딴다 */
  const f = /if \(o\.region && [^\n]*\)/.exec(code);
  assert.ok(f, '지역 거르는 줄을 못 찾았다');
  assert.ok(f[0].indexOf('bidwinnrAdrs') === -1,
    '낙찰업체 주소로 지역을 거른다 — 그건 공사 위치가 아니라 업체 소재지다');
});
