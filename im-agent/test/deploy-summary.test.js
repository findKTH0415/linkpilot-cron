'use strict';
/**
 * deploy-summary.test.js — **배포 요약이 「어디까지 닿았는지」를 말한다** 〈2026-08-27 · D-143〉.
 *
 * ★★★ 왜. 오늘 이런 왕복이 있었다 — 사장님은 「디자인 반영이 아직 안 됐다」,
 *   이쪽은 「반영했고 배포도 초록」. **둘 다 맞는 말이었다.**
 *   이 배포가 올리는 것은 NAS 이고, 앱 저장소의 `im-flow/` 사본은 **사람이**
 *   올린다. 그 경계가 배포 화면 어디에도 없어서 **「초록 = 앱에 반영됨」**으로
 *   읽혔다 (M-25 · D-87 과 같은 결 — 한쪽만 보면 아무 이상이 없다).
 *
 * ★ 문서에 적는 것으로는 안 된다. **초록 옆에 적혀야** 읽힌다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const WF = fs.readFileSync(
  path.join(__dirname, '..', '..', '.github', 'workflows', 'deploy-nas.yml'), 'utf8');
const step = WF.slice(WF.indexOf('name: What is still by hand'));

test('★★★ 배포마다 **남은 손일**을 요약에 적는다', () => {
  assert.ok(step.length > 100, '그 단계가 없다 — 배포 화면에는 초록만 남는다');
  assert.match(step, /앱 저장소[^|]*사본[\s\S]{0,120}\*\*사람\*\*/,
    '사본을 사람이 올린다는 말이 없으면 「초록 = 앱에 반영됨」으로 읽힌다');
  assert.match(step, /GITHUB_STEP_SUMMARY/, '요약에 안 적으면 로그에 묻힌다');
});

test('★★★ 판 지문을 **읽어서** 적는다 — 손으로 박으면 그날부터 옛말을 한다', () => {
  assert.match(step, /grep -o "LP_BUILD = '\[0-9a-f\]\*'"/,
    '지문을 파일에서 읽지 않으면 요약만 옛 판을 말한다 (M-25 가 막으려던 바로 그 상태)');
  assert.ok(!/판 `[0-9a-f]{8}`/.test(step), '지문을 글자로 박아 뒀다');
});

test('★★ 실패해도 적는다 — 빨간 배포일수록 「어디까지 갔나」가 궁금하다', () => {
  const head = step.slice(0, step.indexOf('run: |'));
  assert.match(head, /always\(\)/, 'always() 가 없으면 실패한 배포에서는 안 나온다');
  assert.match(head, /dry_run != 'true'/, 'dry run 에서 적으면 안 한 일을 했다고 말한다');
});
