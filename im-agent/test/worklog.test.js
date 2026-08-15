'use strict';
/**
 * 작업지시판 테스트.
 *
 * 여기가 새면 **등록부에만 있고 보드에는 없는 일**이 생긴다. 그런 일은 아무도 안 한다.
 * 보드와 등록부(docs/미결정-사항.md)를 서로 대조해 한쪽에만 있는 항목을 잡아낸다.
 *
 * 화면 로직은 board-core.js 를 그대로 쓰므로 여기서 다시 검사하지 않는다
 * (board.test.js 가 맡는다). 여기서 보는 것은 데이터의 정합성이다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const B = require('../ui/platform/board-core.js');
const { build } = require('../ui/platform/build-worklog.js');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const data = JSON.parse(fs.readFileSync(path.join(DOCS, '작업지시.json'), 'utf8'));
const register = fs.readFileSync(path.join(DOCS, '미결정-사항.md'), 'utf8');

/** 등록부에서 활성 미결정 ID 를 뽑는다 (범위 외·결정 기록 표는 제외) */
function activeDecisionIds() {
  return (register.match(/^### [^ ]+ (D-\d+)\./gm) || [])
    .map(s => s.match(/D-\d+/)[0]);
}

const ids = data.tasks.map(t => t.id);

test('★ 등록부의 미결정 항목이 전부 보드에 있다', () => {
  const missing = activeDecisionIds().filter(id => !ids.includes(id));
  assert.deepStrictEqual(missing, [],
    `등록부에만 있고 보드에 없는 항목: ${missing.join(', ')} — 보드에 없으면 아무도 안 한다`);
});

test('★ 보드가 가리키는 등록부 ID 가 실제로 등록부에 있다', () => {
  const known = new Set(activeDecisionIds());
  // 결정 기록·범위 외로 옮겨간 것도 유효한 참조다
  (register.match(/\| (D-\d+) \|/g) || []).forEach(s => known.add(s.match(/D-\d+/)[0]));

  const dangling = ids.filter(id => /^D-\d+$/.test(id) && !known.has(id));
  assert.deepStrictEqual(dangling, [],
    `등록부에 없는 D- 항목이 보드에 있다: ${dangling.join(', ')}`);
});

test('카드 ID 가 중복되지 않는다', () => {
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  assert.deepStrictEqual(dup, [], `중복 ID: ${dup.join(', ')}`);
});

test('★ 기한을 지어내지 않는다', () => {
  data.tasks.forEach((t) => {
    if (t.due === undefined || t.due === null) return;
    assert.match(String(t.due), /^\d{4}-\d{2}-\d{2}$/, `${t.id}: 기한 형식이 아니다`);
  });
  // 지금은 정해진 마감이 없다. 있으면 위 형식 검사만 통과하면 된다
  const withDue = data.tasks.filter(t => t.due);
  assert.strictEqual(withDue.length, 0,
    '없는 기한을 채우면 보드가 급한 순서를 거짓으로 정렬한다');
});

test('상태·우선순위가 보드가 아는 값이다', () => {
  const statuses = B.STATUSES.map(s => s.id);
  data.tasks.forEach((t) => {
    assert.ok(statuses.includes(t.status), `${t.id}: 모르는 상태 '${t.status}'`);
    assert.ok(['urgent', 'normal'].includes(t.priority), `${t.id}: 모르는 우선순위 '${t.priority}'`);
    assert.ok(data.people.includes(t.assignee), `${t.id}: 담당 '${t.assignee}' 가 people 에 없다`);
    assert.ok(data.projects.includes(t.project), `${t.id}: 분류 '${t.project}' 가 projects 에 없다`);
  });
});

test('완료 항목에는 완료일이 있다', () => {
  data.tasks.filter(t => t.status === 'done').forEach((t) => {
    assert.match(String(t.doneAt || ''), /^\d{4}-\d{2}-\d{2}$/,
      `${t.id}: 완료인데 완료일이 없다 — 언제 끝났는지 모르면 되돌아볼 수 없다`);
  });
});

test('모든 카드에 제목과 설명이 있다', () => {
  data.tasks.forEach((t) => {
    assert.ok(t.title && t.title.trim(), `${t.id}: 제목 없음`);
    assert.ok(t.detail && t.detail.trim().length > 10,
      `${t.id}: 설명이 없거나 너무 짧다 — 제목만으로는 무엇을 해야 하는지 모른다`);
  });
});

test('보드가 상태별로 묶인다 (board-core 로 실제 계산)', () => {
  const groups = B.groupByStatus(data.tasks, B.kstYmd());
  const total = groups.reduce((a, g) => a + g.count, 0);
  assert.strictEqual(total, data.tasks.length, '어느 카드도 사라지지 않는다');
  assert.ok(groups.find(g => g.status.id === 'todo').count > 0);
  assert.ok(groups.find(g => g.status.id === 'done').count > 0);
});

// ── 빌드 산출물 ──────────────────────────────────────────────

test('★ 미리보기에 데모 데이터가 남지 않는다', () => {
  const html = build();
  ['감정평가 법인 선정', '박상무', '이팀장', '남동공단 데이터센터'].forEach((needle) => {
    assert.ok(!html.includes(needle),
      `미리보기에 board.html 의 데모 데이터 '${needle}' 가 남아 있다`);
  });
  assert.ok(html.includes('아침 크론을 어디로 옮기는가'), '실제 작업이 들어가야 한다');
});

test('★ 미리보기가 파일 하나로 열린다 (외부 참조 없음)', () => {
  const html = build();
  assert.ok(!/<script src=/.test(html), '외부 스크립트가 남으면 파일 하나로 안 열린다');
  assert.ok(!/<link[^>]+stylesheet/.test(html), '외부 스타일시트가 남았다');
});

test('★ script 태그 짝이 맞는다 (인라인 시 조기 종료 방지)', () => {
  const html = build();
  const open = (html.match(/<script\b/g) || []).length;
  const close = (html.match(/<\/script>/g) || []).length;
  assert.strictEqual(open, close, '주석 안의 닫는 태그 하나로 화면이 통째로 빈다');
});

test('★ 설정 블록 뒤에 세미콜론이 있다', () => {
  const html = build();
  // 없으면 바로 뒤의 (function(){...}()) 이 객체를 호출하는 꼴이 되어
  // 화면이 통째로 비고 DOM 만 봐서는 원인이 안 보인다
  assert.match(html, /\}\s*;\s*\n\s*\(function/,
    '설정 블록과 즉시실행 함수 사이에 세미콜론이 없다');
});

test('미리보기임이 화면에 적혀 있다', () => {
  const html = build();
  assert.match(html, /미리보기/, '실제 보드로 오해하면 여기서 카드를 옮긴다');
  assert.match(html, /저장되지 않습니다/);
  assert.match(html, /작업지시.json/, '데이터 출처를 밝힌다');
});

test('미리보기에 내부 호스트가 들어가지 않는다', () => {
  const html = build();
  assert.ok(!/\.ts\.net|synologynas|192\.168\./.test(html), '공개 저장소다');
});

test('★ 커밋된 worklog.html 이 데이터와 같다 (재생성 필요 여부)', () => {
  const committed = fs.readFileSync(path.join(ROOT, 'im-agent', 'ui', 'platform', 'worklog.html'), 'utf8');
  assert.strictEqual(build(), committed,
    '작업지시.json 이나 board.html 이 바뀌었다 — `npm run im:worklog` 로 다시 만들어라');
});

test.after(() => { try { fs.rmSync(path.join(os.tmpdir(), 'noop'), { force: true }); } catch (_) {} });
