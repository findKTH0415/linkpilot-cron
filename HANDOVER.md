# HANDOVER — 인수인계 · 버그/오류 개선안

작성 2026-08-14 (KST) · 대상 저장소 `findKTH0415/linkpilot-cron`

---

## 0. 결론 먼저

- **코드는 막힌 곳이 없다. 막힌 것은 전부 저장소 밖이다** — PR 병합, Secret 등록,
  본체 소스, NAS 접근. 넷 다 사람이 해야 한다.
- **테스트 330건 통과.** 새 의존성 0건. 아침 크론 발송 로직은 여전히 무변경.
- **가장 급한 것 하나** — PR #4(실패 알림)가 병합되지 않는 한, 크론이 실패해도
  다음날 아침까지 아무도 모른다. 이 상태가 지금도 계속되고 있다.

---

## 1. 현재 상태

| 항목 | 값 |
|---|---|
| 작업 브랜치 | `claude/linkpilot-agent-github-plan-0af7xs` (= **PR #3**) |
| 최신 커밋 | `7979400` 외부 업무지침을 플랫폼에 반영하고 어긋난 곳을 맞춤 |
| PR #3 | open · draft · `mergeable_state: clean` · 124파일 / +25,772 |
| PR #4 | open · draft · clean · 브랜치 `claude/ops-cron-alerts-and-deploy` (별개) |
| 테스트 | `npm test` → **330 pass / 0 fail** |
| CI | `im-agent-ci.yml`, `cron-ci.yml` (경로 변경 시에만 실행) |

> PR #3 과 PR #4 는 **다른 브랜치**다. 이번 지침 반영 작업은 PR #3 에 들어갔다.
> 운영 알림·NAS 배포는 PR #4 에 있고, 그쪽이 병합되어야 Actions 탭에 배포 버튼이 생긴다.

### 이번 세션에서 한 일

「LinkPilot 외부 업무지침」(2026-08-14, 협력사 배포본)과 앱을 대조해 어긋난 4건을 고쳤다.

- `im-agent/ui/platform/catalog.js` — 지침 §2 기능·등급의 단일 출처 (신규)
- `im-agent/ui/platform/inapp.js` — 지침 §1 인앱 브라우저 배너 (신규)
- `im-agent/ui/platform/guide.html` — 지침 전문 화면 (신규)
- `im-agent/test/guide.test.js` — 지침 대조 17건 (신규)
- 검증 보고서 등급 `business → pro` (화면·서버 양쪽)
- Free 플랜의 근거 없는 한도 문구 제거
- 유료 메뉴 잠금 표시 통일, 산출물 [인쇄 · PDF 저장] 추가

---

## 2. 버그 · 오류 개선안

심각도 — 🔴 확인된 결함 / 🟡 미검증(터질 수 있음) / 🟢 개선 제안

### 🔴 B-1. 크론 실패가 여전히 조용하다

| | |
|---|---|
| 위치 | `.github/workflows/morning-brief.yml` 외 3개 (main 브랜치 기준) |
| 증상 | 크론이 실패해도 알림이 없다. 다음날 아침 브리핑이 안 온 것으로 알게 된다 |
| 원인 | 고친 코드가 **PR #4 에만 있고 main 에 없다** |
| 조치 | PR #4 병합. 그 뒤 Actions → `alert-failure` → Run workflow 로 실도착 확인 |
| 난이도 | 사람만 가능 (5분) |

CLAUDE.md §2 「발송 실패 시 조용히 죽지 않는다」가 현재 main 에서 지켜지지 않는다.

### 🔴 B-2. 공개 저장소에 내부 NAS 주소가 평문으로 남아 있다

| | |
|---|---|
| 위치 | `README.md:55`, `README.md:58`, `send-morning-brief.js:11`, `CLAUDE.md:10` |
| 증상 | tailnet 주소와 내부 IP가 공개 저장소 본문에 있다 |
| 원인 | 이전부터 있던 예시 문자열. 이번에 새로 만든 파일들은 전부 치환했다 |
| 조치 | ① 본문 치환(`nas.example.com`) ② **git 이력에는 그대로 남는다** — 저장소를 private 으로 돌리거나 이력 재작성을 결정해야 한다 |
| 난이도 | 본문 치환은 5분. 이력은 결정 필요 |

CLAUDE.md §2 위반이다. 본문만 고쳐도 검색 노출은 줄지만 이력은 남는다.

### 🟡 B-3. VWorld 지오코딩이 사용자 환경에서 실패한다 (원인 미확정)

| | |
|---|---|
| 위치 | `im-agent/connectors/vworld.js` |
| 증상 | 지오코딩 응답이 비어 돌아온다. 07 Geo Agent 가 통째로 건너뛰어진다 |
| 이미 고친 것 | `type=json` 이 주소 서비스의 `type=ROAD/PARCEL` 을 덮어쓰던 버그 (회귀 테스트 있음) |
| 남은 것 | 그 뒤로도 실패한다는 보고. **키 문제인지 미매칭인지 구분 못 함** |
| 조치 | `~/linkpilot-cron` 에서 `IM_AGENT_DEBUG_HTTP=1 npm run im:smoke` 실행 후 `attempts[]` 확인 |
| 난이도 | 진단 10분 (사용자 환경에서만 가능) |

> 이전에 `~` 에서 실행해 계속 실패했다. **반드시 `~/linkpilot-cron` 안에서** 실행한다.

### 🟡 B-4. 공공데이터 응답 스키마를 실제 키로 검증하지 않았다

| | |
|---|---|
| 위치 | `im-agent/connectors/*.js` |
| 증상 | 아직 없음. 필드명이 문서와 다르면 조용히 빈 값이 된다 |
| 조치 | `VWORLD_KEY`·`DATA_GO_KR_KEY` 등록 후 `node im-agent/cli.js quota` + 실거래 1건 조회 |
| 난이도 | 사람만 가능 (10분) |

파서는 JSON/XML(한글 태그) 양쪽을 흡수하도록 만들었지만 실물 확인이 없다.

### 🟡 B-5. NAS 배포 경로가 한 번도 실행되지 않았다

| | |
|---|---|
| 위치 | `.github/workflows/deploy-nas.yml` (PR #4) |
| 증상 | 아직 없음. 첫 실행에서 tailnet 인증·SSH·백업 중 어디서 막힐지 모른다 |
| 원인 | 이 세션에서 NAS 에 4회 시도했으나 전부 차단(`host_not_allowed`). 검증 불가 |
| 조치 | PR #4 병합 → Secret 등록 → **`dry_run: true` 로 먼저 실행** → 출력 확인 후 실배포 |
| 난이도 | 사람만 가능 |

`dry_run` 기본값이 true 인 이유가 이것이다. 첫 실행을 실배포로 하지 말 것.

### 🟡 B-6. 유료 기능 3종의 등급이 확정되지 않았다

| | |
|---|---|
| 위치 | `im-agent/ui/platform/catalog.js:50-52` |
| 증상 | 통화음성분석=Pro / 프리미엄 투자소스 DB=Pro / 신재생에너지 분석=Business 는 **추정치**다 |
| 원인 | 지침 §2 는 '유료'라고만 적었고 등급을 나누지 않았다 |
| 위험 | Basic 회원이 쓸 수 있어야 하는 기능이 잠겨 있으면 문의가 들어온다 |
| 조치 | 결정 후 `byGuide: false` → `true` 로 바꾸고 지침도 함께 갱신 (재갱신 요청서 A-1 참조) |
| 난이도 | 결정 5분 + 반영 5분 |

### 🟢 B-7. 업무지시 보드가 데모 데이터로만 돈다

| | |
|---|---|
| 위치 | `im-agent/ui/platform/board.html:259-261` |
| 증상 | 카드를 옮겨도 새로고침하면 되돌아간다. `api: null` |
| 원인 | `/board` 엔드포인트와 저장소가 없다 |
| 조치 | `report-api.cjs` 와 같은 방식으로 쓰기 라우터 추가 + JSON 파일 또는 본체 DB 연결 |
| 난이도 | 반나절. 본체 소스가 있으면 그 DB 를 쓰는 편이 낫다 |

### 🟢 B-8. [인쇄 · PDF 저장]이 아직 안내만 띄운다

| | |
|---|---|
| 위치 | `im-agent/ui/platform/reports.html:255` (`fileUrl: null`) |
| 증상 | 버튼을 눌러도 "여는 경로를 본체에 연결하세요"가 뜬다 |
| 원인 | 산출물 파일을 내려주는 정적 경로가 서버에 없다 |
| 조치 | 본체에서 `12_Final/*.html` 을 서빙하고 `fileUrl` 함수를 넣으면 바로 동작한다 |
| 난이도 | 30분 (본체 소스 필요) |

지침 §7-3 이 [인쇄 · PDF 저장]을 안내하므로 **협력사 눈에는 이미 있는 기능**이다. 우선순위가 낮지 않다.

### 🟢 B-9. 결제 연동이 없다

| | |
|---|---|
| 위치 | `membership.html:311`, `upgrade.html:250` (`billingUrl: null`) |
| 증상 | 플랜을 골라도 "결제 연동이 아직 없습니다" 안내만 나온다 |
| 설계 | 카드정보를 이 화면에서 받지 않는다(PCI 범위 회피). 결제대행사 페이지로 보낸다 |
| 조치 | 결제대행사 선정 후 `billingUrl` 한 줄 |
| 난이도 | 코드는 5분. 결정이 오래 걸린다 |

### 🟢 B-10. PDF·PPTX·HWP 를 서버에서 만들 수 없다

| | |
|---|---|
| 위치 | `im-agent/ui/platform/reports.html:286-290` |
| 현재 | 목록에는 두되 비활성 + 이유 표시. 서버도 거부한다 |
| 원인 | PDF/PPTX 는 의존성 추가가 필요하고 승인받지 않았다. HWP 는 사실상 불가 |
| 대안 | HTML(A4) → 브라우저 인쇄로 PDF 저장 (지침 §7-3 과 동일한 방식) |
| 조치 | 서버 PDF 가 필요하면 의존성 추가 승인 필요 |

### 🟢 B-11. Lineage(값 출처 추적) 모달이 바닐라 판에 없다

| | |
|---|---|
| 위치 | `im-agent/ui/vanilla/control-tower.js` |
| 증상 | React 판에는 있고 순수 JS 판에는 없다. 본체가 단일 HTML 이면 못 본다 |
| 영향 | 숫자를 눌러 출처를 확인하는 경로가 막힌다 — IM Agent 의 핵심 가치 중 하나 |
| 조치 | 포팅. `ui-parity.test.js` 에 검사 추가 |
| 난이도 | 2~3시간 |

### 🟢 B-12. IDC(건설이자) 자본화 관행이 미확인이다

| | |
|---|---|
| 위치 | `im-agent/agents/04_financial.js` |
| 증상 | 모델 총사업비가 문서값보다 크다 (2,846 → 2,962억원). `TPC_GAP` 경고만 뜬다 |
| 원인 | 건설이자를 총사업비에 포함하는지가 회사·딜마다 다르다 |
| 조치 | 사내 기준 확정 후 상수화 |
| 난이도 | 결정 필요 |

---

## 3. 사람만 할 수 있는 것 (막힌 것 전부)

| # | 할 일 | 왜 나는 못 하나 | 걸리는 시간 |
|---|---|---|---|
| 1 | **PR #4 병합** | 권한 없음 | 2분 |
| 2 | Secret 등록 — `TS_OAUTH_CLIENT_ID`/`TS_OAUTH_SECRET`, `NAS_SSH_HOST`/`NAS_SSH_USER`/`NAS_SSH_KEY`, `ALERT_PHONE`, `VWORLD_KEY`, `DATA_GO_KR_KEY` | 값을 모르고 알아서도 안 됨 | 10분 |
| 3 | `alert-failure` 수동 실행 → 알림 도착 확인 | Secret 필요 | 3분 |
| 4 | VWorld 진단 (B-3) | 사용자 환경에서만 재현 | 10분 |
| 5 | **본체 앱 소스를 `linkpilot-platform` 저장소에 업로드** | 접근 불가 | — |
| 6 | 등급·Free 한도·결제사 결정 | 경영 판단 | — |

### 5번이 막고 있는 것

본체 소스가 없어서 못 하는 일이 쌓여 있다.

- `server.js` 에 `report-api.cjs` + `run-queue.cjs` 배선 (코드는 다 됐고 붙이기만 하면 된다)
- `authenticate` 를 실제 로그인 세션에 연결
- `fileUrl` 연결 (B-8)
- 업무지시 보드 저장 (B-7)
- 새로 만든 화면들을 실제 메뉴에 넣기

> 지금 만든 화면들은 **실제 앱을 보고 만든 것이 아니다.** 스크린샷과 지침을 근거로
> 테마를 맞췄다. 본체 소스가 오면 실제 컴포넌트로 다시 맞춰야 한다.

---

## 4. 다음 세션 시작법

```
HANDOVER.md 읽고 이어서 진행
```

우선순위는 위 표 순서다. **1번(PR #4 병합)이 끝나기 전까지는 다른 작업이 다 부차적이다** —
그 사이에 크론이 실패하면 아무도 모른다.

### 실행 명령 모음

```bash
cd ~/linkpilot-cron

npm test                                   # 330건
npm run im:platform                        # 단일 HTML 재생성
IM_AGENT_DEBUG_HTTP=1 npm run im:smoke     # VWorld 진단 (B-3)
node im-agent/cli.js quota                 # 공공데이터 쿼터 (B-4)
```

### 손대면 안 되는 것 (CLAUDE.md §2)

- 카카오 OAuth refresh token 갱신 로직 — 지우거나 단순화하지 않는다
- cron 은 UTC — 06:00 KST = `0 21 * * *`
- 시크릿을 코드·로그·커밋에 남기지 않는다
- 실패 알림(fallback) 경로를 항상 유지한다

### 이번에 생긴 규칙 하나

`catalog.js` 의 `byGuide: true` 는 **협력사에 배포된 지침이 등급까지 못 박은 항목**이다.
여기를 바꾸면 배포된 문서가 거짓말이 된다. 코드만 고치지 말고 문서를 먼저 고친다.
테스트(`guide.test.js`)가 이 규칙을 지킨다.
