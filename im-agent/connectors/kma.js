'use strict';
/**
 * kma.js — 기상청 API허브(apihub.kma.go.kr) Connector.
 *
 *   ① 지상관측 일통계   지점 + 날짜범위 → 일사량·일조시간 (sun_sfc_day.php)
 *   ② 지점정보          지점번호 → 위경도 (stn_inf.php)
 *
 * ★ **data.go.kr 과 별개 시스템이다.** 키도 다르고(`KMA_APIHUB_KEY`), 응답도
 *   JSON/XML 이 아니라 `#` 로 시작하는 주석 헤더가 붙은 CSV 텍스트다.
 *   그래서 molit/nsdi 가 쓰는 xml.normalize 를 태울 수 없고 여기서 직접 판다.
 *
 * ★ 이 Connector 는 **일사량까지만** 낸다. 발전량(= 일사량 × 용량 × 시스템효율)은
 *   내지 않는다 — 시스템효율(PR)이 가정치이고, 가정치는 IM 에 들어가지 않는다.
 *   (2026-08-15 결정. 등록부 D-25 참조)
 *
 * 인증키: KMA_APIHUB_KEY
 *   ★ 키 첫 글자가 대문자 I 인지 소문자 l 인지 화면 글꼴로 구분되지 않는다.
 *     틀리면 401 만 돌아온다 — 실제로 여기서 한 번 막혔다.
 */

const { request, buildUrl, redact } = require('./http');
const cache = require('./cache');

const PROVIDER = 'kma';
const BASE = 'https://apihub.kma.go.kr/api/typ01/url';

/** 일사량 1 MJ/㎡ = 1/3.6 kWh/㎡ */
const MJ_TO_KWH = 1 / 3.6;

function apiKey() {
  return (process.env.KMA_APIHUB_KEY || '').trim();
}

function isAvailable() {
  return Boolean(apiKey());
}

function unavailable(what) {
  return { ok: false, error: `KMA_APIHUB_KEY 미설정 — ${what} 조회 생략`, unavailable: true };
}

/**
 * API허브 응답 판별.
 * 오류는 JSON 으로 오고 정상은 `#START7777` 로 시작하는 텍스트다.
 * @returns {string|null} 오류 메시지. 정상이면 null.
 */
function errorOf(body) {
  const t = String(body || '').trim();
  if (!t) return '빈 응답';
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      const r = j.result || {};
      if (r.status && Number(r.status) >= 400) {
        return `${r.message || '오류'} (status ${r.status})`;
      }
    } catch (_) { /* JSON 이 아니면 아래로 */ }
  }
  if (/유효한 인증키가 아닙니다/.test(t)) {
    return '인증키가 올바르지 않다 — 첫 글자의 대문자 I / 소문자 l 을 확인한다';
  }
  if (/활용신청이 필요한/.test(t)) return '활용신청이 필요한 API 다 (API허브에서 신청)';
  return null;
}

async function call(endpoint, params, namespace, cacheParams, ttl = null) {
  if (!isAvailable()) return unavailable(endpoint);

  return cache.through(PROVIDER, namespace, cacheParams, async () => {
    const url = buildUrl(`${BASE}/${endpoint}`, { ...params, authKey: apiKey() });
    const r = await request(url);

    // ★ API허브는 오류를 본문 JSON 으로도 주지만 HTTP 상태로도 준다.
    //   상태로 끊기면 아래 errorOf 가 돌지 못해 "HTTP 403" 만 남는다 —
    //   그것만 보면 키가 틀린 건지 신청이 안 된 건지 알 수 없다.
    if (!r.ok) {
      if (r.status === 403) {
        return { ok: false, error: `${endpoint} 는 API허브에서 활용신청이 필요하다 (승인 후 재시도)` };
      }
      if (r.status === 401) {
        return { ok: false, error: '인증키가 올바르지 않다 — 첫 글자의 대문자 I / 소문자 l 을 확인한다' };
      }
      return { ok: false, error: redact(r.error) };
    }

    const err = errorOf(r.body);
    if (err) return { ok: false, error: redact(err) };
    return { ok: true, value: r.body };
  }, ttl ? { ttl } : {});
}

/**
 * 일통계 텍스트를 판다.
 *
 * 형식 (실측, 2026-08-15):
 *   #START7777
 *   # YYMMDD STN  TA...  CA   SS   SS    SI    SI
 *   20250801,108,31.0,35.1,1213,27.8,538,66.9,49.0,1358,8.4,4.5,14.1,16.09,2.80,
 *   #7777END
 *
 * 열 위치 (0-based): 0 날짜 · 1 지점 · 10 전운량 · 11 일조시간(hr) · 13 일사량(MJ/㎡)
 * ★ 헤더가 주석이라 열 이름으로 찾을 수 없다. 위치로 읽되 **자릿수를 검증**한다 —
 *   기상청이 열을 늘리면 조용히 다른 값을 일사량으로 읽게 된다.
 */
const COL = { date: 0, stn: 1, cloud: 10, sunshineHr: 11, solarMJ: 13, MIN_COLS: 15 };

function parseDaily(text) {
  const rows = [];
  let malformed = 0;

  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;

    const c = t.split(',');
    if (c.length < COL.MIN_COLS) { malformed++; continue; }

    const date = c[COL.date].trim();
    if (!/^\d{8}$/.test(date)) { malformed++; continue; }

    rows.push({
      date,
      stn: c[COL.stn].trim(),
      solarMJ: num(c[COL.solarMJ]),
      sunshineHr: num(c[COL.sunshineHr]),
      cloud: num(c[COL.cloud]),
    });
  }
  return { rows, malformed };
}

/** 기상청 결측은 -9, -99, -999 계열로 온다. 0 과 구분해야 한다 — 흐린 날의 0 은 실측값이다. */
function num(v) {
  const n = Number(String(v == null ? '' : v).trim());
  if (!Number.isFinite(n)) return null;
  if (n <= -9) return null;
  return n;
}

/**
 * 지점의 일별 일사량·일조시간.
 * @param {string|number} stn 지점번호 (0 이면 전체 지점)
 * @param {string} tm1 YYYYMMDD
 * @param {string} tm2 YYYYMMDD
 */
async function dailySolar(stn, tm1, tm2) {
  if (!stn && stn !== 0) return { ok: false, error: '지점번호 없음' };

  const r = await call('sun_sfc_day.php', { tm1, tm2, stn }, 'kma_sun', { stn, tm1, tm2 }, 30 * 86400);
  if (!r.ok) return r;

  const { rows, malformed } = parseDaily(r.value);
  if (!rows.length) return { ok: false, error: '일통계 자료 없음' };
  return { ok: true, cached: r.cached, value: rows, malformed };
}

/**
 * 연간 일사량·일조시간 집계.
 *
 * ★ **결측일 수를 반드시 함께 돌려준다.** 결측을 0 으로 세면 합계가 조용히
 *   작아지고, 그 값이 발전량 근거로 쓰이면 사업성을 과소평가한다.
 *   결측이 많으면 호출자가 그 해를 버릴 수 있어야 한다.
 *
 * @param {string|number} stn 지점번호
 * @param {number} year 연도 (예: 2025)
 */
async function annualSolar(stn, year) {
  const r = await dailySolar(stn, `${year}0101`, `${year}1231`);
  if (!r.ok) return r;

  const rows = r.value;
  const withSolar = rows.filter(x => x.solarMJ !== null);
  const withSun = rows.filter(x => x.sunshineHr !== null);

  if (!withSolar.length) {
    return { ok: false, error: `${year}년 ${stn} 지점에 일사량 관측값이 없다 (일사 미관측 지점일 수 있다)` };
  }

  const totalMJ = withSolar.reduce((s, x) => s + x.solarMJ, 0);
  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;

  return {
    ok: true,
    cached: r.cached,
    value: {
      year,
      stn: String(stn),
      irradianceMJ: round1(totalMJ),
      irradianceKwh: round1(totalMJ * MJ_TO_KWH),          // kWh/㎡·년
      dailyAvgKwh: round2(totalMJ * MJ_TO_KWH / withSolar.length), // kWh/㎡·일
      sunshineHours: round1(withSun.reduce((s, x) => s + x.sunshineHr, 0)),
      observedDays: withSolar.length,
      missingDays: daysInYear - withSolar.length,
      coverage: round1(withSolar.length / daysInYear * 100),
    },
  };
}

/**
 * 지점정보 (위경도 포함).
 * ★ 별도 활용신청이 필요하다. 미신청 상태면 403 이 오고, 그때는 지점을 사람이
 *   지정해야 한다 — 좌표를 코드에 박아 넣지 않는다 (출처 없는 숫자 금지).
 */
async function stations() {
  const r = await call('stn_inf.php', { inf: 'SFC' }, 'kma_stn', { inf: 'SFC' }, 180 * 86400);
  if (!r.ok) return r;

  const list = [];
  for (const line of String(r.value).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const c = t.split(/[,\s]+/).filter(Boolean);
    if (c.length < 4) continue;
    const id = c[0];
    const lon = Number(c[1]);
    const lat = Number(c[2]);
    if (!/^\d+$/.test(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    list.push({ stn: id, lat, lon, name: c[c.length - 1] });
  }
  if (!list.length) return { ok: false, error: '지점 목록을 파싱하지 못했다' };
  return { ok: true, cached: r.cached, value: list };
}

/** 두 좌표 사이 거리(km) — 지점 선택에만 쓰므로 구면 근사로 충분하다 */
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 좌표에서 가장 가까운 관측지점.
 * ★ **거리를 함께 돌려준다.** 부지에서 80km 떨어진 관측소 값을 출처 표시 없이
 *   쓰면 그것도 근거 없는 숫자다. 호출자가 거리를 IM 에 적을 수 있어야 한다.
 */
async function nearestStation(lat, lon) {
  if (lat === null || lon === null) return { ok: false, error: '좌표 없음' };

  // ★ 지점정보(stn_inf)는 별도 활용신청이 필요하고, 승인 전에는 좌표를 얻을 수
  //   없어 일사량 경로 전체가 막힌다. 그때 지점번호를 직접 줄 수 있게 한다.
  //   ★ **거리를 지어내지 않는다.** 사람이 고른 지점이 부지에서 얼마나 떨어졌는지
  //     우리는 모른다. distanceKm 를 null 로 두어 출처에 "거리 미상" 이 남게 한다 —
  //     0km 로 채우면 부지에서 잰 값처럼 보인다.
  const forced = (process.env.KMA_STN || '').trim();
  if (forced) {
    return {
      ok: true,
      value: { stn: forced, lat: null, lon: null, name: null, distanceKm: null },
      forced: true,
    };
  }

  const r = await stations();
  if (!r.ok) return r;

  let best = null;
  for (const s of r.value) {
    const km = distanceKm(lat, lon, s.lat, s.lon);
    if (!best || km < best.distanceKm) best = { ...s, distanceKm: round1(km) };
  }
  if (!best) return { ok: false, error: '지점을 찾지 못했다' };
  return { ok: true, cached: r.cached, value: best };
}

/**
 * 관측 풍속을 **허브 높이로 환산하지 않는다** (등록부 D-55).
 *
 * ★ 이 함수는 값을 내려고 있는 것이 아니라 **못 내는 이유를 코드가 들고
 *   있으려고** 있다. `kepco.substationDistance()` 와 같은 자리다.
 *
 * 왜 못 하는가: 기상청 지상관측 풍속은 **10m 기준**이고 풍력 터빈 허브는 통상
 * 80~140m다. 둘을 잇는 것은 전단지수(α)인데 그 값이 지표 거칠기에 따라
 * 0.1~0.4 로 갈리는 **가정**이다. 그런데 발전량은 풍속의 **세제곱**에 비례한다 —
 * α 를 0.14 로 잡느냐 0.25 로 잡느냐가 발전량을 배 가까이 흔든다.
 *
 * 게다가 **결과가 그럴듯하다.** 10m 에서 4.5m/s 를 100m 로 올리면 6~8m/s 가
 * 나오고, 그 값은 실제 풍황탑 측정치와 구분되지 않는다. 출처에는 「기상청」이
 * 남아 근거 있는 값처럼 보인다 — 이 저장소가 가장 경계하는 모양이다.
 *
 * **풍황탑(MET mast)·라이다 측정치를 사람이 넣는다.** 그것이 실사의 핵심 문서다.
 */
function hubWindSpeed() {
  return {
    ok: false,
    byDesign: true,
    error: '관측 풍속(10m)을 허브 높이로 환산하지 않는다 — 전단지수(α)가 가정이고 '
      + '발전량은 풍속의 **세제곱**에 비례해 그 가정이 결과를 배 가까이 흔든다. '
      + '**풍황탑·라이다 측정치를 사람이 넣는다** (site.wind_speed + site.hub_height_m)',
  };
}

function round1(n) { return n === null ? null : Math.round(n * 10) / 10; }
function round2(n) { return n === null ? null : Math.round(n * 100) / 100; }

module.exports = {
  dailySolar, annualSolar, stations, nearestStation,
  parseDaily, distanceKm, isAvailable, errorOf, hubWindSpeed,
  MJ_TO_KWH, COL, PROVIDER,
};
