'use strict';
/**
 * preview.test.js — 보고서 생성 미리보기의 **구조**를 고정한다.
 *
 * 미리보기는 CLAUDE.md §8 의 산출물이다. 화면을 고쳤는데 미리보기가 옛 구조를
 * 보여주면, 그걸 보고 판단하는 사람이 틀린 것을 근거로 판단한다.
 *
 * 여기서 검사하는 것은 **보이는 그림이 아니라 약속**이다:
 *   ① 단계가 4개이고 순서·이름이 파이프라인과 같은가
 *   ② 높이를 빌드 시점에 박아 두지 않았는가 (내용이 바뀌면 틀린 값이 된다)
 *   ③ 4단계의 '확정됨' 상태를 플래그로 세우지 않고 실제 버튼으로 만드는가
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { build, SCREENS, EXTRAS } = require('../ui/platform/build-preview.js');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');

test('단계는 4개이고 순서·이름이 고정되어 있다', () => {
  assert.deepStrictEqual(
    SCREENS.map(s => `${s.no}. ${s.name}`),
    ['1. 보고서 생성 입력', '2. 가이드 필드 (자동입력 + 직접입력)', '3. 출력조건', '4. 생성']);

  // 번호는 1..4 로 이어져야 한다 — 건너뛰면 흐름이 아니라 목록이 된다
  SCREENS.forEach((s, i) => assert.strictEqual(s.no, i + 1));
});

/**
 * ★ 화면(reports.html)이 자기 단계 이름을 바꾸면 미리보기도 따라와야 한다.
 *   둘이 갈리면 "3단계가 뭐였더라" 를 두 곳에서 다르게 답한다.
 */
test('단계 이름이 실제 화면의 단계 표시와 같다', () => {
  const html = fs.readFileSync(path.join(PLATFORM, 'reports.html'), 'utf8');
  const m = html.match(/\[('[^']*',\s*)+'[^']*'\]\.forEach\(function \(label, i\)/);
  assert.ok(m, 'reports.html 의 단계 배열을 찾지 못했다 — 미리보기 대조가 불가능해졌다');
  const labels = [...m[0].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.strictEqual(labels.length, 4);

  // 1·2 는 미리보기에서 별도 화면이라 이름이 다르다 (대상 선택 vs 접수).
  // 3·4 는 같은 화면의 두 상태이므로 **이름이 같아야 한다**
  assert.strictEqual(SCREENS[2].name, labels[2], '3단계 이름이 화면과 다르다');
  assert.strictEqual(SCREENS[3].name, labels[3], '4단계 이름이 화면과 다르다');
});

test('3·4 단계는 같은 파일의 서로 다른 상태다', () => {
  assert.strictEqual(SCREENS[2].file, SCREENS[3].file);
  assert.strictEqual(SCREENS[2].after, undefined, '3단계는 확정 전이어야 한다');
  assert.strictEqual(SCREENS[3].after, 'CONFIRM_SPEC', '4단계는 확정을 실제로 눌러야 한다');
});

test('흐름 밖 화면을 4단계 안에 끼우지 않는다', () => {
  // 지금은 비어 있다 (작업지시판을 2026-08-15 저장소에서 제거했다).
  // 나중에 다시 생기더라도 단계 목록과 섞이면 안 된다 — 4단계가 5단계처럼 보인다
  const files = SCREENS.map(s => s.file);
  EXTRAS.forEach((x) => {
    assert.ok(!files.includes(x.file), `${x.file} 이 단계 목록에도 들어 있다`);
  });
});

test('★ 고정형 — 높이를 빌드 시점에 박아 두지 않는다', async () => {
  const html = await build();

  // 문서가 자기 높이를 알리고, 부모가 그만큼 늘린다
  assert.match(html, /linkpilotPreviewHeight/, '자동 높이 장치가 없다');
  assert.match(html, /iframe\[name="/, '부모가 iframe 을 name 으로 찾아야 한다');
  assert.match(html, /scrolling="no"/, '안쪽 스크롤을 끄지 않았다');

  // 픽셀을 박아 두면 내용이 바뀐 날부터 틀린 값이 된다.
  // ★ `<iframe[^>]*` 로 못 찾는다 — srcdoc 안에 `>` 가 잔뜩 들어 있어 속성 구간을
  //   가로지르지 못한다 (실제로 이 검사를 그렇게 썼다가 안 물었다).
  //   srcdoc 을 닫는 따옴표 뒤 꼬리만 본다.
  const tails = [...html.matchAll(/srcdoc="[\s\S]*?"([^>]*)>/g)].map(m => m[1].trim());
  assert.ok(tails.length >= SCREENS.length, 'iframe 을 찾지 못했다 — 검사가 헛돈다');
  tails.forEach((tail) => {
    assert.strictEqual(tail, 'scrolling="no"',
      `iframe 속성에 예상 밖의 것이 붙었다: '${tail}' — 높이를 박으면 내용이 바뀐 날부터 틀린다`);
  });
});

/**
 * ★ id 를 iframe 과 <section> 이 나눠 쓰면 안 된다.
 *   실제로 그렇게 만들었다가 부모가 section 을 집어 높이가 안 붙었다 —
 *   화면은 멀쩡해 보이는데 안쪽에 스크롤만 남는, 눈으로만 잡히는 종류의 버그다.
 */
test('부모는 iframe 을 id 가 아니라 name 으로 찾는다', async () => {
  const html = await build();
  assert.ok(!/getElementById\(d\.frame\)/.test(html),
    'id 로 찾으면 앵커용 section 을 집는다');
});

test('4단계는 상태를 억지로 세우지 않고 실제 버튼을 누른다', async () => {
  const html = await build();
  assert.match(html, /이 사양으로 확정/, '확정 버튼을 찾아 누르는 코드가 있어야 한다');
  // locked 를 밖에서 true 로 세우는 코드가 있으면 그건 그림이지 미리보기가 아니다
  assert.ok(!/locked['"]?\s*[:=]\s*true/.test(html.replace(/state\.locked = true;/g, '')),
    '확정 상태를 플래그로 세우고 있다 — 눌리지 않은 것을 눌린 것처럼 보이면 안 된다');
});

test('빌드는 파일을 쓰지 않는다 (require 만으로 저장소가 바뀌면 안 된다)', async () => {
  const before = fs.readdirSync(PLATFORM).sort();
  await build();
  assert.deepStrictEqual(fs.readdirSync(PLATFORM).sort(), before);
});
