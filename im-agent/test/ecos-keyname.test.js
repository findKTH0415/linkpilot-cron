'use strict';
/**
 * ecos-keyname.test.js — 한국은행(ECOS) 열쇠 이름이 둘인 것을 고정한다.
 *
 * ★★ **왜 이 검사가 있나** 〈2026-08-26 실측〉.
 *   안내 문서(`.env.example` · CLAUDE.md §4.1)는 `ECOS_API_KEY` 인데
 *   사장님이 실제로 넣으신 이름은 `ECOS_BOK_KEY` 였다.
 *   엔진이 한 이름만 보면 **넣으신 값이 조용히 죽는다** — 넣은 사람은 넣었다고 알고,
 *   스모크는 「미설정」이라고 말하고, 배포는 초록이다.
 *
 *   `law.js` 의 `LAW_OC` / `LAW_OPEN_DATA` 와 글자 그대로 같은 사고다.
 *   그때 정한 답(둘 다 읽고, 어느 이름이 쓰였는지 말해 준다)을 여기서도 지킨다.
 *
 *   ★ 값이 아니라 **동작**을 고정한다. 이름 하나를 지우는 순간 이 검사가 빨개진다.
 */

const test = require('node:test');
const assert = require('node:assert');

const ecos = require('../connectors/ecos');

/** 환경변수를 만졌다가 반드시 되돌린다 — 다른 검사에 새어 나가면 원인 추적이 오래 걸린다 */
function withEnv(pairs, fn) {
  const saved = {};
  for (const k of Object.keys(pairs)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(pairs)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('★ 둘 다 비어 있으면 못 쓴다고 말한다', () => {
  withEnv({ ECOS_API_KEY: undefined, ECOS_BOK_KEY: undefined }, () => {
    assert.strictEqual(ecos.usedName(), null);
    assert.strictEqual(ecos.isAvailable(), false);
  });
});

test('★ ECOS_BOK_KEY 만 넣어도 엔진이 읽는다 — 이것이 이 검사의 이유다', () => {
  withEnv({ ECOS_API_KEY: undefined, ECOS_BOK_KEY: 'bok-abcdefghij' }, () => {
    assert.strictEqual(ecos.usedName(), 'ECOS_BOK_KEY');
    assert.strictEqual(ecos.isAvailable(), true);
  });
});

test('★ ECOS_API_KEY 만 넣어도 읽는다 (안내 문서의 이름)', () => {
  withEnv({ ECOS_API_KEY: 'api-abcdefghij', ECOS_BOK_KEY: undefined }, () => {
    assert.strictEqual(ecos.usedName(), 'ECOS_API_KEY');
    assert.strictEqual(ecos.isAvailable(), true);
  });
});

test('★ 둘 다 있으면 안내 문서의 이름이 이긴다 — 우선순위가 흔들리면 안 된다', () => {
  withEnv({ ECOS_API_KEY: 'api-abcdefghij', ECOS_BOK_KEY: 'bok-abcdefghij' }, () => {
    assert.strictEqual(ecos.usedName(), 'ECOS_API_KEY');
  });
});

test('★ 공백만 넣은 것은 넣은 것이 아니다', () => {
  withEnv({ ECOS_API_KEY: '   ', ECOS_BOK_KEY: 'bok-abcdefghij' }, () => {
    assert.strictEqual(ecos.usedName(), 'ECOS_BOK_KEY',
      '공백을 값으로 세면 「넣었는데 왜 안 되지」가 된다');
  });
});

test('★ 못 쓴다는 말에 **받는 이름이 전부** 들어 있다', () => {
  // 「미설정」이라고만 하면 사장님이 넣으신 이름을 의심하지 못한다.
  // 두 이름이 다 적혀 있어야 「아, 내가 다른 이름으로 넣었구나」가 된다.
  const r = ecos.unavailable('시장금리');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.unavailable, true);
  for (const name of ['ECOS_API_KEY', 'ECOS_BOK_KEY']) {
    assert.ok(r.error.includes(name), `못 쓴다는 말에 ${name} 이 없다: ${r.error}`);
  }
});

test('★ 키가 없으면 실제 조회도 그 말을 그대로 돌려준다', async () => {
  // 문구만 맞고 실제 경로가 다르면 화면에는 딴 말이 뜬다 — 경로까지 확인한다
  await withEnv({ ECOS_API_KEY: undefined, ECOS_BOK_KEY: undefined }, async () => {
    const r = await ecos.marketRate();
    assert.strictEqual(r.unavailable, true);
    assert.ok(r.error.includes('ECOS_BOK_KEY'), `실제 조회 경로의 문구: ${r.error}`);
  });
});

test('★ 로그 가리개(SECRET_ENV)가 두 이름을 **모두** 안다', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'connectors', 'http.js'), 'utf8');
  for (const name of ['ECOS_API_KEY', 'ECOS_BOK_KEY']) {
    assert.ok(src.includes(`'${name}'`),
      `${name} 이 SECRET_ENV 에 없다 — 오류 메시지에 열쇠가 평문으로 남을 수 있다 (CLAUDE.md §2)`);
  }
});

test('★ 안내 문서가 두 이름을 함께 적고 있다', () => {
  const env = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', '.env.example'), 'utf8');
  assert.ok(env.includes('ECOS_BOK_KEY'),
    '.env.example 이 받는 이름을 다 적지 않으면 다음 사람이 또 다른 이름으로 넣는다');
});
