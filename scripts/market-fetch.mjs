// 시장 근거 수집 — 한국부동산원(R-ONE) 자본환원율·임대료, 통계청(KOSIS) 분당 인구
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

function rows(o, depth = 0) {
  if (!o || depth > 6) return [];
  if (Array.isArray(o)) return o;
  if (typeof o !== 'object') return [];
  for (const v of Object.values(o)) {
    const r = rows(v, depth + 1);
    if (r.length && typeof r[0] === 'object') return r;
  }
  return [];
}

say('# 시장 근거 자료 수집');
say('');
say(`조회일 ${new Date().toISOString().slice(0, 10)}`);
say('');

say('## 1. 한국부동산원 (R-ONE)');
say('');

if (!REB) { say('REB_API_KEY 없음 — 건너뜀'); }
else {
  const listUrl = `https://www.reb.or.kr/r-one/openapi/SttsApiTbl.do?KEY=${REB}&Type=json&pIndex=1&pSize=1000`;
  const list = await getJson(listUrl);
  if (list.__err) {
    say(`통계표 목록 조회 실패 : ${list.__err}`);
    say('```'); say(String(list.__body || '').slice(0, 400)); say('```');
  } else {
    const all = rows(list);
    say(`통계표 ${all.length}건 수신`);
    await writeFile(`${OUT}/reb_tables.json`, JSON.stringify(all, null, 2));

    const KW = ['상업용', '임대', '수익률', '환원', '지가', '오피스', '집합상가', '중대형'];
    const hit = all.filter((t) => KW.some((k) => JSON.stringify(t).includes(k)));
    say(`키워드 일치 ${hit.length}건`);
    say('');

    const data = {};
    for (const t of hit.slice(0, 25)) {
      const id = t.STATBL_ID || t.statblId;
      const nm = t.STATBL_NM || t.statblNm || '';
      const cyc = t.DTACYCLE_CD || t.dtacycleCd || 'QY';
      if (!id) continue;
      say(`- ${id} · ${nm} (${cyc})`);
      const d = await getJson(
        `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?KEY=${REB}&Type=json&STATBL_ID=${id}&DTACYCLE_CD=${cyc}&pIndex=1&pSize=500`
      );
      data[id] = { name: nm, cycle: cyc, resp: d };
      const rr = rows(d);
      if (rr.length) {
        const seong = rr.filter((x) => JSON.stringify(x).match(/성남|분당|경기/));
        say(`    행 ${rr.length}건${seong.length ? ` · 성남·분당·경기 ${seong.length}건` : ''}`);
        for (const x of seong.slice(0, 5)) {
          const cls = x.CLS_NM || x.clsNm || '';
          const itm = x.ITM_NM || x.itmNm || '';
          const val = x.DTA_VAL ?? x.dtaVal ?? '';
          const tm = x.WRTTIME_DESC || x.wrttimeDesc || x.WRTTIME_IDTFR_ID || '';
          say(`      · ${tm} ${cls} ${itm} = ${val}`);
        }
      } else if (d.__err) say(`    조회 실패 : ${d.__err}`);
    }
    await writeFile(`${OUT}/reb_data.json`, JSON.stringify(data, null, 2));
  }
}
say('');

say('## 2. 통계청 (KOSIS)');
say('');

if (!KOSIS) { say('KOSIS_API_KEY 없음 — 건너뜀'); }
else {
  const queries = ['주민등록인구', '장래인구추계', '고령인구', '가구원수'];
  const found = {};
  for (const q of queries) {
    const u = `https://kosis.kr/openapi/statisticsSearch.do?method=getList&apiKey=${KOSIS}` +
              `&searchNm=${encodeURIComponent(q)}&format=json&jsonVD=Y&startCount=1&resultCount=20`;
    const r = await getJson(u);
    const rr = rows(r);
    say(`검색 「${q}」 → ${rr.length}건${r.__err ? ' · ' + r.__err : ''}`);
    if (r.__err) { say('```'); say(String(r.__body || '').slice(0, 300)); say('```'); }
    found[q] = rr;
    for (const x of rr.slice(0, 6)) {
      say(`  - ${x.ORG_ID || ''} / ${x.TBL_ID || ''} · ${x.TBL_NM || x.STAT_NM || ''}`);
    }
  }
  await writeFile(`${OUT}/kosis_search.json`, JSON.stringify(found, null, 2));

  say('');
  say('### 성남시 분당구 인구 조회 시도');
  const tries = [
    { orgId: '101', tblId: 'DT_1B040A3', prdSe: 'Y', label: '주민등록인구(시군구)' },
    { orgId: '101', tblId: 'DT_1B04005N', prdSe: 'Y', label: '주민등록 연령별 인구' },
  ];
  const pop = {};
  for (const t of tries) {
    const u = `https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList&apiKey=${KOSIS}` +
              `&itmId=T20+&objL1=ALL&format=json&jsonVD=Y&prdSe=${t.prdSe}&newEstPrdCnt=3` +
              `&orgId=${t.orgId}&tblId=${t.tblId}`;
    const r = await getJson(u);
    const rr = rows(r);
    say(`- ${t.label} (${t.tblId}) → ${rr.length}건${r.__err ? ' · ' + r.__err : ''}`);
    const bd = rr.filter((x) => JSON.stringify(x).includes('분당'));
    if (bd.length) {
      say(`  분당 관련 ${bd.length}건`);
      for (const x of bd.slice(0, 6)) say(`   · ${x.PRD_DE || ''} ${x.C1_NM || ''} ${x.ITM_NM || ''} = ${x.DT || ''}`);
    }
    pop[t.tblId] = rr.slice(0, 300);
  }
  await writeFile(`${OUT}/kosis_population.json`, JSON.stringify(pop, null, 2));
}

say('');
say('---');
say('수집 완료.');
await writeFile(`${OUT}/_summary.md`, log.join('\n'));
console.log('\n완료 — data/market/');
