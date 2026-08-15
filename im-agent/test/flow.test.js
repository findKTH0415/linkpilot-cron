'use strict';
/**
 * flow.test.js — 앱 [보고서 생성] 섹션(report-flow.html)과 4단계 단일 출처.
 *
 * 여기서 지키는 것:
 *   ① 단계 목록이 두 벌이 되지 않는가 (제품과 미리보기가 다른 흐름을 보이면 끝이다)
 *   ② 단계 화면을 복사하지 않았는가 (복사하면 출처 검사가 두 벌이 된다)
 *   ③ 잠긴 단계가 **이유를 말하는가** (이유 없는 회색은 고장으로 보인다)
 *   ④ 문서를 스크립트에 심을 때 화면이 통째로 비지 않는가 (실제로 그랬다)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const F = require('../ui/platform/flow-core.js');
const { buildSection, SCREENS } = require('../ui/platform/build-preview.js');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');

/* ───────────── 단일 출처 ───────────── */

test('★ 4단계 목록이 한 곳에만 있다', () => {
  assert.strictEqual(SCREENS, F.STEPS, '미리보기가 자기 목록을 따로 들고 있다');

  const flow = read('report-flow.html');
  assert.match(flow, /flow-core\.js/, '제품 화면도 같은 파일을 읽어야 한다');
  // 화면이 단계 이름을 직접 적어 두면 flow-core 를 고쳐도 화면은 안 바뀐다
  F.STEPS.forEach((s) => {
    assert.ok(!flow.includes("'" + s.name + "'"),
      `report-flow.html 에 '${s.name}' 이 하드코딩돼 있다 — 목록이 두 벌이 된다`);
  });
});

test('★ 단계 화면을 복사하지 않는다', () => {
  const flow = read('report-flow.html');
  // 실제 화면들의 표시는 그쪽 파일에만 있어야 한다
  ['이 사양으로 확정', '출처 없는 값은 저장', '지원하지 않는 형식'].forEach((needle) => {
    assert.ok(!flow.includes(needle),
      `'${needle}' 이 셸에 복사돼 있다 — 규칙이 두 벌이 되고 한쪽만 고치는 날 갈린다`);
  });
  assert.match(flow, /iframe/, '화면들을 그대로 끼워야 한다');
});

/* ───────────── 잠금과 이유 ───────────── */

test('★ 잠긴 단계는 이유를 말한다', () => {
  const noApi = F.stepState({ api: null, projectId: 'LP-DC-2026-001' });
  noApi.forEach(s => assert.strictEqual(s.why, F.WHY.api, `${s.no}단계에 사유가 없다`));

  const noProject = F.stepState({ api: '/api', projectId: null });
  assert.strictEqual(noProject[0].locked, false, '1단계는 프로젝트 없이도 열려야 한다');
  [1, 2, 3].forEach((i) => {
    assert.strictEqual(noProject[i].locked, true);
    assert.strictEqual(noProject[i].why, F.WHY.project);
  });

  const ok = F.stepState({ api: '/api', projectId: 'LP-DC-2026-001' });
  ok.forEach(s => assert.strictEqual(s.locked, false, `${s.no}단계가 이유 없이 잠겼다`));
});

test('★ 서버 미연결이 프로젝트 없음보다 먼저 나온다', () => {
  // 순서를 바꾸면 "프로젝트를 만드세요"만 뜨고 진짜 원인(미연결)이 가려진다.
  // 그 상태에서는 1단계를 눌러도 프로젝트가 안 만들어져 사용자가 갇힌다
  const s = F.stepState({ api: null, projectId: null });
  assert.strictEqual(s[1].why, F.WHY.api);
});

test('단계 주소에 프로젝트가 붙는다 (화면들이 ?project= 를 읽는다)', () => {
  const ctx = { base: '/im/', projectId: 'LP-DC-2026-001' };
  assert.strictEqual(F.urlFor(F.STEPS[0], ctx), '/im/intake.html', '1단계는 프로젝트가 없다');
  assert.strictEqual(F.urlFor(F.STEPS[1], ctx), '/im/fields.html?project=LP-DC-2026-001');
  assert.strictEqual(F.urlFor(F.STEPS[1], { projectId: null }), 'fields.html');
});

test('화면 파일에서 단계를 되찾는다 (화면이 스스로 넘어가도 레일이 따라간다)', () => {
  assert.strictEqual(F.stepOfFile('/im/fields.html?project=X').id, 'fields');
  assert.strictEqual(F.stepOfFile('intake.html').id, 'intake');
  assert.strictEqual(F.stepOfFile('membership.html'), null);
});

/* ───────────── 끼워 넣기 ───────────── */

test('★ 끼울 때 사이드바를 두 번 그리지 않는다', () => {
  ['.side', '.top'].forEach(sel => assert.ok(F.EMBED_CSS.includes(sel + '{display:none!important}'),
    `${sel} 을 감추지 않으면 앱 안에 사이드바가 두 벌 뜬다`));
  assert.match(F.EMBED_CSS, /overflow-y:hidden!important/, '안쪽 스크롤을 끄지 않으면 창 안을 또 끌게 된다');
  assert.ok(F.EMBED_CSS.includes('.steps{display:none!important}'),
    '셸이 레일을 그리는데 화면 안 단계 칩까지 두면 같은 표시가 두 번 뜬다');
  assert.match(F.EMBED_CSS, /height:auto!important/);
});

/* ───────────── 섹션 미리보기 (CLAUDE.md §8) ───────────── */

test('★ 문서를 심어도 화면이 통째로 비지 않는다', async () => {
  const html = await buildSection();
  const at = html.indexOf('window.LINKPILOT_PREVIEW_DOCS');
  assert.ok(at > 0, '단계 문서를 심는 블록이 없다');
  const end = html.indexOf('\n', html.indexOf('=', at));
  const line = html.slice(at, end);

  // ★ 이 셋 중 하나라도 날것으로 들어가면 브라우저가 스크립트 데이터 상태를
  //   바꿔 버려 블록 전체가 문법 오류가 된다. 오류는 콘솔에만 뜨고 화면은 빈다
  ['</script', '<script', '<!--'].forEach((needle) => {
    assert.ok(!line.includes(needle),
      `심는 문서에 '${needle}' 가 날것으로 들어갔다 — 화면이 통째로 빈다 (실제로 그랬다)`);
  });
  assert.match(line, /\\u003C/, '< 를 깨뜨리지 않았다');
});

test('★ 섹션 미리보기가 파일 하나로 열린다', async () => {
  const html = await buildSection();
  assert.ok(!/<script src=/.test(html), '외부 스크립트가 남으면 파일 하나로 안 열린다');
  assert.ok(!/<link[^>]+stylesheet/.test(html), '외부 스타일시트가 남았다');

  const open = (html.match(/<script\b/g) || []).length;
  const close = (html.match(/<\/script>/g) || []).length;
  assert.strictEqual(open, close, 'script 태그 짝이 안 맞는다 — 화면이 통째로 빈다');
});

test('미리보기임이 화면에 적혀 있다', async () => {
  const html = await buildSection();
  assert.match(html, /미리보기입니다/, '실물로 오해하면 이걸 근거로 판단한다');
  assert.match(html, /서버에 연결되어 있지 않습니다/);
  assert.match(html, /지어낸 것이 아닙니다/, '심은 값의 출처를 밝힌다');
});

test('★ 외부 분석 경로를 지우지 않았다', () => {
  const flow = read('report-flow.html');
  ['LinkPilot AGENT 저장소', '보고서 생성 AGENT 열기'].forEach((label) => {
    assert.ok(flow.includes(label), `${label} 이 사라졌다 — 지금 운영 중인 경로다`);
  });
  // 주소가 없을 때 눌리는 척하면 안 된다
  assert.match(flow, /b\.disabled = true/, '주소가 없으면 잠가야 한다');
});

test('미리보기에 내부 호스트가 들어가지 않는다', async () => {
  const html = await buildSection();
  assert.ok(!/\.ts\.net|synologynas|192\.168\./.test(html), '공개 저장소다');
});

test('★ 커밋된 section-preview.html 이 소스와 같다', async () => {
  const committed = read('section-preview.html');
  assert.strictEqual(await buildSection(), committed,
    '화면이나 단계가 바뀌었다 — `npm run im:section` 으로 다시 만들어라');
});

test('빌드는 파일을 쓰지 않는다', async () => {
  const before = fs.readdirSync(PLATFORM).sort();
  await buildSection();
  assert.deepStrictEqual(fs.readdirSync(PLATFORM).sort(), before);
});
