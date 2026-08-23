/**
 * **자료를 정말 읽었는가**를 화면이 말할 수 있는가.
 *
 * ★★ 2026-08-23 사장님: 「데이터를 정말 스캔했는지 모르겠다 알수 있는 방법이
 *   좋을듯」. 앞 판의 4단계는 **빈 입력칸 목록**으로 시작했다. 자료를 읽어
 *   값이 들어와 있어도 화면은 똑같이 생겼다 — 「스캔했습니다」라는 말만 있고
 *   **몇 개가 어느 파일에서 나왔는지**가 없었다.
 *
 * ★ 여기서 재는 것은 셋이다:
 *   ① 값에서 증거를 만든다 (별도 기록을 믿지 않는다)
 *   ② 값이 안 나온 자료를 **감추지 않는다**
 *   ③ 「자료에서 읽은 값」과 「자동으로 채운 값」을 **가른다**
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const F = require('../ui/platform/fields-core.js');

const VALUES = {
  'project.name': { value: '새만금 태양광', source: '사업계획서.pdf', page: 1 },
  'land.areaM2': { value: 120000, source: '사업계획서.pdf', page: 12 },
  'capacity.mw': { value: 120, source: '토지이용계획.pdf', page: 3 },
  'debt.rate': { value: 4.2, source: '' },
  'equity.amount': { value: '', source: '' },
};
const FILES = ['사업계획서.pdf', '토지이용계획.pdf', '등기부.png'];

test('★★★ 값이 어느 자료에서 몇 개 나왔는지 센다', () => {
  const ev = F.readEvidence(VALUES, FILES);
  assert.strictEqual(ev.total, 4, '값이 있는 항목 수');
  assert.deepStrictEqual(ev.bySource.map((b) => [b.source, b.count]), [
    ['사업계획서.pdf', 2],
    ['토지이용계획.pdf', 1],
  ], '많이 나온 자료가 앞에 온다');
  assert.deepStrictEqual(ev.bySource[0].pages, ['1', '12']);
});

test('★★★ 올렸는데 값이 하나도 안 나온 자료를 따로 적는다', () => {
  const ev = F.readEvidence(VALUES, FILES);
  assert.deepStrictEqual(ev.unusedFiles, ['등기부.png'],
    '헛돈 자료를 감추면 「10개 올렸는데 값 3개」의 원인을 못 찾는다');
});

test('★★ 출처 없는 값을 따로 센다 — 이대로는 저장되지 않는다', () => {
  assert.strictEqual(F.readEvidence(VALUES, FILES).noSource, 1);
});

test('★★ 빈 값은 세지 않는다 — 0 과 빈 칸은 다르다', () => {
  const ev = F.readEvidence({
    a: { value: 0, source: 'x.pdf' },
    b: { value: '', source: 'x.pdf' },
    c: { value: null, source: 'x.pdf' },
    d: { value: undefined, source: 'x.pdf' },
  }, []);
  assert.strictEqual(ev.total, 1, '0 은 값이다. 빈 칸·null·undefined 는 아니다');
});

test('★ 자료가 없으면 0 으로 답한다 — 던지지 않는다', () => {
  const ev = F.readEvidence(null, null);
  assert.deepStrictEqual(ev, { total: 0, bySource: [], unusedFiles: [], noSource: 0 });
});

test('★★★ 자료에서 읽은 값과 자동으로 채운 값을 가른다', () => {
  /* fill 은 fields-core 의 AUTO_FILLS 에 있는 것이어야 자동으로 센다 */
  const plan = { 'auto.key': { fill: 'public', label: '공공데이터', why: '' } };
  assert.strictEqual(F.originOf('project.name', VALUES['project.name'], plan, []).kind, 'read');
  assert.strictEqual(F.originOf('debt.rate', VALUES['debt.rate'], plan, []).kind, 'typed');
  assert.strictEqual(F.originOf('equity.amount', VALUES['equity.amount'], plan, []).kind, 'empty');
  assert.strictEqual(F.originOf('auto.key', { value: 7, source: '' }, plan, []).kind, 'auto');
  assert.strictEqual(F.originOf('returns.irr', { value: 9 }, plan, ['returns.irr']).kind, 'computed');
});

test('★★ 읽은 값에는 출처와 페이지가 함께 나온다 — 값만 보여주지 않는다', () => {
  const o = F.originOf('land.areaM2', VALUES['land.areaM2'], null, []);
  assert.strictEqual(o.label, '사업계획서.pdf');
  assert.strictEqual(o.page, 12);
});

test('★★ splitByOrigin 이 네 갈래로 나눈다', () => {
  const s = F.splitByOrigin(Object.keys(VALUES), VALUES, null, []);
  assert.deepStrictEqual(s.read, ['project.name', 'land.areaM2', 'capacity.mw']);
  assert.deepStrictEqual(s.typed, ['debt.rate']);
  assert.deepStrictEqual(s.empty, ['equity.amount']);
});

/* ── 화면이 실제로 그것을 그리는가 ─────────────────────────── */

function screen() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'ui', 'platform', 'fields.html'), 'utf8');
}
/** 주석을 떼고 본다 — 경위를 잘 적어 둘수록 검사가 눈이 먼다 (CLAUDE.md §8) */
function code() {
  return screen().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('★★★ 4단계가 읽은 값 요약을 그린다', () => {
  const c = code();
  assert.ok(c.indexOf('evidenceCard') !== -1, '요약 패널이 없다');
  assert.ok(c.indexOf('F.readEvidence') !== -1, '증거를 값에서 만들지 않는다');
  assert.ok(c.indexOf('state.readAt') !== -1, '언제 읽었는지를 안 쓴다');
});

test('★★★ 값이 하나도 없으면 **없다고 말한다** — 빈 목록으로 두지 않는다', () => {
  assert.ok(code().indexOf('아직 읽은 자료가 없습니다') !== -1);
  assert.ok(code().indexOf('값이 하나도 안 나왔습니다') !== -1);
});

test('★★★ 값이 없는 항목은 「자료에서 안 나왔습니다」로 적는다 — 빈 칸으로 두지 않는다', () => {
  assert.ok(code().indexOf('자료에서 안 나왔습니다') !== -1,
    '빈 입력칸만 두면 안 나온 것과 아직 안 그린 것이 똑같이 생긴다');
});

test('★★★ 입력 상자는 고칠 때만 열린다 (사장님 지시: 입력필드를 없애고 분석값으로)', () => {
  const c = code();
  assert.ok(c.indexOf('state.editing[key]') !== -1, '편집 상태가 없다');
  assert.ok(/if \(!state\.editing\[key\]\) \{/.test(c),
    '기본이 읽는 판이 아니다 — 입력 상자가 늘 열려 있으면 읽은 값과 빈 칸이 똑같이 생긴다');
  assert.ok(c.indexOf('고치기 닫기') !== -1,
    '한 번 연 줄을 닫는 길이 없으면 화면이 옛 모습으로 돌아간다');
});

test('★★ 서버가 읽은 시각과 충돌 건수를 준다', () => {
  const api = fs.readFileSync(
    path.join(__dirname, '..', 'ui', 'report-api.cjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(api.indexOf('readAt:') !== -1, 'getFacts 가 읽은 시각을 안 준다');
  assert.ok(api.indexOf('conflicts:') !== -1, 'getFacts 가 충돌 건수를 안 준다');
});
