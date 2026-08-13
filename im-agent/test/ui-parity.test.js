'use strict';
/**
 * React 판(ui/lib.js)과 순수 JS 판(ui/vanilla/control-tower.js)의 표시 로직이
 * 같은 결과를 내는지 검사한다.
 *
 * 왜 필요한가: 본체가 단일 HTML 파일이라 빌드 없이 돌아가는 두 번째 구현이 필요했고,
 * 번들러 없이 코드를 공유할 방법이 없어 로직이 두 벌이 되었다.
 * 두 화면이 같은 스냅샷을 다르게 해석하면 어느 쪽이 맞는지 알 수 없다 —
 * 특히 progressGapNotice 가 갈리면 한쪽 화면에서는 배포 경고가 사라진다.
 *
 * 이 테스트가 깨지면 둘 중 하나만 고친 것이다. 반드시 양쪽을 맞춘다.
 */
const test = require('node:test');
const assert = require('node:assert');

const vanilla = require('../ui/vanilla/control-tower.js');

let lib;
test.before(async () => {
  lib = await import('../ui/lib.js');
});

// 경계값을 노린 스냅샷들 — 격차 9/10, 검증 미실행, 빈 트랙, 승인 차단
const CASES = [
  {
    name: '정상 진행 (격차 없음)',
    snap: {
      project: { id: 'LP-DC-2026-001', name: '인천 데이터센터' },
      overall: 50,
      tracks: {
        production: { pct: 50, weight: 50, label: '제작' },
        validation: { pct: 50, weight: 25, label: '검증', score: 80, status: 'PASS', critical: 0, major: 1, minor: 2, gatesPassed: 8, gatesTotal: 8 },
        output: { pct: 50, weight: 15, label: '산출', specLocked: true, files: [{ path: 'a', label: 'A', exists: true }] },
        approval: { pct: 50, weight: 10, label: '승인', approved: false, reasons: [] },
      },
      agents: [
        { id: '01', label: 'Project', status: 'COMPLETED', elapsedMs: 1200 },
        { id: '02', label: 'Extraction', status: 'RUNNING', elapsedMs: 65000 },
      ],
      activity: [
        { at: '2026-08-13T06:00:01+09:00', agent: '01_project', message: '시작', level: 'INFO' },
        { at: '2026-08-13T06:00:09+09:00', agent: '05_validation', message: 'RED', level: 'ERROR' },
      ],
    },
  },
  {
    name: '★ 격차 경계 — 정확히 10%p (경고가 떠야 한다)',
    snap: {
      overall: 80,
      tracks: {
        production: { pct: 90, weight: 50, label: '제작' },
        validation: { pct: 70, weight: 25, label: '검증' },
        output: { pct: 80, weight: 15, label: '산출', files: [] },
        approval: { pct: 0, weight: 10, label: '승인', reasons: ['RED FLAG 2건'] },
      },
      agents: [],
      activity: [],
    },
  },
  {
    name: '격차 경계 — 9%p (경고가 뜨면 안 된다)',
    snap: {
      overall: 80,
      tracks: {
        production: { pct: 89, weight: 50, label: '제작' },
        validation: { pct: 70, weight: 25, label: '검증' },
        output: { pct: 80, weight: 15, label: '산출', files: [] },
        approval: { pct: 0, weight: 10, label: '승인', reasons: [] },
      },
      agents: [],
      activity: [],
    },
  },
  {
    name: '데모 실제값 — 제작 100 / 전체 80 / 승인 0 (배포 차단)',
    snap: {
      overall: 80,
      tracks: {
        production: { pct: 100, weight: 50, label: '제작' },
        validation: { pct: 70, weight: 25, label: '검증', score: 46, status: 'DISTRIBUTION BLOCKED', critical: 1, major: 3, minor: 0, gatesPassed: 5, gatesTotal: 8 },
        output: { pct: 80, weight: 15, label: '산출', specLocked: false, files: [{ path: 'im.md', label: 'IM', exists: true }, { path: 'im.pdf', label: 'PDF', exists: false }] },
        approval: { pct: 0, weight: 10, label: '승인', approved: false, reasons: ['RED FLAG 2건 미해소', '출력 사양 미확정'] },
      },
      agents: [
        { id: '05', label: 'Validation', status: 'WARNING', elapsedMs: 3000 },
        { id: '11', label: 'Final', status: 'BLOCKED', elapsedMs: 500 },
      ],
      activity: [{ at: '2026-08-13T06:01:00+09:00', agent: '04_financial', message: 'IRR', level: 'INFO' }],
    },
  },
  { name: '빈 스냅샷', snap: {} },
  { name: 'tracks 없음', snap: { overall: 0, agents: [], activity: [] } },
];

const PURE = ['trackList', 'progressGapNotice', 'agentSummary', 'riskSummary', 'outputSummary', 'userActions'];

for (const c of CASES) {
  test(`패리티: ${c.name}`, () => {
    for (const fn of PURE) {
      assert.deepStrictEqual(
        vanilla[fn](c.snap), lib[fn](c.snap),
        `${fn}() 결과가 React 판과 다르다 — 두 화면이 같은 데이터를 다르게 해석한다`,
      );
    }
    for (const id of ['ALL', 'ERROR', 'DATA', 'FINANCIAL', 'DOCUMENT', 'QA']) {
      assert.deepStrictEqual(
        vanilla.filterActivity(c.snap.activity, id), lib.filterActivity(c.snap.activity, id),
        `filterActivity(${id}) 결과가 다르다`,
      );
    }
  });
}

test('패리티: 포맷 함수', () => {
  for (const ms of [null, undefined, NaN, 0, 999, 1000, 65000, 3600000, -5]) {
    assert.strictEqual(vanilla.formatDuration(ms), lib.formatDuration(ms), `formatDuration(${ms})`);
  }
  for (const s of [null, '', '2026-08-13T06:01:02+09:00', 'garbage']) {
    assert.strictEqual(vanilla.clockOf(s), lib.clockOf(s), `clockOf(${s})`);
  }
  for (const p of [-10, 0, 42, 100, 150, null, 'x']) {
    assert.strictEqual(vanilla.barWidth(p), lib.barWidth(p), `barWidth(${p})`);
  }
});

test('패리티: 상수 테이블', () => {
  assert.deepStrictEqual(vanilla.TRACK_ORDER, lib.TRACK_ORDER);
  assert.deepStrictEqual(vanilla.AGENT_STATUS_ICON, lib.AGENT_STATUS_ICON);
  assert.deepStrictEqual(vanilla.AGENT_STATUS_TONE, lib.AGENT_STATUS_TONE);
  assert.deepStrictEqual(vanilla.HEALTH_TONE, lib.HEALTH_TONE);
  assert.deepStrictEqual(
    vanilla.ACTIVITY_FILTERS.map(f => f.id + ':' + f.label),
    lib.ACTIVITY_FILTERS.map(f => f.id + ':' + f.label),
  );
});

test('★ 격차 경고 문구가 두 판에서 글자까지 같다', () => {
  const snap = CASES[3].snap;
  const v = vanilla.progressGapNotice(snap);
  const l = lib.progressGapNotice(snap);
  assert.ok(v && l, '양쪽 다 경고가 떠야 한다');
  assert.strictEqual(v.message, l.message);
  assert.match(v.message, /아직 배포할 수 없다/);
});
