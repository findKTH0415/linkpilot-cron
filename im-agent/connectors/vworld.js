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

/**
 * VWorld 키는 신청 시 등록한 도메인에서만 동작한다.
 * 브라우저 호출은 Referer 로 판정하지만 서버 호출은 Referer 가 없으므로
 * 등록한 도메인을 `domain` 파라미터로 명시해야 한다.
 *
 * ★ **콘솔의 서비스URL 을 글자 그대로 넣는다** (스킴·경로 포함).
 *   예: VWORLD_DOMAIN=https://nas.example.com/app.html
 *
 *   전에는 여기서 스킴·경로를 벗겨 호스트만 보냈다. `req/*` 계열은 그래도
 *   통과하지만 **`ned/*` 계열(개별공시지가·토지이용계획)은 간헐적으로
 *   INCORRECT_KEY 를 돌려준다** — 2026-08-15 실측에서 호스트만 보낸 경우
 *   5회 중 2회 실패, 등록 URL 그대로 보낸 경우 5회 중 0회 실패였다.
 *   간헐적이라 "가끔 값이 안 들어오는" 형태로만 드러나 원인을 찾기 어렵다.
 *   등록값을 가공하지 않는 것이 유일하게 안전한 쪽이다.
 */
function domain() {
  // ★ 콘솔의 **서비스URL 을 글자 그대로** 보낸다. 스킴·경로를 벗기면 안 된다.
  //
  //   예전에는 여기서 `https://` 와 경로를 잘라 호스트만 남겼다. 그러면
  //   `req/*` 계열(지오코딩·지적)은 통과하는데 `ned/*` 계열(공시지가·토지이용계획·
  //   토지특성)이 **간헐적으로** INCORRECT_KEY 를 낸다 — 실측에서 5회 중 2회 실패.
  //
  //   간헐적이라는 것이 이 결함의 성질이다. "가끔 값이 안 들어온다" 로만 보여서
  //   키를 재발급받고 도메인을 다시 등록해도 같은 증상이 반복된다.
  //   (2026-08-16 실측으로 확인 — 사용자 환경 B-3 의 원인)
  return (process.env.VWORLD_DOMAIN || '').trim();
}

/**
 * 요청 URL 조립.
 *
 * ★ 순서가 중요하다. format 을 먼저 두고 호출자 params 가 그것을 덮게 한다.
 *   예전에는 `{...params, type:'json'}` 처럼 뒤에 붙여서, 주소 서비스의
 *   type=ROAD/PARCEL 이 type=json 으로 덮어써졌다 — 지오코딩이 키와 무관하게
 *   항상 실패하던 원인이다. key·domain 만 마지막에 둬서 덮이지 않게 한다.
 */
function buildRequestUrl(service, params) {
  return buildUrl(`${BASE}/${service}`, {
    format: 'json',
    ...params,
    key: apiKey(),
    domain: domain() || undefined,
  });
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
    const url = buildRequestUrl(service, params);
    const r = await request(url);

    // IM_AGENT_DEBUG_HTTP=1 이면 원본 응답을 그대로 보여준다.
    // 인증 실패인지, 파라미터 문제인지, 결과가 없는 건지는 원문을 봐야 구분된다.
    if (process.env.IM_AGENT_DEBUG_HTTP === '1') {
      console.error(`\n[debug] ${redact(url)}`);
      console.error(`[debug] ${r.ok ? 'HTTP OK' : 'HTTP 실패: ' + r.error}`);
      if (r.body) console.error(`[debug] 응답: ${redact(String(r.body).slice(0, 400))}\n`);
    }

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
      const hint = !domain() && /권한|domain|인증|AUTH|KEY/i.test(String(msg) + status)
        ? ' — VWORLD_DOMAIN 미설정. VWorld 콘솔에 등록한 도메인을 넣어야 서버 호출이 허용된다'
        : '';
      return { ok: false, error: `VWorld ${status}: ${msg}${hint}` };
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
  //
  // ★ 각 시도의 실제 오류를 반드시 보존한다.
  //   폴백이 원인을 감추면 "미매칭"인지 "인증 실패"인지 구분할 수 없다.
  const attempts = [];

  for (const type of ['ROAD', 'PARCEL']) {
    const r = await call('address', {
      service: 'address', request: 'getcoord', version: '2.0',
      crs: 'EPSG:4326', address, type,
    }, 'geocode', { address, type });

    if (r.ok && r.value?.result?.point) {
      const p = r.value.result.point;
      return {
        ok: true, cached: r.cached, attempts,
        value: {
          lat: num(p.y), lon: num(p.x),
          matchedType: type,
          refined: r.value.refined?.text || address,
        },
      };
    }
    if (r.unavailable) return r;

    attempts.push({
      type,
      error: r.error || (r.ok ? '응답에 좌표(result.point)가 없다' : '알 수 없는 실패'),
      status: r.ok && r.value ? (r.value.status || null) : null,
    });
  }

  // 두 시도의 오류가 같으면 한 번만 보여준다 (같은 원인이면 중복 표시는 잡음이다)
  const messages = [...new Set(attempts.map(a => a.error))];
  const detail = messages.length === 1
    ? messages[0]
    : attempts.map(a => `${a.type}: ${a.error}`).join(' / ');

  return {
    ok: false, attempts,
    error: `지오코딩 실패 — ${detail} (주소: ${address})`,
    hint: diagnoseGeocodeFailure(attempts),
  };
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
      // ★ 연속지적도에는 **면적 필드가 없다.** 실측 응답 속성은
      //   pnu·jibun·bonbun·bubun·addr·jiga·gosi_year·gosi_month 8개뿐이다
      //   (2026-08-15 확인). 따라서 이 값은 사실상 항상 null 이고,
      //   대지면적은 건축물대장 platArea 또는 nsdi.landCharacteristics 가 채운다.
      //   필드명을 바꾼다고 채워지지 않는다 — 그 헛수고를 막으려고 남긴다.
      officialAreaSqm: num(props.lndpcl_ar ?? props.LNDPCL_AR ?? props.area),
      polygon,
    },
  };
}

/**
 * 필지 주변 필지들 — 연속지적도 bbox 조회 (도로필지 수집용, D-102).
 *
 * ★ parcelAt 과 **같은 레이어·같은 활용신청**이다(LP_PA_CBND_BUBUN). 필터만
 *   POINT → BOX 로 바뀐다. 새 신청 없이 붙는 이유가 이것이다.
 * ★ 연속지적도 속성에는 지목이 없다 — 지목 판정은 호출한 쪽이 토지특성
 *   (nsdi.landCharacteristics)으로 한다. 여기서는 후보만 낸다 (§4.9).
 *
 * @param {Array<[lon,lat]>} ring 기준 필지 폴리곤 (위경도)
 * @param {number} marginM bbox 여유 (m) — 접한 도로를 잡을 만큼만
 * @returns {{ok, value:[{pnu, jibun, polygon}]}}
 */
async function parcelsNear(ring, marginM = 30) {
  if (!ring || ring.length < 3) return { ok: false, error: '기준 폴리곤 없음' };

  const lons = ring.map(p => p[0]);
  const lats = ring.map(p => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = marginM / 111320;                                   // 1° 위도 ≈ 111.32km
  const dLon = marginM / (111320 * Math.cos(midLat * Math.PI / 180));
  const box = [
    round6(Math.min(...lons) - dLon), round6(Math.min(...lats) - dLat),
    round6(Math.max(...lons) + dLon), round6(Math.max(...lats) + dLat),
  ];

  const r = await call('data', {
    service: 'data', request: 'GetFeature', version: '2.0',
    data: 'LP_PA_CBND_BUBUN',
    geomFilter: `BOX(${box.join(',')})`,
    geometry: 'true', attribute: 'true', size: 60, page: 1,
    crs: 'EPSG:4326',
  }, 'parcels-near', { box: box.join(',') });

  if (!r.ok) return r;

  const features = r.value?.result?.featureCollection?.features || [];
  return {
    ok: true, cached: r.cached,
    value: features.map(f => ({
      pnu: f.properties?.pnu || f.properties?.PNU || null,
      jibun: f.properties?.addr || f.properties?.jibun || null,
      polygon: extractPolygon(f.geometry),
    })).filter(p => p.polygon.length >= 3),
  };
}

/**
 * 실패 원인 추정 — 오류 문구로 다음 행동을 좁혀준다.
 * 확신할 수 없으면 추측하지 않고 '원문 확인 필요'라고 쓴다.
 */
function diagnoseGeocodeFailure(attempts) {
  const all = attempts.map(a => `${a.error} ${a.status || ''}`).join(' ');

  if (/INVALID_KEY|등록되지|권한|UNAUTHORIZED|인증/i.test(all)) {
    return '키 또는 도메인 인증 실패 — VWorld 콘솔의 서비스URL 과 VWORLD_DOMAIN 이 정확히 같은지, '
      + '개발키가 승인 상태인지 확인한다 (승인 전에는 호출이 거부된다)';
  }
  if (/NOT_FOUND|결과가 없|no result/i.test(all)) {
    return '키·도메인은 통과했으나 주소가 매칭되지 않았다 — 다른 주소로 다시 시도한다';
  }
  if (/좌표\(result\.point\)가 없다/.test(all)) {
    return '응답은 정상(OK)인데 좌표가 비어 있다 — 주소 매칭 실패이거나 응답 구조가 다르다. '
      + 'IM_AGENT_DEBUG_HTTP=1 로 원문을 확인한다';
  }
  if (/타임아웃|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(all)) {
    return '네트워크 문제 — 방화벽·프록시에서 api.vworld.kr 접근이 막혔는지 확인한다';
  }
  return 'IM_AGENT_DEBUG_HTTP=1 로 다시 실행해 VWorld 원문 응답을 확인한다';
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
    key: apiKey(), domain: domain() || undefined, format: 'png', errorformat: 'json',
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

module.exports = { geocode, parcelAt, parcelsNear, staticMapUrl, mapLink, isAvailable, extractPolygon, buildRequestUrl, domain, diagnoseGeocodeFailure, PROVIDER };
