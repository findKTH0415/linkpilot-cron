'use strict';
/**
 * check-model.test.js — 설계 협력사 산출물 검사 (등록부 D-37 · D-38).
 *
 * 2026-08-16 에 둘을 결정했다 — 형상에서 물량을 계산하지 않고(D-37), Rhino 서버도
 * 세우지 않는다(D-38). 둘 다 **협력사가 만든 것을 받는다**는 뜻이다.
 *
 * ★ **받는다는 결정에는 검사가 따라와야 한다.** 안 그러면 「받았다」와 「쓸 수
 *   있다」가 같은 말이 되는데, 실제로는 **파일이 멀쩡하고 형상도 다 들어 있는데
 *   수량만 없는 경우**가 흔하다. 그 상태로 파이프라인에 넣으면 물량이 「없음」으로
 *   남고, 사람은 파일을 줬으니 된 줄 안다.
 *
 * 그래서 여기서 못 박는 것은 셋이다.
 *   ① 수량 없는 파일을 **통과시키지 않는가**
 *   ② 무엇을 켜야 하는지 **도구별 위치까지** 말하는가
 *   ③ 값을 안 찍는가 — 협력사가 돌린 출력이 그대로 붙어 와도 딜 정보가 안 새야 한다
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const checker = require('../tools/check-model');
const ifc = require('../core/ifc');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.ifc');
const SAMPLE = fs.readFileSync(FIXTURE, 'utf8');

function tmpFile(content, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkmodel-'));
  const p = path.join(dir, name || 'model.ifc');
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

/* ═════════ ① 수량 없는 파일을 통과시키지 않는다 ═════════ */

test('★ 수량이 들어 있으면 통과한다', () => {
  const r = checker.check(FIXTURE);
  assert.strictEqual(r.ok, true, r.problems.join(' / '));
  assert.strictEqual(r.schema, 'IFC4');
  assert.ok(r.totals.grossArea > 0);
});

/**
 * ★ **이 검사가 이 파일의 본체다.** 형상은 다 들어 있고 파일도 멀쩡하다 —
 *   수량만 없다. 통과시키면 물량 없이 견적이 나간다.
 */
test('★ 형상은 있는데 수량만 없는 파일을 막는다', () => {
  // 수량 실체만 빼고 나머지는 그대로 둔다 (실무에서 나오는 모양 그대로)
  const stripped = SAMPLE.replace(/IFCQUANTITY(AREA|VOLUME|LENGTH|COUNT)/g, 'IFCPROPERTYSINGLEVALUE');
  const r = checker.check(tmpFile(stripped));
  assert.strictEqual(r.ok, false, '수량 없는 파일이 통과했다');
  assert.ok(r.elementCount > 0, '부재는 읽혔어야 한다 — 파일 자체는 멀쩡하다');
  assert.ok(r.problems.some(p => /Base Quantities|기본 수량/.test(p)));
  assert.ok(r.problems.some(p => /형상에서 물량을 새로 계산하지는 않는다/.test(p)),
    '왜 우리가 못 재는지 말해야 다음 행동이 정해진다');
});

/** ★ 파서와 **같은 문구**를 쓴다 — 두 벌로 두면 한쪽만 고치는 날 갈린다 */
test('★ 반려 문구를 파서에서 가져온다 (두 벌로 두지 않는다)', () => {
  const stripped = SAMPLE.replace(/IFCQUANTITY(AREA|VOLUME|LENGTH|COUNT)/g, 'IFCPROPERTYSINGLEVALUE');
  const fromParser = ifc.read(Buffer.from(stripped), { name: 'x.ifc' }).reason;
  assert.strictEqual(checker.check(tmpFile(stripped)).problems[0], fromParser);
});

test('IFC 가 아니면 그렇게 말한다', () => {
  const r = checker.check(tmpFile('이건 그냥 텍스트다', 'x.ifc'));
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.length);
});

test('파일이 없으면 조용히 통과하지 않는다', () => {
  const r = checker.check('/없는/경로/model.ifc');
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /열지 못했다/.test(p)));
});

/* ═════════ ② 어디를 켜야 하는지 말한다 ═════════ */

/**
 * ★ 「Base Quantities 를 켜세요」만으로는 어디 있는지 찾느라 하루가 간다.
 *   협력사가 쓰는 도구가 무엇이든 자기 줄을 찾을 수 있어야 한다.
 */
test('★ 도구별 메뉴 위치를 알려 준다', () => {
  const hint = checker.EXPORT_HINT.join('\n');
  ['Revit', 'ArchiCAD', 'Rhino'].forEach(t => assert.ok(hint.includes(t), `${t} 안내가 없다`));
  assert.match(hint, /Export base quantities/);
});

/* ═════════ ③ 값을 찍지 않는다 ═════════ */

/**
 * ★ 이 출력은 **협력사가 돌려서 우리에게 붙여 넣는다.** 부재명·주소가 섞여 나오면
 *   딜 정보가 그 경로로 샌다. 합계와 개수까지만 낸다.
 */
test('★ 부재명·식별자를 결과에 담지 않는다', () => {
  const r = checker.check(FIXTURE);
  const dumped = JSON.stringify(r);
  assert.ok(!/GlobalId|0aBcDe/.test(dumped), 'IFC 식별자가 결과에 남았다');
  // 파일명은 남긴다 — 어느 파일인지 몰라도 되면 검사가 소용없다
  assert.strictEqual(r.file, 'sample.ifc');
  assert.ok(!('elements' in r), '부재 목록을 통째로 담고 있다');
});

/* ═════════ 막지는 않지만 봐야 하는 것 ═════════ */

/**
 * ★ 모델 단위가 mm 면 면적이 **백만 배**로 들어온다. 숫자가 커도 우리는 못
 *   알아본다 — 그래서 짚어 준다. 다만 **단정하지 않는다**: 진짜 초대형 단지일
 *   수도 있고, 단정하면 멀쩡한 모델을 되돌려 보내게 된다.
 */
test('★ 단위가 mm 로 의심되면 짚어 주되 단정하지 않는다', () => {
  const big = checker.suspiciousUnits({ grossArea: 2.4e8 });
  assert.ok(big, '백만 배로 들어온 면적을 안 짚었다');
  assert.match(big, /확인해 주십시오/, '단정하면 멀쩡한 모델을 반려하게 된다');
  assert.match(big, /mm/);
  assert.strictEqual(checker.suspiciousUnits({ grossArea: 52000 }), null, '정상 규모를 반려하면 안 된다');
});

test('이름을 알아보지 못한 수량을 알려 준다 (물량이 왜 적은지 알 수 있게)', () => {
  const r = checker.check(FIXTURE);
  assert.ok(r.notes.some(n => /알아보지 못한 수량/.test(n)),
    '못 센 수량을 안 알리면 적은 물량이 그대로 견적이 된다');
});

test('경고는 통과를 막지 않는다 (봐야 할 것과 못 쓰는 것은 다르다)', () => {
  const r = checker.check(FIXTURE);
  assert.strictEqual(r.ok, true);
  assert.ok(r.notes.length > 0);
});

/* ═════════ 결정이 문서·코드에 남아 있는가 ═════════ */

test('★ 규격 문서가 있고 협력사에 보낼 수 있는 내용이다', () => {
  const spec = path.join(__dirname, '..', '..', checker.SPEC);
  assert.ok(fs.existsSync(spec), '받는다고 정해 놓고 무엇을 받는지 적지 않았다');
  const s = fs.readFileSync(spec, 'utf8');
  assert.match(s, /D-37/);
  assert.match(s, /D-38/);
  assert.match(s, /Base Quantities/);
  assert.match(s, /im:check-model/, '협력사가 보내기 전에 돌릴 방법을 적어야 한다');
  // D-38 쪽 — .3dm 을 안 받고 무엇을 받는지
  assert.match(s, /전제 조건/, '매스는 전제에 따라 연면적이 크게 갈린다');
  assert.match(s, /생성물/, '공부에서 온 값과 다른 칸에 둔다는 사실이 있어야 한다');
});

test('★ Rhino 커넥터가 「안 세우기로 했다」고 말한다 (「미설정」만 있으면 설정하면 되는 줄 안다)', async () => {
  const saved = process.env.RHINO_COMPUTE_URL;
  delete process.env.RHINO_COMPUTE_URL;
  try {
    const rhino = require('../connectors/rhino');
    const r = await rhino.solve({ definition: { pointer: 'm.gh' }, inputs: { 대지면적: 12000 } });
    assert.strictEqual(r.unavailable, true);
    assert.match(r.error, /서버를 세우지 않고 설계 협력사 결과를 받는다/);
    assert.match(r.error, /규격/, '무엇을 받는지 어디를 보면 되는지 말해야 한다');
  } finally {
    if (saved !== undefined) process.env.RHINO_COMPUTE_URL = saved;
  }
});

test('★ 커넥터를 지우지 않았다 (나중에 세우면 주소만 넣으면 된다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'rhino.js'), 'utf8');
  assert.match(src, /이 파일은 지우지 않는다/);
  assert.match(src, /만 넣으면 그대로 돈다/, '나중에 세울 때 무엇만 하면 되는지 적어야 한다');
});

test('★ 등록부에 두 결정이 기록되어 있다', () => {
  // ★ 경로는 `core/registry-doc.js` 한 곳에서 온다 〈2026-08-26 · D-134〉 —
  //   표가 `docs/결정-기록.md` 로 떨어져 나갔다. 본문(경위)은 등록부에 그대로다.
  const R = require('../core/registry-doc.js');
  const reg = R.read(R.REGISTRY);
  assert.match(reg, /### ✅ D-37\./, '결정된 항목을 ✅ 로 바꿔야 한다');
  assert.match(reg, /### ✅ D-38\./);
  // CLAUDE.md §9 — 결정일·결정자·반영 커밋을 결정 기록 표에 남긴다
  const table = R.decided();
  assert.ok(table.includes('D-37'), '결정 기록 표에 없다 (§9)');
  assert.ok(table.includes('D-38'));
});

test('npm 스크립트가 걸려 있다 (문서가 가리키는 명령이 실제로 있어야 한다)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['im:check-model'], '규격 문서가 없는 명령을 안내하고 있다');
});
