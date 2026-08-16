'use strict';
/**
 * raster.js — SVG 를 **JPEG 로도** 낸다 (CLAUDE.md §6 — SVG 는 항상 JPEG 을 함께).
 *
 * 왜 필요한가: SVG 는 브라우저에서만 확실히 열린다. 카카오톡·메일 미리보기·
 * 파워포인트 붙여넣기·인쇄 대화상자에서는 빈 칸이 되거나 아예 안 뜬다.
 * 그림을 보라고 보냈는데 빈 칸이 오는 것은 안 보낸 것보다 나쁘다 — 고장으로 읽힌다.
 *
 * ★ **라이브러리를 들이지 않는다.** sharp·canvas·resvg 는 전부 네이티브
 *   의존성이라 §5(의존성 최소화)에 걸린다. 대신 이 저장소가 이미 쓰는
 *   **헤드리스 크로미움**에 그리게 한다 — 파일 확장자로 JPEG 을 직접 써 준다.
 *
 * ★ **SVG 를 지우지 않는다.** JPEG 은 덧붙이는 것이다. SVG 는 벡터라 인쇄에서
 *   깨지지 않고 글자를 고를 수 있다. 둘 다 남긴다.
 *
 * ★ **브라우저가 없으면 조용히 넘어가지 않는다.** 없는 환경(NAS 운영 서버)이
 *   실제로 있다. 그때 `{ok:false, reason}` 을 돌려주고, 부르는 쪽이 경고를
 *   남긴다 — 「JPEG 이 있어야 하는데 없다」를 아무도 모르는 상태를 만들지 않는다.
 *
 * ★ **크기를 SVG 에서 읽는다.** 창 크기를 짐작하면 잘리거나 여백이 생긴다.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/** 인쇄까지 견디게 2배로 그린다. 화면용만이면 1로 낮춘다 */
const DEFAULT_SCALE = 2;
const RENDER_TIMEOUT_MS = 20000;

/**
 * 헤드리스 크로미움 찾기.
 * ★ `ui/platform/build-static.js` 와 **같은 규칙**이다. 두 벌로 두면 한쪽에서만
 *   찾아지는 환경이 생기고, 그때 왜 한쪽만 되는지 알기 어렵다.
 */
function findBrowser() {
  const fromEnv = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM;
  const candidates = [fromEnv].filter(Boolean);
  const roots = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch (_) { continue; }
    for (const d of dirs) {
      candidates.push(path.join(root, d, 'chrome-linux', 'headless_shell'));
      candidates.push(path.join(root, d, 'chrome-linux', 'chrome'));
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  return candidates.find((p) => {
    try { return fs.statSync(p).isFile(); } catch (_) { return false; }
  }) || null;
}

/**
 * SVG 의 자기 크기. `width`/`height` 를 먼저 보고, 없으면 `viewBox` 를 본다.
 * ★ 못 읽으면 **짐작하지 않는다** — 창 크기를 잘못 잡으면 그림이 잘린다.
 */
function sizeOf(svg) {
  const s = String(svg || '');
  // ★ **여는 `<svg …>` 태그 안에서만** 찾는다. 문서 앞부분을 통째로 훑으면
  //   첫 `<rect width="10">` 을 캔버스 크기로 집어 10px 짜리 그림이 나온다
  //   (테스트가 실제로 잡았다).
  const open = s.match(/<svg\b[^>]*>/i);
  if (!open) return null;
  const head = open[0];
  const w = (head.match(/\swidth="(\d+(?:\.\d+)?)(?:px)?"/) || [])[1];
  const h = (head.match(/\sheight="(\d+(?:\.\d+)?)(?:px)?"/) || [])[1];
  if (w && h) return { width: Math.round(Number(w)), height: Math.round(Number(h)), from: 'width/height' };

  const vb = (head.match(/viewBox="([\d.\s-]+)"/) || [])[1];
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]), from: 'viewBox' };
    }
  }
  return null;
}

/**
 * SVG 파일 → JPEG 파일.
 *
 * @param {string} svgPath  .svg 경로
 * @param {object} [opt] { out, scale, browser }
 * @returns {{ok, path, bytes, width, height, reason}}
 */
function svgFileToJpeg(svgPath, opt) {
  const o = opt || {};
  const out = o.out || svgPath.replace(/\.svg$/i, '.jpg');

  let svg;
  try { svg = fs.readFileSync(svgPath, 'utf8'); } catch (e) {
    return { ok: false, path: null, reason: `SVG 를 읽지 못했다: ${e.message}` };
  }

  const size = sizeOf(svg);
  if (!size) {
    return {
      ok: false, path: null,
      reason: 'SVG 에 width/height 도 viewBox 도 없다 — 창 크기를 짐작하면 그림이 잘린다',
    };
  }

  const browser = o.browser || findBrowser();
  if (!browser) {
    return {
      ok: false, path: null, width: size.width, height: size.height,
      reason: '헤드리스 크로미움이 없어 JPEG 을 만들지 못했다 (SVG 는 그대로 남아 있다). '
        + 'CHROME_PATH 로 알려 주거나 그 서버에 크로미움을 설치하면 된다',
    };
  }

  const scale = o.scale || DEFAULT_SCALE;
  // ★ SVG 를 그대로 열지 않고 감싸는 문서에 넣는다. SVG 를 직접 열면 브라우저가
  //   여백과 배경(투명 → 검정)을 자기 방식으로 넣어, 인쇄본에서 검은 테두리가 생긴다
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-raster-'));
  const page = path.join(tmp, 'page.html');
  fs.writeFileSync(page,
    '<!doctype html><meta charset="utf-8">'
    + '<style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style>'
    + svg, 'utf8');

  try {
    execFileSync(browser, [
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      `--force-device-scale-factor=${scale}`,
      `--window-size=${size.width},${size.height}`,
      '--default-background-color=FFFFFFFF',
      `--screenshot=${out}`,
      'file://' + page,
    ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: RENDER_TIMEOUT_MS });
  } catch (e) {
    return { ok: false, path: null, reason: `JPEG 변환 실패: ${e.message}` };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }
  }

  let bytes = 0;
  try { bytes = fs.statSync(out).size; } catch (_) { bytes = 0; }
  if (!bytes) {
    // ★ 파일이 안 생겼는데 성공으로 두면, 화면에는 「JPEG 있음」이 뜨고 열면 없다
    return { ok: false, path: null, reason: 'JPEG 이 만들어지지 않았다 (빈 파일)' };
  }

  return {
    ok: true, path: out, bytes,
    width: size.width * scale, height: size.height * scale,
    reason: null,
  };
}

/**
 * 파일 목록에서 `.svg` 를 찾아 전부 JPEG 으로도 만든다.
 *
 * @param {string} baseDir  파일 경로의 기준 폴더
 * @param {string[]} relPaths 프로젝트 상대 경로들 (예: '04_Property/massing.svg')
 * @returns {{made:string[], failed:Array<{rel,reason}>}}
 */
function alongside(baseDir, relPaths, opt) {
  const made = [];
  const failed = [];
  // 브라우저를 한 번만 찾는다 (파일마다 찾으면 디렉터리를 몇 번씩 훑는다)
  const browser = (opt && opt.browser) || findBrowser();

  (relPaths || []).filter(r => /\.svg$/i.test(r)).forEach((rel) => {
    const r = svgFileToJpeg(path.join(baseDir, rel), { ...(opt || {}), browser });
    if (r.ok) made.push(rel.replace(/\.svg$/i, '.jpg'));
    else failed.push({ rel, reason: r.reason });
  });
  return { made, failed };
}

module.exports = { svgFileToJpeg, alongside, findBrowser, sizeOf, DEFAULT_SCALE };
