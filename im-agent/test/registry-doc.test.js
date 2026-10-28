'use strict';
/**
 * registry-doc — **등록부를 읽는 곳이 한 곳인가** 〈2026-08-26 · D-134〉
 *
 * ★★★ 이 검사가 막는 것은 하나다 —
 *   표를 **또 옮겼을 때 읽는 곳 하나가 옛 파일을 읽고도 초록으로 남는 것.**
 *   읽긴 읽으니 오류가 안 난다. 그때 그 검사는 **아무것도 안 재면서 통과**한다.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const R = require('../core/registry-doc.js');

test('★ 두 파일이 다 있고, 각자 제 몫만 담는다', () => {
  assert.ok(fs.existsSync(R.REGISTRY), '등록부가 없다');
  assert.ok(fs.existsSync(R.DECISIONS), '결정 표가 없다');
  assert.ok(R.items().length > 50, '항목을 못 읽었다');
  assert.ok(R.decided().length > 50, '결정 표를 못 읽었다');
});

test('★★★ 표가 두 벌이 아니다 — 두 벌이면 반드시 한쪽이 옛말을 한다', () => {
  const reg = R.read(R.REGISTRY);
  const afterOut = reg.slice(reg.indexOf('## 범위 외'));
  assert.ok(!/^\| D-\d+ \| \*\*/m.test(afterOut.replace(/^## 결정 기록 →[\s\S]*$/m, '')),
    '등록부에 결정 표가 그대로 남아 있다');
  // 그런데 **가리키는 줄은 있어야 한다** — 없으면 사람이 표를 못 찾는다
  assert.match(reg, /결정-기록\.md/, '등록부가 표가 어디로 갔는지 안 가리킨다');
});

test('★★ 적힌 건수와 센 건수가 같다 (손으로 적은 숫자는 코드가 바뀐 날부터 옛말이다)', () => {
  const s = R.statedCounts();
  const a = R.actualCounts();
  assert.ok(s, '머리에 건수 줄이 없다');
  assert.strictEqual(a.open, s.open, '미결정 건수가 다르다');
  assert.strictEqual(a.decided, s.decided, '결정 건수가 다르다');
});

test('★★★ 표 파일만 센다 — 본문의 「견주는 표」를 결정으로 세지 않는다', () => {
  // 앞 판에서 실제로 헛울음이 났다: 두 작업선의 번호를 견주는 대조표가
  // 본문에 있는데, 문서 전체에서 `| D-nn |` 을 세니 그것까지 결정이 되었다.
  const reg = R.read(R.REGISTRY);
  const inBody = [...reg.matchAll(/^\| (D-\d+) \|/gm)].length;
  const inTable = R.decided().length;
  assert.notStrictEqual(inBody, inTable,
    '본문에도 같은 수가 있으면 이 검사가 아무것도 안 가른다 — 표본을 다시 본다');
  assert.strictEqual(R.decided(R.read(R.DECISIONS)).length, inTable,
    '표 파일에서 센 값과 기본값이 다르다');
});

test('★★★ 읽는 곳이 경로를 따로 적지 않는다 (주석은 떼고 본다)', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = [
    path.join(__dirname, 'flow.test.js'),
    path.join(__dirname, 'check-model.test.js'),
  ];
  for (const f of files) {
    const src = strip(fs.readFileSync(f, 'utf8'));
    assert.ok(!/결정-기록\.md/.test(src),
      `${path.basename(f)} 가 결정 표 경로를 직접 적었다 — 다음에 옮길 때 여기가 빠진다`);
    assert.ok(!/'## 결정 기록'/.test(src),
      `${path.basename(f)} 가 옛 절 이름으로 자른다 — 이제 그 절은 등록부에 없다`);
  }
});

test('★★ 이모지를 문자 집합으로 쓰지 않는다 (서로게이트 반쪽이 된다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'registry-doc.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\[[🔴🟠🟡⚪✅]/u.test(src),
    '이모지를 [ ] 안에 넣으면 u 플래그 없이는 반쪽들의 집합이 된다');
  assert.match(src, /gmu\)/, '유니코드 플래그 없이 이모지를 다루면 안 된다');
});

test('★ 스스로 돌면 센 값과 적힌 값을 나란히 말한다', () => {
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '..', 'core', 'registry-doc.js')], { encoding: 'utf8' });
  assert.match(out, /센 값/);
  assert.match(out, /적힌 값/);
  assert.match(out, /● 같다/, '지금 등록부가 어긋나 있다 — 머리의 건수를 고친다');
});
