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

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'LinkPilot-poems-probe/1.0 (public-domain check)' } });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (_) {}
  return { status: r.status, text, j };
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
        const pick = hits.find(h => h.replace(/\s*\(.*\)\s*$/, '') === title) || null;
        if (!pick) { P(`- ${w.author} «${title}» — 검색 HTTP ${s.status} · 후보 ${hits.length ? hits.join(' · ') : '없음'} · **제목이 같은 문서를 못 골랐다**(지어 고르지 않는다)`); continue; }
        const raw = await getJson(`${API}?action=parse&format=json&prop=wikitext&page=${encodeURIComponent(pick)}`);
        const wt = raw.j && raw.j.parse && raw.j.parse.wikitext && raw.j.parse.wikitext['*'];
        if (!wt) { P(`- ${w.author} «${title}» → 문서 «${pick}» · 원문 HTTP ${raw.status} · 앞머리 «${String(raw.text).slice(0, 200).replace(/\s+/g, ' ')}»`); continue; }
        const slug = `${w.author}-${title}`.replace(/[^\p{L}\p{N}-]+/gu, '_');
        await writeFile(`${OUT}/raw/${slug}.wikitext`, wt);
        const lines = poemLines(wt);
        if (!lines) { P(`- ${w.author} «${title}» → «${pick}» · 원문은 받았는데 본문 줄을 못 뽑았다 · \`raw/${slug}.wikitext\``); continue; }
        got.push({ author: w.author, died: w.died, title, page: pick, url: `https://ko.wikisource.org/wiki/${encodeURIComponent(pick)}`, lines, sources: ['위키문헌'], verified: false });
        P(`- ${w.author} «${title}» → «${pick}» · ${lines.length}줄 · 첫 줄 «${lines[0].slice(0, 40)}»`);
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
  process.exitCode = code;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
