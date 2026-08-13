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

test('매스 Agent: API 키 없이도 문서의 용도지역만으로 법정한도를 검토한다', () => {
  const first = store.listProjects()[0].id;
  const m = store.readJson(first, '04_Property/massing.json');

  // 샘플: 대지 18,400㎡ · 일반공업지역(용적률 350%) → 허용 연면적 64,400㎡
  assert.strictEqual(m.inputs.farLimit, 350);
  assert.strictEqual(m.inputs.gfaAllowedSqm, 64400);
  assert.ok(m.inputs.farPlanned < m.inputs.farLimit, '계획 용적률이 상한 이내여야 한다');
  assert.match(m.inputs.limitSource, /국토계획법/);

  const far = m.flags.find(f => f.type === 'FAR');
  assert.ok(far && far.severity === 'GREEN', '한도 이내면 GREEN');
});

test('매스 Agent: 3D 산출물 3종이 실제로 생성된다', () => {
  const first = store.listProjects()[0].id;
  const dir = store.projectDir(first);
  for (const f of ['04_Property/massing.obj', '04_Property/massing.gltf', '04_Property/massing.svg']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} 없음`);
    assert.ok(fs.statSync(path.join(dir, f)).size > 100, `${f} 가 비어 있다`);
  }
  const gltf = JSON.parse(fs.readFileSync(path.join(dir, '04_Property/massing.gltf'), 'utf8'));
  assert.strictEqual(gltf.asset.version, '2.0');
});

test('용적률 초과 계획은 RED FLAG 로 잡힌다', async () => {
  const massing = require('../agents/09-massing');
  const { Dataset } = require('../core/facts');
  const { FIELDS } = require('../core/dictionary');

  const ds = new Dataset('LP-RE-2026-001', FIELDS);
  ds.add({ key: 'land.area_sqm', value: 10000, unit: '㎡', source: 'plan.pdf' });
  ds.add({ key: 'building.gfa_sqm', value: 40000, unit: '㎡', source: 'plan.pdf' }); // FAR 400%
  ds.add({ key: 'land.zoning', value: '제2종일반주거지역', source: 'plan.pdf' });     // 상한 250%
  ds.resolve();

  const projectId = store.listProjects()[0].id;
  const out = await massing.run({ projectId }, { dataset: ds, warn: () => {} });

  const red = out.flags.find(f => f.type === 'FAR_EXCEEDED');
  assert.ok(red, '용적률 초과가 검출되어야 한다');
  assert.strictEqual(red.severity, 'RED');
  assert.match(red.message, /400%/);
  assert.match(red.message, /250%/);
});

test('감정평가: 법적 고지가 산출물에 반드시 포함된다', () => {
  const first = store.listProjects()[0].id;
  const a = store.readJson(first, '04_Property/appraisal.json');
  assert.match(a.disclaimer, /감정평가가 아니며/);

  const im = fs.readFileSync(path.join(store.projectDir(first), '09_IM/im.md'), 'utf8');
  if (a.concluded) {
    assert.ok(im.includes('부록 C. 감정평가 요약'), 'IM에 감정평가 부록이 있어야 한다');
    assert.ok(im.includes('감정평가가 아니며'), 'IM 본문에 법적 고지가 있어야 한다');
  }
});

test('감정평가: 평가방식이 1개뿐이면 토지비 적정성을 단정하지 않는다', () => {
  const first = store.listProjects()[0].id;
  const a = store.readJson(first, '04_Property/appraisal.json');
  if (Object.keys(a.methods).length === 1) {
    assert.ok(a.flags.some(f => f.type === 'APPRAISAL_SINGLE_METHOD'));
    assert.ok(!a.flags.some(f => ['LAND_OVERPAY', 'LAND_UNDERPAY'].includes(f.type)),
      '단일 방식으로 고가/저가 매입을 단정하면 안 된다');
  }
});

test('공공데이터 키가 없어도 파이프라인이 죽지 않는다', () => {
  const first = store.listProjects()[0].id;
  const geo = store.readJson(first, '04_Property/geo.json');
  assert.strictEqual(geo.geo, null, '키 없으면 조회를 건너뛴다');
  assert.deepStrictEqual(geo.facts, [], '없는 데이터를 지어내지 않는다');
});

test('RED FLAG 가 남아 있으면 승인/배포가 차단된다', () => {
  const first = store.listProjects()[0].id;
  const gate = require('../core/gate');
  assert.strictEqual(gate.canApprove(first).allowed, false);
  assert.strictEqual(gate.distributionAllowed(first).allowed, false);
  assert.strictEqual(store.readJson(first, '01_Project/project.json').status, 'blocked');
});

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
