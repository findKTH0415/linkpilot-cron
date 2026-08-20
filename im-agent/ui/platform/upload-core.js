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
 * 의존성 없음. 브라우저·Node 양쪽에서 읽힌다(테스트가 Node 에서 부른다).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotUpload = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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
  function send(opt) {
    var files = opt.files || [];
    var payload = JSON.stringify({ files: files });
    var say = opt.onUpdate || function () {};

    say({ phase: 'sending', sent: 0, total: payload.length, files: files.length, pct: 0, error: null });

    var xhr = new XMLHttpRequest();
    xhr.open('POST', opt.url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', 'application/json');

    xhr.upload.onprogress = function (ev) {
      // ★ 길이를 모르면 % 를 만들지 않는다. 지어낸 진행률은 멈춘 것처럼 보인다
      // ★ 보내는 동안 100% 를 찍지 않는다 — 그 뒤에 서버가 읽는 시간이 남아 있다
      say({
        phase: 'sending',
        sent: ev.loaded,
        total: ev.lengthComputable ? ev.total : null,
        files: files.length,
        pct: ev.lengthComputable && ev.total ? Math.min(99, Math.floor((ev.loaded / ev.total) * 100)) : null,
        error: null,
      });
    };

    // 다 보냈다 → 이제 서버가 읽는다. 여기서 100% 로 두지 않는다
    xhr.upload.onload = function () {
      say({ phase: 'reading', pct: null, files: files.length, error: null });
    };

    xhr.onload = function () {
      var j = {};
      try { j = JSON.parse(xhr.responseText || '{}'); } catch (_) { j = {}; }
      if (xhr.status >= 200 && xhr.status < 300) {
        say({ phase: 'done', pct: 100, files: files.length, error: null });
        if (opt.onDone) opt.onDone(j, xhr.status);
      } else {
        var why = j.error || ('HTTP ' + xhr.status);
        say({ phase: 'error', pct: null, files: files.length, error: why });
        if (opt.onFail) opt.onFail(why, xhr.status, j);
      }
    };

    // ★ 조용히 죽지 않는다. 진행 바가 멈춘 채 남으면 사용자는 계속 기다린다
    xhr.onerror = function () {
      var why = '전송이 끊겼습니다 — 다시 시도하세요';
      say({ phase: 'error', pct: null, files: files.length, error: why });
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

  return { readAll: readAll, readOne: readOne, send: send, tooBig: tooBig, summary: summary };
}));
