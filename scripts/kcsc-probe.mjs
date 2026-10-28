// scripts/kcsc-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// 국가건설기준센터(KCSC) 건설기준 목록이 열쇠로 오는가 — 실측 진단 〈2026-10-22 · 사장님 「권하는 개선안 대로 진행해」〉
//
// ★ 앞 판은 공공데이터포털에서 «국가건설기준»을 찾았는데 0건이었다(미측정). KCSC 는 포털 밖 창구다.
//   주소·인자는 «지어내지 않고» 사장님 지침서 docs/운영지침-공공API-활용.md 4-A 표 그대로 쓴다:
//   목록 `https://kcsc.re.kr/OpenApi/CodeList` · 인자 `Type`(KDS/KCS) · `Code`(예 101000) · `Key`.
// ★ 지침서가 «요청변수표는 Key, 예시 URL 은 key=» 로 엇갈린다고 적었다 — 둘 다 불러 대소문자를 확정한다.
// ★★ 열쇠가 주소에 실린다 — 주소는 적지 않고 경로·상태코드·가린 본문만 적는다 (§2 · 지침서 6-5).

import { mkdir, writeFile } from 'node:fs/promises';
import { redact, pick, probe, sayRow, verdictOf, MEAN } from './probe-lib.mjs';

const OUT = 'data/_api';
await mkdir(OUT, { recursive: true });
const log = [];
const P = (s = '') => { log.push(s); console.log(s); };
const BASE = 'https://kcsc.re.kr/OpenApi';

P('# 국가건설기준센터(KCSC) — 실측 진단');
P('');
P(`조회일 ${new Date().toISOString().slice(0, 10)}`);
P('');
P('> 주소·인자는 지침서 4-A 표 그대로다 — 지어 넣지 않는다 (CLAUDE.md §4.3).');
P('');

async function run() {
  const key = pick(['KICT_API_KEY', 'KCSC_CONSTRUCTION_STANDARDS']);
  if (!key) return { code: 2, verdict: '판정 2 — 열쇠가 없다 — KICT_API_KEY 또는 KCSC_CONSTRUCTION_STANDARDS 를 넣으시면 그날 잰다' };
  P(`- 열쇠 **\`${key.name}\`** 로 읽었다 (길이 ${key.value.length}자 · 값은 안 적는다)`);
  P('');
  const rows = [];
  for (const kn of ['Key', 'key']) {
    for (const type of ['KDS', 'KCS']) {
      const q = new URLSearchParams({ Type: type, Code: '101000' });
      q.set(kn, key.value);
      const r = await probe(`CodeList · Type=${type} · Code=101000 · 열쇠 인자 «${kn}»`, `${BASE}/CodeList?${q}`, {},
        /"(fullCode|codeType|name)"\s*:/, /^(code|fullCode|name|ver)$/);
      sayRow(P, r, '기준 목록');
      rows.push(r);
      if (r.gotValue) break;
    }
    if (rows.some((r) => r.gotValue)) break;
  }
  const v = verdictOf(rows);
  const okRow = rows.find((r) => r.gotValue);
  return { code: v.code, verdict: v.code === 0
    ? `판정 0 — KCSC 건설기준 목록이 온다 (${okRow.label}) — 배선할 수 있다`
    : `판정 ${v.code} — ${MEAN[v.code]}` };
}

const res = await run();
log.unshift(`> ${res.verdict}`, '');
await writeFile(`${OUT}/kcsc-probe.md`, redact(log.join('\n')));
await writeFile(`${OUT}/kcsc-probe.json`, redact(JSON.stringify({ code: res.code }, null, 1)));
console.log(`\n완료 — ${OUT}/kcsc-probe.md`);
// ★ 사람이 읽는 판정은 stderr 로도 낸다 — 요약이 stdout 만 받아 가는 자리가 있다 (§12-19)
if (res.code !== 0) console.error(res.verdict.replace(/\*\*/g, ''));
process.exit(res.code);
