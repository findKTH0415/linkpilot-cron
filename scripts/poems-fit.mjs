// 저작권이 끝난 시 — «카드 한 장에 들어가는가» 실측 〈2026-10-21 사장님: 「시를 선정시 카드 화면안에 들어가는 컨텐츠만 구성」〉
//
// ★ 플랫폼(linkpilot-platform)의 명언 카드 그리기와 «같은 규칙»으로 잰다 — 값은 아래 CARD 한 곳에 있고, 출처를 적어 둔다.
//   1080×1920 · 좌우 여백 92 · 글 칸 위 260 ~ 아래 1720(나의 글 판) · 글씨 64px 에서 시작해 9줄을 넘으면 4px 씩 · 46px 밑으로는 더 안 줄인다 ·
//   줄 높이 = 글씨 × 1.34 · 줄바꿈은 글자 단위(폭 896px 을 넘으면 다음 줄) · 작가·제목 한 줄 자리 70px.
//   ★ 플랫폼 카드가 바뀌면 이 값도 함께 바꾼다 — 두 벌이라 한쪽이 옛말을 할 수 있다(§8-1). 그 사실을 _fit.md 에 적는다.
// ★ 글자 폭은 «잰 값»이다 — 헤드리스 크로미움에서 페이퍼로지(700)로 measureText 한다. 글꼴이 안 실리면 «못 쟀다»로 끝낸다(대체 글꼴로 잰 값은 거짓이다).
// ★ 옛한글 «원문» 판은 후보에서 뺀다 — 카드 글꼴이 그 글자를 못 그릴 수 있다(빈 네모가 나간다). 현대어 판이 있으면 그것, 없으면 본문.
// ★ 시를 자르지(발췌하지) 않는다 — 들어가지 않으면 «안 들어감»으로 적고 카드 후보에서 뺀다.
// 종료 코드 0 잼 · 2 못 쟀다(크로미움·글꼴·자료 없음)
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OUT = 'data/poems';
export const CARD = Object.freeze({
  W: 1080, padX: 92, top: 260, bottom: 1720, fs0: 64, fsMin: 46, step: 4, maxLines: 9, lh: 1.34, personGap: 70, weight: 700,
  source: 'linkpilot-platform 명언 카드(나의 글 판) — W=1080 · padX=92 · midTop=260 · midBot=1720 · QMAX=9 · QMIN=46 · 64→4px 씩 · 줄높이 1.34 · 인물 줄 70',
});
const FONT_URL = 'https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@892c5e6b51f8947b532156e3f6e4c09773086387/Paperlogy-7Bold.woff2';

/** 판 고르기 — 현대어 → 본문(머리글 없음) · 원문(옛한글)은 안 쓴다 */
export function cardVersion(edition) {
  const vs = (edition && edition.versions) || [];
  return vs.find(v => v.label === '현대어') || vs.find(v => !v.label || v.label === '본문') || null;
}
/** 카드에 실을 줄 — 첫 줄이 제목과 같으면 뗀다(제목은 작가 줄에 실린다) · 앞뒤 빈 줄 정리 */
export function cardLines(lines, title) {
  const t = String(title || '').replace(/\s+/g, '');
  const out = (lines || []).map(s => String(s).trim());
  if (out.length && out[0].replace(/\s+/g, '').replace(/[<>«»]/g, '') === t) out.shift();
  while (out.length && !out[0]) out.shift();
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}
/**
 * 카드 규칙대로 줄바꿈·축소를 흉내 낸다. measure(text, fs) → 폭(px).
 * 플랫폼 wrap 과 같다: '\n' 마다 끊고, 글자를 하나씩 붙여 폭을 넘으면 다음 줄 · 빈 줄도 한 줄로 센다.
 */
export function simulate(lines, measure, card = CARD) {
  const maxW = card.W - card.padX * 2;
  const wrap = fs => {
    const out = [];
    for (const seg of lines) { let cur = ''; for (const ch of seg) { if (measure(cur + ch, fs) > maxW) { out.push(cur); cur = ch; } else cur += ch; } out.push(cur); }
    return out;
  };
  let fs = card.fs0; let rows = wrap(fs);
  while (rows.length > card.maxLines && fs > card.fsMin) { fs -= card.step; rows = wrap(fs); }
  const lh = Math.round(fs * card.lh);
  const height = rows.length * lh + card.personGap;
  const limit = card.bottom - card.top;
  return { fs, rows: rows.length, height, limit, fits: height <= limit };
}

function findBrowser() {
  const c = [process.env.CHROME_PATH].filter(Boolean);
  for (const root of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    let ds = []; try { ds = readdirSync(root); } catch (_) { continue; }
    for (const d of ds) c.push(path.join(root, d, 'chrome-linux', 'chrome'), path.join(root, d, 'chrome-linux', 'headless_shell'));
  }
  c.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  return c.find(p => { try { return statSync(p).isFile(); } catch (_) { return false; } }) || null;
}

async function main() {
  const log = []; const P = (s = '') => { log.push(s); console.log(s); };
  const finish = async (code, head) => {
    log.unshift(`> ${head}`, '');
    await writeFile(`${OUT}/_fit.md`, log.join('\n') + '\n');
    console.log(`LP_POEMS_FIT verdict=${code}`);
    process.exit(code);
  };
  P('# 저작권이 끝난 시 — 카드 한 장에 들어가는가'); P('');
  P(`카드 규칙: ${CARD.source}`); P('');
  let src;
  try { src = JSON.parse(await readFile(`${OUT}/wikisource.json`, 'utf8')); } catch (e) { return finish(2, `판정 2 — 시 자료(wikisource.json)를 못 읽었다 · 못 쟀다`); }
  const browser = findBrowser();
  if (!browser) return finish(2, '판정 2 — 헤드리스 크로미움이 없다 · 못 쟀다');

  const items = [];
  for (const p of src.list || []) for (const e of p.editions || []) {
    const v = cardVersion(e);
    items.push({ author: p.author, title: p.title, page: e.page, label: v ? (v.label || '본문') : null, lines: v ? cardLines(v.lines, p.title) : null });
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'poems-fit-'));
  const local = process.env.LP_FONT_DIR && path.join(process.env.LP_FONT_DIR, 'Paperlogy-7Bold.woff2');
  const fontSrc = local && existsSync(local) ? `url(file://${local})` : `url(${FONT_URL})`;
  const page = `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:Paperlogy;src:${fontSrc} format('woff2');font-weight:700}</style><pre id="out">PENDING</pre>
<script>
const CARD=${JSON.stringify(CARD)};const ITEMS=${JSON.stringify(items)};
${simulate.toString()}
(async()=>{const o=document.getElementById('out');try{await document.fonts.load('700 64px Paperlogy');const ok=document.fonts.check('700 64px Paperlogy');
const cv=document.createElement('canvas').getContext('2d');const m=(t,fs)=>{cv.font='700 '+fs+'px Paperlogy';return cv.measureText(t).width;};
const res=ITEMS.map(it=>it.lines?Object.assign({author:it.author,title:it.title,page:it.page,label:it.label},simulate(it.lines,m,CARD)):{author:it.author,title:it.title,page:it.page,label:null,fits:false,why:'카드에 실을 판이 없다(원문 옛한글뿐)'});
o.textContent=JSON.stringify({fontOk:ok,res});}catch(e){o.textContent=JSON.stringify({error:String(e)});}})();
</script>`;
  const file = path.join(dir, 'fit.html');
  await writeFile(file, page);
  let dom = '';
  try {
    dom = execFileSync(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=15000', '--dump-dom', `file://${file}`], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { return finish(2, `판정 2 — 크로미움이 끝나지 않았다 (${String(e.message).slice(0, 80)}) · 못 쟀다`); }
  const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  let r = null; try { r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')); } catch (_) {}
  if (!r || r.error || !r.res) return finish(2, `판정 2 — 재는 쪽에서 답을 못 받았다 (${(r && r.error) || '빈 답'}) · 못 쟀다`);
  if (!r.fontOk) return finish(2, '판정 2 — 페이퍼로지 글꼴이 실리지 않았다(대체 글꼴로 잰 값은 쓰지 않는다) · 못 쟀다');

  const fit = r.res.filter(x => x.fits);
  for (const x of r.res) {
    P(x.fits ? `- ✓ ${x.author} «${x.title}» (${x.label}) — ${x.rows}줄 · 글씨 ${x.fs}px · 높이 ${x.height}/${x.limit}px · **카드에 들어간다**`
      : x.why ? `- ✗ ${x.author} «${x.title}» — ${x.why}` : `- ✗ ${x.author} «${x.title}» (${x.label}) — ${x.rows}줄 · 글씨 ${x.fs}px 까지 줄여도 높이 ${x.height}/${x.limit}px · **안 들어간다**(자르지 않는다)`);
  }
  await writeFile(`${OUT}/card-fit.json`, JSON.stringify({ at: new Date().toISOString().slice(0, 10), card: CARD, note: '카드 후보는 fits=true 인 것만 · 근거 하나(위키문헌) — verified=false 는 그대로', list: r.res }, null, 1));
  return finish(0, `판정 0 — 잰 ${r.res.length}편 중 **${fit.length}편**이 카드 한 장에 들어간다`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
