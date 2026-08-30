'use strict';
/**
 * geometry.js — **앱 아이콘의 자릿수를 한 곳에서 만든다** 〈2026-08-30 · D-181〉.
 *
 * ★★★ 왜 값을 코드로 두나 〈사장님 화면: 깔린 앱 아이콘에서 나침반 원이 사방으로
 *   잘려 나갔다 · 「원형그대로 보이도록」〉.
 *
 *   아이콘은 **눈으로 보고 고치기 가장 나쁜 그림**이다. 원이 조금 잘려도
 *   1024px 로 크게 보면 멀쩡해 보이고, 정작 부두(Dock)에서 48px 로 줄면
 *   그때야 어긋난 것이 보인다. 그래서 **자리가 맞는지를 재는 검사**를 둔다
 *   (`assets/brand/icon.test.js`). 그 검사가 볼 수 있게 값을 여기 한 곳에 둔다.
 *
 * ★ 값은 애플이 정한 자리에서 온다. 맥 아이콘은 **가장자리까지 채우지 않는다** —
 *   1024 짜리 칸 안에 **824 짜리 둥근 사각형**이 가운데 놓이고 사방 100 이 빈다.
 *   지금 깔린 아이콘은 그 규칙을 안 지켜 그림을 칸 끝까지 늘렸고, 그래서
 *   나침반 원이 잘렸다.
 */

/** 그림판 한 변 (애플 기준 크기) */
const CANVAS = 1024;

/** 둥근 사각형 — 애플이 정한 자리. 1024 안에 824 가 가운데, 사방 100 이 빈다 */
const PLATE = { size: 824, x: 100, y: 100, radius: 185.4 };

/** 나침반 한가운데 = 그림판 한가운데. **이것이 사장님 지시의 핵심이다** */
const CENTER = { x: CANVAS / 2, y: CANVAS / 2 };

/**
 * 고리(테두리 원). `r` 은 **가운데 선**의 반지름이고 `width` 가 굵기다 —
 * 바깥 반지름 = r + width/2, 안쪽 반지름 = r - width/2.
 */
const RING = { r: 237, width: 62 };
const RING_OUT = RING.r + RING.width / 2;   // 268
const RING_IN = RING.r - RING.width / 2;    // 206

/** 동서남북 마름모 — 고리를 가로질러 바깥과 안으로 뾰족하게 나온다 */
const PIP = { out: 298, in: 188, half: 34 };

/**
 * 종이비행기. `nose` 는 한가운데에서 코끝까지의 거리(오른위 45°),
 * `len` 은 코끝에서 꼬리끝까지, `span` 은 날개 폭의 절반.
 *
 * ★ 코끝만 고리 밖으로 나간다 (298 마름모보다 짧게 잡아 **마름모가 가장 바깥**이
 *   되게 한다 — 그래야 원이 가장 큰 모양으로 읽힌다).
 * ★ 꼬리는 **고리 안쪽에 머문다.** 밖으로 나가면 원이 끊겨 보인다.
 */
const PLANE = { nose: 290, len: 361, span: 125.4, keel: 46.8, angleDeg: -45 };

/** 색 — 저장소 브랜드 토큰과 같은 계열 (`tokens.css` 의 라임 · 잉크) */
const COLOR = {
  plate: '#FFFFFF',
  ink: '#101A22',
  planeLight: '#A9DC1E',
  planeMid: '#74B41C',
  planeDark: '#3F7A16',
};

/** 마름모 네 개의 꼭짓점. 각도는 SVG 기준(0°=오른쪽, 90°=아래) */
function pip(deg) {
  const t = (deg * Math.PI) / 180;
  const u = { x: Math.cos(t), y: Math.sin(t) };
  const v = { x: -Math.sin(t), y: Math.cos(t) };
  const at = (rad, lat) => [
    +(CENTER.x + u.x * rad + v.x * lat).toFixed(2),
    +(CENTER.y + u.y * rad + v.y * lat).toFixed(2),
  ];
  return [at(PIP.out, 0), at(RING.r, PIP.half), at(PIP.in, 0), at(RING.r, -PIP.half)];
}

/** 종이비행기 꼭짓점 넷 — 코 · 위날개 · 접힌 자리 · 아래날개 */
function planePoints() {
  const t = (PLANE.angleDeg * Math.PI) / 180;
  const u = { x: Math.cos(t), y: Math.sin(t) };          // 코가 향하는 쪽
  const v = { x: -Math.sin(t), y: Math.cos(t) };         // 날개 쪽
  const at = (a, b) => [
    +(CENTER.x + u.x * a + v.x * b).toFixed(2),
    +(CENTER.y + u.y * a + v.y * b).toFixed(2),
  ];
  const tail = PLANE.nose - PLANE.len;
  return {
    nose: at(PLANE.nose, 0),
    wingA: at(tail, -PLANE.span),
    wingB: at(tail, +PLANE.span),
    keel: at(PLANE.keel, 0),
  };
}

/** 한가운데에서 얼마나 멀리까지 그리는가 — 검사가 이것으로 여백을 잰다 */
function markReach() {
  const p = planePoints();
  const far = (pt) => Math.hypot(pt[0] - CENTER.x, pt[1] - CENTER.y);
  return Math.max(PIP.out, far(p.nose), far(p.wingA), far(p.wingB));
}

module.exports = {
  CANVAS, PLATE, CENTER, RING, RING_OUT, RING_IN, PIP, PLANE, COLOR,
  pip, planePoints, markReach,
};
