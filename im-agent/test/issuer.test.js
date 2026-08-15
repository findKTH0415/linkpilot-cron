'use strict';
/**
 * 발행 주체 테스트.
 *
 * 여기가 새면 **다른 회사가 만든 IM 에 남의 회사 이름이 찍혀 나간다.**
 * 대외 배포 문서라 나간 뒤에는 회수할 수 없고, 받은 쪽이 먼저 알아챈다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const issuer = require('../core/issuer');
const a4 = require('../design/a4');

function tmpRoot() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'im-issuer-'));
  process.env.IM_AGENT_ROOT = r;
  delete process.env.IM_AGENT_ISSUER;
  return r;
}
const doc = (extra) => Object.assign({
  projectId: 'LP-DC-2026-001', projectName: '표본 프로젝트',
  sections: [], disclaimers: [], kpis: [],
}, extra || {});

// ── 설정을 못 찾았을 때 ──────────────────────────────────────

test('★ 설정이 없으면 아무 회사 이름도 쓰지 않는다', () => {
  tmpRoot();
  assert.strictEqual(issuer.read(), null, '기본 회사를 두면 설정을 잊은 것과 구분할 수 없다');

  const html = a4.render(doc());
  assert.ok(!/PDI/.test(html), '특정 회사 이름이 문서에 남아 있다');
  assert.match(html, /발행 주체 미설정/, '조용히 비우면 그대로 배포된다');
  assert.match(html, /issuer\.json/, '어떻게 고치는지 알려준다');
});

test('★ 코드 어디에도 회사명이 박혀 있지 않다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'design', 'a4.js'), 'utf8');
  ['PDI Global', '피디아이', 'DEALMAKER'].forEach((needle) => {
    assert.ok(!src.includes(needle), `design/a4.js 에 '${needle}' 이 박혀 있다`);
  });
});

// ── 설정을 찾았을 때 ────────────────────────────────────────

test('프로젝트별 설정을 가장 먼저 본다', () => {
  const root = tmpRoot();
  const id = 'LP-DC-2026-001';
  fs.mkdirSync(path.join(root, id, '01_Project'), { recursive: true });
  fs.writeFileSync(path.join(root, 'issuer.json'), JSON.stringify({ en: '저장소 전체' }));
  fs.writeFileSync(path.join(root, id, '01_Project', 'issuer.json'), JSON.stringify({ en: '이 프로젝트' }));

  assert.strictEqual(issuer.read(id).en, '이 프로젝트');
  assert.strictEqual(issuer.read().en, '저장소 전체', '프로젝트를 안 주면 저장소 설정');
});

test('환경변수로도 넣을 수 있다', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'issuer.json'), JSON.stringify({ en: '저장소 전체' }));
  process.env.IM_AGENT_ISSUER = JSON.stringify({ en: '환경변수 회사' });
  assert.strictEqual(issuer.read().en, '환경변수 회사', '환경변수가 저장소 설정보다 앞선다');
  delete process.env.IM_AGENT_ISSUER;
});

test('설정한 회사가 문서에 그대로 나온다', () => {
  tmpRoot();
  const html = a4.render(doc({
    issuer: { en: 'Acme Capital Partners', kr: '(주)에이스캐피탈', tag: 'REAL ASSET INVESTMENT', mark: 'ACP' },
  }));
  assert.match(html, /Acme Capital Partners/);
  assert.match(html, /에이스캐피탈/);
  assert.match(html, /REAL ASSET INVESTMENT/);
  assert.match(html, />ACP</, '로고 자리 이니셜도 따라간다');
  assert.ok(!/발행 주체 미설정/.test(html));
});

test('국문·태그라인이 없으면 그 줄을 만들지 않는다', () => {
  tmpRoot();
  const html = a4.render(doc({ issuer: { en: 'Solo Advisors', mark: 'SA' } }));
  assert.match(html, /Solo Advisors/);
  // 빈 줄이 남으면 서명부에 구멍이 생긴다
  assert.ok(!/font-size:11px;color:[^"]*;"><\/div>/.test(html));
});

// ── 이니셜 ──────────────────────────────────────────────────

test('이니셜을 이름에서 만든다', () => {
  assert.strictEqual(issuer.markFrom('Acme Capital Partners'), 'ACP');
  assert.strictEqual(issuer.markFrom('Solo'), 'SOLO');
  assert.strictEqual(issuer.markFrom('A B C D E F'), 'ABCD', '4글자를 넘지 않는다');
  assert.strictEqual(issuer.markFrom(''), '');
});

test('설정에 mark 가 있으면 그것을 쓴다', () => {
  tmpRoot();
  const root = process.env.IM_AGENT_ROOT;
  fs.writeFileSync(path.join(root, 'issuer.json'), JSON.stringify({ en: 'Acme Capital Partners', mark: 'ACME' }));
  assert.strictEqual(issuer.read().mark, 'ACME');
});

// ── 잘못된 설정 ─────────────────────────────────────────────

test('이름 없는 설정은 설정이 아니다', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'issuer.json'), JSON.stringify({ kr: '국문만 있음' }));
  assert.strictEqual(issuer.read(), null, '이름이 없으면 서명부를 채울 수 없다');
});

test('깨진 JSON 은 조용히 넘어가지 않는다', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'issuer.json'), '{ 깨진');
  assert.throws(() => issuer.read(), /읽을 수 없다/,
    '조용히 미설정으로 넘어가면 왜 이름이 안 나오는지 알 수 없다');
});

test('회사명에 태그가 들어와도 그대로 그리지 않는다', () => {
  tmpRoot();
  const html = a4.render(doc({ issuer: { en: '<script>alert(1)</script>', mark: 'X' } }));
  assert.ok(!/<script>alert/.test(html), '회사명은 설정값이지만 이스케이프한다');
  assert.match(html, /&lt;script&gt;/);
});
