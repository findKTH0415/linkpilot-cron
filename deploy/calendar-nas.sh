#!/usr/bin/env bash
#
# calendar-nas.sh — 특일정보를 **국내 자리(NAS)에서** 받아 앱이 읽을 곳에 둔다
#                   〈2026-09-12 · D-206 실측 · CLAUDE.md §4〉
#
#   NAS 안에서 돈다. DSM 「작업 스케줄러」가 이 파일을 부른다.
#   쓰는 법:  bash deploy/calendar-nas.sh          (엔진 뿌리에서)
#
# ★★★ 왜 NAS 인가. **GitHub Actions 러너에서 `apis.data.go.kr` 이 안 열린다.**
#   첫 실행에서 5년 × 4갈래 **스무 칸 전부**가 응답 없이 죽었다(`fetch failed`).
#   러너가 해외 IP 라서다 — 활용신청·키와는 **아무 상관이 없다.**
#   그러니 이 갈래 수집은 국내 자리에서 돈다.
#
# ★★ **이 스크립트에는 접속 자격증명이 없다.** SSH 로 들어와서 부르는 것이 아니라
#   **NAS 가 스스로 자기 것을 부른다.** 데이터 열쇠도 여기 없다 — 엔진 뿌리의
#   `linkpilot.env` 에서 `im-agent/core/env.js` 가 읽는다 (§2 · 규정집 2-8).
#
# ★ **「못 닿음」을 「승인 안 됨」으로 적지 않는다.** `kasi.js` 의 `diagnose()` 가
#   그 둘을 갈라 주고, 이 스크립트는 그 말을 그대로 내보낸다. 뭉뚱그리면
#   **이미 하신 활용신청을 또 하시게 만든다.**
#
# ★ 되돌아오는 값
#     0  받았고 앱이 읽을 자리에 뒀다
#     3  자리(엔진 뿌리·node)가 없다 — 아무것도 안 건드렸다
#     4  받기는 했는데 **한 해도 못 채웠다** (열쇠·승인·그물 중 하나)
#     5  받았는데 **앱이 읽을 자리에 못 뒀다** — 받은 것은 살아 있다
set -uo pipefail

ROOT="${LP_ENGINE_ROOT:-/volume1/docker/linkpilot}"
WEB="${LP_CALENDAR_WEB:-}"            # 앱이 HTTP 로 읽을 자리. 안 주면 옮기지 않는다
FROM="${1:-}"
TO="${2:-}"

say() { echo "$*"; }

[ -d "$ROOT" ] || { say "엔진 뿌리가 없다: $ROOT — LP_ENGINE_ROOT 로 알려 주십시오"; exit 3; }
cd "$ROOT" || exit 3

NODE="$(command -v node || true)"
[ -n "$NODE" ] || NODE="/usr/local/bin/node"
[ -x "$NODE" ] || { say "node 를 못 찾았다 — DSM 에서 Node.js 패키지를 켜야 한다"; exit 3; }

say "──────── 특일정보 수집 (국내 자리) ────────"
say "자리: $ROOT · node: $($NODE -v 2>/dev/null || echo '?')"

# ★ 열쇠는 linkpilot.env 에서 env.js 가 읽는다. 여기서 값을 꺼내 보지 않는다 (§2)
if [ ! -f "$ROOT/linkpilot.env" ]; then
  say "linkpilot.env 가 없다 — 열쇠를 못 읽는다. 그래도 불러 본다 (진단이 이유를 말해 준다)"
fi

"$NODE" im-agent/tools/calendar-fetch.js $FROM $TO
FETCH_RC=$?

say ""
say "──────── 요약 ────────"
cat data/_calendar/_summary.md 2>/dev/null || say "(요약이 없다)"

# ★ 「돌았다」와 「채워졌다」는 다른 사실이다 — 파일 개수로 센다 (§8 「걸었다 ≠ 닿았다」)
YEARS="$(ls data/_calendar/*.json 2>/dev/null | wc -l | tr -d ' ')"
say ""
say "받은 해: ${YEARS} 개"
if [ "$YEARS" = "0" ]; then
  say "★ 한 해도 못 채웠다. 위 요약의 «이유»를 보십시오 — 「못 닿음」과 「승인 안 됨」은 다른 사실입니다"
  exit 4
fi

# ★ 앱이 읽을 자리에 둔다. 자리를 안 알려 주면 «옮기지 않았다»고 말한다 (조용히 넘어가지 않는다)
if [ -z "$WEB" ]; then
  say "★ LP_CALENDAR_WEB 이 안 켜져 있어 **앱이 읽을 자리로 옮기지 않았다** — 받은 것은 위 자리에 있다"
  exit 0
fi
mkdir -p "$WEB" 2>/dev/null || { say "앱 자리를 못 만들었다: $WEB"; exit 5; }
cp -f data/_calendar/*.json "$WEB"/ 2>/dev/null || { say "앱 자리로 못 옮겼다: $WEB"; exit 5; }
cp -f data/_calendar/_summary.md "$WEB"/ 2>/dev/null || true

COPIED="$(ls "$WEB"/*.json 2>/dev/null | wc -l | tr -d ' ')"
say "앱이 읽을 자리에 둔 해: ${COPIED} 개 → $WEB"
[ "$COPIED" = "$YEARS" ] || { say "★ 옮긴 개수가 받은 개수와 다르다 (${COPIED} ≠ ${YEARS})"; exit 5; }

say "끝났다 — 받았고 앱이 읽을 자리에 뒀다 (수집 되돌아온 값 ${FETCH_RC})"
exit 0
