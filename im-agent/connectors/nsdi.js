'use strict';
/**
 * nsdi.js — 국가공간정보(VWorld NED) Connector.
 *
 *   ① 개별공시지가   PNU → 원/㎡ (연도별 고시)
 *   ② 토지이용계획   PNU → 용도지역 + 조례상 용적률/건폐율 상한
 *   ③ 토지특성       PNU → 공부상 대지면적·지목 (나대지의 유일한 면적 출처)
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

/**
 * VWorld 와 같은 도메인 규칙을 쓴다 (등록된 서비스URL 을 가공하지 않고 그대로).
 * ned/* 계열은 특히 여기에 민감하다 — vworld.js 의 domain() 주석 참고.
 */
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

/**
 * 연도별 고시 이력을 **최신 우선**으로 정렬한다.
 *
 * ★ NED 응답은 최초 고시연도부터 오름차순이다. 이 저장소는 같은 함정에 두 번
 *   걸렸다 — 공시지가(2015년을 최신으로 오인)와 토지특성이다. 정렬을 각자
 *   구현하면 세 번째가 나온다. 여기 한 곳에 두고 테스트로 고정한다.
 *   연도가 없는 행은 뒤로 보낸다 (최신으로 뽑히면 안 된다).
 */
function latestFirst(rows) {
  return rows.slice().sort((a, b) => (b.year || 0) - (a.year || 0));
}

/** 개별공시지가 (원/㎡). 최신 고시연도 값을 돌려준다. */
async function landPrice(pnu, year = null) {
  if (!pnu) return { ok: false, error: 'PNU 없음' };

  // ★ 응답은 **최초 고시연도부터 오름차순**이다. numOfRows 를 작게 잡으면
  //   최신이 아니라 **가장 오래된 쪽**만 받는다. 10 이었을 때 2006~2015 만
  //   와서 "최신"이 2015년 값이 됐다 (실측: 2015년 46,100,000 vs 실제 최신
  //   2026년 65,730,000 — 30% 낮다). 조용히 낡은 값이 IM 에 들어간다.
  //   한 필지의 이력은 20여 건이므로 100 이면 전부 받는다 (호출 수는 그대로 1).
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
    .filter(x => x.pricePerSqm !== null);
  const sorted = latestFirst(rows);

  if (!sorted.length) return { ok: false, error: '공시지가 자료 없음' };
  return { ok: true, cached: r.cached, value: sorted[0], history: sorted };
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

  return {
    ok: true, cached: r.cached,
    value: { zone: primary, allZones: zones, limits, limitsSource: limits ? '국토계획법 시행령 기준(조례 확인 필요)' : null },
  };
}

/**
 * 토지특성 — 공부상 대지면적(`lndpclAr`)과 지목.
 *
 * ★ 왜 별도 호출인가: 연속지적도(LP_PA_CBND_BUBUN)에는 **면적 필드가 아예 없다.**
 *   건물이 있는 필지는 건축물대장의 `platArea` 로 채워지지만, **나대지는
 *   건축물대장 자체가 없어** 여기가 공부상 면적의 유일한 출처다.
 *   개발사업 부지는 대개 나대지이므로 실사용에서는 이 경로가 주로 쓰인다.
 *
 * ★ 공시지가와 마찬가지로 응답이 **오름차순**이라 numOfRows 를 넉넉히 잡고
 *   최신 고시연도를 직접 고른다. 작게 잡으면 20년 전 면적을 최신으로 오인한다.
 */
async function landCharacteristics(pnu) {
  if (!pnu) return { ok: false, error: 'PNU 없음' };

  const r = await call('getLandCharacteristics', { pnu, numOfRows: 100, pageNo: 1 }, 'landchar', { pnu });
  if (!r.ok) return r;

  const rows = (r.value || [])
    .map(x => ({
      year: num(x.stdrYear ?? x.stdr_year),
      areaSqm: num(x.lndpclAr ?? x.lndpcl_ar),
      category: (x.lndcgrCodeNm || x.lndcgr_code_nm || '').trim() || null,  // 지목
      zone: (x.prposArea1Nm || x.prpos_area1_nm || '').trim() || null,
      topography: (x.tpgrphHgCodeNm || '').trim() || null,
      roadSide: (x.roadSideCodeNm || '').trim() || null,
    }))
    .filter(x => x.areaSqm !== null);
  const sorted = latestFirst(rows);

  if (!sorted.length) return { ok: false, error: '토지특성 자료 없음' };
  return { ok: true, cached: r.cached, value: sorted[0], history: sorted };
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

module.exports = { landPrice, landUse, landCharacteristics, latestFirst, limitsForZone, normalizeZone, isAvailable, ZONE_LIMITS, PROVIDER };
