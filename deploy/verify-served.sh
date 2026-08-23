#!/usr/bin/env bash
#
# verify-served.sh — **「올렸다」와 「닿았다」를 갈라 준다** 〈2026-08-22 · M-25〉.
#
#   deploy/verify-served.sh <NAS_HOST> <NAS_USER> <DEST> [파일 …]
#
# ★★★ 왜 있나. 「반영이 안 된다」는 **한 증상이 아니라 셋**이다:
#
#     저장소 ≠ 디스크  → 올리기가 실제로 안 됐다        (M-20 · M-22)
#     디스크 ≠ HTTP    → **셋 중 하나** — 잰 길이 다르거나 / 다른 이가 덮었거나 /
#                        캐시. 이 자리에서는 구분되지 않는다 (M-25 정정)
#     셋이 같다        → 브라우저가 들고 있는 것이다
#
#   **셋은 화면에서 똑같이 보인다.** 그래서 나는 가장 만만한 셋째로 단정하고
#   「새로고침해 보십시오」를 세 번 반복했고, 세 번 다 틀렸다.
#
# ★ 표식(「이 글자가 있나」)이 아니라 **지문**을 댄다. 표식으로는 **두 판 전
#   파일**이 「새 판」으로 통과한다 — 실제로 그렇게 한 번 속았다.
#
# ★ 되돌아오는 값
#     0  세 자리가 모두 같다 (진짜로 닿았다)
#     1  어딘가 갈렸다 — 어디서 갈렸는지는 표준출력에 이름을 붙여 적는다
#
# ★★★ **올리기 「전」과 「뒤」는 뜻이 정반대다** 〈2026-08-23 · 실제로 배포가 막혔다〉.
#
#   `LP_BEFORE=1` 이면 **재기만 하고 절대 빨갛게 끝내지 않는다.**
#
#   왜 필요한가. 이 스크립트를 올리기 **전에도** 그대로 썼더니, 「저장소 ≠ 디스크」를
#   치명으로 보고 배포를 세웠다. 그런데 올리기 전에 저장소와 디스크가 다른 것은
#   **고장이 아니라 올리는 이유 그 자체**다. 그래서 **바꿀 것이 있는 날에는
#   무조건 배포가 막혔다** — 바꿀 것이 없는 날에만 초록인 장치였던 셈이다.
#   (2026-08-23 run #44 — 16개 중 4개가 「올리기가 안 됐다」로 죽고 Upload 는 건너뜀)
#
#   ★ 올린 **뒤**에는 그대로 치명이다. 그 자리에서는 정말로 올리기가 안 된 것이다.
#
# ★ 읽기만 한다. 아무것도 바꾸지 않는다.
set -u

# 올리기 전이면 재기만 한다 — 「다르다」는 고장이 아니라 할 일이 있다는 뜻이다
BEFORE="${LP_BEFORE:-0}"
if [ "$BEFORE" = "1" ]; then LVL=notice; else LVL=error; fi
# 올리기 전에는 BAD 를 올리지 않는다
mark() { [ "$BEFORE" = "1" ] || BAD=1; }

HOST="${1:-}"; USER_="${2:-}"; DEST="${3:-}"; shift 3 2>/dev/null || true
if [ -z "$HOST" ] || [ -z "$USER_" ] || [ -z "$DEST" ]; then
  echo "쓰는 법: deploy/verify-served.sh <NAS_HOST> <NAS_USER> <DEST> [파일 …]" >&2
  exit 64
fi

# 기본으로 재는 셋 — 화면 하나, 코어 하나, 그리고 사고가 났던 브리지
FILES=("$@")
# ★ `flow-core.js` 를 반드시 넣는다 〈2026-08-22〉 — **탭 목록·단계 목록이 여기 있다.**
#   앱 탭 바가 이 파일을 읽어 간다. 이것이 옛 판이면 화면은 새것인데 **탭만 옛것**이다.
[ ${#FILES[@]} -eq 0 ] && FILES=(flow-core.js embed-bridge.js files.html report-flow.html)

WEBPATH=$(printf '%s' "$DEST" | sed 's|^/volume1/web||')
KEY="${LP_SSH_KEY:-$HOME/.ssh/id_deploy}"
BAD=0

for NAME in "${FILES[@]}"; do
  LOCAL=$(sha256sum "im-agent/ui/platform/$NAME" 2>/dev/null | cut -c1-12)
  DISK=$(ssh -o BatchMode=yes -o ConnectTimeout=20 -i "$KEY" "$USER_@$HOST" \
    "sha256sum '$DEST/$NAME' 2>/dev/null | cut -c1-12" 2>/dev/null | tr -d '\r')

  # ★★★ **어느 주소로 쟀는지 적는다** 〈2026-08-22 · 본체 회신으로 드러났다〉.
  #   이 탐침은 tailnet 호스트의 **포트 80 으로 직접** 받는다. 그런데 앱은
  #   **Funnel 443 → 80** 으로 들어온다 — `Host:` 머리말이 다르다. DSM 웹 서비스는
  #   Host 로 가상 호스트를 고르므로 **문서 루트가 다를 수 있다.**
  #   ★ 그러면 「디스크 ≠ HTTP」가 나와도 그것은 캐시가 아니라 **다른 파일을 본 것**이다.
  #   본체가 Funnel 로 재니 4/4 가 일치했다. 그래서 잰 주소를 반드시 남긴다.
  SERVED=""; HDR=""; VIA=""
  for PORT in 80 5000 8080; do
    URL="http://${HOST}:${PORT}${WEBPATH}/${NAME}"
    B=$(curl -sS -m 20 "$URL" 2>/dev/null)
    [ -z "$B" ] && continue
    SERVED=$(printf '%s' "$B" | sha256sum | cut -c1-12)
    HDR=$(curl -sS -I -m 10 "$URL" 2>/dev/null)
    VIA="포트 ${PORT} (Host: ${HOST})"
    break
  done
  CC=$(printf '%s' "$HDR" | grep -i '^cache-control:' | tr -d '\r' | cut -d' ' -f2-)

  echo "── ${NAME}"
  echo "   저장소 ${LOCAL:-?} · 디스크 ${DISK:-?} · HTTP ${SERVED:-?}"
  echo "   HTTP 를 받은 길: ${VIA:-(못 받음)}"

  if [ -z "$LOCAL" ]; then
    echo "::${LVL}::${NAME} — 저장소에 그 파일이 없다. 재는 목록이 실제 파일과 어긋났다"
    mark
  elif [ -z "$DISK" ]; then
    echo "::${LVL}::${NAME} — NAS 디스크에서 못 읽었다 (경로·권한을 본다)"
    mark
  elif [ "$LOCAL" != "$DISK" ]; then
    if [ "$BEFORE" = "1" ]; then
      echo "::notice::${NAME} — 저장소와 디스크가 다르다. **올리기 전이므로 이것이 올릴 이유다** (바뀐 파일)"
    else
      echo "::error::${NAME} — **올리기가 실제로 안 됐다.** 저장소와 디스크가 다르다. 초록으로 끝난 배포가 파일을 안 바꾼 것이다 (M-20 · M-22)"
    fi
    mark
  elif [ -z "$SERVED" ]; then
    echo "::warning::${NAME} — 웹으로는 못 받았다. 이 경로로 안 열리는 자리일 수 있다"
  elif [ "$SERVED" != "$DISK" ] && [ "${LP_HTTP_FATAL:-0}" != "1" ]; then
    # ★★★ **HTTP 가 다른 것만으로는 빨갛게 끝내지 않는다** 〈2026-08-23〉.
    #
    #   이 탐침은 tailnet 호스트의 포트 80 으로 받는데 앱은 Funnel 443 으로
    #   들어온다 — `Host:` 가 달라 **문서 루트가 다를 수 있다.** 2026-08-22 에
    #   실제로 그랬고, 본체가 앱과 같은 길로 재니 4/4 가 맞았다 (M-25).
    #
    #   ★ 그러니 여기서 빨갛게 끝내면 **멀쩡한 배포가 늘 빨갛다.** 그러면 빨간
    #     것을 안 보게 되고, 진짜 사고가 났을 때도 안 보인다.
    #   ★ **디스크가 다른 것은 여전히 치명적이다** — 그건 올리기가 안 된 것이다.
    #   ★ 꼭 치명으로 두고 싶으면 `LP_HTTP_FATAL=1`.
    echo "::warning::${NAME} — 디스크와 HTTP 가 다르다. 아래 셋 중 하나이고 이 자리에서는 구분되지 않는다:"
    echo "::warning::  ① 다른 파일을 봤다 — 잰 길(${VIA:-?})이 앱이 쓰는 길(Funnel 443→80)과 Host 가 다르다. **먼저 이것부터**"
    echo "::warning::  ② 다른 쓰는 이가 덮었다"
    echo "::warning::  ③ 웹서버·앞단 캐시 — ①②를 지운 뒤에만 의심한다"
  elif [ "$SERVED" != "$DISK" ]; then
    # ★★★ **원인을 하나로 단정하지 않는다** 〈2026-08-22 · 실제로 틀렸다〉.
    #   앞 판은 「웹서버가 캐시하고 있다」고 적고 **DSM 설정을 바꾸라**고 시켰다.
    #   그런데 본체가 Funnel 로 재니 디스크=HTTP 가 4/4 로 맞았다 — 캐시가 아니었다.
    #   ★ 이 탐침이 가를 수 있는 것은 **「다르다」까지**다. 왜 다른지는 셋 중 하나이고
    #     셋 다 이 자리에서는 똑같이 보인다. **틀린 짐작을 적으면 사람이 그 짐작부터
    #     판다** — M-24 에서 적어 놓고 여기서 또 했다.
    echo "::${LVL}::${NAME} — **디스크와 HTTP 가 다르다.** 아래 셋 중 하나다 — 이 자리에서는 구분되지 않는다:"
    echo "::${LVL}::  ① **다른 파일을 봤다** — 잰 길(${VIA:-?})이 앱이 쓰는 길(Funnel 443→80)과 Host 가 달라 문서 루트가 다를 수 있다. **먼저 이것부터 확인한다**"
    echo "::${LVL}::  ② **다른 쓰는 이가 덮었다** — 같은 폴더에 배포 경로가 둘이면 잰 사이에 덮인다"
    echo "::${LVL}::  ③ 웹서버·앞단 캐시 — ①②를 지운 뒤에만 의심한다"
    mark
  else
    echo "   ✓ 저장소 = 디스크 = HTTP — 진짜로 닿았다"
  fi

  [ -z "$CC" ] && [ -n "$SERVED" ] && \
    echo "::warning::${NAME} 에 Cache-Control 이 없다 — 브라우저가 제 마음대로 오래 들고 있을 수 있다"
done

if [ "$BEFORE" = "1" ]; then
  echo "── 올리기 **전** 재기였다 — 여기서는 빨갛게 끝내지 않는다 (LP_BEFORE=1)"
  exit 0
fi
exit "$BAD"
