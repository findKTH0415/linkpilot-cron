'use strict';
/**
 * vworldkey.test.js — VWorld 열쇠를 **이름 셋 다** 읽는지, 그리고 **인증 거부일
 * 때만** 다음 열쇠로 넘어가는지 잰다.
 *
 * ★★★ **왜 이 칸을 두는가** 〈2026-09-17 사장님: 「VWORLD_DOMAIN ·
 *   LINKPILOT_VWORLD_WEB_KEY · LINKPILOT_VWORLD_REPORT_KEY — 3대 키 넣었어」〉.
 *   실측으로 그 두 이름이 **저장소에 0회**였다 — 넣으신 열쇠를 **읽는 코드가
 *   한 줄도 없었다.** 그 상태는 **아무 오류도 안 낸다** (CLAUDE.md §4.6).
 *
 * ★ **「목록에 있는가」가 아니라 «돌려서» 잰다.** 이름을 목록에 적어 두고
 *   커넥터가 제 손으로 `process.env.VWORLD_KEY` 를 읽으면 그 커넥터만 조용히
 *   죽는다 — `datakey.test.js` 가 같은 자리를 그렇게 잰다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CONN = path.join(ROOT, 'im-agent', 'connectors');
const vkey = require('../connectors/vworldkey');

/** 환경변수를 갈아 끼우고 되돌린다 — 받는 이름은 전부 비우고 시작한다 */
function withEnv(vars, fn) {
  const saved = {};
  const names = new Set([...vkey.KEY_NAMES, ...Object.keys(vars), 'VWORLD_DOMAIN']);
  names.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.entries(vars).forEach(([k, v]) => {
    if (v !== undefined) process.env[k] = v;
  });
  try { return fn(); } finally {
    names.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    });
  }
}

const A = 'A'.repeat(40);
const B = 'B'.repeat(40);
const C = 'C'.repeat(40);

/* ────────────────────────────── 이름 읽기 ────────────────────────────── */

test('★★★ 사장님이 넣으신 이름만 있어도 값이 읽힌다 (REPORT · WEB 각각)', () => {
  withEnv({ LINKPILOT_VWORLD_REPORT_KEY: B }, () => {
    assert.strictEqual(vkey.usedName(), 'LINKPILOT_VWORLD_REPORT_KEY');
    assert.strictEqual(vkey.vworldKey(), B);
    assert.strictEqual(vkey.hasKey(), true);
  });
  withEnv({ LINKPILOT_VWORLD_WEB_KEY: C }, () => {
    assert.strictEqual(vkey.usedName(), 'LINKPILOT_VWORLD_WEB_KEY');
    assert.strictEqual(vkey.vworldKey(), C);
  });
});

test('★ 셋 다 있으면 지금 도는 이름(VWORLD_KEY)이 이긴다', () => {
  withEnv({ VWORLD_KEY: A, LINKPILOT_VWORLD_REPORT_KEY: B, LINKPILOT_VWORLD_WEB_KEY: C }, () => {
    assert.strictEqual(vkey.usedName(), 'VWORLD_KEY');
    assert.strictEqual(vkey.vworldKey(), A);
  });
});

test('★ 하나도 없으면 없다고 한다 — 빈 문자열이지 undefined 가 아니다', () => {
  withEnv({}, () => {
    assert.strictEqual(vkey.usedName(), null);
    assert.strictEqual(vkey.vworldKey(), '');
    assert.strictEqual(vkey.hasKey(), false);
    assert.deepStrictEqual(vkey.keys(), []);
  });
});

test('★ 앞뒤 빈칸은 떼고 읽는다 (붙여 넣을 때 딸려 온다)', () => {
  withEnv({ LINKPILOT_VWORLD_WEB_KEY: `  ${C}\t` }, () => {
    assert.strictEqual(vkey.vworldKey(), C);
  });
});

/**
 * ★★ **같은 값을 두 이름으로 넣으실 수 있다.** 그때 두 번 부르면 **호출만 배로**
 *   늘고 한도를 먹는다 (§4.5). 값으로 중복을 거른다.
 */
test('★★ 같은 값이 두 이름에 들어 있으면 «한 번만» 센다', () => {
  withEnv({ VWORLD_KEY: A, LINKPILOT_VWORLD_REPORT_KEY: A, LINKPILOT_VWORLD_WEB_KEY: C }, () => {
    const ks = vkey.keys();
    assert.strictEqual(ks.length, 2, `같은 값을 두 번 센다: ${ks.map((k) => k.name).join(' · ')}`);
    assert.deepStrictEqual(ks.map((k) => k.name), ['VWORLD_KEY', 'LINKPILOT_VWORLD_WEB_KEY']);
  });
});

/* ───────────────────────── 커넥터가 실제로 읽는가 ───────────────────────── */

test('★★★ VWorld 커넥터가 「제 손으로」 환경변수를 읽는 곳이 없다', () => {
  const offenders = [];
  for (const f of fs.readdirSync(CONN).filter((n) => n.endsWith('.js'))) {
    if (f === 'vworldkey.js') continue;   // 이름 목록의 집. 여기만 직접 읽는다
    if (f === 'http.js') continue;        // SECRET_ENV 는 «가릴 이름»의 목록이다
    const src = fs.readFileSync(path.join(CONN, f), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (/process\.env\.VWORLD_KEY/.test(src)) offenders.push(f);
  }
  assert.deepStrictEqual(offenders, [],
    `제 손으로 VWORLD_KEY 를 읽는다: ${offenders.join(' · ')} — `
    + '새 이름으로 넣으신 날 이 커넥터만 조용히 죽는다. vworldkey.js 의 vworldKey() 를 쓴다');
});

const VWORLD_CONNECTORS = ['vworld', 'nsdi'];

test('★★★ 새 이름만 넣어도 두 커넥터가 전부 「쓸 수 있다」고 한다', () => {
  const dead = [];
  withEnv({ LINKPILOT_VWORLD_REPORT_KEY: B }, () => {
    VWORLD_CONNECTORS.forEach((name) => {
      const m = require(`../connectors/${name}`);
      assert.strictEqual(typeof m.isAvailable, 'function',
        `${name} 이 isAvailable 을 안 내보낸다 — 이 칸이 그 커넥터를 못 잰다`);
      if (m.isAvailable() !== true) dead.push(name);
    });
  });
  assert.deepStrictEqual(dead, [],
    `열쇠가 들어 있는데 「키 없음」이라 한다: ${dead.join(' · ')} — 이름이 안 이어졌다`);
});

test('★ 되짚어 잰다 — 셋 다 비우면 두 커넥터가 전부 「못 쓴다」고 한다', () => {
  const alive = [];
  withEnv({}, () => {
    VWORLD_CONNECTORS.forEach((name) => {
      if (require(`../connectors/${name}`).isAvailable() === true) alive.push(name);
    });
  });
  assert.deepStrictEqual(alive, [],
    `열쇠가 없는데 「쓸 수 있다」고 한다: ${alive.join(' · ')} — 위 칸이 늘 초록이 된다`);
});

/* ───────────────── 인증 거부일 때만 다음 열쇠로 (돌려서 잰다) ───────────────── */

/**
 * `vworld.js` 를 **가짜 망**으로 다시 불러온다.
 *
 * ★ 왜 이렇게 하나 — `vworld.js` 가 `const { request } = require('./http')` 로
 *   **구조분해해서 잡아 두므로**, 나중에 http 를 갈아 끼워도 안 먹는다.
 *   그래서 http 모듈 객체를 먼저 덮고 **vworld 를 새로 require** 한다.
 * ★★ 캐시(`cache.through`)도 지나가게 둔다 — 안 그러면 두 번째 호출이 캐시에
 *   걸려 **재시도를 아예 안 하고**, 이 칸이 조용히 아무것도 안 재게 된다.
 */
function withFakeHttp(fakeRequest, fn) {
  const http = require('../connectors/http');
  const cache = require('../connectors/cache');
  const vwPath = require.resolve('../connectors/vworld');
  const savedReq = http.request;
  const savedThrough = cache.through;
  http.request = fakeRequest;
  cache.through = async (_p, _ns, _cp, run) => run();
  delete require.cache[vwPath];
  try { return fn(require('../connectors/vworld')); } finally {
    http.request = savedReq;
    cache.through = savedThrough;
    delete require.cache[vwPath];
    require('../connectors/vworld');
  }
}

/** 응답 하나를 흉내 낸다 — VWorld 는 200 안에 status 로 오류를 담는다 */
const authRejectBody = JSON.stringify({ response: { status: 'ERROR', error: { text: 'INVALID_KEY' } } });
const okBody = JSON.stringify({ response: { status: 'OK', result: { point: { x: '127.1', y: '37.5' } } } });

test('★★★ 인증 거부면 «다음 열쇠»로 넘어간다 — 한 줄로 접지 않는다', async () => {
  const seen = [];
  await withEnv({ VWORLD_KEY: A, LINKPILOT_VWORLD_REPORT_KEY: B, VWORLD_DOMAIN: 'x.example.com' }, async () => {
    await withFakeHttp(async (url) => {
      const k = /[?&]key=([^&]+)/.exec(url);
      seen.push(k ? k[1] : '(없음)');
      // 첫 열쇠(A)는 거부, 둘째(B)는 통과
      return seen[seen.length - 1] === A
        ? { ok: true, body: authRejectBody }
        : { ok: true, body: okBody };
    }, async (vw) => {
      const r = await vw.geocode('서울특별시 강남구 테헤란로 1');
      assert.strictEqual(r.ok, true, `둘째 열쇠로 넘어가지 않았다 (걸어 본 열쇠: ${seen.join(' · ')})`);
    });
  });
  assert.ok(seen.includes(A) && seen.includes(B),
    `열쇠 둘을 다 걸어 보지 않았다: ${seen.join(' · ')} — 거부 한 줄로 멀쩡한 열쇠가 묻힌다`);
});

test('★★★ 되짚어 잰다 — 5xx·못 닿음에서는 «열쇠를 안 돈다» (호출만 배로 는다)', async () => {
  const seen = [];
  await withEnv({ VWORLD_KEY: A, LINKPILOT_VWORLD_REPORT_KEY: B, VWORLD_DOMAIN: 'x.example.com' }, async () => {
    await withFakeHttp(async (url) => {
      const k = /[?&]key=([^&]+)/.exec(url);
      seen.push(k ? k[1] : '(없음)');
      return { ok: false, error: 'HTTP 502 (4회 시도 실패)' };
    }, async (vw) => {
      await vw.geocode('서울특별시 강남구 테헤란로 1');
    });
  });
  const uniq = [...new Set(seen)];
  assert.deepStrictEqual(uniq, [A],
    `5xx 인데 다른 열쇠로 또 걸었다: ${uniq.join(' · ')} — 다른 열쇠로 낫지 않는 갈래다 (§12-11)`);
});

/**
 * ★★ **글은 어디를 가리키는가를 잰다** — 낱말이 아니다 (§4.6 의 그 잣대).
 *   5xx 에서 「디버그를 켜고 다시 돌려라」라고 시키면, 요약 맨 앞 판정
 *   (「우리 쪽에 고칠 것이 없다」)과 **한 화면에서 정반대를 말한다.**
 */
test('★★★ 5xx·못 닿음에는 «다시 실행해 원문을 보라»고 시키지 않는다', () => {
  const vw = require('../connectors/vworld');
  assert.strictEqual(typeof vw.diagnoseGeocodeFailure, 'function',
    'diagnoseGeocodeFailure 를 안 내보낸다 — 이 칸이 아무것도 못 잰다');

  const h5 = vw.diagnoseGeocodeFailure([{ error: 'HTTP 502 (4회 시도 실패)' }]);
  assert.ok(!/IM_AGENT_DEBUG_HTTP/.test(h5), `5xx 인데 디버그 실행을 시킨다: ${h5}`);
  assert.ok(/고칠 것이 없|시간을 두고/.test(h5), `5xx 에 「우리 쪽에 고칠 것이 없다」가 없다: ${h5}`);

  const hn = vw.diagnoseGeocodeFailure([{ error: 'fetch failed (4회 시도 실패)' }]);
  assert.ok(!/IM_AGENT_DEBUG_HTTP/.test(hn), `못 닿음인데 디버그 실행을 시킨다: ${hn}`);
  assert.ok(/열쇠 문제가 아니다/.test(hn), `못 닿음에 「열쇠 문제가 아니다」가 없다: ${hn}`);

  const ha = vw.diagnoseGeocodeFailure([{ error: 'VWorld ERROR: INVALID_KEY' }]);
  assert.ok(/인증 실패/.test(ha), `인증 거부를 못 가린다: ${ha}`);
});

/* ─────────────────────── 가림 · 배포가 나르는가 ─────────────────────── */

test('★★ 받는 이름이 전부 SECRET_ENV 에 있다 (값이 로그에 안 새게)', () => {
  const http = fs.readFileSync(path.join(CONN, 'http.js'), 'utf8');
  const missing = vkey.KEY_NAMES.filter((n) => !new RegExp(`'${n}'`).test(http));
  assert.deepStrictEqual(missing, [],
    `SECRET_ENV 에 없다: ${missing.join(', ')} — 이 이름으로 들어온 값이 로그에 평문으로 남을 수 있다`);
});

test('★★★ 배포가 받는 이름을 전부 NAS 로 나른다 (env: 와 NAMES 둘 다)', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-nas.yml'), 'utf8');
  const noEnv = vkey.KEY_NAMES.filter((n) => !new RegExp(`^\\s*${n}:\\s*\\$\\{\\{ secrets\\.${n} \\}\\}`, 'm').test(wf));
  assert.deepStrictEqual(noEnv, [], `deploy-nas.yml 의 env: 에 없다: ${noEnv.join(', ')}`);

  const m = wf.match(/^\s*NAMES="([^"]+)"/m);
  assert.ok(m, 'NAMES 목록을 찾지 못했다 — 이 칸은 아무것도 안 잰다');
  const carried = m[1].split(/\s+/);
  const noCarry = vkey.KEY_NAMES.filter((n) => carried.indexOf(n) === -1);
  assert.deepStrictEqual(noCarry, [],
    `NAMES 목록에 없다: ${noCarry.join(', ')} — env: 에만 있으면 열쇠 파일에 «안 실린다»`);
});

/**
 * ★ **열쇠를 쓰는 수집 워크플로가 그 이름을 주입하는지** 본다.
 *   `deploy-nas` 와 다른 사실이다 — 수집 잡은 NAS 를 안 거치고 러너에서 바로 부른다.
 */
test('★★ 브이월드를 부르는 워크플로가 받는 이름을 전부 주입한다', () => {
  ['vworld.yml', 'api-smoke.yml'].forEach((f) => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8');
    const missing = vkey.KEY_NAMES.filter(
      (n) => !new RegExp(`^\\s*${n}:\\s*\\$\\{\\{ secrets\\.${n} \\}\\}`, 'm').test(wf));
    assert.deepStrictEqual(missing, [], `${f} 의 env: 에 없다: ${missing.join(', ')}`);
  });
});

/* ------------------------------------------------------------------------- *
 * **차례는 «잰 값»이다 — 콘솔 화면으로 확인했다** 〈2026-09-18 · D-220〉
 *
 * [앞 판] 이름만 보고 `REPORT` 가 서버용일 것이라 **추측해 앞에 두었다.**
 *   그리고 「추측이다 · 잰 값이 나오면 고친다」고 적어 두었다.
 * [잰 값] 사장님이 VWorld 콘솔 화면을 주셨다. 「활용API」 체크가 —
 *   · WEB    … 2D지도 · 배경지도 · WMS/WFS · WMTS/TMS · **2D데이터** ·
 *              **지오코더** · **검색** · **이미지** · 범례
 *   · REPORT … 3D지도 · 3D데스크톱 · 국가중점 **셋뿐**
 *   이 엔진이 부르는 것은 `req/address`(지오코더) · `req/data`(2D데이터) ·
 *   `req/image`(이미지)다 — **전부 WEB 에만 있고 REPORT 에는 하나도 없다.**
 *   이름이 뜻과 반대로 읽히는 자리라 추측이 거꾸로 갔다.
 *
 * ★ **이 칸이 없으면 되돌려도 조용하다** — 실측으로 기존 14칸이 순서를 한 번도
 *   안 쟀다. 잰 값으로 고친 것은 **재는 자리가 있어야** 남는다 (§8).
 * ★★ **낱말로 안 잰다** — 「주석에 WEB 이라 적혀 있는가」는 아무것도 안 재는
 *   것이다. **환경변수를 실제로 넣고 돌려** 어느 이름이 나오는지 본다.
 * ------------------------------------------------------------------------- */
test('★★★ 우리가 쓰는 API 가 승인된 열쇠(WEB)를 REPORT 보다 «먼저» 쓴다 (D-220)', () => {
  /* ★ 둘만 있을 때 — 콘솔에서 지오코더·2D데이터를 가진 쪽이 먼저여야 한다 */
  withEnv({ LINKPILOT_VWORLD_REPORT_KEY: B, LINKPILOT_VWORLD_WEB_KEY: C }, () => {
    assert.strictEqual(vkey.usedName(), 'LINKPILOT_VWORLD_WEB_KEY',
      'REPORT 를 먼저 씁니다 — 그 열쇠에는 지오코더·2D데이터가 승인돼 있지 않아 '
      + '첫 호출이 거부되고, 그만큼 호출과 시간이 버려집니다 (콘솔 실측 · D-220).');
    assert.strictEqual(vkey.vworldKey(), C);
  });

  /* ★★ 돌아가는 차례도 같다 — `keys()` 가 실제로 그 순서로 준다 */
  withEnv({ LINKPILOT_VWORLD_REPORT_KEY: B, LINKPILOT_VWORLD_WEB_KEY: C }, () => {
    assert.deepStrictEqual(vkey.keys().map((k) => k.name),
      ['LINKPILOT_VWORLD_WEB_KEY', 'LINKPILOT_VWORLD_REPORT_KEY'],
      '열쇠를 도는 차례가 거꾸로입니다 — 승인 안 된 쪽부터 겁니다.');
  });

  /* ★★★ 반대로 가는 것도 막는다 — 지금 도는 이름은 «여전히» 첫째다.
     순서를 고치면서 그것까지 밀어내면 NAS 에서 도는 것이 조용히 바뀐다. */
  withEnv({ VWORLD_KEY: A, LINKPILOT_VWORLD_WEB_KEY: C }, () => {
    assert.strictEqual(vkey.usedName(), 'VWORLD_KEY',
      '지금 도는 이름을 밀어냈습니다 — 도는 것을 안 건드리는 것이 이 목록의 첫 규칙입니다.');
  });

  /* ★ REPORT 를 «빼지 않았는가» — 콘솔에서 체크를 더하시면 살아나야 한다 */
  assert.ok(vkey.KEY_NAMES.includes('LINKPILOT_VWORLD_REPORT_KEY'),
    'REPORT 를 목록에서 뺐습니다 — 콘솔에서 체크를 더하셔도 안 살아납니다 (§4.6).');
});
