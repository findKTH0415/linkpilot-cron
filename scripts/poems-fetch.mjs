// 저작권이 끝난 한국 시 — 위키문헌 원문 진단 수집 (GitHub Actions 레인)
// 〈2026-10-21 사장님: 「시집 · 인스타 인기 글을 명언처럼 API 로 수집·DB화」 → 권장 1단계 «저작권이 끝난 시» · CLAUDE.md §6-2-7〉
//
// ★ 진단부터 짠다 (§4) — 제목이 위키문헌에 어떤 이름으로 있는지 모르므로 **검색 API 로 찾고**, 찾은 문서의 원문(wikitext)을 그대로 저장한다.
// ★ 여기서 받는 것은 **근거 하나**다. §6-2-7 의 VERIFIED 는 «독립 근거 둘»이라 이 결과만으로 앱 시집 표에 올리지 않는다 —
//   다음 단계에서 두 번째 근거(원전 시집·공유마당)와 글자를 대조한다. 요약에 그 사실을 적는다.
// ★ 대상은 **작가 사후 70년이 지난** 작품뿐이다(저작권법 제39조). 목록은 제목·작가·몰년만 적는다 — 본문을 손으로 적지 않는다.
// 종료 코드 0 전부 받음 / 1 일부 / 2 한 편도 못 받음(못 닿음 포함)
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = 'data/poems';
const API = 'https://ko.wikisource.org/w/api.php';
export const WORKS = [
  { author: '김소월', died: 1934, titles: ['진달래꽃', '엄마야 누나야', '산유화', '초혼', '먼 후일'] },
  { author: '윤동주', died: 1945, titles: ['서시', '별 헤는 밤', '자화상', '쉽게 씌어진 시'] },
  { author: '한용운', died: 1944, titles: ['님의 침묵', '알 수 없어요'] },
  { author: '이육사', died: 1944, titles: ['광야', '청포도'] },
  { author: '이상화', died: 1943, titles: ['빼앗긴 들에도 봄은 오는가'] },
  { author: '정지용', died: 1950, titles: ['향수', '유리창'] },
];
/** 사후 70년이 지났는가 — 저작권은 사망한 해의 다음 해 1월 1일부터 70년 (저작권법 제39조·제44조) */
export const isPublicDomain = (died, year) => year > died + 70;

/** wikitext → 시 본문 줄. 틀({{…}})·주석(<ref>)·분류·꾸밈표를 걷고 줄을 남긴다. 걷은 뒤 비면 null */
export function poemLines(wt) {
  let t = String(wt || '');
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '');
  for (let i = 0; i < 5; i++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  t = t.replace(/\[\[(?:분류|Category|파일|File):[^\]]*\]\]/gi, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<\/?(poem|center|div|span|br\s*\/?|small|big|p)[^>]*>/gi, '\n')
    .replace(/'''?/g, '').replace(/^[=]+.*[=]+\s*$/gm, '').replace(/^__\w+__$/gm, '');
  const lines = t.split('\n').map(s => s.replace(/\s+$/g, '')).filter((s, i, a) => s.trim() || (i > 0 && a[i - 1].trim()));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.length ? lines : null;
}

const norm = s => String(s || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, '');
/**
 * 검색 결과 → 그 시의 문서들. 위키문헌은 시를 «시집 (판)/제목» 아래 쪽에 둔다 — 마지막 토막이 제목과 같은 것을 고른다.
 * 띄어쓰기만 다른 것(«별헤는 밤»)은 같은 제목으로 본다. 판이 여럿이면 **전부** 돌려준다(하나를 지어 고르지 않는다).
 * 아래 쪽이 없을 때만 제목이 꼭 같은 윗문서를 쓴다 — 그것이 동음이의 안내면 원문 단계에서 버린다.
 */
export function pickPages(hits, title) {
  const t = norm(title);
  const sub = hits.filter(h => h.includes('/') && norm(h.split('/').pop()) === t);
  if (sub.length) return sub;
  return hits.filter(h => !h.includes('/') && norm(h) === t).slice(0, 1);
}
/** 동음이의·목차 안내 문서인가 — 틀이 그렇다고 하거나, 본문 줄이 전부 목록(«*»)이면 시가 아니다 */
export function isListPage(wt, lines) {
  if (/\{\{\s*(동음이의|disambig|명확화)/i.test(String(wt || ''))) return true;
  const body = (lines || []).filter(s => s.trim());
  return !body.length || body.every(s => /^\s*[*#:]/.test(s));
}
/**
 * 한 문서에 든 시 묶음을 «판»마다 가른다 — 위키문헌은 «'''현대어'''»·«'''원문'''» 머리글 아래 <poem> 을 나란히 둔다.
 * 머리글은 바로 앞(앞 묶음이 끝난 뒤) 굵은 글씨에서만 읽는다 — 없으면 null(지어 붙이지 않는다). <poem> 이 없으면 문서 통째로 한 판.
 */
export function poemVersions(wt) {
  const src = String(wt || ''); const out = []; let prev = 0;
  for (const m of src.matchAll(/<poem[^>]*>([\s\S]*?)<\/poem>/gi)) {
    const before = src.slice(prev, m.index);
    const heads = [...before.matchAll(/'''\s*([^'\n]{1,12}?)\s*'''/g)].map(x => x[1].trim());
    const lines = poemLines(m[1]);
    if (lines) out.push({ label: heads.length ? heads[heads.length - 1] : null, lines });
    prev = m.index + m[0].length;
  }
  if (out.length) return out;
  const lines = poemLines(src);
  return lines ? [{ label: null, lines }] : [];
}
/**
 * 화면에 그려진 판(HTML)에서 시 칸만 읽는다 — 본문을 다른 문서에서 끌어오는 쪽(틀 끼워 넣기 · 스캔 쪽 묶음)은 원문 글에 본문이 없다.
 * MediaWiki 의 시 칸은 `<div class="poem">` 이다. 그 밖(머리말 상자·목록)은 읽지 않는다.
 */
export function htmlPoemLines(html) {
  const blocks = [...String(html || '').matchAll(/<div[^>]*class="[^"]*\bpoem\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)].map(m => m[1]);
  if (!blocks.length) return null;
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
  const t = blocks.join('\n\n').replace(/<br\s*\/?>\n?/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, k) => ent[k]).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
  return poemLines(t);
}
/** 판의 해 — «하늘과 바람과 별과 시 (1948년)/서시» → 1948 · 없으면 null */
export const editionYear = page => { const m = String(page).match(/\((\d{4})년?\)/); return m ? Number(m[1]) : null; };

const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
/** 위키문헌은 빨리 물으면 429 를 준다 — 물음 사이를 띄우고, 429 면 Retry-After(없으면 5·10·20초)만큼 기다려 세 번까지 다시 묻는다 */
async function getJson(url) {
  for (let i = 0; ; i++) {
    const wait = 1200 - (Date.now() - last); if (wait > 0) await sleep(wait);
    last = Date.now();
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'LinkPilot-poems-probe/1.0 (public-domain check; https://github.com/findKTH0415/linkpilot-cron)' } });
    const text = await r.text();
    if (r.status === 429 && i < 3) { const ra = Number(r.headers.get('retry-after')); await sleep((ra > 0 ? Math.min(ra, 60) : 5 * 2 ** i) * 1000); continue; }
    let j = null; try { j = JSON.parse(text); } catch (_) {}
    return { status: r.status, text, j, retried: i };
  }
}

async function main() {
  const year = Number(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 4));
  await mkdir(`${OUT}/raw`, { recursive: true });
  const log = []; const P = (s = '') => { log.push(s); console.log(s); };
  const got = []; let tried = 0; let reached = false;
  P('# 저작권이 끝난 시 — 위키문헌 원문 진단'); P('');
  P(`조회일 ${new Date().toISOString().slice(0, 10)} · 근거 **하나**(위키문헌) — 앱 시집 표에 올리기 전에 두 번째 근거와 대조한다 (§6-2-7)`); P('');
  for (const w of WORKS) {
    if (!isPublicDomain(w.died, year)) { P(`- ${w.author} — 몰년 ${w.died} · 아직 저작권 보호 중 · **건너뜀**`); continue; }
    for (const title of w.titles) {
      tried++;
      try {
        const q = `${API}?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(`${title} ${w.author}`)}`;
        const s = await getJson(q);
        reached = reached || s.status > 0;
        const hits = ((s.j && s.j.query && s.j.query.search) || []).map(h => h.title);
        const pages = pickPages(hits, title);
        if (!pages.length) { P(`- ${w.author} «${title}» — 검색 HTTP ${s.status}${s.retried ? ` (429 로 ${s.retried}번 다시 물음)` : ''} · 후보 ${hits.length ? hits.join(' · ') : '없음'} · **제목이 같은 문서를 못 골랐다**(지어 고르지 않는다)`); continue; }
        const editions = []; const notes = [];
        for (const pick of pages) {
          const raw = await getJson(`${API}?action=parse&format=json&prop=wikitext&page=${encodeURIComponent(pick)}`);
          const wt = raw.j && raw.j.parse && raw.j.parse.wikitext && raw.j.parse.wikitext['*'];
          if (!wt) { notes.push(`«${pick}» 원문 HTTP ${raw.status}`); continue; }
          const slug = `${w.author}-${title}-${editionYear(pick) || 'x'}`.replace(/[^\p{L}\p{N}-]+/gu, '_');
          let versions = poemVersions(wt); let from = 'wikitext';
          if (isListPage(wt, versions.length ? versions[0].lines : null)) {
            // 원문 글에 본문이 없다 — 그려진 판에서 시 칸을 읽는다 (진단용으로 원문 글도 남긴다)
            await writeFile(`${OUT}/raw/${slug}.list.wikitext`, wt);
            const html = await getJson(`${API}?action=parse&format=json&prop=text&page=${encodeURIComponent(pick)}`);
            const h = html.j && html.j.parse && html.j.parse.text && html.j.parse.text['*'];
            const hl = htmlPoemLines(h);
            if (!hl) { notes.push(`«${pick}» 은 안내·목록 문서(시 아님) · 그려진 판에도 시 칸 없음 (HTTP ${html.status})`); continue; }
            versions = [{ label: null, lines: hl }]; from = 'html';
          } else {
            await writeFile(`${OUT}/raw/${slug}.wikitext`, wt);
          }
          editions.push({ page: pick, year: editionYear(pick), url: `https://ko.wikisource.org/wiki/${encodeURIComponent(pick)}`, from, versions, lines: versions[0].lines });
        }
        if (!editions.length) { P(`- ${w.author} «${title}» — ${notes.join(' · ')} · **시 본문을 못 받았다**`); continue; }
        got.push({ author: w.author, died: w.died, title, editions, sources: ['위키문헌'], verified: false });
        const e0 = editions[0];
        const vs = e => e.versions.map(v => `${v.label || '본문'} ${v.lines.filter(x => x.trim()).length}줄`).join('/');
        P(`- ${w.author} «${title}» → ${editions.map(e => `«${e.page}» ${vs(e)}${e.from === 'html' ? ' (그려진 판)' : ''}`).join(' · ')} · 첫 줄 «${e0.lines[0].slice(0, 40)}»${editions.length > 1 ? ` · 판 ${editions.length}개 — 다음 단계에서 두 판의 글자를 대 본다` : ''}${notes.length ? ` · (${notes.join(' · ')})` : ''}`);
      } catch (e) {
        P(`- ${w.author} «${title}» — **못 닿음** (${String((e && e.cause && e.cause.code) || (e && e.message) || e).slice(0, 80)})`);
      }
    }
  }
  await writeFile(`${OUT}/wikisource.json`, JSON.stringify({ at: new Date().toISOString().slice(0, 10), note: '근거 하나(위키문헌). verified=false — 두 번째 근거와 대조 전에는 앱에 싣지 않는다', list: got }, null, 1));
  const code = got.length === tried ? 0 : got.length ? 1 : 2;
  const head = code === 0 ? `판정 0 — ${tried}편 **전부** 받았다` : code === 1 ? `판정 1 — ${tried}편 중 **${got.length}편** 받았다` : `판정 2 — **한 편도 못 받았다** (${tried}편)${reached ? '' : ' · 위키문헌에 닿지 못했다'}`;
  log.unshift(`> ${head}`, '');
  await writeFile(`${OUT}/_summary.md`, log.join('\n') + '\n');
  console.log(`LP_POEMS verdict=${code}`);
  process.exit(code);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
