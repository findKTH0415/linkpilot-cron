// scripts/fsc-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// `FSC_API` — 금융위원회 금융통계(종합금융회사 · 국내은행) 진단 〈2026-09-27 · D-357〉
//
// ★★★ **주소를 추측하지 않는다 — 공공데이터포털 안내 페이지에서 읽는다** (§4.3).
//   사장님이 「금융위원회_금융통계종합금융회사정보」(15061312) 활용신청 화면과 함께
//   `FSC_API` 를 넣으셨다. 그런데 그 서비스의 **요청 주소·오퍼레이션 이름**을 이 자리에서는
//   못 읽는다 — `www.data.go.kr` 이 개발 컨테이너의 문지기에 막힌다(실측).
//   그래서 **열쇠가 있는 자리(Actions)에서 그 안내 페이지를 먼저 받아**,
//   거기 적힌 `apis.data.go.kr/1160100/...` 주소를 뽑아 그대로 부른다.
//   ★ R-ONE 은 규격을 추측해서 **여섯 번 다시 썼다.**
//
// ★★ **국내은행 서비스(15061304)도 함께 잰다** — 투자정보 [은행] 탭에 쓸 후보다.
//   신청을 안 하셨으면 **판정 4(인증 거부)** 가 나오고, 그것이 곧 「그 서비스는 신청이
//   필요하다」는 잰 값이다. **승인은 키 단위가 아니라 서비스 단위다** (§4.2 · v1.3 부록 D).
//
// ★ **값은 한 글자도 안 남긴다** (§2 · 이 저장소는 공개다 · D-10) — 공용 창구의
//   `redact()` 를 지나가고, 요약에는 **이름과 길이**만 적는다.

import { mkdir, writeFile } from 'node:fs/promises';
import { redact, pick, probe, sayRow, verdictOf, MEAN } from './probe-lib.mjs';

const OUT = 'data/_api';
await mkdir(OUT, { recursive: true });

const log = [];
const P = (s = '') => { log.push(s); console.log(s); };

/* 재는 서비스 — 이름은 포털에 적힌 그대로다. 주소는 **아래에서 읽는다.** */
/* ★ `FSC_AMC_API` 〈같은 날 · 사장님: 「FSC_AMC_API 키넣었어」〉 — 자산운용사(AMC) 쪽이다.
   서비스 이름을 **아직 못 들었다** — 15139266 은 검색으로 찾은 후보이고, 나머지는 포털 검색
   화면에서 «자산운용» 이 든 제목을 뽑아 함께 건다. 어느 것이 신청된 서비스인지는 판정이 말한다. */
const SERVICES = [
  { key: 'FSC_API', id: '15061312', name: '금융위원회_금융통계종합금융회사정보', use: '종합금융회사 일반·재무·경영지표' },
  /* ★ `FSC_DOMESTIC_BANK_API` 〈2026-09-28 · 사장님: 「FSC_DOMESTIC_BANK_API 키넣었어」 + 상세기능 화면(일반현황·재무현황·주요경영지표·주요영업활동)〉 —
     앞서 `FSC_API`·포털 열쇠로 걸었을 때 「등록되지 않은 서비스키」였다. 이제 그 이름으로 건다 (없으면 포털 열쇠로 대신) */
  { key: 'FSC_DOMESTIC_BANK_API', id: '15061304', name: '금융위원회_금융통계국내은행정보', use: '투자정보 [은행] 탭 후보' },
  /* ★ `FSC_IAF_API` 〈같은 날 · 사장님: 「FSC_IAF_API 키 넣었어」 + 설명 화면〉 — 투자자문사(오퍼레이션 둘: 일반현황 · 재무현황) */
  { key: 'FSC_IAF_API', id: '15061358', name: '금융위원회_금융통계투자자문사정보', use: '투자자문사 일반·재무현황' },
  /* ★ `FSC_KOFIA_API` 〈같은 날 · 사장님: 「FSC_KOFIA_API 키넣었어」 + 상세기능 화면(신탁규모·펀드순자산·CMA·신용공여·증시자금·DLS/DLB)〉 */
  { key: 'FSC_KOFIA_API', id: '15094809', name: '금융위원회_금융투자협회종합통계정보', use: '펀드순자산·증시자금·신용공여 추이' },
  /* ★ `MSS_SME_SPA_API` — 투자정보 [정책자금] 탭 후보. 검색으로 찾은 번호 둘을 함께 건다 — 어느 쪽이 신청된 것인지는 판정이 말한다 */
  { key: 'MSS_SME_SPA_API', id: '15113297', name: '중소벤처기업부_사업공고', use: '[정책자금] 후보 — 중기부 사업공고' },
  { key: 'MSS_SME_SPA_API', id: '15113191', name: '중소기업기술정보진흥원_중소벤처24 공고정보', use: '[정책자금] 후보 — 중소벤처24 공고' },
  { key: 'FSC_AMC_API', id: '15139266', name: '금융위원회_자산운용사 영업활동통계정보', use: '자산운용사 — 후보(검색으로 찾음)' },
];
/* 서비스 번호를 모르는 것은 **포털 검색 화면**에서 찾는다 — 번호를 지어내지 않는다.
   ★ `SME_SUPPORT` 〈같은 날 · 사장님: 「중소벤처기업부_중소기업 지원사업 공고 — API 키넣었어」〉 — 투자정보 [정책자금] 탭 후보.
     열쇠 이름은 `MSS_SME_SPA_API` 〈같은 날 사장님이 알려 주셨다〉. */
const SEARCHES = [
  { key: 'FSC_AMC_API', keyword: '금융위원회 자산운용', word: '자산운용', use: '자산운용사 — 포털 검색에서 찾음' },
  { key: 'MSS_SME_SPA_API', keyword: '중소벤처기업부 중소기업 지원사업 공고', word: '지원사업', use: '투자정보 [정책자금] 탭 후보 — 포털 검색에서 찾음' },
  /* ★ 〈2026-09-28 · 사장님: 「FSC_SAVINGS_BANK_API · FSC_CREDIT_UNION_BANK_API · FSC__Agricultural_Cooperative_Bank_API 키넣었어」
     + 상세기능 화면 셋(각 일반현황·재무현황·주요경영지표)〉 — 서비스 번호를 못 들었으므로 **포털 검색에서 찾는다** (번호를 지어내지 않는다).
     ★ 농협 열쇠 이름은 **밑줄이 둘**(FSC__)이다 — 넣으신 글자 그대로 읽는다. GitHub 비밀 이름은 대문자로 저장된다. */
  { key: 'FSC_SAVINGS_BANK_API', keyword: '금융위원회 금융통계 저축은행', word: '저축은행', use: '저축은행 일반·재무·주요경영지표' },
  { key: 'FSC_CREDIT_UNION_BANK_API', keyword: '금융위원회 금융통계 신용협동조합', word: '신용협동조합', use: '신용협동조합 일반·재무·주요경영지표' },
  { key: 'FSC__AGRICULTURAL_COOPERATIVE_BANK_API', keyword: '금융위원회 금융통계 농업협동조합', word: '농업협동조합', use: '농업협동조합 일반·재무·주요경영지표' },
  /* ★ 〈같은 날 · 사장님: 「FSC_Fisheries_Cooperative_Bank_API 키 넣었어」 + 상세기능 화면(수산업협동조합 일반·재무·주요경영지표)〉 */
  { key: 'FSC_FISHERIES_COOPERATIVE_BANK_API', keyword: '금융위원회 금융통계 수산업협동조합', word: '수산업협동조합', use: '수산업협동조합 일반·재무·주요경영지표' },
  /* ★ 〈2026-09-28 · 사장님: 「FSC_SP_FIN 개인사업자금융정보 키넣었어」 + 상세기능 화면(getGrnBalInfo 보증잔액 · getDpstLoanInfo 예금대출)〉 —
     서비스 번호를 못 들었으므로 포털 검색에서 찾는다. 오퍼레이션이 basYm 말고 다른 인자를 요구하면 판정 5 로 나오고 그 본문으로 규격을 고친다 (§4.3) */
  { key: 'FSC_SP_FIN', keyword: '개인사업자금융정보', word: '개인사업자', use: '개인사업자 보증잔액·예금대출 — 투자정보 [정책자금]·[은행] 후보' },
  /* ★ 〈같은 날 · 사장님 목록: 「금융위원회_기금대출정보(FSC_API)」·「한국국제협력단_사업정보(분야,국가)조회(KOICA_PROJ_SC)」〉 —
     둘 다 이 진단에 없던 서비스다. 번호를 못 들었으므로 포털 검색에서 찾는다 (번호를 지어내지 않는다) */
  { key: 'FSC_API', keyword: '금융위원회 기금대출정보', word: '기금대출', use: '기금대출정보 — 투자정보 [정책자금] 후보' },
  { key: 'KOICA_PROJ_SC', keyword: '한국국제협력단 사업정보', word: '사업정보', use: 'KOICA 사업정보(분야·국가) — 해외 프로젝트 후보' },
];
const searchUrl = (kw) => 'https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=' + encodeURIComponent(kw);

/* 값이 실렸는가 — 포털 1160100 계열은 `totalCount` 를 준다. 0 이면 «대답은 왔는데 비었다» */
const HAS_ITEMS = /"totalCount"\s*:\s*"?[1-9]|<totalCount>[1-9]/;

/* 안내 페이지에서 **요청 주소**와 **오퍼레이션 이름**을 뽑는다.
   ★ 페이지 모양이 바뀌어도 되게 두 갈래로 찾는다 — 통째 주소 · 스웨거 경로(`"/getX"`).
   ★★ 못 뽑으면 **빈 목록**을 돌려준다 — 「주소가 없다」가 아니라 「못 읽었다」다 (§8). */
export function discover(html) {
  const flat = String(html || '');
  const bases = new Set();
  const full = new Set();
  /* 기관 번호(1160100)를 박지 않는다 — 같은 부처라도 서비스마다 다를 수 있다 */
  for (const m of flat.matchAll(/apis\.data\.go\.kr\/(\d{5,8}\/(?:service\/)?[A-Za-z0-9_]+)(?:\/(get[A-Za-z0-9_]+))?/g)) {
    bases.add(m[1]);
    if (m[2]) full.add(`${m[1]}/${m[2]}`);
  }
  const ops = new Set();
  for (const m of flat.matchAll(/["'\/](get[A-Z][A-Za-z0-9_]{2,60})["'?\/]/g)) ops.add(m[1]);
  /* ★ 스웨거 «paths» 의 열쇠도 줍는다 — get 으로 시작하지 않는 오퍼레이션이 있다(실측: 1421000/bizinfo) */
  const pi = flat.indexOf('"paths"');
  if (pi >= 0) for (const m of flat.slice(pi, pi + 20000).matchAll(/"\/([A-Za-z][A-Za-z0-9_]{2,60})"\s*:/g)) ops.add(m[1]);
  for (const o of [...ops]) if (/_response$/.test(o)) ops.delete(o);
  return { bases: [...bases], full: [...full], ops: [...ops] };
}

/* 포털 검색 화면에서 «자산운용» 이 든 오픈API 목록(번호 · 제목)을 뽑는다 */
export function searchHits(html, word) {
  const src = String(html || '');
  const hits = [];
  for (const m of src.matchAll(/\/data\/(\d{6,9})\/openapi\.do[^>]*>([^<]{2,80})</g)) {
    const t = m[2].replace(/\s+/g, ' ').trim();
    if (t.includes(word) && !hits.some((h) => h.id === m[1])) hits.push({ id: m[1], name: t });
  }
  /* ★ 목록 모양이 달라 위에서 못 뽑으면 — 낱말 바로 앞 800자 안의 서비스 번호를 줍는다 */
  if (!hits.length) {
    let i = src.indexOf(word);
    while (i >= 0 && hits.length < 4) {
      const back = src.slice(Math.max(0, i - 800), i);
      const ids = [...back.matchAll(/(?:\/data\/|publicDataPk=)(\d{6,9})/g)];
      const id = ids.length ? ids[ids.length - 1][1] : null;
      const name = src.slice(i, i + 80).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
      if (id && !hits.some((h) => h.id === id)) hits.push({ id, name });
      i = src.indexOf(word, i + word.length);
    }
  }
  return hits.slice(0, 4);
}

/* 응답의 첫 항목에서 **칸 이름만** 뽑는다 — 값은 안 담는다 (배선은 칸 이름으로 한다) */
function itemKeys(body) {
  try {
    const j = JSON.parse(body);
    const bd = j && j.response && j.response.body;
    let it = bd && bd.items;
    /* ★ D-363 — 은행 계열(국내은행·저축은행·신협·농협·수협)은 «표 목록» 모양이다:
       body.tableList[].items.item. 앞 판은 body.items 만 봐서 칸 이름을 못 뽑았다.
       표 쪽 칸 이름은 «표.» 를 붙여 따로 적는다 — 두 층이 섞이면 배선할 때 헷갈린다. */
    let head = [];
    if (!it && bd && Array.isArray(bd.tableList) && bd.tableList.length) {
      const tb = bd.tableList[0] || {};
      head = Object.keys(tb).filter((k) => k !== 'items').map((k) => '표.' + k);
      head.unshift(`표목록(${bd.tableList.length})`);
      it = tb.items;
    }
    it = it && (it.item || it);
    if (Array.isArray(it)) it = it[0];
    const ks = it && typeof it === 'object' ? Object.keys(it) : [];
    return head.length || ks.length ? head.concat(ks).slice(0, 48) : null;
  } catch (_) { return null; }
}

/* 기준 연월 — 금융통계는 분기·월 단위라 **작년 12월**을 기본으로 한다(공표가 끝난 달) */
const Y = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear() - 1;
const BAS_YM = `${Y}12`;

async function main() {
  P('# `FSC_API` — 금융위원회 금융통계 실측 진단');
  P('');
  P(`조회일 ${new Date().toISOString().slice(0, 10)} · 기준연월 ${BAS_YM}`);
  P('');
  P('> 주소를 추측하지 않는다 — **포털 안내 페이지에서 읽고** 그대로 부른다 (CLAUDE.md §4.3).');
  P('');

  const results = { keys: {}, services: [] };
  /* ★ 포털 열쇠와 «같은 값»인지만 적는다 — 값·길이 차이는 안 적는다 (§2) */
  /* ★ `PERSONAL_API_KEY` 〈같은 날 · 사장님: 「PERSONAL_API_KEY 넣었어 — 정부공공데이터 여기에 모두 다 있어」〉 —
     포털 «개인 인증키»다. 그 이름이 있으면 그것을 먼저 쓰고, 기존 포털 열쇠와 같은 값인지만 적는다(값은 안 적는다). */
  const portal = pick(['PERSONAL_API_KEY', 'DATA_GO_KR_KEY', 'APIS_DATA', 'SPECIAL_DAY_INFO']);
  const oldPortal = pick(['DATA_GO_KR_KEY', 'APIS_DATA', 'SPECIAL_DAY_INFO']);
  if (portal && portal.name === 'PERSONAL_API_KEY') P(`- 포털 개인 인증키 \`PERSONAL_API_KEY\` 읽었다 (길이 ${portal.value.length}자) · 기존 \`${oldPortal ? oldPortal.name : '없음'}\` 과 ${oldPortal ? (oldPortal.value === portal.value ? '**같은 값**' : '**다른 값**') : '견줄 것이 없다'}`);
  else P('- 포털 개인 인증키 `PERSONAL_API_KEY` — **이 저장소의 Actions 비밀에 없다**');
  const KEYS = {};
  const OWN = [];
  /* ★★ 넣으신 이름이 이 자리에 없으면 **포털 계정 열쇠**로 건다 〈2026-09-27 실측: 세 이름이 이 저장소의
     Actions 비밀에 없었다 — 빈칸으로 찍혔다〉. 포털 인증키는 계정당 하나이고 **승인만 서비스별**이라(§4.2)
     그 서비스를 신청하셨으면 같은 열쇠로 통한다. 어느 이름으로 걸었는지는 반드시 적는다 — 섞어 읽으면
     「어느 열쇠가 통했는가」가 흐려진다. */
  for (const n of ['FSC_API', 'FSC_AMC_API', 'FSC_IAF_API', 'FSC_KOFIA_API', 'FSC_DOMESTIC_BANK_API', 'FSC_SAVINGS_BANK_API', 'FSC_CREDIT_UNION_BANK_API', 'FSC__AGRICULTURAL_COOPERATIVE_BANK_API', 'FSC_FISHERIES_COOPERATIVE_BANK_API', 'FSC_SP_FIN', 'KOICA_PROJ_SC', 'MSS_SME_SPA_API']) {
    const own = pick([n]);
    if (own) OWN.push(own);
    const k = own || portal;
    KEYS[n] = k;
    results.keys[n] = own ? own.value.length : null;
    if (own) P(`- 열쇠 **\`${n}\`** 읽었다 (길이 ${own.value.length}자 · 값은 안 적는다) · 포털 열쇠와 ${portal ? (portal.value === own.value ? '**같은 값**' : '**다른 값**') : '견줄 것이 없다'}`);
    else P(`- 열쇠 **\`${n}\`** — **이 저장소의 Actions 비밀에 없다** → ${portal ? `포털 계정 열쇠 \`${portal.name}\` 로 대신 건다` : '대신 걸 포털 열쇠도 없다'}`);
  }
  /* ★ 세 이름이 «같은 값»인지만 적는다 — 포털 인증키는 계정당 하나라 같을 수 있다. 값은 안 적는다 (§2) */
  const have = OWN;
  if (have.length > 1) P(`- 들어온 열쇠 ${have.length}개가 ${new Set(have.map((k) => k.value)).size === 1 ? '**모두 같은 값**' : '**서로 다른 값이 섞였다**'}`);
  P('');

  /* 자산운용 후보를 포털 검색으로 더한다 — 못 읽으면 적힌 후보만 건다 */
  for (const q of SEARCHES) {
    try {
      const r = await fetch(searchUrl(q.keyword), { signal: AbortSignal.timeout(15000) });
      const sh = await r.text();
      const hits = searchHits(sh, q.word);
      P(`- 포털 검색 «${q.keyword}» — HTTP ${r.status} · ${sh.length}자 · ${hits.length ? hits.map((h) => `${h.id} ${h.name}`).join(' · ') : '**못 뽑았다**'}`);
      /* 못 뽑았으면 그 낱말 둘레를 조금 남긴다 — 다음에 뽑는 법을 고칠 재료다(공개 목록이라 비밀이 없다) */
      if (!hits.length) { const i = sh.indexOf(q.word); P(`  - 둘레 «${i < 0 ? '(낱말이 페이지에 없다)' : redact(sh.slice(Math.max(0, i - 200), i + 60).replace(/\s+/g, ' '))}»`); }
      for (const h of hits) if (!SERVICES.some((x) => x.id === h.id)) SERVICES.push({ key: q.key, id: h.id, name: h.name, use: q.use });
    } catch (e) { P(`- 포털 검색 «${q.keyword}» — **못 닿음** (${redact(String((e && e.message) || e))})`); }
  }
  P('');

  const codes = [];
  for (const svc of SERVICES.slice(0, 32)) {
    P(`## ${svc.name} (${svc.id}) — ${svc.use} · 열쇠 \`${svc.key}\``);
    P('');
    const key = KEYS[svc.key];
    if (key) P(`- 건 열쇠: \`${key.name}\``);
    if (!key) { P('> **판정 2** — 열쇠가 없다'); P(''); codes.push(2); results.services.push({ id: svc.id, code: 2 }); continue; }
    let decoded = key.value;
    try { decoded = decodeURIComponent(key.value); } catch (_) { decoded = key.value; }
    const page = await probe('포털 안내 페이지', `https://www.data.go.kr/data/${svc.id}/openapi.do`, {}, null, null);
    let html = '';
    try {
      const r = await fetch(`https://www.data.go.kr/data/${svc.id}/openapi.do`, { signal: AbortSignal.timeout(15000) });
      html = await r.text();
    } catch (_) { html = ''; }
    const d = discover(html);
    P(`- 안내 페이지 — ${page.status == null ? `**못 닿음** (${page.transport})` : `HTTP ${page.status}`} · ${page.ms}ms`);
    P(`  - 뽑은 서비스 ${d.bases.length ? d.bases.map((b) => `\`${b}\``).join(' · ') : '**없음(못 읽었다)**'}`);
    P(`  - 뽑은 오퍼레이션 ${d.ops.length ? d.ops.map((o) => `\`${o}\``).join(' · ') : '**없음(못 읽었다)**'}`);
    const rows = [];
    /* 부를 것 — 통째 주소가 있으면 그것, 없으면 서비스 × 오퍼레이션 */
    /* 통째 주소가 먼저, 그다음 서비스 × 오퍼레이션 — 페이지가 둘을 따로 적는 수가 있다 */
    let targets = d.full.slice();
    for (const b of d.bases) for (const o of d.ops) targets.push(`${b}/${o}`);
    targets = [...new Set(targets)].slice(0, 6);
    /* 뿌리는 읽었는데 오퍼레이션을 못 뽑았으면 뿌리 자체도 한 번 건다 — 뿌리가 곧 창구인 서비스가 있다 */
    if (!targets.length) for (const b of d.bases) targets.push(b);
    if (!targets.length || !d.ops.length) {
      if (!targets.length) P('  - ★ 부를 주소를 **못 읽었다** — 페이지 모양이 다르거나 막혔다. **열쇠 문제가 아니다**');
      /* 다음에 뽑는 법을 고칠 재료 — 공개 안내 페이지라 비밀이 없다. 요청주소 둘레 200자만 */
      const at = ['apis.data.go.kr', '요청주소', 'End Point', 'swagger'].map((w) => html.indexOf(w)).filter((i) => i >= 0)[0];
      P(`  - 둘레 «${at == null ? '(요청주소 낱말이 페이지에 없다)' : redact(html.slice(Math.max(0, at - 80), at + 220).replace(/\s+/g, ' '))}»`);
    }
    for (const t of targets) {
      for (const [how, k] of [['원본', key.value], ['디코딩', decoded]]) {
        if (how === '디코딩' && k === key.value) continue;
        /* ★ 대답은 왔는데 그 기준월이 비었으면(종금사 202512 = 0건 · 실측) 앞 기준월로 두 번 더 건다.
           «비었다»를 「규격이 틀렸다」로 적지 않으려는 것이다 — 공표 전인 달일 수 있다 (§4 의 셋째 갈래). */
        let url = '', r = null;
        for (const ym of [BAS_YM, `${Y}06`, `${Y - 1}12`]) {
          url = `https://apis.data.go.kr/${t}?serviceKey=${encodeURIComponent(k)}`
            + `&pageNo=1&numOfRows=3&resultType=json&basYm=${ym}`;
          r = await probe(`${t} · ${how} · ${ym}`, url, {}, HAS_ITEMS, null);
          if (r.gotValue || r.status == null || r.authFail || !/"resultCode"\s*:\s*"00"/.test(r.head || '')) break;
        }
        rows.push(r);
        sayRow(P, r, '항목(totalCount>0)');
        if (r.gotValue) {
          try {
            const body = await (await fetch(url, { signal: AbortSignal.timeout(15000) })).text();
            const ks = itemKeys(body);
            if (ks) P(`  - 칸 이름 ${ks.map((x) => `\`${redact(x)}\``).join(' ')}`);
          } catch (_) { /* 칸 이름은 덤이다 — 못 받아도 판정은 그대로다 */ }
        }
        if (r.gotValue || (r.status != null && !r.authFail)) break; // 원본이 대답했으면 디코딩은 안 건다
      }
    }
    /* 부를 주소를 못 읽었으면 «못 쟀다(3)» — 기관에 안 닿았다 */
    const v = targets.length ? verdictOf(rows) : { code: 3, head: '**부를 주소를 못 읽었다** — 안내 페이지를 못 받았거나 모양이 다르다. 열쇠 문제가 아니다' };
    codes.push(v.code);
    results.services.push({ id: svc.id, bases: d.bases, ops: d.ops, code: v.code,
      rows: rows.map((r) => ({ label: r.label, status: r.status, gotValue: r.gotValue, authFail: r.authFail, head: r.head })) });
    P('');
    P(`> **판정 ${v.code}** — ${v.head}`);
    P('');
  }

  await writeFile(`${OUT}/fsc-probe.json`, redact(JSON.stringify(results, null, 1)));
  /* 되돌아오는 값은 **나쁜 쪽** — 두 서비스를 다 쓰려는 것이라 하나라도 막히면 할 일이 남는다 */
  const code = Math.max(...codes);
  const verdict = `판정 ${code} — ${MEAN[code] || '판정하지 못했다'} (`
    + results.services.map((x, i) => `${SERVICES[i].name.replace('금융위원회_', '')} ${x.code}`).join(' · ') + ')';
  log.unshift(`> ${verdict}`, '');
  await writeFile(`${OUT}/fsc-probe.md`, log.join('\n'));
  console.log(`\n완료 — ${OUT}/fsc-probe.md`);
  if (code !== 0) console.error(verdict.replace(/\*\*/g, ''));
  return code;
}

/* ★ 가져다 쓰는 쪽(검사)이 부를 때는 안 돈다 */
if (process.argv[1] && process.argv[1].endsWith('fsc-probe.mjs')) {
  const code = await main();
  process.exit(code);
}
