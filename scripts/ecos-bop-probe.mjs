// scripts/ecos-bop-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// 한국은행 «국제수지» 통계가 ECOS 열쇠로 오는가 — 실측 진단 〈2026-10-10 · D-435〉
//
// ★★★ 통계표 코드를 «외워서» 박지 않는다 (CLAUDE.md §4.3). ECOS 의 통계표 목록
//   (StatisticTableList)을 받아 이름에 「국제수지」가 든 표를 찾고, 그 표의 항목 목록
//   (StatisticItemList)에서 첫 항목을 골라 최근 값(StatisticSearch)을 부른다.
//   틀린 코드를 박으면 증상이 「열쇠가 틀렸다」와 구분되지 않는다.
// ★ 열쇠는 ECOS 와 같다(ECOS_API_KEY · ECOS_BOK_KEY) — 이름 둘 다 읽는다.
// ★★ 값은 한 글자도 안 남긴다 (§2 · 공개 저장소) — 주소에 열쇠가 실리므로 오류 글까지 redact 를 지난다.

import { mkdir, writeFile } from 'node:fs/promises';
import { redact, pick, probe, sayRow, verdictOf, MEAN } from './probe-lib.mjs';

const OUT = 'data/_api';
await mkdir(OUT, { recursive: true });
const log = [];
const P = (s = '') => { log.push(s); console.log(s); };
const BASE = 'https://ecos.bok.or.kr/api';

P('# 한국은행 국제수지 — 실측 진단');
P('');
P(`조회일 ${new Date().toISOString().slice(0, 10)}`);
P('');
P('> 통계표 코드를 외워서 박지 않는다 — 통계표 목록에서 찾고 그 표를 부른다 (CLAUDE.md §4.3).');
P('');

const key = pick(['ECOS_API_KEY', 'ECOS_BOK_KEY']);
const out = (code, verdict, extra) => ({ code, verdict, extra: extra || {} });
/* 목록 받기 — 본문을 직접 읽어야 하므로 probe() 대신 쓴다. 오류 글은 가린다 */
async function getJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (_) {}
    return { status: r.status, j, head: redact(t.replace(/\s+/g, ' ').slice(0, 200)) };
  } catch (e) { return { status: null, j: null, transport: redact(String((e && e.message) || e)) }; }
}

async function run() {
  if (!key) return out(2, '판정 2 — 열쇠가 없다 — ECOS 열쇠를 넣으시면 그날 잰다');
  P(`- 열쇠 **\`${key.name}\`** 로 읽었다 (길이 ${key.value.length}자 · 값은 안 적는다)`);
  P('');
P('## 1. 통계표 목록에서 «국제수지» 찾기');
const list = await getJson(`${BASE}/StatisticTableList/${encodeURIComponent(key.value)}/json/kr/1/2000`);
if (list.status == null) { P(`- **못 닿음** (${list.transport})`); return out(3, `판정 3 — ${MEAN[3]}`); }
const rows = (list.j && list.j.StatisticTableList && list.j.StatisticTableList.row) || [];
if (!rows.length) {
  P(`- HTTP ${list.status} · 목록이 비었다 — 본문 «${list.head}»`);
  const auth = /인증|INFO-100|INFO-200|키/.test(list.head || '');
  return out(auth ? 4 : 5, `판정 ${auth ? 4 : 5} — ${MEAN[auth ? 4 : 5]} (통계표 목록)`);
}
const bop = rows.filter((r) => /국제수지/.test(String(r.STAT_NAME || '')) && String(r.SRCH_YN || 'Y') === 'Y');
P(`- 통계표 ${rows.length}개 중 이름에 「국제수지」가 든 표 ${bop.length}개`);
for (const r of bop.slice(0, 8)) P(`  - \`${r.STAT_CODE}\` ${r.STAT_NAME} · 주기 ${r.CYCLE || '-'}`);
if (!bop.length) return out(5, `판정 5 — ${MEAN[5]} (「국제수지」 표를 못 찾았다 — 이름이 다를 수 있다)`);
P('');

const pickT = bop.find((r) => /M/.test(String(r.CYCLE || ''))) || bop[0];
P(`## 2. \`${pickT.STAT_CODE}\` ${pickT.STAT_NAME} 의 항목`);
const items = await getJson(`${BASE}/StatisticItemList/${encodeURIComponent(key.value)}/json/kr/1/100/${pickT.STAT_CODE}`);
const it = ((items.j && items.j.StatisticItemList && items.j.StatisticItemList.row) || []);
P(`- 항목 ${it.length}개${it[0] ? ` · 첫 항목 \`${it[0].ITEM_CODE}\` ${it[0].ITEM_NAME} · 주기 ${it[0].CYCLE}` : ''}`);
if (!it.length) return out(5, `판정 5 — ${MEAN[5]} (항목 목록이 비었다)`);
P('');

const cyc = String(it[0].CYCLE || pickT.CYCLE || 'M').slice(0, 1);
const now = new Date(Date.now() + 9 * 3600e3);
const y = now.getUTCFullYear();
const ym = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const span = cyc === 'M' ? [ym(new Date(Date.UTC(y - 1, now.getUTCMonth(), 1))), ym(now)]
  : cyc === 'Q' ? [`${y - 2}Q1`, `${y}Q4`] : [`${y - 3}`, `${y}`];
P(`## 3. 최근 값 (\`${cyc}\` · ${span[0]} ~ ${span[1]})`);
const r = await probe('StatisticSearch',
  `${BASE}/StatisticSearch/${encodeURIComponent(key.value)}/json/kr/1/24/${pickT.STAT_CODE}/${cyc}/${span[0]}/${span[1]}/${it[0].ITEM_CODE}`,
  {}, /"DATA_VALUE"/, /^(TIME|DATA_VALUE)$/);
sayRow(P, r, '값(DATA_VALUE)');
const v = verdictOf([r]);
return out(v.code, v.code === 0
  ? `판정 0 — 국제수지(\`${pickT.STAT_CODE}\` ${pickT.STAT_NAME})가 ECOS 열쇠로 온다 — 배선할 수 있다`
  : `판정 ${v.code} — ${MEAN[v.code]}`, { table: pickT.STAT_CODE, item: it[0].ITEM_CODE });
}

const res = await run();
log.unshift(`> ${res.verdict}`, '');
await writeFile(`${OUT}/ecos-bop-probe.md`, log.join('\n'));
await writeFile(`${OUT}/ecos-bop-probe.json`, redact(JSON.stringify(Object.assign({ code: res.code }, res.extra), null, 1)));
console.log(`\n완료 — ${OUT}/ecos-bop-probe.md`);
// ★ 사람이 읽는 판정은 stderr 로도 낸다 — 요약이 stdout 만 받아 가는 자리가 있다 (§12-19)
if (res.code !== 0) console.error(res.verdict.replace(/\*\*/g, ''));
process.exit(res.code);
