> 판정 0 — 값이 왔다 — 배선할 수 있다 (REC 0 · SMP 0)

# 전력 판매 단가 실측 (SMP · REC)

- REC 육지 최근 1개월 — 가중평균 **71449원/REC** · 단순평균 71428 · 개장 9회 · 기간 20260901~20261001 · 마지막 거래일 종가(평균) 71172
- REC 육지 최근 3개월 — 가중평균 **71321원/REC** · 단순평균 71302 · 개장 26회 · 기간 20260701~20261001 · 마지막 거래일 종가(평균) 71172

- 포털 열쇠: `KPX_SMP_DEMAND_FORECAST` (길이 64)
- 포털 검색 «한국전력거래소 계통한계가격» — HTTP 200 · 15131225 계통한계가격 및 수요예측(하루전 발전계획용)
- 포털 검색 «한국전력거래소 SMP» — HTTP 200 · 15103214 SMP 결정 횟수(일별)
- 포털 검색 «전력거래소 계통한계가격» — HTTP 200 · 15131225 계통한계가격 및 수요예측(하루전 발전계획용)
- 포털 검색 «한국전력거래소 SMP 수요예측» — HTTP 200 · 못 뽑았다
- 포털 검색 «전력거래소 수요예측» — HTTP 200 · 15131225 수요예측 (하루전 발전계획용)
## 계통한계가격 및 수요예측(하루전 발전계획용) (15131225)
- 서비스 B552115/SmpWithForecastDemand · 오퍼레이션 getSmpWithForecastDemand · getSmpWithForecastDemand_header · getSmpWithForecastDemand_body · getSmpWithForecastDemand_items · getSmpWithForecastDemand_item · 필수 인자 pageNo · numOfRows · dataType
- `B552115/SmpWithForecastDemand/getSmpWithForecastDemand` — HTTP 200 · 23430자
  - 앞머리 «{ "response" : { "header" : { "resultCode" : "00", "resultMsg" : "OK" }, "body" : { "dataType" : "JSON", "totalCount" : "118773", "numOfRows" : "100", "pageNo" : "1", "items" : { "item" : [ { "date" : "20261001", "jlfd" : 614.00000, "slfd" : 55894.00000, "hour" : "01", "areaName" : "육지", "smp" : 105.99000, "rn" : 1, "mlfd" : 55280.00000 }, { "date" : "20261001", "jlfd" : 614.00000, "slfd" : 55894.00000, "hour" : "01", "a»
- `B552115/SmpWithForecastDemand/getSmpWithForecastDemand_header` — HTTP 400 · 190자
  - 앞머리 «{ "OpenAPI_ServiceResponse": { "cmmMsgHeader": { "errMsg": "NO_OPENAPI_SERVICE_ERROR", "returnAuthMsg": "해당 오픈API 서비스가 없거나 폐기됨", "returnReasonCode": "12" } } } »
- `B552115/SmpWithForecastDemand/getSmpWithForecastDemand_body` — HTTP 400 · 190자
  - 앞머리 «{ "OpenAPI_ServiceResponse": { "cmmMsgHeader": { "errMsg": "NO_OPENAPI_SERVICE_ERROR", "returnAuthMsg": "해당 오픈API 서비스가 없거나 폐기됨", "returnReasonCode": "12" } } } »
- `B552115/SmpWithForecastDemand/getSmpWithForecastDemand_items` — HTTP 400 · 190자
  - 앞머리 «{ "OpenAPI_ServiceResponse": { "cmmMsgHeader": { "errMsg": "NO_OPENAPI_SERVICE_ERROR", "returnAuthMsg": "해당 오픈API 서비스가 없거나 폐기됨", "returnReasonCode": "12" } } } »
## SMP 결정 횟수(일별) (15103214)
- 서비스 B552115/SmpDecByFuel2 · 오퍼레이션 getSmpDecByFuel2 · 필수 인자 pageNo · numOfRows · dataType
- `B552115/SmpDecByFuel2/getSmpDecByFuel2` — HTTP 403 · 192자
  - 앞머리 «{ "OpenAPI_ServiceResponse": { "cmmMsgHeader": { "errMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "returnAuthMsg": "등록되지 않은 서비스키", "returnReasonCode": "30" } } } »
- SMP 육지 최근 1개월 — 평균 **113.51원/kWh** · 기간 20260902~20261001 · 30일 718시간 · 마지막 날 20261001 평균 108.61원/kWh (24시간)
- SMP 육지 시간대 단순평균 — 09~17시 **114.13원/kWh** (268시간) · 11~15시 **110.63원/kWh** (148시간) · 발전량 가중 아님
- SMP 시간대별 평균(시각 칸 01~24) — 01:104.05 · 02:98.99 · 03:97.8 · 04:97.46 · 05:97.47 · 06:98.36 · 07:100.3 · 08:103.04 · 09:110.3 · 10:115.62 · 11:112.83 · 12:105.2 · 13:103.2 · 14:114.09 · 15:117.43 · 16:118.67 · 17:129.13 · 18:133.59 · 19:135.33 · 20:133.84 · 21:130.67 · 22:127.23 · 23:122.78 · 24:116.34

## 전력수급예보 — 열쇠 `KPX_POWER_SUPPLY_DEMAND_FORECAST_GW` (길이 64)
- 포털 검색 «한국전력거래소 전력수급예보» — HTTP 200 · 15051436 수급예보조회 · 15158707 수급예보조회_GW
- 포털 검색 «전력거래소 전력수급예보조회» — HTTP 200 · 15051436 수급예보조회 · 15158707 수급예보조회 _GW
### 수급예보조회 (15051436)
- 서비스 못 읽었다 · 오퍼레이션 못 읽었다 · 필수 인자 (못 읽었다/없음)
### 수급예보조회_GW (15158707)
- 서비스 B552115/forecast1dMaxBaseDate · 오퍼레이션 getForecast1dMaxBaseDate · 필수 인자 dataType
- `B552115/forecast1dMaxBaseDate/getForecast1dMaxBaseDate` — HTTP 200 · 455자
  - 앞머리 «{ "response" : { "header" : { "resultCode" : "00", "resultMsg" : "OK" }, "body" : { "dataType" : "JSON", "totalCount" : "1", "numOfRows" : "50", "pageNo" : "1", "items" : { "item" : [ { "fcStime" : "18", "fcMaxload" : 70400, "fcDate" : "20261006", "fcEtime" : "19", "rn" : 1, "fcLevel" : 0, "fcReservePwr" : 26414 } ] } } }}»
- 공개 화면 https://www.kpx.or.kr/ — HTTP 200 · 206자
- 공개 화면 https://new.kpx.or.kr/ — HTTP 200 · 206자
- 공개 화면 https://epsis.kpx.or.kr/epsisnew/selectEkmaSmpShdChart.do?menuId=040201 — HTTP 200 · 2065자
  - 둘레 «연료원별 발전형식별 회원사별 발전기별 상용자가설비 발전기 세부내역 연도별 실시간 전력수급 전력수급실적 최대/최소전력 월별평균 추계정보 연료비용 계통한계가격 시장참여설비용량 (전력시장·PPA) 전력입찰량 전력거래량 (전력시장·PPA) 전력거래금액 (전력시장·PPA) 정산단가 회원사현황 송전설비 변전설비 지역별 변전설비 배전설비 지역별 배전설비 통신설비 유형별전기고장추이 발전량 발전연료사용량추이 화력발전소열효율 판매전력량 판매금액 판매단가 전력손실량 고객호수 전력시장 전력계통 전력수급 국가승인통계 기타 관련법규 제공중단통계 EPSIS소»
  - 둘레 «매금액 판매단가 전력손실량 고객호수 전력시장 전력계통 전력수급 국가승인통계 기타 관련법규 제공중단통계 EPSIS소개 고객센터 전력거래 연료비용 계통한계가격 가중평균SMP 시간별SMP 연료원별 SMP결정 시장참여설비용량 (전력시장·PPA) 연료원별 회원사별 전력입찰량 연료원별 회원사별 전력거래량 (전력시장·PPA) 연료원별 회원사별 전력거래금액 (전력시장·PPA) 연료원별 회원사별 정산단가 연료원별 회원사별 회원사현황 시간별SMP HOME > 전력거래 > 계통한계가격 > 가중평균SMP 그래프 선그래프 막대그래프 년도 2026 2025»
  - 둘레 «손실량 고객호수 전력시장 전력계통 전력수급 국가승인통계 기타 관련법규 제공중단통계 EPSIS소개 고객센터 전력거래 연료비용 계통한계가격 가중평균SMP 시간별SMP 연료원별 SMP결정 시장참여설비용량 (전력시장·PPA) 연료원별 회원사별 전력입찰량 연료원별 회원사별 전력거래량 (전력시장·PPA) 연료원별 회원사별 전력거래금액 (전력시장·PPA) 연료원별 회원사별 정산단가 연료원별 회원사별 회원사현황 시간별SMP HOME > 전력거래 > 계통한계가격 > 가중평균SMP 그래프 선그래프 막대그래프 년도 2026 2025 2024 2023 »
  - 둘레 «수 전력시장 전력계통 전력수급 국가승인통계 기타 관련법규 제공중단통계 EPSIS소개 고객센터 전력거래 연료비용 계통한계가격 가중평균SMP 시간별SMP 연료원별 SMP결정 시장참여설비용량 (전력시장·PPA) 연료원별 회원사별 전력입찰량 연료원별 회원사별 전력거래량 (전력시장·PPA) 연료원별 회원사별 전력거래금액 (전력시장·PPA) 연료원별 회원사별 정산단가 연료원별 회원사별 회원사현황 시간별SMP HOME > 전력거래 > 계통한계가격 > 가중평균SMP 그래프 선그래프 막대그래프 년도 2026 2025 2024 2023 2022 20»
- 공개 화면 https://epsis.kpx.or.kr/epsisnew/selectEkmaSmpSmpChart.do?menuId=040202 — HTTP 200 · 1601자
  - 둘레 «연료원별 발전형식별 회원사별 발전기별 상용자가설비 발전기 세부내역 연도별 실시간 전력수급 전력수급실적 최대/최소전력 월별평균 추계정보 연료비용 계통한계가격 시장참여설비용량 (전력시장·PPA) 전력입찰량 전력거래량 (전력시장·PPA) 전력거래금액 (전력시장·PPA) 정산단가 회원사현황 송전설비 변전설비 지역별 변전설비 배전설비 지역별 배전설비 통신설비 유형별전기고장추이 발전량 발전연료사용량추이 화력발전소열효율 판매전력량 판매금액 판매단가 전력손실량 고객호수 전력시장 전력계통 전력수급 국가승인통계 기타 관련법규 제공중단통계 EPSIS소»
  - 둘레 «매금액 판매단가 전력손실량 고객호수 전력시장 전력계통 전력수급 국가승인통계 기타 관련법규 제공중단통계 EPSIS소개 고객센터 전력거래 연료비용 계통한계가격 가중평균SMP 시간별SMP 연료원별 SMP결정 시장참여설비용량 (전력시장·PPA) 연료원별 회원사별 전력입찰량 연료원별 회원사별 전력거래량 (전력시장·PPA) 연료원별 회원사별 전력거래금액 (전력시장·PPA) 연료원별 회원사별 정산단가 연료원별 회원사별 회원사현황 가중평균SMP HOME > 전력거래 > 계통한계가격 > 시간별SMP 그래프 선그래프 막대그래프 주기 년 월 Help »
  - 둘레 «손실량 고객호수 전력시장 전력계통 전력수급 국가승인통계 기타 관련법규 제공중단통계 EPSIS소개 고객센터 전력거래 연료비용 계통한계가격 가중평균SMP 시간별SMP 연료원별 SMP결정 시장참여설비용량 (전력시장·PPA) 연료원별 회원사별 전력입찰량 연료원별 회원사별 전력거래량 (전력시장·PPA) 연료원별 회원사별 전력거래금액 (전력시장·PPA) 연료원별 회원사별 정산단가 연료원별 회원사별 회원사현황 가중평균SMP HOME > 전력거래 > 계통한계가격 > 시간별SMP 그래프 선그래프 막대그래프 주기 년 월 Help Image 주기 년 »
  - 둘레 «수 전력시장 전력계통 전력수급 국가승인통계 기타 관련법규 제공중단통계 EPSIS소개 고객센터 전력거래 연료비용 계통한계가격 가중평균SMP 시간별SMP 연료원별 SMP결정 시장참여설비용량 (전력시장·PPA) 연료원별 회원사별 전력입찰량 연료원별 회원사별 전력거래량 (전력시장·PPA) 연료원별 회원사별 전력거래금액 (전력시장·PPA) 연료원별 회원사별 정산단가 연료원별 회원사별 회원사현황 가중평균SMP HOME > 전력거래 > 계통한계가격 > 시간별SMP 그래프 선그래프 막대그래프 주기 년 월 Help Image 주기 년 월 기간 20»
- 공개 화면 https://epsis.kpx.or.kr/epsisnew/selectEkmaSmpSmpGrid.do?menuId=040202 — HTTP 404 · 168자