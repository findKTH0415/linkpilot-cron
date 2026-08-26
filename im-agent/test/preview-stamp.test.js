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

/* ───────────── ★★★ 내보내는 셋 **전부**에 찍히는가 ───────────── */

test('★★★ 주소로 나가는 판에도 찍힌다 — 한 곳만 고치면 나머지가 옛말을 한다', () => {
  // ★ 처음 붙였을 때 `flowShell()` 한 곳에만 넣었더니 **section-preview.html
  //   에만** 찍혔다. 그런데 §8 이 「기본 전달」로 정한 것은 **아티팩트**다 —
  //   사장님이 실제로 여시는 주소에는 지문이 없었다.
  //
  // ★★ 그게 왜 빠뜨린 것보다 나쁜가: 앞 판은 **하나도 없어서** 아무도 안 봤다.
  //   고친 뒤에는 미리보기에만 있으니 「지문이 있는 판」과 「없는 판」이 섞인다.
  //   없는 쪽을 열면 M-25 가 막으려던 상태로 **되돌아간 줄도 모른다.**
  // ★★ **파일이 아니라 만드는 자리를 잰다.** `section-static.html` 과
  //   `section-artifact.html` 은 `.gitignore` 에 있어 **새로 받은 자리에는 없다.**
  //   있는지로 재면 CI 에서만 빨개지는 검사가 된다 — 오늘 이미 한 번 그랬다.
  const src = fs.readFileSync(path.join(HERE, 'build-static.js'), 'utf8')
    // 주석을 떼고 본다 (CLAUDE.md §8 — 경위를 잘 적어 둘수록 글자 대조가 눈이 먼다)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const inserts = (src.match(/preview-stamp\.js'\)\.html\(\)/g) || []).length;
  assert.ok(inserts >= 3,
    `build-static.js 가 지문을 ${inserts}곳에만 넣는다 — 미리 그린 판 · 아티팩트 조각 ·`
    + ' 한 단계만 보는 조각, 셋 다 주소로 나간다');

  const preview = fs.readFileSync(path.join(HERE, 'build-preview.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(preview, /preview-stamp\.js'\)\.html\(\)/,
    'build-preview.js 에서 지문이 빠졌다');

  // 만들어져 있으면 값까지 본다 (여기서 돌린 뒤라면 있다)
  const now = fresh().previewHash();
  for (const f of ['section-preview.html', 'section-static.html', 'section-artifact.html']) {
    const p = path.join(HERE, f);
    if (!fs.existsSync(p)) continue;        // 아직 안 만든 자리 — 위에서 소스로 이미 쟀다
    const html = fs.readFileSync(p, 'utf8');
    assert.match(html, /data-lp-preview-stamp/, `${f} 에 미리보기 지문이 없다`);
    assert.ok(html.includes(`미리보기-${now}`),
      `${f} 의 지문이 지금 소스와 다르다 — 다시 만들어야 한다`);
  }
});

test('★★ 조각에 넣어도 올릴 수 있는 꼴이다 (스크립트·바깥 주소 없음)', () => {
  // 아티팩트 조각은 `publishable()` 을 지나야 한다. 지문이 그것을 어기면
  // **조각 만들기 자체가 막혀** 전달이 통째로 멈춘다.
  const frag = fresh().html();
  assert.ok(!/<script/i.test(frag), '스크립트가 들어가면 조각이 막힌다');
  assert.ok(!/(?:src|href)="https?:/i.test(frag), '바깥 주소는 CSP 가 막는다');
  assert.ok(!/<(?:html|head|body|iframe)[\s>]/i.test(frag), '감싸는 문서는 올리는 쪽이 붙인다');
});
