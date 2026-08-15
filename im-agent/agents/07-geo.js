'use strict';
/**
 * 07 Geo / Satellite Agent — 위성지도 · 지적 · 공공데이터 입지 조사
 *
 * ★ 이 Agent의 진짜 가치는 지도 그림이 아니라 **독립된 두 번째 출처**다.
 *   지적도에서 계산한 대지면적, 건축물대장의 연면적은 사업계획서와 무관한 출처이므로
 *   - 일치하면 해당 값이 verified 로 승격되고
 *   - 다르면 RED FLAG 로 드러난다.
 *   Dataset 이 이 판정을 자동으로 수행하므로 여기서는 값을 정확한 출처와 함께 넣기만 한다.
 *
 * 호출 순서: 지오코딩 1회 → 필지 1회 → (PNU 파생) → 공시지가·토지이용·건축물대장 각 1회
 *   프로젝트당 최대 5회. 전부 캐시되므로 재실행 시 0회.
 */

const vworld = require('../connectors/vworld');
const nsdi = require('../connectors/nsdi');
const molit = require('../connectors/molit');
const pnuUtil = require('../connectors/pnu');
const geometry = require('../geo/geometry');
const cache = require('../connectors/cache');
const store = require('../core/store');
const { round } = require('../core/numeric');
const { kstDate } = require('../core/kst');

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    address: { type: 'string', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['facts', 'sources'],
  properties: {
    facts: { type: 'array' },
    sources: { type: 'array' },
    geo: { type: 'object', nullable: true },
    parcel: { type: 'object', nullable: true },
    landUse: { type: 'object', nullable: true },
    building: { type: 'object', nullable: true },
    quota: { type: 'object' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

async function run(input, ctx) {
  const ds = ctx.dataset;
  const today = kstDate();
  const facts = [];
  const sources = [];
  const out = { geo: null, parcel: null, landUse: null, building: null };

  const addrFact = ds && ds.get('project.location');
  const address = input.address || (addrFact ? String(addrFact.value) : null);

  if (!address) {
    ctx.warn('소재지가 확인되지 않아 위성지도·지적 조회를 생략한다');
    return { facts, sources, ...out, quota: cache.stats(), confidence: 0 };
  }
  if (!vworld.isAvailable()) {
    ctx.warn('VWORLD_KEY 미설정 — 위성지도·지적·공시지가 조회 전체 생략');
    return { facts, sources, ...out, quota: cache.stats(), confidence: 0 };
  }

  // ── ① 지오코딩 ──────────────────────────────────────────
  const geo = await vworld.geocode(address);
  if (!geo.ok) {
    ctx.warn(`지오코딩 실패: ${geo.error}`);
    return { facts, sources, ...out, quota: cache.stats(), confidence: 0 };
  }
  out.geo = { ...geo.value, mapLink: vworld.mapLink(geo.value.lat, geo.value.lon) };
  sources.push({ name: 'VWorld 지오코딩', cached: !!geo.cached });

  const src = (name) => ({ source: name, sourceDate: today, page: null });
  facts.push({ key: 'geo.lat', value: round(geo.value.lat, 7), unit: null, confidence: 0.9, verified: true, ...src('VWorld 지오코딩') });
  facts.push({ key: 'geo.lon', value: round(geo.value.lon, 7), unit: null, confidence: 0.9, verified: true, ...src('VWorld 지오코딩') });

  // ── ② 필지(지적도) ──────────────────────────────────────
  const parcel = await vworld.parcelAt(geo.value.lon, geo.value.lat);
  let parsedPnu = null;

  if (parcel.ok) {
    const polygonAreaSqm = parcel.value.polygon.length >= 3
      ? geometry.polygonAreaSqm(parcel.value.polygon)
      : null;

    out.parcel = {
      ...parcel.value,
      polygonAreaSqm: polygonAreaSqm === null ? null : round(polygonAreaSqm, 1),
    };
    sources.push({ name: 'VWorld 연속지적도', cached: !!parcel.cached });

    if (parcel.value.pnu) {
      parsedPnu = pnuUtil.parse(parcel.value.pnu);
      facts.push({ key: 'geo.pnu', value: parcel.value.pnu, unit: null, confidence: 0.95, ...src('VWorld 연속지적도') });
    }

    // ★ 공부상 면적을 land.area_sqm 으로 등록 → 문서값과 교차검증된다
    if (parcel.value.officialAreaSqm) {
      facts.push({
        key: 'land.area_sqm', value: parcel.value.officialAreaSqm, unit: '㎡',
        confidence: 0.95, quote: `지적 공부상 면적 ${parcel.value.officialAreaSqm}㎡`,
        ...src('지적공부(VWorld)'),
      });
    }
    // 폴리곤 실측 면적은 공부상 면적과 오차가 있을 수 있어 참고값으로만 둔다
    if (polygonAreaSqm && parcel.value.officialAreaSqm) {
      const diff = Math.abs(polygonAreaSqm - parcel.value.officialAreaSqm) / parcel.value.officialAreaSqm;
      if (diff > 0.05) {
        ctx.warn(`지적도 폴리곤 실측(${round(polygonAreaSqm, 0)}㎡)과 공부상 면적(${parcel.value.officialAreaSqm}㎡) 차이 ${round(diff * 100, 1)}%`);
      }
    }
  } else if (!parcel.unavailable) {
    ctx.warn(`필지 조회 실패: ${parcel.error}`);
  }

  // ── ③ 토지이용계획 (용도지역 → 용적률/건폐율 상한) ────────
  if (parsedPnu) {
    const landUse = await nsdi.landUse(parsedPnu.pnu);
    if (landUse.ok) {
      out.landUse = landUse.value;
      sources.push({ name: 'VWorld 토지이용계획', cached: !!landUse.cached });
      facts.push({ key: 'land.zoning', value: landUse.value.zone, unit: null, confidence: 0.9, ...src('토지이용계획(VWorld)') });

      if (landUse.value.limits) {
        facts.push({
          key: 'land.far_limit', value: landUse.value.limits.far, unit: '%',
          confidence: 0.7, note: '국토계획법 시행령 기준 — 지자체 조례 확인 필요',
          ...src(`국토계획법 시행령(용도지역: ${landUse.value.zone})`),
        });
        facts.push({
          key: 'land.bcr_limit', value: landUse.value.limits.bcr, unit: '%',
          confidence: 0.7, note: '국토계획법 시행령 기준 — 지자체 조례 확인 필요',
          ...src(`국토계획법 시행령(용도지역: ${landUse.value.zone})`),
        });
      } else {
        ctx.warn(`용도지역 '${landUse.value.zone}' 의 법정 상한 테이블이 없다 — 조례 직접 확인 필요`);
      }
    } else if (!landUse.unavailable) {
      ctx.warn(`토지이용계획 조회 실패: ${landUse.error}`);
    }

    // ── ④ 건축물대장 (기존 건물이 있는 경우) ────────────────
    const reg = await molit.buildingRegister(parsedPnu);
    if (reg.ok) {
      out.building = reg.value;
      sources.push({ name: '건축물대장(국토교통부)', cached: !!reg.cached });
      const push = (key, value, unit) => {
        if (value !== null && value !== undefined) {
          facts.push({ key, value, unit, confidence: 0.95, ...src('건축물대장(국토교통부)') });
        }
      };
      push('land.area_sqm', reg.value.platAreaSqm, '㎡');
      push('building.gfa_sqm', reg.value.totalAreaSqm, '㎡');
      push('building.footprint_sqm', reg.value.archAreaSqm, '㎡');
      push('building.floors', reg.value.groundFloors, '층');
      push('building.height_m', reg.value.heightM, 'm');
    } else if (!reg.unavailable && !/자료 없음/.test(reg.error || '')) {
      ctx.warn(`건축물대장 조회 실패: ${reg.error}`);
    }
  }

  // ── ⑤ 지도 이미지 (기본 비활성 — 쿼터 절약) ──────────────
  if (process.env.IM_AGENT_FETCH_IMAGES === '1' && out.geo) {
    const saved = await saveSatelliteImage(input.projectId, out.geo.lat, out.geo.lon, ctx);
    if (saved) out.geo.satelliteImage = saved;
  } else if (out.geo) {
    out.geo.satelliteImageHint = 'IM_AGENT_FETCH_IMAGES=1 로 실행하면 위성영상을 내려받는다';
  }

  const confidence = out.parcel ? (out.landUse ? 0.9 : 0.75) : 0.5;
  return { facts, sources, ...out, quota: cache.stats(), confidence };
}

/** 위성영상 저장. 이미지 URL에는 인증키가 들어가므로 URL 자체는 산출물에 남기지 않는다. */
async function saveSatelliteImage(projectId, lat, lon, ctx) {
  const url = vworld.staticMapUrl(lat, lon, { layer: 'Satellite' });
  if (!url) return null;

  const q = cache.checkQuota(vworld.PROVIDER);
  if (!q.allowed) { ctx.warn(q.reason); return null; }

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    cache.consume(vworld.PROVIDER);
    if (!r.ok) { ctx.warn(`위성영상 다운로드 실패: HTTP ${r.status}`); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.slice(0, 4).toString('utf8').includes('{')) {
      ctx.warn('위성영상 응답이 이미지가 아니다 (키/권한 확인 필요)');
      return null;
    }
    const fs = require('fs');
    const path = require('path');
    const file = path.join(store.projectDir(projectId), '04_Property', 'satellite.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return '04_Property/satellite.png';
  } catch (e) {
    ctx.warn(`위성영상 다운로드 예외: ${e.message}`);
    return null;
  }
}

/**
 * 이 Agent 가 **소재지만 있으면** 공공데이터로 채우는 key.
 * ★ 사람에게 물어보지 않아도 되는 항목이다 — 물어보면 공부(公簿)와 다른 값을
 *   손으로 적게 되고, 그 순간 독립된 두 번째 출처라는 가치가 사라진다.
 */
const FILLS = ['geo.pnu', 'geo.lat', 'geo.lon',
  'land.area_sqm', 'land.zoning', 'land.far_limit', 'land.bcr_limit', 'land.official_price'];

module.exports = { id: '07_geo', label: 'Geo / Satellite Agent', inputSchema, outputSchema, run, FILLS };
