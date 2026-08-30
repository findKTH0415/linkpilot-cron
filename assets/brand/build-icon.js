'use strict';
/**
 * build-icon.js — **앱 아이콘을 그린다** 〈2026-08-30 사장님 지시 · D-181〉.
 *
 * 사장님 지시: 「앱이 깔리면 보이는 모습 샘플처럼 타원이 앱안에 중앙에 배치하여
 * 원형그대로 보이도록 만들어줘」.
 *
 * ★★★ 지금 깔린 아이콘은 나침반 원이 **사방으로 잘려** 있다. 맥 아이콘은
 *   가장자리까지 채우는 그림이 아닌데(1024 칸 안에 824 둥근 사각형),
 *   그 규칙을 안 지키고 그림을 칸 끝까지 늘린 탓이다.
 *
 * ★ 여기서 만드는 것 셋:
 *     ① `linkpilot-icon.svg`  — 앱 아이콘 원본 (흰 둥근 사각형 + 나침반)
 *     ② `linkpilot-mark.svg`  — 나침반만 (바탕 없음). 파비콘·화면용
 *     ③ `LinkPilot.iconset/`  — 맥이 요구하는 크기 열 장 (PNG, 투명)
 *
 * ★★ **PNG 로 낸다 — JPEG 이 아니다.** CLAUDE.md §6-1 은 SVG 옆에 JPEG 을
 *   함께 두라고 하는데, 아이콘은 **투명이 있어야** 둥근 모서리 밖이 비친다.
 *   JPEG 은 투명을 못 담아 모서리가 검게 칠해진다 — 그 규칙이 막으려는 것
 *   (「그림을 보라고 보냈는데 빈 칸이 온다」)보다 나쁜 결과가 된다. 그래서
 *   **여기서는 PNG 가 그 자리를 대신한다.** 미리보기용 그림은 §6-1 대로 낸다.
 *
 * ★ 라이브러리를 안 들인다 (§5). 이미 쓰는 **헤드리스 크로미움**이 그린다.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const G = require('./geometry.js');

const HERE = __dirname;
const { findBrowser } = require(path.join(
  HERE, '..', '..', 'im-agent', 'ui', 'platform', 'build-static.js'));

/** 맥이 요구하는 열 장. 이름이 정확해야 `iconutil` 이 받는다 */
const ICONSET = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
];

const pts = (list) => list.map((p) => p.join(',')).join(' ');

/** 나침반 그림만. `withPlate` 면 흰 둥근 사각형을 깔고 그린다 */
function mark(opt) {
  const o = opt || {};
  const p = G.planePoints();
  const plate = o.withPlate
    ? `  <rect x="${G.PLATE.x}" y="${G.PLATE.y}" width="${G.PLATE.size}" height="${G.PLATE.size}"`
      + ` rx="${G.PLATE.radius}" ry="${G.PLATE.radius}" fill="${G.COLOR.plate}"/>\n`
    : '';
  return plate
    /* 고리 — 가운데 선 반지름에 굵기를 준다 */
    + `  <circle cx="${G.CENTER.x}" cy="${G.CENTER.y}" r="${G.RING.r}"`
    + ` fill="none" stroke="${G.COLOR.ink}" stroke-width="${G.RING.width}"/>\n`
    /* 동서남북 마름모 — 이것이 **가장 바깥**이라 원이 가장 크게 읽힌다 */
    + [0, 90, 180, 270].map((d) =>
      `  <polygon points="${pts(G.pip(d))}" fill="${G.COLOR.ink}"/>`).join('\n') + '\n'
    /* 종이비행기 — 뒤(어두운 면)부터 앞(밝은 면) 차례로 */
    + `  <polygon points="${pts([p.keel, p.wingA, p.wingB])}" fill="${G.COLOR.planeDark}"/>\n`
    + `  <polygon points="${pts([p.nose, p.keel, p.wingB])}" fill="${G.COLOR.planeMid}"/>\n`
    + `  <polygon points="${pts([p.nose, p.wingA, p.keel])}" fill="${G.COLOR.planeLight}"/>\n`;
}

function svg(opt) {
  const o = opt || {};
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${G.CANVAS}" height="${G.CANVAS}"`
    + ` viewBox="0 0 ${G.CANVAS} ${G.CANVAS}" role="img" aria-label="LinkPilot">\n`
    + `  <title>LinkPilot</title>\n`
    + mark(o)
    + `</svg>\n`;
}

/**
 * 크로미움으로 PNG 를 찍는다. **투명 바탕**으로 찍는다 —
 * 안 그러면 둥근 모서리 밖이 흰색으로 칠해져 부두에서 네모로 보인다.
 */
function png(browser, svgMarkup, out, size) {
  const page = out + '.html';
  /* ★★★ **그림을 글자로 박아 넣는다 — `img src` 로 부르지 않는다**
   *   〈2026-08-30 · 스스로 잡았다〉.
   *
   *   앞 판은 임시 html 을 **PNG 가 나갈 폴더**에 쓰고 `img src` 로 옆 SVG 를
   *   불렀다. 그런데 SVG 는 **한 칸 위 폴더**에 있어서 못 찾았다 — 그런데
   *   크로미움은 **오류를 안 낸다.** 깨진 그림 표시만 찍고 정상 종료했고,
   *   스크립트는 「10장 만들었다」로 끝났다. **파일도 있고 크기도 있는데
   *   전부 빈 그림이었다.** 눈으로 열어 보지 않았으면 그대로 나갔다.
   *
   * ★ 그래서 부르지 않고 **그 자리에 박는다.** 부를 것이 없으면 못 찾을 수도 없다. */
  fs.writeFileSync(page,
    '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'html,body{margin:0;padding:0;background:transparent}'
    + `svg{display:block;width:${size}px;height:${size}px}`
    + '</style></head><body>' + svgMarkup + '</body></html>');
  execFileSync(browser, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--window-size=${size},${size}`,
    '--default-background-color=00000000',      // 투명
    `--screenshot=${out}`,
    '--virtual-time-budget=4000',
    page,
  ], { stdio: 'pipe' });
  fs.unlinkSync(page);
}

function build() {
  const iconSvg = path.join(HERE, 'linkpilot-icon.svg');
  const markSvg = path.join(HERE, 'linkpilot-mark.svg');
  fs.writeFileSync(iconSvg, svg({ withPlate: true }), 'utf8');
  fs.writeFileSync(markSvg, svg({ withPlate: false }), 'utf8');
  console.log('  ' + path.relative(process.cwd(), iconSvg) + ' · 앱 아이콘 원본');
  console.log('  ' + path.relative(process.cwd(), markSvg) + ' · 나침반만 (파비콘·화면용)');

  const browser = findBrowser();
  if (!browser) {
    /* ★ 조용히 넘어가지 않는다 (§6-1). 「PNG 가 있어야 하는데 없다」를
       아무도 모르는 상태를 만들지 않는다 */
    console.log('  ⚠️  크로미움이 없어 PNG 를 **못 만들었다** — SVG 만 냈다.');
    return 2;
  }
  const set = path.join(HERE, 'LinkPilot.iconset');
  fs.mkdirSync(set, { recursive: true });
  const markup = svg({ withPlate: true });
  ICONSET.forEach(([name, size]) => {
    png(browser, markup, path.join(set, name), size);
  });
  console.log('  ' + path.relative(process.cwd(), set) + ' · 맥용 ' + ICONSET.length + '장');
  return 0;
}

if (require.main === module) process.exit(build());
module.exports = { build, svg, mark, ICONSET };
