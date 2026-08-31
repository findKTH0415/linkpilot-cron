#!/usr/bin/env node
'use strict';
/**
 * pdf.js — 대외 문서 HTML 을 **A4 PDF 로** 뽑는다 (CLAUDE.md §6-2-1).
 *
 * 〈2026-08-31 사장님 지시: 「외부신청은 항상 HTML 파일을 만들어 url 연결 열어줘
 *  그리고 pdf 파일로 만들어줘」 · 「npm run im:pdf 명령으로 만들어줘」〉
 *
 * ★ **왜 명령으로 만드는가.** 규칙을 문서에만 적으면 그 규칙은 사람의 기억에
 *   얹힌다. 이 저장소는 그 자리에서 이미 여섯 번 빠뜨렸다 (MEMORY M-31 —
 *   「할 줄 몰라서」가 아니라 「빠뜨려서」). `guard` 를 한 줄로 만든 것과 같은 이유다.
 *
 * ★★ **인쇄용 파일을 따로 만들지 않는다.** 같은 HTML 의 `@media print` 를 쓴다.
 *   두 벌이면 화면만 고치고 PDF 는 안 고친 상태가 생기는데 **그것이 눈에 안 보인다**
 *   (§6-1-2 「모델 코드를 두 벌로 만들지 않는다」와 같은 결).
 *
 * ★★★ **글꼴이 이 도구의 급소다.** 헤드리스 크로미움은 프록시 뒤에서 Google Fonts 에
 *   닿지 못한다 — 그런데 화면(사장님 브라우저)은 멀쩡히 닿는다. 그러면
 *   **PDF 만 조용히 대체 글꼴로 나온다.** 오류도 안 나고, 열어 봐도 「좀 다르네」
 *   정도라 알아채기 어렵다. 그래서 이 도구는
 *   ① 뽑기 전에 글꼴이 있는지 재고, 없으면 내려받아 깔고,
 *   ② 뽑은 뒤 **PDF 안에 그 글꼴이 실제로 박혔는지** 다시 잰다.
 *   못 깔았으면 **조용히 넘어가지 않고 빨갛게 끝낸다** (§6-1 「브라우저가 없으면
 *   조용히 넘어가지 않는다」와 같은 규칙).
 *
 * 쓰는 법:
 *   npm run im:pdf -- <입력.html> [...]        지정한 파일들을 옆에 .pdf 로
 *   npm run im:pdf -- <입력.html> -o <출력.pdf>
 *   npm run im:pdf -- --check <파일.pdf>       이미 만든 PDF 만 검사
 *
 * 되돌아오는 값: 0 통과 · 1 실패 · 2 못 쟀다(§8 「못 잰 것은 통과가 아니다」)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findBrowser } = require('../core/raster');

const RENDER_TIMEOUT_MS = 90000;
const FETCH_TIMEOUT_MS = 90000;
/** A4 = 210×297mm = 595.28×841.89pt. 크로미움이 소수점을 조금씩 다르게 쓴다 */
const A4_PT = { w: 595, h: 842, tol: 3 };

const OK = '통과';
const NO = '실패';

function say(mark, line) { process.stdout.write(`${mark} ${line}\n`); }

/* ────────────────────────────────────────────────────────────
 * 1. HTML 이 어떤 글꼴을 부르는지 읽는다
 * ──────────────────────────────────────────────────────────── */

/**
 * `<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@700&...">`
 * 에서 글꼴 이름을 뽑는다.
 *
 * ★ **CSS 의 `font-family` 를 읽지 않는다.** 거기에는 대체 글꼴(`serif`,
 *   `Malgun Gothic`)이 섞여 있어 「없어도 되는 것」과 「있어야 하는 것」이 구분되지
 *   않는다. 웹폰트 주소에 적힌 것만이 **이 문서가 없으면 안 되는 글꼴**이다.
 */
function fontsWanted(html) {
  const out = [];
  const links = String(html || '').match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"']+/g) || [];
  for (const url of links) {
    for (const m of url.matchAll(/family=([^&:]+)(?::([^&]+))?/g)) {
      const family = decodeURIComponent(m[1]).replace(/\+/g, ' ').trim();
      const weights = [];
      // `wght@300;400;700` 또는 `ital,wght@0,400;1,700`
      const spec = m[2] || '';
      for (const w of spec.matchAll(/(?:^|[;,@])(\d{3})(?=[;&]|$)/g)) weights.push(Number(w[1]));
      if (family) out.push({ family, weights: [...new Set(weights)].sort((a, b) => a - b) });
    }
  }
  // 같은 글꼴이 두 링크에 나뉘어 있을 수 있다 — 굵기를 합친다
  const merged = new Map();
  for (const f of out) {
    const prev = merged.get(f.family) || { family: f.family, weights: [] };
    prev.weights = [...new Set([...prev.weights, ...f.weights])].sort((a, b) => a - b);
    merged.set(f.family, prev);
  }
  return [...merged.values()];
}

/* ────────────────────────────────────────────────────────────
 * 2. 글꼴이 이 자리에 깔려 있는가
 * ──────────────────────────────────────────────────────────── */

function fcList() {
  try {
    return execFileSync('fc-list', [], { encoding: 'utf8', timeout: 20000 });
  } catch (_) {
    return null; // fontconfig 가 없는 자리도 있다
  }
}

/**
 * 이 글꼴을 **실제로 이 이름으로 쓸 수 있는가**를 fontconfig 에게 묻는다.
 *
 * ★★★ **fc-list 를 글자로 훑지 않는다** 〈2026-08-31 · 이 도구를 만들다 바로 걸렸다〉.
 *   앞 판은 `fc-list` 결과에 이름이 들어 있으면 있다고 봤다. 그런데 Google 이 준
 *   `IBM Plex Mono` 굵기 500 짜리 TTF 는 자기 이름을 **「IBM Plex Mono Medium」**
 *   으로 등록한다. 글자로 훑으면 「IBM Plex Mono」가 들어 있으니 **있다고 나오는데**,
 *   브라우저가 `font-family:"IBM Plex Mono"` 로 물으면 fontconfig 는 못 찾고
 *   **DejaVu Sans Mono 로 바꿔치기한다.** 그래서 검사는 초록인데 PDF 의 숫자만
 *   다른 글꼴로 나왔다 — 실제로 그 상태로 문서를 두 번 내보냈다.
 *
 * ★ 그래서 **브라우저와 같은 방식으로** 묻는다. `fc-match` 는 「이 이름으로 물으면
 *   무엇이 나오는가」를 답한다. 돌아온 이름이 물어본 이름과 다르면 **없는 것**이다.
 *   fc-list 는 「깔려 있는가」를, fc-match 는 「그 이름으로 쓰이는가」를 잰다.
 */
function installed(list, family) {
  if (list == null) return null; // 못 쟀다
  let got = '';
  try {
    got = execFileSync('fc-match', ['--format=%{family}', family],
      { encoding: 'utf8', timeout: 20000 });
  } catch (_) {
    return null; // fc-match 가 없으면 못 잰 것이다 — 있다고 하지 않는다
  }
  const want = family.trim().toLowerCase();
  // fc-match 는 별칭이 있으면 쉼표로 여럿을 준다 ('Noto Sans KR,Noto Sans KR Light')
  return got.split(',').some(n => n.trim().toLowerCase() === want);
}

/**
 * Google Fonts 에서 **TTF 한 벌**을 받아 `~/.fonts` 에 깐다.
 *
 * ★ 오래된 User-Agent 를 쓴다. 요즘 브라우저인 척하면 유니코드 구간별로 쪼갠
 *   woff2 를 수백 개 주는데, 그건 fontconfig 가 못 쓴다. 옛 UA 로 물으면
 *   **글꼴마다 TTF 하나**가 온다 — 한글은 한 벌이 6~14MB 로 크지만 한 번만 받는다.
 * ★ 네트워크가 없는 자리(NAS)에서는 실패한다. 그때 **거짓으로 넘어가지 않는다.**
 */
function installFonts(wanted) {
  const spec = wanted
    .map(f => 'family=' + encodeURIComponent(f.family).replace(/%20/g, '+')
      + (f.weights.length ? ':wght@' + f.weights.join(';') : ''))
    .join('&');
  const url = `https://fonts.googleapis.com/css2?${spec}&display=swap`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-pdf-font-'));
  const cssPath = path.join(tmp, 'legacy.css');
  try {
    execFileSync('curl', ['-sS', '-m', String(Math.round(FETCH_TIMEOUT_MS / 1000)),
      '-A', 'Mozilla/4.0', '-o', cssPath, url],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: FETCH_TIMEOUT_MS });
  } catch (e) {
    return { ok: false, reason: `글꼴 목록을 받지 못했다: ${e.message}` };
  }

  let css = '';
  try { css = fs.readFileSync(cssPath, 'utf8'); } catch (e) {
    return { ok: false, reason: `글꼴 목록을 읽지 못했다: ${e.message}` };
  }
  const urls = [...new Set(css.match(/https:\/\/[^)]+\.ttf/g) || [])];
  if (!urls.length) {
    return { ok: false, reason: 'TTF 주소가 하나도 없다 — 응답이 woff2 뿐이면 fontconfig 가 못 쓴다' };
  }

  const dest = path.join(os.homedir(), '.fonts');
  fs.mkdirSync(dest, { recursive: true });
  let got = 0;
  urls.forEach((u, i) => {
    const file = path.join(dest, `im-pdf-${i + 1}.ttf`);
    try {
      execFileSync('curl', ['-sS', '-m', String(Math.round(FETCH_TIMEOUT_MS / 1000)), '-o', file, u],
        { stdio: ['ignore', 'ignore', 'pipe'], timeout: FETCH_TIMEOUT_MS });
      if (fs.statSync(file).size > 1000) got += 1;
    } catch (_) { /* 아래에서 센다 */ }
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더다 */ }

  if (!got) return { ok: false, reason: '글꼴 파일을 하나도 받지 못했다' };
  try {
    execFileSync('fc-cache', ['-f'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 60000 });
  } catch (e) {
    return { ok: false, reason: `fc-cache 실패: ${e.message}` };
  }
  return { ok: true, count: got };
}

/**
 * 글꼴을 갖춘다. 이미 있으면 아무것도 안 한다.
 * @returns {{ok:boolean, measured:boolean, missing:string[], reason?:string}}
 */
function ensureFonts(wanted) {
  if (!wanted.length) return { ok: true, measured: true, missing: [] };

  let list = fcList();
  if (list == null) {
    return { ok: false, measured: false, missing: wanted.map(f => f.family),
      reason: 'fc-list 가 없어 글꼴이 깔렸는지 잴 수 없다' };
  }
  let missing = wanted.filter(f => !installed(list, f.family)).map(f => f.family);
  if (!missing.length) return { ok: true, measured: true, missing: [] };

  const r = installFonts(wanted.filter(f => missing.includes(f.family)));
  if (!r.ok) return { ok: false, measured: true, missing, reason: r.reason };

  list = fcList();
  missing = wanted.filter(f => !installed(list, f.family)).map(f => f.family);
  return { ok: missing.length === 0, measured: true, missing,
    reason: missing.length ? '내려받았는데도 fontconfig 가 못 찾는다' : undefined };
}

/* ────────────────────────────────────────────────────────────
 * 3. 뽑은 PDF 를 검사한다
 * ──────────────────────────────────────────────────────────── */

/**
 * PDF 를 **바이트로** 본다. 라이브러리를 들이지 않는다 (§5).
 *
 * ★ 여기서 재는 셋이 각각 다른 사고를 막는다:
 *   - 쪽수 0 → 아예 안 나온 것
 *   - A4 아님 → 인쇄하면 잘리거나 여백이 생긴다
 *   - 글꼴 이름 없음 → **화면과 다른 글꼴로 나온 것** (이 도구의 급소)
 */
function inspect(pdfPath, wanted) {
  let buf;
  try { buf = fs.readFileSync(pdfPath); } catch (e) {
    return { ok: false, reason: `PDF 를 읽지 못했다: ${e.message}` };
  }
  if (buf.length < 1000 || buf.slice(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, reason: 'PDF 가 아니거나 너무 작다' };
  }
  const raw = buf.toString('latin1');

  // 쪽수: /Type /Page (Pages 가 아닌 것만)
  const pages = (raw.match(/\/Type\s*\/Page(?![sA-Za-z])/g) || []).length;

  // 크기: 첫 /MediaBox
  const mb = raw.match(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/);
  const size = mb ? { w: Number(mb[3]) - Number(mb[1]), h: Number(mb[4]) - Number(mb[2]) } : null;
  const isA4 = !!size
    && Math.abs(size.w - A4_PT.w) <= A4_PT.tol
    && Math.abs(size.h - A4_PT.h) <= A4_PT.tol;

  // 글꼴: PDF 안의 이름은 공백이 빠진 채로 박힌다 ('Noto Serif KR' → 'NotoSerifKR')
  const fontMissing = wanted
    .filter(f => !raw.includes(f.family.replace(/\s+/g, '')))
    .map(f => f.family);

  return {
    ok: pages > 0 && isA4 && fontMissing.length === 0,
    bytes: buf.length, pages, size, isA4, fontMissing,
  };
}

/* ────────────────────────────────────────────────────────────
 * 4. 뽑기
 * ──────────────────────────────────────────────────────────── */

function renderOne(htmlPath, outPath, browser) {
  const abs = path.resolve(htmlPath);
  try {
    execFileSync(browser, [
      '--headless', '--disable-gpu', '--no-sandbox',
      '--no-pdf-header-footer',
      '--virtual-time-budget=9000',
      `--print-to-pdf=${outPath}`,
      'file://' + abs,
    ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: RENDER_TIMEOUT_MS });
  } catch (e) {
    return { ok: false, reason: `PDF 변환 실패: ${e.message}` };
  }
  return { ok: true };
}

/**
 * HTML 하나 → PDF 하나.
 * @returns {{ok, path, pages, reason, fontMissing}}
 */
function htmlToPdf(htmlPath, opt) {
  const o = opt || {};
  const out = o.out || htmlPath.replace(/\.html?$/i, '.pdf');

  let html;
  try { html = fs.readFileSync(htmlPath, 'utf8'); } catch (e) {
    return { ok: false, path: null, reason: `HTML 을 읽지 못했다: ${e.message}` };
  }

  // ★ 인쇄 규격이 없는 문서를 조용히 뽑지 않는다 — A4 가 아닌 채로 나온다
  if (!/@page\b/.test(html) && !/@media\s+print/.test(html)) {
    return { ok: false, path: null,
      reason: '이 HTML 에 인쇄 규격(@page · @media print)이 없다 — 넣고 다시 부른다 (CLAUDE.md §6-2-1)' };
  }

  const wanted = o.wanted || fontsWanted(html);
  const browser = o.browser || findBrowser();
  if (!browser) {
    return { ok: false, path: null, measured: false,
      reason: '헤드리스 크로미움이 없어 PDF 를 만들지 못했다 — CHROME_PATH 로 알려 주거나 설치한다' };
  }

  const r = renderOne(htmlPath, path.resolve(out), browser);
  if (!r.ok) return { ok: false, path: null, reason: r.reason };

  const got = inspect(out, wanted);
  return { ...got, path: out, wanted };
}

/* ────────────────────────────────────────────────────────────
 * 5. 명령줄
 * ──────────────────────────────────────────────────────────── */

function usage() {
  process.stdout.write(
    '쓰는 법:\n'
    + '  npm run im:pdf -- <입력.html> [...]            옆에 같은 이름의 .pdf 를 만든다\n'
    + '  npm run im:pdf -- <입력.html> -o <출력.pdf>\n'
    + '  npm run im:pdf -- --check <파일.pdf>           이미 만든 PDF 만 검사한다\n'
    + '\n'
    + '대외로 나가는 문서는 주소와 PDF 를 둘 다 낸다 (CLAUDE.md §6-2-1).\n');
}

function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) { usage(); return 0; }

  // --check 는 이미 있는 PDF 만 본다 (글꼴은 못 재므로 안 잰다고 적는다)
  if (args[0] === '--check') {
    const files = args.slice(1);
    if (!files.length) { say(NO, '--check 뒤에 PDF 경로가 없다'); return 1; }
    let bad = 0;
    for (const f of files) {
      const r = inspect(f, []);
      if (!r.ok || !r.pages) { say(NO, `${f} — ${r.reason || '쪽수 0 또는 A4 아님'}`); bad += 1; continue; }
      say(OK, `${f} — ${r.pages}쪽 · ${Math.round(r.size.w)}×${Math.round(r.size.h)}pt`
        + `${r.isA4 ? ' (A4)' : ' ⚠ A4 아님'} · ${(r.bytes / 1024).toFixed(0)}KB`);
      if (!r.isA4) bad += 1;
    }
    say('', '※ --check 는 글꼴이 화면과 같은지는 재지 않는다 — 그건 만들 때 잰다');
    return bad ? 1 : 0;
  }

  const inputs = [];
  let out = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-o' || args[i] === '--out') { out = args[i + 1]; i += 1; continue; }
    inputs.push(args[i]);
  }
  if (!inputs.length) { say(NO, '입력 HTML 이 없다'); usage(); return 1; }
  if (out && inputs.length > 1) { say(NO, '-o 는 입력이 하나일 때만 쓴다'); return 1; }

  // 글꼴은 **입력 전부를 합쳐 한 번에** 갖춘다 (파일마다 받으면 같은 것을 몇 번씩 받는다)
  const allWanted = new Map();
  for (const f of inputs) {
    let html = '';
    try { html = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const w of fontsWanted(html)) {
      const prev = allWanted.get(w.family) || { family: w.family, weights: [] };
      prev.weights = [...new Set([...prev.weights, ...w.weights])].sort((a, b) => a - b);
      allWanted.set(w.family, prev);
    }
  }
  const wanted = [...allWanted.values()];

  if (wanted.length) {
    const fr = ensureFonts(wanted);
    if (!fr.measured) {
      say('못잼', fr.reason);
      say('', '★ 못 잰 것은 통과가 아니다 — 이 자리에서는 PDF 글꼴을 보증할 수 없다');
      return 2;
    }
    if (!fr.ok) {
      say(NO, `글꼴을 갖추지 못했다: ${fr.missing.join(' · ')}`);
      say('', `사유: ${fr.reason}`);
      say('', '★ 이대로 뽑으면 화면과 다른 글꼴로 나온다. 오류가 안 나므로 아무도 모른다.');
      return 1;
    }
    say(OK, `글꼴 ${wanted.length}종 확인 — ${wanted.map(w => w.family).join(' · ')}`);
  }

  const browser = findBrowser();
  let bad = 0;
  for (const f of inputs) {
    const r = htmlToPdf(f, { out: inputs.length === 1 ? out : null, browser, wanted });
    if (!r.ok) {
      if (r.measured === false) { say('못잼', `${f} — ${r.reason}`); return 2; }
      const why = r.reason
        || (r.fontMissing && r.fontMissing.length ? `PDF 안에 글꼴이 없다: ${r.fontMissing.join(' · ')}` : null)
        || (!r.isA4 ? `A4 가 아니다 (${Math.round(r.size ? r.size.w : 0)}×${Math.round(r.size ? r.size.h : 0)}pt)` : null)
        || '쪽수가 0이다';
      say(NO, `${path.basename(f)} — ${why}`);
      bad += 1;
      continue;
    }
    say(OK, `${path.basename(r.path)} — ${r.pages}쪽 · A4 · ${(r.bytes / 1024).toFixed(0)}KB`
      + ` · 글꼴 ${wanted.length}종 박힘`);
  }
  if (bad) say('', `${bad}건 실패 — 내보내지 않는다 (CLAUDE.md §8)`);
  return bad ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { fontsWanted, ensureFonts, inspect, htmlToPdf, installed, main, A4_PT };
