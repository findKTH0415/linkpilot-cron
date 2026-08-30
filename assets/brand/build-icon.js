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
function png(browser, svgMarkup, out, size, bg) {
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
    /* ★★★ **바닥 몇 줄이 비는 것을 바탕색으로 막는다** 〈2026-08-30 · 검사가 잡았다〉.
     *   창은 512인데 그림이 509줄쯤 그려져 **아래 가장자리가 투명하게** 남았다.
     *   오려 내는 판(maskable)에서는 그 몇 줄이 곧 「가장자리까지 안 찼다」가 되어
     *   아이콘이 쪼그라든다. 그림 크기를 맞추려 씨름하는 대신 **창 바탕을 흰색으로**
     *   둔다 — 어차피 그 판은 흰 바탕이므로 덮여도 같은 색이다.
     *   ★ 안 오려 내는 판은 그대로 **투명**이다. 모서리 밖이 비쳐야 한다. */
    `--default-background-color=${bg || '00000000'}`,
    `--screenshot=${out}`,
    '--virtual-time-budget=4000',
    page,
  ], { stdio: 'pipe' });
  fs.unlinkSync(page);
}

/**
 * ══════════ **`.icns` 를 여기서 만든다** 〈2026-08-30 사장님 지시 · D-187〉 ══════════
 *
 * 사장님 지시: 「개정된 파비콘 앱 다운로드 될수 있도록 · 갱신한 주소로 접속해도
 * 과거 버젼이 다운로드됨」.
 *
 * ★★★ 앞 판은 **맥에서 `iconutil` 을 치셔야** `.icns` 가 됐다. 그런데 그 한 줄이
 *   안 쳐지면 **아이콘은 영영 안 바뀐다** — 실제로 안 바뀐 채로 며칠이 갔다.
 *   손으로 해야 도는 장치는 안 돈다 (D-88 과 같은 결).
 *
 * ★ `.icns` 는 **겉모양이 아주 단순하다** — 머리 8바이트 뒤에 「종류 4자 + 길이 4바이트
 *   + PNG」가 이어질 뿐이다. 그래서 라이브러리 없이(§5) `fs` 만으로 쓴다.
 *
 * ★★ 종류 이름은 **크기마다 정해져 있다.** 틀리면 맥이 통째로 거절하는데,
 *   그때 나오는 말은 한 줄뿐이라 무엇이 틀렸는지 안 알려 준다. 그래서 표로 둔다.
 */
const ICNS_TYPE = {
  'icon_16x16.png': 'icp4',
  'icon_16x16@2x.png': 'ic11',
  'icon_32x32.png': 'icp5',
  'icon_32x32@2x.png': 'ic12',
  'icon_128x128.png': 'ic07',
  'icon_128x128@2x.png': 'ic13',
  'icon_256x256.png': 'ic08',
  'icon_256x256@2x.png': 'ic14',
  'icon_512x512.png': 'ic09',
  'icon_512x512@2x.png': 'ic10',
};

/** 묶은 것을 도로 풀어 본다 — **쓴 것과 읽히는 것이 같은지**를 검사가 잰다 */
function readIcns(buf) {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'icns') {
    throw new Error('icns 가 아니다 (머리 네 글자가 다르다)');
  }
  const total = buf.readUInt32BE(4);
  if (total !== buf.length) throw new Error(`적어 둔 길이(${total})와 실제(${buf.length})가 다르다`);
  const out = [];
  let at = 8;
  while (at + 8 <= buf.length) {
    const type = buf.toString('ascii', at, at + 4);
    const len = buf.readUInt32BE(at + 4);
    if (len < 8 || at + len > buf.length) throw new Error(`조각 길이가 틀렸다: ${type}`);
    out.push({ type, bytes: len - 8 });
    at += len;
  }
  return out;
}

/**
 * 열 장을 `.icns` 한 벌로 묶는다.
 *
 * ★ 한 장이라도 없으면 **묶지 않는다.** 반쯤 묶인 것을 내면 맥이 거절하는데,
 *   그때는 「아이콘이 안 바뀐다」로만 보여 원인이 안 보인다.
 */
function icns(dir) {
  const parts = [];
  Object.keys(ICNS_TYPE).forEach((name) => {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) throw new Error(`묶을 그림이 없다: ${name}`);
    const png = fs.readFileSync(f);
    const head = Buffer.alloc(8);
    head.write(ICNS_TYPE[name], 0, 4, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    parts.push(head, png);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/**
 * ══════════ **웹앱(PWA) 아이콘** 〈2026-08-30 사장님 화면 · D-188〉 ══════════
 *
 * ★★★ **`.icns` 로는 안 바뀐다.** 사장님이 「앱 다운로드」라고 하신 것은
 *   안드로이드 크롬의 **「설치 및 바로가기 만들기」**였다 — 맥 앱 꾸러미가
 *   아니라 **웹앱(PWA)** 이다. 그 아이콘은 `.icns` 가 아니라 **웹 매니페스트의
 *   PNG** 에서 온다. 앞 판은 맥 쪽만 만들어 두고 「아이콘을 고쳤다」고 말했다 —
 *   **고친 것이 그 자리에 안 닿았다.**
 *
 * ★★ **안드로이드는 그림을 동그랗게 오려 낸다**(masking). 그래서 두 벌이 필요하다 —
 *
 *     any       지금 아이콘 그대로 (둥근 사각형 + 투명 여백). 오려 내지 않는 자리용
 *     maskable  **가장자리까지 꽉 채운** 판. 오려 내도 흰 판이 안 잘린다
 *
 *   `maskable` 을 안 주면 안드로이드가 **투명 여백째로 오려** 아이콘이 조그맣게
 *   박힌 흰 동그라미가 된다. 반대로 `maskable` 만 주면 오려 내지 않는 자리에서
 *   모서리가 각진 네모로 뜬다. **둘 다 낸다.**
 *
 * ★ 안전 반경: 오려 내는 원은 한 변의 **80%**다. 우리 그림은 한가운데에서
 *   가장 멀리 닿는 곳이 한 변의 29%(지름 58%)라 **넉넉히 들어간다** —
 *   `geometry.js` 의 `markReach()` 로 재서 검사가 지킨다.
 */
const PWA = [
  ['linkpilot-192.png', 192, 'any'],
  ['linkpilot-512.png', 512, 'any'],
  ['linkpilot-maskable-192.png', 192, 'maskable'],
  ['linkpilot-maskable-512.png', 512, 'maskable'],
];

/** 가장자리까지 꽉 채운 판 — 오려 내도 안 잘린다 */
function maskableSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${G.CANVAS}" height="${G.CANVAS}"`
    + ` viewBox="0 0 ${G.CANVAS} ${G.CANVAS}" preserveAspectRatio="none" role="img" aria-label="LinkPilot">\n`
    + `  <title>LinkPilot</title>\n`
    + `  <rect x="-8" y="-8" width="${G.CANVAS + 16}" height="${G.CANVAS + 16}" fill="${G.COLOR.plate}"/>\n`
    + mark({ withPlate: false })
    + `</svg>\n`;
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

  /* ★★★ **웹앱(PWA) 아이콘** — 사장님이 실제로 설치하시는 자리다 (D-188).
   *   안드로이드 크롬의 「설치 및 바로가기 만들기」가 쓰는 것은 이쪽이다. */
  const web = path.join(HERE, 'pwa');
  fs.mkdirSync(web, { recursive: true });
  const anySvg = svg({ withPlate: true });
  const maskSvg = maskableSvg();
  PWA.forEach(([name, size, purpose]) => {
    png(browser, purpose === 'maskable' ? maskSvg : anySvg, path.join(web, name), size,
      purpose === 'maskable' ? 'FFFFFFFF' : '00000000');
  });
  console.log('  ' + path.relative(process.cwd(), web) + ' · 웹앱용 ' + PWA.length + '장'
    + ' (오려 내는 자리용 · 안 오려 내는 자리용)');

  /* ★ 그리고 **바로 쓸 수 있는 한 벌**로 묶는다. 맥에서 `iconutil` 을 안 쳐도 된다 */
  const out = path.join(HERE, 'LinkPilot.icns');
  const buf = icns(set);
  fs.writeFileSync(out, buf);
  const back = readIcns(buf);
  console.log('  ' + path.relative(process.cwd(), out)
    + ` · ${back.length}조각 · ${Math.round(buf.length / 1024)}KB (도로 풀어 확인했다)`);
  return 0;
}

if (require.main === module) process.exit(build());
module.exports = { build, svg, mark, maskableSvg, ICONSET, PWA, icns, readIcns, ICNS_TYPE };
