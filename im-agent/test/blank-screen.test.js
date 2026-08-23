/**
 * **빈 화면으로 끝나지 않는다** 〈2026-08-24 사장님: 데스크탑에서 흰 화면〉.
 *
 * ★★★ 화면이 통째로 비어 뜬 일이 있었다(`보고서 생성 입력` — intake).
 *   소스는 멀쩡했고 헤드리스로 열면 정상이었다 — 즉 **그 순간의 브라우저에서만**
 *   무언가가 안 왔다.
 *
 *   ★ 가장 흔한 자리: 배포가 파일을 하나씩 갈아 끼우는 동안(70초쯤) 화면은
 *     새 판인데 형제 스크립트가 **아직 안 올라와 404** 인 순간이 있다.
 *     그러면 전역이 아예 안 생기고, 첫 줄에서 예외가 나고,
 *     **화면은 흰 채로 아무 말도 안 한다.**
 *
 *   ★★ 짝 확인(M-29 · `data-lp-pair`)은 **옛 스크립트**는 잡지만
 *     **없는 스크립트**는 못 잡는다 — 견줄 전역 자체가 없기 때문이다.
 *     그 구멍을 여기서 막는다.
 *
 * ★ 그리고 **헛울음을 내지 않는다.** `report-flow` 는 창을 품고 있어 브라우저가
 *   막는 읽기가 하나 나는데 화면은 멀쩡히 뜬다. 그것까지 빨간 띠로 띄우면
 *   멀쩡한 화면에 고장 딱지가 붙는다 — 그래서 코드가 던진 것은
 *   **화면이 실제로 비었을 때만** 알린다.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HERE = path.join(__dirname, '..', 'ui', 'platform');
const { required } = require('../ui/platform/build-embed.js');
const pages = () => required().filter((f) => f.endsWith('.html'));
const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

test('★★★ 화면마다 빈 화면 지킴이가 들어 있다', () => {
  pages().forEach((f) => {
    assert.ok(read(f).indexOf('data-lp-fail') !== -1,
      `${f}: 지킴이가 없다 — 파일 하나가 안 오면 흰 화면으로 끝난다`);
  });
});

test('★★★ 지킴이가 **형제 스크립트보다 먼저** 있다 (뒤면 못 듣는다)', () => {
  pages().forEach((f) => {
    const src = read(f);
    const guard = src.indexOf('data-lp-fail');
    const first = src.search(/<script src="/);
    assert.ok(guard > -1 && first > -1 && guard < first,
      `${f}: 지킴이가 형제 스크립트 뒤에 있다 — 이미 난 불러오기 실패를 못 듣는다`);
  });
});

test('★★★ 불러오기 실패는 **잡기 단계**에서 듣는다 (거품이 안 올라온다)', () => {
  const src = read(pages()[0]);
  assert.ok(/addEventListener\('error', function \(e\) \{[\s\S]*?\}, true\)/.test(src),
    '잡기 단계(true)로 안 듣는다 — 스크립트 404 는 거품이 안 올라와서 안 들린다');
});

test('★★★ 코드가 던진 것은 **화면이 빈 경우에만** 알린다 (헛울음 금지)', () => {
  const src = read(pages()[0]);
  assert.ok(src.indexOf('function noteErr') !== -1, '던진 것을 바로 띄운다 — 헛울음이 난다');
  assert.ok(/if \(n < 40\)/.test(src), '화면이 비었는지를 안 보고 띄운다');
});

test('★★ 지킴이가 스스로 죽지 않는다 (전부 감싸져 있다)', () => {
  const src = read(pages()[0]);
  const at = src.indexOf('data-lp-fail');
  const block = src.slice(Math.max(0, at - 1500), at + 2500);
  assert.ok(/try \{/.test(block) && /catch/.test(block), '알리다 죽으면 그것이 또 빈 화면이다');
});

/* ── 실제로 열어서 잰다 ───────────────────────────────────── */

test('★★★ 형제 하나가 없으면 **이름을 대고** 알린다 (실제로 열어 본다)', () => {
  const { findBrowser, renderDom } = require(path.join(HERE, 'build-static.js'));
  const b = findBrowser();
  if (!b) return;   // 크로미움이 없는 서버가 실제로 있다

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-blank-'));
  try {
    for (const n of fs.readdirSync(HERE)) {
      if (/\.(js|css|html)$/.test(n)) fs.copyFileSync(path.join(HERE, n), path.join(dir, n));
    }
    fs.unlinkSync(path.join(dir, 'flow-core.js'));
    const dom = renderDom(b, path.join(dir, 'intake.html'), 30000, 430) || '';
    const body = (dom.match(/<body[\s\S]*<\/body>/) || [''])[0].replace(/<script[\s\S]*?<\/script>/g, '');
    assert.match(body, /화면에 필요한 파일을 못 받았습니다/,
      '형제가 없는데 흰 화면으로 끝난다 — 사장님이 본 그 화면이다');
    assert.match(body, /flow-core\.js/, '어느 파일이 안 왔는지 이름을 안 댄다');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★★★ 멀쩡한 화면에는 **고장 딱지를 안 붙인다** (실제로 열어 본다)', () => {
  const { findBrowser, renderDom } = require(path.join(HERE, 'build-static.js'));
  const b = findBrowser();
  if (!b) return;

  pages().forEach((f) => {
    const dom = renderDom(b, path.join(HERE, f), 30000, 430) || '';
    const body = (dom.match(/<body[\s\S]*<\/body>/) || [''])[0].replace(/<script[\s\S]*?<\/script>/g, '');
    assert.ok(!/화면에 필요한 파일을 못 받았습니다|화면을 그리다 멈췄습니다/.test(body),
      `${f}: 멀쩡한 화면에 경고띠가 떴다 — 헛울음은 진짜 고장을 안 보이게 만든다`);
  });
});
