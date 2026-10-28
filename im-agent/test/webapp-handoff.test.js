'use strict';
/**
 * webapp-handoff.test.js — **넘기는 폴더가 옛말을 하지 않게** 〈2026-08-30 · D-189〉.
 *
 * ★★★ 사장님이 「아직 반영이 안 됨」을 **세 번** 말씀하셨다. 그림은 다 만들어져
 *   있는데 **넣는 자리가 저쪽**이라 아무것도 안 바뀌고 있었다. 그래서 저쪽에서
 *   **복사만 하면 되도록** 한 폴더에 담았다 (`docs/전달-webapp/`).
 *
 * ★ 사본은 조용히 갈린다 (M-63 과 같은 결). 그림을 다시 그려도 이 폴더가
 *   옛 그림을 들고 있으면 **넘긴 것만 옛말을 한다** — 그때는 아무도 모른다.
 *   그래서 **바이트가 같은지** 여기서 잰다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', '전달-webapp');
const PWA = path.join(ROOT, 'assets', 'brand', 'pwa');

test('★★★ 넘기는 그림이 지금 그림과 바이트까지 같다 (사본이 옛말을 안 한다)', () => {
  const { PWA: LIST } = require(path.join(ROOT, 'assets', 'brand', 'build-icon.js'));
  LIST.forEach(([name]) => {
    const a = path.join(PWA, name);
    const b = path.join(OUT, name);
    assert.ok(fs.existsSync(b), `넘기는 폴더에 ${name} 이 없다`);
    assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)),
      `${name} 이 지금 그림과 다르다 — 넘긴 것만 옛 판이 된다 (npm run brand:icon 뒤 다시 복사한다)`);
  });
});

test('★★ 매니페스트가 넉 장을 다 부르고, purpose 를 갈라 적는다', () => {
  const m = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(m.icons.length, 4, '아이콘이 넷이 아니다');

  const any = m.icons.filter((i) => i.purpose === 'any');
  const mask = m.icons.filter((i) => i.purpose === 'maskable');
  assert.strictEqual(any.length, 2, '안 오려 내는 판이 둘이 아니다 — 각진 네모로 뜬다');
  assert.strictEqual(mask.length, 2,
    '오려 내는 판이 둘이 아니다 — 조그맣게 박힌 흰 동그라미가 된다');

  /* 부르는 파일이 실제로 함께 넘어가는가 — 이름만 맞고 파일이 없으면 아이콘이 안 뜬다 */
  m.icons.forEach((i) => {
    const f = path.basename(i.src);
    assert.ok(fs.existsSync(path.join(OUT, f)), `매니페스트가 부르는 ${f} 가 폴더에 없다`);
    assert.strictEqual(i.type, 'image/png', `${f} 의 type 이 PNG 가 아니다`);
    assert.ok(/^\d+x\d+$/.test(i.sizes), `${f} 의 sizes 가 비었다`);
  });

  /* ★ 주소를 적어 두지 않는다 (§2 — NAS 접속정보). start_url 은 상대 경로여야 한다 */
  const text = fs.readFileSync(path.join(OUT, 'manifest.webmanifest'), 'utf8');
  assert.doesNotMatch(text, /\.ts\.net|synologynas/i, '매니페스트에 주소가 박혀 있다');
});

test('★★ 「지우고 다시 설치해야 한다」를 안내에 적어 둔다', () => {
  const doc = fs.readFileSync(path.join(OUT, '읽어주십시오.md'), 'utf8');
  assert.match(doc, /길게 눌러 제거/,
    '재설치 절차가 없다 — 고치고도 「아직 안 바뀌네」로 서로 헛돈다');
  assert.match(doc, /maskable/, '오려 내는 판을 설명하지 않는다');
});
