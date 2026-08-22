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

/** 지문을 지운 내용. **재는 것과 쓰는 것이 같은 기준**이어야 한다 */
function bare(text) {
  return text.replace(RE, '');
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
 * 한 화면에 지문을 박는다. 이미 같은 값이면 **손대지 않는다** —
 * 안 그러면 돌릴 때마다 파일 시각이 바뀌어 「바뀐 것 없는데 커밋할 것이 있다」가 된다.
 */
function stamp(name, value) {
  const p = path.join(HERE, name);
  const src = fs.readFileSync(p, 'utf8');
  const want = ' ' + ATTR + '="' + value + '"';
  const cleaned = bare(src);
  // <html …> 의 여는 태그에만 붙인다
  const m = cleaned.match(/<html\b[^>]*>/i);
  if (!m) throw new Error(name + ': <html> 태그를 못 찾았다 — 지문을 박을 자리가 없다');
  const tag = m[0];
  const next = cleaned.replace(tag, tag.slice(0, -1) + want + '>');
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

  pages().forEach((n) => {
    const now = stampedAt(n);
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
  console.log('지문 ' + want + ' 을 ' + pages().length + '개 화면에 찍었다');
}

if (require.main === module) main();

module.exports = { ATTR, bare, bundleHash, pages, stampedAt };
