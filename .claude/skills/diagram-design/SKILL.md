---
name: diagram-design
description: 도식·도표(흐름도·순서도·조직도·구조도·ERD·일정·사업 구조)를 그릴 때 쓴다 — Diagram design 먼저(Diagrams 플러그인 → Mermaid Chart 커넥터), 그다음 Figma, 막히면 제미나이. 기밀은 도식 글에 넣지 않고, SVG+JPEG 로 내고, 그려서 눈으로 본 뒤 싣는다.
---

# 도식은 Diagram design 먼저

〈2026-11-03 사장님 지시: 「Figma 보다 Diagram design으로 스킬에 지침으로 반영하여 넣어줘」〉
정본 규칙은 CLAUDE.md §27 한 곳이다. 이 스킬은 거기로 가는 절차다 — 여기 규칙을 새로 적지 않는다.

## 차례

1. **Diagrams 플러그인**(Kroki · `diagram` 스킬) — 깔려 있으면 먼저. PlantUML·D2·C4·ERD·GraphViz 등 20여 종.
   깔렸는지는 `ListPlugins`(키워드 `diagram`)로 잰다. 안 깔렸으면 2로 간다(멈추지 않는다).
2. **Mermaid Chart 커넥터** — `mcp__Mermaid_Chart__validate_and_render_mermaid_diagram`(ToolSearch 로 불러온다).
   돌려받는 JSON 의 `valid`·`rawSVG` 를 읽는다. 결과가 커서 파일로 오면 `jq -r .rawSVG` 로 꺼낸다.
3. **Figma(FigJam)** — 1·2 가 안 맞는 모양(자유 배치 그림·디자인 시안)일 때.
4. **제미나이** — 워크플로 «그림 짓기 (제미나이)»(`figure-gemini.yml`). 1~3 이 다 막혔을 때.

사진형·조감도는 이 차례가 아니다 — §7(실사 표준) · §27 ④.

## 지킬 것

- **기밀을 바깥에 보내지 않는다.** Kroki·Mermaid 는 바깥 서버에서 그린다. 투자자 이름·금액·주소·사람 이름은 «A사»·«약 N억» 처럼 가리거나 빼고, 못 가리면 3·4 또는 손으로 쓴 SVG 로 간다 (CLAUDE.md §2).
- **숫자·이름은 받은 자료에 있는 것만** — 없으면 «확인 필요»로 둔다. 지어 넣지 않는다 (§4.9).
- **SVG + 같은 이름 JPEG** 를 함께 낸다 (§6-1). 헤드리스 크로미움으로 2배 해상도 JPEG 을 찍는다.
- **그려서 눈으로 본다** — 글자 겹침·선 위 글자 꺾임(한 글자씩 세로)·잘림. 선 이름표는 짧게(2~4자) 쓴다.
- **바꿔 간 도구를 답변에 적는다** — «Mermaid 로 그렸습니다(플러그인 미설치)»처럼.
- 대외 문서(IM)에 싣는 도식은 문서 서체·색 규격을 따른다 — Mermaid 기본 보라색 그대로 싣지 않는다(`%%{init: {"theme":"base","themeVariables":{...}}}%%` 로 색을 맞춘다).

## 재는 자리

- 2026-11-03 실측: Mermaid Chart 커넥터 `valid=true` · flowchart · SVG 63,457자 (변경→배포 흐름 예시).
- 자동 검사는 없다 — 바깥 커넥터라 이 저장소 테스트로 못 잰다. 그리는 턴마다 위 «그려서 눈으로 본다»로 잰다.
