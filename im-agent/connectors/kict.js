'use strict';
/**
 * kict.js — 한국건설기술연구원(KICT) **건설공사비** Connector.
 *
 * 〈2026-08-25 사장님: 「KICT_API_KEY 넣었어」〉
 *
 * ★★★ **지금은 호출하지 않는다.** 키는 들어왔지만 **어느 서비스의 키인지가
 *   확정되지 않았다** (등록부 D-106). KICT 는 공사비원가관리센터(표준품셈·
 *   표준시장단가)와 건설공사비지수를 함께 내는데 발급 경로가 서로 다르다.
 *
 *   확정 전에 아무 주소로나 부르면 돌아오는 오류가 **「키가 틀렸다」와 구분되지
 *   않는다.** 그러면 사장님이 멀쩡한 키를 다시 발급받으시게 된다 — Gemini 에서
 *   실제로 두 번 그랬다 (M-31). 그래서 **모르는 채로 부르지 않는다.**
 *
 * ★ 대신 이 파일은 **키가 살아 있다는 사실을 지킨다**:
 *   ① `.env.example` · `SECRET_ENV` · 배포 목록에 이름이 올라가 있어 NAS 로 간다
 *   ② 스모크가 「설정됨 / 엔드포인트 미확정」을 구분해 말한다
 *   ③ 주소가 정해지면 `KICT_API_BASE` 만 넣으면 돈다 — 코드는 안 건드린다
 *
 * ★ 무엇에 쓸 것인가: **공사비 시점수정의 두 번째 출처**다. 지금 단가 시점수정은
 *   한국은행 생산자물가지수(`ecos`) 하나로 하는데, 그것은 재료비 성격이다.
 *   **건설공사비지수는 노무비·경비를 포함**해 공사비 대조에는 결이 맞다.
 *   ★★ 그래도 **공사비를 자동으로 내지는 않는다** — 물량과 단가가 가정계수다 (§4.8).
 *   이 커넥터가 낼 수 있는 것은 **지수(시점수정 계수)** 까지다.
 */

const { request, buildUrl, redact } = require('./http');
const cache = require('./cache');

const PROVIDER = 'kict';

function apiKey() {
  return (process.env.KICT_API_KEY || '').trim();
}

/** ★ 주소가 확정될 때까지 비어 있다. 비어 있으면 **부르지 않는다**. */
function base() {
  return (process.env.KICT_API_BASE || '').trim();
}

function hasKey() {
  return Boolean(apiKey());
}

/**
 * 부를 준비가 되었는가 — **키만으로는 아니다**.
 * 키가 있어도 주소를 모르면 못 부른다. 둘을 갈라 말하는 것이 이 함수의 일이다.
 */
function isAvailable() {
  return Boolean(apiKey() && base());
}

/**
 * 지금 상태를 사람 말로. 스모크와 env-doctor 가 이걸 그대로 찍는다.
 * ★ 「미설정」과 「주소 미확정」은 **다른 사실**이다 — 뭉뚱그리면 사장님이
 *   넣으신 키를 못 넣은 줄 알고 다시 넣으신다 (M-40).
 */
function status() {
  if (!hasKey()) {
    return { ok: false, code: 'nokey', text: 'KICT_API_KEY 미설정 — 건설공사비지수 건너뜀 (시점수정은 ecos 생산자물가지수만 쓴다)' };
  }
  if (!base()) {
    return {
      ok: false, code: 'noendpoint',
      text: '키는 설정됨 · **엔드포인트 미확정 (D-106)** — 어느 KICT 서비스인지 정해지면 KICT_API_BASE 만 넣으면 된다. 그때까지 호출하지 않는다',
    };
  }
  return { ok: true, code: 'ready', text: '설정됨 (⚠ 응답 필드 미검증 — 실호출 1회 필요)' };
}

function unavailable(what) {
  const s = status();
  return { ok: false, unavailable: true, error: `${s.text} — ${what} 조회 생략`, code: s.code };
}

/**
 * 건설공사비지수 — 월별 지수.
 *
 * ★ 시점수정 계수 = 지수(평가시점) ÷ 지수(기준시점). **변동률을 곱해 쌓지 않는다**
 *   — 구간 경계에서 한 달을 더 세기 쉽다 (reb.js 에서 실제로 틀렸던 자리, §4.4).
 *
 * @param {object} o
 * @param {string} o.from YYYYMM
 * @param {string} o.to   YYYYMM
 */
async function costIndex({ from, to } = {}) {
  if (!isAvailable()) return unavailable('건설공사비지수');
  if (!from || !to) return { ok: false, error: '조회 기간(from, to) 이 필요하다' };

  return cache.through(PROVIDER, 'costindex', { from, to }, async () => {
    const url = buildUrl(base(), { serviceKey: apiKey(), type: 'json', from, to });
    const r = await request(url);
    if (!r.ok) return { ok: false, error: redact(r.error) };

    let body;
    try {
      body = JSON.parse(r.body);
    } catch (_) {
      // ★ 주소가 맞는지부터 의심한다. 여기서 「키가 틀렸다」고 말하면 안 된다
      return { ok: false, error: 'JSON 이 아닌 응답 — 엔드포인트(KICT_API_BASE)가 맞는지 먼저 본다 (D-106)' };
    }
    // ★ 응답 필드 이름을 **아직 모른다.** 실호출 1회 전까지는 가공하지 않고
    //   원문을 그대로 넘긴다 — 여기서 지어낸 매핑이 곧 출처가 되어 버린다 (§4.7)
    return { ok: true, value: { raw: body, note: '응답 필드 미검증 — 실호출 1회 필요 (D-106)' } };
  }, { ttl: 30 * 86400 });
}

/**
 * 시점수정 계수 — 지수의 **비**로 낸다.
 * 지수를 못 받으면 계수도 안 낸다. 「대략 1.05」 같은 것을 돌려주지 않는다 (§4.9).
 */
async function timeAdjustment({ baseMonth, targetMonth } = {}) {
  if (!isAvailable()) return unavailable('공사비 시점수정');
  const r = await costIndex({ from: baseMonth, to: targetMonth });
  if (!r.ok) return r;
  return {
    ok: false,
    error: '지수는 받았으나 응답 필드가 확정되지 않아 계수를 내지 않는다 (D-106) — 대체값으로 메우지 않는다',
    raw: r.value,
  };
}

module.exports = { isAvailable, hasKey, status, costIndex, timeAdjustment, PROVIDER };
