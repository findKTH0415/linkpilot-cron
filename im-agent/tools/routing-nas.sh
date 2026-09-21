#!/usr/bin/env bash
#
# routing-nas.sh — 길찾기 소요시간을 **국내 자리(NAS)에서** 한 번 불러 본다
#                  〈2026-09-21 · D-252 · CLAUDE.md §12-62〉
#
#   NAS 안에서 돈다. DSM 「작업 스케줄러」나 `npm run routing:nas` 가 부른다.
#
# ★★★ **왜 NAS 인가 — 사장님 콘솔 화면이 잰 값을 줬다.**
#   ODsay 콘솔이 「서비스 상태 **활성화**(기한제한 없음) · 현재 호출수 0/30 ·
#   서비스 URI·**서버 IP 등록됨**」이었다. 곧 열쇠도 등록도 멀쩡하다.
#   그런데 진단은 **GitHub Actions 러너(해외 IP)** 에서 돌아 `[ApiKeyAuthFailed]` 가 났다.
#   ODsay 는 **등록된 서버에서 온 요청만** 통과시킨다.
#   ★ D-206 이 세운 「열쇠가 있는 자리가 곧 «닿는 자리»는 아니다」와 **같은 규칙**이고,
#     이번엔 이유가 **IP 등록**이다. 「못 닿음」을 「승인 안 됨」으로 적지 않는다.
#
# ★★ **이 스크립트에는 접속 자격증명이 없다.** SSH 로 들어와서 부르는 것이 아니라
#   **NAS 가 스스로 자기 것을 부른다.** 데이터 열쇠도 여기 없다 — 엔진 뿌리의
#   `linkpilot.env` 에서 `im-agent/core/env.js` 가 읽는다 (§2 · 규정집 2-8).
#
# ★ **자리가 `im-agent/` 안인 것이 규격이다** — `deploy/engine.sh` 가 NAS 로 올리는 것은
#   `im-agent/` 뿐이다. `scripts/` 에 두면 **저장소에는 있고 NAS 에는 없다**
#   (§4 의 `calendar-nas.sh` 가 겪은 그 자리 · 「만들었다」와 「닿는다」는 다른 사실).
#
# ★ **진단이 아니라 «실제로 쓸 커넥터»를 부른다.** 「진단이 통한다」와 「커넥터가
#   통한다」는 다른 사실이다 (§8). 그래서 `im-agent/connectors/routing.js` 를 그대로 쓴다.
#
# ★ 되돌아오는 값
#     0  자동차·대중교통 **둘 다** 값이 왔다
#     1  **하나만** 왔다 — 어느 쪽이 왜 막혔는지는 요약이 적는다
#     3  자리(엔진 뿌리·node)가 없다 — 아무것도 안 불렀다
#     4  **둘 다** 못 받았다
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${LP_ENGINE_ROOT:-$(cd "$HERE/../.." && pwd)}"

say() { echo "$*"; }

[ -d "$ROOT" ] || { say "엔진 뿌리가 없다: $ROOT — LP_ENGINE_ROOT 로 알려 주십시오"; exit 3; }
cd "$ROOT" || exit 3

# ★ node 는 «여러 자리»를 훑는다 — DSM 작업 스케줄러의 PATH 가 좁다 (§4 · 실측).
#   판 번호를 박지 않는다 — 판을 올리시는 날 조용히 깨지고 증상이 「안 깔렸다」와 같아진다.
NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ]; then
  for c in /usr/local/bin/node /var/packages/Node.js_*/target/usr/local/bin/node \
           /volume1/@appstore/Node.js_*/usr/local/bin/node; do
    [ -x "$c" ] && { NODE="$c"; break; }
  done
fi
[ -n "$NODE" ] || { say "node 를 못 찾았다 — DSM 작업 스케줄러의 PATH 가 좁습니다"; exit 3; }

say "길찾기 소요시간 — 국내 자리에서 재 본다"
say "  도는 자리: $ROOT"
say "  node: $NODE"
say ""

# ★ 좌표는 **공개 랜드마크 둘**이다 — 사장님 일정이나 주소를 안 쓴다 (§2).
#   서울시청 → 강남역.
"$NODE" -e '
const r = require("./im-agent/connectors/routing.js");
const A = { x: 127.0276, y: 37.5665 };   // 서울시청
const B = { x: 127.0276, y: 37.4979 };   // 강남역
const mm = (s) => Math.round(s / 60) + "분";

/* ★ 열쇠 «이름과 있음/없음»만 적는다 — 값은 한 글자도 안 찍는다 (§2) */
const kName = r.usedName();
const oName = r.odsayUsedName();
console.log("  열쇠 — 자동차: " + (kName || "없다 (" + r.namesText() + ")"));
console.log("  열쇠 — 대중교통: " + (oName || "없다 (" + r.ODSAY_KEY_NAMES.join(" 또는 ") + ")"));
console.log("");

/* ★ 갈래마다 사장님이 하실 일이 «정반대»다 — 뭉뚱그리면 고칠 것이 없는 자리를 보러 가신다 */
const SAY = {
  unavailable: "열쇠가 없다 — 배포가 열쇠 파일을 놓았는지 본다",
  "bad-input": "좌표가 잘못됐다 — 이 스크립트의 문제다",
  unreachable: "못 닿았다 — **열쇠 문제가 아니다.** 이 자리의 바깥 연결(방화벽·DNS)을 본다",
  auth: "인증이 거부됐다 — 열쇠·등록을 본다",
  http: "그쪽 서버가 오류로 답했다 — 우리 쪽에 고칠 것이 없을 수 있다",
  "not-json": "JSON 이 아닌 답이 왔다 — 안내 페이지일 수 있다 (도는 자리·그쪽 서버)",
  "no-route": "경로가 안 왔다",
  "no-value": "대답은 왔는데 값 칸을 못 찾았다 — **규격**을 본다. 열쇠 문제가 아니다",
};

(async () => {
  let good = 0;
  for (const [name, fn] of [["자동차", r.carDuration], ["대중교통", r.transitDuration]]) {
    let x;
    try { x = await fn(A, B); } catch (e) { x = { ok: false, reason: "throw", error: String(e && e.message || e) }; }
    if (x.ok) {
      good += 1;
      console.log("  ✓ " + name + " — " + mm(x.seconds) + " (" + x.seconds + "초"
        + (x.meters != null ? " · " + x.meters + "m" : "") + ")"
        + (x.cached ? " · 캐시" : ""));
      if (x.source) console.log("      출처: " + x.source.기관 + " " + x.source.api);
    } else {
      console.log("  ✗ " + name + " — " + (SAY[x.reason] || x.reason));
      /* ★ 본문 앞머리는 커넥터가 이미 가려서 싣는다 — 여기서 또 자르지 않는다 */
      if (x.error) console.log("      " + x.error);
    }
  }
  console.log("");
  /* ★ 「돌았다」와 「값이 왔다」는 다른 사실이다 (§8) — 개수로 센다 */
  console.log("  값이 온 갈래: " + good + " / 2");
  if (good === 2) { console.log("  끝났다 — 둘 다 왔다"); process.exit(0); }
  if (good === 1) { console.log("  ★ 하나만 왔다 — 위의 ✗ 줄이 무엇이 막았는지 적는다"); process.exit(1); }
  console.log("  ★ 둘 다 못 받았다. 위의 ✗ 줄을 보십시오 — 「못 닿음」과 「거부」는 다른 사실입니다");
  process.exit(4);
})();
'
exit $?
