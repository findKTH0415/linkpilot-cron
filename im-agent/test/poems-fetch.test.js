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

test('판 가르기 — «현대어»·«원문» 묶음을 따로 · 머리글이 없으면 null · 그려진 판에서는 시 칸만 읽는다', async () => {
  const { poemVersions, htmlPoemLines } = await import(SRC);
  // 2026-10-21 실측 모양(진달래꽃) — 첫 줄이 «현대어»로 섞여 나왔다
  const wt = "{{머리말|제목=진달래꽃}}\n'''현대어'''\n\n<poem>\n나 보기가 역겨워\n가실 때에는\n</poem>\n{{Multicol-break}}\n'''원문'''\n{{옛한글/시작}}\n<poem>\n나보기가 역겨워\n가실ᄯᅢ에는\n</poem>";
  const v = poemVersions(wt);
  assert.deepStrictEqual(v.map(x => x.label), ['현대어', '원문']);
  assert.deepStrictEqual(v[0].lines, ['나 보기가 역겨워', '가실 때에는']);
  assert.strictEqual(v[1].lines[1], '가실ᄯᅢ에는');
  assert.deepStrictEqual(poemVersions('<poem>\n한 줄\n</poem>').map(x => x.label), [null], '머리글이 없으면 지어 붙이지 않는다');
  const html = '<table class="머리말"><tr><td>서시 — 윤동주</td></tr></table><div class="poem"><p>죽는 날까지 하늘을 우러러<br>\n한 점 부끄럼이 없기를,</p></div>';
  assert.deepStrictEqual(htmlPoemLines(html), ['죽는 날까지 하늘을 우러러', '한 점 부끄럼이 없기를,']);
  assert.strictEqual(htmlPoemLines('<ul><li>목록</li></ul>'), null, '시 칸이 없으면 읽지 않는다');
});

test('카드 한 장에 들어가는가 — 플랫폼 카드 규칙(64→4px · 9줄 · 1460px)을 흉내 내고, 원문 옛한글 판은 안 쓰고, 자르지 않는다', async () => {
  const { simulate, cardVersion, cardLines, CARD } = await import(path.resolve(__dirname, '..', '..', 'scripts', 'poems-fit.mjs'));
  const m = (t, fs) => [...t].length * fs; // 한 글자 = 글씨 크기만큼
  assert.deepStrictEqual(simulate(['짧은 시', '두 줄'], m), { fs: 64, rows: 2, height: 2 * Math.round(64 * 1.34) + 70, limit: 1460, fits: true });
  const long = Array.from({ length: 30 }, () => '한 줄');
  const r = simulate(long, m);
  assert.strictEqual(r.fs, 44, '9줄을 넘으면 46 밑까지 4px 씩 줄인다(플랫폼과 같은 마지막 값)');
  assert.strictEqual(r.fits, false, '30줄은 1460px 를 넘는다 — 안 들어간다');
  assert.strictEqual(simulate(['가'.repeat(20)], m).rows, 2, '폭 896px 를 넘으면 다음 줄로 넘긴다');
  assert.strictEqual(CARD.bottom - CARD.top, 1460);
  assert.strictEqual(cardVersion({ versions: [{ label: '원문', lines: ['ᄭᅩᆺ'] }, { label: '현대어', lines: ['꽃'] }] }).label, '현대어');
  assert.strictEqual(cardVersion({ versions: [{ label: '원문', lines: ['ᄭᅩᆺ'] }] }), null, '옛한글 원문뿐이면 카드에 안 싣는다');
  assert.deepStrictEqual(cardLines(['<진달래꽃>', '', '나 보기가', ''], '진달래꽃'), ['나 보기가'], '첫 줄 제목은 작가 줄로 옮긴다');
});
