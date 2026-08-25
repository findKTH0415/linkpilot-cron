'use strict';
/**
 * registry-check.test.js — 번호 발급 장치가 **오탐 없이** 충돌을 잡는가.
 *
 * ★ 오탐이 섞이면 아무도 이 도구를 안 본다. 그러면 없는 것과 같다 —
 *   실제로 첫 판이 D-84(개정)를 D-85(충돌)와 똑같이 「다르다」로 냈다.
 *   그래서 **뿌리(main)에 그 번호가 있느냐**로 가른다.
 */
const test = require('node:test');
const assert = require('node:assert');
const rc = require('../tools/registry-check');

const doc = lines => lines.join('\n');
const H = (id, title, status = '🟠') => `### ${status} ${id}. ${title}`;

test('머리말에서 번호·상태·제목을 뽑는다', () => {
  const items = rc.parse(doc([
    '# 등록부', '', H('D-10', '저장소 공개 범위'), '본문', H('D-84', '`im-flow` 쓰는 이', '✅'),
    '### 결정된 것들',           // 번호 없는 머리말은 세지 않는다
  ]));
  assert.deepStrictEqual(items.map(i => i.id), ['D-10', 'D-84']);
  assert.strictEqual(items[1].status, '✅');
  assert.match(items[0].title, /저장소 공개/);
});

test('한 갈래 안에서 번호를 두 번 쓰면 잡는다', () => {
  const items = rc.parse(doc([H('D-90', '첫째'), H('D-90', '둘째')]));
  const d = rc.localDuplicates(items);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].id, 'D-90');
});

test('★ 뿌리에 없는 번호를 두 갈래가 각자 붙이면 — 충돌', () => {
  const base = rc.parse(doc([H('D-10', '저장소 공개 범위')]));
  const by = {
    A: rc.parse(doc([H('D-85', '조달청 기초금액')])),
    B: rc.parse(doc([H('D-85', '오케스트레이터가 pipeline 대체')])),
  };
  const { conflicts, revisions } = rc.crossConflicts(by, base);
  assert.strictEqual(conflicts.length, 1, '충돌을 못 잡았다');
  assert.strictEqual(conflicts[0].id, 'D-85');
  assert.strictEqual(revisions.length, 0);
});

test('★ 뿌리에 있는 번호의 제목이 갈리면 — 충돌이 아니라 개정', () => {
  const base = rc.parse(doc([H('D-84', '`im-flow` 에 쓰는 이를 하나로 할 것인가')]));
  const by = {
    main: base,
    A: rc.parse(doc([H('D-84', '`im-flow` 에 쓰는 이는 하나', '✅')])),
    B: base,
  };
  const { conflicts, revisions } = rc.crossConflicts(by, base);
  assert.strictEqual(conflicts.length, 0, `개정을 충돌로 잡았다 (오탐)`);
  assert.strictEqual(revisions.length, 1);
  assert.strictEqual(revisions[0].id, 'D-84');
});

test('같은 항목의 상태만 갈리면 개정으로 센다 (미결정 → 결정됨)', () => {
  const base = rc.parse(doc([H('D-83', 'MCP 로 붙일 것인가')]));
  const by = { A: base, B: rc.parse(doc([H('D-83', 'MCP 로 붙일 것인가', '✅')])) };
  const { conflicts, revisions } = rc.crossConflicts(by, base);
  assert.strictEqual(conflicts.length, 0);
  assert.strictEqual(revisions.length, 1);
});

test('★ 다음 번호는 가장 큰 것 +1 — 빈 구멍을 재활용하지 않는다', () => {
  // 옛 대화·커밋이 그 번호를 다른 뜻으로 부른다
  const by = { A: rc.parse(doc([H('D-1', 'a'), H('D-5', 'b'), H('D-9', 'c')])) };
  const f = rc.nextFree(by);
  assert.strictEqual(f.next, 10, `구멍(D-2)을 재활용했다: D-${f.next}`);
  assert.strictEqual(f.maxUsed, 9);
});

test('제목 대조는 꾸밈(별표·백틱·괄호·공백)을 무시한다', () => {
  assert.ok(rc.sameSubject('`im-flow` 에 **쓰는 이를** 하나로', 'im-flow 에 쓰는 이를 하나로'));
  assert.ok(!rc.sameSubject('조달청 기초금액을 어디서', '오케스트레이터가 pipeline'));
});

test('★ 실제 등록부에 번호가 겹치지 않는다', () => {
  const fs = require('fs');
  const path = require('path');
  const full = path.join(__dirname, '..', '..', rc.DOC);
  const items = rc.parse(fs.readFileSync(full, 'utf8'));
  assert.ok(items.length > 50, `등록부를 못 읽었다 (${items.length}건)`);
  const dups = rc.localDuplicates(items);
  assert.deepStrictEqual(dups.map(d => d.id), [], '등록부 안에서 번호가 겹친다');
});

test('★ 등록부에 번호 배정 규칙이 살아 있다', () => {
  const fs = require('fs');
  const path = require('path');
  const t = fs.readFileSync(path.join(__dirname, '..', '..', rc.DOC), 'utf8');
  assert.match(t, /npm run d:next/, '번호를 어디서 받는지가 등록부에 없다');
  assert.match(t, /늦게 붙인 쪽이 양보/, '충돌 푸는 규칙이 사라졌다');
});
