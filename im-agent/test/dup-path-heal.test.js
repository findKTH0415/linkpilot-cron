'use strict';
/**
 * 겹친 경로 — **화면이 실제로 뜨는가** 〈2026-08-26 · 같은 고장 세 번째 · D-138〉
 *
 * ★★★ 무슨 일이 세 번 났나.
 *
 *   사장님 앱 화면에 `/im-flow/im-flow/embed-bridge.js` 로 파일을 찾다가
 *   못 받는 일이 났다. 앞 두 번의 「고침」은 **띠의 글을 좋게 만드는 일**이었다 —
 *   경로를 붙이고, 다시 「두 번 들어 있습니다」를 붙였다.
 *
 *   **그런데 화면은 여전히 안 떴다.** 사장님이 보시는 것은 같은 빨간 띠다.
 *   **잘 설명하는 고장은 고장이다.**
 *
 * ★★ 세 번째 판에서 재는 것을 바꿨다 — 「띠에 무슨 글이 있나」가 아니라
 *   **「버튼이 그려지는가」**다. 그것이 사장님이 실제로 겪는 것이다.
 *
 * ★★★ 그리고 **실패한 뒤에 다시 부르는 것으로는 부족했다.** 실측에서
 *   파일 17개를 다시 받았는데 **버튼이 5개에서 0개**가 되었다 — 그때는 이미
 *   초기화가 끝나 늦게 온 스크립트가 화면을 못 그린다. 그래서 지금은
 *   **아무것도 받기 전에** `<base>` 로 자리를 바로잡는다.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');

/** 이 저장소가 쓰는 헤드리스 크로미움 (build-static 과 같은 규칙) */
function findBrowser() {
  const cands = [process.env.CHROME_PATH, process.env.PLAYWRIGHT_CHROMIUM].filter(Boolean);
  for (const root of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch (_) { continue; }
    for (const d of dirs) {
      cands.push(path.join(root, d, 'chrome-linux', 'headless_shell'));
      cands.push(path.join(root, d, 'chrome-linux', 'chrome'));
    }
  }
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  return cands.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } }) || null;
}

/** 형제 파일이 실제로 있는 자리와, 한 겹 더 깊은 자리 둘을 만든다 */
function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-dup-'));
  const flow = path.join(dir, 'im-flow');
  fs.mkdirSync(path.join(flow, 'im-flow'), { recursive: true });
  for (const f of fs.readdirSync(PLATFORM)) {
    if (!/\.(js|css|html)$/.test(f)) continue;
    if (f.startsWith('section-') || f.startsWith('build-')) continue;
    try { fs.copyFileSync(path.join(PLATFORM, f), path.join(flow, f)); } catch (_) { /* 건너뛴다 */ }
  }
  // ★ 겹친 자리에는 **화면만** 둔다. 형제 파일은 한 칸 위에만 있다 —
  //   이것이 사장님 앱에서 난 것과 같은 꼴이다.
  fs.copyFileSync(path.join(PLATFORM, 'report-flow.html'),
    path.join(flow, 'im-flow', 'report-flow.html'));
  return { dir, ok: path.join(flow, 'report-flow.html'), dup: path.join(flow, 'im-flow', 'report-flow.html') };
}

function render(browser, file) {
  return execFileSync(browser, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=4000', '--dump-dom', `file://${file}`,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

/* ───────────── 소스에 장치가 있는가 (브라우저가 없어도 잰다) ───────────── */

test('★★★ 일곱 화면 모두 **받기 전에** 자리를 바로잡는다', () => {
  const screens = fs.readdirSync(PLATFORM)
    .filter((f) => f.endsWith('.html') && !f.startsWith('section-static'));
  let n = 0;
  for (const f of screens) {
    const s = fs.readFileSync(path.join(PLATFORM, f), 'utf8');
    if (!s.includes('data-lp-fail')) continue;   // 띠가 없는 화면은 이 검사 대상이 아니다
    n += 1;
    assert.match(s, /createElement\('base'\)/,
      `${f} 에 자리를 바로잡는 장치가 없다 — 실패한 뒤에 고치면 초기화가 이미 끝나 화면이 안 그려진다`);
    assert.match(s, /data-lp-base/, `${f} 이 무엇을 지웠는지 안 남긴다`);
  }
  assert.ok(n >= 6, `장치를 재야 할 화면이 ${n}개뿐이다 — 목록이 줄었는지 본다`);
});

test('★★ 자리를 바로잡을 때 **조용히 넘어가지 않는다**', () => {
  const s = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  assert.match(s, /console\.warn\('\[LinkPilot\] 경로에/,
    '흔적을 안 남기면 앱 쪽 근본 원인이 영영 안 고쳐진다');
  // ★ 그런데 **빨간 띠는 안 띄운다** — 멀쩡히 도는 화면을 고장으로 읽으시게 된다
  const near = s.slice(s.indexOf("createElement('base')"), s.indexOf("var shown = false;"));
  assert.ok(!/say\(/.test(near), '자리를 고친 것만으로 띠를 띄우면 늑대야가 된다');
});

test('★★ 한 겹만 지운다 — 지어내면 멀쩡한 주소를 망가뜨린다', () => {
  const s = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  assert.match(s, /fixed\.splice\(cut, 1\)/, '여러 겹을 한꺼번에 지우면 안 된다');
  assert.match(s, /break;/, '첫 겹에서 멈춰야 한다');
});

/* ───────────── ★★★ 실제로 화면이 뜨는가 (브라우저로 잰다) ───────────── */

test('★★★★ 겹친 자리에서도 화면이 **멀쩡한 자리와 똑같이** 뜬다', (t) => {
  const browser = findBrowser();
  if (!browser) {
    // ★ 못 잰 것을 통과로 세지 않는다 — 건너뛴 것을 그대로 적는다 (M-30)
    t.skip('헤드리스 크로미움이 없어 **못 쟀다** (통과가 아니다)');
    return;
  }
  const { dir, ok, dup } = stage();
  try {
    const a = render(browser, dup);
    const b = render(browser, ok);
    const btn = (h) => (h.match(/<button/g) || []).length;
    const band = (h) => { const m = h.match(/<div data-lp-fail="([^"]*)"/); return m ? (m[1] || 'fatal') : null; };

    assert.ok(btn(b) > 0, '멀쩡한 자리에서도 안 그려진다 — 표본이 거짓말을 한다 (CLAUDE.md §8)');
    assert.strictEqual(btn(a), btn(b),
      `겹친 자리에서 버튼이 ${btn(a)}개, 멀쩡한 자리에서 ${btn(b)}개 — 화면이 안 뜬다`);
    assert.strictEqual(band(a), null, '겹친 자리에서 띠가 떴다 — 자리를 못 바로잡았다');

    // 무엇을 지웠는지 남는다
    assert.match(a, /<base [^>]*data-lp-base="im-flow"/, '지운 토막을 안 남겼다');
    assert.ok(!/<base [^>]*data-lp-base/.test(b),
      '멀쩡한 자리에까지 base 를 세웠다 — 헛울음이다');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★★★ 장치를 빼면 **화면이 안 뜬다** (통과가 아니라 실패를 잰다)', (t) => {
  const browser = findBrowser();
  if (!browser) { t.skip('헤드리스 크로미움이 없어 **못 쟀다**'); return; }
  const { dir, ok, dup } = stage();
  try {
    // ★ 자리를 바로잡는 조각만 무력화한다 (지침 §5-④ — 막는 장치를 빼고 돌려 본다)
    const s = fs.readFileSync(dup, 'utf8').replace("createElement('base')", "createElement('span')");
    fs.writeFileSync(dup, s);
    const a = render(browser, dup);
    const b = render(browser, ok);
    const btn = (h) => (h.match(/<button/g) || []).length;
    assert.ok(btn(a) < btn(b),
      '장치를 빼도 화면이 그대로 뜬다 — 이 검사는 아무것도 안 재고 있다');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
