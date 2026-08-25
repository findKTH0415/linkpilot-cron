'use strict';
/**
 * 대시보드 표시 로직 테스트.
 *
 * React 렌더링은 테스트하지 않는다(DOM 필요). 대신 화면에 뭘 띄울지 결정하는
 * 순수 로직(ui/lib.js)만 검증한다 — 여기가 틀리면 사용자가 진행률을 오해한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ui/lib.js 는 ESM 이므로 동적 import 로 읽는다
let lib;
test.before(async () => {
  lib = await import('../ui/lib.js');
});

const SNAPSHOT = {
  project: { id: 'LP-DC-2026-001', name: '인천 데이터센터' },
  overall: 80,
  tracks: {
    production: { pct: 100, weight: 50, label: 'PRODUCTION (Agent 실행)', done: 11, total: 11 },
    validation: { pct: 70, weight: 25, label: 'VALIDATION (검증)', score: 80, status: 'DISTRIBUTION BLOCKED', gatesPassed: 5, gatesTotal: 8, critical: 1, major: 3, minor: 0 },
    output: { pct: 80, weight: 15, label: 'OUTPUT (사양·파일)', specLocked: false, detail: '사양 DRAFT', files: [{ path: 'a.md', label: 'IM', exists: true }, { path: 'b.html', label: 'A4', exists: false }] },
    approval: { pct: 0, weight: 10, label: 'APPROVAL (사람 승인)', approved: false, reasons: ['RED FLAG 2건 미해소', '출력 사양 미확정'] },
  },
  agents: [
    { id: '04_financial', label: 'Financial Agent', status: 'COMPLETED', progress: 100, elapsedMs: 5400 },
    { id: '07_geo', label: 'Geo Agent', status: 'WARNING', progress: 100, elapsedMs: 1200 },
    { id: '11_final_validation', label: 'Final Validation', status: 'ERROR', progress: 100, elapsedMs: 800 },
    { id: '03_research', label: 'Research', status: 'WAITING', progress: 0 },
  ],
  health: { level: 'BLOCKED', mark: '🔴', reason: 'CRITICAL 1건' },
  activity: [
    { at: '2026-08-13T14:52:11+09:00', agent: '02_extraction', message: '추출 완료', level: 'INFO', records: 35 },
    { at: '2026-08-13T14:52:19+09:00', agent: '07_geo', message: 'VWORLD_KEY 미설정', level: 'WARN' },
    { at: '2026-08-13T14:52:37+09:00', agent: '04_financial', message: 'CAPEX 재계산', level: 'INFO' },
  ],
  timing: { elapsedMs: 1122000, estimatedRemainingMs: 375000 },
};

test('★ Agent 100% · 전체 80% 격차를 화면 경고로 띄운다', () => {
  const n = lib.progressGapNotice(SNAPSHOT);
  assert.ok(n, '격차 경고가 나와야 한다');
  assert.strictEqual(n.gap, 20);
  assert.match(n.message, /Agent 작업은 100%/);
  assert.match(n.message, /전체는 80%/);
  assert.match(n.message, /배포할 수 없다/);
  // 뒤처진 트랙을 지목한다
  assert.match(n.message, /APPROVAL|VALIDATION/);
});

test('격차가 작으면 경고를 띄우지 않는다 (경고 남발 금지)', () => {
  const close = { ...SNAPSHOT, overall: 95, tracks: { ...SNAPSHOT.tracks, production: { ...SNAPSHOT.tracks.production, pct: 100 } } };
  assert.strictEqual(lib.progressGapNotice(close), null);
});

test('트랙 순서는 제작 → 검증 → 산출 → 승인 고정', () => {
  const list = lib.trackList(SNAPSHOT);
  assert.deepStrictEqual(list.map(t => t.key), ['production', 'validation', 'output', 'approval']);
  assert.strictEqual(list[0].weight, 50);
});

test('위험 요약은 검증 트랙에서만 가져온다 (Agent 진행률과 섞지 않는다)', () => {
  const r = lib.riskSummary(SNAPSHOT);
  assert.strictEqual(r.score, 80);
  assert.strictEqual(r.critical, 1);
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.gatesPassed, 5);
});

test('검증 미실행이면 available=false — 0점으로 표시하지 않는다', () => {
  const s = { tracks: { validation: { pct: 0, detail: '검증 미실행' } } };
  const r = lib.riskSummary(s);
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.detail, '검증 미실행');
});

test('산출물은 파일 존재 여부로 센다', () => {
  const o = lib.outputSummary(SNAPSHOT);
  assert.strictEqual(o.ready, 1);
  assert.strictEqual(o.total, 2);
  assert.strictEqual(o.specLocked, false);
});

test('Agent 요약: 상태별 집계', () => {
  const s = lib.agentSummary(SNAPSHOT);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.completed, 1);
  assert.strictEqual(s.warning, 1);
  assert.strictEqual(s.error, 1);
  assert.strictEqual(s.waiting, 1);
});

test('사용자 조치 항목은 승인 차단 사유에서 나온다', () => {
  const a = lib.userActions(SNAPSHOT);
  assert.strictEqual(a.length, 2);
  assert.strictEqual(a[0].id, 'A1');
  assert.match(a[0].message, /RED FLAG/);
});

test('활동 로그 필터', () => {
  assert.strictEqual(lib.filterActivity(SNAPSHOT.activity, 'ALL').length, 3);
  assert.strictEqual(lib.filterActivity(SNAPSHOT.activity, 'ERROR').length, 1);
  assert.strictEqual(lib.filterActivity(SNAPSHOT.activity, 'FINANCIAL').length, 1);
  assert.strictEqual(lib.filterActivity(SNAPSHOT.activity, 'DATA').length, 2);
});

test('알 수 없는 필터는 전체로 처리한다 (화면이 비지 않게)', () => {
  assert.strictEqual(lib.filterActivity(SNAPSHOT.activity, 'NOPE').length, 3);
});

test('시간 표기', () => {
  assert.strictEqual(lib.formatDuration(1122000), '18m 42s');
  assert.strictEqual(lib.formatDuration(45000), '45s');
  assert.strictEqual(lib.formatDuration(null), '-');
});

test('타임스탬프 → 시각', () => {
  assert.strictEqual(lib.clockOf('2026-08-13T14:52:11+09:00'), '14:52:11');
  assert.strictEqual(lib.clockOf(null), '');
});

test('진행바 폭은 0~100 으로 클램프된다', () => {
  assert.strictEqual(lib.barWidth(150), '100%');
  assert.strictEqual(lib.barWidth(-10), '0%');
  assert.strictEqual(lib.barWidth(null), '0%');
});

test('빈 스냅샷에서도 죽지 않는다', () => {
  assert.deepStrictEqual(lib.trackList(null), []);
  assert.strictEqual(lib.progressGapNotice(null), null);
  assert.strictEqual(lib.agentSummary(null).total, 0);
  assert.strictEqual(lib.outputSummary({}).total, 0);
});

// ── 컴포넌트 정합성 (렌더링 없이 정적 검사) ─────────────────
test('컴포넌트는 색을 하드코딩하지 않는다 (테마 변수만 사용)', () => {
  const uiDir = path.join(__dirname, '..', 'ui');
  for (const f of ['ControlTower.jsx', 'Panels.jsx', 'Lineage.jsx']) {
    const src = fs.readFileSync(path.join(uiDir, f), 'utf8');
    const hex = src.match(/#[0-9A-Fa-f]{6}\b/g);
    assert.strictEqual(hex, null, `${f} 에 하드코딩된 색이 있다: ${hex}`);
  }
});

test('CSS 는 테마 변수를 쓰고 폴백을 가진다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'ui', 'controlTower.css'), 'utf8');
  assert.match(css, /var\(--lp-primary,/, '테마 변수 + 폴백');
  assert.match(css, /prefers-reduced-motion/, '모션 감소 대응');
  assert.match(css, /@media \(max-width/, '모바일 대응');
});

test('API 라우터는 경로 조작을 막는다', () => {
  const { PROJECT_ID, DICT_KEY } = require('../ui/api-router.cjs');
  assert.ok(PROJECT_ID.test('LP-DC-2026-001'));
  assert.ok(!PROJECT_ID.test('../../etc/passwd'));
  assert.ok(!PROJECT_ID.test('LP-DC-2026-001/../..'));
  assert.ok(DICT_KEY.test('building.gfa_sqm'));
  assert.ok(!DICT_KEY.test('../../../secret'));
});

test('API 라우터는 읽기 전용이다 (쓰기 엔드포인트 없음)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'api-router.cjs'), 'utf8');
  assert.ok(!/router\.(post|put|patch|delete)/.test(src), '쓰기 엔드포인트가 노출되면 안 된다');
});

test('GET /projects 는 선택에 필요한 항목만 내보낸다', async () => {
  const { createHandlers } = require('../ui/api-router.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-projects-'));
  const dir = path.join(tmp, 'LP-DC-2026-001', '01_Project');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    name: '인천 데이터센터', assetType: '데이터센터', status: 'blocked',
    // ↓ 목록에 실리면 안 되는 것들
    totalProjectCost: 296200000000, sponsor: '비공개 스폰서',
  }));

  const r = await createHandlers({ agentRoot: tmp }).projects();

  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.projects.length, 1);
  // ★ `externalId` 는 **앱의 딜 키**다 — 딜 내용이 아니라 이름표다.
  //   앱이 자기 목록과 맞춰 보려면 있어야 한다 (프로젝트-연결-규칙 §3).
  /* ★ `hidden`·`hiddenAt` 은 **목록에서 접었는지**다 〈2026-08-24〉 — 딜 내용이
   *   아니라 화면 정리용 표시다. 서버가 접힌 것을 빼 버리면 되돌릴 길이
   *   없으므로, 빼지 않고 **표시만** 해서 내보낸다 */
  assert.deepStrictEqual(Object.keys(r.body.projects[0]).sort(),
    ['assetType', 'externalId', 'hidden', 'hiddenAt', 'id', 'name', 'status'],
    '딜 내용(금액·스폰서)이 목록 API 로 새어 나가면 안 된다');
  // 새면 안 되는 것을 **이름으로도** 못 박아 둔다 — 키 목록만 보면
  // 나중에 항목이 늘 때 무심코 통과시킨다
  ['totalProjectCost', 'sponsor'].forEach((k) => {
    assert.ok(!(k in r.body.projects[0]), `${k} 가 목록 API 로 새어 나갔다`);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('GET /projects 는 프로젝트가 없어도 죽지 않는다', async () => {
  const { createHandlers } = require('../ui/api-router.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-empty-'));
  const r = await createHandlers({ agentRoot: tmp }).projects();
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.projects, []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('배포 페이지: 인라인 스크립트가 조기 종료되지 않는다', () => {
  // 닫는 스크립트 태그가 이스케이프되지 않으면 화면이 통째로 비고 오류도 안 뜬다.
  const page = path.join(__dirname, '..', 'ui', 'vanilla', 'linkpilot-control-tower.html');
  if (!fs.existsSync(page)) return;   // 아직 빌드 전이면 건너뛴다
  const html = fs.readFileSync(page, 'utf8');
  const opens = (html.match(/<script\b/gi) || []).length;
  const closes = (html.match(/<\/script>/gi) || []).length;
  assert.strictEqual(opens, closes, 'script 태그 짝이 맞지 않는다 — 이스케이프 누락');
  assert.ok(!/\n\s*\*.*<\/script>/.test(html), '주석 안의 닫는 태그가 그대로 남아 있다');
});
