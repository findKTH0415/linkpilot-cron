# 〈전달용〉 `linkpilot-platform` 의 `im-flow/README.md`

> **이 파일은 이 저장소에서 쓰는 문서가 아닙니다.**
> `linkpilot-platform` 저장소(갈래 `platform`)의 `im-flow/README.md` 로
> **그대로 옮겨 주십시오.**
>
> 왜 여기 있나 — 이 세션은 저쪽 저장소에 쓰지 않습니다 (CLAUDE.md §8-2).
> 「무엇을 보내야 하는지」까지만 적어 두고, 보내는 것은 사람이 합니다.

---

## 옮길 내용 (아래 줄부터 파일 끝까지)

```markdown
# im-flow/ — 이 폴더는 **사본입니다**

보고서 요청·생산 화면 16개입니다. **이 저장소가 만든 것이 아닙니다.**

## 본체는 어디인가

`linkpilot-cron` 의 `im-agent/ui/platform/` 입니다.

2026-08-26 결정(D-120) — 두 저장소를 이름이 아니라 **일**로 가릅니다.

| | 맡는 일 |
|---|---|
| `linkpilot-platform` (여기) | **유저 접촉** — CRM · 태양광 · 통화분석 · 회원·요금 |
| `linkpilot-cron` | **보고서 요청 및 생산** — 이 폴더의 화면 16개 + 엔진 |

## 여기서 고치지 마십시오

고쳐도 **다음 복사에 조용히 덮입니다.** 오류도 안 나고 아무 표시도 안 남습니다.
고칠 것이 있으면 `linkpilot-cron` 쪽에서 고치고 다시 받으십시오.

## 맞는지 재는 법

`manifest.json` 이 이 폴더의 파일 목록과 지문(sha256)입니다.
`linkpilot-cron` 쪽에서 이렇게 견줍니다:

    node im-agent/tools/sync-im-flow.js --verify <이 폴더의 manifest.json>

같으면 0, 어긋나면 1 로 끝납니다.

## ★ 어긋나는 것이 예외가 아니라 기본값입니다

화면마다 **판 지문**(`LP_BUILD`)이 박혀 있습니다.
`linkpilot-cron` 이 **한 번만 바뀌어도 16개 전부**에 새 지문이 찍힙니다 —
내용이 그대로여도 그렇습니다.

실측: 2026-08-26 에 Agent 둘을 붙인 것만으로 **16개 중 15개**가 어긋났습니다.

그래서 **`linkpilot-cron` 이 나갈 때마다 이 폴더도 함께 받아야 합니다.**
「가끔 확인」으로는 못 잡습니다.

### 어긋난 채로 두면 무슨 일이

화면 아래 여덟 글자(`판 xxxxxxxx`)는 **「지금 내가 보는 것이 그 판인가」를
사진 한 장으로 가리라고** 만든 것입니다.
사본이 옛 지문을 달고 있으면 그 여덟 글자가 **틀린 답을 보여 줍니다.**

## 파일 16개

catalog.js · embed-bridge.js · fields-core.js · fields.html · files.html ·
flow-core.js · gate-core.js · inapp.js · intake.html · live-core.js ·
outputs.html · report-flow.html · reports.html · tokens.css ·
upload-core.js · versions-core.js

이 목록은 `linkpilot-cron` 의 배포 묶음과 **같은 목록**입니다
(`build-embed.js` 의 `required()` 한 곳에서 나옵니다).
```
