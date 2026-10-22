> 판정 0 — KCSC 건설기준 목록이 온다 (CodeList · Type=KDS · Code=101000 · 열쇠 인자 «key») — 배선할 수 있다

# 국가건설기준센터(KCSC) — 실측 진단

조회일 2026-10-22

> 주소·인자는 지침서 4-A 표 그대로다 — 지어 넣지 않는다 (CLAUDE.md §4.3).

- 열쇠 **`KICT_API_KEY`** 로 읽었다 (길이 43자 · 값은 안 적는다)

- `CodeList · Type=KDS · Code=101000 · 열쇠 인자 «Key»` — HTTP 400 · 849ms
  - 본문 «{"timestamp":"2026-10-22T00:20:49.495+00:00","status":400,"error":"Bad Request","path":"/openApi/CodeList"}»
  - 기준 목록 칸: **못 찾았다**
  - 칸 자리: **못 찾았다** — JSON 은 읽었으니 **이름이 다른 것**이다
- `CodeList · Type=KCS · Code=101000 · 열쇠 인자 «Key»` — HTTP 400 · 787ms
  - 본문 «{"timestamp":"2026-10-22T00:20:50.282+00:00","status":400,"error":"Bad Request","path":"/openApi/CodeList"}»
  - 기준 목록 칸: **못 찾았다**
  - 칸 자리: **못 찾았다** — JSON 은 읽었으니 **이름이 다른 것**이다
- `CodeList · Type=KDS · Code=101000 · 열쇠 인자 «key»` — HTTP 200 · 8308ms
  - 본문 «[{"no":4240,"codeType":"KDS","code":"100000","fullCode":"10101000","name":"공통설계기준","version":"2021","updateDate":"2023-03-08T16:27:00","list":null,"listParentCodes":[{"codeType":"KDS","fullCode":"10","name":"설계기준"},{"codeType":"KDS","fullCode":"1010","name":"공통편"},{"codeType":"KDS","fullCode":"10101» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 기준 목록 칸: **찾았다**
  - 칸 자리: **못 찾았다** — JSON 은 읽었으니 **이름이 다른 것**이다