> 판정 5 — 대답은 왔는데 값을 못 뽑았다 — **규격**을 고친다. 열쇠 문제가 아니다 (금융통계종합금융회사정보 5 · 금융통계국내은행정보 0 · 금융통계투자자문사정보 0 · 금융투자협회종합통계정보 0 · 중소벤처기업부_사업공고 4 · 중소기업기술정보진흥원_중소벤처24 공고정보 3 · 자산운용사 영업활동통계정보 0 · 자산운용사정보 4 · 지원사업 공고 조회 서비스 0 · 저축은행정보 0 · 신용협동조합정보 0 · 농업협동조합정보 0 · 수산업협동조합정보 0)

# `FSC_API` — 금융위원회 금융통계 실측 진단

조회일 2026-09-28 · 기준연월 202512

> 주소를 추측하지 않는다 — **포털 안내 페이지에서 읽고** 그대로 부른다 (CLAUDE.md §4.3).

- 포털 개인 인증키 `PERSONAL_API_KEY` — **이 저장소의 Actions 비밀에 없다**
- 열쇠 **`FSC_API`** — **이 저장소의 Actions 비밀에 없다** → 포털 계정 열쇠 `DATA_GO_KR_KEY` 로 대신 건다
- 열쇠 **`FSC_AMC_API`** — **이 저장소의 Actions 비밀에 없다** → 포털 계정 열쇠 `DATA_GO_KR_KEY` 로 대신 건다
- 열쇠 **`FSC_IAF_API`** — **이 저장소의 Actions 비밀에 없다** → 포털 계정 열쇠 `DATA_GO_KR_KEY` 로 대신 건다
- 열쇠 **`FSC_KOFIA_API`** — **이 저장소의 Actions 비밀에 없다** → 포털 계정 열쇠 `DATA_GO_KR_KEY` 로 대신 건다
- 열쇠 **`FSC_DOMESTIC_BANK_API`** — **이 저장소의 Actions 비밀에 없다** → 포털 계정 열쇠 `DATA_GO_KR_KEY` 로 대신 건다
- 열쇠 **`FSC_SAVINGS_BANK_API`** — **이 저장소의 Actions 비밀에 없다** → 포털 계정 열쇠 `DATA_GO_KR_KEY` 로 대신 건다
- 열쇠 **`FSC_CREDIT_UNION_BANK_API`** — **이 저장소의 Actions 비밀에 없다** → 포털 계정 열쇠 `DATA_GO_KR_KEY` 로 대신 건다
- 열쇠 **`FSC__AGRICULTURAL_COOPERATIVE_BANK_API`** — **이 저장소의 Actions 비밀에 없다** → 포털 계정 열쇠 `DATA_GO_KR_KEY` 로 대신 건다
- 열쇠 **`FSC_FISHERIES_COOPERATIVE_BANK_API`** — **이 저장소의 Actions 비밀에 없다** → 포털 계정 열쇠 `DATA_GO_KR_KEY` 로 대신 건다
- 열쇠 **`MSS_SME_SPA_API`** — **이 저장소의 Actions 비밀에 없다** → 포털 계정 열쇠 `DATA_GO_KR_KEY` 로 대신 건다

- 포털 검색 «금융위원회 자산운용» — HTTP 200 · 423272자 · 15061325 자산운용사정보 · 15139266 자산운용사 영업활동통계정보
- 포털 검색 «중소벤처기업부 중소기업 지원사업 공고» — HTTP 200 · 412910자 · 15157820 지원사업 공고 조회 서비스
- 포털 검색 «금융위원회 금융통계 저축은행» — HTTP 200 · 405979자 · 15061316 저축은행정보
- 포털 검색 «금융위원회 금융통계 신용협동조합» — HTTP 200 · 406025자 · 15061337 신용협동조합정보
- 포털 검색 «금융위원회 금융통계 농업협동조합» — HTTP 200 · 406024자 · 15061344 농업협동조합정보
- 포털 검색 «금융위원회 금융통계 수산업협동조합» — HTTP 200 · 406008자 · 15061340 수산업협동조합정보

## 금융위원회_금융통계종합금융회사정보 (15061312) — 종합금융회사 일반·재무·경영지표 · 열쇠 `FSC_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1502ms
  - 뽑은 서비스 `1160100/service/GetMercBankInfoService`
  - 뽑은 오퍼레이션 **없음(못 읽었다)**
  - 둘레 «"key">요청주소</strong> <div class="value"> https://apis.data.go.*** </div> </li> <li> <strong class="key">서비스 URL</strong> <div class="value"> »
- `1160100/service/GetMercBankInfoService/getMercBankGeneInfo · 원본 · 202412` — HTTP 200 · 193ms
  - 본문 «{"response":{"body":{"tableList":[{"items":{"item":[]},"title":"종금사_일반현황_임직원현황","totalCount":0},{"items":{"item":[]},"title":"종금사_일반현황_영업점포현황","totalCount":0}]},"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE.","pageNo":"1","numOfRows":"3"}}}»
  - 항목(totalCount>0) 칸: **못 찾았다**

> **판정 5** — 대답은 왔는데 **값을 못 뽑았다** — 주소·파라미터 규격이 다르다. **열쇠 문제가 아니다.** 아래 본문을 보고 배선을 고친다

## 금융위원회_금융통계국내은행정보 (15061304) — 투자정보 [은행] 탭 후보 · 열쇠 `FSC_DOMESTIC_BANK_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1221ms
  - 뽑은 서비스 `1160100/service/GetDomeBankInfoService`
  - 뽑은 오퍼레이션 **없음(못 읽었다)**
  - 둘레 «"key">요청주소</strong> <div class="value"> https://apis.data.go.*** </div> </li> <li> <strong class="key">서비스 URL</strong> <div class="value"> »
- `1160100/service/GetDomeBankInfoService/getDomeBankGeneInfo · 원본 · 202512` — HTTP 200 · 509ms
  - 본문 «{"response":{"body":{"tableList":[{"items":{"item":[{"basYm":"202512","crno":"1101110023393","fncoCd":"0010001","fncoNm":"우리은행","xcsmCnt":"14211","xcsmDcd":"A","xcsmDcdNm":"총임직원"},{"basYm":"202512","crno":"1101110023393","fncoCd":"0010001","fncoNm":"우리은행","xcsmCnt":"28","xcsmDcd":"A1","xcsmDcdNm":"임» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `표목록(4)` `표.title` `표.totalCount` `basYm` `crno` `fncoCd` `fncoNm` `xcsmCnt` `xcsmDcd` `xcsmDcdNm`

> **판정 0** — **값이 왔다** — 이 후보로 배선한다

## 금융위원회_금융통계투자자문사정보 (15061358) — 투자자문사 일반·재무현황 · 열쇠 `FSC_IAF_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1155ms
  - 뽑은 서비스 `1160100/service/GetInveAdviCompInfoService`
  - 뽑은 오퍼레이션 **없음(못 읽었다)**
  - 둘레 «"key">요청주소</strong> <div class="value"> https://apis.data.go.*** </div> </li> <li> <strong class="key">서비스 URL</strong> <div class="value"> »
- `1160100/service/GetInveAdviCompInfoService/getInveAdviCompGeneInfo · 원본 · 202512` — HTTP 200 · 303ms
  - 본문 «{"response":{"body":{"tableList":[{"items":{"item":[]},"title":"투자자문_일반현황_임직원현황(09.03월이전)","totalCount":0},{"items":{"item":[{"basYm":"202512","crno":"1101110566773","fncoCd":"0010193","fncoNm":"프랭클린템플턴투자자문 주식회사","xcsmCnt":"0","xcsmDcd":"D","xcsmDcdNm":"운용전문인력"},{"basYm":"202512","crno":"11011115415» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `표목록(2)` `표.title` `표.totalCount`

> **판정 0** — **값이 왔다** — 이 후보로 배선한다

## 금융위원회_금융투자협회종합통계정보 (15094809) — 펀드순자산·증시자금·신용공여 추이 · 열쇠 `FSC_KOFIA_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1193ms
  - 뽑은 서비스 `1160100/service/GetKofiaStatisticsInfoService`
  - 뽑은 오퍼레이션 `getTrustScaleInfo` · `getFundTotalNetEssetInfo` · `getCMAStatus` · `getGrantingOfCreditBalanceInfo` · `getSecuritiesMarketTotalCapitalInfo` · `getDLSAndDLBInfo` · `getELSAndELBInfo` · `getDerivationProductTradingInfo`
- `1160100/service/GetKofiaStatisticsInfoService/getTrustScaleInfo · 원본 · 202512` — HTTP 200 · 181ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":330,"items":{"item":[{"basYm":"202512","bzds":"합계","tstCtg":"금전신탁 특정금전신탁","kind":"정기예금형","iqBs":"계약수","val":"107829"},{"basYm":"202512","bzds":"합계","tstCtg":"금전신탁 특정금전신탁","kind":"기타"» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basYm` `bzds` `tstCtg` `kind` `iqBs` `val`
- `1160100/service/GetKofiaStatisticsInfoService/getFundTotalNetEssetInfo · 원본 · 202512` — HTTP 200 · 207ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":28687,"items":{"item":[{"basDt":"20260922","ctg":"-","tstMthdCtg":"공모","nPptTotAmt":"36229761418"},{"basDt":"20260922","ctg":"재간접","tstMthdCtg":"공모","nPptTotAmt":"55853622174489"},{"» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basDt` `ctg` `tstMthdCtg` `nPptTotAmt`
- `1160100/service/GetKofiaStatisticsInfoService/getCMAStatus · 원본 · 202512` — HTTP 200 · 199ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":14448,"items":{"item":[{"basDt":"20260922","mngInvTgt":"합계","invrCtg":"기관","scrtCmpyCnt":"0","actCnt":"147378","actBal":"12214007072315"},{"basDt":"20260922","mngInvTgt":"MMF형","invr» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basDt` `mngInvTgt` `invrCtg` `scrtCmpyCnt` `actCnt` `actBal`
- `1160100/service/GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo · 원본 · 202512` — HTTP 200 · 173ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":1191,"items":{"item":[{"basDt":"20260922","crdTrFingWhl":"32819168401860","crdTrFingScrs":"25609148339779","crdTrFingKosdaq":"7210020062081","crdTrLndrWhl":"34329878973","crdTrLndrSc» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basDt` `crdTrFingWhl` `crdTrFingScrs` `crdTrFingKosdaq` `crdTrLndrWhl` `crdTrLndrScrs` `crdTrLndrKosdaq` `sbscCapLn` `dpsgScrtMogFing`
- `1160100/service/GetKofiaStatisticsInfoService/getSecuritiesMarketTotalCapitalInfo · 원본 · 202512` — HTTP 200 · 174ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":1204,"items":{"item":[{"basDt":"20260922","invrDpsgAmt":"100982554761485","onbdDrvPrdTrRcAdvAmt":"42217285110345","toCstRpchCndBndSlgBal":"110640626185958","brkTrdUcolMny":"853708535» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basDt` `invrDpsgAmt` `onbdDrvPrdTrRcAdvAmt` `toCstRpchCndBndSlgBal` `brkTrdUcolMny` `brkTrdUcolMnyVsOppsTrdAmt` `ucolMnyVsOppsTrdRlImpt`
- `1160100/service/GetKofiaStatisticsInfoService/getDLSAndDLBInfo · 원본 · 202512` — HTTP 200 · 174ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":1176,"items":{"item":[{"basDt":"202607","ctgDlbDls":"원금비보장형","ctgPrplcPsub":"사모","presCtg":"상환현황","amt":"387334000000","ccnt":"46"},{"basDt":"202607","ctgDlbDls":"원금보장형","ctgPrplcPsu» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basDt` `ctgDlbDls` `ctgPrplcPsub` `presCtg` `amt` `ccnt`

> **판정 0** — **값이 왔다** — 이 후보로 배선한다

## 중소벤처기업부_사업공고 (15113297) — [정책자금] 후보 — 중기부 사업공고 · 열쇠 `MSS_SME_SPA_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1322ms
  - 뽑은 서비스 `1421000/mssBizService_v2`
  - 뽑은 오퍼레이션 `getbizList_v2`
- `1421000/mssBizService_v2/getbizList_v2 · 원본 · 202512` — HTTP 403 · 153ms
  - 본문 «{ "OpenAPI_ServiceResponse": { "cmmMsgHeader": { "errMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "returnAuthMsg": "등록되지 않은 서비스키", "returnReasonCode": "30" } } }»
  - 항목(totalCount>0) 칸: **못 찾았다**
  - ★ 본문이 **인증 거부**를 말한다 — 상태코드가 200 이어도 그렇다 (D-229)

> **판정 4** — **인증이 거부됐다** — 열쇠 자체이거나 **그 서비스 등록·신청**이 안 된 것이다. ★ 상태코드가 **200 이어도** 본문이 그렇게 말하는 곳이 있다(ODsay 가 그렇다). 아래 응답 본문이 둘 중 어느 쪽인지 말해 준다

## 중소기업기술정보진흥원_중소벤처24 공고정보 (15113191) — [정책자금] 후보 — 중소벤처24 공고 · 열쇠 `MSS_SME_SPA_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1219ms
  - 뽑은 서비스 **없음(못 읽었다)**
  - 뽑은 오퍼레이션 **없음(못 읽었다)**
  - ★ 부를 주소를 **못 읽었다** — 페이지 모양이 다르거나 막혔다. **열쇠 문제가 아니다**
  - 둘레 « "/images/biz/swagger-guide/gw/gateway_swagger_guide.pdf" window.open(url, "_blank"); }) }) const fn_listCsvDownload = function (filename) { $.»

> **판정 3** — **부를 주소를 못 읽었다** — 안내 페이지를 못 받았거나 모양이 다르다. 열쇠 문제가 아니다

## 금융위원회_자산운용사 영업활동통계정보 (15139266) — 자산운용사 — 후보(검색으로 찾음) · 열쇠 `FSC_AMC_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1139ms
  - 뽑은 서비스 `1160100/service/GetFSSaleActInfoService`
  - 뽑은 오퍼레이션 `getScrtDlngPresInfo` · `getDrvpDlngPresInfo` · `getInvdCminPresInfo` · `getInvdCntrPresInfo` · `getInvdPptPresInfo` · `getInvdPptOperPresInfo`
- `1160100/service/GetFSSaleActInfoService/getScrtDlngPresInfo · 원본 · 202512` — HTTP 200 · 293ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":3520,"items":{"item":[{"basYm":"202512","fncoCd":"0019635","fncoNm":"스피네이커자산운용 주식회사","sttsItemCd":"H","sttsItemNm":"증권합계","sttsItemAmt":"2755335595"},{"basYm":"202512","fncoCd":"0014» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basYm` `fncoCd` `fncoNm` `sttsItemCd` `sttsItemNm` `sttsItemAmt`
- `1160100/service/GetFSSaleActInfoService/getDrvpDlngPresInfo · 원본 · 202512` — HTTP 200 · 245ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":792,"items":{"item":[{"basYm":"202512","fncoCd":"0012121","fncoNm":"브레인자산운용","sttsItemCd":"A1","sttsItemNm":"선물","sttsItemAmt":"801488982500"},{"basYm":"202512","fncoCd":"0019431","f» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basYm` `fncoCd` `fncoNm` `sttsItemCd` `sttsItemNm` `sttsItemAmt`
- `1160100/service/GetFSSaleActInfoService/getInvdCminPresInfo · 원본 · 202512` — HTTP 200 · 216ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":1368,"items":{"item":[{"basYm":"202512","fncoCd":"0010183","fncoNm":"교보악사자산운용","sttsItemCd":"A1","sttsItemNm":"일반투자자","sttsItemAmt":"0"},{"basYm":"202512","fncoCd":"0019588","fncoNm"» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basYm` `fncoCd` `fncoNm` `sttsItemCd` `sttsItemNm` `sttsItemAmt`
- `1160100/service/GetFSSaleActInfoService/getInvdCntrPresInfo · 원본 · 202512` — HTTP 200 · 237ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":972,"items":{"item":[{"basYm":"202512","fncoCd":"0010170","fncoNm":"하나자산운용","sttsItemCd":"A","sttsItemNm":"고객수","sttsItemAmt":"14"},{"basYm":"202512","fncoCd":"0016797","fncoNm":"파이브» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basYm` `fncoCd` `fncoNm` `sttsItemCd` `sttsItemNm` `sttsItemAmt`
- `1160100/service/GetFSSaleActInfoService/getInvdPptPresInfo · 원본 · 202512` — HTTP 200 · 236ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":1452,"items":{"item":[{"basYm":"202512","fncoCd":"0013784","fncoNm":"웰스자산운용","sttsItemCd":"A1","sttsItemNm":"일반투자자","sttsItemAmt":"0"},{"basYm":"202512","fncoCd":"0010210","fncoNm":"» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basYm` `fncoCd` `fncoNm` `sttsItemCd` `sttsItemNm` `sttsItemAmt`
- `1160100/service/GetFSSaleActInfoService/getInvdPptOperPresInfo · 원본 · 202512` — HTTP 200 · 235ms
  - 본문 «{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"numOfRows":3,"pageNo":1,"totalCount":964,"items":{"item":[{"basYm":"202512","fncoCd":"0010215","fncoNm":"플러스자산운용","sttsItemCd":"A","sttsItemNm":"유동성자산","sttsItemDmstAmt":"119849171692","sttsItemOvseAmt":"0"},{"basYm":"2» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `basYm` `fncoCd` `fncoNm` `sttsItemCd` `sttsItemNm` `sttsItemDmstAmt` `sttsItemOvseAmt`

> **판정 0** — **값이 왔다** — 이 후보로 배선한다

## 자산운용사정보 (15061325) — 자산운용사 — 포털 검색에서 찾음 · 열쇠 `FSC_AMC_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1245ms
  - 뽑은 서비스 `1160100/service/GetAsseManaCompInfoService`
  - 뽑은 오퍼레이션 **없음(못 읽었다)**
  - 둘레 «"key">요청주소</strong> <div class="value"> https://apis.data.go.*** </div> </li> <li> <strong class="key">서비스 URL</strong> <div class="value"> »
- `1160100/service/GetAsseManaCompInfoService/getAsseManaCompGeneInfo · 원본 · 202512` — HTTP 403 · 154ms
  - 본문 «{ "OpenAPI_ServiceResponse": { "cmmMsgHeader": { "errMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "returnAuthMsg": "등록되지 않은 서비스키", "returnReasonCode": "30" } } }»
  - 항목(totalCount>0) 칸: **못 찾았다**
  - ★ 본문이 **인증 거부**를 말한다 — 상태코드가 200 이어도 그렇다 (D-229)

> **판정 4** — **인증이 거부됐다** — 열쇠 자체이거나 **그 서비스 등록·신청**이 안 된 것이다. ★ 상태코드가 **200 이어도** 본문이 그렇게 말하는 곳이 있다(ODsay 가 그렇다). 아래 응답 본문이 둘 중 어느 쪽인지 말해 준다

## 지원사업 공고 조회 서비스 (15157820) — 투자정보 [정책자금] 탭 후보 — 포털 검색에서 찾음 · 열쇠 `MSS_SME_SPA_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1409ms
  - 뽑은 서비스 `1421000/bizinfo`
  - 뽑은 오퍼레이션 `pblancBsnsService`
- `1421000/bizinfo/pblancBsnsService · 원본 · 202512` — HTTP 200 · 264ms
  - 본문 «<response> <header> <resultCode>00</resultCode> <resultMsg>NORMAL_SERVICE</resultMsg> </header> <body> <items> <item> <pblancNm><![CDATA[2026년 하반기 산청군 단체관광객 유치 인센티브 지원 공고]]></pblancNm> <!-- 공고명 --> <pblancUrl>https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000126818</pb» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 서버 Apache

> **판정 0** — **값이 왔다** — 이 후보로 배선한다

## 저축은행정보 (15061316) — 저축은행 일반·재무·주요경영지표 · 열쇠 `FSC_SAVINGS_BANK_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1248ms
  - 뽑은 서비스 `1160100/service/GetMutuSaviBankInfoService`
  - 뽑은 오퍼레이션 **없음(못 읽었다)**
  - 둘레 «"key">요청주소</strong> <div class="value"> https://apis.data.go.*** </div> </li> <li> <strong class="key">서비스 URL</strong> <div class="value"> »
- `1160100/service/GetMutuSaviBankInfoService/getMutuSaviBankGeneInfo · 원본 · 202512` — HTTP 200 · 261ms
  - 본문 «{"response":{"body":{"tableList":[{"items":{"item":[{"basYm":"202512","crno":"1101110126014","fncoCd":"0010345","fncoNm":"애큐온저축은행","xcsmCnt":"384","xcsmDcd":"A","xcsmDcdNm":"총임직원"},{"basYm":"202512","crno":"1101110126014","fncoCd":"0010345","fncoNm":"애큐온저축은행","xcsmCnt":"18","xcsmDcd":"A1","xcsmDcdNm» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `표목록(2)` `표.title` `표.totalCount` `basYm` `crno` `fncoCd` `fncoNm` `xcsmCnt` `xcsmDcd` `xcsmDcdNm`

> **판정 0** — **값이 왔다** — 이 후보로 배선한다

## 신용협동조합정보 (15061337) — 신용협동조합 일반·재무·주요경영지표 · 열쇠 `FSC_CREDIT_UNION_BANK_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1398ms
  - 뽑은 서비스 `1160100/service/GetCredUnioInfoService`
  - 뽑은 오퍼레이션 **없음(못 읽었다)**
  - 둘레 «"key">요청주소</strong> <div class="value"> https://apis.data.go.*** </div> </li> <li> <strong class="key">서비스 URL</strong> <div class="value"> »
- `1160100/service/GetCredUnioInfoService/getCredUnioGeneInfo · 원본 · 202512` — HTTP 200 · 1305ms
  - 본문 «{"response":{"body":{"tableList":[{"items":{"item":[{"basYm":"202512","crno":"","fncoCd":"00106561002","fncoNm":"정락","xcsmCnt":"16","xcsmDcd":"A","xcsmDcdNm":"총임직원"},{"basYm":"202512","crno":"","fncoCd":"00106561002","fncoNm":"정락","xcsmCnt":"10","xcsmDcd":"A1","xcsmDcdNm":"임 원"},{"basYm":"202512","c» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `표목록(2)` `표.title` `표.totalCount` `basYm` `crno` `fncoCd` `fncoNm` `xcsmCnt` `xcsmDcd` `xcsmDcdNm`

> **판정 0** — **값이 왔다** — 이 후보로 배선한다

## 농업협동조합정보 (15061344) — 농업협동조합 일반·재무·주요경영지표 · 열쇠 `FSC__AGRICULTURAL_COOPERATIVE_BANK_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1130ms
  - 뽑은 서비스 `1160100/service/GetAgriCoopInfoService`
  - 뽑은 오퍼레이션 **없음(못 읽었다)**
  - 둘레 «"key">요청주소</strong> <div class="value"> https://apis.data.go.*** </div> </li> <li> <strong class="key">서비스 URL</strong> <div class="value"> »
- `1160100/service/GetAgriCoopInfoService/getAgriCoopGeneInfo · 원본 · 202512` — HTTP 200 · 386ms
  - 본문 «{"response":{"body":{"tableList":[{"items":{"item":[{"basYm":"202512","crno":"1146360000288","fncoCd":"0010027100089","fncoNm":"남서울농협","xcsmCnt":"174","xcsmDcd":"A","xcsmDcdNm":"총임직원"},{"basYm":"202512","crno":"1146360000288","fncoCd":"0010027100089","fncoNm":"남서울농협","xcsmCnt":"23","xcsmDcd":"A1","x» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `표목록(2)` `표.title` `표.totalCount` `basYm` `crno` `fncoCd` `fncoNm` `xcsmCnt` `xcsmDcd` `xcsmDcdNm`

> **판정 0** — **값이 왔다** — 이 후보로 배선한다

## 수산업협동조합정보 (15061340) — 수산업협동조합 일반·재무·주요경영지표 · 열쇠 `FSC_FISHERIES_COOPERATIVE_BANK_API`

- 건 열쇠: `DATA_GO_KR_KEY`
- 안내 페이지 — HTTP 200 · 1364ms
  - 뽑은 서비스 `1160100/service/GetFishCoopInfoService`
  - 뽑은 오퍼레이션 **없음(못 읽었다)**
  - 둘레 «"key">요청주소</strong> <div class="value"> https://apis.data.go.*** </div> </li> <li> <strong class="key">서비스 URL</strong> <div class="value"> »
- `1160100/service/GetFishCoopInfoService/getFishCoopGeneInfo · 원본 · 202512` — HTTP 200 · 320ms
  - 본문 «{"response":{"body":{"tableList":[{"items":{"item":[{"basYm":"202512","crno":"","fncoCd":"0010028100970","fncoNm":"근해안강망수협","xcsmCnt":"2","xcsmDcd":"A11","xcsmDcdNm":"임 원_상근 이사 및 감사"},{"basYm":"202512","crno":"","fncoCd":"0010028100970","fncoNm":"근해안강망수협","xcsmCnt":"7","xcsmDcd":"A12","xcsmDcdNm":"임» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 항목(totalCount>0) 칸: **찾았다**
  - 칸 이름 `표목록(2)` `표.title` `표.totalCount` `basYm` `crno` `fncoCd` `fncoNm` `xcsmCnt` `xcsmDcd` `xcsmDcdNm`

> **판정 0** — **값이 왔다** — 이 후보로 배선한다
