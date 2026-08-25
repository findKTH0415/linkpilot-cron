'use strict';
/**
 * geometry.js — 필지 폴리곤 기하 계산 (의존성 0, 전부 결정적).
 *
 * 위경도(EPSG:4326) 폴리곤을 지역 평면 미터좌표로 투영해 면적·중심·치수를 구한다.
 * 필지 규모(수백 m)에서는 등거리원통도법 근사로 충분하며, 오차는 0.1% 미만이다.
 */

const R = 6378137; // WGS84 장반경(m)

function toRad(deg) { return (deg * Math.PI) / 180; }

/** 링의 산술 중심 (좌표 평균) */
function centroid(ring) {
  if (!ring || !ring.length) return null;
  const pts = closedRing(ring);
  const n = pts.length - 1; // 마지막은 첫 점과 동일
  let lon = 0, lat = 0;
  for (let i = 0; i < n; i++) { lon += pts[i][0]; lat += pts[i][1]; }
  return [lon / n, lat / n];
}

/** 폴리곤이 닫혀 있도록 보정 */
function closedRing(ring) {
  const pts = ring.map(p => [Number(p[0]), Number(p[1])]);
  const first = pts[0], last = pts[pts.length - 1];
  if (!first || !last) return pts;
  if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);
  return pts;
}

/**
 * 위경도 링 → 원점 기준 로컬 미터좌표 [[x(동), y(북)], ...]
 * @param {Array} ring [[lon,lat], ...]
 * @param {Array} origin [lon,lat] (기본: 링 중심)
 */
function toLocalMeters(ring, origin = null) {
  const pts = closedRing(ring);
  const o = origin || centroid(pts);
  const latRad = toRad(o[1]);
  const mPerDegLon = (Math.PI / 180) * R * Math.cos(latRad);
  const mPerDegLat = (Math.PI / 180) * R;
  return pts.map(([lon, lat]) => [
    (lon - o[0]) * mPerDegLon,
    (lat - o[1]) * mPerDegLat,
  ]);
}

/** 신발끈 공식. 평면 미터좌표 기준 면적(㎡). 방향 무관하게 양수 */
function planarArea(points) {
  const pts = closedRing(points);
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    sum += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  }
  return Math.abs(sum) / 2;
}

/** 위경도 폴리곤 면적(㎡) */
function polygonAreaSqm(ring) {
  if (!ring || ring.length < 3) return null;
  return planarArea(toLocalMeters(ring));
}

/** 로컬 미터좌표 경계상자 { minX, minY, maxX, maxY, width, depth } */
function bbox(points) {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, depth: maxY - minY };
}

/** 폴리곤 방향 (양수 = 반시계) */
function signedArea(points) {
  const pts = closedRing(points);
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    sum += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  }
  return sum / 2;
}

/**
 * Ear clipping 삼각분할. 오목 폴리곤도 올바르게 처리한다.
 * (부채꼴 분할은 볼록 폴리곤에서만 맞는데, 실제 필지는 대부분 오목하다)
 * @returns {number[][]} 삼각형 인덱스 배열
 */
function triangulate(points) {
  const pts = closedRing(points).slice(0, -1); // 닫는 점 제거
  const n = pts.length;
  if (n < 3) return [];

  // 반시계 방향으로 정규화
  const ccw = signedArea(pts) > 0;
  const idx = ccw ? [...pts.keys()] : [...pts.keys()].reverse();

  const triangles = [];
  const verts = idx.slice();
  let guard = 0;

  while (verts.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < verts.length; i++) {
      const prev = verts[(i - 1 + verts.length) % verts.length];
      const curr = verts[i];
      const next = verts[(i + 1) % verts.length];

      if (!isConvex(pts[prev], pts[curr], pts[next])) continue;
      if (verts.some(v => v !== prev && v !== curr && v !== next && pointInTriangle(pts[v], pts[prev], pts[curr], pts[next]))) continue;

      triangles.push([prev, curr, next]);
      verts.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // 자기교차 등 비정상 폴리곤 — 남은 것만 반환
  }
  if (verts.length === 3) triangles.push([verts[0], verts[1], verts[2]]);
  return triangles;
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function isConvex(a, b, c) {
  return cross(b, c, a) > 0;
}

function pointInTriangle(p, a, b, c) {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * 폴리곤을 중심 기준으로 축소 (건축면적 = 대지면적 × 건폐율 근사 매스 생성용).
 * 정확한 오프셋이 아니라 면적비 스케일이며, 그 사실을 산출물에 명시한다.
 */
function scaleAboutCentroid(points, factor) {
  const pts = closedRing(points).slice(0, -1);
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const s = Math.sqrt(Math.max(0, factor));
  return pts.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]);
}

/**
 * 두 링 사이 최단거리(m) — 접함 판정용 (D-102 도로필지).
 * 한쪽의 꼭짓점에서 다른 쪽의 변까지 점-선분 거리를 양방향으로 잰다.
 * 연속지적도의 접한 필지는 변을 공유해 0 에 가깝게 나온다.
 */
function minRingDistance(ringA, ringB) {
  const a = closedRing(ringA);
  const b = closedRing(ringB);
  const ptSeg = (p, s, e) => {
    const dx = e[0] - s[0], dy = e[1] - s[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / L2));
    return Math.hypot(p[0] - (s[0] + t * dx), p[1] - (s[1] + t * dy));
  };
  let min = Infinity;
  const oneWay = (pts, ring) => {
    for (const p of pts) {
      for (let i = 0; i < ring.length - 1; i++) {
        const d = ptSeg(p, ring[i], ring[i + 1]);
        if (d < min) min = d;
      }
    }
  };
  oneWay(a, b);
  oneWay(b, a);
  return min;
}

/** 면적만 아는 경우의 대체 사각형 footprint (필지 폴리곤 미확보 시) */
function squareFootprint(areaSqm, ratio = 1.5) {
  if (!areaSqm || areaSqm <= 0) return null;
  const depth = Math.sqrt(areaSqm / ratio);
  const width = areaSqm / depth;
  return [
    [-width / 2, -depth / 2], [width / 2, -depth / 2],
    [width / 2, depth / 2], [-width / 2, depth / 2],
  ];
}

module.exports = {
  centroid, closedRing, toLocalMeters, planarArea, polygonAreaSqm,
  bbox, signedArea, triangulate, scaleAboutCentroid, squareFootprint,
  minRingDistance,
};
