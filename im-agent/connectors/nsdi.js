'use strict';
/**
 * nsdi.js — 국가공간정보(VWorld NED) Connector.
 *
 *   ① 개별공시지가   PNU → 원/㎡ (연도별 고시)
 *   ② 토지이용계획   PNU → 용도지역 + 조례상 용적률/건폐율 상한
 *                    + **규제 사항**(개발제한구역·군사시설보호구역·지구단위계획 등)
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

  // ★ numOfRows 를 넉넉히 준다. NED 응답이 **오름차순**이라 10건만 받으면
  //   2006~2015 만 오고, 그중 최신을 골라도 "최신 = 2015년" 이 된다.
  //   실측에서 2015년 46,100,000 원/㎡ 를 최신으로 잡아 **30% 오차**가 났다
  //   (실제 2026년 65,730,000). 값도 출처도 멀쩡해 보여서 문서로는 안 잡힌다.
  //   (2026-08-16 실측으로 확인)
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

/**
 * 지역·지구 중 **딜 조건이 되는 것**의 분류표.
 *
 * ★ 왜 필요한가: `landUse()` 는 지역·지구를 전부 받아 오는데(서울 중구 표본은
 *   19건) 그중 대표 용도지역 하나만 IM 에 실려 왔다. 나머지에 토지거래허가구역·
 *   고도제한이 섞여 있어도 문서에는 "일반상업지역, 용적률 상한 1300%" 만 남는다.
 *   1300% 를 실제로 못 쓰는 부지인데 그 근거가 조회는 됐고 버려진 것이다.
 *
 * ★ RED 는 **거래·개발의 성립 자체에 조건이 붙는 것**만 둔다. 절차가 늘거나
 *   수치가 깎이는 것은 YELLOW 다. 여기를 넓히면 전부 RED 가 되어 승인 게이트가
 *   의미를 잃는다 (RED 는 배포를 차단한다 — core/gate.js).
 *
 * ★ 이 목록이 맞는지는 아직 사람이 확인하지 않았다 — 등록부 D-24.
 *   확정 전까지 **없는 규제를 지어내지 않고, 매칭된 것만** 올린다.
 */
const REGULATIONS = [
  // ── RED: 거래 또는 개발 가능성 자체에 조건이 붙는다 ─────────
  { match: /토지거래계약.*허가구역/, severity: 'RED', why: '매매에 관청 허가가 필요하다 — 거래 성사의 선행조건이다' },
  { match: /개발제한구역/, severity: 'RED', why: '원칙적으로 건축·형질변경이 제한된다' },
  { match: /군사기지|군사시설보호|비행안전구역/, severity: 'RED', why: '국방부 협의 없이는 건축 가능 여부를 확정할 수 없다' },
  { match: /상수원보호구역|수질보전특별대책/, severity: 'RED', why: '입지 가능 업종이 법으로 제한된다' },
  { match: /문화재보호구역|국가유산보호구역/, severity: 'RED', why: '현상변경 허가 대상이다' },

  // ── YELLOW: 계획 수치를 깎거나 절차를 늘린다 ────────────────
  { match: /대공방어협조구역/, severity: 'YELLOW', why: '고도제한 — 용적률 상한을 다 쓰지 못할 수 있다' },
  { match: /최고높이 제한|고도지구/, severity: 'YELLOW', why: '고도제한 — 용적률 상한을 다 쓰지 못할 수 있다' },
  { match: /지구단위계획구역/, severity: 'YELLOW', why: '개별 필지 기준이 아니라 지구단위계획의 규정을 따른다' },
  { match: /역사문화환경보존지역|등록문화유산/, severity: 'YELLOW', why: '심의 대상 — 인허가 일정이 늘어난다' },
  { match: /경관지구|중점경관관리구역/, severity: 'YELLOW', why: '높이·외관 심의 대상이다' },
  { match: /과밀억제권역/, severity: 'YELLOW', why: '취득세 중과 대상일 수 있다 — 사업비에 영향' },
  { match: /정비구역|재정비촉진/, severity: 'YELLOW', why: '정비사업 절차를 따라야 한다' },
  { match: /교육환경보호구역|학교환경위생/, severity: 'YELLOW', why: '입지 가능 업종이 제한된다' },
];

/**
 * 지역·지구 목록에서 딜 조건이 되는 것을 골라낸다.
 * @param {string[]} zones `landUse().value.allZones`
 * @returns {{zone:string, severity:string, why:string}[]} 매칭된 것만. 중복은 제거한다.
 */
function classifyZones(zones) {
  const seen = new Set();
  const out = [];
  for (const zone of zones || []) {
    const rule = REGULATIONS.find(r => r.match.test(zone));
    if (!rule || seen.has(zone)) continue;
    seen.add(zone);
    out.push({ zone, severity: rule.severity, why: rule.why });
  }
  // RED 를 먼저 보여 준다
  return out.sort((a, b) => (a.severity === 'RED' ? -1 : 1) - (b.severity === 'RED' ? -1 : 1));
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
  landPrice, landUse, landCharacteristics, latestFirst, classifyZones,
  limitsForZone, normalizeZone, isAvailable, isCritical,
  ZONE_LIMITS, REGULATIONS, CRITICAL_RESTRICTIONS, PROVIDER,
};
