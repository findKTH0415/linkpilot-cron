'use strict';
/**
 * build-files.js — 「자료 업로드」탭을 **미리 그려** 한 장으로 낸다 (2026-08-20).
 *
 *   npm run im:files
 *
 * ★★ 왜 따로 있나: 보고서 생성 미리보기(`im:section`)는 **4단계만** 담는다 —
 *   흐름 밖 화면을 그 순서에 끼우면 4단계가 5단계처럼 보이기 때문이다. 그래서
 *   자료 업로드 탭은 어느 미리보기에도 안 들어가고, **바뀌어도 볼 방법이 없었다.**
 *
 * ★ 스크립트를 미리 돌려 **결과 DOM 만** 남긴다. 아티팩트로 올리면 옆 창에서
 *   확실히 열리지만 **눌리지는 않는다** — 직접 만져 봐야 하면 파일을 함께 준다.
 *
 * ★ 데이터는 **예시다.** 그렇다고 화면에 박아 둔다 — 데모를 실제로 오해하면
 *   그것을 근거로 판단한다.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const HERE = __dirname;
const { findBrowser, publishable, renderDom } = require('./build-static.js');
const { inlineScreen } = require('./build-static.js');
const { selfContained } = require('./build-preview.js');
// ★ 가짜 서버가 **진짜 목록**을 쓰게 한다 — 손으로 옮겨 적으면 갈린다
const storage = require(path.join(HERE, '..', '..', 'connectors', 'storage.js'));

/** 예시 자료 — 실제 딜 자료는 이 저장소에 두지 않는다 (public) */
const DEMO = {
  projects: [{ id: 'LP-DC-2026-001', name: '인천 남동 데이터센터' }],
};

const WRAP_CSS = `
:root { --pg: #F2F2F7; --sf: #FFFFFF; --ln: #E8EAEC; --ink: #0A1419; --ink2: #7C838C; }
:root:not([data-theme="light"]) { color-scheme: light; }
body { margin: 0; background: var(--pg); color: var(--ink);
  font: 400 15px/1.6 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
    'Malgun Gothic', Arial, sans-serif; }
.lead { max-width: 1120px; margin: 0 auto; padding: 22px 20px 0; }
.lead__t { font-size: 21px; font-weight: 800; margin: 0; }
.lead__d { font-size: 13.5px; color: var(--ink2); margin: 7px 0 0; line-height: 1.7; }
.demo { max-width: 1120px; margin: 12px auto 0; padding: 12px 16px; border-radius: 12px;
  background: #FFF4E5; color: #8A5A10; font-size: 13px; line-height: 1.7; }
.pv { max-width: 1120px; margin: 14px auto 24px; background: var(--sf);
  border: 1px solid var(--ln); border-radius: 18px; overflow: hidden; padding: 4px 0; }
`;

/**
 * 설정을 심은 사본을 만든다 — **원본을 고치지 않는다.**
 *
 * ★ 설정 블록 자체를 고쳐 쓰지 않는다. 괄호 하나만 어긋나도 스크립트가 통째로
 *   죽고, 그때 **화면은 빈 채로 뜨는데 오류는 안 보인다.** 실제로 그렇게 한 번
 *   빈 판이 나왔다. 그러니 **뒤에 덧붙여 병합**한다 — 대입이 아니라 병합이다.
 */
function withConfig(html, cfg) {
  const inject = `<script>Object.assign(window.LINKPILOT_FILES, ${JSON.stringify(cfg)});</script>\n`;
  const at = html.indexOf('<script src="embed-bridge.js"');
  if (at < 0) throw new Error('브리지 태그를 못 찾았다 — 설정을 넣을 자리가 없다');
  return html.slice(0, at) + inject + html.slice(at);
}

async function build(outFile) {
  const browser = findBrowser();
  if (!browser) throw new Error('헤드리스 크로미움이 없어 미리 그릴 수 없다');

  const src = fs.readFileSync(path.join(HERE, 'files.html'), 'utf8');
  const cfg = {
    api: null,                    // 서버를 부르지 않는다 — 예시만 보여 준다
    session: { authenticated: true, name: '예시 사용자', planId: 'pro', status: 'active' },
    projectId: DEMO.projects[0].id,
    inTab: true,
    preload: DEMO,
    requiredPlan: 'free',
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-files-'));
  const f = path.join(tmp, 'files.html');
  // 화면이 참조하는 형제 파일들을 같은 곳에 둔다 (`<script src>` 로 부른다)
  ['gate-core.js', 'flow-core.js', 'upload-core.js', 'embed-bridge.js', 'tokens.css', 'catalog.js', 'inapp.js']
    .filter(n => fs.existsSync(path.join(HERE, n)))
    .forEach(n => fs.copyFileSync(path.join(HERE, n), path.join(tmp, n)));
  fs.writeFileSync(f, withConfig(src, cfg));

  const part = inlineScreen(renderDom(browser, f), 'scr-files');

  const frag = `<title>자료 업로드 탭</title>
<style>
${WRAP_CSS}
${part.css}
</style>
<div class="lead">
  <h1 class="lead__t">자료 업로드 — 붙이는 자리</h1>
  <p class="lead__d">두 갈래를 고르면 그 자리에서 파일을 고르고 올립니다.
    전에는 셋이 <b>설명만</b>이어서, 자료를 넣으려면 보고서 생성 1단계로 되돌아가야 했습니다.</p>
</div>
<div class="demo"><b>예시 화면입니다.</b> 프로젝트와 목록은 실제 자료가 아니고,
  이 판은 <b>미리 그려 넣은 것</b>이라 눌리지 않습니다 — 직접 만져 보려면 함께 보낸
  <code>files.html</code> 을 브라우저로 여십시오.</div>
<div class="pv">${part.html}</div>
`;

  const bad = publishable(frag);
  if (bad && bad.length) throw new Error('아티팩트로 올릴 수 없다:\n  ' + bad.join('\n  '));

  fs.writeFileSync(outFile, frag);
  return { file: outFile, bytes: frag.length };
}


/**
 * **실제로 도는 판** — 미리 그린 판이 아니라 스크립트가 그대로 돈다 (2026-08-20).
 *
 * ★★ 왜 이것이 따로 필요한가: 미리 그린 판은 **눌리지 않는다.** 「보인다」와
 *   「된다」는 다른 확인이다 — 갈래를 눌러 바꾸고 파일을 골라 올려 봐야
 *   실제로 되는지 알 수 있다.
 *
 * ★ `publishable()` 은 `<script>` 를 막는다. 그 규칙은 **스크립트가 막힌 곳을
 *   전제**하고 만든 것인데(M-01 은 전달 수단 이야기이지 스크립트 이야기가
 *   아니었다), 주소로 여는 페이지에서는 인라인 스크립트가 돈다. 그래서 이 판은
 *   `publishableLive()` 로 따로 잰다 — **바깥 주소만** 막는다. 규칙을 지우지 않고
 *   무엇을 재는 판인지로 가른다.
 *
 * ★★ 가짜 서버는 **화면보다 먼저** 넣는다. 뒤에 넣으면 화면이 이미 첫 요청을
 *   보낸 뒤라 가로채지 못하고, **「프로젝트가 없습니다」가 그럴듯하게 뜬다.**
 *   실제로 그렇게 한 번 나왔다 — 오류는 없고 목록만 비어 있었다.
 *
 * ★★ 서버가 없다. 그래서 **화면 안에 가짜 서버를 둔다.** 실제 API 를 부르는
 *   길(fetch·XHR)을 가로채 예시 응답을 준다 — 화면 코드는 그대로 돈다.
 *   **예시라는 것을 화면에 박아 둔다** — 이 자료를 실제로 오해하면 안 된다.
 */
function publishableLive(frag) {
  const bad = [];
  const has = (re, why) => { if (re.test(frag)) bad.push(why); };
  has(/<!doctype/i, 'doctype 가 있다');
  has(/<html[\s>]/i, '<html> 이 있다');
  has(/<body[\s>]/i, '<body> 가 있다');
  has(/(?:src|href)="https?:/i, '바깥 주소를 부른다 (CSP 가 막는다)');
  if (!/<title>[^<]{2,}<\/title>/i.test(frag)) bad.push('<title> 이 없다');
  return bad;
}

/**
 * 화면 안에 두는 가짜 서버. **실제 응답 모양을 그대로 흉내낸다.**
 *
 * ★★ **가짜 서버가 진짜보다 너그러우면 안 된다** 〈2026-08-21〉. 앱 첨부를
 *   받는 길을 만들 때 여기서는 `provider === 'linkpilot-app'` 이면 그냥 받아
 *   줬는데, **진짜 검증기(`connectors/storage.js`)는 그 이름을 몰라 전부
 *   거절하고 있었다.** 미리보기는 초록이었고 실기기에서만 「첨부 0개」가 떴다.
 *   그래서 지금은 **진짜 목록을 심어서** 같은 기준으로 거절한다 — 데모가
 *   되는데 실물이 안 되는 일이 다시 나면 여기서 먼저 빨개진다.
 */
function fakeServer(limits) {
  return `<script>
(function () {
  'use strict';
  // ★ 예시 응답. 모양은 실제 API 와 같게 둔다 — 모양이 다르면 여기서 되는 것이
  //   실제로도 된다는 뜻이 아니게 된다
  var LIMITS = ${JSON.stringify(limits)};
  // ★ 진짜 검증기의 목록을 **그대로 심는다.** 손으로 옮겨 적으면 갈린다
  var KNOWN_IDS = ${JSON.stringify(storage.KNOWN_IDS)};
  var PROVIDERS_DEMO = ${JSON.stringify(storage.PROVIDER_IDS.map(id => ({
    id, name: storage.PROVIDERS[id].name, configured: false,
    keyEnv: storage.PROVIDERS[id].tokenEnv,
  })))};
  var INTERNAL_IDS = ${JSON.stringify(storage.INTERNAL_IDS)};
  var kept = [];
  var oneshot = [];
  var base = [
    { id: 'LP-DC-2026-001', name: '인천 남동 데이터센터' },
    { id: 'LP-SOL-2026-004', name: '전남 영암 태양광' },
  ];
  var made = [];
  var linked = [];

  function reply(url, method, body) {
    var p = String(url).replace(/^[^]*?\\/api/, '');
    if (p === '/intake') return [200, LIMITS];
    // 새 프로젝트 만들기 — 실제 서버와 같은 모양(201 + projectId)으로 답한다
    if (p === '/projects' && method === 'POST') {
      var req = String((body && body.request) || '').trim();
      if (req.length < 5) return [400, { error: '무엇을 만들지 한 줄로 적어 주세요' }];
      var mk = { id: 'LP-GEN-2026-' + String(900 + made.length + 1), name: req.slice(0, 40) };
      made.push(mk);
      return [201, { projectId: mk.id, name: mk.name, assetClass: null, seeded: [] }];
    }
    if (p === '/projects') return [200, { projects: base.concat(made) }];
    if (/\\/sources$/.test(p) && method === 'POST') {
      var got = (body && body.files) || [];
      var saved = [], rejected = [];
      got.forEach(function (f) {
        // 빈 파일은 실제 서버도 거절한다. 거절을 숨기지 않는 것을 보여 준다
        if (!f.contentBase64) rejected.push({ name: f.name, reason: '빈 파일입니다' });
        else { saved.push({ name: f.name }); kept.push({ name: f.name, bytes: Math.round(f.contentBase64.length * 0.75) }); }
      });
      return [200, { saved: saved, rejected: rejected, replaced: [] }];
    }
    if (/\\/sources$/.test(p)) return [200, { files: kept, trash: [], usage: { billableBytes: kept.reduce(function (a, b) { return a + b.bytes; }, 0) } }];
    if (/\\/oneshot$/.test(p) && method === 'POST') {
      var g2 = (body && body.files) || [];
      g2.forEach(function (f) { oneshot.push({ name: f.name, bytes: 0, fingerprint: { value: 'demo' }, readAt: '예시' }); });
      // ★ 1회성은 **올리는 그 자리에서 읽는다.** 실제 서버가 read 를 함께 주므로
      //   여기서도 준다 — 안 주면 미리보기에서만 다음 단계로 안 넘어간다.
      //   (이 블록은 템플릿 문자열 안이다 — 역따옴표를 쓰면 문자열이 끊긴다)
      return [200, { accepted: g2.map(function (f) { return { name: f.name }; }), rejected: [], reusable: false,
        read: { facts: g2.map(function (f, i) { return { key: 'demo.' + i }; }),
          documents: g2.map(function (f) { return { name: f.name }; }), unsupported: [] },
        note: '보관하지 않습니다 — 보고서를 다시 만들려면 다시 올려야 합니다.' }];
    }
    if (/\\/oneshot$/.test(p)) return [200, { items: oneshot }];
    // 프로젝트 내용 → 값. **사전에 없는 항목은 거절한다** (실제 서버와 같다)
    if (/\\/facts$/.test(p) && method === 'PUT') {
      var fs2 = (body && body.facts) || [];
      var okd = [], no = [];
      fs2.forEach(function (f) {
        if (!f.source) no.push({ key: f.key, reason: '출처가 없습니다' });
        else if (String(f.key).indexOf('.') < 0) no.push({ key: f.key, reason: '사전에 없는 항목' });
        else okd.push({ key: f.key });
      });
      return [200, { saved: okd, rejected: no }];
    }
    // ★ 연결 갈래는 **실제로도 아직 안 열려 있다.** 여기서도 501 을 준다 —
    //   되는 것처럼 보여 주면 그것이 곧 거짓말이다
    // 원본이 그대로인가 — **실제 응답 모양 그대로.** 접근권 만료가 흔한 답이라
    // 그것을 보여 준다 (그때그때 고르기의 값이다. 고장이 아니다)
    if (/\\/linked\\/verify$/.test(p) && method === 'POST') {
      var okd = [], chg = [], err = [];
      linked.forEach(function (x, i) {
        if (i === 0) chg.push({ key: 'k' + i, name: x.name, was: 'v2', now: 'v3' });
        else if (i === 1) err.push({ key: 'k' + i, name: x.name,
          reason: '접근권이 만료되었습니다 — 파일을 다시 골라 주세요' });
        else okd.push({ key: 'k' + i, name: x.name });
      });
      return [200, { ok: !chg.length && !err.length, ok_: okd, changed: chg,
        missing: [], unread: [], errors: err, at: '2026-08-21 09:12' }];
    }
    if (/\\/linked$/.test(p) && method === 'POST') {
      var ref = (body && body.ref) || {};
      // ★★ **진짜 검증기와 같은 기준으로** 거절한다. 여기만 너그러우면
      //   미리보기는 초록인데 실물은 「첨부 0개」가 된다 (2026-08-21 실측)
      if (KNOWN_IDS.indexOf(String(ref.provider || '')) === -1) {
        return [400, { error: '모르는 저장소입니다 (' + KNOWN_IDS.join(' · ') + ' 중 하나)' }];
      }
      if (!ref.rev) {
        return [400, { error: '판(rev/version)이 없습니다 — 파일만 가리키면 나중에 바뀌어도 알 수 없습니다' }];
      }
      // 고르기 창으로 붙이는 저장소는 **실제로도 아직 안 열려 있다**
      if (INTERNAL_IDS.indexOf(String(ref.provider)) === -1) {
        return [501, { error: '저장소 연결이 아직 열려 있지 않습니다 (본체가 함수를 넘겨야 합니다)' }];
      }
      linked.push({ name: ref.name, kind: ref.kind || 'file' });
      return [200, { key: 'app-' + linked.length, ref: ref }];
    }
    if (/\\/linked$/.test(p)) {
      // ★ 단추 목록도 진짜 표에서 온다. 손으로 적으면 이름·개수가 갈린다.
      //   appProvider 는 **단추에 안 뜬다** — 고를 창이 없는 출처다.
      //   (이 주석에 역따옴표를 쓰지 않는다 — 이 블록 전체가 템플릿 문자열이라
      //    역따옴표 한 쌍이 문자열을 끊어 버린다. 실제로 그렇게 한 번 깨졌다)
      return [200, { items: linked, storesCopies: false,
        appProvider: INTERNAL_IDS[0] || null, providers: PROVIDERS_DEMO }];
    }
    // ★ 자료 스캔 — **응답 모양을 실제와 같게 둔다.** 여기만 후하면 미리보기는
    //   초록인데 실물은 빈 칸이 된다 (연결 갈래에서 실제로 그렇게 당했다)
    if (/\\/scan$/.test(p) && method === 'POST') {
      var all = kept.map(function (f) { return f.name; })
        .concat(linked.map(function (x) { return x.name; }));
      if (!all.length) {
        // ★ 실제 서버와 같은 말을 한다. 1회성으로만 넣은 상태를 **탓하지 않는다**
        //   (2026-08-21 실제 신고 — 넣은 사람에게 안 넣었다고 말하고 있었다)
        if (oneshot.length) {
          return [200, { scanned: [], unread: [], facts: 0, documents: 0, empty: true,
            oneshotOnly: true, oneshotCount: oneshot.length,
            note: '여기서 다시 읽을 자료가 없습니다 — 「파일업로드」로 넣은 '
              + oneshot.length + '건은 올리는 그 자리에서 이미 읽었고, 보관하지 않으므로 '
              + '원본이 남아 있지 않습니다. 다시 읽어야 하면 「폴더를 연결해서」로 넣으십시오.',
            at: '예시' }];
        }
        return [200, { scanned: [], unread: [], facts: 0, documents: 0, empty: true,
          oneshotOnly: false, oneshotCount: 0,
          note: '읽을 자료가 없습니다 — 자료를 먼저 넣어 주십시오.', at: '예시' }];
      }
      var IMG = /\\.(png|jpe?g|webp|heic|heif)$/i;
      var NOPE = /\\.(hwp|dwg|zip)$/i;
      var scanned = all.map(function (n) {
        var isImg = IMG.test(n), no = NOPE.test(n);
        return { name: n, how: isImg ? 'ocr' : (no ? 'convert' : 'text'),
          ocr: isImg, readable: !no,
          note: isImg ? '이미지입니다 — 글자로 옮겨서 읽습니다 (신뢰도를 낮춰 표시합니다)'
            : no ? '이 형식은 읽지 못합니다 — PDF 나 PNG 로 바꿔서 올립니다' : null };
      });
      var readable = scanned.filter(function (f) { return f.readable; });
      return [200, {
        scanned: scanned,
        unread: scanned.filter(function (f) { return !f.readable; })
          .map(function (f) { return { name: f.name, why: f.note, from: 'extract' }; }),
        facts: readable.length * 3, documents: readable.length,
        empty: !readable.length,
        oneshotNote: '1회성으로 올린 자료는 올릴 때 이미 읽었습니다 — 보관하지 않으므로 다시 읽지 않습니다.',
        at: '예시',
      }];
    }
    return [404, { error: '예시 서버에 없는 길입니다' }];
  }

  var realFetch = window.fetch;
  window.fetch = function (url, opt) {
    if (String(url).indexOf('/api') === -1) return realFetch.apply(this, arguments);
    var o = opt || {};
    var body = null;
    try { body = o.body ? JSON.parse(o.body) : null; } catch (e) {}
    var r = reply(url, o.method || 'GET', body);
    return Promise.resolve(new Response(JSON.stringify(r[1]),
      { status: r[0], headers: { 'content-type': 'application/json' } }));
  };

  // 업로드는 XHR 로 간다 (진행률 때문에). 그것도 흉내낸다.
  //
  // ★ 진짜 XMLHttpRequest 를 덧씌우지 않는다. status·responseText 는 네이티브
  //   getter 라 인스턴스에 덮어써도 원하는 대로 안 되고, **업로드가 「보내는 중」
  //   에서 멈춘 채 끝나지 않는다** (실측). 그래서 쓰는 만큼만 흉내낸 객체를 준다
  var RealXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    var real = null, url = null, method = 'GET';
    var x = {
      upload: {}, withCredentials: false, status: 0, responseText: '',
      onload: null, onerror: null, onabort: null,
      setRequestHeader: function () {},
      open: function (m, u) {
        method = m; url = u;
        if (String(u).indexOf('/api') === -1) { real = new RealXHR(); real.open(m, u); }
      },
      send: function (payload) {
        if (real) return real.send(payload);
        var body = null;
        try { body = payload ? JSON.parse(payload) : null; } catch (e) {}
        var r = reply(url, method, body);
        var total = (payload || '').length;
        // 진행 단계를 실제처럼 둘로 나눠 보여 준다 (보내는 중 → 서버가 읽는 중)
        setTimeout(function () { if (x.upload.onprogress) x.upload.onprogress({ lengthComputable: true, loaded: Math.round(total * 0.5), total: total }); }, 90);
        setTimeout(function () { if (x.upload.onprogress) x.upload.onprogress({ lengthComputable: true, loaded: total, total: total }); }, 220);
        setTimeout(function () { if (x.upload.onload) x.upload.onload(); }, 300);
        setTimeout(function () {
          x.status = r[0];
          x.responseText = JSON.stringify(r[1]);
          if (x.onload) x.onload();
        }, 900);
      },
    };
    return x;
  };
}());
</script>`;
}

/**
 * 예시 앱 딜 — **실제 딜이 아니다** (public 저장소).
 *
 * ★★ 예시라도 **실제 서버가 요구하는 것을 다 갖춘다.** 처음엔 `rev` 를 빼고
 *   만들었는데, 가짜 서버가 너그러워서 그대로 초록이 났다. 진짜 검증기는
 *   판(rev) 없는 참조를 거절한다 — 실기기에서만 「첨부 0개」로 드러났을 것이다.
 */
const APP_DEMO = [
  { id: 'deal-8842', title: '잠원동 역세권개발 주상복합', client: '(주)예시개발', files: 2, images: 1 },
  { id: 'deal-9107', title: '경기도 여주시 대신면 3MW 태양광', client: '예시에너지', files: 1, images: 2 },
];

/**
 * 앱이 넘기는 함수를 흉내낸다.
 *
 * ★★ **화면보다 뒤에 둔다.** 앞에 두면 화면의 `window.LINKPILOT_FILES = {…}`
 *   **대입**이 이 함수를 통째로 지운다 — 그러면 앱 목록은 뜨는데 고르면
 *   아무것도 안 나온다. 오류는 없다. 실제로 그렇게 한 번 안 붙었다.
 * ★ 대입이 아니라 **속성만 얹는다** — 화면이 이미 잡아 둔 참조를 그대로 쓴다.
 * ★ 실제로는 본체가 자기 API 로 받아 온다. 여기서는 모양만 같게 둔다
 */
function appBridge() {
  return `<script>
(function () {
  'use strict';
  var BUNDLE = {
    'deal-8842': {
      content: { updatedAt: '2026-08-19', summary: '잠원동 역세권 주상복합 개발',
        facts: [
          { key: 'land.area_sqm', value: 12709, unit: '㎡' },
          { key: 'building.gfa_sqm', value: 84300, unit: '㎡' },
          { key: '자유입력', value: '담당자 메모' } ],
        notes: ['현장 방문 소견 (자유 입력)'] },
      files: [
        { id: 'f1', name: '사업계획서.pdf', bytes: 2400000, ref: { provider: 'linkpilot-app', fileId: 'f1', name: '사업계획서.pdf', rev: 'v7', path: '/deal/8842/사업계획서.pdf', kind: 'file' }, access: { url: 'https://example.invalid/f1' } },
        { id: 'f2', name: '감정평가서.pdf', bytes: 5100000, ref: { provider: 'linkpilot-app', fileId: 'f2', name: '감정평가서.pdf', rev: 'v2', path: '/deal/8842/감정평가서.pdf', kind: 'file' }, access: { url: 'https://example.invalid/f2' } } ],
      images: [
        { id: 'i1', name: '현장사진-01.jpg', bytes: 830000, ref: { provider: 'linkpilot-app', fileId: 'i1', name: '현장사진-01.jpg', rev: 'v1', path: '/deal/8842/현장사진-01.jpg', kind: 'image' }, access: { url: 'https://example.invalid/i1' } } ],
    },
    'deal-9107': {
      content: { updatedAt: '2026-08-18',
        facts: [{ key: 'solar.capacity_dc_mw', value: 3.4, unit: 'MWdc' }], notes: [] },
      /* ★ 같은 문서의 여러 판을 일부러 넣는다 — §7 경고를 **눈으로 확인**할 수
         있어야 한다. 안 보이면 만든 것이 아니다 (CLAUDE.md §8) */
      files: [
        { id: 'g1', name: '사업계획서_v2.pdf', bytes: 410000, ref: { provider: 'linkpilot-app', fileId: 'g1', name: '사업계획서_v2.pdf', rev: 'v2', kind: 'file' }, access: { url: 'https://example.invalid/g1' } },
        { id: 'g2', name: '사업계획서_Final.pdf', bytes: 430000, ref: { provider: 'linkpilot-app', fileId: 'g2', name: '사업계획서_Final.pdf', rev: 'v1', kind: 'file' }, access: { url: 'https://example.invalid/g2' } },
        { id: 'g3', name: '사업계획서_20260819.pdf', bytes: 428000, ref: { provider: 'linkpilot-app', fileId: 'g3', name: '사업계획서_20260819.pdf', rev: 'v1', kind: 'file' }, access: { url: 'https://example.invalid/g3' } } ],
      images: [
        { id: 'j1', name: '부지-항공.jpg', bytes: 1200000, ref: { provider: 'linkpilot-app', fileId: 'j1', name: '부지-항공.jpg', rev: 'v1', kind: 'image' }, access: { url: 'https://example.invalid/j1' } },
        { id: 'j2', name: '배치도.png', bytes: 640000, ref: { provider: 'linkpilot-app', fileId: 'j2', name: '배치도.png', rev: 'v1', kind: 'image' }, access: { url: 'https://example.invalid/j2' } } ],
    },
  };
  window.LINKPILOT_FILES = window.LINKPILOT_FILES || {};
  window.LINKPILOT_FILES.fetchAppProject = function (appId) {
    // 실제 앱도 곧바로 주지 않는다 — 부르는 쪽이 기다릴 줄 아는지 여기서 드러난다
    return new Promise(function (ok) {
      setTimeout(function () { ok(BUNDLE[appId] || { content: null, files: [], images: [] }); }, 250);
    });
  };
}());
</script>`;
}

async function buildLive(outFile) {
  const { createHandlers } = require(path.join(HERE, '..', 'api-router.cjs'));
  const h = createHandlers({ agentModulePath: path.join(HERE, '..', '..') });
  // ★ 한도를 손으로 적지 않는다 — 서버가 실제로 내려 줄 것을 그대로 심는다
  const limits = (await h.intake()).body;

  const doc = selfContained('files.html', {
    embed: false,
    inject: {
      global: 'LINKPILOT_FILES',
      value: {
        api: '/api', inTab: true, requiredPlan: 'free',
        session: { authenticated: true, name: '예시 사용자', planId: 'pro', status: 'active' },
        // ★ 앱이 내려주는 딜 목록 — **예시다.** 실제 딜 자료는 이 저장소에 두지 않는다
        appProjects: APP_DEMO,
        appLinks: {},
      },
    },
  });

  // 감싸는 문서를 걷어내고 조각만 남긴다 (올리는 쪽이 다시 감싼다)
  const head = doc.slice(doc.indexOf('<head>') + 6, doc.indexOf('</head>'));
  const body = doc.slice(doc.indexOf('<body>') + 6, doc.lastIndexOf('</body>'));
  const styles = (head.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');

  const frag = `<title>자료 업로드 탭 — 실제로 도는 판</title>
<style>${LIVE_CSS}</style>
${styles}
<div class="lead">
  <h1 class="lead__t">자료 업로드 — <b>눌러 볼 수 있는 판</b></h1>
  <p class="lead__d">미리 그린 그림이 아닙니다. 화면 코드가 그대로 돕니다 —
    갈래를 바꾸고, 파일을 고르고, 실제로 올려 보십시오.</p>
</div>
<div class="demo"><b>서버는 예시입니다.</b> 이 페이지 안에 가짜 서버를 두고 화면이 그것을
  부릅니다. 프로젝트·목록·올린 결과는 <b>실제 자료가 아닙니다.</b>
  「폴더를 연결해서」는 <b>실제로도 아직 안 열려 있어</b> 여기서도 그렇게 나옵니다.</div>
${fakeServer(limits)}
<div class="pv">${body}</div>
${appBridge()}
`;

  const bad = publishableLive(frag);
  if (bad.length) throw new Error('올릴 수 없다:\n  ' + bad.join('\n  '));
  fs.writeFileSync(outFile, frag);
  return { file: outFile, bytes: frag.length };
}

const LIVE_CSS = `
:root { --pg: #F2F2F7; --sf: #FFFFFF; --ln: #E8EAEC; --ink: #0A1419; --ink2: #7C838C; }
body { margin: 0; background: var(--pg); color: var(--ink);
  font: 400 15px/1.6 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
    'Malgun Gothic', Arial, sans-serif; }
.lead { max-width: 1120px; margin: 0 auto; padding: 22px 20px 0; }
.lead__t { font-size: 21px; font-weight: 800; margin: 0; }
.lead__d { font-size: 13.5px; color: var(--ink2); margin: 7px 0 0; line-height: 1.7; }
.demo { max-width: 1120px; margin: 12px auto 0; padding: 12px 16px; border-radius: 12px;
  background: #FFF4E5; color: #8A5A10; font-size: 13px; line-height: 1.7; }
.pv { max-width: 1120px; margin: 14px auto 24px; background: var(--sf);
  border: 1px solid var(--ln); border-radius: 18px; padding: 6px 0 2px; }
`;

if (require.main === module) {
  const live = process.argv.includes('--live');
  const i = process.argv.indexOf('--out');
  const out = i > -1 && process.argv[i + 1]
    ? path.resolve(process.argv[i + 1])
    : path.join(HERE, live ? 'files-live.html' : 'files-artifact.html');
  (live ? buildLive(out) : build(out)).then((r) => {
    console.log(`${r.file} (${Math.round(r.bytes / 1024)}KB) · 자료 업로드 탭${live ? ' — 실제로 도는 판' : ''}`);
  }).catch((e) => { console.error(e.message); process.exit(2); });
}

module.exports = { build, buildLive, publishableLive, DEMO };
