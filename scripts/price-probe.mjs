// scripts/price-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다.
//
// 전력 판매 단가 실측 — SMP(계통한계가격) · REC 현물 〈2026-10-05 사장님: 「⚙ 가정값 직접 설정에서 최근 한전에 반영된 가격으로 기초값으로 설정해줘」〉
//
// ★ 기초값을 «지어내지 않는다» — 열쇠가 있는 자리(Actions)에서 공식 자료를 받아 «값 · 출처 · 기준일»을 함께 적는다.
//   REC 는 이미 붙은 커넥터(kpx.js · 판정 0)로 받는다. SMP 는 이 저장소에 커넥터가 없어 **주소를 추측하지 않고**
//   포털 검색 → 안내 페이지에서 서비스·오퍼레이션을 읽어 그대로 부른다 (§4.3 · fsc-probe 와 같은 방식).
// ★ 시세는 공개 자료라 값을 적는다. 열쇠 값은 한 글자도 안 남긴다 (redact · §2).

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { redact, pick, MEAN } from './probe-lib.mjs';
import { discover, searchHits } from './fsc-probe.mjs';

const require = createRequire(import.meta.url);
const kpx = require('../im-agent/connectors/kpx.js');
const OUT = 'data/_api';
await mkdir(OUT, { recursive: true });
const log = [];
const P = (s = '') => { log.push(s); console.log(s); };
const result = { at: new Date().toISOString(), rec: null, smp: [] };
const codes = [];

P('# 전력 판매 단가 실측 (SMP · REC)');
P('');

/* ① REC 현물 — 최근 1·3개월 거래량 가중평균과 마지막 거래일 */
for (const months of [1, 3]) {
  const r = await kpx.recAverage({ months, area: 'land' });
  if (r.ok) {
    const v = r.value;
    if (months === 1) result.rec = { ...v };
    else result.rec3 = { ...v };
    P(`- REC 육지 최근 ${months}개월 — 가중평균 **${v.weightedAvg}원/REC** · 단순평균 ${v.simpleAvg} · 개장 ${v.sessions}회 · 기간 ${v.from}~${v.latestDate} · 마지막 거래일 종가(평균) ${v.latestPrice}`);
    codes.push(0);
  } else { P(`- REC 최근 ${months}개월 — **못 받았다** (${redact(String(r.error || ''))})`); codes.push(3); }
}
P('');

/* ② SMP — 포털에서 서비스를 찾는다 (번호를 지어내지 않는다) */
const key = pick(['KPX_SMP_DEMAND_FORECAST', 'PERSONAL_API_KEY', 'DATA_GO_KR_KEY', 'APIS_DATA', 'SPECIAL_DAY_INFO']);
P(`- 포털 열쇠: ${key ? `\`${key.name}\` (길이 ${key.value.length})` : '**없다**'}`);
const svcs = [];
for (const [kw, word] of [['한국전력거래소 계통한계가격', '계통한계가격'], ['한국전력거래소 SMP', 'SMP'], ['전력거래소 계통한계가격', '계통한계'], ['한국전력거래소 SMP 수요예측', 'SMP'], ['전력거래소 수요예측', '수요예측']]) {
  try {
    const r = await fetch('https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=' + encodeURIComponent(kw), { signal: AbortSignal.timeout(15000) });
    const hits = searchHits(await r.text(), word);
    P(`- 포털 검색 «${kw}» — HTTP ${r.status} · ${hits.length ? hits.map((h) => `${h.id} ${h.name}`).join(' · ') : '못 뽑았다'}`);
    for (const h of hits) if (!svcs.some((x) => x.id === h.id)) svcs.push(h);
  } catch (e) { P(`- 포털 검색 «${kw}» — 못 닿음 (${redact(String(e && e.message || e))})`); }
}
const today = new Date(Date.now() + 9 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const days = [1, 2, 3, 7].map((n) => ymd(new Date(today.getTime() - n * 86400e3)));
let smpOk = false;
for (const s of svcs.slice(0, 5)) {
  let html = '';
  try { html = await (await fetch(`https://www.data.go.kr/data/${s.id}/openapi.do`, { signal: AbortSignal.timeout(15000) })).text(); } catch (_) {}
  const d = discover(html);
  P(`## ${s.name} (${s.id})`);
  P(`- 서비스 ${d.bases.join(' · ') || '못 읽었다'} · 오퍼레이션 ${d.ops.join(' · ') || '못 읽었다'} · 필수 인자 ${d.required.join(' · ') || '(못 읽었다/없음)'}`);
  if (!key) continue;
  const targets = [...new Set([...d.full, ...d.bases.flatMap((b) => d.ops.map((o) => `${b}/${o}`))])].slice(0, 4);
  for (const t of targets) {
    /* 필수 인자가 날짜면 최근 날짜를 넣는다 — 이름은 스웨거가 적은 것만 쓴다(지어내지 않는다) */
    const dateArgs = d.required.filter((n) => /(dd|day|date|ymd|dt)$/i.test(n));
    for (const day of dateArgs.length ? days : ['']) {
      const q = new URLSearchParams({ pageNo: '1', numOfRows: '100', dataType: 'JSON', _type: 'json' });
      for (const n of dateArgs) q.set(n, day);
      const url = `https://apis.data.go.kr/${t}?serviceKey=${encodeURIComponent(key.value)}&${q}`;
      let body = '', st = null;
      try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); st = r.status; body = await r.text(); } catch (e) { body = String(e && e.message || e); }
      P(`- \`${t}\`${day ? ` · ${dateArgs.join('/')}=${day}` : ''} — HTTP ${st} · ${body.length}자`);
      P(`  - 앞머리 «${redact(body.slice(0, 600).replace(/\s+/g, ' '))}»`);
      const ok = st === 200 && /"items?"|<item>/.test(body) && /\d{2,3}\.\d+/.test(body);
      result.smp.push({ svc: s.id, op: t, day, status: st, head: redact(body.slice(0, 4000)) });
      if (ok) { smpOk = true; break; }
    }
  }
}
/* ②-1 SMP 평균 — 판정 0 이 나온 서비스(15131225)에서 육지 시간별 SMP 를 받아 «최근 1개월»·«마지막 날» 평균을 낸다.
   정렬은 믿지 않고 날짜로 직접 거른다 (§4.4). 기초값은 이 숫자·기간·표본 수로만 적는다 — 지어내지 않는다. */
if (smpOk && key) {
  const rows = [];
  for (let pg = 1; pg <= 3; pg++) {
    const q = new URLSearchParams({ pageNo: String(pg), numOfRows: '1000', dataType: 'JSON' });
    try {
      const r = await fetch(`https://apis.data.go.kr/B552115/SmpWithForecastDemand/getSmpWithForecastDemand?serviceKey=${encodeURIComponent(key.value)}&${q}`, { signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      let it = j && j.response && j.response.body && j.response.body.items && j.response.body.items.item;
      if (it && !Array.isArray(it)) it = [it];
      if (!it || !it.length) break;
      rows.push(...it);
    } catch (e) { P(`- SMP 평균용 ${pg}쪽 — 못 받았다 (${redact(String(e && e.message || e))})`); break; }
  }
  const land = rows.filter((x) => x && /육지/.test(String(x.areaName || '')) && Number.isFinite(+x.smp) && +x.smp > 0 && /^\d{8}$/.test(String(x.date)));
  const dates = [...new Set(land.map((x) => String(x.date)))].sort();
  if (dates.length) {
    const last = dates[dates.length - 1];
    const lt = new Date(`${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}T00:00:00Z`);
    const from = new Date(lt.getTime() - 29 * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
    const avg = (a) => Math.round(a.reduce((t, x) => t + (+x.smp), 0) / a.length * 100) / 100;
    const m1 = land.filter((x) => String(x.date) >= from);
    const d1 = land.filter((x) => String(x.date) === last);
    result.smpAvg = { area: '육지', from: [...new Set(m1.map((x) => String(x.date)))].sort()[0], to: last, days: new Set(m1.map((x) => String(x.date))).size, hours: m1.length, avg1m: avg(m1), lastDay: last, lastDayAvg: avg(d1), lastDayHours: d1.length, source: '한국전력거래소 계통한계가격 및 수요예측(하루전 발전계획용) · data.go.kr 15131225' };
    /* 시간대별 평균 〈2026-10-05 · 권장 진행〉 — 「hour」 칸(01~24)으로 30일을 묶는다. 발전량 가중치는 출처가 없어 안 쓴다 —
       단순평균을 시간대마다 적고, 주간 구간 둘(09~17시 · 11~15시)도 «단순평균»이라고 적는다. 지어내지 않는다. */
    const byH = {};
    for (const x of m1) { const h = String(x.hour || '').padStart(2, '0'); if (!/^(0[1-9]|1\d|2[0-4])$/.test(h)) continue; (byH[h] = byH[h] || []).push(x); }
    const hours = Object.keys(byH).sort().map((h) => ({ hour: h, n: byH[h].length, avg: avg(byH[h]) }));
    const band = (a, b) => { const r = m1.filter((x) => { const h = +x.hour; return h >= a && h <= b; }); return r.length ? { from: a, to: b, n: r.length, avg: avg(r) } : null; };
    result.smpAvg.hourly = hours;
    result.smpAvg.day0917 = band(9, 17);
    result.smpAvg.day1115 = band(11, 15);
    const v = result.smpAvg;
    P(`- SMP 육지 최근 1개월 — 평균 **${v.avg1m}원/kWh** · 기간 ${v.from}~${v.to} · ${v.days}일 ${v.hours}시간 · 마지막 날 ${v.lastDay} 평균 ${v.lastDayAvg}원/kWh (${v.lastDayHours}시간)`);
    if (v.day0917) P(`- SMP 육지 시간대 단순평균 — 09~17시 **${v.day0917.avg}원/kWh** (${v.day0917.n}시간) · 11~15시 **${v.day1115 ? v.day1115.avg : '-'}원/kWh** (${v.day1115 ? v.day1115.n : 0}시간) · 발전량 가중 아님`);
    if (hours.length) P(`- SMP 시간대별 평균(시각 칸 01~24) — ${hours.map((h) => `${h.hour}:${h.avg}`).join(' · ')}`);
  } else P('- SMP 평균 — 육지 시간별 값을 못 뽑았다');
}
/* ②-2 전력수급예보 〈2026-10-05 · D-420 · 사장님이 KPX_POWER_SUPPLY_DEMAND_FORECAST_GW 를 넣으셨다〉 —
   SMP 와 같은 방식(포털 검색 → 안내 페이지 → 그대로 부른다). 판정에는 안 섞는다 — 받았는지만 적는다. */
const key2 = pick(['KPX_POWER_SUPPLY_DEMAND_FORECAST_GW', 'PERSONAL_API_KEY', 'DATA_GO_KR_KEY', 'APIS_DATA', 'SPECIAL_DAY_INFO']);
P('');
P(`## 전력수급예보 — 열쇠 ${key2 ? `\`${key2.name}\` (길이 ${key2.value.length})` : '**없다**'}`);
result.supply = [];
const svcs2 = [];
for (const [kw, word] of [['한국전력거래소 전력수급예보', '수급예보'], ['전력거래소 전력수급예보조회', '수급']]) {
  try {
    const r = await fetch('https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=' + encodeURIComponent(kw), { signal: AbortSignal.timeout(15000) });
    const hits = searchHits(await r.text(), word);
    P(`- 포털 검색 «${kw}» — HTTP ${r.status} · ${hits.length ? hits.map((h) => `${h.id} ${h.name}`).join(' · ') : '못 뽑았다'}`);
    for (const h of hits) if (!svcs2.some((x) => x.id === h.id)) svcs2.push(h);
  } catch (e) { P(`- 포털 검색 «${kw}» — 못 닿음 (${redact(String(e && e.message || e))})`); }
}
for (const s of svcs2.slice(0, 3)) {
  let html = '';
  try { html = await (await fetch(`https://www.data.go.kr/data/${s.id}/openapi.do`, { signal: AbortSignal.timeout(15000) })).text(); } catch (_) {}
  const d = discover(html);
  P(`### ${s.name} (${s.id})`);
  P(`- 서비스 ${d.bases.join(' · ') || '못 읽었다'} · 오퍼레이션 ${d.ops.join(' · ') || '못 읽었다'} · 필수 인자 ${d.required.join(' · ') || '(못 읽었다/없음)'}`);
  if (!key2) continue;
  const targets = [...new Set([...d.full, ...d.bases.flatMap((b) => d.ops.map((o) => `${b}/${o}`))])].slice(0, 4);
  for (const t of targets) {
    const dateArgs = d.required.filter((n) => /(dd|day|date|ymd|dt)$/i.test(n));
    const q = new URLSearchParams({ pageNo: '1', numOfRows: '50', dataType: 'JSON', _type: 'json' });
    for (const n of dateArgs) q.set(n, days[0]);
    let body = '', st = null;
    try { const r = await fetch(`https://apis.data.go.kr/${t}?serviceKey=${encodeURIComponent(key2.value)}&${q}`, { signal: AbortSignal.timeout(20000) }); st = r.status; body = await r.text(); } catch (e) { body = String(e && e.message || e); }
    P(`- \`${t}\` — HTTP ${st} · ${body.length}자`);
    P(`  - 앞머리 «${redact(body.slice(0, 600).replace(/\s+/g, ' '))}»`);
    result.supply.push({ svc: s.id, op: t, status: st, head: redact(body.slice(0, 2000)) });
  }
}
/* ③ SMP — 공개 화면(열쇠 없음)에서 읽는다. 위 API 는 활용신청 전이라 막혔다(등록되지 않은 서비스키).
   주소는 전력거래소·EPSIS 의 공개 화면이고, 숫자는 «SMP» 낱말 둘레에서만 줍는다 — 지어내지 않는다.
   무엇을 받았는지 둘레 글을 그대로 남겨, 값을 쓸지는 사람이 본다. */
result.smpPublic = [];
for (const u of ['https://www.kpx.or.kr/', 'https://new.kpx.or.kr/', 'https://epsis.kpx.or.kr/epsisnew/selectEkmaSmpShdChart.do?menuId=040201', 'https://epsis.kpx.or.kr/epsisnew/selectEkmaSmpSmpChart.do?menuId=040202', 'https://epsis.kpx.or.kr/epsisnew/selectEkmaSmpSmpGrid.do?menuId=040202']) {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    const t = (await r.text()).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const snips = [];
    let i = t.search(/SMP|계통한계가격/);
    while (i >= 0 && snips.length < 4) { snips.push(t.slice(Math.max(0, i - 80), i + 220)); const n = t.slice(i + 3).search(/SMP|계통한계가격/); i = n < 0 ? -1 : i + 3 + n; }
    P(`- 공개 화면 ${u} — HTTP ${r.status} · ${t.length}자`);
    for (const x of snips) P(`  - 둘레 «${redact(x)}»`);
    result.smpPublic.push({ url: u, status: r.status, snips });
  } catch (e) { P(`- 공개 화면 ${u} — 못 닿음 (${redact(String(e && e.message || e))})`); }
}
codes.push(smpOk ? 0 : 5);
await writeFile(`${OUT}/price-probe.json`, redact(JSON.stringify(result, null, 1)));
const code = Math.max(...codes);
const verdict = `판정 ${code} — ${MEAN[code] || '판정하지 못했다'} (REC ${result.rec ? 0 : 3} · SMP ${smpOk ? 0 : 5})`;
log.unshift(`> ${verdict}`, '');
await writeFile(`${OUT}/price-probe.md`, log.join('\n'));
console.log(verdict);
process.exit(code);
