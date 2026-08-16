'use strict';
/**
 * fonts.js — 문서가 **요청한 글꼴이 실제로 쓰이는지** 본다 (등록부 D-52).
 *
 * 무엇이 문제였나: `design/tokens.js` 는 `Noto Sans KR`·`Noto Serif KR` 을
 * 지정하는데, 그 글꼴이 없는 기계에서는 브라우저가 **말없이 다른 글꼴로 대신
 * 그린다.** 실제로 이 저장소의 PDF 에는 한글이 **중국어 글꼴
 * (`WenQuanYiZenHei`)** 로 박혀 있었다.
 *
 * ★ **가장 나쁜 점은 조용하다는 것이다.** 오류도 경고도 없고, 화면에서는
 *   한글이 멀쩡히 보인다. 그래서 **만드는 기계마다 활자가 다른 문서**가 나가고
 *   아무도 모른다. `design/check.js` 도 못 잡는다 — 그건 HTML 의 `font-family`
 *   **문자열**만 보지, 렌더 시점에 그 글꼴이 있는지는 보지 않는다.
 *
 * ★ **글꼴 파일을 저장소에 넣지 않는다.** 재 봤다 — Noto Sans/Serif KR 의
 *   한글 서브셋은 **4벌 합쳐 약 11MB · 496파일**이다(2026-08-16 실측).
 *   공개 저장소에 넣을 크기가 아니고 §5(의존성·군살 최소화)에도 어긋난다.
 *   대신 **렌더 환경에 설치**하고, 없으면 **조용히 넘어가지 않는다.**
 *
 * ★ 그래서 이 파일이 하는 일은 하나다 — **요청한 글꼴과 실제 쓸 수 있는 글꼴을
 *   대조해서 다르면 말한다.** 고치는 것은 환경이고, 감추지 않는 것이 코드의 몫이다.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** 글꼴 파일을 직접 넣고 싶을 때 여기에 둔다 (커밋하지 않는다 — .gitignore) */
const LOCAL_DIR = process.env.IM_AGENT_FONTS
  || path.join(__dirname, '..', '..', 'fonts');

/** 한글이 나오는 문서다 — 이 글자가 그려지는지가 판정 기준이다 */
const PROBE = '가';

/**
 * `font-family` 선언에서 실제 글꼴 이름만 뽑는다.
 * `"'Noto Sans KR', sans-serif"` → `['Noto Sans KR']`
 * (`sans-serif`·`serif` 같은 총칭은 글꼴 이름이 아니다 — 늘 있다)
 */
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

function familiesOf(decl) {
  return String(decl || '')
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(s => s && !GENERIC.has(s.toLowerCase()));
}

/** 이 기계에 설치된 글꼴 목록 (fontconfig). 없으면 빈 배열 — 모른다고 본다 */
function installed() {
  try {
    return execFileSync('fc-list', [':', 'family'], { encoding: 'utf8', timeout: 5000 })
      .split('\n')
      .flatMap(l => l.split(','))
      .map(s => s.trim())
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function has(family, list) {
  const want = String(family).toLowerCase();
  return (list || installed()).some(f => f.toLowerCase() === want);
}

/**
 * 한글을 실제로 그리게 될 글꼴. **요청한 것이 없을 때 무엇으로 대신되는지**를
 * fontconfig 에게 직접 묻는다 — 짐작하지 않는다.
 */
function substituteFor(family) {
  try {
    const out = execFileSync('fc-match', ['-f', '%{family}', `${family}:charset=AC00`], {
      encoding: 'utf8', timeout: 5000,
    });
    return out.split(',')[0].trim() || null;
  } catch (_) {
    return null;
  }
}

/**
 * 테마가 요청한 글꼴이 이 기계에 있는가.
 *
 * @param {object} theme `design/themes` 가 준 테마 (serif·sans 를 본다)
 * @returns {{ok, requested, missing, substitutes, reason}}
 */
function check(theme) {
  const t = theme || {};
  const requested = [...new Set([...familiesOf(t.serif), ...familiesOf(t.sans)])];
  if (!requested.length) {
    return { ok: true, requested: [], missing: [], substitutes: {}, reason: null };
  }

  const list = installed();
  if (!list.length) {
    // ★ fontconfig 이 없으면 **있다고 치지 않는다.** 모르는 것과 괜찮은 것은 다르다
    return {
      ok: false, requested, missing: requested, substitutes: {}, unknown: true,
      reason: '글꼴 목록을 확인할 수 없다 (fontconfig 없음) — 요청한 글꼴이 쓰였는지 모른다',
    };
  }

  const missing = requested.filter(f => !has(f, list));
  if (!missing.length) {
    return { ok: true, requested, missing: [], substitutes: {}, reason: null };
  }

  const substitutes = {};
  missing.forEach((f) => { substitutes[f] = substituteFor(f); });

  return {
    ok: false, requested, missing, substitutes,
    reason: `요청한 글꼴이 없다: ${missing.join(', ')} — `
      + `대신 ${[...new Set(Object.values(substitutes).filter(Boolean))].join(', ') || '알 수 없는 글꼴'} `
      + '로 그려진다. **만드는 기계마다 활자가 달라진다** '
      + `(${LOCAL_DIR} 에 글꼴 파일을 넣거나 시스템에 설치한다)`,
  };
}

/**
 * `fonts/` 에 넣어 둔 글꼴 파일을 문서에 박는 `@font-face` 를 만든다.
 *
 * ★ 파일이 없으면 **빈 문자열**을 돌려준다 — 없는 파일을 가리키는 `@font-face`
 *   는 브라우저가 조용히 무시하고, 그러면 다시 대체 글꼴로 돌아간다.
 *
 * 파일 이름 규칙: `<Family>-<Weight>.woff2` (예: `NotoSansKR-400.woff2`)
 */
function faceCss(dir = LOCAL_DIR) {
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { return ''; }

  const faces = files
    .filter(f => /\.(woff2?|otf|ttf)$/i.test(f))
    .map((f) => {
      const m = f.match(/^(.+?)-(\d{3})\.(woff2?|otf|ttf)$/i);
      if (!m) return null;
      const family = m[1].replace(/([a-z])([A-Z])/g, '$1 $2');   // NotoSansKR → Noto Sans KR
      const fmt = { woff2: 'woff2', woff: 'woff', otf: 'opentype', ttf: 'truetype' }[m[3].toLowerCase()];
      const data = fs.readFileSync(path.join(dir, f)).toString('base64');
      const mime = { woff2: 'font/woff2', woff: 'font/woff', otf: 'font/otf', ttf: 'font/ttf' }[m[3].toLowerCase()];
      return `@font-face{font-family:'${family}';font-style:normal;font-weight:${m[2]};`
        + `src:url(data:${mime};base64,${data}) format('${fmt}');font-display:block;}`;
    })
    .filter(Boolean);

  return faces.join('\n');
}

/** 사람이 읽는 한 줄. **없으면 없다고 적는다** */
function summarize(r) {
  if (!r) return '글꼴 확인 안 함';
  if (r.ok) return `글꼴 정상 (${r.requested.join(', ')})`;
  return r.reason;
}

module.exports = { check, faceCss, familiesOf, installed, has, substituteFor, summarize, LOCAL_DIR, PROBE };
