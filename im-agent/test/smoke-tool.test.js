'use strict';
/**
 * 진단 도구(`npm run im:smoke`) 자체를 검사한다 〈2026-08-22〉.
 *
 * ★★ **왜 생겼나 — 실제로 당했다.** 도구가 `molit.buildingPermit(...)` 를 부르고
 *   있었는데 **그런 함수가 없었다**(진짜 이름은 `buildingPermits`). 그래서 실제
 *   키를 넣고 돌리자 거기서 통째로 터졌고, **그 뒤 절이 전부 안 돌았다** —
 *   실거래가·조달청·공장등록·수출입·환경·KOSIS 까지.
 *
 * ★★ 아무도 몰랐던 이유가 핵심이다: 이 도구는 **키가 있어야 그 줄에 닿는다.**
 *   키 없는 환경(CI·이 저장소)에서는 앞에서 다 건너뛰므로 죽은 줄을 지나간다.
 *   「도구가 있다」와 「도구가 끝까지 돈다」는 다른 일이다 (M-08 과 같은 병).
 *
 * ★ 그래서 **부르지 않고도 잡을 수 있는 것**을 잡는다 — 이름이 실제로 있는지.
 *   네트워크도 키도 필요 없다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools/smoke-public-data.js');

/** 도구가 `const x = require('../connectors/y')` 로 들여온 것들 */
function importsOf(src) {
  const map = {};
  const re = /const\s+(\w+)\s*=\s*require\('(\.\.\/[^']+)'\)/g;
  let m;
  while ((m = re.exec(src))) map[m[1]] = m[2];
  return map;
}

test('★★ 진단 도구가 부르는 함수가 실제로 있다 (없으면 그 뒤가 통째로 안 돈다)', () => {
  const src = fs.readFileSync(TOOL, 'utf8');
  const mods = importsOf(src);
  assert.ok(Object.keys(mods).length >= 5,
    `도구가 들여오는 모듈을 ${Object.keys(mods).length}개만 찾았다 — 읽는 방식이 어긋났다`);

  /* ★ 주석 안의 이름은 세지 않는다. 지운 절을 설명하는 주석이 남아 있고,
     그것까지 잡으면 「설명을 적을 수 없는」 검사가 된다 */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const missing = [];
  let checked = 0;
  for (const [alias, rel] of Object.entries(mods)) {
    let mod;
    /* ★ 경로는 **도구 파일 기준**이다. ROOT 기준으로 붙이면 한 단이 어긋나
       전부 require 에 실패하고, 그러면 검사가 **아무것도 안 세고 통과**한다.
       그 상태를 잡으려고 아래에 「몇 곳을 봤나」를 함께 단언한다 */
    try { mod = require(path.resolve(path.dirname(TOOL), rel)); } catch (_) { continue; }
    if (!mod || typeof mod !== 'object') continue;
    const re = new RegExp(`\\b${alias}\\.(\\w+)\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(code))) {
      const fn = m[1];
      checked += 1;
      if (typeof mod[fn] !== 'function') missing.push(`${alias}.${fn}`);
    }
  }

  assert.ok(checked >= 20, `부르는 자리를 ${checked}곳만 찾았다 — 검사가 헛돌고 있다`);
  assert.deepStrictEqual([...new Set(missing)], [],
    '진단 도구가 없는 함수를 부른다 — 실제로 돌리면 그 자리에서 터지고 '
    + '**그 뒤 항목이 전부 안 돈다.** 키가 없는 환경에서는 거기까지 못 가서 안 보인다');
});

test('★ 같은 조회를 두 절에서 되풀이하지 않는다 (일 10,000건 한도 · §4.5)', () => {
  const src = fs.readFileSync(TOOL, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const calls = [...src.matchAll(/\bmolit\.(buildingPermits|housingPermits|buildingRegister)\s*\(/g)]
    .map(m => m[1]);
  const dup = calls.filter((x, i) => calls.indexOf(x) !== i);
  assert.deepStrictEqual([...new Set(dup)], [],
    `같은 조회를 두 번 부른다 (${[...new Set(dup)].join(', ')}) — 한도를 두 배로 쓴다`);
});

test('★ 한 절이 터져도 무엇이 안 돌았는지 말한다', () => {
  const src = fs.readFileSync(TOOL, 'utf8');
  assert.match(src, /터진 자리/, '어디서 터졌는지 안 알려 준다 — 「is not a function」만으로는 못 찾는다');
  assert.match(src, /이 뒤의 항목은 돌지 않았다/,
    '멈춘 뒤가 안 돌았다는 것을 안 말한다 — 통과한 줄만 보고 「다 됐다」로 읽힌다');
});

/**
 * ★★ **인자를 안 주면 예시 주소로 되돌아간다 — 그것을 화면이 말해야 한다**
 *   〈2026-08-22 · 실제로 당했다〉.
 *
 *   `--kosis-tbl` 만 주고 돌렸더니 주소가 예시로 되돌아갔고, VWorld 가 그 예시를
 *   못 찾아 **그 뒤 필지 계열 10여 개가 통째로 건너뛰어졌다.** 14/16 이던 것이
 *   5/7 로 보였다 — **나빠진 것이 아니라 재지 않은 것**인데 숫자만 보면 같다.
 */
test('★★ 진단 도구가 주소를 .env 에서도 받고, 예시로 되돌아간 것을 말한다', () => {
  const src = fs.readFileSync(TOOL, 'utf8');
  assert.match(src, /IM_SMOKE_ADDRESS/,
    '.env 로 주소를 못 준다 — 인자를 매번 다시 쳐야 하고, 한 번 빠뜨리면 조용히 예시로 돈다');
  assert.match(src, /예시 주소\*\*로 잽니다|예시 주소/,
    '예시로 되돌아간 것을 화면이 안 말한다 — 「왜 갑자기 안 되지」로 헤매게 된다');

  /* ★ 차례가 뒤집히면 안 된다: 인자가 .env 를 이긴다. 반대면 한 번 넣은 .env
     때문에 `--address` 가 먹지 않고, 그 증상은 「주소를 줬는데 무시된다」다 */
  const at = src.indexOf('const ADDRESS =');
  assert.ok(at > -1, 'ADDRESS 를 정하는 자리를 못 찾았다');
  const line = src.slice(at, src.indexOf('\n', at));
  assert.ok(line.indexOf("argOf('--address')") < line.indexOf('IM_SMOKE_ADDRESS'),
    '.env 가 인자보다 앞에 있다 — --address 를 줘도 무시된다');
});

/**
 * ★★ **`.env.example` 에는 넣지 않는다** 〈2026-08-22 · 검사가 막았다〉.
 *
 *   처음에 거기 적었더니 검사 둘이 울었다 — 「.env.example 의 키는 전부 마스킹
 *   대상이어야 한다」와 「인수인계서에 있어야 한다」. 둘 다 **시크릿을 위한
 *   규칙**이고 옳다. 주소는 시크릿이 아니라서 마스킹 대상에 넣을 수 없고,
 *   넣으면 **진단 화면에서 주소가 가려져** 도구가 쓸모없어진다.
 *
 * ★ 그래서 규칙을 약하게 만들지 않고, **알려 주는 자리를 옮겼다** — 예시
 *   주소로 되돌아가는 바로 그 순간에 화면이 말한다. 필요할 때 눈앞에 뜨는
 *   것이 목록 어딘가에 적혀 있는 것보다 낫다.
 */
test('★ 예시로 되돌아갈 때 .env 로 두는 법을 그 자리에서 알려 준다', () => {
  const src = fs.readFileSync(TOOL, 'utf8');
  const at = src.indexOf('예시 주소');
  assert.ok(at > -1, '예시로 되돌아간 것을 안 말한다');
  const near = src.slice(at, at + 600);
  assert.match(near, /IM_SMOKE_ADDRESS/,
    '되돌아갔다고만 하고 **어떻게 하면 안 되는지**를 안 알려 준다');
  assert.match(near, /--address/, '인자로 주는 법을 안 알려 준다');

  // 시크릿 목록에 섞이지 않았는지 — 주소가 마스킹되면 진단이 못 읽힌다
  const ex = fs.readFileSync(path.join(ROOT, '..', '.env.example'), 'utf8');
  assert.ok(!/IM_SMOKE_ADDRESS/.test(ex),
    '.env.example 에 들어갔다 — 거기 키는 전부 마스킹 대상이라 주소가 가려진다');
});
