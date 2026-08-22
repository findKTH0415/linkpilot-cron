'use strict';
/**
 * linked-fetch.js — 연결된 자료를 **잠깐 가져오는** 기본 구현 (2026-08-20).
 *
 * `report-api` 는 `fetchLinked`·`headLinked` 를 **주입받는다.** 지금까지는
 * 아무도 주지 않아서 연결 갈래가 통째로 501 이었다 — 등록조차 받지 않는다
 * (읽을 수 없으면 받지 않는다는 설계다. 연결만 되고 안 읽히면 사용자는 자료를
 * 넣었다고 믿는데 보고서에는 안 실린다).
 *
 * ★★ 여기는 **토큰을 모른다.** 「그때그때 고르기」에서 제공자가 준 **짧게 사는
 *   주소**를 `core/handoff.js` 가 들고 있고, 이 모듈은 그것으로 받아 올 뿐이다.
 *   그래서 이 저장소 어디에도 남의 계정 열쇠가 저장되지 않는다.
 *
 * ★★ **못 가져온 이유를 뭉치지 않는다.** 만료·미연결·원본 삭제·권한 끊김은
 *   사용자가 할 일이 각각 다르다. 「가져오지 못했습니다」 하나로 내면 무엇을
 *   해야 할지 알 수 없다.
 *
 * ★ 크기를 재고 넘치면 **받다가 멈춘다.** 남의 드라이브에 있는 파일이라
 *   우리가 크기를 정할 수 없다 — 20MB 짜리 IM 자료 자리에 2GB 영상이 올 수 있다.
 */
const http = require('../connectors/http');
const handoff = require('./handoff');

/**
 * 파일 하나 한도.
 *
 * ★★ **베껴 적지 않는다** 〈2026-08-22〉. 앞 판은 `20 * 1024 * 1024` 를 여기
 *   손으로 적고 주석에 「`ui/api-router.cjs` 와 같은 값을 쓴다」고 달아 두었다.
 *   같은 값이었던 것은 그날뿐이다 — 한도를 30MB 로 올리는 순간 **연결 자료만
 *   조용히 20MB 에서 잘렸을 것이다.** 그리고 화면은 「한도 30MB」라고 적혀
 *   있으므로, 사용자는 26MB 짜리가 왜 안 들어오는지 알 방법이 없다.
 *   ★ `api-router.cjs` 는 맨 위에서 `path` 와 `routes.cjs` 만 부른다 —
 *     express 는 지연 로드라 여기서 끌어와도 무겁지 않다.
 */
const { MAX_FILE_BYTES: MAX_BYTES } = require('../ui/api-router.cjs');

function mb(n) { return Math.round((n / (1024 * 1024)) * 10) / 10; }

/**
 * 연결 자료 하나를 받아 온다. `core/linked.js` 의 `materialize()` 가 부른다.
 *
 * @param {object} item  장부의 항목 ({provider, fileId, name, rev, key, …})
 * @param {{projectId:string}} ctx
 * @returns {Promise<{ok:true, buf:Buffer}|{ok:false, reason:string}>}
 */
async function fetchLinked(item, ctx = {}) {
  const key = item && item.key;
  const got = handoff.get(ctx.projectId, key);
  if (!got.ok) return { ok: false, reason: got.reason };

  const r = await http.request(got.url, {
    binary: true,
    headers: got.headers || {},
    timeoutMs: 60000,
  });

  if (!r.ok) {
    // ★ 상태코드를 사람 말로 바꾼다. 숫자만 내면 사용자가 할 일을 못 정한다
    if (r.status === 404 || r.status === 410) {
      return { ok: false, reason: '원본을 찾을 수 없습니다 — 지워졌거나 옮겨졌습니다' };
    }
    if (r.status === 401 || r.status === 403) {
      return { ok: false, reason: '접근 권한이 끊겼습니다 — 파일을 다시 골라 주세요' };
    }
    return { ok: false, reason: r.error || `내려받지 못했습니다 (HTTP ${r.status})` };
  }

  const buf = r.body;
  if (!Buffer.isBuffer(buf) || !buf.length) {
    return { ok: false, reason: '빈 파일입니다' };
  }
  if (buf.length > MAX_BYTES) {
    return { ok: false, reason: `파일이 너무 큽니다 (${mb(buf.length)}MB · 한도 ${mb(MAX_BYTES)}MB)` };
  }
  return { ok: true, buf };
}

/**
 * 원본이 **그때 그대로인가**를 묻는다. `core/linked.js` 의 `verify()` 가 부른다.
 *
 * ★ 사본이 없으므로 물어보지 않으면 알 수 없다. 그런데 여기서 **조용히
 *   「이상 없음」을 내는 것이 가장 나쁜 답이다** — 근거가 사라진 것을 모른 채
 *   문서가 나간다. 그래서 모를 때는 모른다고 돌려준다.
 *
 * @returns {Promise<{ok:true, rev?:string, bytes?:number}|{ok:false, reason:string}>}
 */
async function headLinked(item, ctx = {}) {
  const key = item && item.key;
  const got = handoff.get(ctx.projectId, key);
  if (!got.ok) return { ok: false, reason: got.reason };

  const r = await http.request(got.url, {
    method: 'HEAD',
    headers: got.headers || {},
    timeoutMs: 20000,
  });

  if (!r.ok) {
    if (r.status === 404 || r.status === 410) {
      return { ok: false, reason: '원본을 찾을 수 없습니다 — 지워졌거나 옮겨졌습니다' };
    }
    if (r.status === 401 || r.status === 403) {
      return { ok: false, reason: '접근 권한이 끊겼습니다 — 파일을 다시 골라 주세요' };
    }
    return { ok: false, reason: r.error || `확인하지 못했습니다 (HTTP ${r.status})` };
  }
  // ★ 임시 주소는 판(rev)을 알려 주지 않는 경우가 많다. **모르면 지어내지 않는다**
  return { ok: true, rev: null, bytes: null };
}

module.exports = { fetchLinked, headLinked, MAX_BYTES };
