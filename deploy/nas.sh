#!/usr/bin/env bash
#
# nas.sh — 엔진을 NAS 에 올린다 (2026-08-18 · 이관 ③).
#
#   deploy/nas.sh [--dry-run] [--host <user@addr>] [--root <경로>]
#
# ★★ 왜 만들었나: NAS 는 저장소를 clone 해 두지 않는다. 지금까지 사람이
#   tar-over-ssh 를 손으로 쳤고, **앱·CI 가 초록인데 NAS 만 옛 판**인 상태가
#   실제로 있었다. 그 상태는 아무 오류도 내지 않는다 — 새 기능이 그냥 없다.
#
# ★ 그래서 올리고 끝내지 않는다. **올린 뒤 지문을 대조하고, 살아났는지 묻는다.**
#   셋 중 하나라도 어긋나면 0 이 아닌 값으로 끝난다.
#
# ★ 되돌릴 길을 먼저 만든다 — 덮어쓰기 전에 백업을 뜬다. 백업 없이 덮어쓰면
#   되돌리려고 다시 tar 를 말아야 하고, 그 사이 서비스가 멈춘다.
set -euo pipefail

# ★★ 접속정보를 이 파일에 적지 않는다. **이 저장소는 public 이다** (D-10).
#   전에는 계정과 주소를 기본값으로 박아 두었는데, 그것이 곧 공개다.
#   환경변수로 준다:  export LP_NAS_HOST='사용자@주소'
HOST="${LP_NAS_HOST:-}"
ROOT="${LP_NAS_ROOT:-/volume1/docker/linkpilot}"
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --host) HOST="$2"; shift ;;
    --root) ROOT="$2"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "모르는 인자: $1" >&2; exit 64 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."
STAMP="$(date +%Y%m%d%H%M)"

# 주소가 없으면 **여기서 멈춘다.** 기본값을 두면 그 기본값이 곧 공개 정보가 된다
if [ -z "$HOST" ]; then
  echo "LP_NAS_HOST 가 없다 — 접속정보는 이 저장소에 두지 않는다 (public)." >&2
  echo "  export LP_NAS_HOST='사용자@주소'   # 필요하면 LP_NAS_ROOT 도" >&2
  exit 64
fi

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then say "  (dry-run) $*"; else eval "$@"; fi; }

say "엔진 → NAS"
say "  대상 : $HOST:$ROOT"
say "  판   : $(git rev-parse --short HEAD 2>/dev/null || echo '(git 아님)')"

# ── 1. 올리기 전에 로컬이 깨끗한지 본다 ────────────────────────────────
# 커밋 안 된 변경을 올리면 NAS 에만 있는 판이 생기고, 그 판은 어디에도 기록이 없다
if [ "$DRY" = 0 ] && [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
  say "  ⚠ 커밋되지 않은 변경이 있다 — NAS 에만 있는 판이 생긴다"
  say "     그래도 올리려면: LP_ALLOW_DIRTY=1 deploy/nas.sh"
  [ "${LP_ALLOW_DIRTY:-0}" = 1 ] || exit 3
fi

# ── 2. 백업 뜨고 올린다 ────────────────────────────────────────────────
say "1) 백업 + 전송"
run "tar czf - im-agent | ssh '$HOST' 'cd $ROOT && cp -a im-agent im-agent.bak-$STAMP && tar xzf -'"

# ── 3. 올라간 것이 **같은 파일인지** 지문으로 확인한다 ─────────────────
#    「전송 성공」은 내용이 같다는 뜻이 아니다. 실제로 재 본다
say "2) 지문 대조"
PROBE="im-agent/ui/platform/files.html im-agent/pipeline.js im-agent/ui/routes.cjs"
if [ "$DRY" = 1 ]; then
  say "  (dry-run) 로컬 지문:"
  for f in $PROBE; do say "    $(sha256sum "$f" | cut -c1-12)  $f"; done
else
  LOCAL="$(for f in $PROBE; do sha256sum "$f"; done | sort)"
  REMOTE="$(ssh "$HOST" "cd $ROOT && for f in $PROBE; do sha256sum \$f; done" | sort)"
  if [ "$LOCAL" != "$REMOTE" ]; then
    say "  ✗ 지문이 다르다 — NAS 가 옛 판이거나 전송이 덜 됐다"
    diff <(echo "$LOCAL") <(echo "$REMOTE") || true
    exit 4
  fi
  say "  ✓ 3개 파일 지문 일치"
fi

# ── 4. 다시 띄우고 살아났는지 묻는다 ───────────────────────────────────
say "3) 재시작 + healthz"
run "ssh '$HOST' 'cd $ROOT && ./stop-engine.sh || true; ./start-engine.sh'"
if [ "$DRY" = 0 ]; then
  ok=0
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if ssh "$HOST" 'curl -sf http://127.0.0.1:8181/healthz' >/dev/null 2>&1; then ok=1; break; fi
  done
  # ★ 「띄웠다」로 끝내지 않는다. 안 살아났으면 여기서 멈춰야 다음 사람이 안다
  if [ "$ok" != 1 ]; then
    say "  ✗ healthz 가 10초 안에 안 뜬다 — engine.log 를 본다"
    ssh "$HOST" "tail -30 $ROOT/engine.log" || true
    say "  되돌리려면: ssh $HOST 'cd $ROOT && rm -rf im-agent && mv im-agent.bak-$STAMP im-agent && ./start-engine.sh'"
    exit 5
  fi
  say "  ✓ healthz 응답"
fi

say ""
say "끝났다. 되돌리려면:"
say "  ssh $HOST 'cd $ROOT && rm -rf im-agent && mv im-agent.bak-$STAMP im-agent && ./start-engine.sh'"
say "이어서 확인: npm run verify:nas"
