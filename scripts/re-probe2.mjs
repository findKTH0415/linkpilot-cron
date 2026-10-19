// scripts/re-probe2.mjs
// ↑ 첫 글자는 반드시 "//" 다.
// re-probe 후속 — 안내 페이지의 규격(swagger)에서 인자 이름을 읽고, 날짜 인자만 최근 날짜로 채워 다시 부른다.
// 좌표·관리번호 같은 값은 지어 넣지 않는다 (§4.3). 열쇠는 안 남긴다 (§2).
import { mkdir, writeFile } from 'node:fs/promises';
import { redact, pick } from './probe-lib.mjs';
import { swaggerUrlOf } from './fsc-probe.mjs';
const OUT = 'data/_api'; await mkdir(OUT, { recursive: true });
const log = []; const P = (s = '') => { log.push(s); console.log(s); };
const key = pick(['DATA_GO_KR_KEY', 'PERSONAL_API_KEY']);
P('# re-probe2 — 규격에서 인자 읽기'); P(`- 포털 열쇠: ${key ? `\`${key.name}\`` : '**없다**'}`);
const kst = new Date(Date.now() + 9 * 3600e3);
const ymd = (n) => new Date(kst.getTime() - n * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
for (const id of ['15084795', '15142639']) {
  P(''); P(`## ${id}`);
  let html = '';
  try { html = await (await fetch(`https://www.data.go.kr/data/${id}/openapi.do`, { signal: AbortSignal.timeout(15000) })).text(); } catch (e) { P(`- 안내 페이지 못 닿음`); continue; }
  P(`- 안내 페이지 ${html.length}자 · 제목 «${(html.match(/<title>([^<]{0,120})/) || [])[1] || ''}»`);
  const typ = (html.match(/(LINK|REST|SOAP|파일데이터|링크)[^<]{0,40}/) || [])[0] || '';
  P(`- 유형 단서 «${typ}»`);
  const su = swaggerUrlOf(html);
  let sw = null;
  if (su) { try { sw = JSON.parse(await (await fetch(su, { signal: AbortSignal.timeout(15000) })).text()); } catch (_) {} }
  if (!sw) { const m = html.match(/var\s+swaggerJson\s*=\s*`([\s\S]*?)`/) || html.match(/swaggerJson\s*=\s*'([\s\S]*?)';/); if (m) { try { sw = JSON.parse(m[1]); } catch (_) {} } }
  P(`- 규격 ${sw ? '읽음' : '못 읽음'} ${su ? '(swaggerUrl)' : ''} · host ${sw && sw.host || ''} · basePath ${sw && sw.basePath || ''}`);
  { const t = html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
    for (const w of ['요청변수', '항목명(영문)', '출력결과', '응답메시지']) { let i = t.indexOf(w), n = 0; while (i >= 0 && n < 3) { P(`- «${w}» 둘레 «${redact(t.slice(i, i + 900))}»`); i = t.indexOf(w, i + 900); n++; } } }
  if (!sw) { const i = html.indexOf('요청주소'); P(`- 요청주소 둘레 «${redact(html.slice(Math.max(0, i), i + 400).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))}»`); continue; }
  for (const [p, ms] of Object.entries(sw.paths || {})) for (const [m, op] of Object.entries(ms || {})) {
    const ps = (op.parameters || []).filter((x) => !/^serviceKey$/i.test(x.name));
    P(`### ${m.toUpperCase()} ${p} — ${op.summary || ''}`);
    for (const x of ps) P(`  - ${x.name}${x.required ? ' (필수)' : ''} · ${String(x.description || '').replace(/\s+/g, ' ').slice(0, 80)}${x.example != null ? ` · 예 ${x.example}` : ''}${x.default != null ? ` · 기본 ${x.default}` : ''}`);
    if (!key || !sw.host) continue;
    if (id === '15142639') continue; // 관리번호·좌표가 필수 — 지어 넣지 않는다
    for (const back of [1, 7, 30]) {
      const q = new URLSearchParams();
      let fillable = true;
      for (const x of ps) {
        if (/date|dd|ymd|dt|de$/i.test(x.name)) q.set(x.name, ymd(back));
        else if (/pageNo/i.test(x.name)) q.set(x.name, '1');
        else if (/numOfRows/i.test(x.name)) q.set(x.name, '10');
        else if (/type$/i.test(x.name)) q.set(x.name, x.example != null ? String(x.example) : 'json');
        else if (x.required) { if (x.example != null) q.set(x.name, String(x.example)); else fillable = false; }
      }
      if (!fillable) { P(`  - 필수 인자 값을 문서에서 못 얻어 부르지 않았다`); break; }
      const url = `https://${sw.host}${sw.basePath || ''}${p}?serviceKey=${encodeURIComponent(key.value)}&${q}`;
      let st = null, body = '';
      try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); st = r.status; body = await r.text(); } catch (e) { body = String(e && e.message || e); }
      P(`  - 호출 (${q.toString().replace(/serviceKey=[^&]*/, '')}) — HTTP ${st} · ${body.length}자 «${redact(body.slice(0, 900).replace(/\s+/g, ' '))}»`);
      if (st === 200 && /<item>|"item"/.test(body)) break;
    }
  }
}
if (key) for (const [a, b] of [['201201', '202012'], ['202401', '202412']]) {
  let st = null, body = '';
  try { const r = await fetch(`https://apis.data.go.kr/B552521/recSpotInfo/getData?serviceKey=${encodeURIComponent(key.value)}&strDateS=${a}&strDateE=${b}`, { signal: AbortSignal.timeout(20000) }); st = r.status; body = await r.text(); } catch (e) { body = String(e && e.message || e); }
  P(`- 중부발전 getData strDateS=${a} strDateE=${b} — HTTP ${st} · ${body.length}자 «${redact(body.slice(0, 1500).replace(/\s+/g, ' '))}»`);
}
await writeFile(`${OUT}/re-probe2.md`, log.join('\n'));
