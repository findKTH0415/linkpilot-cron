'use strict';
/**
 * 통합 테스트 — LLM 없이(오프라인) 전체 파이프라인이 끝까지 도는지 확인한다.
 * CI에서 매 PR마다 실행된다. 외부 네트워크 호출 없음.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'im-pipe-'));
process.env.IM_AGENT_ROOT = ROOT;
process.env.IM_AGENT_OFFLINE = '1';

const pipeline = require('../pipeline');
const store = require('../core/store');
const { kstDate, kstYear, kstStamp, daysBetween } = require('../core/kst');

const SILENT = () => {};

test('KST: UTC 자정 직전에도 한국 날짜로 계산한다', () => {
  // 2025-12-31 20:00 UTC = 2026-01-01 05:00 KST
  const d = new Date('2025-12-31T20:00:00Z');
  assert.strictEqual(kstDate(d), '2026-01-01');
  assert.strictEqual(kstYear(d), 2026, 'Project ID 연도는 KST 기준이어야 한다');
  assert.ok(kstStamp(d).endsWith('+09:00'));
});

test('KST: 날짜 차이 계산', () => {
  assert.strictEqual(daysBetween('2026-01-01', '2026-01-31'), 30);
  assert.strictEqual(daysBetween('2025-01-01', '2026-01-01'), 365);
});

test('Project ID: LP-<자산코드>-<KST연도>-<일련번호>', async () => {
  const r = await pipeline.run({ request: '인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성', log: SILENT });
  assert.match(r.projectId, /^LP-DC-\d{4}-001$/);
  assert.strictEqual(r.templateId, 'datacenter');

  // 13개 표준 폴더
  const dir = store.projectDir(r.projectId);
  for (const f of store.FOLDERS) assert.ok(fs.existsSync(path.join(dir, f)), `${f} 폴더 없음`);
});

test('요청문에서 뽑은 값은 verified 가 아니다', async () => {
  const ds = pipeline.loadDataset('LP-DC-2026-001');
  const cap = ds.get('capacity.it_load_mw');
  assert.ok(cap, '요청문의 6.5MW 가 추출되어야 한다');
  assert.strictEqual(cap.value, 6.5);
  assert.strictEqual(cap.source, 'user_request');
  assert.strictEqual(cap.verified, false, '사용자 발언은 문서 확인이 아니다');
});

test('전체 파이프라인: 샘플 자료 투입 후 IM/Teaser 가 생성된다', async () => {
  const first = store.listProjects()[0].id;
  const dest = path.join(store.projectDir(first), '02_Source_Data');
  const sampleDir = path.join(__dirname, '..', 'samples');
  for (const f of fs.readdirSync(sampleDir)) fs.copyFileSync(path.join(sampleDir, f), path.join(dest, f));

  const r = await pipeline.run({ projectId: first, log: SILENT });

  // 모든 Agent 가 실행되고, 오프라인이어도 error 로 죽지 않는다
  for (const [id, res] of Object.entries(r.results)) {
    assert.notStrictEqual(res.status, 'error', `${id} 실패: ${res.error}`);
  }

  const im = fs.readFileSync(path.join(store.projectDir(first), '09_IM/im.md'), 'utf8');
  assert.ok(im.includes('Strictly Private and Confidential'), '하우스 스타일 헤더');
  assert.ok(im.includes('부록 B. 수치 출처표'), '출처표가 반드시 붙는다');
  assert.ok(im.includes('20. Investment Conclusion'), '20개 절이 모두 생성된다');
  assert.ok(fs.existsSync(path.join(store.projectDir(first), '10_Teaser/teaser.md')));
});

test('교차검증: 연면적 충돌(54,822 vs 52,822)이 RED FLAG 로 잡힌다', () => {
  const first = store.listProjects()[0].id;
  const val = store.readJson(first, '11_QC/validation.json');
  const conflict = val.flags.find(f => f.type === 'VALUE_CONFLICT' && (f.keys || []).includes('building.gfa_sqm'));
  assert.ok(conflict, '연면적 충돌이 검출되어야 한다');
  assert.strictEqual(conflict.severity, 'RED');
  assert.ok(conflict.message.includes('54822') && conflict.message.includes('52822'));
});

test('재무모델: 문서값으로 실제 지표가 계산된다', () => {
  const first = store.listProjects()[0].id;
  const fin = store.readJson(first, '07_Financial/financial.json');
  const base = fin.scenarios.base.metrics;
  assert.ok(base.projectIRR > 0, `Project IRR: ${base.projectIRR}`);
  assert.ok(base.equityIRR !== null);
  assert.strictEqual(base.debtAmount, 1850, '차입금은 문서값을 그대로 쓴다');
  assert.ok(['upside', 'downside'].every(k => fin.scenarios[k]), '3개 시나리오');
  assert.ok(fin.sensitivity && fin.sensitivity.rows.length, '민감도 매트릭스');
});

test('재실행해도 계산값이 자기 자신과 충돌하지 않는다', async () => {
  const first = store.listProjects()[0].id;
  await pipeline.run({ projectId: first, log: SILENT });
  const val = store.readJson(first, '11_QC/validation.json');
  const selfConflict = val.flags.filter(f =>
    f.type === 'VALUE_CONFLICT' && (f.keys || []).some(k => k.startsWith('returns.')));
  assert.strictEqual(selfConflict.length, 0, '재무모델 계산값 자기충돌이 없어야 한다');
});

test('오프라인이어도 IM 본문에 출처 없는 숫자가 들어가지 않는다', () => {
  const first = store.listProjects()[0].id;
  const im = store.readJson(first, '09_IM/im.json');
  assert.strictEqual(im.unsourcedNumbers.length, 0);
  assert.ok(im.citations.length > 10, '출처표에 인용이 쌓여야 한다');
  assert.ok(im.citations.every(c => c.citation), '모든 인용에 출처 문자열이 있다');
});

test('RED FLAG 가 남아 있으면 승인/배포가 차단된다', () => {
  const first = store.listProjects()[0].id;
  const gate = require('../core/gate');
  assert.strictEqual(gate.canApprove(first).allowed, false);
  assert.strictEqual(gate.distributionAllowed(first).allowed, false);
  assert.strictEqual(store.readJson(first, '01_Project/project.json').status, 'blocked');
});

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
