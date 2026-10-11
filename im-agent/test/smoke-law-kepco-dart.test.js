'use strict';
/**
 * smoke-law-kepco-dart.test.js — 미측정 셋을 «재는 자리»로 옮긴 것을 못박는다 (D-438).
 *   ① 법령 API 결과가 요약 표 줄(●/✕)로 나간다 — 앞 판은 _raw.txt 에만 있어 「미측정」으로 세졌다.
 *   ② 진단이 한전 계통을 실제로 부른다(--grid-region) · 선로 없음은 열쇠 실패로 안 센다.
 *   ③ DART 의 «ZIP 이 아니다»가 상태코드·길이·모양·앞머리를 함께 적는다 — 열쇠는 가린다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const dart = require('../connectors/dart');

const ROOT = path.join(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const noComment = s => s.split('\n').filter(l => !/^\s*(\/\/|\*|#)/.test(l)).join('\n');

test('① 법령 API 결과가 요약 표 줄로 나간다 — 승인·실패 두 갈래 모두', () => {
  const s = noComment(read('im-agent/tools/smoke-public-data.js'));
  const i = s.indexOf("law.findLaw('건축법 시행령')");
  assert.ok(i > 0, '법령 실호출 자리를 못 찾았다 — 이 칸은 아무것도 안 잰다');
  const blk = s.slice(i, i + 1400);
  assert.match(blk, /report\('국가법령정보 \(법제처\)', true/, '승인됐을 때 요약 줄이 없다');
  assert.match(blk, /report\('국가법령정보 \(법제처\)', false/, '실패했을 때 요약 줄이 없다');
});

test('② 진단 워크플로가 한전 계통을 실제로 부른다', () => {
  const y = noComment(read('.github/workflows/api-smoke.yml'));
  const run = y.slice(y.indexOf('smoke-public-data.js'), y.indexOf('smoke-public-data.js') + 300);
  assert.match(run, /--grid-region\s+"[^"]+"/, '--grid-region 이 없으면 한전은 영영 「미측정」이다');
});

test('② 선로 없음(noData)은 «열쇠 통과»로 적는다 — 실패로 안 센다', () => {
  const s = noComment(read('im-agent/tools/smoke-public-data.js'));
  const i = s.indexOf('kepco.capacity({ region: gridRegion })');
  assert.ok(i > 0);
  const blk = s.slice(i, i + 1400);
  const m = blk.match(/else if \(g\.noData\) \{[\s\S]*?report\([^,]+,\s*(true|false)/);
  assert.ok(m, 'noData 갈래가 없다 — 선로 없음이 열쇠 실패로 세진다');
  assert.strictEqual(m[1], 'true', '선로 없음을 실패(✕)로 적는다');
  assert.match(blk.slice(blk.indexOf('g.noData')), /열쇠 통과/);
});

test('③ DART «ZIP 이 아니다» — 상태코드·길이·모양·앞머리를 함께, 열쇠는 가린다', () => {
  const KEY = 'zzKEY0123456789abcdef0123456789abcdefzz';
  const before = process.env.DART_API_KEY;
  process.env.DART_API_KEY = KEY;
  try {
    const html = `<!DOCTYPE html><html><head><style>p{}</style><script>var k="${KEY}"</script></head>`
      + `<body><h1>시스템 점검 안내</h1><p>점검 중입니다 ${KEY}</p></body></html>`;
    const e = dart.notZipWhy({ status: 503, body: Buffer.from(html) });
    assert.match(e, /ZIP 이 아니다/);
    assert.match(e, /HTTP 503/, '상태코드가 없다');
    assert.match(e, /\d+바이트/, '길이가 없다');
    assert.match(e, /HTML/, '모양이 없다');
    assert.match(e, /시스템 점검 안내/, '앞머리가 없다 — 점검인지 한도인지 못 가른다');
    assert.ok(!e.includes(KEY), '열쇠 값이 오류 글에 샜다');
    assert.ok(!/<h1>|var k/.test(e), '태그·스크립트가 그대로 남았다');

    const empty = dart.notZipWhy({ status: 200, body: Buffer.alloc(0) });
    assert.match(empty, /빈 대답/);
    assert.ok(!/앞머리/.test(empty), '빈 대답에 앞머리 줄을 붙이면 「본문이 있다」로 읽힌다');
  } finally {
    if (before === undefined) delete process.env.DART_API_KEY; else process.env.DART_API_KEY = before;
  }
});

test('③ corpIndex 가 그 글을 실제로 쓴다 — <status> 가 있으면 그것이 이긴다', () => {
  const s = read('im-agent/connectors/dart.js');
  assert.match(s, /const s = statusError\(.*\n\s*return \{ ok: false, error: s \|\| notZipWhy\(r\) \}/);
});
