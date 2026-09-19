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

/* ★★★ **커넥터가 갈라 준 것을 «읽어» 적는다** 〈2026-09-19 · D-226 · §12-19〉.
   [무엇이 났나] `law.js` 는 실패를 **승인·OC·없음·형식**(D-226 뒤로는 **못 닿음**까지
     다섯)으로 갈라 `kind`·`head`·`bodyHead`·`headHdr` 로 돌려준다. 그런데 이 스크립트가
     **`error` 한 칸만** 찍고 나머지를 버렸다 — 요약에 남는 글은
     「찾지 못함 — fetch failed (4회 시도 실패)」 하나뿐이었다.
   ★ **나르는 자리는 셋이다**(§12-19): 커넥터가 실어도 여기서 안 읽으면 사라지고,
     읽어도 요약에 안 적으면 또 사라진다. 「만들었다」와 「닿는다」는 다른 사실이다 (§8).
   ★★ **값은 커넥터가 이미 가렸다**(`redact`). 여기서 새로 조립하지 않는다 (§2). */
const kinds = [];
function why(r) {
  /* ★★★ **실패는 «빠짐없이» 센다** — 한 건이라도 안 세면 아래 `fail2()` 가
     「전부 못 닿았다」를 **거짓으로** 말한다. 갈래를 모르면 모른다고 센다 (§8 · §4.7). */
  kinds.push((r && r.kind) || (r && r.unavailable ? 'unavailable' : 'unknown'));
  const bits = [r && r.head ? r.head : String((r && r.error) || '사유 없음')];
  if (r && r.httpStatus != null) bits.push(`HTTP ${r.httpStatus}`);
  if (r && r.bodyHead) bits.push(`본문 «${r.bodyHead}»`);
  if (r && r.headHdr) bits.push(`헤더 ${r.headHdr}`);
  return bits.join(' · ');
}
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
  if (!f.ok) { P(`- ${name}: 찾지 못함 — ${why(f)}`); continue; }
  const hit = f.value.find(x => x.name === name) || f.value[0];
  P(`- ${hit.name} (시행 ${hit.enforcedAt || '미상'})`); got++;
  for (const jo of jos) {
    tried++;
    const a = await law.article({ mst: hit.mst, jo });
    if (a.ok) { got++; lawOut.push({ law: hit.name, enforcedAt: hit.enforcedAt, jo, title: a.value.title, text: a.value.text, raw: a.value.raw }); P(`  - 제${jo}조 ${a.value.title || ''} 받음`); }
    else P(`  - 제${jo}조 실패 — ${why(a)}`);
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
  else P(`- ${sid}: 실패 — ${why(r)}`);
}
await writeFile(`${OUT}/ecos.json`, JSON.stringify(rates, null, 1));
P(''); P(`판정 ${got}/${tried}`);

// ★★★ 판정을 **요약 맨 앞**으로 올린다 〈2026-09-19 · D-225 · §12-24 · §6-3 ①〉.
//   맨 끝에 적으면 아무도 안 본다 — 브이월드에서 실제로 그랬다.
//   ★ 되돌아오는 값(0·1·2)은 앞 판 그대로다. 바뀐 것은 **어디에 적는가**와
//     **워크플로가 그것을 버리지 않는가**(그쪽의 continue-on-error)다.
/* ★★★ **판정 글이 «틀린 곳»을 가리키지 않게 한다** 〈D-226 · §4.6 · §12-24〉.
   앞 판은 한 가지도 못 받으면 무조건 「열쇠·활용 승인·그쪽 서버 중 하나다」라고 적었다.
   그런데 **전부 못 닿은 것**이면 열쇠에는 고칠 것이 **없다** — 그 글을 보시면
   이미 하신 신청을 또 하시게 된다 (M-86). 갈래를 세어 **잰 값으로** 적는다. */
function fail2() {
  const un = kinds.filter(k => k === 'unreachable').length;
  if (kinds.length && un === kinds.length) {
    return '**전부 «못 닿았다»** — 응답이 한 번도 안 왔다. '
      + '**열쇠·활용 승인 문제가 아니다** (다시 넣거나 다시 신청하실 일이 아니다). '
      + '잠시 뒤 다시 걸어 보고, 되풀이되면 국내 자리(NAS)에서 부른다 (§4 · D-206)';
  }
  if (un) return `일부는 **못 닿았고**(${un}건) 나머지는 사유가 다르다 — 갈래별로 아래를 본다`;
  return '열쇠(LAW_OC · ECOS_API_KEY)·활용 승인·그쪽 서버 중 하나다 — 아래 사유를 본다';
}

const verdict = got === tried
  ? `판정 0 — ${tried} 가지를 **전부** 받았다`
  : got
    ? `판정 1 — ${tried} 가지 중 **${got} 개만** 받았다. 아래에서 어느 것이 실패했는지 본다`
    : `판정 2 — **한 가지도 못 받았다** (${tried} 가지). ${fail2()}`;
log.unshift(`> ${verdict}`, '');

await writeFile(`${OUT}/_sources.md`, log.join('\n'));
// ★ 사람이 읽는 판정은 stderr 로도 낸다 — 요약이 stdout 만 받아 가는 자리가 있다 (§12-19)
if (got !== tried) console.error(verdict.replace(/\*\*/g, ''));
process.exit(got === tried ? 0 : (got ? 1 : 2));
