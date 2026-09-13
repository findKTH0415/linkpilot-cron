'use strict';
/**
 * datakey.test.js — 공공데이터포털 키를 **두 이름 다** 읽는지 잰다.
 *
 * ★★★ **왜 이 칸을 두는가** 〈2026-09-13 사장님 지시: 「APIS_DATA 이름으로 넣었어」〉.
 *   이름이 어긋나면 **아무 오류도 안 나고 조용히 값이 죽는다.** 이 저장소에서
 *   실제로 세 번 났다 (`ECOS_API_KEY`/`ECOS_BOK_KEY` · `LAW_OC`/`LAW_OPEN_DATA` ·
 *   `CLODE_API_KEY2`). 그때마다 사장님은 넣으셨고 엔진은 「키가 없다」고 했다.
 *
 * ★ **「목록에 있는가」가 아니라 «커넥터가 실제로 그 값을 읽는가»를 잰다.**
 *   목록만 세면 `datakey.js` 를 안 쓰는 커넥터가 하나 남아 있어도 초록이 된다 —
 *   그리고 그 하나가 「일부 기능만 안 된다」를 만든다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CONN = path.join(ROOT, 'im-agent', 'connectors');
const datakey = require('../connectors/datakey');

/** 환경변수를 갈아 끼우고 되돌린다 */
function withEnv(vars, fn) {
  const saved = {};
  Object.keys(vars).forEach((k) => { saved[k] = process.env[k]; });
  datakey.KEY_NAMES.forEach((k) => {
    if (!(k in saved)) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  Object.entries(vars).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });
  try { return fn(); } finally {
    Object.entries(saved).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    });
  }
}

const FAKE = 'K'.repeat(40);

test('★★★ 사장님이 넣으신 이름(APIS_DATA)만 있어도 값이 읽힌다', () => {
  withEnv({ DATA_GO_KR_KEY: undefined, APIS_DATA: FAKE }, () => {
    assert.strictEqual(datakey.usedName(), 'APIS_DATA');
    assert.strictEqual(datakey.dataKey(), FAKE);
    assert.strictEqual(datakey.hasKey(), true);
  });
});

test('★ 둘 다 있으면 안내 문서의 이름(DATA_GO_KR_KEY)이 이긴다', () => {
  withEnv({ DATA_GO_KR_KEY: 'A'.repeat(40), APIS_DATA: FAKE }, () => {
    assert.strictEqual(datakey.usedName(), 'DATA_GO_KR_KEY');
    assert.strictEqual(datakey.dataKey(), 'A'.repeat(40));
  });
});

test('★ 하나도 없으면 없다고 한다 — 빈 문자열이지 undefined 가 아니다', () => {
  withEnv({ DATA_GO_KR_KEY: undefined, APIS_DATA: undefined }, () => {
    assert.strictEqual(datakey.usedName(), null);
    assert.strictEqual(datakey.dataKey(), '');
    assert.strictEqual(datakey.hasKey(), false);
  });
});

test('★ 앞뒤 빈칸은 떼고 읽는다 (붙여 넣을 때 딸려 온다)', () => {
  withEnv({ DATA_GO_KR_KEY: undefined, APIS_DATA: `  ${FAKE}\t` }, () => {
    assert.strictEqual(datakey.dataKey(), FAKE);
  });
});

/**
 * ★★★ **여기가 급소다.** data.go.kr 을 쓰는 커넥터가 **전부** 이 읽기를 거치는지
 *   확인한다. 하나라도 제 손으로 `process.env.DATA_GO_KR_KEY` 를 읽으면,
 *   `APIS_DATA` 로 넣으신 날 **그 커넥터만 조용히 죽는다.**
 */
test('★★★ data.go.kr 커넥터가 「제 손으로」 환경변수를 읽는 곳이 없다', () => {
  const offenders = [];
  for (const f of fs.readdirSync(CONN).filter((n) => n.endsWith('.js'))) {
    if (f === 'datakey.js') continue;          // 이름 목록의 집. 여기만 직접 읽는다
    if (f === 'http.js') continue;             // SECRET_ENV 는 «가릴 이름»의 목록이다
    const src = fs.readFileSync(path.join(CONN, f), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (/process\.env\.DATA_GO_KR_KEY/.test(src)) offenders.push(f);
  }
  assert.deepStrictEqual(offenders, [],
    `제 손으로 DATA_GO_KR_KEY 를 읽는다: ${offenders.join(' · ')} — `
    + 'APIS_DATA 로 넣으신 날 이 커넥터만 조용히 죽는다. datakey.js 의 dataKey() 를 쓴다');
});

/**
 * ★★ **돌려서 잰다.** 위 칸은 글자를 보는 것이라 「안 읽는다」까지만 안다.
 *   이 칸은 커넥터를 **실제로 불러** `APIS_DATA` 만 있을 때 「쓸 수 있다」고 하는지 본다.
 *
 * ★★★ **앞 판의 이 칸은 아무것도 안 쟀다** 〈2026-09-13 · 사보타주에서 잡았다〉.
 *   `kasi.diagnose()` 를 불러 「미설정」이 없는지 봤는데, `diagnose(status, body, …)` 는
 *   **인자를 받아 분류만 하는 함수**라 열쇠를 아예 안 본다. 인자 없이 부르면 언제나
 *   `unreachable` 이 나오고, 그래서 **커넥터를 옛 방식으로 되돌려도 초록이었다.**
 *   ★ 「불러 봤다」와 「그 값을 보는 것을 불러 봤다」는 다른 사실이다 (§8 과 같은 결).
 *   ★★ 지금은 **열 커넥터의 `isAvailable()` 을 전부** 돌린다 — 그것이 실제로
 *     「키 없음」을 정하는 자리다. 망을 안 탄다.
 */
const DATA_GO_KR_CONNECTORS = [
  'molit', 'kpx', 'fsc', 'g2b', 'nts', 'nps', 'kasi', 'customs', 'enviro', 'factory',
];

test('★★★ APIS_DATA 만 넣어도 열 커넥터가 전부 「쓸 수 있다」고 한다', () => {
  const dead = [];
  withEnv({ DATA_GO_KR_KEY: undefined, APIS_DATA: FAKE }, () => {
    DATA_GO_KR_CONNECTORS.forEach((name) => {
      const m = require(`../connectors/${name}`);
      assert.strictEqual(typeof m.isAvailable, 'function',
        `${name} 이 isAvailable 을 안 내보낸다 — 이 칸이 그 커넥터를 못 잰다`);
      if (m.isAvailable() !== true) dead.push(name);
    });
  });
  assert.deepStrictEqual(dead, [],
    `APIS_DATA 가 들어 있는데 「키 없음」이라 한다: ${dead.join(' · ')} — 이름이 안 이어졌다`);
});

test('★ 되짚어 잰다 — 둘 다 비우면 열 커넥터가 전부 「못 쓴다」고 한다', () => {
  const alive = [];
  withEnv({ DATA_GO_KR_KEY: undefined, APIS_DATA: undefined }, () => {
    DATA_GO_KR_CONNECTORS.forEach((name) => {
      if (require(`../connectors/${name}`).isAvailable() === true) alive.push(name);
    });
  });
  assert.deepStrictEqual(alive, [],
    `열쇠가 없는데 「쓸 수 있다」고 한다: ${alive.join(' · ')} — 위 칸이 늘 초록이 된다`);
});

/**
 * ★ **이름을 더하면 «가리는 목록»에도 더해야 한다** (CLAUDE.md §2 · §4.1).
 *   빠지면 오류 본문·로그에 **평문으로 샌다.** 이 칸이 그 둘을 대 본다.
 */
test('★★ 받는 이름이 전부 SECRET_ENV 에 있다 (값이 로그에 안 새게)', () => {
  const http = fs.readFileSync(path.join(CONN, 'http.js'), 'utf8');
  const missing = datakey.KEY_NAMES.filter((n) => !new RegExp(`'${n}'`).test(http));
  assert.deepStrictEqual(missing, [],
    `SECRET_ENV 에 없다: ${missing.join(', ')} — 이 이름으로 들어온 값이 로그에 평문으로 남을 수 있다`);
});

/**
 * ★ **배포가 나르지 않으면 Secret 에 넣어도 NAS 로 안 간다** (M-40 사고 그대로).
 *   `env:` 에 있는 것과 `NAMES` 목록에 있는 것은 **다른 사실**이라 둘 다 본다.
 */
test('★★★ 배포가 받는 이름을 전부 NAS 로 나른다 (env: 와 NAMES 둘 다)', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-nas.yml'), 'utf8');
  const noEnv = datakey.KEY_NAMES.filter((n) => !new RegExp(`^\\s*${n}: \\$\\{\\{ secrets\\.${n} \\}\\}`, 'm').test(wf));
  assert.deepStrictEqual(noEnv, [], `deploy-nas.yml 의 env: 에 없다: ${noEnv.join(', ')}`);

  const m = wf.match(/^\s*NAMES="([^"]+)"/m);
  assert.ok(m, 'NAMES 목록을 찾지 못했다 — 이 칸은 아무것도 안 잰다');
  const carried = m[1].split(/\s+/);
  const noCarry = datakey.KEY_NAMES.filter((n) => carried.indexOf(n) === -1);
  assert.deepStrictEqual(noCarry, [],
    `NAMES 목록에 없다: ${noCarry.join(', ')} — env: 에만 있으면 열쇠 파일에 «안 실린다»`);
});
