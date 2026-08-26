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

/**
 * 서버 없이 재려면 자리마다 폴더를 만들어야 한다.
 * 형제 파일은 **`im-flow/` 한 곳에만** 둔다 — NAS 배포와 같은 꼴이다.
 */
function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-dup-'));
  const flow = path.join(dir, 'im-flow');
  fs.mkdirSync(path.join(flow, 'im-flow'), { recursive: true });
  /**
   * ★★★ **살아 있는 폴더에서 베끼면 흔들린다** 〈2026-08-26 · 실측〉.
   *
   *   `node --test` 는 파일마다 프로세스를 띄운다. 그동안 다른 검사가 이
   *   폴더의 파일을 다시 만들 수 있고, 그러면 **반쯤 쓰인 파일**을 베낀다.
   *   실제로 이 검사가 혼자서는 통과하고 다 함께 돌면 빨개졌다 —
   *   **흔들리는 검사는 없느니만 못하다.** 빨간 줄을 보고도 코드를 안 믿게 된다.
   *
   * ★ 그래서 **다 베낀 뒤에 온전한지 보고, 아니면 다시 베낀다.**
   */
  const copyStable = (from, to, mustHave) => {
    for (let i = 0; i < 20; i++) {
      try {
        const buf = fs.readFileSync(from);
        if (buf.length > 0 && (!mustHave || buf.includes(mustHave))) {
          fs.writeFileSync(to, buf);
          return true;
        }
      } catch (_) { /* 그 순간 없거나 쓰이는 중 */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
    return false;
  };

  for (const f of fs.readdirSync(PLATFORM)) {
    if (!/\.(js|css)$/.test(f) || f.startsWith('build-')) continue;
    copyStable(path.join(PLATFORM, f), path.join(flow, f));
  }
  const screen = path.join(PLATFORM, 'report-flow.html');
  assert.ok(copyStable(screen, path.join(flow, 'report-flow.html'), 'data-lp-fail'),
    '화면을 온전하게 베끼지 못했다 — 표본이 거짓말을 한다 (CLAUDE.md §8)');
  /* ★ 겹친 자리와 뿌리 자리에는 **화면만** 둔다 — 형제 파일은 `im-flow/` 에만
   *   있다. 이것이 사장님 앱에서 난 두 꼴 그대로다:
   *     겹침 /im-flow/im-flow/…   빠짐 /… (뿌리) */
  const src = fs.readFileSync(path.join(flow, 'report-flow.html'));
  fs.writeFileSync(path.join(flow, 'im-flow', 'report-flow.html'), src);
  fs.writeFileSync(path.join(dir, 'report-flow.html'), src);
  return {
    dir,
    ok: path.join(flow, 'report-flow.html'),
    dup: path.join(flow, 'im-flow', 'report-flow.html'),
    root: path.join(dir, 'report-flow.html'),
  };
}

/**
 * ★★★ **파일로 열어서는 이것을 못 잰다** 〈2026-08-26 · 실제로 헛돌았다〉.
 *
 *   자리를 정하는 장치는 **http(s) 일 때만** 돈다 — 미리보기(`file:`)를
 *   건드리면 멀쩡한 화면이 깨지기 때문이다. 그래서 `file://` 로 재면
 *   장치가 아예 안 돌고, **고쳤는데 검사가 빨개진다.**
 *
 * ★★★ **서버를 같은 프로세스에 두면 검사가 멈춘다** 〈같은 날 · 실측〉.
 *   브라우저를 `execFileSync` 로 부르면 **Node 가 멈춘다.** 그동안 같은
 *   프로세스의 서버는 요청에 답을 못 한다 — 서로 기다리다 끝나지 않는다.
 *   실제로 이 검사가 10분을 넘겨 죽었다.
 *   ★ 그래서 서버는 **딴 프로세스**로 띄운다.
 *
 * ★ 새 라이브러리는 안 들인다 (§5) — node 의 `http` 만 쓴다.
 */
function serve(rootDir) {
  const { spawn } = require('child_process');
  const portFile = path.join(rootDir, '.port');
  const code = `
    const http=require('http'),fs=require('fs'),path=require('path');
    const root=${JSON.stringify(rootDir)};
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
    const s=http.createServer((req,res)=>{
      const rel=decodeURIComponent(String(req.url).split('?')[0]).replace(/^\\/+/,'');
      const f=path.join(root,rel);
      if(!f.startsWith(root)){res.writeHead(403);res.end();return;}
      fs.readFile(f,(e,b)=>{
        if(e){res.writeHead(404);res.end('없다');return;}
        res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});
        res.end(b);
      });
    });
    s.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(portFile)},String(s.address().port)));
  `;
  const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });

  /* 포트가 적힐 때까지 **진짜로** 기다린다. setTimeout 은 여기서 못 쓴다 —
     이 검사는 동기로 돌기 때문이다. Atomics.wait 이 다른 프로세스를 안 막는다. */
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  for (let i = 0; i < 200; i++) {
    try { const p = fs.readFileSync(portFile, 'utf8').trim(); if (p) return { child, port: Number(p) }; }
    catch (_) { /* 아직 */ }
    sleep(50);
  }
  try { child.kill(); } catch (_) { /* 무시 */ }
  throw new Error('시험용 서버가 안 떴다');
}

function render(browser, url) {
  return execFileSync(browser, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=4000', '--dump-dom', url,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

const btn = (h) => (h.match(/<button/g) || []).length;
const band = (h) => { const m = h.match(/<div data-lp-fail="([^"]*)"/); return m ? (m[1] || 'fatal') : null; };
const baseOf = (h) => { const m = h.match(/<base [^>]*data-lp-base="([^"]*)"/); return m ? m[1] : null; };

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
      `${f} 에 자리를 정하는 장치가 없다 — 실패한 뒤에 고치면 초기화가 이미 끝나 화면이 안 그려진다`);
    assert.match(s, /data-lp-base/, `${f} 이 왜 자리를 바꿨는지 안 남긴다`);
    /* ★★★ **세 길이 다 있어야 한다** 〈2026-08-26 · 네 번째 판〉.
     *   3판은 겹침만 고쳐서, **앞이 아예 없는** 경우가 나자 또 빨간 띠가 떴다.
     *   한 증상만 보고 고치면 남은 증상이 다음 주에 온다. */
    assert.match(s, /meta\[name="lp:base"\]/, `${f} 에 앱이 알려 줄 길이 없다`);
    assert.match(s, /indexOf\('\/' \+ FOLDER \+ '\/'\)/, `${f} 이 주소에서 폴더를 안 찾는다 (겹침)`);
    assert.match(s, /lastIndexOf\('\/'\) === 0/, `${f} 이 뿌리에서 열린 경우를 안 본다 (빠짐)`);
  }
  assert.ok(n >= 6, `장치를 재야 할 화면이 ${n}개뿐이다 — 목록이 줄었는지 본다`);
});

test('★★ 자리를 바로잡을 때 **조용히 넘어가지 않는다**', () => {
  const s = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  assert.match(s, /console\.warn\('\[LinkPilot\] 형제 파일 자리를 바로잡았다/,
    '흔적을 안 남기면 앱 쪽 근본 원인이 영영 안 고쳐진다');
  // ★ 그런데 **빨간 띠는 안 띄운다** — 멀쩡히 도는 화면을 고장으로 읽으시게 된다
  const near = s.slice(s.indexOf("createElement('base')"), s.indexOf("var shown = false;"));
  assert.ok(!/say\(/.test(near), '자리를 고친 것만으로 띠를 띄우면 늑대야가 된다');
});

test('★★★ 멀쩡한 자리는 건드리지 않는다 — 늑대야가 되면 아무도 안 본다', () => {
  const s = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  /* ★ 지금 폴더와 같으면 아무것도 안 한다. 이 줄이 없으면 멀쩡한 화면에도
   *   `<base>` 가 서고, 그러면 이 장치가 **해가 된다.** */
  assert.match(s, /base !== now/, '지금 자리와 같은지 안 보고 자리를 바꾼다');
  /* ★★ 파일로 열었을 때(file:)는 손대지 않는다 — 미리보기가 그 길이다 */
  assert.match(s, /\^https\?:\$/, 'http(s) 일 때만 자리를 바꿔야 한다');
});

/* ───────────── ★★★ 실제로 화면이 뜨는가 (진짜 서버 + 브라우저) ───────────── */

test('★★★★ 앱이 어디에 얹든 화면이 **똑같이** 뜬다 (겹침 · 빠짐 · 멀쩡)', (t) => {
  const browser = findBrowser();
  if (!browser) {
    // ★ 못 잰 것을 통과로 세지 않는다 — 건너뛴 것을 그대로 적는다 (M-30)
    t.skip('헤드리스 크로미움이 없어 **못 쟀다** (통과가 아니다)');
    return;
  }
  const { dir } = stage();
  const { child, port } = serve(dir);
  const at = (p) => `http://127.0.0.1:${port}${p}`;
  try {
    const okH = render(browser, at('/im-flow/report-flow.html'));      // 멀쩡한 자리
    const dupH = render(browser, at('/im-flow/im-flow/report-flow.html')); // 앞을 두 번 붙였다
    const rootH = render(browser, at('/report-flow.html'));             // 앞을 아예 안 붙였다

    assert.ok(btn(okH) > 0, '멀쩡한 자리에서도 안 그려진다 — 표본이 거짓말을 한다 (CLAUDE.md §8)');
    assert.strictEqual(btn(dupH), btn(okH),
      `겹친 자리 버튼 ${btn(dupH)}개 vs 멀쩡한 자리 ${btn(okH)}개 — 화면이 안 뜬다`);
    assert.strictEqual(btn(rootH), btn(okH),
      `뿌리 자리 버튼 ${btn(rootH)}개 vs 멀쩡한 자리 ${btn(okH)}개 — **3판이 놓친 증상이다**`);

    assert.strictEqual(band(dupH), null, '겹친 자리에서 띠가 떴다');
    assert.strictEqual(band(rootH), null, '뿌리 자리에서 띠가 떴다');

    // 왜 바꿨는지 남고, 멀쩡한 자리는 안 건드린다
    assert.ok(baseOf(dupH), '겹친 자리에서 자리를 안 바꿨다');
    assert.ok(baseOf(rootH), '뿌리 자리에서 자리를 안 바꿨다');
    assert.strictEqual(baseOf(okH), null, '멀쩡한 자리까지 바꿨다 — 헛울음이다');
  } finally {
    try { child.kill(); } catch (_) { /* 이미 죽었다 */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★★★ 장치를 빼면 **화면이 안 뜬다** (통과가 아니라 실패를 잰다)', (t) => {
  const browser = findBrowser();
  if (!browser) { t.skip('헤드리스 크로미움이 없어 **못 쟀다**'); return; }
  const { dir, dup } = stage();
  // ★ 자리를 정하는 조각만 무력화한다 (지침 §5-④)
  fs.writeFileSync(dup, fs.readFileSync(dup, 'utf8').replace("createElement('base')", "createElement('span')"));
  const { child, port } = serve(dir);
  try {
    const a = render(browser, `http://127.0.0.1:${port}/im-flow/im-flow/report-flow.html`);
    const b = render(browser, `http://127.0.0.1:${port}/im-flow/report-flow.html`);
    assert.ok(btn(a) < btn(b),
      '장치를 빼도 화면이 그대로 뜬다 — 이 검사는 아무것도 안 재고 있다');
  } finally {
    try { child.kill(); } catch (_) { /* 이미 죽었다 */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ───────────── ★★★★ CI 를 깨뜨린 함정 ───────────── */

test('★★★★ 저장소 이름이 두 번인 자리를 **겹침으로 오해하지 않는다** (CI 를 깼던 자리)', (t) => {
  /* ★★★ 3판은 **아무 토막이나 두 번 이어지면** 겹침으로 봤다.
   *   그런데 GitHub Actions 의 체크아웃 자리가 이렇게 생겼다 —
   *
   *     /home/runner/work/linkpilot-cron/linkpilot-cron/…
   *
   *   저장소 이름이 두 번이다. 3판은 그것을 겹침으로 읽고 자리를 바꿔
   *   **화면 검사 일곱 개를 깼고, 배포가 막혔다.** 내 화면에서는 안 났다 —
   *   그 자리에서만 나는 고장이다.
   *
   * ★ 4판이 안전한 이유는 둘이다: **`im-flow` 라는 폴더만** 찾고,
   *   **http(s) 일 때만** 움직인다. 둘 중 하나만 빠져도 CI 가 다시 깨진다. */
  const browser = findBrowser();
  if (!browser) { t.skip('헤드리스 크로미움이 없어 **못 쟀다**'); return; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-ci-'));
  const deep = path.join(dir, 'linkpilot-cron', 'linkpilot-cron');
  fs.mkdirSync(deep, { recursive: true });
  try {
    for (const f of fs.readdirSync(PLATFORM)) {
      if (!/\.(js|css)$/.test(f) || f.startsWith('build-')) continue;
      try { fs.copyFileSync(path.join(PLATFORM, f), path.join(deep, f)); } catch (_) { /* 건너뛴다 */ }
    }
    fs.copyFileSync(path.join(PLATFORM, 'report-flow.html'), path.join(deep, 'report-flow.html'));

    const h = render(browser, `file://${path.join(deep, 'report-flow.html')}`);
    assert.ok(btn(h) > 0, '이름이 두 번인 자리에서 화면이 안 뜬다 — CI 가 이렇게 깨졌다');
    assert.strictEqual(baseOf(h), null,
      '저장소 이름이 두 번인 것을 겹침으로 오해했다 — CI 의 체크아웃 자리가 바로 이 꼴이다');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★★★ 아무 토막이나 두 번이면 움직이지 않는다 — **`im-flow` 만** 본다', () => {
  const s = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  /* ★ 3판은 `segs[i] === segs[i+1]` 로 **아무 토막이나** 봤다. 그 줄이
   *   돌아오면 CI 가 다시 깨진다. */
  assert.ok(!/segs\[i\] === segs\[i \+ 1\]/.test(s.slice(0, s.indexOf('var shown = false;'))),
    '아무 토막이나 겹치면 자리를 바꾼다 — CI 체크아웃 자리(이름 두 번)를 깨뜨린다');
  assert.match(s, /FOLDER = 'im-flow'/, '찾을 폴더 이름이 정해져 있지 않다');
});
