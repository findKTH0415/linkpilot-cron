> 판정 5 — 대답은 왔는데 값을 못 뽑았다 — **규격**을 고친다. 열쇠 문제가 아니다 (자동차 5 · 대중교통 5). 아래 갈래별 판정을 본다

# 길찾기 소요시간 — 실측 진단

조회일 2026-09-19 · 서울시청 → 강남역

> 규격을 모르는 채 배선하지 않는다. 후보를 걸어 **무엇이 오는지부터** 본다 (CLAUDE.md §4).

## 1. 자동차 — 카카오모빌리티

- 열쇠 **`KAKAO_MOBILITY_REST_API`** 로 읽었다 (길이 32자 · 값은 안 적는다)

- `apis-navi /v1/directions` — HTTP 200 · 1424ms
  - 본문 «{"trans_id":"01a0b825c5b7784cb36edd5481a81d0f","routes":[{"result_code":0,"result_msg":"길찾기 성공","summary":{"origin":{"name":"","x":126.97839806210874,"y":37.566599979513605},"destination":{"name":"","x":127.02759129515296,"y":37.49789587828953},"waypoints":[],"priority":"RECOMMEND","bound":{"min_x":»
- `apis-navi /v1/future/directions` — HTTP 200 · 823ms
  - 본문 «{"trans_id":"01a0b825c98a748182669400fe43fd1a","routes":[{"result_code":0,"result_msg":"길찾기 성공","summary":{"origin":{"name":"","x":126.97839806210874,"y":37.566599979513605},"destination":{"name":"","x":127.02759129515296,"y":37.49789587828953},"waypoints":[],"priority":"RECOMMEND","bound":{"min_x":»

> **판정 5** — 대답은 왔는데 **값을 못 뽑았다** — 주소·파라미터 규격이 다르다. **열쇠 문제가 아니다.** 아래 본문을 보고 배선을 고친다

## 2. 대중교통 — ODsay

- 열쇠 **`ODSAY_API_KEY`** 로 읽었다 (길이 66자 · 값은 안 적는다)

- `원본 그대로` — HTTP 200 · 558ms
  - 본문 «{"error":[{"code":"500","message":"[ApiKeyAuthFailed] ApiKey authentication failed."}]}»
- `한 번 디코딩` — 원본과 같아 건너뛴다

> **판정 5** — 대답은 왔는데 **값을 못 뽑았다** — 주소·파라미터 규격이 다르다. **열쇠 문제가 아니다.** 아래 본문을 보고 배선을 고친다
