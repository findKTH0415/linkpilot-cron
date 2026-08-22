'use strict';
/**
 * 자료 스캔 — **진행률과 걸린 시간이 실제로 움직이는가** 〈2026-08-22 사용자 지시〉.
 *
 * ★★ 왜 생겼나: 스캔을 누르면 단추만 「읽는 중…」으로 바뀌고 **칸도 숫자도
 *   그대로** 있었다. 실제로는 돌고 있는데 화면이 아무 말도 안 해서 **멈춘 것으로
 *   읽혔다.** 사용자가 「그대로 뜸」이라고 적어 보냈다.
 *
 * ★ 그래서 「미터가 있다」를 재지 않는다. **시간이 지나면 숫자가 커지는가**를
 *   잰다 — 그것이 사용자가 보는 것이다 (M-08: 부르지 않는 검사를 만들지 않는다).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui/platform');

test('★★ 스캔이 도는 동안 진행률과 시간이 실제로 커진다', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-meter-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  /* 스캔이 **끝나지 않게** 붙잡아 둔다 — 도는 동안의 화면을 재려는 것이다.
     그러려면 그 요청만 영영 답하지 않게 하면 된다 */
  const probe = '<div id="probe"></div><script>(function () {'
    + 'var out = { err: [] };'
    + 'window.onerror = function (m) { out.err.push(String(m)); };'
    + 'var of = window.fetch;'
    + 'window.fetch = function (u, o) {'
    + '  if (String(u).indexOf("/scan") > -1) return new Promise(function () {});'
    + '  return of.apply(this, arguments); };'
    + 'var pick = function (s) { var e = document.querySelector(s); return e ? e.textContent.trim() : null; };'
    + 'var press = function () {'
    + '  var b = [].slice.call(document.querySelectorAll("button"))'
    + '    .filter(function (x) { return /자료 스캔/.test(x.textContent) && !x.disabled; })[0];'
    + '  if (b) { b.click(); return true; } return false; };'
    /* ★ 프로젝트를 먼저 고른다 — 안 고르면 스캔 칸이 아예 안 그려진다.
         (flow-mobile 검사와 같은 방식) */
    + 'var picked = false;'
    + 'var pickProj = function () {'
    + '  var sel = document.querySelector(".wayin select"); if (!sel) return false;'
    + '  var o = [].slice.call(sel.options).filter(function (x) { return /^LP-/.test(x.value); })[0];'
    + '  if (!o) return false;'
    + '  sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; };'
    + 'var n = 0, started = false, t = setInterval(function () {'
    + '  if (!picked) { picked = pickProj(); return; }'
    + '  if (!started) started = press();'
    + '  if (!started && n > 60) {'
    + '    out.saw = [].slice.call(document.querySelectorAll("button"))'
    + '      .map(function (x) { return x.textContent.trim().slice(0, 14); });'
    + '    document.getElementById("probe").textContent = JSON.stringify(out);'
    + '    clearInterval(t); return; }'
    + '  if (started && n === 12) { out.early = { pct: pick(".mtr__pct"), t: pick(".mtr__t") }; }'
    + '  if (started && n > 60) {'
    + '    out.late = { pct: pick(".mtr__pct"), t: pick(".mtr__t"), sub: pick(".mtr__s") };'
    + '    out.note = pick(".mtr__n");'
    + '    out.bar = (function () { var i = document.querySelector(".mtr__bar i");'
    + '      return i ? i.style.width : null; })();'
    + '    document.getElementById("probe").textContent = JSON.stringify(out);'
    + '    clearInterval(t); }'
    + '  n += 1;'
    + '}, 120);'
    + '}());<' + '/script>';

  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  const dom = renderDom(findBrowser(), page, 60000, 430);
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 스캔 단추까지 못 갔다');
  const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

  assert.deepStrictEqual(r.err, [], '스캔 중에 예외가 났다');
  assert.ok(r.early && r.early.t, `도는 동안 걸린 시간이 안 보인다 (${JSON.stringify(r.early)})`);
  assert.ok(r.late && r.late.t, '시간이 사라졌다');

  const sec = (s) => parseFloat(String(s).replace(/[^\d.]/g, ''));
  assert.ok(sec(r.late.t) > sec(r.early.t),
    `시간이 안 흐른다 — ${r.early.t} → ${r.late.t} (화면이 멈춘 것으로 보인다)`);

  const pct = (s) => parseInt(String(s), 10);
  assert.ok(pct(r.late.pct) >= pct(r.early.pct),
    `진행률이 거꾸로 간다 — ${r.early.pct} → ${r.late.pct}`);

  /* ★★ **끝나기 전에 100% 를 만들지 않는다.** 가짜 100% 는 「끝났는데 화면이
     안 넘어간다」로 읽혀서 멈춰 보이는 것보다 나쁘다 */
  assert.ok(pct(r.late.pct) < 100,
    `아직 답이 안 왔는데 ${r.late.pct} 를 보여 준다 — 서버는 중간 상태를 알려 주지 않는다`);

  /* ★ 어림값이라는 것을 화면이 말해야 한다 — 안 적으면 잰 값으로 읽힌다 */
  assert.match(String(r.note || ''), /어림/,
    '진행률이 어림값이라는 말이 없다 — 사용자는 잰 값으로 믿는다');

  assert.ok(r.bar && /%$/.test(r.bar), `막대가 안 그려졌다 (${r.bar})`);

  process.stderr.write(`  [스캔] ${r.early.pct} ${r.early.t} → ${r.late.pct} ${r.late.t}`
    + `${r.late.sub ? ' · ' + r.late.sub : ''}\n`);
});
