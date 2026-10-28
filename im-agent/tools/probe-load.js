'use strict';
/**
 * probe-load.js — **화면이 뜨기까지 무엇을 기다리는가.**
 *
 *   npm run probe:load            (왕복 지연 120ms 로 흉내)
 *   npm run probe:load -- --delay 0
 *
 * ★★★ **왜 만들었나** 〈2026-09-09 사장님 지시: 「너무 느림 로딩 교차검증하고 개선해줘」〉.
 *
 *   앞서 「스크립트가 여섯 개라 느립니다」라고 말씀드렸는데 **그것은 세어 본 것이지
 *   재 본 것이 아니었다.** 개수는 원인이 아닐 수 있다 — 브라우저는 여러 개를 한꺼번에
 *   받는다. 진짜로 느린 자리는 **순서대로 기다려야만 하는 사슬**이다.
 *
 * ★ **여기서는 NAS 터널을 못 본다.** 그래서 왕복 지연을 넣어 흉내 내고, 그 사실을
 *   결과에 적는다 — 「실제 그 망에서 잰 값」이 아니다 (§8 「못 잰 것은 통과가 아니다」).
 *   지연 0 으로도 함께 재서, 지연이 만드는 몫과 코드가 만드는 몫을 갈라 적는다.
 *
 * ★★ 재는 것 넷:
 *   ① **첫 글자가 보일 때까지**(FCP) — 사람이 「떴다」고 느끼는 순간
 *   ② **화면이 다 그려질 때까지**(load)
 *   ③ **사슬의 깊이** — 앞의 것이 끝나야 다음이 시작하는 요청이 몇 겹인가
 *   ④ **기다리게 하는 자리** — 어느 파일이 첫 그리기를 막고 있는가
 *
 * 되돌아오는 값: 0 쟀다 · 2 못 쟀다 (크로미움이 없거나 붙지 못했다)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

/* 어느 폴더를 재는가 — 앱 본체는 저쪽 저장소에 있어 밖에서 넣어 준다 */
const DIR = (() => {
  const i = process.argv.indexOf('--dir');
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1])
                                       : path.join(__dirname, '..', 'ui', 'platform');
})();
const PORT = 8791, CDP = 9791;
/* 앱에서 이 화면이 놓이는 폴더 — 이 이름이 곧 표본의 성질이다 (아래 주석) */
const MOUNT = (() => {
  const i = process.argv.indexOf('--mount');
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : 'im-flow';
})();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : dflt;
}
const DELAY = Number(arg('delay', 120));
const FILE = arg('file', 'report-flow.html');

function findBrowser() {
  const env = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM;
  if (env && fs.existsSync(env)) return env;
  for (const c of ['/opt/pw-browsers/chromium', '/usr/bin/chromium',
                   '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (_) {}
  }
  return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
               '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

/* 흉내 낸 왕복 지연을 «요청마다» 준다 — 터널 너머에서 파일을 받는 모양이다.
   ★ 이것이 이 도구의 핵심이다. 지연이 0 이면 사슬이 깊어도 티가 안 나고,
     그래서 이 자리에서 재면 늘 「빠르다」가 나온다. */
function serve(delayMs) {
  return http.createServer((q, r) => {
    /* ★★★ **진짜 앱과 «같은 자리»에서 준다** 〈2026-09-09 · 표본이 거짓말을 했다〉.
       [사고] 처음엔 파일을 뿌리(`/report-flow.html`)에서 줬다. 그러면 화면이
         「뿌리에서 열렸네」로 판단해 스스로 `<base>` 를 세우고, 주소가 달라진
         형제 파일 여섯을 **한 번 더 받는다.** 그 두 번째 줄기를 보고 「앱이 두 번
         받는다」고 읽을 뻔했다 — 고칠 곳은 코드가 아니라 표본이었다.
       ★ 표본은 진짜 값일 필요는 없지만 **재려는 성질은 지켜야 한다** (§8). */
    let rel = decodeURIComponent((q.url || '/').split('?')[0]).replace(/^\/+/, '');
    if (MOUNT) rel = rel.replace(new RegExp('^' + MOUNT + '/?'), '');
    rel = rel || FILE;
    const p = path.join(DIR, rel);
    setTimeout(() => {
      if (!p.startsWith(DIR) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        r.writeHead(404); r.end('no'); return;
      }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream',
                         'Cache-Control': 'no-store' });
      r.end(fs.readFileSync(p));
    }, delayMs);
  });
}

async function run(delayMs) {
  const browser = findBrowser();
  if (!browser) return { measured: false, why: '헤드리스 크로미움이 없다' };

  const srv = serve(delayMs);
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-load-'));
  const proc = spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

  let ws = null, out = { measured: false };
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) { await sleep(250);
      try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
            target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch (_) {}
    }
    if (!target) return { measured: false, why: '크로미움에 붙지 못했다' };
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const wait = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
    const cmd = (m, p) => new Promise(r => { const id = ++seq; wait.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p || {} })); });
    const ev = async x => { const r = await cmd('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
      return r && r.result && r.result.result ? r.result.result.value : undefined; };

    await cmd('Page.enable'); await cmd('Runtime.enable');
    await cmd('Network.setCacheDisabled', { cacheDisabled: true });   /* 첫 방문을 잰다 */
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
    await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/` + (MOUNT ? MOUNT + '/' : '') + FILE });
    /* 넉넉히 기다린다 — 못 기다리고 재면 「빠르다」로 잘못 나온다 */
    await sleep(Math.max(6000, 3000 + delayMs * 12));

    out = await ev(`(()=>{
      const nav=performance.getEntriesByType('navigation')[0]||{};
      const paint=performance.getEntriesByType('paint')||[];
      const fcp=(paint.find(p=>p.name==='first-contentful-paint')||{}).startTime||null;
      const res=performance.getEntriesByType('resource').map(r=>({
        n:r.name.split('/').pop().split('?')[0], s:Math.round(r.startTime), e:Math.round(r.responseEnd),
        t:r.initiatorType }));
      /* 사슬의 깊이 — 앞의 것이 «끝난 뒤» 시작한 요청을 겹으로 센다 */
      const sorted=res.slice().sort((a,b)=>a.s-b.s);
      let depth=1, edge=0;
      for(const r of sorted){ if(r.s>=edge-5){ depth++; edge=r.e; } }
      return { measured:true,
        fcp: fcp==null?null:Math.round(fcp),
        dcl: Math.round(nav.domContentLoadedEventEnd||0),
        load: Math.round(nav.loadEventEnd||0),
        docBytes: Math.round((nav.decodedBodySize||0)/1024),
        n: res.length, depth,
        res: sorted.slice(0,14) };
    })()`);
  } finally {
    try { if (ws) ws.close(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await new Promise(r => srv.close(r));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
  return out || { measured: false, why: '값을 못 읽었다' };
}

(async () => {
  console.log(`\n화면 로딩 진단 — ${FILE}`);
  console.log('★ 이 자리에서는 NAS 터널을 못 본다. 왕복 지연을 «흉내» 내서 잰 값이다.\n');
  const rows = [];
  for (const d of [0, DELAY]) {
    const r = await run(d);
    if (!r.measured) { console.log(`  ⚠ 지연 ${d}ms — 못 쟀다 (${r.why})`); process.exit(2); }
    rows.push(Object.assign({ delay: d }, r));
  }
  console.log('  왕복지연   첫 글자(FCP)   다 그림(load)   요청 수   사슬 깊이');
  for (const r of rows) {
    console.log(`  ${String(r.delay + 'ms').padEnd(9)}${String(r.fcp + 'ms').padEnd(15)}${String(r.load + 'ms').padEnd(16)}${String(r.n).padEnd(10)}${r.depth}겹`);
  }
  const slow = rows[rows.length - 1];
  console.log(`\n  첫 그리기를 막는 자리 (지연 ${slow.delay}ms · 시작 순):`);
  for (const r of slow.res) {
    const bar = r.s <= slow.fcp ? '  ← 첫 글자보다 먼저' : '';
    console.log(`    ${String(r.s + '~' + r.e + 'ms').padEnd(16)}${r.n}${bar}`);
  }
  console.log('');
  process.exit(0);
})();
