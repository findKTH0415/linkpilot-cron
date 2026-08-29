'use strict';
/**
 * second-reader.test.js — **자료를 읽는 길이 둘이다** 〈2026-08-29 · D-167〉.
 *
 * 사장님이 PDF 여덟을 올리셨는데 셋을 한 글자도 못 읽었다. 그 셋은 글자의
 * 58~100% 가 코드값으로만 들어 있어 OCR 로 넘어가야 했는데, **그 OCR 이
 * 하나뿐**이었고 그날 Gemini 열쇠가 전부 막혀 있었다(D-166).
 *
 * ★ D-166 은 **같은 길을 고친 것**이다. 한도가 정말 찬 날에는 여전히 한 글자도
 *   못 읽는다. 그래서 **다른 회사의 다른 길**을 하나 더 뒀다.
 *
 * ★★ 이 검사는 **진짜 API 를 부르지 않는다.** 열쇠를 찾는 규칙과 넘어가는
 *   규칙만 잰다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const claude = require('../core/claude.js');
const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 시험 사이에 환경을 되돌린다 — 안 그러면 앞 시험이 뒤 시험을 물들인다 */
function withEnv(vars, fn) {
  const saved = {};
  Object.keys(process.env).forEach((n) => {
    if (claude.KEY_PATTERN.test(n)) { saved[n] = process.env[n]; delete process.env[n]; }
  });
  Object.keys(vars).forEach((n) => { process.env[n] = vars[n]; });
  try { return fn(); }
  finally {
    Object.keys(vars).forEach((n) => { delete process.env[n]; });
    Object.keys(saved).forEach((n) => { process.env[n] = saved[n]; });
  }
}

const LONG = 'x'.repeat(40);

// ══ 열쇠 이름 ══════════════════════════════════════════════

/**
 * ★★★ 이번 사고의 핵심. 사장님이 넣으신 이름은 `CLODE_API_Key2` 였다 —
 *   `CLAUDE` 가 아니라 `CLODE` 다. 이름 하나만 기다리면 **오류 없이 조용히
 *   안 읽힌다**: 넣은 사람은 넣었다고 알고, 엔진은 없다고 하고, 둘 다 모른다.
 */
test('★★★ 철자가 달라도 받는다 — CLODE·CLAUDE·ANTHROPIC', () => {
  ['CLAUDE_API_KEY', 'CLODE_API_KEY2', 'CLODE_API_KEY_2', 'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY_2', 'CLODE_API_KEY'].forEach((name) => {
    withEnv({ [name]: LONG }, () => {
      assert.strictEqual(claude.keyName(), name, `${name} 을 못 알아본다`);
      assert.strictEqual(claude.available(), true);
    });
  });
});

test('대소문자를 가리지 않는다 (사장님이 적으신 Key 처럼)', () => {
  withEnv({ CLODE_API_Key2: LONG }, () => {
    assert.strictEqual(claude.available(), true, '대소문자가 다르다고 못 읽는다');
  });
});

/**
 * ★ **값이 비었거나 짧은 것**은 「없다」와 다르다. 이름은 만들어 두고 값을
 *   안 넣은 상태가 실제로 자주 있다 — 그때 「없다」고만 하면 이름을 다시 만든다.
 */
test('★ 이름은 있는데 값이 짧으면 그렇다고 말한다', () => {
  withEnv({ CLAUDE_API_KEY: 'short' }, () => {
    const d = claude.diagnose();
    assert.strictEqual(d.ok, false);
    assert.match(d.text, /값이 비었거나 너무 짧다/, '왜 안 되는지를 안 적는다');
    assert.match(d.text, /CLAUDE_API_KEY/, '어느 이름인지 안 적는다');
  });
});

test('열쇠가 없으면 없다고 말하고, 받는 이름들을 알려 준다', () => {
  withEnv({}, () => {
    const d = claude.diagnose();
    assert.strictEqual(d.ok, false);
    assert.match(d.text, /CLODE_API_KEY2/, '받는 이름을 안 알려 준다');
  });
});

/**
 * ★★★ **값을 한 글자도 내지 않는다** (CLAUDE.md §2). 진단은 사람이 보는
 *   글이고 로그에도 남는다.
 */
test('★★★ 진단이 열쇠 값을 한 글자도 내지 않는다', () => {
  const secret = 'sk-ant-SECRETVALUE-0123456789';
  withEnv({ CLAUDE_API_KEY: secret }, () => {
    const d = claude.diagnose();
    assert.ok(d.text.indexOf(secret) === -1, '값이 그대로 실렸다');
    assert.ok(d.text.indexOf('SECRETVALUE') === -1, '값 조각이 실렸다');
    assert.match(d.text, /CLAUDE_API_KEY/, '이름은 적어야 사람이 찾는다');
  });
});

test('이름이 여럿이면 어느 것을 쓰는지 말한다', () => {
  withEnv({ CLAUDE_API_KEY: LONG, ANTHROPIC_API_KEY: LONG }, () => {
    const d = claude.diagnose();
    assert.strictEqual(d.ok, true);
    assert.match(d.text, /2개 들어와 있어/, '여럿인 사실을 안 알려 준다');
  });
});

// ══ 배선 ═══════════════════════════════════════════════════

/**
 * ★★★ **Secret 에 넣어도 배포 목록에 없으면 NAS 로 안 간다.** 넣은 사람은
 *   넣었다고 알고, 엔진은 「키가 없다」고 하고, 배포는 초록으로 끝난다
 *   (MEMORY M-40 이 기록한 사고 그대로다).
 */
test('★★★ 배포가 이 열쇠를 NAS 로 실어 나른다', () => {
  const wf = read('.github/workflows/deploy-nas.yml');
  ['CLAUDE_API_KEY', 'CLODE_API_KEY2', 'ANTHROPIC_API_KEY'].forEach((n) => {
    assert.ok(wf.indexOf(`${n}: \${{ secrets.${n} }}`) !== -1,
      `${n} 을 Secret 에서 안 받는다`);
    assert.match(wf, new RegExp(`NAMES="[^"]*\\b${n}\\b`),
      `${n} 이 실어 나르는 목록에 없다 — Secret 에 넣어도 NAS 로 안 간다`);
  });
});

/**
 * ★ 목록에 없으면 **그 이름만** 로그에 평문으로 남는다 (§2).
 */
test('★ 열쇠 이름이 가리개 목록에 있다', () => {
  const http = read('im-agent/connectors/http.js');
  ['CLAUDE_API_KEY', 'CLODE_API_KEY2', 'ANTHROPIC_API_KEY'].forEach((n) => {
    assert.match(http, new RegExp(`'${n}'`), `${n} 이 SECRET_ENV 에 없다 — 로그에 평문으로 남는다`);
  });
});

test('새 라이브러리를 들이지 않았다 (CLAUDE.md §5)', () => {
  const src = read('im-agent/core/claude.js');
  assert.match(src, /require\('https'\)/, '표준 https 를 안 쓴다');
  assert.ok(!/@anthropic-ai\/sdk/.test(src), 'SDK 를 들였다 — 배포가 npm install 을 안 돌린다');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!(pkg.dependencies || {})['@anthropic-ai/sdk'], '의존성이 늘었다');
});

// ══ 넘어가는 규칙 ═══════════════════════════════════════════

const ocrSrc = read('im-agent/core/ocr.js');

test('첫 길이 실패하면 두 번째 길로 넘어간다', () => {
  assert.match(ocrSrc, /claude\.available\(\)/, '두 번째 길이 켜졌는지 안 본다');
  assert.match(ocrSrc, /await claude\.generate\(/, '두 번째 길을 안 부른다');
});

/**
 * ★★ 두 번째 길이 꺼져 있으면 **첫 까닭을 그대로** 올려야 한다.
 *   여기서 말을 바꾸면 원인이 흐려진다.
 */
test('★★ 두 번째 길이 꺼져 있으면 첫 까닭을 그대로 올린다', () => {
  assert.match(ocrSrc, /if \(!claude\.available\(\)\) \{[\s\S]*?throw e;/,
    '두 번째 길이 없을 때 원래 까닭을 안 올린다');
});

test('★★ 둘 다 실패하면 두 까닭을 함께 적는다', () => {
  assert.match(ocrSrc, /두 길 다 못 읽었다 — 첫째: \$\{firstWhy\} \/ 둘째: \$\{why2\}/,
    '한쪽 까닭만 적으면 왜 안 되는지를 반쪽만 알게 된다');
  assert.match(ocrSrc, /OCR_BOTH_FAILED/, '가려낼 코드가 없다');
});

/**
 * ★ 두 길의 글자는 결이 다를 수 있다. 나중에 「이 값이 왜 이런가」를 볼 때
 *   누가 읽었는지가 필요하다 (§4.7 출처 규칙).
 */
test('★ 누가 읽었는지 남긴다', () => {
  assert.match(ocrSrc, /by: 'claude'|by,/, '읽은 쪽을 안 남긴다');
  assert.match(ocrSrc, /fallbackFrom/, '왜 넘어갔는지를 안 남긴다');
});

test('모델을 한 곳에서만 정한다', () => {
  assert.strictEqual(claude.MODEL, 'claude-opus-5');
  const src = read('im-agent/core/claude.js');
  const hits = (src.match(/claude-opus-5/g) || []).length;
  assert.strictEqual(hits, 1, '모델 이름이 여러 곳에 박혀 있다 — 한쪽만 고치는 날이 온다');
});

/**
 * ★ 거절도 200 으로 온다. `content` 를 보기 전에 왜 멈췄는지부터 봐야 한다.
 */
test('★ 거절을 성공으로 넘기지 않는다', () => {
  const src = read('im-agent/core/claude.js');
  assert.match(src, /stop_reason === 'refusal'/, '거절을 안 본다 — 빈 글자를 성공으로 넘긴다');
});
