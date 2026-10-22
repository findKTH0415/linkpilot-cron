// 한국해외인프라도시개발지원공사(KIND) 홈페이지 창구 진단 — 2026-10-22 사장님:
//   「KIND API 추출하여 투자·정보지원 섹션 좌측상단에 · KIND 가 지원하는 사업정보 노출 · 실시간 업데이트」
// 의존성 없음. Node 20+ 내장 fetch 만 쓴다. 열쇠·접속정보 없음(공개 홈페이지).
//
// ★ 진단부터 짠다 (CLAUDE.md §4 · §4.3) — KIND 는 공공데이터포털에 «사업정보» 오픈 API 가 안 보인다
//   (입찰공고·보도자료·해외지사 파일데이터뿐). 홈페이지가 화면을 그릴 때 부르는 창구(/api/v1/…)가 있으므로
//   ① 첫 화면과 스크립트 묶음에서 그 주소들을 찾아 적고 ② 사업·투자처럼 보이는 것을 GET 으로 불러
//   ③ 상태·형식·응답 앞머리(400자)를 그대로 남긴다. 추측한 인자를 넣지 않는다 — 주소에 적힌 그대로만 부른다.
// ★ 결과는 data/kind/_probe.md · _probe.json. 사람 이름·전화가 섞이면 안 된다 — 앞머리에서 전화·메일 모양을 가린다(공개 저장소 · D-10).

import { mkdir, writeFile } from 'node:fs/promises';

const OUT = 'data/kind';
const BASE = 'https://www.kindkorea.or.kr';
await mkdir(OUT, { recursive: true });

const log = [];
const say = (...ls) => { for (const s of ls) { console.log(s); log.push(s); } };
const mask = (s) => String(s || '')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[메일]')
  .replace(/\+?\d{2,3}[-. ]\d{3,4}[-. ]\d{4}/g, '[전화]');

async function get(url, accept) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (LinkPilot probe)', Accept: accept || '*/*' } });
    const text = await r.text();
    return { reached: true, status: r.status, type: r.headers.get('content-type') || '', text };
  } catch (e) {
    return { reached: false, status: 0, type: '', text: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}

const home = await get(BASE + '/', 'text/html');
say(`# KIND 홈페이지 창구 진단 — ${new Date().toISOString()}`, '');
say(`- 첫 화면: ${home.reached ? 'HTTP ' + home.status + ' · ' + home.type + ' · ' + home.text.length + '자' : '못 닿음 (' + home.text.slice(0, 80) + ')'}`);
if (!home.reached) {
  await writeFile(`${OUT}/_probe.md`, log.join('\n') + '\n');
  await writeFile(`${OUT}/_probe.json`, JSON.stringify({ at: new Date().toISOString(), home: { reached: false } }, null, 1));
  process.exit(3);
}

// 스크립트 묶음 — 같은 출처만
const scripts = [...new Set([...home.text.matchAll(/<script[^>]+src="([^"]+)"/gi)].map(m => m[1]))]
  .map(s => s.startsWith('http') ? s : BASE + (s.startsWith('/') ? '' : '/') + s)
  .filter(s => s.startsWith(BASE)).slice(0, 25);
say(`- 스크립트 묶음 ${scripts.length}개`);

const found = new Map();  // 주소 → 처음 본 자리
const grab = (txt, where) => {
  for (const m of txt.matchAll(/["'`](\/api\/v\d+\/[A-Za-z0-9_\-/{}.:?=&]+)["'`]/g)) if (!found.has(m[1])) found.set(m[1], where);
};
grab(home.text, '첫 화면');
for (const s of scripts) {
  const r = await get(s);
  say(`  · ${s.replace(BASE, '')} — ${r.reached ? 'HTTP ' + r.status + ' · ' + r.text.length + '자' : '못 닿음'}`);
  if (r.reached && r.status === 200) grab(r.text, s.replace(BASE, ''));
}
// 하위 화면 — 사업·투자 메뉴의 주소를 첫 화면 링크에서 찾는다
const pages = [...new Set([...home.text.matchAll(/href="(\/[^"#]*)"/gi)].map(m => m[1]))]
  .filter(h => /biz|business|project|invest|support|사업|투자/i.test(h)).slice(0, 15);
say(`- 사업·투자로 보이는 화면 링크 ${pages.length}개: ${pages.join(' · ') || '없음'}`);

const list = [...found.keys()].sort();
say('', `## 찾은 /api 주소 ${list.length}개`, '');
for (const a of list) say(`- \`${a}\` (${found.get(a)})`);

// 인자 자리({id} 등)가 없는 것만 GET — 사업·투자·게시판으로 보이는 것을 먼저
const want = list.filter(a => !/[{}:]/.test(a) && !/\/attachment\/[0-9a-f-]{36}$/.test(a))
  .sort((a, b) => (/(biz|business|project|invest|support|program|board|notice|news)/i.test(b) ? 1 : 0) - (/(biz|business|project|invest|support|program|board|notice|news)/i.test(a) ? 1 : 0))
  .slice(0, 30);
say('', `## 불러 본 것 ${want.length}개 (인자 없이 · 주소 그대로)`, '');
const calls = [];
for (const a of want) {
  const r = await get(BASE + a, 'application/json');
  let shape = '';
  try { const j = JSON.parse(r.text); shape = Array.isArray(j) ? `배열 ${j.length}` : ('키: ' + Object.keys(j).slice(0, 12).join(',')); } catch (_) { shape = '(JSON 아님)'; }
  const head = mask(r.text.slice(0, 400)).replace(/\s+/g, ' ');
  calls.push({ path: a, status: r.status, type: r.type, len: r.text.length, shape, head });
  say(`### \`${a}\``, `- HTTP ${r.status} · ${r.type} · ${r.text.length}자 · ${shape}`, '```', head, '```', '');
}

// ── 둘째 단계 — 홈페이지가 서버에서 그리는 판이면 /api 는 첨부(그림)뿐이다. 그래서 화면 자체를 잰다.
//   ① 첫 화면의 같은 출처 링크 전부 ② 사업 화면 글(태그를 걷은 앞 900자) ③ 게시판으로 보이는 화면의 목록 모양.
const strip = (h) => mask(String(h || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<header[\s\S]*?<\/header>/gi, ' ').replace(/<footer[\s\S]*?<\/footer>/gi, ' ').replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')).trim();
const allLinks = [...new Set([...home.text.matchAll(/href="(\/[^"#]*)"/gi)].map(m => m[1]))].sort();
say('', `## 첫 화면 링크 ${allLinks.length}개`, '', allLinks.map(h => '`' + h + '`').join(' · '));
const pageInfo = [];
for (const h of pages) {
  const r = await get(BASE + h, 'text/html');
  const title = (r.text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const heads = [...r.text.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m => strip(m[1])).filter(Boolean).slice(0, 12);
  const body = strip(r.text).slice(0, 900);
  pageInfo.push({ path: h, status: r.status, len: r.text.length, title, heads });
  say(`### 화면 \`${h}\``, `- HTTP ${r.status} · ${r.text.length}자 · 제목 «${title.trim()}»`, `- 머리글: ${heads.join(' | ') || '없음'}`, '```', body, '```', '');
}
const boards = allLinks.filter(h => /board|notice|news|bbs|press|bid|recruit|data|archive|list/i.test(h)).slice(0, 12);
say('', `## 게시판으로 보이는 화면 ${boards.length}개`, '');
const boardInfo = [];
for (const h of boards) {
  const r = await get(BASE + h, 'text/html');
  const rows = [...r.text.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => strip(m[0])).filter(t => t.length > 8).slice(0, 6);
  const items = [...r.text.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => strip(m[1])).filter(t => /20\d\d[.\-]\d\d/.test(t)).slice(0, 6);
  const hrefs = [...new Set([...r.text.matchAll(/href="([^"#]*(?:view|detail|seq|idx|id=)[^"#]*)"/gi)].map(m => m[1]))].slice(0, 6);
  boardInfo.push({ path: h, status: r.status, rows, items, hrefs });
  say(`### 게시판 \`${h}\``, `- HTTP ${r.status} · ${r.text.length}자 · 표 줄 ${rows.length} · 날짜 든 목록 ${items.length}`,
    ...rows.map(t => '  - 표: ' + t.slice(0, 160)), ...items.map(t => '  - 목록: ' + t.slice(0, 160)), ...hrefs.map(t => '  - 글 주소: `' + t + '`'), '');
}

log.splice(1, 0, list.length ? `판정 0 — /api 주소 ${list.length}개` : '판정 2 — /api 주소를 하나도 못 찾음');
await writeFile(`${OUT}/_probe.md`, log.join('\n') + '\n');
await writeFile(`${OUT}/_probe.json`, JSON.stringify({ at: new Date().toISOString(), home: { status: home.status, len: home.text.length }, scripts: scripts.map(s => s.replace(BASE, '')), pages, apis: list, calls, links: allLinks, pageInfo, boardInfo }, null, 1));
// 판정 — 0 주소를 찾음 · 2 하나도 못 찾음(화면이 서버에서 그려지는 판일 수 있다) · 3 첫 화면에 못 닿음(위에서 끝남)
const code = list.length ? 0 : 2;
console.log(code === 0 ? `판정 0 — /api 주소 ${list.length}개를 찾았다` : '판정 2 — 첫 화면·스크립트에서 /api 주소를 하나도 못 찾았다(위 «화면 링크»를 본다)');
process.exit(code);
