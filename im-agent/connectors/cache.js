'use strict';
/**
 * cache.js — 공공데이터 응답 캐시 + 일일 호출 쿼터.
 *
 * CLAUDE.md 규칙:
 *   "data.go.kr 계열은 일 10,000건 호출 한도 → 호출 수를 최소화하고 결과를 캐시한다.
 *    동일 데이터 재호출 금지."
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

/** TTL 기본값(초) — 데이터 성격별로 다르게 준다 */
const TTL = {
  geocode: 180 * 86400,   // 주소→좌표: 사실상 불변
  parcel: 180 * 86400,    // 지적/필지: 거의 불변
  landuse: 30 * 86400,    // 용도지역/용적률: 조례 개정 시에만 변경
  landprice: 30 * 86400,  // 개별공시지가: 연 1회 고시
  building: 30 * 86400,   // 건축물대장
  trade: 7 * 86400,       // 실거래가: 월 단위 갱신
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

function limitFor(provider) {
  const envKey = `IM_AGENT_QUOTA_${provider.toUpperCase()}`;
  const v = Number(process.env[envKey] || process.env.IM_AGENT_QUOTA || DEFAULT_QUOTA);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_QUOTA;
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
    return { allowed: false, reason: `${provider} 일일 호출 한도 소진 (${current}/${limit}, KST ${kstDate()})`, used: current, limit };
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

  if (!result.ok) return { ok: false, error: result.error, cached: false };

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
