'use strict';
/**
 * build-outputs.js — 「완성 보고서」 탭을 **눌러 볼 수 있는 한 장**으로 낸다 (2026-08-20).
 *
 *   npm run im:outputs:live
 *
 * ★★ 왜 필요한가: 이 화면에 네 갈래([미리보기][다운로드][공유하기][프로젝트 이동])가
 *   들어왔는데, **눌러 보지 않으면 되는지 알 수 없다.** 「보인다」와 「된다」는
 *   다른 확인이다 — 특히 여기는 **배포가 막혔을 때 정말 안 열리는가**가 핵심이라
 *   그림으로는 아무것도 증명하지 못한다.
 *
 * ★ 서버가 없으므로 **화면 안에 가짜 서버를 둔다.** 실제 응답 모양을 그대로
 *   흉내내고, **예시라는 것을 화면에 박아 둔다** — 데모를 실제로 오해하면
 *   그것을 근거로 판단한다.
 *
 * ★★ 가짜 서버는 **화면보다 먼저** 넣는다. 뒤에 넣으면 화면이 이미 첫 요청을
 *   보낸 뒤라 가로채지 못하고, 「목록이 없습니다」가 그럴듯하게 뜬다
 *   (files 판에서 실제로 그렇게 한 번 나왔다).
 *
 * ★ 파일 내려받기·미리보기는 **가짜 서버가 실제 내용을 준다.** 링크만 걸어 두면
 *   눌렀을 때 빈 칸이 뜨고, 그것을 「고장」으로 읽는다.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const { selfContained } = require('./build-preview.js');
const { publishableLive } = require('./build-files.js');

/** 예시 산출물 — **실제 딜 자료는 이 저장소에 두지 않는다** (public) */
const DEMO = {
  projects: [{ id: 'LP-DC-2026-001', name: '인천 남동 데이터센터' }],
  reports: {
    progress: { percent: 67, done: 2, total: 3, countsWhat: '사양에 담은 것' },
    distribution: { blocked: false, reasons: [] },
    specKnown: true,
    all: [
      { name: 'IM 본문', path: '09_IM/im.md', exists: true, bytes: 84210, at: '2026-08-20T11:02:00' },
      { name: 'A4 최종본', path: '12_Final/im-a4.html', exists: true, bytes: 210400, at: '2026-08-20T11:03:00' },
      { name: '검증 보고서', path: '11_QC/validation.md', exists: false, expected: true,
        why: '검증을 아직 돌리지 않았습니다' },
      { name: '탁상검토 보고서', path: '13_Desk/desk.md', exists: false, expected: false,
        why: '이 딜에서는 나오지 않습니다 (토지 단독 평가가 아닙니다)' },
    ],
  },
};

/** 화면이 실제로 열어 보게 될 문서. **빈 칸을 주지 않는다** */
const DOCS = {
  '09_IM/im.md': '# 인천 남동 데이터센터 — IM 본문 (예시)\n\n'
    + '이것은 **예시 문서**입니다. 실제 딜 자료가 아닙니다.\n',
  // ★ 예시 문서에 `<!doctype` 를 적지 않는다 — 조각 검사(publishableLive)가
  //   **조각 전체**에서 그것을 찾으므로, 데모 문자열 안에 있어도 걸린다.
  //   blob 으로 열리는 문서라 doctype 없이도 그대로 뜬다
  '12_Final/im-a4.html': '<meta charset="utf-8">'
    + '<div style="font:15px/1.7 -apple-system,sans-serif;padding:28px;max-width:640px">'
    + '<h1 style="font-size:20px;margin:0 0 12px">인천 남동 데이터센터 — A4 최종본 (예시)</h1>'
    + '<p style="color:#6b7280">이것은 <b>예시 문서</b>입니다. 실제 딜 자료가 아닙니다.</p>'
    + '<p>미리보기는 새 창을 열지 않고 이 자리에서 폅니다 — 인앱 브라우저에서는 '
    + '새 창을 열면 돌아오지 못하기 때문입니다.</p></div>',
};

/**
 * 화면 안에 두는 가짜 서버.
 *
 * ★ 「막힌 판」으로 바꿔 볼 수 있게 **토글**을 하나 둔다. 배포 차단은 이 화면의
 *   가장 중요한 동작인데, 막힌 상태를 볼 방법이 없으면 그것만 확인이 안 된다.
 */
function fakeServer() {
  return `<script>
(function () {
  'use strict';
  var DEMO = ${JSON.stringify(DEMO)};
  var DOCS = ${JSON.stringify(DOCS)};
  /* ★★ 다시 읽을 때까지 **살아남아야** 한다. 처음에는 그냥 변수에 두고 화면을
     새로 고쳤는데, 새로 고치는 순간 이 파일이 다시 돌면서 값이 false 로
     되돌아갔다 — 눌러도 아무 일이 없는 것처럼 보였다. 실제로 그랬다. */
  try { window.__lpBlocked = sessionStorage.getItem('lp-demo-blocked') === '1'; }
  catch (e) { window.__lpBlocked = false; }

  function reports() {
    var r = JSON.parse(JSON.stringify(DEMO.reports));
    if (window.__lpBlocked) {
      r.distribution = { blocked: true,
        reasons: ['RED FLAG 2건이 해소되지 않았습니다', '출력 사양이 확정되지 않았습니다'] };
    }
    return r;
  }

  var realFetch = window.fetch;
  window.fetch = function (url, opt) {
    var u = String(url);
    if (u.indexOf('/api') === -1) return realFetch.apply(this, arguments);
    var p = u.replace(/^[^]*?\\/api/, '');
    var body = null, status = 200;
    if (p === '/projects') body = { projects: DEMO.projects };
    else if (/\\/reports$/.test(p)) body = reports();
    else { status = 404; body = { error: '예시 서버에 없는 길입니다' }; }
    return Promise.resolve(new Response(JSON.stringify(body),
      { status: status, headers: { 'content-type': 'application/json' } }));
  };

  /* 미리보기·내려받기는 iframe·<a> 가 **주소를 직접** 연다 — fetch 를 안 탄다.
     그래서 그 주소를 blob 으로 바꿔 준다. 안 그러면 눌렀을 때 빈 칸이 뜨고,
     빈 칸은 「고장」으로 읽힌다 */
  function blobFor(rel) {
    var t = DOCS[rel];
    if (t === undefined) return null;
    var type = /\\.html?$/.test(rel) ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8';
    return URL.createObjectURL(new Blob([t], { type: type }));
  }
  function relOf(href) {
    var m = String(href).match(/[?&]rel=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  new MutationObserver(function () {
    [].slice.call(document.querySelectorAll('iframe[src*="/api/"], a[href*="/api/"]')).forEach(function (n) {
      var attr = n.tagName === 'IFRAME' ? 'src' : 'href';
      var rel = relOf(n.getAttribute(attr));
      if (!rel) return;
      var b = blobFor(rel);
      if (b) n.setAttribute(attr, b);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
}());
</script>`;
}

/** 막힌 판으로 바꿔 보는 손잡이. **예시라는 표시와 같은 자리**에 둔다 */
function toggle() {
  return `<div class="demo">
  <b>서버는 예시입니다.</b> 이 페이지 안에 가짜 서버를 두고 화면이 그것을 부릅니다.
  프로젝트·목록·문서는 <b>실제 자료가 아닙니다.</b>
  <div style="margin-top:9px">
    <button type="button" id="lp-block" style="font:700 12.5px/1 inherit;padding:9px 13px;
      border-radius:999px;border:1px solid #E0C48A;background:#fff;color:#8A5A10;cursor:pointer">
      배포가 막힌 판으로 보기</button>
    <span id="lp-block-now" style="margin-left:8px;font-size:12.5px"></span>
  </div>
</div>
<script>
(function () {
  var b = document.getElementById('lp-block');
  var now = document.getElementById('lp-block-now');
  function say() {
    now.textContent = window.__lpBlocked ? '지금: 막힌 판' : '지금: 열린 판';
    b.textContent = window.__lpBlocked ? '열린 판으로 되돌리기' : '배포가 막힌 판으로 보기';
  }
  b.addEventListener('click', function () {
    window.__lpBlocked = !window.__lpBlocked;
    // ★ 저장해 두고 새로 고친다. 프로젝트가 미리 정해져 있으면 고르는 칸이 없어
    //   「다시 고르기」로는 목록을 못 다시 읽는다 — 그 길만 두면 눌러도 안 바뀐다
    try { sessionStorage.setItem('lp-demo-blocked', window.__lpBlocked ? '1' : '0'); }
    catch (e) { /* 저장이 막힌 브라우저 — 아래 「다시 고르기」로 간다 */ }
    say();
    var sel = document.querySelector('#view select');
    if (sel) { sel.dispatchEvent(new Event('change', { bubbles: true })); return; }
    location.reload();
  });
  say();
}());
</script>`;
}

async function buildLive(outFile) {
  const doc = selfContained('outputs.html', {
    embed: false,
    inject: {
      global: 'LINKPILOT_OUTPUTS',
      value: {
        api: '/api', inTab: true, requiredPlan: 'pro', projectId: DEMO.projects[0].id,
        session: { authenticated: true, name: '예시 사용자', planId: 'pro', status: 'active' },
      },
    },
  });

  const head = doc.slice(doc.indexOf('<head>') + 6, doc.indexOf('</head>'));
  const body = doc.slice(doc.indexOf('<body>') + 6, doc.lastIndexOf('</body>'));
  const styles = (head.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');

  const frag = `<title>완성 보고서 탭 — 실제로 도는 판</title>
<style>${WRAP_CSS}</style>
${styles}
<div class="lead">
  <h1 class="lead__t">완성 보고서 — <b>눌러 볼 수 있는 판</b></h1>
  <p class="lead__d">문서를 골라 [미리보기] [다운로드] [공유하기] [프로젝트 이동] 을
    실제로 눌러 보십시오. <b>배포가 막힌 판</b>으로 바꾸면 앞의 셋이 잠깁니다 —
    그것이 이 화면에서 가장 중요한 동작입니다.</p>
</div>
${toggle()}
${fakeServer()}
<div class="pv-wrap">${body}</div>
`;

  const bad = publishableLive(frag);
  if (bad.length) throw new Error('올릴 수 없다:\n  ' + bad.join('\n  '));
  fs.writeFileSync(outFile, frag);
  return { file: outFile, bytes: frag.length };
}

const WRAP_CSS = `
:root { --pg: #F2F2F7; --sf: #FFFFFF; --ln: #E8EAEC; --ink: #0A1419; --ink2: #7C838C; }
body { margin: 0; background: var(--pg); color: var(--ink);
  font: 400 15px/1.6 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
    'Malgun Gothic', Arial, sans-serif; }
.lead { max-width: 1120px; margin: 0 auto; padding: 22px 20px 0; }
.lead__t { font-size: 21px; font-weight: 800; margin: 0; }
.lead__d { font-size: 13.5px; color: var(--ink2); margin: 7px 0 0; line-height: 1.7; }
.demo { max-width: 1120px; margin: 12px auto 0; padding: 12px 16px; border-radius: 12px;
  background: #FFF4E5; color: #8A5A10; font-size: 13px; line-height: 1.7; }
.pv-wrap { max-width: 1120px; margin: 14px auto 24px; background: var(--sf);
  border: 1px solid var(--ln); border-radius: 18px; padding: 6px 0 2px; }
`;

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const out = i > -1 && process.argv[i + 1]
    ? path.resolve(process.argv[i + 1])
    : path.join(HERE, 'outputs-live.html');
  buildLive(out).then((r) => {
    console.log(`${r.file} (${Math.round(r.bytes / 1024)}KB) · 완성 보고서 탭 — 실제로 도는 판`);
  }).catch((e) => { console.error(e.message); process.exit(2); });
}

module.exports = { buildLive, DEMO, DOCS };
