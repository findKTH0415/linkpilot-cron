// 시장 근거 수집 v6 — 기간 고정 + 전 페이지 수집 후 분당·성남 추출
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

// 한 기간(WRTTIME_IDTFR_ID)을 페이지 단위로 전부 긁는다
async function fetchPeriod(id, cyc, wt) {
  const out = [];
  for (let p = 1; p <= 40; p++) {
    const u = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?KEY=${REB}&Type=json` +
              `&STATBL_ID=${id}&DTACYCLE_CD=${cyc}&WRTTIME_IDTFR_ID=${wt}&pIndex=${p}&pSize=100`;
    const r = await get(u);
    const rr = rows(r.json);
    out.push(...rr);
    if (rr.length < 100) break;
  }
  return out;
}

// 분당·성남 상권과 경기 광역
const PICK = (x) => {
  const s = `${x.CLS_FULLNM || ''} ${x.CLS_NM || ''}`;
  return /분당|성남/.test(s) && !/울산/.test(s) || s.trim() === '경기';
};

const PERIODS = ['202502', '202501', '202404', '202403'];
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

say('# 시장 근거 자료 수집 v6');
say('');
say(`조회일 ${new Date().toISOString().slice(0, 10)}`);
say('');
say('## 1. 한국부동산원 — 상업용부동산 임대동향조사');
say('');
say('분당역세권·성남구시가지·경기 광역만 추출했습니다.');
say('');

const store = {};
if (!REB) say('REB_API_KEY 없음 — 건너뜀');
else {
  for (const [id, label] of TBL) {
    say(`### ${label}`);
    let picked = [], usedWt = '';
    for (const wt of PERIODS) {
      const all = await fetchPeriod(id, 'QY', wt);
      if (!all.length) continue;
      const hit = all.filter(PICK);
      if (hit.length) { picked = hit; usedWt = wt; break; }
      if (!usedWt) usedWt = wt;
    }
    if (!picked.length) { say(`- 해당 지역 데이터 없음 (조회 기간 ${usedWt || PERIODS.join(', ')})`); say(''); continue; }

    const when = picked[0].WRTTIME_DESC || usedWt;
    say(`- 기준 ${when} · ${picked.length}건`);
    const byGeo = {};
    for (const x of picked) {
      const g = x.CLS_FULLNM || x.CLS_NM;
      (byGeo[g] ||= []).push(x);
    }
    for (const [g, arr] of Object.entries(byGeo)) {
      const parts = arr.map((x) => `${x.ITM_NM} **${Number(x.DTA_VAL).toFixed(2)}**${x.UI_NM || ''}`);
      say(`  · **${g}** — ${parts.join(' · ')}`);
    }
    store[id] = { label, when, rows: picked };
    say('');
  }
  await writeFile(`${OUT}/reb_data.json`, JSON.stringify(store, null, 2));
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
    say(`### ${t.label} — 분당 ${bd.length}건`);
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

/* ★★★ **초록이 「값이 왔다」를 뜻하게 한다** 〈2026-09-19 · D-226 · §12-24 · §12-36〉.
   [무엇이었나] 이 스크립트는 `process.exit` 이 **한 곳도 없었다.** 열쇠가 없어
     통째로 건너뛰어도, 열 표가 전부 빈손이어도 **초록**이다. 초록이라 아무도
     `_summary.md` 를 안 열어 보고, 정작 하려던 수집은 한 번도 안 된 채로 남는다.
   ★ 세는 잣대는 **「보고서에 실을 것이 왔나」**다 — 호출 횟수가 아니다.
     이 스크립트가 내려는 것은 둘이다: **부동산원 임대동향 표**와 **통계청 분당 행**.
   ★★ 판정은 **요약 맨 앞**(§6-3 ①), **결과 파일을 먼저 남긴 뒤에** 빨갛게 끝낸다 (§12-24).
   ★★★ **「대답했는데 그 지역 자료가 없다」를 실패로 세지 않는다** — 그 갈래는
     고칠 자리가 없다 (§4 의 셋째 갈래). 여기서는 **한 표라도 값이 왔는가**로 센다. */
const gotReb = Object.keys(store).length > 0;
const gotKosis = Object.values(kosisOut).some((v) => Array.isArray(v) && v.length > 0);
const code = (gotReb && gotKosis) ? 0 : ((gotReb || gotKosis) ? 1 : 2);
const verdict = code === 0
  ? '판정 0 — 부동산원 표와 통계청 행을 **둘 다** 받았다'
  : code === 1
    ? `판정 1 — **하나만** 받았다 (부동산원 ${gotReb ? '받음' : '못 받음'} · `
      + `통계청 ${gotKosis ? '받음' : '못 받음'}). 아래에서 어느 쪽이 빈손인지 본다`
    : '판정 2 — **한 가지도 못 받았다.** 열쇠(REB_API_KEY · KOSIS_API_KEY)·'
      + '활용신청·그쪽 서버 중 하나다 — 아래 사유를 본다';
log.unshift(`> ${verdict}`, '');

await writeFile(`${OUT}/_summary.md`, log.join('\n'));
console.log('\n완료 — data/market/');
// ★ 사람이 읽는 판정은 stderr 로도 낸다 — 요약이 stdout 만 받아 가는 자리가 있다 (§12-19)
if (code !== 0) console.error(verdict.replace(/\*\*/g, ''));
process.exit(code);
