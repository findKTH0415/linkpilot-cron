// scripts/re-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다.
//
// 신재생 보고서용 공공 API 셋 실측 〈2026-10-20 사장님: 「위 API가 만약 작동이 안되거나 막혀 있으면 알려줘」〉
//   ① 신재생에너지(REC) 현물시장 거래시장  ② 한국중부발전 공급인증서(REC) 기준가격  ③ 국립환경과학원 환경영향평가 지형지질정보
// ★ price-probe 와 같은 방식 — 포털 검색 → 안내 페이지에서 서비스·오퍼레이션을 읽어 그대로 부른다 (§4.3 · 주소를 지어내지 않는다).
// ★ 필수 인자 중 날짜만 최근 날짜로 채운다. 좌표·지역 같은 값은 지어 넣지 않는다 — 그 응답도 «승인 여부»를 가른다.
// ★ 열쇠 값은 한 글자도 안 남긴다 (redact · §2).

import { mkdir, writeFile } from 'node:fs/promises';
import { redact, pick } from './probe-lib.mjs';
import { discover, searchHits } from './fsc-probe.mjs';

const OUT = 'data/_api';
await mkdir(OUT, { recursive: true });
const log = [];
const P = (s = '') => { log.push(s); console.log(s); };
const result = { at: new Date().toISOString(), groups: [] };

const key = pick(['DATA_GO_KR_KEY', 'PERSONAL_API_KEY', 'KPX_SMP_DEMAND_FORECAST', 'KPX_POWER_SUPPLY_DEMAND_FORECAST_GW', 'APIS_DATA', 'SPECIAL_DAY_INFO']);
P('# 신재생 보고서용 공공 API 셋 실측');
P('');
P(`- 포털 열쇠: ${key ? `\`${key.name}\` (길이 ${key.value.length})` : '**없다**'}`);

const today = new Date(Date.now() + 9 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const ym = (d) => ymd(d).slice(0, 6);
const days = [1, 3, 7, 30].map((n) => new Date(today.getTime() - n * 86400e3));

function verdictOf(st, body) {
  if (st == null) return '못 닿음';
  if (/SERVICE_KEY_IS_NOT_REGISTERED/.test(body)) return '활용신청 안 됨(등록되지 않은 서비스키)';
  if (/NO_OPENAPI_SERVICE/.test(body)) return '서비스 없음·폐기';
  if (/LIMITED_NUMBER/.test(body)) return '일일 한도 초과';
  if (st === 200 && /"resultCode"\s*:\s*"0*0"|<resultCode>0*0<\/resultCode>/.test(body) && /"items?"|<item>/.test(body)) return '값이 왔다';
  if (st === 200 && /NODATA|"totalCount"\s*:\s*"?0"?/.test(body)) return '대답은 왔다 · 0건';
  if (st === 200) return '대답은 왔다 · 판정 보류(본문 확인)';
  return `HTTP ${st}`;
}

const GROUPS = [
  { name: 'REC 현물시장 거래시장', kws: [['신재생에너지 현물시장 거래', '현물'], ['REC 현물시장', 'REC'], ['공급인증서 현물시장', '현물']] },
  { name: '한국중부발전 REC 기준가격', kws: [['한국중부발전 공급인증서', '공급인증서'], ['한국중부발전 REC', 'REC'], ['중부발전 기준가격', '기준가격']] },
  { name: '국립환경과학원 환경영향평가 지형지질', kws: [['환경영향평가 지형지질', '지형'], ['국립환경과학원 환경영향평가', '환경영향평가'], ['지형지질정보', '지형']] },
];

for (const g of GROUPS) {
  P('');
  P(`## ${g.name}`);
  const grp = { name: g.name, search: [], calls: [] };
  const svcs = [];
  for (const [kw, word] of g.kws) {
    try {
      const r = await fetch('https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=' + encodeURIComponent(kw), { signal: AbortSignal.timeout(15000) });
      const hits = searchHits(await r.text(), word);
      P(`- 포털 검색 «${kw}» — HTTP ${r.status} · ${hits.length ? hits.map((h) => `${h.id} ${h.name}`).join(' · ') : '못 뽑았다'}`);
      grp.search.push({ kw, status: r.status, hits });
      for (const h of hits) if (!svcs.some((x) => x.id === h.id)) svcs.push(h);
    } catch (e) { P(`- 포털 검색 «${kw}» — 못 닿음 (${redact(String(e && e.message || e))})`); }
  }
  for (const s of svcs.slice(0, 4)) {
    let html = '';
    try { html = await (await fetch(`https://www.data.go.kr/data/${s.id}/openapi.do`, { signal: AbortSignal.timeout(15000) })).text(); } catch (_) {}
    const d = discover(html);
    P(`### ${s.name} (${s.id})`);
    P(`- 서비스 ${d.bases.join(' · ') || '못 읽었다'} · 오퍼레이션 ${d.ops.join(' · ') || '못 읽었다'} · 필수 인자 ${d.required.join(' · ') || '(못 읽었다/없음)'}`);
    if (!key) continue;
    const targets = [...new Set([...d.full, ...d.bases.flatMap((b) => d.ops.map((o) => `${b}/${o}`))])].filter((t) => !/_(header|body|items?)$/.test(t)).slice(0, 3);
    for (const t of targets) {
      const dateArgs = d.required.filter((n) => /(dd|day|date|ymd|dt|de)$/i.test(n));
      const monthArgs = d.required.filter((n) => /(ym|month|mm)$/i.test(n) && !dateArgs.includes(n));
      for (const day of (dateArgs.length || monthArgs.length) ? days : [null]) {
        const q = new URLSearchParams({ pageNo: '1', numOfRows: '20', dataType: 'JSON', _type: 'json', type: 'json', resultType: 'json' });
        for (const n of dateArgs) q.set(n, ymd(day));
        for (const n of monthArgs) q.set(n, ym(day));
        let body = '', st = null;
        try { const r = await fetch(`https://apis.data.go.kr/${t}?serviceKey=${encodeURIComponent(key.value)}&${q}`, { signal: AbortSignal.timeout(20000) }); st = r.status; body = await r.text(); } catch (e) { body = String(e && e.message || e); }
        const v = verdictOf(st, body);
        P(`- \`${t}\`${day ? ` · ${[...dateArgs, ...monthArgs].join('/')}=${ymd(day)}` : ''} — HTTP ${st} · ${body.length}자 · **${v}**`);
        P(`  - 앞머리 «${redact(body.slice(0, 700).replace(/\s+/g, ' '))}»`);
        grp.calls.push({ svc: s.id, name: s.name, op: t, day: day ? ymd(day) : '', status: st, verdict: v, head: redact(body.slice(0, 4000)) });
        if (v === '값이 왔다' || /활용신청|서비스 없음/.test(v)) break;
      }
    }
  }
  const best = grp.calls.find((c) => c.verdict === '값이 왔다') || grp.calls[0];
  grp.verdict = best ? best.verdict : (svcs.length ? '부르지 못함' : '포털에서 서비스를 못 찾음');
  P(`- **판정: ${grp.verdict}**`);
  result.groups.push(grp);
}

await writeFile(`${OUT}/re-probe.json`, redact(JSON.stringify(result, null, 1)));
log.splice(1, 0, '', ...result.groups.map((g) => `> ${g.name} — **${g.verdict}**`));
await writeFile(`${OUT}/re-probe.md`, log.join('\n'));
