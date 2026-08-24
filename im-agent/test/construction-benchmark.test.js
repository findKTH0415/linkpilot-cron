/**
 * **공사비 대조 — 만들어 놓고 안 부르던 커넥터를 이었다.**
 *
 * ★★★ 2026-08-25 사장님: 「부르는곳을 만들어 · 공사비 대조해」.
 *
 *   최종 교차검증에서 `connectors/g2b.js`(조달청 낙찰)를 **아무 Agent 도
 *   안 부르고 있는 것**을 찾았다. 스모크에서만 돌았다.
 *
 *   ★ 이 저장소에서 **세 번째**로 나온 같은 결이다 — D-48(커넥터 다섯을
 *     만들어 놓고 안 부름) · D-62(`ess`·`solar` 가 테스트에서만 돎).
 *     만들어 두고 안 부르면 없는 것과 같고, 더 나쁜 것은 **「붙였다」고 적혀
 *     있어서 아무도 없는 줄 모른다**는 점이다.
 *
 * ★ 여기서 재는 것:
 *   ① 실제로 **불리는가** (05_validation 이 부른다)
 *   ② **총액끼리 안 견주는가** — 관급 낙찰과 개발사업 공사비는 규모가 다르다
 *   ③ **판정하지 않는가** — GREEN(정보)으로만 낸다
 *   ④ **모수와 기간을 함께 적는가** (§4.7)
 *   ⑤ **건너뛰면 건너뛴 사실을 남기는가** (D-48 의 교훈)
 *   ⑥ 지역을 못 정하면 **전국으로 대체하지 않는가** (§4.9)
 *   ⑦ **Dataset 에 안 넣는가** — 업종 평균이 딜의 값으로 실리면 안 된다
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const V = require('../agents/05-validation.js');

/* ── ⑥ 지역 특정 ────────────────────────────────────────── */

test('★★ 주소에서 시·도를 뽑는다 — 17개 행정구역 이름이라 짐작이 아니다', () => {
  assert.strictEqual(V.sidoOf('서울특별시 서초구 서초동'), '서울');
  assert.strictEqual(V.sidoOf('인천광역시 남동구 논현동'), '인천');
  assert.strictEqual(V.sidoOf('충청남도 천안시 서북구'), '충남');
  assert.strictEqual(V.sidoOf('전라북도 전주시 완산구'), '전북');
  assert.strictEqual(V.sidoOf('경상남도 창원시'), '경남');
});

test('★★★ 못 정하면 **null** — 전국으로 대체하지 않는다 (§4.9)', () => {
  assert.strictEqual(V.sidoOf('어딘가'), null);
  assert.strictEqual(V.sidoOf(''), null);
  assert.strictEqual(V.sidoOf(null), null);
});

/* ── ①②③④⑤⑦ 소스가 규칙을 지키는가 ──────────────────── */

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'agents', '05-validation.js'), 'utf8');
/** ★ 주석을 떼고 본다 — 경위를 잘 적어 둘수록 검사가 눈이 먼다 (CLAUDE.md §8) */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('★★★ 05_validation 이 실제로 부른다 — 만들어 두고 안 부르면 없는 것과 같다', () => {
  assert.ok(/require\('\.\.\/connectors\/g2b'\)/.test(CODE), 'g2b 를 안 들여온다');
  assert.ok(/await checkConstructionCost\(ds, ctx\)/.test(CODE),
    'run 이 공사비 대조를 안 부른다 — D-48 · D-62 와 같은 결이다');
});

test('★★★ **판정하지 않는다** — GREEN(정보)으로만 낸다', () => {
  const fn = CODE.slice(CODE.indexOf('async function checkConstructionCost'),
    CODE.indexOf('async function checkSponsor'));
  assert.ok(fn.length > 300, '함수를 못 잘랐다 — 검사가 아무것도 안 재고 있다');
  assert.ok(/flag\('GREEN', 'CONSTRUCTION_BENCHMARK'/.test(fn));
  assert.ok(!/flag\('RED'|flag\('YELLOW'/.test(fn),
    '관급과 민간은 발주 조건이 달라 어떤 문턱을 잡아도 자의적이다 — 늘 노란 검사가 된다');
});

test('★★★ 총액끼리 안 견준다 — 나누지 않는다', () => {
  const fn = CODE.slice(CODE.indexOf('async function checkConstructionCost'),
    CODE.indexOf('async function checkSponsor'));
  assert.ok(!/cost\.value\s*\/\s*r\.median|ratio/.test(fn),
    '총액을 나눠 배수를 낸다 — 규모가 다른 것을 틀렸다고 말하게 된다');
  assert.ok(/medianRate/.test(fn),
    '낙찰률을 안 쓴다 — 규모와 무관하고 가정이 안 들어가는 유일한 잣대다');
});

test('★★ 모수와 기간을 값과 함께 적는다 (§4.7)', () => {
  const fn = CODE.slice(CODE.indexOf('async function checkConstructionCost'),
    CODE.indexOf('async function checkSponsor'));
  assert.ok(/r\.count/.test(fn), '몇 건 중 중앙값인지 안 적는다');
  assert.ok(/r\.period/.test(fn), '조회 기간을 안 적는다');
  assert.ok(/rateCount/.test(fn), '낙찰률의 모수를 안 적는다');
  assert.ok(/rateReason/.test(fn), '낙찰률을 못 낸 사유를 안 적는다');
});

test('★★★ 건너뛰면 **건너뛴 사실을 남긴다** — 조용히 빠지면 「대조했는데 문제 없었다」로 읽힌다', () => {
  const fn = CODE.slice(CODE.indexOf('async function checkConstructionCost'),
    CODE.indexOf('async function checkSponsor'));
  assert.ok(/DATA_GO_KR_KEY 미설정/.test(fn), '키가 없을 때 말이 없다');
  assert.ok(/시·도를 특정하지 못했다/.test(fn), '지역을 못 정했을 때 말이 없다');
  assert.ok(/전국 값으로 대체하지 않는다/.test(fn), '§4.9 를 안 지킨다');
  assert.ok((fn.match(/warn\(/g) || []).length >= 4, '건너뛰는 갈래마다 말하지 않는다');
});

test('★★★ Dataset 에 안 넣는다 — 업종 평균이 이 딜의 값으로 실리면 안 된다 (D-48)', () => {
  const fn = CODE.slice(CODE.indexOf('async function checkConstructionCost'),
    CODE.indexOf('async function checkSponsor'));
  assert.ok(!/ds\.add|facts\.push/.test(fn), '조달청 낙찰가를 이 딜의 값으로 등록한다');
});

test('★★ 커넥터가 죽어도 검증 전체를 안 죽인다 (§4.6)', () => {
  const fn = CODE.slice(CODE.indexOf('async function checkConstructionCost'),
    CODE.indexOf('async function checkSponsor'));
  assert.ok(/try \{[\s\S]*await g2b\.benchmark[\s\S]*\} catch/.test(fn),
    '커넥터가 던지면 검증이 통째로 죽는다');
});
