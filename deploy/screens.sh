#!/usr/bin/env bash
#
# screens.sh — 화면 16개를 NAS 의 `im-flow` 로 올린다 〈2026-08-23〉.
#
#   deploy/screens.sh [--dry-run] [--host <사용자@주소>] [--dest <경로>]
#
# ★★ 왜 만들었나. 지금까지 이 일을 손으로 세 줄에 나눠 쳤고, **세 줄 다
#   한 번씩 틀렸다.**
#
#     ① `--out /volume1/web/im-flow`  → 그건 **NAS 안의 경로**다. 맥에는 없다
#     ② 붙여넣은 주석(`# …`)          → zsh 는 그것을 명령으로 읽는다
#     ③ `LP_NAS_HOST='사용자@주소'`    → 예시를 **그대로** 넣어 hostname 오류
#
#   셋 다 사람 잘못이 아니라 **안내가 나눠져 있어서** 난 일이다. 한 줄로 만든다.
#
# ★ 올리고 끝내지 않는다. **올린 뒤 지문을 대조한다** — 「올렸다」와 「닿았다」는
#   다른 말이고, 이 저장소는 그 차이로 세 번 헤맸다 (MEMORY M-20 · M-22 · M-25).
#
# ★ 접속정보를 이 파일에 적지 않는다 (§2). 환경변수로 받는다:
#     export LP_NAS_HOST='사용자@주소'      ← 진짜 값으로 바꿔서
set -euo pipefail

HOST="${LP_NAS_HOST:-}"
DEST="${LP_NAS_WEB:-/volume1/web/im-flow}"
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --host) HOST="$2"; shift ;;
    --dest) DEST="$2"; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "모르는 인자: $1" >&2; exit 64 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."

if [ -z "$HOST" ]; then
  echo "LP_NAS_HOST 가 없습니다 — 접속정보는 이 저장소에 두지 않습니다 (public)." >&2
  echo "  export LP_NAS_HOST='사용자@주소'      ← 진짜 값으로 바꿔서" >&2
  exit 64
fi

# ★★ **예시를 그대로 넣은 것을 여기서 잡는다** 〈2026-08-23 · 실제로 그랬다〉.
#   ssh 는 `hostname contains invalid characters` 라고만 말한다 — 그 문구만 보면
#   주소가 틀린 줄 알지, **예시를 안 바꿨다**는 생각은 안 든다.
if printf '%s' "$HOST" | LC_ALL=C grep -q '[^ -~]'; then
  echo "LP_NAS_HOST 에 예시 글자가 그대로 들어 있습니다: 한글이 섞여 있습니다." >&2
  echo "  '사용자@주소' 는 **바꿔 넣으실 자리**입니다. 진짜 계정과 주소를 넣습니다." >&2
  exit 64
fi
case "$HOST" in
  *@*) : ;;
  *) echo "LP_NAS_HOST 에 @ 가 없습니다: 사용자@주소 꼴이어야 합니다." >&2; exit 64 ;;
esac

# ★ `im-flow` 로 끝나야 한다. build-embed 가 같은 규칙을 쥐고 있다 —
#   경로를 잘못 적으면 16개가 엉뚱한 곳에 쏟아진다
case "$DEST" in
  */im-flow) : ;;
  *) echo "낼 곳이 im-flow 로 끝나지 않습니다: $DEST" >&2; exit 64 ;;
esac

TMP="$(mktemp -d)/im-flow"
trap 'rm -rf "$(dirname "$TMP")"' EXIT

# ★★★ **이 길은 두 번째 길이다** 〈2026-08-23 · D-84 재결정〉.
#
#   쓰는 곳은 **하나여야 한다.** 오늘 그 하나는 GitHub Actions 의 `deploy-nas`
#   워크플로다. 이 스크립트는 그 길이 못 돌 때(러너 장애·tailnet 문제) 쓰는
#   **대비**이지, 평소에 쓰는 길이 아니다.
#
#   ★ 왜 굳이 적어 두나. 둘을 **같은 날 같이 쓰면** 누가 마지막에 썼는지
#     아무도 모른다 — 그러면 「올렸는데 옛 판이 보인다」로 돌아온다.
#     D-84 가 그래서 한 번 쓰기를 통째로 지웠던 자리다.
printf '\033[33m%s\033[0m\n' "※ 이 길은 두 번째 길입니다 — 평소에는 GitHub Actions 의 deploy-nas 로 올립니다."
echo "   (그 길이 못 돌 때만 여기를 씁니다. 둘을 같은 날 같이 쓰지 않습니다 — D-84)"
echo

echo "화면 → NAS"
echo "  대상 : $HOST:$DEST"
echo "  판   : $(git rev-parse --short HEAD)"

echo "1) 사본 만들기"
npm run --silent im:embed -- --out "$TMP" >/dev/null
COUNT=$(find "$TMP" -maxdepth 1 -type f | wc -l | tr -d ' ')
# ★ `manifest.json` 은 화면이 아니라 **무엇을 올렸는지 적은 목록**이다.
#   합계만 적으면 「16개라더니 17개네」가 되어 사람이 한 번 멈춘다
echo "   화면 $((COUNT - 1)) 개 + 목록 1 개"

if [ "$DRY" = "1" ]; then
  echo "   (dry run — 여기서 멈춥니다. NAS 는 그대로입니다)"
  exit 0
fi

echo "2) 보내기"
# ★★ **`-O` 를 뺄 수 없다.** OpenSSH 9 부터 scp 는 속으로 SFTP 를 쓰는데,
#   Synology 에 「SFTP 사용자를 홈 폴더에 가둔다」 설정이 켜져 있으면 그쪽에서는
#   /volume1/web 이 **아예 없는 것처럼** 보인다. 그러면 「그런 폴더 없음」이라고
#   나와서, 멀쩡한 경로를 몇 번이고 다시 확인하게 된다.
ssh -o BatchMode=yes "$HOST" "mkdir -p '$DEST'"
scp -O -q "$TMP"/* "$HOST:$DEST/"

echo "3) 닿았는지 재기"
BAD=0
for f in "$TMP"/*; do
  n=$(basename "$f")
  a=$(shasum -a 256 "$f" 2>/dev/null | cut -c1-12 || sha256sum "$f" | cut -c1-12)
  b=$(ssh -o BatchMode=yes "$HOST" "sha256sum '$DEST/$n' 2>/dev/null | cut -c1-12" | tr -d '\r')
  if [ "$a" != "$b" ]; then
    echo "   ✗ $n  맥 $a · NAS ${b:-못 읽음}"
    BAD=1
  fi
done

if [ "$BAD" = "1" ]; then
  echo "어긋난 파일이 있습니다 — 다시 올립니다." >&2
  exit 1
fi

STAMP=$(grep -o 'data-lp-build="[0-9a-f]*"' "$TMP/report-flow.html" | head -1 | sed 's/.*"\(.*\)"/\1/')
echo "   ✓ $COUNT 개 모두 같습니다 (화면 $((COUNT - 1)) + 목록 1)"
echo
echo "화면 아래에 **판 $STAMP** 가 찍혀 있으면 반영된 것입니다."
