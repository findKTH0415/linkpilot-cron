#!/usr/bin/env bash
#
# weather-nas.sh — 날씨의 **둘째 출처(기상청)를 국내 자리에서 실제로 불러 본다**
#                  〈2026-09-21 · D-253 · CLAUDE.md §12-63〉
#
#   NAS 안에서 돈다. `npm run weather:nas` 또는 DSM 「작업 스케줄러」가 부른다.
#
# ★★★ **왜 필요한가.** `test-weather-kma.js` 는 **가짜 응답**으로 잰다 — 「무엇이 오든
#   지어내지 않는가」까지다. **격자·기준시각·규격이 실제로 맞는지**는 그 자리에서
#   한 번 불러 봐야 안다 (§4.3 — 붙이기 전에 실제로 불러 본다).
#   ★ R-ONE 이 이것을 안 해서 **여섯 번 다시 썼다.**
#
# ★★ **`weather.php` 통째가 아니라 «기상청 함수»만 부른다.** 통째로 부르면
#   open-meteo 가 먼저 성공해 **기상청 길을 한 번도 안 지나간다** — 재려던 것을
#   영영 못 잰다 (§8). 그래서 `wx_grid`·`wx_pty`·`wx_sky`·`wx_kma_fcst`·`wx_kma` 를
#   **소스에서 오려 내** 돌린다. **진짜 코드를 돌리는 것이지 베끼는 것이 아니다** (§8-1).
#
# ★ **이 스크립트에는 접속 자격증명도 데이터 열쇠도 없다** — NAS 가 스스로 자기 것을
#   부르고, 열쇠는 웹루트의 `weathergo_key.store.php` 를 `lp_key()` 가 읽는다 (규정집 2-8).
# ★ **웹루트 경로를 저장소에 안 적는다** (§2 · 이 저장소는 공개다 · D-10) —
#   `LP_WEB_DIR` 로 받는다. 안 주면 «못 쟀다»로 끝난다.
#
# ★ 되돌아오는 값
#     0  값이 왔다 (기온 · 있으면 최고/최저/강수확률/하늘상태)
#     1  대답은 왔는데 **값을 못 뽑았다** — 규격을 본다. 열쇠 문제가 아니다
#     3  자리(웹루트·php·weather.php)가 없다 — 아무것도 안 불렀다
#     4  **못 닿았거나 거부됐다** — 사유는 화면이 적는다
set -uo pipefail

WEB="${LP_WEB_DIR:-}"
LAT="${1:-37.5665}"
LON="${2:-126.9780}"

say() { echo "$*"; }

if [ -z "$WEB" ]; then
  say "⚠ 웹루트를 모른다 — **못 쟀다**(통과가 아니다)."
  say "  `LP_WEB_DIR=<weather.php 가 있는 폴더> npm run weather:nas` 로 알려 주십시오."
  exit 3
fi
[ -f "$WEB/weather.php" ] || { say "weather.php 가 그 자리에 없다 — 배포가 아직 안 닿았을 수 있다"; exit 3; }

PHP="$(command -v php 2>/dev/null || true)"
if [ -z "$PHP" ]; then
  for c in /usr/local/bin/php /usr/bin/php /var/services/web/../../usr/local/bin/php \
           /volume1/@appstore/PHP*/usr/local/bin/php* ; do
    [ -x "$c" ] && { PHP="$c"; break; }
  done
fi
[ -n "$PHP" ] || { say "php 를 못 찾았다 — DSM 작업 스케줄러의 PATH 가 좁습니다"; exit 3; }

say "날씨 둘째 출처(기상청) — 국내 자리에서 실제로 불러 본다"
say "  웹루트: (적지 않는다 · §2)"
say "  php: $PHP"
say "  좌표: $LAT, $LON   ← 공개 랜드마크. 사장님 일정·주소를 안 쓴다 (§2)"
say ""

LP_LAT="$LAT" LP_LON="$LON" "$PHP" -r '
$web = getenv("LP_WEB_DIR");
$src = file_get_contents($web . "/weather.php");

/* ★ 진짜 코드를 «오려 내» 돌린다 — 베끼면 한쪽이 옛말을 한다 (§8-1) */
$need = ["wx_get", "wx_grid", "wx_pty", "wx_sky", "wx_kma_fcst", "wx_kma"];
$code = "";
foreach ($need as $fn) {
  if (!preg_match("/function " . $fn . "\([\s\S]*?\n\}/", $src, $m)) {
    fwrite(STDERR, "  ⚠ " . $fn . " 를 못 뽑았다 — **못 쟀다**\n"); exit(3);
  }
  $code .= $m[0] . "\n";
}
require_once $web . "/lp_key.php";
eval($code);

/* ★ 열쇠가 «그 자리에» 있는지부터 — 없으면 배포가 아직 안 닿은 것이다.
     이름과 «있음/없음»만 말한다. 값은 한 글자도 안 찍는다 (§2). */
$k = lp_key("weathergo");
echo "  열쇠(weathergo): " . ($k === "" ? "없다 — 배포가 아직 안 놓았다" : "있다 (" . strlen($k) . "자)") . "\n";
if ($k === "") { echo "\n  ★ 배포의 「Carry the weather key」 단계가 돌았는지 봅니다.\n"; exit(4); }

$lat = (float)getenv("LP_LAT"); $lon = (float)getenv("LP_LON");
list($nx, $ny) = wx_grid($lat, $lon);
echo "  격자: nx=" . $nx . " ny=" . $ny . "\n\n";

list($r, $why) = wx_kma($lat, $lon);
if ($r === null) {
  echo "  ✗ 값이 안 왔다\n      " . $why . "\n\n";
  /* ★ 갈래를 갈라 끝낸다 — 할 일이 정반대다 (§4.6) */
  if (strpos($why, "비어") !== false) {
    echo "  ★ **대답은 왔는데 값을 못 뽑았다** — «규격»을 봅니다. 열쇠 문제가 아닙니다.\n"; exit(1);
  }
  echo "  ★ 못 닿았거나 거부됐습니다. 위 사유를 보십시오 — 「못 닿음」과 「거부」는 다른 사실입니다.\n";
  exit(4);
}
echo "  ✓ 기온 " . $r["temp"] . "°\n";
/* ★ 못 받은 칸은 «못 받았다»고 적는다 — 0 으로 안 적는다 (§4.6) */
foreach ([["max","최고"],["min","최저"],["rainProb","비 올 확률"],["code","하늘·강수(WMO)"]] as $p) {
  $v = isset($r[$p[0]]) ? $r[$p[0]] : null;
  echo "    " . $p[1] . ": " . ($v === null ? "못 받았다" : $v) . "\n";
}
echo "\n  끝났다 — 기상청이 값을 준다\n";
exit(0);
' 2>&1
RC=$?
exit $RC
