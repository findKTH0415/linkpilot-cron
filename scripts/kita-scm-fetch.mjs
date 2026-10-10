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
  say('', '## 응답 본문 앞머리 (진단용 · 태그 벗김)', '', '```', strip(r.text).slice(0, 600), '```');
  if (!items.length) {
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
  await writeFile(`${OUT}/latest.json`, JSON.stringify({
    source: '한국무역협회 소재부품장비산업 공급망센터 · 글로벌 공급망 인사이트',
    list: LIST,
    note: '제목·발간일·원문 주소만 싣는다. 본문은 원문에서 본다.',
    fetchedAt: new Date().toISOString(),
    items: top,
  }, null, 2) + '\n');
  say('', `## 최근 호 (새로 ${fresh}개)`, '');
  for (const x of top) say(`- ${x.date || '날짜 못 읽음'} · ${x.title} · ${x.url}`);
  // ★ 진단 둘째 — 가장 최근 호의 상세 화면 생김새를 잰다(«자료분석»을 붙일 자리를 찾는다 · §4.3).
  //   본문을 옮겨 싣지 않는다 — 진단용 앞머리 800자와 «첨부 이름»만 요약에 남긴다.
  const d = await get(top[0].url);
  if (d.reached && d.ok) {
    const txt = strip(d.text);
    // 화면 머리(<title>·메뉴)에도 제목이 있어 첫 자리는 메뉴다 — 첨부 이름이 처음 나오는 자리
    // (게시 본문 바로 곁)를 기준으로 그 앞 600자 · 뒤 400자를 본다. 첨부가 없으면 제목의 «마지막» 자리.
    const key = String(top[0].title).replace(/^\[[^\]]*\]\s*/, '').slice(0, 12);
    const fi = txt.search(/\S+\.(?:pdf|hwp|hwpx)\b/i);
    const at = fi > 0 ? Math.max(0, fi - 600) : txt.lastIndexOf(key);
    const files = [...new Set((d.text.match(/[^"'<>\s\/]+\.(?:pdf|hwp|hwpx|pptx?|docx?)/gi) || []))].slice(0, 6);
    say('', `## 상세 화면 진단 — ${top[0].title}`, '', `- HTTP ${d.status} · 본문 ${d.text.length}자 · 첨부 후보: ${files.length ? files.join(' · ') : '(없음)'}`,
      '', '```', txt.slice(Math.max(0, at), Math.max(0, at) + 1000), '```');
    // ★ 진단 셋째 — 상세 화면에는 본문이 없고 «첨부파일을 확인해 주십시오»뿐이다(2026-10-10 실측).
    //   그러니 «자료분석»은 PDF 에서 해야 한다. 내려받기 주소 후보를 적고, 첫 후보를 받아
    //   pdftotext 로 앞 세 쪽의 «머리 줄»만 뽑는다. 본문은 옮겨 싣지 않는다 (§6-2-7).
    const hrefs = [...new Set([...d.text.matchAll(/href\s*=\s*["']([^"']*(?:[Dd]own|[Ff]ile)[^"']*)["']/g)].map((m) => m[1].replace(/&amp;/g, '&')))]
      .filter((h) => !/^javascript:void|#$/.test(h)).slice(0, 6);
    const onclk = [...new Set([...d.text.matchAll(/onclick\s*=\s*["']([^"']*(?:[Dd]own|[Ff]ile)[^"']*)["']/g)].map((m) => m[1]))].slice(0, 4);
    say('', `- 내려받기 주소 후보: ${hrefs.length ? hrefs.join(' · ') : '(없음)'}`, `- 누름 스크립트 후보: ${onclk.length ? onclk.join(' · ') : '(없음)'}`);
    const pdfHref = hrefs.find((h) => /\.pdf|down/i.test(h));
    if (pdfHref) {
      const pdfUrl = pdfHref.startsWith('http') ? pdfHref : BASE + (pdfHref.startsWith('/') ? '' : '/') + pdfHref;
      try {
        const pr = await fetch(pdfUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (LinkPilot weekly digest)', Referer: top[0].url } });
        const buf = Buffer.from(await pr.arrayBuffer());
        const isPdf = buf.slice(0, 5).toString() === '%PDF-';
        say(`- PDF 받기: HTTP ${pr.status} · ${buf.length}바이트 · ${isPdf ? 'PDF 맞음' : 'PDF 아님(' + buf.slice(0, 40).toString().replace(/\s+/g, ' ') + ')'}`);
        if (isPdf) {
          await writeFile('/tmp/kita-latest.pdf', buf);
          let txt2 = '';
          try { txt2 = execFileSync('pdftotext', ['-l', '3', '-layout', '/tmp/kita-latest.pdf', '-'], { encoding: 'utf8' }); }
          catch (e) { say(`- pdftotext 못 돌림 — ${String(e.message).slice(0, 120)}`); }
          if (txt2) say('', '### PDF 앞 세 쪽 앞머리 (진단용)', '', '```', txt2.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 1200), '```');
        }
      } catch (e) { say(`- PDF 받기 실패 — ${String(e.message).slice(0, 120)}`); }
    }
  } else {
    say('', `- 상세 화면 못 받음 (${d.reached ? 'HTTP ' + d.status : '응답 없음'}) — 목록은 받았으니 판정은 그대로다`);
  }
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
