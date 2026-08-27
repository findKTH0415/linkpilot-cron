'use strict';
/**
 * upload-5xx-live.test.js — **502 를 실제로 받아서 화면을 잰다** 〈2026-08-27 · M-58〉.
 *
 * ★★★ 왜 소스 검사로 부족한가. `upload-5xx.test.js` 는 글자를 본다 — 그러면
 *   **「그리는 코드는 있는데 그 자리까지 안 간다」**를 못 잡는다. 이 저장소는
 *   그 결로 여러 번 당했다(M-05 · M-25 · M-57 — 오류를 안 내는 고장).
 *   그래서 가짜 서버가 **진짜로 502 를 돌려주게** 하고, 사람이 보는 글자를 읽는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');

test('★★★ 502 를 받으면 화면이 「잠깐 나는 고장」이라 말하고 [다시 보내기]를 준다', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;   // 크로미움이 없는 서버가 실제로 있다

  const { buildLive, uploadDriver } = require(path.join(PLATFORM, 'build-files.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-502-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  /* ★ 손이 파일을 고르고 보내기 전에 **고장을 걸어 둔다.** 걸어 두는 시점이
   *   늦으면 이미 성공해 버려서 재려는 것을 못 잰다. */
  const arm = '<script>window.__lpForce5xx = 502;<' + '/script>';

  const probe = '<div id="probe"></div><script>(function () {'
    + 'var $ = function (s) { return document.querySelector(s); };'
    + 'var $$ = function (s) { return [].slice.call(document.querySelectorAll(s)); };'
    + 'var out = { err: [] };'
    + 'window.onerror = function (m) { out.err.push(String(m)); };'
    + 'var n = 0;'
    + 'var t = setInterval(function () {'
    + '  out.phase = ($(".up__h b") || {}).textContent || null;'
    + '  out.lines = $$(".up__d").map(function (x) { return x.textContent; });'
    + '  out.again = $$("button").filter(function (b) { return /다시 보내기/.test(b.textContent); }).length;'
    /* 고른 파일이 남아 있는가 — 다시 고르지 않아도 되는지가 이 검사의 절반이다 */
    + '  out.rows = $$(".row__n").length;'
    + '  document.getElementById("probe").textContent = JSON.stringify(out);'
    + '  if ((out.phase === "올리지 못했습니다" && out.again > 0) || ++n > 2400) clearInterval(t);'
    + '}, 50);'
    + '}());<' + '/script>';

  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + arm + uploadDriver() + probe + '</body></html>');

  const dom = renderDom(findBrowser(), page, 200000, 430);
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 화면이 그 자리까지 못 갔다');
  const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

  assert.deepStrictEqual(r.err, [], '502 를 받는 동안 예외가 났다');
  assert.strictEqual(r.phase, '올리지 못했습니다', `실패 칸이 안 떴다 (phase=${r.phase})`);

  const all = (r.lines || []).join(' ');
  assert.match(all, /잠깐 나는 고장/,
    '502 를 「일시적」이라고 말하지 않는다 — 이름만 적으면 사람은 처음부터 다시 한다');
  assert.match(all, /보내신 파일이 크거나 틀려서가 아니라/,
    '「내 파일 탓이 아니다」가 화면에 안 나온다');
  assert.ok(r.again > 0, '[다시 보내기] 단추가 화면에 없다');
  assert.match(all, /다시 고르실 필요가 없습니다/, '고른 파일을 그대로 뒀다는 말이 없다');
});
