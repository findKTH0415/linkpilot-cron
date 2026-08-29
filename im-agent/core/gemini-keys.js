'use strict';
/**
 * gemini-keys.js — Gemini 열쇠 여덟 개를 **하나의 문**으로 관리한다 (D-110).
 *
 * 〈2026-08-25 사장님 작업지시서 「Gemini 6-Key Manager」〉
 *
 * ★★★ **왜 만드나 — 「돌아가며 쓴다」가 아니다.**
 *   앞 판(`llm.js`)은 열쇠를 쉼표로 갈라 **배열 순회**만 했다. 그래서:
 *   - 429 를 맞은 열쇠를 **다음 요청에서 또 먼저** 집었다. 첫 열쇠가 죽으면
 *     모든 요청이 그 열쇠에서 한 번씩 죽고 시작한다.
 *   - 401 로 폐기된 열쇠를 **영원히 다시 집었다.** 고를 대상에서 빼는 곳이 없다.
 *   - 무엇이 몇 번 실패했는지 **아무 데도 안 남았다.** 그래서 「요즘 느리다」의
 *     원인을 열쇠에서 찾을 방법이 없었다.
 *
 * ★ 그래서 고르는 일을 **상태 기계**로 만든다. 고르기 전에 거르고, 쓰고 나서
 *   결과를 적고, 식은 뒤에 **다시 물어보고** 되살린다.
 *
 * ── 이 저장소의 사정에 맞춘 것 ──────────────────────────────
 *
 * 지시서는 DB 테이블 다섯과 Redis 를 말한다. **이 저장소에는 둘 다 없다** —
 * 엔진은 NAS 에서 **한 프로세스**로 돌고 자료는 파일로 둔다 (CLAUDE.md §5:
 * 새 라이브러리·스택 변경 금지). 그래서 같은 일을 이렇게 한다.
 *
 * | 지시서            | 여기서                                            |
 * |---|---|
 * | `gemini_keys` 표  | 메모리 + 파일 한 장(`.state/gemini-keys.json`)     |
 * | Redis Atomic INCR | 한 프로세스이므로 **정수 하나**로 충분하다         |
 * | 암호화 저장       | 열쇠를 **아예 저장하지 않는다** — 환경변수에서 읽고 |
 * |                   | 파일에는 지문·통계만 남는다 (더 안전하다)          |
 *
 * ★★★ **지문에 열쇠 글자를 쓰지 않는다** — 지시서와 다르게 했다.
 *   지시서는 `AIza••••••••••7F2A` 처럼 **끝 네 글자**를 보이라고 한다. 그런데
 *   이 저장소는 public 이고 **GitHub Actions 로그도 공개**다. 끝 네 글자는
 *   작지만 진짜 열쇠 조각이고, 한 번 로그에 박히면 지울 수 없다 (D-10 과 같은
 *   뿌리다). 그래서 **해시에서 뽑은 네 글자**를 쓴다 — 열쇠마다 다르고,
 *   같은 열쇠는 늘 같으며, 되돌릴 수 없다. 사람이 구별하는 데는 똑같이 쓰인다.
 *
 * ★ **이 파일은 Gemini 를 부르지 않는다.** 고르고 적기만 한다. 부르는 것은
 *   `llm.js`, 실제로 살았는지 물어보는 것은 `tools/gemini-doctor.js` 다.
 *   섞으면 시험할 때 진짜 호출이 나간다.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { kstStamp } = require('./kst');

/* ★★★ **키를 읽는 쪽이 스스로 `.env` 를 올린다** 〈2026-08-23 사고〉.
 *   부르는 쪽이 올려 주겠거니 하면, 새 입구가 하나 생기는 날 **영영 오프라인**이
 *   된다. NAS 엔진이 실제로 그 상태였고, 화면은 「열쇠가 필요합니다」만
 *   되풀이했다. 읽는 곳은 여기 하나이므로 여기서 올린다. */
require('./env').ensure();

/**
 * 슬롯 수. 지시서는 여섯이었는데 **사장님이 여덟을 넣으셨다** 〈2026-08-25〉.
 * ★ 사람이 이미 넣어 둔 것을 「규격이 여섯이라」 두 개 버리지 않는다.
 *   버리면 그 둘은 **넣은 사람만 넣은 줄 아는 상태**가 된다 (M-40 이 그것이었다).
 */
const SLOTS = 8;

/** 지시서 §9 — 한 요청에서 서로 다른 열쇠를 최대 몇 개까지 시도하나 */
const MAX_KEY_RETRY = SLOTS;

/**
 * 지시서 §10 — 429 를 연달아 맞을수록 더 오래 쉰다.
 * ★ 첫 칸이 60초인 이유: Gemini 의 분당 한도는 **1분이면 다시 찬다.** 처음부터
 *   길게 재우면 멀쩡한 열쇠를 놀린다.
 */
const COOLDOWN_LADDER = [60, 120, 300, 600];

/**
 * ★★★ **403 은 열쇠를 버리는 이유가 아니다** 〈2026-08-29 · D-166 · 실측〉.
 *
 *   사장님 화면에 `GEMINI_ALL_KEYS_UNAVAILABLE — 전부 쉬는 중이거나 폐기됨`
 *   이 떠서 **PDF 를 한 건도 못 읽었다.** 그런데 같은 시각 NAS 진단은
 *   **「열쇠 확인: 살아 있다 — 구글이 받아들였다」**였다. 둘 다 사실이다.
 *
 *   앞 판은 `401` 과 `403` 을 **같이** 다뤄 곧바로 폐기(`INVALID`)했다.
 *   그런데 구글은 **열쇠와 무관한 이유로도 403 을 준다** —
 *   한도 초과(`RESOURCE_EXHAUSTED`) · 권한(`PERMISSION_DENIED`) · 지역 차단.
 *   OCR 은 문서 한 건에도 요청을 여러 번 쓰므로, 한도에 닿는 순간
 *   **여덟 개가 줄줄이 폐기되고 그대로 굳었다.**
 *
 *   ★ 그래서 403 은 **오래 쉬게** 한다. 버리지 않는다.
 */
const FORBIDDEN_REST_SECONDS = 900;   // 15분

/**
 * ★★★ **폐기도 영원하지 않다** 〈같은 날 · 같은 사고〉.
 *
 *   앞 판은 `INVALID` 가 되면 **사람이 손으로 깨우기 전까지 영원히** 죽어
 *   있었다(`revalidate(slot)`). 그런데 **아무도 그것을 눌러야 하는 줄 모른다.**
 *   그 사이 서비스는 멈춰 있고, 화면에는 「전부 폐기됨」만 남는다.
 *
 *   ★ 그래서 폐기에도 **다시 물어볼 시각**을 둔다. 진짜 죽은 열쇠라면 그때
 *     한 번 더 거절당하고 다시 폐기될 뿐이다 — **요청 하나**가 값이다.
 *     그 하나를 아끼려고 **서비스를 멈춰 두는 쪽이 훨씬 비싸다.**
 */
const RETIRE_RECHECK_SECONDS = 1800;  // 30분

/** 상태 — 지시서 §4 */
const STATE = {
  UNREGISTERED: 'UNREGISTERED',
  VALIDATING: 'VALIDATING',
  ACTIVE: 'ACTIVE',
  QUOTA_LIMITED: 'QUOTA_LIMITED',
  COOLDOWN: 'COOLDOWN',
  TEMP_ERROR: 'TEMP_ERROR',
  INVALID: 'INVALID',
  DISABLED: 'DISABLED',
};

/** 고를 수 있는 상태 — 나머지는 전부 뺀다 (지시서 §7) */
const SELECTABLE = new Set([STATE.ACTIVE, STATE.UNREGISTERED, STATE.VALIDATING, STATE.TEMP_ERROR]);

/* ── 어디에 적나 ──────────────────────────────────────────── */

function stateDir() {
  /* ★ 엔진 루트가 정해져 있으면 거기, 아니면 저장소 루트. NAS 에서는
   *   열쇠 파일(`linkpilot.env`)과 같은 자리라 백업·권한이 함께 간다. */
  const base = process.env.LP_STATE_DIR
    || process.env.IM_AGENT_ROOT
    || path.join(__dirname, '..', '..');
  return path.join(base, '.state');
}

function statePath() {
  return path.join(stateDir(), 'gemini-keys.json');
}

/* ── 지문 ────────────────────────────────────────────────── */

/**
 * 열쇠에서 **되돌릴 수 없는** 짧은 이름을 만든다.
 * 열쇠 글자는 한 자도 안 들어간다 (위 ★★★).
 */
function fingerprint(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
}

/** 화면·로그에 쓰는 이름. 예: `열쇠 #a3f1` */
function label(fp) {
  return fp ? `#${fp.slice(0, 4).toUpperCase()}` : '#____';
}

/* ── 슬롯 읽기 ───────────────────────────────────────────── */

/**
 * 환경변수에서 열쇠를 읽는다.
 *
 * ★ **옛 이름을 버리지 않는다** (CLAUDE.md §35 「기존 것을 제거하지 말고 통합」).
 *   `GEMINI_API_KEY` 는 지금 NAS 에 들어 있는 유일한 열쇠이고, 쉼표로 여러 개를
 *   넣는 길도 이미 쓰이고 있다. 그것을 **남은 슬롯에 채운다** — 새 이름으로
 *   옮기기 전에도 그대로 돈다.
 */
/**
 * 슬롯 하나가 볼 환경변수 이름들. **먼저 있는 것이 이긴다.**
 *
 * ★★★ **사람이 실제로 넣은 이름을 읽는다** 〈2026-08-25 · 실제로 어긋났다〉.
 *   나는 `GEMINI_KEY_01` 로 읽게 만들어 두고 그렇게 안내했는데, 사장님은
 *   **`GEMINI_API_KEY_2` … `_8`** 로 넣으셨다. 그 상태로 두면 여덟 개가
 *   Secrets 에 멀쩡히 있는데 엔진은 **하나만** 본다 — 넣은 사람은 넣었다고
 *   알고, 배포는 초록이고, 아무도 모른다 (M-40 과 같은 결).
 *
 * ★ 그래서 **두 이름을 다 받는다.** 사람에게 다시 넣으라고 하지 않는다.
 *   새 이름(`GEMINI_KEY_0n`)은 앞으로 쓰기 좋고, 옛 이름은 이미 들어 있다.
 */
function namesFor(slot) {
  const pad = `GEMINI_KEY_${String(slot).padStart(2, '0')}`;
  return slot === 1 ? [pad, 'GEMINI_API_KEY'] : [pad, `GEMINI_API_KEY_${slot}`];
}

function readSlots() {
  const out = [];
  const used = new Set();
  for (let i = 1; i <= SLOTS; i++) {
    for (const name of namesFor(i)) {
      /* ★ 옛 이름 하나에 쉼표로 여러 개를 넣던 길이 있었다 — 첫 개만 이 슬롯이
       *   되고 나머지는 아래에서 빈 자리를 채운다 */
      const v = (process.env[name] || '').split(',')[0].trim();
      if (!v || out.some(x => x.key === v)) continue;   // 같은 열쇠를 두 슬롯에 두지 않는다
      out.push({ slot: i, key: v, from: name });
      used.add(i);
      break;
    }
  }
  const legacy = (process.env.GEMINI_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const k of legacy) {
    if (out.some(x => x.key === k)) continue;
    let slot = 1;
    while (slot <= SLOTS && used.has(slot)) slot++;
    if (slot > SLOTS) break;                            // 슬롯 수를 넘기지 않는다
    used.add(slot);
    out.push({ slot, key: k, from: 'GEMINI_API_KEY' });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

/* ── 풀 ──────────────────────────────────────────────────── */

let pool = null;      // [{slot, key, fp, ...통계}]
let cursor = 0;       // 지시서 §14 — 한 프로세스라 정수 하나로 원자적이다
let loadedFrom = '';  // 어느 이름들에서 왔나 (진단용)

function blank(slot, key, from) {
  return {
    slot,
    key,                       // ★ 메모리에만 있다. 파일·응답·로그에 안 나간다
    fp: fingerprint(key),
    from,
    status: STATE.UNREGISTERED,
    enabled: true,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rateLimitCount: 0,
    authErrorCount: 0,
    serverErrorCount: 0,
    cooldownCount: 0,
    latencySumMs: 0,
    latencyCount: 0,
    lastUsedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    cooldownUntil: 0,
    /* 폐기된 열쇠를 **언제 다시 물어볼지** — 0 이면 물어볼 계획이 없다 */
    revalidateAt: 0,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    healthScore: 100,
  };
}

/**
 * 저장된 통계를 되살린다 (지시서 §「서버 재시작 후 상태 복구」).
 *
 * ★ **지문으로 맞춘다 — 슬롯 번호로 맞추지 않는다.** 슬롯은 사람이 옮길 수
 *   있고, 그러면 3번 열쇠의 실패 이력이 5번 열쇠에 붙는다. 그 상태에서
 *   「이 열쇠가 자꾸 죽는다」를 보면 **엉뚱한 열쇠를 버리게 된다.**
 */
function restore(list) {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (_) { return; }
  const rows = (saved && Array.isArray(saved.keys)) ? saved.keys : [];
  const byFp = new Map(rows.map(r => [r.fp, r]));
  const now = Date.now();
  for (const k of list) {
    const r = byFp.get(k.fp);
    if (!r) continue;
    for (const f of ['totalRequests', 'successfulRequests', 'failedRequests', 'rateLimitCount',
      'authErrorCount', 'serverErrorCount', 'cooldownCount', 'latencySumMs', 'latencyCount',
      'consecutiveFailures', 'consecutiveSuccesses']) {
      if (typeof r[f] === 'number') k[f] = r[f];
    }
    for (const f of ['lastUsedAt', 'lastSuccessAt', 'lastErrorAt', 'lastError']) {
      if (r[f]) k[f] = r[f];
    }
    if (typeof r.healthScore === 'number') k.healthScore = r.healthScore;
    if (r.enabled === false) k.enabled = false;
    /* ★ 상태는 **골라서** 되살린다. `ACTIVE` 를 그대로 믿으면 어제 죽은 열쇠가
     *   오늘 아침 살아 있는 것으로 뜬다 — 실제로 확인한 것은 아무것도 없는데.
     *   그래서 「쉬는 중」과 「폐기」만 잇고, 나머지는 **다시 물어보게** 둔다. */
    if (r.status === STATE.INVALID) {
      /* ★★★ **폐기를 영원히 잇지 않는다** 〈2026-08-29 · D-166〉.
       *   앞 판은 `INVALID` 를 그대로 되살렸고, 다시 물어볼 계획이 없었다.
       *   그래서 한 번 굳으면 **다시 뜨나 다시 배포하나 그대로 죽어 있었다.**
       *   ★ 기한이 지났거나 아예 없으면 **다시 물어보는 상태**로 둔다. */
      const at = Number(r.revalidateAt) || 0;
      if (at && at > now) { k.status = STATE.INVALID; k.revalidateAt = at; }
      else { k.status = STATE.VALIDATING; k.revalidateAt = 0; }
    } else if (r.status === STATE.DISABLED) k.status = STATE.DISABLED;
    else if (r.cooldownUntil && r.cooldownUntil > now) {
      /* 403(QUOTA_LIMITED)도 쉬는 상태다 — 원래 상태를 지켜 준다 */
      k.status = (r.status === STATE.QUOTA_LIMITED) ? STATE.QUOTA_LIMITED : STATE.COOLDOWN;
      k.cooldownUntil = r.cooldownUntil;
    }
  }
}

/** 통계를 적는다. **열쇠는 안 적는다** */
function persist() {
  if (!pool) return;
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    const body = {
      savedAt: kstStamp(),
      keys: pool.map(k => ({
        slot: k.slot, fp: k.fp, status: k.status, enabled: k.enabled,
        totalRequests: k.totalRequests, successfulRequests: k.successfulRequests,
        failedRequests: k.failedRequests, rateLimitCount: k.rateLimitCount,
        authErrorCount: k.authErrorCount, serverErrorCount: k.serverErrorCount,
        cooldownCount: k.cooldownCount, latencySumMs: k.latencySumMs, latencyCount: k.latencyCount,
        lastUsedAt: k.lastUsedAt, lastSuccessAt: k.lastSuccessAt,
        lastErrorAt: k.lastErrorAt, lastError: k.lastError,
        cooldownUntil: k.cooldownUntil,
        revalidateAt: k.revalidateAt,
        consecutiveFailures: k.consecutiveFailures, consecutiveSuccesses: k.consecutiveSuccesses,
        healthScore: k.healthScore,
      })),
    };
    fs.writeFileSync(statePath(), JSON.stringify(body, null, 2), { mode: 0o600 });
  } catch (_) { /* ★ 적다 죽지 않는다 — 통계 때문에 보고서 생성이 멈추면 안 된다 */ }
}

function ensure() {
  if (pool) return pool;
  const list = readSlots().map(s => blank(s.slot, s.key, s.from));
  loadedFrom = [...new Set(list.map(x => x.from))].join(' · ');
  restore(list);
  pool = list;
  return pool;
}

/** 환경변수를 다시 읽는다 (시험·재검증용). 통계는 파일에서 다시 잇는다 */
function reload() {
  pool = null;
  cursor = 0;
  return ensure();
}

/* ── 쉬는 시간 ───────────────────────────────────────────── */

/** 쉴 시간이 끝났으면 **다시 물어봐야 하는 상태**로 돌린다 (지시서 §11) */
function thaw(k) {
  const now = Date.now();
  /* ★ 쉬는 상태는 **둘**이다 — 429(COOLDOWN)와 403(QUOTA_LIMITED).
   *   하나만 깨우면 403 맞은 열쇠가 영원히 안 깨어난다 (D-166 과 같은 결). */
  const resting = (k.status === STATE.COOLDOWN || k.status === STATE.QUOTA_LIMITED);
  if (resting && k.cooldownUntil && now >= k.cooldownUntil) {
    /* ★ 곧바로 ACTIVE 로 두지 않는다. 아직 아무것도 확인하지 않았다 —
     *   `VALIDATING` 은 「골라도 되지만 아직 못 믿는다」는 뜻이다. */
    k.status = STATE.VALIDATING;
    k.cooldownUntil = 0;
  }
  /* ★★★ **폐기도 기한이 지나면 다시 물어본다** 〈D-166〉. 사람이 누르기를
   *   기다리면 아무도 안 누르고, 그동안 서비스가 멈춘다. */
  if (k.status === STATE.INVALID && k.revalidateAt && now >= k.revalidateAt) {
    k.status = STATE.VALIDATING;
    k.revalidateAt = 0;
    k.consecutiveFailures = 0;
  }
}

function cooldownSeconds(n) {
  return COOLDOWN_LADDER[Math.min(Math.max(n, 1), COOLDOWN_LADDER.length) - 1];
}

/* ── 고르기 ──────────────────────────────────────────────── */

/** 지금 쓸 수 있는 열쇠들 */
function available() {
  const list = ensure();
  list.forEach(thaw);
  return list.filter(k => k.enabled && SELECTABLE.has(k.status));
}

/**
 * 다음 열쇠를 고른다. 지시서 §7 — **쓸 수 있는 것들만** 돌아가며 쓴다.
 *
 * @param {Set<string>} skip 이번 요청에서 이미 써 본 지문
 */
function selectNext(skip) {
  let list = available().filter(k => !skip || !skip.has(k.fp));
  /* ★★★ **전부 잠겨 있으면 하나를 깨워서 써 본다** 〈2026-08-29 · D-166〉.
   *
   *   앞 판은 여기서 `null` 을 돌려주고 끝이었다. 그러면 화면에는
   *   `GEMINI_ALL_KEYS_UNAVAILABLE` 만 남고 **사람이 손으로 깨우기 전까지
   *   아무 일도 안 일어난다.** 실제로 그렇게 굳어 PDF 를 한 건도 못 읽었다.
   *
   *   ★ 「전부 못 쓴다」는 대개 **한도**다. 한도는 시간이 지나면 풀리는데,
   *     풀렸는지 아는 방법은 **한 번 써 보는 것**뿐이다. 그래서 가장 오래 쉰
   *     열쇠 하나를 깨운다 — 아직 진짜로 막혀 있으면 그 요청 하나가 다시
   *     거절될 뿐이고, 그때 다시 쉰다.
   *   ★★ **쓸 수 있는 것이 하나라도 있으면 깨우지 않는다.** 멀쩡한 열쇠를
   *     두고 쉬는 것을 깨우면 쉬게 한 뜻이 사라진다.
   *   ★★★ 사람이 끈 열쇠(`DISABLED`)는 **깨우지 않는다.** 그것은 한도가
   *     아니라 **사람의 결정**이다. */
  /* ★★★ **한 요청에 하나만 깨운다** 〈D-166 · 스스로 잡은 결함〉.
   *   부르는 쪽(`llm.js`)은 실패할 때마다 `skip` 을 늘려 가며 여기를 다시
   *   부른다. 그대로 두면 **한 요청이 여덟을 전부 깨워** 쉬게 한 뜻이
   *   통째로 사라진다 — 한도가 안 풀렸는데 여덟 번 더 두드리는 셈이다.
   *   ★ `skip` 이 비었을 때 = **그 요청의 첫 시도**다. 그때만 깨운다. */
  const firstTry = !skip || skip.size === 0;
  if (!list.length && firstTry) list = wakeOldest(skip);
  if (!list.length) return null;
  /* ★ 정수 하나를 올리고 나눈다. 한 프로세스라 이것으로 원자적이다.
   *   ★★ 여러 프로세스로 늘리는 날에는 **여기만** 바꾸면 된다 — 고르는 곳이
   *      한 곳뿐이라서 그렇다. 그것이 이 파일을 만든 이유의 절반이다. */
  const i = (cursor++) % list.length;
  if (cursor > 1e9) cursor = 0;
  return list[i];
}

/**
 * 마지막 수단 — **가장 오래 쉰 열쇠 하나**를 깨운다.
 *
 * @returns {Array} 깨운 열쇠 하나짜리 목록 (깨울 것이 없으면 빈 목록)
 */
function wakeOldest(skip) {
  const list = ensure();
  const cand = list.filter(k => k.enabled
    && k.status !== STATE.DISABLED
    && (!skip || !skip.has(k.fp)));
  if (!cand.length) return [];
  /* 「가장 오래 쉰 것」 = 깨어날 시각이 가장 이른 것. 시각이 없으면(폐기인데
     계획도 없는 것) 가장 먼저 깨운다 — 그것이 제일 오래 죽어 있던 것이다 */
  const at = (k) => (k.status === STATE.INVALID
    ? (k.revalidateAt || 0)
    : (k.cooldownUntil || 0));
  cand.sort((a, b) => at(a) - at(b));
  const k = cand[0];
  k.status = STATE.VALIDATING;
  k.cooldownUntil = 0;
  k.revalidateAt = 0;
  k.wokenAt = kstStamp();   // 「깨워서 써 본 것」임을 진단이 말할 수 있게
  persist();
  return [k];
}

/* ── 결과 적기 ───────────────────────────────────────────── */

function bump(k, field) { k[field] += 1; }

function recordSuccess(k, latencyMs) {
  if (!k) return;
  bump(k, 'totalRequests'); bump(k, 'successfulRequests');
  k.consecutiveSuccesses += 1;
  k.consecutiveFailures = 0;
  k.status = STATE.ACTIVE;
  k.cooldownUntil = 0;
  k.lastUsedAt = kstStamp();
  k.lastSuccessAt = k.lastUsedAt;
  if (typeof latencyMs === 'number' && latencyMs >= 0) {
    k.latencySumMs += latencyMs; k.latencyCount += 1;
  }
  k.healthScore = Math.min(100, k.healthScore + 5);
  persist();
}

/** 429 — 열쇠가 나쁜 것이 아니라 **지금 바쁜** 것이다 (지시서 §8·§10) */
function recordRateLimit(k) {
  if (!k) return;
  bump(k, 'totalRequests'); bump(k, 'failedRequests'); bump(k, 'rateLimitCount');
  bump(k, 'cooldownCount');
  k.consecutiveFailures += 1;
  k.consecutiveSuccesses = 0;
  const secs = cooldownSeconds(k.cooldownCount);
  k.status = STATE.COOLDOWN;
  k.cooldownUntil = Date.now() + secs * 1000;
  k.lastUsedAt = kstStamp();
  k.lastErrorAt = k.lastUsedAt;
  k.lastError = `429 · ${secs}초 쉼`;
  k.healthScore = Math.max(0, k.healthScore - 10);
  persist();
  return secs;
}

/**
 * 401 — 열쇠 자체가 안 먹는다. 풀에서 뺀다 (지시서 §12).
 *
 * ★★★ **403 은 여기로 오지 않는다** 〈2026-08-29 · D-166〉. 위 `FORBIDDEN_REST_SECONDS`
 *   설명 참고 — 구글은 한도·권한 문제에도 403 을 준다. 그것으로 열쇠를 버리면
 *   **여덟 개가 줄줄이 폐기되고 그대로 굳는다.** 실제로 그렇게 굳었다.
 *
 * ★ 폐기하되 **다시 물어볼 시각**을 함께 적는다. 영원한 폐기는 두지 않는다.
 */
function recordAuthError(k, status) {
  if (!k) return;
  bump(k, 'totalRequests'); bump(k, 'failedRequests'); bump(k, 'authErrorCount');
  k.consecutiveFailures += 1;
  k.consecutiveSuccesses = 0;
  k.status = STATE.INVALID;
  k.revalidateAt = Date.now() + RETIRE_RECHECK_SECONDS * 1000;
  k.lastUsedAt = kstStamp();
  k.lastErrorAt = k.lastUsedAt;
  k.lastError = `${status} · 인증 거부 — ${Math.round(RETIRE_RECHECK_SECONDS / 60)}분 뒤 다시 물어본다`;
  k.healthScore = 0;
  persist();
}

/**
 * 403 — **열쇠가 틀린 것이 아니다.** 한도 초과·권한·지역 차단이 여기로 온다.
 *
 * ★ 그래서 **버리지 않고 오래 쉬게** 한다. 429 보다 길게 쉬는 이유: 429 는
 *   분당 한도라 1분이면 다시 차지만, 403 은 대개 **일 한도**나 설정 문제라
 *   금방 풀리지 않는다. 그렇다고 폐기하면 **풀려도 아무도 안 쓴다.**
 */
function recordForbidden(k, status, message) {
  if (!k) return FORBIDDEN_REST_SECONDS;
  bump(k, 'totalRequests'); bump(k, 'failedRequests'); bump(k, 'authErrorCount');
  k.consecutiveFailures += 1;
  k.consecutiveSuccesses = 0;
  k.status = STATE.QUOTA_LIMITED;
  k.cooldownUntil = Date.now() + FORBIDDEN_REST_SECONDS * 1000;
  k.lastUsedAt = kstStamp();
  k.lastErrorAt = k.lastUsedAt;
  k.lastError = `${status} · 거절(한도·권한일 수 있다) — `
    + `${Math.round(FORBIDDEN_REST_SECONDS / 60)}분 쉼`
    + (message ? ` · ${String(message).slice(0, 120)}` : '');
  k.healthScore = Math.max(0, k.healthScore - 5);
  persist();
  return FORBIDDEN_REST_SECONDS;
}

/** 5xx — 구글 쪽 일이다. **열쇠를 버리지 않는다** (지시서 §13) */
function recordServerError(k, status) {
  if (!k) return;
  bump(k, 'totalRequests'); bump(k, 'failedRequests'); bump(k, 'serverErrorCount');
  k.consecutiveFailures += 1;
  k.consecutiveSuccesses = 0;
  k.status = STATE.TEMP_ERROR;
  k.lastUsedAt = kstStamp();
  k.lastErrorAt = k.lastUsedAt;
  k.lastError = `${status} · 구글 쪽 일시 오류`;
  k.healthScore = Math.max(0, k.healthScore - 2);
  persist();
}

/** 그 밖의 실패 (시간초과·끊김 등). 상태는 안 바꾼다 — 원인이 열쇠라는 근거가 없다 */
function recordUnknownError(k, message) {
  if (!k) return;
  bump(k, 'totalRequests'); bump(k, 'failedRequests');
  k.consecutiveFailures += 1;
  k.consecutiveSuccesses = 0;
  k.lastUsedAt = kstStamp();
  k.lastErrorAt = k.lastUsedAt;
  k.lastError = String(message || '알 수 없는 오류').slice(0, 200);
  k.healthScore = Math.max(0, k.healthScore - 1);
  persist();
}

/** 사람이 끄고 켠다 (지시서 §4 DISABLED) */
function setEnabled(slot, on) {
  const k = ensure().find(x => x.slot === Number(slot));
  if (!k) return null;
  k.enabled = !!on;
  k.status = on ? STATE.VALIDATING : STATE.DISABLED;
  if (on) k.cooldownUntil = 0;
  persist();
  return k;
}

/** 폐기된 열쇠를 사람이 다시 물어보게 한다 (지시서 §12 「재검증」) */
function revalidate(slot) {
  const k = ensure().find(x => x.slot === Number(slot));
  if (!k) return null;
  k.status = STATE.VALIDATING;
  k.cooldownUntil = 0;
  k.consecutiveFailures = 0;
  persist();
  return k;
}

/** 통계만 지운다. 상태는 안 건드린다 */
function resetStats() {
  ensure().forEach((k) => {
    k.totalRequests = 0; k.successfulRequests = 0; k.failedRequests = 0;
    k.rateLimitCount = 0; k.authErrorCount = 0; k.serverErrorCount = 0;
    k.cooldownCount = 0; k.latencySumMs = 0; k.latencyCount = 0;
    k.lastError = null;
  });
  persist();
}

/* ── 내다보기 ────────────────────────────────────────────── */

/**
 * 화면·API 가 쓰는 요약. **열쇠는 한 글자도 안 들어간다** (지시서 §19·§23·§24).
 */
function snapshot() {
  const list = ensure();
  list.forEach(thaw);
  const keys = list.map(k => ({
    slot: k.slot,
    id: `key-${String(k.slot).padStart(2, '0')}`,
    label: label(k.fp),
    fingerprint: k.fp,
    from: k.from,
    status: k.status,
    enabled: k.enabled,
    healthScore: k.healthScore,
    totalRequests: k.totalRequests,
    successfulRequests: k.successfulRequests,
    failedRequests: k.failedRequests,
    rateLimitCount: k.rateLimitCount,
    authErrorCount: k.authErrorCount,
    serverErrorCount: k.serverErrorCount,
    cooldownCount: k.cooldownCount,
    avgLatencyMs: k.latencyCount ? Math.round(k.latencySumMs / k.latencyCount) : null,
    lastUsedAt: k.lastUsedAt,
    lastSuccessAt: k.lastSuccessAt,
    lastErrorAt: k.lastErrorAt,
    lastError: k.lastError,
    cooldownSecondsLeft: k.cooldownUntil > Date.now()
      ? Math.ceil((k.cooldownUntil - Date.now()) / 1000) : 0,
    consecutiveFailures: k.consecutiveFailures,
    consecutiveSuccesses: k.consecutiveSuccesses,
  }));
  const total = keys.reduce((a, k) => a + k.totalRequests, 0);
  const ok = keys.reduce((a, k) => a + k.successfulRequests, 0);
  return {
    slots: SLOTS,
    registered: keys.length,
    active: keys.filter(k => k.status === STATE.ACTIVE).length,
    availableNow: available().length,
    invalid: keys.filter(k => k.status === STATE.INVALID).length,
    cooldown: keys.filter(k => k.status === STATE.COOLDOWN).length,
    totalRequests: total,
    successRate: total ? Math.round((ok / total) * 1000) / 10 : null,
    readFrom: loadedFrom || '(없음)',
    /* ★ 알림 조건 — 지시서 §27. 화면이 아니라 **여기서** 정한다.
     *   화면이 정하면 화면마다 달라지고, 그러면 「경고가 왜 안 떴나」를 못 푼다. */
    alerts: alertsFor(keys, available().length),
    keys,
    at: kstStamp(),
  };
}

/**
 * ★★★ **「쓸 수 있는」은 고르기와 같은 잣대로 센다** 〈2026-08-25 · 시험에서 걸렸다〉.
 *   앞 판은 `ACTIVE` 와 `VALIDATING` 만 셌다. 그런데 **한 번도 안 써 본 열쇠**는
 *   `UNREGISTERED` 다 — 고르기는 그것을 고르는데 알림은 「하나도 없습니다」라고
 *   말했다. 재는 잣대가 둘이면 **둘 다 못 믿는다.**
 */
function alertsFor(keys, availN) {
  const out = [];
  const registered = keys.length;
  const activeN = typeof availN === 'number' ? availN : available().length;
  if (!registered) {
    out.push({ level: 'red', text: '등록된 Gemini 열쇠가 없습니다 — 스캔본·이미지 PDF 를 한 글자도 못 읽습니다' });
  } else if (!activeN) {
    out.push({ level: 'red',
      text: '쓸 수 있는 열쇠가 하나도 없습니다 (GEMINI_ALL_KEYS_UNAVAILABLE) — '
        + '다음 요청이 쉬던 열쇠 하나를 깨워 확인합니다. 대개 한도이고 시간이 '
        + '지나면 풀립니다' });
  } else if (registered >= 3 && activeN < 3) {
    out.push({ level: 'yellow', text: `쓸 수 있는 열쇠가 ${activeN}개뿐입니다 — 셋 아래로 내려갔습니다` });
  }
  keys.filter(k => k.status === STATE.INVALID).forEach((k) => {
    out.push({ level: 'red', text: `${k.id} ${k.label} 이 인증에 거부되었습니다 — 다시 넣어 주십시오` });
  });
  const total = keys.reduce((a, k) => a + k.totalRequests, 0);
  const ok = keys.reduce((a, k) => a + k.successfulRequests, 0);
  if (total >= 20 && (ok / total) < 0.95) {
    out.push({ level: 'yellow', text: `성공률이 ${Math.round((ok / total) * 1000) / 10}% 입니다 (95% 아래)` });
  }
  return out;
}

module.exports = {
  SLOTS, MAX_KEY_RETRY, COOLDOWN_LADDER, STATE,
  FORBIDDEN_REST_SECONDS, RETIRE_RECHECK_SECONDS,
  fingerprint, label, readSlots, namesFor,
  ensure, reload, available, selectNext, wakeOldest,
  recordSuccess, recordRateLimit, recordAuthError, recordForbidden,
  recordServerError, recordUnknownError,
  setEnabled, revalidate, resetStats,
  snapshot, statePath, cooldownSeconds,
};
