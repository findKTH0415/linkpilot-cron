---
name: diagram-design
description: 도식·도표(흐름도·순서도·조직도·구조도·ERD·일정·사업 구조)를 그릴 때 쓴다 — 로컬 렌더 dot(계정 스킬 pdi-im-diagram-연결)이 먼저이고 IM·대외비는 그 길만(Mermaid 출력은 IM 본문 금지), 기밀 없는 설명 도식만 Diagrams 플러그인·Mermaid Chart, 그다음 Figma·제미나이. SVG+JPEG 로 내고 그려서 눈으로 본 뒤 싣는다.
---

# 도식은 Diagram design 먼저

〈2026-11-03 사장님 지시: 「Figma 보다 Diagram design으로 스킬에 지침으로 반영하여 넣어줘」〉
정본 규칙은 CLAUDE.md §27 한 곳이다. 이 스킬은 거기로 가는 절차다 — 여기 규칙을 새로 적지 않는다.

## 차례

1. **로컬 렌더 `dot`** — GraphViz `dot` 로 사업구조·자금흐름·권리관계·Gate·절차를 다 그린다. 계정 스킬 «pdi-im-diagram-연결»의 `pdi_diagram.py` 와 PDI 프리셋(색·서체·화살표 의미색)을 따른다.
   **IM·대외비 도식은 이 길만 쓴다** — 바깥 서버로 보내지 않는다. 없으면 깐다: `apt-get install -y graphviz`.
   **Mermaid(`mmdc`) 출력은 IM 본문에 쓰지 않는다** — 그라데이션·그림자 필터가 박혀 «그라데이션 0» 규칙에 걸린다(계정 스킬 v1.1 · 2026-11-03 22:58 KST). Mermaid 는 내부 메모 초안에만.
   페이퍼로지를 `~/.fonts` 에 깔고 `fc-cache -f` 를 먼저 돌린다 — 안 하면 상자 폭이 어긋난다.
1-1. **Diagram Design 플러그인**(cathrynlavery/diagram-design · MIT · 2.6.141) — 이 컨테이너 안에서 HTML·SVG 로 그린다(서버 없음 · 보내는 자료 없음 · PRIVACY.md). 45종(Sankey·Gantt·Wardley·스윔레인 등). 부를 때는 `diagram-design:diagram-design`.
   설치: `claude plugin marketplace add cathrynlavery/diagram-design` → `claude plugin install diagram-design@diagram-design`(사용자 범위 · 컨테이너가 바뀌면 다시 깐다).
   ★ 템플릿이 Google Fonts 를 부른다 — 우리 문서는 페이퍼로지로 바꾸고 그 링크를 뺀다. ★ IM 본문 도식은 계정 스킬대로 `dot` 이 정본이다 — 이 플러그인을 IM 에 쓸지는 사장님 판단 전이다.
2. **Diagrams 플러그인(Kroki) · Mermaid Chart 커넥터** — 바깥 서버에서 그린다. **기밀이 없는 설명 도식만**(작업 흐름·안내 그림).
   플러그인은 `ListPlugins`(키워드 `diagram`)로 깔렸는지 잰다. 커넥터는 `mcp__Mermaid_Chart__validate_and_render_mermaid_diagram`(ToolSearch) · 결과 JSON 의 `valid`·`rawSVG`.
3. **Figma(FigJam)** — 사장님이 직접 고칠 편집 원본 등록. 막히면 1·2로 문서를 끝내고 등록만 다음 판으로.
4. **제미나이** — 워크플로 «그림 짓기 (제미나이)»(`figure-gemini.yml`). 1~3 이 다 막혔을 때.

사진형·조감도는 이 차례가 아니다 — §7(실사 표준) · §27 ④.

## 지킬 것

- **사업 자료는 바깥에 보내지 않는다.** IM·검토자료·투자자·금액·주소가 든 도식은 1(로컬)로만 그린다 (CLAUDE.md §2 · 계정 스킬 «pdi-im-diagram-연결»).
- **숫자·이름은 받은 자료에 있는 것만** — 없으면 «확인 필요»로 둔다. 지어 넣지 않는다 (§4.9).
- **SVG + 같은 이름 JPEG** 를 함께 낸다 (§6-1). 헤드리스 크로미움으로 2배 해상도 JPEG 을 찍는다.
- **그려서 눈으로 본다** — 글자 겹침·선 위 글자 꺾임(한 글자씩 세로)·잘림. 선 이름표는 짧게(2~4자) 쓴다.
- **바꿔 간 도구를 답변에 적는다** — «Mermaid 로 그렸습니다(플러그인 미설치)»처럼.
- 대외 문서(IM)에 싣는 도식은 문서 서체·색 규격을 따른다 — Mermaid 기본 보라색 그대로 싣지 않는다(`%%{init: {"theme":"base","themeVariables":{...}}}%%` 로 색을 맞춘다).

## 재는 자리

- 2026-11-03 실측: Mermaid Chart 커넥터 `valid=true` · flowchart · SVG 63,457자 (변경→배포 흐름 예시 · 기밀 없음).
- 2026-11-03 실측: 이 컨테이너에 `dot` 없음 → `apt-get install graphviz` 로 2.43 깔고 SVG 렌더 확인. `mmdc` 는 IM 에 안 쓰므로 깔지 않았다(계정 스킬 v1.1).
- 자동 검사는 없다 — 바깥 커넥터라 이 저장소 테스트로 못 잰다. 그리는 턴마다 위 «그려서 눈으로 본다»로 잰다.
