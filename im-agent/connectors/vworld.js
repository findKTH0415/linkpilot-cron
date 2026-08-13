'use strict';
/**
 * vworld.js — 국토교통부 공간정보 오픈플랫폼(VWorld) Connector.
 *
 * 사용 기능:
 *   ① 지오코딩         주소 → 위경도(EPSG:4326)
 *   ② 필지(지적) 조회   좌표 → 필지 폴리곤 + 공부상 면적 + PNU
 *   ③ 위성/지도 영상    IM 삽입용 정적 이미지 URL (Static Map)
 *
 * ★ 필지 폴리곤에서 계산한 면적은 '독립된 두 번째 출처'가 된다.
 *   문서상 대지면적과 대조해 불일치를 잡아내는 것이 이 Connector의 핵심 가치다.
 *
 * 인증키: VWORLD_KEY (GitHub Secrets)
 */

const { request, buildUrl, redact } = require('./http');
const cache = require('./cache');
const { num } = require('./xml');

const PROVIDER = 'vworld';
const BASE = 'https://api.vworld.kr/req';

function apiKey() {
  return process.env.VWORLD_KEY || '';
}

function isAvailable() {
  return Boolean(apiKey());
}

function unavailable() {
  return { ok: false, error: 'VWORLD_KEY 미설정 — 위성지도/지적 조회 생략', unavailable: true };
}

/** VWorld 공통 호출: JSON 응답의 status 필드까지 검사한다 */
async function call(service, params, namespace, cacheParams) {
  if (!isAvailable()) return unavailable();

  return cache.through(PROVIDER, namespace, cacheParams, async () => {
    const url = buildUrl(`${BASE}/${service}`, { ...params, key: apiKey(), format: 'json', type: 'json' });
    const r = await request(url);
    if (!r.ok) return { ok: false, error: redact(r.error) };

    let j;
    try {
      j = JSON.parse(r.body);
    } catch (e) {
      return { ok: false, error: `응답 파싱 실패: ${redact(r.body.slice(0, 80))}` };
    }
    const status = j?.response?.status;
    if (status && status !== 'OK') {
      const msg = j?.response?.error?.text || status;
      return { ok: false, error: `VWorld ${status}: ${msg}` };
    }
    return { ok: true, value: j.response };
  });
}

/**
 * 주소 → 좌표
 * @param {string} address 도로명 또는 지번 주소
 */
async function geocode(address) {
  if (!address) return { ok: false, error: '주소 없음' };

  // 도로명 우선, 실패 시 지번으로 재시도 (호출 2회 → 캐시로 반복 방지)
  for (const type of ['ROAD', 'PARCEL']) {
    const r = await call('address', {
      service: 'address', request: 'getcoord', version: '2.0',
      crs: 'EPSG:4326', address, type,
    }, 'geocode', { address, type });

    if (r.ok && r.value?.result?.point) {
      const p = r.value.result.point;
      return {
        ok: true, cached: r.cached,
        value: {
          lat: num(p.y), lon: num(p.x),
          matchedType: type,
          refined: r.value.refined?.text || address,
        },
      };
    }
    if (r.unavailable) return r;
  }
  return { ok: false, error: `지오코딩 실패 (도로명·지번 모두 미매칭): ${address}` };
}

/**
 * 좌표 → 필지(지적) 정보. 연속지적도 WFS 레이어 조회.
 * @returns {{ok, value:{pnu, jibun, officialAreaSqm, polygon:[[lon,lat],...]}}}
 */
async function parcelAt(lon, lat) {
  if (lon === null || lat === null) return { ok: false, error: '좌표 없음' };

  const r = await call('data', {
    service: 'data', request: 'GetFeature', version: '2.0',
    data: 'LP_PA_CBND_BUBUN',            // 연속지적도 (부번)
    geomFilter: `POINT(${lon} ${lat})`,
    geometry: 'true', attribute: 'true', size: 5, page: 1,
    crs: 'EPSG:4326',
  }, 'parcel', { lon: round6(lon), lat: round6(lat) });

  if (!r.ok) return r;

  const features = r.value?.result?.featureCollection?.features || [];
  if (!features.length) return { ok: false, error: '해당 좌표에 필지 없음' };

  const f = features[0];
  const props = f.properties || {};
  const polygon = extractPolygon(f.geometry);

  return {
    ok: true, cached: r.cached,
    value: {
      pnu: props.pnu || props.PNU || null,
      jibun: props.addr || props.jibun || null,
      officialAreaSqm: num(props.lndpcl_ar ?? props.LNDPCL_AR ?? props.area),
      polygon,
    },
  };
}

/** GeoJSON geometry → 외곽 링 좌표 배열 */
function extractPolygon(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates?.[0] || [];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates?.[0]?.[0] || [];
  return [];
}

/**
 * IM 삽입용 정적 지도 이미지 URL.
 * ★ 키가 URL에 포함되므로 IM 문서에는 절대 넣지 않는다.
 *   문서에는 키 없는 지도 링크(mapLink)만 넣고, 이미지 URL은 내부 다운로드용으로만 쓴다.
 */
function staticMapUrl(lat, lon, { zoom = 17, width = 800, height = 600, layer = 'Satellite' } = {}) {
  if (!isAvailable() || lat === null || lon === null) return null;
  return buildUrl(`${BASE}/image`, {
    service: 'image', request: 'getmap', version: '2.0',
    key: apiKey(), format: 'png', errorformat: 'json',
    basemap: layer,                    // Satellite | Base | Hybrid
    center: `${lon},${lat}`, zoom, size: `${width},${height}`,
    crs: 'EPSG:4326',
  });
}

/** 키가 노출되지 않는 공개 지도 링크 (IM 본문·투자자 배포용) */
function mapLink(lat, lon, zoom = 17) {
  if (lat === null || lon === null) return null;
  return `https://map.vworld.kr/map/maps.do#${zoom}/${lon}/${lat}`;
}

function round6(n) { return Math.round(Number(n) * 1e6) / 1e6; }

module.exports = { geocode, parcelAt, staticMapUrl, mapLink, isAvailable, extractPolygon, PROVIDER };
