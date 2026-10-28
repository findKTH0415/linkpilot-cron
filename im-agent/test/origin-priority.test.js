/**
 * **올린 자료가 1순위다** 〈2026-08-24 사장님 지시:
 * 「업로드한 자료를 100% 초점을 맞추고 + 추가자료로는 AI 자동으로 보완적
 *  기능으로 재구성해줘」〉.
 *
 * ★★★ 앞 판은 값이 갈릴 때 **독립 출처 수**만 봤다(`sources.size * 10`).
 *   그래서 공공데이터·계산값이 여럿이면 **사장님이 올린 문서를 이겼다.**
 *   자료를 올린 사람에게는 「내 자료가 안 쓰였다」가 되는데, 출처 표시는
 *   멀쩡해서 **문서만 봐서는 안 잡힌다** — 이 저장소가 가장 무서워하는 결이다.
 *
 * ★ 여기서 재는 것:
 *   ① 올린 자료가 통상치·공공데이터를 **이긴다** (숫자가 밀려도)
 *   ② 진 값은 **사라지지 않는다** (alternatives · 충돌 기록)
 *   ③ 같은 등급끼리는 예전 규칙(출처 수 → 신뢰도) 그대로
 *   ④ 등급을 **밝힌 것과 짐작한 것**을 가른다
 *   ⑤ 확정값이 어디서 왔는지 **셀 수 있다** (tally)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { Dataset, Fact, ORIGIN, inferOrigin } = require('../core/facts.js');

const F = { area: { type: 'number', unit: '㎡' }, name: { type: 'string' } };
const ds = () => new Dataset('P', F);

test('★★★ 올린 자료가 통상치 셋을 이긴다 — 출처 수로는 지는데도', () => {
  const d = ds();
  ['A', 'B', 'C'].forEach((n) => d.add({ key: 'area', value: 100, source: `통상치 ${n} (04_financial)` }));
  d.add({ key: 'area', value: 250, source: '사업계획서.pdf', page: 3 });
  d.resolve();
  const w = d.get('area');
  assert.strictEqual(w.value, 250, '통상치가 올린 자료를 이겼다');
  assert.strictEqual(w.origin, 'document');
});

test('★★★ 올린 자료가 공공데이터도 이긴다 (공공데이터는 보완이다)', () => {
  const d = ds();
  d.add({ key: 'area', value: 100, source: '개별공시지가(2026년 고시)' });
  d.add({ key: 'area', value: 250, source: '사업계획서.pdf' });
  d.resolve();
  assert.strictEqual(d.get('area').value, 250);
});

test('★★★ 진 값은 사라지지 않는다 — 충돌은 이 시스템이 잡아야 할 신호다', () => {
  const d = ds();
  d.add({ key: 'area', value: 100, source: '통상치 (04_financial)' });
  d.add({ key: 'area', value: 250, source: '사업계획서.pdf' });
  d.resolve();
  const w = d.get('area');
  assert.strictEqual(w.alternatives.length, 1, '진 값을 통째로 버렸다');
  assert.strictEqual(w.alternatives[0].value, 100);
  assert.ok(d.conflicts.some((c) => c.type === 'VALUE_CONFLICT'),
    '값이 갈린 사실을 안 남겼다 — 조용히 고르면 안 된다');
  assert.strictEqual(w.verified, false, '충돌이 있는데 확인된 값으로 뒀다');
});

test('★★ 같은 등급끼리는 예전 규칙 그대로 — 출처가 많은 쪽이 이긴다', () => {
  const d = ds();
  d.add({ key: 'area', value: 100, source: 'a.pdf' });
  d.add({ key: 'area', value: 100, source: 'b.pdf' });
  d.add({ key: 'area', value: 250, source: 'c.pdf' });
  d.resolve();
  assert.strictEqual(d.get('area').value, 100);
  assert.strictEqual(d.get('area').verified, false, '갈렸는데 확인됨으로 올렸다');
});

test('★★ 자료가 없으면 통상치가 자리를 메운다 — 비워 두지 않는다', () => {
  const d = ds();
  d.add({ key: 'area', value: 100, source: '통상치 (04_financial)' });
  d.resolve();
  assert.strictEqual(d.get('area').value, 100);
  assert.strictEqual(d.get('area').origin, 'derived');
});

test('★★★ 등급을 밝히면 그대로 쓰고, 안 밝히면 짐작하되 **짐작했다고 적는다**', () => {
  const told = new Fact({ key: 'area', value: 1, source: '이름만 있는 것', origin: 'document' });
  assert.strictEqual(told.origin, 'document');
  assert.strictEqual(told.originGuessed, false);

  const guessed = new Fact({ key: 'area', value: 1, source: '이름만 있는 것' });
  assert.strictEqual(guessed.originGuessed, true, '짐작한 것을 밝힌 것처럼 뒀다');
});

test('★★★ 다시 만들어져도 짐작이었다는 사실을 잃지 않는다', () => {
  const a = new Fact({ key: 'area', value: 1, source: 'x.pdf' });   // 짐작
  const b = new Fact(a.toJSON());
  assert.strictEqual(b.origin, 'document');
  assert.strictEqual(b.originGuessed, true,
    '되살리면서 짐작이 「밝힌 값」으로 바뀌었다 — 확정값이 더 확실해 보인다');
});

test('★★ 짐작 규칙 — 파일 이름 · 접수문 · 에이전트 · 기관', () => {
  assert.strictEqual(inferOrigin('사업계획서.pdf'), 'document');
  assert.strictEqual(inferOrigin('user_request'), 'request');
  assert.strictEqual(inferOrigin('financial_model (04_financial)'), 'derived');
  assert.strictEqual(inferOrigin('매스 검토 Agent (09_massing)'), 'derived');
  assert.strictEqual(inferOrigin('한국은행 ECOS 국고채3년'), 'public');
  assert.strictEqual(inferOrigin(''), 'derived', '출처가 없으면 가장 낮게 본다');
});

test('★★★ 확정값이 어디서 왔는지 셀 수 있다 — 안 세면 통상치가 몇 개인지 모른다', () => {
  const d = ds();
  d.add({ key: 'area', value: 250, source: '사업계획서.pdf' });
  d.add({ key: 'name', value: '잠원동', source: 'user_request', origin: 'request' });
  d.resolve();
  const t = d.tally();
  assert.strictEqual(t.total, 2);
  assert.strictEqual(t.document, 1);
  assert.strictEqual(t.request, 1);
  assert.strictEqual(t.guessed, 1, '짐작한 값의 수를 안 센다');
});

test('★★ 등급표가 뜻대로 줄 세워져 있다 (자료 > 공공 > 접수 > 계산)', () => {
  assert.ok(ORIGIN.document > ORIGIN.public);
  assert.ok(ORIGIN.public > ORIGIN.request);
  assert.ok(ORIGIN.request > ORIGIN.derived);
});

/* ── 만드는 쪽이 밝히는가 ─────────────────────────────────── */

const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('★★★ 추출·접수·재무가 자기 등급을 **밝힌다** (짐작에 기대지 않는다)', () => {
  assert.ok(/origin: 'document'/.test(read('agents/02-extraction.js')),
    '올린 자료에서 읽은 값이라고 안 밝힌다 — 확장자 없는 이름이 오면 짐작이 틀린다');
  assert.ok(/origin: 'request'/.test(read('agents/01-project.js')), '접수문 등급을 안 밝힌다');
  assert.ok(/origin: 'derived'/.test(read('agents/04-financial.js')), '계산값 등급을 안 밝힌다');
});
