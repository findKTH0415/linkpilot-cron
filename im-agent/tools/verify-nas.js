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
 */
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
    const text = await r.text();
    return { status: r.status, text, ct: r.headers.get('content-type') || '' };
  } finally { clearTimeout(t); }
}

/* ── 재지 않고도 아는 것 — 저장소만 보면 되는 것들 ───────────────── */

function localChecks() {
  // 탭 셋이 한 곳에서 나오는가
  const tabs = FLOW.TABS.map(t => t.tab).join(' · ');
  add('탭 셋이 flow-core 한 곳에서 나온다', FLOW.TABS.length === 3 ? 'ok' : 'fail', tabs);

  // 배포용 사본이 만들어지는가 (브리지 순서 확인 포함 — 여기서 걸리면 사본이 틀린다)
  try {
    const r = embed.build(null);
    add('배포용 사본 목록·브리지 확인', 'ok', `${r.files.length}개`);
  } catch (e) {
    add('배포용 사본 목록·브리지 확인', 'fail', e.message.split('\n')[0]);
  }

  const n = W.ROUTES.length + A.ROUTES.length;
  add('라우트 표', n === 28 ? 'ok' : 'fail', `읽기 ${A.ROUTES.length} · 쓰기 ${W.ROUTES.length} = ${n}`);
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

  // ★ 인증은 **서버가** 막는다. 200 이 오면 그게 사고다
  await tryOne('무인증 쓰기 → 401', async () => {
    const r = await http(API + '/projects', { method: 'POST' });
    add('무인증 쓰기 → 401', r.status === 401 ? 'ok' : 'fail',
      r.status === 200 ? `${r.status} — 인증 없이 열려 있다` : String(r.status));
  });

  // 화면 파일이 실제로 서빙되는가 — tokens.css 가 빠지면 색 없이 뜬다
  for (const f of ['tokens.css', 'embed-bridge.js', ...FLOW.TABS.map(t => t.file)]) {
    // eslint-disable-next-line no-await-in-loop
    await tryOne('화면 ' + f, async () => {
      const r = await http('/im-flow/' + f);
      add('화면 ' + f, r.status === 200 ? 'ok' : 'fail', String(r.status));
    });
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
