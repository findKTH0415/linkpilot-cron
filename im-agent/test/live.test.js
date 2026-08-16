'use strict';
/**
 * live.test.js — 생성이 도는 동안 화면이 무엇을 말하는가.
 *
 * 이 화면의 실패는 조용하다. 진행이 멈췄는데 「진행 중」으로 굳어 있거나,
 * 시작도 안 했는데 0% 막대가 떠 있으면 사용자는 **기다리지 않아도 될 때 기다리고
 * 기다려야 할 때 포기한다.** 그래서 상태 판정을 테스트로 고정한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const L = require('../ui/platform/live-core.js');
const registry = require('../core/registry');
const monitor = require('../core/monitor');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');

/* ───────────── 카테고리 ───────────── */

test('★ 카테고리가 Agent 를 하나도 빠뜨리지 않는다', () => {
  const inPhases = L.PHASES.flatMap(p => p.agents);
  const known = registry.list().map(a => a.id);

  known.forEach((id) => {
    assert.ok(inPhases.includes(id),
      `${id} 가 어느 카테고리에도 없다 — 그 Agent 가 도는 동안 화면이 아무 말도 안 한다`);
  });
  inPhases.forEach((id) => {
    assert.ok(known.includes(id), `${id} 는 registry 에 없는 Agent 다`);
  });
  assert.strictEqual(inPhases.length, new Set(inPhases).size, '같은 Agent 가 두 카테고리에 있다');
});

/**
 * ★ 카테고리 순서가 실행 순서와 같아야 한다. 뒤 단계가 먼저 완료로 보이면
 *   화면이 거짓말한다 — 「문서 만들기」가 끝났는데 「계산」이 진행 중이면
 *   사용자는 무엇을 믿어야 할지 모른다.
 */
test('★ 카테고리 순서가 실제 실행 순서와 같다', () => {
  const order = {};
  registry.list().forEach((a) => { order[a.id] = a.order; });

  let last = -1;
  L.PHASES.forEach((p) => {
    p.agents.forEach((id) => {
      assert.ok(order[id] > last,
        `${p.label} 의 ${id}(order ${order[id]}) 가 앞 카테고리보다 먼저 돈다`);
      last = order[id];
    });
  });
});

test('Agent 상태 이름이 monitor 와 같은 집합이다', () => {
  Object.keys(monitor.STATUS).forEach((k) => {
    assert.ok(L.AGENT_STATE[k], `${k} 를 화면이 모른다 — 모르는 상태는 '대기'로 보인다`);
  });
});

/* ───────────── 시작 전 ───────────── */

/**
 * ★ 0% 막대는 **'멈춰 있다'로 읽힌다.** 큐에서 기다리는 중에는 진행률이 없는
 *   것이 사실이므로, 없는 것을 0 으로 만들어 그리지 않는다.
 */
test('★ 시작 전에는 진행률 막대를 그리지 않는다', () => {
  const v = L.viewFrom({ run: { status: 'queued', position: 3 } });
  assert.strictEqual(v.state, 'queued');
  assert.strictEqual(v.pct, null, '0 이 아니라 null 이어야 한다');
  assert.match(v.headline, /기다리는/);
  assert.match(v.note, /앞에 2건/, '몇 번째인지 말해야 기다릴지 말지 정한다');
});

test('실행 기록이 없는 것을 오류로 만들지 않는다', () => {
  const v = L.viewFrom({ run: null });
  assert.strictEqual(v.state, 'queued');
  assert.ok(!/실패|오류/.test(v.headline));
});

/* ───────────── 도는 중 ───────────── */

const SNAP = {
  overall: 42,
  currentAgent: '07_geo',
  timing: { elapsedMs: 65000, estimatedRemainingMs: 90000 },
  agents: [
    { id: '10_output_spec', status: 'COMPLETED' },
    { id: '01_project', status: 'COMPLETED' },
    { id: '02_extraction', status: 'WARNING' },
    { id: '07_geo', status: 'RUNNING' },
  ],
  activity: [{ at: '2026-08-16T15:00:01+09:00', agent: '07_geo', message: '지적도 조회', level: 'INFO' }],
};

test('지금 무엇을 하고 있는지 한 줄로 말한다', () => {
  const v = L.viewFrom({ snapshot: SNAP });
  assert.strictEqual(v.state, 'running');
  assert.match(v.headline, /공부·시장 조회/, 'Agent 이름이 아니라 하는 일을 말해야 한다');
  assert.ok(!/07_geo/.test(v.headline), '내부 id 를 사용자에게 보이면 안 된다');
  assert.strictEqual(v.pct, 42, '진행률은 monitor 가 준 값을 그대로 쓴다');
  assert.strictEqual(v.elapsed, '1분 5초');
});

/**
 * ★ 한 카테고리 안에 경고가 하나라도 있으면 그 카테고리는 경고다.
 *   좋은 쪽으로 뭉개면 「완료」로 보이고, 사람은 그 안의 경고를 영영 못 본다.
 */
test('★ 카테고리 상태는 가장 나쁜 것을 따른다', () => {
  const v = L.viewFrom({ snapshot: SNAP });
  const read = v.phases.find(p => p.id === 'read');
  assert.strictEqual(read.tone, 'warn', '경고가 있는데 완료로 보인다');

  const bad = L.viewFrom({
    snapshot: { ...SNAP, agents: [...SNAP.agents, { id: '05_validation', status: 'ERROR' }] },
  });
  assert.strictEqual(bad.state, 'failed', '실패한 Agent 가 있는데 진행 중으로 보인다');
  assert.match(bad.headline, /문제/);
});

test('끝나면 끝났다고 한다', () => {
  const v = L.viewFrom({
    snapshot: { ...SNAP, overall: 100, timing: { elapsedMs: 120000, finishedAt: '2026-08-16 15:02:00' } },
  });
  assert.strictEqual(v.state, 'done');
  assert.ok(L.isFinal(v.state));
  assert.strictEqual(L.nextPollMs(v, 0), 0, '끝났는데 계속 물어보면 서버만 두드린다');
});

/* ───────────── 확인이 안 될 때 ───────────── */

/**
 * ★ 폴링이 실패해도 **화면이 마지막 상태로 굳으면 안 된다.** 사용자는 생성이
 *   멈춘 줄 알고 다시 누르거나 포기한다. 사유를 적고, 멈춘 것이 아니라
 *   확인이 안 되는 것임을 말한다.
 */
test('★ 확인이 안 되면 「진행 중」으로 두지 않는다', () => {
  const v = L.viewFrom({ failures: 3, error: 'HTTP 500' });
  assert.strictEqual(v.state, 'unknown');
  assert.match(v.headline, /확인할 수 없/);
  assert.match(v.note, /HTTP 500/, '왜 못 봤는지 적어야 한다');
  assert.match(v.note, /멈췄다는 뜻은 아닙니다/, '생성이 죽은 것으로 오해하면 다시 누른다');
});

test('실패가 이어지면 간격을 늘린다 — 다만 멈추지는 않는다', () => {
  const running = L.viewFrom({ snapshot: SNAP });
  assert.strictEqual(L.nextPollMs(running, 0), 2000);
  assert.ok(L.nextPollMs(running, 3) > L.nextPollMs(running, 1), '죽은 서버를 같은 속도로 두드린다');
  assert.ok(L.nextPollMs(running, 20) <= 30000, '간격이 무한정 늘면 회복해도 안 돌아온다');
});

/* ───────────── 화면 연결 ───────────── */

/** 주석은 뺀다 — 왜 그렇게 했는지 **설명하는 문장**까지 잡으면 설명을 지우게 된다 */
function code(file) {
  return fs.readFileSync(path.join(PLATFORM, file), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('★ 생성 클릭 뒤 그 자리에서 보여준다', () => {
  const html = fs.readFileSync(path.join(PLATFORM, 'reports.html'), 'utf8');
  assert.match(html, /live-core\.js/, '판정 로직을 화면이 다시 짜면 안 된다');
  assert.match(html, /state\.live = \{/, '생성 클릭이 진행 패널을 켜야 한다');
  assert.match(html, /control-tower/, '진행은 서버 스냅샷에서 온다');
  assert.ok(!/IM 제작현황 화면에서 확인/.test(code('reports.html')),
    '다른 화면으로 보내면 사람은 안 본다 — 안 보는 동안 RED FLAG 가 떠도 모른다');
});

test('★ 화면이 카테고리 이름을 복사해 두지 않는다', () => {
  const html = code('reports.html');
  ['공부·시장 조회', '최종 검증', '값 검증'].forEach((label) => {
    assert.ok(!html.includes(label),
      `reports.html 에 '${label}' 이 박혀 있다 — live-core 가 단일 출처다`);
  });
});

/**
 * ★ 실제로 겪은 결함 둘 — 화면은 멀쩡해 보이고 산출물만 엉뚱해진다.
 *
 *   ① `reports.html` 이 `window.LINKPILOT_REPORTS` 를 **덮어썼다.** 앱이 설정을
 *      채워 놓아도 조용히 데모값으로 되돌아가 api 가 null 이 되고,
 *      "본체 API 에 연결하세요" 만 뜬다 — 붙였는데 안 붙은 것처럼 보인다.
 *   ② 4단계가 흐름이 잡은 프로젝트를 **안 봤다.** `C.projects[0]` 만 읽어서,
 *      2단계에서 값을 넣은 프로젝트와 4단계에서 생성하는 프로젝트가 달라진다.
 */
test('★ 앱이 준 설정이 기본값을 이긴다', () => {
  const html = fs.readFileSync(path.join(PLATFORM, 'reports.html'), 'utf8');
  assert.match(html, /Object\.assign\(\{/, '설정을 덮어쓰면 앱이 채운 값이 사라진다');
  assert.match(html, /\}, window\.LINKPILOT_REPORTS \|\| \{\}\);/,
    '앱이 준 값이 마지막에 얹혀야 이긴다');
});

test('★ 4단계가 흐름이 잡은 프로젝트를 본다', () => {
  const html = fs.readFileSync(path.join(PLATFORM, 'reports.html'), 'utf8');
  assert.match(html, /function pickProject/);
  // 순서: ?project= → C.projectId → 데모 목록
  const fn = html.slice(html.indexOf('function pickProject'), html.indexOf('var state = {'));
  const q = fn.indexOf("get('project')");
  const cfg = fn.indexOf('C.projectId');
  const demo = fn.indexOf('C.projects[0]');
  assert.ok(q !== -1 && cfg !== -1 && demo !== -1, '세 경로가 다 있어야 한다');
  assert.ok(q < cfg && cfg < demo,
    '흐름이 넘긴 값을 먼저 봐야 한다 — 데모 목록이 이기면 다른 프로젝트를 생성한다');

  const flow = fs.readFileSync(path.join(PLATFORM, 'flow-core.js'), 'utf8');
  assert.match(flow, /\?project=/, '흐름이 넘기는 이름이 바뀌면 여기서 걸린다');
});

/* ───────────── 세부 진행률 (입력 → 가이드 필드 → 사양 → 생성) ───────────── */

const FC = require('../ui/platform/fields-core.js');
const dictionary = require('../core/dictionary');

/** 필수 항목이 실제로 있는 사전. 손으로 만든 가짜를 쓰면 규칙이 바뀌어도 안 걸린다 */
function realFields() {
  const out = {};
  Object.keys(dictionary.FIELDS).forEach((k) => { out[k] = dictionary.FIELDS[k]; });
  return out;
}

test('★ 네 단계를 하나의 % 로 뭉치지 않는다', () => {
  const steps = L.stepProgress({ project: 'P1' });
  assert.strictEqual(steps.length, 4);
  assert.deepStrictEqual(steps.map(s => s.n), [1, 2, 3, 4]);
  assert.deepStrictEqual(steps.map(s => s.id), L.STEPS.map(s => s.id));

  // 합계를 만들어 두면 화면이 그걸 그린다. 애초에 만들지 않는다
  steps.forEach((s) => {
    assert.ok(!('overall' in s) && !('total' in s),
      '단계마다 성격이 달라 합계는 뜻이 없다 — 만들면 화면이 그린다');
  });
});

/**
 * ★ 「모른다」와 「0 이다」를 구분한다.
 *   못 물어본 것을 0% 로 그리면 사용자는 자기가 안 한 줄 알고 이미 넣은 값을 다시 찾는다.
 */
test('★ 못 물어본 단계는 0% 가 아니라 null 이다', () => {
  const steps = L.stepProgress({ project: 'P1' });   // fields/values/spec/snapshot 없음
  const by = {};
  steps.forEach((s) => { by[s.id] = s; });

  assert.strictEqual(by.fields.pct, null, '필드를 못 받았는데 0% 로 그리면 안 된다');
  assert.strictEqual(by.spec.pct, null);
  assert.strictEqual(by.make.pct, null);
  assert.strictEqual(by.intake.pct, 100, '프로젝트는 있다 — 이건 아는 것이다');
});

test('★ 2단계는 fields-core 의 셈을 그대로 쓴다 (두 벌로 세지 않는다)', () => {
  const fields = realFields();
  const values = {};
  const mine = FC.completeness(fields, values, 'im');
  const step = L.stepProgress({
    project: 'P1', fields: fields, values: values, docType: 'im', complete: FC.completeness,
  }).filter(s => s.id === 'fields')[0];

  assert.strictEqual(step.pct, mine.percent);
  assert.strictEqual(step.parts[0].n + step.parts[1].n, mine.total,
    '채움 + 남음 이 필수 개수와 다르면 어느 쪽이 맞는지 알 수 없다');
  assert.match(step.detail, /값과 출처가 모두 있어야/,
    '값만 있고 출처가 없는 것을 채운 것으로 세면 다 됐다고 착각한다');
});

test('★ 3단계는 확정 전과 확정 후가 다르다', () => {
  const pick = (spec) => L.stepProgress({ project: 'P1', spec: spec }).filter(s => s.id === 'spec')[0];
  assert.strictEqual(pick({ locked: false }).state, 'doing');
  assert.strictEqual(pick({ locked: false }).pct, 50);
  assert.strictEqual(pick({ locked: true }).state, 'done');
  assert.strictEqual(pick({ locked: true }).pct, 100);
  assert.match(pick({ locked: false }).detail, /확정해야/);
});

test('★ 4단계 진행률은 monitor 가 준 값을 그대로 쓴다', () => {
  const snap = { overall: 57, timing: {}, agents: [] };
  const step = L.stepProgress({ project: 'P1', snapshot: snap }).filter(s => s.id === 'make')[0];
  assert.strictEqual(step.pct, 57, '화면이 다시 세면 [IM 제작현황] 과 숫자가 갈린다');
  assert.strictEqual(step.state, 'doing');

  const done = L.stepProgress({
    project: 'P1', snapshot: { overall: 100, timing: { finishedAt: '2026-08-16T15:00:00+09:00' } },
  }).filter(s => s.id === 'make')[0];
  assert.strictEqual(done.state, 'done');
});

/**
 * ★ 계산 항목 0/19 를 실패로 칠하지 않는다.
 *   사람이 넣는 것이 아니라 **생성할 때 만들어지는 것**이라, 시작 전 0 개가 정상이다.
 *   빨갛게 칠하면 사용자는 자기가 빠뜨린 줄 알고 넣을 곳을 찾아 헤맨다 (넣을 곳이 없다).
 */
test('★ 계산 항목은 시작 전 0 개가 정상이라고 적는다', () => {
  const keys = dictionary.COMPUTED_KEYS;
  assert.ok(keys.length > 0, '계산 항목이 없으면 이 화면 자체가 뜻이 없다');

  const before = L.computedProgress(keys, {}, false);
  assert.strictEqual(before.made, 0);
  assert.strictEqual(before.total, keys.length);
  assert.strictEqual(before.started, false);
  assert.match(before.detail, /정상입니다/, '0 개를 잘못으로 읽히게 두지 않는다');

  const during = L.computedProgress(keys, { [keys[0]]: { value: 12.5 } }, true);
  assert.strictEqual(during.made, 1);
  assert.match(during.detail, /만들어졌습니다/);
});

test('★ 빈 값·null 을 만들어진 것으로 세지 않는다', () => {
  const keys = ['a', 'b', 'c'];
  const got = L.computedProgress(keys, { a: { value: null }, b: { value: '' }, c: { value: 0 } }, true);
  assert.strictEqual(got.made, 1, '0 은 값이다. null·빈칸은 값이 아니다');
  assert.deepStrictEqual(got.keys, ['c']);
});

/* ───────────── 화면이 판정을 베끼지 않는가 ───────────── */

/**
 * ★ 화면이 라벨·%를 자기 손으로 적기 시작하면 live-core 를 고쳐도 화면만 옛말을 한다.
 *   그래서 report-flow.html 은 **문구를 갖고 있지 않아야** 한다.
 */
test('★ 세부 진행률 화면이 단계 이름을 베껴 쓰지 않는다', () => {
  const raw = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  // 설명 주석은 검사에서 뺀다 — 왜 그런지 적어 둔 글이 규칙 위반으로 잡힌다
  const html = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

  assert.match(html, /LinkPilotLive/, 'live-core 를 안 쓰면 판정이 두 벌이 된다');
  assert.match(html, /L\.stepProgress\(/);
  assert.match(html, /L\.computedProgress\(/);
  assert.match(html, /complete: FC && FC\.completeness/,
    '2단계 셈을 주입하지 않으면 화면이 자기 식으로 센다');

  L.STEPS.forEach((s) => {
    assert.ok(html.indexOf("'" + s.label + "'") === -1,
      `화면이 「${s.label}」 을 직접 적고 있다 — live-core 를 고쳐도 화면만 옛말을 한다`);
  });
});

test('★ 모르는 값은 막대가 아니라 빗금이다', () => {
  const html = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  assert.match(html, /prog__bar--none/, '0% 막대를 그리면 「아무것도 안 됐다」로 읽힌다');
  assert.match(html, /pct === null \|\| pct === undefined/);
});

/**
 * ★ 진행률 갱신이 단계 화면(iframe)을 다시 싣지 않아야 한다.
 *   draw() 를 부르면 iframe 이 새로 실려 입력하던 것이 날아간다 — 2초마다 그러면
 *   값을 아예 못 넣는다.
 */
test('★ 진행률 갱신이 단계 화면을 다시 싣지 않는다', () => {
  const html = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  const fn = html.slice(html.indexOf('function renderProgress'), html.indexOf('외부 분석 경로 ('));
  assert.ok(fn.length > 100, 'renderProgress 를 찾지 못했다');
  assert.ok(fn.indexOf('draw()') === -1,
    '진행률을 갱신하면서 draw() 를 부르면 입력하던 값이 날아간다');
});

test('★ 404 를 오류로 세지 않는다 (아직 없는 것과 못 받은 것은 다르다)', () => {
  const html = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  assert.match(html, /r\.status === 404/, '사양 미확정·생성 전에는 404 가 정상이다');
});
