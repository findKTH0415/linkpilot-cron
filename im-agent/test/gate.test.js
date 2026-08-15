'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'im-gate-'));
process.env.IM_AGENT_ROOT = ROOT;

const store = require('../core/store');
const gate = require('../core/gate');

const PID = 'LP-DC-2026-999';

/**
 * 승인에 필요한 최소 상태를 만든다.
 * 게이트는 (교차검증 + IM + 최종 독립검증 + 출력사양 확정) 넷을 모두 요구한다.
 */
function seed({ flags = [], unsourced = [], finalStatus = 'APPROVED FOR DISTRIBUTION', finalScore = 96, specLocked = true, issuerSet = true } = {}) {
  store.createProjectDirs(PID);
  store.writeJson(PID, '11_QC/validation.json', { flags, verdict: 'PASS', score: { total: 90 } });
  store.writeJson(PID, '09_IM/im.json', { sections: [], citations: [], unsourcedNumbers: unsourced });
  store.writeJson(PID, '11_QC/final-validation.json', {
    status: finalStatus, score: { total: finalScore }, issues: [],
    summary: { critical: 0, major: 0, minor: 0 },
  });
  store.writeJson(PID, '01_Project/output-spec.json', {
    docType: 'im', version: 'v1.0', locked: specLocked, confirmedBy: specLocked ? '김대표' : null,
  });
  // 발행 주체가 없으면 대외 배포를 막는다 (core/issuer.js) — 승인 검사의 기본 상태다.
  // ★ 끄는 경우 파일을 지운다. 남겨 두면 앞 테스트가 쓴 값이 그대로 통과시킨다
  const issuerFile = path.join(store.projectDir(PID), '01_Project', 'issuer.json');
  if (issuerSet) store.writeJson(PID, '01_Project/issuer.json', { en: 'Sample Capital Co.,Ltd' });
  else if (fs.existsSync(issuerFile)) fs.unlinkSync(issuerFile);
}

test('검증 없이는 승인할 수 없다', () => {
  store.createProjectDirs(PID);
  const c = gate.canApprove(PID);
  assert.strictEqual(c.allowed, false);
  assert.ok(c.reasons[0].includes('Cross Validation'));
});

test('최종 독립검증 없이는 승인할 수 없다', () => {
  seed({});
  const fs2 = require('fs');
  fs2.unlinkSync(require('path').join(store.projectDir(PID), '11_QC/final-validation.json'));
  const c = gate.canApprove(PID);
  assert.strictEqual(c.allowed, false);
  assert.ok(c.reasons.some(r => /최종 독립검증 미실행/.test(r)));
});

test('최종검증이 배포차단이면 승인할 수 없다', () => {
  seed({ finalStatus: 'DISTRIBUTION BLOCKED', finalScore: 62 });
  const c = gate.canApprove(PID);
  assert.strictEqual(c.allowed, false);
  assert.ok(c.reasons.some(r => /배포차단/.test(r)));
});

test('출력 사양이 확정되지 않으면 승인할 수 없다', () => {
  seed({ specLocked: false });
  const c = gate.canApprove(PID);
  assert.strictEqual(c.allowed, false);
  assert.ok(c.reasons.some(r => /출력 사양 미확정/.test(r)));
});

test('RED FLAG 가 있으면 승인이 거부된다', () => {
  seed({ flags: [{ severity: 'RED', type: 'VALUE_CONFLICT', message: '연면적 불일치' }] });
  assert.strictEqual(gate.canApprove(PID).allowed, false);
  assert.throws(() => gate.approve(PID, { approver: '김대표' }), /승인 불가/);
});

test('출처 없는 숫자가 본문에 있으면 승인이 거부된다', () => {
  seed({ flags: [], unsourced: [{ section: '01', token: '18.5%' }] });
  assert.strictEqual(gate.canApprove(PID).allowed, false);
});

test('YELLOW 만 있으면 승인 가능하다', () => {
  seed({ flags: [{ severity: 'YELLOW', type: 'STALE', message: '자료 경과' }] });
  assert.strictEqual(gate.canApprove(PID).allowed, true);
});

test('AI 는 스스로 승인할 수 없다', () => {
  seed({ flags: [] });
  assert.throws(() => gate.approve(PID, { approver: 'validation-agent' }), /사람이어야 한다/);
  assert.throws(() => gate.approve(PID, { approver: 'Claude' }), /사람이어야 한다/);
});

test('사람 승인 기록이 남고, 그 뒤에야 배포가 허용된다', () => {
  seed({ flags: [] });
  assert.strictEqual(gate.distributionAllowed(PID).allowed, false);

  const r = gate.approve(PID, { approver: '김대표', comment: 'IC 통과' });
  assert.strictEqual(r.decision, 'APPROVE');
  assert.ok(r.at.endsWith('+09:00'), '승인 시각은 KST 로 기록된다');

  assert.strictEqual(gate.distributionAllowed(PID).allowed, true);
});

test('REJECT 로 기록하면 배포가 다시 막힌다', () => {
  seed({ flags: [] });
  gate.approve(PID, { approver: '김대표', decision: 'REJECT', comment: '재작성 필요' });
  assert.strictEqual(gate.distributionAllowed(PID).allowed, false);
});

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test('★ 발행 주체가 없으면 대외 배포를 막는다', () => {
  seed({ issuerSet: false });
  const c = gate.canApprove(PID);
  assert.strictEqual(c.allowed, false);
  assert.ok(c.reasons.some(r => r.includes('발행 주체')),
    '누가 낸 문서인지 모르는 채로 대외 배포하면 회수할 수 없다');

  seed();   // 발행 주체를 넣으면 통과한다
  assert.strictEqual(gate.canApprove(PID).allowed, true);
});
