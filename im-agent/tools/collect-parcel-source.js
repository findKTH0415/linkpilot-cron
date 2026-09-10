#!/usr/bin/env node
'use strict';

/**
 * collect-parcel-source.js — 한 필지의 투자검토 원자료를 GitHub Actions에서 수집한다.
 *
 * 이 도구는 열쇠가 있는 Actions에서만 외부 API를 부른다. 각 HTTP 응답은 개인식별자와
 * 인증값을 가린 뒤 raw/*.json에 전문을 남기고, 분석에 쓰는 정규화 값은 normalized.json,
 * 사람이 먼저 읽을 결과는 _summary.md에 남긴다.
 *
 * 실행 예:
 *   node im-agent/tools/collect-parcel-source.js \
 *     --address "충청남도 부여군 외산면 만수리 25-12" \
 *     --region "부여군" \
 *     --out data/parcel/buyeo-mansu-25-12
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function arg(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].trim() : fallback;
}

const ADDRESS = arg('--address');
const REGION = arg('--region');
const OUT = path.resolve(arg('--out', 'data/parcel/latest'));
const DATA_ROOT = path.resolve('data') + path.sep;

if (!ADDRESS) {
  console.error('주소가 없습니다. --address 뒤에 지번 주소를 적어야 합니다.');
  process.exit(2);
}
if (!OUT.startsWith(DATA_ROOT)) {
  console.error('출력 폴더는 저장소의 data/ 아래여야 합니다.');
  process.exit(2);
}

const RAW_DIR = path.join(OUT, 'raw');
fs.mkdirSync(RAW_DIR, { recursive: true });

// 같은 워크플로를 다시 돌려도 반드시 새 응답을 받는다. 운영 캐시와 섞지 않는다.
process.env.IM_AGENT_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-parcel-source-'));

// .env와 마스킹 목록을 먼저 올린 뒤 커넥터를 읽는다.
require('../core/env').load();
const { redact } = require('../connectors/http');

const nativeFetch = global.fetch.bind(global);
let rawSequence = 0;
const rawManifest = [];

function countMatches(text, regex) {
  return (String(text).match(regex) || []).length;
}

/** 공개 저장소·아티팩트에 남기면 안 되는 개인식별자를 원문에서 가린다. */
function sanitizeBody(input) {
  let text = redact(String(input));
  const counts = {
    email: countMatches(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
    phone: countMatches(text, /\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b/g),
    residentId: countMatches(text, /\b\d{6}-?[1-4]\d{6}\b/g),
    namedField: 0,
  };
  text = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]')
    .replace(/\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b/g, '[PHONE_REDACTED]')
    .replace(/\b\d{6}-?[1-4]\d{6}\b/g, '[RESIDENT_ID_REDACTED]');

  const fields = [
    '소유자', '건축주', '대표자', '성명', '전화번호', '이메일',
    'ownerNm', 'ownrNm', 'archNm', 'reprNm', 'rprNm', 'enpRprFnm', 'telNo', 'email',
  ];
  for (const field of fields) {
    const json = new RegExp(`("${field}"\\s*:\\s*")([^"]*)(")`, 'gi');
    const xml = new RegExp(`(<${field}>)([^<]*)(<\\/${field}>)`, 'gi');
    counts.namedField += countMatches(text, json) + countMatches(text, xml);
    text = text.replace(json, '$1[PERSON_REDACTED]$3').replace(xml, '$1[PERSON_REDACTED]$3');
  }
  return { text, counts };
}

function safePart(value) {
  return String(value || 'response')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'response';
}

function writeRawRecord(url, init, response, buffer, error = null) {
  const safeUrl = redact(String(url));
  const parsed = new URL(safeUrl);
  const requestId = crypto.createHash('sha256')
    .update(`${init?.method || 'GET'} ${safeUrl}`)
    .digest('hex').slice(0, 12);
  const seq = String(++rawSequence).padStart(3, '0');
  const file = `${seq}-${safePart(parsed.hostname)}-${safePart(parsed.pathname)}-${requestId}.json`;
  const target = path.join(RAW_DIR, file);
  const contentType = response?.headers?.get('content-type') || '';
  const isText = !buffer || /json|xml|text|csv|javascript|html/i.test(contentType)
    || !buffer.subarray(0, Math.min(buffer.length, 2048)).includes(0);
  const sanitized = isText && buffer ? sanitizeBody(buffer.toString('utf8')) : null;
  const record = {
    schemaVersion: 1,
    collectedAt: new Date().toISOString(),
    request: {
      method: init?.method || 'GET',
      url: safeUrl,
      // 요청 본문과 Authorization 헤더는 저장하지 않는다.
    },
    response: response ? {
      ok: response.ok,
      status: response.status,
      contentType,
      bodyEncoding: isText ? 'utf8-redacted' : 'base64',
      bodySha256: buffer ? crypto.createHash('sha256').update(buffer).digest('hex') : null,
      body: isText ? (sanitized?.text || '') : buffer.toString('base64'),
      redactions: sanitized?.counts || {},
    } : null,
    error: error ? redact(String(error.message || error)) : null,
  };
  fs.writeFileSync(target, JSON.stringify(record, null, 2), 'utf8');
  rawManifest.push({ file, url: safeUrl, status: response?.status || null, error: record.error });
}

/**
 * 모든 커넥터가 공통으로 쓰는 fetch 앞에서 응답 전문을 보존한다.
 * clone을 읽으므로 커넥터가 받는 원 응답은 바뀌지 않는다.
 */
global.fetch = async function archivedFetch(url, init = {}) {
  try {
    const response = await nativeFetch(url, init);
    const clone = response.clone();
    const buffer = Buffer.from(await clone.arrayBuffer());
    writeRawRecord(url, init, response, buffer);
    return response;
  } catch (error) {
    writeRawRecord(url, init, null, null, error);
    throw error;
  }
};

const geometry = require('../geo/geometry');
const kma = require('../connectors/kma');
const kepco = require('../connectors/kepco');
const kpx = require('../connectors/kpx');
const law = require('../connectors/law');
const molit = require('../connectors/molit');
const nsdi = require('../connectors/nsdi');
const pnuUtil = require('../connectors/pnu');
const reb = require('../connectors/reb');
const vworld = require('../connectors/vworld');

const collectedAt = new Date().toISOString();
const source = {
  schemaVersion: 1,
  address: ADDRESS,
  region: REGION || null,
  collectedAt,
  grade: 'B — GitHub Actions 공식 실행 아티팩트',
  sources: {},
};

function compact(result) {
  if (!result || typeof result !== 'object') return { ok: false, error: '응답 객체 없음' };
  const out = {
    ok: Boolean(result.ok),
    cached: Boolean(result.cached),
    unavailable: Boolean(result.unavailable),
    error: result.error || null,
  };
  if ('value' in result) out.value = result.value;
  if ('history' in result) out.history = result.history;
  if ('count' in result) out.count = result.count;
  if ('latest' in result) out.latest = result.latest;
  if ('errors' in result) out.errors = result.errors;
  return out;
}

async function collect(id, label, provider, fn) {
  const started = new Date().toISOString();
  let result;
  try {
    result = await fn();
  } catch (error) {
    result = { ok: false, error: redact(error.stack || error.message || String(error)) };
  }
  source.sources[id] = { label, provider, startedAt: started, ...compact(result) };
  console.log(`${result.ok ? '●' : '✕'} ${label}${result.error ? ` — ${result.error}` : ''}`);
  return result;
}

function median(values) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

function money(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString('ko-KR')}원` : '미확인';
}

function lineStatus(item) {
  if (!item) return '미실행';
  return item.ok ? '성공' : (item.unavailable ? '키 없음' : `확인 실패: ${item.error || '원인 미상'}`);
}

function buildSummary(derived) {
  const s = source.sources;
  const L = [];
  L.push('# 부여군 외산면 만수리 25-12 — API 원자료 수집 요약');
  L.push('');
  L.push(`**수집시각** ${new Date(collectedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST`);
  L.push(`**수집방식** GitHub Actions에서 공식 API 호출 · 응답 전문 ${rawManifest.length}건 보존`);
  L.push(`**대상주소** ${ADDRESS}`);
  L.push('');
  L.push('> raw 응답은 인증값·전화번호·이메일·주민번호·이름 필드를 가린 사본입니다.');
  L.push('> 조회가 안 된 항목은 “문제 없음”이 아니라 “미확인”입니다.');
  L.push('');
  L.push('## 핵심 원자료');
  L.push('');
  L.push(`- 좌표: ${derived.lat ?? '미확인'}, ${derived.lon ?? '미확인'}`);
  L.push(`- PNU: ${derived.pnu || '미확인'} · 지번: ${derived.jibun || '미확인'}`);
  L.push(`- 공부상 면적/지목: ${derived.areaSqm?.toLocaleString('ko-KR') || '미확인'}㎡ · ${derived.category || '미확인'}`);
  L.push(`- 지적 폴리곤 실측면적: ${derived.polygonAreaSqm?.toLocaleString('ko-KR') || '미확인'}㎡`);
  L.push(`- 최신 개별공시지가: ${derived.landPriceYear || '연도 미확인'} · ${money(derived.landPricePerSqm)}/㎡`);
  L.push(`- 공시지가 단순 합계(공부면적×공시지가): ${money(derived.officialLandValue)} · 시장가치가 아님`);
  L.push(`- 용도지역: ${derived.zone || '미확인'}`);
  L.push(`- 함께 조회된 규제: ${derived.restrictions?.length ? derived.restrictions.join(' · ') : '없음으로 확인된 것이 아님 — 원자료 확인 필요'}`);
  L.push(`- 만수리 토지 실거래: 최근 36개월 ${derived.tradeCount}건 · ㎡당 단가 중앙값 ${money(derived.tradeMedianPerSqm)}`);
  L.push(`- 일사량: ${derived.solarYears?.length ? derived.solarYears.map(x => `${x.year}년 ${x.irradianceKwh}kWh/㎡(관측 ${x.coverage}%)`).join(' · ') : '미확인'}`);
  L.push(`- REC 현물시장: ${derived.recWeightedAvg ? `최근 12개월 육지 거래량가중 평균 ${money(derived.recWeightedAvg)}/REC · ${derived.recSessions}회` : '미확인'}`);
  L.push(`- 계통 여유: ${derived.gridRows === null ? '미확인' : `${derived.gridRows}개 선로 응답`} · 변전소 거리는 공식 API 비공개`);
  L.push('');
  L.push('## 호출 결과');
  L.push('');
  L.push('| 항목 | 기관 | 결과 |');
  L.push('|---|---|---|');
  for (const item of Object.values(s)) L.push(`| ${item.label} | ${item.provider} | ${lineStatus(item).replace(/\|/g, '·')} |`);
  L.push('');
  L.push('## 이 자료만으로 확정할 수 없는 것');
  L.push('');
  L.push('- 발전량·매출·IRR: 설비용량(DC/AC), 시스템효율, 손실률, SMP·PPA 조건이 필요합니다.');
  L.push('- 개발행위 가능 여부: 부여군 태양광 이격거리 조문, 농지·산지전용, 환경·재해·문화유산 협의를 별도로 확인해야 합니다.');
  L.push('- 계통 접속 가능 여부: 공개 여유용량은 대기열과 접속승인을 포함하지 않습니다. 한전 사전검토 회신이 필요합니다.');
  L.push('- 담보·권리관계: 등기부, 토지대장, 지적도 원본과 현장경계 측량이 필요합니다.');
  L.push('');
  L.push('원자료 목록은 `raw/manifest.json`, 분석용 정규화 값은 `normalized.json`에 있습니다.');
  return L.join('\n') + '\n';
}

async function main() {
  const geocode = await collect('geocode', '주소→좌표', 'VWorld', () => vworld.geocode(ADDRESS));
  let parcel = { ok: false, error: '좌표 미확인으로 건너뜀' };
  let parsed = null;
  let polygonAreaSqm = null;

  if (geocode.ok) {
    parcel = await collect('parcel', '연속지적도·PNU', 'VWorld', () => vworld.parcelAt(geocode.value.lon, geocode.value.lat));
    if (parcel.ok) {
      parsed = pnuUtil.parse(parcel.value.pnu);
      polygonAreaSqm = parcel.value.polygon?.length >= 3
        ? Math.round(geometry.polygonAreaSqm(parcel.value.polygon)) : null;
      source.sources.parcel.derivedPolygonAreaSqm = polygonAreaSqm;
      await collect('nearbyParcels', '주변 30m 필지', 'VWorld', () => vworld.parcelsNear(parcel.value.polygon, 30));
    }
  } else {
    source.sources.parcel = { label: '연속지적도·PNU', provider: 'VWorld', ...compact(parcel) };
  }

  const skipped = (label, provider, why) => ({ label, provider, ok: false, error: why, skipped: true });
  let landChar = null;
  let landPrice = null;
  let landUse = null;
  let trades = null;
  let rec = null;
  let grid = null;
  const solarYears = [];

  if (parsed) {
    const [lc, lp, lu, br, bp, hp] = await Promise.all([
      collect('landCharacteristics', '토지특성·공부면적·지목', 'VWorld NED', () => nsdi.landCharacteristics(parsed.pnu)),
      collect('landPrice', '개별공시지가', 'VWorld NED', () => nsdi.landPrice(parsed.pnu)),
      collect('landUse', '토지이용계획·규제', 'VWorld NED', () => nsdi.landUse(parsed.pnu)),
      collect('buildingRegister', '건축물대장', '국토교통부', () => molit.buildingRegister(parsed)),
      collect('buildingPermits', '건축인허가 이력', '국토교통부', () => molit.buildingPermits(parsed)),
      collect('housingPermits', '주택인허가 이력', '국토교통부', () => molit.housingPermits(parsed)),
    ]);
    landChar = lc;
    landPrice = lp;
    landUse = lu;

    const months = pnuUtil.recentMonths(36);
    trades = await collect('landTrades', '최근 36개월 토지 실거래', '국토교통부', () => molit.trades(parsed.sigunguCd, months, 'land'));
    if (trades.ok) {
      const target = trades.value.filter(x => String(x.dong || '').includes('만수리'));
      source.sources.landTrades.months = months;
      source.sources.landTrades.regionCount = trades.value.length;
      source.sources.landTrades.targetCount = target.length;
      source.sources.landTrades.targetTransactions = target;
    }
  } else {
    source.sources.landCharacteristics = skipped('토지특성·공부면적·지목', 'VWorld NED', 'PNU 미확인');
    source.sources.landPrice = skipped('개별공시지가', 'VWorld NED', 'PNU 미확인');
    source.sources.landUse = skipped('토지이용계획·규제', 'VWorld NED', 'PNU 미확인');
    source.sources.buildingRegister = skipped('건축물대장', '국토교통부', 'PNU 미확인');
    source.sources.buildingPermits = skipped('건축인허가 이력', '국토교통부', 'PNU 미확인');
    source.sources.housingPermits = skipped('주택인허가 이력', '국토교통부', 'PNU 미확인');
    source.sources.landTrades = skipped('최근 36개월 토지 실거래', '국토교통부', 'PNU 미확인');
  }

  if (geocode.ok) {
    const station = await collect('solarStation', '최근 일사 관측소', '기상청 API허브', () => kma.nearestStation(geocode.value.lat, geocode.value.lon));
    if (station.ok) {
      const completeYear = new Date().getUTCFullYear() - 1;
      for (const year of [completeYear - 2, completeYear - 1, completeYear]) {
        const annual = await collect(`solar${year}`, `${year}년 일사량`, '기상청 API허브', () => kma.annualSolar(station.value.stn, year));
        if (annual.ok) solarYears.push({ ...annual.value, station: station.value });
      }
    }
  } else {
    source.sources.solarStation = skipped('최근 일사 관측소', '기상청 API허브', '좌표 미확인');
  }

  rec = await collect('rec', '최근 12개월 REC 현물시장', '전력거래소', () => kpx.recAverage({ months: 12, area: 'land' }));
  grid = await collect('grid', '부여군 분산전원 계통 여유', '한국전력', () => kepco.capacity({ region: REGION || '부여군' }));
  await collect('ordinanceSolar', '부여군 군계획 조례 후보', '국가법령정보센터', () => law.ordinance('충청남도 부여군', '군계획 조례'));
  await collect('ordinanceUrban', '부여군 도시계획 조례 후보', '국가법령정보센터', () => law.ordinance('충청남도 부여군', '도시계획 조례'));

  if (reb.isAvailable()) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const region = await collect('landIndexRegion', '지가지수 지역코드', '한국부동산원', () => reb.resolveRegion(ADDRESS, `${year}01`));
    if (region.ok) {
      await collect('landIndex', '공시지가 시점수정 지수', '한국부동산원', () => reb.timeAdjustment({
        clsId: region.value.clsId, from: `${year}01`, to: `${year}${month}`, expectRegion: region.value.full,
      }));
    }
  } else {
    source.sources.landIndexRegion = skipped('지가지수 지역코드', '한국부동산원', 'REB_API_KEY 미설정');
  }

  const targetTrades = source.sources.landTrades?.targetTransactions || [];
  const derived = {
    lat: geocode.ok ? geocode.value.lat : null,
    lon: geocode.ok ? geocode.value.lon : null,
    pnu: parsed?.pnu || null,
    jibun: parsed?.jibun || null,
    polygonAreaSqm,
    areaSqm: landChar?.ok ? landChar.value.areaSqm : null,
    category: landChar?.ok ? landChar.value.category : null,
    landPriceYear: landPrice?.ok ? landPrice.value.year : null,
    landPricePerSqm: landPrice?.ok ? landPrice.value.pricePerSqm : null,
    officialLandValue: landChar?.ok && landPrice?.ok
      ? landChar.value.areaSqm * landPrice.value.pricePerSqm : null,
    zone: landUse?.ok ? landUse.value.zone : null,
    restrictions: landUse?.ok ? landUse.value.restrictions : [],
    tradeCount: targetTrades.length,
    tradeMedianPerSqm: median(targetTrades.map(x => x.pricePerSqm)),
    solarYears: solarYears.map(x => ({ year: x.year, irradianceKwh: x.irradianceKwh, coverage: x.coverage })),
    recWeightedAvg: rec?.ok ? rec.value.weightedAvg : null,
    recSessions: rec?.ok ? rec.value.sessions : null,
    gridRows: grid?.ok ? grid.value.rows.length : null,
  };
  source.derived = derived;
  source.rawResponseCount = rawManifest.length;

  fs.writeFileSync(path.join(RAW_DIR, 'manifest.json'), JSON.stringify(rawManifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'normalized.json'), JSON.stringify(source, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, '_summary.md'), buildSummary(derived), 'utf8');

  // 실제 비밀값이 어디에도 남지 않았는지 마지막에 다시 센다.
  const files = fs.readdirSync(RAW_DIR).filter(x => x.endsWith('.json')).concat(['normalized.json', '_summary.md']);
  const secretHits = [];
  for (const file of files) {
    const target = ['normalized.json', '_summary.md'].includes(file) ? path.join(OUT, file) : path.join(RAW_DIR, file);
    const body = fs.readFileSync(target, 'utf8');
    for (const [name, value] of Object.entries(process.env)) {
      if (!/KEY|TOKEN|SECRET|PASSWORD|OC$/i.test(name)) continue;
      if (String(value || '').length >= 8 && body.includes(String(value))) secretHits.push({ file, name });
    }
  }
  if (secretHits.length) {
    console.error(`원자료에 인증값이 ${secretHits.length}건 남았습니다. 결과를 공개하지 않습니다.`);
    fs.rmSync(OUT, { recursive: true, force: true });
    process.exit(1);
  }

  console.log(`원자료 ${rawManifest.length}건 · ${path.relative(process.cwd(), OUT)}/_summary.md`);
  if (!parsed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(redact(error.stack || error.message || String(error)));
  process.exit(1);
});

