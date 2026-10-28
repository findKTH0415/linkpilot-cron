'use strict';
/**
 * frame-shrink.test.js — **틀이 내용을 따라 줄어드는가** 〈2026-09-01 · M-72〉.
 *
 * ★★★ 무슨 일이 있었나. 사장님 신고: 「스크롤 하면 작동이 잘 안 됨」.
 *   `report-flow.html` 의 `fit()` 이 안쪽 높이를 `scrollHeight` 로 쟀다.
 *   그런데 **틀 높이가 곧 안쪽의 화면 높이**가 되고, `scrollHeight` 는 화면
 *   높이 아래로 내려가지 않는다. 실측 — 내용이 1200px→200px 로 줄었는데
 *   `scrollHeight` 는 **1200 을 그대로** 돌려줬다.
 *
 *   결과: **틀은 커지기만 하고 한 번 커지면 안 줄어든다.** 긴 단계에서 짧은
 *   단계로 옮기면 빈 칸이 그만큼 남고, 사장님은 그 빈 칸을 스크롤하시게 된다.
 *
 * ★★ **똑같은 고장을 `embed-bridge.js` 가 2026-08-23 에 이미 고쳤다.** 그런데
 *   고침이 그 파일에만 들어갔다 — M-69·M-70 과 같은 병이다.
 *   그래서 이 검사는 **두 자리를 함께** 본다.
 *
 * ★ 재는 것은 「스크롤이 되는가」가 아니라 **「줄어든 내용을 따라가는가」**다.
 *   커지는 쪽은 옛 방식으로도 되므로, 커지는 것만 재면 언제나 초록이다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const P = path.join(__dirname, '..', 'ui', 'platform');

/** 주석을 떼고 본다 — 경위를 적어 둔 주석이 코드로 읽히면 검사가 눈이 먼다 (§8) */
function code(file) {
  return fs.readFileSync(path.join(P, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('★★★ 틀 높이를 재는 두 자리가 모두 내용 상자를 본다', () => {
  /* `scrollHeight` 를 **홀로** 쓰면 안 된다. 물러설 자리로 두는 것은 괜찮다 —
     그래서 「`getBoundingClientRect` 가 먼저 있는가」로 잰다. */
  for (const f of ['report-flow.html', 'embed-bridge.js']) {
    const s = code(f);
    assert.ok(/getBoundingClientRect\(\)[\s\S]{0,200}?\.height/.test(s),
      `${f} 이 내용 상자를 안 잰다 — scrollHeight 만 쓰면 틀이 줄지 않는다`);
  }
});

function findBrowser() {
  const env = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM;
  if (env && fs.existsSync(env)) return env;
  try { return require('../core/raster.js').findBrowser(); } catch (_) { return null; }
}

test('★★★ 실제로 그려서 잰다 — 내용이 줄면 잰 높이도 준다', (t) => {
  const browser = findBrowser();
  if (!browser) { t.skip('헤드리스 크로미움이 없어 **못 쟀다** (통과가 아니다)'); return; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-fit-'));
  try {
    /* 안쪽: 틀에 얹혔을 때와 같은 조건(`height:auto`)에서 내용이 줄어든다 */
    fs.writeFileSync(path.join(dir, 'inner.html'),
      '<!doctype html><html><head><meta charset=utf-8><style>'
      + 'html,body{height:auto!important;min-height:0!important;margin:0}'
      + 'body{overflow-y:hidden!important}#big{height:1200px}'
      + '</style></head><body><div id="big"></div><scr' + 'ipt>'
      + 'setTimeout(function(){document.getElementById("big").style.height="200px";},700);'
      + '</scr' + 'ipt></body></html>');

    /* 바깥: 옛 방식과 새 방식을 **나란히** 재고, 옛 방식대로 높이를 실제로 쓴다.
       그래야 「틀이 커져서 안쪽 화면이 커지는」 되먹임이 그대로 생긴다. */
    fs.writeFileSync(path.join(dir, 'outer.html'),
      '<!doctype html><html><head><meta charset=utf-8>'
      + '<style>html,body{margin:0}iframe{display:block;width:100%;border:0}</style>'
      + '</head><body><iframe id="a" src="inner.html" style="height:320px"></iframe><scr' + 'ipt>'
      + 'var fr=document.getElementById("a"),lastOld=0,seen=null;'
      + 'function oldWay(d){return Math.max(d.documentElement.scrollHeight,d.body?d.body.scrollHeight:0)}'
      + 'function newWay(d){var el=d.documentElement;'
      + ' if(el&&el.getBoundingClientRect){var r=el.getBoundingClientRect();'
      + '  if(r&&r.height>0)return Math.ceil(r.height)}'
      + ' return Math.max(el?el.scrollHeight:0,d.body?d.body.scrollHeight:0)}'
      + 'var n=0,iv=setInterval(function(){var d=fr.contentDocument;'
      + ' if(d&&d.body){var ho=oldWay(d),hn=newWay(d);'
      + '  if(ho!==lastOld){lastOld=ho;fr.style.height=ho+"px"}'
      + '  seen={old:ho,neu:hn,content:d.getElementById("big")?d.getElementById("big").offsetHeight:-1}}'
      + ' if(++n>40){clearInterval(iv);'
      + '  document.documentElement.setAttribute("data-fit",JSON.stringify(seen))}},60);'
      + '</scr' + 'ipt></body></html>');

    let dom = '';
    try {
      dom = execFileSync(browser, ['--headless', '--disable-gpu', '--no-sandbox',
        '--allow-file-access-from-files', '--window-size=1200,900',
        '--virtual-time-budget=9000', '--dump-dom',
        `file://${path.join(dir, 'outer.html')}`], { encoding: 'utf8', timeout: 90000 });
    } catch (e) { t.skip(`크로미움이 못 돌았다 — ${String(e.message).split('\n')[0]}`); return; }

    const m = dom.match(/data-fit="([^"]*)"/);
    if (!m) { t.skip('재는 값이 안 찍혔다 — **못 쟀다**'); return; }
    const got = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

    assert.strictEqual(got.content, 200, `표본이 안 줄었다 — 재려는 성질이 없다 (${got.content})`);
    assert.ok(got.old > 900,
      `옛 방식이 줄어 버렸다 (${got.old}) — 그러면 이 검사가 아무것도 안 지킨다`);
    assert.ok(got.neu <= 260,
      `새 방식도 안 줄었다 (${got.neu}) — 내용은 200px 인데 이만큼을 돌려주면 빈 칸이 남는다`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
