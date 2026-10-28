# Control Tower 대시보드 — LinkPilot 본체 드롭인 패키지

`control-tower.json` 스키마를 그대로 읽는 React 컴포넌트다.
**LinkPilot 본체(React/Vite) 저장소에 폴더째 복사해 넣으면 된다.**

> 이 폴더가 왜 cron 저장소에 있는가: 본체 저장소가 이 세션에서 접근되지 않아 여기에 두었다.
> 본체로 옮긴 뒤에는 이 폴더를 지워도 `im-agent` 동작에는 영향이 없다 —
> 다만 `ui/lib.js` 는 테스트가 걸려 있으므로 옮길 때 `test/ui.test.js` 도 함께 옮기거나 지운다.

## 설치

```bash
# 본체 저장소에서
cp -r <cron-repo>/im-agent/ui src/components/ControlTower
```

```jsx
import ControlTower from './components/ControlTower/ControlTower.jsx';

<ControlTower projectId="LP-DC-2026-001" baseUrl="/api/linkpilot" />
```

컴포넌트는 ESM(`.jsx`/`.js`), 본체 API 라우터는 CommonJS(`.cjs`)다.
`ui/package.json` 이 이 폴더만 ESM 으로 선언하므로 저장소의 다른 CommonJS 코드에 영향이 없다.

**의존성 추가 없음.** React 만 있으면 된다 — 차트 라이브러리, CSS-in-JS, 상태관리 라이브러리를
쓰지 않는다. 진행바·게이지는 전부 CSS다.

## 파일

| 파일 | 역할 |
|---|---|
| `ControlTower.jsx` | 메인 컨테이너 + ① Overall Progress |
| `Panels.jsx` | ② Agent Activity · ③ Validation/Risk · ④ Output Status · Live Activity · User Actions |
| `Lineage.jsx` | 데이터 계보 / 변경 영향 모달 |
| `useControlTower.js` | 폴링 훅 (`useControlTower`, `useLineage`) |
| `lib.js` | 표시 로직 (순수 함수 — 테스트 대상) |
| `controlTower.css` | 스타일 (테마 CSS 변수 기반) |
| `package.json` | `ui/` 폴더만 ESM 으로 선언 (저장소 나머지는 CommonJS 유지) |
| `api-router.cjs` | 본체 Node API(8181)에 붙이는 읽기 전용 라우터 (CommonJS) |

## 디자인 일관성

색을 하드코딩하지 않는다. `im-agent` 가 프로젝트마다 내보내는 **`12_Final/theme.css`** 의
CSS 변수(`--lp-primary`, `--lp-accent`, `--lp-chart-1` …)를 그대로 쓴다.
프로젝트 테마를 바꾸면 대시보드 색도 같이 바뀐다 — **한 프로젝트 = 한 디자인**.

```jsx
// 프로젝트 테마를 화면에 적용
<link rel="stylesheet" href={`/api/linkpilot/projects/${id}/theme.css`} />
```

`theme.css` 를 로드하지 않으면 `institutional`(PDI 핸드오프 정본) 값이 폴백으로 쓰인다.

## 화면 설계에서 지킨 것

**Agent 진행률을 프로젝트 진행률처럼 보이게 하지 않는다.**

전체 진행률을 가장 크게 두되 바로 아래에 4개 트랙을 분해하고, Agent 진행률이 전체보다
10%p 이상 앞서면 그 격차를 **경고 문구로 띄운다**:

> **진행률 해석 주의** Agent 작업은 100% 진행됐지만 프로젝트 전체는 80%다.
> APPROVAL (사람 승인) 0%, VALIDATION (검증) 70% 가 남아 있어 아직 배포할 수 없다.

이 문구가 없으면 사용자가 "Agent 100%"를 보고 완료로 오해하고, 검증 안 된 투자문서가 나간다.

그 밖에:

- **승인 버튼은 차단 사유가 하나라도 남아 있으면 비활성**이다. 눌러서 실패하는 게 아니라 못 누른다.
- **산출물은 파일 존재 여부로 판정**한다. "생성됨" 표시만 하지 않는다.
- **폴링 실패해도 마지막 화면을 지우지 않는다.** 대신 "마지막 수신 시각 기준"임을 명시한다 —
  화면이 비면 사용자가 작업이 사라진 줄 안다.
- **계보는 채택되지 않은 후보까지 보여준다.** 어느 값이 버려졌는지 알아야 판단할 수 있다.
- 탭이 백그라운드면 폴링을 멈춘다. 실행 중 2초 / 완료 후 15초.

## 본체 API 연결

`im-agent` 는 파일시스템에 산출물을 쓴다. 본체 API(8181)가 그걸 읽어 대시보드에 넘긴다.

```js
// 본체 server.js
const { createRouter } = require('./im-agent/ui/api-router.cjs');

app.use('/api/linkpilot', createRouter({
  agentRoot: process.env.IM_AGENT_ROOT,       // 예: /volume1/linkpilot/im-projects
  agentModulePath: '/volume1/linkpilot/im-agent',
}));
```

express 를 쓰지 않으면 `createHandlers()` 로 순수 핸들러만 가져다 쓴다.

| 엔드포인트 | 응답 |
|---|---|
| `GET /projects/:id/control-tower` | `01_Project/control-tower.json` 스냅샷 |
| `GET /projects/:id/lineage/:key` | 데이터 계보 |
| `GET /projects/:id/impact/:key` | 변경 영향 |

### 쓰기 라우터 (인증 필수)

읽기 라우터와 **분리해 둔다.** 쓰기는 파일을 만들고 LLM 을 부르고 쿼터를 쓴다.
`authenticate` 가 없으면 **마운트 시점에 예외**를 던진다 (fail closed).

```js
const reports = require('./im-agent/ui/report-api.cjs');

app.use('/api/linkpilot', reports.createRouter({
  agentRoot: process.env.IM_AGENT_ROOT,
  authenticate: (req) => req.session && req.session.user,   // 필수
  startRun: (id, spec, user) => queue.push({ id, spec, by: user.name }),
}));
```

| 엔드포인트 | 하는 일 |
|---|---|
| `GET /projects/:id/file?rel=` | 산출물 파일. `rel` 은 목록과 **글자 그대로 같을 때만** 통과한다. HTML 은 sandbox CSP 로 내려간다 |

**읽기 라우터는 전부 읽기 전용이다.** 승인·사양 확정 같은 쓰기 동작은 노출하지 않았다 —
그건 사람 인증을 거쳐야 하는 동작이고, 대시보드 폴링 경로와 같은 권한으로 열면 안 된다.
`onApprove` 콜백만 열어두었으니 본체의 인증된 경로에 연결하면 된다.

```jsx
<ControlTower projectId={id} onApprove={async (pid) => {
  await api.post(`/projects/${pid}/approve`, { by: currentUser.name });  // 본체 인증 경로
}} />
```

`projectId` 는 `LP-XX-YYYY-NNN`, 데이터 key 는 `category.field` 형식만 통과시킨다
(경로 조작으로 프로젝트 폴더 밖을 읽히지 않게).

## 폴링 대신 SSE 를 쓰려면

`useControlTower` 를 그대로 두고 `fetchImpl` 만 바꾸거나, 훅 내부의 `setTimeout` 루프를
`EventSource` 로 교체하면 된다. `control-tower.json` 이 갱신될 때 본체가 이벤트를 쏘면
폴링 간격 없이 즉시 반영된다. 현재는 의존성 없이 동작하는 폴링을 기본으로 두었다.

## 데이터 스키마

`control-tower.json` 구조는 `core/monitor.js` 의 `snapshot()` 이 정의한다.

```
{
  project:   { id, name, assetType, status },
  overall:   80,                       // 4트랙 가중합
  tracks: {
    production: { pct, weight: 50, label, done, total },
    validation: { pct, weight: 25, label, score, status, gatesPassed, gatesTotal, critical, major, minor },
    output:     { pct, weight: 15, label, specLocked, files: [{ path, label, exists }], manifestStatus },
    approval:   { pct, weight: 10, label, approved, reasons: [] }
  },
  agents:    [{ id, label, status, progress, activity, elapsedMs, depends, warnings, error }],
  health:    { level, mark, reason },
  bottleneck:{ id, label, elapsedMs, sharePct, dependents, impactLevel },
  waiting:   [{ id, label, waitingFor: [] }],
  timing:    { startedAt, finishedAt, elapsedMs, estimatedRemainingMs, note },
  activity:  [{ at, agent, message, level, records }],
  generatedAt
}
```

트랙 비중(50/25/15/10)은 `core/monitor.js` 의 `TRACK_WEIGHTS` 가 단일 소스다.
대시보드는 응답에 실린 `weight` 를 표시만 하고 자체 계산하지 않는다 —
두 곳에서 계산하면 화면과 실제가 어긋난다.
