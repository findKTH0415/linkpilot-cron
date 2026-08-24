/**
 * embed-bridge.js — 앱 안에 얹힌 화면이 **부모에게서 설정을 받는다** (2026-08-18).
 *
 * ★★ 왜 만들었나: 본체가 배포용 사본을 만들면서 **원본 글자를 찾아 끼워 넣고**
 *   있었다(설정 병합·세션·토큰 래퍼 셋). 앵커가 되는 줄이 한 글자만 바뀌어도
 *   치환이 빗나가고, 그러면 **앱 배포가 멈추거나 설정이 안 들어간 사본이 나간다.**
 *   그리고 새 화면(`files.html`)은 그 목록에 없어서 **화면은 뜨는데 목록이 비었다.**
 *
 * ★ 그래서 계약을 **엔진이 갖는다.** 사본은 원본 그대로 복사하면 되고,
 *   본체가 할 일은 iframe 을 만들기 **전에** 전역 하나를 채우는 것뿐이다.
 *
 *   ```js
 *   // 부모(앱)에서 — iframe 을 붙이기 전에
 *   window.LINKPILOT_EMBED = {
 *     common:   { api: '/api/linkpilot', inTab: true, token: lpToken, session: user },
 *     byScreen: { LINKPILOT_REPORT_FLOW: { base: '/im-flow/' } },   // 화면별 추가분
 *   };
 *   ```
 *
 * ★★ **같은 출처라서 읽을 수 있다.** 다른 도메인에 올리면 부모 전역을 못 읽고
 *   (예외가 난다) 화면은 **설정 없이** 뜬다 — 그때 조용히 넘어가지 않고
 *   `window.LinkPilotEmbed.reason` 에 이유를 남긴다. 같은 출처는 iframe 높이
 *   측정에도 필요하므로 어차피 지켜야 하는 조건이다.
 *
 * ★ 단독으로 열면(부모가 없거나 전역이 없으면) **아무 일도 하지 않는다.**
 *   화면이 심어 둔 기본값 그대로 뜬다 — 미리보기가 그대로 동작해야 한다.
 *
 * 의존성 없음. 화면의 **설정 블록 다음, 본체 스크립트 앞**에 놓는다.
 */
(function () {
  'use strict';

  /**
   * ★ **이 스크립트가 어느 판인가** 〈2026-08-23 · D-93 사고〉.
   *   `build-stamp.js` 가 채운다 — 손으로 고치지 않는다.
   */
  var LP_BUILD = 'c760f626';

  var self = document.currentScript;
  var name = self && self.getAttribute('data-lp-global');
  if (!name) return;                       // 어느 전역인지 모르면 손대지 않는다

  var state = { applied: false, reason: null, config: null };

  /** 부모의 설정. **다른 출처면 예외가 난다** — 그것을 이유로 남긴다 */
  function fromParent() {
    if (window.parent === window) { state.reason = '단독으로 열렸습니다 (부모 없음)'; return null; }
    /* ★★ 2026-08-23 D-92 실측 — 직계 부모만 보면 **중첩 화면이 빈손이다.**
     *   3·4·5단계(files/fields/intake)는 report-flow.html 안의 iframe 이라 window.parent 가 앱이 아니라
     *   report-flow 다. 앱은 계약대로 window.LINKPILOT_EMBED 를 채우고 있었다(앱 정본 ReportHubView, 매 렌더).
     *   그래서 「부모가 채우지 않았습니다」가 나오고 토큰이 없어 401 → 「로그인이 필요합니다」.
     *   → 조상을 위로 거슬러 올라가며 처음 만나는 LINKPILOT_EMBED 를 쓴다(같은 출처 안에서만). */
    var w = window, hops = 0;
    try {
      while (w.parent && w.parent !== w && hops < 8) {
        w = w.parent; hops++;
        var cfg = w.LINKPILOT_EMBED;          // 다른 출처면 여기서 예외
        if (cfg) return cfg;
      }
      state.reason = '조상 ' + hops + '단계 어디에도 LINKPILOT_EMBED 가 없습니다';
      return null;
    } catch (e) {
      // 같은 출처가 아니면 여기로 온다. 화면이 「설정 없이」 뜨는 진짜 이유다
      state.reason = '부모를 읽을 수 없습니다 — 같은 출처가 아닙니다 (' + e.name + ', ' + hops + '단계)';
      return null;
    }
  }

  var cfg = fromParent();
  if (cfg) {
    var target = window[name] || (window[name] = {});
    // ★ **대입이 아니라 병합이다.** 대입하면 화면이 심어 둔 기본값 구조가 통째로
    //   날아가고, 부모가 안 넘긴 항목이 undefined 가 된다 (실제 사고)
    var merge = function (src) { if (src) Object.keys(src).forEach(function (k) { target[k] = src[k]; }); };
    merge(cfg.common);
    merge(cfg.byScreen && cfg.byScreen[name]);
    state.applied = true;
    state.reason = null;
    state.config = target;

    // ★ 토큰은 **머무르지 않는다.** 설정에 담아 온 것을 헤더로만 쓰고 전역에서 지운다 —
    //   화면 코드가 실수로 장부·로그에 실을 자리를 만들지 않는다
    var token = target.token || null;
    if ('token' in target) delete target.token;
    if (token) installAuth(token);
  }

  /**
   * 모든 호출에 `Authorization: Bearer` 를 붙인다.
   * ★ **이미 붙어 있으면 건드리지 않는다** — 본체가 자기 래퍼를 쓰고 있을 수 있고,
   *   그때 두 번 덮으면 어느 쪽이 이겼는지 알 수 없게 된다.
   *
   * ★★★ **`fetch` 만 덮으면 안 된다** 〈2026-08-22 · 실제 사고, 세 번 반복됐다〉.
   *
   *   앞 판은 `window.fetch` 하나만 덮었다. 그런데 자료 올리기는 **진행률을
   *   재려고 `XMLHttpRequest`** 를 쓴다(`upload-core.js`). fetch 에는 진행
   *   이벤트가 없어서 그렇게 만든 것이다. 그래서 이렇게 갈렸다:
   *
   *       목록 읽기 (fetch) → Authorization 붙음 → 200
   *       자료 올리기 (XHR) → **안 붙음**      → 401 「로그인이 필요합니다」
   *
   *   ★★ 증상이 **로그인 문제로 보인다는 것**이 이 결함의 진짜 값이다. 사용자는
   *     로그인이 되어 있고 목록도 보고 있는데 「로그인이 필요합니다」를 읽는다.
   *     그래서 로그인을 다시 하고, 세션을 의심하고, 본문 한도를 뒤진다 —
   *     **전부 엉뚱한 자리다.** 실제로 그렇게 세 번 헤맸다.
   *
   *   ★ 그래서 **보내는 길 두 개를 한 함수에서 함께 덮는다.** 하나만 덮는 판을
   *     다시 만들지 않으려면 이 둘이 갈라지지 않아야 한다.
   */
  function installAuth(token) {
    installFetchAuth(token);
    installXhrAuth(token);
  }

  /**
   * 이 주소에 토큰을 붙여도 되는가 — **같은 출처일 때만** 붙인다.
   *
   * ★★ XHR 은 프로토타입을 덮으므로 **화면이 부르는 모든 요청**을 지나간다.
   *   남의 서버로 가는 요청에까지 붙이면 **열쇠를 통째로 넘기는 것**이다.
   *   상대 주소(`/api/...`)와 같은 출처만 통과시킨다.
   */
  function sameOrigin(url) {
    try {
      return new URL(String(url), window.location.href).origin === window.location.origin;
    } catch (_) {
      return false;   // 못 읽으면 안 붙인다 — 모를 때는 안 주는 쪽이 안전하다
    }
  }

  function installFetchAuth(token) {
    var orig = window.fetch;
    if (typeof orig !== 'function' || orig.__lpAuth) return;
    var wrapped = function (input, init) {
      var o = init ? Object.assign({}, init) : {};
      var url = (typeof input === 'object' && input && input.url) || input;
      var h = new Headers(o.headers || (typeof input === 'object' && input && input.headers) || {});
      if (!h.has('Authorization') && sameOrigin(url)) h.set('Authorization', 'Bearer ' + token);
      o.headers = h;
      if (!o.credentials) o.credentials = 'same-origin';
      return orig.call(window, input, o);
    };
    wrapped.__lpAuth = true;
    window.fetch = wrapped;
  }

  /**
   * XHR 에도 같은 헤더를 붙인다.
   *
   * ★ `open` 에서 주소를 기억하고, `send` 직전에 붙인다. 헤더는 `open` 뒤·`send`
   *   앞에만 넣을 수 있어서 이 순서여야 한다.
   * ★ 화면이 이미 손으로 붙였으면 **덮지 않는다** — 어느 쪽이 이겼는지 모르게 된다.
   */
  function installXhrAuth(token) {
    var X = window.XMLHttpRequest;
    if (typeof X !== 'function' || !X.prototype || X.prototype.open.__lpAuth) return;
    var open = X.prototype.open;
    var send = X.prototype.send;
    var setH = X.prototype.setRequestHeader;

    var openWrap = function (method, url) {
      this.__lpUrl = url;
      this.__lpAuthSet = false;
      return open.apply(this, arguments);
    };
    openWrap.__lpAuth = true;
    X.prototype.open = openWrap;

    X.prototype.setRequestHeader = function (k, v) {
      if (String(k).toLowerCase() === 'authorization') this.__lpAuthSet = true;
      return setH.apply(this, arguments);
    };

    X.prototype.send = function () {
      try {
        if (!this.__lpAuthSet && sameOrigin(this.__lpUrl)) {
          setH.call(this, 'Authorization', 'Bearer ' + token);
        }
      } catch (_) { /* 헤더를 못 붙여도 요청 자체는 보낸다 — 서버가 사유를 말한다 */ }
      return send.apply(this, arguments);
    };
  }

  /**
   * 로그인·등급이 **열려 있는 동안 바뀌면** 부모가 알려 준다.
   * 화면은 표시용으로만 쓴다 — **차단은 서버가 한다**(401/403).
   */
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.type !== 'lp-session') return;
    var t = window[name];
    if (!t) return;
    t.session = d.session || { authenticated: d.authenticated, planId: d.pro ? 'pro' : 'free' };
    // 화면이 다시 그릴 기회를 준다. 안 들어도 그만이다 — 다음 렌더에 반영된다
    try { document.dispatchEvent(new CustomEvent('lp-session-change', { detail: t.session })); } catch (_) { /* 오래된 브라우저 */ }
  });

  // 부모가 「언제 준비됐나」를 알아야 높이 측정·설정 확인을 할 수 있다
  try { if (window.parent !== window) window.parent.postMessage({ type: 'lp-embed-ready', global: name, applied: state.applied }, '*'); } catch (_) { /* 막혀 있으면 그만 */ }

  /**
   * 탭 안에 얹혔을 때 **높이를 부모에게 알린다** 〈2026-08-20〉.
   *
   * ★★ 왜: 앱이 iframe 높이를 고정해 두면 화면 안에 **스크롤바가 하나 더** 생긴다.
   *   탭 안에서 또 스크롤하는 것은 앱처럼 안 보이고, 스크롤이 둘이면 사용자는
   *   바깥을 내렸는데 안이 안 내려가는 상태를 만난다.
   *
   * ★ 높이 고정을 푸는 것까지만 여기서 한다 (`height:100%` → 내용만큼).
   *   **넘치는 것을 숨기지는 않는다** — 부모가 안 늘려 주면 내용이 잘리고,
   *   잘린 화면은 스크롤바보다 나쁘다. 부모가 늘려 주면 스크롤바는 저절로 사라진다.
   *
   * ★ 같은 출처로만 보낸다. 값이 안 바뀌면 보내지 않는다 — 리사이즈가
   *   서로를 부르며 도는 것을 막는다.
   */
  (function reportHeight() {
    if (window.parent === window) return;
    var st = document.createElement('style');
    st.id = 'lp-embed-height';
    st.textContent = 'html,body{height:auto!important;min-height:0!important}.app{min-height:0!important}';
    (document.head || document.documentElement).appendChild(st);

    var last = 0;
    var timer = null;
    /**
     * ★★★ **`scrollHeight` 는 화면 높이보다 작아지지 않는다** 〈2026-08-23 · 실제 사고〉.
     *
     *   사장님 화면이 **조금씩 계속 내려갔다.** 빈 칸이 끝없이 늘어났다.
     *
     *   왜: 부모가 이 값에 여백을 더해 iframe 높이를 잡는다. 그러면 자식의
     *   **화면(viewport)이 그만큼 커지고**, `documentElement.scrollHeight` 는
     *   **화면 높이 아래로 내려가지 않으므로** 다음 번에 그 커진 값을 그대로
     *   되돌려준다. 부모가 또 여백을 더한다 — **한 바퀴에 여백만큼씩 영원히 자란다.**
     *
     *   ★ 「값이 안 바뀌면 안 보낸다」는 이 고리를 **못 막는다.** 매번 여백만큼
     *     **진짜로 바뀌기** 때문이다. 막는 장치가 있었는데 이 결에는 안 들었다.
     *
     * ★ 그래서 **내용 높이**를 잰다. `height:auto` 인 문서 뿌리(`documentElement`)의
     *   테두리 상자는 내용만큼이고 **화면 높이에 눌리지 않는다.**
     *   못 재면 옛 방식으로 물러선다.
     *
     *   ※ 이 주석에 **여는 html 태그를 글자 그대로 적지 않는다.** 조각
     *     검사(`build-files.js`)가 주석을 가리지 않고 보기 때문에 진짜
     *     문서로 오인해 올리기를 거부한다 (CLAUDE.md §8).
     */
    function contentHeight() {
      var el = document.documentElement;
      if (el && el.getBoundingClientRect) {
        var r = el.getBoundingClientRect();
        if (r && r.height > 0) return Math.ceil(r.height);
      }
      return Math.max(el ? el.scrollHeight : 0, document.body ? document.body.scrollHeight : 0);
    }
    function tell() {
      var h = contentHeight();
      if (!h || Math.abs(h - last) < 4) return;    // 4px 미만은 알리지 않는다
      last = h;
      try {
        window.parent.postMessage({ type: 'lp-embed-height', global: name, height: h },
          window.location.origin);
      } catch (_) { /* 다른 출처면 막힌다 — 그게 맞다 */ }
    }
    function soon() { clearTimeout(timer); timer = setTimeout(tell, 60); }

    if (document.readyState === 'complete') soon();
    window.addEventListener('load', soon);
    window.addEventListener('resize', soon);
    if (window.MutationObserver) {
      new MutationObserver(soon).observe(document.documentElement,
        { childList: true, subtree: true, attributes: true, characterData: true });
    }
  }());

  window.LinkPilotEmbed = {
    BUILD: LP_BUILD,
    global: name,
    applied: state.applied,
    reason: state.reason,
  };
}());
