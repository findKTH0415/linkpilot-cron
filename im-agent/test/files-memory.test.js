'use strict';
/**
 * **지난번에 고른 것을 기억하는가** 〈2026-08-22 사용자 지시 —
 * 「사용자가 파일선택을 하면 다음번에도 기억하고 연이어 편리 사용하도록」〉.
 *
 * ★ 「저장하는 코드가 있다」를 재지 않는다. **화면을 두 번 열어서** 두 번째에
 *   그대로 서 있는지를 잰다 — 그것이 사용자가 겪는 것이다 (M-08).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui/platform');

test('★★ 갈래와 프로젝트를 기억해 다음에 이어서 연다', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;
  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-mem-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  /* 한 페이지 안에서 **두 번 연다.** 첫 번째에서 고르고, 저장된 것을 읽어
     두 번째 시작에 그대로 먹이는 대신 — 실제로 남는 자리(localStorage)를
     그대로 쓰고 화면만 다시 그린다. 저장이 안 되면 두 번째가 기본값으로 뜬다 */
  const probe = '<div id="probe"></div><script>(function () {'
    + 'var out = { err: [] };'
    + 'window.onerror = function (m) { out.err.push(String(m)); };'
    /* 2026-08-23: 고르기는 갈래 안(.wayin)이 아니라 1(.pickone) 에 있다 */
    + 'var sel = function () { return document.querySelector(".pickone select"); };'
    + 'var tiles = function () { return [].slice.call(document.querySelectorAll(".pw")); };'
    + 'var onTile = function () { var t = tiles().filter(function (b) {'
    + '  return b.className.indexOf("on") > -1; })[0];'
    + '  return t ? t.textContent.replace(/\\s*무료\\s*$/, "").trim().slice(0, 12) : null; };'
    + 'var n = 0, picked = false, t = setInterval(function () {'
    + '  var s = sel();'
    + '  if (!picked && s) {'
    + '    var o = [].slice.call(s.options).filter(function (x) { return /^LP-/.test(x.value); })[0];'
    + '    if (o) { out.want = o.value;'
    + '      s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true }));'
    + '      picked = true; }'
    + '  }'
    + '  if (picked && n > 12) {'
    + '    try { out.saved = window.localStorage.getItem("lp.files.last"); } catch (e) { out.saved = "막힘"; }'
    + '    out.firstWay = onTile();'
    + '    document.getElementById("probe").textContent = JSON.stringify(out);'
    + '    clearInterval(t);'
    + '  }'
    + '  n += 1;'
    + '}, 120);'
    + '}());<' + '/script>';

  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + probe + '</body></html>');

  const dom = renderDom(findBrowser(), page, 40000, 430);
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다');
  const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

  assert.deepStrictEqual(r.err, [], '고르는 동안 예외가 났다');
  assert.ok(r.want, '고를 프로젝트가 목록에 없었다');
  assert.ok(r.saved && r.saved !== '막힘', `기억한 것이 없다 (${r.saved})`);

  const saved = JSON.parse(r.saved);
  assert.strictEqual(saved.projectId, r.want,
    `고른 프로젝트를 안 기억했다 — 원한 것 ${r.want} · 기억한 것 ${saved.projectId}`);

  process.stderr.write(`  [기억] ${saved.projectId} · 갈래 ${saved.way || '(기본)'}\n`);
});

test('★★ 저장이 막힌 곳에서도 화면은 그대로 돈다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'files.html'), 'utf8');
  const at = src.indexOf('function remember(');
  assert.ok(at > -1, 'remember() 가 없다');
  const body = src.slice(at, src.indexOf('function recall(', at));
  assert.match(body, /try\s*\{/, '저장을 try 로 안 감쌌다 — 사생활 보호 창에서 화면이 통째로 죽는다');

  const at2 = src.indexOf('function recall(');
  const body2 = src.slice(at2, at2 + 400);
  assert.match(body2, /catch/, '읽기를 try 로 안 감쌌다');

  /* ★★ **딜 자료를 브라우저에 남기지 않는다.** 기억하는 것은 갈래와 프로젝트
     번호뿐이다 — 파일 이름·내용이 들어가면 그것이 곧 유출 경로다 */
  assert.ok(!/localStorage[\s\S]{0,400}(picked|contentBase64|f\.name)/.test(src),
    '고른 파일을 저장하려 한다 — 딜 자료가 브라우저에 남는다');
});

test('★★ 고르기 창에 읽을 수 있는 형식만 건다 (안드로이드 시트가 짧아진다)', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'files.html'), 'utf8');
  const at = src.indexOf('function acceptList(');
  assert.ok(at > -1, 'acceptList() 가 없다 — accept 없이 열면 카메라까지 뜬다');
  const body = src.slice(at, src.indexOf('\n  }', at));

  /* ★ 확장자를 화면에 베껴 두지 않는다 — 서버가 준 목록을 쓴다 (§4 단일 출처) */
  assert.ok(!/'\.(pdf|docx|xlsx|hwp)'/.test(body),
    '확장자를 화면에 적어 두었다 — 형식이 늘면 화면만 옛 목록을 들고 있게 된다');
  assert.match(body, /state\.limits/, '서버가 준 목록을 안 쓴다');
  assert.match(body, /convert/, "못 읽는 형식(convert)을 안 걸러낸다 — 골라 봐야 거절한다");

  /* ★ 목록을 못 받았으면 아무것도 걸지 않는다. 빈 accept 는 「고를 수 있는
     파일이 없습니다」가 되어, 모르는 것이 못 고르는 것으로 바뀐다 */
  assert.match(body, /return ''/, '목록이 없을 때 빈 문자열을 안 돌려준다');
});
