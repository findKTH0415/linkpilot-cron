---
name: card-ocr-ko
description: 명함 OCR·촬영 보정을 고치거나 새로 짤 때 쓴다 — 그림자 진 곳을 칸마다 밝혀 색을 고르게 하고, 한자·외래어(이름·직함·상호·부서)를 한글로 적고, 업종(음식점·카페·병원·약국 등)을 갈라 산업·태그·메모에 싣는다. 원문은 지우지 않고 [원문] 줄에 남긴다.
---

# 명함 OCR — 한글 표기 · 업종 구분

〈2026-10-14 사장님 지시: 「명함스캔시 한자, 외래어까지 한글로 번역해줘 특히 음식점, 상호, 병원, 카페등등 분별하여 스캔해주도록」〉

규칙의 정본은 `CLAUDE.md` §14 의 «명함 OCR 은 한자·외래어를 한글로» 줄이다. 이 스킬은 **고치는 절차**다.

## 어디에 있나 (`linkpilot-platform`)

| 자리 | 하는 일 |
|---|---|
| `linkpilot-platform.deploy.html` 의 `PREMIUM_OCR_SYSTEM_PROMPT` | AI 에게 무엇을 뽑으라 시키는가 (무료·유료 AI 가 같은 프롬프트를 쓴다) |
| 같은 파일의 `mapClaudeToForm` | AI 가 낸 JSON 을 연락처 칸으로 옮긴다 |
| 같은 파일의 `lpShadeFlat` · `autoEnhanceCard` | 찍은 사진의 그림자를 펴고 밝기·대비를 맞춘다 (한 장·연속 앞면·뒷면 모두) |
| `test-card-ko.js` | 위 둘을 떼어 내 돌려 잰다 (게이트 목록 `gate-tests.json` 에 있다) |

OCR 길은 이 둘뿐이다 — 고치기 전에 `grep -c PREMIUM_OCR_SYSTEM_PROMPT` · `grep -c mapClaudeToForm` 로 다시 센다(늘었으면 그 자리도 고친다).

## 지킬 것

1. **한글로 넣는 칸** — 이름(`name_ko`) · 직함(`title_ko`) · 회사·상호(`company_ko`) · 부서(`department_ko`).
   - 한자 → 한국어 읽기 (金龍飯店 → 금룡반점) · 일본어 → 한글 표기 · 영어 상호 → 통용 한글 표기 (Starbucks → 스타벅스).
2. **원문은 지우지 않는다** — 바꿔 넣은 칸의 원문은 메모 `[원문]` 줄에 남는다. 원문이 이미 한글이면 또 적지 않는다.
3. **한글 표기가 안 오면 원문 그대로** — 변환기가 읽기를 지어내지 않는다 (CLAUDE.md §4.6).
4. **업종 `business_type` 은 아래 17 중 하나** + 근거 `business_type_why`(무엇을 보고 골랐는지):
   음식점 · 카페·디저트 · 주점·바 · 병원·의원 · 치과 · 한의원 · 약국 · 미용·뷰티 · 숙박 · 학원·교육 · 소매·상점 · 부동산중개 · 법률·회계 · 금융기관 · 공공기관 · 일반기업 · 기타
   - 산업 칸 · `#태그`(가운뎃점·빈칸 뺌) · 메모 `[업종 구분] 음식점 — 근거` 에 싣는다.
   - **일반기업·기타는 산업 칸을 덮지 않고 태그·업종 줄도 안 쓴다** — AI 가 준 산업값이 그대로 산다.
   - 애매하면 «기타»다 — 근거 없이 고르지 않는다 (CLAUDE.md §4.9).
5. **사진의 그림자** — `autoEnhanceCard` 맨 앞의 `lpShadeFlat` 가 칸마다 밝기를 편다. 전체 밝기·감마만으로 고치지 않는다(한쪽 그림자가 남는다). 색은 R·G·B 같은 비율로만 바꾼다. 재는 자리 `test-card-shade.js`.
6. 갈래를 늘리거나 바꾸면 **프롬프트 목록과 `test-card-ko.js` 의 목록을 함께** 고친다.

## 고친 뒤

1. 크기: `node test-app-split.js` — 앱 gzip 600 KiB 한도. 넘으면 긴 경위 주석을 한 줄로 접는다(한도를 올리지 않는다).
2. 검사: `node test-card-ko.js` · `test-card-upright.js` · `check-tdz.js` · `check-undefined.js` · `verify-build.js linkpilot-platform.deploy.html`.
3. 사보타주: 옛 판(`git show HEAD:linkpilot-platform.deploy.html`)에 대어 `test-card-ko.js` 가 빨개지는지 본다.
4. PR → 초록 → 합치기 → 배포 판 지문 확인 (CLAUDE.md §8 · §10).
5. **못 잰 것**: 실제 AI 가 업종을 맞게 고르는지는 열쇠가 있는 자리에서만 잰다 — 통과로 적지 않는다.
