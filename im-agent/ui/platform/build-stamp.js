#!/usr/bin/env node
'use strict';
/**
 * build-stamp.js — **화면이 스스로 「어느 판인지」 말하게 한다** 〈2026-08-22〉.
 *
 * ★★★ 왜 만들었나. 같은 신고가 세 번 왔는데, 그때마다 셋 중 무엇인지 알 수가
 *   없었다:
 *
 *     ① 안 올라갔다   ② 올라갔는데 브라우저가 옛것을 들고 있다   ③ 코드가 틀렸다
 *
 *   **셋은 화면에서 똑같이 보인다.** 그래서 나는 「새로고침해 보십시오」를
 *   반복했고, 사용자는 같은 화면을 다시 찍어 보냈다. 사진 한 장으로 판을
 *   가릴 수 있었으면 첫 번째에 끝났다.
 *
 * ★ 그래서 **묶음 전체의 지문**을 화면에 박아 둔다. 화면 하나가 아니라 묶음
 *   전체다 — 실제로 틀렸던 것은 `embed-bridge.js` 였는데 사용자가 보는 것은
 *   `files.html` 이다. 한 파일만 재면 **바뀐 줄 모른다.**
 *
 * ★★ **시계를 넣지 않는다.** 날짜를 박으면 아무도 안 고친 날에도 산출물이
 *   달라져서 CI 가 빨개진다 (M-10 — 자정에 CI 가 빨개졌다). 지문은 **내용에서만**
 *   나온다.
 *
 * ★ 자기 자신을 세는 문제: 지문을 써 넣으면 파일 내용이 바뀐다. 그래서
 *   **재기 전에 `data-lp-build="…"` 를 지운 상태**로 잰다.
 *
 *   쓰는 법:  npm run im:stamp        (다시 찍는다)
 *            npm run im:stamp -- --check   (찍힌 것이 맞는지만 본다)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const { required } = require('./build-embed.js');

/** 지문 속성. 이 글자는 화면·검사·탐침이 함께 쓴다 — 한 곳에서만 만든다 */
const ATTR = 'data-lp-build';
const RE = new RegExp('\\s' + ATTR + '="[0-9a-f]*"', 'g');

/**
 * ★★★ **형제 파일 주소의 판 표시** 〈2026-08-23 · 실제 사고 · D-93〉.
 *
 *   사장님 화면이 「F.readEvidence is not a function」으로 죽었다. 배포는
 *   초록이었고 디스크도 HTTP 도 새 판이었다. **브라우저가 `fields-core.js` 만
 *   아침 것을 들고 있었다** — `fields.html` 은 새것이라 새 함수를 불렀고,
 *   그 함수가 옛 스크립트에 없었다.
 *
 *   ★ 이 결의 사고는 **화면이 안 뜨는 것보다 나쁘다.** 화면은 멀쩡히 뜨고
 *     지문도 새 판으로 찍혀 있는데 기능만 죽는다 (M-25 의 세 갈래 중
 *     **브라우저** 갈래 — 지금까지 재는 장치가 없던 유일한 갈래다).
 *
 *   ★ 그래서 형제 파일 주소 뒤에 지문을 붙인다. 내용이 바뀌면 주소가 바뀌므로
 *     브라우저가 **다시 받을 수밖에 없다.**
 */
const VER = /(<script src="|<link rel="stylesheet" href=")([^"?]+)(\?v=[0-9a-f]*)?"/g;

/**
 * ★★ JS 안에 박는 판 표시. 화면이 **자기 짝이 맞는지** 대 보는 데 쓴다.
 *   주소에 판을 붙여도 프록시·확장·오프라인 캐시가 옛것을 줄 수 있다 —
 *   그때 「함수가 없다」로 죽지 않고 **사람 말로** 말하려면 값이 있어야 한다.
 */
const JSVER = /(LP_BUILD = ')[0-9a-f_]*(')/g;

/**
 * 지문을 지운 내용. **재는 것과 쓰는 것이 같은 기준**이어야 한다.
 *
 * ★★★ 주소의 `?v=` 와 JS 의 `LP_BUILD` 도 **반드시 함께 지운다.** 안 지우면
 *   지문이 자기 자신을 물어 매번 값이 달라지고, `--check` 가 영원히 빨갛다.
 */
function bare(text) {
  return text
    .replace(RE, '')
    .replace(VER, '$1$2"')
    .replace(JSVER, "$1$2");
}

/**
 * 묶음 전체의 지문 8자.
 * ★ 파일 이름도 함께 넣는다 — 내용이 통째로 자리를 바꿔도 다른 지문이 나오게.
 */
function bundleHash() {
  const h = crypto.createHash('sha256');
  required().slice().sort().forEach((name) => {
    const p = path.join(HERE, name);
    if (!fs.existsSync(p)) return;
    h.update(name).update('\0').update(bare(fs.readFileSync(p, 'utf8'))).update('\0');
  });
  return h.digest('hex').slice(0, 8);
}

/** 지문을 박을 화면들 — 묶음 안의 HTML 전부 */
function pages() {
  return required().filter((n) => n.endsWith('.html'));
}

/**
 * 판 표시 자리(`LP_BUILD`)를 들고 있는 스크립트들.
 * ★ `JSVER` 는 `g` 플래그라 `.test()` 를 그대로 쓰면 **호출마다 결과가 달라진다**
 *   (`lastIndex` 가 남는다). 여기서는 플래그 없는 사본으로 본다.
 */
const JSVER_ONE = /LP_BUILD = '[0-9a-f_]*'/;
function scripts() {
  return required().filter((n) => n.endsWith('.js')
    && JSVER_ONE.test(fs.readFileSync(path.join(HERE, n), 'utf8')));
}

/** 지금 스크립트에 박혀 있는 값 (자리가 없으면 null) */
function scriptStampedAt(name) {
  const m = fs.readFileSync(path.join(HERE, name), 'utf8').match(/LP_BUILD = '([0-9a-f_]*)'/);
  return m ? m[1] : null;
}

/**
 * 한 화면에 지문을 박는다. 이미 같은 값이면 **손대지 않는다** —
 * 안 그러면 돌릴 때마다 파일 시각이 바뀌어 「바뀐 것 없는데 커밋할 것이 있다」가 된다.
 */
function stamp(name, value) {
  const p = path.join(HERE, name);
  const src = fs.readFileSync(p, 'utf8');
  let next = bare(src);

  if (name.endsWith('.js')) {
    /* ★ JS 는 `LP_BUILD` 자리 하나만 채운다. 자리가 없는 파일은 건너뛴다 —
     *   억지로 넣으면 파일마다 다른 곳에 박혀 다음 사람이 못 찾는다 */
    next = next.replace(JSVER, '$1' + value + '$2');
  } else {
    const want = ' ' + ATTR + '="' + value + '"';
    // 문서 뿌리의 여는 태그에만 붙인다
    const m = next.match(/<html\b[^>]*>/i);
    if (!m) throw new Error(name + ': 문서 뿌리 태그를 못 찾았다 — 지문을 박을 자리가 없다');
    next = next.replace(m[0], m[0].slice(0, -1) + want + '>');
    /* ★ 형제 파일 주소에도 붙인다. **여기서 안 붙이면 브라우저가 옛 스크립트를
     *   들고 새 화면을 돌린다** — 그때 나오는 말은 「… is not a function」뿐이라
     *   캐시가 원인이라는 생각 자체가 안 든다 (2026-08-23 실제 사고) */
    next = next.replace(VER, '$1$2?v=' + value + '"');
  }

  if (next === src) return false;
  fs.writeFileSync(p, next);
  return true;
}

/** 지금 박혀 있는 값 (없으면 null) */
function stampedAt(name) {
  const src = fs.readFileSync(path.join(HERE, name), 'utf8');
  const m = src.match(new RegExp(ATTR + '="([0-9a-f]*)"'));
  return m ? m[1] : null;
}

function main() {
  const check = process.argv.indexOf('--check') > -1;
  const want = bundleHash();
  const bad = [];

  /* ★ 지문이 이미 맞으면 건너뛴다 — 파일을 안 건드려야 「바뀐 것 없는데 커밋할
   *   것이 있다」가 안 생긴다.
   *   ★ 고칠 곳이 늘면(예전에 형제 파일 주소에 `?v=` 를 붙여 본 적이 있다)
   *     **속성만 보고 건너뛰면 안 된다.** 그때는 `stamp()` 를 늘 부르고
   *     돌려주는 값(바꿨는가)을 본다. 지금은 고칠 곳이 속성 하나뿐이다. */
  /* ★ 고칠 곳이 **둘 이상**이 되었으므로 속성만 보고 건너뛰면 안 된다.
   *   `stamp()` 를 늘 부르고 「바꿨는가」를 본다 (위 주석이 예고한 그 자리다) */
  pages().forEach((n) => {
    if (check) {
      const now = stampedAt(n);
      if (now !== want) { bad.push(n + ' (' + (now || '없음') + ')'); return; }
      /* ★ 속성만 보고 넘어가지 않는다 — **속성은 맞는데 형제 주소가 옛것**일
       *   수 있다. 그 상태가 바로 2026-08-23 사고다 */
      const src = fs.readFileSync(path.join(HERE, n), 'utf8');
      const wrong = [...src.matchAll(VER)].filter(m => (m[3] || '') !== '?v=' + want);
      VER.lastIndex = 0;
      if (wrong.length) bad.push(n + ' (형제 주소 ' + wrong.length + '곳이 옛 판)');
      return;
    }
    stamp(n, want);
  });

  /* ★ 스크립트 안의 판 표시도 함께 본다 — 이것이 화면과 다르면 짝이 깨진 것이다 */
  scripts().forEach((n) => {
    const now = scriptStampedAt(n);
    if (now === want) return;
    if (check) { bad.push(n + ' (' + (now || '없음') + ')'); return; }
    stamp(n, want);
  });

  if (check) {
    if (bad.length) {
      console.error('지문이 옛것이다: ' + bad.join(' · ') + '\n  → npm run im:stamp 로 다시 찍는다');
      process.exit(1);
    }
    console.log('지문 ' + want + ' — ' + pages().length + '개 화면 모두 최신');
    return;
  }
  console.log('지문 ' + want + ' 을 화면 ' + pages().length
    + '개 · 스크립트 ' + scripts().length + '개에 찍었다');
}

if (require.main === module) main();

module.exports = {
  ATTR, bare, bundleHash, pages, stampedAt, scripts, scriptStampedAt, VER, JSVER,
};
