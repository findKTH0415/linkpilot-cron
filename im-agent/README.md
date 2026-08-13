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
npm test                      # 82개 회귀 테스트 (네트워크 불필요)
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
03 Research     시장분석 (산출물은 전부 verified=false — 재무모델에 투입 금지)
04 Financial    Base/Upside/Downside 3개 시나리오 + 민감도  ← LLM 미사용
05 Validation   값 충돌·정합성·범위·법률 → RED/YELLOW/GREEN + QC Score  ← LLM 미사용
06 IM Writer    20개 절 IM + Teaser + 수치 출처표
──────────────  사람 승인 게이트 (여기부터는 사람만 통과시킬 수 있다)
Phase 3         Distribution (미구현)
```

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
