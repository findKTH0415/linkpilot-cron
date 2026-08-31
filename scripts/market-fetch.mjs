// 시장 근거 수집 v4 — 부동산원 항목(ITM/CLS/기간) 탐색 후 데이터 조회 + 통계청 분당 인구
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
function resultMsg(j) {
  const s = JSON.stringify(j || {});
  const m = s.match(/"CODE"\s*:\s*"([^"]+)"[^}]*"MESSAGE"\s*:\s*"([^"]+)"/);
  return m ? `${m[1]} ${m[2]}` : '';
}

const TARGET = /성남|분당|경기/;
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
  ['A_2024_00367', '수익률 · 중대형 (2022~2024)'],
  ['A_2024_00369', '수익률 · 집합 (2022~2024)'],
  ['A_2024_00278', '임대료 · 중대형 (2022~2024)'],
  ['A_2024_00280', '임대료 · 집합 (2022~2024)'],
  ['A_2024_00415', '자본수익률 · 중대형 (2022~)'],
  ['A_2024_00391', '소득수익률 · 중대형 (2022~)'],
];

say('# 시장 근거 자료 수집 v4');
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
    const d = { label };

    // (a) 항목·분류·기간 메타 조회
    const itm = await get(`https://www.reb.or.kr/r-one/openapi/SttsApiTblItm.do?KEY=${REB}&Type=json&STATBL_ID=${id}&pIndex=1&pSize=1000`);
    const itmRows = rows(itm.json);
    d.itm = { status: itm.status, count: itmRows.length, sample: itmRows.slice(0, 8), msg: resultMsg(itm.json) };
    say(`- 항목메타 : HTTP ${itm.status} · ${itmRows.length}건 ${d.itm.msg}`);
    if (!itmRows.length) say('  ```\n  ' + itm.text.slice(0, 300).replace(/\n/g, ' ') + '\n  ```');
    else {
      const keys = Object.keys(itmRows[0]).join(', ');
      say(`  필드 : ${keys}`);
      for (const x of itmRows.slice(0, 6)) say(`  · ${JSON.stringify(x).slice(0, 160)}`);
    }

    // (b) 기간 후보 추출
    const geo = itmRows.filter((x) => /성남|분당|경기/.test(String(x.ITM_NM || '') + String(x.ITM_FULLNM || '')));
    if (geo.length) {
      say(`  지역 분류 ${geo.length}건 : ` + geo.map((x) => `${x.ITM_NM}(${x.ITM_ID})`).slice(0, 12).join(', '));
      d.geo = geo;
    }

    const times = [...new Set(itmRows.map((x) => x.WRTTIME_IDTFR_ID || x.wrttimeIdtfrId).filter(Boolean))];
    const cands = times.length ? times.slice(-3) : ['', '20244', '2024', '20243'];

    // (c) 데이터 조회 — 기간 후보를 순서대로 시도
    d.tries = [];
    for (const cyc of ['QY', 'YY']) {
      for (const wt of cands) {
        const u = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?KEY=${REB}&Type=json` +
                  `&STATBL_ID=${id}&DTACYCLE_CD=${cyc}` + (wt ? `&WRTTIME_IDTFR_ID=${wt}` : '') +
                  `&pIndex=1&pSize=1000`;
        const r = await get(u);
        const rr = rows(r.json);
        const hit = rr.filter((x) => TARGET.test(JSON.stringify(x)));
        d.tries.push({ cyc, wt, status: r.status, rows: rr.length, matched: hit.length, msg: resultMsg(r.json), body: rr.length ? '' : r.text.slice(0, 200) });
        say(`- 데이터 ${cyc}${wt ? '/' + wt : ''} : ${rr.length}행 · 성남·분당·경기 ${hit.length}행 ${resultMsg(r.json)}`);
        if (hit.length) {
          d.matched = hit;
          const seen = new Set();
          for (const x of hit) {
            const key = `${x.CLS_NM || ''}|${x.ITM_NM || ''}`;
            if (seen.has(key)) continue; seen.add(key);
            say(`  · ${x.WRTTIME_DESC || x.WRTTIME_IDTFR_ID || ''} · ${x.CLS_NM || ''} · ${x.ITM_NM || ''} = **${x.DTA_VAL}** ${x.UI_NM || ''}`);
            if (seen.size >= 12) break;
          }
          break;
        }
        if (rr.length && !hit.length) {
          say(`  (성남·분당 없음 — 분류 예시 : ${[...new Set(rr.map((x) => x.CLS_NM).filter(Boolean))].slice(0, 8).join(', ')})`);
          break;
        }
        if (!rr.length && r.text) say('  ```\n  ' + r.text.slice(0, 220).replace(/\n/g, ' ') + '\n  ```');
      }
      if (d.matched) break;
    }
    diag[id] = d;
    say('');
  }
  await writeFile(`${OUT}/reb_diag.json`, JSON.stringify(diag, null, 2));
}

/* ─────────── 통계청 ─────────── */
say('## 2. 통계청 — 성남시 분당구');
say('');
const kosisOut = {};
if (!KOSIS) say('KOSIS_API_KEY 없음 — 건너뜀');
else {
  const tries = [
    { tblId: 'DT_1B040A3', itmId: 'T20+T21+T22+', label: '주민등록 총인구·성별' },
    { tblId: 'DT_1JC1502', itmId: 'T1+',          label: '가구원수별 가구' },
    { tblId: 'DT_1B04005N', itmId: 'T20+',        label: '읍면동/5세별 주민등록인구' },
  ];
  for (const t of tries) {
    const u = `https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList&apiKey=${KOSIS}` +
              `&itmId=${t.itmId}&objL1=ALL&format=json&jsonVD=Y&prdSe=Y&newEstPrdCnt=3&orgId=101&tblId=${t.tblId}`;
    const r = await get(u);
    const rr = rows(r.json);
    const bd = rr.filter((x) => JSON.stringify(x).includes('분당'));
    say(`### ${t.label} (${t.tblId})`);
    say(`전체 ${rr.length}행 · 분당 ${bd.length}행`);
    for (const x of bd.slice(0, 20)) {
      say(`- ${x.PRD_DE || ''} · ${x.C1_NM || ''} · ${x.ITM_NM || ''} = **${x.DT || ''}** ${x.UNIT_NM || ''}`);
    }
    say('');
    kosisOut[t.tblId] = bd;
  }
  await writeFile(`${OUT}/kosis_data.json`, JSON.stringify(kosisOut, null, 2));
}

say('---');
say('수집 완료. reb_diag.json · kosis_data.json 참조.');
await writeFile(`${OUT}/_summary.md`, log.join('\n'));
console.log('\n완료 — data/market/');
