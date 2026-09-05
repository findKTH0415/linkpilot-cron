/**
 * **교차검증을 한 줄로 돈다** 〈2026-08-24 사장님: 「다시 재교차검증하고
 * 다시는 오류가 발생되지 않도록 기록하고 개선해줘」〉.
 *
 * ★★★ CLAUDE.md §8 이 넷을 요구하는데 **넷을 손으로 챙기고 있었다.**
 *   하루 반 동안 여섯 번 빠뜨렸다 — 미리보기 재생성 세 번, 지문 두 번,
 *   헤드리스 한 번. 「할 줄 몰라서」가 아니라 **「빠뜨려서」**다 (M-31).
 *
 * ★ 여기서 재는 것:
 *   ① 넷을 **전부** 도는가 (하나 빠지면 그게 다음에 빠질 자리다)
 *   ② **못 잰 것을 통과로 세지 않는가** (M-11 · M-12 · M-30)
 *   ③ 미리보기를 **git 으로 재지 않는가** — 아직 커밋 안 한 작업까지
 *     「갈렸다」로 잡으면 헛울음이 난다 (첫 판이 실제로 그랬다)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', 'guard.js'), 'utf8');
/** 주석은 떼고 본다 (CLAUDE.md §8) */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('★★★ 교차검증 넷을 전부 돈다', () => {
  ['function tests', 'function stamp', 'function previews', 'function render']
    .forEach((f) => assert.ok(CODE.indexOf(f) !== -1, `${f} 가 없다`));
  /* ★ 재려는 것은 **「부르는가」**다. 앞 판은 `tests(); stamp(); previews(); render();`
     라는 **글자 차례**를 통째로 못박아, 순서를 고치자 「안 부른다」며 빨개졌다 —
     코드는 넷을 다 부르고 있었다. 재려던 것이 아닌 것을 재면 고칠 때마다 헛울음이 난다.
     순서는 아래 전용 칸이 따로 잰다. 〈2026-09-01〉 */
  ['tests', 'stamp', 'previews', 'render'].forEach((f) => assert.ok(
    new RegExp('(^|[^\\w.])' + f + '\\(\\);').test(CODE),
    `${f}() 를 만들어 놓고 안 부른다 — 그게 다음에 빠질 자리다`));
});

/**
 * ★★★ **넷이 바닥이지 천장이 아니다** 〈2026-08-25〉. 같은 결로 두 번 당한
 *   것은 여기 한 칸으로 들어온다. 들어온 칸이 **불리지 않으면** 없는 것과
 *   같으므로 부르는 자리까지 함께 잰다.
 */
test('★★★ 늘어난 칸도 실제로 부른다', () => {
  ['function saveBar', 'function openFile', 'function agents', 'function branches', 'function imflow',
    'function pdfFresh', 'function viewport']
    .forEach((f) => assert.ok(CODE.indexOf(f) !== -1, `${f} 가 없다`));
  ['render', 'saveBar', 'openFile', 'agents', 'branches', 'imflow'].forEach((f) => assert.ok(
    new RegExp('(^|[^\\w.])' + f + '\\(\\);').test(CODE),
    `${f}() 를 만들어 놓고 안 부른다 — 그게 다음에 빠질 자리다`));
  assert.ok(/pdfFresh\(\);/.test(CODE),
    '대외 문서 PDF 칸을 만들어 놓고 안 부른다 (§6-2-1)');
  assert.ok(/viewport\(\);/.test(CODE),
    '화면 크기 칸을 만들어 놓고 안 부른다 (M-71 · M-72)');
  /* ★ 못 쟀을 때(되돌아오는 값 2)를 통과로 세면 안 된다.
   *   크로미움이 없는 자리 둘([저장]·[열기]) · 원격을 못 보는 자리 하나(갈래 겹침) ·
   *   보낸 기록이 아예 없는 자리 하나(보고서 화면 사본 · D-120) ·
   *   HTML·PDF 짝이 하나도 없는 자리 하나(대외 문서 PDF · §6-2-1 — 「정말 없는 것」과
   *   「훑는 곳이 틀린 것」이 구분되지 않으므로 통과로 세지 않는다) ·
   *   재려던 폭으로 못 잰 자리 하나(화면 크기 · 2026-09-01 — 헤드리스 창이 390px 로
   *   안 줄어들어 **폰을 잰 줄 알고 485px 를 재고도 초록이던** 자리다. 다른 폭을
   *   재고 통과로 끝내면 이 칸을 둔 뜻이 없어진다) */
  assert.strictEqual((CODE.match(/code === 2 \? 'unknown'/g) || []).length, 6,
    '못 잰 것을 통과로 세는 칸이 있다 — 못 잰 것은 통과가 아니다');
});

test('★★★ 못 잰 것을 통과로 세지 않는다', () => {
  assert.ok(CODE.indexOf("'unknown'") !== -1, '「못 쟀다」라는 상태 자체가 없다');
  assert.ok(CODE.indexOf('못 잰 것은 통과가 아니다') !== -1, '그 말을 화면에 안 적는다');
  /* ★ 못 잰 것이 있으면 **0 으로 끝나지 않는다** */
  assert.ok(/if \(unk\) \{[\s\S]*?return 2;/.test(CODE),
    '못 잰 것이 있는데 0 으로 끝난다 — 재지 못한 것이 통과로 읽힌다');
  assert.ok(/if \(bad\) \{[\s\S]*?return 1;/.test(CODE), '실패해도 0 으로 끝난다');
});

test('★★★ 크로미움이 없으면 **못 쟀다**로 적는다 (초록으로 안 끝난다)', () => {
  assert.ok(/if \(!b\) \{ add\('헤드리스 렌더', 'unknown'/.test(CODE),
    '브라우저가 없을 때 조용히 넘어간다 — 그 서버는 실제로 있다');
});

test('★★★ 미리보기를 **git 으로 재지 않는다** (헛울음이 난다)', () => {
  assert.ok(CODE.indexOf('git status') === -1,
    'git 으로 재면 아직 커밋 안 한 작업까지 「갈렸다」로 잡는다');
  assert.ok(/const changed = made\.filter/.test(CODE),
    '다시 만들기 전후를 안 댄다 — 재려는 것은 「다시 만들면 달라지는가」다');
});

test('★★ 헤드리스가 **빈 화면과 헛울음을 둘 다** 잡는다', () => {
  assert.ok(CODE.indexOf('거의 빈 화면') !== -1, '빈 화면을 안 잡는다');
  assert.ok(CODE.indexOf('멀쩡한 화면에 고장 딱지가 붙었다') !== -1,
    '헛울음을 안 잡는다 — 딱지가 헤프면 진짜 고장이 안 보인다');
});

test('★★★ `npm run guard` 로 부를 수 있다', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts.guard, 'node im-agent/tools/guard.js',
    '한 줄로 못 부르면 다시 손으로 챙기게 된다');
});

test('★★★ CLAUDE.md 가 그 한 줄을 가리킨다 (문서와 도구가 갈리면 안 된다)', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'CLAUDE.md'), 'utf8');
  assert.ok(doc.indexOf('`npm run guard` 한 줄로 돈다') !== -1,
    '§8 이 여전히 넷을 손으로 챙기라고 한다');
  assert.ok(doc.indexOf('dry_run=false') !== -1 || doc.indexOf('`dry_run=false`') !== -1,
    '배포를 걸 때 dry_run 을 꺼야 한다는 것이 안 적혀 있다 — 두 번 헛돌았다');
});

/**
 * ★★★ **미리보기를 먼저 다시 만들고 나서 시험을 돈다** 〈2026-09-01 · 오늘 두 번 헤맸다〉.
 *
 *   시험 하나가 **커밋된 미리보기를 디스크에서 읽어** 소스와 대조한다
 *   (`flow.test.js` 의 「커밋된 section-preview.html 이 소스와 같다」).
 *   미리보기가 갈려 있는데 시험이 먼저 돌면 —
 *     ① 「❌ 테스트 … 1 실패」  ② 「❌ 미리보기 재생성 … 갈려 있었다」
 *   **한 원인이 빨간 줄 둘**이 되고, ①이 코드 고장처럼 읽힌다. 오늘 그 ①을 좇아
 *   한 바퀴 돌았다. 순서를 바꾸면 시험이 **다시 만든 판**을 재므로 빨간 줄이 하나 남는다.
 *
 * ★ 순서를 **글자로만** 대조하면 주석에 적힌 이름에 걸려 헛통과한다(§8).
 *   그래서 주석을 떼고, **호출 줄 하나**에서 자리를 잰다.
 */
test('★★ guard 가 미리보기를 다시 만든 뒤에 시험을 돈다 (한 원인이 빨간 줄 둘이 되지 않게)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'guard.js'), 'utf8');
  /* 주석을 걷는다 — 이 저장소는 경위 주석이 길어 검사가 눈이 먼다 */
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{}(])\/\/[^\n]*/g, '$1 ');
  const line = bare.split('\n').find((l) => /previews\(\)/.test(l) && /tests\(\)/.test(l));
  assert.ok(line, 'previews() 와 tests() 를 함께 부르는 줄을 못 찾았다');
  assert.ok(line.indexOf('previews()') < line.indexOf('tests()'),
    '★ tests() 가 previews() 보다 먼저면, 미리보기가 갈렸을 때 「테스트 실패」가 먼저 떠서 '
    + '코드 고장처럼 읽힌다 — 한 원인을 두 이름으로 말하게 된다');
});

/**
 * ★ 순서를 바꿨다고 **갈린 사실을 덮으면 안 된다.** 다시 만들어 주고 조용히
 *   넘어가면 커밋 안 된 미리보기가 그대로 남아 CI 에서 터진다 — 자리만 옮긴 셈이다.
 */
test('★★ 미리보기가 갈리면 여전히 빨갛게 말한다 (고쳐 주고 넘어가지 않는다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'guard.js'), 'utf8');
  const i = src.indexOf('function previews()');
  const body = src.slice(i, src.indexOf('\n}', i));
  /* ★★ **「갈렸을 때」 갈래를 콕 집어 본다.** 앞 판은 previews() 본문 어딘가에
     'fail' 이 있으면 통과했다 — 그 갈래를 'ok' 로 바꿔 놓아도 초록이었다(훼손 실측).
     본문에는 「다시 만들다가 죽었다」·「안 만들어진 것이 있다」 갈래에도 'fail' 이 있어서다.
     재려는 것은 **그 갈래 하나**이므로 거기서부터 잘라 본다. 〈2026-09-01〉 */
  const j = body.indexOf('if (changed.length)');
  assert.ok(j > 0, '「다시 만드니 달라졌다」 갈래를 못 찾았다');
  const branch = body.slice(j, j + 400);
  assert.ok(/'fail'/.test(branch),
    '★ 다시 만들어 달라졌으면 **그 갈래가** fail 로 말해야 한다 — 고쳐 주고 넘어가면 '
    + '커밋 안 된 미리보기가 남아 CI 에서 터진다(자리만 옮긴 셈이다)');
  assert.ok(/커밋/.test(branch), '무엇을 하면 되는지(이대로 커밋)를 말해야 한다');
});
