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
const kma = require('../connectors/kma');
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
    templateId: { type: 'string', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['facts', 'sources'],
  properties: {
    facts: { type: 'array' },
    sources: { type: 'array' },
    flags: { type: 'array' },
    geo: { type: 'object', nullable: true },
    parcel: { type: 'object', nullable: true },
    landUse: { type: 'object', nullable: true },
    building: { type: 'object', nullable: true },
    permit: { type: 'object', nullable: true },
    quota: { type: 'object' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

/** 공부 날짜(YYYYMMDD)를 사람이 읽는 형식으로. 형식이 아니면 버린다 */
function dateOf(v) {
  const s = String(v ?? '').replace(/\D/g, '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null;
}

async function run(input, ctx) {
  const ds = ctx.dataset;
  const today = kstDate();
  const facts = [];
  const sources = [];
  const flags = [];
  const out = { geo: null, parcel: null, landUse: null, building: null };

  const addrFact = ds && ds.get('project.location');
  const address = input.address || (addrFact ? String(addrFact.value) : null);

  if (!address) {
    ctx.warn('소재지가 확인되지 않아 위성지도·지적 조회를 생략한다');
    return { facts, sources, flags, ...out, quota: cache.stats(), confidence: 0 };
  }
  if (!vworld.isAvailable()) {
    ctx.warn('VWORLD_KEY 미설정 — 위성지도·지적·공시지가 조회 전체 생략');
    return { facts, sources, flags, ...out, quota: cache.stats(), confidence: 0 };
  }

  // ── ① 지오코딩 ──────────────────────────────────────────
  const geo = await vworld.geocode(address);
  if (!geo.ok) {
    ctx.warn(`지오코딩 실패: ${geo.error}`);
    return { facts, sources, flags, ...out, quota: cache.stats(), confidence: 0 };
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
    // 지번도 같은 응답에 들어 있다 — IM 물건개요가 쓰는 값이라 등록해 둔다
    if (parcel.value.jibun) {
      facts.push({ key: 'land.jibun', value: String(parcel.value.jibun), unit: null, confidence: 0.9, ...src('VWorld 연속지적도') });
    }

    // ★ 공부상 면적을 land.area_sqm 으로 등록 → 문서값과 교차검증된다
    if (parcel.value.officialAreaSqm) {
      facts.push({
        key: 'land.area_sqm', value: parcel.value.officialAreaSqm, unit: '㎡',
        confidence: 0.95, quote: `지적 공부상 면적 ${parcel.value.officialAreaSqm}㎡`,
        ...src('지적공부(VWorld)'),
      });
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

      // ★ 대표 용도지역 하나만 싣던 것을 고친다. 조회는 지역·지구를 전부
      //   받아 오는데(표본 19건) 나머지를 버리면 토지거래허가·고도제한 같은
      //   딜 조건이 IM 에서 통째로 사라진다.
      const districts = [...new Set(landUse.value.allZones || [])];
      if (districts.length) {
        facts.push({
          key: 'land.use_districts', value: districts.join(', '), unit: null,
          confidence: 0.9, quote: `지역·지구 ${districts.length}건`,
          ...src('토지이용계획(VWorld)'),
        });
      }

      // 그중 딜 조건이 되는 것은 승인 게이트까지 올린다 (분류표: nsdi.REGULATIONS)
      for (const r of nsdi.classifyZones(districts)) {
        flags.push({
          severity: r.severity, type: 'LAND_USE_REGULATION',
          message: `${r.zone} — ${r.why}`,
          keys: ['land.use_districts'],
        });
      }

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

      // ★ 규제 사항 (C-05) — 같은 응답에 이미 들어 있던 것을 지금까지 버리고 있었다.
      //   개발제한구역에 걸린 땅과 아닌 땅이 '자연녹지지역' 하나로 똑같이 보였다
      const rst = landUse.value.restrictions || [];
      if (rst.length) {
        facts.push({
          key: 'land.use_districts', value: rst.join(' · '), unit: null,
          confidence: 0.9, quote: rst.join(' · '),
          ...src('토지이용계획(VWorld)'),
        });
      }
      // 사업 가능 여부 자체를 좌우하는 규제는 조용히 값으로만 두지 않는다
      const critical = landUse.value.critical || [];
      if (critical.length) {
        ctx.warn(`중대 규제: ${critical.join(' · ')} — 용적률 검토보다 먼저 사업 가능 여부를 확인해야 한다`);
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

      // ★ 여기까지는 원래 등록하던 것이고, 아래는 **같은 응답에 이미 실려 오는데
      //   버리고 있던 값**이다. 새로 부르는 호출이 하나도 없다 — 쿼터도 안 는다.
      //   ★ 건폐율·용적률은 **실적치**다. 법정 상한(land.*_limit)과 다른 항목에
      //     둔다 — 한 칸에 섞으면 지어도 되는 한도인지 이미 지은 결과인지 모른다
      push('building.bcr', reg.value.bcRatio, '%');
      push('building.far', reg.value.vlRatio, '%');
      push('building.basement_floors', reg.value.basementFloors, '층');
      push('building.main_use', reg.value.mainUse, null);
      push('building.approval_date', dateOf(reg.value.approvalDate), null);
    } else if (!reg.unavailable && !/자료 없음/.test(reg.error || '')) {
      ctx.warn(`건축물대장 조회 실패: ${reg.error}`);
    }

    // ── ⑥ 토지특성 — 대지면적 폴백 ─────────────────────────
    // 연속지적도에는 면적 필드가 없고, 나대지는 건축물대장도 없다.
    // 그 경우 공부상 면적의 출처가 여기뿐이다. 개발사업 부지는 대개 나대지다.
    // ★ 이미 채워졌으면 부르지 않는다 — 호출 수를 늘리지 않는다 (CLAUDE.md §4).
    if (!facts.some(f => f.key === 'land.area_sqm')) {
      const chr = await nsdi.landCharacteristics(parsedPnu.pnu);
      if (chr.ok) {
        out.landCharacteristics = chr.value;
        sources.push({ name: 'VWorld 토지특성', cached: !!chr.cached });
        facts.push({
          key: 'land.area_sqm', value: chr.value.areaSqm, unit: '㎡',
          confidence: 0.95,
          quote: `토지특성 공부상 면적 ${chr.value.areaSqm}㎡ (${chr.value.year}년 기준)`,
          ...src('토지특성(VWorld)'),
        });
        // 지목은 out.landCharacteristics 에만 남긴다 — 이 경로에서만 나오므로
        // 사실(fact)로 올리면 "있을 때만 있는 항목"이 되어 화면이 거짓말한다.
      } else if (!chr.unavailable) {
        ctx.warn(`토지특성 조회 실패: ${chr.error} — 대지면적은 직접 입력해야 한다`);
      }
    }
  }

  // ── ⑥ 일사량 (태양광 딜에서만) ──────────────────────────
  // ★ 태양광이 아닌 딜에서는 부르지 않는다. 부동산 IM 에 일사량은 쓰이지
  //   않는데 호출만 1회 늘어난다 (CLAUDE.md §4).
  // ★ 여기서 내는 것은 **일사량까지**다. 발전량은 시스템효율(PR) 가정이
  //   들어가므로 사람이 넣는다 (2026-08-15 결정, 등록부 D-25).
  if (input.templateId === 'solar' && kma.isAvailable() && out.geo) {
    await addSolar(out.geo, facts, sources, src, ctx, out);
  }

  // ── 교차검증: 지적도 폴리곤 실측 vs 공부상 면적 ────────────
  // ★ 전에는 연속지적도 응답 안에서만 비교했는데 그 응답에는 면적이 없어
  //   **한 번도 동작하지 않았다.** 면적 출처가 확정된 뒤로 옮긴다.
  //   공부상 면적과 실측이 크게 어긋나면 필지가 잘못 잡혔다는 신호다.
  const areaFact = facts.find(f => f.key === 'land.area_sqm');
  if (areaFact && out.parcel && out.parcel.polygonAreaSqm) {
    const official = areaFact.value;
    const diff = Math.abs(out.parcel.polygonAreaSqm - official) / official;
    if (diff > 0.05) {
      ctx.warn(`지적도 폴리곤 실측(${round(out.parcel.polygonAreaSqm, 0)}㎡)과 `
        + `공부상 면적(${official}㎡, ${areaFact.source}) 차이 ${round(diff * 100, 1)}% `
        + '— 필지 특정이 잘못됐을 수 있다');
    }
  }

  // ── ⑦ 지도 이미지 (기본 비활성 — 쿼터 절약) ──────────────
  if (process.env.IM_AGENT_FETCH_IMAGES === '1' && out.geo) {
    const saved = await saveSatelliteImage(input.projectId, out.geo.lat, out.geo.lon, ctx);
    if (saved) out.geo.satelliteImage = saved;
  } else if (out.geo) {
    out.geo.satelliteImageHint = 'IM_AGENT_FETCH_IMAGES=1 로 실행하면 위성영상을 내려받는다';
  }

  const confidence = out.parcel ? (out.landUse ? 0.9 : 0.75) : 0.5;
  return { facts, sources, flags, ...out, quota: cache.stats(), confidence };
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
 * 일사량 조회 — 좌표에서 가장 가까운 기상청 관측지점의 최근 완결 연도 통계.
 *
 * ★ **어느 관측소의 값인지, 부지에서 몇 km 인지를 출처에 적는다.** 80km 떨어진
 *   관측소 값을 "이 부지의 일사량"으로 적으면 그것도 근거 없는 숫자다.
 * ★ 결측일이 많은 해는 합계가 조용히 작아진다 → 커버리지가 낮으면 경고한다.
 */
async function addSolar(geo, facts, sources, src, ctx, out) {
  const near = await kma.nearestStation(geo.lat, geo.lon);
  if (!near.ok) {
    ctx.warn(`일사량 조회 생략: ${near.error}`);
    return;
  }

  // 올해는 아직 안 끝났으므로 **직전 연도**를 쓴다. 진행 중인 해를 합치면
  // 연간 일사량이 실제의 절반으로 나온다.
  const year = Number(kstDate().slice(0, 4)) - 1;
  const solar = await kma.annualSolar(near.value.stn, year);
  if (!solar.ok) {
    ctx.warn(`일사량 조회 실패(${near.value.stn} 지점): ${solar.error}`);
    return;
  }

  const s = solar.value;
  if (s.coverage < 90) {
    ctx.warn(`${year}년 ${near.value.stn} 지점 일사량 결측 ${s.missingDays}일 `
      + `(관측률 ${s.coverage}%) — 연간 합계가 실제보다 작다`);
  }

  out.solar = { ...s, station: near.value };
  sources.push({ name: '기상청 지상관측 일통계', cached: !!solar.cached });

  // 거리를 모르면 모른다고 적는다. 사람이 지점을 직접 지정한 경우가 그렇다.
  const where = near.value.distanceKm === null
    ? '거리 미상 — 지점 직접 지정'
    : `부지에서 ${near.value.distanceKm}km`;
  const origin = `기상청 지상관측 일통계(${near.value.name || near.value.stn} 지점, ${where}, ${year}년)`;

  if (near.forced) {
    ctx.warn(`일사량 관측지점을 KMA_STN=${near.value.stn} 로 직접 지정했다 — `
      + '부지와의 거리가 확인되지 않는다. 지점정보 API 승인 후 자동 선택으로 돌아간다');
  }

  facts.push({
    key: 'site.solar_irradiance', value: s.irradianceKwh, unit: 'kWh/㎡·년',
    confidence: 0.9,
    quote: `${year}년 일사량 합계 ${s.irradianceMJ}MJ/㎡ (일평균 ${s.dailyAvgKwh}kWh/㎡, 관측 ${s.observedDays}일)`,
    ...src(origin),
  });
  facts.push({
    key: 'site.sunshine_hours', value: s.sunshineHours, unit: 'hr',
    confidence: 0.9, ...src(origin),
  });
}

/**
 * 이 Agent 가 **소재지만 있으면** 공공데이터로 채우는 key.
 * ★ 사람에게 물어보지 않아도 되는 항목이다 — 물어보면 공부(公簿)와 다른 값을
 *   손으로 적게 되고, 그 순간 독립된 두 번째 출처라는 가치가 사라진다.
 *
 * ★ 여기 적는 것은 **이 파일이 실제로 facts.push 하는 key 뿐이다.**
 *   다른 Agent 가 채우는 것을 적어 두면 화면은 "07 이 채운다"고 믿고, 07 만
 *   돌렸을 때 조용히 빈칸이 남는다. 개별공시지가는 08 Appraisal 이 채운다.
 *   (`fieldplan.test.js` 가 FILLS 와 실제 push 를 대조한다)
 */
// ★ `land.use_districts` 는 `land.zoning` 과 **같은 조회·같은 조건**에서 채워진다.
//   따라서 zoning 을 선언하면서 이것만 빼면 그것도 거짓말이 된다.
//
// ★ 지목(`land.category`)은 여기 없다. 토지특성 폴백 경로에서만 채워지고,
//   그 경로는 건축물대장이 면적을 채우면 아예 호출되지 않는다. "공공데이터가
//   채운다"고 적어 두면 건물이 있는 필지에서 조용히 빈칸이 남는다.
const FILLS = ['geo.pnu', 'geo.lat', 'geo.lon', 'land.jibun',
  'land.area_sqm', 'land.zoning', 'land.use_districts', 'land.far_limit', 'land.bcr_limit'];

/**
 * **조건이 붙는** 채움 — 건축물대장은 **건물이 이미 있을 때만** 존재한다.
 *
 * ★ 이걸 FILLS 로 옮기면 안 된다. 개발사업은 대개 나대지에서 시작하고, 그때는
 *   대장이 없어 이 값들이 안 들어온다. FILLS 에 넣는 순간 화면은 "자동으로
 *   채워집니다"라며 **연면적을 안 물어보고**, 값은 빈 채로 남는다 (B-18 과
 *   똑같은 실패다).
 *
 * ★ 그렇다고 선언 없이 두면 "왜 여기서 연면적이 나오지" 를 아무도 모른다.
 *   그래서 목록은 남기되 화면 계획(fieldplan)에는 넣지 않는다.
 *   `fieldplan.test.js` 가 (실제 push − FILLS) ⊆ CONDITIONAL_FILLS 를 검사한다.
 */
const CONDITIONAL_FILLS = {
  '건축물대장(기존 건물이 있는 경우에만)':
    ['building.gfa_sqm', 'building.footprint_sqm', 'building.floors', 'building.height_m'],

  // ★ 인허가는 여기서 **채우지 않는다.** 한 필지에 인허가가 여러 건 쌓이고
  //   (표본 11건) 과거 건물 이력이 섞여서 "최신 건 = 이 딜의 인허가" 라고
  //   단정할 수 없다. 개발 예정지는 아직 인허가가 없는 것이 정상이고, 그때
  //   공부에는 옛 건물 허가만 남아 있다 — 그걸 집어 채우면 없는 인허가를
  //   있다고 적는 셈이다. 그래서 **05 Validation 이 대조만 한다.**

  // 건축물대장 응답에 이미 실려 오던 것 — 새 호출 없이 등록만 한다
  '건축물대장의 나머지 제원(기존 건물이 있는 경우에만)':
    ['building.bcr', 'building.far', 'building.basement_floors',
      'building.main_use', 'building.approval_date'],

  // ★ 일사량·일조시간은 **태양광 딜에서만** 부른다. FILLS 로 올리면 부동산 딜
  //   화면이 "자동으로 채워집니다"라고 해 놓고 조용히 빈칸이 남는다.
  //   그리고 여기서 내는 것은 일사량까지다 — 발전량은 시스템효율(PR) 가정이
  //   들어가므로 사람이 넣는다 (2026-08-15 결정).
  '기상청 일사량(태양광 딜에서만)': ['site.solar_irradiance', 'site.sunshine_hours'],

  // ★ 지목은 **토지특성 폴백 경로에서만** 나온다. 건축물대장이 면적을 채우면
  //   그 경로는 아예 호출되지 않는다.
  '토지특성(대지면적을 다른 곳에서 못 채웠을 때만)': ['land.category'],
};

module.exports = {
  id: '07_geo', label: 'Geo / Satellite Agent',
  inputSchema, outputSchema, run, FILLS, CONDITIONAL_FILLS,
};
