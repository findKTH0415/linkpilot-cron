'use strict';
/**
 * pdf.js — 문서 HTML 을 **PDF 로 낸다** (등록부 D-53).
 *
 * 무엇이 문제였나: `core/outputspec.js` 는 모든 문서 종류에 `formats: ['pdf']`
 * 를 선언한다. 그런데 실제 산출물은 `09_IM/im.md` 와 `12_Final/im-a4.html` 까지고
 * **PDF 는 어디서도 만들어지지 않았다.** 선언과 실제가 갈린 채로 있었다.
 *
 * ★ **새 의존성을 들이지 않는다.** 이 저장소는 이미 헤드리스 크로미움을 쓰고
 *   (`core/raster.js`), `design/a4.js` 는 이미 `@page` 로 인쇄 기하를 소유한다.
 *   `--print-to-pdf` 하나면 된다 — wkhtmltopdf·WeasyPrint 는 네이티브/Python
 *   의존성이라 §5 에 걸리고, pdfkit 계열은 레이아웃을 처음부터 다시 짜야 한다.
 *
 * ★ **글꼴을 먼저 본다** (D-52). 요청한 글꼴이 없으면 브라우저가 말없이 다른
 *   글꼴로 그린다 — 실제로 한글이 **중국어 글꼴**로 박혀 있었다. PDF 는 한 번
 *   나가면 회수할 수 없으므로, 여기서 **막지는 않되 반드시 알린다.**
 *   (막지 않는 이유: 글꼴이 없다고 문서 생성 전체를 세우면 그게 더 나쁘다.
 *    대신 결과에 `fontOk:false` 와 사유를 실어 부르는 쪽이 플래그를 세운다)
 *
 * ★ **머리말·꼬리말을 브라우저가 넣게 두지 않는다.** 기본값은 파일 경로와
 *   날짜를 페이지마다 찍는데, 그건 **대외 배포 문서에 로컬 경로가 박히는 것**이다.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const raster = require('./raster');
const fonts = require('./fonts');

const RENDER_TIMEOUT_MS = 120000;

/**
 * PDF 의 페이지 수. 만들어 놓고 **몇 장인지 모르면 사양(targetPages)과 대조할 수
 * 없다.** 완전한 PDF 파서는 필요 없다 — 페이지 객체만 센다.
 */
function pageCount(buf) {
  const s = buf.toString('latin1');
  const pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
  return pages > 0 ? pages : null;
}

/**
 * HTML 파일 → PDF 파일.
 *
 * @param {string} htmlPath 인쇄 기하(@page)를 스스로 가진 HTML
 * @param {object} [opt] { out, browser, theme }
 * @returns {{ok, path, bytes, pages, fontOk, fontReason, fontNote, reason}}
 */
function fromHtmlFile(htmlPath, opt) {
  const o = opt || {};
  const out = o.out || htmlPath.replace(/\.html?$/i, '.pdf');

  if (!fs.existsSync(htmlPath)) {
    return { ok: false, path: null, reason: `HTML 이 없다: ${htmlPath}` };
  }

  // ★ 글꼴을 먼저 본다. 막지는 않지만 **결과에 실어 보낸다** (D-52)
  const font = o.theme ? fonts.check(o.theme) : { ok: true, reason: null };

  const browser = o.browser || raster.findBrowser();
  if (!browser) {
    return {
      ok: false, path: null, fontOk: font.ok, fontReason: font.reason, fontNote: font.note || null,
      reason: '헤드리스 크로미움이 없어 PDF 를 만들지 못했다 (HTML 은 그대로 남아 있다). '
        + 'CHROME_PATH 로 알려 주거나 그 서버에 크로미움을 설치하면 된다',
    };
  }

  try {
    execFileSync(browser, [
      '--headless', '--disable-gpu', '--no-sandbox',
      // ★ 기본 머리말·꼬리말에는 **파일 경로와 날짜**가 박힌다. 대외 문서에
      //   로컬 경로가 나가면 안 된다 (CLAUDE.md §2 와 같은 줄)
      '--no-pdf-header-footer',
      // 배경색·박스를 인쇄에서도 그대로 (표지의 네이비 박스가 사라지면 안 된다)
      '--print-to-pdf-no-header',
      `--print-to-pdf=${out}`,
      'file://' + path.resolve(htmlPath),
    ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: RENDER_TIMEOUT_MS });
  } catch (e) {
    return { ok: false, path: null, fontOk: font.ok, fontReason: font.reason, fontNote: font.note || null, reason: `PDF 변환 실패: ${e.message}` };
  }

  let buf;
  try { buf = fs.readFileSync(out); } catch (_) { buf = null; }
  if (!buf || !buf.length) {
    // ★ 파일이 안 생겼는데 성공으로 두면 화면에는 「PDF 있음」이 뜨고 열면 없다
    return { ok: false, path: null, fontOk: font.ok, fontReason: font.reason, fontNote: font.note || null, reason: 'PDF 가 만들어지지 않았다 (빈 파일)' };
  }
  if (buf.slice(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, path: null, fontOk: font.ok, fontReason: font.reason, fontNote: font.note || null, reason: 'PDF 형식이 아니다' };
  }

  return {
    ok: true,
    path: out,
    bytes: buf.length,
    pages: pageCount(buf),
    // ★ PDF 는 나왔지만 **활자가 요청과 다를 수 있다.** 그 사실을 함께 낸다
    fontOk: font.ok,
    fontReason: font.reason,
    // ★ 「고장은 아니지만 1순위가 아닌 이름으로 그렸다」 — 경고와 구분해서 낸다.
    //   문서를 다시 만들 때 같은 활자가 나오는지는 이 값에 달려 있다
    fontNote: font.note || null,
    reason: null,
  };
}

/**
 * 사양이 요구한 쪽수와 실제 쪽수를 견준다.
 *
 * ★ **막지 않는다.** 쪽수는 내용이 정하는 것이고, 사양은 목표다. 다만 크게
 *   벗어나면 사람이 알아야 한다 — 40쪽 사양에 8쪽이 나왔다면 무언가 빠진 것이다.
 */
function pageCheck(pages, spec) {
  if (!pages || !spec) return null;
  const { minPages, maxPages, targetPages } = spec;
  if (minPages && pages < minPages) {
    return `쪽수 ${pages}p 가 최소 ${minPages}p 에 못 미친다 (목표 ${targetPages}p) — 빠진 절이 없는지 본다`;
  }
  if (maxPages && pages > maxPages) {
    return `쪽수 ${pages}p 가 최대 ${maxPages}p 를 넘는다 (목표 ${targetPages}p)`;
  }
  return null;
}

module.exports = { fromHtmlFile, pageCount, pageCheck, RENDER_TIMEOUT_MS };
