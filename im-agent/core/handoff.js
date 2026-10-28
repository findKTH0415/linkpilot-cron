'use strict';
/**
 * handoff.js — 고른 순간의 **접근권**을 잠깐 들고 있는 자리 (2026-08-20 · D-69②).
 *
 * ★★ 왜 필요한가: 「그때그때 고르기(chooser)」는 사용자가 파일을 고르는 **그 순간**
 *   짧게 사는 접근권을 준다. 그런데 보고서를 만드는 것은 그 다음이다. 그 사이를
 *   이어 줄 곳이 필요하다.
 *
 * ★★ **장부(`linked.json`)에 넣으면 안 된다.** `normalizeRef` 가 `accessToken`·
 *   `token`·`secret` 을 막고 테스트가 그것을 고정하고 있다. 이유는 분명하다 —
 *   장부는 오래 남고, **오래 남는 곳에 열쇠를 두지 않는다.**
 *
 * ★★ 그래서 여기는 **디스크에 아무것도 쓰지 않는다.** 프로세스 메모리에만 있고,
 *   시간이 지나면 스스로 지워지고, 서버가 내려가면 함께 사라진다. 그것이 맞다 —
 *   남아 있으면 안 되는 것이 남아 있는 편보다 **다시 고르게 하는 쪽**이 낫다.
 *
 * ★ 만료된 것과 **처음부터 없던 것**을 구분해서 돌려준다. 사용자가 볼 말이
 *   달라진다 — 만료면 「다시 골라 주세요」이고, 없으면 「연결이 안 되어 있습니다」다.
 *   둘을 뭉치면 사용자는 무엇을 해야 할지 모른다.
 *
 * ★ 값을 **로그에 찍지 않는다.** 주소 자체가 열쇠인 경우가 있다(제공자가 주는
 *   임시 내려받기 주소). `describe()` 만 밖으로 낸다.
 */

/** 기본 수명. 제공자가 주는 링크는 대개 한 시간~몇 시간인데, **그보다 짧게** 잡는다 */
const DEFAULT_TTL_MS = 30 * 60 * 1000;   // 30분

/** 한 프로젝트가 들고 있을 수 있는 최대 건수 — 새면 오래된 것부터 밀어낸다 */
const MAX_PER_PROJECT = 200;

/** projectId → Map(key → entry) */
const store = new Map();

function now() { return Date.now(); }

function bucket(projectId) {
  const id = String(projectId || '');
  if (!store.has(id)) store.set(id, new Map());
  return store.get(id);
}

/**
 * 접근권을 맡긴다.
 *
 * @param {string} projectId
 * @param {string} key        장부의 `refKey` 와 같은 값
 * @param {{url:string, headers?:object, expiresAt?:number}} access
 * @param {{ttlMs?:number}} [opts]
 */
function put(projectId, key, access, opts = {}) {
  if (!key) return { ok: false, reason: '어느 자료인지 알 수 없습니다' };
  const url = access && String(access.url || '');
  if (!url) return { ok: false, reason: '내려받을 주소가 없습니다' };
  // ★ http(s) 만 받는다. `file:` 같은 것이 들어오면 **서버의 파일을 읽게 된다**
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, reason: '접근 주소는 https 여야 합니다' };
  }

  const ttl = Number.isFinite(opts.ttlMs) ? opts.ttlMs : DEFAULT_TTL_MS;
  // 제공자가 만료를 알려 주면 **둘 중 이른 쪽**을 쓴다. 우리 것이 더 길면 의미가 없다
  const mine = now() + ttl;
  const theirs = Number.isFinite(access.expiresAt) ? access.expiresAt : null;
  const expiresAt = theirs ? Math.min(mine, theirs) : mine;

  const b = bucket(projectId);
  b.set(key, { url, headers: access.headers || null, expiresAt });

  // 오래된 것부터 밀어낸다 — 한 프로젝트가 메모리를 무한히 먹지 않게
  if (b.size > MAX_PER_PROJECT) {
    const oldest = [...b.entries()].sort((a, c) => a[1].expiresAt - c[1].expiresAt)[0];
    if (oldest) b.delete(oldest[0]);
  }
  return { ok: true, expiresAt };
}

/**
 * 맡긴 것을 꺼낸다.
 *
 * @returns {{ok:true, url, headers}|{ok:false, reason, expired:boolean}}
 */
function get(projectId, key) {
  const b = store.get(String(projectId || ''));
  const e = b && b.get(key);
  if (!e) {
    return { ok: false, expired: false, reason: '이 자료의 접근권이 없습니다 — 다시 연결해 주세요' };
  }
  if (e.expiresAt <= now()) {
    b.delete(key);
    return { ok: false, expired: true, reason: '접근 권한이 만료되었습니다 — 파일을 다시 골라 주세요' };
  }
  return { ok: true, url: e.url, headers: e.headers };
}

/** 하나를 지운다 (연결을 끊을 때) */
function drop(projectId, key) {
  const b = store.get(String(projectId || ''));
  return !!(b && b.delete(key));
}

/** 프로젝트 것을 통째로 지운다 */
function clear(projectId) {
  return store.delete(String(projectId || ''));
}

/** 만료된 것을 걷어낸다. 부르지 않아도 `get()` 이 그때그때 지운다 */
function sweep() {
  let n = 0;
  const t = now();
  store.forEach((b, id) => {
    b.forEach((e, k) => { if (e.expiresAt <= t) { b.delete(k); n += 1; } });
    if (!b.size) store.delete(id);
  });
  return n;
}

/**
 * 무엇을 들고 있는지 **주소 없이** 말한다.
 * ★ 주소 자체가 열쇠일 수 있으므로 절대 밖으로 내지 않는다.
 */
function describe(projectId) {
  const b = store.get(String(projectId || ''));
  if (!b) return { count: 0, items: [] };
  const t = now();
  return {
    count: b.size,
    items: [...b.entries()].map(([key, e]) => ({
      key,
      expiresInSec: Math.max(0, Math.round((e.expiresAt - t) / 1000)),
      expired: e.expiresAt <= t,
    })),
  };
}

module.exports = { put, get, drop, clear, sweep, describe, DEFAULT_TTL_MS, MAX_PER_PROJECT };
