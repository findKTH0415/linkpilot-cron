/**
 * page.js — NAS 배포용 Control Tower 페이지 껍데기.
 *
 * 대시보드 자체는 control-tower.js 가 그린다. 이 파일은 그 앞단만 맡는다:
 *   ① 프로젝트 목록을 받아 고르게 한다
 *   ② 고른 프로젝트로 대시보드를 마운트한다
 *   ③ API 가 죽었을 때 무엇이 잘못됐는지 알려준다
 *
 * ★ API 주소는 세 곳에서 온다. 앞에 있는 것이 이긴다.
 *     1) ?api=... 쿼리스트링          (임시 확인용)
 *     2) window.LINKPILOT_API         (HTML 에서 지정)
 *     3) '/api/linkpilot'             (같은 호스트에 API 가 있을 때)
 *   NAS 와 API 서버(8181)가 다른 포트면 2번을 쓴다.
 *
 * ★ 선택한 프로젝트는 주소(#LP-DC-2026-001)에 남긴다.
 *   새로고침·북마크·공유가 되어야 실제로 쓴다.
 */
(function () {
  'use strict';

  function apiBase() {
    var q = new URLSearchParams(location.search).get('api');
    if (q) return q.replace(/\/$/, '');
    if (window.LINKPILOT_API) return String(window.LINKPILOT_API).replace(/\/$/, '');
    return '/api/linkpilot';
  }

  var PROJECT_ID = /^LP-[A-Z]+-\d{4}-\d{3}$/;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null && text !== '') n.textContent = String(text);
    return n;
  }

  function currentId() {
    var h = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
    return PROJECT_ID.test(h) ? h : null;
  }

  function start() {
    var base = apiBase();
    var picker = document.getElementById('lp-picker');
    var host = document.getElementById('lp-dashboard');
    var mounted = null;

    function mount(id) {
      if (mounted) mounted.stop();
      host.textContent = '';
      mounted = window.LinkPilotControlTower.mount(host, { projectId: id, baseUrl: base });
    }

    function drawPicker(projects, selected) {
      picker.textContent = '';
      if (!projects.length) {
        picker.appendChild(el('p', 'lp-page__hint',
          '프로젝트가 없다. 서버에서 `node im-agent/cli.js demo` 로 하나 만들어 본다.'));
        return;
      }
      var label = el('label', 'lp-page__label', '프로젝트');
      var select = el('select', 'lp-page__select');
      projects.forEach(function (p) {
        var o = el('option', null, p.id + (p.name ? ' — ' + p.name : ''));
        o.value = p.id;
        if (p.id === selected) o.selected = true;
        select.appendChild(o);
      });
      select.addEventListener('change', function () {
        location.hash = select.value;   // hashchange 가 마운트를 다시 건다
      });
      label.appendChild(select);
      picker.appendChild(label);
    }

    function fail(message, detail) {
      host.textContent = '';
      var box = el('div', 'lp-page__error');
      box.appendChild(el('strong', null, message));
      if (detail) box.appendChild(el('p', null, detail));
      // 무엇을 확인해야 하는지까지 적는다. "실패"만 띄우면 다음 행동을 모른다.
      var hint = el('ul', 'lp-page__hint');
      [
        'API 주소: ' + base + '  (다르면 HTML 의 window.LINKPILOT_API 를 고친다)',
        '본체 API(8181)가 떠 있는지, /api/linkpilot 라우터가 붙어 있는지 확인한다',
        'IM_AGENT_ROOT 가 im-projects 폴더를 가리키는지 확인한다',
      ].forEach(function (t) { hint.appendChild(el('li', null, t)); });
      box.appendChild(hint);
      host.appendChild(box);
    }

    function route(projects) {
      var id = currentId() || (projects[0] && projects[0].id);
      if (!id) return;
      drawPicker(projects, id);
      mount(id);
    }

    fetch(base + '/projects')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var projects = (j && j.projects) || [];
        route(projects);
        window.addEventListener('hashchange', function () { route(projects); });
      })
      .catch(function (e) {
        // 목록을 못 받아도 주소에 ID 가 있으면 대시보드는 띄워본다.
        // 목록 API 만 막힌 경우까지 화면을 통째로 죽일 이유는 없다.
        var id = currentId();
        if (id) { mount(id); return; }
        fail('프로젝트 목록을 불러오지 못했다.', e.message);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
