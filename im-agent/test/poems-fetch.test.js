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

test('문서 고르기 — «시집 (판)/제목» 아래 쪽을 판마다 전부 · 띄어쓰기만 다르면 같은 제목 · 동음이의 안내는 시가 아니다', async () => {
  const { pickPages, isListPage, editionYear, poemLines } = await import(SRC);
  // 2026-10-21 실측 — 위키문헌 검색이 실제로 준 후보
  const hits = ['하늘과 바람과 별과 시 (1948년)/별 헤는 밤', '하늘과 바람과 별과 시 (1955년)/별헤는 밤', '하늘과 바람과 별과 시 (1955년)/거리에서', '하늘과 바람과 별과 시 (1948년)'];
  assert.deepStrictEqual(pickPages(hits, '별 헤는 밤'), hits.slice(0, 2));
  assert.deepStrictEqual(pickPages(['진달래꽃 (시집)/산유화', '진달래꽃 (시집)'], '산유화'), ['진달래꽃 (시집)/산유화']);
  assert.deepStrictEqual(pickPages(['진달래꽃', '진달래꽃 (시집)'], '진달래꽃'), ['진달래꽃'], '아래 쪽이 없으면 같은 제목의 윗문서');
  assert.deepStrictEqual(pickPages(['글로벌 세계 대백과사전/인명사전'], '산유화'), []);
  assert.strictEqual(editionYear('하늘과 바람과 별과 시 (1948년)/서시'), 1948);
  const disamb = '* [[진달래꽃 (시집)]]: 김소월의 시집.\n* [[진달래꽃 (시)]]: 시.';
  assert.strictEqual(isListPage(disamb, poemLines(disamb)), true, '그날 «2편 받음»으로 센 그 모양이다');
  assert.strictEqual(isListPage('{{동음이의}}\n본문', ['본문']), true);
  const poem = '<poem>\n나 보기가 역겨워\n가실 때에는\n</poem>';
  assert.strictEqual(isListPage(poem, poemLines(poem)), false);
});
