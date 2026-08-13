'use strict';
const test = require('node:test');
const assert = require('node:assert');
const geometry = require('../geo/geometry');
const mass = require('../geo/mass');
const pnuUtil = require('../connectors/pnu');
const nsdi = require('../connectors/nsdi');

// 서울시청 인근 100m × 100m 사각형 (위경도)
const SQUARE = (() => {
  const lat = 37.5665, lon = 126.9780;
  const dLat = 100 / 111320;
  const dLon = 100 / (111320 * Math.cos(lat * Math.PI / 180));
  return [[lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat]];
})();

test('폴리곤 면적: 100m×100m ≈ 10,000㎡', () => {
  const area = geometry.polygonAreaSqm(SQUARE);
  assert.ok(Math.abs(area - 10000) < 50, `실제 ${area}`);
});

test('폴리곤 면적: 좌표 순서(시계/반시계) 무관하게 양수', () => {
  const a = geometry.polygonAreaSqm(SQUARE);
  const b = geometry.polygonAreaSqm([...SQUARE].reverse());
  assert.ok(Math.abs(a - b) < 0.01);
  assert.ok(a > 0);
});

test('폴리곤 면적: 정점 3개 미만이면 null', () => {
  assert.strictEqual(geometry.polygonAreaSqm([[1, 1], [2, 2]]), null);
});

test('삼각분할: 사각형 → 삼각형 2개', () => {
  const tris = geometry.triangulate([[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.strictEqual(tris.length, 2);
});

test('삼각분할: 오목(L자) 폴리곤도 면적이 보존된다', () => {
  const L = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]]; // 면적 300
  const tris = geometry.triangulate(L);
  assert.strictEqual(tris.length, 4, '정점 6개 → 삼각형 4개');
  const total = tris.reduce((sum, [a, b, c]) => sum + geometry.planarArea([L[a], L[b], L[c]]), 0);
  assert.ok(Math.abs(total - 300) < 0.01, `삼각형 합 ${total} ≠ 300`);
});

test('중심 기준 축소: 면적비가 계수와 일치한다', () => {
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const shrunk = geometry.scaleAboutCentroid(sq, 0.7);
  assert.ok(Math.abs(geometry.planarArea(shrunk) - 7000) < 1);
});

test('대체 footprint: 면적이 보존된다', () => {
  const fp = geometry.squareFootprint(12880);
  assert.ok(Math.abs(geometry.planarArea(fp) - 12880) < 1);
});

test('매스: 정점/삼각형 수가 층수와 무관하게 압출 형상이다', () => {
  const m = mass.buildMass([[0, 0], [10, 0], [10, 10], [0, 10]], { floors: 5, floorHeight: 4 });
  assert.strictEqual(m.meta.vertices, 8, '사각 기둥은 정점 8개');
  assert.strictEqual(m.height, 20);
});

test('OBJ: 정점·면 수가 일치하고 인덱스가 1부터 시작한다', () => {
  const m = mass.buildMass([[0, 0], [10, 0], [10, 10], [0, 10]], { floors: 2 });
  const obj = mass.toObj(m);
  const vLines = obj.split('\n').filter(l => l.startsWith('v '));
  const fLines = obj.split('\n').filter(l => l.startsWith('f '));
  assert.strictEqual(vLines.length, 8);
  assert.strictEqual(fLines.length, m.indices.length / 3);
  const minIdx = Math.min(...fLines.flatMap(l => l.slice(2).split(' ').map(Number)));
  assert.strictEqual(minIdx, 1, 'OBJ 인덱스는 1-based');
});

test('glTF: 스펙에 맞는 단일 파일 (버퍼 내장·정렬)', () => {
  const m = mass.buildMass([[0, 0], [10, 0], [10, 10], [0, 10]], { floors: 3 });
  const g = JSON.parse(mass.toGltf(m));
  assert.strictEqual(g.asset.version, '2.0');
  assert.strictEqual(g.accessors[0].count, 8);
  assert.strictEqual(g.accessors[1].count, m.indices.length);

  const buf = Buffer.from(g.buffers[0].uri.split(',')[1], 'base64');
  assert.strictEqual(buf.length, g.buffers[0].byteLength);
  for (const bv of g.bufferViews) {
    assert.ok(bv.byteOffset + bv.byteLength <= buf.length, 'bufferView가 버퍼를 넘어간다');
  }
  assert.strictEqual(g.bufferViews[1].byteOffset % 4, 0, '인덱스 accessor 오프셋 정렬');
});

test('SVG: 매스가 위로 압출된다 (상부면이 하부면보다 화면 위)', () => {
  const m = mass.buildMass([[0, 0], [10, 0], [10, 10], [0, 10]], { floors: 10, floorHeight: 4 });
  const svg = mass.toSvg(m, { label: 'test' });
  const polys = [...svg.matchAll(/points="([^"]+)"/g)].map(x =>
    x[1].split(' ').map(p => Number(p.split(',')[1])));

  const bottom = polys[0];           // 첫 폴리곤 = 하부 대지면
  const top = polys[polys.length - 1]; // 마지막 폴리곤 = 상부면
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
  // SVG는 y가 아래로 증가 → 위에 있으면 값이 작다
  assert.ok(avg(top) < avg(bottom), `상부면(${avg(top)})이 하부면(${avg(bottom)})보다 위에 있어야 한다`);
});

test('SVG: 라벨이 XML 이스케이프된다', () => {
  const m = mass.buildMass([[0, 0], [10, 0], [10, 10], [0, 10]], { floors: 1 });
  assert.ok(mass.toSvg(m, { label: 'A & B <script>' }).includes('A &amp; B &lt;script&gt;'));
});

test('PNU 분해: 19자리 → 시군구·법정동·본번·부번', () => {
  const p = pnuUtil.parse('1168010100100120000');
  assert.strictEqual(p.sigunguCd, '11680');
  assert.strictEqual(p.bjdongCd, '10100');
  assert.strictEqual(p.bun, '0012');
  assert.strictEqual(p.ji, '0000');
  assert.strictEqual(p.jibun, '12');
  assert.strictEqual(p.isMountain, false);
});

test('PNU 분해: 자릿수가 다르면 null', () => {
  assert.strictEqual(pnuUtil.parse('116801010010012'), null);
  assert.strictEqual(pnuUtil.parse(null), null);
});

test('실거래 조회월: 연초에도 전년으로 정확히 넘어간다', () => {
  const months = pnuUtil.recentMonths(4, '2026-02-15');
  assert.deepStrictEqual(months, ['202602', '202601', '202512', '202511']);
});

test('용도지역 상한: 문자열만으로 조회된다 (API 불필요)', () => {
  assert.deepStrictEqual(nsdi.limitsForZone('일반공업지역'), { zone: '일반공업지역', far: 350, bcr: 70 });
  assert.deepStrictEqual(nsdi.limitsForZone('제3종 일반주거지역'), { zone: '제3종일반주거지역', far: 300, bcr: 50 });
  assert.strictEqual(nsdi.limitsForZone('알수없는지역'), null);
});
