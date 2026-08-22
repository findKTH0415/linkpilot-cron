#!/usr/bin/env bash
#
# 크론-이관.sh — 아침 크론을 **새 저장소로 옮길 준비**를 한다 (D-19).
#
#   deploy/크론-이관.sh <나갈-폴더>
#   deploy/크론-이관.sh ~/linkpilot-morning
#
# ★★ 왜 스크립트인가: 파일이 삭제 커밋(ee24abb) 안에 있어서 손으로 꺼내면
#   **하나씩 빠뜨린다.** 실제로 그렇게 잃기 쉬운 것이 글꼴 3개(6.8MB)와
#   워크플로 4개다 — 없어도 push 는 되고, **다음 날 아침에야 안 도는 것을 안다.**
#
# ★ 이 스크립트는 **이 저장소를 건드리지 않는다.** 나갈 폴더에 꺼내 놓기만 한다.
#   push 는 사람이 한다 — 어디로 보낼지는 사람이 정하는 것이다.
set -euo pipefail

# 크론이 삭제된 커밋. 그 **직전**(^)에 파일들이 온전히 있다
DEL=ee24abb779db1783afd2540b8f270c236909945e

OUT="${1:-}"
if [ -z "$OUT" ]; then
  echo "쓰는 법: deploy/크론-이관.sh <나갈-폴더>" >&2
  echo "  예:    deploy/크론-이관.sh ~/linkpilot-morning" >&2
  exit 64
fi

cd "$(dirname "$0")/.."

# 삭제 커밋이 이 저장소에 있는지 먼저 본다. 없으면 아무것도 안 하고 멈춘다 —
# 반쯤 꺼내 놓고 멈추는 것이 가장 나쁘다
if ! git cat-file -e "$DEL^" 2>/dev/null; then
  echo "::삭제 커밋($DEL)을 못 찾았다 — 이 저장소가 맞는지 본다" >&2
  exit 1
fi

mkdir -p "$OUT"

# ★ 목록을 손으로 적지 않는다. **삭제 커밋이 지운 것 중** 크론에 속하는 것만 고른다.
#   손으로 적으면 다음에 하나가 늘었을 때 그 하나만 조용히 빠진다
FILES=$(git show --name-only --format= "$DEL" \
  | grep -E '^(send-morning-|fetch-daily-quote|fetch-laws|render-card|fonts/|\.github/workflows/(morning-|daily-quote|fetch-laws)|test/cron\.test\.js)' \
  | sort -u)

if [ -z "$FILES" ]; then
  echo "::옮길 파일을 하나도 못 찾았다 — 고르는 규칙이 파일 이름과 어긋났다" >&2
  exit 1
fi

n=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  mkdir -p "$OUT/$(dirname "$f")"
  git show "$DEL^:$f" > "$OUT/$f"
  sz=$(wc -c < "$OUT/$f")
  printf '  %8d  %s\n' "$sz" "$f"
  n=$((n + 1))
done <<< "$FILES"

echo
echo "$n 개를 $OUT 에 꺼냈다."
echo

cat > "$OUT/README-이관.md" <<'EOF'
# 아침 크론 — 이관 꾸러미

이 폴더는 `linkpilot-cron` 의 삭제 커밋에서 **크론에 속한 파일만** 꺼낸 것이다.

## 옮기고 나서 반드시 해야 하는 것

### 1) Secret 을 새 저장소에 다시 넣는다

**Secret 은 저장소를 따라오지 않는다.** 안 넣으면 워크플로가 초록으로 뜨다가
발송만 조용히 안 된다.

| 이름 | 무엇 |
|---|---|
| `KAKAO_REST_API_KEY` | 카카오 REST API 키 |
| `KAKAO_REFRESH_TOKEN` | 카카오 refresh token |
| `GEMINI_API_KEY` | 한줄생각 생성 |
| `SOLAPI_API_KEY` · `SOLAPI_API_SECRET` | 실패 알림 |
| `NAS_BASE_URL` | 풀버전 HTML 이 올라가는 곳 |
| `LAW_*` · `FRIENDS_URL` · `RECIPIENTS` | 법령 수집 · 수신자 |

**넣는 곳** 새 저장소 → **Settings → Secrets and variables → Actions →
[New repository secret]**

### 2) cron 시각을 다시 확인한다

**UTC 로 적는다.** 06:00 KST = `0 21 * * *` (UTC 21:00).
KST/UTC 변환 실수가 이 크론의 1순위 사고 원인이다.

### 3) 첫 발송을 손으로 한 번 돌려 본다

워크플로 화면에서 **[Run workflow]** 로 한 번 돌리고 카카오톡이 실제로 오는지
본다. 「초록으로 끝났다」는 발송됐다는 뜻이 아니다.

### 4) 옛 저장소에서 되살리지 않는다

`linkpilot-cron` 은 보고서 생성 전용으로 남는다. 양쪽에서 돌면 **하루에 두 번**
발송된다.
EOF

echo "다음에 할 일:"
echo "  1) GitHub 에서 새 저장소를 만든다 (Private 권장)"
echo "  2) cd $OUT && git init && git add -A && git commit -m '아침 크론 이관' "
echo "  3) git remote add origin <새 저장소 주소> && git push -u origin main"
echo "  4) $OUT/README-이관.md 를 읽고 **Secret 을 다시 넣는다** — 이것을 빠뜨리면"
echo "     워크플로는 초록인데 발송만 조용히 안 된다"
