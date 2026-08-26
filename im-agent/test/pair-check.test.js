/**
 * **화면과 형제 스크립트의 판이 어긋나는 사고**를 막는 두 겹.
 *
 * ★★★ 2026-08-23 실제 사고 (D-93). 사장님 화면이
 *   **「F.readEvidence is not a function」**으로 죽었다.
 *
 *   배포는 초록이었다. 저장소 = 디스크 = HTTP 가 전부 새 판이었고, 화면 아래
 *   지문도 새 판이었다. **브라우저만 `fields-core.js` 를 아침 것으로 들고
 *   있었다** — 새 화면이 새 함수를 불렀고, 그 함수가 옛 스크립트에 없었다.
 *
 * ★ 이 결의 사고는 **화면이 안 뜨는 것보다 나쁘다.** 화면은 멀쩡히 뜨고 지문도
 *   새 판이라, 나오는 말은 「… is not a function」 하나뿐이다. 캐시가 원인이라는
 *   생각 자체가 안 든다. M-25 의 세 갈래(저장소≠디스크 / 디스크≠HTTP /
 *   **브라우저**) 중 마지막 갈래이고, 지금까지 재는 장치가 없던 유일한 갈래다.
 *
 * ★ 그래서 두 겹으로 막는다:
 *   ① **예방** — 형제 주소에 판 표시(`?v=지문`). 내용이 바뀌면 주소가 바뀌므로
 *      브라우저가 다시 받을 수밖에 없다.
 *   ② **탐지** — 그래도 옛것이 오면(프록시·확장·오프라인 캐시) 화면이 자기
 *      지문과 스크립트 지문을 대 보고 **사람 말로** 알린다.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HERE = path.join(__dirname, '..', 'ui', 'platform');
const stamp = require('../ui/platform/build-stamp.js');
const { required } = require('../ui/platform/build-embed.js');

const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');
const pages = () => required().filter((f) => f.endsWith('.html'));

/* ── ① 예방 — 형제 주소에 판이 붙는가 ───────────────────── */

test('★★★ 화면이 부르는 형제 파일 주소에 전부 판 표시가 붙어 있다', () => {
  const want = stamp.bundleHash();
  pages().forEach((f) => {
    const src = read(f);
    const bare = [];
    [...src.matchAll(/<script src="([^"?]+)"(\?[^"]*)?"?|<script src="([^"]+)"/g)];
    [...src.matchAll(/(?:<script src="|<link rel="stylesheet" href=")([^"]+)"/g)]
      .forEach((m) => { if (m[1].indexOf('?v=') === -1) bare.push(m[1]); });
    assert.deepStrictEqual(bare, [],
      `${f}: 판 표시가 없는 주소가 있다 — 브라우저가 옛 파일을 들고 새 화면을 돌린다`);
    const wrong = [...src.matchAll(/(?:<script src="|<link rel="stylesheet" href=")([^"?]+)\?v=([0-9a-f]*)"/g)]
      .filter((m) => m[2] !== want).map((m) => m[1]);
    assert.deepStrictEqual(wrong, [], `${f}: 옛 판 표시가 남아 있다`);
  });
});

test('★★★ 판 표시를 붙여도 지문이 흔들리지 않는다 (자기 자신을 물지 않는다)', () => {
  /* ★ `bare()` 가 `?v=` 와 `LP_BUILD` 를 안 지우면 지문이 매번 달라져
   *   `--check` 가 영원히 빨갛다. 두 번 재서 같은지 본다 */
  assert.strictEqual(stamp.bundleHash(), stamp.bundleHash());
  const one = read(pages()[0]);
  assert.ok(stamp.bare(one).indexOf('?v=') === -1, 'bare() 가 ?v= 를 안 지운다');
  assert.ok(/LP_BUILD = ''/.test(stamp.bare(read('flow-core.js'))),
    'bare() 가 LP_BUILD 값을 안 지운다');
});

test('★★ 판 표시는 파일 이름이 아니다 — 배포 목록에 물음표가 안 들어간다', () => {
  required().forEach((f) => {
    assert.ok(f.indexOf('?') === -1, `배포 목록에 판 표시가 섞였다: ${f}`);
    assert.ok(fs.existsSync(path.join(HERE, f)), `${f} 이 실제로 없다`);
  });
});

/* ── ② 탐지 — 화면이 짝을 확인하는가 ─────────────────────── */

test('★★★ 배포되는 스크립트 전부가 자기 판을 말한다', () => {
  const want = stamp.bundleHash();
  const js = required().filter((f) => f.endsWith('.js'));
  const silent = js.filter((f) => stamp.scriptStampedAt(f) === null);
  assert.deepStrictEqual(silent, [],
    `자기 판을 안 말하는 스크립트가 있다: ${silent.join(', ')} — 짝이 깨져도 못 잡는다`);
  const stale = js.filter((f) => stamp.scriptStampedAt(f) !== want);
  assert.deepStrictEqual(stale, [], `옛 판 표시가 남은 스크립트: ${stale.join(', ')}`);
});

test('★★★ 스크립트가 판을 **밖으로** 내놓는다 (화면이 읽을 수 있어야 한다)', () => {
  const want = stamp.bundleHash();
  required()
    .filter((f) => f.endsWith('.js') && f !== 'embed-bridge.js')
    .forEach((f) => {
      delete require.cache[require.resolve(path.join(HERE, f))];
      const m = require(path.join(HERE, f));
      assert.strictEqual(m.BUILD, want, `${f}: BUILD 를 안 내놓거나 값이 다르다`);
    });
});

test('★★ embed-bridge 도 판을 내놓는다 (브라우저 전역으로만 산다)', () => {
  const src = read('embed-bridge.js');
  assert.match(src, /BUILD: LP_BUILD/, '브리지가 판을 안 내놓는다');
  assert.strictEqual(stamp.scriptStampedAt('embed-bridge.js'), stamp.bundleHash());
});

test('★★★ 화면마다 짝 확인 조각이 들어 있다 — 화면 안에 있어야 한다', () => {
  pages().forEach((f) => {
    const src = read(f);
    assert.ok(src.indexOf('data-lp-pair') !== -1,
      `${f}: 짝 확인 조각이 없다 — 옛 스크립트가 오면 「… is not a function」으로 죽는다`);
    /* ★ 따로 파일로 빼면 **그 파일도 옛것일 수 있다.** 화면 안에 있어야 한다 */
    assert.ok(!/src="[^"]*pair[^"]*"/.test(src),
      `${f}: 짝 확인을 딴 파일로 뺐다 — 그 파일이 옛것이면 확인 자체가 안 돈다`);
  });
});

test('★★★ 짝 확인이 표를 두지 않는다 — 스크립트가 늘어도 안 갈린다', () => {
  const src = read(pages()[0]);
  const at = src.indexOf('data-lp-pair');
  const block = src.slice(Math.max(0, at - 2000), at + 1500);
  assert.ok(block.indexOf('Object.keys(window)') !== -1,
    '전역을 훑지 않고 이름을 손으로 적으면, 스크립트가 늘 때마다 갈린다');
});

test('★★ 짝 확인이 화면을 죽이지 않는다 (감싸져 있다)', () => {
  const block = pairScript();
  assert.ok(/try \{/.test(block) && /catch/.test(block),
    '검사가 던지면 검사 때문에 화면이 죽는다');
});

/* ── 짝 확인 로직을 실제로 돌려 본다 ─────────────────────── */

/** 화면에서 짝 확인 조각만 떼어 낸다 */
function pairScript() {
  const src = read('fields.html');
  const at = src.indexOf('data-lp-pair');
  const open = src.lastIndexOf('<script>', at);
  const close = src.indexOf('</script>', at);
  return src.slice(open + '<script>'.length, close);
}

/** 아주 작은 가짜 DOM — 조각이 쓰는 것만 흉내낸다 */
function fakeWin(docBuild, globals) {
  const made = [];
  const body = { appendChild: (n) => made.push(n) };
  const el = () => {
    const n = { attrs: {}, textContent: '', setAttribute(k, v) { this.attrs[k] = v; } };
    return n;
  };
  const win = {
    document: {
      documentElement: { getAttribute: (k) => (k === 'data-lp-build' ? docBuild : null) },
      body,
      createElement: el,
      addEventListener: () => {},
    },
    made,
  };
  Object.assign(win, globals);
  return win;
}

function runPair(win) {
  // eslint-disable-next-line no-new-func
  new Function('window', 'document',
    'with (window) { ' + pairScript() + ' }')(win, win.document);
  return win.made;
}

test('★★★ 짝이 어긋나면 화면에 사람 말로 뜬다', () => {
  const win = fakeWin('aaaaaaaa', {
    LinkPilotFlow: { BUILD: 'aaaaaaaa' },
    LinkPilotFields: { BUILD: 'bbbbbbbb' },      // 브라우저가 든 옛 스크립트
  });
  const made = runPair(win);
  assert.strictEqual(made.length, 1, '어긋났는데 아무 말도 안 한다');
  assert.match(made[0].textContent, /판이 다릅니다/);
  assert.match(made[0].textContent, /LinkPilotFields \(bbbbbbbb\)/,
    '어느 스크립트가 옛것인지 이름으로 말해야 한다');
  assert.match(made[0].textContent, /새로고침/, '무엇을 하면 되는지 말해야 한다');
});

test('★★★ 짝이 맞으면 아무 말도 안 한다 (헛울음을 안 낸다)', () => {
  const win = fakeWin('aaaaaaaa', {
    LinkPilotFlow: { BUILD: 'aaaaaaaa' },
    LinkPilotFields: { BUILD: 'aaaaaaaa' },
  });
  assert.deepStrictEqual(runPair(win), []);
});

test('★★ 판을 안 말하는 전역은 세지 않는다 — 앱이 넣은 전역까지 잡으면 안 된다', () => {
  const win = fakeWin('aaaaaaaa', {
    LinkPilotFlow: { BUILD: 'aaaaaaaa' },
    LinkPilotEmbedSomethingElse: { hello: 1 },   // BUILD 가 없다
    LinkPilotNull: null,
  });
  assert.deepStrictEqual(runPair(win), []);
});

test('★★ 지문이 없는 판에서는 조용히 넘어간다 (미리보기·단독 열기)', () => {
  const win = fakeWin(null, { LinkPilotFields: { BUILD: 'bbbbbbbb' } });
  assert.deepStrictEqual(runPair(win), []);
});
