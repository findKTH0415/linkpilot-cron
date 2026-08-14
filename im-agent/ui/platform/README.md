# LinkPilot 플랫폼 — 단일 HTML

빌드 도구·번들러·의존성 없이 도는 LinkPilot 화면이다.
`linkpilot-platform.html` **파일 하나**를 웹서버에 올리면 끝난다.

> ⚠️ **기존 파일을 덮어쓰기 전에 백업하세요.**
> 이 파일은 NAS 의 기존 `linkpilot-platform.html` 을 보고 만든 것이 **아니다.**
> 원본 구조를 모르는 상태에서 새로 작성한 것이므로, 같은 이름으로 덮으면 되돌릴 수 없다.
> 먼저 다른 이름(`linkpilot-v2.html`)으로 올려 비교한 뒤 교체한다.

## 화면

| 탭 | 내용 | 데이터 |
|---|---|---|
| 오늘 | 일정·긴급/일반 업무·신규 접수(15일) | NAS `sync.php` |
| 프로젝트 | 단계별(접수/타진/진행/보류/완료) + 검색 + D-Day | NAS `sync.php` |
| 인맥 | 검색 + 활동량순 + `tel:` 딥링크 | NAS `sync.php` |
| IM 제작현황 | Control Tower (4트랙 진행률·검증·산출물) | 본체 API |
| 내 정보 | 계정·멤버십·플랜 (별도 창) | 설정 주입 |

별도 화면(같은 테마, 각각 단일 파일):

| 파일 | 화면 | 대상 |
|---|---|---|
| `guide.html` | 외부 업무지침 | 협력사·외부 담당자 |
| `board.html` | 업무지시 보드 (칸반) | 유료 회원 |
| `reports.html` | 보고서 생성 | Pro 이상 |
| `membership.html` | 더보기 › 유료 멤버십 › 멤버십 | 유료 회원 |
| `upgrade.html` | 내정보 › 업그레이드 | 무료 회원 |

## 빌드

```bash
npm run im:platform
# 주소를 미리 박아 넣으려면
npm run im:platform -- --nas https://nas.example.com --api https://nas.example.com:8181/api/linkpilot
```

## 설정

빌드 결과물 상단의 `window.LINKPILOT_CONFIG` **한 블록만** 고치면 된다.

```js
window.LINKPILOT_CONFIG = {
  nas: "https://nas.example.com",          // sync.php 위치. 비우면 인맥·프로젝트·일정이 안 나온다
  api: "/api/linkpilot",                   // IM Agent API (본체 8181)

  me: { name: "홍길동", email: "...", org: "PDI GID", role: "CEO" },

  membership: {
    planId: "pro", status: "active", until: "2027-02-10",
    usage: { "프로젝트": { used: 4, limit: 20 }, "IM 생성": { used: 12, limit: null } },
  },

  plans: null,        // null 이면 기본 3종(Free/Pro/Enterprise)
  billingUrl: null,   // 결제 페이지. 예: 'https://pay.example.com/checkout'
};
```

임시 확인은 주소 뒤에 `?nas=...&api=...` 를 붙이면 된다. 탭은 `#projects` 처럼 주소에 남는다.

### 서버가 내려주는 편이 낫다

`me` / `membership` 을 파일에 박아두면 사람이 바뀔 때마다 파일을 고쳐야 하고,
브라우저에서 값을 바꿔 유료 기능을 흉내낼 수도 있다.
본체 서버가 로그인 세션을 보고 이 블록을 만들어 내려주는 것이 정석이다.
**화면 표시는 화면 표시일 뿐이므로, 권한 검사는 반드시 서버에서 한 번 더 한다.**

## CORS — 자주 막히는 지점

페이지와 NAS/API 가 **다른 출처**(호스트 또는 포트가 다름)면 응답에 헤더가 필요하다.

```
Access-Control-Allow-Origin: https://nas.example.com
```

Synology 는 `web` 폴더의 `.htaccess` 또는 Web Station 의 헤더 설정으로 넣는다.
**페이지와 API 를 같은 출처에 두면 이 문제가 아예 없다** — 가장 쉬운 해법이다.

> 이 화면은 NAS 호출에 커스텀 헤더를 붙이지 않는다.
> `cache-control` 같은 헤더를 넣으면 단순요청이 아니게 되어 프리플라이트(OPTIONS)가 먼저 날아가고,
> `Access-Control-Allow-Headers` 가 없으면 통째로 실패한다. 캐시는 `?t=` 로 무력화한다.

## 본체 API 붙이기

```js
// 본체 server.js
const { createRouter } = require('/volume1/linkpilot/im-agent/ui/api-router.cjs');
app.use('/api/linkpilot', createRouter({
  agentRoot: '/volume1/linkpilot/im-projects',
  agentModulePath: '/volume1/linkpilot/im-agent',
}));
```

엔드포인트 5개, **전부 읽기 전용**이다. `GET /fields` 는 데이터 사전(가이드 필드
정의)을 내려준다 — 화면이 필드 목록을 복사해 두지 않게 하려고 있다.

## 멤버십에서 지킨 것

- **정보가 없으면 Free 로 단정하지 않는다.** '연동 전'으로 표시한다 —
  유료 회원인데 화면이 Free 로 보이면 문의가 들어온다.
- **가격을 코드에 박지 않는다.** 설정에 없으면 지어내지 않고 '문의'로 표시한다.
- **카드정보를 이 화면에서 받지 않는다.** `billingUrl` 의 결제대행사 페이지로 보낸다.
  카드정보를 직접 받으면 PCI 범위에 들어간다. (테스트가 입력 필드 종류를 검사한다.)
- 만료·임박(14일)을 눈에 띄게 알린다. 만료되면 유료 기능이 막히기 때문이다.

## 그 밖에 지킨 것

- **못 가져온 것과 없는 것을 구분한다.** NAS 가 죽었을 때 "일정 없음"이라고 쓰지 않고
  "확인되지 않았습니다"로 표시한다. 없는 날로 오해하면 일정을 놓친다.
- **한쪽이 죽어도 다른 쪽은 보여준다.** NAS 가 막혀도 IM 제작현황은 나온다.
- **날짜는 전부 `Asia/Seoul` 로 명시 계산한다.** 해외 출장 중 노트북 시간대가 바뀌어도
  '오늘'이 어긋나지 않는다.
- **값은 전부 `textContent`.** `innerHTML` 을 쓰지 않는다 — 인맥·메모는 사용자 입력이다.
- **색을 하드코딩하지 않는다.** `controlTower.css` 의 테마 변수를 쓴다.

## 테스트

```bash
npm test          # im-agent/test/platform.test.js 포함
```

날짜(KST·D-Day·월말/연말), 단계 표준화, 검색, 전화번호 추출, 멤버십 상태 판정,
결제 입력 부재를 검증한다. DOM 은 테스트하지 않는다.

---

## 외부 업무지침을 코드가 지킨다

「LinkPilot 외부 업무지침」(2026-08-14)은 **협력사에 배포된 문서**다.
앱이 문서와 갈리면 내부 버그와 성격이 다르다 — 문의가 외부에서 들어온다.
그래서 문서의 확정 사실을 코드에 박고, 벗어나면 테스트가 깨지게 했다.

| 파일 | 지침 근거 | 하는 일 |
|---|---|---|
| `catalog.js` | §2 계정과 권한 | 무료/유료 기능 목록·등급의 **단일 출처** |
| `inapp.js` | §1 접속 방법 | 메신저 인앱 브라우저 감지 + [외부 브라우저로 열기] 배너 |
| `guide.html` | 전체 | 지침 전문을 앱 안에서 (인쇄·PDF 저장 가능) |

### 어긋나 있던 것 (고침)

| 항목 | 지침 | 고치기 전 |
|---|---|---|
| 검증 보고서 등급 | §2 보고서 생성 **(Pro)** | Business 요구 — Pro 회원이 문서대로 눌렀다 403 |
| Free 플랜 | 할일·연락처·프로젝트·캘린더·Q&A·투자소스 DB | '프로젝트 3건' 등 **지침에 없는 한도**를 표시 |
| 유료 메뉴 표시 | "무료 계정에서도 **보이되 잠겨** 있습니다" | 화면마다 제각각 (자물쇠 없는 화면이 있었다) |
| 외부 브라우저 배너 | "배너가 나오면 눌러 주십시오" | **배너 자체가 없었다** |

### 등급을 바꿀 때

`catalog.js` 의 `byGuide: true` 는 지침이 등급까지 못 박은 항목이다
(현재 무료 6종과 `보고서 생성` = Pro). **여기를 바꾸려면 지침을 먼저 고친다.**
`byGuide: false` 는 내부 판단이라 지침과 어긋나지 않지만, 올리면 그 등급 회원이
못 쓰게 되므로 확인이 필요하다.

> `통화음성분석`(Pro) · `프리미엄 투자소스 DB`(Pro) · `신재생에너지 분석`(Business)
> 은 지침이 '유료'라고만 적어 등급이 확정되지 않았다. 현재 값은 잠정이다.

### 접속 주소

**저장소는 공개다.** 내부 주소를 파일에 박지 않는다 (CLAUDE.md §2).
`guide.html` 은 비어 있으면 지금 보고 있는 주소에서 만들고,
설정 `LINKPILOT_GUIDE.url` 로 덮을 수 있다. 테스트가 하드코딩을 막는다.

### 인앱 브라우저 — 왜 오탐이 더 나쁜가

정상 브라우저에 "브라우저를 바꾸라"는 배너를 띄우면 멀쩡한 사용자가 못 쓰는 줄 안다.
그래서 `SamsungBrowser`·`Whale`·`CriOS` 등을 먼저 통과시키고 확실한 서명만 잡는다.
iOS 인앱(카카오톡·라인 외)은 외부 브라우저를 **강제로 열 수 없어** 주소 복사를 준다 —
지침도 그렇게 안내한다. 억지로 스킴을 던지면 아무 일도 안 일어나고 고장으로 보인다.

---

## 보고서 생성 연결 (서버)

화면(`reports.html`)이 실제로 동작하려면 서버에 두 조각을 붙인다.

```js
// 본체 server.js
const { createRouter } = require('/volume1/linkpilot/im-agent/ui/report-api.cjs');
const { createQueue }  = require('/volume1/linkpilot/im-agent/ui/run-queue.cjs');

const queue = createQueue({
  agentRoot: '/volume1/linkpilot/im-projects',
  concurrency: 1,            // 늘리면 LLM 비용도 같이 는다
  timeoutMs: 20 * 60_000,    // 넘으면 죽이고 실패로 기록한다
  onDone: (run) => { /* 알림·로그 (실패해도 큐는 계속 돈다) */ },
});

app.use('/api/linkpilot', createRouter({
  agentRoot: '/volume1/linkpilot/im-projects',
  agentModulePath: '/volume1/linkpilot/im-agent',
  authenticate: (req) => req.session && req.session.user,   // ★ 없으면 마운트 자체가 실패한다
  startRun: queue.startRun.bind(queue),
}));

process.on('SIGTERM', () => queue.stop());   // 자식 프로세스를 남기지 않는다
```

화면 쪽은 `LINKPILOT_REPORTS.api = '/api/linkpilot'` 한 줄이면 서버를 탄다.
가이드 필드 화면은 `LINKPILOT_FIELDS_CFG.api` 다.

`runningFor` 를 함께 주면 **생성 중에는 값을 고칠 수 없게** 된다.
파이프라인이 읽는 도중에 데이터가 바뀌면 산출물과 데이터가 어긋난다.

```js
  runningFor: (projectId) => queue.latestFor(projectId),
```

## 가이드 필드 입력 (`fields.html`)

보고서에 들어갈 수치를 **출처와 함께** 입력하는 화면이다. 보고서 생성 2단계.

| 지킨 것 | 왜 |
|---|---|
| **필드 목록을 화면에 복사하지 않는다** | `core/dictionary.js` 가 단일 출처다. `GET /fields` 로 받아 그린다. 복사본을 두면 사전이 바뀐 날부터 조용히 갈리고, 화면만 옛 항목을 계속 보여준다 |
| **출처 없으면 저장 버튼이 열리지 않는다** | `facts.js` 가 `source` 없는 Fact 생성을 예외로 막는다. 화면에서 먼저 막지 않으면 저장을 누른 뒤에야 알게 된다 |
| **출처를 업로드된 자료 중에서 고른다** | 자유 입력만 두면 "사업계획서"처럼 어느 파일인지 알 수 없는 문자열이 쌓이고 값을 추적할 수 없다 |
| **계산 항목은 입력란을 만들지 않는다** | 사람이 IRR 을 적어 넣는 순간 "숫자는 만들지 않고 계산한다"가 무너진다. 서버도 거부한다 |
| **범위를 벗어나도 막지 않고 경고한다** | 여기서 막으면 05 Validation 이 RED FLAG 로 잡아야 할 이상값이 화면에서 사라진다 |
| **문제 있는 줄은 필터·검색과 무관하게 보인다** | "경고 1건"이라고 띄워 놓고 그 줄이 필터에 가려 있으면 고칠 방법이 없다 |
| **단위는 사전에서 가져오고 사용자가 못 바꾼다** | 억원/원이 섞이면 재무모델이 통째로 틀린다. 환산 도우미는 값을 보여 주기만 하고 자동 적용하지 않는다 |
| **진행률은 값과 출처가 모두 있을 때만 센다** | 출처 없는 값을 세면 다 됐다고 착각한다 |

판정 로직은 `fields-core.js` 하나다 (`fields.test.js` 32건이 검사한다).
**필드 정의를 못 받으면 입력란을 그리지 않는다** — 옛 항목으로 입력받아 저장하면
더 큰 문제가 된다.

### 이 조합이 막는 것

| 상황 | 결과 |
|---|---|
| 미인증 | 401 |
| 무료·만료·모르는 플랜 코드 | 403 |
| 검증 보고서를 Pro 가 요청 | 403 (종류별 플랜) |
| **출력 사양 확정 전 생성** | 409 — 실행기를 부르지 않는다 |
| **같은 프로젝트 중복 실행** | 409 — 산출물이 섞이고 쿼터가 두 배로 나간다 |
| PDF·HWP·PPTX 사양 저장 | 400 + 만들 수 없는 이유 |
| `startRun` 미주입 | 501 — 없는 기능을 있는 척하지 않는다 |
| 파이프라인이 20분 넘게 안 끝남 | 죽이고 실패로 기록 (영원히 running 으로 남지 않는다) |

### 진행 상황

별도 통로를 만들지 않는다. 파이프라인이 `01_Project/control-tower.json` 에 쓰고,
**IM 제작현황 화면이 그대로 읽는다.** 실행 자체의 성패는 `queue.get(runId)` 로 본다.

`authenticate` 는 `outputspec.confirm()` 에 사람 이름을 넘기는 데도 쓰인다 —
서비스 계정 이름(`claude`, `agent` 등)으로는 사양을 확정할 수 없다.
