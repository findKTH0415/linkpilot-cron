'use strict';
/**
 * birdseye.js — 지적 필지 + 건축개요로 **조감도**를 그린다. 의존성 0.
 *
 * `mass.toSvg` 와 무엇이 다른가:
 *   - `mass.toSvg` 는 **매스만** 그린다 (건축면적 비율로 축소한 형상).
 *   - 이 파일은 **실제 지적선을 그대로** 깔고 그 위에 매스를 얹는다.
 *     그래서 대지 안에서 건물이 차지하는 자리와 남는 자리(이격·조경·주차)가
 *     눈에 보인다. 조감도의 값어치는 거기에 있다.
 *
 * ★ **필지 형상이 없으면 그리지 않는다.**
 *   매스 검토는 사각형으로 근사해도 뜻이 있다(면적·층수 검증). 조감도는 다르다 —
 *   **부지 형상 그 자체가 정보**라서, 근사한 사각형을 조감도라고 내놓으면
 *   실제 땅 모양으로 읽힌다. 그건 그럴듯하게 틀린 그림이다.
 *
 * ★ **AI 로 그린 이미지가 아니다.** 모든 선이 지적도와 건축개요에서 나온다.
 *   그래서 캡션에 무엇으로 그렸는지 적고, 「설계도면이 아님」을 박아 둔다.
 *   (건축사법상 설계도서 작성은 건축사의 업무다 — 등록부 D-32)
 *
 * ★ 축척과 방위를 **반드시** 넣는다. 없으면 크기를 가늠할 수 없어
 *   같은 그림이 20m 건물로도 200m 건물로도 읽힌다.
 */

const COLOR = {
  sky: '#F5F7FA',
  ground: '#EDEFF2',
  parcel: '#2F5D50',
  parcelFill: '#DDE7E2',
  massTop: '#C8A96B',
  massSide: '#10233C',
  line: '#8A9099',
  ink: '#17181A',
  faint: '#7C838C',
};

/** 아이소메트릭 — `mass.toSvg` 와 **같은 식**을 쓴다. 다르면 두 그림이 어긋난다 */
function iso(x, y, z) {
  return [(x - y) * Math.cos(Math.PI / 6), z - (x + y) * Math.sin(Math.PI / 6)];
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** 사람이 읽기 좋은 축척 눈금 (1·2·5 계열) */
function niceScale(metersPerPx, targetPx) {
  const raw = metersPerPx * targetPx;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const candidates = [1, 2, 5, 10].map(m => m * pow);
  return candidates.reduce((best, c) =>
    Math.abs(c - raw) < Math.abs(best - raw) ? c : best, candidates[0]);
}

/**
 * 조감도를 그린다.
 *
 * @param {object} o
 *   parcel     [[x,y], …] 지적 필지 (미터 단위 로컬 좌표, geometry.toLocalMeters 결과)
 *   mass       buildMass() 결과 — footprint · height · base · floorOutlines
 *   label      아래에 적을 한 줄 (사업명 · 층수 · 면적)
 *   sources    ['연속지적도(VWorld, 2026-08-16)', '건축물대장(국토부)'] 처럼 무엇으로 그렸는지
 *   width/height  기본 880 × 600
 * @returns {{ok, svg, reason, meta}}
 */
function render(o) {
  const opt = o || {};
  const parcel = Array.isArray(opt.parcel) ? opt.parcel.filter(p => Array.isArray(p) && p.length >= 2) : [];

  // ★ 필지가 없으면 그리지 않는다. 사각형으로 대신 그리면 실제 땅 모양으로 읽힌다
  if (parcel.length < 3) {
    return {
      ok: false, svg: null, meta: null,
      reason: '지적 필지 형상이 없어 조감도를 그리지 않았다. 대지 모양을 근사해서 그리면 '
        + '실제 필지처럼 보이는 그림이 된다 — 그건 매스 검토와 달리 그럴듯하게 틀린다. '
        + 'VWORLD_KEY 를 넣고 연속지적도를 받으면 그려진다',
    };
  }

  const mass = opt.mass || null;
  const width = opt.width || 880;
  const height = opt.height || 600;

  // ── 화면에 담기 ────────────────────────────────────────
  const groundPts = parcel.map(([x, y]) => iso(x, y, 0));
  const topPts = mass ? mass.footprint.map(([x, y]) => iso(x, y, mass.base + mass.height)) : [];
  const basePts = mass ? mass.footprint.map(([x, y]) => iso(x, y, mass.base)) : [];

  const all = groundPts.concat(topPts, basePts);
  const xs = all.map(p => p[0]);
  const ys = all.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const pad = 48;
  const footer = 54;                                   // 캡션·축척 자리
  const scale = Math.min(
    (width - pad * 2) / (maxX - minX || 1),
    (height - pad * 2 - footer) / (maxY - minY || 1));

  const tx = p => [
    pad + (p[0] - minX) * scale,
    height - footer - pad - (p[1] - minY) * scale,
  ];
  const poly = pts => pts.map(p => tx(p).map(v => v.toFixed(1)).join(',')).join(' ');

  // ── 매스 옆면 ──────────────────────────────────────────
  const sides = [];
  if (mass) {
    for (let i = 0; i < mass.footprint.length; i++) {
      const j = (i + 1) % mass.footprint.length;
      sides.push(`<polygon points="${poly([basePts[i], basePts[j], topPts[j], topPts[i]])}" `
        + `fill="${COLOR.massSide}" fill-opacity="0.20" stroke="${COLOR.massSide}" stroke-width="0.7"/>`);
    }
  }
  const floorLines = mass
    ? (mass.floorOutlines || []).slice(1, -1).map((f) => {
      const ring = mass.footprint.map(([x, y]) => iso(x, y, f.z));
      return `<polygon points="${poly(ring)}" fill="none" stroke="${COLOR.massSide}" `
        + 'stroke-width="0.35" stroke-opacity="0.45"/>';
    }).join('\n  ')
    : '';

  // ── 축척 막대 — 없으면 크기를 가늠할 수 없다 ─────────────
  const metersPerPx = 1 / scale;
  const barMeters = niceScale(metersPerPx, 120);
  const barPx = barMeters * scale;
  const barX = pad;
  const barY = height - 24;

  // ── 방위 — 로컬 좌표의 +y 가 북쪽이다 (toLocalMeters 규약) ──
  const northLen = 26;
  const northX = width - pad - 16;
  const northY = pad + 34;
  const [nx, ny] = iso(0, 1, 0);
  const nlen = Math.hypot(nx, ny) || 1;
  const nEnd = [northX + (nx / nlen) * northLen, northY - (ny / nlen) * northLen];

  const sources = (opt.sources || []).filter(Boolean);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}" font-family="'Noto Sans KR', sans-serif">
  <!-- LinkPilot IM Agent — 조감도. 지적도 + 건축개요로 그린 검토용 그림이며 설계도면이 아니다 -->
  <rect width="${width}" height="${height}" fill="${COLOR.sky}"/>
  <polygon points="${poly(groundPts)}" fill="${COLOR.parcelFill}" stroke="${COLOR.parcel}" stroke-width="1.6"/>
  ${mass ? `<polygon points="${poly(basePts)}" fill="${COLOR.ground}" stroke="${COLOR.line}" stroke-width="0.6" stroke-dasharray="3 3"/>` : ''}
  ${sides.join('\n  ')}
  ${floorLines}
  ${mass ? `<polygon points="${poly(topPts)}" fill="${COLOR.massTop}" fill-opacity="0.42" stroke="${COLOR.massTop}" stroke-width="1.2"/>` : ''}

  <g stroke="${COLOR.ink}" stroke-width="1.2" fill="none">
    <line x1="${northX.toFixed(1)}" y1="${northY.toFixed(1)}" x2="${nEnd[0].toFixed(1)}" y2="${nEnd[1].toFixed(1)}"/>
  </g>
  <text x="${northX.toFixed(1)}" y="${(northY + 14).toFixed(1)}" font-size="11" fill="${COLOR.ink}" text-anchor="middle">N</text>

  <g stroke="${COLOR.ink}" stroke-width="1.4">
    <line x1="${barX}" y1="${barY}" x2="${(barX + barPx).toFixed(1)}" y2="${barY}"/>
    <line x1="${barX}" y1="${barY - 4}" x2="${barX}" y2="${barY + 4}"/>
    <line x1="${(barX + barPx).toFixed(1)}" y1="${barY - 4}" x2="${(barX + barPx).toFixed(1)}" y2="${barY + 4}"/>
  </g>
  <text x="${(barX + barPx + 8).toFixed(1)}" y="${barY + 4}" font-size="11" fill="${COLOR.ink}">${barMeters}m</text>

  <text x="${pad}" y="${height - 40}" font-size="12.5" fill="${COLOR.ink}">${escapeXml(opt.label || '')}</text>
  ${sources.length ? `<text x="${pad}" y="${height - 26}" font-size="10" fill="${COLOR.faint}">근거: ${escapeXml(sources.join(' · '))}</text>` : ''}
  <text x="${width - pad}" y="${height - 26}" font-size="10" fill="${COLOR.faint}" text-anchor="end">검토용 조감도 · 설계도면이 아님</text>
</svg>
`;

  return {
    ok: true,
    svg,
    reason: null,
    meta: {
      // ★ 무엇으로 그렸는지를 그림과 함께 들고 다닌다. 떼어 놓으면 나중에
      //   이 그림이 실측인지 근사인지 알 수 없다 (§4.7)
      parcelPoints: parcel.length,
      hasMass: !!mass,
      scaleBarMeters: barMeters,
      metersPerPixel: Math.round(metersPerPx * 1000) / 1000,
      sources,
      note: '지적도 필지선과 건축개요로 그린 검토용 그림이다. 설계도면이 아니고, '
        + '주변 건물·수목·차량은 그리지 않았다 — 없는 것을 그리면 있는 것처럼 보인다',
    },
  };
}

module.exports = { render, iso, niceScale, COLOR };
