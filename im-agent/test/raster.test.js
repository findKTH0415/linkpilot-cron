'use strict';
/**
 * raster.test.js — SVG 를 JPEG 으로도 내는 규칙 (CLAUDE.md §6-1).
 *
 * 이 규칙의 실패는 조용하다. JPEG 이 안 만들어져도 SVG 는 남아 있어서
 * 산출물 목록은 멀쩡해 보인다 — 그리고 받은 사람이 메일에서 열었을 때
 * 빈 칸을 본다. 그래서 「못 만들었으면 반드시 말한다」를 테스트로 고정한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const raster = require('../core/raster');
const birdseye = require('../geo/birdseye');
const geometry = require('../geo/geometry');
const mass = require('../geo/mass');

const PARCEL = [[0, 0], [40, 0], [52, 26], [18, 38], [-6, 20]];
const HAS_BROWSER = !!raster.findBrowser();

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'raster-t-'));
}

function sampleSvg() {
  const built = mass.buildMass(geometry.scaleAboutCentroid(PARCEL, 0.6),
    { floors: 6, floorHeight: 4, basementFloors: 0 });
  return birdseye.render({ parcel: PARCEL, mass: built, label: '표본' }).svg;
}

/* ───────────── 크기 읽기 ───────────── */

/** ★ 창 크기를 짐작하면 그림이 잘리거나 여백이 생긴다 */
test('★ SVG 자기 크기를 읽는다 (width/height → viewBox 순)', () => {
  assert.deepStrictEqual(raster.sizeOf('<svg width="880" height="600" viewBox="0 0 100 50">'),
    { width: 880, height: 600, from: 'width/height' });
  assert.deepStrictEqual(raster.sizeOf('<svg viewBox="0 0 400 300">'),
    { width: 400, height: 300, from: 'viewBox' });
  assert.deepStrictEqual(raster.sizeOf('<svg width="320px" height="240px">'),
    { width: 320, height: 240, from: 'width/height' });
});

test('★ 크기를 모르면 짐작하지 않고 null 이다', () => {
  assert.strictEqual(raster.sizeOf('<svg>'), null);
  assert.strictEqual(raster.sizeOf('<svg viewBox="0 0 0 0">'), null);
  assert.strictEqual(raster.sizeOf(''), null);
});

test('★ 크기를 못 읽으면 변환하지 않고 사유를 말한다', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'nosize.svg');
  fs.writeFileSync(p, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
  const r = raster.svgFileToJpeg(p);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /짐작하면 그림이 잘린다/);
});

test('★ 없는 파일은 그렇다고 말한다', () => {
  const r = raster.svgFileToJpeg(path.join(tmpDir(), '없다.svg'));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /읽지 못했다/);
});

/**
 * ★ **브라우저가 없는 서버가 실제로 있다** (NAS 운영기). 그때 성공으로 두면
 *   산출물 목록에는 JPEG 이 있고 열면 없다.
 */
test('★ 브라우저가 없으면 사유를 남기고 SVG 는 그대로 둔다', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'a.svg');
  fs.writeFileSync(p, sampleSvg());

  const r = raster.svgFileToJpeg(p, { browser: null, out: path.join(dir, 'a.jpg') });
  // browser:null 은 "자동 탐색"으로 읽히므로, 탐색 결과가 없을 때만 이 분기를 본다
  if (!HAS_BROWSER) {
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /헤드리스 크로미움이 없어/);
    assert.match(r.reason, /SVG 는 그대로 남아 있다/);
  }
  assert.ok(fs.existsSync(p), 'SVG 를 지우면 안 된다 — JPEG 은 덧붙이는 것이다');
});

/* ───────────── 실제 변환 (브라우저가 있을 때만) ───────────── */

test('★ 실제로 JPEG 이 만들어진다', { skip: !HAS_BROWSER && '헤드리스 크로미움 없음' }, () => {
  const dir = tmpDir();
  const p = path.join(dir, 'birdseye.svg');
  fs.writeFileSync(p, sampleSvg());

  const r = raster.svgFileToJpeg(p);
  assert.strictEqual(r.ok, true, r.reason || '');
  assert.strictEqual(r.path, path.join(dir, 'birdseye.jpg'), '같은 이름 옆에 둬야 짝이 보인다');
  assert.ok(r.bytes > 2000, `${r.bytes}B — 너무 작다. 빈 그림일 수 있다`);

  const head = fs.readFileSync(r.path).subarray(0, 3);
  assert.deepStrictEqual([...head], [0xFF, 0xD8, 0xFF], 'JPEG 머리표가 아니다');

  // 인쇄까지 견디게 2배로 그린다
  assert.strictEqual(r.width, 880 * raster.DEFAULT_SCALE);
  assert.strictEqual(r.height, 600 * raster.DEFAULT_SCALE);
  assert.ok(fs.existsSync(p), 'SVG 가 사라졌다');
});

test('★ 목록에서 .svg 만 골라 나란히 만든다', { skip: !HAS_BROWSER && '헤드리스 크로미움 없음' }, () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, '04_Property'), { recursive: true });
  fs.writeFileSync(path.join(dir, '04_Property/a.svg'), sampleSvg());
  fs.writeFileSync(path.join(dir, '04_Property/b.obj'), 'v 0 0 0\n');

  const r = raster.alongside(dir, ['04_Property/a.svg', '04_Property/b.obj']);
  assert.deepStrictEqual(r.made, ['04_Property/a.jpg']);
  assert.deepStrictEqual(r.failed, [], 'obj 를 변환하려 들면 안 된다');
  assert.ok(fs.existsSync(path.join(dir, '04_Property/a.jpg')));
});

/* ───────────── 파이프라인에 붙어 있는가 ───────────── */

test('★ 09 Massing 이 SVG 를 낼 때 JPEG 도 낸다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents', '09-massing.js'), 'utf8');
  assert.match(src, /raster\.alongside\(/, 'SVG 만 내고 있다');
  assert.match(src, /ctx\.warn\(`\$\{f\.rel\} 의 JPEG 을 만들지 못했다/,
    '못 만들었는데 아무 말이 없으면 아무도 모른다');
  assert.match(src, /JPEG_MISSING/, '검증 플래그로도 남겨야 화면에 뜬다');
});

/** ★ 브라우저 찾는 규칙이 두 벌이면 한쪽에서만 찾아지는 환경이 생긴다 */
test('★ 브라우저 찾는 규칙을 두 벌로 두지 않는다', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', 'core', 'raster.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'build-static.js'), 'utf8');
  ['/opt/pw-browsers', 'CHROME_PATH', 'headless_shell', '/usr/bin/chromium'].forEach((k) => {
    assert.ok(a.includes(k) && b.includes(k), `${k} 가 한쪽에만 있다`);
  });
  assert.match(a, /build-static\.js. 와 \*\*같은 규칙\*\*/, '같은 규칙이라는 것을 적어 둬야 한다');
});

/** ★ 규칙이 CLAUDE.md 에 없으면 다음 사람이 SVG 만 내고 끝낸다 */
test('★ 규칙이 CLAUDE.md 에 적혀 있다', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'CLAUDE.md'), 'utf8');
  assert.match(md, /SVG 와 JPEG 을 \*\*둘 다\*\* 낸다/);
  assert.match(md, /core\/raster\.js/);
  assert.match(md, /브라우저가 없으면 조용히 넘어가지 않는다/);
});
