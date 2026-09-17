'use strict';
/**
 * vworldkey.js — VWorld 인증키를 **여러 이름으로** 읽는다.
 *
 * ★★★ **왜 만들었나** 〈2026-09-17 사장님: 「VWORLD_DOMAIN ·
 *   LINKPILOT_VWORLD_WEB_KEY · LINKPILOT_VWORLD_REPORT_KEY — 3대 키 넣었어」〉.
 *
 *   실측으로 그 두 이름이 **저장소에 0회**였다. 곧 사장님이 넣으신 열쇠 둘을
 *   **읽는 코드가 한 줄도 없었다.** 「넣었다」와 「쓰인다」는 다른 사실이고,
 *   그 상태는 **아무 오류도 안 낸다** (CLAUDE.md §4.6 — GEMINI 열쇠 15개가
 *   그대로 죽어 있던 자리와 같다).
 *
 * ★ **답은 「다시 넣으시라」가 아니라 «둘 다 읽는 것»이다.** 이 저장소가 같은
 *   사고를 네 번 겪고 정한 규칙이다 (`ECOS_API_KEY`/`ECOS_BOK_KEY` ·
 *   `LAW_OC`/`LAW_OPEN_DATA` · `DATA_GO_KR_KEY`/`APIS_DATA`).
 *
 * ★★ **이름 목록은 여기 한 곳에만 있다.** `vworld.js`(req 계열)와
 *   `nsdi.js`(ned 계열)가 **같은 값**을 읽으므로, 이름표를 두 벌 두면
 *   다음 사람이 한 곳만 고친다 — 그러면 「일부 기능만 된다」가 되고 그 증상은
 *   「키가 틀렸다」와 구분되지 않는다 (§8-1 · `datakey.js` 와 같은 결).
 *
 * ★★★ **열쇠가 여럿이면 «한 번 거부됐다고 접지 않는다».** VWorld 는 키마다
 *   등록 도메인·활용신청이 따로다 — 하나가 거부돼도 다른 하나는 될 수 있다.
 *   그래서 `keys()` 가 **값이 든 것 전부**를 순서대로 준다. 다만 **인증 거부일
 *   때만** 다음 키로 넘어간다: 5xx·못 닿음은 **다른 열쇠로 낫지 않는다**
 *   (§12-11 의 셋째 갈래 잣대 · §12-5 「끊김은 다른 열쇠로 낫지 않는다」).
 *
 * ★ **값은 한 글자도 안 찍는다** (§2). 가리는 일은 `http.js` 의 `SECRET_ENV`
 *   가 한다 — 여기 이름을 더하면 **거기에도 더해야 하고**, 어긋나면
 *   `vworldkey.test.js` 가 빨갛게 끝난다.
 */

/**
 * 받는 이름 — **앞에 있는 것이 이긴다.**
 *
 * ★ `VWORLD_KEY` 가 첫째인 이유: 지금 도는 것이 그것이고, 지침서·안내 문서·
 *   NAS 열쇠 파일이 전부 그 이름으로 적혀 있다. **도는 것을 안 건드린다.**
 *
 * ★★ 그다음 둘의 순서는 **추측이다 — 그래서 그렇게 적어 둔다.** 이름만 보면
 *   `REPORT` 가 서버(보고서 생성)용, `WEB` 이 브라우저(자바스크립트 지도)용으로
 *   읽히지만, **VWorld 콘솔에서 무엇으로 등록되었는지는 여기서 못 잰다.**
 *   추측으로 하나만 고르지 않고 **둘 다 후보로 두고**, 실제로 어느 이름이
 *   먹었는지는 `usedName()` 이 말한다 — 그때 잰 값으로 이 순서를 고친다
 *   (§4.3 「붙이기 전에 실제로 불러본다」).
 */
const KEY_NAMES = [
  'VWORLD_KEY',
  'LINKPILOT_VWORLD_REPORT_KEY',
  'LINKPILOT_VWORLD_WEB_KEY',
];

const val = (n) => String(process.env[n] || '').trim();

/** 실제로 값이 들어 있는 첫 이름. 없으면 null */
function usedName() {
  return KEY_NAMES.find((n) => val(n)) || null;
}

/** 첫 값. 없으면 빈 문자열 — 부르는 쪽은 전부 이 모양을 기대한다 */
function vworldKey() {
  const n = usedName();
  return n ? val(n) : '';
}

function hasKey() {
  return Boolean(vworldKey());
}

/**
 * 값이 든 이름 전부 — **같은 값은 한 번만.**
 *
 * ★ 왜 값으로 중복을 거르나: 사장님이 같은 열쇠를 두 이름으로 넣으실 수 있다.
 *   그때 두 번 부르면 **호출만 두 배**가 되고 한도를 먹는다 (§4.5).
 */
function keys() {
  const seen = new Set();
  const out = [];
  for (const name of KEY_NAMES) {
    const v = val(name);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push({ name, value: v });
  }
  return out;
}

/** 사람에게 보여 줄 이름 목록 */
function namesText() {
  return KEY_NAMES.join(' 또는 ');
}

module.exports = { KEY_NAMES, usedName, vworldKey, hasKey, keys, namesText };
