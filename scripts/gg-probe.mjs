// scripts/gg-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// `GG_DATADREAM_OPENDATA` 가 먹는가 — 진단 〈2026-10-26 · 사장님 「경기데이터드림의 전체 공공데이터(GG_DataDream_OpenData) 키넣었어」〉
//
// ★★★ 왜 따로인가 — 경기데이터드림은 공공데이터포털(data.go.kr)이 아니다. 주소가 openapi.gg.go.kr 이고
//   열쇠를 `KEY=` 로 받는다. 포털 검색 진단(fsc-probe)에 실으면 남의 창구에 열쇠를 보내고 «없다»로 적힌다.
// ★★ 진단부터 짠다 (CLAUDE.md §4) — 용도가 아직 정해지지 않아, 널리 쓰이는 서비스 둘을 «시험용»으로 불러
//   무엇이 오는지만 본다. 서비스 이름이 틀렸으면 본문이 그렇게 말한다 — 그것도 잰 값이다(판정 5).
// ★ 결과 코드는 본문 RESULT.CODE 를 그대로 적는다(INFO-000 정상 · ERROR-290 인증키 문제 등) — 상태코드만 보면 둘이 같다 (§4.2).
// ★ 값은 한 글자도 안 남긴다 (§2 · 공개 저장소) — 본문·오류 글은 공용 창구의 `redact()` 를 지나간다.

import { mkdir, writeFile } from 'node:fs/promises';
import { redact, pick, probe, sayRow, verdictOf, MEAN } from './probe-lib.mjs';

const OUT = 'data/_api';
await mkdir(OUT, { recursive: true });

const log = [];
const P = (s = '') => { log.push(s); console.log(s); };

/* 값이 왔다 = 행(row) 배열에 한 줄 이상 */
const VALUE = /"row"\s*:\s*\[\s*\{/;
/* 시험용 서비스 둘 — 용도가 정해지면 그 서비스로 바꾼다 */
const SERVICES = [
  ['RegionMnyFacltStus', '경기지역화폐 가맹점 현황'],
  ['Genrestrtlist', '일반음식점 현황'],
];

P('# `GG_DATADREAM_OPENDATA` 가 먹는가 — 실측 진단');
P('');
P(`조회일 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)} (KST) · 경기데이터드림 openapi.gg.go.kr`);
P('');

const key = pick(['GG_DATADREAM_OPENDATA', 'GG_DataDream_OpenData']);
if (!key) {
  P('> **판정 2** — 열쇠가 없다. 넣으시면 그날 잰다');
  await writeFile(`${OUT}/gg-probe.md`, ['> 판정 2 — 열쇠가 없다', ''].concat(log).join('\n'));
  console.error('판정 2 — 열쇠가 없다 — 넣으시면 그날 잰다');
  process.exit(2);
}
P(`- 열쇠 **\`${key.name}\`** 로 읽었다 (길이 ${key.value.length}자 · 값은 안 적는다)`);
P('');

const rows = [];
for (const [svc, label] of SERVICES) {
  const url = `https://openapi.gg.go.kr/${svc}?KEY=${encodeURIComponent(key.value)}&Type=json&pIndex=1&pSize=1`;
  const r = await probe(`${label} ${svc} (시험용)`, url, {}, VALUE, null);
  const code = ((r.head || '').match(/"CODE"\s*:\s*"([A-Z]+-\d+)"/) || [])[1] || null;
  if (code === 'ERROR-290') r.authFail = true; // 인증키 문제 — 상태코드는 200 으로 온다
  r.resultCode = code;
  sayRow(P, r, '행(row)');
  P(`  - 결과 코드: ${code ? '`' + code + '`' : '**못 읽었다** (앞 300자 밖이거나 JSON 이 아니다)'}`);
  rows.push(r);
}

const v = verdictOf(rows);
const verdict = v.code === 0
  ? '판정 0 — `GG_DATADREAM_OPENDATA` 가 먹는다. 경기데이터드림 행이 왔다'
  : `판정 ${v.code} — ${MEAN[v.code] || '판정하지 못했다'}`;
log.unshift(`> ${verdict}`, '');
P('');
P(`> **판정 ${v.code}** — ${v.head}`);

await writeFile(`${OUT}/gg-probe.json`, redact(JSON.stringify({ key: key.name, rows }, null, 1)));
await writeFile(`${OUT}/gg-probe.md`, log.join('\n'));
if (v.code !== 0) console.error(verdict.replace(/\*\*/g, ''));
process.exit(v.code);
