---
name: linkpilot-font
description: LinkPilot 플랫폼 화면·보고서의 글꼴을 고치거나 새 화면·갈래·카드를 만들 때 쓴다 — 숫자·영문까지 전부 페이퍼로지(Paperlogy), 대체는 Cambria. 같은 출처 fonts/ 먼저 · jsDelivr(커밋 고정) 다음. 한 곳만 바꾸면 «숫자만 다른 글꼴»이 오류 없이 남는다.
---

# LinkPilot 글꼴 — 페이퍼로지(Paperlogy)

〈2026-10-18 사장님 지시: 「LinkPilot 플렛폼에 적용하는 폰트는 정부: 숫자·영문 전부 폰트는 페이퍼로지(Paperlogy) …
 페이퍼로지3 Light · 페이퍼로지6 SemiBold · 페이퍼로지5 Medium · CambriaRegular 반영하여 스킬로 저장해」〉

규칙의 정본은 `CLAUDE.md` §6-3-0 아래 «글꼴은 페이퍼로지» 줄이다. 이 스킬은 **고치는 절차**다.

## 규칙

1. **화면 글자 전부** — 한글·숫자·영문 모두 `Paperlogy`. 숫자만 다른 글꼴로 남기지 않는다.
2. **굵기** — 본문 Light 300 · 보통 400 · 강조 Medium 500 · 제목 SemiBold 600 · 굵게 Bold 700. 지시서에 적힌 셋(3 Light · 5 Medium · 6 SemiBold)이 기본이고,
   앱이 이미 쓰는 400·700 도 같은 글꼴의 파일로 받는다(파일이 없으면 브라우저가 굵기를 지어내 획이 뭉개진다).
3. **대체** — `Paperlogy, Cambria, -apple-system, 'SF Pro Text', system-ui, 'Apple SD Gothic Neo', Pretendard, sans-serif`.
   Cambria 는 PDF 원본에 함께 박혀 온 영문 대체 글꼴이다 — 페이퍼로지를 못 받았을 때만 쓰인다.
4. **받는 자리** — 같은 출처 `fonts/Paperlogy-{3Light,4Regular,5Medium,6SemiBold,7Bold}.woff2` 먼저, 다음 jsDelivr
   `cdn.jsdelivr.net/gh/projectnoonnu/2408-3@<커밋 40자>/` (태그 말고 커밋 — `verify-build.js` 가 잰다). `font-display:swap`.
5. **v3·v4 디자인 시스템의 SF Pro 스택은 «대체»로 남는다** — 나중 지시가 이긴다.

## 어디에 있나 (`linkpilot-platform`)

| 자리 | 하는 일 |
|---|---|
| `linkpilot-platform.deploy.html` 첫 디자인 `<style>` | `@font-face` 다섯 · `--lp-font` · `body *:not(svg)…{font-family:var(--lp-font)!important}` (인라인 `fontFamily` 까지 덮는다) |
| `solar-report.php` · `lp-solar.js` | 보고서·PDF 쪽 (2026-10-05 부터 이미 Paperlogy) |
| 캔버스 카드(`ctx.font=…` · 명언·나의 글·예약·태양광 카드) | **Paperlogy 먼저** 〈2026-10-18 · platform #432〉 — 캔버스는 CSS 를 안 따르므로 그리는 함수가 `await window.lpFontsReady()` 를 먼저 부른다(다섯 굵기 · 3초 상한 · 못 받으면 대체 글꼴). 새 카드를 만들면 같은 두 가지(글꼴 차례 · 기다림)를 넣고 `test-mine-card.js` 처럼 그려서 잰다 |
| `test-design-v4.js` · `test-fonts-local.js` · `test-solar-report-v2.js` | 재는 자리 |

## 고칠 때 절차

1. 글꼴을 적는 자리를 **전부** 센다 — `grep -o "font-family:[^;\"}]*" …` · `grep -o "fontFamily:[^,}]*" lp-*.js` · `grep -o "\.font *= *[^;]*" …`.
   하나라도 다른 값을 쓰면 «숫자만 다른 글꼴»이 된다 (cron CLAUDE.md §6-2-1 의 fc-match 교훈).
2. 그 글꼴로 **화면에서 그려지는지** 잰다 — 헤드리스에서 `getComputedStyle(e).fontFamily` 첫 이름과 `document.fonts` 의 `status`.
   «깔려 있다»와 «그 이름으로 쓰인다»는 다른 사실이다.
3. 굳이 다른 글꼴이 필요한 칸(코드·숫자 대조표)은 `data-lp-font-keep` 를 붙여 덮어쓰기에서 뺀다 — 사람이 고른 예외만.
4. 대비 규칙(text-3 `.73`)은 글꼴과 상관없이 그대로다. Light 300 은 작은 글자(12px 미만)에 쓰지 않는다 — 획이 가늘어 대비가 더 떨어져 보인다.
