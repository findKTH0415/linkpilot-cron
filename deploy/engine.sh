#!/usr/bin/env bash
#
# engine.sh — **엔진을 올리고, 안 살아나면 스스로 되돌린다** 〈2026-08-23 · D-88〉.
#
#   deploy/engine.sh <NAS_HOST> <NAS_USER> [ROOT]
#
# ★★★ 왜 만들었나. 화면 열여섯은 `deploy-nas` 가 올린다. **엔진은 아무도 안
#   올렸다.** NAS 에 `im-agent.bak-*` 폴더가 스무 개 쌓여 있는 것이 그 증거다 —
#   사람이 손으로 tar 를 말아 왔다는 뜻이다.
#
#   그래서 2026-08-23 에 「＋ 신규프로젝트 → 만들기」가 `POST /projects` 에서
#   404 였다(D-87). **화면은 새 판, 서버는 옛 라우팅 표.** 화면만 올리는
#   자동배포는 그 어긋남을 **더 빨리 만들 뿐**이다.
#
# ★★★ **엔진은 화면과 다르다 — 잘못되면 서비스가 멈춘다.**
#   화면이 잘못되면 새로고침으로 끝나지만, 엔진이 안 뜨면 보고서 생성이 통째로
#   죽는다. 그리고 자동배포에는 **지켜보는 사람이 없다.**
#   그래서 이 스크립트는 「올렸다」로 끝내지 않는다:
#
#     ① 되돌릴 자리를 **먼저** 만든다 (im-agent.bak-<시각>)
#     ② 갈아 끼우고 다시 띄운다
#     ③ 살아났는지 **묻는다** (최대 30초)
#     ④ 안 살아나면 **스스로 되돌리고**, 되돌린 판이 살아났는지 또 묻는다
#     ⑤ 그러고 나서 빨갛게 끝낸다 — 되돌렸다고 초록으로 끝내지 않는다
#
# ★ 되돌아오는 값
#     0  올라갔고 살아 있다
#     3  자리(경로·권한)가 없다 — **아무것도 안 건드렸다**
#     4  올라간 것이 보낸 것과 다르다 — 갈아 끼우기 전에 멈췄다
#     5  안 살아나서 **되돌렸다** (옛 판으로 서비스는 살아 있다)
#     6  되돌렸는데 그것도 안 산다 — **사람이 봐야 한다**
#
# ★ 접속정보를 이 파일에 적지 않는다. **이 저장소는 public 이다** (D-10 · §2).
set -uo pipefail

HOST="${1:-${LP_NAS_HOST_ONLY:-}}"
USER_="${2:-${LP_NAS_USER:-}}"
ROOT="${3:-${LP_ENGINE_ROOT:-/volume1/docker/linkpilot}}"
KEY="${LP_SSH_KEY:-$HOME/.ssh/id_deploy}"
PORT="${LP_ENGINE_PORT:-8181}"
KEEP="${LP_KEEP_BAK:-5}"
WAIT="${LP_HEALTH_WAIT:-30}"

if [ -z "$HOST" ] || [ -z "$USER_" ]; then
  echo "쓰는 법: deploy/engine.sh <NAS_HOST> <NAS_USER> [ROOT]" >&2
  exit 64
fi

cd "$(dirname "$0")/.."
# ★ 시각은 한 곳에서만 만든다 (§8 · core/kst.js 와 같은 규칙). 러너는 UTC 다
STAMP=$(TZ=Asia/Seoul date +%Y%m%d%H%M)
BAK="im-agent.bak-$STAMP"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=20 -i $KEY $USER_@$HOST"

say() { printf '%s\n' "$*"; }

say "엔진 → NAS  ($ROOT · 판 $STAMP)"

# ── ① 자리부터 본다. 없는 자리에 tar 를 풀면 반쯤 풀린 상태가 남는다 ───────
CHK=$($SSH "test -d '$ROOT' || { echo NOROOT; exit 0; }
            test -w '$ROOT' || { echo NOWRITE; exit 0; }
            test -f '$ROOT/im-engine-server.cjs' || { echo NOSRV; exit 0; }
            test -x '$ROOT/start-engine.sh' || { echo NOSTART; exit 0; }
            echo OK" 2>&1 | tr -d '\r' | tail -1)
case "$CHK" in
  OK) say "  자리 확인: 있고, 쓸 수 있고, 기동 스크립트가 있다" ;;
  NOROOT)  say "::error::엔진 루트가 없다: $ROOT — 실제 경로를 확인한다"; exit 3 ;;
  NOWRITE) say "::error::엔진 루트에 쓸 수가 없다 — 그 계정의 권한을 본다"; exit 3 ;;
  NOSRV)   say "::error::$ROOT 에 im-engine-server.cjs 가 없다 — 엔진 루트가 다른 곳이다"; exit 3 ;;
  NOSTART) say "::error::$ROOT/start-engine.sh 가 없거나 실행 권한이 없다 — 되띄울 방법이 없으므로 손대지 않는다"; exit 3 ;;
  *)       say "::error::자리를 확인하지 못했다: $CHK"; exit 3 ;;
esac

# ── ② 스테이징으로 먼저 푼다. 살아 있는 im-agent 를 직접 덮지 않는다 ───────
#    직접 덮으면 tar 가 도는 **그 몇 초 동안** 엔진이 반쯤 새 파일을 읽는다.
STAGE="$ROOT/.im-agent.stage"
say "1) 보내기 (스테이징)"
# ★ 테스트·표본·문서는 안 보낸다. 엔진이 안 읽고, 크기만 세 배가 된다
if ! tar czf - \
      --exclude='im-agent/test' \
      --exclude='im-agent/samples' \
      --exclude='im-agent/docs' \
      --exclude='node_modules' \
      --exclude='.DS_Store' \
      im-agent \
   | $SSH "rm -rf '$STAGE' && mkdir -p '$STAGE' && tar xzf - -C '$STAGE'"; then
  say "::error::보내기가 실패했다 — **아무것도 안 갈아 끼웠다.** 서비스는 그대로다"
  $SSH "rm -rf '$STAGE'" >/dev/null 2>&1
  exit 4
fi

# ── ③ 보낸 것과 도착한 것이 같은가. 「전송 성공」은 같다는 뜻이 아니다 ──────
say "2) 지문 대조"
PROBE="im-agent/ui/routes.cjs im-agent/ui/api-router.cjs im-agent/ui/report-api.cjs im-agent/pipeline.js"
LOCAL=$(for f in $PROBE; do sha256sum "$f"; done | awk '{print $1, $2}' | sort)
REMOTE=$($SSH "cd '$STAGE' && for f in $PROBE; do sha256sum \$f; done" 2>/dev/null \
         | tr -d '\r' | awk '{print $1, $2}' | sort)
if [ "$LOCAL" != "$REMOTE" ]; then
  say "::error::도착한 것이 보낸 것과 **다르다** — 갈아 끼우기 전에 멈춘다. 서비스는 그대로다"
  diff <(printf '%s\n' "$LOCAL") <(printf '%s\n' "$REMOTE") || true
  $SSH "rm -rf '$STAGE'" >/dev/null 2>&1
  exit 4
fi
say "  ✓ 네 파일 지문 일치 (routes · api-router · report-api · pipeline)"

# ── ④ 갈아 끼우고 다시 띄운다 ──────────────────────────────────────────────
say "3) 갈아 끼우기 + 재시작"
$SSH "cd '$ROOT' \
      && rm -rf '$BAK' \
      && mv im-agent '$BAK' \
      && mv '$STAGE/im-agent' im-agent \
      && rm -rf '$STAGE' \
      && { ./stop-engine.sh >/dev/null 2>&1 || true; } \
      && rm -f engine.pid \
      && ./start-engine.sh" 2>&1 | sed 's/^/  /'

# ── ⑤ 살아났는지 **묻는다**. 「띄웠다」는 살아 있다는 뜻이 아니다 ───────────
#    ★ 두 길로 묻는다: `/healthz` 가 없는 판이 있다. 그때 「죽었다」로 읽고
#      멀쩡한 엔진을 되돌리면, 되돌림 그 자체가 사고가 된다.
say "4) 살아났는지 묻기 (최대 ${WAIT}초)"
ALIVE=0
i=0
while [ "$i" -lt "$WAIT" ]; do
  i=$((i + 1))
  sleep 1
  OUT=$($SSH "curl -sf -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:${PORT}/healthz 2>/dev/null \
              || curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:${PORT}/api/linkpilot/intake 2>/dev/null" \
        2>/dev/null | tr -d '\r' | tail -1)
  case "$OUT" in
    200|204) ALIVE=1; say "  ✓ ${i}초 만에 응답 (HTTP $OUT)"; break ;;
  esac
done

if [ "$ALIVE" = "1" ]; then
  # ── ⑥ 쌓인 백업을 정리한다. 스무 개가 쌓여 있던 자리다 ──────────────────
  #    ★ **살아난 뒤에만** 지운다. 되돌릴 자리를 지우고 나서 죽으면 끝이다.
  GONE=$($SSH "cd '$ROOT' && ls -1d im-agent.bak-* 2>/dev/null | sort -r | tail -n +$((KEEP + 1))" \
         2>/dev/null | tr -d '\r')
  if [ -n "$GONE" ]; then
    N=$(printf '%s\n' "$GONE" | wc -l | tr -d ' ')
    # ★★ **지웠다고 말하기 전에 다시 센다** 〈2026-08-23 · 실제로 안 지워지고 있었다〉.
    #   앞 판은 목록을 만들고 `rm -rf` 를 던진 뒤 **결과를 안 보고** 「N개 지움」
    #   이라고 적었다. 그런데 NAS 에는 백업이 열여섯 개 그대로 남아 있었다 —
    #   한 건에 ssh 를 한 번씩 새로 붙이느라 느렸고, 실패해도 `>/dev/null` 이
    #   전부 삼켰다. **재는 장치가 아무것도 안 재고 초록으로 끝나는 결**이다
    #   (M-11 · M-12 와 같다).
    # ★ 그래서 ① ssh 한 번으로 몰아 지우고 ② **다시 세어** 남은 수로 말한다.
    LIST=$(printf '%s\n' "$GONE" | sed "s|^|'|; s|$|'|" | tr '\n' ' ')
    LEFT=$($SSH "cd '$ROOT' && rm -rf $LIST; ls -1d im-agent.bak-* 2>/dev/null | wc -l" \
           2>/dev/null | tr -d '\r' | tail -1)
    case "$LEFT" in
      ''|*[!0-9]*) say "  옛 백업을 지웠는지 **못 쟀다** — 남은 수를 세지 못했다" ;;
      *)
        if [ "$LEFT" -le "$KEEP" ]; then
          say "  옛 백업 ${N}개 지움 · 남은 것 ${LEFT}개 (최근 ${KEEP}개는 남긴다)"
        else
          say "  ⚠️  ${N}개를 지우라고 했는데 아직 ${LEFT}개가 남아 있다 — 권한을 본다"
        fi ;;
    esac
  fi
  say ""
  say "끝났다. 되돌릴 자리: $ROOT/$BAK"
  exit 0
fi

# ── ⑦ 안 살아났다 — **스스로 되돌린다** ────────────────────────────────────
#    자동배포에는 지켜보는 사람이 없다. 여기서 손을 놓으면 서비스가 멈춘 채로
#    아침까지 간다.
say "::error::엔진이 ${WAIT}초 안에 응답하지 않는다 — **되돌린다**"
say "── engine.log 끝 40줄 ──"
$SSH "tail -40 '$ROOT/engine.log'" 2>&1 | sed 's/^/  /'

$SSH "cd '$ROOT' \
      && { ./stop-engine.sh >/dev/null 2>&1 || true; } \
      && rm -rf im-agent \
      && mv '$BAK' im-agent \
      && rm -f engine.pid \
      && ./start-engine.sh" 2>&1 | sed 's/^/  /'

BACK=0
i=0
while [ "$i" -lt "$WAIT" ]; do
  i=$((i + 1))
  sleep 1
  OUT=$($SSH "curl -sf -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:${PORT}/healthz 2>/dev/null \
              || curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:${PORT}/api/linkpilot/intake 2>/dev/null" \
        2>/dev/null | tr -d '\r' | tail -1)
  case "$OUT" in 200|204) BACK=1; break ;; esac
done

if [ "$BACK" = "1" ]; then
  say "::error::**되돌렸다 — 옛 판으로 서비스는 살아 있다.** 새 판이 왜 안 떴는지는 위 engine.log 를 본다"
  exit 5
fi
say "::error::**되돌렸는데 그것도 안 산다 — 사람이 봐야 한다.** ssh 로 붙어 $ROOT/engine.log 를 본다"
exit 6
