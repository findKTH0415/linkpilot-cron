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
npm test                      # 182개 회귀 테스트 (네트워크 불필요)
npm run im:demo               # 샘플 자료로 전체 흐름 시연 (LLM 없이 동작)

node im-agent/cli.js new "인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성"
# → 02_Source_Data 에 원본자료를 넣고
node im-agent/cli.js run LP-DC-2026-001
node im-agent/cli.js status LP-DC-2026-001
node im-agent/cli.js approve LP-DC-2026-001 --by "홍길동" --comment "IC 통과"
```

## 파이프라인

```
10 Output Spec  출력 사양 제안 (페이지·크기·형식·언어) — 사람이 확정해야 LOCK
01 Project      요청문 → Project ID(LP-DC-2026-001) + 13개 표준 폴더
02 Extraction   원본자료 → Fact (규칙 기반 + LLM 보완, 근거 문구 필수)
07 Geo          공공데이터: 지오코딩·지적도·용도지역·건축물대장  ← LLM 미사용
03 Research     시장분석 (산출물은 전부 verified=false — 재무모델에 투입 금지)
04 Financial    Base/Upside/Downside 3개 시나리오 + 민감도  ← LLM 미사용
08 Appraisal    감정평가 3방식 (공시지가·거래사례·수익환원)  ← LLM 미사용
09 Massing      건축 3D 매스 + 용적률/건폐율 법정한도 검토  ← LLM 미사용
05 Validation   값 충돌·정합성·범위·법률 → RED/YELLOW/GREEN + QC Score  ← LLM 미사용
06 IM Writer    20개 절 IM + Teaser + 수치 출처표
11 Final Valid. 8개 GATE 독립 검증 + 재계산 + 추적성  ← LLM 미사용
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

## 최종 검증 게이트 (11_final_validation)

이 저장소에서 **가장 중요한 Agent**다. 앞선 Agent의 결과를 신뢰하지 않는 독립 제3자 검증이다.

### GATE 03 이 핵심이다 — 왜 모델을 다시 부르지 않는가

`buildModel()` 을 다시 호출하면 **같은 코드가 같은 답을 낸다.** 그건 검증이 아니다.
그래서 이렇게 한다:

1. 모델이 **발표한 현금흐름표(periods)** 만 입력으로 받는다 (모델 입력은 보지 않는다)
2. IRR을 **Newton-Raphson** 으로 다시 푼다 (원본은 이분법 — 알고리즘이 다르다)
3. 표 자체의 항등식을 재검산한다 (NOI = 매출 − 운영비, CFADS = NOI − 세금, 원리금 = 이자 + 원금)

실측 결과 — 정상 모델은 14개 항목 전부 오차 0%:

```
| 지표          | 발표값   | 독립계산 | 차이(%) | 판정 |
| 차입+자본=총사업비 | 2,961.95 | 2,961.95 |      0 | PASS |
| Project IRR   |    12.08 |    12.08 |      0 | PASS |
| Equity IRR    |    15.92 |    15.92 |      0 | PASS |
| NPV           | 1,274.99 | 1,274.99 |      0 | PASS |
```

발표값만 몰래 바꾸면 잡힌다:

```
Equity IRR 을 15.92 → 22.5 로 조작
→ CRITICAL: 발표값 22.5 vs 독립계산 15.92 (차이 29.244%)
```

### 8개 GATE

| GATE | 검사 | LLM |
|---|---|:--:|
| 01 Source | 핵심 항목 출처·기준일·페이지 | 미사용 |
| 02 Data | 단위 일관성, 기준일 격차, 오래된 자료 | 미사용 |
| 03 Calculation | **독립 재계산 (Newton-Raphson)** | 미사용 |
| 04 Cross | 값충돌, IM↔재무모델, IM↔Teaser, IM↔3D, GIS↔공부 | 미사용 |
| 05 Legal | 인허가·소유권·용적률 법정한도 | 미사용 |
| 06 Financial | DSCR, 가정치 비중, Downside 생존 | 미사용 |
| 07 Document | 출처 없는 숫자, 디자인 규칙, 출처표 | 미사용 |
| 08 Distribution | 출력사양 확정, 페이지 예산 | 미사용 |

**전 구간 LLM 미사용.** 검증을 언어모델에 맡기면 검증 자체를 신뢰할 수 없다.

### 오차 등급 · 최종 판정

```
0~0.5% PASS · 0.5~1% MINOR · 1~3% WARNING · 3~5% MAJOR · >5% CRITICAL

점수 100점: Data 20 · Source 15 · Financial 20 · Cross 15 · Legal 10
            Market 5 · Document 5 · Visual 5 · Traceability 5

95+ APPROVED · 90~94 CONDITIONAL · 80~89 REVIEW · 70~79 REVISION · <70 BLOCKED
CRITICAL 1건이라도 있으면 점수와 무관하게 BLOCKED
```

### 산출물 4종

```
11_QC/validation-report.md    전체 검증 결과 + 독립 재계산 표
11_QC/red-flag-report.md      미해결 위험사항 (ID·분류·조치·상태)
11_QC/traceability-report.md  핵심 수치 원천자료 추적표
12_Final/manifest.json        출력 매니페스트
```

```bash
node im-agent/cli.js validate LP-DC-2026-001
```

## 출력 사양 확정 (10_output_spec)

**순서가 핵심이다.** 콘텐츠를 먼저 만들고 나중에 페이지 수·형식을 정하면, 이미 만든 것에
사양을 끼워맞추게 된다.

```
출력 사양 확정 → 콘텐츠 생성 → 디자인 → 렌더링 → 최종 QC
```

**AI는 제안만 하고 확정하지 않는다.** 사양이 LOCK 되기 전에는 산출물이 DRAFT 이며
승인 게이트를 통과하지 못한다.

```bash
node im-agent/cli.js spec show LP-DC-2026-001
node im-agent/cli.js spec set LP-DC-2026-001 --pages 40 --size A4 --formats html,json
node im-agent/cli.js spec confirm LP-DC-2026-001 --by "홍길동"   # 사람만 가능
```

- **페이지 예산**: "약 30페이지"라고 쓰지 않는다. 절별 분량 가중치로 배분한 뒤 목표에 맞춘다.
  내용을 임의로 삭제하지 않고 배분만 조정한다.
- **중대 변경 시 버전 상승**: 페이지 수·크기·방향·형식·언어·테마를 바꾸면 확정이 해제되고
  버전이 올라간다. 다시 사람이 확인해야 한다.
- **만들 수 없는 형식은 사양에서 막는다**: HWP·PPTX·DOCX 를 사양에 넣으면 확정 단계에서
  거부된다. 만들 수 있는 척하지 않는다.

| 형식 | 상태 |
|---|---|
| `html` (A4 인쇄본) · `json` (뷰어) · `md` | 생성 가능 |
| `pdf` | HTML을 브라우저 인쇄로 출력 (헤드리스 렌더러 미탑재) |
| `pptx` · `docx` · `xlsx` | 의존성 추가 승인 필요 |
| `hwp` | 생성 불가 |

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

## PDI 디자인 시스템 적용

`design_handoff_grand_hyatt` · `PDI SOLAR REPORT SPEC` 핸드오프를 적용했다.
적합성 분석과 충돌 교차검증 결과는 **`docs/DESIGN-ADOPTION.md`** 에 있다.

| 파일 | 역할 |
|---|---|
| `design/tokens.js` | 디자인 토큰 단일 소스 (Navy/Gold/Cream · Noto Serif/Sans · 금액 포맷터) |
| `design/a4.js` | A4 인쇄 HTML — 표지 → 중요고지 → 목차 → Chapter → 연락처(END) |
| `design/content.js` | 기존 IM 뷰어 계약(`content.json`) — 뷰어를 다시 만들지 않는다 |
| `design/rules.json` | 디자인 규칙 **단일 소스** — 게이트와 문서가 같은 파일을 읽는다 |
| `design/check.js` | 규칙 게이트. RED 위반은 승인·배포를 차단한다 |

산출물은 두 갈래다.

```
12_Final/im-a4.html    자립형 A4 인쇄본 (그대로 PDF 출력 가능)
12_Final/content.json  기존 design_handoff_*/build/ 뷰어에 넣으면 그대로 렌더
```

### 게이트가 실제로 잡은 것

규칙을 문서에만 적었다면 그대로 배포됐을 위반 3건을 도입 즉시 검출했다.

| 위반 | 내용 |
|---|---|
| `D5-palette` | 매스 SVG가 아침 브리핑 팔레트(`#C00000`/Arial)를 쓰고 있었다 |
| `D3-no-emoji` | 대외 문서에 `⚠` 기호가 들어가 있었다 |
| `D2-caption-prefix` | 표에 `자료출처:` 캡션이 없었다 |

게이트 자체도 시험한다(`test/design.test.js`) — 일부러 위반을 만들어 검출되는지 확인한다.

### 서식 적용 구간 (태양광 스펙 §10)

> "값은 토큰으로 갈아끼워지지만 서술문은 그대로 남는다.
>  숫자는 게이트가 지키지만 문장은 지킬 수 없다."

자산유형 템플릿의 기본 가정은 특정 규모대를 전제로 한다. 사업이 그 구간을 벗어나면
수치는 맞아도 서술이 다른 구간 기준이 되므로, IM 첫머리와 표지에 그 사실을 밝힌다
(`finance/templates.js` 의 `SCALE_BANDS`). 구간 안이면 빈 문자열이라 문서가 달라지지 않는다.

### Confidence 등급 (A~E)

등급은 **파생값**이다. 기존 `(confidence + verified + source)` 에서 계산되며 따로 저장하지 않는다
(`core/confidence.js`). 두 곳에 적으면 반드시 어긋난다.

```
A 공적장부·감사자료·계산결과   B 신뢰 외부출처(단일)   C 문서 기반 추정
D 템플릿 통상치·모델 가정      E 출처 미확인 ← 본문 사용 금지
```

## 디자인 선택 (테마 13종)

사용자가 프로젝트 성격에 맞는 디자인을 고르면 **IM·보고서·PPT·Dashboard 전체에 같은 테마가
적용된다.** 테마는 코드가 아니라 **데이터**이고, 렌더러는 색을 하드코딩하지 않는다
(`design/themes.js`). 그래야 A4·PPT·Dashboard 가 같은 파일을 읽고 같은 결과를 낸다.

```bash
node im-agent/cli.js design list                       # 13종 목록
node im-agent/cli.js design recommend LP-DC-2026-001   # AI 추천 상위 3개 + 근거
node im-agent/cli.js design preview --theme luxury     # 미리보기 HTML
node im-agent/cli.js design set LP-DC-2026-001 --theme technology --by "홍길동"
node im-agent/cli.js run LP-DC-2026-001                # 새 디자인으로 재렌더
node im-agent/cli.js design history LP-DC-2026-001
node im-agent/cli.js design revert LP-DC-2026-001 --version 1.0 --by "홍길동"
```

| # | 테마 | 용도 |
|---|---|---|
| 01 | `institutional` | 기관투자자 / PF / Credit — **PDI 핸드오프 정본** |
| 02 | `global_ib` | M&A / 글로벌 투자자 |
| 03 | `private_equity` | PE / VC / 대체투자 |
| 04 | `real_estate` | 부동산 개발 — **부동산개발 IM 기본 추천** |
| 05 | `corporate` | 기업 보고서 (Brand Kit 우선) |
| 06 | `premium` | 복합개발 / 랜드마크 |
| 07 | `minimal` | CEO / Executive |
| 08 | `technology` | Data Center / AI / ICT |
| 09 | `renewable` | Solar / Wind / ESS |
| 10 | `infrastructure` | SOC / 물류 / 산업단지 |
| 11 | `luxury` | 호텔 / 리조트 |
| 12 | `government` | 공공기관 / 지자체 |
| 13 | `custom` | 사용자 지정 + Brand Kit |

### Content 와 Design 은 완전히 분리된다

디자인을 바꿔도 **데이터와 분석 결과는 변하지 않는다.** 실측으로 확인한다 —
테마를 `institutional` → `technology` 로 바꾸고 재실행해도 `im.md` 는 바이트 단위로 동일하고
색·레이아웃만 바뀐다(`test/design-selection.test.js`).

```
dataset.json  →  im.json (내용·수치)  →  theme  →  im-a4.html / content.json / theme.css
     ↑                    ↑                 ↑
   데이터            Design 무관        여기만 바뀐다
```

### 무엇이 테마에 따라 바뀌고 무엇이 안 바뀌나

| 바뀐다 | 바뀌지 않는다 |
|---|---|
| 팔레트 · 타이포 · 차트 색 | 페이지 기하(A4/17mm) · 괘선 두께 · 표 규격 |
| 표지 형식 (rule / fullImage / split) | 챕터 오프너 페이지 분리 |
| 여백 밀도 (compact / normal / airy) | `자료출처:` 캡션 규칙 |
| 절별 레이아웃 (L01~L12) | 출처 표기 · 미검증 표기 |
| 표지 강조 KPI | 수치 자체 |

구조까지 테마마다 다르면 문서가 서로 다른 시스템처럼 보인다.

### AI 추천은 규칙 기반이다

같은 프로젝트에 **항상 같은 추천**이 나오고, 왜 그 테마인지 설명할 수 있어야 한다.
"Confidence 96%" 가 매번 달라지면 그건 신뢰도가 아니라 잡음이다. 그래서 언어모델을 쓰지 않는다.

```
BEST MATCH — 인천 남동공단 6.5MW 데이터센터 개발사업
  ① Global Investment Bank — 69%   근거: 문서유형: im / 투자자: global
  ② Technology / Data Center — 44%  근거: 자산유형: datacenter
  ③ Institutional — 33%
```

### 산출물 (12_Final/)

```
im-a4.html    선택한 테마가 적용된 A4 인쇄본
content.json  기존 뷰어용 데이터 (theme 정보 포함)
theme.json    팔레트·타이포·차트 색 — PPT 빌더·Dashboard 가 읽는다
theme.css     CSS 변수 (--lp-primary 등)
layouts.json  절별 자동 배정 레이아웃 (L01~L12)
```

### 디자인 일관성 검사 (D11)

문서에 쓰인 색·서체가 **전부 선택된 테마 팔레트에서 나왔는지** 검사한다.
도입 즉시 렌더러의 하드코딩 색(`#4A5A70`) 하나를 잡아냈다.

## LinkPilot Agent Builder 적용

`prompts/master-orchestrator.md` 를 System Prompt 칸에 그대로 붙여넣으면 된다.
**이 저장소의 실제 구현과 1:1로 대응한다** — 프롬프트만 있고 구현이 없는 기능은 적지 않았다.
적으면 모델이 있다고 믿고 거짓 산출물을 만든다.

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
