#!/usr/bin/env node
/* 열쇠 «이름»이 이 저장소의 Actions 비밀에 실제로 들어 있는가 — 값은 한 글자도 안 찍는다 (§2)
   〈2026-10-12 사장님: API 목록 49개 · 「입력반영된것과 안된것을 교차검증해줘」〉.
   ★ 이 표는 «사장님이 적어 주신 이름» 그대로다. 「들어 있다」와 «그 서비스가 값을 준다»는 다른 사실이다 —
     뒤엣것은 fsc-probe·price-probe 등 실측 진단이 잰다. 이 표는 앞엣것만 잰다.
   ★ GitHub 비밀 이름은 대문자로 저장된다 — 그래서 대문자로 묻는다. 없으면 «없음»이지 «못 쟀다»가 아니다:
     같은 실행의 다른 비밀(DATA_GO_KR_KEY 등)이 읽히면 워크플로가 비밀을 못 읽는 것이 아니다 (§4.6). */
import fs from 'node:fs';
import path from 'node:path';

export const NAMES = [
  ['국가법령정보', 'KOREA_LAW_INFORMATION'], ['공공데이터포털', 'DATAGOKR_PUBLIC_DATA'], ['한국천문연구원 특일 정보', 'KASI_SPECIAL_DAYS'],
  ['기상청 단기예보', 'KMA_SHORT_TERM_FORECAST'], ['전력거래소 REC 현물시장', 'KPX_REC_SPOT_MARKET'], ['REC 현물시장 거래시장', 'REC_SPOT_MARKET_TRADING'],
  ['중부발전 REC 기준가격', 'KOMIPO_REC_REFERENCE_PRICE'], ['한국전력', 'KEPCO'], ['전력거래소 SMP·수요예측', 'KPX_SMP_DEMAND_FORECAST'],
  ['전력거래소 전력수급예보', 'KPX_POWER_SUPPLY_DEMAND_FORECAST_GW'], ['KOTRA 국가정보', 'KOICA_COUNTRY_INFORMATION'], ['KOTRA 외국인투자 업종별', 'KOTRA_KOREA_FDI_BY_INDUSTRY'], ['경기데이터드림 전체 공공데이터', 'GG_DATADREAM_OPENDATA'], ['EDINET API v2', 'EDINET_API_KEY'], ['한국무역보험공사 국가목록', 'KSURE_COUNTRY_LIST'], ['외교부 국가·지역별 우리나라와의 관계', 'MOFA_RELATIONS_WITH_KOREA_BY_COUNTRY'], ['중소벤처기업부 사업공고', 'MSS_BUSINESS_SUPPORT_ANNOUNCEMENTS'], ['기업은행 영업점 정보', 'IBK_BRANCH_INFORMATION'],
  ['외교부 정치현황', 'KOICA_GLOBAL_POLITICAL_DEVELOPMENTS'], ['부동산원 전국지가변동률', 'REB_LAND_PRICE_CHANGE'], ['국가건설기준센터', 'KCSC_CONSTRUCTION_STANDARDS'],
  ['브이월드', 'VWORLD_SPATIAL_DATA'], ['지가변동률 마이크로데이터', 'REB_LAND_MICRO'], ['아파트 매매 실거래가', 'MOLIT_APT_SALE'],
  ['오피스텔 전월세', 'MOLIT_OFFICETEL_RENT'], ['공공데이터포털 (넷째 이름)', 'DATA_GO_KR'], ['건축물대장', 'MOLIT_HUB_BLDG_LEDGER'], ['주택인허가', 'MOLIT_HUB_HOUSING_PERMIT'],
  ['건축인허가', 'MOLIT_HUB_BLDG_PERMIT'], ['토지이용규제정보', 'MOLIT_LUR_INFO'], ['상업업무용 매매', 'MOLIT_COMM_SALE'],
  ['토지 매매', 'MOLIT_LAND_SALE'], ['토지이용규제 법령정보', 'MOLIT_LUR_LAW_KEY'], ['캠코 체납 압류재산 공매', 'KAMCO_PUBLIC_AUCTION_STATISTICS'],
  ['나라장터 낙찰정보', 'KONEPS_AWARD_INFORMATION'], ['나라장터 입찰공고', 'KONEPS_BID_NOTICE'], ['온비드 부동산 물건상세', 'ONBID_REAL_ESTATE_PROPERTY'],
  ['중기부 지원사업 공고', 'MSS_SME_SPA_API'], ['사업자 진위·상태', 'NTS_BIZ_VERIFY'], ['온비드 입찰결과목록', 'KAMCO_ONBID_BID_RESULT'],
  ['압류재산 공매 낙찰가율', 'KAMCO_SEIZED_AUCTION_RATE'], ['자산운용사 영업활동통계', 'FSC_ASSET_MANAGEMENT_BUSINESS_STATISTICS'], ['기업기본정보', 'FSC_CORP_BASIC'],
  ['종합금융회사', 'FSC_AMC_API'], ['기금대출정보', 'FSC_API'], ['투자자문사', 'FSC_IAF_API'],
  ['금융투자협회 종합통계', 'FSC_KOFIA_API'], ['국내은행', 'FSC_DOMESTIC_BANK_API'], ['저축은행', 'FSC_SAVINGS_BANK_API'],
  ['신용협동조합', 'FSC_CREDIT_UNION_BANK_API'], ['농업협동조합', 'FSC_AGRICULTURAL_COOPERATIVE_BANK_API'], ['수산업협동조합', 'FSC_FISHERIES_COOPERATIVE_BANK_API'],
  ['개인사업자금융정보', 'FSC_SP_FIN'], ['한국은행', 'ECOC_API'], ['한국은행 국제수지', 'ECOC_BOK_BOP_STATISTICS'], ['DART 공시', 'FSS_DART_DISCLOSURE'],
];
/* 같은 실행에서 «읽히는 것이 확인된» 이름 — 이것이 비면 워크플로가 비밀을 못 읽는 것이므로 «못 쟀다»로 끝낸다 (§8) */
export const CONTROL = ['DATA_GO_KR_KEY'];

export function presence(env) {
  return NAMES.map(([label, name]) => { const v = String(env[name] || '').trim(); return { label, name, has: v.length > 0, len: v.length }; });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctl = CONTROL.some((n) => String(process.env[n] || '').trim());
  const rows = presence(process.env);
  const on = rows.filter((r) => r.has).length;
  const log = [];
  const verdict = (ctl ? `> 이름 ${rows.length}개 중 **${on}개 들어 있음 · ${rows.length - on}개 없음** — 값은 안 찍는다 · 길이만` : '> **못 쟀다** — 대조 비밀(DATA_GO_KR_KEY)도 안 읽혔다. 워크플로가 비밀을 못 읽는 상태라 이 표는 «없음»을 말할 수 없다');
  log.push('', '| 이름 | 무엇 | 이 저장소 Actions 비밀 |', '|---|---|---|');
  for (const r of rows) log.push(`| \`${r.name}\` | ${r.label} | ${!ctl ? '못 쟀다' : r.has ? `✅ 있음 (길이 ${r.len})` : '— 없음'} |`);
  log.unshift(verdict); /* 판정은 요약 맨 앞 (§6-3 ①) */
  const out = path.join('data', '_api', 'key-presence.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '# 열쇠 이름 — 들어 있는가\n\n' + log.join('\n') + '\n');
  console.log(log.join('\n'));
  process.exit(ctl ? 0 : 2);
}
