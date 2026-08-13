# Control Tower — 순수 JS 판 (단일 HTML 본체용)

본체가 **단일 HTML 파일**(`linkpilot-platform.html`)일 때 쓴다.
React·Vite·번들러가 필요 없다. 상위 폴더의 React 판과 화면·스타일이 같다.

> React/Vite 프로젝트라면 이 폴더가 아니라 **상위 `ui/` 폴더**를 쓴다.

## 붙이는 법

`linkpilot-platform.html` 에 세 줄을 넣는다.

```html
<link rel="stylesheet" href="controlTower.css">
<div id="ct"></div>
<script src="control-tower.js"></script>
<script>
  LinkPilotControlTower.mount(document.getElementById('ct'), {
    projectId: 'LP-DC-2026-001',
    baseUrl: '/api/linkpilot',
  });
</script>
```

NAS 에 올릴 파일은 2개다 — `control-tower.js`, `../controlTower.css`.

### 한 파일로 합칠 때 주의

`control-tower.js` 를 HTML 안에 **통째로 붙여넣는다면** 닫는 스크립트 태그 문자열을
`<\/script>` 로 이스케이프해야 한다. HTML 파서는 문자열 안이든 주석 안이든
그 지점에서 스크립트를 끝내버리고, **화면이 통째로 빈 채로 아무 오류도 안 뜬다.**

`build-preview.js` 가 이 처리를 한다. 직접 합칠 일이 있으면 그 코드를 참고한다.

## 미리보기 (API 없이 화면만 확인)

```bash
npm run im:demo        # 데모 프로젝트 생성
npm run im:preview     # preview.html 생성
```

`im-agent/ui/vanilla/preview.html` 을 브라우저로 열면 실제 실행 결과가 그대로 보인다.
CSS·JS·스냅샷이 한 파일에 들어 있어 서버 없이 열린다.

## 옵션

| 옵션 | 설명 |
|---|---|
| `projectId` | 조회할 프로젝트 ID |
| `baseUrl` | 본체 API 경로 (기본 `/api/linkpilot`) |
| `snapshot` | 스냅샷을 직접 주입. 주면 **폴링하지 않는다** (미리보기용) |
| `onApprove` | 승인 콜백. 없으면 승인 버튼이 비활성 |
| `fetch` | fetch 구현 교체 (테스트용) |

반환값: `{ refresh(), stop(), state }`. 화면을 떠날 때 `stop()` 을 부른다.

## React 판과의 관계

**클래스명이 같다** (`lp-ct__*`). `controlTower.css` 한 벌을 두 구현이 공유한다 —
스타일시트가 두 벌이 되면 디자인 테마를 바꿨을 때 한쪽만 바뀐다.

**표시 로직도 같아야 한다.** 번들러 없이 코드를 공유할 방법이 없어 로직이 두 벌이 되었고,
`im-agent/test/ui-parity.test.js` 가 두 구현의 출력이 글자 단위로 같은지 검사한다.
특히 `progressGapNotice` 가 갈리면 **한쪽 화면에서만 배포 경고가 사라진다.**

> 이 테스트가 깨지면 둘 중 하나만 고친 것이다. 반드시 양쪽을 맞춘다.

## 이식하지 않은 것

- **데이터 계보 모달** (`Lineage.jsx`) — 별도 화면이라 필요할 때 옮긴다.
  API(`/lineage/:key`, `/impact/:key`)는 이미 `api-router.cjs` 에 있다.

## 지킨 것

- **값은 전부 `textContent`.** `innerHTML` 을 쓰지 않는다 — 프로젝트명·활동로그는
  사용자가 올린 문서에서 나온 문자열이다.
- **폴링 실패해도 마지막 화면을 지우지 않는다.** 대신 "언제 기준 화면인지" 밝힌다.
  화면이 비면 사용자가 작업이 사라진 줄 안다.
- **승인 버튼은 차단 사유가 남아 있으면 못 누른다.** 눌러서 실패하는 게 아니다.
- **산출물은 파일 존재 여부로 판정**한다. '생성됨' 표시만 하지 않는다.
- **탭이 백그라운드면 폴링을 멈춘다.** 실행 중 2초 / 완료 후 15초.
- **색을 하드코딩하지 않는다.** 프로젝트 테마(`12_Final/theme.css`)의 CSS 변수를 쓴다.
