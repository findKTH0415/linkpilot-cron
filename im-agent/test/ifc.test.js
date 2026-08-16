'use strict';
/**
 * ifc.test.js — IFC 모델에서 수량을 읽는다.
 *
 * 이 파서의 실패는 **조용하다.** 세미콜론 하나를 잘못 자르면 그 줄부터
 * 어긋나는데, 결과는 여전히 숫자로 나온다 — 「부피 12.5㎥」가 그럴듯하게
 * 찍히고 문서만 봐서는 틀린 줄 모른다. 그래서 잘리는 지점을 테스트로 고정한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ifc = require('../core/ifc');
const ex = require('../agents/02-extraction');

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.ifc'));

test('★ 모델이 들고 있는 수량을 읽는다', () => {
  const r = ifc.read(SAMPLE, { name: 'sample.ifc' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.schema, 'IFC4');
  assert.strictEqual(r.hasQuantities, true);

  const by = {};
  r.elements.forEach((e) => { by[e.label] = e; });
  assert.strictEqual(by['벽'].quantities.netVolume, 12.5);
  assert.strictEqual(by['벽'].quantities.grossArea, 48);
  assert.strictEqual(by['슬래브'].quantities.grossArea, 320);
  assert.strictEqual(r.totals.netVolume, 76.5, '부재별 수량이 합계로 모여야 한다');
});

/**
 * ★ 한 실체가 여러 줄에 걸친 파일이 흔하다 (내보내기 도구마다 줄 길이가 다르다).
 *   줄바꿈으로 자르면 그 실체를 통째로 놓치고, 물량만 조용히 줄어든다.
 */
test('★ 여러 줄에 걸친 실체를 놓치지 않는다', () => {
  const r = ifc.read(SAMPLE);
  const slab = r.elements.find(e => e.label === '슬래브');
  assert.ok(slab, '두 줄로 쓰인 IFCELEMENTQUANTITY 를 놓쳤다');
  assert.strictEqual(slab.quantities.netVolume, 64);
});

/**
 * ★ 부재명에 세미콜론·쉼표가 들어 있는 파일이 실제로 있다 (주소·구간 표기).
 *   문자열 안인지 밖인지를 안 지키면 그 줄부터 전부 어긋난다.
 */
test('★ 문자열 안의 세미콜론에 잘리지 않는다', () => {
  const r = ifc.read(SAMPLE);
  assert.strictEqual(r.elements.reduce((a, e) => a + e.count, 0), 2,
    '문자열 안의 ; 에서 잘렸다면 부재 수가 달라진다');
});

/** ★ 한글 부재명은 `\\X2\\...\\X0\\` 로 인코딩되어 온다. 안 풀면 화면에 그대로 나간다 */
test('★ STEP 인코딩된 한글을 되돌린다', () => {
  const wall = "#1=IFCWALL('0aBcDeFgHiJkLmNoPqRsT0',$,'\\X2\\C678BD80BCBD\\X0\\',$,$,$,$,$);";
  const doc = `ISO-10303-21;\nFILE_SCHEMA(('IFC4'));\nDATA;\n${wall}\nENDSEC;`;
  const r = ifc.read(doc);
  assert.strictEqual(r.ok, true);
  // 이름 자체는 요약에 안 나오지만, 인코딩이 안 풀리면 파싱 중에 깨진다
  assert.ok(!JSON.stringify(r).includes('\\X2\\'), 'STEP 인코딩이 그대로 남아 있다');
});

/**
 * ★ **수량이 없는 IFC 를 0 으로 돌려주지 않는다.**
 *   0 을 주면 「물량 0」으로 읽혀 견적이 통째로 비어도 정상처럼 보인다.
 */
test('★ 수량이 없으면 0 이 아니라 「없다」고 말한다', () => {
  const doc = "ISO-10303-21;\nFILE_SCHEMA(('IFC2X3'));\nDATA;\n"
    + "#1=IFCWALL('0aBcDeFgHiJkLmNoPqRsT0',$,'W1',$,$,$,$,$);\nENDSEC;";
  const r = ifc.read(doc);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.hasQuantities, false);
  assert.deepStrictEqual(r.totals, {});
  assert.match(r.reason, /Base Quantities|기본 수량/, '무엇을 켜서 다시 내보내면 되는지 적어야 한다');
  assert.match(r.reason, /형상에서 물량을 새로 계산하지는 않는다/,
    '왜 우리가 못 세는지도 적어야 한다 — 안 적으면 버그로 읽힌다');
});

/**
 * ★ 이름을 모르는 수량을 **조용히 버리지 않는다.** 버리면 물량이 왜 적은지
 *   알 수 없고, 적은 물량이 그대로 견적이 된다.
 */
test('★ 못 센 수량을 세어서 함께 돌려준다', () => {
  const r = ifc.read(SAMPLE);
  assert.deepStrictEqual(r.unmapped, [{ name: 'MyCustomArea', count: 1 }]);
  assert.match(ifc.summarize(r), /이름을 모르는 수량 1종은 세지 않았다/);
});

test('★ IFC 가 아니면 그렇다고 말한다', () => {
  const r = ifc.read(Buffer.from('PK zip 입니다'));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /ISO-10303-21/);
  assert.strictEqual(r.hasQuantities, false);
});

/** ★ 출처에 「어디서·어떻게 나온 값인지」를 남긴다 (§4.7) */
test('★ 출처에 모델 파일명과 스키마를 남긴다', () => {
  const r = ifc.read(SAMPLE, { name: '기본설계.ifc' });
  assert.strictEqual(r.source.file, '기본설계.ifc');
  assert.strictEqual(r.source.schema, 'IFC4');
  assert.match(r.source.note, /형상에서 다시 계산하지 않았다/,
    '모델이 준 값인지 우리가 센 값인지 구분되어야 한다');
});

/* ───────────── 자료 읽기에 붙는 방식 ───────────── */

test('★ .ifc 가 읽을 수 있는 형식으로 등록되어 있다', () => {
  assert.strictEqual(ex.FORMATS['.ifc'], 'model');
  const g = ex.readGroups().find(x => x.id === 'model');
  assert.ok(g, '화면에 「BIM 모델」 묶음이 없다 — 올려도 되는지 사용자가 알 수 없다');
  assert.deepStrictEqual(g.ext, ['.ifc']);
  assert.match(g.why, /자동으로 필드에 채우지 않습니다/,
    '모델은 근거가 아니라 대조 대상이라는 것을 화면이 말해야 한다');
});

/**
 * ★ **STEP 원문을 글자로 넘기지 않는다.** 좌표·GUID 가 수만 줄이라 별칭 추출이
 *   엉뚱한 숫자를 잡는다 — 「연면적 12.5」 같은 값이 출처까지 달고 들어온다.
 */
test('★ IFC 원문을 추출기에 그대로 흘리지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '02-extraction.js'), 'utf8');
  const fn = src.slice(src.indexOf("if (ext === '.ifc')"), src.indexOf('if (OCR_EXT.has(ext))'));
  assert.ok(fn.indexOf('ifc.summarize') !== -1, '요약이 아니라 원문을 넘기고 있다');
  assert.ok(fn.indexOf('readFileSync(file.path, ') === -1, '원문을 그대로 읽어 넘기면 안 된다');
});
