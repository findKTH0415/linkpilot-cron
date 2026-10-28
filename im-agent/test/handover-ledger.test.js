'use strict';
/**
 * handover-ledger — **빈 칸을 세는가, 그리고 채워진 척하지 않는가**
 * 〈2026-08-26 · 인수인계 완료검증 감사 게이트 13〉
 *
 * ★★★ 이 검사가 지키는 것 —
 *   **「지정되지 않았다」가 「지정되었다」로 새어 나가지 않는 것.**
 *   장부는 채워져 있으면 아무도 안 본다. 그래서 빈 칸을 못 세는 순간
 *   이 장부는 **거짓이 되고, 거짓 장부는 없는 장부보다 나쁘다.**
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const L = require('../tools/handover-ledger.js');

const HEAD = `| ${L.COLS.join(' | ')} |\n|${L.COLS.map(() => '---').join('|')}|\n`;
const row = (o) => `| ${L.COLS.map((c) => o[c] || '미지정').join(' | ')} |\n`;

/* ───────────── 빈 칸을 센다 ───────────── */

test('★★★ 비어 있으면 「다 됐다」가 안 나온다', () => {
  const rows = L.parse(HEAD + row({ 번호: '1', 항목: 'ㄱ', 상태: 'NOT_STARTED', 중요도: 'HIGH' }));
  const c = L.count(rows);
  assert.strictEqual(c.ready, false);
  assert.strictEqual(c.assigned, 0);
  assert.deepStrictEqual(c.noGiver, ['1']);
  assert.deepStrictEqual(c.noTaker, ['1']);
  assert.deepStrictEqual(c.noDate, ['1']);
});

test('★★★ 셋을 다 채우면 열린다 — 늑대야가 되면 안 된다', () => {
  const rows = L.parse(HEAD + row({
    번호: '1', 항목: 'ㄱ', 상태: 'PARTIAL', 중요도: 'HIGH',
    인계자: '김', 인수자: '박', 목표일: '2099-01-01',
  }));
  const c = L.count(rows);
  assert.strictEqual(c.ready, true, '채웠는데도 안 열리면 아무도 안 채운다');
  assert.strictEqual(c.assigned, 1);
});

test('★★ 하나만 비어도 안 열린다 — 인수자 없는 항목은 완료가 아니다 (지침 §6)', () => {
  const rows = L.parse(HEAD + row({
    번호: '1', 항목: 'ㄱ', 상태: 'PARTIAL', 중요도: 'HIGH',
    인계자: '김', 목표일: '2099-01-01',       // 인수자만 미지정
  }));
  assert.strictEqual(L.count(rows).ready, false);
});

test('★★ 빈 칸을 적는 말이 여러 가지여도 다 잡는다', () => {
  for (const v of ['미지정', '-', '—', '']) {
    assert.strictEqual(L.unset(v), true, `${JSON.stringify(v)} 를 못 잡는다`);
  }
  assert.strictEqual(L.unset('김대표'), false);
  assert.strictEqual(L.unset(' 박 '), false);
});

/* ───────────── 끝난 것은 안 센다 ───────────── */

test('★★ ACCEPTED 는 빈 칸을 안 센다 — 끝난 것을 계속 외치면 아무도 안 본다', () => {
  const rows = L.parse(HEAD
    + row({ 번호: '1', 항목: 'ㄱ', 상태: 'ACCEPTED', 중요도: 'LOW' })
    + row({ 번호: '2', 항목: 'ㄴ', 상태: 'PARTIAL', 중요도: 'HIGH', 인계자: '김', 인수자: '박', 목표일: '2099-01-01' }));
  const c = L.count(rows);
  assert.strictEqual(c.total, 2);
  assert.strictEqual(c.open, 1);
  assert.strictEqual(c.done, 1);
  assert.strictEqual(c.ready, true, '끝난 줄의 빈 칸까지 세면 영영 안 열린다');
});

/* ───────────── 잘못 적은 것을 잡는다 ───────────── */

test('★★★ 모르는 상태·중요도를 **조용히 넘기지 않는다**', () => {
  // 오타 하나로 그 줄이 판정에서 빠지면, 채운 줄과 구분이 안 된다
  const rows = L.parse(HEAD + row({
    번호: '1', 항목: 'ㄱ', 상태: 'DONE', 중요도: '높음',
    인계자: '김', 인수자: '박', 목표일: '2099-01-01',
  }));
  const c = L.count(rows);
  assert.strictEqual(c.badState.length, 1, 'DONE 은 지침 §5 의 상태가 아니다');
  assert.strictEqual(c.badSev.length, 1, '「높음」은 지침 §5 의 중요도가 아니다');
  assert.strictEqual(c.ready, false, '오타가 있는 장부를 「다 됐다」로 읽으면 안 된다');
});

test('★★★ 「곧」·「이번 주」는 목표일이 아니다 — 지나갔는지를 잴 수 없다', () => {
  const rows = L.parse(HEAD + row({
    번호: '1', 항목: 'ㄱ', 상태: 'PARTIAL', 중요도: 'HIGH',
    인계자: '김', 인수자: '박', 목표일: '이번 주',
  }));
  const c = L.count(rows);
  assert.strictEqual(c.badDate.length, 1);
  assert.strictEqual(c.ready, false);
});

test('★★ 목표일이 지난 것을 센다 — 적어 놓고 지나가면 안 적은 것과 같다', () => {
  const saved = process.env.LP_TODAY;
  process.env.LP_TODAY = '2026-09-01';
  try {
    const rows = L.parse(HEAD
      + row({ 번호: '1', 항목: 'ㄱ', 상태: 'PARTIAL', 중요도: 'HIGH', 인계자: '김', 인수자: '박', 목표일: '2026-08-20' })
      + row({ 번호: '2', 항목: 'ㄴ', 상태: 'PARTIAL', 중요도: 'LOW', 인계자: '김', 인수자: '박', 목표일: '2026-12-01' }));
    const c = L.count(rows);
    assert.strictEqual(c.overdue.length, 1);
    assert.strictEqual(c.overdue[0].no, '1');
    assert.strictEqual(c.ready, true, '지난 것이 있어도 「지정은 됐다」 — 둘은 다른 사실이다');
    assert.match(L.line(c), /목표일이 지난 것 1건/, '지난 것을 말하지 않으면 아무도 모른다');
  } finally {
    if (saved === undefined) delete process.env.LP_TODAY; else process.env.LP_TODAY = saved;
  }
});

/* ───────────── 문서에 다른 표가 생겨도 안 섞인다 ───────────── */

test('★★★ 머리글이 있는 표만 읽는다 — 설명용 표를 항목으로 세지 않는다', () => {
  // 앞 판의 등록부 검사가 본문의 「견주는 표」를 결정으로 세다 헛울음이 났다.
  const doc = '| 칸 | 뜻 |\n|---|---|\n| 중요도 | 지침 §5 |\n\n' + HEAD
    + row({ 번호: '1', 항목: 'ㄱ', 상태: 'PARTIAL', 중요도: 'HIGH' });
  const rows = L.parse(doc);
  assert.strictEqual(rows.length, 1, '설명용 표까지 세면 건수가 거짓이 된다');
  assert.strictEqual(rows[0].항목, 'ㄱ');
});

/* ───────────── 실제 대장 ───────────── */

test('★★ 저장소의 대장이 읽히고, 상태·중요도에 오타가 없다', () => {
  assert.ok(fs.existsSync(L.LEDGER), '관리대장 파일이 없다');
  const rows = L.parse();
  assert.ok(rows && rows.length > 0, '대장의 표를 못 읽었다');
  const c = L.count(rows);
  assert.deepStrictEqual(c.badState, [], `모르는 상태: ${JSON.stringify(c.badState)}`);
  assert.deepStrictEqual(c.badSev, [], `모르는 중요도: ${JSON.stringify(c.badSev)}`);
  assert.deepStrictEqual(c.badDate, [], `날짜 꼴이 아닌 목표일: ${JSON.stringify(c.badDate)}`);
});

test('★ 이름을 지어내지 않는다 — 코드에 사람 이름이 박혀 있으면 안 된다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'handover-ledger.js'), 'utf8')
    // 주석을 떼고 본다 (CLAUDE.md §8)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/기본\s*담당자|DEFAULT_OWNER|기본값.*담당/.test(src),
    '기본 담당자를 두면 장부가 채워진 척한다');
});
