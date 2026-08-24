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
 * ★★★ **문자 알림을 지웠다** 〈2026-08-24 사장님 지시 · D-99〉.
 *
 *   앞 판은 「실패 알림이 secret 을 쓰고 있는가」를 쟀다. 그 장치를 통째로
 *   지웠으니 그대로 두면 **영영 빨간 검사**가 된다 — 그리고 늘 빨간 검사는
 *   아무도 안 본다.
 *
 * ★ 그래서 재는 것을 바꾼다. **지운 것이 정말 지워졌는가**, 그리고 **무엇이
 *   대신 알리는지가 적혀 있는가**. 뒤엣것을 안 재면 반년 뒤에 「왜 알림이
 *   없지」로 다시 헤맨다 — CLAUDE.md §2 는 규칙 자체는 그대로 두고 경로만
 *   바꿔 적었다.
 */
test('★★★ 지운 알림의 secret 을 아무 워크플로도 안 읽는다', () => {
  const used = workflowSecrets();
  ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SENDER_PHONE', 'ALERT_PHONE'].forEach((k) => {
    assert.ok(!used.has(k),
      `${k} 를 아직 읽는 워크플로가 있다: ${(used.get(k) || []).join(', ')} — 반쯤 지우면 배포가 없는 파일을 부른다`);
  });
});

test('★★ 무엇이 대신 알리는지가 CLAUDE.md 에 적혀 있다', () => {
  const md = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.ok(/GitHub 이 실행 실패 시 보내는 메일/.test(md),
    '지운 사실만 적고 대신 무엇이 알리는지를 안 적었다 — 반년 뒤 같은 논의를 다시 한다');
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

/**
 * ★★ **접속정보는 저장소에 두지 않는다.** 이 저장소는 public 이다 (D-10).
 *
 * 왜 이 검사가 있나: `deploy/nas.sh` 가 NAS 계정과 tailnet 주소를 **기본값으로**
 * 박고 있었고, 지시서 본문에도 주소가 적혀 있었다 (2026-08-19 발견). 기본값은
 * 편하려고 넣은 것인데, public 저장소에서 기본값은 **곧 공개**다.
 *
 * ★ 「키」만 시크릿이 아니다. §2 는 **NAS 접속정보**를 함께 금지한다 — 계정 이름과
 *   주소가 있으면 나머지는 시도해 볼 수 있는 것이 되기 때문이다.
 *
 * ★ 추적되는 파일만 본다. 손에만 있는 `.env` 는 올라가지 않으므로 볼 것이 없다.
 */
test('★★ 추적되는 파일에 NAS 접속정보가 없다 (public — D-10)', () => {
  const { execFileSync } = require('node:child_process');
  // ★ `-z` 로 받는다. 기본 출력은 한글 파일 이름을 `"docs/\\354..."` 로 따옴표
  //   이스케이프해서 내주고, 그 경로는 열리지 않아 **조용히 건너뛰어진다.**
  //   실제로 그렇게 통과했다 — 지시서에 주소가 그대로 있는데 초록이었다
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean)
    // 이 파일 자신은 「무엇을 금지하는지」를 적으므로 본보기가 들어간다
    .filter(f => f !== 'im-agent/test/secrets.test.js');

  const 금지 = [
    { 무엇: 'tailnet 주소', re: /[a-z0-9-]+\.ts\.net/i },
    { 무엇: 'tailnet 대역 IP', re: /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/ },
    { 무엇: 'ssh 계정@주소', re: /\b[a-z][a-z0-9_.-]{2,}@(\d{1,3}\.){3}\d{1,3}\b/i },
  ];

  const hits = [];
  let 못읽음 = 0;
  for (const f of tracked) {
    const full = path.join(ROOT, f);
    let s;
    try { s = fs.readFileSync(full, 'utf8'); } catch { 못읽음 += 1; continue; }
    for (const g of 금지) {
      const m = g.re.exec(s);
      if (m) hits.push(`${f}: ${g.무엇} (${m[0]})`);
    }
  }
  assert.deepStrictEqual(hits, [],
    '접속정보가 저장소에 있다 — public 이므로 그대로 공개다 (§2 · D-10):\n  ' + hits.join('\n  '));
  // ★ 못 읽은 것을 「깨끗하다」로 세지 않는다. 못 읽는 파일이 늘면 검사가 조용히 좁아진다
  assert.equal(못읽음, 0, `${못읽음}개를 못 읽었다 — 그만큼 안 본 것이다`);
  assert.ok(tracked.length > 100, `추적 파일이 ${tracked.length}개뿐이다 — 목록을 잘못 받았다`);
});

/**
 * ★★ **키를 코드가 알고 있어도, 넣는 사람은 `.env.example` 만 본다.**
 *
 * 저장소 연결 4종의 키 이름은 `connectors/storage.js` 에 있었고 `SECRET_ENV`
 * 에도 있었는데 **`.env.example` 에만 없었다**(2026-08-20 발견). 그러면 NAS 에
 * `.env` 를 채우는 사람은 그 키가 있다는 것 자체를 모르고, 연결 갈래는
 * 「아직 열려 있지 않습니다」로 조용히 남는다 — 아무 오류도 안 난다.
 *
 * ★ 위의 검사는 **한 방향만** 봤다(`.env.example` → `SECRET_ENV`). 반대 방향이
 *   비어 있어서 이 구멍이 오래 남았다. 검사는 양쪽을 다 봐야 양쪽이 지켜진다.
 */
test('★★ 제공자 키가 전부 .env.example 에 있다 (넣는 사람은 이것만 본다)', () => {
  const storage = require('../connectors/storage');
  const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const missing = storage.PROVIDER_IDS
    .map(id => storage.PROVIDERS[id].tokenEnv)
    .filter(k => k && !new RegExp('^' + k + '=', 'm').test(env));
  assert.deepStrictEqual(missing, [],
    `.env.example 에 없다: ${missing.join(', ')} — 넣어야 하는 줄 모른다`);
});

/** ★ 콘솔 설정을 사람이 베껴 적지 않는다 — SCOPES 가 단일 출처다 */
test('★ .env.example 의 콘솔 안내가 SCOPES 와 같다', () => {
  const storage = require('../connectors/storage');
  const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  storage.PROVIDER_IDS.forEach((id) => {
    const sc = storage.SCOPES[id];
    sc.allow.forEach((a) => {
      assert.ok(env.includes(a), `${id}: 허용 범위 '${a}' 가 .env.example 에 없다`);
    });
    sc.deny.forEach((d) => {
      assert.ok(env.includes(d), `${id}: 금지 범위 '${d}' 가 .env.example 에 없다 — 넓게 잡고도 모른다`);
    });
  });
});

/**
 * ★★ 콘솔 등록 안내가 **코드의 범위와 갈리지 않게** 한다.
 *
 * 사람이 콘솔에서 고르는 값이다. 문서가 옛 범위를 적고 있으면 그대로 넓게
 * 잡히고, **Dropbox 는 되돌릴 수 없다.** 그래서 안내에 적힌 범위가 `SCOPES` 와
 * 같은지, 금지 범위를 빠뜨리지 않았는지 대조한다.
 */
test('★★ 콘솔 등록 안내의 범위가 코드와 같다 (넓게 잡히면 되돌릴 수 없다)', () => {
  const storage = require('../connectors/storage');
  const doc = fs.readFileSync(path.join(ROOT, 'docs', '저장소-연결-등록.md'), 'utf8');

  storage.PROVIDER_IDS.forEach((id) => {
    const p = storage.PROVIDERS[id];
    const sc = storage.SCOPES[id];
    assert.ok(doc.includes(p.tokenEnv), `등록 안내에 ${p.tokenEnv} 가 없다`);
    sc.allow.forEach(a => assert.ok(doc.includes(a), `${id}: 허용 범위 '${a}' 가 안내에 없다`));
    sc.deny.forEach(d => assert.ok(doc.includes(d),
      `${id}: 금지 범위 '${d}' 가 안내에 없다 — 넓게 잡고도 모른다`));
  });

  // ★ secret 을 넣으라고 적으면 이 설계에서 벗어난다
  assert.match(doc, /client secret 은 넣지 않는다/, 'secret 을 넣지 않는다는 말이 없다');
});
