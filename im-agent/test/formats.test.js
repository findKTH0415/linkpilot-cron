'use strict';
/**
 * 자료 읽기 테스트 — PDF · 한글(hwp/hwpx) · 옛 오피스(doc/xls/ppt) · 스캔 OCR.
 *
 * 이 테스트가 지키려는 것 하나: **못 읽었으면 못 읽었다고 말한다.**
 *
 *   이 영역에서 가장 위험한 실패는 예외가 아니다. "조회는 성공했는데 글자가
 *   깨진 것"이다. 깨진 글자는 규칙 추출을 통과해 「연면적 4」 같은 값이 되고,
 *   출처(파일명·페이지)까지 붙어 보고서에 실린다. 화면에는 아무 경고도 안 뜬다.
 *   그래서 각 파서는 자신 없을 때 **던지거나 reliable:false 로 내려야** 한다.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pdftext = require('../core/pdftext');
const ole = require('../core/ole');
const ocr = require('../core/ocr');
const unzip = require('../core/unzip');
const ex = require('../agents/02-extraction');

const oleFix = require('./fixtures/ole');
const zipFix = require('./fixtures/zip');

const FIX = path.join(__dirname, 'fixtures');

// ── PDF ──────────────────────────────────────────────────────

/**
 * ★ 이 PDF 는 **크로미움이 만든 것**이다 (headless print-to-pdf).
 *   내가 만든 파일로 내 파서를 시험하면 같은 오해를 두 번 하고도 통과한다.
 *   남이 만든 파일이라야 CID 폰트·ToUnicode·서브셋 같은 실제 구조를 만난다.
 */
test('PDF 텍스트 레이어를 읽는다 (크로미움이 만든 파일)', () => {
  const r = pdftext.pdfText(fs.readFileSync(path.join(FIX, 'sample-text.pdf')));
  assert.strictEqual(r.reliable, true, r.reason || '');
  assert.match(r.text, /인천/, '한글이 CID 코드값이 아니라 글자로 나와야 한다');
  assert.match(r.text, /12,345/);
  assert.match(r.text, /2,846/);
});

/**
 * ★ 줄바꿈을 위치로 판단하는지 본다. PDF 에는 '줄'이 없어서, 글자마다 좌표를
 *   다시 잡는 파일에서 Td 마다 줄을 바꾸면 「대지면적」과 「12,345」가 다른 줄로
 *   흩어진다. 그러면 한 줄에서 값을 찾는 규칙 추출이 영영 못 만난다.
 */
test('★ PDF 에서 항목과 값이 같은 줄에 남는다', () => {
  const r = pdftext.pdfText(fs.readFileSync(path.join(FIX, 'sample-text.pdf')));
  const line = r.text.split('\n').find(l => l.includes('대지면적'));
  assert.ok(line, '대지면적 줄이 없다');
  assert.match(line, /12,345/, '항목과 값이 다른 줄로 흩어졌다 — 규칙 추출이 못 잡는다');
});

test('★ 규칙 추출이 PDF 본문에서 값을 뽑는다', () => {
  const r = pdftext.pdfText(fs.readFileSync(path.join(FIX, 'sample-text.pdf')));
  const got = {};
  r.text.split('\n').forEach((l) => ex.extractFromLine(l).forEach((f) => { got[f.key] = f.value; }));
  assert.strictEqual(got['land.area_sqm'], 12345);
  assert.strictEqual(got['building.gfa_sqm'], 45678);
  assert.strictEqual(got['investment.total'], 2846);
  assert.strictEqual(got['debt.ltc'], 65);
});

test('★ 스캔 PDF 는 성공으로 위장하지 않는다', () => {
  const r = pdftext.pdfText(fs.readFileSync(path.join(FIX, 'sample-scan.pdf')));
  assert.strictEqual(r.reliable, false);
  assert.match(r.reason, /텍스트 레이어/);
  assert.strictEqual(r.text, '', '빈 문자열이라도 reliable=true 로 내려보내면 안 된다');
});

test('PDF 가 아닌 파일은 PDF 로 읽지 않는다', () => {
  const r = pdftext.pdfText(Buffer.from('그냥 텍스트입니다'));
  assert.strictEqual(r.reliable, false);
  assert.match(r.reason, /%PDF/);
});

// ── 한글 ─────────────────────────────────────────────────────

test('hwpx 는 ZIP 이라 그대로 읽힌다', () => {
  const buf = zipFix.buildHwpx(['인천 남동 데이터센터', '대지면적 12,345 ㎡']);
  const text = unzip.hwpxText(buf);
  assert.match(text, /인천 남동 데이터센터/);
  assert.match(text, /12,345/);
});

test('hwp(바이너리) 본문을 읽는다 — 압축·비압축 둘 다', () => {
  for (const compressed of [true, false]) {
    const buf = oleFix.buildHwp(['인천 남동 데이터센터 개발사업', '총사업비 2,846억원'], { compressed });
    const text = ole.hwpText(buf);
    assert.match(text, /데이터센터/, `compressed=${compressed}`);
    assert.match(text, /2,846/, `compressed=${compressed}`);
  }
});

test('★ 암호 걸린 hwp 는 열지 못한다고 말한다', () => {
  const buf = oleFix.buildHwp(['비밀']);
  // FileHeader 의 속성 플래그에 암호 비트를 세운다
  const streams = ole.readOle(buf);
  assert.ok(streams.get('FileHeader'), '시험 파일이 잘못됐다');
  const patched = Buffer.from(buf);
  const at = patched.indexOf(Buffer.from('HWP Document File'));
  patched.writeUInt32LE(0x3, at + 36);
  assert.throws(() => ole.hwpText(patched), /암호/);
});

// ── 옛 오피스 ────────────────────────────────────────────────

test('doc / xls / ppt 본문을 읽는다', () => {
  assert.match(ole.docText(oleFix.buildDoc('Total project cost 2,846 / LTC 65%')), /2,846/);

  const xls = ole.xlsText(oleFix.buildXls([['항목', '값'], ['대지면적(㎡)', 12345]]));
  assert.match(xls, /대지면적/);
  assert.match(xls, /12345/);
  assert.ok(xls.includes('\t'), '표는 칸을 탭으로 구분해야 한 줄에서 값이 잡힌다');

  assert.match(ole.pptText(oleFix.buildPpt(['인천 데이터센터 사업개요', 'LTC 65%'])), /사업개요/);
});

test('★ 깨진 글자는 성공으로 내보내지 않는다', () => {
  // 무작위 바이트를 UTF-16 으로 읽으면 그럴듯한 길이의 쓰레기가 나온다
  const junk = Buffer.alloc(4000);
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 37 + 11) & 0xFF;
  const buf = oleFix.buildOle([{ name: 'PowerPoint Document', data: junk }]);
  assert.throws(() => ole.pptText(buf), /깨져|찾지 못했다/,
    '읽을 수 있는 글자 비율을 안 보면 쓰레기가 값으로 들어간다');
});

test('그릇이 아니면 그렇다고 말한다', () => {
  assert.throws(() => ole.readOle(Buffer.from('PK zip 입니다')), /CFBF/);
  assert.throws(() => ole.oleText('.rtf', Buffer.alloc(0)), /다루지 않는다/);
});

// ── 읽는 방법 표 ─────────────────────────────────────────────

test('★ 확장자마다 읽는 방법이 하나씩 정해져 있다', () => {
  const all = Object.keys(ex.FORMATS);
  assert.ok(all.length >= 25, `형식이 ${all.length}개 — 줄었다면 무엇이 빠졌는지 본다`);
  all.forEach((e) => {
    assert.match(e, /^\.[a-z0-9]+$/, `${e}: 확장자 형식이 아니다`);
    assert.ok(['text', 'zip', 'pdf', 'ole', 'ocr', 'convert', 'model'].includes(ex.FORMATS[e]),
      `${e}: 모르는 방법 ${ex.FORMATS[e]}`);
  });
  // 사용자가 적어 준 12개가 전부 들어 있는가
  ['.doc', '.gif', '.hwp', '.hwpx', '.jpeg', '.jpg', '.pdf', '.png', '.ppt', '.tif', '.tiff', '.xls']
    .forEach(e => assert.ok(ex.FORMATS[e], `${e} 가 표에 없다`));
});

test('★ 못 읽는 형식에는 무엇으로 바꿀지 적혀 있다', () => {
  [...ex.UNSUPPORTED_EXT].forEach((e) => {
    assert.ok(ex.CONVERT_HINT[e], `${e}: "못 읽습니다"만 말하고 있다`);
  });
});

test('★ 화면이 확장자 목록을 복사해 두지 않는다', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'intake.html'), 'utf8');
  ['.hwpx', '.tiff', '.xlsm'].forEach((e) => {
    assert.ok(!html.includes(`'${e}'`), `intake.html 에 ${e} 가 박혀 있다 — 서버가 준 목록만 그린다`);
  });
  assert.match(html, /state\.info\b[\s\S]{0,400}formats/, '묶음은 서버 응답에서 읽는다');
});

// ── OCR 경로 ─────────────────────────────────────────────────

test('OCR 이 받는 형식은 Gemini 가 인라인으로 받는 것뿐이다', () => {
  ['a.png', 'a.jpg', 'a.jpeg', 'a.pdf', 'a.webp'].forEach(n => assert.ok(ocr.isSupported(n), n));
  ['a.gif', 'a.tif', 'a.tiff', 'a.bmp'].forEach(n => assert.ok(!ocr.isSupported(n), `${n} 는 받지 못한다`));
});

test('★ 키가 없으면 "읽었다"가 아니라 "키가 없다"고 말한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-fmt-'));
  const p = path.join(dir, '스캔본.png');
  fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4E, 0x47]));

  const before = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const r = await ex.tryOcr({ name: '스캔본.png', path: p, ext: '.png' }, '이미지 파일', () => {});
    assert.ok(!r.text);
    assert.match(r.error, /GEMINI_API_KEY/, '왜 안 읽혔는지 말하지 않으면 사람은 화면을 의심한다');
  } finally {
    if (before === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = before;
  }
});

test('★ 변환이 필요한 형식은 OCR 로도 시도하지 않는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-fmt-'));
  const p = path.join(dir, '도면.tiff');
  fs.writeFileSync(p, Buffer.from('II*'));
  const r = await ex.tryOcr({ name: '도면.tiff', path: p, ext: '.tiff' }, '이미지 파일', () => {});
  assert.match(r.error, /PDF 나 PNG/, '못 하는 것을 시도해 놓고 실패 사유를 흐리면 안 된다');
});

test('OCR 은 큰 파일을 조용히 자르지 않는다', async () => {
  await assert.rejects(
    () => ocr.transcribe({ name: 'x.png', buffer: Buffer.alloc(ocr.MAX_INLINE_BYTES + 1) }),
    /나눠서/);
});

// ── 파이프라인 연결 ──────────────────────────────────────────

test('★ toText 가 형식마다 읽는 방법을 밝힌다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-fmt-'));
  const write = (name, data) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, data);
    return { name, path: p, ext: path.extname(name).toLowerCase() };
  };

  assert.strictEqual(ex.toText(write('a.md', '연면적 : 52822 ㎡')).via, 'text');
  assert.strictEqual(ex.toText(write('a.hwpx', zipFix.buildHwpx(['대지면적 12,345 ㎡']))).via, 'zip');
  assert.strictEqual(ex.toText(write('a.hwp', oleFix.buildHwp(['대지면적 12,345 ㎡']))).via, 'ole');

  const scan = ex.toText(write('a.pdf', fs.readFileSync(path.join(FIX, 'sample-scan.pdf'))));
  assert.ok(!scan.text);
  assert.ok(scan.ocr, '스캔본은 OCR 로 넘길 값어치가 있다고 표시해야 한다');

  const tif = ex.toText(write('a.tiff', Buffer.from('II*')));
  assert.match(tif.error, /PDF 나 PNG/);
  assert.ok(!tif.ocr, '변환이 필요한 형식을 OCR 로 넘기면 쓸데없이 키를 쓰고 실패한다');
});
