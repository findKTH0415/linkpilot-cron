'use strict';
// 저작권이 끝난 시 진단 — 사후 70년 판정과 위키문헌 원문 정리를 돌려서 잰다 (망을 안 탄다)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const SRC = path.resolve(__dirname, '..', '..', 'scripts', 'poems-fetch.mjs');

test('사후 70년 — 사망한 해 다음 해부터 70년이 지나야 자유이용 (저작권법 제39조·제44조)', async () => {
  const { isPublicDomain, WORKS } = await import(SRC);
  assert.strictEqual(isPublicDomain(1950, 2020), false, '1950 몰 → 2020년까지 보호');
  assert.strictEqual(isPublicDomain(1950, 2021), true);
  assert.ok(WORKS.every(w => isPublicDomain(w.died, 2026)), '목록의 작가는 전부 2026년에 보호가 끝났다');
  assert.ok(WORKS.every(w => w.titles.length && !w.text), '목록에는 제목만 — 본문을 손으로 적지 않는다');
});

test('wikitext → 본문 줄 — 틀·주석·분류·poem 태그를 걷는다 · 비면 null', async () => {
  const { poemLines } = await import(SRC);
  const wt = '{{머리말|제목=시|저자=작가}}\n<poem>\n첫째 줄<ref>주석</ref>\n둘째 [[낱말|줄]]\n\n셋째 줄\n</poem>\n[[분류:시]]';
  assert.deepStrictEqual(poemLines(wt), ['첫째 줄', '둘째 줄', '', '셋째 줄']);
  assert.strictEqual(poemLines('{{틀}}\n[[분류:시]]'), null);
});
