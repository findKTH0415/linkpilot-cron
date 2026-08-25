# HANDOVER — 다음 세션 인수인계

작성 **2026-08-25 21:20 (KST)** · 브랜치 `claude/sketchup-engineering-agent-rg04zq` (`0e923a4`)
· main `7339b33` (아직 미병합) · 열린 PR **#9 하나(draft)** · 이 갈래 커밋 **139개**
· 테스트 **1832/1832 통과**(skip 7) · 화면 묶음 판 지문 **`664b0bf8`**
· 등록부 미결정 **57건** · 결정 **39건**

> 이 파일은 **SketchUp Engineering Agent 갈래**의 인수인계다. 앞 판(2026-08-22)은
> 통합 갈래(`0af7xs`) 것이었고, 그 갈래는 이번 세션에 **이 갈래로 병합**되었다.

---

## 1. 세션 목표

SketchUp 트랙을 실사용 가능한 상태로 닫는다 — 개념 배치의 총량 정합, 도로필지
동봉, 렌더 표준 강제, **조감도 자동 렌더 개통**, 그리고 두 작업선 병합.

## 2. 완료된 작업

### 2-1. 두 작업선 병합 · 번호 충돌 해소
- 통합 갈래(`claude/linkpilot-agent-github-plan-0af7xs`)를 두 번 병합
  (`15ac974`, `cce9737`) — 화면·배포 트랙 + 업무지침 + `deliverables` 절이 들어왔다.
- **번호 충돌 재발**(D-77 과 같은 결): 이쪽 D-101/D-102/M-35 가 저쪽과 겹쳐
  **D-104 / D-105 / M-40** 으로 재번호 (`def8b20`). 규칙 — **코드가 참조하는 쪽이
  번호를 지킨다**. 충돌 해소는 전부 **합집합**으로 했다(changes.js · MEMORY.md ·
  미결정 등록부 · section-preview.html).

### 2-2. 엔진 — 개념 배치·도로·렌더
| 커밋 | 무엇 | 파일 |
|---|---|---|
| `ad622be` | **D-104** 동 길이를 `GFA ÷ (층수×동수×깊이)` 로 자른다 (데모 98.2m→75.0m) | `im-agent/agents/12-sketchup-plan.js` |
| `ad622be` | **D-105** 부지에 접한 도로필지(지목 「도로」 확인분)를 `site.road_polygons_mm` 로 동봉. 미확보면 null + notes | `connectors/vworld.js`(`parcelsNear`) · `geo/geometry.js`(`minRingDistance`) · `agents/07-geo.js` · `09-massing.js` · `12-sketchup-plan.js` |
| `77fcd3c` | **렌더 표준 강제** — Veras 4.0 (Nano Banana Pro). 값은 `RENDER_STANDARD` **한 곳**에만. 비표준은 `RENDER_TOOL_NONSTANDARD` YELLOW | `core/outputspec.js` · `12-sketchup-plan.js` · `13-sketchup-intake.js` |
| `d0e4d5c` | **D-34 개정** — 조감도 자동 렌더 개통(`npm run im:render`). 생성은 자동, **채택은 사람**(`--adopt`) | `im-agent/tools/render-birdseye.js`(신규) · `package.json` |
| `451b783` | 렌더 실패를 **결제·열쇠·모델**로 갈라 사람 말로 말한다(`diagnose`) | `tools/render-birdseye.js` |
| `0e923a4` | **D-34 2차 개정** — AI 렌더를 **IM 본문(05 Asset Overview)** 에 싣는다 | `13-sketchup-intake.js`(`bodyRenders`) · `pipeline.js` · `06-im-writer.js`(`renderFigures`) |

### 2-3. 검사 장치 (통합 갈래에서 들어옴 + 이번에 실측)
- `npm run agent:check` — Agent **배선 다섯 곳 × 13개** 를 전부 센다. 실측 결과
  **빠진 곳 없음 · 진행률 비중 합계 100**.
- `npm run branch:check` — 열린 갈래와 **같은 파일을 건드리는지** 잰다. 특히
  **양쪽이 새로 만든 같은 경로**를 따로 잡는다.
- `npm run guard` — 교차검증 **여덟 칸**(위 둘이 일곱째·여덟째).

### 2-4. 문서
- 신규: `docs/안내-조감도-자동-렌더.md` (키 발급 → 실행 → 채택 → 막히는 곳 → 무료 경로 → 결제)
- 신규: `.github/workflows/render-smoke.yml` (im:render 실키 실측 자리)
- 개정: `docs/스케치업-모델-계획-규격.md` §3-1 · `docs/작업지침서-스케치업-엔진-운용.md`
  · `docs/미결정-사항.md`(D-34 ✅ · D-104 ✅ · D-105 ✅) · `CLAUDE.md` §7 · §8-1

## 3. 결정사항과 그 이유

- **D-34 를 두 번 개정했다.**
  - 1차: 「API 실측 전 자동화 보류」를 풀었다 — 자동화 경로는 **Veras API 가 아니라
    Gemini API**(표준과 같은 Nano Banana Pro 계열). 이유: Veras API 존재를 실측할
    길이 없었고, 기존 `GEMINI_API_KEY` 로 새 의존성 없이 붙는다.
  - 2차: 「표지·티저 한정 · IM 본문 제외」를 **풀었다**(사장님 지시). 이유는 사장님
    결정이고, 막는 방식이 **안 싣는 것 → 표기와 순서**로 바뀌었다: 근거(매스 표·기하
    조감도)가 먼저·렌더가 뒤, 그림 밑에 disclaimer·원본 장면·도구 세대를 인쇄,
    표기 없는 렌더는 본문에 안 실린다. **기하 조감도를 대체하지 않는다.**
- **비표준 도구 렌더도 본문에 싣는다 — YELLOW 로 알리기만 한다.** 이유: 표준은
  **기록의 문제**이지 그림을 지울 사유가 아니다. 표기(ai_generated·disclaimer·
  based_on) 없는 것만 뺀다.
- **`RENDER_STANDARD` 를 한 곳에 뒀다.** 두 벌이면 한쪽이 옛말을 한다 — Veras 5 가
  나와도 상수 하나만 고친다.
- **호출 가드 5→7 로 올렸다**(도로필지 bbox 1 + 토지특성 ≤12, PNU별 30일 캐시).
  근거 주석을 달았고 **승인 없이 이 수를 다시 올리지 않는다**.

### 실패했던 접근 (다음 세션에서 반복 금지)
- **`workflow_dispatch` 로 render-smoke 를 못 돌린다** — main 에 파일이 없으면
  **404**다. 병합 전 실측은 `push` + `paths` 필터로 우회했다(`c9cd9a5`).
- **열쇠를 다시 넣어도 안 열린다** — 서버 말이 영어 한 덩어리라 「열쇠가 틀렸다」와
  「결제가 없다」가 똑같이 보여 **두 번 헛돌았다**. 그래서 `diagnose()` 를 만들었다.
- **changes.js 에 `**` 를 쓰면 테스트가 빨개진다** — 그 파일은 평문이다.
- **번호를 비워 두는 약속으로는 충돌을 못 막는다** — 실제로 여섯이 두 뜻을 가졌다.
  번호를 따기 전에 **열린 갈래와 운용서를 먼저 읽는다**.

## 4. 미완료 작업 (우선순위 순)

1. **Gemini 결제 연결** 〈사람 몫 · 유일한 관문〉 — 무료 티어는 이미지 한도가 **0**
   이라 API 자동 렌더가 안 돈다(실측 2회). aistudio.google.com → 「Get API key」 →
   그 키의 프로젝트 → 「Set up Billing」. 절차: `docs/안내-조감도-자동-렌더.md` §5.
   연결 뒤 `.github/workflows/render-smoke.yml` 재실행하면 그 자리에서 판정된다.
2. **렌더 채택 실측 1회** — 웹 무료 경로(AI Studio·Gemini 앱)로 그림 하나 만들어
   `--adopt` 까지 돌리면 본문 게재 배선이 실제 문서에서 닫힌다.
   `im-agent/tools/render-birdseye.js`
3. **D-105 bbox 실키 스모크** — 키 있는 자리(NAS)에서 `npm run im:smoke` 의
   「연속지적도 bbox」 항목. 키 없는 자리에서 판정하지 않는다.
4. **`ops-cron-alerts-and-deploy` 갈래 겹침 처리** 〈사람 결정〉 —
   `branch:check` 가 **양쪽이 새로 만든 `.github/workflows/deploy-nas.yml`** 을
   잡고 있다. 그 갈래를 닫을지 정해야 guard 여덟째 칸이 초록이 된다.
5. **PR #9 draft 해제 → 머지** 〈사람 결정〉 — CI 초록·mergeable clean 상태.
6. 미결정 🟡 잔여: **D-97**(PPT) · **D-98**(도면 인식) · **D-100**(개념 배치
   파라미터 확정 — 깊이 13m·인동 0.8·폭 0.8 은 통상치).

## 5. 주의사항

- **`npm run guard` 하나로 검사한다.** 손으로 챙기면 빠뜨린다(하루 반에 여섯 번).
  지금 상태는 **7 통과 · 못 잼 1** — 못 잰 칸은 위 4-4(갈래 겹침, 열린 PR 미조회로
  나이 어림)다. **못 잰 것은 통과가 아니다.**
- **`im:smoke` 를 키 없는 자리에서 돌려 운영 열쇠를 판정하지 않는다** — 전부
  「미설정」으로 나와 **없는 것과 구분이 안 된다**. 운영 열쇠는 배포의
  `env-doctor --keys` 가 NAS 안에서 잰다.
- **PR #9 에 빨간 체크가 보이면** 옛 커밋(`c9cd9a5`·`6a2ed46`)의 **render-smoke
  실키 실측**이다 — 결제 미연결이 원인이고 **현재 헤드에는 안 붙는다**. 고장이 아니다.
- **아티팩트 주소를 저장소에 적지 않는다**(D-10 — 이 저장소는 public).
- 렌더 도구는 키가 없으면 **만들지 않고 안내만 한다**(§4.6). 그것이 정상 동작이다.
- `im-projects/**` 는 gitignore 다 — 데모 산출물은 커밋되지 않는다.
