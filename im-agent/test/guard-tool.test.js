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
  assert.ok(/tests\(\); stamp\(\); previews\(\); render\(\);/.test(CODE),
    '만들어 놓고 안 부르는 것이 있다 — 그게 다음에 빠질 자리다');
});

/**
 * ★★★ **넷이 바닥이지 천장이 아니다** 〈2026-08-25〉. 같은 결로 두 번 당한
 *   것은 여기 한 칸으로 들어온다. 들어온 칸이 **불리지 않으면** 없는 것과
 *   같으므로 부르는 자리까지 함께 잰다.
 */
test('★★★ 늘어난 칸도 실제로 부른다', () => {
  assert.ok(CODE.indexOf('function saveBar') !== -1, '[저장] 막대 자리 검사가 없다');
  assert.ok(CODE.indexOf('function openFile') !== -1, '[열기] 읽히는가 검사가 없다');
  assert.ok(/render\(\); saveBar\(\); openFile\(\);/.test(CODE),
    '만들어 놓고 안 부른다 — 그게 다음에 빠질 자리다');
  /* ★ 못 쟀을 때(되돌아오는 값 2)를 통과로 세면 안 된다 */
  assert.strictEqual((CODE.match(/code === 2 \? 'unknown'/g) || []).length, 2,
    '크로미움이 없을 때 통과로 세는 칸이 있다 — 못 잰 것은 통과가 아니다');
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
