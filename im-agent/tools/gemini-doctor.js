'use strict';
/**
 * gemini-doctor.js — 열쇠 여덟을 **실제로 불러 본다** (지시서 §5·§6·§25).
 *
 * ★★★ **「넣었다」는 「된다」가 아니다.** 2026-08-25 에 실제로 겪었다 — NAS 의
 *   열쇠 파일에 값이 들어 있어서 배포 로그는 「OCR 켜짐」으로 나왔는데,
 *   물어보니 **HTTP 401** 이었다. 그 상태로 자료를 올리면 **올리는 그 순간에야**
 *   실패하고, 화면은 「읽었습니다」와 구분되지 않는다 (MEMORY M-34·M-40).
 *
 * ★ 그래서 상태를 **호출 결과로만** 정한다. 값이 들어 있다는 사실은
 *   ACTIVE 의 근거가 아니다.
 *
 * ★ 가장 가벼운 요청을 쓴다 — 모델 목록(`GET /v1beta/models`). 생성 요청은
 *   돈과 한도를 쓴다. 여덟 개를 매번 생성으로 재면 재는 것이 곧 소모다.
 *
 * ★ **값은 한 글자도 안 찍는다** (CLAUDE.md §2). 이름·해시에서 뽑은 네 글자·
 *   상태·지연시간만 남는다. 이 저장소는 public 이고 Actions 로그도 공개다.
 *
 * 쓰는 법:
 *   npm run gemini:keys            여덟 슬롯을 전부 재고 사람 말로 적는다
 *   npm run gemini:keys -- --json  같은 결과를 JSON 으로
 *   npm run gemini:keys -- --slot 3  한 슬롯만
 */

require('../core/env').ensure();
const keys = require('../core/gemini-keys');
const { kstStamp } = require('../core/kst');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 10000;

/**
 * 거절 본문에서 **무엇이 잘못됐는지**를 읽는다.
 * ★ 상태코드만 보면 「열쇠가 죽었다」와 「그 API 를 안 켰다」가 같아 보인다
 *   (CLAUDE.md §4.2 와 같은 결).
 */
function why(status, text) {
  const t = String(text || '');
  if (/API_KEY_INVALID|API key not valid/i.test(t)) return '열쇠가 유효하지 않다 — 새로 만들어야 한다';
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(t)) return '그 프로젝트에서 Generative Language API 가 꺼져 있다';
  if (/PERMISSION_DENIED/i.test(t)) return '권한이 없다 — 다른 프로젝트 열쇠이거나 제한이 걸려 있다';
  if (/quota|RESOURCE_EXHAUSTED/i.test(t)) return '한도를 넘었다 — 열쇠 자체는 살아 있다';
  return `HTTP ${status}`;
}

/**
 * 한 열쇠를 재고 **매니저 상태를 갱신한다.**
 * @returns {Promise<object>} 값이 없는 요약 한 줄
 */
async function checkOne(k) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  const base = { slot: k.slot, id: `key-${String(k.slot).padStart(2, '0')}`, label: keys.label(k.fp), from: k.from };
  try {
    const r = await fetch(ENDPOINT, { headers: { 'x-goog-api-key': k.key }, signal: ctl.signal });
    const ms = Date.now() - t0;
    if (r.ok) {
      const j = await r.json().catch(() => null);
      const n = Array.isArray(j && j.models) ? j.models.length : null;
      keys.recordSuccess(k, ms);
      return { ...base, status: keys.STATE.ACTIVE, ok: true, latencyMs: ms, models: n, note: '실제 호출 성공' };
    }
    const body = (await r.text().catch(() => '')).slice(0, 400);
    const reason = why(r.status, body);
    if (r.status === 429) {
      const secs = keys.recordRateLimit(k);
      return { ...base, status: keys.STATE.COOLDOWN, ok: false, latencyMs: ms, http: 429, note: `한도 — ${secs}초 쉼` };
    }
    if (r.status === 401 || r.status === 403) {
      keys.recordAuthError(k, r.status);
      return { ...base, status: keys.STATE.INVALID, ok: false, latencyMs: ms, http: r.status, note: reason };
    }
    if (r.status >= 500) {
      keys.recordServerError(k, r.status);
      return { ...base, status: keys.STATE.TEMP_ERROR, ok: false, latencyMs: ms, http: r.status, note: reason };
    }
    keys.recordUnknownError(k, reason);
    return { ...base, status: k.status, ok: false, latencyMs: ms, http: r.status, note: reason };
  } catch (e) {
    /* ★★ **못 물어본 것을 죽은 것으로 세지 않는다.** 그물이 안 닿아서 못 잰
     *   것을 INVALID 로 적으면 멀쩡한 열쇠를 사람이 버린다 (M-40 의 결). */
    return {
      ...base, status: k.status, ok: false, measured: false,
      note: e && e.name === 'AbortError' ? '10초 안에 답이 없다 — 못 쟀다' : '그물이 안 닿는다 — 못 쟀다',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 슬롯 하나 */
async function checkSlot(slot) {
  const k = keys.ensure().find(x => x.slot === Number(slot));
  if (!k) return { slot: Number(slot), status: keys.STATE.UNREGISTERED, ok: false, note: '그 슬롯에 열쇠가 없다' };
  return checkOne(k);
}

/** 여덟 전부 — 지시서 §6 `health-check-all` */
async function checkAll() {
  const list = keys.ensure();
  /* ★ 한꺼번에 던지지 않는다. 같은 프로젝트의 열쇠들이면 **재는 행위 자체가
   *   분당 한도를 때린다** (지시서 §31). 하나씩 부른다 — 여덟이면 몇 초다. */
  const results = [];
  for (const k of list) results.push(await checkOne(k));
  return { at: kstStamp(), slots: keys.SLOTS, registered: list.length, results };
}

/* ── 사람 말로 ───────────────────────────────────────────── */

const MARK = {
  ACTIVE: '🟢', COOLDOWN: '🟡', QUOTA_LIMITED: '🟡',
  INVALID: '🔴', TEMP_ERROR: '🟠', DISABLED: '⚫', UNREGISTERED: '·', VALIDATING: '·',
};

function describe(report) {
  const out = [];
  out.push(`Gemini 열쇠 ${report.registered}/${report.slots} — ${report.at}`);
  out.push('');
  if (!report.registered) {
    out.push('  등록된 열쇠가 없다. GEMINI_API_KEY · GEMINI_API_KEY_2 … _8 (또는 GEMINI_KEY_01 … 08) 을 넣는다.');
    return out.join('\n');
  }
  report.results.forEach((r) => {
    const mark = MARK[r.status] || '·';
    const ms = typeof r.latencyMs === 'number' ? `${String(r.latencyMs).padStart(5)}ms` : '     —';
    out.push(`  ${r.id}  ${r.label}  ${mark} ${String(r.status).padEnd(13)} ${ms}  ${r.note}`);
  });
  out.push('');
  const alive = report.results.filter(r => r.ok).length;
  const unmeasured = report.results.filter(r => r.measured === false).length;
  out.push(`  실제 호출 성공 ${alive}/${report.registered}`
    + (unmeasured ? ` · 못 잰 것 ${unmeasured} (죽은 것과 **다른 사실**이다)` : ''));
  if (!alive && !unmeasured) out.push('  ❌ GEMINI_ALL_KEYS_UNAVAILABLE — 쓸 수 있는 열쇠가 없다');
  return out.join('\n');
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--slot');
  const one = i >= 0 ? argv[i + 1] : null;
  (one
    ? checkSlot(one).then(r => ({ at: kstStamp(), slots: keys.SLOTS, registered: 1, results: [r] }))
    : checkAll()
  ).then((report) => {
    if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else console.log(describe(report));
    /* ★ 되돌아오는 값으로 갈라 준다 — `guard` 와 같은 잣대다.
     *   0 = 하나라도 살아 있다 / 1 = 전부 죽었다 / 2 = 못 쟀다 */
    const alive = report.results.filter(r => r.ok).length;
    const unmeasured = report.results.filter(r => r.measured === false).length;
    process.exitCode = alive ? 0 : (unmeasured ? 2 : 1);
  });
}

module.exports = { checkOne, checkSlot, checkAll, describe, why };
