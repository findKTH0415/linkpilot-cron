'use strict';
/**
 * kind-fetch.test.js — KIND 지원공고·사업 목록 읽기 〈2026-10-22 사장님: 「KIND 가 지원하는 사업정보 노출 · 실시간 업데이트」〉
 *
 * 표본은 진단(data/kind/_probe.md)이 본 화면 모양 그대로다 — 공고는 «/pages/29?id=…&menuMode=READ» 링크 글자가 제목이고
 * 날짜는 그 뒤에 온다, 사업은 카드 글 뒤에 «상세보기» 링크가 온다, 맨 위 고정글은 같은 글이 두 번 나온다.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = pathToFileURL(path.resolve(__dirname, '..', '..', 'scripts', 'kind-fetch.mjs')).href;

const BOARD = `
<li class="fix"><a href="/pages/29?id=10590&amp;menuMode=READ&amp;q=">직원 사칭 피해 주의 안내 직원 사칭 피해 주의 안내</a><span>2025-05-29</span></li>
<li><a href="/pages/29?id=11052&amp;menuMode=READ&amp;q=">[KIND-2026-04] 제안서작성 지원 대상사업 모집공고</a><span class="date">2026.03.20</span></li>
<li><a href="/pages/29?id=11518&amp;menuMode=READ&amp;q=">[포르투갈 AICEP] 비즈니스 포럼 참가 안내 담당 02-123-4567</a><span>2026-10-01</span></li>
<li><a href="/pages/29?id=10590&amp;menuMode=READ&amp;q=">직원 사칭 피해 주의 안내</a><span>2025-05-29</span></li>
<p>총 218 건</p>`;

const PROJ = `
<header><nav>사업 소개 프로젝트 소개</nav></header>
<div class="card"><p>카자흐스탄</p><h3>알마티 순환도로</h3><p>$15.0M · 운영 중</p><a href="/project/DIRECT_INVESTMENT/detail/210">상세보기</a></div>
<div class="card"><p>호주</p><h3>시드니 초고층 아파트 개발</h3><p>건설 중</p><a href="/project/DIRECT_INVESTMENT/detail/422">상세보기</a></div>`;

test('공고 — 제목·날짜·주소를 읽고, 고정글은 한 번만 · 겹친 제목은 하나로 · 전화는 가린다', async () => {
  const { parseBoard } = await import(SRC);
  const got = parseBoard(BOARD, 29);
  assert.deepStrictEqual(got.map((g) => g.id), [11518, 11052, 10590]);
  assert.strictEqual(got[1].date, '2026-03-20');
  assert.strictEqual(got[2].title, '직원 사칭 피해 주의 안내');
  assert.ok(!/02-123-4567/.test(got[0].title) && /\[전화\]/.test(got[0].title), '전화번호를 안 가렸다');
  assert.match(got[1].url, /^https:\/\/www\.kindkorea\.or\.kr\/pages\/29\?id=11052&menuMode=READ$/);
});

test('사업 — 카드 글과 상세 주소 · 최근(번호 큰) 것이 먼저 · 머리 메뉴가 안 섞인다', async () => {
  const { parseProjects } = await import(SRC);
  const got = parseProjects(PROJ, 'DIRECT_INVESTMENT');
  assert.deepStrictEqual(got.map((g) => g.id), [422, 210]);
  assert.match(got[1].text, /카자흐스탄 알마티 순환도로 \$15\.0M · 운영 중/);
  assert.match(got[0].text, /^호주 시드니 초고층 아파트 개발 건설 중$/);
  assert.ok(!/프로젝트 소개/.test(got[1].text), '머리 메뉴 글자가 카드 글에 섞였다');
});

test('사업 카드 — «지역 / 나라 분야 : …» 를 칸으로 가른다', async () => {
  const { parseProjects } = await import(SRC);
  const html = '<img alt="지도" src="x.png"> 아시아/태평양 / 호주 분야 : 도시개발 <a href="/project/POLICY_FUND/detail/420">상세보기</a>';
  const [p] = parseProjects(html, 'POLICY_FUND');
  assert.deepStrictEqual([p.region, p.country, p.sector], ['아시아/태평양', '호주', '도시개발']);
});

test('다른 갈래의 상세 링크는 안 줍는다', async () => {
  const { parseProjects } = await import(SRC);
  assert.strictEqual(parseProjects(PROJ, 'POLICY_FUND').length, 0);
});

test('사업 상세 — 실측 머리 글자에서 사업명·단계·개요 · dt/dd 칸 · 모양이 다르면 이름은 null', async () => {
  const { parseDetail } = await import(SRC);
  const html = '<h3>직접투자사업</h3><div><span>호주</span><span>Australia</span><b>호주 시드니 채스우드 공동주택</b><i>직접투자사업</i><i>개발단계</i><i>아시아/태평양</i><i>도시개발</i></div>'
    + '<h4>OVERVIEW</h4><p>임대주택 개발사업</p><h4>KEY FACTS</h4><dl><dt>사업부지</dt><dd>New South Wales주 Chatswood</dd><dt>사업내용(규모)</dt><dd>총 260세대</dd></dl>';
  const d = parseDetail(html);
  assert.strictEqual(d.name, '호주 시드니 채스우드 공동주택');
  assert.strictEqual(d.stage, '개발단계');
  assert.strictEqual(d.overview, '임대주택 개발사업');
  assert.deepStrictEqual(d.fields, { '사업부지': 'New South Wales주 Chatswood', '사업내용(규모)': '총 260세대' });
  const uk = parseDetail('<h3>x</h3>영국 United Kingdom 영국 런던 지하철 정책펀드사업 운영 중 유럽 교통 <dl><dt>사업부지</dt><dd>런던</dd></dl>');
  assert.strictEqual(uk.name, '영국 런던 지하철');
  const kcn = parseDetail('<h3>x</h3>인도네시아 Indonesia 신수도 교통체계 계획수립 KCN 및 EIPP 개발단계 아시아/태평양 교통 <dl><dt>사업부지</dt><dd>누산타라</dd></dl>');
  assert.strictEqual(kcn.name, '신수도 교통체계 계획수립');
  const odd = parseDetail('<h3>x</h3>무엇인가 다른 모양<dl><dt>사업부지</dt><dd>X</dd></dl>');
  assert.strictEqual(odd.name, null);
  assert.strictEqual(odd.head, '무엇인가 다른 모양');
});
