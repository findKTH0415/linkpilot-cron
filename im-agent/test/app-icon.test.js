'use strict';
/**
 * app-icon.test.js — **앱 아이콘의 원이 잘리지 않았는지 픽셀에서 잰다**
 *   〈2026-08-30 사장님 지시 · D-181〉.
 *
 * 사장님 지시: 「앱이 깔리면 보이는 모습 샘플처럼 타원이 앱안에 중앙에 배치하여
 * 원형그대로 보이도록 만들어줘」.
 *
 * ★★★ **아이콘은 눈으로 고치기 가장 나쁜 그림이다.** 1024px 로 크게 보면
 *   조금 잘려도 멀쩡해 보이고, 부두(Dock)에서 48px 로 줄어야 어긋난 것이
 *   보인다. 그래서 「그렸다」가 아니라 **「어디까지 그려졌는가」**를 잰다.
 *
 * ★★ 이 갈래에서 실제로 당했다: 임시 html 이 옆 폴더의 SVG 를 못 찾았는데
 *   크로미움이 **오류를 안 냈다.** 깨진 그림 표시만 찍고 정상 종료했고
 *   스크립트는 「10장 만들었다」로 끝났다 — **파일도 크기도 있는데 전부 빈
 *   그림**이었다. 눈으로 열어 보지 않았으면 그대로 나갔다.
 *   그래서 **빈 그림이 아닌지**도 여기서 잰다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const BRAND = path.join(__dirname, '..', '..', 'assets', 'brand');
const BIG = path.join(BRAND, 'LinkPilot.iconset', 'icon_512x512@2x.png');

const G = require(path.join(BRAND, 'geometry.js'));
const { read } = require(path.join(BRAND, 'png-read.js'));

/** 짙은 남색(고리·마름모)인가 */
const isInk = (p) => p[3] > 200 && p[0] < 70 && p[1] < 70 && p[2] < 80;
/** 초록(비행기)인가 */
const isGreen = (p) => p[3] > 200 && p[1] > p[0] + 20 && p[1] > p[2] + 20;
/** 흰 바탕(둥근 사각형)인가 */
const isPlate = (p) => p[3] === 255 && p[0] > 245 && p[1] > 245 && p[2] > 245;

test('★★★ 나침반 원이 안 잘리고, 한가운데에 있다 (찍어 낸 그림에서 잰다)', () => {
  assert.ok(fs.existsSync(BIG), '1024 짜리 아이콘이 없다 — npm run brand:icon 으로 만든다');
  const im = read(BIG);
  assert.strictEqual(im.width, 1024, '아이콘 크기가 애플 기준(1024)이 아니다');
  assert.strictEqual(im.height, 1024, '아이콘 크기가 애플 기준(1024)이 아니다');

  /* ① **빈 그림이 아니다.** 이 갈래에서 실제로 빈 그림 열 장이 나왔다 */
  let ink = 0, green = 0;
  for (let y = 0; y < 1024; y += 4) {
    for (let x = 0; x < 1024; x += 4) {
      const p = im.at(x, y);
      if (isInk(p)) ink++; else if (isGreen(p)) green++;
    }
  }
  assert.ok(ink > 2000, `고리가 거의 안 그려졌다 (짙은 점 ${ink}개) — 빈 그림일 수 있다`);
  assert.ok(green > 1500, `비행기가 거의 안 그려졌다 (초록 점 ${green}개) — 빈 그림일 수 있다`);

  /* ② **원이 사방으로 온전한가.** 가운데를 지나는 가로·세로 줄에서
   *    짙은 점의 양 끝을 찾는다. 잘렸으면 한쪽 끝이 판 가장자리에 붙는다 */
  const row = [], col = [];
  for (let i = 0; i < 1024; i++) {
    if (isInk(im.at(i, 512))) row.push(i);
    if (isInk(im.at(512, i))) col.push(i);
  }
  assert.ok(row.length && col.length, '가운데 줄에서 고리를 못 찾았다');
  const left = row[0], right = row[row.length - 1];
  const top = col[0], bottom = col[col.length - 1];

  /* ③ **가운데에 있다** — 사장님 지시의 핵심. 양쪽이 같은 만큼 떨어져야 한다 */
  assert.ok(Math.abs((512 - left) - (right - 512)) <= 3,
    `가로로 안 가운데다 (왼 ${512 - left} · 오른 ${right - 512})`);
  assert.ok(Math.abs((512 - top) - (bottom - 512)) <= 3,
    `세로로 안 가운데다 (위 ${512 - top} · 아래 ${bottom - 512})`);
  assert.ok(Math.abs((right - left) - (bottom - top)) <= 3,
    `가로 지름과 세로 지름이 다르다 (${right - left} · ${bottom - top}) — 원이 아니다`);

  /* ④ **잘리지 않았다** — 그림 끝과 둥근 사각형 안쪽 사이에 여백이 남아야 한다.
   *    이것이 사장님이 신고하신 바로 그 자리다 (지금 깔린 아이콘은 여백이 0 이라
   *    원이 사방으로 잘려 있다) */
  const plateLeft = G.PLATE.x, plateRight = G.PLATE.x + G.PLATE.size;
  const margin = Math.min(left - plateLeft, plateRight - right,
    top - G.PLATE.y, (G.PLATE.y + G.PLATE.size) - bottom);
  assert.ok(margin >= 60,
    `원이 둥근 사각형에 너무 붙었다 (여백 ${margin}px) — 작게 줄이면 잘려 보인다`);

  /* ⑤ **둥근 사각형이 제자리에 있다.** 밖은 비어 있고 안은 흰색이어야 한다 —
   *    밖이 안 비면 부두에서 네모난 흰 판으로 보인다 */
  assert.strictEqual(im.at(512, G.PLATE.y - 10)[3], 0,
    '둥근 사각형 밖이 안 비었다 — 부두에서 네모로 보인다');
  assert.ok(isPlate(im.at(512, G.PLATE.y + 10)),
    '둥근 사각형 안이 흰 바탕이 아니다');
  assert.strictEqual(im.at(4, 4)[3], 0, '모서리가 안 비었다');
});

/**
 * ★ 원본(SVG)과 찍어 낸 그림이 **같은 자리에서 나왔는지** 본다.
 *   값을 한 곳(`geometry.js`)에서만 만들므로, 그 값이 바뀌면 그림도 바뀌어야 한다.
 */
test('★★ 아이콘 SVG 가 자릿수와 어긋나지 않는다 (다시 만들어 대 본다)', () => {
  const { svg } = require(path.join(BRAND, 'build-icon.js'));
  const onDisk = fs.readFileSync(path.join(BRAND, 'linkpilot-icon.svg'), 'utf8');
  assert.strictEqual(svg({ withPlate: true }), onDisk,
    '커밋된 아이콘 SVG 가 지금 자릿수로 다시 만든 것과 다르다 — npm run brand:icon 을 돌린다');
  const mark = fs.readFileSync(path.join(BRAND, 'linkpilot-mark.svg'), 'utf8');
  assert.strictEqual(svg({ withPlate: false }), mark,
    '커밋된 나침반 SVG 가 지금 자릿수로 다시 만든 것과 다르다');
  /* 바탕 없는 판에는 흰 판이 없어야 한다 — 파비콘으로 쓰면 흰 네모가 남는다 */
  assert.ok(!/<rect/.test(mark), '나침반만 낸 판에 흰 사각형이 남아 있다');
});

/**
 * ★★ **맥이 요구하는 열 장이 다 있고, 다 크기가 맞는가.**
 *   하나라도 빠지면 `iconutil` 이 통째로 거절한다 — 그때 나오는 말은
 *   「invalid iconset」 한 줄뿐이라 무엇이 빠졌는지 안 알려 준다.
 */
test('★★ 맥용 열 장이 다 있고 크기가 맞다', () => {
  const { ICONSET } = require(path.join(BRAND, 'build-icon.js'));
  const dir = path.join(BRAND, 'LinkPilot.iconset');
  assert.strictEqual(ICONSET.length, 10, '맥은 열 장을 요구한다');
  ICONSET.forEach(([name, size]) => {
    const f = path.join(dir, name);
    assert.ok(fs.existsSync(f), `${name} 이 없다 — iconutil 이 통째로 거절한다`);
    const im = read(f);
    assert.strictEqual(im.width, size, `${name} 의 폭이 ${im.width} 다 (${size} 여야 한다)`);
    assert.strictEqual(im.height, size, `${name} 의 높이가 ${im.height} 다 (${size} 여야 한다)`);
  });
});

/**
 * ★★★ **`.icns` 를 여기서 만든다 — 맥에서 한 줄 안 쳐도 된다**
 *   〈2026-08-30 사장님: 「개정된 파비콘 앱 다운로드 될수 있도록 · 갱신한 주소로
 *   접속해도 과거 버젼이 다운로드됨」 · D-187〉.
 *
 *   앞 판은 맥에서 `iconutil` 을 치셔야 `.icns` 가 됐다. 그 한 줄이 안 쳐지면
 *   **아이콘은 영영 안 바뀐다** — 손으로 해야 도는 장치는 안 돈다 (D-88).
 */
test('★★★ .icns 가 실제로 묶이고, 도로 풀어도 열 조각이 그대로다', () => {
  const B = require(path.join(BRAND, 'build-icon.js'));
  const f = path.join(BRAND, 'LinkPilot.icns');
  assert.ok(fs.existsSync(f), '.icns 가 없다 — npm run brand:icon 으로 만든다');

  const buf = fs.readFileSync(f);
  assert.strictEqual(buf.toString('ascii', 0, 4), 'icns', '머리 네 글자가 icns 가 아니다');
  assert.strictEqual(buf.readUInt32BE(4), buf.length,
    '적어 둔 길이와 실제 길이가 다르다 — 맥이 통째로 거절한다');

  const back = B.readIcns(buf);
  assert.strictEqual(back.length, 10, `조각이 ${back.length}개다 — 열 개여야 한다`);

  /* 종류 이름이 하나라도 틀리면 맥이 거절하는데, 그때 나오는 말은 한 줄뿐이라
     무엇이 틀렸는지 안 알려 준다. 그래서 여기서 이름을 지킨다 */
  const want = Object.keys(B.ICNS_TYPE).map((k) => B.ICNS_TYPE[k]).sort();
  assert.deepStrictEqual(back.map((x) => x.type).sort(), want, '조각 종류 이름이 다르다');

  /* 각 조각이 **진짜 PNG** 인가 — 껍데기만 맞고 알맹이가 비면 아이콘이 안 뜬다 */
  let at = 8;
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32BE(at + 4);
    const png = buf.subarray(at + 8, at + len);
    assert.strictEqual(png.readUInt32BE(0), 0x89504E47,
      `${buf.toString('ascii', at, at + 4)} 조각이 PNG 가 아니다`);
    at += len;
  }
});

/**
 * ★★ **묶은 그림이 「지금 그린 것」인가.** 옛 PNG 를 그대로 묶으면
 *   「고쳤는데 아이콘이 그대로」가 된다 — 사장님이 겪으신 그 모습이다.
 */
test('★★ .icns 안의 1024 조각이 지금 아이콘과 바이트까지 같다', () => {
  const B = require(path.join(BRAND, 'build-icon.js'));
  const buf = fs.readFileSync(path.join(BRAND, 'LinkPilot.icns'));
  const big = fs.readFileSync(path.join(BRAND, 'LinkPilot.iconset', 'icon_512x512@2x.png'));
  const type = B.ICNS_TYPE['icon_512x512@2x.png'];

  let at = 8, found = null;
  while (at + 8 <= buf.length) {
    const t = buf.toString('ascii', at, at + 4);
    const len = buf.readUInt32BE(at + 4);
    if (t === type) { found = buf.subarray(at + 8, at + len); break; }
    at += len;
  }
  assert.ok(found, `${type} 조각을 못 찾았다`);
  assert.ok(found.equals(big),
    '.icns 안의 큰 그림이 지금 아이콘과 다르다 — 옛 판을 묶었다 (「고쳤는데 그대로」의 정체)');
});

/**
 * ★★★ **웹앱(PWA) 아이콘 — 사장님이 실제로 설치하시는 자리**
 *   〈2026-08-30 사장님 화면: 안드로이드 크롬 「설치 및 바로가기 만들기」 · D-188〉.
 *
 *   `.icns` 는 **맥 앱**용이다. 사장님이 「앱 다운로드」라고 하신 것은
 *   **웹앱(PWA)** 이었고, 그 아이콘은 **웹 매니페스트의 PNG** 에서 온다.
 *   앞 판은 맥 쪽만 만들어 두고 「고쳤다」고 말했다 — **고친 것이 그 자리에 안 닿았다.**
 */
test('★★★ 오려 내는 판(maskable)은 가장자리까지 꽉 차 있다', () => {
  const B = require(path.join(BRAND, 'build-icon.js'));
  const f = path.join(BRAND, 'pwa', 'linkpilot-maskable-512.png');
  assert.ok(fs.existsSync(f), '오려 내는 판이 없다 — npm run brand:icon 으로 만든다');
  const im = read(f);

  /* 네 모서리가 **투명하지 않아야** 한다. 투명하면 안드로이드가 그것째로 오려
     아이콘이 조그맣게 박힌 흰 동그라미가 된다 */
  [[2, 2], [im.width - 3, 2], [2, im.height - 3], [im.width - 3, im.height - 3]]
    .forEach(([x, y]) => {
      assert.strictEqual(im.at(x, y)[3], 255,
        `모서리 (${x},${y}) 가 비어 있다 — 오려 내면 아이콘이 쪼그라든다`);
    });
  assert.ok(B.PWA.some((r) => r[2] === 'maskable'), '오려 내는 판을 안 만든다');
});

test('★★ 안 오려 내는 판(any)은 둥근 사각형 밖이 비어 있다', () => {
  const f = path.join(BRAND, 'pwa', 'linkpilot-512.png');
  const im = read(f);
  assert.strictEqual(im.at(2, 2)[3], 0,
    '모서리가 안 비었다 — 오려 내지 않는 자리에서 각진 네모로 뜬다');
});

/**
 * ★ 오려 내는 원은 한 변의 **80%** 다. 그림이 그 밖으로 나가면 잘린다.
 *   `geometry.js` 의 값으로 재므로, 나중에 그림을 키우면 여기서 빨개진다.
 */
test('★★ 그림이 오려 내는 원(한 변의 80%) 안에 들어간다', () => {
  const G2 = require(path.join(BRAND, 'geometry.js'));
  const safeRadius = G2.CANVAS * 0.4;          // 지름 80% → 반지름 40%
  assert.ok(G2.markReach() <= safeRadius,
    `그림이 ${Math.round(G2.markReach())} 까지 닿는다 — 안전 반경 ${safeRadius} 를 넘어 잘린다`);
});

test('★★ 웹앱 아이콘 넉 장이 다 있고 크기가 맞다', () => {
  const B = require(path.join(BRAND, 'build-icon.js'));
  assert.strictEqual(B.PWA.length, 4, '웹앱 아이콘은 넉 장이다 (192·512 × 오림·안오림)');
  B.PWA.forEach(([name, size]) => {
    const f = path.join(BRAND, 'pwa', name);
    assert.ok(fs.existsSync(f), `${name} 이 없다`);
    const im = read(f);
    assert.strictEqual(im.width, size, `${name} 의 폭이 ${im.width} 다 (${size} 여야 한다)`);
  });
});
