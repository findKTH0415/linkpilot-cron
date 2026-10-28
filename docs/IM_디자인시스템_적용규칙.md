# IM 디자인시스템 적용규칙

> **이 문서는 손으로 고치지 않는다.** `npm run im:layouts` 가
> `im-agent/design/` 의 `tokens.js` · `themes.js` · `layouts.js` ·
> `rules.json` 을 읽어 만든다. 값을 바꾸려면 그 네 곳을 고치고 다시 돌린다 —
> 여기를 직접 고치면 다음 생성 때 조용히 지워진다.
>
> 왜 이렇게 하나: 규칙을 두 벌로 두면 **한쪽이 옛말을 하고, 그 상태가 아무
> 오류도 안 낸다** (CLAUDE.md §8-1). 실제로 `--lime-deep` 이 세 값으로
> 갈려 있었고 아무도 몰랐다.

## 1. 무엇이 정해져 있나

| 항목 | 수 | 단일 소스 |
| --- | --- | --- |
| 레이아웃 | 12 | `design/layouts.js` |
| 테마 | 13 | `design/themes.js` |
| 문체 | 9 | `design/themes.js` WRITING |
| 정보 밀도 | 3 | `design/themes.js` DENSITY |
| 문서 종류 | 11 | `design/themes.js` DOC_PROFILE |
| 디자인 규칙 | 14 | `design/rules.json` |

지면은 A4 210×297mm, 여백 17mm 이다.

## 2. 레이아웃 12종

| ID | 이름 | 쓰는 자리 | 필요한 자료 |
| --- | --- | --- | --- |
| `L01` | Full Image | 표지·자산 전경·입지 항공사진 | image |
| `L02` | Two Column | 서술 + 데이터 병렬 | 없음 |
| `L03` | Three Column | 3개 축 비교 | 없음 |
| `L04` | KPI Dashboard | 핵심 지표 카드 | kpi |
| `L05` | Chart Focus | 차트 중심 | chart |
| `L06` | Table Focus | 표 중심 | table |
| `L07` | Map Focus | 지도·위성·GIS | map |
| `L08` | Timeline | 일정·단계 | timeline |
| `L09` | Comparison | 경쟁·대안 비교 | table |
| `L10` | Investment Structure | 자본구조·지분구조 | 없음 |
| `L11` | Risk Matrix | 위험 매트릭스 | flags |
| `L12` | Full Text | 순수 서술 | 없음 |

## 3. 어떤 절이 어떤 레이아웃으로 가는가

아래 표는 **옮겨 적은 것이 아니라** `layouts.pick()` 을 실제로 돌린 결과다.
규칙을 고치면 이 표가 따라 바뀐다.

| 절의 내용 | 고른 레이아웃 | 고른 이유 |
| --- | --- | --- |
| 지적·위성 자료가 있는 절 | `L07` Map Focus | 지도·위성 자료 포함 |
| 위험 플래그가 붙은 절 | `L11` Risk Matrix | 위험 플래그 포함 |
| 민감도 분석이 있는 절 | `L05` Chart Focus | 민감도·차트 자료 |
| 일정만 있는 절 | `L08` Timeline | 일정 정보 |
| 표와 지표가 함께 있는 절 | `L06` Table Focus | 지표 표 |
| 표만 있는 절 | `L06` Table Focus | 표 포함 |
| 지표만 있는 절 | `L04` KPI Dashboard | 핵심 지표 |
| 이미지만 있는 절 | `L01` Full Image | 이미지 자료 |
| 자료가 거의 없는 절 | `L12` Full Text | 자료 부족 |
| 순수 서술 절 | `L12` Full Text | 서술 중심 |

★ 위에 안 나오는 레이아웃(`L02` · `L03` · `L09` · `L10`)은
**자동 판정으로는 안 나온다.** 테마가 `layouts` 로 지정할 때만 쓰인다 —
없는 것을 있는 것처럼 적지 않는다.

## 4. 테마 13종

| ID | 이름 | 쓰는 곳 | 문체 | 주색 |
| --- | --- | --- | --- | --- |
| `institutional` | Institutional | 기관투자자 / PF / Credit | executive | `#10233C` |
| `global_ib` | Global Investment Bank | M&A / 글로벌 투자자 | executive | `#0B1B2B` |
| `private_equity` | Private Equity | PE / VC / 대체투자 | persuasive | `#14213D` |
| `real_estate` | Real Estate Investment | 부동산 개발 / 매입 / 매각 | persuasive | `#12314B` |
| `corporate` | Corporate | 기업 보고서 / 사업계획서 | executive | `#17457A` |
| `premium` | Premium | 호텔 / 복합개발 / 랜드마크 | persuasive | `#14100E` |
| `minimal` | Minimal | CEO / Executive 보고 | plain | `#111827` |
| `technology` | Technology / Data Center | Data Center / AI / ICT | technical | `#0E1A2B` |
| `renewable` | Renewable Energy | Solar / Wind / ESS / Hydrogen | technical | `#0F3D2E` |
| `infrastructure` | Infrastructure | SOC / 물류 / 산업단지 | technical | `#263238` |
| `luxury` | Luxury / Hospitality | 호텔 / 리조트 / 복합관광 | brand | `#1B1410` |
| `government` | Government / Public | 공공기관 / 지자체 / 정책사업 | official | `#12365E` |
| `custom` | Custom | 사용자 지정 | — | `#10233C` |

테마가 바꾸는 것은 **팔레트·타이포·표지 형식·차트 색·강조 KPI·선호 레이아웃**뿐이다.
구조 토큰(지면 기하 · 괘선 두께 · 표 규격)은 **바꾸지 않는다** — 구조까지 테마마다
다르면 문서가 서로 다른 시스템처럼 보인다.

## 5. 바꾸지 않는 값

| 이름 | 값 | 쓰는 곳 |
| --- | --- | --- |
| `body` | `#2E3949` | 본문 |
| `muted` | `#6E7A8C` | 보조 설명 |
| `faint` | `#8A8578` | 캡션 |
| `ruleStrong` | `#D8D2C6` | 굵은 괘선 |
| `ruleWeak` | `#E4DFD4` | 가는 괘선 |
| `negative` | `#B4453A` | 음수 · 경고 |
| `track` | `#EDE9E0` | 차트 트랙 |

## 6. 활자

- 제목 `'Noto Serif KR', 'Noto Serif CJK KR', serif`
- 본문 `'Noto Sans KR', 'Noto Sans CJK KR', sans-serif`

★★ **두 번째 이름을 지우지 않는다.** `Noto Sans KR` 만 적으면 그 이름으로
설치된 기계에서만 맞고, 없는 기계에서는 브라우저가 **말없이 아무 CJK 글꼴로
대신 그린다.** 실측(2026-08-17, CI 와 같은 조건)에서 중국어 글꼴(WenQuanYi
Zen Hei)로 나갔다. CI 가 까는 `fonts-noto-cjk` 가 심는 이름은
**`Noto Sans CJK KR`** 이지 `Noto Sans KR` 이 아니다.

| 이름 | 크기 | 쓰는 곳 |
| --- | --- | --- |
| `h1` | 48px | 표지 제목 |
| `h2` | 26px | 장 제목 |
| `h2Small` | 22px | 작은 장 제목 |
| `h3` | 15.5px | 절 제목 |
| `body` | 12.5px | 본문 |
| `table` | 11.5px | 표 |
| `tableHead` | 11px | 표 머리 |
| `caption` | 10.5px | 캡션 |
| `micro` | 8.5px | 각주 · 페이지번호 |

## 7. 규칙 14개

규칙의 단일 소스는 `design/rules.json` 이고, 게이트(`design/check.js`)와
이 문서가 **같은 파일**을 읽는다.

| ID | 규칙 | 적용 | 등급 | 왜 |
| --- | --- | --- | --- | --- |
| `D1-chapter-break` | 챕터 오프너는 항상 새 페이지 최상단에서 시작 | a4html | RED | 이전 챕터가 페이지 중간에 끝나도 다음 챕터는 다음 장 상단에서 시작해야 한다. 핸드오프 필수 요구사항. |
| `D2-caption-prefix` | 모든 표·차트 아래 캡션은 '자료출처: ' 로 시작 | a4html | RED | 출처 없는 표는 IM에서 근거가 없는 것과 같다. 핸드오프 공통 규칙. |
| `D3-no-emoji` | 대외 문서에 이모지 금지 | a4html,markdown | RED | PDI 하우스 스타일. 아침 브리핑(내부용)과 달리 IM은 대외 배포 문서다. |
| `D4-krw-only` | 금액은 원화(억원/조원) 표기, 음수는 △ | a4html | YELLOW | 핸드오프가 정한 단일 통화 규칙. 단위가 섞이면 표 간 비교가 깨진다. |
| `D5-palette` | IM 산출물은 IM 디자인 토큰만 사용 (아침 브리핑 팔레트 금지) | a4html,svg | RED | 브리핑 팔레트(#C00000/Arial)가 IM에 섞이면 핸드오프와 어긋난다. 실제로 매스 SVG에서 발생했던 사고. |
| `D6-print-color` | 인쇄 시 배경·막대·도넛이 실제로 인쇄되어야 한다 | a4html | RED | print-color-adjust: exact 가 없으면 네이비 박스가 흰색으로 인쇄된다. |
| `D7-page-geometry` | A4 210×297mm · 여백 17mm | a4html | RED | 핸드오프 고정 기하. 다르면 기존 리포트와 나란히 놓을 수 없다. |
| `D8-source-marking` | 공시·감사 원문값과 본 자료 산출·추정치를 표기에서 구분 | a4html,markdown | RED | 법적 고지 요건. 핸드오프 '이식 시 주의' 4번. |
| `D9-no-orphan-cell` | 표 셀은 1줄 표기 원칙 | a4html | YELLOW | 2줄 셀이 생기면 행 높이가 들쭉날쭉해지고 인쇄 시 페이지가 어긋난다. |
| `D10-scale-notice` | 사업 규모가 서식 가정 구간을 벗어나면 첫머리에 명시 | markdown,a4html | YELLOW | 값은 토큰으로 갈아끼워지지만 서술문은 그대로 남는다. 태양광 스펙 §10의 교훈. |
| `D11-theme-consistency` | 문서의 색·서체는 선택된 테마 팔레트에서만 나온다 | a4html | YELLOW | 테마를 골라놓고 다른 색이 섞이면 '한 프로젝트 = 한 디자인'이 깨진다. IM·PPT·Dashboard가 따로 놀게 된다. |
| `D12-secret-leak` | 산출물에 열쇠·비밀정보가 없다 | a4html,markdown,asset | YELLOW | CLAUDE.md §2 · 지침 §8·§12·§14.5. SECRET_ENV 는 로그만 가린다 — 최종 산출물은 아무도 훑지 않았다. 첫 판은 YELLOW 다: 오탐으로 문서가 아예 안 나가는 쪽이 더 나쁠 수 있어 세어 본 뒤 RED 로 올린다 (D-118). |
| `D13-personal-info` | 동의 없는 개인정보가 없다 | a4html,markdown,asset | YELLOW | 디자인 지시서 §10.4 — 「개인정보는 사용자가 제공하거나 승인한 정보만 사용한다」. 전화번호·주민번호·이메일 꼴을 훑는다. 이 저장소의 git 이력에 실제로 실명·번호가 남아 있었다. |
| `D14-rights-unchecked` | 권리 확인이 필요한 자산에 표시가 있다 | a4html,markdown,asset | YELLOW | 디자인 지시서 §14.5·§16 — 상표·폰트·이미지 권리. 지금은 아무도 안 본다. 확정이 아니라 **표시**다: 로고·상표·스톡 이미지가 보이면 RIGHTS_CHECK_REQUIRED 로 사람에게 넘긴다. 유사성 점검만으로 상표 등록 가능성을 확정하지 않는다(§10.5). |

## 8. 숫자 표기

- 금액은 원화 **억원 / 조원**, 음수는 **△**
- 캡션은 언제나 `자료출처:` 로 시작한다 — 출처 없는 표는 IM 에서 근거가 없는 것과 같다
- 숫자는 `tabular-nums` 로 자릿수를 맞춘다
- 표 셀은 한 줄로 두고, 폭이 모자라면 셀을 접는 대신 **표를 가로 스크롤**시킨다 (CLAUDE.md §6-3 ⑤)

## 9. 어디에 쓰나

| 자리 | 무엇을 읽나 |
| --- | --- |
| A4 인쇄 산출물 | `design/a4.js` — 핸드오프 규격이라 **인라인 style** 로 간다 (rules.json D7) |
| A4 밖 (견본 · 미리보기 · 화면에 얹는 조각) | `design/im-design-system.css` — 이 도구가 만든다 |
| 테마 고르는 화면 | `npm run im:themes` → `theme-gallery.html` |
| 레이아웃 견본 | `npm run im:layouts` → `layout-system.html` |

★ 플랫폼 화면 토큰은 `--lp-` 이고 **다른 체계다** (브리핑 #C00000 / Arial).
IM 토큰은 `--im-` 을 쓴다 — 접두어가 같으면 한 화면에 둘이 섞였을 때
**어느 쪽이 이겼는지 알 수 없다.**
