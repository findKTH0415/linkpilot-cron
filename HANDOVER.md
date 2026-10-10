# HANDOVER — 새 세션으로 이어받기

작성 **2026-10-10 20:08 (KST)** · 앞 세션 `session_013AtoauB49GHvieyybGtZyM`
(컨텍스트가 가득 차서 새 세션으로 옮긴다).
첫 프롬프트: **「HANDOVER.md 읽고 이어서 진행」**

## 0. 먼저 할 것 (세션 시작 순서)
1. `git fetch origin && git checkout claude/guideline-inbox-d428` — 작업 가지. 원격 머리 `b97d290`.
2. `npm run hooks:on` — 되돌림 지킴이(§12-61)는 컨테이너마다 다시 켠다.
3. `npm run guide:status` — 지침함 현황(CLAUDE.md §18). «미반영»이 있으면 먼저 알린다.
4. `docs/미결정-사항.md` 의 🔴 를 확인한다(§9).

## 1. 지금 상태 — 지침함 (CLAUDE.md §18)
- 지침 6건 **모두 송부됨** (2026-10-10 19:07 · `docs/지침함/송부기록.md`) · **반영 0건** (`반영기록.md` 비어 있음).
  운영지침 `7dc8d38844dc` · 글로벌 개인화UI `a950f18eb917` · 다국어 `c830ff988e8d` ·
  관계지도 `28651d162842` · 링크드인 차별화 `25a851d049dc` · G-06 광고 구조 `915284477acb`
- 송부 뒤 Gemini 재검토(19:08): **다국어 = 반영 보류(BLOCK)**, 나머지 5건 = 보완 필요(HIGH 없음).
  ★ 다국어 건을 거둘지 사장님께 여쭌 상태 — 답이 오기 전에는 송부 기록을 건드리지 않는다.
- G-06 의 첫 «나라 × 업종»은 사장님 답이 없어 예시 셋(한국·태양광 / 방글라데시·인프라 / 베트남·부동산)으로 시작한다고 송부 기록에 적었다.
- 현황표의 검증 칸이 「검토 대기」인 것은 고장이 아니다 — 작업 가지 실행은 결과를 커밋하지 않는다(D-213 가드). 실제 판정은 Actions 실행 로그에 있다.

## 2. 검증자 열쇠 — 잰 값
| 검증자 | 상태 |
|---|---|
| 1 Gemini | 돈다 (gemini-3.1-flash-lite 만 · 판마다 판정이 흔들린다) |
| 2 ChatGPT | 열쇠 `OPENAI_API_KEY` 없음 |
| 3 Claude | `CLAUDE_API_KEY` = 401 · `CLODE_API_KEY2` = 인증 통과, **HTTP 400 «워크스페이스에 안 묶인 열쇠 — anthropic-workspace-id 필요»** |

- `b97d290` 이 그 400 을 따로 가르고, 저장소 **변수** `ANTHROPIC_WORKSPACE_ID` 가 있으면 머리에 싣게 했다(검사 12칸 · 사보타주 확인).
- **사장님 손 하나**: Claude 콘솔에서 워크스페이스 번호(`wrkspc_…`)를 찾아 GitHub linkpilot-cron → Settings → Secrets and variables → Actions → **Variables 탭** → `ANTHROPIC_WORKSPACE_ID`. 또는 워크스페이스 안에서 만든 열쇠로 `CLODE_API_KEY2` 를 바꾼다.
  넣으셨다고 하면 `guideline-review.yml` 을 **새로 걸어**(Re-run 금지) `[Claude]` 줄을 잰다.

## 3. 남은 권고 (값이 큰 순)
1. 워크스페이스 번호 — 위 2절.
2. 다국어 지침 송부 유지/취소 — 사장님 답 대기.
3. 지침 가지를 `main` 에 합치기 → 검증 결과가 main 에 커밋되어 현황표가 실제 판정을 보인다. (PR 초록 + §10 조건 셋)
4. `npm test` 의 빨간 칸 둘 — `design-options.test.js` · `design-layout.test.js` 「견본/화면에 이모지가 없다」. **main 에서도 빨갛다(이번 변경과 무관)** — 견본의 ★ 가 이모지로 세진다.
5. CLAUDE.md 를 «목차 + 규칙 한 줄»로 줄이기 — 세션이 빨리 차는 가장 큰 원인. 글자로 재는 검사가 여럿이라 함께 옮겨야 한다.

## 4. 산출물 자리
- 아티팩트 「G-06 광고 구조 교차검증」 (Artifact 목록에서 그 이름으로 찾는다 · 주소는 저장소에 안 적는다 · D-10)
- 프로젝트 문서 백업: `claude/지침함/2026-10-10-무료회원-광고-구글구조.md` · `claude/지침함/_교차검증결과-2026-10-10-G06.md`

## 5. 이 세션에서 배운 것
- 원격에 있는데 「unpushed」 경고가 뜨면: `remote.origin.fetch` 가 main 만 보고 있었다 → `+refs/heads/*:refs/remotes/origin/*` 로 넓혔다.
- 「Claude 열쇠 문제」는 401(값이 틀림)과 400 워크스페이스(값은 맞음)가 할 일이 다르다 — 갈라 적는다.
