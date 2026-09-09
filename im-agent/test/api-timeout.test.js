/**
 * **서버가 대답을 안 할 때 화면이 말을 하는가** 〈2026-09-09 사장님 지시:
 * 「너무 느림 로딩 교차검증하고 개선해줘」〉.
 *
 * ★★★ [사고] 사장님 화면의 보고서 자리에 **글자 하나 없는 흰 상자**가 떠 있었다.
 *   재 보니 화면 열셋의 `fetch` 쉰네 곳에 **시간 제한이 한 곳도 없었다.**
 *   서버가 404 나 오류를 주면 화면이 「못 받았습니다」를 띄우는데,
 *   **대답을 아예 안 하고 매달려 있으면** 그 자리도 안 온다 — 영영 기다린다.
 *
 * ★ 「못 받았다」와 「아직 기다린다」는 사람에게 **똑같이 보인다.** 앞엣것은 고칠
 *   데가 있고 뒤엣것은 없는데, 화면이 갈라 주지 않으면 둘 다 「고장」으로 읽힌다
 *   (`blank-screen.test.js` 와 같은 결 — 그쪽은 «파일이 안 온 것», 이쪽은
 *   «대답이 안 오는 것»이다. 둘 다 흰 화면으로 보이지만 원인이 다르다).
 *
 * ★★ **글자로 「시간 제한을 쓰나」만 세지 않는다.** 이름만 바꿔 놓고 안 돌 수 있다.
 *   **대답을 «영영 안 하는» 서버를 세워 실제로 그려 보고**, 화면에 사람이 읽을 말이
 *   뜨는지 센다. 재려는 성질은 「흰 채로 안 끝난다」이다.
 *
 * ★★★ 못 재면 **「못 쟀다」**로 건너뛴다 — 통과로 적지 않는다 (CLAUDE.md §8).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const HERE = path.join(__dirname, '..', 'ui', 'platform');
/* 보고서 길에서 사장님이 실제로 지나는 화면들 */
const SCREENS = ['intake.html', 'report-flow.html', 'fields.html', 'files.html',
                 'outputs.html', 'reports.html'];

/* ── ① 자료: 그 화면들이 시간 제한 있는 창구를 쓰는가 ─────────────── */
test('보고서 길의 화면이 시간 제한 있는 창구로 API 를 부른다', () => {
  const bare = [];
  for (const f of SCREENS) {
    const s = fs.readFileSync(path.join(HERE, f), 'utf8');
    /* 두 자리는 세지 않는다 — **재려던 성질이 그 자리에는 없기 때문**이다.
       ① 창구가 없을 때 물러나는 한 줄 (그 자리가 곧 물러나는 길이다)
       ② **화면이 제 판을 서버에 다시 묻는 자리** — API 가 아니라 이 화면 자신을
          받아 본다. 한 번만·세션당 한 번이라는 제 규칙이 이미 있고, 늦어도
          «흰 상자»가 되지 않는다(화면은 이미 떠 있다). 검사가 가짜 fetch 를
          끼워 넣어 재는 자리이기도 해서, 창구로 보내면 그 검사가 못 잰다.
       ★ 재려는 것은 「모든 fetch」가 아니라 **「사람이 기다리게 되는 API 호출」**이다. */
    const body = s
      .replace(/return function \(u, o\) \{ return fetch\(u, o\); \};/g, '')
      .replace(/fetch\(url, \{ cache: 'no-store', credentials: 'same-origin' \}\)/g, '');
    const n = (body.match(/(^|[^A-Za-z0-9_.])fetch\(/g) || []).length;
    if (n > 0) bare.push(`${f}: ${n}곳`);
  }
  assert.deepStrictEqual(bare, [],
    '시간 제한 없이 부르는 자리가 남았다 — ' + bare.join(' · '));
});

test('창구가 시간 제한을 실제로 걸고, 시간 초과를 갈라서 알려 준다', () => {
  /* ★ 이 파일은 UMD 다 — Node 에서는 `module.exports` 쪽으로 나온다.
       `new Function` 으로 돌리면 창구가 «전역»에 붙어 내 그릇에는 안 담긴다
       (실제로 그렇게 「창구가 없다」로 한 번 빨개졌다). 그냥 불러 온다. */
  const F = require(path.join(HERE, 'flow-core.js'));
  assert.ok(F && typeof F.lpFetch === 'function', '창구(lpFetch)가 없다');
  assert.ok(F.API_TIMEOUT_MS > 0 && F.API_TIMEOUT_MS <= 20000,
    '기본 시간 제한이 없거나 사람이 못 참을 만큼 길다: ' + F.API_TIMEOUT_MS);
  /* 시간이 다 된 것과 그냥 실패를 갈라 말하는가 */
  const a = F.apiWhy({ lpTimeout: true });
  const b = F.apiWhy(new Error('boom'));
  assert.notStrictEqual(a, b, '시간 초과와 다른 실패를 같은 말로 알린다');
  assert.match(a, /대답/, '시간 초과 안내가 사람 말이 아니다: ' + a);
});

/* ── ② 그려서 잰다: «영영 대답 안 하는» 서버 앞에서 흰 채로 안 끝나는가 ── */
test('서버가 대답을 안 해도 화면이 흰 채로 끝나지 않는다 (실제로 그려서 잰다)', async (t) => {
  let findBrowser;
  try { ({ findBrowser } = require(path.join(HERE, 'build-static.js'))); }
  catch (_) { return t.skip('그리는 도구가 없다 — 못 쟀다'); }
  const b = findBrowser();
  if (!b) return t.skip('헤드리스 크로미움이 없다 — 못 쟀다');

  /* ★★★ `--dump-dom` 으로는 못 잰다 — 요청이 매달려 있으면 «그 도구도» 안 끝난다
       (실제로 그렇게 멈췄다). 화면을 붙잡아 아무 때나 읽는 쪽으로 간다. */
  const { spawn } = require('node:child_process');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CDP = 9795;

  /* 화면 파일은 주고, `/api/` 는 **영영 붙잡는다** — 이것이 이 검사의 표본이다.
     404 를 주면 화면이 「못 받았습니다」로 빠져 재려던 성질이 사라진다. */
  const held = [];
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent((q.url || '/').split('?')[0]).replace(/^\/+/, '');
    if (/(^|\/)api\//.test('/' + rel)) { held.push(r); return; }
    const p = path.join(HERE, rel.replace(/^im-flow\/?/, '') || 'intake.html');
    if (!p.startsWith(HERE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end('no'); return; }
    r.writeHead(200, { 'Content-Type': /\.js$/.test(p) ? 'text/javascript; charset=utf-8'
      : /\.css$/.test(p) ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8' });
    r.end(fs.readFileSync(p));
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const port = srv.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-to-'));
  const proc = spawn(b, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let ws = null, text = '';
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) { await sleep(250);
      try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
            target = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (_) {}
    }
    if (!target) return t.skip('크로미움에 붙지 못했다 — 못 쟀다');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const wait = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
    const cmd = (m, p) => new Promise(r => { const id = ++seq; wait.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p || {} })); });
    const ev = async x => { const r = await cmd('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
      return r && r.result && r.result.result ? r.result.result.value : undefined; };
    await cmd('Page.enable'); await cmd('Runtime.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: true });
    await cmd('Page.navigate', { url: `http://127.0.0.1:${port}/im-flow/intake.html?api=${encodeURIComponent('/api/linkpilot')}` });
    /* 창구의 시간 제한(12초)보다 넉넉히 기다린다 — 못 기다리고 재면
       「흰 채로 끝났다」로 잘못 나온다 (§8 「못 잰 것은 통과가 아니다」의 반대편). */
    await sleep(16000);
    text = String(await ev("(document.body&&document.body.innerText||'').replace(/\\s+/g,' ').trim()") || '');
  } finally {
    for (const r of held) { try { r.destroy(); } catch (_) {} }
    try { if (ws) ws.close(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await new Promise(ok => srv.close(ok));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
  assert.ok(text.length > 40, '화면이 사실상 비었다 (글자 ' + text.length + '자)');
  /* 기다리는 중이라는 말이든, 시간이 다 됐다는 말이든 — **사람이 읽을 것이 있어야 한다** */
  assert.match(text, /대답|다시 열|시간|불러오지 못|못 받/,
    '대답 없는 서버 앞에서 화면이 그 사실을 말하지 않는다: ' + text.slice(0, 200));
});
