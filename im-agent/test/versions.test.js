'use strict';
/**
 * versions.test.js — 같은 문서의 **여러 판**을 가려낸다 (2026-08-21 · 클라우드 폴더 지시 §7).
 *
 * ★★ 이 검사가 지키는 것은 하나다: **화면이 대신 고르지 않는다.**
 *   틀린 판으로 보고서를 만들면 숫자도 출처도 멀쩡해 보인다 — 문서만 봐서는
 *   절대 안 잡힌다. 그래서 「가릴 수 없으면 가릴 수 없다고 말하는가」를 잰다.
 */
const test = require('node:test');
const assert = require('node:assert');
const V = require('../ui/platform/versions-core.js');

test('★★ 지시서 예시 다섯이 한 묶음으로 잡힌다', () => {
  const r = V.group([
    { name: 'IM_v1.pdf' }, { name: 'IM_v2.pdf' }, { name: 'IM_20260820.pdf' },
    { name: 'IM_Final.pdf' }, { name: 'IM_Final_20260820.pdf' },
    { name: '감정평가서.pdf' },          // 다른 문서 — 섞이면 안 된다
  ]);
  assert.strictEqual(r.conflicts, 1, '다섯이 한 묶음으로 안 잡혔다');
  assert.strictEqual(r.groups[0].items.length, 5);
  assert.ok(!r.groups[0].items.some(i => i.name === '감정평가서.pdf'),
    '다른 문서가 같은 묶음에 들어갔다');
});

test('★★ 「Final」이라는 이름이 판 번호를 이기지 않는다', () => {
  const r = V.group([{ name: '계약서_Final.pdf' }, { name: '계약서_v7.pdf' }]);
  const first = r.groups[0].items[0];
  assert.strictEqual(first.name, '계약서_v7.pdf',
    '이름이 「최종」이라고 주장하는 것이 판 번호를 앞질렀다');
  // ★★ 그리고 **가린 것이 아니라고** 말해야 한다 — 근거 종류가 다르다
  assert.strictEqual(r.groups[0].undecidable, true,
    '번호와 주장을 견줘 놓고 「가렸다」고 한다');
  assert.match(r.groups[0].why, /가릴 근거가 없습니다/);
});

test('★★ 근거 종류가 다르면 가리지 않는다 (번호 vs 날짜)', () => {
  // IM_v2 와 IM_20260820 중 무엇이 최신인지는 **알 방법이 없다**
  const r = V.group([{ name: 'IM_v2.pdf' }, { name: 'IM_20260820.pdf' }]);
  assert.strictEqual(r.groups[0].undecidable, true, '견줄 수 없는 둘을 가렸다고 한다');
});

test('★ 같은 근거끼리는 가린다 (번호 · 날짜 · 시각)', () => {
  const byNum = V.group([{ name: 'IM_v1.pdf' }, { name: 'IM_v3.pdf' }, { name: 'IM_v2.pdf' }]);
  assert.deepStrictEqual(byNum.groups[0].items.map(i => i.name),
    ['IM_v3.pdf', 'IM_v2.pdf', 'IM_v1.pdf']);
  assert.strictEqual(byNum.groups[0].undecidable, false, '가릴 수 있는데 못 가렸다고 한다');

  const byDate = V.group([{ name: 'IM_20260801.pdf' }, { name: 'IM_20260820.pdf' }]);
  assert.strictEqual(byDate.groups[0].items[0].name, 'IM_20260820.pdf');
  assert.strictEqual(byDate.groups[0].undecidable, false);

  // 이름에 아무 표시가 없으면 수정 시각으로 가린다
  const byTime = V.group([
    { name: '보고서.pdf', modifiedAt: '2026-08-01T10:00:00+09:00' },
    { name: '보고서.pdf', modifiedAt: '2026-08-20T10:00:00+09:00' },
  ]);
  assert.strictEqual(byTime.groups[0].items[0].modifiedAt.slice(0, 10), '2026-08-20');
  assert.strictEqual(byTime.groups[0].undecidable, false);
});

test('★ 한 벌뿐이면 묶음을 만들지 않는다 (헛울음 금지)', () => {
  assert.strictEqual(V.group([{ name: 'IM_v1.pdf' }, { name: 'Teaser_v1.pdf' }]).conflicts, 0);
  assert.strictEqual(V.group([{ name: 'IM.pdf' }]).conflicts, 0);
  assert.strictEqual(V.group([]).conflicts, 0);
  assert.strictEqual(V.group(null).conflicts, 0);
  // 확장자가 다르면 다른 문서다 (IM.pdf 와 IM.pptx 는 같은 것이 아니다)
  assert.strictEqual(V.group([{ name: 'IM_v1.pdf' }, { name: 'IM_v1.pptx' }]).conflicts, 0);
});

test('★ 밑줄이 붙어 있어도 판 번호를 읽는다 (한 번 이것 때문에 아무것도 안 잡혔다)', () => {
  // `_v` 는 자바스크립트가 낱말 경계로 보지 않는다 (`_` 도 낱말 문자다)
  assert.strictEqual(V.versionNumber('IM_v3.pdf'), 3);
  assert.strictEqual(V.versionNumber('IM-v3.pdf'), 3);
  assert.strictEqual(V.versionNumber('IM v3.pdf'), 3);
  assert.strictEqual(V.versionNumber('IM_ver12.pdf'), 12);
  assert.strictEqual(V.versionNumber('IM.pdf'), null, '없는 번호를 지어냈다');
  assert.strictEqual(V.stampedDate('IM_20260820.pdf'), '2026-08-20');
  assert.strictEqual(V.stampedDate('IM_2026-08-20.pdf'), '2026-08-20');
  // 8자리라고 다 날짜가 아니다
  assert.strictEqual(V.stampedDate('IM_99999999.pdf'), null);
  assert.strictEqual(V.stampedDate('전화_01012345678.pdf'), null);
});

test('★ 근거를 **말한다** — 순서만 주면 사람이 고를 수 없다', () => {
  const r = V.group([{ name: 'IM_v2.pdf' }, { name: 'IM_Final.pdf' }]);
  const bases = r.groups[0].items.map(i => i.basis);
  assert.ok(bases.some(b => /판 번호 v2/.test(b)));
  assert.ok(bases.some(b => /근거 아님/.test(b)), '주장을 근거처럼 적었다');
});

test('★★ 출처를 가리지 않는다 — 연결한 것과 1회성이 같은 묶음에 든다', () => {
  const r = V.group([
    { name: 'IM_v1.pdf', provider: 'dropbox' },
    { name: 'IM_v2.pdf', provider: 'linkpilot-app' },
  ]);
  assert.strictEqual(r.conflicts, 1,
    '저장소가 다르다고 다른 문서로 봤다 — 묶는 기준은 이름이지 저장소가 아니다');
});
