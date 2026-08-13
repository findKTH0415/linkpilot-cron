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

엔드포인트 4개, **전부 읽기 전용**이다.

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
