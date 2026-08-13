/**
 * control-tower.js — Control Tower 대시보드, 순수 JS 판.
 *
 * 본체가 단일 HTML 파일(linkpilot-platform.html)일 때 쓴다.
 * React·빌드 도구·번들러가 필요 없다. 스크립트 태그 두 줄이면 끝이다.
 *
 *   controlTower.css 를 link 로 걸고
 *   <div id="ct"> 를 두고
 *   이 파일을 script src 로 불러온 뒤
 *   LinkPilotControlTower.mount(document.getElementById('ct'), {
 *     projectId: 'LP-DC-2026-001', baseUrl: '/api/linkpilot' })
 *
 * ★ 이 파일을 HTML 안에 통째로 붙여넣을 거라면 닫는 스크립트 태그 문자열이
 *   코드·주석에 들어가지 않게 한다. 브라우저는 그 지점에서 스크립트를 끝내버린다.
 *   (그래서 이 주석에도 태그를 직접 쓰지 않았다.)
 *
 * ★ 클래스명은 React 판과 똑같은 `lp-ct__*` 를 쓴다.
 *   controlTower.css 를 그대로 재사용하기 위해서다 — 스타일시트가 두 벌이 되면
 *   디자인 테마를 바꿨을 때 한쪽만 바뀐다.
 *
 * ★ 표시 로직도 React 판(`../lib.js`)과 같은 결과를 내야 한다.
 *   두 화면이 같은 스냅샷을 다르게 해석하면 어느 쪽이 맞는지 알 수 없다.
 *   `im-agent/test/ui-parity.test.js` 가 두 구현의 출력이 일치하는지 검사한다.
 *
 * ★ 값은 전부 textContent 로 넣는다. innerHTML 을 쓰지 않는다 —
 *   프로젝트명·활동로그는 사용자가 올린 문서에서 나온 문자열이다.
 *
 * 미이식: 데이터 계보 모달(Lineage.jsx). 별도 화면이라 필요할 때 옮긴다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotControlTower = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── 표시 로직 (lib.js 와 동일해야 한다) ──────────────────────────

  var TRACK_ORDER = ['production', 'validation', 'output', 'approval'];

  var AGENT_STATUS_ICON = {
    COMPLETED: '●', WARNING: '▲', RUNNING: '▶', ERROR: '✕',
    WAITING: '○', SKIPPED: '·', BLOCKED: '■', QUEUED: '◇', APPROVED: '✓',
  };

  var AGENT_STATUS_TONE = {
    COMPLETED: 'ok', APPROVED: 'ok',
    RUNNING: 'active', QUEUED: 'active',
    WARNING: 'warn',
    ERROR: 'bad', BLOCKED: 'bad',
    WAITING: 'idle', SKIPPED: 'idle',
  };

  var HEALTH_TONE = { HEALTHY: 'ok', ATTENTION: 'warn', 'AT RISK': 'warn', BLOCKED: 'bad' };

  function formatDuration(ms) {
    if (ms === null || ms === undefined || !isFinite(ms)) return '-';
    var total = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m ? m + 'm ' + String(s).padStart(2, '0') + 's' : s + 's';
  }

  function clockOf(stamp) {
    if (!stamp) return '';
    var m = String(stamp).match(/T(\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : '';
  }

  function trackList(snapshot) {
    if (!snapshot || !snapshot.tracks) return [];
    var out = [];
    TRACK_ORDER.forEach(function (k) {
      if (!snapshot.tracks[k]) return;
      var t = { key: k };
      Object.keys(snapshot.tracks[k]).forEach(function (p) { t[p] = snapshot.tracks[k][p]; });
      out.push(t);
    });
    return out;
  }

  /**
   * ★ 이 시스템에서 가장 중요한 판정.
   * Agent 진행률이 전체보다 크게 앞서면 "거의 다 됐다"고 오해한다.
   * 그 격차를 화면에 명시한다.
   */
  function progressGapNotice(snapshot) {
    if (!snapshot || !snapshot.tracks) return null;
    var production = (snapshot.tracks.production && snapshot.tracks.production.pct) || 0;
    var overall = snapshot.overall || 0;
    var gap = production - overall;
    if (gap < 10) return null;

    var lagging = trackList(snapshot)
      .filter(function (t) { return t.key !== 'production' && t.pct < production; })
      .sort(function (a, b) { return a.pct - b.pct; })
      .slice(0, 2);

    return {
      show: true,
      gap: gap,
      message: 'Agent 작업은 ' + production + '% 진행됐지만 프로젝트 전체는 ' + overall + '%다. '
        + lagging.map(function (t) { return t.label + ' ' + t.pct + '%'; }).join(', ')
        + ' 가 남아 있어 아직 배포할 수 없다.',
    };
  }

  function agentSummary(snapshot) {
    var agents = (snapshot && snapshot.agents) || [];
    function count(s) { return agents.filter(function (a) { return a.status === s; }).length; }
    return {
      agents: agents,
      total: agents.length,
      completed: count('COMPLETED') + count('APPROVED'),
      running: count('RUNNING'),
      warning: count('WARNING'),
      error: count('ERROR') + count('BLOCKED'),
      waiting: count('WAITING') + count('QUEUED'),
      skipped: count('SKIPPED'),
    };
  }

  function riskSummary(snapshot) {
    var v = snapshot && snapshot.tracks && snapshot.tracks.validation;
    if (!v) return { available: false };
    return {
      available: v.score !== null && v.score !== undefined,
      score: v.score,
      status: v.status,
      critical: v.critical || 0,
      major: v.major || 0,
      minor: v.minor || 0,
      gatesPassed: v.gatesPassed || 0,
      gatesTotal: v.gatesTotal === undefined || v.gatesTotal === null ? 8 : v.gatesTotal,
      detail: v.detail,
      blocked: v.status === 'DISTRIBUTION BLOCKED',
    };
  }

  function outputSummary(snapshot) {
    var o = snapshot && snapshot.tracks && snapshot.tracks.output;
    if (!o) return { files: [], ready: 0, total: 0, specLocked: false };
    var files = o.files || [];
    return {
      files: files,
      ready: files.filter(function (f) { return f.exists; }).length,
      total: files.length,
      specLocked: !!o.specLocked,
      detail: o.detail,
      manifestStatus: o.manifestStatus || null,
    };
  }

  function userActions(snapshot) {
    var reasons = (snapshot && snapshot.tracks && snapshot.tracks.approval
      && snapshot.tracks.approval.reasons) || [];
    return reasons.map(function (r, i) { return { id: 'A' + (i + 1), message: r }; });
  }

  var ACTIVITY_FILTERS = [
    { id: 'ALL', label: '전체', match: function () { return true; } },
    { id: 'ERROR', label: '오류·경고', match: function (l) { return l.level === 'WARN' || l.level === 'ERROR'; } },
    { id: 'DATA', label: '데이터', match: function (l) { return /extraction|geo|project/.test(l.agent); } },
    { id: 'FINANCIAL', label: '재무', match: function (l) { return /financial|appraisal/.test(l.agent); } },
    { id: 'DOCUMENT', label: '문서', match: function (l) { return /writer|output_spec/.test(l.agent); } },
    { id: 'QA', label: '검증', match: function (l) { return /validation/.test(l.agent); } },
  ];

  function filterActivity(activity, filterId) {
    var f = null;
    ACTIVITY_FILTERS.forEach(function (x) { if (x.id === filterId) f = x; });
    if (!f) f = ACTIVITY_FILTERS[0];
    return (activity || []).filter(f.match);
  }

  function barWidth(pct) {
    return Math.max(0, Math.min(100, Number(pct) || 0)) + '%';
  }

  // ── DOM 헬퍼 ──────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null && text !== '') n.textContent = String(text);
    return n;
  }

  function add(parent /*, children… */) {
    for (var i = 1; i < arguments.length; i++) {
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }

  /** 진행바 — React 판과 같은 구조(<span style="width:…">) */
  function fillBar(cls, pct) {
    var wrap = el('div', cls);
    var span = el('span');
    span.style.width = barWidth(pct);
    wrap.appendChild(span);
    return wrap;
  }

  function panelTitle(no, text, sub) {
    var h = el('h2', 'lp-ct__panel-title');
    if (no) h.appendChild(el('span', 'lp-ct__panel-no', no));
    h.appendChild(document.createTextNode(no ? ' ' + text : text));
    if (sub) h.appendChild(el('span', 'lp-ct__panel-sub', sub));
    return h;
  }

  /** <strong>제목</strong> 본문 형태의 알림 문단 */
  function notice(cls, strongText, bodyText) {
    var p = el('p', cls);
    if (strongText) p.appendChild(el('strong', null, strongText));
    if (bodyText) p.appendChild(document.createTextNode(' ' + bodyText));
    return p;
  }

  // ── 렌더링 ────────────────────────────────────────────────────────

  function renderHeader(snap, state) {
    var t = snap.timing || {};
    var running = !t.finishedAt;
    var head = el('header', 'lp-ct__header');

    var left = el('div');
    add(left,
      el('p', 'lp-ct__eyebrow', 'LinkPilot Project Control Tower'),
      el('h1', 'lp-ct__title', (snap.project && (snap.project.name || snap.project.id)) || ''),
      el('p', 'lp-ct__meta', (snap.project && snap.project.id ? snap.project.id : '')
        + (snap.project && snap.project.assetType ? ' · ' + snap.project.assetType : '')));

    var right = el('div', 'lp-ct__header-right');
    if (snap.health) {
      var health = el('span', 'lp-ct__health lp-ct__tone--' + (HEALTH_TONE[snap.health.level] || 'idle'),
        snap.health.level);
      health.appendChild(el('small', null, snap.health.reason || ''));
      right.appendChild(health);
    }
    right.appendChild(el('p', 'lp-ct__timing',
      (running ? '실행 중' : '실행 완료') + ' · 경과 ' + formatDuration(t.elapsedMs)
      + (running && t.estimatedRemainingMs
        ? ' · 남은 예상 ' + formatDuration(t.estimatedRemainingMs) + ' (참고값)' : '')));

    // ★ 폴링이 실패해도 마지막 화면을 지우지 않는다. 대신 '언제 기준'인지 밝힌다.
    if (state.error) {
      var stale = el('p', 'lp-ct__stale',
        '갱신 실패 — 마지막 수신 ' + (clockOf(state.lastAt) || '알 수 없음') + ' 기준 화면입니다. ');
      var retry = el('button', 'lp-ct__link', '다시 시도');
      retry.type = 'button';
      retry.addEventListener('click', function () { state.refresh(); });
      stale.appendChild(retry);
      right.appendChild(stale);
    }

    return add(head, left, right);
  }

  function renderOverall(snap) {
    var box = el('section', 'lp-ct__panel');
    box.appendChild(panelTitle('01', 'Overall Progress'));

    var overall = el('div', 'lp-ct__overall');
    var value = el('div', 'lp-ct__overall-value', snap.overall);
    value.appendChild(el('span', null, '%'));
    var barWrap = fillBar('lp-ct__overall-bar', snap.overall);
    barWrap.setAttribute('role', 'progressbar');
    barWrap.setAttribute('aria-valuenow', String(snap.overall || 0));
    barWrap.setAttribute('aria-valuemin', '0');
    barWrap.setAttribute('aria-valuemax', '100');
    add(overall, value, barWrap);
    box.appendChild(overall);

    // ★ 격차 경고 — 이 문구가 없으면 Agent 100% 를 완료로 오해한다
    var gap = progressGapNotice(snap);
    if (gap) box.appendChild(notice('lp-ct__notice lp-ct__notice--warn', '진행률 해석 주의', gap.message));

    var ul = el('ul', 'lp-ct__tracks');
    trackList(snap).forEach(function (t) {
      var li = el('li', 'lp-ct__track lp-ct__track--' + t.key);
      var head = el('div', 'lp-ct__track-head');
      add(head,
        el('span', 'lp-ct__track-label', t.label),
        el('span', 'lp-ct__track-weight', '비중 ' + t.weight + '%'),
        el('span', 'lp-ct__track-pct', t.pct + '%'));
      add(li, head, fillBar('lp-ct__track-bar', t.pct),
        t.detail ? el('p', 'lp-ct__track-detail', t.detail) : null);
      ul.appendChild(li);
    });
    box.appendChild(ul);

    box.appendChild(el('p', 'lp-ct__footnote',
      '전체 진행률은 4개 트랙의 가중합입니다. Agent 작업이 모두 끝나도 검증·승인 전이면 100%가 되지 않습니다.'));
    return box;
  }

  function renderAgents(snap) {
    var s = agentSummary(snap);
    var box = el('section', 'lp-ct__panel');
    box.appendChild(panelTitle('02', 'Agent Activity', s.completed + '/' + s.total + ' 완료'));

    var ul = el('ul', 'lp-ct__agents');
    s.agents.forEach(function (a) {
      var li = el('li', 'lp-ct__agent lp-ct__tone--' + (AGENT_STATUS_TONE[a.status] || 'idle'));
      var icon = el('span', 'lp-ct__agent-icon', AGENT_STATUS_ICON[a.status] || '·');
      icon.setAttribute('aria-hidden', 'true');
      var name = el('span', 'lp-ct__agent-name', a.label);
      name.appendChild(el('small', null, a.id));
      var activity = null;
      if (a.activity) {
        activity = el('span', 'lp-ct__agent-activity', a.activity);
        activity.title = a.activity;
      }
      add(li, icon, name, fillBar('lp-ct__agent-bar', a.progress),
        el('span', 'lp-ct__agent-status', a.status),
        el('span', 'lp-ct__agent-time', a.elapsedMs ? formatDuration(a.elapsedMs) : ''),
        activity);
      ul.appendChild(li);
    });
    box.appendChild(ul);

    var b = snap.bottleneck;
    if (b) {
      box.appendChild(notice('lp-ct__notice', '병목',
        b.label + ' — ' + formatDuration(b.elapsedMs)
        + ' (전체의 ' + b.sharePct + '%, 후속 ' + b.dependents + '개, 영향 ' + b.impactLevel + ')'));
    }
    var waiting = snap.waiting || [];
    if (waiting.length) {
      box.appendChild(notice('lp-ct__notice', '선행 대기',
        waiting.map(function (w) { return w.id + ' ← ' + (w.waitingFor || []).join(', '); }).join(' / ')));
    }
    return box;
  }

  function renderRisk(snap) {
    var r = riskSummary(snap);
    var box = el('section', 'lp-ct__panel' + (r.blocked ? ' lp-ct__panel--blocked' : ''));
    box.appendChild(panelTitle('03', 'Validation / Risk'));

    if (!r.available) {
      box.appendChild(el('p', 'lp-ct__muted', r.detail || '검증이 아직 실행되지 않았습니다.'));
      return box;
    }

    var score = el('div', 'lp-ct__score');
    add(score,
      el('span', 'lp-ct__score-value', r.score),
      el('span', 'lp-ct__score-max', '/ 100'),
      el('span', 'lp-ct__score-status ' + (r.blocked ? 'lp-ct__tone--bad' : 'lp-ct__tone--ok'), r.status));
    box.appendChild(score);

    var sev = el('ul', 'lp-ct__severity');
    [['bad', r.critical, 'CRITICAL'], ['warn', r.major, 'MAJOR'], ['idle', r.minor, 'MINOR'],
      ['ok', r.gatesPassed + '/' + r.gatesTotal, 'GATE']].forEach(function (row) {
      var li = el('li', 'lp-ct__tone--' + row[0]);
      li.appendChild(el('b', null, row[1]));
      li.appendChild(document.createTextNode(' ' + row[2]));
      sev.appendChild(li);
    });
    box.appendChild(sev);

    if (r.blocked) {
      box.appendChild(notice('lp-ct__notice lp-ct__notice--bad', '배포 차단',
        'CRITICAL 항목이 해소되기 전에는 최종 배포할 수 없습니다.'));
    }
    return box;
  }

  function renderOutput(snap) {
    var o = outputSummary(snap);
    var box = el('section', 'lp-ct__panel');
    box.appendChild(panelTitle('04', 'Output Status', o.ready + '/' + o.total + ' 생성'));

    var ul = el('ul', 'lp-ct__files');
    o.files.forEach(function (f) {
      // ★ '생성됨' 표시가 아니라 파일 존재 여부로 판정한다
      var li = el('li', f.exists ? 'lp-ct__tone--ok' : 'lp-ct__tone--idle');
      var mark = el('span', null, f.exists ? '✓' : '○');
      mark.setAttribute('aria-hidden', 'true');
      add(li, mark, el('span', 'lp-ct__file-label', f.label), el('code', null, f.path));
      ul.appendChild(li);
    });
    box.appendChild(ul);

    box.appendChild(notice('lp-ct__notice' + (o.specLocked ? '' : ' lp-ct__notice--warn'), '출력 사양',
      (o.detail || '') + (o.manifestStatus ? ' · 매니페스트: ' + o.manifestStatus : '')));
    return box;
  }

  function renderActivity(snap, state) {
    var box = el('section', 'lp-ct__panel');
    box.appendChild(panelTitle('05', 'Live Activity'));

    var tabs = el('div', 'lp-ct__filters');
    tabs.setAttribute('role', 'tablist');
    ACTIVITY_FILTERS.forEach(function (f) {
      var b = el('button', 'lp-ct__filter' + (state.filter === f.id ? ' is-active' : ''), f.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(state.filter === f.id));
      b.addEventListener('click', function () { state.filter = f.id; state.draw(); });
      tabs.appendChild(b);
    });
    box.appendChild(tabs);

    var rows = filterActivity(snap.activity, state.filter);
    if (!rows.length) {
      box.appendChild(el('p', 'lp-ct__muted', '기록된 활동이 없습니다.'));
      return box;
    }
    var ol = el('ol', 'lp-ct__log');
    rows.slice().reverse().forEach(function (l) {
      var li = el('li', l.level === 'WARN' ? 'lp-ct__tone--warn' : '');
      add(li, el('time', null, clockOf(l.at)),
        el('span', 'lp-ct__log-agent', l.agent),
        el('span', 'lp-ct__log-msg', l.message),
        l.records ? el('span', 'lp-ct__log-records', l.records + '건') : null);
      ol.appendChild(li);
    });
    box.appendChild(ol);
    return box;
  }

  function renderActions(snap, opts, state) {
    var actions = userActions(snap);
    var approval = snap.tracks && snap.tracks.approval;

    if (approval && approval.approved) {
      var done = el('section', 'lp-ct__panel lp-ct__panel--ok');
      add(done, panelTitle(null, 'Approval'), el('p', 'lp-ct__tone--ok', approval.detail || ''));
      return done;
    }

    var box = el('section', 'lp-ct__panel');
    box.appendChild(panelTitle(null, 'User Action Required'));

    if (!actions.length) {
      box.appendChild(el('p', 'lp-ct__muted', '해소해야 할 항목이 없습니다.'));
    } else {
      var ul = el('ul', 'lp-ct__actions');
      actions.forEach(function (a) {
        var li = el('li');
        li.appendChild(el('span', null, a.id));
        li.appendChild(document.createTextNode(a.message));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    // ★ 차단 사유가 하나라도 남아 있으면 누를 수 없다. 눌러서 실패하는 게 아니다.
    var canApprove = !!approval && actions.length === 0 && !approval.approved;
    var btn = el('button', 'lp-ct__approve', '최종 승인');
    btn.type = 'button';
    btn.disabled = !canApprove || !opts.onApprove;
    btn.title = canApprove ? '' : '차단 사유가 남아 있어 승인할 수 없습니다';
    btn.addEventListener('click', function () {
      if (!opts.onApprove) return;
      Promise.resolve(opts.onApprove(snap.project && snap.project.id)).then(function () { state.refresh(); });
    });
    box.appendChild(btn);

    if (!canApprove) {
      box.appendChild(el('p', 'lp-ct__footnote',
        '위 항목이 모두 해소되어야 승인할 수 있습니다. 승인은 사람만 할 수 있으며 기록이 남습니다.'));
    }
    return box;
  }

  // ── 마운트 ────────────────────────────────────────────────────────

  var RUNNING_MS = 2000;    // 실행 중
  var IDLE_MS = 15000;      // 완료 후

  function mount(container, opts) {
    if (!container) throw new Error('control-tower: 컨테이너 엘리먼트가 필요하다');
    opts = opts || {};
    var baseUrl = (opts.baseUrl || '/api/linkpilot').replace(/\/$/, '');
    var fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch.bind(null) : null);

    var state = {
      projectId: opts.projectId,
      snapshot: opts.snapshot || null,   // 폴링 없이 주입할 수도 있다
      filter: 'ALL',
      error: null,
      lastAt: null,
      timer: null,
      stopped: false,
    };

    function draw() {
      container.textContent = '';
      container.className = 'lp-ct' + (state.snapshot ? '' : ' lp-ct--empty');

      if (!state.snapshot) {
        container.appendChild(state.error
          ? el('p', 'lp-ct__error', '현황을 불러오지 못했습니다: ' + state.error)
          : el('p', 'lp-ct__muted', '현황을 불러오는 중…'));
        return;
      }

      var snap = state.snapshot;
      container.appendChild(renderHeader(snap, state));
      container.appendChild(renderOverall(snap));

      var grid = el('div', 'lp-ct__grid');
      add(grid, renderAgents(snap), renderRisk(snap), renderOutput(snap), renderActivity(snap, state));
      container.appendChild(grid);

      container.appendChild(renderActions(snap, opts, state));
      container.appendChild(add(el('footer', 'lp-ct__footer'), el('span', null, snap.generatedAt || '')));
    }
    state.draw = draw;

    function nextDelay() {
      var agents = (state.snapshot && state.snapshot.agents) || [];
      var running = agents.some(function (a) { return a.status === 'RUNNING' || a.status === 'QUEUED'; });
      return running ? RUNNING_MS : IDLE_MS;
    }

    function schedule() {
      clearTimeout(state.timer);
      if (state.stopped || opts.snapshot) return;   // 주입 모드면 폴링하지 않는다
      state.timer = setTimeout(tick, nextDelay());
    }

    function tick() {
      // 탭이 백그라운드면 폴링하지 않는다 (NAS·API 부하를 아낀다)
      if (typeof document !== 'undefined' && document.hidden) return schedule();
      refresh().then(schedule);
    }

    function refresh() {
      if (opts.snapshot) { draw(); return Promise.resolve(); }
      if (!fetchImpl) {
        state.error = 'fetch 를 쓸 수 없다';
        draw();
        return Promise.resolve();
      }
      return fetchImpl(baseUrl + '/projects/' + encodeURIComponent(state.projectId) + '/control-tower')
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (j) {
          state.snapshot = j;
          state.lastAt = j.generatedAt || null;
          state.error = null;
          draw();
        })
        .catch(function (e) {
          state.error = e.message;   // 마지막 스냅샷은 유지한 채 경고만 띄운다
          draw();
        });
    }
    state.refresh = refresh;

    draw();
    if (!opts.snapshot) refresh().then(schedule);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && !state.stopped && !opts.snapshot) tick();
      });
    }

    return {
      refresh: refresh,
      stop: function () { state.stopped = true; clearTimeout(state.timer); },
      state: state,
    };
  }

  return {
    mount: mount,
    // 표시 로직 — 패리티 테스트가 이걸 React 판과 비교한다
    TRACK_ORDER: TRACK_ORDER,
    AGENT_STATUS_ICON: AGENT_STATUS_ICON,
    AGENT_STATUS_TONE: AGENT_STATUS_TONE,
    HEALTH_TONE: HEALTH_TONE,
    ACTIVITY_FILTERS: ACTIVITY_FILTERS,
    formatDuration: formatDuration,
    clockOf: clockOf,
    trackList: trackList,
    progressGapNotice: progressGapNotice,
    agentSummary: agentSummary,
    riskSummary: riskSummary,
    outputSummary: outputSummary,
    userActions: userActions,
    filterActivity: filterActivity,
    barWidth: barWidth,
  };
}));
