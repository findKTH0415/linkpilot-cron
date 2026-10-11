// scripts/global-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다.
//
// 베트남·태국·방글라데시 «현지 정보 출처» — 실측 진단 〈2026-10-11 사장님: 「①의 진단 스크립트를 지금 만들어 돌려줘」〉
//
// ★★★ 열리는지 «추측하지 않고» 잰다 (CLAUDE.md §4.3). 출처 후보를 열쇠 없이 한 번씩 불러
//   무엇이 오는지만 적는다 — 배선은 판정 0 이 나온 것만 한다.
// ★ 열쇠를 하나도 안 쓴다 — 전부 공개 주소다. 그래도 본문 앞머리는 redact 를 지난다 (§2).
// ★★ 갈래 다섯 (값마다 하실 일이 다르다 · §12-24):
//   0 값이 왔다(JSON·XML 에서 기대한 칸을 찾았다) — 커넥터 후보
//   1 화면만 열린다(HTML · API 아님) — 사람이 조회하는 출처로 둔다. 긁지 않는다 (§6-2-7)
//   2 대답은 왔는데 기대한 값이 없다 — 규격을 다시 본다
//   3 못 닿았다(응답 없음 · 5xx) — 도는 자리 문제일 수 있다. «없다»로 적지 않는다
//   4 열쇠·가입이 필요하다(401·403 · 인증 낱말) — 열쇠를 받을지 사람이 정한다

import { mkdir, writeFile } from 'node:fs/promises';
import { redact } from './probe-lib.mjs';

const OUT = 'data/_global';
const Y = new Date().getUTCFullYear();
const D = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/* 출처 후보 — 이름은 지식 기준이다. 맞는지는 아래가 잰다. want: 값이 왔다고 볼 글자 */
const SOURCES = [
  // 공통
  { c: '공통', what: '세계은행 — 베트남 GDP', url: 'https://api.worldbank.org/v2/country/VNM/indicator/NY.GDP.MKTP.CD?format=json&per_page=2', want: /"value"\s*:\s*[0-9]/ },
  { c: '공통', what: '세계은행 — 태국·방글라데시 물가상승률', url: 'https://api.worldbank.org/v2/country/THA;BGD/indicator/FP.CPI.TOTL.ZG?format=json&per_page=4', want: /"value"\s*:\s*-?[0-9]/ },
  { c: '공통', what: 'IMF DataMapper — 실질성장률 3개국', url: 'https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/VNM/THA/BGD', want: /"VNM"\s*:\s*\{/ },
  { c: '공통', what: '공휴일 API(Nager.Date) — 베트남', url: `https://date.nager.at/api/v3/PublicHolidays/${Y}/VN`, want: /"localName"/ },
  { c: '공통', what: '공휴일 API(Nager.Date) — 태국', url: `https://date.nager.at/api/v3/PublicHolidays/${Y}/TH`, want: /"localName"/ },
  { c: '공통', what: '공휴일 API(Nager.Date) — 방글라데시', url: `https://date.nager.at/api/v3/PublicHolidays/${Y}/BD`, want: /"localName"/ },
  { c: '공통', what: '환율 API(Frankfurter·ECB) — VND·THB·BDT', url: 'https://api.frankfurter.app/latest?from=USD&to=VND,THB,BDT', want: /"(VND|THB|BDT)"\s*:\s*[0-9]/ },
  // 베트남
  { c: '베트남', what: '국가통계청(NSO·옛 GSO) 누리집', url: 'https://www.nso.gov.vn/', want: null },
  { c: '베트남', what: '국가 오픈데이터 포털', url: 'https://data.gov.vn/', want: null },
  { c: '베트남', what: '중앙은행(SBV) 누리집', url: 'https://www.sbv.gov.vn/', want: null },
  { c: '베트남', what: '기업등록 국가포털', url: 'https://dangkykinhdoanh.gov.vn/', want: null },
  { c: '베트남', what: '법령 데이터베이스(vbpl)', url: 'https://vbpl.vn/', want: null },
  // 태국
  { c: '태국', what: '오픈데이터(CKAN API) — 검색', url: 'https://data.go.th/api/3/action/package_search?q=exchange&rows=1', want: /"success"\s*:\s*true/ },
  { c: '태국', what: '중앙은행(BOT) API 게이트웨이 — 환율', url: `https://apigw1.bot.or.th/bot/public/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/?start_period=${D(10)}&end_period=${D(1)}&currency=USD`, want: /"data_detail"/ },
  { c: '태국', what: '상무부 DBD 기업정보', url: 'https://datawarehouse.dbd.go.th/', want: null },
  { c: '태국', what: '재무부 토지평가가', url: 'https://assessprice.treasury.go.th/', want: null },
  // 방글라데시
  { c: '방글라데시', what: '중앙은행 환율 화면', url: 'https://www.bb.org.bd/en/index.php/econdata/exchangerate', want: null },
  { c: '방글라데시', what: '통계청(BBS) 누리집', url: 'https://bbs.gov.bd/', want: null },
  { c: '방글라데시', what: '회사등기소(RJSC)', url: 'https://roc.gov.bd/', want: null },
  { c: '방글라데시', what: '오픈데이터 포털', url: 'http://data.gov.bd/', want: null },
];

const AUTH = /unauthori[sz]ed|forbidden|api[ _-]?key|client[ _-]?id|access token|invalid credential|subscription/i;
const MEAN = {
  0: '값이 왔다 — 커넥터 후보',
  1: '화면만 열린다(API 아님) — 사람이 조회하는 출처로 둔다',
  2: '대답은 왔는데 기대한 값이 없다 — 규격을 다시 본다',
  3: '못 닿았다 — 도는 자리 문제일 수 있다. «없다»가 아니다',
  4: '열쇠·가입이 필요하다 — 받을지 사람이 정한다',
};

async function one(s) {
  const t0 = Date.now();
  try {
    const r = await fetch(s.url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (LinkPilot probe)', Accept: '*/*' } });
    const body = await r.text();
    const ms = Date.now() - t0;
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    const html = /html/i.test(ct) || /^\s*<(!doctype|html)/i.test(body);
    const head = redact(body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200));
    let code;
    if (r.status === 401 || r.status === 403 || (r.status >= 400 && AUTH.test(body.slice(0, 2000)))) code = 4;
    else if (r.status >= 500) code = 3;
    else if (s.want && s.want.test(body)) code = 0;
    else if (r.status >= 200 && r.status < 400 && html) code = 1;
    else code = 2;
    return { ...s, code, status: r.status, ms, ct, len: body.length, final: r.url !== s.url ? new URL(r.url).host : '', head };
  } catch (e) {
    const why = redact(String((e && (e.cause && e.cause.code)) || (e && e.message) || e)).slice(0, 120);
    return { ...s, code: 3, status: null, ms: Date.now() - t0, why };
  }
}

const rows = [];
for (const s of SOURCES) rows.push(await one(s)); // 한 번에 하나씩 — 남의 서버에 몰아 붙지 않는다

const cnt = [0, 1, 2, 3, 4].map((k) => rows.filter((r) => r.code === k).length);
const head = `판정 — 값 ${cnt[0]} · 화면만 ${cnt[1]} · 값 없음 ${cnt[2]} · 못 닿음 ${cnt[3]} · 열쇠 필요 ${cnt[4]} (전체 ${rows.length})`;
const log = [];
log.push(`# 해외 현지 정보 출처 — 실측 진단`, '', `조회일 ${new Date().toISOString().slice(0, 10)} · 자리: GitHub Actions 러너(해외 IP)`, '');
log.push('| 나라 | 출처 | 판정 | HTTP | ms | 비고 |', '|---|---|---|---|---:|---|');
for (const r of rows) {
  const note = r.status == null ? `응답 없음 (${r.why})` : `${r.ct || '?'} · ${r.len}자${r.final ? ' · →' + r.final : ''}`;
  log.push(`| ${r.c} | ${r.what} | ${r.code} | ${r.status ?? '-'} | ${r.ms} | ${note.replace(/\|/g, '/')} |`);
}
log.push('', '## 판정 뜻', ...Object.entries(MEAN).map(([k, v]) => `- ${k} ${v}`));
log.push('', '## 본문 앞머리(200자 · 가림)', ...rows.filter((r) => r.head).map((r) => `- ${r.c} · ${r.what}: ${r.head.replace(/\|/g, '/')}`));
log.push('', '> 이름은 지식 기준 후보다. «못 닿음»은 이 러너에서의 값이다 — 국내 자리에서는 다를 수 있다 (D-206).');

log.splice(2, 0, head, ''); // 판정을 요약 맨 앞에 (§6-3 ①)
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/_summary.md`, log.join('\n') + '\n');
await writeFile(`${OUT}/global-probe.json`, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2) + '\n');

console.log(head);
for (const r of rows) console.log(`${r.code} ${r.c} ${r.what} HTTP ${r.status ?? '-'} ${r.ms}ms`);
console.error(head);

// 하나라도 값이 오면 0 · 전부 못 닿았으면 3 · 그 밖은 0 (진단은 «무엇이 오는지 적는 일»이라 화면만 열리는 것은 실패가 아니다)
const code = cnt[3] === rows.length ? 3 : 0;
process.exit(code);
