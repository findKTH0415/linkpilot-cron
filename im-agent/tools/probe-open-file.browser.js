'use strict';
/*
 * probe-open-file.browser.js — 브라우저 안에서 도는 쪽.
 *
 * ★★★ **왜 파일을 따로 두는가** 〈2026-08-25 · 그 자리에서 당했다〉.
 *   앞 판은 이 코드를 노드 쪽 템플릿 문자열 안에 적었다. 그랬더니 **역슬래시가
 *   통째로 먹혔다** — 정규식의 \w 가 w 로, \/ 가 / 로 바뀌어 정규식이 그 자리에서
 *   끝났다. 화면은 아무 말도 안 하고 결과만 안 남겼다.
 *   ★ 그러니 브라우저에서 돌 코드는 **진짜 파일**로 둔다. 문자열에 넣지 않는다.
 *
 * 받는 것: window.LP_PROBE = { cases, want }
 *   cases  [{ rel, type, b64, ... }] — 서버가 실제로 정한 딱지와 진짜 바이트
 *   want   글자 파일에서 그대로 보여야 하는 한국어 조각
 * 남기는 것: <html data-lp-open="[…]">
 */
(function () {
  var CFG = window.LP_PROBE || {};
  var CASES = CFG.cases || [];
  var WANT = String(CFG.want || '');

  function bytesOf(b64) {
    var bin = atob(b64);
    var a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) a[i] = bin.charCodeAt(i);
    return a;
  }

  /* 서버가 보낸 그대로를 돌려주는 가짜 통신. 화면 코드는 손대지 않는다 */
  window.fetch = function (url) {
    var hit = null;
    for (var i = 0; i < CASES.length; i += 1) {
      if (String(url).indexOf(encodeURIComponent(CASES[i].rel)) !== -1) { hit = CASES[i]; break; }
    }
    if (!hit) return Promise.reject(new Error('모르는 주소: ' + url));
    return Promise.resolve(new Response(bytesOf(hit.b64), {
      status: 200, headers: { 'Content-Type': hit.type },
    }));
  };

  /*
   * blob 을 **브라우저가 여는 방식 그대로** 읽는다 — 「열렸다」가 아니라 「읽히는가」.
   *
   * ★★★ 여기가 M-35 의 자리다. 블롭을 글자로 바로 달라고 하면 언제나 UTF-8 로
   *   풀려 **깨지는 것을 못 본다** — 검사가 눈이 먼다. 브라우저는 둘을 본다:
   *     ① 딱지에 글자표(charset)가 있는가 — 없으면 기본 인코딩으로 그린다.
   *        한국어 윈도·사파리에서 글자가 깨지는 자리가 정확히 여기다.
   *     ② 그 형식을 그려 주는가 — 마크다운 딱지는 안 그리고 내려받는다.
   *   그래서 그 둘을 그대로 흉내내어 읽는다.
   */
  var RENDERABLE = ['text/plain', 'text/html', 'application/json', 'text/css', 'image/'];

  function readLikeBrowser(blob) {
    var t = String(blob.type || '').toLowerCase();
    var m = /charset=([\w-]+)/i.exec(t);
    var enc = m ? m[1] : 'windows-1252';
    var renderable = RENDERABLE.some(function (p) { return t.indexOf(p) === 0; });
    return blob.arrayBuffer().then(function (buf) {
      var text = '';
      try { text = new TextDecoder(enc).decode(new Uint8Array(buf)); }
      catch (e) { text = '(모르는 글자표: ' + enc + ')'; }
      return { renderable: renderable, enc: enc, text: text };
    });
  }

  var out = [];
  var at = 0;

  function done() {
    document.documentElement.setAttribute('data-lp-open', JSON.stringify(out));
  }

  function next() {
    if (at >= CASES.length) return done();
    var c = CASES[at];
    at += 1;
    /* ★ 화면의 진짜 함수를 부른다 — 베끼면 화면이 바뀐 날부터 검사만 옛말을 한다 */
    fetchAsBlob('/api/linkpilot/projects/X/file?rel=' + encodeURIComponent(c.rel), c.rel)
      .then(function (blob) {
        var row = { rel: c.rel, serverType: c.type, blobType: blob.type, size: blob.size };
        if (/\.pdf$/i.test(c.rel)) {
          return blob.slice(0, 4).text().then(function (head) {
            row.head = head;
            row.ok = head === '%PDF';
            row.why = row.ok ? null : '이진 파일이 글자로 바뀌었다';
            out.push(row); next();
          });
        }
        return readLikeBrowser(blob).then(function (r) {
          row.enc = r.enc;
          row.renderable = r.renderable;
          row.seen = r.text.slice(0, 60);
          if (!r.renderable) {
            row.ok = false;
            row.why = '브라우저가 안 그리는 딱지다 (' + row.blobType + ') — 내려받기로 떨어진다';
          } else if (r.text.indexOf(WANT) === -1) {
            row.ok = false;
            row.why = '글자표 ' + r.enc + ' 로 풀려 깨진다 (딱지에 charset 이 없다)';
          } else {
            row.ok = true;
            row.why = null;
          }
          out.push(row); next();
        });
      })
      .catch(function (e) {
        out.push({ rel: c.rel, ok: false, why: '못 받았다: ' + e.message });
        next();
      });
  }

  next();
}());
