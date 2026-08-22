'use strict';
/**
 * upload-unread.test.js — **받은 것과 읽은 것은 다르다** (2026-08-22).
 *
 * ★★ 실제 신고: 「1번 첨부하여 수집한 파일들 모이는곳 파일업로드하면 오류가 발생
 *   깨짐」. 재현해 보니 오류 상자도 없었고 예외도 없었다. 화면은 초록 칸에
 *   「2개를 올렸습니다」만 띄웠다 — 그런데 **둘 다 읽히지 않았다.**
 *
 *   서버는 세 가지를 따로 준다:
 *     rejected          — 아예 안 받았다 (빈 파일·용량 초과)
 *     read.unsupported  — **받았는데 못 읽었다** (엑셀·한글 문서·손상된 ZIP)
 *     read.facts        — 읽어서 값이 됐다
 *   화면은 첫째만 그리고 **가운데를 통째로 빼먹고 있었다.** 그래서 사용자는
 *   성공 표시를 본 뒤 다음 칸이 비어 있는 것을 고장으로 읽었다.
 *
 * ★ 1회성(파일업로드)은 여기서 한 겹 더 나쁘다 — 서버가 읽어 보고 **원본을
 *   이미 지웠다.** 못 읽었다고 말하지 않으면 자료가 사라진 것도 모른다.
 *
 * 그래서 이 시험은 **실제로 눌러 본다.** 문자열 검사로는 「그리기는 하는데
 *   그 자리까지 안 간다」를 못 잡는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');

test('★★ 받았지만 못 읽은 자료를 화면이 말한다 (올려 보고 잰다)', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;   // 크로미움이 없는 서버가 실제로 있다

  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-unread-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  /* ★ 올리는 손은 **미리 그리는 판과 같은 것**을 쓴다 (`uploadDriver`).
       둘로 갈리면 한쪽만 고쳐지고, 그때 시험은 실제와 다른 것을 재게 된다.
       ★ 그 손은 정해진 시간을 기다리지 않고 **다음 것이 나타날 때까지** 되묻는다 —
         시험을 여럿 한꺼번에 돌리면 고정 대기는 가끔 못 끝냈다. */
  const { uploadDriver } = require(path.join(PLATFORM, 'build-files.js'));
  const probe = '<div id="probe"></div><script>(function () {'
    + 'var $ = function (s) { return document.querySelector(s); };'
    + 'var $$ = function (s) { return [].slice.call(document.querySelectorAll(s)); };'
    + 'var out = { err: [] };'
    + 'window.onerror = function (m) { out.err.push(String(m)); };'
    + 'window.addEventListener("unhandledrejection", function (e) {'
    + '  out.err.push("rejected: " + ((e.reason && e.reason.message) || e.reason)); });'
    + 'var n = 0;'
    + 'var t = setInterval(function () {'
    + '  var d = window.__lpDrove || {};'
    + '  out.step = d.step || null; out.ticks = d.ticks || 0;'
    + '  out.hasTile = !!$$(".pw").filter(function (b) { return /파일업로드/.test(b.textContent); })[0];'
    + '  out.hasDrop = !!$(".drop input");'
    + '  out.headings = $$(".sub__n").map(function (x) { return x.textContent; });'
    + '  out.rows = $$(".row__n").map(function (x) { return x.textContent; });'
    + '  out.phase = ($(".up__h b") || {}).textContent || null;'
    + '  out.lines = $$(".up__d").map(function (x) { return x.textContent; });'
    + '  out.bad = $$(".up__d--bad").map(function (x) { return x.textContent; });'
    + '  out.errBox = $$(".err").length;'
    + '  document.getElementById("probe").textContent = JSON.stringify(out);'
    + '  if (d.done || ++n > 700) clearInterval(t);'
    + '}, 50);'
    + '}());<' + '/script>';

  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + uploadDriver() + probe + '</body></html>');

  const dom = renderDom(findBrowser(), page, 30000, 430);
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 화면이 그 자리까지 못 갔다');
  const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

  assert.deepStrictEqual(r.err, [], '올리는 동안 예외가 났다');
  assert.ok(r.hasTile, '「파일업로드」 갈래가 없다');
  assert.ok(r.hasDrop, '파일 고르기가 없다');

  // ① 번호 붙은 칸이 실제로 그려진다 — 사용자가 손으로 그려 알려 준 그 구분
  assert.deepStrictEqual(r.headings, ['1', '2'],
    '① 자료 수집 · ② 자료 스캔 번호가 화면에 없다 — 어디까지가 모으는 일인지 안 보인다');

  assert.deepStrictEqual(r.rows, ['[붙임3]산출근거.xlsx', '사업계획서(초안).pdf'],
    '고른 파일 이름이 그대로 안 나온다');
  assert.strictEqual(r.phase, '올렸습니다',
    `올리기가 끝나지 않았다 — 마지막 걸음 ${r.step} · ${r.ticks}번 되물었다`);
  assert.strictEqual(r.errBox, 0, '빨간 오류 상자가 떴다 — 이건 고장이 아니다');

  // ★★ 핵심: **못 읽은 것을 말한다.** 이 줄이 없던 것이 신고의 원인이다
  const all = r.lines.join('\n');
  assert.match(all, /읽지 못했습니다/,
    '못 읽은 자료를 한 줄도 안 말한다 — 「올렸습니다」만 보고 다음 칸이 빈 것을 고장으로 읽는다');
  assert.match(all, /\[붙임3\]산출근거\.xlsx/,
    '어느 파일이 안 읽혔는지 이름을 안 적는다 — 무엇을 다시 올려야 할지 모른다');
  assert.ok(r.bad.length >= 2,
    '나쁜 소식이 초록 칸 안에서 눈에 안 걸린다 (up__d--bad 가 안 붙었다)');

  // ★ 1회성은 **원본이 남아 있지 않다.** 그 말까지 해야 사용자가 판단할 수 있다
  assert.match(all, /원본을 지웁니다|남아 있지 않습니다/,
    '1회성이라 원본이 사라졌다는 말이 없다 — 자료를 잃은 것도 모른다');

  // ★ 읽힌 것까지 싸잡아 실패로 말하지 않는다
  assert.match(all, /2개를 올렸습니다/, '올린 개수를 안 말한다');

  fs.rmSync(dir, { recursive: true, force: true });
});
