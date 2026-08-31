// 시장 근거 수집 v2 — 한국부동산원 임대동향조사(수익률·임대료·공실률) + 통계청 분당 인구
// 의존성 없음. Node 20+ 내장 fetch 만 쓴다.

import { mkdir, writeFile } from 'node:fs/promises';

const REB = process.env.REB_API_KEY;
const KOSIS = process.env.KOSIS_API_KEY;
const OUT = 'data/market';
await mkdir(OUT, { recursive: true });

const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function getJson(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const t = await r.text();
    if (!r.ok) return { __err: `HTTP ${r.status}`, __body: t.slice(0, 300) };
    try { return JSON.parse(t); } catch { return { __err: 'JSON 아님', __body: t.slice(0, 400) }; }
  } catch (e) { return { __err: e.message }; }
}

// REB 는 [{head:[...]},{row:[...]}] 구조, KOSIS 는 평평한 배열
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

const TARGET = /성남|분당|경기/;

say('# 시장 근거 자료 수집');
say('');
say(`조회일 ${new Date().toISOString().slice(0, 10)}`);
say('');

/* ─────────── 1. 한국부동산원 임대동향조사 ─────────── */
say('## 1. 한국부동산원 — 상업용부동산 임대동향조사');
say('');

// 2024년 3분기 이후 최신 계열 + 2022~2024 계열
const TBL = [
  ['T245883135037859', '수익률 · 오피스',        'QY'],
  ['T242083134887473', '수익률 · 중대형 상가',   'QY'],
  ['T246253134913401', '수익률 · 소규모 상가',   'QY'],
  ['T246393134978815', '수익률 · 집합 상가',     'QY'],
  ['A_2024_00366',     '수익률 · 오피스 (2022~)','QY'],
  ['A_2024_00367',     '수익률 · 중대형 (2022~)','QY'],
  ['A_2024_00369',     '수익률 · 집합 (2022~)',  'QY'],
  ['TT249843134237374','임대료 · 오피스',        'QY'],
  ['T244363134858603', '임대료 · 중대형 상가',   'QY'],
  ['T248223134698125', '임대료 · 소규모 상가',   'QY'],
  ['T244913134948657', '임대료 · 집합 상가',     'QY'],
  ['A_2024_00278',     '임대료 · 중대형 (2022~)','QY'],
  ['A_2024_00280',     '임대료 · 집합 (2022~)',  'QY'],
  ['TT244763134428698','공실률 · 오피스',        'QY'],
  ['T249633134845544', '공실률 · 중대형 상가',   'QY'],
  ['T243283134931290', '공실률 · 집합 상가',     'QY'],
  ['T241873134863890', '층별임대료 · 중대형',    'QY'],
  ['T249023134703697', '층별임대료 · 집합 상가', 'QY'],
  ['A_2024_00415',     '자본수익률 · 중대형',    'QY'],
  ['A_2024_00417',     '자본수익률 · 집합',      'QY'],
  ['A_2024_00391',     '소득수익률 · 중대형',    'QY'],
  ['A_2024_00393',     '소득수익률 · 집합',      'QY'],
];

const rebOut = {};
if (!REB) say('REB_API_KEY 없음 — 건너뜀');
else {
  for (const [id, label, cyc] of TBL) {
    const d = await getJson(
      `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?KEY=${REB}&Type=json` +
      `&STATBL_ID=${id}&DTACYCLE_CD=${cyc}&pIndex=1&pSize=2000`
    );
    const rr = rows(d);
    const hit = rr.filter((x) => TARGET.test(JSON.stringify(x)));
    rebOut[id] = { label, total: rr.length, matched: hit };
    say(`### ${label}`);
    if (d.__err) { say(`조회 실패 : ${d.__err}`); say(''); continue; }
    say(`전체 ${rr.length}행 · 성남·분당·경기 ${hit.length}행`);
    // 최신 시점만 추려서 표시
    const latest = {};
    for (const x of hit) {
      const tm = x.WRTTIME_DESC || x.WRTTIME_IDTFR_ID || '';
      const cls = x.CLS_NM || '';
      const key = cls;
      if (!latest[key] || String(tm) > String(latest[key].tm)) {
        latest[key] = { tm, cls, itm: x.ITM_NM || '', val: x.DTA_VAL, unit: x.UI_NM || '' };
      }
    }
    for (const v of Object.values(latest).slice(0, 12)) {
      say(`- ${v.tm} · ${v.cls} · ${v.itm} = **${v.val}** ${v.unit}`);
    }
    say('');
  }
  await writeFile(`${OUT}/reb_data.json`, JSON.stringify(rebOut, null, 2));
}

/* ─────────── 2. 통계청 분당 인구 ─────────── */
say('## 2. 통계청 — 성남시 분당구');
say('');

const kosisOut = {};
if (!KOSIS) say('KOSIS_API_KEY 없음 — 건너뜀');
else {
  const tries = [
    { tblId: 'DT_1B040A3',  itmId: 'T20+T21+T22+', prdSe: 'Y', label: '주민등록 총인구·세대' },
    { tblId: 'DT_1B04006',  itmId: 'T20+',         prdSe: 'Y', label: '시군구/1세별 주민등록인구' },
    { tblId: 'DT_1JC1502',  itmId: 'T1+',          prdSe: 'Y', label: '가구원수별 가구(읍면동)' },
  ];
  for (const t of tries) {
    const u = `https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList&apiKey=${KOSIS}` +
              `&itmId=${t.itmId}&objL1=ALL&format=json&jsonVD=Y&prdSe=${t.prdSe}&newEstPrdCnt=3` +
              `&orgId=101&tblId=${t.tblId}`;
    const r = await getJson(u);
    const rr = rows(r);
    const bd = rr.filter((x) => JSON.stringify(x).includes('분당'));
    say(`### ${t.label} (${t.tblId})`);
    if (r.__err) { say(`조회 실패 : ${r.__err}`); say(''); continue; }
    say(`전체 ${rr.length}행 · 분당 ${bd.length}행`);
    for (const x of bd.slice(0, 12)) {
      say(`- ${x.PRD_DE || ''} · ${x.C1_NM || ''} · ${x.ITM_NM || ''} = **${x.DT || ''}** ${x.UNIT_NM || ''}`);
    }
    say('');
    kosisOut[t.tblId] = bd;
  }
  await writeFile(`${OUT}/kosis_data.json`, JSON.stringify(kosisOut, null, 2));
}

say('---');
say('수집 완료. reb_data.json · kosis_data.json 참조.');
await writeFile(`${OUT}/_summary.md`, log.join('\n'));
console.log('\n완료 — data/market/');
