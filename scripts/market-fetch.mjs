// 시장 근거 수집 v5 — 부동산원 ITM_DATANO/CLS_DATANO 로 좁혀 조회 + 통계청 분당 인구
// 의존성 없음. Node 20+ 내장 fetch 만 쓴다.

import { mkdir, writeFile } from 'node:fs/promises';

const REB = process.env.REB_API_KEY;
const KOSIS = process.env.KOSIS_API_KEY;
const OUT = 'data/market';
await mkdir(OUT, { recursive: true });

const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { ok: r.ok, status: r.status, text: t, json: j };
  } catch (e) { return { ok: false, status: 0, text: String(e.message), json: null }; }
}
function rows(o, depth = 0) {
  if (!o || depth > 8) return [];
  if (Array.isArray(o)) {
    const inner = [];
    for (const el of o) { const r = rows(el, depth + 1); if (r.length) inner.push(...r); }
    if (inner.length) return inner;
    return o.filter((x) => x && typeof x === 'object');
  }
  if (typeof o !== 'object') return [];
  if (Array.isArray(o.row)) return o.row;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'head' || k === 'RESULT') continue;
    const r = rows(v, depth + 1);
    if (r.length) return r;
  }
  return [];
}
function msg(j) {
  const s = JSON.stringify(j || {});
  const m = s.match(/"CODE"\s*:\s*"([^"]+)"[^}]*"MESSAGE"\s*:\s*"([^"]+)"/);
  return m ? `${m[1]} ${m[2]}` : '';
}

// 항목 메타 전체 페이징 (한 페이지 100건 상한)
async function allItems(id) {
  const out = [];
  for (let p = 1; p <= 20; p++) {
    const r = await get(`https://www.reb.or.kr/r-one/openapi/SttsApiTblItm.do?KEY=${REB}&Type=json&STATBL_ID=${id}&pIndex=${p}&pSize=100`);
    const rr = rows(r.json);
    out.push(...rr);
    if (rr.length < 100) break;
  }
  return out;
}

const GEO = /경기|성남|분당/;
const TBL = [
  ['T242083134887473', '수익률 · 중대형 상가'],
  ['T246393134978815', '수익률 · 집합 상가'],
  ['T246253134913401', '수익률 · 소규모 상가'],
  ['T244363134858603', '임대료 · 중대형 상가'],
  ['T244913134948657', '임대료 · 집합 상가'],
  ['T248223134698125', '임대료 · 소규모 상가'],
  ['T241873134863890', '층별임대료 · 중대형 상가'],
  ['T249023134703697', '층별임대료 · 집합 상가'],
  ['T249633134845544', '공실률 · 중대형 상가'],
  ['T243283134931290', '공실률 · 집합 상가'],
];

say('# 시장 근거 자료 수집 v5');
say('');
say(`조회일 ${new Date().toISOString().slice(0, 10)}`);
say('');
say('## 1. 한국부동산원 — 상업용부동산 임대동향조사');
say('');

const diag = {};
if (!REB) say('REB_API_KEY 없음 — 건너뜀');
else {
  for (const [id, label] of TBL) {
    say(`### ${label}  \`${id}\``);
    const meta = await allItems(id);
    const items = meta.filter((x) => String(x.ITM_TAG) === '항목');
    const clses = meta.filter((x) => String(x.ITM_TAG) === '분류');
    const geo = clses.filter((x) => GEO.test(String(x.ITM_NM) + String(x.ITM_FULLNM)));
    say(`- 메타 ${meta.length}건 · 항목 ${items.length} · 분류 ${clses.length} · 경기·성남·분당 분류 ${geo.length}`);
    if (items.length) say(`  항목 : ${items.slice(0, 8).map((x) => `${x.ITM_NM}(${x.ITM_ID})`).join(', ')}`);
    if (geo.length) say(`  지역 : ${geo.map((x) => `${x.ITM_FULLNM || x.ITM_NM}(${x.ITM_ID})`).join(', ')}`);
    else say(`  지역 분류 예시 : ${clses.slice(0, 12).map((x) => x.ITM_NM).join(', ')}`);

    const d = { label, items: items.slice(0, 20), geo, results: [] };
    const useItems = items.length ? items.slice(0, 4) : [{ ITM_ID: '' }];
    const useGeo = geo.length ? geo.slice(0, 4) : clses.slice(0, 1);

    outer:
    for (const it of useItems) {
      for (const g of useGeo) {
        const u = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?KEY=${REB}&Type=json` +
                  `&STATBL_ID=${id}&DTACYCLE_CD=QY` +
                  (it.ITM_ID ? `&ITM_DATANO=${it.ITM_ID}` : '') +
                  `&CLS_DATANO=${g.ITM_ID}&pIndex=1&pSize=100`;
        const r = await get(u);
        const rr = rows(r.json);
        if (!rr.length) {
          say(`- ${it.ITM_NM || '전체'} × ${g.ITM_NM} : 0행 ${msg(r.json)}`);
          continue;
        }
        const last = rr.slice(-6);
        say(`- **${it.ITM_NM || '전체'} × ${g.ITM_FULLNM || g.ITM_NM}** : ${rr.length}행`);
        for (const x of last) {
          say(`  · ${x.WRTTIME_DESC || x.WRTTIME_IDTFR_ID || ''} = **${x.DTA_VAL}** ${x.UI_NM || ''}`);
        }
        d.results.push({ item: it.ITM_NM, geo: g.ITM_FULLNM || g.ITM_NM, rows: rr });
        if (d.results.length >= 6) break outer;
      }
    }
    diag[id] = d;
    say('');
  }
  await writeFile(`${OUT}/reb_data.json`, JSON.stringify(diag, null, 2));
}

say('## 2. 통계청 — 성남시 분당구');
say('');
const kosisOut = {};
if (!KOSIS) say('KOSIS_API_KEY 없음 — 건너뜀');
else {
  const tries = [
    { tblId: 'DT_1B040A3', itmId: 'T20+T21+T22+', label: '주민등록 총인구·성별' },
    { tblId: 'DT_1JC1502', itmId: 'T1+', label: '가구원수별 가구' },
  ];
  for (const t of tries) {
    const u = `https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList&apiKey=${KOSIS}` +
              `&itmId=${t.itmId}&objL1=ALL&format=json&jsonVD=Y&prdSe=Y&newEstPrdCnt=3&orgId=101&tblId=${t.tblId}`;
    const r = await get(u);
    const rr = rows(r.json);
    const bd = rr.filter((x) => JSON.stringify(x).includes('분당'));
    say(`### ${t.label} (${t.tblId}) — 전체 ${rr.length}행 · 분당 ${bd.length}행`);
    for (const x of bd.slice(0, 20)) {
      say(`- ${x.PRD_DE || ''} · ${x.C1_NM || ''} · ${x.ITM_NM || ''} = **${x.DT || ''}** ${x.UNIT_NM || ''}`);
    }
    say('');
    kosisOut[t.tblId] = bd;
  }
  await writeFile(`${OUT}/kosis_data.json`, JSON.stringify(kosisOut, null, 2));
}

say('---');
say('수집 완료.');
await writeFile(`${OUT}/_summary.md`, log.join('\n'));
console.log('\n완료 — data/market/');
