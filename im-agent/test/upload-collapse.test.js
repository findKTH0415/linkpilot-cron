'use strict';
/**
 * upload-collapse.test.js — **다 올린 뒤에는 접힌다** 〈2026-08-27 · D-146〉.
 *
 * 사장님 말씀: 「관련자료 제공 2번이나 올려야 하는 번거로움」. 앞 판은 올리기가
 * 끝나도 파일 고르기가 **그대로 펼쳐진 채** 남아, 위에서는 「완료」라고 하면서
 * 아래에서는 또 올리라는 것처럼 보였다.
 *
 * ★ 이 검사는 **눌러서 잰다.** 올린 뒤의 화면을 실제로 그려서 무엇이 남는지 본다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');

test('★★★ 올린 뒤에는 파일 고르기가 접히고 [＋ 자료 더 올리기]만 남는다', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;

  const { buildLive, uploadDriver } = require(path.join(PLATFORM, 'build-files.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-fold-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  const probe = '<div id="probe"></div><script>(function () {'
    + 'var $ = function (s) { return document.querySelector(s); };'
    + 'var $$ = function (s) { return [].slice.call(document.querySelectorAll(s)); };'
    + 'var out = { err: [] };'
    + 'window.onerror = function (m) { out.err.push(String(m)); };'
    + 'var n = 0;'
    + 'var t = setInterval(function () {'
    + '  out.phase = ($(".up__h b") || {}).textContent || null;'
    + '  out.drop = $$(".drop").length;'                       // 파일 고르기
    + '  out.more = $$("button").filter(function (b) { return /자료 더 올리기/.test(b.textContent); }).length;'
    + '  out.headings = $$(".sub__n, .ah__n").map(function (x) { return x.textContent; });'
    + '  document.getElementById("probe").textContent = JSON.stringify(out);'
    + '  if ((out.phase === "올렸습니다" && out.more > 0) || ++n > 2400) clearInterval(t);'
    + '}, 50);'
    + '}());<' + '/script>';

  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + uploadDriver() + probe + '</body></html>');

  const dom = renderDom(findBrowser(), page, 200000, 430);
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다');
  const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

  assert.deepStrictEqual(r.err, [], '올리는 동안 예외가 났다');
  assert.strictEqual(r.phase, '올렸습니다', `올리기가 안 끝났다 (phase=${r.phase})`);
  assert.strictEqual(r.drop, 0,
    '올린 뒤에도 파일 고르기가 남아 있다 — 「또 올려야 하나」로 읽힌다');
  assert.ok(r.more > 0,
    '[＋ 자료 더 올리기] 가 없다 — 접는 것이 곧 막는 것이 되면 안 된다');
  // ③(진행/결과)은 접지 않는다 — 무엇이 올라갔는지는 끝난 뒤에 더 봐야 한다
  assert.ok((r.headings || []).indexOf('3') >= 0,
    '③ 칸까지 사라졌다 — 올린 결과를 볼 자리가 없어진다');
});
