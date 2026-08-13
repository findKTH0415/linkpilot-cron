/**
 * app.js — LinkPilot 플랫폼 화면 로직.
 *
 * 데이터는 두 곳에서 온다.
 *   ① NAS sync.php        인맥·프로젝트·할일·일정  (아침 브리핑과 같은 소스)
 *   ② 본체 API /api/linkpilot   IM Agent 제작 현황
 *
 * ★ 한쪽이 죽어도 다른 쪽은 보여준다. 화면 전체를 죽이지 않는다.
 *   NAS 가 죽었는데 "일정 없음"이라고 쓰면 CEO 가 일정이 없는 날로 오해한다 —
 *   못 가져온 것과 없는 것을 반드시 구분해서 표시한다.
 *
 * ★ 날짜는 전부 Asia/Seoul 로 명시 계산한다. 브라우저 로컬타임에 의존하지 않는다
 *   (해외 출장 중 노트북 시간대가 바뀌면 '오늘'이 어긋난다).
 *
 * ★ 값은 전부 textContent 로 넣는다. innerHTML 을 쓰지 않는다 —
 *   인맥·프로젝트 메모는 사용자가 입력한 문자열이다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotApp = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── 날짜 (전부 KST) ───────────────────────────────────────────────

  var KST = 'Asia/Seoul';

  /** KST 기준 'YYYY-MM-DD' */
  function kstYmd(date) {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date || new Date());
  }

  /** 'YYYY년 MM월 DD일 X요일' */
  function kstLabel(date) {
    var parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
    }).formatToParts(date || new Date());
    var get = function (t) { return (parts.find(function (p) { return p.type === t; }) || {}).value || ''; };
    return get('year') + '년 ' + get('month') + '월 ' + get('day') + '일 ' + get('weekday');
  }

  /** n일 전/후의 KST 날짜 문자열 */
  function kstShift(days, from) {
    return kstYmd(new Date((from ? new Date(from) : new Date()).getTime() + days * 86400000));
  }

  /**
   * D-Day. 양수 = 남은 일수, 0 = 오늘, 음수 = 지남.
   * 날짜 문자열끼리 비교하므로 시간대 영향을 받지 않는다.
   */
  function dday(dateStr, today) {
    if (!dateStr) return null;
    var d = String(dateStr).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    var a = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
    var t = today || kstYmd();
    var b = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
    return Math.round((a - b) / 86400000);
  }

  function ddayLabel(n) {
    if (n === null) return '';
    if (n === 0) return 'D-DAY';
    return n > 0 ? 'D-' + n : 'D+' + (-n);
  }

  // ── 데이터 정리 ───────────────────────────────────────────────────

  /** 상태 → 단계 표준화. 아침 브리핑(send-morning-brief.js)과 같은 규칙을 쓴다 */
  function mapToStage(s) {
    s = (s || '').trim();
    if (s === '완료') return '완료';
    if (s === '보류') return '보류';
    if (s === '진행' || s === '해외') return '진행';
    if (s === '타진') return '타진';
    return '접수';
  }

  var STAGES = ['접수', '타진', '진행', '보류', '완료'];

  function todayEvents(events, today) {
    var t = today || kstYmd();
    return (events || [])
      .filter(function (e) { return (e.startDate || e.date || '').slice(0, 10) === t; })
      .sort(function (a, b) { return (a.time || 'zz').localeCompare(b.time || 'zz'); });
  }

  function openTodos(todos, priority) {
    return (todos || []).filter(function (t) {
      if (t.status === '완료') return false;
      return priority === '긴급' ? t.priority === '긴급' : t.priority !== '긴급';
    });
  }

  /** 최근 N일 내 접수된 프로젝트 */
  function recentIntake(projects, days, today) {
    var since = kstShift(-(days || 15), (today || kstYmd()) + 'T00:00:00Z');
    var key = function (p) { return String(p.updatedAt || p.createdAt || p.dueDate || '').slice(0, 10); };
    return (projects || [])
      .filter(function (p) { return mapToStage(p.status) === '접수'; })
      .filter(function (p) { var k = key(p); return k && k >= since; })
      .sort(function (a, b) { return key(b).localeCompare(key(a)); });
  }

  function byStage(projects, stage) {
    if (!stage || stage === '전체') return (projects || []).slice();
    return (projects || []).filter(function (p) { return mapToStage(p.status) === stage; });
  }

  /** 프로젝트 검색 — 제목·클라이언트·메모 */
  function searchProjects(projects, q) {
    var s = String(q || '').trim().toLowerCase();
    if (!s) return (projects || []).slice();
    return (projects || []).filter(function (p) {
      return [p.title, p.client, p.memo, p.status].join(' ').toLowerCase().indexOf(s) > -1;
    });
  }

  /** 인맥 검색 — 이름·소속·딜·소개자 */
  function searchContacts(contacts, q) {
    var s = String(q || '').trim().toLowerCase();
    if (!s) return (contacts || []).slice();
    return (contacts || []).filter(function (c) {
      return [c.name, c.org, c.deal, c.referrer, (c.tags || []).join(' ')]
        .join(' ').toLowerCase().indexOf(s) > -1;
    });
  }

  /** 전화번호 필드가 데이터마다 달라서 후보를 순서대로 본다 */
  function phoneOf(c) {
    var v = c.phone || c.mobile || c.tel || c.hp || c.phoneNumber || '';
    var digits = String(v).replace(/[^0-9]/g, '');
    return digits.length >= 9 ? digits : null;
  }

  /** 활동량 점수 — 아침 브리핑의 '연락_활동활발TOP5'와 같은 가중치 */
  function activityScore(c) {
    return (c.timeline || []).length * 2 + (c.referrer ? 2 : 0) + (c.deal ? 1 : 0);
  }

  // ── DOM ───────────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null && text !== '') n.textContent = String(text);
    return n;
  }

  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }

  function link(cls, text, href) {
    var a = el('a', cls, text);
    a.href = href;
    if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  }

  function mapLink(place) {
    return 'https://map.naver.com/p/search/' + encodeURIComponent(place);
  }

  function card(title, count) {
    var c = el('section', 'lp-card');
    var h = el('h2', 'lp-card__title', title);
    if (count !== undefined && count !== null) h.appendChild(el('span', 'lp-card__count', count));
    c.appendChild(h);
    return c;
  }

  /**
   * ★ 비어 있음과 못 가져옴을 구분한다.
   *   NAS 가 죽었는데 "일정 없음"으로 보이면 CEO 가 오판한다.
   */
  function emptyOrFailed(state, emptyText) {
    if (state.nasError) {
      return el('p', 'lp-empty lp-empty--failed',
        'NAS 조회 실패 — 확인되지 않았습니다 (' + state.nasError + ')');
    }
    return el('p', 'lp-empty', emptyText);
  }

  // ── 화면: 오늘 ────────────────────────────────────────────────────

  function viewToday(state) {
    var wrap = el('div', 'lp-grid');
    var d = state.data || {};
    var today = state.today;

    // 오늘의 일정
    var evs = todayEvents(d.events, today);
    var c1 = card('오늘의 일정', evs.length);
    if (!evs.length) c1.appendChild(emptyOrFailed(state, '오늘 일정이 없습니다.'));
    else {
      var ul = el('ul', 'lp-list');
      evs.forEach(function (e) {
        var li = el('li', 'lp-item');
        var head = el('div', 'lp-item__head');
        add(head, el('span', 'lp-time', e.time || '시간 미정'), el('span', 'lp-item__title', e.title || '(제목 없음)'));
        li.appendChild(head);
        var attendees = Array.isArray(e.attendees) ? e.attendees.join(', ') : (e.attendees || '');
        if (attendees) li.appendChild(el('div', 'lp-item__sub', '참석 ' + attendees));
        if (e.location) li.appendChild(add(el('div', 'lp-item__sub'), link('lp-link', '📍 ' + e.location, mapLink(e.location))));
        ul.appendChild(li);
      });
      c1.appendChild(ul);
    }
    wrap.appendChild(c1);

    // 할일 — 긴급 / 보통
    [['긴급', '반드시 처리할 업무', 'urgent'], ['보통', '그 외 업무', '']].forEach(function (row) {
      var items = openTodos(d.todos, row[0]);
      var c = card(row[1], items.length);
      if (row[2]) c.classList.add('lp-card--urgent');
      if (!items.length) c.appendChild(emptyOrFailed(state, '없습니다.'));
      else {
        var ul = el('ul', 'lp-list');
        items.slice(0, 20).forEach(function (t) {
          var li = el('li', 'lp-item');
          li.appendChild(el('div', 'lp-item__title', t.text || '(내용 없음)'));
          var due = t.date || t.dueDate || '';
          var n = dday(due, today);
          var sub = el('div', 'lp-item__sub');
          if (due) {
            var chip = el('span', 'lp-chip' + (n !== null && n < 0 ? ' lp-chip--over' : n === 0 ? ' lp-chip--today' : ''),
              due.slice(0, 10) + (n !== null ? ' · ' + ddayLabel(n) : ''));
            sub.appendChild(chip);
          }
          var who = t.referrer || t.manager || '';
          if (who) sub.appendChild(el('span', 'lp-muted', ' ' + who));
          if (sub.childNodes.length) li.appendChild(sub);
          ul.appendChild(li);
        });
        c.appendChild(ul);
      }
      wrap.appendChild(c);
    });

    // 신규 접수 (15일)
    var intake = recentIntake(d.projects, 15, today);
    var c4 = card('신규 접수 (최근 15일)', intake.length);
    if (!intake.length) c4.appendChild(emptyOrFailed(state, '최근 15일 신규 접수가 없습니다.'));
    else {
      var ul4 = el('ul', 'lp-list');
      intake.slice(0, 12).forEach(function (p) {
        var li = el('li', 'lp-item');
        li.appendChild(el('div', 'lp-item__title', p.title || '(제목 없음)'));
        var sub = el('div', 'lp-item__sub');
        if (p.client) sub.appendChild(el('span', 'lp-muted', p.client));
        if (p.memo) sub.appendChild(el('span', 'lp-item__memo', ' ' + String(p.memo).replace(/\s+/g, ' ').slice(0, 60)));
        li.appendChild(sub);
        ul4.appendChild(li);
      });
      c4.appendChild(ul4);
    }
    wrap.appendChild(c4);

    return wrap;
  }

  // ── 화면: 프로젝트 ────────────────────────────────────────────────

  function viewProjects(state) {
    var wrap = el('div');
    var d = state.data || {};

    var bar = el('div', 'lp-toolbar');
    var tabs = el('div', 'lp-tabs');
    ['전체'].concat(STAGES).forEach(function (s) {
      var n = s === '전체' ? (d.projects || []).length : byStage(d.projects, s).length;
      var b = el('button', 'lp-tab' + (state.stage === s ? ' is-active' : ''), s + ' ' + n);
      b.type = 'button';
      b.addEventListener('click', function () { state.stage = s; state.draw(); });
      tabs.appendChild(b);
    });
    bar.appendChild(tabs);

    var search = el('input', 'lp-search');
    search.type = 'search';
    search.placeholder = '제목·고객·메모 검색';
    search.value = state.projectQuery || '';
    search.addEventListener('input', function () {
      state.projectQuery = search.value;
      state.drawInto('lp-project-list', projectList(state));
    });
    bar.appendChild(search);
    wrap.appendChild(bar);

    var host = el('div', 'lp-grid');
    host.id = 'lp-project-list';
    host.appendChild(projectList(state));
    wrap.appendChild(host);
    return wrap;
  }

  function projectList(state) {
    var frag = document.createDocumentFragment();
    var rows = searchProjects(byStage((state.data || {}).projects, state.stage), state.projectQuery);

    if (!rows.length) {
      frag.appendChild(emptyOrFailed(state, '해당 조건의 프로젝트가 없습니다.'));
      return frag;
    }
    rows.slice(0, 200).forEach(function (p) {
      var c = el('article', 'lp-card lp-card--project');
      var head = el('div', 'lp-project__head');
      add(head, el('h3', 'lp-project__title', p.title || '(제목 없음)'),
        el('span', 'lp-stage lp-stage--' + mapToStage(p.status), p.status || '접수'));
      c.appendChild(head);

      var meta = el('div', 'lp-item__sub');
      if (p.client) meta.appendChild(el('span', 'lp-muted', p.client));
      var n = dday(p.dueDate, state.today);
      if (n !== null) {
        meta.appendChild(el('span', 'lp-chip' + (n < 0 ? ' lp-chip--over' : n === 0 ? ' lp-chip--today' : ''),
          p.dueDate.slice(0, 10) + ' · ' + ddayLabel(n)));
      }
      if (meta.childNodes.length) c.appendChild(meta);
      if (p.memo) c.appendChild(el('p', 'lp-project__memo', String(p.memo).replace(/\s+/g, ' ')));
      frag.appendChild(c);
    });
    return frag;
  }

  // ── 화면: 인맥 ────────────────────────────────────────────────────

  function viewContacts(state) {
    var wrap = el('div');

    var bar = el('div', 'lp-toolbar');
    var search = el('input', 'lp-search lp-search--wide');
    search.type = 'search';
    search.placeholder = '이름·소속·딜·소개자 검색';
    search.value = state.contactQuery || '';
    search.addEventListener('input', function () {
      state.contactQuery = search.value;
      state.drawInto('lp-contact-list', contactList(state));
    });
    bar.appendChild(search);
    wrap.appendChild(bar);

    var host = el('div', 'lp-grid lp-grid--contacts');
    host.id = 'lp-contact-list';
    host.appendChild(contactList(state));
    wrap.appendChild(host);
    return wrap;
  }

  function contactList(state) {
    var frag = document.createDocumentFragment();
    var all = (state.data || {}).contacts || [];
    var rows = searchContacts(all, state.contactQuery);

    if (!rows.length) {
      frag.appendChild(emptyOrFailed(state,
        state.contactQuery ? '검색 결과가 없습니다.' : '인맥 데이터가 없습니다.'));
      return frag;
    }

    // 검색어가 없으면 활동량 순으로 보여준다 (1,000건 넘는 목록을 이름순으로 주면 못 쓴다)
    if (!state.contactQuery) {
      rows = rows.slice().sort(function (a, b) { return activityScore(b) - activityScore(a); });
    }

    var shown = rows.slice(0, 100);
    shown.forEach(function (c) {
      var box = el('article', 'lp-card lp-card--contact');
      box.appendChild(el('h3', 'lp-contact__name', c.name || '(이름 없음)'));
      if (c.org) box.appendChild(el('div', 'lp-item__sub', c.org));

      var chips = el('div', 'lp-chips');
      if (c.deal) chips.appendChild(el('span', 'lp-chip', c.deal));
      if (c.referrer) chips.appendChild(el('span', 'lp-chip lp-chip--soft', '소개 ' + c.referrer));
      (c.tags || []).slice(0, 3).forEach(function (t) { chips.appendChild(el('span', 'lp-chip lp-chip--soft', t)); });
      if (chips.childNodes.length) box.appendChild(chips);

      // ★ 인맥은 눌러서 바로 전화가 걸려야 쓴다 (CLAUDE.md §6 — 모든 항목은 액션 가능하게)
      var tel = phoneOf(c);
      if (tel) box.appendChild(link('lp-btn lp-btn--tel', '전화', 'tel:' + tel));
      frag.appendChild(box);
    });

    if (rows.length > shown.length) {
      frag.appendChild(el('p', 'lp-empty', rows.length + '건 중 ' + shown.length + '건 표시 — 검색으로 좁히세요.'));
    }
    return frag;
  }

  // ── 화면: IM Control Tower ────────────────────────────────────────

  function viewTower(state) {
    var wrap = el('div');
    var bar = el('div', 'lp-toolbar');
    var host = el('div');
    host.id = 'lp-tower-host';

    var projects = state.imProjects;
    if (projects === null) {
      bar.appendChild(el('p', 'lp-empty', 'IM 프로젝트 목록을 불러오는 중…'));
    } else if (!projects.length) {
      bar.appendChild(el('p', 'lp-empty lp-empty--failed',
        'IM 프로젝트가 없거나 API(' + state.apiBase + ')에 연결되지 않았습니다. '
        + '본체 서버에 /api/linkpilot 라우터가 붙어 있는지 확인하세요.'));
    } else {
      var label = el('label', 'lp-field', '프로젝트');
      var sel = el('select', 'lp-select');
      projects.forEach(function (p) {
        var o = el('option', null, p.id + (p.name ? ' — ' + p.name : ''));
        o.value = p.id;
        if (p.id === state.imProjectId) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        state.imProjectId = sel.value;
        mountTower(state);
      });
      label.appendChild(sel);
      bar.appendChild(label);
    }

    wrap.appendChild(bar);
    wrap.appendChild(host);
    return wrap;
  }

  function mountTower(state) {
    var host = document.getElementById('lp-tower-host');
    if (!host || !state.imProjectId || !window.LinkPilotControlTower) return;
    if (state.tower) state.tower.stop();
    host.textContent = '';
    state.tower = window.LinkPilotControlTower.mount(host, {
      projectId: state.imProjectId,
      baseUrl: state.apiBase,
    });
  }

  // ── 내 정보 · 멤버십 ──────────────────────────────────────────────
  //
  // ★ 요금·플랜 내용은 코드가 아니라 설정(LINKPILOT_CONFIG.plans)에서 온다.
  //   가격을 코드에 박으면 바꿀 때마다 배포해야 하고, 잘못된 금액이 화면에 남는다.
  //   설정에 가격이 없으면 지어내지 않고 '문의'로 표시한다.
  //
  // ★ 결제 정보(카드번호 등)를 이 화면에서 받지 않는다.
  //   결제는 결제대행사 페이지로 보낸다 — 카드정보를 직접 받으면 PCI 범위에 들어간다.

  var DEFAULT_PLANS = [
    {
      id: 'free', name: 'Free', price: null, period: '월',
      features: ['프로젝트 3건', 'IM 생성 월 1회', '공공데이터 조회 제한', '커뮤니티 지원'],
    },
    {
      id: 'pro', name: 'Pro', price: null, period: '월', recommended: true,
      features: ['프로젝트 20건', 'IM·티저 무제한', '감정평가 · 3D 매싱 포함', '최종검증 8 GATE', '이메일 지원'],
    },
    {
      id: 'enterprise', name: 'Enterprise', price: null, period: '월',
      features: ['프로젝트 무제한', '온프레미스 설치', '전용 디자인 테마', 'API 연동 지원', '전담 지원'],
    },
  ];

  /**
   * 멤버십 상태 정리.
   * 설정이 없으면 '연동 전'으로 명시한다 — 무료 회원으로 단정하지 않는다.
   * (실제로는 유료인데 화면이 Free 로 보이면 문의가 들어온다.)
   */
  function membership(cfg, today) {
    var m = (cfg && cfg.membership) || null;
    var plans = (cfg && cfg.plans) || DEFAULT_PLANS;
    if (!m) {
      return { linked: false, plans: plans, planId: null, planName: '연동 전', status: null, until: null, daysLeft: null };
    }
    var left = m.until ? dday(m.until, today) : null;
    var plan = plans.find(function (p) { return p.id === m.planId; }) || null;
    return {
      linked: true,
      plans: plans,
      planId: m.planId || null,
      planName: (plan && plan.name) || m.planId || '알 수 없음',
      status: m.status || (left !== null && left < 0 ? 'expired' : 'active'),
      until: m.until || null,
      daysLeft: left,
      expiringSoon: left !== null && left >= 0 && left <= 14,
      usage: m.usage || null,
    };
  }

  function formatPrice(p) {
    if (p === null || p === undefined || p === '') return '문의';
    return typeof p === 'number' ? p.toLocaleString('ko-KR') + '원' : String(p);
  }

  function openMyInfo(state) {
    var cfg = state.cfg;
    var me = cfg.me || {};
    var m = membership(cfg, state.today);

    var overlay = el('div', 'lp-modal');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '내 정보');

    var box = el('div', 'lp-modal__box');
    var head = el('div', 'lp-modal__head');
    head.appendChild(el('h2', 'lp-modal__title', '내 정보'));
    var close = el('button', 'lp-modal__close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', '닫기');
    head.appendChild(close);
    box.appendChild(head);

    var body = el('div', 'lp-modal__body');

    // ① 계정
    var acc = el('section', 'lp-mysec');
    acc.appendChild(el('h3', 'lp-mysec__title', '계정'));
    var dl = el('dl', 'lp-kv');
    [['이름', me.name], ['이메일', me.email], ['소속', me.org], ['역할', me.role]].forEach(function (row) {
      dl.appendChild(el('dt', null, row[0]));
      dl.appendChild(el('dd', row[1] ? null : 'lp-muted', row[1] || '미설정'));
    });
    acc.appendChild(dl);
    body.appendChild(acc);

    // ② 멤버십 현황
    var cur = el('section', 'lp-mysec');
    cur.appendChild(el('h3', 'lp-mysec__title', '멤버십'));

    if (!m.linked) {
      cur.appendChild(el('p', 'lp-empty lp-empty--failed',
        '멤버십 정보가 연동되지 않았습니다 — 서버에서 LINKPILOT_CONFIG.membership 을 내려주면 표시됩니다.'));
    } else {
      var badge = el('div', 'lp-plan-badge lp-plan-badge--' + (m.status || 'active'));
      badge.appendChild(el('span', 'lp-plan-badge__name', m.planName));
      badge.appendChild(el('span', 'lp-plan-badge__status',
        m.status === 'expired' ? '만료됨' : m.status === 'trial' ? '체험' : '이용 중'));
      cur.appendChild(badge);

      var kv = el('dl', 'lp-kv');
      if (m.until) {
        kv.appendChild(el('dt', null, m.status === 'expired' ? '만료일' : '다음 갱신일'));
        kv.appendChild(el('dd', null, m.until.slice(0, 10) + (m.daysLeft !== null ? ' · ' + ddayLabel(m.daysLeft) : '')));
      }
      if (m.usage) {
        Object.keys(m.usage).forEach(function (k) {
          var u = m.usage[k];
          kv.appendChild(el('dt', null, k));
          kv.appendChild(el('dd', null, u.used + (u.limit === null || u.limit === undefined ? ' (무제한)' : ' / ' + u.limit)));
        });
      }
      if (kv.childNodes.length) cur.appendChild(kv);

      // 만료가 임박하면 눈에 띄게 알린다. 만료되면 IM 생성이 막힌다
      if (m.status === 'expired') {
        cur.appendChild(el('p', 'lp-banner lp-banner--bad', '멤버십이 만료되었습니다. 갱신 전까지 유료 기능을 쓸 수 없습니다.'));
      } else if (m.expiringSoon) {
        cur.appendChild(el('p', 'lp-banner', '갱신일이 ' + m.daysLeft + '일 남았습니다.'));
      }
    }
    body.appendChild(cur);

    // ③ 플랜
    var plansSec = el('section', 'lp-mysec');
    plansSec.appendChild(el('h3', 'lp-mysec__title', '플랜'));
    var grid = el('div', 'lp-plans');

    m.plans.forEach(function (p) {
      var isCurrent = m.linked && p.id === m.planId;
      var cardEl = el('article', 'lp-plan'
        + (p.recommended ? ' lp-plan--rec' : '')
        + (isCurrent ? ' lp-plan--current' : ''));

      if (p.recommended && !isCurrent) cardEl.appendChild(el('span', 'lp-plan__tag', '추천'));
      if (isCurrent) cardEl.appendChild(el('span', 'lp-plan__tag lp-plan__tag--cur', '현재 플랜'));

      cardEl.appendChild(el('h4', 'lp-plan__name', p.name));
      var price = el('div', 'lp-plan__price', formatPrice(p.price));
      if (p.price !== null && p.price !== undefined && p.price !== '') {
        price.appendChild(el('span', 'lp-plan__period', ' / ' + (p.period || '월')));
      }
      cardEl.appendChild(price);

      var ul = el('ul', 'lp-plan__features');
      (p.features || []).forEach(function (f) { ul.appendChild(el('li', null, f)); });
      cardEl.appendChild(ul);

      var btn = el('button', 'lp-btn lp-btn--primary', isCurrent ? '이용 중' : '이 플랜으로 변경');
      btn.type = 'button';
      btn.disabled = isCurrent;
      btn.addEventListener('click', function () { requestUpgrade(state, p, body); });
      cardEl.appendChild(btn);

      grid.appendChild(cardEl);
    });
    plansSec.appendChild(grid);
    plansSec.appendChild(el('p', 'lp-note',
      '가격·구성은 서버 설정(LINKPILOT_CONFIG.plans)에서 내려옵니다. 표시된 값이 실제와 다르면 설정을 확인하세요.'));
    body.appendChild(plansSec);

    box.appendChild(body);
    overlay.appendChild(box);

    function shut() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') shut(); }
    close.addEventListener('click', shut);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) shut(); });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    close.focus();
  }

  /**
   * 플랜 변경 요청.
   * ★ 이 화면에서 카드번호를 받지 않는다. 결제대행사 페이지로 보낸다.
   *   결제 URL 이 설정되지 않았으면 지어내지 않고, 무엇이 필요한지 적는다.
   */
  function requestUpgrade(state, plan, body) {
    var url = state.cfg.billingUrl;
    if (url) {
      var sep = url.indexOf('?') > -1 ? '&' : '?';
      window.open(url + sep + 'plan=' + encodeURIComponent(plan.id), '_blank', 'noopener');
      return;
    }
    var old = body.querySelector('.lp-upgrade-note');
    if (old) old.remove();
    var note = el('div', 'lp-banner lp-upgrade-note');
    note.textContent = '결제 연동이 아직 없습니다 (' + plan.name + ' 선택됨). '
      + 'LINKPILOT_CONFIG.billingUrl 에 결제 페이지 주소를 넣으면 이 버튼이 그리로 연결됩니다.';
    body.appendChild(note);
    note.scrollIntoView({ block: 'nearest' });
  }

  // ── 앱 ────────────────────────────────────────────────────────────

  var VIEWS = [
    { id: 'today', label: '오늘', render: viewToday },
    { id: 'projects', label: '프로젝트', render: viewProjects },
    { id: 'contacts', label: '인맥', render: viewContacts },
    { id: 'tower', label: 'IM 제작현황', render: viewTower },
  ];

  function config() {
    var c = window.LINKPILOT_CONFIG || {};
    var q = new URLSearchParams(location.search);
    return {
      nas: (q.get('nas') || c.nas || '').replace(/\/$/, ''),
      api: (q.get('api') || c.api || '/api/linkpilot').replace(/\/$/, ''),
      me: c.me || null,
      membership: c.membership || null,
      plans: c.plans || null,
      billingUrl: c.billingUrl || null,
    };
  }

  function mount(container) {
    var cfg = config();
    var state = {
      cfg: cfg,
      view: (location.hash.replace(/^#/, '').split('/')[0]) || 'today',
      today: kstYmd(),
      data: null,
      nasError: null,
      apiBase: cfg.api,
      imProjects: null,
      imProjectId: null,
      stage: '전체',
      projectQuery: '',
      contactQuery: '',
      tower: null,
    };

    function drawInto(id, node) {
      var host = document.getElementById(id);
      if (!host) return;
      host.textContent = '';
      host.appendChild(node);
    }
    state.drawInto = drawInto;

    function draw() {
      container.textContent = '';
      container.className = 'lp-app';

      var header = el('header', 'lp-header');
      var brand = el('div', 'lp-brand');
      add(brand, el('span', 'lp-brand__name', 'LinkPilot'), el('span', 'lp-brand__date', kstLabel()));
      header.appendChild(brand);

      // 내 정보 — 별도 창(모달)으로 띄운다. 화면 전환이 아니라서 보던 내용이 유지된다
      var mineBtn = el('button', 'lp-mine', '내 정보');
      mineBtn.type = 'button';
      var mNow = membership(cfg, state.today);
      if (mNow.linked) {
        mineBtn.appendChild(el('span', 'lp-mine__plan'
          + (mNow.status === 'expired' ? ' lp-mine__plan--bad' : ''), mNow.planName));
      }
      mineBtn.addEventListener('click', function () { openMyInfo(state); });
      header.appendChild(mineBtn);

      var nav = el('nav', 'lp-nav');
      VIEWS.forEach(function (v) {
        var b = el('button', 'lp-nav__btn' + (state.view === v.id ? ' is-active' : ''), v.label);
        b.type = 'button';
        b.addEventListener('click', function () { location.hash = v.id; });
        nav.appendChild(b);
      });
      header.appendChild(nav);
      container.appendChild(header);

      // NAS 실패는 화면 맨 위에 한 번만 알린다. 각 카드에도 '확인되지 않음'이 뜬다.
      if (state.nasError && state.view !== 'tower') {
        container.appendChild(el('p', 'lp-banner',
          'NAS(' + (cfg.nas || '미설정') + ') 조회 실패 — 아래 정보는 확인되지 않았습니다. 사유: ' + state.nasError));
      }

      var main = el('main', 'lp-main');
      var view = VIEWS.find(function (v) { return v.id === state.view; }) || VIEWS[0];
      main.appendChild(view.render(state));
      container.appendChild(main);

      if (state.view === 'tower') mountTower(state);
    }
    state.draw = draw;

    window.addEventListener('hashchange', function () {
      var next = location.hash.replace(/^#/, '').split('/')[0] || 'today';
      if (next === state.view) return;
      if (state.tower) { state.tower.stop(); state.tower = null; }
      state.view = next;
      draw();
    });

    draw();

    // ① NAS — 없으면 조용히 건너뛴다 (IM 제작현황만 쓸 수도 있다)
    if (cfg.nas) {
      // ★ 커스텀 헤더를 붙이지 않는다.
      //   cache-control 같은 헤더를 넣으면 단순요청이 아니게 되어 CORS 프리플라이트(OPTIONS)가
      //   먼저 날아가고, NAS 가 Access-Control-Allow-Headers 를 안 주면 통째로 실패한다.
      //   캐시는 ?t= 로 이미 무력화되므로 헤더는 불필요하다.
      //   (페이지와 NAS 가 다른 출처면 NAS 응답에 Access-Control-Allow-Origin 이 필요하다.)
      fetch(cfg.nas + '/sync.php?t=' + Date.now())
        .then(function (r) { if (!r.ok) throw new Error('sync.php HTTP ' + r.status); return r.json(); })
        .then(function (j) { state.data = j && typeof j === 'object' ? j : {}; state.nasError = null; draw(); })
        .catch(function (e) { state.nasError = e.message; draw(); });
    } else {
      state.nasError = 'NAS 주소 미설정 (LINKPILOT_CONFIG.nas)';
      draw();
    }

    // ② IM Agent 목록
    fetch(cfg.api + '/projects')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        state.imProjects = (j && j.projects) || [];
        if (!state.imProjectId && state.imProjects.length) state.imProjectId = state.imProjects[0].id;
        if (state.view === 'tower') draw();
      })
      .catch(function () { state.imProjects = []; if (state.view === 'tower') draw(); });

    return state;
  }

  return {
    mount: mount,
    // 순수 로직 — 테스트 대상
    kstYmd: kstYmd, kstLabel: kstLabel, kstShift: kstShift, dday: dday, ddayLabel: ddayLabel,
    mapToStage: mapToStage, STAGES: STAGES, VIEWS: VIEWS,
    todayEvents: todayEvents, openTodos: openTodos, recentIntake: recentIntake,
    byStage: byStage, searchProjects: searchProjects, searchContacts: searchContacts,
    phoneOf: phoneOf, activityScore: activityScore,
    membership: membership, formatPrice: formatPrice, DEFAULT_PLANS: DEFAULT_PLANS,
  };
}));
