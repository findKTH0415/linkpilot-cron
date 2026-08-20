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

  var self = document.currentScript;
  var name = self && self.getAttribute('data-lp-global');
  if (!name) return;                       // 어느 전역인지 모르면 손대지 않는다

  var state = { applied: false, reason: null, config: null };

  /** 부모의 설정. **다른 출처면 예외가 난다** — 그것을 이유로 남긴다 */
  function fromParent() {
    if (window.parent === window) { state.reason = '단독으로 열렸습니다 (부모 없음)'; return null; }
    try {
      var cfg = window.parent.LINKPILOT_EMBED;
      if (!cfg) { state.reason = '부모가 LINKPILOT_EMBED 를 채우지 않았습니다'; return null; }
      return cfg;
    } catch (e) {
      // 같은 출처가 아니면 여기로 온다. 화면이 「설정 없이」 뜨는 진짜 이유다
      state.reason = '부모를 읽을 수 없습니다 — 같은 출처가 아닙니다 (' + e.name + ')';
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
   */
  function installAuth(token) {
    var orig = window.fetch;
    if (typeof orig !== 'function') return;
    window.fetch = function (input, init) {
      var o = init ? Object.assign({}, init) : {};
      var h = new Headers(o.headers || (typeof input === 'object' && input && input.headers) || {});
      if (!h.has('Authorization')) h.set('Authorization', 'Bearer ' + token);
      o.headers = h;
      if (!o.credentials) o.credentials = 'same-origin';
      return orig.call(window, input, o);
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
    function tell() {
      var h = Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0);
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
    global: name,
    applied: state.applied,
    reason: state.reason,
  };
}());
