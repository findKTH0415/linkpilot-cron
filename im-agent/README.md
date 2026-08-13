# LinkPilot IM & Report Automation Agent (Phase 1)

프로젝트 자료를 넣으면 **재무모델 → 교차검증 → IM/Teaser**까지 만들어내는 Agent 파이프라인.
아침 브리핑 크론(`send-morning-*.js`)과 완전히 분리되어 있으며 서로 영향을 주지 않는다.

## 이 시스템이 지키는 두 가지 원칙

이 저장소의 설계는 전부 아래 두 문장에서 나온다. 나머지는 구현 세부다.

**① 출처 없는 숫자는 시스템에 들어올 수 없다.**
모든 값은 `Value / Unit / Source / Source Date / Page / Confidence / Verified / Last Updated`
를 반드시 동반한다. `source`가 없으면 `Fact` 객체 생성 자체가 예외로 실패한다
(`core/facts.js`). 우회 경로는 없다.

**② 숫자는 LLM이 만들지 않는다.**
IRR·NPV·DSCR·Exit Value는 전부 `finance/` 의 결정적 함수가 계산한다. LLM은 문장과
분류만 담당한다. IM 본문에서 LLM은 숫자를 직접 쓸 수 없고 `{{key}}` 자리표시자만 쓸 수
있으며, 치환 전 원문에 남은 숫자는 전부 '출처 없는 숫자'로 검출되어 배포가 차단된다
(`agents/06-im-writer.js`).

## 빠른 실행

```bash
npm test                      # 113개 회귀 테스트 (네트워크 불필요)
npm run im:demo               # 샘플 자료로 전체 흐름 시연 (LLM 없이 동작)

node im-agent/cli.js new "인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성"
# → 02_Source_Data 에 원본자료를 넣고
node im-agent/cli.js run LP-DC-2026-001
node im-agent/cli.js status LP-DC-2026-001
node im-agent/cli.js approve LP-DC-2026-001 --by "홍길동" --comment "IC 통과"
```

## 파이프라인

```
01 Project      요청문 → Project ID(LP-DC-2026-001) + 13개 표준 폴더
02 Extraction   원본자료 → Fact (규칙 기반 + LLM 보완, 근거 문구 필수)
07 Geo          공공데이터: 지오코딩·지적도·용도지역·건축물대장  ← LLM 미사용
03 Research     시장분석 (산출물은 전부 verified=false — 재무모델에 투입 금지)
04 Financial    Base/Upside/Downside 3개 시나리오 + 민감도  ← LLM 미사용
08 Appraisal    감정평가 3방식 (공시지가·거래사례·수익환원)  ← LLM 미사용
09 Massing      건축 3D 매스 + 용적률/건폐율 법정한도 검토  ← LLM 미사용
05 Validation   값 충돌·정합성·범위·법률 → RED/YELLOW/GREEN + QC Score  ← LLM 미사용
06 IM Writer    20개 절 IM + Teaser + 수치 출처표
──────────────  사람 승인 게이트 (여기부터는 사람만 통과시킬 수 있다)
Phase 3         Distribution (미구현)
```

07/08/09는 부동산개발 전용이다. 데이터가 없으면 경고만 남기고 건너뛰므로
데이터센터·태양광 등 다른 자산유형 실행에는 영향이 없다.

각 Agent는 실패해도 파이프라인 전체를 죽이지 않는다. 실패는 격리되고 `run-log.jsonl`
에 남으며, 뒤 단계는 확보된 데이터만으로 계속 진행한다.

## 환각을 막는 구체적 장치

| 장치 | 위치 | 동작 |
|---|---|---|
| 출처 강제 | `core/facts.js` | `source` 없는 Fact 생성 시 예외 |
| 값 충돌 보존 | `core/facts.js` | 다른 값을 덮어쓰지 않고 후보로 모두 보관 → RED FLAG |
| 교차 검증 승격 | `core/facts.js` | 독립 출처 2건 이상 일치할 때만 `verified=true` |
| LLM 추출 근거 검사 | `agents/02-extraction.js` | `quote`가 원문에 실제로 없으면 그 값을 폐기 |
| 숫자 직접 기재 금지 | `agents/06-im-writer.js` | 치환 전 원문의 숫자를 전부 검출 |
| 승인 차단 | `core/gate.js` | RED FLAG나 출처 없는 숫자가 있으면 승인 불가 |
| AI 자동승인 금지 | `core/gate.js` | `approver`가 AI로 보이면 예외 |

## 부동산개발 Agent (07 / 08 / 09)

### 07 Geo — 위성지도 · 지적

이 Agent의 가치는 지도 그림이 아니라 **독립된 두 번째 출처**다. 지적공부의 대지면적과
건축물대장의 연면적은 사업계획서와 무관한 출처이므로, 값이 일치하면 `verified` 로
승격되고 다르면 RED FLAG가 뜬다. 판정은 `core/facts.js` 가 자동으로 한다.

| 조회 | 출처 | 캐시 TTL |
|---|---|---|
| 주소 → 좌표 | VWorld 지오코딩 | 180일 |
| 좌표 → 필지 폴리곤·PNU·공부상 면적 | VWorld 연속지적도 | 180일 |
| 용도지역 → 용적률/건폐율 상한 | VWorld 토지이용계획 | 30일 |
| 기존 건축물 연면적·건폐율·층수 | 건축물대장(국토교통부) | 30일 |

프로젝트당 최대 5회 호출. 전부 캐시되므로 **재실행 시 0회**다.
지도 이미지 URL에는 인증키가 포함되므로 IM 본문에는 키 없는 공개 지도 링크만 넣는다.
위성영상 다운로드는 쿼터 절약을 위해 기본 비활성이다 (`IM_AGENT_FETCH_IMAGES=1`).

### 08 Appraisal — 감정평가 (참고용 간이 평가)

> ⚠ **법적 고지**: 대한민국에서 감정평가는 「감정평가 및 감정평가사에 관한 법률」에 따라
> 감정평가법인등만 수행할 수 있다. 이 Agent의 산출물은 **법정 감정평가가 아니며**
> 법적 효력이 없다. 모든 산출물과 IM 부록에 이 문구가 자동으로 따라붙는다.

3방식을 병행하고 가중평균(거래사례 50% / 수익환원 30% / 공시지가 20%)으로 결론을 낸다.

| 방식 | 산정 | 데이터 |
|---|---|---|
| 공시지가 기준 | 개별공시지가 × 면적 × 현실화계수 | VWorld NED |
| 거래사례비교법 | 인근 실거래 ㎡단가 중앙값 × 면적 | 국토교통부 실거래가 |
| 수익환원법 | (안정화 NOI ÷ Cap Rate) − 건물가치 | 04_financial 결과 |

방식 간 편차가 2배 이상이면 RED, 1.5배 이상이면 YELLOW다. 사업계획서상 토지비가
평가액의 1.3배를 넘으면 고가매입 RED FLAG가 뜬다. **단, 평가방식이 1개뿐이면
토지비 적정성 판단을 하지 않는다** — 수익환원법 단독값은 Cap Rate 가정에 그대로
끌려다니므로 그것만으로 단정하면 오경보가 된다.

### 09 Massing — 건축 3D 매스

목적은 예쁜 3D가 아니라 **계획안이 법적으로 성립하는지 확인**하는 것이다.
사업계획서의 연면적이 용적률 상한을 넘으면 그 사업계획은 성립하지 않으며,
이것은 IM 배포 전에 반드시 잡아야 할 RED FLAG다.

| 산출물 | 용도 |
|---|---|
| `04_Property/massing.obj` | 스케치업·라이노·블렌더 |
| `04_Property/massing.gltf` | 웹 뷰어·파워포인트 3D 삽입 (버퍼 내장 단일 파일) |
| `04_Property/massing.svg` | IM 삽입용 아이소메트릭 프리뷰 |

필지 폴리곤이 있으면 실제 지적 형상을 건축면적 비율로 축소해 쓰고, 없으면 직사각형으로
근사한 뒤 그 사실을 YELLOW로 남긴다. 용도지역별 용적률/건폐율 상한은 국토계획법
시행령 기준 내장 테이블을 쓰며, **지자체 조례가 더 강할 수 있으므로 참고 상한**이다.

## 공공데이터 Connector Layer

CLAUDE.md의 `일 10,000건 한도 · 동일 데이터 재호출 금지` 규칙을 `connectors/cache.js` 가
강제한다. Connector는 반드시 이곳을 통과해야 한다.

- **캐시 히트는 네트워크도 쿼터도 소모하지 않는다.** 데이터 성격별 TTL을 둔다
  (지오코딩 180일 / 공시지가·용도지역 30일 / 실거래가 7일).
- **쿼터 소진 시 호출 자체를 거부**하고 사유를 남긴다. 조용히 실패하지 않는다.
- 쿼터 카운터는 **KST 날짜** 기준으로 리셋된다 (UTC 자정이 아니다).
- 실패는 3회 재시도(1s/2s/4s) 후 예외 대신 `{ok:false}` 를 돌려준다. 한 소스가 죽어도
  IM 생성 전체를 죽이지 않는다.
- 로그·에러 메시지의 서비스키는 자동 마스킹된다.

```bash
node im-agent/cli.js quota      # 오늘 사용량·한도·캐시 위치
```

## 재무모델 규약 (`finance/model.js`)

IM '가정' 절에 그대로 실리는 내용이다.

- 연 단위, 기말 현금흐름. 0기 = 착공 직전. 금액 단위 **억원**.
- 자기자본 선투입(equity-first) → 소진 후 차입 인출.
- 건설기간 이자(IDC)를 자본화하여 총사업비에 가산하고, 차입금을 고정점 반복(5회)으로 재계산.
  → **모델 총사업비가 문서 총사업비보다 크게 나오는 것이 정상이며**, 문서 수치에 IDC가
  이미 포함돼 있으면 중복 계상이므로 Validation이 `TPC_GAP` 경고를 낸다.
- 감가상각 정액법(상각대상 = 총사업비 − 토지비), 세무상 결손금 이월.
- Exit = 매각연도 다음 해 NOI ÷ Cap Rate − 매각부대비용.
- **미반영**: 운전자본, 부가세, 준공 후 추가 CAPEX, 분기/월 단위 현금흐름.

## Data Dictionary (`core/dictionary.js`)

정규화 단위 고정: 금액 `억원` · 면적 `㎡` · 전력 `MW` · 비율 `%` · 기간 `년`.
문서의 `1조 2,000억원`, `284,600백만원`, `평` 표기는 추출 시 자동 환산된다.
`returns.*` 는 계산 전용 key로, 추출·입력이 불가능하다.

## 지원 파일 포맷

| 포맷 | 상태 |
|---|---|
| txt / md / csv / tsv / json / html / xml | 직접 파싱 |
| docx / xlsx / pptx | 내장 `zlib` 기반 ZIP 리더로 텍스트 추출 (`core/unzip.js`, 의존성 0) |
| **pdf / 이미지 / hwp** | **미지원** — 조용히 건너뛰지 않고 경고로 남긴다 |

PDF·OCR은 새 의존성 승인이 필요하다. 승인 전까지 `toText()`의 어댑터 자리만 비워두었다.

## Agent Control Center

```bash
node im-agent/cli.js agents
```

Agent별로 `enabled / confidenceThreshold / approvalRule` 을 `core/registry.js` 에서
관리한다. 환경변수로 개별 차단도 가능하다:

```bash
IM_AGENT_DISABLE="03_research" node im-agent/cli.js run LP-DC-2026-001
```

## 환경변수

| 이름 | 용도 |
|---|---|
| `IM_AGENT_ROOT` | 프로젝트 데이터룸 루트 (기본 `./im-projects`, gitignore 대상) |
| `IM_AGENT_OFFLINE` | `1` 이면 LLM 호출 없이 결정적 경로만 실행 (CI가 사용) |
| `IM_AGENT_DISABLE` | 끌 Agent 목록 (쉼표 구분) |
| `GEMINI_API_KEY` | LLM 사용 시. 콤마로 여러 키 지정하면 자동 로테이션 (GitHub Secrets) |
| `GEMINI_MODELS` | 모델 폴백 순서 (기본 `gemini-2.5-flash,gemini-2.0-flash`) |
| `VWORLD_KEY` | VWorld 인증키 — 지오코딩·지적도·용도지역·공시지가 |
| `DATA_GO_KR_KEY` | 공공데이터포털 서비스키(디코딩된 일반키) — 실거래가·건축물대장 |
| `IM_AGENT_QUOTA` | 일일 호출 한도 (기본 10000). 제공자별로 `IM_AGENT_QUOTA_VWORLD` 등 |
| `IM_AGENT_CACHE` | 공공데이터 캐시 경로 (기본 `<IM_AGENT_ROOT>/.cache`) |
| `IM_AGENT_FETCH_IMAGES` | `1` 이면 위성영상을 내려받는다 (기본 비활성 — 쿼터 절약) |
| `IM_AGENT_LAND_REALIZATION` | 공시지가 대비 시가 현실화계수 (기본 1.6) |

시크릿은 코드·로그·커밋에 남기지 않는다. `im-projects/` 는 실제 딜 자료가 들어가므로
`.gitignore` 로 차단되어 있다.

## Phase 2 / 3 (미구현)

`core/registry.js` 의 `PLANNED` 에 자리만 선언해 두었다. Control Center에 '미구현'으로
노출되므로 있는 척하지 않는다.

- **Phase 2**: Legal / Technical / Risk / Design(PDF·PPT) / Reviewer
- **Phase 3**: Distribution, Investor Matching, CRM, Data Room

Distribution은 되돌릴 수 없는 외부 발송이므로 `gate.distributionAllowed()` 를 반드시
통과해야 하도록 인터페이스만 먼저 고정해 두었다.

## 알려진 한계

1. 시장조사(`03_research`)는 Connector가 없어 LLM 기억에 의존한다. 산출물은 전부
   `verified=false` 이며 수치는 재무모델에 들어가지 않지만, **운영 투입 전 웹검색·통계
   API Connector를 붙여 URL 출처를 강제해야 한다.**
2. 규칙 기반 추출은 `항목 : 값` 형태의 줄에 강하고, 병합셀이 많은 복잡한 표에는 약하다.
3. 재무모델은 연 단위다. 분기·월 단위 인출 스케줄이 필요한 PF 딜에는 정밀도가 부족하다.
4. 민감도는 2변수 매트릭스 1개만 산출한다.
5. **공공데이터 API 응답 스키마는 실제 키로 검증하지 않았다.** 엔드포인트·파라미터는
   공식 문서 기준으로 작성했고 파서는 JSON/XML(한글 태그 포함) 양쪽을 흡수하도록
   만들었지만, 필드명이 문서와 다를 가능성이 남아 있다. **실제 키를 등록한 뒤
   `node im-agent/cli.js quota` 와 실거래 1건 조회로 스모크 테스트가 필요하다.**
6. 용도지역별 용적률/건폐율 상한은 국토계획법 시행령 기준이다. 지자체 조례가 더
   강한 경우가 흔하므로 확정 판단에는 조례 확인이 필요하다.
7. 매스 모델은 대지 형상을 면적비로 축소한 근사이며, 이격거리·사선제한·주차장 기준을
   반영하지 않는다. 설계 검토가 아니라 규모 검토용이다.
