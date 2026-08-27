'use strict';
/**
 * deploy-report.test.js — **배포 확인 한 장이 빠짐없이 그려지는가** 〈2026-08-27 · D-147〉.
 *
 * ★★ 이 검사가 지키는 것은 「예쁘게 나오는가」가 아니라 **「빠진 줄이 없는가」**다.
 *   처음 만든 판은 guard 의 열 칸 중 **일곱만** 잡았다 — 이름 안에 공백이 있는
 *   칸(「[저장] 막대 자리」)이 「두 칸 이상 띄면 경계」 규칙에 안 걸렸다.
 *   빠진 줄은 화면에서 **안 보이므로** 아무도 눈치채지 못한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const { guardRows, render } = require('../tools/deploy-report.js');

/** guard 가 실제로 찍는 모양 그대로 (pad(name,16) + 한 칸) */
const SAMPLE = [
  '배포·전달 전 교차검증 (CLAUDE.md §8)',
  '',
  '  ✅ 테스트           2167 통과 · 7 skip · 0 실패',
  '  ✅ [저장] 막대 자리 틀 안 34px 아래·꼬리 39px',
  '  ✅ 다른 갈래와 겹침 살아 있는 갈래 1개',
  '  ⚠️  문서 활자        글꼴이 이 자리에 없다',
  '',
  '  통과 9 · 실패 0 · 못 잼 1  ← 못 잰 것은 통과가 아니다',
  '',
  '⚠️  못 잰 것이 있다. 내보낼 때 **무엇을 못 쟀는지 말한다** (§8).',
].join('\n');

test('★★★ 이름 안에 공백이 있는 칸도 빠뜨리지 않는다', () => {
  const g = guardRows(SAMPLE);
  assert.ok(g, '아무것도 못 읽었다');
  const names = g.rows.map((r) => r.name);
  assert.deepStrictEqual(names, ['테스트', '[저장] 막대 자리', '다른 갈래와 겹침', '문서 활자'],
    '칸이 빠지거나 이름이 잘렸다 — 빠진 줄은 화면에서 안 보인다');
  assert.deepStrictEqual(g.tally, ['9', '0', '1'], '통과·실패·못 잼 숫자를 못 읽었다');
});

test('★★★ 마지막 판정 줄을 **칸으로 세지 않는다**', () => {
  // 「❌ **내보내지 않는다**」는 들여쓰기가 없다. 안 가르면 없는 칸이 하나 생긴다
  const g = guardRows(SAMPLE + '\n❌ **내보내지 않는다.** 위 실패를 먼저 고친다.\n');
  assert.strictEqual(g.rows.length, 4, '판정 줄이 칸으로 들어왔다');
});

test('★★ 못 읽었으면 **빈 표가 아니라 그렇다고 말한다**', () => {
  assert.strictEqual(guardRows(''), null);
  assert.strictEqual(guardRows('아무 상관 없는 글'), null);
  const html = render({ stamp: 'abc12345', sha: 'deadbeef', at: '지금', steps: [], guard: null });
  assert.match(html, /교차검증 결과를 못 읽었다/,
    '못 읽고도 조용하면 「다 통과」로 보인다 — 가장 비싼 거짓말이다');
});

test('★★ 실패가 있으면 **첫 줄이 초록이 아니다**', () => {
  const bad = render({ stamp: 'a', at: '지금', steps: [{ name: 'Upload', conclusion: 'failure' }],
    guard: { rows: [], tally: ['8', '1', '1'] } });
  assert.match(bad, /class="v bad"/, '실패인데 첫 줄이 초록이면 아무도 안 본다');
  const ok = render({ stamp: 'a', at: '지금', steps: [{ name: 'Upload', conclusion: 'success' }],
    guard: { rows: [], tally: ['9', '0', '1'] } });
  assert.match(ok, /class="v ok"/);
});

test('★★★ 판 지문을 **읽어서** 쓴다 — 손으로 박으면 그날부터 옛말을 한다', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'deploy-report.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /LP_BUILD = '\(\[0-9a-f\]\+\)'/, '지문을 파일에서 읽지 않는다');
});

test('★★ 제목이 발행할 때마다 바뀌지 않는다 — 목록에서 같은 장을 알아봐야 한다', () => {
  const a = render({ stamp: 'aaaaaaaa', at: '지금', steps: [], guard: null });
  const b = render({ stamp: 'bbbbbbbb', at: '지금', steps: [], guard: null });
  const t = (h) => (h.match(/<title>([^<]*)<\/title>/) || [])[1];
  assert.strictEqual(t(a), t(b), '판이 바뀌면 제목이 바뀐다 — 다른 장으로 보인다');
  assert.match(a, /aaaaaaaa/, '그래도 지문은 장 안에 있어야 한다');
});
