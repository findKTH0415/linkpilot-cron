// 여의동 893 — 추가 소싱처 (국가법령정보 · 한국은행) 조회. GitHub Actions 레인 전용.
// 한국부동산원 지가지수는 같은 워크플로에서 scripts/market-jeonju.mjs 가 맡는다.
// 원칙: 키는 환경변수로만. 응답은 가공 전 그대로 저장. 실패는 실패로 적는다(빈 값을 「없음」으로 읽지 않는다).
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
const require = createRequire(import.meta.url);
process.env.IM_AGENT_CACHE = process.env.IM_AGENT_CACHE || path.join(os.tmpdir(), `lp-y893s-${Date.now()}`);
require('../im-agent/core/env').load();
const law = require('../im-agent/connectors/law');
const ecos = require('../im-agent/connectors/ecos');
const OUT = 'data/yeoui893';
await mkdir(OUT, { recursive: true });
const log = []; const P = (s = '') => { log.push(s); console.log(s); };
let got = 0, tried = 0;
P('# 여의동 893 추가 소싱처'); P(`조회일 ${new Date().toISOString().slice(0, 10)}`); P('');

// ── 1. 국가법령정보 — 보고서가 인용한 조문 원문 ──
P('## 1. 국가법령정보');
const WANT = [
  ['지방세법', [106, 111]],
  ['지방세법 시행령', [102]],
  ['국토의 계획 및 이용에 관한 법률 시행령', [84, 85]],
];
const lawOut = [];
if (!law.isAvailable()) { P('- 키 없음(LAW_OC / LAW_OPEN_DATA) — 미실행'); }
else for (const [name, jos] of WANT) {
  tried++;
  const f = await law.findLaw(name);
  if (!f.ok) { P(`- ${name}: 찾지 못함 — ${f.error}`); continue; }
  const hit = f.value.find(x => x.name === name) || f.value[0];
  P(`- ${hit.name} (시행 ${hit.enforcedAt || '미상'})`); got++;
  for (const jo of jos) {
    tried++;
    const a = await law.article({ mst: hit.mst, jo });
    if (a.ok) { got++; lawOut.push({ law: hit.name, enforcedAt: hit.enforcedAt, jo, title: a.value.title, text: a.value.text, raw: a.value.raw }); P(`  - 제${jo}조 ${a.value.title || ''} 받음`); }
    else P(`  - 제${jo}조 실패 — ${a.error}`);
  }
}
await writeFile(`${OUT}/law.json`, JSON.stringify(lawOut, null, 1));
P('');

// ── 2. 한국은행 — 시장금리(대출 조건 참고) ──
P('## 2. 한국은행 시장금리');
const rates = {};
for (const sid of ['cd91', 'ktb3']) {
  tried++;
  const r = await ecos.marketRate(sid, 21);
  if (r.ok) { got++; rates[sid] = r.value; P(`- ${sid}: ${JSON.stringify(r.value).slice(0, 160)}`); }
  else P(`- ${sid}: 실패 — ${r.error}`);
}
await writeFile(`${OUT}/ecos.json`, JSON.stringify(rates, null, 1));
P(''); P(`판정 ${got}/${tried}`);

// ★★★ 판정을 **요약 맨 앞**으로 올린다 〈2026-09-19 · D-225 · §12-24 · §6-3 ①〉.
//   맨 끝에 적으면 아무도 안 본다 — 브이월드에서 실제로 그랬다.
//   ★ 되돌아오는 값(0·1·2)은 앞 판 그대로다. 바뀐 것은 **어디에 적는가**와
//     **워크플로가 그것을 버리지 않는가**(그쪽의 continue-on-error)다.
const verdict = got === tried
  ? `판정 0 — ${tried} 가지를 **전부** 받았다`
  : got
    ? `판정 1 — ${tried} 가지 중 **${got} 개만** 받았다. 아래에서 어느 것이 실패했는지 본다`
    : `판정 2 — **한 가지도 못 받았다** (${tried} 가지). 열쇠(LAW_OC · ECOS_API_KEY)·`
      + '활용 승인·그쪽 서버 중 하나다 — 아래 사유를 본다';
log.unshift(`> ${verdict}`, '');

await writeFile(`${OUT}/_sources.md`, log.join('\n'));
// ★ 사람이 읽는 판정은 stderr 로도 낸다 — 요약이 stdout 만 받아 가는 자리가 있다 (§12-19)
if (got !== tried) console.error(verdict.replace(/\*\*/g, ''));
process.exit(got === tried ? 0 : (got ? 1 : 2));
