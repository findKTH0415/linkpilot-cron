'use strict';
/**
 * 실패 알림 회귀 테스트 — 네트워크·시크릿 없이 돈다.
 *
 * 지키려는 규칙: **실패했을 때 조용히 죽지 않는다.**
 * 지금 이 경로를 쓰는 것은 `deploy-nas.yml` 이다. 배포가 실패했는데 알림이
 * 안 오면 NAS 에 무엇이 올라갔는지 모르는 채로 지나간다.
 *
 * (아침 크론은 이 저장소 범위에서 제외되었다 — docs/삭제-후보.md B군)
 */
const test = require('node:test');
const assert = require('node:assert');

const alert = require('../alert-failure');

test('알림: 실패 시각을 KST 로 찍는다 (러너는 UTC 로 돈다)', () => {
  // 2026-08-13T21:30:00Z = 2026-08-14 06:30 KST — 날짜가 넘어가는 시각으로 잡는다
  const stamp = alert.kstStamp(new Date('2026-08-13T21:30:00Z'));
  assert.match(stamp, /^2026-08-14 06:30:00 KST$/,
    'UTC 로 찍히면 날짜가 하루 어긋나 실패 시점을 잘못 읽는다');
});

test('알림: 이슈 제목이 워크플로마다 고정된다 (연속 실패 시 이슈 폭증 방지)', () => {
  const a = alert.issueTitle('deploy-nas');
  const b = alert.issueTitle('deploy-nas');
  assert.strictEqual(a, b, '제목에 시각이 섞이면 실패할 때마다 새 이슈가 쌓인다');
  assert.notStrictEqual(a, alert.issueTitle('im-agent-ci'), '워크플로가 다르면 이슈도 달라야 한다');
});

test('알림: 본문에 워크플로명·실행 URL·KST 시각이 모두 들어간다', () => {
  const a = alert.buildAlert({
    workflow: 'deploy-nas',
    runUrl: 'https://github.com/o/r/actions/runs/123',
    now: new Date('2026-08-13T21:30:00Z'),
  });
  assert.match(a.body, /deploy-nas/);
  assert.match(a.body, /actions\/runs\/123/);
  assert.match(a.body, /2026-08-14 06:30:00 KST/);
  assert.match(a.sms, /deploy-nas/, 'SMS 만 봐도 어느 워크플로인지 알아야 한다');
});

test('알림: 로그에 전화번호를 그대로 남기지 않는다', () => {
  const masked = alert.maskPhone('01012345678');
  assert.ok(!masked.includes('1234'), '가운데 자리가 그대로 남아 있다');
  assert.match(masked, /5678$/, '식별용 뒷자리는 남긴다');
});

test('알림: DRY RUN 은 네트워크를 타지 않는다', async () => {
  const saved = process.env.ALERT_DRY_RUN;
  process.env.ALERT_DRY_RUN = '1';
  delete require.cache[require.resolve('../alert-failure')];
  const dry = require('../alert-failure');
  // 모듈 로드 시점에 DRY_RUN 이 고정되므로 재로드해서 확인한다
  assert.ok(dry.buildAlert({ workflow: 'x' }).title);
  if (saved) process.env.ALERT_DRY_RUN = saved; else delete process.env.ALERT_DRY_RUN;
  delete require.cache[require.resolve('../alert-failure')];
});
