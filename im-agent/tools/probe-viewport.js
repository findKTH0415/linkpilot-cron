'use strict';
/**
 * probe-viewport.js — **화면 크기에서 무엇이 잘리거나 밖으로 나가는가.**
 *
 *   npm run probe:viewport
 *
 * ★★★ **왜 만들었나** 〈2026-09-01 사장님 지시 — 「권장안대로 진행」 · M-71 · M-72〉.
 *
 *   같은 날 화면 크기 문제 둘이 났다 —
 *     M-71  폰에서 내용이 잘린 채 스크롤이 안 됐다
 *     M-72  앱 틀이 커지기만 하고 줄지 않아 빈 칸이 남았다
 *   **둘 다 사장님이 눈으로 찾으셨다.** 그때까지 검사는 전부 초록이었다.
 *
 *   기존 검사(`render-scan`)는 **「그려지는가」**를 본다. 그려지기는 하는데
 *   **자리가 틀린** 고장은 그것으로 안 잡힌다. 이 도구가 그 자리를 맡는다.
 *
 * ★ 재는 것 넷 (폰·데스크탑 두 폭에서):
 *   ① **가로로 넘치는가** — 본문이 옆으로 밀리면 안 된다 (CLAUDE.md 아티팩트 규칙과 같은 뜻)
 *   ② **화면 밖으로 나간 것이 있는가** — 단추·글자가 오른쪽으로 삐져나가면 못 누른다
 *   ③ **상자가 내용보다 작은가** — M-71 이 난 모양
 *   ④ **글자가 잘렸는가** — `overflow:hidden` 안에서 내용이 넘친 것
 *
 * ★★ **일부러 그런 것은 세지 않는다.** 안 그러면 늘 빨갛고, **늘 빨간 검사는
 *   아무도 안 본다** (M-25 와 같은 결).
 *   - 가로 스크롤 상자(`overflow-x:auto|scroll`) 안은 **넘치라고 만든 것**이다
 *   - `text-overflow:ellipsis` 는 **줄이라고 붙인 것**이다
 *   - 안 보이는 것(넓이·높이 0, `display:none`)은 자리가 없다
 *
 * ★ 못 재면 **「못 쟀다」**로 끝난다 (되돌아오는 값 2). 통과가 아니다 (§8).
 *
 * 되돌아오는 값: 0 이상 없음 · 1 잘리거나 넘쳤다 · 2 못 쟀다
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const P = path.join(__dirname, '..', 'ui', 'platform');

/** 어느 폭에서 보는가 — 사장님이 실제로 쓰시는 둘 */
const SIZES = [
  { name: '폰', w: 390, h: 844 },
  { name: '맥', w: 1440, h: 900 },
];

/** 삐져나감을 이만큼은 봐 준다 (px) — 그림자·테두리 반올림 */
const SLACK = 2;

function findBrowser() {
  const env = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM;
  if (env && fs.existsSync(env)) return env;
  try { return require('../core/raster.js').findBrowser(); } catch (_) { return null; }
}

/**
 * 화면 안에서 도는 자막대기.
 *
 * ★ 글자로 만든다 — 이 문자열은 화면 HTML 에 끼워 넣는다. 그래서 `</scr`+`ipt>`
 *   처럼 잘라 쓴다(안 그러면 이 파일의 스크립트가 거기서 끝난다).
 */
const MEASURE = [
  '<scr' + 'ipt>',
  '(function () {',
  '  function scroller(n) {',
  '    for (var p = n.parentElement; p; p = p.parentElement) {',
  '      var s = getComputedStyle(p);',
  '      if (s.overflowX === "auto" || s.overflowX === "scroll") return true;',
  '      if (s.overflowY === "auto" || s.overflowY === "scroll") return true;',
  '    }',
  '    return false;',
  '  }',
  '  function go() {',
  '    var el = document.documentElement, b = document.body;',
  '    var vw = el.clientWidth, out = { w: vw, h: el.clientHeight };',
  '    out.sideways = el.scrollWidth - vw;',
  '    var wrap = document.querySelector(".wrap") || b;',
  '    out.boxH = Math.round(parseFloat(getComputedStyle(el).height) || 0);',
  '    out.contentH = Math.round(wrap.getBoundingClientRect().height);',
  '    var over = [], cut = [];',
  '    var all = document.querySelectorAll("body *");',
  '    for (var i = 0; i < all.length; i++) {',
  '      var n = all[i], s = getComputedStyle(n);',
  '      if (s.display === "none" || s.visibility === "hidden") continue;',
  '      var r = n.getBoundingClientRect();',
  '      if (r.width < 1 || r.height < 1) continue;',
  '      var tag = (n.tagName + "." + (n.className || "")).slice(0, 60);',
  '      if (!scroller(n) && (r.right > vw + ' + SLACK + ' || r.left < -' + SLACK + ')) {',
  '        if (over.length < 6) over.push(tag + " →" + Math.round(r.right));',
  '      }',
  '      if (s.overflowX === "hidden" && s.textOverflow !== "ellipsis"',
  '          && n.scrollWidth > n.clientWidth + ' + SLACK + ' && n.children.length === 0) {',
  '        if (cut.length < 6) cut.push(tag + " " + n.clientWidth + "<" + n.scrollWidth);',
  '      }',
  '    }',
  '    out.over = over; out.cut = cut;',
  '    var txt = JSON.stringify(out);',
  '    /* 틀 안에서 잰 값은 틀 밖으로 넘겨야 읽힌다 — --dump-dom 은 틀 안을 안 준다 */',
  '    try { if (window.top !== window.self) parent.postMessage(txt, "*"); } catch (_) {}',
  '    document.documentElement.setAttribute("data-lp-vp", txt);',
  '  }',
  '  setTimeout(go, 2200);',
  '}());',
  '</scr' + 'ipt>',
].join('\n');

/** 화면 폴더를 통째로 옮겨 놓고 **이름을 그대로** 둔다 — 이름이 다르면 다른 것을 재게 된다 */
function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-vp-'));
  for (const n of fs.readdirSync(P)) {
    if (/\.(html?|js|css)$/i.test(n)) {
      try { fs.copyFileSync(path.join(P, n), path.join(dir, n)); } catch (_) {}
    }
  }
  return dir;
}

/**
 * 폭이 **정확한** 틀에 화면을 넣는 겉장.
 *
 * ★★★ **헤드리스 창은 390px 로 안 줄어든다** 〈2026-09-01 · 실측〉.
 *   `--window-size=390,844` 를 줘도 실제 폭이 **485px** 로 나왔다. 그대로 두면
 *   **폰을 잰 줄 알고 폰이 아닌 폭을 재게 된다** — 오늘 세 번 겪은
 *   「초록인데 안 재고 있었다」와 같은 모양이다.
 * ★ 그래서 폭이 정확한 **틀**에 넣고 잰다. 창은 틀보다 넉넉히 열어야 틀이 안 눌린다.
 */
function hostPage(file, size) {
  return '<!doctype html><html><head><meta charset=utf-8>'
    + '<style>html,body{margin:0;background:#fff}'
    + `iframe{display:block;width:${size.w}px;height:${size.h}px;border:0}</style>`
    + '</head><body>'
    + `<iframe src="${file}"></iframe>`
    + '<scr' + 'ipt>'
    + 'addEventListener("message",function(e){'
    + ' if(typeof e.data==="string"&&e.data.charAt(0)==="{")'
    + '  document.documentElement.setAttribute("data-lp-vp",e.data)});'
    + '</scr' + 'ipt></body></html>';
}

function measure(browser, dir, file, size) {
  const target = path.join(dir, file);
  const orig = fs.readFileSync(target, 'utf8');
  const host = path.join(dir, `__vp-${size.w}-${file}`);
  fs.writeFileSync(target, orig.replace('</body>', MEASURE + '\n</body>'));
  fs.writeFileSync(host, hostPage(file, size));
  let dom = '';
  const done = () => {
    fs.writeFileSync(target, orig);
    try { fs.rmSync(host); } catch (_) {}
  };
  try {
    dom = execFileSync(browser, ['--headless', '--disable-gpu', '--no-sandbox',
      '--allow-file-access-from-files',
      `--window-size=${Math.max(size.w + 200, 900)},${size.h + 120}`,
      '--virtual-time-budget=8000', '--dump-dom', `file://${host}`],
    { encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    done();
    return { error: String(e.message).split('\n')[0] };
  }
  done();
  const m = dom.match(/data-lp-vp="([^"]*)"/);
  if (!m) return { error: '재는 값이 안 찍혔다' };
  let got;
  try {
    got = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } catch (e) { return { error: '재는 값을 못 읽었다' }; }
  /* ★★★ **재려던 폭으로 실제로 쟀는지 확인한다.** 안 그러면 폰을 잰 줄 알고
   *   다른 폭을 재고도 초록이 된다 — 오늘 세 번 겪은 모양이다. */
  if (Math.abs(got.w - size.w) > 20) {
    return { error: `폭이 ${got.w}px 로 나왔다 (${size.w}px 를 재려 했다)` };
  }
  return got;
}

function scan(files, sizes) {
  const browser = findBrowser();
  if (!browser) return { measured: false, why: '헤드리스 크로미움이 없다' };
  const dir = stage();
  const rows = [];
  try {
    for (const f of files) {
      for (const s of sizes) rows.push(Object.assign({ file: f, size: s.name }, measure(browser, dir, f, s)));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return { measured: true, rows };
}

function bad(r) {
  if (r.error) return null;                       // 못 잰 것은 「이상」이 아니다 — 따로 센다
  const why = [];
  if (r.sideways > SLACK) why.push(`가로로 ${r.sideways}px 넘친다`);
  if ((r.over || []).length) why.push(`화면 밖 ${r.over.length}개 (${r.over.slice(0, 2).join(' · ')})`);
  if (r.contentH && r.boxH && r.boxH + SLACK < r.contentH) {
    why.push(`상자(${r.boxH})가 내용(${r.contentH})보다 작다`);
  }
  if ((r.cut || []).length) why.push(`글자 잘림 ${r.cut.length}개 (${r.cut.slice(0, 2).join(' · ')})`);
  return why.length ? why.join(' · ') : null;
}

function main(argv) {
  const only = argv.slice(2).filter((a) => !a.startsWith('-'));
  const files = only.length ? only : require('../ui/platform/build-stamp.js').pages();
  const r = scan(files, SIZES);
  if (!r.measured) {
    process.stdout.write(`화면 크기: 못 쟀다 — ${r.why}\n`);
    return 2;
  }
  const errs = r.rows.filter((x) => x.error);
  const hits = r.rows.map((x) => ({ x, why: bad(x) })).filter((o) => o.why);

  r.rows.forEach((x) => {
    if (x.error) { process.stdout.write(`  ⚠️  ${x.file} (${x.size}) — 못 쟀다: ${x.error}\n`); return; }
    const w = bad(x);
    process.stdout.write(`  ${w ? '❌' : '·'} ${x.file} (${x.size} ${x.w}px)${w ? ' — ' + w : ''}\n`);
  });

  if (errs.length) {
    process.stdout.write(`\n화면 크기: 못 쟀다 — ${errs.length}개를 못 열었다\n`);
    return 2;
  }
  if (hits.length) {
    process.stdout.write(`\n화면 크기: ${hits.length}곳이 잘리거나 넘친다 — `
      + hits.slice(0, 2).map((o) => `${o.x.file}(${o.x.size}) ${o.why}`).join(' / ') + '\n');
    return 1;
  }
  process.stdout.write(`\n화면 크기: 화면 ${files.length}개 × 폭 ${SIZES.length}개 — 잘리거나 넘친 것 없다\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { scan, bad, main, SIZES, SLACK };
