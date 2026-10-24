// scripts/edinet-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// `EDINET_API_KEY` 가 먹는가 — 진단 〈2026-10-25 · 사장님 「반영해줘」 · Global M&A Intelligence 작업지침 §9〉
//
// ★★★ 왜 «진단»인가 (CLAUDE.md §4 「진단부터 짠다」). 열쇠는 2026-10-24 에 cron Actions 비밀에 들어왔고,
//   지침은 「EDINET 키 실조회 — 워크플로 없음」을 남은 일로 적었다. 규격을 추측해 배선하지 않고,
//   EDINET API v2 의 서류 목록 창구를 한 번 불러 **무엇이 오는지부터** 본다.
// ★★ 회사 코드 목록은 키 없이 공개라 견주지 않는다 — 이 진단은 **열쇠 하나**가 받아들여지는가만 잰다.
// ★ 값은 한 글자도 안 남긴다 (§2 · 공개 저장소) — 본문·오류 글은 공용 창구의 `redact()` 를 지나간다.
// ★ 날짜는 KST 기준 «어제부터 거꾸로 첫 평일»이다 — 오늘·주말은 서류가 0건이라 「값 없음」이
//   「규격이 틀렸다」와 구분되지 않는다 (§8).

import { mkdir, writeFile } from 'node:fs/promises';
import { redact, pick, probe, sayRow, verdictOf, MEAN } from './probe-lib.mjs';

const OUT = 'data/_api';
await mkdir(OUT, { recursive: true });

const log = [];
const P = (s = '') => { log.push(s); console.log(s); };

const d = new Date(Date.now() + 9 * 3600 * 1000 - 24 * 3600 * 1000); // Asia/Seoul 어제 (§5)
while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() - 1);
const DATE = d.toISOString().slice(0, 10);

/* 서류 목록(type=2)에 서류가 실리면 `docID` 칸이 온다. 메타데이터만 오는 경우는 값으로 세지 않는다 */
const VALUE = /"docID"\s*:/;

P('# `EDINET_API_KEY` 가 먹는가 — 실측 진단');
P('');
P(`조회일 ${new Date().toISOString().slice(0, 10)} · 서류 제출일 ${DATE} (KST 기준 어제부터 첫 평일)`);
P('');

const key = pick(['EDINET_API_KEY']);
if (!key) {
  P('> **판정 2** — 열쇠가 없다. 넣으시면 그날 잰다');
  await writeFile(`${OUT}/edinet-probe.md`, ['> 판정 2 — 열쇠가 없다', ''].concat(log).join('\n'));
  console.error('판정 2 — 열쇠가 없다 — 넣으시면 그날 잰다');
  process.exit(2);
}
P(`- 열쇠 **\`${key.name}\`** 로 읽었다 (길이 ${key.value.length}자 · 값은 안 적는다)`);
P('');

const url = `https://api.edinet-fsa.go.jp/api/v2/documents.json?date=${DATE}&type=2`
  + `&Subscription-Key=${encodeURIComponent(key.value)}`;
const r = await probe('EDINET v2 서류 목록 documents.json', url, {}, VALUE, null);
sayRow(P, r, '서류(docID)');

/* ★ EDINET 은 인증 거부를 HTTP 200 + 본문 `"StatusCode":401` 로 줄 때가 있다 — 본문으로도 잰다 (§4.2) */
if (r.status === 200 && /"StatusCode"\s*:\s*401/.test(r.head || '')) r.authFail = true;

const v = verdictOf([r]);
const verdict = v.code === 0
  ? '판정 0 — `EDINET_API_KEY` 가 먹는다. 서류 목록이 왔다'
  : `판정 ${v.code} — ${MEAN[v.code] || '판정하지 못했다'}`;
log.unshift(`> ${verdict}`, '');
P('');
P(`> **판정 ${v.code}** — ${v.head}`);

await writeFile(`${OUT}/edinet-probe.json`, redact(JSON.stringify({ key: key.name, date: DATE, row: r }, null, 1)));
await writeFile(`${OUT}/edinet-probe.md`, log.join('\n'));
if (v.code !== 0) console.error(verdict.replace(/\*\*/g, ''));
process.exit(v.code);
