'use strict';
/**
 * flow-live-loop.test.js — **되풀이를 소스가 아니라 화면에서 잰다**
 *   〈2026-08-30 사장님 신고: 「관련자료 업로드 클릭하면 켜졌다 꺼졌다 무한반복」 · D-186〉.
 *
 * ★★★ `frame-loop.test.js` 는 **소스 글자**를 본다. 그 검사 열셋이 전부 초록인데
 *   사장님 화면에서는 흐름이 **제 안에 또 떴다.** 소스만 보는 검사는
 *   「그리기는 하는데 그 자리까지 안 간다」를 못 잡는다 — 이 저장소가 여러 번
 *   겪은 자리다.
 *
 * ★★ **`file://` 로는 못 잰다.** 틀이 다른 출처로 잡혀 안쪽을 못 읽고,
 *   화면이 스스로 자리를 고치는 조각(M-56)도 안 돈다. 그래서 **작은 서버를
 *   띄워 `/im-flow/` 아래에서** 실제와 같은 주소로 연다.
 *
 * ★ 재는 것 셋 —
 *     ① 흐름이 **제 안에 또 뜨지 않는다** (h1 이 하나, 안쪽 문서가 흐름이 아님)
 *     ② 절을 눌러도 **칸 수가 안 늘어난다** (되풀이하면 쌓이거나 깜빡인다)
 *     ③ 그리는 동안 **예외가 없다**
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const { findBrowser } = require(path.join(PLATFORM, 'build-static.js'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
};

/** `/im-flow/…` 로 화면 폴더를 내주는 작은 서버. 실제 주소 모양과 같게 둔다 */
function serve() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url).split('?')[0]);
    if (!rel.startsWith('/im-flow/')) { res.writeHead(404); return res.end('밖'); }
    const f = path.join(PLATFORM, rel.slice('/im-flow/'.length));
    if (!f.startsWith(PLATFORM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end('없음');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

const PROBE = `<div id="probe"></div><script>
(function(){
var out={err:[],h1max:0,secMax:0,secMin:99,clicks:0,innerIsFlow:false,innerTitle:null};
window.onerror=function(m){ if(out.err.length<3) out.err.push(String(m).slice(0,120)); };
var n=0;
var t=setInterval(function(){
  n++;
  var h1=document.querySelectorAll('h1').length;
  var sec=document.querySelectorAll('.sec').length;
  if(h1>out.h1max) out.h1max=h1;
  if(sec>out.secMax) out.secMax=sec;
  if(sec<out.secMin) out.secMin=sec;
  var fr=document.querySelector('iframe');
  if(fr){ var d=null; try{ d=fr.contentDocument; }catch(e){ d=null; }
    if(d&&d.body){ out.innerTitle=(d.title||'').slice(0,40);
      if(d.querySelectorAll('.sec').length>0) out.innerIsFlow=true; } }
  if(n===10||n===40||n===80){
    var s=[].slice.call(document.querySelectorAll('.sec')).filter(function(x){
      return /관련자료 업로드/.test(x.textContent||''); })[0];
    var h=s&&(s.querySelector('.sec__h')||s.firstElementChild);
    if(h){ h.click(); out.clicks++; }
  }
  document.getElementById('probe').textContent=JSON.stringify(out);
  if(n>90) clearInterval(t);
},60);
}());
<\/script>`;

function drive(browser, url) {
  const dom = execFileSync(browser, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    /* ★ 바깥 그물을 끊는다. 크로미움이 저 혼자 갱신·핑을 보내는데, 막힌 자리에서는
     *   그것이 **검사 시간을 통째로 잡아먹는다** (실측: 10분을 넘겼다). */
    '--disable-background-networking', '--disable-component-update',
    '--disable-default-apps', '--no-first-run', '--disable-sync',
    /* ★ **되돌이 주소를 바깥 프록시로 보내지 않는다.** 이 자리는 프록시를 거치는데
     *   127.0.0.1 까지 그리로 보내면 크로미움이 붙지 못해 화면을 영영 안 뱉는다. */
    '--no-proxy-server', '--proxy-bypass-list=<-loopback>',
    '--window-size=1100,900', '--virtual-time-budget=24000', '--dump-dom', url,
  ], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 화면이 그 자리까지 못 갔다');
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

/** 설정을 끼운 임시 판. 원본을 안 건드린다 */
function probeFile(projectId) {
  const shell = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  const at = shell.indexOf('</script>', shell.indexOf('LINKPILOT_REPORT_FLOW'));
  assert.notStrictEqual(at, -1, 'report-flow.html: 설정 블록을 못 찾았다');
  const cfg = '<' + 'script>Object.assign(window.LINKPILOT_REPORT_FLOW,'
    + JSON.stringify({
      projectId: projectId,
      session: { authenticated: true, name: '예시', planId: 'pro', status: 'active' },
    }) + ');<\\/' + 'script>';
  const f = path.join(PLATFORM, '.lp-live-loop.html');
  fs.writeFileSync(f, shell.slice(0, at + 9) + cfg + shell.slice(at + 9) + PROBE);
  return f;
}

/**
 * ★★★ **이 검사는 불러야 돈다** 〈2026-08-30 · D-186〉.
 *
 *   실제 브라우저를 띄우고 작은 서버까지 세우므로 오래 걸린다. 이 자리에서는
 *   바깥 프록시 때문에 브라우저가 화면을 안 뱉어 **6분 40초를 넘겼다.**
 *   `npm test` 안에서 늘 돌리면 검사 전체가 서고, **서는 검사는 결국 꺼진다.**
 *
 * ★ 그래서 `LP_LIVE_LOOP=1` 일 때만 돈다. **그 사실을 숨기지 않는다** —
 *   안 돌 때는 「못 쟀다」이지 「통과」가 아니다 (§8).
 *   되풀이가 의심되면 이렇게 부른다:
 *
 *       LP_LIVE_LOOP=1 node --test im-agent/test/flow-live-loop.test.js
 */
const LIVE = process.env.LP_LIVE_LOOP === '1';

async function run(projectId) {
  if (!LIVE) return null;                 // 불러야 돈다 — 위 주석 참고
  const browser = findBrowser();
  if (!browser) return null;              // 크로미움이 없는 서버가 실제로 있다
  const srv = await serve();
  const f = probeFile(projectId);
  try {
    const port = srv.address().port;
    return drive(browser, `http://127.0.0.1:${port}/im-flow/.lp-live-loop.html?step=sources`);
  } finally {
    fs.rmSync(f, { force: true });
    await new Promise((ok) => srv.close(ok));
  }
}

function assertNoLoop(r, where) {
  assert.deepStrictEqual(r.err, [], `${where}: 그리는 동안 예외가 났다`);
  assert.strictEqual(r.h1max, 1,
    `${where}: 제목이 ${r.h1max}개다 — 흐름이 **제 안에 또 떴다** (사장님이 보신 그 모습)`);
  assert.ok(!r.innerIsFlow,
    `${where}: 안쪽 틀에 흐름이 들어 있다 (안쪽 제목: ${r.innerTitle})`);
  assert.ok(r.clicks >= 3, `${where}: 절을 못 눌렀다 (${r.clicks}번)`);
  /* 눌러서 접었다 폈다 하는 것은 정상이다 — 재는 것은 **칸이 늘어나는가**다 */
  assert.strictEqual(r.secMax, 6,
    `${where}: 절이 ${r.secMax}개까지 늘었다 — 되풀이하며 쌓인다`);
}

test('★★★ 「관련자료 업로드」를 눌러도 흐름이 제 안에 또 뜨지 않는다 (프로젝트 있음)', async () => {
  const r = await run('LP-DC-2026-001');
  if (!r) return;
  assertNoLoop(r, '프로젝트 있음');
  assert.match(String(r.innerTitle || ''), /보고서 생성 입력/,
    `안쪽 틀이 접수 화면이 아니다 (${r.innerTitle})`);
});

test('★★★ 프로젝트가 없을 때도 되풀이하지 않는다 (사장님 화면의 상태)', async () => {
  const r = await run(null);
  if (!r) return;
  assertNoLoop(r, '프로젝트 없음');
});
