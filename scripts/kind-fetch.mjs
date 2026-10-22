// 한국해외인프라도시개발지원공사(KIND) 지원사업·공고 수집 — 2026-10-22 사장님:
//   「KIND API 추출하여 투자·정보지원 섹션 좌측상단에 · KIND 가 지원하는 사업정보 노출 · 실시간 업데이트」
// 의존성 없음. Node 20+ 내장 fetch 만 쓴다. 열쇠·접속정보 없음(공개 홈페이지).
//
// ★ KIND 는 사업정보 오픈 API 가 없다 — 진단(data/kind/_probe.md · 2026-10-22 세 번)에서 /api 는 그림 첨부뿐이었고,
//   화면은 서버가 그린다. 그래서 공개 목록 화면 첫 쪽만 읽는다:
//   · 지원공고 /pages/29 · 보도자료 /pages/32 · 활동소식 /pages/31 — 제목 · 날짜 · 원문 주소
//   · 사업 넷 /project?businessType=… — 카드 글(나라·사업명·금액·상태)과 상세 주소
// ★ 본문은 옮겨 싣지 않는다(원문 링크 · CLAUDE.md §6-2-7). 사람 이름·전화·메일 모양은 가린다(공개 저장소 · D-10).
// ★ 못 받은 갈래는 비워 두고 사유를 적는다 — «없다»로 적지 않는다(§4.6).

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const OUT = 'data/kind';
const BASE = 'https://www.kindkorea.or.kr';
const log = [];
const say = (...ls) => { for (const s of ls) { console.log(s); log.push(s); } };

async function get(url) {
  const a = await get1(url);
  if (a.reached && a.status < 500) return a;
  await new Promise((r) => setTimeout(r, 3000));
  return get1(url);
}
async function get1(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (LinkPilot digest)', Accept: 'text/html' } });
    const text = await r.text();
    return { reached: true, status: r.status, ok: r.ok, text };
  } catch (e) {
    return { reached: false, status: 0, ok: false, text: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}

const mask = (s) => String(s || '')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[메일]')
  .replace(/\+?\d{2,3}[-. ]\d{3,4}[-. ]\d{4}/g, '[전화]');
const strip = (h) => mask(String(h || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')).trim();
const ymd = (s) => { const d = String(s || '').match(/(20\d{2})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/); return d ? `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}` : null; };

// 게시판 첫 쪽 — <a href="/pages/NN?id=…&menuMode=READ…">제목</a> 뒤 600자 안의 첫 날짜를 날짜로 본다.
// 맨 위 고정글(직원 사칭 안내 등 같은 글이 두 번 나온다)은 한 번만 싣는다.
export function parseBoard(html, page) {
  const out = new Map();
  const re = new RegExp(`<a\\b[^>]*href="([^"]*\\/pages\\/${page}\\?id=(\\d+)[^"]*)"[^>]*>([\\s\\S]*?)<\\/a>`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const id = Number(m[2]);
    const title = strip(m[3]).replace(/^(.{6,}?)\s+\1$/, '$1');
    if (!title || title.length < 4) continue;
    const date = ymd(strip(html.slice(re.lastIndex, re.lastIndex + 600)));
    const prev = out.get(id);
    if (!prev || (!prev.date && date)) out.set(id, { id, title, date, url: `${BASE}/pages/${page}?id=${id}&menuMode=READ` });
  }
  return [...out.values()].sort((a, b) => b.id - a.id);
}

// 사업 목록 — 카드마다 «상세보기» 링크가 있고 제목은 링크 앞 글자에 있다.
// 앞 상세 링크(없으면 600자 앞)부터 이 링크까지의 글을 카드 글로 본다. 상세 번호가 큰 것이 최근이다.
export function parseProjects(html, type) {
  const re = new RegExp(`href="(\\/project\\/${type}\\/detail\\/(\\d+))"`, 'g');
  const out = new Map();
  let m; let prevEnd = -1;
  while ((m = re.exec(html))) {
    const id = Number(m[2]);
    const from = prevEnd >= 0 ? Math.max(prevEnd, m.index - 1500) : Math.max(0, m.index - 600);
    const tagAt = html.lastIndexOf('<', m.index);
    let chunk = html.slice(from, tagAt > from ? tagAt : m.index);
    // 첫 카드는 앞 글자에 거르기 칸·메뉴가 섞일 수 있다 — 그런 덩어리가 끝나는 자리 뒤만 본다
    const cut = Math.max(...['</nav>', '</header>', '</form>', '</select>', '</ul>'].map((t) => chunk.lastIndexOf(t) + (chunk.lastIndexOf(t) >= 0 ? t.length : 0)));
    if (prevEnd < 0 && cut > 0) chunk = chunk.slice(cut);
    const gt = chunk.indexOf('>'); const lt = chunk.indexOf('<');
    if (gt >= 0 && (lt < 0 || gt < lt)) chunk = chunk.slice(gt + 1);
    const text = strip(chunk).replace(/^.*?(?:상세보기|바로가기)\s*/, '').replace(/\s*상세보기\s*$/, '').slice(-240).trim();
    prevEnd = re.lastIndex;
    if (!out.has(id)) out.set(id, { id, type, text: text || null, url: BASE + m[1] });
  }
  return [...out.values()].sort((a, b) => b.id - a.id);
}

const BOARDS = [
  { key: 'notices', page: 29, name: '지원공고' },
  { key: 'news', page: 32, name: '보도자료' },
  { key: 'activity', page: 31, name: '활동소식' },
];
const TYPES = [
  { type: 'DIRECT_INVESTMENT', name: '직접투자' },
  { type: 'POLICY_FUND', name: '정책펀드' },
  { type: 'FS_SUPPORT', name: '타당성조사 지원' },
  { type: 'KCN_EIPP', name: 'K-City Network · EIPP' },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const at = new Date().toISOString();
  const res = { at, source: BASE, boards: {}, projects: {}, failed: [] };
  let got = 0; let tried = 0; let reachedAny = false;

  for (const b of BOARDS) {
    tried++;
    const r = await get(`${BASE}/pages/${b.page}`);
    reachedAny = reachedAny || r.reached;
    const items = r.ok ? parseBoard(r.text, b.page).slice(0, 12) : [];
    const total = r.ok ? ((strip(r.text).match(/총\s*([\d,]+)\s*건/) || [])[1] || null) : null;
    if (items.length) { got++; res.boards[b.key] = { name: b.name, total: total ? Number(total.replace(/,/g, '')) : null, items, url: `${BASE}/pages/${b.page}` }; }
    else res.failed.push({ part: b.name, why: r.reached ? `HTTP ${r.status} · 글 0` : `못 닿음 (${r.text.slice(0, 80)})` });
    say(`- ${b.name}: ${r.reached ? 'HTTP ' + r.status : '못 닿음'} · ${items.length}건${total ? ' (전체 ' + total + '건)' : ''}`);
  }
  for (const t of TYPES) {
    tried++;
    const r = await get(`${BASE}/project?businessType=${t.type}`);
    reachedAny = reachedAny || r.reached;
    const items = r.ok ? parseProjects(r.text, t.type).slice(0, 10) : [];
    if (items.length) { got++; res.projects[t.type] = { name: t.name, items, url: `${BASE}/project?businessType=${t.type}` }; }
    else res.failed.push({ part: t.name, why: r.reached ? `HTTP ${r.status} · 사업 0` : `못 닿음 (${r.text.slice(0, 80)})` });
    say(`- 사업 ${t.name}: ${r.reached ? 'HTTP ' + r.status : '못 닿음'} · ${items.length}건`);
  }

  // 모양 견본 — 목록 글자가 빠지면(제목·날짜 null) 무엇을 고칠지 보려고 첫 항목 둘레를 남긴다(공개 글자만 · 가림 거침)
  if (process.env.KIND_DIAG === '1') {
    log.push('', '## 모양 견본');
    const rb = await get(`${BASE}/pages/32`);
    const ib = rb.text.search(/\/pages\/32\?id=\d+/);
    if (ib > 0) log.push('### 보도자료 첫 글 둘레', '```', strip(rb.text.slice(Math.max(0, ib - 400), ib + 900)).slice(0, 700), '```');
    const rp = await get(`${BASE}/project?businessType=DIRECT_INVESTMENT`);
    const ip = rp.text.search(/\/project\/DIRECT_INVESTMENT\/detail\/\d+/);
    if (ip > 0) log.push('### 직접투자 첫 카드 둘레 (링크 뒤)', '```', strip(rp.text.slice(ip, ip + 1500)).slice(0, 700), '```');
    const first = res.projects.DIRECT_INVESTMENT && res.projects.DIRECT_INVESTMENT.items[0];
    if (first) {
      const rd = await get(first.url);
      const heads = [...rd.text.matchAll(/<(h[1-6]|strong|dt|th)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[1] + ':' + strip(m[2])).filter((t) => t.length > 3).slice(0, 40);
      log.push('### 직접투자 첫 상세 머리글', ...heads.map((h) => '- ' + h.slice(0, 120)));
    }
  }

  // 판정 — 0 전부 · 1 일부 · 2 못 받음(닿았는데 글 0) · 3 못 닿음
  const code = got === tried ? 0 : got > 0 ? 1 : reachedAny ? 2 : 3;
  const verdict = ['판정 0 — 전부 받았다', '판정 1 — 일부만 받았다', '판정 2 — 닿았는데 목록을 못 읽었다(화면 모양이 바뀌었을 수 있다)', '판정 3 — KIND 홈페이지에 못 닿았다'][code];
  res.verdict = code;

  // 못 받은 갈래가 있으면 지난 결과를 덮지 않고 그 갈래만 지난 값으로 남긴다 — «빈 것으로 덮지 않는다»(§4.6)
  if (code !== 0) {
    try {
      const prev = JSON.parse(await readFile(`${OUT}/latest.json`, 'utf8'));
      for (const b of BOARDS) if (!res.boards[b.key] && prev.boards && prev.boards[b.key]) res.boards[b.key] = { ...prev.boards[b.key], stale: prev.at };
      for (const t of TYPES) if (!res.projects[t.type] && prev.projects && prev.projects[t.type]) res.projects[t.type] = { ...prev.projects[t.type], stale: prev.at };
    } catch (_) { /* 지난 결과 없음 */ }
  }
  if (code !== 3 || Object.keys(res.boards).length || Object.keys(res.projects).length) {
    await writeFile(`${OUT}/latest.json`, JSON.stringify(res, null, 1) + '\n');
  }
  log.unshift(`${verdict} · ${got}/${tried} 갈래 · ${at}`, '');
  if (res.failed.length) log.push('', '## 못 받은 갈래', ...res.failed.map((f) => `- ${f.part} — ${f.why}`));
  await writeFile(`${OUT}/_summary.md`, log.join('\n') + '\n');
  console.log(verdict);
  if (code) console.error(verdict);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const code = await main().catch((e) => { const msg = mask(String(e && e.stack || e)); console.log('판정 2 — 예상 밖 오류: ' + msg); console.error('판정 2 — 예상 밖 오류: ' + msg); return 2; });
process.exit(code);
}
