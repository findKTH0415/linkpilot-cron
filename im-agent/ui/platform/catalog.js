/**
 * catalog.js — 기능 카탈로그. 「LinkPilot 외부 업무지침」 §2 가 원본이다.
 *
 * 왜 파일로 뽑았나:
 *   무료/유료 경계가 membership.html · upgrade.html · reports.html · report-api.cjs
 *   네 곳에 각각 적혀 있었고, 이미 갈려 있었다. 여기에 더해 이제는 협력사에
 *   배포된 종이 지침까지 있다. 어긋나면 "지침에는 된다는데 안 된다"는 문의가
 *   외부에서 들어온다 — 내부 버그와 달리 이건 신뢰 문제가 된다.
 *
 * ★ 규칙: 지침에 적힌 것과 다르게 바꾸려면 지침을 먼저 고친다.
 *   여기서만 고치면 배포된 문서가 거짓말이 된다.
 *
 * ★★ 이 파일은 '무엇을 보여줄지'만 정한다. 권한 강제는 서버가 한다.
 *   (gate-core.js 와 같은 원칙 — 브라우저 코드는 사용자가 고칠 수 있다.)
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 동작한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotCatalog = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * ★ **이 스크립트가 어느 판인가** 〈2026-08-23 · D-93 사고〉.
   *   `build-stamp.js` 가 채운다 — 손으로 고치지 않는다. 화면이 자기
   *   지문과 대 보고 다르면 「함수가 없다」로 죽기 전에 사람 말로 알린다.
   */
  var LP_BUILD = 'fca016d9';

  /** 지침 판(版). 지침을 고치면 이 값도 같이 올린다 */
  var GUIDE = { title: 'LinkPilot 외부 업무지침', asOf: '2026-08-14' };

  /**
   * 지침 §2 「계정과 권한」 표 그대로.
   *
   *   무료 — 할일 · 연락처 · 프로젝트 · 캘린더 · Q&A · 투자소스 DB
   *   유료 — 무료 전체 + 오늘의 한줄생각 · 아침브리핑 · 통화음성분석
   *          · 프리미엄 투자소스 DB · 신재생에너지 분석 · 보고서 생성 (Pro)
   *
   * minPlan 은 실제로 걸리는 플랜이다.
   * byGuide=true 는 지침이 등급까지 못 박은 것 — 마음대로 못 바꾼다.
   * byGuide=false 는 내부 판단 — 지침은 '유료'라고만 했다. 바꿔도 지침과
   * 어긋나지 않지만, 바꾸면 그 등급 회원이 못 쓰게 되므로 확인이 필요하다.
   */
  var FEATURES = [
    // 무료
    { key: 'todo',      icon: '✓',  name: '할일',                minPlan: 'free', byGuide: true },
    { key: 'contacts',  icon: '👤', name: '연락처',              minPlan: 'free', byGuide: true },
    { key: 'projects',  icon: '📁', name: '프로젝트',            minPlan: 'free', byGuide: true },
    { key: 'calendar',  icon: '🗓', name: '캘린더',              minPlan: 'free', byGuide: true },
    { key: 'qna',       icon: '💬', name: 'Q&A',                 minPlan: 'free', byGuide: true },
    { key: 'sourcedb',  icon: '☆',  name: '투자소스 DB',          minPlan: 'free', byGuide: true },
    // 유료
  /* ★★★ **2026-08-26 — 등급을 둘로 맞췄다** 〈D-06 · D-08〉.
   *
   *   살아 있는 앱(`linkpilot-platform.deploy.html`, platform 갈래)에서 직접 쟀다:
   *     · 등급은 **Free / Pro 둘뿐**이다 (`plan:'Free'` · `plan:'Pro'`)
   *     · 앱이 화면에 넘기는 값도 **`planId: isPro ? 'pro' : 'free'`** 뿐이다
   *
   *   여기 있던 `basic` · `business` 는 앱에 **없는 등급**이었다. 그래서
   *   `business` 로 잠근 「신재생에너지 분석」은 **Pro 를 결제해도 안 열렸다** —
   *   PLAN_RANK 로 pro(2) < business(3) 이라 영영 잠긴 채였고, 오류는 안 났다.
   *   D-06 이 걱정한 「결제한 사람이 못 쓴다」가 실제로 나 있었다.
   *
   *   ★ `byGuide: false` 는 그대로 둔다 — 지침은 여전히 「유료」라고만 했다.
   *     등급이 둘이 된 것이지 지침이 등급을 못 박은 것이 아니다.
   */
    { key: 'quote',     icon: '☆',  name: '오늘의 한줄생각',      minPlan: 'pro', byGuide: false },
    { key: 'brief',     icon: '☀',  name: '아침브리핑',           minPlan: 'pro', byGuide: false },
    { key: 'callai',    icon: '📞', name: '통화음성분석',         minPlan: 'pro', byGuide: false },
    { key: 'sourcedb+', icon: '★',  name: '프리미엄 투자소스 DB',  minPlan: 'pro', byGuide: false },
    { key: 'renew',     icon: '🔆', name: '신재생에너지 분석',     minPlan: 'pro', byGuide: false },
    // 지침이 등급까지 적은 유일한 항목
    { key: 'reports',   icon: '📄', name: '보고서 생성',          minPlan: 'pro',      byGuide: true },
  ];

  /** 지침 §2 무료 칸의 항목 이름 — 테스트가 이 순서까지 대조한다 */
  var GUIDE_FREE = ['할일', '연락처', '프로젝트', '캘린더', 'Q&A', '투자소스 DB'];
  var GUIDE_PAID = ['오늘의 한줄생각', '아침브리핑', '통화음성분석',
    '프리미엄 투자소스 DB', '신재생에너지 분석', '보고서 생성'];

  var PLAN_RANK = { free: 0, pro: 1 };   // 앱이 보내는 값이 이 둘뿐이다 (실측 2026-08-26)

  function free() { return FEATURES.filter(function (f) { return f.minPlan === 'free'; }); }
  function paid() { return FEATURES.filter(function (f) { return f.minPlan !== 'free'; }); }

  function byName(name) {
    var want = String(name || '').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < FEATURES.length; i++) {
      if (FEATURES[i].name === want) return FEATURES[i];
    }
    return null;
  }

  /**
   * 이 세션이 기능을 쓸 수 있는가.
   *
   * ★ 지침 §2: "유료 기능은 무료 계정에서도 메뉴에 보이되 잠겨 있습니다."
   *   그래서 '숨김'이 아니라 '잠김'을 돌려준다. 숨기면 무엇이 있는지 몰라
   *   승급을 요청할 이유도 생기지 않는다.
   *
   * 플랜을 모를 때(planId 없음)는 잠근 채로 두되 사유를 구분한다 —
   * 유료 회원인데 화면이 Free 로 보이면 그것도 문의가 된다.
   */
  function unlocked(session, feature) {
    var f = typeof feature === 'string' ? byName(feature) : feature;
    if (!f) return true;                    // 카탈로그에 없는 메뉴는 건드리지 않는다
    if (f.minPlan === 'free') return true;
    var s = session || {};
    if (!s.authenticated) return false;
    if (s.status === 'expired') return false;
    var have = PLAN_RANK[s.planId];
    if (have === undefined) return false;   // null·오타 모두 잠근다
    return have >= PLAN_RANK[f.minPlan];
  }

  /**
   * 사이드바/하단탭의 유료 항목에 자물쇠를 붙인다 (지침 §2).
   *
   * 메뉴는 각 화면에 정적 HTML 로 들어 있다. 화면마다 손으로 lock 클래스를
   * 붙이면 또 갈리므로, 이름으로 찾아 한 번에 칠한다.
   *
   * @param {Document|Element} root
   * @param {object} session
   * @param {string} sel 기본 '.nav'
   * @returns {number} 잠근 개수
   */
  function applyLocks(root, session, sel) {
    if (!root || !root.querySelectorAll) return 0;
    var nodes = root.querySelectorAll(sel || '.nav');
    var n = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var f = byName(labelOf(el));
      if (!f || f.minPlan === 'free') continue;
      var open = unlocked(session, f);
      el.classList.toggle('lock', !open);
      var lk = el.querySelector('.nav__lk');
      if (open) {
        if (lk) lk.remove();
      } else {
        n++;
        if (!lk) {
          lk = el.ownerDocument.createElement('span');
          lk.className = 'nav__lk';
          lk.textContent = '🔒';
          el.appendChild(lk);
        }
        // 잠긴 메뉴는 왜 잠겼는지 알려준다. 그냥 안 눌리면 고장으로 오해한다
        el.title = f.name + ' — ' + planName(f.minPlan) + ' 플랜부터 사용할 수 있습니다';
      }
    }
    return n;
  }

  /** 아이콘·자물쇠를 뺀 메뉴 이름 */
  function labelOf(el) {
    var t = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType === 3) t += c.nodeValue;
      else if (c.nodeType === 1 && !/nav__ic|nav__lk|bot__/.test(c.className || '')) t += c.textContent;
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  var PLAN_NAMES = { free: 'Free', pro: 'Pro' };
  function planName(id) { return PLAN_NAMES[id] || id; }

  return {
    BUILD: LP_BUILD,
    GUIDE: GUIDE, FEATURES: FEATURES, PLAN_RANK: PLAN_RANK, PLAN_NAMES: PLAN_NAMES,
    GUIDE_FREE: GUIDE_FREE, GUIDE_PAID: GUIDE_PAID,
    free: free, paid: paid, byName: byName, unlocked: unlocked,
    applyLocks: applyLocks, labelOf: labelOf, planName: planName,
  };
}));
