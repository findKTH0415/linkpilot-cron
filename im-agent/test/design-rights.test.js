'use strict';
/**
 * design-rights.test.js — 문체 프로필과 권리 검사를 고정한다.
 *
 * ★★ **왜 이것들이 생겼나** 〈2026-08-26 · 디자인 지시서 §17 점검〉.
 *   지시서 §11 이 정한 것은 하나다 — 「디자인과 문체를 **분리하지 않고
 *   하나의 프로필로** 관리한다」. 그런데 이 저장소는 절반만 갖고 있었다:
 *   테마 13종이 색과 활자를 정하는데 **문장은 아무도 안 정했다**(문체 0종).
 *
 *   권리 검사는 아예 없었다 — `상표`·`저작권`·`라이선스` 를 코드에서 찾으면
 *   전부 0건이었다. 지시서 §14.5·§16 이 요구하는데 아무도 안 봤다.
 *
 * ★★ **첫 판이 막지 않는 것이 설계다.** 셋 다 YELLOW 다.
 *   오탐 하나에 문서가 아예 안 나가면 사람들은 검사를 꺼 버린다.
 *   **이 검사가 그 사실을 지킨다** — 누가 RED 로 올리면 여기서 빨개지고,
 *   그때는 오탐을 세어 본 뒤인지 스스로 묻게 된다.
 */

const test = require('node:test');
const assert = require('node:assert');

const themes = require('../design/themes');
const check = require('../design/check');

/* ───────────── 문체 프로필 ───────────── */

test('★ 지시서 §11.1 의 문체 9종이 전부 있다', () => {
  const want = ['official', 'executive', 'persuasive', 'technical',
    'research', 'legal_review', 'court', 'plain', 'brand'];
  assert.deepStrictEqual(Object.keys(themes.WRITING).sort(), want.slice().sort());
});

test('★★ 테마마다 문체가 정해져 있다 — 「한 프로필」이 이 검사의 뜻이다', () => {
  for (const [id, t] of Object.entries(themes.THEMES)) {
    if (id === 'custom') {
      assert.strictEqual(t.writing, null, 'custom 은 사람이 고른다 — 지어내지 않는다');
      continue;
    }
    assert.ok(t.writing, `${id} 에 문체가 없다 — 색은 정해지는데 문장은 안 정해진다`);
    assert.ok(themes.WRITING[t.writing], `${id} 의 문체 '${t.writing}' 가 목록에 없다`);
  }
});

test('★ 문체 값을 테마에 복붙하지 않는다 — 이름만 가리킨다', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'design', 'themes.js'), 'utf8');
  // 테마 블록에 '경영진 요약형' 같은 **문자열**이 직접 있으면 복붙이다
  const body = src.slice(src.indexOf('const THEMES'));
  for (const w of Object.values(themes.WRITING)) {
    assert.ok(!body.includes(`'${w.label}'`),
      `테마에 '${w.label}' 을 직접 적었다 — 글꼴에서 겪은 것과 같은 병이다(13군데 복붙)`);
  }
});

test('★ 쓰이지 않는 문체가 셋 있고, 그것이 정상이다 (D-129 결정)', () => {
  /* ★★ **2026-08-26 결정 — 테마 넷을 만들지 않는다** 〈사장님 「권고안대로 확정」〉.
   *
   *   연구기관·로펌·법원에 **실제로 낼 일이 있는지 모른다.** 쓰지 않을 테마를
   *   넷 만들면 고르는 화면만 길어지고, **긴 목록은 아무도 안 읽는다.**
   *   1인기업은 `minimal` + 쉬운 설명형으로 이미 부분적으로 덮인다.
   *
   * ★ **문체 셋은 지운 게 아니라 대기다.** 지우면 나중에 테마를 만들 때
   *   문체부터 다시 정해야 하고, 그때 앞 판과 다른 말투가 나온다.
   *
   * ★★★ **법원 제출형은 테마보다 금지가 먼저다** (지시서 §6.7) —
   *   「법원 문서·판결문·공식 명령서처럼 오인되는 디자인 금지」,
   *   「직인·관인·서명·사건번호를 생성하거나 위조하지 않는다」.
   *   만들기로 정하는 날, **그 금지를 규칙으로 세운 뒤에** 테마를 만든다.
   *   순서를 바꾸면 오인되는 문서가 먼저 나온다.
   *
   * ★ 이 검사가 셋을 못박는 이유 — 테마를 더하면 여기가 빨개져서
   *   **D-129 를 다시 열지 않고 지나칠 수 없다.** */
  const used = new Set(Object.values(themes.THEMES).map(t => t.writing).filter(Boolean));
  const unused = Object.keys(themes.WRITING).filter(k => !used.has(k));
  assert.deepStrictEqual(unused.sort(), ['court', 'legal_review', 'research'],
    '쓰이지 않는 문체가 달라졌다 — 테마를 더했으면 D-129 를 다시 열고, 법원형이면 §6.7 금지를 먼저 세워라');
});

/* ───────────── 권리·비밀 검사 ───────────── */

test('★★ 첫 판은 막지 않는다 — 셋 다 YELLOW', () => {
  for (const id of ['D12-secret-leak', 'D13-personal-info', 'D14-rights-unchecked']) {
    const rule = check.RULES.rules.find(r => r.id === id);
    assert.ok(rule, `${id} 규칙이 없다`);
    assert.strictEqual(rule.severity, 'YELLOW',
      `${id} 를 RED 로 올렸다 — 오탐을 세어 본 뒤인가? (D-118)`);
  }
});

test('★★ 열쇠는 **값**으로 찾는다 — 이름만 찾으면 안내문이 걸린다', () => {
  const env = { ECOS_API_KEY: 'abcd-1234-efgh-5678' };
  // 안내문에는 이름만 있다 → 걸리면 안 된다
  const guide = check.checkRights('ECOS_API_KEY 를 .env 에 넣으십시오', { env });
  assert.strictEqual(guide.violations.filter(v => v.rule === 'D12-secret-leak').length, 0,
    '안내문이 걸렸다 — 이름으로 찾고 있다');
  // 실제 값이 들어가면 걸려야 한다
  const leak = check.checkRights('key=abcd-1234-efgh-5678', { env });
  assert.strictEqual(leak.violations.filter(v => v.rule === 'D12-secret-leak').length, 1);
});

test('★★ 찾은 열쇠 값을 메시지에 넣지 않는다 (CLAUDE.md §2)', () => {
  const secret = 'abcd-1234-efgh-5678';
  const r = check.checkRights(`key=${secret}`, { env: { ECOS_API_KEY: secret } });
  for (const v of r.violations) {
    assert.ok(!v.message.includes(secret),
      '경고 메시지에 열쇠가 그대로 들어갔다 — 로그에 남는다');
  }
});

test('★ URL 로 인코딩된 값도 찾는다', () => {
  const secret = 'abcd 1234 efgh';
  const r = check.checkRights(`?key=${encodeURIComponent(secret)}`, { env: { LAW_OC: secret } });
  assert.strictEqual(r.violations.filter(v => v.rule === 'D12-secret-leak').length, 1);
});

test('★ 짧은 값은 건너뛴다 — 아무 데나 걸린다', () => {
  const r = check.checkRights('가나다라마바사', { env: { LAW_OC: '가나다' } });
  assert.strictEqual(r.violations.filter(v => v.rule === 'D12-secret-leak').length, 0);
});

test('★ 개인정보 꼴을 표시한다', () => {
  const r = check.checkRights('연락처 010-1234-5678 · 메일 hong@example.com', { env: {} });
  const kinds = r.violations.filter(v => v.rule === 'D13-personal-info').map(v => v.message);
  assert.strictEqual(kinds.length, 2, JSON.stringify(kinds));
});

test('★ 권리 확인이 필요한 자산을 표시한다 — 확정하지 않는다', () => {
  const r = check.checkRights('Pexels 에서 받은 사진 · 브랜드®', { env: {} });
  const hits = r.violations.filter(v => v.rule === 'D14-rights-unchecked');
  assert.strictEqual(hits.length, 2);
  for (const h of hits) {
    assert.ok(h.message.includes('사람이 확인'),
      '도구가 권리를 확정하는 것처럼 말하면 안 된다 (지시서 §10.5)');
  }
});

test('★ 깨끗한 문서는 조용하다 — 늑대야 하지 않는다', () => {
  const r = check.checkRights('연면적 52,822㎡ · 자료출처: 건축물대장(2026년)', { env: {} });
  assert.deepStrictEqual(r.violations, []);
  assert.strictEqual(r.ok, true);
});

/* ───────────── 출력 사양 ───────────── */

test('★★ PDF 는 실제로 나온다 — 선언이 그것과 같아야 한다', () => {
  // `core/pdf.js`(D-53)가 만들고 pipeline.js 가 부른다. 데모에 im-a4.pdf 가 있다.
  // 선언만 `supported: false` 로 남아 「되는 기능을 안 된다」고 말하고 있었다.
  const o = require('../core/outputspec');
  assert.strictEqual(o.SUPPORTED_FORMATS.pdf.supported, true,
    'PDF 가 실제로 나오는데 선언이 false 다 — 사용자는 되는 기능을 안 쓴다');
  const fs = require('fs');
  const path = require('path');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'core', 'pdf.js')),
    'core/pdf.js 가 없는데 supported: true 라면 반대로 거짓말이다');
});

test('★ 정말 안 되는 것은 그대로 false 다', () => {
  const o = require('../core/outputspec');
  for (const f of ['pptx', 'docx', 'hwp']) {
    assert.strictEqual(o.SUPPORTED_FORMATS[f].supported, false,
      `${f} 는 새 의존성이 필요하다 (CLAUDE.md §5) — 사장님 승인 전에는 false 다`);
  }
});
