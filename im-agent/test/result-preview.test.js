'use strict';
/**
 * 보고서 생성 결과 미리보기 테스트.
 *
 * 여기가 새면 **배포 차단인데 차단이 아닌 것처럼 보인다.** 실제로 한 번 그랬다 —
 * `snapshot.approval` 로 잘못 읽어 배너가 조용히 사라졌고, 화면만 보면 정상으로 보였다.
 *
 * 미리보기는 실제 파이프라인 산출물을 읽으므로, 여기서는 표본 프로젝트를 만들어
 * 스냅샷 구조와 렌더 규약만 검사한다 (파이프라인 자체는 pipeline.test.js 가 맡는다).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AGENT = path.join(__dirname, '..');
const { build } = require('../ui/platform/build-result.js');
const { OUTPUTS } = require('../ui/report-api.cjs');

/** 표본 프로젝트 — monitor 스냅샷이 나올 만큼만 만든다 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-result-'));
  process.env.IM_AGENT_ROOT = root;
  const store = require('../core/store');
  const monitor = require('../core/monitor');
  const id = 'LP-DC-2026-001';
  store.createProjectDirs(id);
  store.writeJson(id, '01_Project/project.json', { id, name: '표본 데이터센터', templateId: 'datacenter' });

  monitor.start(id);
  monitor.update(id, '01_project', { status: 'complete', detail: '완료' });
  monitor.update(id, '05_validation', { status: 'warning', detail: 'RED 2 / YELLOW 9' });

  // 산출물 일부만 만든다 — '있는 것과 없는 것'이 화면에서 구분되어야 한다
  fs.writeFileSync(path.join(root, id, '09_IM', 'im.md'), '# IM\n본문');
  fs.mkdirSync(path.join(root, id, '12_Final'), { recursive: true });
  fs.writeFileSync(path.join(root, id, '12_Final', 'im-a4.html'),
    '<!doctype html><title>표본 IM</title><body><h1>표본 IM</h1></body>');
  fs.writeFileSync(path.join(root, id, '11_QC', 'red-flag-report.md'), '# RED FLAG\n- 연면적 충돌');
  return { root, id };
}

test('★ 배포 차단이면 사유를 화면에 적는다', () => {
  const { root, id } = fixture();
  const html = build({ root, id });

  const blocked = /class="banner banner--blocked"/.test(html);
  const monitor = require('../core/monitor');
  const snap = monitor.snapshot(id);
  const reasons = (snap.tracks.approval && snap.tracks.approval.reasons) || [];

  if (reasons.length) {
    assert.ok(blocked, '차단 사유가 있는데 배너가 없다 — 화면만 보면 정상으로 보인다');
    reasons.forEach((r) => {
      assert.ok(html.includes(r.slice(0, 20)), `사유가 화면에 없다: ${r.slice(0, 40)}`);
    });
  }
});

test('★ 승인 정보를 tracks.approval 에서 읽는다', () => {
  const { root, id } = fixture();
  const monitor = require('../core/monitor');
  const snap = monitor.snapshot(id);
  assert.ok(snap.tracks && snap.tracks.approval,
    'monitor 스냅샷에 tracks.approval 이 없다 — 미리보기가 차단 상태를 못 읽는다');
  assert.strictEqual(snap.approval, undefined,
    '최상위 approval 은 없다. 여기서 읽으면 배너가 조용히 사라진다');
});

test('스냅샷 구조가 바뀌면 조용히 넘어가지 않는다', () => {
  const { root, id } = fixture();
  const monitor = require('../core/monitor');
  const real = monitor.snapshot;
  monitor.snapshot = () => ({ agents: [{ id: 'x' }], tracks: {} });
  try {
    assert.throws(() => build({ root, id }), /tracks\.approval/);
  } finally {
    monitor.snapshot = real;
  }
});

test('산출물은 파일이 실제로 있는지로 판정한다', () => {
  const { root, id } = fixture();
  const html = build({ root, id });
  // 만든 것
  assert.ok(html.includes('09_IM/im.md'));
  assert.ok(html.includes('12_Final/im-a4.html'));
  // 안 만든 것은 '만들어지지 않음'으로 표시된다
  assert.ok(html.includes('만들어지지 않음'), "'생성됨' 표시를 믿지 않는다");
  assert.ok(html.includes('10_Teaser/teaser.md'), '없는 산출물도 목록에는 남긴다');
});

test('산출물 목록이 서버와 같은 정의를 쓴다', () => {
  const { root, id } = fixture();
  const html = build({ root, id });
  OUTPUTS.forEach((o) => {
    assert.ok(html.includes(o.rel), `${o.rel} 이 미리보기에 없다 — 목록이 서버와 갈렸다`);
  });
});

test('생성된 IM 을 실물 그대로 넣는다', () => {
  const { root, id } = fixture();
  const html = build({ root, id });
  assert.match(html, /<iframe class="frame"/, 'IM 을 iframe 으로 그대로 보여준다');
  assert.ok(html.includes('표본 IM'), '본문이 들어가야 한다');
});

test('IM 이 없으면 없다고 말한다', () => {
  const { root, id } = fixture();
  fs.unlinkSync(path.join(root, id, '12_Final', 'im-a4.html'));
  const html = build({ root, id });
  assert.ok(html.includes('IM 이 만들어지지 않았습니다'), '빈 자리를 두지 않는다');
});

test('실행 기록이 없으면 만들지 않는다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-result-empty-'));
  process.env.IM_AGENT_ROOT = root;
  const store = require('../core/store');
  const id = 'LP-DC-2026-002';
  store.createProjectDirs(id);
  assert.throws(() => build({ root, id }), /실행 기록이 없다/,
    '빈 화면을 그리느니 만들지 않는다');
});

test('없는 프로젝트면 만들지 않는다', () => {
  assert.throws(() => build({ root: os.tmpdir(), id: 'LP-DC-1999-001' }), /찾을 수 없다/);
});

test('★ 미리보기임과 데이터 출처를 화면에 적는다', () => {
  const { root, id } = fixture();
  const html = build({ root, id });
  assert.match(html, /실제로 돌린 파이프라인의 산출물/);
  assert.match(html, /내용은 예시/, '표본 자료로 돌린 결과임을 밝힌다');
});

test('제작현황을 복사하지 않고 control-tower.js 를 쓴다', () => {
  const { root, id } = fixture();
  const html = build({ root, id });
  assert.match(html, /LinkPilotControlTower\.mount/,
    '렌더를 복사하면 실제 화면과 미리보기가 갈린다');
  assert.match(html, /fetch: stub/, '실제 스냅샷을 주입해서 보여준다');
});

test('파일 하나로 열린다 (외부 참조 없음)', () => {
  const { root, id } = fixture();
  const html = build({ root, id });
  assert.ok(!/<script src=/.test(html));
  assert.ok(!/<link[^>]+stylesheet/.test(html));
});

test('script 태그 짝이 맞는다', () => {
  const { root, id } = fixture();
  const html = build({ root, id });
  assert.strictEqual((html.match(/<script\b/g) || []).length, (html.match(/<\/script>/g) || []).length);
});

test('내부 호스트가 들어가지 않는다', () => {
  const { root, id } = fixture();
  assert.ok(!/\.ts\.net|synologynas|192\.168\./.test(build({ root, id })));
});
