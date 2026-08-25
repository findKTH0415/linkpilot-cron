'use strict';
/**
 * cache.js — 공공데이터 응답 캐시 + 일일 호출 쿼터.
 *
 * CLAUDE.md 규칙:
 *   "data.go.kr 계열은 호출 한도가 있다 → 호출 수를 최소화하고 결과를 캐시한다.
 *    동일 데이터 재호출 금지."
 *
 * ★ 한도는 **기관 묶음이 아니라 그 안의 갈래마다** 센다 (아래 `FAMILY_QUOTA`).
 *
 * 이 모듈이 그 규칙을 강제한다. Connector는 반드시 이곳을 통과해야 한다.
 *  - 캐시 히트면 네트워크를 타지 않고 쿼터도 소모하지 않는다.
 *  - 쿼터 소진 시 호출 자체를 거부한다 (조용히 실패하지 않고 사유를 남긴다).
 *  - 쿼터 카운터는 KST 날짜 기준으로 리셋된다 (UTC 자정이 아니다).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { kstDate, kstStamp } = require('../core/kst');

const DEFAULT_QUOTA = 10000;

/**
 * ★★★ **한도는 기관 묶음이 아니라 그 안의 갈래마다 센다** 〈2026-08-23 결정 · D-85〉.
 *
 *   data.go.kr 은 **상세기능(오퍼레이션) 하나마다** 하루치를 센다. 개발계정은
 *   대개 **1,000건**이다. 그런데 앞 판은 `data.go.kr` 을 **한 통**으로 두고
 *   10,000 을 재고 있었다 — 그 통을 쓰는 커넥터가 **아홉**이다(실거래가·조달청·
 *   REC·법인·공장등록·수출입·환경·국민연금·국세).
 *
 *   ★ 나쁜 것은 숫자가 큰 것이 아니라 **계량기가 거짓말을 하는 것**이다.
 *     우리가 「3,000 썼다, 여유 있다」고 말하는 동안 상대는 이미 1,000 에서
 *     끊는다. 그러면 증상은 「조회 실패」로만 뜨고 **한도 때문인지 아닌지가
 *     화면에서 구분되지 않는다.**
 *
 *   ★ 그래서 통을 `data.go.kr:g2b` 처럼 **갈래로 나눈다.** 한 곳이 다 써도 다른
 *     곳은 그대로 돈다. 진짜 단위는 오퍼레이션마다이므로 이것도 정확하지는
 *     않지만 **우리 쪽이 더 보수적**이다 — 안전한 방향의 오차다.
 *
 *   ★ 운영계정으로 올리면 한도가 커진다. 그때는 `IM_AGENT_QUOTA_DATA_GO_KR_G2B`
 *     처럼 환경변수로 올린다 — 코드는 안 건드린다.
 */
const FAMILY_QUOTA = {
  'data.go.kr': 1000,   // 개발계정 기준. 운영계정이면 환경변수로 올린다
};

/** 통 이름의 앞부분(기관). `data.go.kr:g2b` → `data.go.kr` */
function familyOf(provider) {
  return String(provider).split(':')[0];
}

/**
 * 환경변수 이름으로 쓸 수 있게 다듬는다.
 * ★ `.` `:` 는 환경변수 이름에 못 쓴다. 앞 판은 `provider.toUpperCase()` 를 그대로
 *   붙여 `IM_AGENT_QUOTA_DATA.GO.KR` 을 찾고 있었다 — **셸에서 만들 수 없는 이름**이라
 *   그 덮어쓰기는 한 번도 동작한 적이 없다.
 */
function envName(provider) {
  return String(provider).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

/** TTL 기본값(초) — 데이터 성격별로 다르게 준다 */
const TTL = {
  geocode: 180 * 86400,   // 주소→좌표: 사실상 불변
  parcel: 180 * 86400,    // 지적/필지: 거의 불변
  landuse: 30 * 86400,    // 용도지역/용적률: 조례 개정 시에만 변경
  landprice: 30 * 86400,  // 개별공시지가: 연 1회 고시
  building: 30 * 86400,   // 건축물대장
  permit: 30 * 86400,     // 건축인허가: 단계가 넘어갈 때만 바뀐다
  trade: 7 * 86400,       // 실거래가: 월 단위 갱신
  rate: 1 * 86400,        // 시장금리: 영업일마다 바뀐다 — 하루만 붙든다
  ppi: 7 * 86400,         // 생산자물가지수: 월 1회 공표 (잠정치가 다음 달 확정으로 바뀐다)
  'ppi-items': 180 * 86400, // 업종 목록: 분류 개정 때만 바뀐다 — 무거운 조회라 오래 붙든다
  // ★ **짧게 잡는다.** 계통 여유는 접속 신청이 들어오면 줄어든다 — 오래 붙들면
  //   이미 찬 선로를 「여유 있음」으로 보고 판단한다 (등록부 D-54)
  grid: 1 * 86400,        // 분산전원 연계 여유용량: 시점 스냅샷이다
  // ★ **짧게 잡는다.** 휴업·폐업은 하루 사이에 바뀌고, 그 값이 딜브레이커다.
  //   국세청도 30분 주기로 갱신한다 — 일주일 묵은 「계속사업자」는 근거가 아니다
  bizstatus: 1 * 86400,     // 사업자등록 상태 (등록부 D-60)
  bizvalidate: 30 * 86400,  // 진위확인: 개업일·상호는 거의 안 바뀐다
  npsworkplace: 30 * 86400, // 국민연금 사업장 검색(색인 성격)
  npsdetail: 7 * 86400,     // 가입자 수·고지금액: 월 단위로 바뀐다
  // ★ **색인은 오래 붙든다** — CLAUDE.md §4.5 가 「목록·색인처럼 큰 조회는 TTL 을
  //   길게 잡는다 (지역 색인 180일)」라고 적어 두었는데 **아래 넷이 목록에 없어
  //   기본 7일로 떨어지고 있었다** (2026-08-16 교차검증에서 발견 — 사양과 코드가
  //   갈린 자리다). 색인은 개정 때만 바뀌고 조회가 무겁다
  landindex: 180 * 86400,    // 한국부동산원 지가지수 통계표 목록
  regionindex: 180 * 86400,  // 지역 색인 (§4.5 가 명시한 바로 그것)
  'kosis-tables': 180 * 86400, // KOSIS 통계표 검색
  'kosis-meta': 180 * 86400,   // KOSIS 항목·분류 메타
  corpcode: 30 * 86400,   // DART 법인코드 전체 목록: 무겁다 — 한 번 받아 오래 쓴다
  company: 30 * 86400,    // DART 기업개황
  default: 7 * 86400,
};

function cacheRoot() {
  return process.env.IM_AGENT_CACHE || path.join(process.env.IM_AGENT_ROOT || path.join(process.cwd(), 'im-projects'), '.cache');
}

function keyFor(namespace, params) {
  const canonical = JSON.stringify(params, Object.keys(params).sort());
  const hash = crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 16);
  return `${namespace}-${hash}`;
}

function pathFor(namespace, params) {
  return path.join(cacheRoot(), namespace, `${keyFor(namespace, params)}.json`);
}

/** @returns {{hit:boolean, value?:any, age?:number}} */
function read(namespace, params, ttlSeconds) {
  const file = pathFor(namespace, params);
  if (!fs.existsSync(file)) return { hit: false };
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ttl = ttlSeconds ?? TTL[namespace] ?? TTL.default;
    const ageSec = (Date.now() - entry.storedAtMs) / 1000;
    if (ageSec > ttl) return { hit: false, expired: true, age: ageSec };
    return { hit: true, value: entry.value, age: ageSec };
  } catch (_) {
    return { hit: false };
  }
}

function write(namespace, params, value) {
  const file = pathFor(namespace, params);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    storedAt: kstStamp(), storedAtMs: Date.now(), namespace, value,
  }, null, 2), 'utf8');
  return file;
}

// ── 일일 쿼터 (KST 기준) ──────────────────────────────────────

function quotaFile() {
  return path.join(cacheRoot(), 'quota.json');
}

function readQuota() {
  const today = kstDate();
  try {
    const q = JSON.parse(fs.readFileSync(quotaFile(), 'utf8'));
    if (q.date === today) return q;
  } catch (_) { /* 최초 실행 */ }
  return { date: today, counts: {} };
}

/**
 * 이 통의 하루 한도.
 * 고르는 차례: **갈래 지정 > 기관 지정 > 전체 지정 > 기관 기본값 > 전체 기본값**.
 * 좁은 것이 넓은 것을 이긴다 — 안 그러면 한 곳만 올리려다 전부 올라간다.
 */
function limitFor(provider) {
  const fam = familyOf(provider);
  const pick = [
    process.env[`IM_AGENT_QUOTA_${envName(provider)}`],
    fam !== provider ? process.env[`IM_AGENT_QUOTA_${envName(fam)}`] : null,
    process.env.IM_AGENT_QUOTA,
  ].filter((x) => x !== null && x !== undefined && String(x).trim() !== '')[0];

  if (pick !== undefined) {
    const v = Number(pick);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return FAMILY_QUOTA[fam] || DEFAULT_QUOTA;
}

function used(provider) {
  return readQuota().counts[provider] || 0;
}

function remaining(provider) {
  return Math.max(0, limitFor(provider) - used(provider));
}

/** @returns {{allowed:boolean, reason?:string, used:number, limit:number}} */
function checkQuota(provider, need = 1) {
  const limit = limitFor(provider);
  const current = used(provider);
  if (current + need > limit) {
    /* ★ **어느 통이 막혔는지**를 적는다. 「data.go.kr 한도 소진」만 적으면 아홉 중
       어느 것을 아껴야 하는지 알 수 없다. 올리는 법도 함께 적는다 (§4.7) */
    return {
      allowed: false,
      reason: `${provider} 일일 호출 한도 소진 (${current}/${limit}, KST ${kstDate()}). `
        + `한도를 올리려면 IM_AGENT_QUOTA_${envName(provider)} 를 준다`,
      used: current, limit,
    };
  }
  return { allowed: true, used: current, limit };
}

function consume(provider, n = 1) {
  const q = readQuota();
  q.counts[provider] = (q.counts[provider] || 0) + n;
  q.updatedAt = kstStamp();
  fs.mkdirSync(path.dirname(quotaFile()), { recursive: true });
  fs.writeFileSync(quotaFile(), JSON.stringify(q, null, 2), 'utf8');
  return q.counts[provider];
}

/**
 * 캐시 우선 조회 → 미스면 fetcher 실행 (쿼터 검사 후).
 * @param {string} provider 쿼터 단위 ('data.go.kr' | 'vworld')
 * @param {string} namespace 캐시 네임스페이스 (TTL 결정)
 * @param {object} params 캐시 키
 * @param {() => Promise<{ok:boolean, value?:any, error?:string}>} fetcher
 */
async function through(provider, namespace, params, fetcher, { ttl = null, force = false } = {}) {
  if (!force) {
    const cached = read(namespace, params, ttl);
    if (cached.hit) {
      return { ok: true, value: cached.value, cached: true, ageSeconds: Math.round(cached.age) };
    }
  }

  const q = checkQuota(provider);
  if (!q.allowed) return { ok: false, error: q.reason, cached: false, quotaExhausted: true };

  const result = await fetcher();
  consume(provider);

  // ★ 실패 응답을 **그대로 흘려보낸다.** 예전에는 `{ok, error}` 만 골라 담았는데,
  //   커넥터가 붙여 둔 구분 플래그(`notFound`·`noData`·`unavailable` 등)가 거기서
  //   사라졌다. 「조회가 실패했다」와 「찾았는데 없다」는 다음에 할 일이 정반대인데
  //   부르는 쪽에서는 둘이 같아 보인다 (2026-08-16 Pexels 붙이다 발견).
  if (!result.ok) return { ...result, cached: false };

  write(namespace, params, result.value);
  return { ok: true, value: result.value, cached: false };
}

function stats() {
  const q = readQuota();
  return {
    date: q.date,
    counts: q.counts,
    limits: Object.fromEntries(Object.keys(q.counts).map(p => [p, limitFor(p)])),
    cacheRoot: cacheRoot(),
  };
}

module.exports = { through, read, write, checkQuota, consume, used, remaining, limitFor, stats, keyFor, cacheRoot, TTL };
