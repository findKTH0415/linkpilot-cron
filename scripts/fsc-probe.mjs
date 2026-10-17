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
/* ★ 판정 1 은 이 진단에만 있다 — 서버가 대답했는데(규격 페이지·411 등) 조회할 값(번호·필수 인자)을 사람이 넣어야 잴 수 있는 경우.
     3(못 닿았다)과 갈라야 요약이 «자리를 옮기라»를 잘못 말하지 않는다. 다른 진단의 MEAN 은 건드리지 않는다 */
const FSC_MEAN = { ...MEAN, 1: '닿았다 — 조회할 값(번호·필수 인자)을 사람이 넣어야 잰다. **열쇠 문제도, 도는 자리 문제도 아니다**' };

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
  /* 15113297 «중소벤처기업부_사업공고» 는 뺐다 〈2026-10-11 · D-442〉 — 같은 열쇠의 15157820 «중소기업 지원사업 공고 조회»가
     이미 값을 준다(판정 0). 신청 안 된 옆 서비스를 «미반영»으로 세면 하실 필요 없는 신청을 하시게 된다 (M-86) */
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
  { key: 'FSC_API', keyword: '기금대출정보', word: '기금대출', use: '기금대출정보 — 투자정보 [정책자금] 후보' },
  { key: 'KOICA_PROJ_SC', keyword: '한국국제협력단 사업정보', word: '사업정보', use: 'KOICA 사업정보(분야·국가) — 해외 프로젝트 후보' },
  /* ★ 〈2026-10-10 · 사장님: 「외교부_국가·지역별 정치현황(KOICA_GLOBAL_POLITICAL_DEVELOPMENTS) · 대한무역투자진흥공사_국가정보(KOICA_COUNTRY_INFORMATION) 키넣었어」 · D-429 · D-430〉 —
     서비스 이름을 받았다. 그 이름 그대로 포털 검색으로 번호를 찾는다(번호를 지어내지 않는다) */
  { key: 'KOICA_GLOBAL_POLITICAL_DEVELOPMENTS', keyword: '외교부 국가·지역별 정치현황', word: '정치현황', use: '외교부 국가·지역별 정치현황 — 해외 프로젝트 국가 리스크 후보' },
  { key: 'KOICA_GLOBAL_POLITICAL_DEVELOPMENTS', keyword: '외교부 정치현황', word: '정치', use: '외교부 국가·지역별 정치현황 — 해외 프로젝트 국가 리스크 후보' },
  { key: 'KOICA_COUNTRY_INFORMATION', keyword: '대한무역투자진흥공사 국가정보', word: '국가정보', use: 'KOTRA 국가정보 — 해외 프로젝트 국가 개황 후보' },
  /* ★ 〈2026-10-17 · 사장님: 「KOTRA_KOREA_FDI_BY_INDUSTRY API 키넣었어」〉 — 이름에서 읽히는 서비스는 KOTRA «외국인투자(FDI) 업종별». 번호를 못 들었으므로 포털 검색에서 찾는다 (번호를 지어내지 않는다) */
  { key: 'KOTRA_KOREA_FDI_BY_INDUSTRY', keyword: '대한무역투자진흥공사 외국인투자 업종별', word: '업종', use: 'KOTRA 외국인직접투자 업종별 현황 — 투자정보 후보' },
  { key: 'KOTRA_KOREA_FDI_BY_INDUSTRY', keyword: '대한무역투자진흥공사 외국인직접투자', word: '외국인', use: 'KOTRA 외국인직접투자 업종별 현황 — 투자정보 후보' },
  /* ★ 〈2026-09-29 · 사장님: 「MOLIT_LUR_LAW_KEY (토지이용규제법령정보서비스) 키넣었어」〉 — 인허가 검토(행위제한·법령) 후보. 번호는 검색에서 찾는다 */
  { key: 'MOLIT_LUR_LAW_KEY', keyword: '토지이용규제법령정보', word: '토지이용규제', use: '토지이용규제 법령정보 — 인허가 검토(행위제한) 후보' },
  /* ★ 〈같은 날 · 첫 검색 둘이 «못 뽑았다»〉 — 이름을 한 겹 넓혀 한 번 더 찾는다. 찾은 번호만 건다 (지어내지 않는다) */
  { key: 'MOLIT_LUR_LAW_KEY', keyword: '토지이용규제', word: '토지이용', use: '토지이용규제 법령정보 — 인허가 검토(행위제한) 후보' },
  /* ★ 〈2026-10-10 · 사장님 목록: 「국가건설기준센터(KCSC)」 · D-435〉 — 열쇠는 건설기술연구원 이름(KICT_API_KEY)으로 들어와 있다.
     포털에 그 서비스가 있는지부터 검색으로 찾는다(번호·주소를 지어내지 않는다). 없으면 KCSC 자체 창구(포털 밖) 열쇠일 수 있다 — 그 사실을 적는다 */
  { key: 'KICT_API_KEY', keyword: '국가건설기준', word: '건설기준', use: '국가건설기준(KCSC) — 설계·시방 기준 조회 후보' },
  /* ★ 〈2026-10-14 · 실측〉 넓힌 검색 «한국건설기술연구원»은 «교통량»·«업체 목록» 서비스만 찾아, 그 서비스들이 «등록되지 않은 서비스키(30)»로
     답한 것을 KCSC 열쇠의 판정처럼 적고 있었다 — 엉뚱한 서비스다. 뺐다. «국가건설기준»은 포털 검색에 0건이다 —
     KCSC 는 포털 밖(국가건설기준센터 자체 창구) 열쇠일 수 있다. 그 주소는 지어내지 않는다 (§4.3) */
  { key: 'FSC_API', keyword: '금융위원회 기금', word: '기금', use: '기금대출정보 — 투자정보 [정책자금] 후보' },
  /* ★ 〈2026-09-29 · 사장님 화면: 「[운영계정]한국산업은행_기금대출 정보」 · 자동승인 · 승인 · 2026-09-28 ~ 2028-09-28〉 —
     제공기관이 금융위원회가 아니라 **한국산업은행**이었다. 앞의 두 검색이 0건이던 까닭이다. 그 이름 그대로 찾는다 (번호를 지어내지 않는다) */
  { key: 'FSC_API', keyword: '한국산업은행 기금대출', word: '기금대출', use: '한국산업은행 기금대출 정보 — 투자정보 [정책자금] 후보' },

  /* ★ 〈2026-09-29 · 사장님: 「확인해줘 반영되었는지?」 + 목록 26개〉 — 이 진단이 한 번도 안 잰 13개를 더한다.
     번호는 모르므로 포털 검색에서 찾는다(지어내지 않는다). 판정 4(등록되지 않은 서비스키)면 활용신청이 아직 안 된 것,
     판정 0·5 면 승인은 된 것이다(5 는 필수 인자만 남았다) */
  { key: 'MOLIT_APT_SALE', keyword: '국토교통부 아파트 매매 실거래가', word: '아파트', use: '아파트 매매 실거래가 — 반영 확인(2026-09-29)' },
  { key: 'REB_LAND_MICRO', keyword: '전국지가변동률조사 마이크로데이터', word: '지가변동률', use: '전국지가변동률조사 마이크로데이터 — 반영 확인(2026-09-29)' },
  { key: 'MOLIT_OFFICETEL_RENT', keyword: '국토교통부 오피스텔 전월세 실거래가', word: '오피스텔', use: '오피스텔 전월세 실거래가 — 반영 확인(2026-09-29)' },
  { key: 'KAMCO_ONBID_BID_RESULT', keyword: '차세대 온비드 물건 입찰결과목록', word: '입찰결과', use: '온비드 물건 입찰결과 — 반영 확인(2026-09-29)' },
  { key: 'KAMCO_SEIZED_AUCTION_RATE', keyword: '체납 압류재산 공매 낙찰가율', word: '낙찰가율', use: '압류재산 공매 낙찰가율 — 반영 확인(2026-09-29)' },
  { key: 'MOLIT_HUB_BLDG_LEDGER', keyword: '건축HUB 건축물대장정보', word: '건축물대장', use: '건축HUB 건축물대장 — 반영 확인(2026-09-29)' },
  { key: 'MOLIT_HUB_HOUSING_PERMIT', keyword: '건축HUB 주택인허가정보', word: '주택인허가', use: '건축HUB 주택인허가 — 반영 확인(2026-09-29)' },
  { key: 'NTS_BIZ_VERIFY', keyword: '사업자등록정보 진위확인 및 상태조회', word: '사업자등록', use: '사업자등록 진위확인·상태조회 — 반영 확인(2026-09-29)' },
  { key: 'MOLIT_HUB_BLDG_PERMIT', keyword: '건축HUB 건축인허가정보', word: '건축인허가', use: '건축HUB 건축인허가 — 반영 확인(2026-09-29)' },
  { key: 'FSC_CORP_BASIC', keyword: '금융위원회 기업기본정보', word: '기업기본정보', use: '기업기본정보 — 반영 확인(2026-09-29)' },
  { key: 'MOLIT_LUR_INFO', keyword: '국토교통부 토지이용규제정보서비스', word: '토지이용규제정보', use: '토지이용규제정보 — 반영 확인(2026-09-29)' },
  { key: 'MOLIT_COMM_SALE', keyword: '상업업무용 부동산 매매 실거래가', word: '상업업무용', use: '상업업무용 부동산 매매 실거래가 — 반영 확인(2026-09-29)' },
  { key: 'MOLIT_LAND_SALE', keyword: '국토교통부 토지 매매 실거래가', word: '토지 매매', use: '토지 매매 실거래가 — 반영 확인(2026-09-29)' },
  /* ★ 〈같은 날 · 첫 검색이 «못 뽑았다»〉 — 이름을 한 겹 좁혀 한 번 더 찾는다(찾은 번호만 건다) */
  { key: 'MOLIT_LAND_SALE', keyword: '토지 매매 실거래가 자료', word: '토지', use: '토지 매매 실거래가 — 반영 확인(2026-09-29)' },
];
const searchUrl = (kw) => 'https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=' + encodeURIComponent(kw);

/* 값이 실렸는가 — 포털 1160100 계열은 `totalCount` 를 준다. 0 이면 «대답은 왔는데 비었다» */
/* ★ 〈2026-10-13 · fsc-probe.md 실측〉 `totalCount` 하나만 보면 놓치는 모양이 셋 있었다 —
   ① KOTRA 국가정보는 결과 00 을 주면서 항목을 `items.item` 이 아닌 자리에 두고 totalCount 를 안 준다
     (scripts/country-fetch.mjs 가 이미 겪었다) ② XML 은 `<item><칸>…` 으로 온다(중소기업 지원사업 공고)
   ③ odcloud 는 `data: [{…}]` 다. 그래서 **본문을 읽어** «낱값 칸이 셋 이상인 객체가 든 배열»이 있으면 값이 왔다고 본다.
   ★ 은행 계열의 빈 «표 목록»(`tableList:[{items:{item:[]},title,totalCount:0}]`)은 객체 안에 객체(items)가 있어
     값으로 안 센다 — 실측: 종금사 202512 가 그 모양으로 비어 왔다. 자리를 지어내지 않고 실제로 있는 것만 본다. */
const COUNT_RE = /"totalCount"\s*:\s*"?[1-9]|<totalCount>[1-9]/;
export function hasItems(text) {
  const s = String(text || '');
  if (COUNT_RE.test(s)) return true;
  if (/<item>\s*<[A-Za-z]/.test(s)) return true;
  let j;
  try { j = JSON.parse(s); } catch (_) { return false; }
  const seen = new Set();
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 8 || seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) {
      const first = v.find((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (first) {
        const vals = Object.values(first);
        if (vals.length >= 3 && vals.every((x) => x == null || typeof x !== 'object')) return true;
      }
      return v.some((x) => walk(x, depth + 1));
    }
    return Object.values(v).some((x) => walk(x, depth + 1));
  };
  return walk(j, 0);
}
/* probe() 는 `.test(본문)` 만 부른다 — 정규식 대신 같은 모양의 판정기를 넘긴다 */
const HAS_ITEMS = { test: hasItems };

/* 대답은 «정상»(결과코드 0·00·000)인데 비었는가 — 기준월을 앞으로 당겨 다시 걸 근거다.
   ★ XML(국토부 실거래 `<resultCode>000</resultCode>`)도 함께 본다 — 앞 판은 JSON 의 "00" 만 봐서 한 번에 멈췄다 */
const OK_EMPTY_RE = /"resultCode"\s*:\s*"?0+"?\s*[,}]|<resultCode>\s*0+\s*<\/resultCode>/;

/* 안내 페이지에서 **요청 주소**와 **오퍼레이션 이름**을 뽑는다.
   ★ 페이지 모양이 바뀌어도 되게 두 갈래로 찾는다 — 통째 주소 · 스웨거 경로(`"/getX"`).
   ★★ 못 뽑으면 **빈 목록**을 돌려준다 — 「주소가 없다」가 아니라 「못 읽었다」다 (§8). */
export function discover(html) {
  const flat = String(html || '');
  const bases = new Set();
  const full = new Set();
  /* 기관 번호(1160100)를 박지 않는다 — 같은 부처라도 서비스마다 다를 수 있다 */
  /* ★ 기관 번호가 글자로 시작하는 곳이 있다(실측: 한국국제협력단 `B260003` — 스웨거 «host» 에 적혀 있다) */
  for (const m of flat.matchAll(/apis\.data\.go\.kr\/([A-Z]?\d{5,8}\/(?:service\/)?[A-Za-z0-9_]+)(?:\/(get[A-Za-z0-9_]+))?/g)) {
    bases.add(m[1]);
    if (m[2]) full.add(`${m[1]}/${m[2]}`);
  }
  const ops = new Set();
  for (const m of flat.matchAll(/["'\/](get[A-Z][A-Za-z0-9_]{2,60})["'?\/]/g)) ops.add(m[1]);
  /* ★ 스웨거 «paths» 의 열쇠도 줍는다 — get 으로 시작하지 않는 오퍼레이션이 있다(실측: 1421000/bizinfo) */
  const pi = flat.indexOf('"paths"');
  if (pi >= 0) for (const m of flat.slice(pi, pi + 20000).matchAll(/"\/([A-Za-z][A-Za-z0-9_]{2,60})"\s*:/g)) ops.add(m[1]);
  for (const o of [...ops]) if (/_response$/.test(o)) ops.delete(o);
  /* ★ 〈2026-09-29 실측: 토지이용규제 법령정보가 «필수 인자 없음(11)»으로 답했다〉 — 스웨거가 «required: true» 로 적은
     인자 이름을 줍는다. 값은 지어 넣지 않는다 — 이름만 적어 배선할 때 쓴다 (§4.3) */
  const required = new Set();
  for (const m of flat.matchAll(/"name"\s*:\s*"([A-Za-z][A-Za-z0-9_]{0,40})"[^{}]{0,400}?"required"\s*:\s*true/g)) required.add(m[1]);
  for (const m of flat.matchAll(/"required"\s*:\s*true[^{}]{0,400}?"name"\s*:\s*"([A-Za-z][A-Za-z0-9_]{0,40})"/g)) required.add(m[1]);
  for (const k of ['serviceKey', 'ServiceKey']) required.delete(k);
  /* ★ 〈2026-10-11 · KOTRA 국가정보 15034830 이 «뿌리/natnInfo» 에 «서비스 없음(12)»으로 답했다〉 — 스웨거가 적은
     host·basePath 와 경로 «통째»(슬래시가 둘 이상인 것 포함)를 그대로 줍는다. 문서에 적힌 것만 쓴다 — 지어내지 않는다 (§4.3) */
  const host = (flat.match(/"host"\s*:\s*"([^"]{3,80})"/) || [])[1] || '';
  const basePath = (flat.match(/"basePath"\s*:\s*"([^"]{1,120})"/) || [])[1] || '';
  const paths = new Set();
  if (pi >= 0) for (const m of flat.slice(pi, pi + 20000).matchAll(/"(\/[A-Za-z][A-Za-z0-9_\/]{1,120})"\s*:\s*\{/g)) paths.add(m[1]);
  /* ★★ 〈같은 날 · 실측〉 KOTRA 는 basePath 가 비고 host 칸에 «apis.data.go.kr/B410001/kotra_nationalInformation/natnInfo» 를
     통째로 적었다(경로는 «/natnInfo»). 그러니 host 와 basePath 를 이어 붙인 뒤 앞의 호스트만 뗀다 */
  const rootPath = `${host}${basePath}`.replace(/^https?:\/\//, '');
  if (/^apis\.data\.go\.kr\//.test(rootPath)) {
    const b = rootPath.replace(/^apis\.data\.go\.kr\//, '').replace(/^\/+|\/+$/g, '');
    if (/^[A-Z]?\d{5,8}\//.test(b)) { bases.add(b); for (const x of paths) full.add(`${b}${x}`); }
  }
  return { bases: [...bases], full: [...full], ops: [...ops], required: [...required], host, basePath, paths: [...paths] };
}

/* ★ 〈2026-09-29 · 실측: 15121307 · 15081808 안내 페이지는 swagger-ui 빈 칸만 주고, 규격은 odcloud «api-docs» 주소에 있었다〉.
   그 규격(JSON)에서 **부를 뿌리 · 경로 · 방법 · 필수 인자**를 뽑는다. 주소를 지어내지 않는다 — 문서에 적힌 것만 쓴다 (§4.3).
   ★ 못 읽으면 null — 「경로가 없다」가 아니라 「못 읽었다」다 (§8). */
export function swaggerOps(json) {
  let d;
  try { d = typeof json === 'string' ? JSON.parse(json) : json; } catch (_) { return null; }
  if (!d || typeof d !== 'object' || !d.paths || typeof d.paths !== 'object') return null;
  let root = '';
  if (d.host) root = `https://${d.host}${d.basePath || ''}`;
  else if (Array.isArray(d.servers) && d.servers[0] && d.servers[0].url) root = String(d.servers[0].url).replace(/^\/\//, 'https://');
  root = root.replace(/\/+$/, '');
  const ops = [];
  for (const [p, methods] of Object.entries(d.paths)) {
    for (const [m, op] of Object.entries(methods || {})) {
      if (!/^(get|post)$/i.test(m) || !op || typeof op !== 'object') continue;
      const params = Array.isArray(op.parameters) ? op.parameters : [];
      const required = params.filter((x) => x && x.required && x.in !== 'header' && x.in !== 'body' && !/^serviceKey$/i.test(x.name)).map((x) => String(x.name));
      const body = Boolean(op.requestBody || params.some((x) => x && x.in === 'body'));
      ops.push({ method: m.toUpperCase(), path: p, required, body });
    }
  }
  return { root: /^https:\/\//.test(root) ? root : '', ops: ops.slice(0, 20) };
}

/* ★ 〈2026-10-12 · 실측: 한국산업은행 기금대출 15060633 — 안내 페이지가 «swaggerUrl» 변수로 규격을 따로 불러온다〉.
   페이지 스크립트에 적힌 그 주소만 읽는다(지어내지 않는다). 빈 값·없음이면 '' — 「규격이 없다」가 아니라 「못 읽었다」다 (§8). */
export function swaggerUrlOf(html) {
  const m = String(html || '').match(/swaggerUrl\s*=\s*['"`]([^'"`]+)['"`]/);
  if (!m) return '';
  const u = m[1].trim();
  if (/^https?:\/\//.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return 'https://www.data.go.kr' + u;
  return '';
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
export function itemKeys(body) {
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
    let ks = it && typeof it === 'object' ? Object.keys(it) : [];
    /* ★ 〈2026-10-13〉 항목이 `items.item` 이 아닌 자리에 있는 곳(KOTRA 국가정보 · odcloud `data`) —
       «낱값 칸이 셋 이상인 객체가 든 첫 배열»의 칸 이름을 줍는다. 자리를 지어내지 않는다 */
    if (!head.length && !ks.length) {
      const seen = new Set();
      const find = (v, depth) => {
        if (!v || typeof v !== 'object' || depth > 8 || seen.has(v)) return null;
        seen.add(v);
        if (Array.isArray(v)) {
          const f = v.find((x) => x && typeof x === 'object' && !Array.isArray(x));
          if (f && Object.values(f).length >= 3 && Object.values(f).every((x) => x == null || typeof x !== 'object')) return f;
          for (const x of v) { const r = find(x, depth + 1); if (r) return r; }
          return null;
        }
        for (const x of Object.values(v)) { const r = find(x, depth + 1); if (r) return r; }
        return null;
      };
      const f = find(j, 0);
      if (f) ks = Object.keys(f);
    }
    return head.length || ks.length ? head.concat(ks).slice(0, 48) : null;
  } catch (_) {
    /* ★ XML(국토부 실거래 · 중소기업 지원사업 공고) — 첫 `<item>` 안의 칸 이름만 줍는다. 값은 안 담는다 */
    const m = String(body || '').match(/<item>([\s\S]*?)<\/item>/);
    if (!m) return null;
    const ks = [...new Set([...m[1].matchAll(/<([A-Za-z][A-Za-z0-9_]{0,40})>/g)].map((x) => x[1]))];
    return ks.length ? ks.slice(0, 48) : null;
  }
}

/* ★ 〈2026-10-13 · fsc-probe.md 실측: 판정 5 열넷 중 여덟이 «필수 인자 없음»(11·81·99) 또는 «인자 없이 빈 대답»이었다〉 —
   필수 인자에 **넣을 값**을 어디서 얻는가. 지어내지 않는다 — 출처는 둘뿐이다 (§4.3):
   ① 안내 페이지 스웨거가 그 인자에 적어 둔 값(x-example·example·default·enum 첫 값·설명 속 «예)»)
   ② 이 저장소의 다른 수집이 **이미 같은 서비스에서 값을 받아 본** 인자(아래 MEASURED — 출처 파일을 함께 적는다).
   ★ 값은 공개 코드(지역코드·국가코드·연월)뿐이다 — 열쇠·개인정보는 없다. 그래도 요약에 적을 때 가림을 지난다 (§2). */
export function paramHints(html) {
  const out = {};
  const flat = String(html || '');
  for (const m of flat.matchAll(/\{[^{}]*?"name"\s*:\s*"([A-Za-z][A-Za-z0-9_]{0,40})"[^{}]*\}/g)) {
    const name = m[1];
    if (out[name] || /^serviceKey$/i.test(name)) continue;
    const o = m[0];
    let x = o.match(/"(x-example|example|default)"\s*:\s*(?:"([^"]{1,40})"|(-?\d{1,20}))/);
    let v = null; let from = '';
    if (x) { v = x[2] != null ? x[2] : x[3]; from = `스웨거 ${x[1]}`; }
    else if ((x = o.match(/"enum"\s*:\s*\[\s*"([^"]{1,40})"/))) { v = x[1]; from = '스웨거 enum 첫 값'; }
    else if ((x = o.match(/"description"\s*:\s*"[^"]*?(?:예\)|예시|예:|ex\))\s*[:：]?\s*([A-Za-z0-9_-]{2,30})/i))) { v = x[1]; from = '스웨거 설명의 예시'; }
    if (v != null && String(v).trim()) out[name] = { value: String(v).trim(), from };
  }
  return out;
}

/* 안내 페이지의 «요청변수» 표에서 인자 이름만 줍는다 — 스웨거를 못 읽은 서비스의 다음 판 재료다(부르지 않는다).
   ★ 실측: 한국산업은행 기금대출 15060633 이 «필수항목이 입력되지 않았습니다(99)»로 답했는데 스웨거가 비어 이름을 못 읽었다 */
export function requestVarsOf(html) {
  const flat = String(html || '');
  const at = ['요청변수', 'Request Parameter'].map((w) => flat.indexOf(w)).filter((i) => i >= 0)[0];
  if (at == null) return null;
  const names = new Set();
  for (const m of flat.slice(at, at + 8000).matchAll(/<td[^>]*>\s*([A-Za-z][A-Za-z0-9_]{1,40})\s*<\/td>/g)) {
    if (!/^serviceKey$/i.test(m[1])) names.add(m[1]);
  }
  return [...names].slice(0, 20);
}

/* ② 이 저장소가 **같은 서비스에서 이미 값을 받아 본** 인자 — 출처 파일을 그대로 적는다(지어내지 않는다).
   ★ 기준월(`ym`)을 받는 것은 아래 기준월 되짚기와 함께 움직인다 */
const MEASURED = [
  /* KOTRA 국가정보 — fsc-probe.md: 결과 81 «Not Exist Required Paramaters» · 스웨거 필수 `isoWd2CntCd` */
  /* ★ 〈2026-10-14 · 실측〉 isoWd2CntCd 를 붙였더니 «HTTP_ERROR(04)» — 같은 열쇠로 country-fetch 는 받는다. 다른 것은 진단이 늘 붙이는
     resultType·basYm·numOfRows=3 뿐이다. 그래서 이 서비스는 «받아 본 요청 그대로»(pageNo=1 · numOfRows=10) 건다 — base 가 그 표시다 */
  { re: /^B410001\/kotra_nationalInformation\//, params: () => ({ isoWd2CntCd: 'BD', type: 'json' }),
    base: { pageNo: '1', numOfRows: '10' },
    from: 'scripts/country-fetch.mjs 실측 (data/country — KOTRA 16/16개국 받음)' },
  /* 국토부 실거래(아파트·오피스텔·상업업무용·토지) — fsc-probe.md: 결과 000 OK 인데 `<items/>`·totalCount 0 · 스웨거 필수 `LAWD_CD`·`DEAL_YMD` */
  { re: /^1613000\/RTMSDataSvc/, params: (ym) => ({ LAWD_CD: '52113', DEAL_YMD: ym }),
    from: 'scripts/yeoui893-fetch.mjs 실측 (국토부 실거래 · LAWD_CD 52113 전주 덕진구)' },
  /* 건축HUB(건축물대장·건축인허가·주택인허가) — fsc-probe.md: 결과 00 인데 `"body":{}` · 스웨거 필수 `sigunguCd`·`bjdongCd` */
  { re: /^1613000\/(?:BldRgstHubService|ArchPmsHubService|HsPmsHubService)\//, params: () => ({ sigunguCd: '41135', bjdongCd: '11100' }),
    from: 'scripts/bldrgst-fetch.mjs 실측 (data/bldrgst — 성남 분당 금곡동 · 건축물대장 받음)' },
];
/* 이미 붙이는 인자 — 필수 인자 목록에서 «값 모름»으로 세지 않는다 */
const BASE_PARAMS = new Set(['pageNo', 'numOfRows', 'resultType', 'basYm']);

/** 한 주소에 붙일 인자를 모은다 — { q: {이름: 값}, used: [{name, value, from}], missing: [이름] } */
export function extraParams(target, ym, required, hints) {
  const q = {}; const used = [];
  const m = MEASURED.find((x) => x.re.test(target));
  const base = m && m.base ? { ...m.base } : null; /* 있으면 진단의 공통 인자 대신 이것만 붙인다 */
  if (m) for (const [k, v] of Object.entries(m.params(ym))) { q[k] = v; used.push({ name: k, value: v, from: m.from }); }
  const missing = [];
  for (const name of required || []) {
    if (BASE_PARAMS.has(name) || q[name] != null) continue;
    const h = hints && hints[name];
    if (h) { q[name] = h.value; used.push({ name, value: h.value, from: h.from }); } else missing.push(name);
  }
  return { q, used, missing, base };
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
  for (const n of ['FSC_API', 'FSC_AMC_API', 'FSC_IAF_API', 'FSC_KOFIA_API', 'FSC_DOMESTIC_BANK_API', 'FSC_SAVINGS_BANK_API', 'FSC_CREDIT_UNION_BANK_API', 'FSC__AGRICULTURAL_COOPERATIVE_BANK_API', 'FSC_FISHERIES_COOPERATIVE_BANK_API', 'FSC_SP_FIN', 'KOICA_PROJ_SC', 'KOICA_GLOBAL_POLITICAL_DEVELOPMENTS', 'KOICA_COUNTRY_INFORMATION', 'KOTRA_KOREA_FDI_BY_INDUSTRY', 'MOLIT_LUR_LAW_KEY', 'MSS_SME_SPA_API', 'MOLIT_APT_SALE', 'REB_LAND_MICRO', 'MOLIT_OFFICETEL_RENT', 'KAMCO_ONBID_BID_RESULT', 'KAMCO_SEIZED_AUCTION_RATE', 'MOLIT_HUB_BLDG_LEDGER', 'MOLIT_HUB_HOUSING_PERMIT', 'NTS_BIZ_VERIFY', 'MOLIT_HUB_BLDG_PERMIT', 'FSC_CORP_BASIC', 'MOLIT_LUR_INFO', 'MOLIT_COMM_SALE', 'MOLIT_LAND_SALE', 'KICT_API_KEY']) {
    /* ★ 2026-10-12 — 등록부에는 밑줄 둘(`FSC__AGRICULTURAL…`)로 적혀 있었다. 사장님 목록은 밑줄 하나다 — 둘 다 읽는다 (§4) */
    const own = pick(n === 'FSC__AGRICULTURAL_COOPERATIVE_BANK_API' ? [n, 'FSC_AGRICULTURAL_COOPERATIVE_BANK_API'] : [n]);
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

  /* 자산운용 후보를 포털 검색으로 더한다 — 못 읽으면 적힌 후보만 건다
     ★ 검색 줄은 로그 앞쪽이라 꼬리만 읽으면 안 보인다 — 끝에서 한 번 더 찍는다(SEARCH_RECAP) */
  const SEARCH_RECAP = [];
  for (const q of SEARCHES) {
    try {
      const r = await fetch(searchUrl(q.keyword), { signal: AbortSignal.timeout(15000) });
      const sh = await r.text();
      const hits = searchHits(sh, q.word);
      const line = `- 포털 검색 «${q.keyword}» — HTTP ${r.status} · ${sh.length}자 · ${hits.length ? hits.map((h) => `${h.id} ${h.name}`).join(' · ') : '**못 뽑았다**'}`;
      P(line); SEARCH_RECAP.push(line.replace(/\*\*/g, ''));
      /* 못 뽑았으면 그 낱말 둘레를 조금 남긴다 — 다음에 뽑는 법을 고칠 재료다(공개 목록이라 비밀이 없다) */
      if (!hits.length) { const i = sh.indexOf(q.word); P(`  - 둘레 «${i < 0 ? '(낱말이 페이지에 없다)' : redact(sh.slice(Math.max(0, i - 200), i + 60).replace(/\s+/g, ' '))}»`); }
      for (const h of hits) if (!SERVICES.some((x) => x.id === h.id)) SERVICES.push({ key: q.key, id: h.id, name: h.name, use: q.use });
    } catch (e) { const line = `- 포털 검색 «${q.keyword}» — **못 닿음** (${redact(String((e && e.message) || e))})`; P(line); SEARCH_RECAP.push(line.replace(/\*\*/g, '')); }
  }
  P('');

  const codes = [];
  for (const svc of SERVICES.slice(0, 64)) {
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
    if (d.host || d.paths.length) { const line = `  - 스웨거 host·basePath \`${redact(d.host || '-')}\` \`${redact(d.basePath || '-')}\` · 경로 ${d.paths.length ? d.paths.slice(0, 6).map((x) => `\`${redact(x)}\``).join(' ') : '(없다)'}`; P(line); SEARCH_RECAP.push(`- ${svc.id} ${line.trim()}`); }
    if (d.required.length) { const line = `  - 필수 인자(스웨거) ${d.required.map((o) => `\`${o}\``).join(' · ')}`; P(line); SEARCH_RECAP.push(`- ${svc.id} ${line.trim()}`); }
    const rows = [];
    const odRows = []; let odSpec = false;
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
      /* ★ 〈2026-09-29 · 사업자 진위확인 15081808 이 «swagger-ui» 빈 칸만 주었다〉 — 규격을 화면 스크립트가 따로 불러오는 모양이다.
         주소를 지어내지 않고, 페이지에 적힌 주소 중 규격·창구로 보이는 것만 적는다(공개 페이지 · 가림을 지난다). 다음 판에서 이것으로 뽑는다 */
      const refs = [...new Set((html.match(/(?:https?:)?\/\/[^"'\s<>()]*(?:odcloud|swagger|api-docs|openapi|\.json)[^"'\s<>()]*/gi) || []))].slice(0, 6);
      const refLine = `  - 규격 주소 후보 ${refs.length ? refs.map((u) => `«${redact(u)}»`).join(' · ') : '(페이지에 없다)'}`;
      P(refLine); SEARCH_RECAP.push(`- ${svc.id} ${refLine.trim()}`);
      /* ★ 〈2026-10-13〉 스웨거가 비어 인자 이름을 못 읽은 곳 — 안내 페이지의 «요청변수» 표에서 이름만 줍는다(부르지 않는다) */
      { const rv = requestVarsOf(html);
        const l = `  - 요청변수 표 ${rv == null ? '(요청변수 낱말이 페이지에 없다 — 화면 스크립트가 따로 그리는 모양이다)' : rv.length ? rv.map((x) => `\`${x}\``).join(' · ') : '(낱말은 있는데 이름을 못 뽑았다)'}`;
        P(l); SEARCH_RECAP.push(`- ${svc.id} ${l.trim()}`); }
      if (/swagger-ui/.test(html)) { const j = html.indexOf('SwaggerUIBundle'); P(`  - 스웨거 불러오기 둘레 «${j < 0 ? '(SwaggerUIBundle 낱말이 없다)' : redact(html.slice(j, j + 300).replace(/\s+/g, ' '))}»`); }
      /* ★ swaggerUrl 이 적혀 있으면 그 규격을 받아 «필수 인자 이름»만 적는다 — 값이 필요한 인자는 지어 넣지 않는다 */
      { const su = swaggerUrlOf(html);
        if (su) {
          let sp = null;
          try { sp = swaggerOps(await (await fetch(su, { signal: AbortSignal.timeout(15000) })).text()); } catch (_) { sp = null; }
          const l = sp
            ? `  - swaggerUrl 규격 — 뿌리 ${sp.root ? `\`${redact(sp.root)}\`` : '**못 읽었다**'} · ` + (sp.ops.length ? sp.ops.map((o) => `${o.method} \`${o.path}\`${o.required.length ? ` (필수 ${o.required.join('·')})` : ''}`).join(' · ') : '경로 **없음(못 읽었다)**')
            : `  - swaggerUrl «${redact(su)}» — **못 읽었다** (받지 못했거나 JSON 이 아니다)`;
          P(l); SEARCH_RECAP.push(`- ${svc.id} ${l.trim()}`);
        } else if (/swaggerUrl/.test(html)) {
          const j = html.indexOf('swaggerUrl'); const l = `  - swaggerUrl 둘레 «${redact(html.slice(j, j + 200).replace(/\s+/g, ' '))}»`; P(l); SEARCH_RECAP.push(`- ${svc.id} ${l.trim()}`);
        }
      }
      /* ★ 그 후보 중 odcloud 규격(api-docs)을 실제로 받아 읽는다 — 문서에 적힌 뿌리·경로로만 부른다.
         ★★ 값이 필요한 인자(사업자번호 등)는 **지어 넣지 않는다** — 이름만 적는다. 부를 수 있는 것만 부른다:
           GET 은 쪽 인자(page·perPage·returnType)만 필요한 것 · POST 는 빈 몸통(인증 통과 여부만 가린다). */
      for (const ref of refs.filter((u) => /odcloud\.kr\/.*api-docs/i.test(u)).slice(0, 2)) {
        const docUrl = ref.startsWith('//') ? `https:${ref}` : ref;
        let spec = null;
        try { spec = swaggerOps(await (await fetch(docUrl, { signal: AbortSignal.timeout(15000) })).text()); } catch (_) { spec = null; }
        if (!spec) { const l = '  - odcloud 규격 — **못 읽었다** (받지 못했거나 JSON 이 아니다)'; P(l); SEARCH_RECAP.push(`- ${svc.id} ${l.trim()}`); continue; }
        odSpec = true;
        const opLine = `  - odcloud 규격 — 뿌리 ${spec.root ? `\`${redact(spec.root)}\`` : '**못 읽었다**'} · `
          + (spec.ops.length ? spec.ops.map((o) => `${o.method} \`${o.path}\`${o.required.length ? ` (필수 ${o.required.join('·')})` : ''}${o.body ? ' (몸통)' : ''}`).join(' · ') : '경로 **없음(못 읽었다)**');
        P(opLine); SEARCH_RECAP.push(`- ${svc.id} ${opLine.trim()}`);
        if (!spec.root) continue;
        const PAGE = new Set(['page', 'perPage', 'returnType']);
        for (const o of spec.ops.slice(0, 4)) {
          const u = `${spec.root}${o.path}?serviceKey=${encodeURIComponent(decoded)}`;
          let r = null;
          if (o.method === 'GET' && o.required.every((x) => PAGE.has(x))) {
            r = await probe(`odcloud GET ${o.path}`, `${u}&page=1&perPage=3&returnType=JSON`, {}, /"currentCount"\s*:\s*[1-9]|"data"\s*:\s*\[\s*\{/, null);
          } else if (o.method === 'POST' && o.body && !o.required.length) {
            r = await probe(`odcloud POST ${o.path} · 빈 몸통`, u, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' }, null, null);
          } else { P(`  - \`${o.method} ${o.path}\` — 필수 인자 값이 있어야 부른다 · **지어 넣지 않아 안 불렀다**`); continue; }
          odRows.push(r); sayRow(P, r, '항목');
        }
      }
    }
    /* ★ 〈2026-10-13〉 필수 인자 값 — 스웨거가 적은 값 · 이 저장소가 같은 서비스에서 받아 본 값만 붙인다(지어내지 않는다).
       무엇을 어디서 가져와 붙였는지, 값을 몰라 못 붙인 필수 인자가 무엇인지 요약에 적는다 */
    const hints = paramHints(html);
    if (targets.length) {
      const ex = extraParams(targets[0], 'YYYYMM', d.required, hints);
      for (const u of ex.used) { const l = `  - 붙인 인자 \`${u.name}=${u.value === 'YYYYMM' ? '기준월(줄마다 따라 움직인다)' : redact(String(u.value))}\` — ${u.from}`; P(l); SEARCH_RECAP.push(`- ${svc.id} ${l.trim()}`); }
      if (ex.missing.length) { const l = `  - 값을 모르는 필수 인자 ${ex.missing.map((x) => `\`${x}\``).join(' · ')} — 스웨거에 예시 값이 없고 이 저장소도 받아 본 적이 없다 · **지어 넣지 않았다** (대답이 «필수 인자 없음»이면 이 칸이다)`; P(l); SEARCH_RECAP.push(`- ${svc.id} ${l.trim()}`); }
    }
    for (const t of targets) {
      for (const [how, k] of [['원본', key.value], ['디코딩', decoded]]) {
        if (how === '디코딩' && k === key.value) continue;
        /* ★ 대답은 «정상»인데 그 기준월이 비었으면 앞 기준월로 더 건다 (§4 의 셋째 갈래 — 공표 전인 달일 수 있다).
           ★★ 〈2026-10-13 · 실측〉 종금사는 202512·202506·202412 셋이 다 «결과 00 · 표 목록 비었음»이었다 —
             그래서 두 해를 더 거슬러 본다. 거기서 차면 «규격»이 아니라 «공표가 끊긴 서비스»다(아래 줄이 그 사실을 적는다).
           ★ 국토부 실거래는 기준월이 곧 `DEAL_YMD` 다 — 같은 되짚기로 움직인다 */
        let url = '', r = null, hitYm = '';
        const months = [BAS_YM, `${Y}06`, `${Y - 1}12`, `${Y - 2}12`, `${Y - 3}12`];
        for (const ym of months) {
          const ex = extraParams(t, ym, d.required, hints);
          url = `https://apis.data.go.kr/${t}?serviceKey=${encodeURIComponent(k)}`
            + (ex.base ? Object.entries(ex.base).map(([n, v]) => `&${n}=${encodeURIComponent(v)}`).join('') : `&pageNo=1&numOfRows=3&resultType=json&basYm=${ym}`)
            + Object.entries(ex.q).map(([n, v]) => `&${encodeURIComponent(n)}=${encodeURIComponent(v)}`).join('');
          r = await probe(`${t} · ${how} · ${ym}`, url, {}, HAS_ITEMS, null);
          hitYm = ym;
          if (r.gotValue || r.status == null || r.authFail || !OK_EMPTY_RE.test(r.head || '')) break;
        }
        rows.push(r);
        sayRow(P, r, '항목');
        if (r.gotValue && hitYm !== BAS_YM) P(`  - ★ 최근 기준월(${BAS_YM})은 비었고 **${hitYm}** 에서 찼다 — 규격이 아니라 공표가 늦거나 끊긴 서비스일 수 있다`);
        if (!r.gotValue && r.status != null && !r.authFail && OK_EMPTY_RE.test(r.head || '')) P(`  - ★ 대답은 **정상(결과 0)** 인데 기준월 ${months.length}개(${months[0]}~${months[months.length - 1]})가 모두 비었다 — 인자가 모자라거나, 그 기간에 자료가 없다`);
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
    /* ★ odcloud 규격으로 부른 줄이 있으면 그것으로 판정한다. 규격은 읽었는데 부를 수 있는 것이 없었으면(값이 필요한 인자뿐)
       «못 쟀다» — 대답을 못 받은 것을 승인·거부 어느 쪽으로도 적지 않는다 (§8) */
    /* ★ 〈2026-10-13 · 실측: 사업자등록 15081808 이 빈 몸통에 HTTP 411 «REQUEST_DATA_MALFORMED» 로 답했다〉 —
       그것은 «규격이 틀렸다»가 아니라 «몸통에 사업자번호(b_no)가 있어야 한다»는 뜻이다. 번호는 지어 넣지 않는다(검사가 막는다) —
       그래서 «못 쟀다»로 적는다. 실제 호출은 im-agent/connectors/nts.js 가 사람이 넣은 번호로 한다.
       ★ 다만 3 이 아니라 1 로 적는다 — 3 은 «못 닿았다 · 도는 자리를 옮긴다»라서, 서버가 대답한 이 경우를 3 으로 세면
         요약 첫 줄이 엉뚱한 일(자리 옮기기)을 시킨다 (Codex 리뷰 · #220). 1 은 «닿았는데 사람이 넣을 값이 있어야 잰다»다 */
    const bodyNeeded = odRows.length > 0 && odRows.every((r) => r.status != null && !r.gotValue && /REQUEST_DATA_MALFORMED/.test(r.head || ''));
    const v = targets.length ? verdictOf(rows)
      : bodyNeeded ? { code: 1, head: '**규격은 읽었다** — 몸통에 조회할 값(사업자번호 `b_no`)이 있어야 대답한다(«REQUEST_DATA_MALFORMED»). 값을 지어 넣지 않아 **못 쟀다**. 실제 조회는 `im-agent/connectors/nts.js` 가 사람이 넣은 번호로 한다. 열쇠가 통했는지는 이 대답만으로 **못 가른다**' }
      : odRows.length ? verdictOf(odRows)
      : odSpec ? { code: 1, head: '**규격은 읽었다** — 부르려면 필수 인자 값이 있어야 해서 지어 넣지 않고 안 불렀다(못 쟀다). **열쇠 문제가 아니다**' }
      : { code: 3, head: '**부를 주소를 못 읽었다** — 안내 페이지를 못 받았거나 모양이 다르다. 열쇠 문제가 아니다' };
    codes.push(v.code);
    results.services.push({ id: svc.id, bases: d.bases, ops: d.ops, code: v.code,
      rows: rows.concat(odRows).map((r) => ({ label: r.label, status: r.status, gotValue: r.gotValue, authFail: r.authFail, head: r.head })) });
    P('');
    P(`> **판정 ${v.code}** — ${v.head}`);
    P('');
  }

  await writeFile(`${OUT}/fsc-probe.json`, redact(JSON.stringify(results, null, 1)));
  /* 되돌아오는 값은 **나쁜 쪽** — 두 서비스를 다 쓰려는 것이라 하나라도 막히면 할 일이 남는다 */
  const code = Math.max(...codes);
  const verdict = `판정 ${code} — ${FSC_MEAN[code] || '판정하지 못했다'} (`
    + results.services.map((x, i) => `${SERVICES[i].name.replace('금융위원회_', '')} ${x.code}`).join(' · ') + ')';
  log.unshift(`> ${verdict}`, '');
  await writeFile(`${OUT}/fsc-probe.md`, log.join('\n'));
  if (SEARCH_RECAP.length) console.log(['', '포털 검색 다시 보기:', ...SEARCH_RECAP].join('\n'));
  console.log(`\n완료 — ${OUT}/fsc-probe.md`);
  if (code !== 0) console.error(verdict.replace(/\*\*/g, ''));
  return code;
}

/* ★ 가져다 쓰는 쪽(검사)이 부를 때는 안 돈다 */
if (process.argv[1] && process.argv[1].endsWith('fsc-probe.mjs')) {
  const code = await main();
  process.exit(code);
}
