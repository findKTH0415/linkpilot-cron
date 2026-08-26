/**
 * 저장된 발행 주체를 **고를 수 있는가.**
 *
 * ★★ 2026-08-23 사장님 지시: 「저장된 회사를 선택할수 있도록 만들어줘 /
 *   신규가 아닐경우 / 자동 저장된 기업은 선택시 자동 노출」.
 *
 *   앞 판에도 목록은 있었는데 **이 브라우저에만** 남았다(localStorage).
 *   그래서 기기를 바꾸면 통째로 비었고, 사장님 화면에는 아무것도 안 보였다.
 *   이제 서버가 함께 기억한다.
 *
 * ★ 여기서 재는 것:
 *   ① 쓴 주체가 **자동으로** 얹힌다 (따로 저장을 안 누른다)
 *   ② 같은 회사는 **덮어쓴다** — 두 벌이면 어느 쪽이 최신인지 모른다
 *   ③ 목록 저장이 실패해도 **프로젝트 생성을 죽이지 않는다**
 *   ④ 응답 크기 때문에 로고를 뺀 것은 **뺐다고 말한다** (§4.9)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ISSUER = path.join(__dirname, '..', 'core', 'issuer.js');

/** 저장 뿌리를 임시 폴더로 돌려 놓고 부른다 — 실제 im-projects 를 안 건드린다 */
function withRoot(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-issuers-'));
  const before = process.env.IM_AGENT_ROOT;
  process.env.IM_AGENT_ROOT = dir;
  delete require.cache[require.resolve(ISSUER)];
  const I = require(ISSUER);
  try {
    return fn(I, dir);
  } finally {
    if (before === undefined) delete process.env.IM_AGENT_ROOT;
    else process.env.IM_AGENT_ROOT = before;
    delete require.cache[require.resolve(ISSUER)];
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const V = (en, extra) => Object.assign({ en, kr: null, tag: null, mark: null, logo: null, contact: null }, extra);

test('★★★ 쓴 주체가 목록 맨 앞에 얹힌다', () => {
  withRoot((I) => {
    assert.deepStrictEqual(I.list(), [], '처음에는 비어 있다');
    assert.strictEqual(I.remember(V('Acme Capital Partners'), '2026-08-23 20:00'), true);
    assert.strictEqual(I.remember(V('PDI Global'), '2026-08-23 20:05'), true);
    assert.deepStrictEqual(I.list().map((v) => v.en), ['PDI Global', 'Acme Capital Partners'],
      '최근에 쓴 것이 앞에 온다');
  });
});

test('★★★ 같은 회사는 덮어쓴다 — 두 벌이 남으면 어느 쪽이 최신인지 모른다', () => {
  withRoot((I) => {
    I.remember(V('PDI Global', { tag: 'PM' }), '2026-08-23 20:00');
    I.remember(V('Acme'), '2026-08-23 20:01');
    I.remember(V('pdi  GLOBAL', { tag: 'AM' }), '2026-08-23 20:10');
    const l = I.list();
    assert.strictEqual(l.length, 2, '대소문자·공백만 다른 것을 새 회사로 세면 안 된다');
    assert.strictEqual(l[0].tag, 'AM', '나중 값이 이긴다');
  });
});

test('★★ 개수 한도를 넘지 않는다', () => {
  withRoot((I) => {
    for (let i = 0; i < I.LIST_MAX + 5; i++) I.remember(V(`Company ${i}`), null);
    assert.strictEqual(I.list().length, I.LIST_MAX);
    assert.strictEqual(I.list()[0].en, `Company ${I.LIST_MAX + 4}`);
  });
});

test('★★ 회사명이 없으면 넣지 않는다 — 적다 만 것으로 목록이 더러워진다', () => {
  withRoot((I) => {
    assert.strictEqual(I.remember(V('   ')), false);
    assert.strictEqual(I.remember(null), false);
    assert.deepStrictEqual(I.list(), []);
  });
});

test('★★★ 목록 파일이 깨져도 던지지 않는다 — 프로젝트 생성이 죽으면 안 된다', () => {
  withRoot((I, dir) => {
    fs.writeFileSync(path.join(dir, I.LIST_FILE), '{ 이건 JSON 이 아니다');
    assert.deepStrictEqual(I.list(), [], '깨진 파일은 빈 목록으로 본다');
    assert.deepStrictEqual(I.listForClient(), []);
    assert.strictEqual(I.remember(V('New Co'), null), true, '깨진 것 위에 새로 쓴다');
    assert.deepStrictEqual(I.list().map((v) => v.en), ['New Co']);
  });
});

test('★★ 배열이 아닌 것이 들어 있어도 빈 목록으로 본다', () => {
  withRoot((I, dir) => {
    fs.writeFileSync(path.join(dir, I.LIST_FILE), '{"en":"단일 객체"}');
    assert.deepStrictEqual(I.list(), []);
  });
});

test('★★★ 로고 총량이 한도를 넘으면 뒤쪽은 로고만 빼고 **뺐다고 말한다**', () => {
  withRoot((I) => {
    // 한 건에 한도의 60% 짜리 로고 — 두 건째부터 넘는다
    const big = 'data:image/png;base64,' + 'A'.repeat(Math.floor(I.LIST_LOGO_BUDGET * 0.6));
    I.remember(V('First', { logo: big }), null);
    I.remember(V('Second', { logo: big }), null);
    /* 최근에 쓴 것이 앞이므로 Second 가 앞이고 First 가 뒤다 */
    const c = I.listForClient();
    assert.strictEqual(c.length, 2, '항목 자체는 남는다 — 통째로 빼면 회사가 사라진다');
    assert.deepStrictEqual(c.map((v) => v.en), ['Second', 'First']);
    assert.strictEqual(c[0].logoOmitted, false, '앞 건은 그대로 실린다');
    assert.ok(c[0].logo, '앞 건 로고가 없다');
    assert.strictEqual(c[1].logoOmitted, true, '넘친 건은 뺐다고 표시해야 한다');
    assert.strictEqual(c[1].logo, null);
  });
});

test('★★ 로고가 원래 없는 것과 뺀 것을 가른다', () => {
  withRoot((I) => {
    I.remember(V('NoLogo'), null);
    const c = I.listForClient();
    assert.strictEqual(c[0].logo, null);
    assert.strictEqual(c[0].logoOmitted, false, '없는 것을 「뺐다」고 하면 안 된다');
  });
});

test('★ 목록에서 지운다', () => {
  withRoot((I) => {
    I.remember(V('A'), null);
    I.remember(V('B'), null);
    assert.strictEqual(I.forget('a'), true, '대소문자를 가리지 않는다');
    assert.deepStrictEqual(I.list().map((v) => v.en), ['B']);
    assert.strictEqual(I.forget('없는회사'), false);
  });
});

/* ── 서버가 실제로 목록을 내려 주는가 ─────────────────────── */

test('★★★ GET /intake 가 저장된 목록을 함께 준다', async () => {
  const { createHandlers } = require('../ui/api-router.cjs');
  const body = (await createHandlers({ agentModulePath: path.join(__dirname, '..') }).intake()).body;
  assert.ok(Array.isArray(body.issuers), 'issuers 가 배열이 아니다 — 화면이 목록을 못 그린다');
});

/* ── 화면이 그것을 쓰는가 ─────────────────────────────────── */

/** 주석을 떼고 본다 (CLAUDE.md §8) */
function code() {
  return fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'intake.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('★★★ 1단계가 서버 목록과 브라우저 목록을 **둘 다** 쓴다', () => {
  const c = code();
  assert.ok(c.indexOf('issuerChoices') !== -1, '합치는 함수가 없다');
  assert.ok(/state\.info && state\.info\.issuers/.test(c),
    '서버 목록을 안 읽는다 — 기기를 바꾸면 목록이 통째로 빈다');
  assert.ok(c.indexOf('loadIssuers()') !== -1, '브라우저 목록을 안 읽는다');
});

test('★★★ 고르면 로고까지 그 회사 것으로 바뀐다 — 앞 회사 로고가 남으면 안 된다', () => {
  const c = code();
  assert.ok(/if \(!it\.logoOmitted\) state\.issuer\.logo = it\.logo \|\| '';/.test(c),
    '로고를 「있을 때만」 덮으면 로고 없는 회사를 골라도 앞 회사 로고가 표지에 찍힌다');
});

test('★★★ 사장님이 지우라고 한 부연설명 둘이 없다', () => {
  const c = code();
  assert.ok(c.indexOf('현재 설정: ') === -1,
    '「현재 설정: … (저장소 설정 issuer.json)」 줄이 남아 있다');
  assert.ok(c.indexOf('이 브라우저에 남습니다') === -1,
    '「여기 적은 것은 이 브라우저에 남습니다 …」 줄이 남아 있다');
});

test('★★ 잘못된 것을 말하는 줄은 **남긴다** — 부연이 아니다', () => {
  const c = code();
  assert.ok(c.indexOf('저장된 발행 주체 설정을 읽지 못했습니다') !== -1,
    '설정을 못 읽은 사실까지 지우면 조용히 미설정으로 나간다');
  assert.ok(c.indexOf('아직 설정된 발행 주체가 없습니다') !== -1);
});
