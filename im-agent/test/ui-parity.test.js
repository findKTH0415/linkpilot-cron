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

// ── 데이터 계보 모달 (B-11) ───────────────────────────────────────
//
// React 판에만 있고 순수 JS 판에는 없었다. 본체가 단일 HTML 이면 **숫자를 눌러
// 출처를 확인하는 경로가 통째로 막힌다** — 출처 없는 숫자를 막는 것이 이 시스템의
// 전부인데, 화면에서 출처를 볼 수 없으면 그 규칙이 사람에게는 보이지 않는다.

const fs = require('fs');
const path = require('path');

/** 최소 DOM. 실제 브라우저가 아니라도 '무엇을 그리는가'는 여기서 확인된다 */
function makeDom() {
  function textNode(v) { return { nodeType: 3, textContent: String(v), children: [], className: '' }; }
  function element(tag) {
    return {
      nodeType: 1, tagName: String(tag).toUpperCase(),
      className: '', id: '', style: {}, attrs: {}, listeners: {},
      children: [], _text: '',
      set textContent(v) { this._text = String(v); this.children = []; },
      get textContent() {
        return this._text + this.children.map(c => c.textContent).join('');
      },
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); },
      removeEventListener() {},
    };
  }
  return {
    createElement: element,
    createTextNode: textNode,
    addEventListener() {}, removeEventListener() {}, hidden: false,
  };
}

function walk(node, out) {
  out = out || [];
  if (!node) return out;
  out.push(node);
  (node.children || []).forEach(c => walk(c, out));
  return out;
}
function classes(node) {
  return walk(node).flatMap(n => String(n.className || '').split(/\s+/)).filter(Boolean);
}

function renderLineageWith(state) {
  const before = global.document;
  global.document = makeDom();
  try { return vanilla.renderLineage(state, () => {}); } finally {
    if (before === undefined) delete global.document; else global.document = before;
  }
}

const FOUND = {
  key: 'building.gfa_sqm',
  lineage: {
    found: true, key: 'building.gfa_sqm', label: '연면적', value: 12345, unit: '㎡',
    grade: 'A', verified: true, conflicted: true,
    chain: [
      { stage: '02_extraction', label: '사업계획서 p.12', detail: '표 3-1', value: 12345, adopted: true },
      { stage: '07_geo', label: '건축물대장', detail: null, value: 11980, adopted: false },
    ],
  },
  impact: {
    totalAffected: 3, requiresNewVersion: true,
    rerunOrder: ['04_financial', '05_validation', '06_writer'],
    affectedValues: [{ key: 'returns.irr', label: 'IRR' }],
    affectedDocuments: ['09_IM/im.md', '12_Final/im-a4.html'],
  },
  loading: false, error: null,
};

test('★ 계보 모달이 순수 JS 판에도 있다', () => {
  assert.strictEqual(typeof vanilla.renderLineage, 'function',
    '없으면 본체(단일 HTML)에서 숫자→출처 경로가 막힌다');
  assert.strictEqual(vanilla.renderLineage(null, () => {}), null);
  assert.strictEqual(vanilla.renderLineage({ key: null }, () => {}), null);
});

test('★ 채택되지 않은 후보를 지우지 않는다', () => {
  const node = renderLineageWith(FOUND);
  const cls = classes(node);
  assert.ok(cls.includes('is-rejected'),
    '미채택 후보를 빼면 "이 값밖에 없었다"로 읽힌다 — 어느 값이 버려졌는지 알아야 판단할 수 있다');
  assert.match(node.textContent, /미채택/);
  assert.match(node.textContent, /11980/, '버려진 값 자체도 보여야 한다');
});

test('값 충돌을 명시한다', () => {
  const node = renderLineageWith(FOUND);
  assert.ok(classes(node).includes('lp-ct__notice--bad'));
  assert.match(node.textContent, /값 충돌/);
});

test('★ 추적이 안 되면 경로를 지어내지 않는다', () => {
  const node = renderLineageWith({
    key: 'debt.rate',
    lineage: { found: false, reason: '이 값을 만든 Agent 기록이 없다' },
    impact: null, loading: false, error: null,
  });
  assert.match(node.textContent, /추적 불가/);
  assert.match(node.textContent, /기록이 없다/);
  assert.ok(!classes(node).includes('lp-ct__chain'), '없는 경로를 그리지 않는다');
});

test('변경 영향이 재실행 순서까지 보여준다', () => {
  const node = renderLineageWith(FOUND);
  assert.match(node.textContent, /3개/);
  assert.match(node.textContent, /04_financial → 05_validation → 06_writer/);
  assert.match(node.textContent, /새 버전이 필요합니다/);
  assert.match(node.textContent, /12_Final\/im-a4\.html/);
});

test('불러오는 중·실패를 그대로 말한다', () => {
  assert.match(renderLineageWith({ key: 'x', loading: true }).textContent, /불러오는 중/);
  assert.match(renderLineageWith({ key: 'x', error: 'HTTP 500' }).textContent, /HTTP 500/);
});

test('★ 클래스명이 React 판과 같다 (스타일시트가 한 벌이다)', () => {
  const jsx = fs.readFileSync(path.join(__dirname, '..', 'ui', 'Lineage.jsx'), 'utf8');
  const inJsx = new Set([...jsx.matchAll(/lp-ct__[a-z-]+/g)].map(m => m[0]));

  // 한 상태만 보면 그 상태에 없는 클래스가 전부 '누락'으로 잡힌다.
  // 모달이 가질 수 있는 상태를 모두 그려서 합친다
  const inVanilla = new Set([
    FOUND,
    // 미검증 표시는 verified=false 일 때만 나온다
    { key: 'x', lineage: Object.assign({}, FOUND.lineage, { verified: false }), impact: null },
    { key: 'x', lineage: { found: false, reason: '기록 없음' }, impact: null },
    { key: 'x', loading: true },
    { key: 'x', error: 'HTTP 500' },
  ].flatMap(s => classes(renderLineageWith(s))));

  const missing = [...inJsx].filter((c) => {
    if (inVanilla.has(c)) return false;
    // JSX 의 `lp-ct__grade--${grade}` 는 값이 붙기 전 조각이다 — 접두사로 본다
    if (c.endsWith('--')) return ![...inVanilla].some(v => v.startsWith(c));
    return true;
  });
  assert.deepStrictEqual(missing, [],
    `React 판에 있는 클래스가 순수 JS 판에 없다: ${missing.join(', ')} — 스타일이 한쪽만 먹는다`);
});

test('★ 값에 섞인 스크립트가 실행되지 않는다 (innerHTML 을 쓰지 않는다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'vanilla', 'control-tower.js'), 'utf8');
  // 주석에는 '쓰지 않는다'고 적혀 있으므로 **대입만** 본다
  assert.ok(!/\.innerHTML\s*=/.test(src),
    '계보에 뜨는 출처 문자열은 사용자가 올린 문서에서 나온다');

  const node = renderLineageWith({
    key: 'x',
    lineage: {
      found: true, key: 'x', label: '<img src=x onerror=alert(1)>', value: 1, grade: 'C',
      chain: [{ stage: 's', label: '<script>alert(1)</script>', adopted: true, value: null }],
    },
    impact: null, loading: false, error: null,
  });
  // 텍스트로만 남는다 — 자식 엘리먼트가 생기지 않는다
  assert.ok(node.textContent.includes('<script>alert(1)</script>'));
  assert.ok(!walk(node).some(n => n.tagName === 'IMG' || n.tagName === 'SCRIPT'));
});

test('닫기 경로가 있다 (ESC · 바깥 클릭 · 닫기 버튼)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'vanilla', 'control-tower.js'), 'utf8');
  assert.match(src, /Escape/, 'ESC 로 닫히지 않으면 모달에 갇힌다');
  assert.match(src, /e\.target === back/, '바깥을 눌러도 닫혀야 한다');
  assert.match(src, /openLineage: openLineage/, '본체가 개별 숫자에 붙일 수 있어야 한다');
});
