# LinkPilot 아침 명언 카드 — 무인 친구톡 발송 (GitHub Actions + Solapi)

**NAS 외부망을 열지 않고, 별도 발송 서버도 없이** 매일 아침 6/7시(KST)에
프리미엄 명언("오늘의 생각 한 줄")을 카카오 **친구톡**으로 무인 발송합니다.

```
[GitHub Actions cron 07:00 KST]
  → Gemini로 오늘 명언 생성
  → Solapi 친구톡(CTA)으로 채널 친구들에게 발송
```
- 클라우드에서 돌기 때문에 **내 PC·NAS가 꺼져 있어도** 동작합니다.
- 비밀키는 모두 **GitHub Secrets**에 저장(코드에 미포함).

---

## 1. 사전 준비 (한 번만)

### A. 카카오 채널 + Solapi
1. **카카오 비즈니스 채널** 개설 (business.kakao.com) — 친구톡 발송 주체.
2. **Solapi** 가입 (solapi.com) → **카카오 채널 연동** → **발신프로필(pfId)** 발급.
   - 콘솔에서 친구톡 사용 신청/검수(채널 친구에게만 발송됨).
3. Solapi **API Key / API Secret** 발급 (대시보드 → 개발/연동).
4. (선택) SMS 대체발송을 쓰려면 **발신번호 등록**(SENDER_PHONE).

> 친구톡은 **채널을 친구추가한 사람**에게만 갑니다(법적 요건). 수신자는 채널 친구여야 합니다.

### B. Gemini 무료 키
- Google AI Studio(aistudio.google.com)에서 무료 API 키 발급.

---

## 2. GitHub 레포 만들기

1. GitHub에서 **비공개(private) 레포** 생성 (예: `linkpilot-morning-card`).
2. 이 폴더(`morning-card-cron/`) 내용을 레포 **루트**에 올립니다:
   ```bash
   cd morning-card-cron
   git init && git add . && git commit -m "morning card cron"
   git branch -M main
   git remote add origin https://github.com/<계정>/linkpilot-morning-card.git
   git push -u origin main
   ```
   - 폴더 구조가 그대로면 `.github/workflows/morning-card.yml` 이 자동 인식됩니다.

---

## 3. Secrets 등록 (레포 → Settings → Secrets and variables → Actions)

| 이름 | 값 |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio 키 |
| `SOLAPI_API_KEY` | Solapi API Key |
| `SOLAPI_API_SECRET` | Solapi API Secret |
| `SOLAPI_PFID` | 발신프로필 ID (예: `KA01PF...`) |
| `FRIENDS_URL` | ★ **앱 친구명단 자동연동(권장)**: `https://synologynas.tail43fc79.ts.net/friends.php` — 앱 "카드 보낼 친구"에 등록한 명단으로 자동 발송(설정 시 RECIPIENTS 불필요) |
| `RECIPIENTS` | (FRIENDS_URL 미설정 시) 수신자 휴대폰 JSON 배열. 예: `["01011112222","01033334444"]` |
| `ONLY_TO` | ★ **테스트 기간: 특정 1명에게만 발송**. 예: `01065503050` (김태형). 설정 시 FRIENDS_URL·RECIPIENTS 무시하고 이 번호로만. 테스트 끝나면 이 시크릿 삭제 |
| `NAS_BASE_URL` | ★ 카드 이미지 저장·음악뷰어용: `https://synologynas.tail43fc79.ts.net` (FRIENDS_URL 있으면 자동 추론되지만 명시 권장) |
| `CARD_NAME` | (선택) 카드 하단 보내는 사람 이름. 기본 `김태형` |
| `CARD_COMPANY` | (선택) 카드 하단 회사 상호. 예: `PDI Global infra structure Development` |
| `SENDER_PHONE` | (선택) 등록된 발신번호. 친구톡 실패 시 SMS 대체 |

> ★ 발송 형태: 매일 **9:16에 가까운(3:4) 명언 카드 이미지** + "음악과 함께 보기 ♪" 버튼으로 친구톡 발송(서버에서 직접 렌더링). 배경은 매일 자동 변경.
> ⚠️ 친구톡 발송 가능 시간 **08:00~20:50**. 워크플로 기본 **08:10 KST**.

---

## 4. 발송 시간 설정

`.github/workflows/morning-card.yml` 의 cron (UTC 기준):
- `0 22 * * *` → **07:00 KST** (기본)
- `0 21 * * *` → **06:00 KST** (주석 해제하면 추가)

> GitHub cron은 부하에 따라 수 분 지연될 수 있습니다(무료 정책). 정시 ±몇 분은 정상입니다.

---

## 5. 테스트

- 레포 → **Actions → morning-card → Run workflow** (workflow_dispatch) 로 즉시 1회 발송 테스트.
- 로그에 생성된 본문과 `✅ 발송 요청 완료` 가 보이면 정상.

---

## 메모 / 한계
- **친구톡 본문**은 Gemini가 매일 생성(명언+오늘의 생각+주간 마무리 인사). 이미지(9:16 카드)는 기본 텍스트 발송이며, `CARD_IMAGE_URL`을 주면 와이드 이미지로 첨부 시도합니다.
- Solapi 친구톡 **광고성 메시지**는 야간(20~08시) 발송 제한·수신거부 문구 등 정책이 있습니다. 정보성(명언/인사)으로 운영하되, Solapi/카카오 가이드의 광고 분류 기준을 확인하세요.
- 인물 중복 방지(최근 1개월)는 앱(브라우저)에서만 관리됩니다. 크론은 Gemini의 다양성에 의존합니다(원하면 레포에 사용이력 파일을 커밋하는 방식으로 강화 가능).
