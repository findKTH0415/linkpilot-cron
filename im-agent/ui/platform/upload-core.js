/**
 * upload-core.js — **자료를 올리는 길은 하나다** (2026-08-20).
 *
 * 두 화면이 파일을 올린다 — 1단계(`intake.html`)와 「자료 업로드」탭(`files.html`).
 * 올리는 방법은 똑같은데 화면마다 따로 쓰면 **갈리는 날이 온다.** 이 저장소는
 * 그 갈라짐을 색(`--lime-deep` 세 값)에서 한 번 겪었다. 그래서 여기 한 곳에 둔다.
 *
 * ★ `fetch` 를 쓰지 않는다. fetch 는 **보낸 바이트를 알려 주지 않는다** —
 *   요청 본문 진행 이벤트가 없다. 진행률을 보여 주려면 `XMLHttpRequest` 의
 *   `upload.onprogress` 밖에 길이 없다. 다른 호출은 그대로 `fetch` 를 쓴다.
 *
 * ★ **다 보냈다고 끝난 것이 아니다.** 100% 를 찍고 나면 서버가 파일을 열어
 *   읽는 시간이 남아 있다(스캔본이면 더 길다). 거기서 100% 로 두면
 *   「다 됐는데 화면이 멈췄다」가 된다. 그래서 단계를 **둘로 나눈다**:
 *   `sending` → `reading`. 그리고 `reading` 은 **진행률을 만들지 않는다** —
 *   얼마나 걸릴지 모르는 것에 숫자를 붙이면 그것이 곧 거짓말이다.
 *
 * ★ **모르는 값을 지어내지 않는다.** 길이를 모르면(`lengthComputable` 이 거짓)
 *   `pct` 는 `null` 이고, 화면은 그때 빗금 막대를 그린다. 0% 막대는 「안 가고
 *   있다」로 읽혀서, 모른다는 것과 멈췄다는 것이 구분되지 않는다.
 *
 * ★ **조용히 죽지 않는다.** 끊기면 사유를 남긴다. 진행 바가 멈춘 채 남으면
 *   사용자는 계속 기다리거나 다시 누른다 — 다시 누르면 두 번 올라간다.
 *
 * ★★ 그런데 **끊기지 않고 멎는 경우**를 이 파일은 오래 놓치고 있었다
 *   〈2026-08-22 · 실제 신고로 잡았다〉. `onerror` 는 연결이 죽어야 온다.
 *   앞단이 본문을 안 받아 주면서 붙들고 있으면 **아무 이벤트도 오지 않고**
 *   진행률만 평평해진다 — 신고 화면에서 6.1초 동안 145번을 쟀는데 한 번도
 *   늘지 않았다. 위 주석은 그때 이미 있었다. **적어 두는 것과 재는 것은
 *   다른 일이다.** 그래서 멈춤 감시(`STALL_MS`)와 천장(`xhr.timeout`)을 둔다.
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 읽힌다(테스트가 Node 에서 부른다).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotUpload = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * ★ **이 스크립트가 어느 판인가** 〈2026-08-23 · D-93 사고〉.
   *   `build-stamp.js` 가 채운다 — 손으로 고치지 않는다. 화면이 자기
   *   지문과 대 보고 다르면 「함수가 없다」로 죽기 전에 사람 말로 알린다.
   */
  var LP_BUILD = '34cd536a';

  /**
   * 파일 하나를 base64 로 읽는다.
   *
   * ★ `data:...;base64,XXXX` 에서 **뒤쪽만** 쓴다. 앞의 머리말까지 보내면
   *   서버가 base64 로 풀 때 깨진다.
   */
  function readOne(file, done) {
    var fr = new FileReader();
    fr.onload = function () {
      var s = String(fr.result || '');
      done(null, s.slice(s.indexOf(',') + 1));
    };
    // ★ 못 읽은 것을 「빈 파일」로 넘기지 않는다 — 사유가 사라진다
    fr.onerror = function () { done(new Error('파일을 읽을 수 없습니다 (권한·손상 여부를 봅니다)')); };
    fr.readAsDataURL(file);
  }

  /**
   * 고른 파일들을 읽어 `onEach(rec)` 로 하나씩 돌려준다.
   *
   * ★ 하나가 실패해도 나머지를 멈추지 않는다. 대신 그 하나에 `error` 를 남긴다 —
   *   묶어서 실패시키면 **어느 것이 문제인지 사라진다.**
   */
  function readAll(list, onEach) {
    Array.prototype.forEach.call(list, function (f) {
      readOne(f, function (err, data) {
        onEach({ name: f.name, size: f.size, data: err ? null : data, error: err ? err.message : null });
      });
    });
  }

  /** 보내기 전에 이미 아는 것 — 서버까지 갔다 올 필요가 없다 */
  function tooBig(file, maxBytes) {
    return !!(maxBytes && file && file.size > maxBytes);
  }

  /**
   * 올린다. 진행은 `onUpdate(u)` 로 알린다.
   *
   *   u = { phase:'sending'|'reading'|'done'|'error', sent, total, pct, files, error }
   *
   * @param {{url:string, files:Array, onUpdate:Function, onDone:Function, onFail:Function}} opt
   * @returns {XMLHttpRequest} 취소할 수 있게 그대로 돌려준다
   */
  /** 이만큼 아무 진전이 없으면 **멈춘 것으로 본다** (밀리초) */
  var STALL_MS = 12000;

  /** 아무리 느려도 이만큼이면 끝난다. 영원히 매달려 있지 않게 하는 천장 */
  var HARD_TIMEOUT_MS = 10 * 60 * 1000;

  function mb(n) { return Math.round((n / (1024 * 1024)) * 10) / 10; }

  function send(opt) {
    var files = opt.files || [];
    var payload = JSON.stringify({ files: files });
    var say = opt.onUpdate || function () {};
    /* ★ 본문 크기를 **처음부터 들고 간다.** 멈췄을 때 「얼마짜리를 보내다 멈췄나」가
     *   원인 찾기의 첫 단서다 — base64 라 원본보다 3분의 1 크다 */
    var bodyBytes = payload.length;
    /* ★ 시험이 12초를 기다릴 수는 없다. **기본값은 그대로 두고** 부르는 쪽이
     *   줄일 수 있게만 연다 — 시험이 실제 코드를 밟게 하려면 이 문이 필요하다 */
    var stallMs = (typeof opt.stallMs === 'number' && opt.stallMs > 0) ? opt.stallMs : STALL_MS;

    say({ phase: 'sending', sent: 0, total: bodyBytes, files: files.length, pct: 0,
      bodyBytes: bodyBytes, error: null });

    var xhr = new XMLHttpRequest();
    xhr.open('POST', opt.url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', 'application/json');

    /* ★★ **멈춘 것과 느린 것을 갈라 준다** 〈2026-08-22 · 실제 신고〉.
     *
     *   신고 화면에서 자취가 **6.1초 동안 평평했다.** 145번을 쟀는데 한 번도
     *   늘지 않았다. 그런데 화면은 그냥 「보내는 중」이었다 — 이 모듈 주석은
     *   「조용히 죽지 않는다」고 적어 두었는데, **멈춘 것을 알아채는 코드가
     *   한 줄도 없었다.** 끊기면 `onerror` 가 오지만, **끊기지 않고 멎는** 경우가
     *   실제로 있다(앞단이 본문을 안 받아 주고 붙들고 있을 때).
     *
     *   ★ 멈췄다고 **끊지는 않는다.** 정말 느린 회선일 수 있고, 그때 우리가
     *     끊으면 다 보낸 것을 버리는 셈이다. 말만 하고 계속 보낸다.
     *   ★ 대신 천장(`HARD_TIMEOUT_MS`)을 둔다 — 영원히 매달려 있는 것보다
     *     사유를 남기고 끝나는 쪽이 낫다.
     */
    var lastSent = 0, lastMoveAt = Date.now(), lastUpdate = null, stalled = false;
    var watch = setInterval(function () {
      if (Date.now() - lastMoveAt < stallMs) return;
      if (stalled) return;                       // 한 번만 말한다
      stalled = true;
      var u = lastUpdate || { phase: 'sending', sent: lastSent, pct: null, files: files.length };
      u.stalled = true;
      u.stallMs = Date.now() - lastMoveAt;
      u.bodyBytes = bodyBytes;
      /* 무엇을 해야 하는지까지 말한다. 「멈췄습니다」만 내면 사용자는 기다리거나
         다시 누른다 — 다시 누르면 두 번 올라간다 */
      u.stallWhy = '보낸 양이 ' + Math.round(u.stallMs / 1000) + '초째 늘지 않습니다. '
        + '이번에 보내는 양이 ' + mb(bodyBytes) + 'MB 인데, 서버나 그 앞단이 '
        + '요청 본문 크기를 제한하고 있으면 여기서 멎습니다 — '
        + '관리자에게 업로드 본문 한도를 확인해 달라고 하십시오.';
      say(u);
    }, Math.min(1000, Math.max(50, Math.floor(stallMs / 4))));

    function done() { clearInterval(watch); }

    xhr.timeout = HARD_TIMEOUT_MS;

    xhr.upload.onprogress = function (ev) {
      if (ev.loaded !== lastSent) { lastSent = ev.loaded; lastMoveAt = Date.now(); stalled = false; }
      // ★ 길이를 모르면 % 를 만들지 않는다. 지어낸 진행률은 멈춘 것처럼 보인다
      // ★ 보내는 동안 100% 를 찍지 않는다 — 그 뒤에 서버가 읽는 시간이 남아 있다
      lastUpdate = {
        phase: 'sending',
        sent: ev.loaded,
        total: ev.lengthComputable ? ev.total : null,
        files: files.length,
        bodyBytes: bodyBytes,
        pct: ev.lengthComputable && ev.total ? Math.min(99, Math.floor((ev.loaded / ev.total) * 100)) : null,
        error: null,
      };
      say(lastUpdate);
    };

    // 다 보냈다 → 이제 서버가 읽는다. 여기서 100% 로 두지 않는다
    xhr.upload.onload = function () {
      done();                                  // 다 보냈다 — 멈춤 감시를 끈다
      say({ phase: 'reading', pct: null, files: files.length, bodyBytes: bodyBytes, error: null });
    };

    xhr.onload = function () {
      done();
      var j = {};
      try { j = JSON.parse(xhr.responseText || '{}'); } catch (_) { j = {}; }
      if (xhr.status >= 200 && xhr.status < 300) {
        say({ phase: 'done', pct: 100, files: files.length, error: null });
        if (opt.onDone) opt.onDone(j, xhr.status);
      } else {
        var why = j.error || ('HTTP ' + xhr.status);
        /* ★★ **`bodyBytes` 를 여기서 흘리지 않는다** 〈2026-08-22 · 실제로 흘렸다〉.
         *   `say` 는 상태를 **갈아치운다.** 이 한 줄만 `bodyBytes` 를 빼먹고 있어서,
         *   서버가 거절하면 화면이 「이번에 보낸 양이 **0 B**」라고 말했다.
         *   0 은 잰 값이 아니라 **잃어버린 값**이었다 — 그런데 화면에서는 둘이
         *   똑같이 보인다. 그 숫자를 믿고 「아무것도 안 갔다」로 원인을 찾으면
         *   엉뚱한 데를 판다. 실제로는 5MB 를 다 보내고 거절당한 것이었다. */
        say({ phase: 'error', pct: null, files: files.length, bodyBytes: bodyBytes, error: why });
        if (opt.onFail) opt.onFail(why, xhr.status, j);
      }
    };

    // ★ 조용히 죽지 않는다. 진행 바가 멈춘 채 남으면 사용자는 계속 기다린다
    xhr.onerror = function () {
      done();
      var why = '전송이 끊겼습니다 — 다시 시도하세요';
      say({ phase: 'error', pct: null, files: files.length, bodyBytes: bodyBytes, error: why });
      if (opt.onFail) opt.onFail(why, 0, {});
    };

    /* ★ 천장에 닿았다. **끊긴 것과 다른 말을 한다** — 다시 눌러도 같은 일이
     *   벌어질 가능성이 높으므로 「다시 시도하세요」로 끝내지 않는다 */
    xhr.ontimeout = function () {
      done();
      var why = '10분 안에 다 보내지 못했습니다 (' + mb(bodyBytes) + 'MB) — '
        + '회선이 느리거나 서버가 이 크기를 안 받고 있습니다. '
        + '파일을 나눠 올리거나 관리자에게 업로드 본문 한도를 확인해 주십시오.';
      say({ phase: 'error', pct: null, files: files.length, bodyBytes: bodyBytes, error: why });
      if (opt.onFail) opt.onFail(why, 0, {});
    };

    // 중단도 **같은 길**로 보낸다. 따로 두면 한쪽만 고쳐지고, 중단은 조용해진다
    xhr.onabort = xhr.onerror;

    xhr.send(payload);
    return xhr;
  }

  /** 올린 결과를 사람이 읽는 한 줄로. **거절된 것을 숨기지 않는다** */
  function summary(j) {
    if (!j) return '';
    var okN = (j.saved || j.accepted || []).length;
    var noN = (j.rejected || []).length;
    var s = okN + '개를 올렸습니다';
    if (noN) s += ' · ' + noN + '개는 거절되었습니다';
    return s;
  }

  return { BUILD: LP_BUILD,
    readAll: readAll, readOne: readOne, send: send, tooBig: tooBig, summary: summary };
}));
