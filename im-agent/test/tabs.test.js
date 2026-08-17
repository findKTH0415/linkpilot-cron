'use strict';
/**
 * tabs.test.js — 세 탭 구성안 화면 (D-63).
 *
 * 구성안의 실패는 조용하다. 목록·단계·한도를 손으로 적어 두면 코드가 바뀐 날부터
 * **구성안만 옛말을 하고**, 그것을 보고 결정이 내려진다. 그래서 「실제 코드에서
 * 가져오는가」와 「커밋본이 재생성 결과와 같은가」를 고정한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const B = require('../ui/platform/build-tabs.js');
const { publishable } = require('../ui/platform/build-static.js');
const api = require('../ui/report-api.cjs');
const FLOW = require('../ui/platform/flow-core.js');
const ex = require('../agents/02-extraction');

const OUT = path.join(__dirname, '..', 'ui', 'platform', 'tabs-artifact.html');

test('구성안: 커밋된 파일이 재생성 결과와 같다', () => {
  assert.ok(fs.existsSync(OUT), 'tabs-artifact.html 이 없다 — npm run im:tabs');
  assert.equal(fs.readFileSync(OUT, 'utf8'), B.build(),
    '산출물이 소스와 갈렸다 — npm run im:tabs 로 다시 만든다');
});

test('구성안: 주소로 올릴 수 있는 조각이다', () => {
  // 못 올릴 조각을 올리면 옆 창이 **빈 채로** 열리고 원인이 화면에 안 뜬다
  assert.deepEqual(publishable(B.build()), []);
});

test('구성안: 탭이 셋이고 각각 지금 있는지를 말한다', () => {
  assert.deepEqual(B.TABS.map(t => t.id), ['done', 'make', 'files']);
  // ★ 「지금 있는가」를 안 적으면 셋 다 있는 것처럼 읽힌다
  B.TABS.forEach((t) => {
    assert.ok(['have', 'none', 'move'].includes(t.state), `${t.id}: state 가 없다`);
    assert.ok(t.stateText && t.stateText.length > 4, `${t.id}: stateText 가 없다`);
  });
  // 실제로 있는 화면은 「새 보고서 생성」 하나뿐이다 (실측)
  assert.equal(B.TABS.filter(t => t.state === 'have').length, 1);
});

test('구성안: 목록·단계·형식·한도를 손으로 적지 않는다', () => {
  const html = B.build();

  // 산출물 — report-api.cjs 의 OUTPUTS 가 단일 출처다
  api.OUTPUTS.forEach(o => assert.ok(html.includes(o.rel), `산출물 경로가 빠졌다: ${o.rel}`));
  assert.ok(html.includes(`<b>${api.OUTPUTS.length}종</b>`), '산출물 개수가 코드와 다르다');

  // 4단계 — flow-core.js 가 단일 출처다
  FLOW.STEPS.forEach(s => assert.ok(html.includes(s.name), `단계가 빠졌다: ${s.name}`));

  // 형식 — 02-extraction 이 단일 출처다
  ex.readGroups().forEach((g) => {
    assert.ok(html.includes(g.label), `형식 묶음이 빠졌다: ${g.label}`);
    g.ext.forEach(e => assert.ok(html.includes(`>${e}<`), `확장자가 빠졌다: ${e}`));
  });

  // 크기 한도 — api-router 의 상수와 같아야 한다
  assert.ok(html.includes(`<b>${Math.round(api.MAX_FILE_BYTES / (1024 * 1024))}MB</b>`));
  assert.ok(html.includes(`<b>${Math.round(api.MAX_REQUEST_BYTES / (1024 * 1024))}MB</b>`));
});

test('구성안: 배포판이 아니라는 것을 화면이 말한다', () => {
  const html = B.build();
  assert.match(html, /구성안입니다 — 배포판이 아닙니다/,
    '구성안을 완성품으로 오해하면 그것을 근거로 일정을 잡는다');
  assert.match(html, /예시 목록/, '실제 데이터가 아니라는 표시가 없다');
});

test('구성안: 아직 정해지지 않은 용량을 「미정」으로 드러낸다', () => {
  const html = B.build();
  // 빈칸으로 두면 「0」이나 「없음」으로 읽힌다
  assert.ok((html.match(/class="und"/g) || []).length >= 3, '세 등급의 미정 표시가 없다');
  assert.match(html, /추후 예정/, 'Biz 가 추후 예정이라는 것이 안 보인다');
});

test('구성안: 탭 순서가 두 가지라는 것을 함께 보여 준다', () => {
  const html = B.build();
  // 개정안 §3-2 는 시간 순서로 적혀 있다. 지금 지시와 다르므로 둘 다 놓고 고르게 한다
  assert.match(html, /지시하신 순서/);
  assert.match(html, /시간 순서/);
  assert.match(html, /개정안 §3-2 를 그 순서로 고칩니다/);
});

/* ───────────── 진행 막대 ───────────── */

test('진행 막대: 탭마다 하나씩, 맨 위에 있다', () => {
  const html = B.build();
  B.TABS.forEach((t) => {
    const body = html.slice(html.indexOf(`class="body body--${t.id}"`));
    const prog = body.indexOf('class="prog"');
    const lede = body.indexOf('class="body__lede"');
    assert.ok(prog > 0, `${t.id}: 진행 막대가 없다`);
    assert.ok(prog < lede, `${t.id}: 진행 막대가 본문보다 아래에 있다`);
  });
});

test('★ 진행 막대: % 만 띄우지 않는다 — 무엇의 몇 %인지 함께 적는다', () => {
  Object.keys(B.PROGRESS).forEach((id) => {
    const p = B.PROGRESS[id];
    assert.ok(p.counts && p.counts.length > 4, `${id}: 무엇을 세는지가 없다`);
    p.states.forEach((s) => {
      // 분자/분모를 숫자로 함께 띄운다. % 만 있으면 「무엇의 몇 %」가 사라지고
      // 그 상태로도 화면은 멀쩡해 보인다
      assert.ok(/\d/.test(s.count), `${id}/${s.id}: 개수 표기가 없다`);
      assert.ok(s.pct >= 0 && s.pct <= 100, `${id}/${s.id}: % 가 범위 밖이다`);
    });
  });
});

test('★ 진행 막대: 진행율마다 설명이 하나씩 있고, 한 번에 하나만 뜬다', () => {
  const html = B.build();
  Object.keys(B.PROGRESS).forEach((id) => {
    B.PROGRESS[id].states.forEach((s) => {
      assert.ok(s.say && s.say.length > 10, `${id}/${s.id}: 설명이 없다`);
      assert.ok(html.includes(`class="say say--${s.id}"`), `${id}/${s.id}: 설명 칸이 없다`);
      assert.ok(html.includes(`#p-${id}-${s.id}:checked ~ .says .say--${s.id} { display: block; }`),
        `${id}/${s.id}: 그 진행율에서 설명이 뜨지 않는다`);
    });
  });
  // 기본은 전부 숨김이다 — 규칙이 빠지면 셋이 한꺼번에 뜬다
  assert.ok(html.includes('.say { display: none;'), '설명이 기본으로 숨겨져 있지 않다');
});

test('★ 진행 막대: 0% 는 「아직」이지 실패가 아니다', () => {
  Object.keys(B.PROGRESS).forEach((id) => {
    const zero = B.PROGRESS[id].states.find(s => s.pct === 0);
    assert.ok(zero, `${id}: 시작 전 상태가 없다`);
    // 0% 를 빨갛게 칠하면 「잘못됐다」로 읽힌다. 회색으로 두고 무엇을 하면 되는지 적는다
    assert.ok(B.build().includes(`#p-${id}-${zero.id}:checked ~ .bar .bar__f { background: #D8DCE0; }`),
      `${id}: 0% 막대가 진행 색으로 칠해진다`);
  });
});

test('★ 진행 막대: 탭마다 세는 대상이 다르다 — 한 잣대로 뭉치지 않는다', () => {
  const what = Object.keys(B.PROGRESS).map(k => B.PROGRESS[k].counts);
  assert.equal(new Set(what).size, what.length, '두 탭이 같은 것을 센다고 적혀 있다');
  // 4단계는 순서라서 눈금을 둔다. 나머지는 묶음이라 눈금이 없다
  assert.equal(B.PROGRESS.make.ticks, 4);
  assert.ok(!B.PROGRESS.done.ticks && !B.PROGRESS.files.ticks);
});

test('★ 진행 막대: 합계 % 를 만들지 않는 이유를 화면이 말한다', () => {
  // 이미 내린 결정이다 — 1·2 는 사람이 채우고 4 만 기계가 도는 구간이라
  // 하나로 뭉치면 무엇의 몇 %인지 알 수 없다. 막대를 넣으면서 뒤집지 않았다
  assert.match(B.PROGRESS.make.note, /각 단계 화면이 따로/);
  assert.match(B.PROGRESS.make.note, /1·2 는 사람이 채우고/);
});

test('★ 진행 막대: 분모가 없는 것은 막대를 그리지 않는다', () => {
  // 등급별 상한이 미정이라 보관 용량은 분모가 없다.
  // 없는 채로 막대를 그리면 「거의 찼다」가 근거 없이 보인다
  assert.match(B.PROGRESS.files.note, /보관 용량 막대는 아직 만들지 않습니다/);
  assert.match(B.PROGRESS.files.counts, /읽을 수 있는/);
});

test('★ 진행 막대: 100% 가 「보내도 된다」로 읽히지 않게 한다', () => {
  const full = B.PROGRESS.done.states.find(s => s.pct === 100);
  assert.match(full.say, /배포 전 교차검증/);
});

test('구성안: 라디오가 탭 바 밖에 있어야 탭이 바뀐다', () => {
  const html = B.build();
  const radio = html.indexOf('id="tab-done"');
  const bar = html.indexOf('<div class="tabs">');
  assert.ok(radio > 0 && bar > 0 && radio < bar,
    '라디오가 .tabs 안에 있으면 ~ 로 닿지 못해 눌러도 안 바뀐다');
  assert.match(html, /#tab-files:checked ~ \.tabs label\[for="tab-files"\]/);
});
