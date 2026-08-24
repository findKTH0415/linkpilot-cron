'use strict';
/**
 * probe-save-bar.js — **[저장] 막대가 어디에 서는지 좌표로 잰다.**
 *
 * ★★★ 왜 만들었나 〈2026-08-25 사장님 화면: 「자료스캔후 [저장] 배치가 너무
 *   아래 동떨어져 배치됨」〉.
 *
 *   이 화면은 앱 안의 **틀(iframe)** 에서 돈다. 틀은 내용 높이만큼 늘어나므로
 *   그 안에서 `position: fixed; bottom: 0` 은 「보이는 화면의 아래」가 아니라
 *   **「틀의 아래」**가 된다. 재 보니 막대 아래로 **1946px** 이 더 있었다 —
 *   사장님이 보신 그 빈칸이다.
 *
 * ★ 소스를 글자로 대조해서는 이걸 못 잡는다. `position: fixed` 는 어느 쪽에서도
 *   똑같이 생겼고, **틀리는 것은 좌표**다. 그래서 실제로 그려서 잰다.
 *
 * ★ 못 재는 경우(크로미움 없음)는 **통과가 아니다** — 되돌아오는 값 2
 *   (CLAUDE.md §8 · M-11 · M-12 · M-30).
 *
 * 되돌아오는 값: 0 제자리 · 1 어긋남 · 2 못 쟀다
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const P = path.join(__dirname, '..', 'ui', 'platform');

/** 표 끝과 막대 사이가 이보다 벌어지면 「동떨어졌다」로 본다 (px) */
const MAX_GAP = 120;
/** 막대 아래로 남는 화면. 붙박이가 아니면 여기가 거의 0 이어야 한다 (px) */
const MAX_TAIL = 200;

const MEASURE = [
  '<scr' + 'ipt>',
  '(function () {',
  '  function go() {',
  '    var s = document.querySelector(".save");',
  '    var body = document.querySelector(".body");',
  '    var last = body && body.lastElementChild;',
  '    var out = { found: !!s };',
  '    if (s) {',
  '      var r = s.getBoundingClientRect();',
  '      out.parent = s.parentElement.className || s.parentElement.tagName;',
  '      out.position = getComputedStyle(s).position;',
  '      out.inframe = document.documentElement.hasAttribute("data-lp-inframe");',
  '      out.gap = last ? Math.round(r.top - last.getBoundingClientRect().bottom) : null;',
  '      out.docH = Math.round(document.documentElement.scrollHeight);',
  '      out.tailBelow = out.docH - Math.round(r.bottom + (window.scrollY || 0));',
  '    }',
  '    var txt = JSON.stringify(out);',
  '    /* 틀 안에서 잰 값은 틀 밖으로 넘겨야 읽힌다 — --dump-dom 은 틀 안을 안 준다 */',
  '    try { if (window.top !== window.self) parent.postMessage(txt, "*"); } catch (_) {}',
  '    document.documentElement.setAttribute("data-lp-measure", txt);',
  '  }',
  '  setTimeout(go, 1800);',
  '}());',
  '</scr' + 'ipt>',
].join('\n');

function parse(dom) {
  const m = dom.match(/data-lp-measure="([^"]*)"/);
  if (!m) return null;
  try {
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  } catch (_) { return null; }
}

async function probe() {
  const B = require(path.join(P, 'build-static.js'));
  const browser = B.findBrowser();
  if (!browser) return { measured: false, why: '크로미움이 없다' };

  const docs = await require(path.join(P, 'build-preview.js')).buildSectionDocs();
  const doc = docs.fields;
  if (!doc) return { measured: false, why: 'fields 화면 문서를 못 만들었다' };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'save-bar-'));
  const solo = path.join(tmp, 'solo.html');
  fs.writeFileSync(solo, doc.replace('</body>', MEASURE + '</body>'));

  /* ★ 틀 안을 흉내내지 않는다 — **진짜 틀에 넣어** 잰다. 흉내내면 「틀인지
   *   알아채는 부분」이 통째로 시험에서 빠진다 (CLAUDE.md §8 「표본이 거짓말을
   *   하면 잡히는 것도 거짓이다」) */
  const host = path.join(tmp, 'host.html');
  fs.writeFileSync(host, '<!doctype html><html><body style="margin:0">'
    + '<iframe src="solo.html" style="width:1180px;height:900px;border:0"></iframe>'
    + '<scr' + 'ipt>window.addEventListener("message", function (e) {'
    + ' document.documentElement.setAttribute("data-lp-measure", String(e.data)); });</scr' + 'ipt>'
    + '</body></html>');

  return {
    measured: true,
    solo: parse(B.renderDom(browser, solo, 9000, 1280)),
    framed: parse(B.renderDom(browser, host, 9000, 1280)),
  };
}

module.exports = { probe, MAX_GAP, MAX_TAIL };

/* ── 사람이 직접 부를 때 ────────────────────────────────── */
function verdict(r) {
  if (!r.measured) return { code: 2, line: `못 쟀다 — ${r.why}` };
  const f = r.framed;
  const s = r.solo;
  if (!f || !f.found) return { code: 2, line: '틀 안에서 막대를 못 찾았다 — 못 쟀다' };
  if (!s || !s.found) return { code: 2, line: '혼자 뜬 판에서 막대를 못 찾았다 — 못 쟀다' };

  const bad = [];
  if (f.position !== 'static') bad.push(`틀 안인데 아직 붙박이다 (${f.position})`);
  if (!/main/.test(String(f.parent))) bad.push(`막대가 표 바깥에 붙었다 (${f.parent})`);
  if (f.gap === null || f.gap < 0 || f.gap > MAX_GAP) bad.push(`표 끝과 ${f.gap}px 떨어졌다`);
  if (f.tailBelow > MAX_TAIL) bad.push(`막대 아래로 ${f.tailBelow}px 이 더 있다`);
  if (s.position !== 'fixed') bad.push(`혼자 뜬 판에서 붙박이가 풀렸다 (${s.position})`);

  if (bad.length) return { code: 1, line: bad.join(' · ') };
  return { code: 0, line: `틀 안 ${f.gap}px 아래·꼬리 ${f.tailBelow}px · 혼자 뜬 판은 붙박이` };
}

if (require.main === module) {
  probe().then((r) => {
    const v = verdict(r);
    process.stdout.write(`[저장] 막대 자리: ${v.line}\n`);
    process.exit(v.code);
  }).catch((e) => {
    process.stdout.write(`[저장] 막대 자리: 재다가 죽었다 — ${e.message}\n`);
    process.exit(2);
  });
}

module.exports.verdict = verdict;
