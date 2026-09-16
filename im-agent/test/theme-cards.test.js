'use strict';
/**
 * theme-cards.test.js — **테마를 「모양을 보고」 고르는가**
 *
 * 〈2026-09-17 사장님 지시: 「보고서 생성에 디자인 템플렛 선택 할수 있도록 만들어줘」 ·
 *  PPT 템플릿 갤러리 사진 다섯 · AskUserQuestion 답 「앱에서 모양 보고 고르기」〉
 *
 * ★★★ **무엇을 막으려고 만들었나.** 고르는 칸은 이미 있었다 — 다만 **색 점 하나 +
 *   이름**이었다. 「Institutional」과 「Premium」이 어떻게 다른지 이름만 보고는 못
 *   고른다. 그래서 고르는 사람은 첫 번째를 누르거나 추천을 그냥 받는다 — **둘 다
 *   고른 것이 아니다** (`design-options.test.js` 가 같은 이유로 세워진 자리다).
 *
 * ★★ 그리고 이 자리는 **눈으로만 확인되는 고장**이 나기 쉽다. 표지 열셋이 전부
 *   같은 모양으로 그려져도 **오류가 한 줄도 안 난다** — 화면은 예쁘고 카드는 열셋이다.
 *   그러니 「카드가 있는가」가 아니라 **「갈래가 실제로 갈리는가」**를 잰다.
 *
 * ★ 재는 것 넷:
 *   ① 값이 `themes.js` 에서 오는가 (화면·갤러리 어디에도 손으로 적힌 값이 없는가)
 *   ② 커밋된 생성물(`style-ab.js`)이 지금 `themes.js` 와 **같은가** — 재생성을 안 하면
 *      화면만 옛말을 하고, 그 상태가 아무 오류도 안 낸다 (§8 「옛 판을 주는 것이 더 나쁘다」)
 *   ③ 표지 그리는 규칙이 **두 곳(화면 · 갤러리)에서 같은가**
 *   ④ **그려서** — 갈래별 표지가 실제 픽셀에서 다른가 (「있는가」로는 못 잡는다)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const UI = path.join(__dirname, '..', 'ui', 'platform');
const themes = require('../design/themes.js');
const gallery = require(path.join(UI, 'build-theme-cards.js'));
const styleBuilder = require(path.join(UI, 'build-styleoptions.js'));

const reportsSrc = fs.readFileSync(path.join(UI, 'reports.html'), 'utf8');

/* ── ① 값이 themes.js 에서 온다 ───────────────────────────── */

test('★★★ 테마 **전부**가 카드로 나온다 — 하나가 빠져도 그 테마는 못 고른다', () => {
  const ids = Object.keys(themes.THEMES);
  const got = gallery.cards().map((c) => c.id);
  assert.deepStrictEqual(got, ids,
    `카드가 테마와 다르다 — 테마 ${ids.length}종 / 카드 ${got.length}장`);
  assert.ok(ids.length >= 13, `테마가 ${ids.length}종뿐이다 — 고를 거리가 줄었다`);
});

test('★★★ 카드 값이 **테마의 실제 값**이다 (손으로 지어 적지 않았다)', () => {
  gallery.cards().forEach((c) => {
    const T = themes.get(c.id);
    assert.strictEqual(c.color, T.primary, `${c.id} 의 색이 테마와 다르다`);
    assert.strictEqual(c.accent, T.accent, `${c.id} 의 강조색이 테마와 다르다`);
    assert.strictEqual(c.name, T.label, `${c.id} 의 이름이 테마와 다르다`);
    assert.ok(c.purpose, `${c.id} 에 쓰임새가 비었다 — 이름만으로는 못 고른다`);
  });
});

/* ── ② 커밋된 생성물이 지금 값과 같은가 ─────────────────────── */

test('★★★ 커밋된 `style-ab.js` 가 지금 테마와 **같다** (재생성을 빠뜨리면 화면만 옛말을 한다)', () => {
  const committed = require(path.join(UI, 'style-ab.js'));
  const now = gallery.cards();
  assert.strictEqual(committed.THEME_CARDS.length, now.length,
    `생성물에 ${committed.THEME_CARDS.length}장, 지금 테마는 ${now.length}종 — \`npm run im:styles\` 를 다시 돌린다`);
  now.forEach((c, i) => {
    const k = committed.THEME_CARDS[i];
    ['id', 'shape', 'color', 'accent', 'surface'].forEach((f) => {
      assert.strictEqual(k[f], c[f],
        `${c.id} 의 ${f} 가 생성물과 다르다 (${k[f]} ≠ ${c[f]}) — \`npm run im:styles\``);
    });
  });
});

/* ── ③ 표지 규칙이 두 곳에서 같은가 ────────────────────────── */

test('★★★ 갈래가 **실제로 갈린다** — 열셋이 한 모양이면 고를 것이 없다', () => {
  const by = {};
  gallery.cards().forEach((c) => { by[c.shape] = (by[c.shape] || 0) + 1; });
  const kinds = Object.keys(by);
  assert.ok(kinds.length >= 3,
    `표지 갈래가 ${kinds.length}가지뿐이다 (${JSON.stringify(by)}) — 모양을 보고 고를 수가 없다`);
  /* 한 갈래가 다 먹어도 「갈렸다」로 세지 않는다 */
  const top = Math.max.apply(null, kinds.map((k) => by[k]));
  assert.ok(top <= gallery.cards().length - 3,
    `한 갈래(${top}장)가 거의 전부다 — ${JSON.stringify(by)}`);
});

test('★★★ 화면과 갤러리가 **같은 규칙**으로 갈래를 정한다 (두 벌이면 한쪽이 옛말을 한다)', () => {
  /* 화면(`reports.html`)은 갈래를 스스로 안 정한다 — 생성물의 `shape` 을 그대로 읽는다.
     그 생성물을 만드는 자리(`build-styleoptions.themeCards`)와 갤러리의 `shapeOf` 가
     같은 답을 내야 둘이 한 벌이다. */
  const fromBuilder = styleBuilder.themeCards();
  const fromGallery = gallery.cards();
  assert.strictEqual(fromBuilder.length, fromGallery.length, '두 자리의 장수가 다르다');
  fromGallery.forEach((c, i) => {
    assert.strictEqual(fromBuilder[i].shape, c.shape,
      `${c.id} 의 갈래가 두 자리에서 다르다 (${fromBuilder[i].shape} ≠ ${c.shape})`);
  });
  /* 자를 실제로 대 본다 — 규칙만 있고 안 쓰이면 위 비교는 헛돈다 */
  assert.strictEqual(gallery.shapeOf('fullImage'), 'full');
  assert.strictEqual(gallery.shapeOf('split'), 'split');
  assert.strictEqual(gallery.shapeOf('rule'), 'rule');
  assert.strictEqual(gallery.shapeOf(''), 'plain');
});

test('★★ 화면이 값을 **손으로 안 적는다** — 생성물을 읽는다', () => {
  assert.match(reportsSrc, /window\.LP_THEME_CARDS/,
    '화면이 생성물을 안 읽는다 — 값을 화면에 적으면 테마가 바뀐 날 조용히 옛말을 한다');
  assert.match(reportsSrc, /data-theme-card/, '카드에 표시가 없어 그려서 잴 수가 없다');
  assert.match(reportsSrc, /data-theme-all/, '[전체 테마 보기] 접힘에 표시가 없다');
  /* 테마 색을 화면에 박아 두지 않았는가 — 박으면 두 벌이 된다 */
  const hard = Object.keys(themes.THEMES)
    .map((id) => themes.get(id).primary)
    .filter((hex) => hex && reportsSrc.includes(hex));
  assert.deepStrictEqual(hard, [],
    `테마 색이 화면에 글자로 박혀 있다: ${hard.join(' ')} — 테마를 고치면 한쪽만 바뀐다`);
});

test('★★ 기본 화면에는 **두 안만** 펴 두고 나머지는 접는다 (§6-3 ⑥)', () => {
  /* 열셋을 늘어놓으면 「내가 뭘 골라야 하나」가 된다. 다만 **여는 길은 있어야** 한다. */
  const m = reportsSrc.match(/el\('details',\s*'thmore'\)/);
  assert.ok(m, '전체 목록이 접힘 안에 없다 — 열셋이 기본 화면에 펴진다');
  assert.ok(!/<details[^>]+class="thmore"[^>]*\sopen/.test(reportsSrc),
    '접힘이 펴진 채로 열린다 — 접어 둔 뜻이 없다');
  assert.match(reportsSrc, /전체 테마 보기/, '여는 자리에 무엇인지 안 적혀 있다');
});

/* ── ④ 그려서 잰다 ────────────────────────────────────────── */

function findBrowser() {
  const env = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM;
  if (env && fs.existsSync(env)) return env;
  try { return require('../core/raster.js').findBrowser(); } catch (_) { return null; }
}

test('★★★ **그려서** 잰다 — 카드가 다 나오고 갈래별 표지가 실제로 다르다', (t) => {
  const browser = findBrowser();
  if (!browser) { t.skip('헤드리스 크로미움이 없어 **못 쟀다** (통과가 아니다)'); return; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-thcard-'));
  try {
    /* 커밋본에 쓰지 않는다 — `npm test` 만으로 작업본이 더러워지면 안 된다
       (`themes-gallery.test.js` 가 같은 자리에서 두 번 당했다) */
    const out = path.join(dir, 'cards.html');
    fs.writeFileSync(out, fs.readFileSync(gallery.OUT, 'utf8'), 'utf8');
    /* 갤러리가 지금 값으로 다시 만들어도 같은지 — 옛 판을 재고 초록이 되지 않게 */
    const rebuilt = execFileSync('node', ['-e',
      `const g=require(${JSON.stringify(path.join(UI, 'build-theme-cards.js'))});`
      + `const fs=require('fs');const o=g.build();process.stdout.write(String(o.count));`],
      { encoding: 'utf8', timeout: 60000 }).trim();
    assert.strictEqual(rebuilt, String(gallery.cards().length), '갤러리를 다시 만들 수 없다');

    const probe = path.join(dir, 'probe.html');
    fs.writeFileSync(probe,
      fs.readFileSync(gallery.OUT, 'utf8').replace('</body>', '<scr' + 'ipt>'
      + 'try{var cs=document.querySelectorAll("[data-theme-card]");var o={n:cs.length,shapes:{},tops:{},ratio:0};'
      + 'if(cs.length){var cv=cs[0].querySelector(".thcov");var r=cv.getBoundingClientRect();'
      + ' o.ratio=Math.round(r.height/r.width*1000)/1000;o.w=Math.round(r.width);}'
      + 'for(var i=0;i<cs.length;i++){var s=cs[i].getAttribute("data-shape");'
      + ' o.shapes[s]=(o.shapes[s]||0)+1;'
      + ' var c=cs[i].querySelector(".thcov"),tp=cs[i].querySelector(".thcov__t");'
      + ' if(c&&tp){var rc=c.getBoundingClientRect(),rt=tp.getBoundingClientRect();'
      + '  var pct=Math.round(rt.height/rc.height*100);'
      + '  (o.tops[s]=o.tops[s]||[]).push(pct);}}'
      + 'document.documentElement.setAttribute("data-th",JSON.stringify(o));'
      + '}catch(e){document.documentElement.setAttribute("data-th-err",String(e&&e.message));}'
      + '</scr' + 'ipt></body>'), 'utf8');

    let dom = '';
    try {
      dom = execFileSync(browser, ['--headless', '--disable-gpu', '--no-sandbox',
        '--allow-file-access-from-files', '--window-size=1000,1400',
        '--virtual-time-budget=6000', '--dump-dom', `file://${probe}`],
        { encoding: 'utf8', timeout: 90000 });
    } catch (e) { t.skip(`크로미움이 못 돌았다 — ${String(e.message).split('\n')[0]}`); return; }

    const err = dom.match(/data-th-err="([^"]*)"/);
    assert.ok(!err, `재는 코드가 던졌다 — ${err && err[1]}`);
    const m = dom.match(/data-th="([^"]*)"/);
    if (!m) { t.skip('재는 값이 안 찍혔다 — **못 쟀다**'); return; }
    const got = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

    assert.strictEqual(got.n, gallery.cards().length,
      `그려진 카드가 ${got.n}장, 테마는 ${gallery.cards().length}종이다`);
    /* A4 비율 — 표지가 정사각이면 「문서」로 안 읽힌다 */
    assert.ok(Math.abs(got.ratio - 1.414) < 0.03,
      `표지 비율이 ${got.ratio} 다 (A4 는 1.414) — 폭 ${got.w}px`);

    /* ★ 여기가 급소다 — 갈래가 **픽셀에서** 갈리는가.
       열셋이 같은 모양으로 그려져도 카드 수·비율은 전부 통과한다. */
    const avg = {};
    Object.keys(got.tops).forEach((k) => {
      avg[k] = Math.round(got.tops[k].reduce((a, b) => a + b, 0) / got.tops[k].length);
    });
    assert.ok(avg.split !== undefined && avg.full !== undefined,
      `갈래가 안 그려졌다 — ${JSON.stringify(avg)}`);
    assert.ok(avg.full - avg.split >= 20,
      `split(${avg.split}%)과 full(${avg.full}%)의 표지가 사실상 같다 — 모양을 보고 고를 수가 없다`);
    /* 같은 갈래끼리는 같아야 한다 — 다르면 갈래표가 거짓이다 */
    Object.keys(got.tops).forEach((k) => {
      const set = Array.from(new Set(got.tops[k]));
      assert.strictEqual(set.length, 1,
        `같은 갈래 ${k} 안에서 표지가 제각각이다 (${set.join('/')})`);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('★ 갤러리는 **파일 하나로 열린다** — 바깥 파일을 안 부른다 (§8)', () => {
  const html = fs.readFileSync(gallery.OUT, 'utf8');
  assert.ok(!/<link[^>]+href=/i.test(html), '바깥 스타일시트를 부른다');
  assert.ok(!/<script[^>]+src=/i.test(html), '바깥 스크립트를 부른다');
  assert.ok(!/https?:\/\//.test(html), '바깥 주소를 부른다');
  assert.ok(!/<img/i.test(html), '그림 파일을 쓴다 — 13장이면 화면이 무거워진다 (CSS 로 그린다)');
  const emoji = html.match(/\p{Extended_Pictographic}/gu) || [];
  assert.strictEqual(emoji.length, 0, `이모지가 있다: ${emoji.join(' ')}`);
});

test('★ 갤러리가 **표지는 갈래를 보이는 것**임을 화면에 적는다 (실제 표지로 오해하지 않게)', () => {
  const html = fs.readFileSync(gallery.OUT, 'utf8');
  assert.match(html, /실제 표지 그대로가 아닙니다/,
    '표지가 견본임을 안 적었다 — 실제 표지로 오해하면 그것을 근거로 판단한다 (§8)');
});
