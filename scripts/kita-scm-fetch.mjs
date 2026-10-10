// 한국무역협회 소부장 공급망센터 «글로벌 공급망 인사이트» 주간 수집 (D-431)
// 의존성 없음. Node 20+ 내장 fetch 만 쓴다.
//
// ★ 무엇을 싣는가 — 제목 · 발간일 · 호수 · 원문 주소 + 첨부 PDF «첫 쪽 목차의 머리 줄»뿐이다.
//   본문은 옮겨 싣지 않는다(원문 복제 대신 요약 + 원문 링크 · CLAUDE.md §6-2-7). PDF 는
//   목차를 읽으려고 받기만 하고 저장소에 안 남긴다. 열쇠가 필요 없는 공개 목록이라 비밀도 없다.
// ★★ 진단부터 짰다 (§4.3) — 2026-10-10 다섯 번 걸어 규격을 쟀다. 못 찾으면 여전히 본문
//   앞머리를 요약에 남기고 갈래로 가른다. «아무것도 못 찾았다»를 «발간이 없다»로 적지 않는다.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = 'data/kita-scm';
const BASE = 'https://www.kita.net';
const LIST = `${BASE}/researchTrade/globalSupplyChain/globalSupplyChainList.do`;
// 뽑는 규칙의 판 — 규칙을 바꾸면 올린다. 옛 판으로 뽑아 둔 소제목은 다시 뽑는다.
const TV = 2;
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

// 첨부 PDF «첫 쪽»(목차 쪽)에서 그 호의 이슈 제목을 뽑는다 (2026-10-10 실측 규격).
// 첫 쪽은 두 단(段) 목차라 -layout 글에서 넓은 빈칸(3칸 이상)이 단을 가른다.
//   · «주요 공급망 이슈» ~ «공급망 이슈 포커스» 사이: [태그(예 미-중·통상)] [제목] 짝
//   · Ⅱ·Ⅲ·Ⅳ 머리와 «산업·품목 심층분석»·«원자재 뉴스 PLUS» 바로 다음 줄: 그 절의 제목
// 고정 목차 머리(Ⅰ. 공급망 주간 이슈 Check! 등)는 싣지 않는다 — 매 호 같아 정보가 아니다.
// 못 뽑으면 빈 목록이다 — 지어내지 않는다.
function headLines(text) {
  const page1 = String(text).split('\f')[0];
  const rows = page1.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const isTag = (x) => /^[가-힣A-Za-z]+(?:[-·][가-힣A-Za-z]+)+$/.test(x) && x.length <= 14;
  const out = [];
  const push = (t) => { t = t.replace(/\s+/g, ' ').trim(); if (t.length >= 6 && t.length <= 90 && !out.includes(t)) out.push(t); };
  let mode = '';
  const after = { 'Ⅱ': '월간 공급망', 'Ⅲ': '더 알아보기', 'Ⅳ': '소식통' };
  let want = '';
  // 두 단 목차는 한 단이 줄을 넘기면 [태그] 와 [제목] 이 다른 줄로 갈린다 — 남은 태그를 다음 줄로 넘긴다.
  let pend = '';
  for (const raw of rows) {
    const line = raw.trim();
    if (want) { push(`${want} — ${line.replace(/^[가-힣A-Za-z]+·[가-힣A-Za-z]+\s+/, '')}`); want = ''; continue; }
    if (/^주요 공급망 이슈$/.test(line)) { mode = 'issues'; continue; }
    if (/^공급망 이슈 포커스/.test(line)) { mode = ''; continue; }
    const m = line.match(/^([ⅡⅢⅣ])\./);
    if (m) { mode = ''; want = after[m[1]]; continue; }
    if (/^산업·품목 심층분석$/.test(line)) { mode = ''; want = '심층분석'; continue; }
    if (/^원자재 뉴스 PLUS$/.test(line)) { mode = ''; want = '원자재'; continue; }
    if (mode === 'issues') {
      const seg = line.split(/\s{3,}/).map((x) => x.trim()).filter(Boolean);
      let i = 0;
      if (pend && seg.length && !isTag(seg[0])) { push(`[${pend}] ${seg[0]}`); i = 1; }
      pend = '';
      for (; i < seg.length; i++) {
        if (!isTag(seg[i])) continue;
        if (i + 1 < seg.length && !isTag(seg[i + 1])) { push(`[${seg[i]}] ${seg[i + 1]}`); i++; }
        else if (i === seg.length - 1) pend = seg[i];
      }
    } else pend = '';
    if (out.length >= 12) break;
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
    // 상한을 둔다 — 머리만 오고 몸통이 안 오면 잡이 시간 한도까지 선다 (§12-81 과 같은 결).
    const pr = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'Mozilla/5.0 (LinkPilot weekly digest)', Referer: x.url } });
    const buf = Buffer.from(await pr.arrayBuffer());
    if (buf.length > 40 * 1024 * 1024) return { topics: [], pdf: noSess(url), why: `PDF 가 너무 크다 (${Math.round(buf.length / 1048576)}MB)` };
    if (buf.slice(0, 5).toString() !== '%PDF-') return { topics: [], pdf: null, why: `PDF 아님 (HTTP ${pr.status})` };
    await writeFile('/tmp/kita-issue.pdf', buf);
    let t = '';
    try { t = execFileSync('pdftotext', ['-l', '1', '-layout', '/tmp/kita-issue.pdf', '-'], { encoding: 'utf8' }); }
    catch { return { topics: [], pdf: noSess(url), why: 'pdftotext 없음' }; }
    const topics = headLines(t);
    if (process.env.KITA_DIAG === '1' && !globalThis.__kitaDiagDone) { globalThis.__kitaDiagDone = 1;
      say('', `### 진단 — ${x.title} PDF 앞 두 쪽 (소제목 규격을 잴 때만 · KITA_DIAG=1)`, '', '```', t.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 2500), '```'); }
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
  //   ★ 못 뽑은 호(빈 목록)는 세 번까지만 다시 받는다(tries) — 안 그러면 그 호를 매주 내려받는다.
  //   ★ 이번에 못 연 호는 앞 결과를 그대로 싣는다 — 진단(KITA_DIAG)으로 돌려도 지우지 않는다.
  let opened = 0;
  const diag = process.env.KITA_DIAG === '1';
  const keep = (x, old) => { x.topics = old.topics; x.pdf = old.pdf || null; x.tv = old.tv; if (old.tries) x.tries = old.tries; };
  for (const x of top) {
    const old = prevById.get(x.no);
    const had = old && Array.isArray(old.topics);
    const done = had && old.tv === TV && (old.topics.length || (old.tries || 0) >= 3);
    if (done && !(diag && opened < 3)) keep(x, old);
    else if (opened < 3) {
      opened++;
      Object.assign(x, await readIssue(x), { tv: TV });
      x.tries = x.topics.length ? undefined : ((had && old.tv === TV ? old.tries || 0 : 0) + 1);
      if (!x.topics.length && had && old.topics.length) keep(x, old);
    } else if (had) keep(x, old);
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
