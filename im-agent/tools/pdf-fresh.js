#!/usr/bin/env node
'use strict';
/**
 * pdf-fresh.js — **PDF 가 화면보다 옛말을 하고 있지 않은가** (CLAUDE.md §6-2-1).
 *
 * ★★★ **왜 필요한가.** §6-2-1 은 대외 문서를 「주소 + PDF」 둘 다 내라고 한다.
 *   그런데 **둘을 만드는 시점이 다르다.** HTML 을 고치고 다시 발행하면 주소는
 *   바로 새 판이 되는데, `npm run im:pdf` 를 다시 안 돌리면 **PDF 만 옛 판으로
 *   남는다.** 그리고 그 상태가 **아무 오류도 안 낸다** — 둘 다 열리고, 둘 다
 *   멀쩡해 보이고, 다른 것은 내용뿐이다.
 *
 *   이것은 M-25(지문 어긋남)와 **같은 결의 사고**다. 「고쳤습니다」라고 말했는데
 *   받는 쪽은 옛 판을 보고 있고, 둘 다 그 사실을 모른다. 화면 지문은 이미
 *   `build-stamp.js` 가 잡는다 — 이 검사는 **PDF 자리의 같은 구멍**을 막는다.
 *
 * ★★ **글자를 대조하지 않고 시각을 잰다.** 내용 비교는 할 수 없다(PDF 는
 *   글자 순서가 화면과 다르게 뽑힌다). 대신 **「PDF 가 HTML 보다 오래됐는가」**
 *   하나만 본다 — 이것이 실제로 나는 사고와 정확히 같은 모양이다.
 *
 * ★ **재는 대상은 「PDF 를 이미 한 벌 낸 HTML」뿐이다.** 옆에 PDF 가 없는
 *   HTML 은 애초에 PDF 를 안 내기로 한 것이므로 세지 않는다 — 여기서
 *   「PDF 가 없다」를 실패로 세면 미리보기 화면 수십 개가 전부 빨개진다.
 *
 * 되돌아오는 값: 0 통과 · 1 옛 PDF 가 있다 · 2 못 쟀다
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** 훑지 않을 곳 */
const SKIP = new Set(['node_modules', '.git', '.github', 'coverage', 'tmp', '.cache']);

/**
 * 시각 차를 이만큼은 봐 준다.
 *
 * ★ git 으로 받아 온 파일은 **받은 순서대로** 시각이 찍힌다 — 내용이 같아도
 *   HTML 이 PDF 보다 몇 초 늦게 찍힐 수 있다. 그걸 빨갛게 세면 새 클론마다
 *   거짓 경보가 난다. 실제 사고(고치고 안 다시 뽑음)는 **분 단위 이상** 벌어지므로
 *   2분이면 충분히 가른다.
 */
const GRACE_MS = 120 * 1000;

/** 이 HTML 이 인쇄 규격을 갖고 있는가 — PDF 를 낼 셈이었는가 */
function isPrintable(file) {
  let s = '';
  try { s = fs.readFileSync(file, 'utf8'); } catch (_) { return false; }
  return /@page\b/.test(s) || /@media\s+print/.test(s);
}

function walk(dir, out) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of names) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      walk(p, out);
    } else if (/\.html?$/i.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 짝을 이룬 HTML·PDF 를 찾아 나이를 잰다.
 *
 * ★ 도장 찍힌 사본(`이름__LP-20260831-ABCD.pdf`)도 같은 HTML 의 짝이다.
 *   수령자별로 여러 벌이 나오므로 **전부** 본다 — 한 벌만 새것이고 나머지가
 *   옛 판이면 그게 더 나쁘다.
 */
function scan(root) {
  const htmls = walk(root || ROOT, []);
  const pairs = [];
  for (const h of htmls) {
    if (!isPrintable(h)) continue;
    const dir = path.dirname(h);
    const base = path.basename(h).replace(/\.html?$/i, '');
    let siblings = [];
    try { siblings = fs.readdirSync(dir); } catch (_) { continue; }
    const pdfs = siblings.filter(n =>
      n === `${base}.pdf` || n.startsWith(`${base}__`) && n.endsWith('.pdf'));
    for (const n of pdfs) {
      const p = path.join(dir, n);
      let hm; let pm;
      try { hm = fs.statSync(h).mtimeMs; pm = fs.statSync(p).mtimeMs; } catch (_) { continue; }
      pairs.push({
        html: path.relative(ROOT, h),
        pdf: path.relative(ROOT, p),
        behindMs: hm - pm,
        stale: (hm - pm) > GRACE_MS,
      });
    }
  }
  return pairs;
}

function fmtAge(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}분`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}시간`;
  return `${Math.round(h / 24)}일`;
}

function main(argv) {
  const args = argv.slice(2);
  const root = args.find(a => !a.startsWith('-')) || ROOT;

  let pairs;
  try { pairs = scan(root); } catch (e) {
    process.stdout.write(`대외 문서 PDF: 못 쟀다 — ${String(e.message).split('\n')[0]}\n`);
    return 2;
  }

  if (!pairs.length) {
    // ★ 짝이 하나도 없는 것은 **통과가 아니다.** 이 저장소에 PDF 를 내는 문서가
    //   정말 없을 수도 있고, 훑는 곳이 틀렸을 수도 있다 — 둘이 구분되지 않는다.
    process.stdout.write('대외 문서 PDF: 못 쟀다 — HTML·PDF 짝이 하나도 없다\n');
    return 2;
  }

  const stale = pairs.filter(p => p.stale);
  if (stale.length) {
    const list = stale.slice(0, 3)
      .map(p => `${p.pdf} (${fmtAge(p.behindMs)} 뒤처짐)`).join(' · ');
    process.stdout.write(
      `대외 문서 PDF: ${stale.length}개가 화면보다 옛 판이다 — ${list}`
      + `${stale.length > 3 ? ` 외 ${stale.length - 3}개` : ''}`
      + ' · `npm run im:pdf -- <그 HTML>` 로 다시 뽑는다\n');
    return 1;
  }

  process.stdout.write(`대외 문서 PDF: 짝 ${pairs.length}쌍 모두 화면과 같은 판이다\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { scan, isPrintable, main, GRACE_MS };
