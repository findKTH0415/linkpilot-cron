'use strict';
/**
 * preview-stamp.js — **미리보기가 자기 판을 스스로 말한다** (D-114)
 *
 * ★★★ **왜 만들었나** 〈2026-08-25 실측 · 2026-08-26 사장님 「권고안대로」〉.
 *
 *   화면 아래 `판 xxxxxxxx` 여덟 글자는 **「사장님이 사진 한 장으로 내가 보는
 *   것이 그 판인가를 가리시라」**고 만든 것이다 (CLAUDE.md §8 · M-25).
 *
 *   그런데 그 지문은 **배포 묶음 16개**로만 만든다. 미리보기를 만드는
 *   `build-preview.js` · `changes.js` 는 **그 16개에 없다.**
 *
 *   실측: 미리보기 내용이 통째로 달라졌는데 찍힌 지문은 **안 바뀌었다.**
 *   갈래 넷 중 셋이 같은 지문을 찍은 적도 있다 — 사장님이 세 아티팩트를
 *   열면 내용이 전부 다른데 지문은 하나였다. **M-25 가 막으려던 바로 그 상태다.**
 *
 * ★★ **둘을 나란히 적는다.** 하나로 합치지 않는다 —
 *   「배포되는 것」과 「보여 주는 것」은 **다른 사실**이라 두 숫자로 적는 것이 맞다.
 *
 *       판 앱-ec3d1270 · 미리보기-a1b2c3d4
 *
 * ★★★ **자기 자신을 해싱하지 않는다.** 결과물에 지문을 넣고 그 결과물을
 *   해싱하면 값이 절대 안 정해진다(닭과 달걀). 그래서 **미리보기를 만드는
 *   소스**를 해싱한다 — 소스가 바뀌면 결과도 바뀌므로 뜻은 같고,
 *   계산은 한 번에 끝난다. `build-stamp.js` 가 묶음 16개를 해싱하는 것과 같은 결이다.
 *
 * ★ 시각을 섞지 않는다. 섞으면 내용이 안 바뀌어도 지문이 날마다 달라져
 *   「재생성 = 커밋본」 검사가 자정마다 빨개진다.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;

/**
 * 미리보기를 만드는 소스들. **이 목록이 곧 「미리보기 판」의 정의다.**
 *
 * ★ 여기 없는 파일을 고치면 지문이 안 바뀐다 — 그러면 이 장치가 거짓말한다.
 *   미리보기 생성에 새 파일이 끼면 **여기 더한다.** 검사가 그것을 센다.
 */
const SOURCES = [
  'build-preview.js',   // 미리보기 조립
  'changes.js',         // 「이번에 바뀐 것」 패널
  'build-static.js',    // 미리 그려 넣는 판
  'flow-core.js',       // 단계 정의 (SCREENS)
];

/** 미리보기 판 지문 — 소스에서 낸다 */
function previewHash() {
  const h = crypto.createHash('sha256');
  for (const f of SOURCES.slice().sort()) {
    const p = path.join(HERE, f);
    // ★ 없는 파일은 **조용히 넘기지 않는다.** 이름을 해시에 넣어 두면
    //   사라진 것도 지문 변화로 드러난다.
    h.update(f);
    h.update(fs.existsSync(p) ? fs.readFileSync(p) : Buffer.from('(없음)'));
  }
  return h.digest('hex').slice(0, 8);
}

/** 앱 묶음 판 지문 — build-stamp 가 이미 내는 것을 그대로 쓴다 (두 벌로 만들지 않는다) */
function appHash() {
  try {
    return require('./build-stamp.js').bundleHash();
  } catch (_) {
    return null;
  }
}

/** 화면 아래에 붙일 한 줄. **둘을 나란히** 적는다 */
function line() {
  const app = appHash();
  return `판 앱-${app || '(못 읽음)'} · 미리보기-${previewHash()}`;
}

/** 붙일 HTML 조각 */
function html() {
  return '\n<div data-lp-preview-stamp style="max-width:960px;margin:34px auto 0;padding:14px 20px 40px;'
    + 'border-top:1px solid rgba(128,128,128,.28);font:400 12px/1.7 ui-monospace,Menlo,monospace;'
    + 'color:#8A939A">'
    + `<b>${line()}</b>`
    + '<br>앞은 <b>배포되는 앱 묶음</b>, 뒤는 <b>이 미리보기</b>의 판입니다. '
    + '<b>둘은 따로 움직입니다</b> — 미리보기만 바뀌면 앞은 그대로이고 뒤만 바뀝니다.'
    + '<br>사진으로 물어보실 때 <b>두 값을 함께</b> 보내 주시면 「반영이 안 됐다」가 '
    + '어느 쪽 이야기인지 한 번에 갈립니다.'
    + '</div>\n';
}

module.exports = { SOURCES, previewHash, appHash, line, html };

if (require.main === module) {
  process.stdout.write(`\n  ${line()}\n`
    + `  미리보기 소스 ${SOURCES.length}개: ${SOURCES.join(' · ')}\n\n`);
}
