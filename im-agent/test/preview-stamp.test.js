'use strict';
/**
 * D-114 — 미리보기가 **자기 판**을 따로 말하는가
 *
 * ★★★ 재는 것은 하나다: **둘이 따로 움직이는가.**
 *   같이 움직이면 두 숫자를 적는 뜻이 없고, 안 움직이면 앞 판으로 되돌아간 것이다.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..', 'ui', 'platform');
const stampPath = path.join(HERE, 'preview-stamp.js');

function fresh() {
  delete require.cache[require.resolve(stampPath)];
  return require(stampPath);
}

test('★ 앱 지문과 미리보기 지문은 서로 다른 값이다', () => {
  const s = fresh();
  assert.match(s.previewHash(), /^[0-9a-f]{8}$/);
  assert.match(s.appHash(), /^[0-9a-f]{8}$/);
  assert.match(s.line(), /판 앱-[0-9a-f]{8} · 미리보기-[0-9a-f]{8}/);
});

test('★★★ 미리보기 소스를 고치면 **미리보기 지문만** 바뀐다', () => {
  const s = fresh();
  const before = { app: s.appHash(), prev: s.previewHash() };

  const p = path.join(HERE, 'changes.js');
  const orig = fs.readFileSync(p);
  try {
    fs.appendFileSync(p, '\n// 검사가 잠깐 붙인 줄\n');
    const s2 = fresh();
    assert.strictEqual(s2.appHash(), before.app,
      '미리보기만 고쳤는데 앱 지문이 따라 움직인다 — 두 숫자를 적는 뜻이 없어진다');
    assert.notStrictEqual(s2.previewHash(), before.prev,
      '미리보기 소스를 고쳤는데 미리보기 지문이 안 바뀐다 — D-114 앞 판으로 되돌아갔다');
  } finally {
    fs.writeFileSync(p, orig);
    fresh();
  }
});

test('★★ 소스 목록에 있는 파일이 실제로 있다 — 없으면 지문이 거짓말한다', () => {
  const s = fresh();
  assert.ok(s.SOURCES.length >= 3, '목록이 너무 짧다 — 미리보기 생성이 이보다 많은 파일을 쓴다');
  for (const f of s.SOURCES) {
    assert.ok(fs.existsSync(path.join(HERE, f)), `${f} 가 없다 — 목록이 옛말을 한다`);
  }
});

test('★★ 화면에 두 값이 **나란히** 찍힌다 (하나로 합치면 안 된다)', () => {
  const html = fs.readFileSync(path.join(HERE, 'section-preview.html'), 'utf8');
  assert.match(html, /data-lp-preview-stamp/, '미리보기 지문 자리가 화면에 없다');
  assert.match(html, /판 앱-[0-9a-f]{8} · 미리보기-[0-9a-f]{8}/,
    '두 값이 나란히 안 적혔다 — 「배포되는 것」과 「보여 주는 것」은 다른 사실이다');
  const s = fresh();
  assert.ok(html.includes(`미리보기-${s.previewHash()}`),
    '화면에 찍힌 미리보기 지문이 지금 소스와 다르다 — 다시 만들어야 한다');
});

test('★ 시각을 섞지 않는다 — 섞으면 자정마다 산출물이 달라진다', () => {
  const src = fs.readFileSync(stampPath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Date\.now\(\)|new Date\(/.test(src),
    '지문에 시각이 섞이면 내용이 안 바뀌어도 매번 달라져 「재생성 = 커밋본」 검사가 빨개진다');
});
