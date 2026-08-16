'use strict';
/**
 * nsdi.js — 국가공간정보(VWorld NED) Connector.
 *
 *   ① 개별공시지가   PNU → 원/㎡ (연도별 고시)
 *   ② 토지이용계획   PNU → 용도지역 + 조례상 용적률/건폐율 상한
 *                    + **규제 사항**(개발제한구역·군사시설보호구역·지구단위계획 등)
 *
 * 용도지역별 상한은 '국토계획법 시행령 기준값'을 내장 테이블로 둔다.
 * 지자체 조례가 더 강할 수 있으므로 **참고 상한**으로만 쓰고,
 * 계획안이 이 상한을 넘으면 RED FLAG를 띄워 조례 확인을 강제한다.
 *
 * 인증키: VWORLD_KEY (VWorld NED는 VWorld 키를 공유한다)
 */

const { request, buildUrl, redact } = require('./http');
const cache = require('./cache');
const { normalize, num } = require('./xml');

const PROVIDER = 'vworld';
const BASE = 'https://api.vworld.kr/ned/data';

function apiKey() {
  return process.env.VWORLD_KEY || '';
}

function isAvailable() {
  return Boolean(apiKey());
}

/** VWorld 와 같은 도메인 규칙을 쓴다 (스킴·경로 제거) */
function domain() {
  return require('./vworld').domain();
}

async function call(endpoint, params, namespace, cacheParams) {
  if (!isAvailable()) {
    return { ok: false, error: 'VWORLD_KEY 미설정 — 공시지가/용도지역 조회 생략', unavailable: true };
  }

  return cache.through(PROVIDER, namespace, cacheParams, async () => {
    const url = buildUrl(`${BASE}/${endpoint}`, { format: 'json', ...params, key: apiKey(), domain: domain() || undefined });
    const r = await request(url);
    if (!r.ok) return { ok: false, error: redact(r.error) };

    // NED는 JSON/XML이 섞여 오므로 공통 정규화기를 태운다
    try {
      const j = JSON.parse(r.body);
      const field = Object.keys(j).find(k => j[k] && j[k].field);
      const items = field ? j[field].field : (normalize(r.body).items || []);
      return { ok: true, value: Array.isArray(items) ? items : [items].filter(Boolean) };
    } catch (_) {
      const parsed = normalize(r.body);
      if (!parsed.ok) return { ok: false, error: redact(parsed.error) };
      return { ok: true, value: parsed.items };
    }
  });
}

/** 개별공시지가 (원/㎡). 최신 고시연도 값을 돌려준다. */
async function landPrice(pnu, year = null) {
  if (!pnu) return { ok: false, error: 'PNU 없음' };

  // ★ numOfRows 를 넉넉히 준다. NED 응답이 **오름차순**이라 10건만 받으면
  //   2006~2015 만 오고, 그중 최신을 골라도 "최신 = 2015년" 이 된다.
  //   실측에서 2015년 46,100,000 원/㎡ 를 최신으로 잡아 **30% 오차**가 났다
  //   (실제 2026년 65,730,000). 값도 출처도 멀쩡해 보여서 문서로는 안 잡힌다.
  //   (2026-08-16 실측으로 확인)
  const r = await call('getIndvdLandPriceAttr', {
    pnu, stdrYear: year || undefined, numOfRows: 100, pageNo: 1,
  }, 'landprice', { pnu, year: year || 'latest' });

  if (!r.ok) return r;

  const rows = (r.value || [])
    .map(x => ({
      year: num(x.stdrYear ?? x.stdr_year),
      pricePerSqm: num(x.pblntfPclnd ?? x.pblntf_pclnd ?? x.landPrice),
      noticeDate: x.pblntfDe || x.pblntf_de || null,
    }))
    .filter(x => x.pricePerSqm !== null)
    .sort((a, b) => (b.year || 0) - (a.year || 0));

  if (!rows.length) return { ok: false, error: '공시지가 자료 없음' };
  return { ok: true, cached: r.cached, value: rows[0], history: rows };
}

/** 토지이용계획 — 용도지역 */
async function landUse(pnu) {
  if (!pnu) return { ok: false, error: 'PNU 없음' };

  const r = await call('getLandUseAttr', { pnu, numOfRows: 30, pageNo: 1 }, 'landuse', { pnu });
  if (!r.ok) return r;

  const zones = (r.value || [])
    .map(x => (x.prposAreaDstrcCodeNm || x.prpos_area_dstrc_code_nm || x.lndcgrCodeNm || '').trim())
    .filter(Boolean);

  if (!zones.length) return { ok: false, error: '토지이용계획 자료 없음' };

  const primary = zones.find(z => ZONE_LIMITS[normalizeZone(z)]) || zones[0];
  const limits = ZONE_LIMITS[normalizeZone(primary)] || null;

  // ★ 나머지 항목을 버리지 않는다 (C-05).
  //   같은 응답에 개발제한구역·군사시설보호구역·지구단위계획구역이 함께 온다.
  //   지금까지는 용도지역 하나만 남기고 전부 흘려보냈다 — **그린벨트에 걸린 땅과
  //   아닌 땅이 화면에서 똑같이 보였다.** 용적률보다 먼저 봐야 하는 정보다.
  const restrictions = zones.filter(z => z !== primary && !ZONE_LIMITS[normalizeZone(z)]);

  return {
    ok: true, cached: r.cached,
    value: {
      zone: primary, allZones: zones, limits,
      limitsSource: limits ? '국토계획법 시행령 기준(조례 확인 필요)' : null,
      restrictions: restrictions,
      critical: restrictions.filter(isCritical),
    },
  };
}

/**
 * **사업 가능 여부 자체를 좌우하는** 규제인가.
 *
 * ★ 목록에 없다고 '문제 없음'이 아니다. 여기 있는 것은 "이게 걸려 있으면 용적률
 *   계산보다 먼저 봐야 한다"는 뜻이고, 없는 것은 사람이 확인해야 한다는 뜻이다.
 */
const CRITICAL_RESTRICTIONS = [
  '개발제한구역', '군사기지', '군사시설보호', '비행안전', '문화재보호',
  '상수원보호', '수변구역', '보전산지', '농업진흥', '접도구역', '공원구역',
];

function isCritical(text) {
  var s = String(text || '').replace(/\s/g, '');
  return CRITICAL_RESTRICTIONS.some(function (k) { return s.indexOf(k) !== -1; });
}

// ── 용도지역별 용적률/건폐율 상한 (국토계획법 시행령) ──────────────
// 지자체 조례가 더 강할 수 있다. 반드시 '참고 상한'으로만 쓴다.
const ZONE_LIMITS = {
  '제1종전용주거지역': { far: 100, bcr: 50 },
  '제2종전용주거지역': { far: 150, bcr: 50 },
  '제1종일반주거지역': { far: 200, bcr: 60 },
  '제2종일반주거지역': { far: 250, bcr: 60 },
  '제3종일반주거지역': { far: 300, bcr: 50 },
  '준주거지역': { far: 500, bcr: 70 },
  '중심상업지역': { far: 1500, bcr: 90 },
  '일반상업지역': { far: 1300, bcr: 80 },
  '근린상업지역': { far: 900, bcr: 70 },
  '유통상업지역': { far: 1100, bcr: 80 },
  '전용공업지역': { far: 300, bcr: 70 },
  '일반공업지역': { far: 350, bcr: 70 },
  '준공업지역': { far: 400, bcr: 70 },
  '보전녹지지역': { far: 80, bcr: 20 },
  '생산녹지지역': { far: 100, bcr: 20 },
  '자연녹지지역': { far: 100, bcr: 20 },
};

function normalizeZone(text) {
  const s = String(text).replace(/\s/g, '');
  return Object.keys(ZONE_LIMITS).find(z => s.includes(z)) || s;
}

/** 용도지역 문자열만으로 상한 조회 (API 없이 문서에서 뽑은 값에도 쓸 수 있다) */
function limitsForZone(zoneText) {
  const key = normalizeZone(zoneText);
  return ZONE_LIMITS[key] ? { zone: key, ...ZONE_LIMITS[key] } : null;
}

module.exports = {
  landPrice, landUse, limitsForZone, normalizeZone, isAvailable, isCritical,
  ZONE_LIMITS, CRITICAL_RESTRICTIONS, PROVIDER,
};
