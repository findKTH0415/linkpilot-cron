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
