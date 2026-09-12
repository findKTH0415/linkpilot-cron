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

/* ── ② 그려서 잰다: 대답이 안 오는 상황에서 «기다림»이 끝나는가 ── */
test('대답이 안 오면 화면이 기다림을 멈추고 그 사실을 말한다 (실제로 그려서 잰다)', async (t) => {
  /* ★★★ **이 칸을 세 번 고쳤다. 앞의 둘은 아무것도 안 재고 있었다** 〈2026-09-09〉.
     ① CDP(WebSocket)로 붙잡아 읽었다 — 이 자리(Node 22)에서는 돌았고 사보타주도
        잡았는데, **CI 는 Node 20 이라 전역 WebSocket 이 없어** ReferenceError 로 죽었다.
        그리고 그것이 「못 쟀다」가 아니라 **「실패」로 끝났다** — 규칙의 반대다 (§8).
     ② 그래서 늦게 대답하는 서버 + `--dump-dom` 으로 바꿨더니 **빠른 응답에서도**
        안 끝났다 (실측: fast·404·slow 셋 다 35초에 죽었다). 그 도구는 http 주소에서
        안 끝난다 — 저장소가 늘 `file://` 만 쓰는 이유다.
     ③ 다시 `file://` + 가짜 fetch 로 바꿨더니 **0.7초에 통과**했다. 이상해서
        사보타주를 걸어 보니 **시간 제한을 통째로 빼도 통과**했다 — `--dump-dom` 은
        **숨은 글자까지** 주기 때문에, 화면에 안 보이는 「불러오지 못했습니다」가
        내 조건에 걸린 것이었다. **잡히는 것이 거짓이었다.**
   ★ 그래서 **보이는 글자**로 재야 한다 — 그것은 화면을 붙잡아 물어봐야 알 수 있다.
   ★★★ ④ 그런데 그 붙잡는 길(웹소켓)이 **CI 에서는 늘 건너뛰어졌다** 〈2026-09-12〉.
        Node 20 에 전역 `WebSocket` 이 없기 때문인데, **런타임을 올려서 고치지 않는다** —
        CI 와 NAS 가 같은 Node 20 이어야 한다는 것이 이 저장소의 규칙이다
        (`deploy-im.yml`: 「NAS 가 v20 이다. 여기서만 새 것을 쓰지 않는다」).
        모자란 것은 웹소켓 한 가지뿐이므로 `ws-lite.js` 로 **그것만 채운다.**
        그래서 이 칸은 이제 **CI 에서도 실제로 잰다.** */
  const wsLite = require('./ws-lite.js');
  let findBrowser;
  try { ({ findBrowser } = require(path.join(HERE, 'build-static.js'))); }
  catch (_) { return t.skip('그리는 도구가 없다 — 못 쟀다'); }
  const b = findBrowser();
  if (!b) return t.skip('헤드리스 크로미움이 없다 — 못 쟀다');

  const { spawn } = require('node:child_process');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CDP = 9796;
  const SHORT = 1200;   /* 시계만 줄인다 — 재려는 성질은 그대로다 */

  const F = require(path.join(HERE, 'flow-core.js'));
  const core = fs.readFileSync(path.join(HERE, 'flow-core.js'), 'utf8')
    .replace('var API_TIMEOUT_MS = ' + F.API_TIMEOUT_MS + ';', 'var API_TIMEOUT_MS = ' + SHORT + ';');
  if (core.indexOf('var API_TIMEOUT_MS = ' + SHORT + ';') < 0)
    return t.skip('시계를 못 바꿨다 — 못 쟀다 (창구의 숫자 모양이 바뀌었다)');

  const held = [];
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent((q.url || '/').split('?')[0]).replace(/^\/+/, '');
    if (/(^|\/)api\//.test('/' + rel)) { held.push(r); return; }   /* 영영 대답 안 함 */
    const rel2 = rel.replace(/^im-flow\/?/, '') || 'intake.html';
    if (rel2 === 'flow-core.js') { r.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); r.end(core); return; }
    const p = path.join(HERE, rel2);
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
  /* ★★★ **자식이 안 죽으면 Node 도 안 끝난다** 〈2026-09-12 · 배포가 두 번 여기서 죽었다〉.
       `spawn` 한 아이는 **이벤트 루프를 붙잡는다.** 크로미움이 SIGTERM 을 안 받고 버티면
       시험 파일이 끝나지 않고, `npm test` 가 12분 제한에 걸려 **배포가 통째로 취소된다.**
       실제로 두 번 다 로그 끝에 `Terminate orphan process: … (chrome)` 이 남아 있었다.
     ★ 그래서 둘을 함께 한다 — **붙잡지 않게 하고(`unref`)**, 치울 때는 **바로 SIGKILL** 을 보낸다.
       시험용 브라우저는 곱게 닫아 줄 이유가 없다. */
  try { proc.unref(); } catch (_) {}
  let ws = null, seen = null;
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) { await sleep(250);
      try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
            target = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (_) {}
    }
    if (!target) return t.skip('크로미움에 붙지 못했다 — 못 쟀다');
    try { ws = await wsLite.connect(target.webSocketDebuggerUrl, 10000); }
    catch (e) { return t.skip('크로미움 웹소켓에 못 붙었다 — 못 쟀다: ' + e.message); }
    let seq = 0; const wait = new Map();
    ws.onMessage(text => { const m = JSON.parse(text); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
    const cmd = (m, p) => new Promise(r => { const id = ++seq; wait.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p || {} })); });
    const ev = async x => { const r = await cmd('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
      return r && r.result && r.result.result ? r.result.result.value : undefined; };
    await cmd('Page.enable'); await cmd('Runtime.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: true });
    await cmd('Page.navigate', { url: `http://127.0.0.1:${port}/im-flow/intake.html?api=${encodeURIComponent('/api/linkpilot')}` });
    /* 줄인 시계(1.2초)보다 넉넉히 기다린다 */
    await sleep(7000);
    /* ★ `innerText` 는 **보이는 글자만** 준다 — 숨은 글자에 속지 않는다.
         앞 판이 `--dump-dom` 의 숨은 글자에 걸려 헛통과했다. */
    seen = String(await ev("(document.body&&document.body.innerText||'').replace(/\\s+/g,' ').trim()") || '');
  } finally {
    for (const r of held) { try { r.destroy(); } catch (_) {} }
    try { if (ws) ws.close(); } catch (_) {}
    try { proc.kill('SIGKILL'); } catch (_) {}
    /* ★★★ **여기서 영원히 매달릴 수 있었다** 〈2026-09-12 · 배포 #193 이 「Run tests」에서
         12분 매달렸다가 취소됐다〉.
       [왜] `srv.close()` 는 **열려 있는 연결이 다 끝나야** 되돌아온다. 크로미움이 받아 둔
         keep-alive 소켓이 그것이다. `proc.kill()` 은 **신호만 보낸다** — 프로세스가
         실제로 죽기 전에 `close()` 를 기다리면, 느린 러너에서는 **안 끝난다.**
         내 자리에서는 크로미움이 빨리 죽어 안 났다.
       ★ 그래서 **연결을 먼저 끊고**(`closeAllConnections`), 그래도 안 끝나면
         **기다리기를 그만둔다.** 시험을 치우는 일이 시험을 멈춰 세우면 안 된다. */
    try { if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections(); } catch (_) {}
    await Promise.race([
      new Promise(ok => srv.close(ok)),
      new Promise(ok => setTimeout(ok, 3000)),
    ]);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
  assert.ok(seen && seen.length > 40, '화면이 사실상 비었다 (글자 ' + ((seen || '').length) + '자)');
  /* ★★ 급소는 여기다 — **아직도 기다리고 있으면 안 된다.** 앞 판은 이것을 안 봐서
       시간 제한을 빼도 통과했다. 「불러오는 중」이 남아 있으면 고치기 전과 같은 상태다. */
  assert.ok(!/불러오는 중/.test(seen),
    '★ 대답이 안 오는데 아직도 「불러오는 중」이다 — 흰 상자 그대로다: ' + seen.slice(0, 200));
  assert.match(seen, /대답|다시 열|불러오지 못|못 받/,
    '기다림은 멈췄는데 이유를 안 말한다: ' + seen.slice(0, 200));
});
