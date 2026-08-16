'use strict';
/**
 * secrets.test.js — 워크플로가 쓰는 secret 과 등록부가 어긋나지 않게 한다 (D-12).
 *
 * 왜 필요한가: 등록부 D-12 는 「공공데이터 키가 없어 CI·배포에서 죽는다」고
 * 적고 있었는데 **사실이 아니었다** (2026-08-16 발견). `im-agent-ci.yml` 은
 * `IM_AGENT_OFFLINE=1` 로 돌고 secret 을 하나도 안 쓴다 — 그 키들을 Secrets 에
 * 넣어도 아무것도 달라지지 않는다.
 *
 * ★ **문서가 워크플로보다 오래 산다.** 워크플로에 secret 을 하나 더하면 등록부는
 *   그대로 남고, 그 상태에서 사람은 「목록대로 다 넣었다」고 믿는다. 그러면
 *   배포가 그 하나 때문에 죽는데 목록에는 없다. 그래서 **양쪽을 대조한다.**
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const REGISTRY = path.join(ROOT, 'docs', '미결정-사항.md');

/** GitHub 이 자동으로 넣어 주는 것 — 사람이 등록하지 않는다 */
const BUILT_IN = new Set(['GITHUB_TOKEN']);

function workflowSecrets() {
  const out = new Map();   // secret → [워크플로]
  for (const f of fs.readdirSync(WF_DIR).filter(n => /\.ya?ml$/.test(n))) {
    const src = fs.readFileSync(path.join(WF_DIR, f), 'utf8');
    for (const m of src.matchAll(/secrets\.([A-Z_][A-Z0-9_]*)/g)) {
      if (BUILT_IN.has(m[1])) continue;
      if (!out.has(m[1])) out.set(m[1], []);
      if (!out.get(m[1]).includes(f)) out.get(m[1]).push(f);
    }
  }
  return out;
}

/**
 * ★ **워크플로가 쓰는 secret 은 전부 등록부에 있어야 한다.**
 *   빠지면 「목록대로 다 넣었다」고 믿는 상태에서 그 하나 때문에 배포가 죽는다.
 */
test('★ 워크플로가 쓰는 secret 이 전부 등록부에 적혀 있다', () => {
  const reg = fs.readFileSync(REGISTRY, 'utf8');
  const d12 = reg.slice(reg.indexOf('### 🔴 D-12.'), reg.indexOf('### ', reg.indexOf('### 🔴 D-12.') + 10));
  assert.ok(d12.length > 200, 'D-12 항목을 찾지 못했다');

  const missing = [...workflowSecrets().keys()].filter(k => !d12.includes(k));
  assert.deepStrictEqual(missing, [],
    `워크플로가 쓰는데 등록부에 없다: ${missing.join(', ')} — 이 상태로 등록하면 그 하나 때문에 죽는다`);
});

/**
 * ★ 반대 방향도 본다. **등록부가 「지금 필요하다」고 한 것은 실제로 쓰여야 한다.**
 *   안 쓰는 것을 필요하다고 하면 목록이 길어지고, 길어진 목록은 시작을 막는다 —
 *   실제로 그 상태였다(공공데이터 키 12개가 「필요」로 적혀 있었다).
 */
test('★ 「지금 등록해야 하는 것」은 실제로 워크플로가 쓰는 것뿐이다', () => {
  const reg = fs.readFileSync(REGISTRY, 'utf8');
  const start = reg.indexOf('**① 지금 등록해야 하는 것');
  const end = reg.indexOf('**② 지금은 등록해도');
  assert.ok(start > -1 && end > start, '① 절을 찾지 못했다');

  const used = workflowSecrets();
  const listed = [...new Set(
    (reg.slice(start, end).match(/`([A-Z_][A-Z0-9_]*)`/g) || []).map(x => x.replace(/`/g, '')),
  )].filter(x => !BUILT_IN.has(x));

  assert.ok(listed.length, '① 에 secret 이 하나도 없다');
  const notUsed = listed.filter(k => !used.has(k));
  assert.deepStrictEqual(notUsed, [],
    `등록부는 필요하다는데 쓰는 워크플로가 없다: ${notUsed.join(', ')}`);
});

/**
 * ★ 「지금은 안 쓰인다」고 적은 것이 정말 안 쓰여야 한다. 하나라도 쓰이기
 *   시작하면 그건 ① 로 올라가야 하는데, 이 검사가 없으면 아무도 모른다.
 */
test('★ 「지금은 쓰이지 않는 것」이 정말로 안 쓰인다', () => {
  const reg = fs.readFileSync(REGISTRY, 'utf8');
  const start = reg.indexOf('**② 지금은 등록해도');
  const end = reg.indexOf('**어떤 워크플로도 이 값을 읽지 않는다.**');
  assert.ok(start > -1 && end > start, '② 절을 찾지 못했다');

  const used = workflowSecrets();
  const listed = (reg.slice(start, end).match(/`([A-Z_][A-Z0-9_]*)`/g) || []).map(x => x.replace(/`/g, ''));
  const actuallyUsed = listed.filter(k => used.has(k));
  assert.deepStrictEqual(actuallyUsed, [],
    `②(안 쓰인다)에 있는데 실제로 쓰인다: ${actuallyUsed.join(', ')} — ① 로 올려야 한다`);
});

/**
 * ★ CI 가 오프라인으로 돈다는 것이 ② 판단의 근거다. 이게 바뀌면 ② 도 바뀐다.
 */
test('★ CI 는 오프라인으로 돈다 (이것이 ② 판단의 근거다)', () => {
  const ci = fs.readFileSync(path.join(WF_DIR, 'im-agent-ci.yml'), 'utf8');
  assert.match(ci, /IM_AGENT_OFFLINE:\s*'?1'?/,
    'CI 가 오프라인이 아니면 공공데이터 키가 필요해진다 — D-12 ② 를 다시 봐야 한다');
  assert.ok(!/secrets\./.test(ci), 'CI 가 secret 을 쓰기 시작했다 — D-12 를 갱신해야 한다');
});

/**
 * ★ 실패 알림 경로에 secret 이 걸려 있다. **이게 비면 실패가 조용히 지나간다** —
 *   CLAUDE.md §2 가 금지하는 상태다.
 */
test('★ 실패 알림이 secret 을 쓰고, 그 사실이 등록부 ① 에 있다', () => {
  const used = workflowSecrets();
  ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'ALERT_PHONE'].forEach((k) => {
    assert.ok(used.has(k), `${k} 를 쓰는 워크플로가 없다 — 실패 알림 경로가 사라졌는가`);
    assert.ok(used.get(k).some(f => /alert-failure/.test(f)), `${k} 가 실패 알림에서 안 쓰인다`);
  });
});

/**
 * ★ 새 커넥터 키를 더할 때 `SECRET_ENV` 에 넣는 것을 잊으면 **로그에 평문으로
 *   남는다**(§4.1). `.env.example` 을 단일 출처로 삼아 대조한다.
 */
test('★ .env.example 의 키가 전부 마스킹 대상이다', () => {
  const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const { SECRET_ENV } = require('../connectors/http');
  // 키가 아닌 것(관측소 번호 등)은 마스킹하면 오히려 로그를 망가뜨린다
  const notSecret = new Set(['KMA_STN']);
  const names = (env.match(/^[A-Z][A-Z0-9_]*=/gm) || []).map(x => x.slice(0, -1));
  const missing = names.filter(n => !notSecret.has(n) && !SECRET_ENV.includes(n));
  assert.deepStrictEqual(missing, [],
    `SECRET_ENV 에 없다: ${missing.join(', ')} — 오류 메시지에 평문으로 남는다`);
});
