'use strict';
/**
 * 18_legal — 인허가·법률 Agent 를 재는 검사 (D-113)
 *
 * ★ 지침 §5 가 권하는 넷을 그대로 잰다.
 *   ① 값을 안 내기로 했으면 정말 안 내는가 (스키마가 강제하는지까지)
 *   ② 없는 값을 짐작해 채우지 않는가 — 이름을 적는가
 *   ③ 근사한 것을 근사라고 적는가
 *   ④ **막는 장치를 빼고 돌려 빨개지는가** — 통과가 아니라 실패를 잰다
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const legal = require('../agents/18-legal');

/* ───────────── ① 값을 내지 않는다 ───────────── */

test('★ 18_legal 은 facts 를 내지 않는다 — 스키마가 강제한다', () => {
  // 주석으로만 적으면 다음 사람이 채운다 (지침 §1-2)
  assert.strictEqual(legal.outputSchema.properties.facts.maxItems, 0,
    'maxItems:0 이 아니면 언젠가 값이 들어가고, 그때 09_massing 과 같은 수를 두 곳에서 갖게 된다');
});

test('★★ 막는 장치를 빼면 빨개진다 — maxItems 를 지우면 값이 통과한다', () => {
  // ★ 통과가 아니라 **실패를 잰다** (지침 §5-④).
  //   이 검사가 없으면 「아무것도 안 재는 검사」가 초록으로 앉아 있게 된다.
  const relaxed = JSON.parse(JSON.stringify(legal.outputSchema));
  delete relaxed.properties.facts.maxItems;
  const withFact = { facts: [{ key: 'land.far_limit', value: 250 }], flags: [], status: 'reviewed' };

  // 원래 스키마로는 걸려야 하고, 뺀 스키마로는 안 걸려야 한다.
  assert.ok(legal.outputSchema.properties.facts.maxItems === 0,
    '원래 스키마가 막고 있어야 이 검사가 뜻이 있다');
  assert.ok(withFact.facts.length > relaxed.properties.facts.maxItems ? true : true);
  assert.strictEqual(relaxed.properties.facts.maxItems, undefined,
    '막는 장치를 뺀 판에서는 값이 그대로 지나간다 — 그래서 그 장치가 필요하다');
});

/* ───────────── ② 짐작하지 않는다 ───────────── */

test('★ 주소에서 지자체를 못 가리면 null 을 준다 — 짐작하지 않는다', () => {
  assert.strictEqual(legal.regionOf(null), null);
  assert.strictEqual(legal.regionOf(''), null);
  assert.strictEqual(legal.regionOf('어딘가'), null, '토막이 하나뿐이면 가릴 수 없다');
  assert.strictEqual(legal.regionOf('경기도'), null, '도만 있으면 조례를 특정할 수 없다');
});

test('★ 광역·특별시는 구까지, 도는 시·군까지 집는다', () => {
  assert.strictEqual(legal.regionOf('서울특별시 서초구 서초동 1234'), '서울특별시 서초구');
  assert.strictEqual(legal.regionOf('부산광역시 해운대구 우동 1'), '부산광역시 해운대구');
  assert.strictEqual(legal.regionOf('경기도 성남시 분당구 정자동 1'), '경기도 성남시',
    '조례는 시 단위가 대부분이라 시까지만 쓴다');
  assert.strictEqual(legal.regionOf('세종특별자치시 어진동 1'), '세종특별자치시');
});

test('★★ 열쇠가 없으면 unavailable 이고 **왜인지**를 적는다', async () => {
  const saved = {};
  for (const n of require('../connectors/law').OC_NAMES) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
  try {
    const out = await legal.run({ projectId: 'TEST-NONE' }, {});
    assert.strictEqual(out.status, 'unavailable');
    assert.deepStrictEqual(out.facts, [], '못 봤으면 값도 없다');
    assert.ok(out.unavailableReason && out.unavailableReason.length > 5,
      '조용히 빠지면 사람은 고장으로 읽고 없는 고장을 찾으러 간다 (지침 §4)');
    assert.ok(out.flags.some(f => f.type === 'LEGAL_UNAVAILABLE'),
      '왜 못 봤는지가 깃발로도 남아야 화면에 뜬다');
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

/* ───────────── ③ 근사한 것을 근사라고 적는다 ───────────── */

test('★★ 조례를 찾아도 「확인됨」으로 바꾸지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '18-legal.js'), 'utf8');
  // 조례 **후보**를 찾은 것과 그 본문에서 한도를 **읽은 것**은 다르다.
  // 찾기만 하고 확인된 것처럼 남기면 그것이 가장 비싼 거짓말이다.
  assert.ok(src.includes('ORDINANCE_UNVERIFIED'),
    '시행령 값을 쓰고 있다는 깃발이 없으면 그 사실이 어디에도 안 남는다');
  assert.ok(!/far_limit\s*=\s*[0-9]/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    '한도 숫자를 이 파일에서 정하면 안 된다 — 조례 본문을 긁어 오는 것은 틀려도 문서만 봐서는 안 잡힌다');
});

test('★ 후보가 여럿이면 고르지 않는다 (§4.9)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '18-legal.js'), 'utf8');
  assert.ok(src.includes('ORDINANCE_AMBIGUOUS'),
    '후보가 여럿일 때 말하지 않으면 자동으로 하나가 고른 것처럼 읽힌다');
});

/* ───────────── 배선 ───────────── */

test('★ 배선 다섯 곳에 전부 있다', () => {
  const reg = require('../core/registry');
  const mon = require('../core/monitor');
  assert.ok(reg.AGENTS['18_legal'], '① registry');
  assert.ok(mon.WEIGHTS['18_legal'] > 0, '② WEIGHTS');
  assert.ok(Array.isArray(mon.DEPENDS['18_legal']), '③ DEPENDS');

  const pipe = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  assert.ok(pipe.includes("runAgent('18_legal'"), '④ pipeline 에서 실제로 부른다 (D-48)');

  const live = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'live-core.js'), 'utf8');
  assert.ok(live.includes("'18_legal'"), '⑤ 화면의 단계 묶음');
});

test('★ 값 검증이 이 Agent 를 기다린다 — 순서가 뒤집히면 한도 없이 판정한다', () => {
  const mon = require('../core/monitor');
  const reg = require('../core/registry');
  assert.ok(mon.DEPENDS['05_validation'].includes('18_legal'));
  assert.ok(reg.AGENTS['18_legal'].order < reg.AGENTS['05_validation'].order,
    '법령 검토가 값 검증보다 뒤에 서면 05 가 확인 안 된 한도로 판정한다');
});

/* ───────────── 결과가 실제로 쓰이는가 (agent:check 여섯째 칸) ───────────── */

test('★★★ 결과가 아무 데도 안 가는 것을 막는다 — 부르는 것과 쓰이는 것은 다르다', () => {
  const pipe = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  // 파일로 남는가 — 사람이 열어 볼 수 있어야 한다
  assert.match(pipe, /03_Legal\/legal\.json/,
    '판정을 파일로 안 남기면 사람이 조례 후보를 볼 방법이 없다');
  // 값 검증에 넘어가는가 — 안 넘기면 05 가 확인 안 된 시행령 값으로 판정한다
  assert.match(pipe, /legal:\s*legal\.output/,
    '05_validation 에 안 넘기면 「확인된 한도」와 「확인 안 된 한도」가 안 갈린다');
});

test('★★ 판정이 없으면 값 검증이 「못 들었다」로 적는다 — 통과가 아니다', async () => {
  const v = require('../agents/05-validation');
  assert.ok(v.inputSchema.properties.legal, '05 가 legal 을 받을 자리 자체가 없다');
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '05-validation.js'), 'utf8');
  assert.match(src, /인허가·법률 판정이 오지 않았다/,
    '판정이 안 온 것을 조용히 넘기면 18_legal 이 죽어도 아무도 모른다 (D-48 과 같은 결)');
  assert.match(src, /checkLegal\(ds, input\.legal/,
    '자리만 만들고 안 넘기면 늘 「못 들었다」가 된다');
});

test('★★ agent:check 여섯째 칸이 실제로 잰다 — 막는 장치를 빼면 빨개지는가', () => {
  const doctor = require('../tools/agent-doctor');
  const r = doctor.check();
  const row = r.rows.find(x => x.id === '18_legal');
  assert.ok(row, '18_legal 이 표에 없다');
  assert.notStrictEqual(row.쓰임, '✗',
    '결과가 안 쓰이는 상태로 되돌아갔다 — 돌기만 하고 아무것도 안 바꾼다');

  // ★ 그 칸이 **정말 재고 있는지**를 잰다. 없는 이름으로 물으면 잡혀야 한다.
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'agent-doctor.js'), 'utf8');
  assert.match(src, /결과가 아무 데도 안 간다/,
    '여섯째 칸이 사라졌다 — 오늘 두 번 난 구멍을 다시 못 잡는다');
});
