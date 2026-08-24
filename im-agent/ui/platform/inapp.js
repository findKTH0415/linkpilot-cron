/**
 * inapp.js — 메신저 인앱 브라우저 감지 및 탈출 배너. 「외부 업무지침」 §1.
 *
 * 왜 필요한가:
 *   지침은 "앱 상단에 [외부 브라우저로 열기] 배너가 나오면 그것을 눌러 주시고,
 *   배너가 없으면 주소를 복사해 붙여넣으라"고 안내한다. 그런데 그 배너가
 *   실제로는 없었다. 지침만 있고 기능이 없으면 지침이 거짓말이 된다.
 *
 * 인앱 브라우저에서 실제로 깨지는 것:
 *   - window.open / target=_blank 가 무시된다 (새 창이 안 열린다)
 *   - <a download> 와 Blob 다운로드가 조용히 실패한다
 *   - 파일 선택창이 사진첩만 열리거나 아예 안 열린다
 *   증상이 전부 '아무 일도 안 일어남'이라 사용자는 서버가 죽은 줄 안다.
 *
 * ★ 오탐이 더 나쁘다. 정상 브라우저에 "브라우저를 바꾸라"는 배너를 띄우면
 *   멀쩡한 사용자가 못 쓰는 줄 안다. 그래서 화이트리스트(정상 브라우저)를
 *   먼저 확인하고, 확실한 인앱 서명만 잡는다.
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 동작한다(감지 함수는 순수함수).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotInApp = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * ★ **이 스크립트가 어느 판인가** 〈2026-08-23 · D-93 사고〉.
   *   `build-stamp.js` 가 채운다 — 손으로 고치지 않는다. 화면이 자기
   *   지문과 대 보고 다르면 「함수가 없다」로 죽기 전에 사람 말로 알린다.
   */
  var LP_BUILD = '7ccb1b42';

  /**
   * 확실한 인앱 서명만 넣는다. 애매한 것은 넣지 않는다 —
   * 못 잡으면 사용자가 불편한 정도지만, 잘못 잡으면 정상 사용자를 쫓아낸다.
   */
  var APPS = [
    { id: 'kakaotalk', name: '카카오톡', re: /KAKAOTALK/i },
    { id: 'kakaostory', name: '카카오스토리', re: /KAKAOSTORY/i },
    { id: 'line', name: '라인', re: /\bLine\//i },
    { id: 'facebook', name: '페이스북', re: /FBAN|FBAV|FB_IAB/i },
    { id: 'instagram', name: '인스타그램', re: /Instagram/i },
    { id: 'naver', name: '네이버 앱', re: /NAVER\(inapp/i },
    { id: 'daum', name: '다음 앱', re: /DaumApps/i },
    { id: 'band', name: '밴드', re: /\bBAND\//i },
    { id: 'wechat', name: '위챗', re: /MicroMessenger/i },
  ];

  /** 이 서명이 있으면 인앱이 아니다 (정상 브라우저) */
  var REAL = /SamsungBrowser|Whale|FxiOS|EdgiOS|CriOS|Edg\//i;

  /**
   * @param {string} ua navigator.userAgent
   * @returns {{inApp:boolean, app:string|null, name:string|null, os:'ios'|'android'|'other'}}
   */
  function detect(ua) {
    var s = String(ua || '');
    var os = /iPhone|iPad|iPod/i.test(s) ? 'ios' : /Android/i.test(s) ? 'android' : 'other';
    if (REAL.test(s)) return { inApp: false, app: null, name: null, os: os };
    for (var i = 0; i < APPS.length; i++) {
      if (APPS[i].re.test(s)) return { inApp: true, app: APPS[i].id, name: APPS[i].name, os: os };
    }
    return { inApp: false, app: null, name: null, os: os };
  }

  /**
   * 탈출 방법. 앱마다 다르고, iOS 는 방법이 없다.
   *
   * @returns {{kind:'scheme'|'intent'|'copy', url:string|null, label:string, hint:string}}
   */
  function escapeRoute(d, url) {
    var u = String(url || '');
    if (d.app === 'kakaotalk') {
      // 카카오톡이 공식으로 여는 스킴. iOS·Android 모두 동작한다
      return { kind: 'scheme', url: 'kakaotalk://web/openExternal?url=' + encodeURIComponent(u),
        label: '외부 브라우저로 열기', hint: '기본 브라우저에서 다시 열립니다.' };
    }
    if (d.app === 'line') {
      return { kind: 'scheme', url: u + (u.indexOf('?') === -1 ? '?' : '&') + 'openExternalBrowser=1',
        label: '외부 브라우저로 열기', hint: '기본 브라우저에서 다시 열립니다.' };
    }
    if (d.os === 'android') {
      // Chrome 을 직접 지정한다. 없으면 아무 일도 안 일어나므로 복사 버튼을 같이 둔다
      return { kind: 'intent', url: 'intent://' + u.replace(/^https?:\/\//, '')
          + '#Intent;scheme=https;package=com.android.chrome;end',
        label: 'Chrome 으로 열기', hint: 'Chrome 이 없으면 아래 주소를 복사해 주세요.' };
    }
    // ★ iOS 인앱은 외부 브라우저를 강제로 열 수 없다. 지침도 '주소 복사'로 안내한다
    return { kind: 'copy', url: null, label: '주소 복사',
      hint: 'Safari 를 열고 붙여넣기 하세요. (iOS 는 앱에서 바로 열 수 없습니다)' };
  }

  /**
   * 배너를 띄운다. 인앱이 아니면 아무것도 하지 않고 null 을 돌려준다.
   *
   * 닫아도 세션 동안만 숨긴다(sessionStorage). 영구 저장하지 않는 이유 —
   * 다음에 파일을 올리려다 또 막히는데, 그때 배너가 없으면 원인을 못 찾는다.
   *
   * @param {object} opts { doc, ua, url, storage }
   */
  function mount(opts) {
    var o = opts || {};
    var doc = o.doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.body) return null;
    var ua = o.ua || (typeof navigator !== 'undefined' ? navigator.userAgent : '');
    var d = detect(ua);
    if (!d.inApp) return null;

    var store = o.storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    try { if (store && store.getItem('lp-inapp-hide') === '1') return null; } catch (e) { /* 접근 차단 환경 */ }

    var url = o.url || (typeof location !== 'undefined' ? location.href : '');
    var r = escapeRoute(d, url);

    var bar = doc.createElement('div');
    bar.className = 'lp-inapp';
    bar.setAttribute('role', 'alert');

    var msg = doc.createElement('div');
    msg.className = 'lp-inapp__msg';
    var strong = doc.createElement('b');
    strong.textContent = d.name + ' 안에서 열렸습니다';
    msg.appendChild(strong);
    var p = doc.createElement('span');
    // 무엇이 안 되는지 먼저 말한다. '권장'만 하면 그냥 쓴다
    p.textContent = ' — 파일 내려받기와 새 창 열기가 되지 않습니다. ' + r.hint;
    msg.appendChild(p);

    var act = doc.createElement('div');
    act.className = 'lp-inapp__act';

    if (r.kind === 'copy') {
      act.appendChild(copyBtn(doc, url, r.label));
    } else {
      var a = doc.createElement('a');
      a.className = 'lp-inapp__btn';
      a.href = r.url;
      a.textContent = r.label;
      act.appendChild(a);
      // 스킴이 막혀 아무 일도 안 일어날 때를 대비해 복사도 같이 준다
      act.appendChild(copyBtn(doc, url, '주소 복사'));
    }

    var x = doc.createElement('button');
    x.type = 'button';
    x.className = 'lp-inapp__x';
    x.setAttribute('aria-label', '배너 닫기');
    x.textContent = '✕';
    x.onclick = function () {
      bar.remove();
      try { if (store) store.setItem('lp-inapp-hide', '1'); } catch (e) { /* 무시 */ }
    };
    act.appendChild(x);

    bar.appendChild(msg);
    bar.appendChild(act);
    doc.body.insertBefore(bar, doc.body.firstChild);
    doc.documentElement.classList.add('has-inapp');
    return bar;
  }

  /** 클립보드 API 는 인앱에서 막히는 경우가 있어 execCommand 로 되돌아간다 */
  function copyBtn(doc, url, label) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'lp-inapp__btn';
    b.textContent = label;
    b.onclick = function () {
      var done = function () { b.textContent = '복사됨'; setTimeout(function () { b.textContent = label; }, 1600); };
      var nav = doc.defaultView && doc.defaultView.navigator;
      if (nav && nav.clipboard && nav.clipboard.writeText) {
        nav.clipboard.writeText(url).then(done, function () { legacy(doc, url, done); });
      } else {
        legacy(doc, url, done);
      }
    };
    return b;
  }

  function legacy(doc, url, done) {
    var ta = doc.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', 'readonly');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    doc.body.appendChild(ta);
    ta.select();
    try { doc.execCommand('copy'); done(); } catch (e) { /* 마지막 수단도 막히면 그대로 둔다 */ }
    ta.remove();
  }

  /** 화면마다 style 을 복사해 붙이지 않도록 CSS 를 여기서 준다 */
  var CSS = [
    '.lp-inapp{position:sticky;top:0;z-index:200;display:flex;gap:10px;align-items:center;',
    'flex-wrap:wrap;padding:10px 14px;background:#17181A;color:#fff;font-size:13px;line-height:1.45}',
    '.lp-inapp__msg{flex:1 1 240px;min-width:0}',
    '.lp-inapp__msg b{color:#9ED700}',
    '.lp-inapp__act{display:flex;gap:8px;align-items:center;flex:none}',
    '.lp-inapp__btn{appearance:none;border:0;border-radius:9px;padding:7px 12px;cursor:pointer;',
    'background:#9ED700;color:#17181A;font-weight:800;font-size:12.5px;text-decoration:none;',
    'font-family:inherit;white-space:nowrap}',
    '.lp-inapp__x{appearance:none;border:0;background:transparent;color:#9AA0A6;',
    'font-size:15px;cursor:pointer;padding:4px 6px;line-height:1}',
    '@media print{.lp-inapp{display:none}}',
  ].join('');

  function injectCss(doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || d.getElementById('lp-inapp-css')) return;
    var s = d.createElement('style');
    s.id = 'lp-inapp-css';
    s.textContent = CSS;
    (d.head || d.documentElement).appendChild(s);
  }

  /** 화면에서는 이것 한 줄만 부르면 된다 */
  function auto(opts) {
    var o = opts || {};
    injectCss(o.doc);
    return mount(o);
  }

  /* ── 링크 가드 — about:blank#blocked 근본 차단 (2026-08-20, 앱 inapp-guard.js 이식) ──
     [왜 여기인가] 이 화면들은 앱(iframe)과 카톡 [자세히 보기] 양쪽에서 열린다. 인앱 웹뷰는
     target="_blank" 새 탭을 못 열어 빈 화면(about:blank#blocked)이 뜬다 — 앱 저장소에서
     6회 재발한 사고다. 화면마다 인라인 주입하면 드리프트라 **이 모듈이 스스로 단다**.
     [원칙] ① 인터셉터는 무조건 등록(감지가 빗나가도 안전) — 감지는 새 탭 허용 판단에만
            ② download 앵커는 건드리지 않는다 ③ window.open 은 감싸되 원본을 보존한다. */
  function guard(doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.defaultView) return false;
    var w = d.defaultView;
    if (w.__lpInAppGuard) return true;
    w.__lpInAppGuard = true;
    var inApp = detect(w.navigator && w.navigator.userAgent || '').inApp;
    var route = function (url) {
      if (!inApp) return false;               // 일반 브라우저 — 네이티브 새 탭 허용
      var r = escapeRoute(detect(w.navigator && w.navigator.userAgent || ''), url);
      if (r.kind === 'scheme' || r.kind === 'intent') {
        try { w.location.href = r.url; } catch (_) {}
        // 스킴이 처리되지 않으면 화면이 그대로 남는다 → 같은 탭 이동 폴백 (앱 가드와 같은 규칙)
        setTimeout(function () { try { if (!w.document.hidden) w.location.href = url; } catch (_) {} }, 1200);
      } else {
        // iOS 인앱 — 외부 브라우저를 강제로 못 연다. 같은 탭으로 연다(빈 화면보다 낫다)
        try { w.location.href = url; } catch (_) {}
      }
      return true;
    };
    d.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[target="_blank"]') : null;
      if (!a || a.hasAttribute('download')) return;
      var url = a.href; if (!url || /^javascript:/i.test(url)) return;
      if (route(url)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    var _open = w.open;
    w.open = function (url, name, feat) {
      if (url && route(String(url))) return null;
      try { return _open ? _open.call(w, url, name, feat) : null; } catch (_) { return null; }
    };
    return true;
  }
  if (typeof document !== 'undefined') { try { guard(document); } catch (_) { /* 화면이 아닌 곳(테스트)에서는 조용히 */ } }

  return { BUILD: LP_BUILD,
    guard: guard, detect: detect, escapeRoute: escapeRoute, mount: mount, auto: auto,
    injectCss: injectCss, CSS: CSS, APPS: APPS };
}));
