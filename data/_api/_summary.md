# 공공 API 실측 진단

**잰 시각** 2026. 10. 10. 17시 38분 35초 · **잰 곳** GitHub Actions (열쇠가 있는 자리)

**9개 항목 중 6개 살아 있음 · 3개 실패**

> 이 파일은 `npm run im:smoke` 를 **키가 있는 자리에서 돌린 결과**입니다.
> 키는 한 글자도 담기지 않습니다 — 쓰기 전에 기계가 세고, 걸리면 안 씁니다.

## 1. 열쇠가 들어왔는가

| 열쇠 | 발급처 | 쓰는 곳 | 들어옴 |
|---|---|---|---|
| `DART_API_KEY` | 금융감독원 전자공시 | 기업 개황·재무제표·감사보고서 | ✅ `DART_API_KEY` |
| `REB_API_KEY` | 한국부동산원 R-ONE | 상업용부동산 임대동향 | ✅ `REB_API_KEY` |
| `KOSIS_API_KEY` | 통계청 | 인구·가구·사회통계 | ✅ `KOSIS_API_KEY` |
| `ECOS_API_KEY` 또는 `ECOS_BOK_KEY` | 한국은행 | 금리·환율·통화 (이름 둘 다 읽는다) | ✅ `ECOS_BOK_KEY` |
| `KEPCO_BIGDATA_KEY` | 한국전력 | 전력 사용량 | ✅ `KEPCO_BIGDATA_KEY` |
| `KMA_APIHUB_KEY` | 기상청 | 일사·일조 (태양광) | ✅ `KMA_APIHUB_KEY` |
| `DATA_GO_KR_KEY` 또는 `APIS_DATA` 또는 `SPECIAL_DAY_INFO` | 공공데이터포털 | 실거래가·건축물대장·인허가·특일정보 (이름을 다 읽는다 — connectors/datakey.js 의 차례 그대로) | ✅ `DATA_GO_KR_KEY` |
| `WEATHER_GO` | 공공데이터포털 기상청 | 단기예보 (VilageFcstInfoService_2.0) — 아직 커넥터에 안 붙였다 | ✅ `WEATHER_GO` |
| `FSC_API` | 금융위원회 금융통계 | 종합금융회사·국내은행 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `FSC_AMC_API` | 금융위원회 금융통계 | 자산운용사 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `FSC_IAF_API` | 금융위원회 금융통계 | 투자자문사 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `PERSONAL_API_KEY` | 공공데이터포털 | 개인 인증키 — 진단(scripts/fsc-probe.mjs)이 먼저 쓴다 · 기존 포털 열쇠와 같은 값인지 적는다 | — **없음** |
| `KPX_POWER_SUPPLY_DEMAND_FORECAST_GW` | 공공데이터포털 한국전력거래소 | 전력수급예보조회 — 진단(scripts/price-probe.mjs)이 먼저 쓴다 · 아직 커넥터에 안 붙였다 | ✅ `KPX_POWER_SUPPLY_DEMAND_FORECAST_GW` |
| `KPX_SMP_DEMAND_FORECAST` | 공공데이터포털 한국전력거래소 | SMP·수요예측 — 진단(scripts/price-probe.mjs)이 먼저 쓴다 · 아직 커넥터에 안 붙였다 | ✅ `KPX_SMP_DEMAND_FORECAST` |
| `MSS_SME_SPA_API` | 중소벤처기업부 | 중소기업 지원사업 공고 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `FSC_DOMESTIC_BANK_API` | 금융위원회 금융통계 | 국내은행 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `FSC_SAVINGS_BANK_API` | 금융위원회 금융통계 | 저축은행 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `FSC_CREDIT_UNION_BANK_API` | 금융위원회 금융통계 | 신용협동조합 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `FSC__AGRICULTURAL_COOPERATIVE_BANK_API` | 금융위원회 금융통계 | 농업협동조합 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `FSC_FISHERIES_COOPERATIVE_BANK_API` | 금융위원회 금융통계 | 수산업협동조합 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `FSC_SP_FIN` | 금융위원회 | 개인사업자금융정보(보증잔액·예금대출) — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `KOICA_PROJ_SC` | 한국국제협력단 | 사업정보(분야·국가) — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `KOICA_GLOBAL_POLITICAL_DEVELOPMENTS` | 한국국제협력단 | 세계 정치동향 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | ✅ `KOICA_GLOBAL_POLITICAL_DEVELOPMENTS` |
| `MOLIT_LUR_LAW_KEY` | 국토교통부 | 토지이용규제 법령정보 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `FSC_KOFIA_API` | 금융위원회 금융투자협회 | 펀드·증시자금·신용공여 — 아직 커넥터에 안 붙였다 (scripts/fsc-probe.mjs) | — **없음** |
| `LAW_OC` 또는 `LAW_OPEN_DATA` | 국가법령정보센터 | 법령·조례 (이름 둘 다 읽는다) | ✅ `LAW_OC` |
| `VWORLD_KEY` 또는 `LINKPILOT_VWORLD_WEB_KEY` 또는 `LINKPILOT_VWORLD_REPORT_KEY` | 브이월드 | 지오코딩·지적·토지특성 (이름을 다 읽는다 — connectors/vworldkey.js 의 차례 그대로) | ✅ `LINKPILOT_VWORLD_WEB_KEY` |
| `VWORLD_DOMAIN` | 브이월드 | 서비스URL — 키와 **짝**이라 둘 다 있어야 한다 | ✅ `VWORLD_DOMAIN` |
| `KRX_API_KEY` | 한국거래소 | 상장 시세 — 서비스 승인이 따로 필요 | ✅ `KRX_API_KEY` |
| `PEXELS_API_KEY` | Pexels | 무료 이미지 | ✅ `PEXELS_API_KEY` |
| `KICT_API_KEY` | 건설기술연구원 | 건설 관련 | ✅ `KICT_API_KEY` |
| `KAKAO_MOBILITY_KEY` 또는 `KAKAOMOBILITY_KEY` 또는 `KAKAO_MOBILITY_REST_API` | 카카오모빌리티 | 자동차 길찾기 소요시간 (이름 셋 다 읽는다) | ✅ `KAKAO_MOBILITY_REST_API` |
| `ODSAY_API_KEY` 또는 `ODSAY_KEY` | ODsay | 대중교통 소요시간 (이름 둘 다 읽는다) | ✅ `ODSAY_API_KEY` |
| `NCP_MAPS_CLIENT_ID` 또는 `NAVER_MAPS_CLIENT_ID` 또는 `NAVER_MAP_CLIENT_ID` 또는 `NAVER_CLIENT_ID` | 네이버 클라우드 Maps | Client ID — 규격 미측정 (진단 D-314) | — **없음** |
| `NCP_MAPS_CLIENT_SECRET` 또는 `NAVER_MAPS_CLIENT_SECRET` 또는 `NAVER_MAP_CLIENT_SECRET` 또는 `NAVER_CLIENT_SECRET` | 네이버 클라우드 Maps | Client Secret — 위의 짝 | — **없음** |

★ **16개가 안 들어왔습니다.** Secrets 에 없거나 **이름이 다릅니다** —
이름이 다르면 아무 오류 없이 조용히 죽습니다 (지침서 §9 첫 줄).

## 2. 실제로 불러 본 결과

| 항목 | 결과 | 왜 | 무엇을 하면 되나 |
|---|---|---|---|
| 한국은행 ECOS 시장금리 | ✅ 살아 있음 | — | — |
| 한국은행 ECOS 생산자물가 업종목록 (404Y014) | ✅ 살아 있음 | — | — |
| 통계청 KOSIS 통계표 검색 (가동률) | ✅ 살아 있음 | — | — |
| DART 시행사 대조 (삼성물산) | ✕ 실패 | DART 800: 시스템 점검 중 | 아래 진단 원문을 보십시오 |
| VWorld 지오코딩 | ✕ 실패 | 지오코딩 실패 — ROAD: fetch failed (4회 시도 실패) / PARCEL: HTTP 502 ( | 아래 진단 원문을 보십시오 |
| REC 현물시장 (전력거래소) | ✅ 살아 있음 | — | — |
| 지가지수 (부동산원) | ✅ 살아 있음 | — | — |
| 기업기본정보 (금융위) | ✅ 살아 있음 | — | — |
| 공사 낙찰 (조달청) | ✕ 실패 | 조회는 됐지만 조건에 맞는 낙찰 건이 없다 (기간 20251010~20261010 · 지역 인천 · 10억  | 아래 진단 원문을 보십시오 |

## 3. 이 파일을 어떻게 읽나

- **살아 있음** — 커넥터가 응답을 받고 기대한 필드가 있습니다. 지침서 §1 의 「미검증」을 이걸로 바꾸십시오.
- **활용신청 안 됨** — 키는 멀쩡합니다. 그 API 하나에 신청만 하면 됩니다 (지침서 §4.2).
- **키 없음** — 이름이 다를 수 있습니다. 위 1번 표에서 어느 이름으로 들어왔는지 보십시오.
- **승인 대기** — KRX 처럼 발급 뒤 관리자 승인이 따로 필요한 곳입니다.

원문은 같은 폴더의 `_raw.txt` 에 있습니다.
