'use strict';
/**
 * verify-nas.js — **붙었는지 사람이 기억으로 치지 않게** 한다 (2026-08-18 · 이관 ④).
 *
 *   npm run verify:nas -- --base https://…   (기본값은 LP_BASE 환경변수)
 *
 * ★★ 왜 만들었나: 인수 조건이 지시서 두 곳에 흩어져 있었고, 사람이 기억으로
 *   쳤다. 빠뜨린 줄은 **안 친 줄과 통과한 줄이 구분되지 않는다** — 그래서
 *   「다 확인했다」가 실제로는 절반인 채로 넘어간다.
 *
 * ★ 못 친 것을 **통과로 세지 않는다.** 네트워크가 막혀 못 물어본 것은 `skip`
 *   이고, 요약에 그렇게 나온다. 초록이 아닌데 초록으로 보이는 것이 제일 나쁘다.
 *
 * ★ 이 스크립트는 **아무것도 고치지 않는다.** 재기만 한다.
 *
 * ★★ 2026-08-19 — **이 스크립트 자체가 초록을 잘못 냈다.** 화면을 `200` 인지만
 *   보고 있었다. 옛 판을 그대로 돌려주는 서버에 대고 돌렸더니 **11통과 0실패**가
 *   나왔다. 「초록인데 NAS 는 옛 판」은 이걸 막으려고 만든 사고인데 정작
 *   막는 쪽이 뚫려 있었다. 그래서 **바이트 지문을 대조한다.**
 *   라우트도 같다 — 28개 중 **둘만** 물어보고 있었다. 앱 프록시 목록에서
 *   열한 개가 빠져 404 가 났던 그 사고를 이 스크립트로는 못 잡는다.
 *   지금은 **28개를 전부 두드린다.**
 */
const crypto = require('crypto');
const platform = require('path').join(__dirname, '..', 'ui', 'platform');
const FLOW = require(platform + '/flow-core.js');
const W = require('../ui/report-api.cjs');
const A = require('../ui/api-router.cjs');
const embed = require(platform + '/build-embed.js');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = String(arg('--base', process.env.LP_BASE || '')).replace(/\/+$/, '');
const API = arg('--api', '/api/linkpilot');
const TIMEOUT = Number(arg('--timeout', '8000'));

const rows = [];
const add = (name, state, note) => rows.push({ name, state, note: note || '' });

async function http(pathname, opt) {
  const o = opt || {};
  const url = BASE + pathname;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { method: o.method || 'GET', headers: o.headers, signal: ac.signal });
    const buf = Buffer.from(await r.arrayBuffer());
    return {
      status: r.status,
      buf,
      text: buf.toString('utf8'),
      ct: r.headers.get('content-type') || '',
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    };
  } finally { clearTimeout(t); }
}

/* ── 재지 않고도 아는 것 — 저장소만 보면 되는 것들 ───────────────── */

function localChecks() {
  // 탭 둘이 한 곳에서 나오는가 〈2026-08-22 — 자료 업로드는 1단계 안으로 들어갔다〉
  const tabs = FLOW.TABS.map(t => t.tab).join(' · ');
  add('탭 둘이 flow-core 한 곳에서 나온다', FLOW.TABS.length === 2 ? 'ok' : 'fail', tabs);

  // 배포용 사본이 만들어지는가 (브리지 순서 확인 포함 — 여기서 걸리면 사본이 틀린다)
  try {
    const r = embed.build(null);
    add('배포용 사본 목록·브리지 확인', 'ok', `${r.files.length}개`);
  } catch (e) {
    add('배포용 사본 목록·브리지 확인', 'fail', e.message.split('\n')[0]);
  }

  const n = W.ROUTES.length + A.ROUTES.length;
  // ★ 숫자를 손으로 적어 둔다 — **일부러** 그렇게 한다. 표에서 세면 길이 조용히
  //   사라져도 통과한다. 길을 더하거나 뺄 때 여기도 같이 고치는 것이 그 확인이다.
  //   (2026-08-21: 자료 스캔 길이 늘어 28 → 29)
  //   (2026-08-24: 목록 접기 `PUT /projects/:id/hidden` 이 늘어 29 → 30.
  //    ★ 지우는 길이 아니다 — 목록에서만 접는다)
  //   (2026-08-24: `GET /projects/:id/scan/progress` 가 늘어 30 → 31.
  //    ★ 스캔 요청은 다 읽어야 답한다 — 진행은 다른 문으로 물어야 한다)
  const WANT = 31;
  add('라우트 표', n === WANT ? 'ok' : 'fail',
    `읽기 ${A.ROUTES.length} · 쓰기 ${W.ROUTES.length} = ${n}` + (n === WANT ? '' : ` (${WANT} 이어야 한다)`));
}

/* ── 물어봐야 아는 것 ─────────────────────────────────────────────── */

async function remoteChecks() {
  if (!BASE) {
    add('주소가 없어 서버는 못 쟀다', 'skip', '--base 또는 LP_BASE 를 준다');
    return;
  }

  const tryOne = async (name, fn) => {
    try { await fn(); } catch (e) { add(name, 'skip', '못 물어봤다: ' + e.message); }
  };

  await tryOne('앱 버전(ver.txt)', async () => {
    const r = await http('/ver.txt');
    add('앱 버전(ver.txt)', r.status === 200 ? 'ok' : 'fail', r.status + ' ' + r.text.trim().slice(0, 20));
  });

  await tryOne('읽기 API(intake)', async () => {
    const r = await http(API + '/intake');
    add('읽기 API(intake)', r.status === 200 ? 'ok' : 'fail', String(r.status));
  });

  /* ★ 인증은 **서버가** 막는다. 200 이 오면 그게 사고다.
   *
   * ★★★ **404 를 「인증이 안 막는다」로 적지 않는다** 〈2026-08-23 · 실제로 헷갈렸다〉.
   *   이 줄은 `POST /projects` 를 두드린다. 404 가 오면 그것은 **인증 이야기가
   *   아니라 그 길이 아예 없다는 뜻**이다. 앞 판은 401 이 아니면 전부
   *   「무인증 쓰기 → 401 실패」로 적었고, 나는 그것을 읽고 **인증 설정을
   *   의심했다** — 실제로는 쓰기 라우터가 통째로 안 걸려 있었다.
   *   ★ 그리고 그 오해가 **번졌다**: 아래에서 쓰기 16개를 「인증이 안 막아서」
   *     건너뛰었다고 적는데, 진짜 이유는 「길이 없어서」다. 틀린 이유를 적으면
   *     사람이 그 이유부터 판다 (M-24 · M-28 과 같은 종류). */
  await tryOne('무인증 쓰기 → 401', async () => {
    const r = await http(API + '/projects', { method: 'POST' });
    if (r.status === 404) {
      add('쓰기 API(POST /projects)', 'fail',
        '404 — **그 길이 없다.** 인증 문제가 아니라 쓰기 라우터가 안 걸렸다');
      return;
    }
    add('무인증 쓰기 → 401', r.status === 401 ? 'ok' : 'fail',
      r.status === 200 ? `${r.status} — 인증 없이 열려 있다` : String(r.status));
  });

  await screenChecks(tryOne);
  await routeChecks(tryOne);
}

/**
 * 화면 사본이 **지금 판인가.**
 *
 * ★★ `200` 은 「파일이 있다」이지 「그 파일이 지금 판이다」가 아니다. 옛 사본도
 *   200 을 준다. 그래서 **바이트 지문을 댄다** — `im:embed` 가 낸 manifest 와
 *   서버가 준 바이트의 sha256 이 같아야 한다. 이 줄이 없던 동안, 화면을 전부
 *   3주 전 판으로 돌려주는 서버가 **11통과 0실패**로 나왔다.
 */
async function screenChecks(tryOne) {
  let want;
  try {
    want = embed.build(null).manifest.files;   // 파일명 → { bytes, sha256 }
  } catch (e) {
    add('화면 사본 지문', 'skip', '사본을 못 만들어 댈 것이 없다: ' + e.message.split('\n')[0]);
    return;
  }

  for (const f of Object.keys(want)) {
    // eslint-disable-next-line no-await-in-loop
    await tryOne('화면 ' + f, async () => {
      const r = await http('/im-flow/' + f);
      if (r.status !== 200) {
        add('화면 ' + f, 'fail', `${r.status} — 올라가 있지 않다`);
      } else if (r.sha256 !== want[f].sha256) {
        // 「옛 판」과 「전송이 덜 됐다」는 여기서 구분되지 않는다. 구분할 필요도 없다 —
        // 둘 다 서버가 저장소와 다른 것을 주고 있다는 뜻이고, 고치는 방법도 같다
        add('화면 ' + f, 'fail',
          `옛 판이다 — 서버 ${r.sha256.slice(0, 12)} · 저장소 ${want[f].sha256.slice(0, 12)}`);
      } else {
        add('화면 ' + f, 'ok', want[f].sha256.slice(0, 12));
      }
    });
  }
}

/**
 * 라우트 스물여덟이 **앱을 거쳐 닿는가.**
 *
 * ★★ 엔진에 있는 것과 앱이 넘겨 주는 것은 다르다. 프록시 목록에서 빠지면
 *   그 라우트만 404 가 나는데, **화면은 멀쩡히 뜨고 그 기능만 없다.**
 *   실제로 열한 개가 그렇게 빠져 있었다.
 *
 * ★ 판정은 「404 냐 아니냐」다. 401·400·405 는 **라우트가 있다는 뜻**이므로
 *   통과다 — 여기서 재는 것은 권한이 아니라 **닿느냐**다.
 *
 * ★ 프로젝트가 없어서 나는 404 와 라우트가 없어서 나는 404 를 가른다.
 *   ★★ 2026-08-21 — 전에는 「엔진 404 는 JSON, 없는 길은 프록시가 HTML」로 갈랐는데
 *     **그 전제가 틀렸다.** 실측하면 없는 길도 엔진 라우터가 JSON `{"error":"not found"}` 로
 *     돌려준다. 그래서 **JSON 404 를 전부 「있다」로 세고 있었다** — 서버에 아예 없는
 *     `POST /projects/:id/scan` 을 두고도 「29개 확인」이 초록으로 났다(본체가 실측으로 잡음).
 *     지금은 **대조군을 하나 두드려** 그 응답과 같은 것만 「없다」로 센다.
 *     (이 스크립트가 초록을 잘못 낸 것은 이번이 두 번째다 — 위 2026-08-19 항목과 같은 성격)
 *
 * ★ 쓰기는 **인증이 막는 것을 확인한 뒤에만** 두드린다. 안 막고 있으면
 *   두드리는 것이 곧 쓰는 것이 된다.
 */
const PROBE = { ':id': '__lp_verify__', ':key': '__lp_verify__', ':name': '__lp_verify__.txt' };

function probePath(p) {
  return p.replace(/:[a-zA-Z]+/g, (m) => PROBE[m] || '__lp_verify__');
}

async function routeChecks(tryOne) {
  const all = [...A.ROUTES.map(r => ({ ...r, side: '읽기' })), ...W.ROUTES.map(r => ({ ...r, side: '쓰기' }))];
  const writesBlocked = rows.some(r => r.name === '무인증 쓰기 → 401' && r.state === 'ok');
  /* ★ **왜 못 두드리는지**를 갈라 적는다. 「인증이 안 막아서」와 「길이 없어서」는
     고칠 곳이 다르다 — 틀린 이유를 적으면 사람이 그쪽부터 판다 〈2026-08-23〉 */
  const writesGone = rows.some(r => r.name === '쓰기 API(POST /projects)' && r.state === 'fail');

  /* ★ 대조군 — **분명히 없는 길**을 하나 두드려 그 응답을 기억한다.
     라우터가 「없다」고 할 때 어떻게 말하는지를 서버에게 직접 물어보는 것이다.
     문서에 적힌 전제(HTML 이다 / JSON 이다)를 믿지 않는다 — 그 전제가 틀려서 뚫렸다. */
  let control = null;
  try {
    control = await http(API + probePath('/projects/:id/__lp_no_such_route__'), { method: 'GET' });
  } catch (_) { /* 대조군을 못 얻으면 아래에서 보수적으로 센다 */ }
  const looksMissing = (r) => {
    if (r.status !== 404) return false;                 // 401·400·405 는 길이 있다는 뜻
    if (!control || control.status !== 404) return true; // 대조군이 없으면 404 는 없는 것으로
    return r.text === control.text;                      // 라우터의 「없다」와 같은 말이면 없는 것
  };

  let miss = 0; let asked = 0; const missing = [];
  for (const route of all) {
    const isRead = route.method === 'GET';
    if (!isRead && !writesBlocked) continue;   // 인증이 안 막고 있으면 두드리지 않는다
    const url = API + probePath(route.path);
    // eslint-disable-next-line no-await-in-loop
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await http(url, { method: route.method });
      asked += 1;
      if (looksMissing(r)) { miss += 1; missing.push(`${route.method} ${route.path}`); }
    } catch (e) {
      add(`라우트 ${route.method} ${route.path}`, 'skip', '못 물어봤다: ' + e.message);
    }
  }

  const skipped = all.length - asked;
  if (!asked) {
    add('라우트 28개가 앱을 거쳐 닿는다', 'skip', '하나도 못 물어봤다');
    return;
  }
  add('라우트 28개가 앱을 거쳐 닿는다', miss ? 'fail' : 'ok',
    miss ? `${miss}개가 404 — ${missing.slice(0, 6).join(' · ')}${missing.length > 6 ? ' …' : ''}`
      : `${asked}개 확인${skipped ? ` · ${skipped}개는 인증이 안 막혀 안 두드렸다` : ''}`);
  // 인증이 안 막고 있어서 쓰기를 통째로 건너뛴 것은 **통과가 아니다**
  if (skipped) {
    add('쓰기 라우트를 두드리지 못했다', 'skip', `${skipped}개 — `
      + (writesGone
        ? '**쓰기 라우터가 안 걸려 있다** (POST /projects 가 404). 인증 문제가 아니다'
        : '무인증 쓰기가 401 이 아니다'));
  }
}

(async () => {
  localChecks();
  await remoteChecks();

  const w = Math.max(...rows.map(r => r.name.length));
  const mark = { ok: '✅', fail: '❌', skip: '⚠️ ' };
  rows.forEach(r => console.log(`${mark[r.state]} ${r.name.padEnd(w)}  ${r.note}`));

  const fail = rows.filter(r => r.state === 'fail').length;
  const skip = rows.filter(r => r.state === 'skip').length;
  console.log(`\n통과 ${rows.length - fail - skip} · 실패 ${fail} · ` +
    `못 잼 ${skip}${skip ? '  ← 못 잰 것은 통과가 아니다' : ''}`);
  // 못 잰 것이 있으면 0 으로 끝내지 않는다 — 「초록」으로 읽히면 안 된다
  process.exit(fail ? 1 : (skip ? 2 : 0));
})();
