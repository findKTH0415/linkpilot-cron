#!/usr/bin/env bash
#
# yeoui893-nas.sh — 여의동 893 브이월드 수집을 **국내 자리(NAS)에서** 돌린다
#                   〈2026-09-19 · D-223 · CLAUDE.md §4 · §12-33〉
#
#   NAS 안에서 돈다. DSM 「작업 스케줄러」가 이 파일을 부른다.
#   쓰는 법:  bash im-agent/tools/yeoui893-nas.sh          (엔진 뿌리에서)
#             npm run yeoui893:nas                          (같은 것이 돈다)
#
# ★★★ **왜 워크플로가 아니라 이 자리인가** 〈§12-33 · D-222〉.
#   앞 판은 `.github/workflows/yeoui893-nas.yml` 이 **러너에서 tailnet 으로 NAS 에 붙어
#   ssh 로 curl 을 돌렸다.** 그 길은 돌기는 했는데 **수집 잡이 NAS 접속 자격증명을 갖는다** —
#   규정집 2-8 이 금지한 자리다(§4). 공공 API 를 부르는 잡에 접속정보를 섞어 두면
#   **그 잡이 받는 바깥 서버 오류 본문에 섞여 나갈 자리**가 생긴다 (§2).
#   ★ 그리고 그 워크플로가 실제로 **검사 아홉 칸을 빨갛게** 만들었다 — 배포 워크플로를
#     고르는 표지(`NAS_SSH_HOST`)를 함께 가졌기 때문이다.
#
# ★★ **여기에는 접속 자격증명이 «한 글자도» 없다.** 들어와서 부르는 것이 아니라
#   **NAS 가 스스로 자기 것을 부른다.** 국내 IP 로 나가므로 ssh 우회 자체가 필요 없다 —
#   `calendar-nas.sh` 가 이미 그 본보기다.
#   데이터 열쇠도 여기 없다 — 엔진 뿌리의 `linkpilot.env` 에서 `im-agent/core/env.js` 가 읽는다.
#
# ★★★ **없어지는 사실 둘을 적어 둔다** (§12 의 날씨 교훈 — 내리기 전에 먼저 잰다).
#   ① **결과가 저장소에 자동 커밋되지 않는다.** 앞 판 워크플로는 기본 가지에서 돌면
#      `data/yeoui893` 를 커밋했다. 여기서는 NAS 안에 남고, `LP_YEOUI_WEB` 을 주시면
#      앱이 읽을 자리로 옮긴다. 저장소로 올리려면 사람이 받아서 커밋한다.
#   ② **Actions 화면에서 누르는 길이 없어진다.** 대신 DSM 「작업 스케줄러」와
#      `npm run yeoui893:nas` 다. 되살리는 법은 `docs/브이월드-NAS-수집.md`.
#
# ★ 되돌아오는 값 — `calendar-nas.sh` 와 **같은 뜻으로** 맞춘다 (두 벌로 만들지 않는다)
#     0  받았다 (앱 자리로 옮겼거나, 옮길 자리를 안 주셨다)
#     3  자리(엔진 뿌리·node)가 없다 — 아무것도 안 건드렸다
#     4  돌기는 했는데 **한 필지도 못 받았다** (열쇠·활용API·그쪽 서버 중 하나)
#     5  받았는데 **앱이 읽을 자리에 못 뒀다** — 받은 것은 살아 있다
set -uo pipefail

# ★ 뿌리는 «이 파일이 놓인 자리»에서 끌어낸다 — im-agent/tools/ 의 두 칸 위가 엔진 뿌리다.
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${LP_ENGINE_ROOT:-$(cd "$HERE/../.." && pwd)}"
WEB="${LP_YEOUI_WEB:-}"               # 앱이 HTTP 로 읽을 자리. 안 주면 옮기지 않는다

say() { echo "$*"; }

[ -d "$ROOT" ] || { say "엔진 뿌리가 없다: $ROOT — LP_ENGINE_ROOT 로 알려 주십시오"; exit 3; }
cd "$ROOT" || exit 3

# ★★★ node 는 «여러 자리»를 훑는다 — DSM 작업 스케줄러의 PATH 가 좁기 때문이다.
#   판 번호를 박으면 판을 올리시는 날 조용히 깨지고 증상이 「안 깔렸다」와 같아진다.
NODE=""
for c in "$(command -v node 2>/dev/null || true)" \
         /usr/local/bin/node \
         /var/packages/Node.js_v*/target/usr/local/bin/node \
         /volume*/@appstore/Node.js_v*/usr/local/bin/node; do
  [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }
done
if [ -z "$NODE" ]; then
  say "node 를 못 찾았다."
  say "  · DSM 「패키지 센터」에서 Node.js 가 «실행 중»인지 먼저 보십시오."
  say "  · 실행 중인데도 이 말이 나오면 스케줄러가 그 자리를 못 보는 것입니다 —"
  say "    작업 설정 첫 줄에 PATH 를 넓혀 주시면 됩니다 (세션 답변에 적어 드립니다)."
  exit 3
fi

say "──────── 여의동 893 브이월드 수집 (국내 자리) ────────"
say "자리: $ROOT · node: $($NODE -v 2>/dev/null || echo '?')"

# ★ 열쇠는 linkpilot.env 에서 env.js 가 읽는다. 여기서 값을 꺼내 보지 않는다 (§2)
if [ ! -f "$ROOT/linkpilot.env" ]; then
  say "linkpilot.env 가 없다 — 열쇠를 못 읽는다. 그래도 불러 본다 (진단이 이유를 말해 준다)"
fi

# ★ 실거래는 기본으로 생략한다 — 36개월치를 이미 받아 두었고, 다시 받으면 한도만 먹는다 (§4.5).
#   다시 받으시려면 SKIP_TRADE=0 으로 부르십시오.
export SKIP_TRADE="${SKIP_TRADE:-1}"

"$NODE" scripts/yeoui893-fetch.mjs
FETCH_RC=$?

say ""
say "──────── 요약 ────────"
cat data/yeoui893/_summary.md 2>/dev/null || say "(요약이 없다)"

# ★ 「돌았다」와 「받았다」는 다른 사실이다 — 필지 결과 파일로 센다 (§8 「걸었다 ≠ 닿았다」)
GOT="$(ls data/yeoui893/*.json 2>/dev/null | grep -v vworld_diag | wc -l | tr -d ' ')"
say ""
say "받은 결과 파일: ${GOT} 개"
if [ "$GOT" = "0" ]; then
  say "★ 한 건도 못 받았다. 위 요약 맨 앞의 «판정»을 보십시오 —"
  say "  「그쪽 서버 5xx」와 「인증 거부」와 「못 닿음」은 **할 일이 정반대**입니다."
  exit 4
fi

# ★ 앱이 읽을 자리에 둔다. 자리를 안 알려 주면 «옮기지 않았다»고 말한다 (조용히 안 넘어간다)
if [ -z "$WEB" ]; then
  say "★ LP_YEOUI_WEB 이 안 켜져 있어 **앱이 읽을 자리로 옮기지 않았다** — 받은 것은 위 자리에 있다"
  exit 0
fi
mkdir -p "$WEB" 2>/dev/null || { say "앱 자리를 못 만들었다: $WEB"; exit 5; }
cp -f data/yeoui893/*.json "$WEB"/ 2>/dev/null || { say "앱 자리로 못 옮겼다: $WEB"; exit 5; }
cp -f data/yeoui893/_summary.md "$WEB"/ 2>/dev/null || true

COPIED="$(ls "$WEB"/*.json 2>/dev/null | wc -l | tr -d ' ')"
say "앱이 읽을 자리에 둔 파일: ${COPIED} 개 → $WEB"

say "끝났다 — 받았다 (수집 되돌아온 값 ${FETCH_RC})"
exit 0
