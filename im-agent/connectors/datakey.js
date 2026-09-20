'use strict';
/**
 * datakey.js — 공공데이터포털(data.go.kr) 인증키를 **여러 이름으로** 읽는다.
 *
 * ★★★ **왜 한 곳에 두는가** 〈2026-09-13 사장님 지시: 「APIS_DATA 이름으로 넣었어」〉.
 *
 *   이 저장소는 같은 사고를 **세 번** 겪었다 — `ECOS_API_KEY`/`ECOS_BOK_KEY` ·
 *   `LAW_OC`/`LAW_OPEN_DATA` · `CLODE_API_KEY2`. 매번 모습이 같다: 사장님이 값을
 *   넣으셨는데 엔진이 **다른 이름**을 보고 있어서, **아무 오류도 안 나고 조용히
 *   값이 죽는다.** 「넣었다」와 「쓰인다」는 다른 사실이다 (CLAUDE.md §4).
 *
 *   앞의 둘은 커넥터마다 제 이름표를 따로 들고 있었다. 그래도 됐던 것은 그 열쇠를
 *   쓰는 자리가 **하나뿐**이어서다. data.go.kr 은 다르다 — **열 군데가 같은 값을
 *   읽는다**(molit·kpx·fsc·g2b·nts·nps·kasi·customs·enviro·factory).
 *   거기에 이름표를 열 벌 두면 **다음 사람이 아홉 곳만 고친다**. 그러면 「일부 기능만
 *   된다」가 되고, 그 증상은 「키가 틀렸다」와 구분되지 않는다.
 *
 * ★ 그래서 **이름 목록은 여기 한 곳에만** 있다. 새 이름이 생기면 이 줄만 는다.
 *   (§8-1 「두 벌이 되면 한쪽이 옛말을 한다」와 같은 결)
 *
 * ★★ **이름은 «화면에서» 읽는다.** 말씀으로 받은 이름을 그대로 박지 않는다 —
 *   `WORLD_NES_KEY` 라고 들었는데 비밀 목록의 실제 이름은 `WORLDWIDE_NEWS` ·
 *   `WORLD_NEWS_API` 둘이었다 (2026-09-13). 그러니 **어느 이름으로 들어왔는지**를
 *   `usedName()` 이 말해 주고, 값이 없을 때는 **받는 이름을 전부** 적는다.
 *   그래야 사장님이 「내가 넣은 이름이 이 중에 있나」를 눈으로 대실 수 있다.
 *
 * ★★★ **값이 아니라 이름만 말한다.** 이 파일은 값을 한 글자도 찍지 않는다 (§2).
 *   가리는 일은 `http.js` 의 `SECRET_ENV` 가 한다 — 새 이름을 여기 더하면
 *   **거기에도 더해야 한다.** 안 더하면 오류 본문에 평문으로 샐 수 있고,
 *   `datakey.test.js` 가 그 둘이 어긋나면 빨갛게 끝난다.
 */

/**
 * 받는 이름 — **앞에 있는 것이 이긴다.**
 * `DATA_GO_KR_KEY` 가 먼저인 이유는 지침서·안내 문서가 그 이름으로 적혀 있어서다.
 */
/* ★ 셋째 이름 〈2026-09-20 사장님: 「SPECIAL_DAY_INFO 키 넣었어」〉.
     특일정보(`SpcdeInfoService`)를 부르는 `kasi.js` 가 이 창구를 쓴다.
     포털 인증키는 계정당 하나이고 승인만 서비스별이라(§4.2) 같은 값일 수 있지만
     **추측하지 않고 둘 다 읽는다** — 이름이 갈리면 아무 오류 없이 조용히 죽는다
     (`ECOS_API_KEY`/`ECOS_BOK_KEY` · `LAW_OC`/`LAW_OPEN_DATA` 에서 두 번 당했다).
     ★★ 차례는 «앞엣것이 먼저»다 — 이미 도는 것을 새 이름이 덮지 않는다.
       어느 이름이 실제로 들어왔는지는 `usedName()` 이 말하고 진단이 그것을 적는다. */
const KEY_NAMES = ['DATA_GO_KR_KEY', 'APIS_DATA', 'SPECIAL_DAY_INFO'];

/** 실제로 값이 들어 있는 이름. 없으면 null */
function usedName() {
  return KEY_NAMES.find((n) => (process.env[n] || '').trim()) || null;
}

/** 값. 없으면 빈 문자열 — 부르는 쪽은 전부 이 모양을 기대한다 */
function dataKey() {
  const n = usedName();
  return n ? String(process.env[n]).trim() : '';
}

function hasKey() {
  return Boolean(dataKey());
}

/** 사람에게 보여 줄 이름 목록 — 「DATA_GO_KR_KEY 또는 APIS_DATA」 */
function namesText() {
  return KEY_NAMES.join(' 또는 ');
}

module.exports = { KEY_NAMES, usedName, dataKey, hasKey, namesText };
