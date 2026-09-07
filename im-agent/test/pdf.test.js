'use strict';
/**
 * pdf.test.js — `npm run im:pdf` 가 대외 문서를 A4 PDF 로 뽑는지 (CLAUDE.md §6-2-1).
 *
 * ★★★ **이 시험의 핵심은 「뽑히는가」가 아니라 「틀린 것을 잡는가」다.**
 *   이 도구를 만들던 날, 글꼴 검사가 **초록인데 PDF 는 다른 글꼴로** 나온 일이 있었다
 *   (fc-list 를 글자로 훑어 「IBM Plex Mono Medium」을 「IBM Plex Mono」로 읽었다).
 *   **검사가 눈이 멀어 있으면 시험도 같이 눈이 먼다** (MEMORY M-30 — 표본이 거짓말을 하면
 *   잡히는 것도 거짓이다). 그래서 아래는 **일부러 틀린 것을 넣어 빨개지는지** 본다.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pdf = require('../tools/pdf');
const fresh = require('../tools/pdf-fresh');

/** 인쇄 규격이 든 최소 문서 하나 */
function sampleHtml(opt) {
  const o = opt || {};
  return '<!doctype html><meta charset="utf-8"><title>표본</title>'
    + (o.noFonts ? '' : '<link rel="stylesheet" href="https://fonts.googleapis.com/css2'
      + '?family=Noto+Sans+KR:wght@400;700&family=IBM+Plex+Mono:wght@500&display=swap">')
    + (o.noPrint ? '<style>body{font-family:"Noto Sans KR",sans-serif}</style>'
      : '<style>@page{size:A4;margin:15mm}@media print{body{background:#fff}}'
        + 'body{font-family:"Noto Sans KR",sans-serif}</style>')
    + '<h1>표본 문서</h1><p>대외 문서 인쇄 시험용입니다.</p>';
}

function tmpFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-pdf-test-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

/* ── 1. HTML 에서 「없으면 안 되는 글꼴」을 읽는가 ───────────────── */

test('웹폰트 주소에서 글꼴 이름과 굵기를 읽는다', () => {
  const got = pdf.fontsWanted(sampleHtml());
  const names = got.map(f => f.family).sort();
  assert.deepStrictEqual(names, ['IBM Plex Mono', 'Noto Sans KR']);
  const sans = got.find(f => f.family === 'Noto Sans KR');
  assert.deepStrictEqual(sans.weights, [400, 700]);
});

test('CSS 의 대체 글꼴은 「없으면 안 되는 것」으로 세지 않는다', () => {
  // font-family 에는 sans-serif 같은 대체값이 섞여 있다. 그것까지 요구하면
  // 절대 못 갖추는 조건이 되어 이 도구가 늘 빨갛게 끝난다.
  const got = pdf.fontsWanted(sampleHtml()).map(f => f.family);
  assert.ok(!got.includes('sans-serif'));
  assert.ok(!got.includes('Malgun Gothic'));
});

test('웹폰트를 안 쓰는 문서는 요구 글꼴이 없다', () => {
  assert.deepStrictEqual(pdf.fontsWanted(sampleHtml({ noFonts: true })), []);
});

/* ── 2. 인쇄 규격이 없는 문서를 조용히 뽑지 않는가 ───────────────── */

test('@page 도 @media print 도 없으면 뽑지 않고 이유를 말한다', () => {
  const p = tmpFile('noprint.html', sampleHtml({ noPrint: true }));
  const r = pdf.htmlToPdf(p);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /인쇄 규격/);
  assert.ok(!fs.existsSync(p.replace(/\.html$/, '.pdf')), 'PDF 를 만들면 안 된다');
});

/* ── 3. PDF 검사가 실제로 무엇을 잡는가 ─────────────────────────── */

test('PDF 가 아닌 파일은 잡는다', () => {
  const p = tmpFile('fake.pdf', 'PDF 인 척하는 글자');
  const r = pdf.inspect(p, []);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /PDF 가 아니|너무 작다/);
});

test('★ 없는 글꼴을 요구하면 빨개진다 — 검사가 눈을 뜨고 있는지', () => {
  // 진짜 PDF 를 하나 만들고, 거기 있을 리 없는 글꼴을 요구한다.
  // 이 시험이 통과한다는 것은 「글꼴이 안 박힌 PDF 를 통과시키지 않는다」는 뜻이다.
  const html = tmpFile('ok.html', sampleHtml({ noFonts: true })
    .replace('<style>', '<style>@page{size:A4;margin:15mm}@media print{body{background:#fff}}'));
  const made = pdf.htmlToPdf(html);
  if (made.measured === false) return; // 크로미움이 없는 자리 — 못 잰 것이지 통과가 아니다

  assert.strictEqual(made.ok, true, made.reason || '기본 문서는 뽑혀야 한다');
  const strict = pdf.inspect(made.path, [{ family: '있을 리 없는 글꼴 XYZ', weights: [] }]);
  assert.strictEqual(strict.ok, false, '없는 글꼴을 요구했는데 통과하면 검사가 눈이 먼 것이다');
  assert.deepStrictEqual(strict.fontMissing, ['있을 리 없는 글꼴 XYZ']);
});

test('뽑힌 PDF 는 A4 이고 쪽수가 0 이 아니다', () => {
  const html = tmpFile('a4.html', sampleHtml({ noFonts: true })
    .replace('<style>', '<style>@page{size:A4;margin:15mm}@media print{body{background:#fff}}'));
  const r = pdf.htmlToPdf(html);
  if (r.measured === false) return; // 크로미움 없음

  assert.strictEqual(r.ok, true, r.reason || 'A4 로 뽑혀야 한다');
  assert.ok(r.pages >= 1, `쪽수가 ${r.pages} 이다`);
  assert.strictEqual(r.isA4, true,
    `A4 가 아니다: ${Math.round(r.size.w)}×${Math.round(r.size.h)}pt`);
});

/* ── 4. 「그 이름으로 쓰이는가」를 재는가 ───────────────────────── */

test('★ 글꼴 확인은 fc-list 를 글자로 훑지 않는다', () => {
  // 〈2026-08-31 · 실제로 당했다〉 굵기 500 짜리 TTF 는 자기 이름을
  // 「IBM Plex Mono Medium」으로 등록한다. fc-list 글자에는 「IBM Plex Mono」가
  // 들어 있지만, 브라우저가 그 이름으로 물으면 fontconfig 는 못 찾는다.
  // 그래서 이 함수는 fc-list 문자열을 답의 근거로 삼으면 안 된다.
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'pdf.js'), 'utf8');
  // ★ 주석에 경위를 길게 적어 두었으므로 **주석을 떼고** 본다 (CLAUDE.md §8).
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  const fn = code.slice(code.indexOf('function installed('), code.indexOf('function installFonts('));
  assert.match(fn, /fc-match/, 'installed() 는 fc-match 로 물어야 한다');
  assert.ok(!/list\.toLowerCase\(\)\.includes/.test(fn),
    'fc-list 문자열을 훑어 판정하면 「IBM Plex Mono Medium」을 「IBM Plex Mono」로 읽는다');
});

test('fc-match 를 못 쓰는 자리에서는 「있다」고 하지 않는다', () => {
  // 못 잰 것은 통과가 아니다 (CLAUDE.md §8). null 이 그 뜻이다.
  assert.strictEqual(pdf.installed(null, 'Noto Sans KR'), null);
});

/* ── 5. 이 저장소의 규칙이 실제로 적혀 있는가 ──────────────────── */

test('CLAUDE.md §6-2-1 이 im:pdf 를 가리킨다', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'CLAUDE.md'), 'utf8');
  assert.match(md, /### 6-2-1\./, '§6-2-1 이 있어야 한다');
  assert.match(md, /npm run im:pdf/, '규칙이 명령 이름을 가리켜야 한다');
});

test('package.json 에 im:pdf 가 있다', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['im:pdf'], 'node im-agent/tools/pdf.js');
});

/* ── 6. 수령자 도장 ─────────────────────────────────────── */

test('같은 수령자·같은 파일·같은 날이면 번호가 같다', () => {
  const a = pdf.docNo('한국벤처투자', 'im.html', '20260831');
  const b = pdf.docNo('한국벤처투자', 'im.html', '20260831');
  assert.strictEqual(a, b);
  assert.match(a, /^LP-20260831-[0-9A-F]{4}$/);
});

test('★ 수령자가 다르면 번호도 다르다 — 이게 아니면 도장이 뜻이 없다', () => {
  const a = pdf.docNo('한국벤처투자', 'im.html', '20260831');
  const b = pdf.docNo('산업은행', 'im.html', '20260831');
  assert.notStrictEqual(a, b);
});

test('번호가 순번이 아니다 — 받는 쪽이 「나는 몇 번째인가」를 알면 안 된다', () => {
  const nos = ['가', '나', '다', '라'].map(t => pdf.docNo(t, 'im.html', '20260831'));
  assert.strictEqual(new Set(nos).size, 4);
  // 001·002 같은 연속값이 아니라는 것: 뒤 네 자리가 오름차순이 아니다
  const tails = nos.map(n => n.split('-').pop());
  assert.ok(!tails.every((v, i) => i === 0 || tails[i - 1] < v),
    '번호가 오름차순이면 순번과 다를 바 없다');
});

test('도장은 기밀 머리 옆과 꼬리 두 곳에 찍힌다', () => {
  const html = '<div class="conf"><b>Strictly Private and Confidential</b>'
    + '<span>기준일</span></div><p>본문</p><footer><p>꼬리</p></footer>';
  const r = pdf.stamp(html, '한국벤처투자', 'im.html');
  assert.strictEqual(r.ok, true);
  // ★ 스타일 블록에도 같은 이름이 들어 있다 — 자리를 잴 때는 **실제 태그**로 본다.
  //   (처음엔 이름만 찾아서 CSS 를 도장으로 세고 있었다 — M-30 과 같은 결)
  assert.ok(r.html.includes('<span class="lp-docno">'), '머리에 찍혀야 한다');
  const foot = r.html.indexOf('<p class="lp-docno-f">');
  assert.ok(foot > -1, '꼬리에도 찍혀야 한다');
  assert.ok(foot > r.html.indexOf('<footer>') && foot < r.html.indexOf('</footer>'),
    '꼬리 도장은 footer 안이어야 한다');
  assert.ok(r.html.includes(r.no));
});

test('★ 박을 자리가 없으면 조용히 넘어가지 않는다', () => {
  // 도장 없는 PDF 가 나가면 「번호를 박았다」고 믿은 채로 추적 불가능한 사본이 돈다
  const r = pdf.stamp('<h1>기밀 머리가 없는 문서</h1>', '아무개', 'x.html');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /기밀 머리/);
});

test('수령자 이름의 꺾쇠는 태그가 되지 않는다', () => {
  const html = '<div class="conf"><b>Strictly Private and Confidential</b></div>';
  const r = pdf.stamp(html, '<script>alert(1)</script>', 'im.html');
  assert.strictEqual(r.ok, true);
  assert.ok(!r.html.includes('<script>alert'), '이름이 그대로 태그가 되면 안 된다');
  assert.ok(r.html.includes('&lt;script&gt;'));
});

/* ── 7. PDF 가 화면보다 옛말을 하지 않는가 ───────────────── */

test('인쇄 규격이 없는 HTML 은 짝 검사 대상이 아니다', () => {
  const p = tmpFile('plain.html', '<h1>미리보기 화면</h1>');
  assert.strictEqual(fresh.isPrintable(p), false);
});

test('@page 나 @media print 가 있으면 검사 대상이다', () => {
  const a = tmpFile('a.html', '<style>@page{size:A4}</style>');
  const b = tmpFile('b.html', '<style>@media print{body{color:#000}}</style>');
  assert.strictEqual(fresh.isPrintable(a), true);
  assert.strictEqual(fresh.isPrintable(b), true);
});

test('★ PDF 가 HTML 보다 오래되면 stale 로 잡는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-fresh-'));
  const h = path.join(dir, 'doc.html');
  const d = path.join(dir, 'doc.pdf');
  fs.writeFileSync(h, '<style>@page{size:A4}</style><h1>문서</h1>', 'utf8');
  fs.writeFileSync(d, '%PDF-1.4\n', 'utf8');
  const old = Date.now() - 3600 * 1000;
  fs.utimesSync(d, old / 1000, old / 1000);

  const pairs = fresh.scan(dir);
  assert.strictEqual(pairs.length, 1, '짝 하나를 찾아야 한다');
  assert.strictEqual(pairs[0].stale, true, 'PDF 가 한 시간 뒤처졌는데 통과하면 검사가 눈이 먼 것이다');
});

test('같은 시각이면 통과한다 — git 클론의 몇 초 차로 빨개지지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-fresh2-'));
  const h = path.join(dir, 'doc.html');
  const d = path.join(dir, 'doc.pdf');
  fs.writeFileSync(h, '<style>@page{size:A4}</style>', 'utf8');
  fs.writeFileSync(d, '%PDF-1.4\n', 'utf8');
  const pairs = fresh.scan(dir);
  assert.strictEqual(pairs.length, 1);
  assert.strictEqual(pairs[0].stale, false);
});

test('도장 찍힌 사본도 같은 HTML 의 짝으로 센다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-fresh3-'));
  fs.writeFileSync(path.join(dir, 'doc.html'), '<style>@page{size:A4}</style>', 'utf8');
  fs.writeFileSync(path.join(dir, 'doc.pdf'), '%PDF-1.4\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'doc__LP-20260831-ABCD.pdf'), '%PDF-1.4\n', 'utf8');
  const pairs = fresh.scan(dir);
  assert.strictEqual(pairs.length, 2, '수령자 사본이 빠지면 그 한 벌만 옛 판으로 남는다');
});

test('짝이 하나도 없으면 「못 잼」이지 통과가 아니다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-fresh4-'));
  assert.strictEqual(fresh.scan(dir).length, 0);
  // main 은 이 경우 2 를 돌려준다 (CLAUDE.md §8 — 못 잰 것은 통과가 아니다)
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'pdf-fresh.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.match(code, /짝이 하나도 없다[\s\S]{0,80}return 2/);
});

test('guard 가 이 칸을 실제로 부른다', () => {
  const g = fs.readFileSync(path.join(__dirname, '..', 'tools', 'guard.js'), 'utf8');
  const code = g.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.match(code, /pdfFresh\(\);/, 'main 에서 불러야 칸이 생긴다');
  assert.match(code, /add\('대외 문서 PDF'/);
});
