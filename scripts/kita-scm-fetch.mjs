// 한국무역협회 소부장 공급망센터 «글로벌 공급망 인사이트» 주간 수집 (D-431)
// 의존성 없음. Node 20+ 내장 fetch 만 쓴다.
//
// ★ 무엇을 싣는가 — 제목 · 발간일 · 호수 · 원문 주소 «뿐»이다. 본문·PDF 는 안 받고
//   안 싣는다(원문 복제 대신 요약 + 원문 링크 · CLAUDE.md §6-2-7). 열쇠가 필요 없는
//   공개 목록이라 비밀도 없다.
// ★★ 진단부터 짠다 (§4.3) — 목록 화면의 생김새를 아직 잰 적이 없다. 그래서 첫 실행이
//   곧 진단이다: 응답 본문 앞머리를 그대로 요약에 남기고, 무엇을 찾았는지 · 못 찾았는지를
//   갈래로 가른다. 추측으로 고른 자리에서 «아무것도 못 찾았다»를 «발간이 없다»로 적지 않는다.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'data/kita-scm';
const BASE = 'https://www.kita.net';
const LIST = `${BASE}/researchTrade/globalSupplyChain/globalSupplyChainList.do`;
const DETAIL = (no) => `${BASE}/researchTrade/globalSupplyChain/globalSupplyChainDetail.do?no=${no}`;
await mkdir(OUT, { recursive: true });

const log = [];
const say = (...ls) => { for (const s of ls) { console.log(s); log.push(s); } };

async function get(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (LinkPilot weekly digest)' } });
    const text = await r.text();
    return { reached: true, status: r.status, ok: r.ok, text };
  } catch (e) {
    return { reached: false, status: 0, ok: false, text: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}

const strip = (h) => String(h || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

// 목록에서 «호수(no) + 제목 + 날짜»를 줍는다. 두 모양을 다 본다 —
// ① <a href="...globalSupplyChainDetail.do?no=2952">제목</a>
// ② onclick="fn_detail('2952')" 같은 스크립트 이동. 둘 다 아니면 빈 목록(=판정 5).
function parseList(html) {
  const out = new Map();
  const re = /<a\b[^>]*?(?:globalSupplyChainDetail\.do\?[^"'>]*?no=(\d+)|\(\s*['"]?(\d{3,6})['"]?\s*\))[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const no = m[1] || m[2];
    const title = strip(m[3]);
    if (!no || !title || title.length < 4) continue;
    // 그 줄 뒤 300자 안의 첫 날짜를 발간일로 본다(없으면 null — 지어내지 않는다)
    const tail = html.slice(re.lastIndex, re.lastIndex + 600);
    const d = strip(tail).match(/(20\d{2})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/);
    const date = d ? `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}` : null;
    if (!out.has(no) || (out.get(no).title.length < title.length)) out.set(no, { no: Number(no), title, date, url: DETAIL(no) });
  }
  return [...out.values()].sort((a, b) => b.no - a.no);
}

// 세션 꼬리(;JSESSIONID_KITA=…)는 남기지 않는다 — 공개 저장소다.
const noSess = (u) => String(u).replace(/;JSESSIONID[^?'"\s]*/gi, '');

// 첨부 PDF 앞 세 쪽에서 «소제목» 줄을 뽑는다. 못 뽑으면 빈 목록 — 지어내지 않는다.
function headLines(text) {
  const out = [];
  const mark = /^(?:[■□◆◇●○▶▷◎※]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.\s]|\d{1,2}[.)]\s|[①-⑩]|[가-하][.)]\s)/;
  for (let ln of String(text).split('\n')) {
    ln = ln.replace(/\s+/g, ' ').trim();
    if (ln.length < 6 || ln.length > 80 || !mark.test(ln) || /\.{4,}|^\d+$/.test(ln)) continue;
    ln = ln.replace(/\s*\d{1,3}$/, '');
    if (!out.includes(ln)) out.push(ln);
    if (out.length >= 8) break;
  }
  return out;
}

async function readIssue(x) {
  const d = await get(x.url);
  if (!d.reached || !d.ok) return { topics: [], pdf: null, why: d.reached ? `상세 HTTP ${d.status}` : '상세 응답 없음' };
  const calls = [...d.text.matchAll(/doDownloadFile\(\s*'([^']+)'\s*,\s*'([^']*)'\s*\)[^>]*>([^<]*)/g)];
  const pick = calls.find((m) => /\.pdf\s*$/i.test(m[3])) || calls[0];
  if (!pick) return { topics: [], pdf: null, why: '첨부 내려받기 자리를 못 찾음' };
  const url = `${BASE}/researchTrade/globalSupplyChain/downloadGlobalSupplyChainFile.do?no=${pick[1]}` + (pick[2] ? `&fileSeq=${pick[2]}` : '');
  try {
    const pr = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LinkPilot weekly digest)', Referer: x.url } });
    const buf = Buffer.from(await pr.arrayBuffer());
    if (buf.slice(0, 5).toString() !== '%PDF-') return { topics: [], pdf: null, why: `PDF 아님 (HTTP ${pr.status})` };
    await writeFile('/tmp/kita-issue.pdf', buf);
    let t = '';
    try { t = execFileSync('pdftotext', ['-l', '3', '-layout', '/tmp/kita-issue.pdf', '-'], { encoding: 'utf8' }); }
    catch { return { topics: [], pdf: noSess(url), why: 'pdftotext 없음' }; }
    const topics = headLines(t);
    if (!topics.length) say('', `### 진단 — ${x.title} PDF 앞머리 (소제목을 못 뽑았다)`, '', '```', t.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 900), '```');
    return { topics, pdf: noSess(url), why: topics.length ? '' : '소제목 모양을 못 찾음' };
  } catch (e) { return { topics: [], pdf: null, why: `PDF 받기 실패 (${String(e.message).slice(0, 60)})` }; }
}

say(`# 글로벌 공급망 인사이트 수집 — ${new Date().toISOString()}`);
say(`- 목록: ${LIST}`);
const r = await get(LIST);
let items = [];
let code;
if (!r.reached) {
  code = 2;
  say(`- **못 닿음** — 응답이 없다 (${r.text.slice(0, 160)}). 열쇠 문제가 아니다 — 도는 자리(러너 해외 IP)를 의심한다`);
} else if (r.status >= 500) {
  code = 3;
  say(`- 그쪽 서버 HTTP ${r.status} — 기다렸다 다시. 우리 쪽에 고칠 것이 없다`);
} else {
  items = parseList(r.text);
  code = items.length ? 0 : 5;
  say(`- HTTP ${r.status} · 본문 ${r.text.length}자 · 찾은 호 ${items.length}개`);
  // ★ 진단: 본문 앞머리를 그대로 남긴다(태그를 벗긴 글 · 공개 화면이라 비밀이 없다)
  if (!items.length) {
    say('', '## 응답 본문 앞머리 (진단용 · 태그 벗김)', '', '```', strip(r.text).slice(0, 600), '```');
    const hint = (r.text.match(/globalSupplyChain[A-Za-z]*\.do[^"'\s>]*/g) || []).slice(0, 8);
    say('', `- 상세 주소 모양 후보: ${hint.length ? hint.join(' · ') : '(없음)'}`);
  }
}

let prev = null;
try { prev = JSON.parse(await readFile(`${OUT}/latest.json`, 'utf8')); } catch {}
if (items.length) {
  const top = items.slice(0, 12);
  const prevNo = prev && prev.items && prev.items[0] ? prev.items[0].no : null;
  const fresh = prevNo ? top.filter((x) => x.no > prevNo).length : top.length;
  const prevById = new Map(((prev && prev.items) || []).map((x) => [x.no, x]));
  say('', `## 최근 호 (새로 ${fresh}개)`, '');
  // ★ 상세 화면에는 본문이 없다 — «자세한 내용은 첨부파일을 확인»뿐이다(2026-10-10 실측).
  //   그래서 «자료분석»은 첨부 PDF 에서 한다. 상세 화면의 doDownloadFile(no, fileSeq) 인자로
  //   그 화면이 쓰는 내려받기 주소를 그대로 짠다(추측 금지 · §4.3 · 진단 실측).
  //   PDF 에서는 앞 세 쪽의 «머리 줄»(목차·소제목)만 뽑는다 — 본문은 옮겨 싣지 않는다 (§6-2-7).
  //   이미 뽑아 둔 호는 다시 받지 않는다(§4.5) — 한 번에 새로 여는 PDF 는 셋까지.
  let opened = 0;
  for (const x of top) {
    const old = prevById.get(x.no);
    if (old && Array.isArray(old.topics) && old.topics.length) { x.topics = old.topics; x.pdf = old.pdf || null; }
    else if (opened < 3) { opened++; Object.assign(x, await readIssue(x)); }
    say(`- ${x.date || '날짜 못 읽음'} · ${x.title} · ${x.url}${x.topics && x.topics.length ? '' : (x.why ? ' — 분석 못 함: ' + x.why : '')}`);
    for (const t of (x.topics || []).slice(0, 6)) say(`  - ${t}`);
    delete x.why;
  }
  await writeFile(`${OUT}/latest.json`, JSON.stringify({
    source: '한국무역협회 소재부품장비산업 공급망센터 · 글로벌 공급망 인사이트',
    list: LIST,
    note: '제목·발간일·원문 주소와 첨부 PDF 의 소제목만 싣는다. 본문은 원문에서 본다.',
    fetchedAt: new Date().toISOString(),
    items: top,
  }, null, 2) + '\n');
} else if (prev) {
  say('', '- 이번엔 못 받아 **앞 결과(latest.json)를 그대로 둔다** — 빈 것으로 덮지 않는다');
}

const verdict = {
  0: `판정 0 — 목록을 받았다 (최근 호 ${items.length}개)`,
  2: '판정 2 — **못 닿았다.** 열쇠 문제가 아니다 — 러너에서 kita.net 이 안 열린 것이다',
  3: '판정 3 — 그쪽 서버가 5xx 다 — 다음 주 실행이 다시 받는다',
  5: '판정 5 — 대답은 왔는데 **호를 못 찾았다** — 목록 생김새가 다르다. 아래 본문 앞머리로 규격을 고친다',
}[code];
log.unshift(`> ${verdict}`, '');
await writeFile(`${OUT}/_summary.md`, log.join('\n') + '\n');
if (code !== 0) console.error(verdict.replace(/\*\*/g, ''));
process.exit(code);
