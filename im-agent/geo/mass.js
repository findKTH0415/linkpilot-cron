'use strict';
/**
 * mass.js — 건축 매스(mass) 3D 모델 생성. 의존성 0.
 *
 * 산출 포맷:
 *   OBJ   (.obj)   범용. 스케치업·라이노·블렌더에서 바로 열린다.
 *   glTF  (.gltf)  웹 뷰어·파워포인트 3D 모델 삽입용. 버퍼를 base64로 내장한 단일 파일.
 *   SVG   (.svg)   IM/Teaser 삽입용 아이소메트릭 정투상 프리뷰.
 *
 * ★ 이것은 설계안이 아니라 **법적 한도와 계획 규모를 눈으로 확인하는 검토용 매스**다.
 *   산출물에 그 사실을 주석으로 명시한다.
 */

const { triangulate, bbox, closedRing } = require('./geometry');
const { COLOR } = require('../design/tokens');

/**
 * 필지 footprint를 층수만큼 압출한 매스를 만든다.
 * @param {Array} footprint [[x,y], ...] 로컬 미터좌표
 * @param {object} opts { floors, floorHeight, basementFloors }
 * @returns {{positions:number[], indices:number[], floorOutlines:Array, height:number, meta:object}}
 */
function buildMass(footprint, { floors = 1, floorHeight = 4.5, basementFloors = 0 } = {}) {
  const ring = closedRing(footprint).slice(0, -1);
  if (ring.length < 3) throw new Error('footprint 정점이 3개 미만이다');

  const n = ring.length;
  const height = Math.max(0.1, floors * floorHeight);
  const base = -Math.max(0, basementFloors) * floorHeight;

  const positions = [];
  const indices = [];

  // 하부면 정점 (0 ~ n-1), 상부면 정점 (n ~ 2n-1)
  for (const [x, y] of ring) positions.push(x, base, -y); // glTF/OBJ는 Y-up, Z는 남쪽(+)
  for (const [x, y] of ring) positions.push(x, base + height, -y);

  // 상부면 (반시계)
  for (const [a, b, c] of triangulate(ring)) indices.push(n + a, n + b, n + c);
  // 하부면 (뒤집어서)
  for (const [a, b, c] of triangulate(ring)) indices.push(c, b, a);

  // 측면
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j);
    indices.push(i, n + j, n + i);
  }

  const floorOutlines = [];
  for (let f = 0; f <= floors; f++) floorOutlines.push({ level: f, z: base + f * floorHeight });

  return {
    positions, indices, floorOutlines,
    height, base, footprint: ring,
    meta: { floors, floorHeight, basementFloors, vertices: positions.length / 3, triangles: indices.length / 3 },
  };
}

/** OBJ 텍스트 */
function toObj(mass, name = 'mass') {
  const lines = [
    '# LinkPilot IM Agent — 검토용 건축 매스 모델',
    '# 설계안이 아니라 용적률/건폐율 검토용 볼륨이다.',
    `# 층수 ${mass.meta.floors} · 층고 ${mass.meta.floorHeight}m · 지하 ${mass.meta.basementFloors}층 · 단위 m`,
    `o ${name}`,
  ];
  for (let i = 0; i < mass.positions.length; i += 3) {
    lines.push(`v ${fixed(mass.positions[i])} ${fixed(mass.positions[i + 1])} ${fixed(mass.positions[i + 2])}`);
  }
  for (let i = 0; i < mass.indices.length; i += 3) {
    // OBJ 인덱스는 1부터
    lines.push(`f ${mass.indices[i] + 1} ${mass.indices[i + 1] + 1} ${mass.indices[i + 2] + 1}`);
  }
  return lines.join('\n') + '\n';
}

/** glTF 2.0 (버퍼 base64 내장 단일 파일) */
function toGltf(mass, name = 'mass') {
  const posArray = new Float32Array(mass.positions);
  const maxIndex = Math.max(...mass.indices);
  const useUint32 = maxIndex > 65535;
  const idxArray = useUint32 ? new Uint32Array(mass.indices) : new Uint16Array(mass.indices);

  const posBytes = Buffer.from(posArray.buffer, posArray.byteOffset, posArray.byteLength);
  let idxBytes = Buffer.from(idxArray.buffer, idxArray.byteOffset, idxArray.byteLength);
  // glTF는 accessor 오프셋이 컴포넌트 크기의 배수여야 한다
  const pad = (4 - (posBytes.length % 4)) % 4;
  const buffer = Buffer.concat([posBytes, Buffer.alloc(pad), idxBytes]);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mass.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], mass.positions[i + k]);
      max[k] = Math.max(max[k], mass.positions[i + k]);
    }
  }

  return JSON.stringify({
    asset: {
      version: '2.0',
      generator: 'LinkPilot IM Agent (massing) — 검토용 매스, 설계안 아님',
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{
      name,
      primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }],
    }],
    materials: [{
      name: 'mass',
      pbrMetallicRoughness: { baseColorFactor: hexToLinear(COLOR.navy), metallicFactor: 0.0, roughnessFactor: 0.85 },
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: posArray.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: useUint32 ? 5125 : 5123, count: mass.indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length + pad, byteLength: idxBytes.length, target: 34963 },
    ],
    buffers: [{ byteLength: buffer.length, uri: `data:application/octet-stream;base64,${buffer.toString('base64')}` }],
  }, null, 2);
}

/**
 * 아이소메트릭 SVG 프리뷰 (IM 삽입용).
 * 좌표계: x(동) → 우하, y(북) → 우상, z(높이) → 위
 */
function toSvg(mass, { width = 720, height = 520, label = '' } = {}) {
  // 화면 좌표는 tx() 에서 뒤집으므로 여기서는 '위로 갈수록 큰 값'(up-positive)으로 만든다.
  // z 부호를 반대로 두면 매스가 아래로 압출되어 보인다.
  const iso = (x, y, z) => [(x - y) * Math.cos(Math.PI / 6), z - (x + y) * Math.sin(Math.PI / 6)];

  const ring = mass.footprint;
  const top = ring.map(([x, y]) => iso(x, y, mass.base + mass.height));
  const bottom = ring.map(([x, y]) => iso(x, y, mass.base));
  const floors = mass.floorOutlines.map(f => ring.map(([x, y]) => iso(x, y, f.z)));

  const all = [...top, ...bottom];
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 40;
  const scale = Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2 - 30) / (maxY - minY || 1));
  const tx = p => [
    pad + (p[0] - minX) * scale,
    height - 30 - pad - (p[1] - minY) * scale,
  ];
  const poly = pts => pts.map(p => tx(p).map(v => v.toFixed(1)).join(',')).join(' ');

  const sideFaces = [];
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    sideFaces.push(`<polygon points="${poly([bottom[i], bottom[j], top[j], top[i]])}" fill="${COLOR.navyMid}" fill-opacity="0.22" stroke="${COLOR.navy}" stroke-width="0.8"/>`);
  }

  const floorLines = floors.slice(1, -1)
    .map(f => `<polygon points="${poly(f)}" fill="none" stroke="${COLOR.navyL2}" stroke-width="0.4" stroke-opacity="0.6"/>`)
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Noto Sans KR', sans-serif">
  <!-- LinkPilot IM Agent — 검토용 건축 매스(설계안 아님) -->
  <rect width="${width}" height="${height}" fill="${COLOR.surface}"/>
  <polygon points="${poly(bottom)}" fill="${COLOR.track}" stroke="${COLOR.ruleStrong}" stroke-width="0.8" stroke-dasharray="4 3"/>
  ${sideFaces.join('\n  ')}
  ${floorLines}
  <polygon points="${poly(top)}" fill="${COLOR.gold}" fill-opacity="0.30" stroke="${COLOR.gold}" stroke-width="1.2"/>
  <text x="${pad}" y="${height - 12}" font-size="12" fill="${COLOR.body}">${escapeXml(label)}</text>
  <text x="${width - pad}" y="${height - 12}" font-size="10" fill="${COLOR.faint}" text-anchor="end">검토용 매스 · 설계안 아님</text>
</svg>
`;
}

/** '#10233C' → glTF baseColorFactor (선형 근사) */
function hexToLinear(hex) {
  const h = hex.replace('#', '');
  const srgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return [...srgb.map(c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))), 1];
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function fixed(n) {
  return Number(n).toFixed(3);
}

module.exports = { buildMass, toObj, toGltf, toSvg, hexToLinear };
