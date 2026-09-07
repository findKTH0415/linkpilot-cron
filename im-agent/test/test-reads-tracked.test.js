'use strict';
/**
 * test-reads-tracked.test.js — **검사가 「없는 파일」을 근거로 삼지 않는다** 〈2026-09-07 · M-78〉.
 *
 * ★★★ [사고] `embed-chrome.test.js` 가 미리 그려 넣은 판을 읽어 화면 구조를 쟀다.
 *   내 자리에는 그 파일이 있어 **초록**이었는데, CI 에는 없어 ENOENT 로 **빨갰다.**
 *   그 파일은 `.gitignore` 에 있는 **빌드 산출물**이다.
 *
 * ★ 이 저장소는 이 함정을 **이미 알고 있었다** — `design-system.test.js` 와
 *   `preview-stamp.test.js` 에 「커밋된 산출물만 읽는다」가 주석으로 적혀 있다.
 *   **적혀만 있었고 재는 것이 없어서** 새 검사가 그대로 다시 밟았다.
 *   규칙을 문서에만 적으면 그 규칙은 사람의 기억에 얹힌다 (CLAUDE.md §8).
 *
 * ★★ 그래서 **글자가 아니라 git 에게 묻는다.** 검사 파일이 이름을 대는 `.html`·`.js`
 *   가운데 **추적되지 않는 것**이 있으면 빨개진다. 「내 자리에서는 된다」가 통하지 않는다.
 *
 * ★★★ **깨끗한 자리에서는 걸릴 것이 0개인 것이 정상이다** 〈2026-09-07 · CI 에서 실측〉.
 *   앞 판은 그 0개를 「공회전」으로 읽고 **CI 에서만 빨갰다** — 새로 받은 자리에는
 *   산출물이 아직 없다. 공회전은 **파일 수**가 아니라 **체가 도는가**로 재야 한다.
 *
 * ⚠ 주석을 걷고 본다 — 위 경위에 그 파일 이름이 글자로 적혀 있다 (§8).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const DIR = __dirname;

/**
 * **위험한 이름들** — `im-agent/ui/` 안에 실제로 있는데 **git 이 추적하지 않는** 파일.
 *
 * ★ 처음엔 「검사가 대는 모든 .html 이 추적되는가」로 쟀는데 **너무 넓었다** —
 *   시험이 스스로 만드는 임시 파일(`probe.html` · `out.html` …)까지 잡혀 열두 칸이
 *   헛울었다. 재려는 것은 그것이 아니라 **「내 자리에만 있는 진짜 산출물」**이다.
 * ★★ 그래서 **git 에게 두 번 묻는다**: 지금 있는 UI 파일 목록과, 그중 추적되는 것.
 *   그 차이가 곧 위험한 이름이다.
 * ★ 그 차이가 0개인 것은 **정상**이다(깨끗한 자리). 대신 **체가 도는지**를 따로 잰다 —
 *   `sieve()` 에 지어낸 목록을 넣어 답이 맞는지 보고, git 이 대답을 했는지 본다.
 */
function sieve(here, tracked) {
  const T = new Set(tracked);
  /* ★ 검사가 **스스로 만드는** 파일은 위험이 아니다 — 이 저장소는 그런 것에 `__` 나
     `.` 를 앞에 붙인다(`__stage-ok-probe.html` · `__evidence-probe.html`).
     재려는 것은 **남이 만드는 산출물을 읽는 것**이다. */
  return here.filter((n) => /\.(html|css|js)$/.test(n)
    && !n.startsWith('.') && !n.startsWith('__') && !T.has(n));
}

/** git 이 추적하는 UI 파일 이름들 */
function tracked() {
  const out = execFileSync('git', ['ls-files', 'im-agent/ui/platform/'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out.split('\n').filter(Boolean).map((p2) => p2.split('/').pop());
}

function risky() {
  return sieve(fs.readdirSync(path.join(ROOT, 'im-agent', 'ui', 'platform')), tracked());
}

/** 검사 파일이 이름을 대는 자리 — 주석은 걷고 본다 */
function named(file) {
  return fs.readFileSync(path.join(DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

test('★ 재는 장치가 실제로 돈다 — 0개를 훑고 통과라고 말하지 않는다', () => {
  const files = fs.readdirSync(DIR).filter((n) => n.endsWith('.test.js'));
  assert.ok(files.length >= 50, `검사 파일을 ${files.length}개만 찾았다 — 훑는 자리가 틀렸다`);

  /* ★★★ **깨끗한 자리에서는 「추적 안 되는 파일」이 0개가 정상이다** 〈2026-09-07 · CI 실측〉.
     앞 판은 그 0개를 「아무것도 안 재고 있다」로 읽고 **CI 에서만 빨갰다** — 새로 받은
     자리에는 산출물이 아직 없기 때문이다. 재려던 것은 **파일이 있는가**가 아니라
     **체가 도는가**였다. 그래서 체에 직접 물어본다 — 파일을 안 만들고. */
  assert.deepStrictEqual(
    sieve(['keep.html', 'gone.html', '__probe.html', '.tmp.html', 'note.md'], ['keep.html']),
    ['gone.html'],
    '★ 체가 안 돈다 — 추적 안 되는 것만 남겨야 하고, 스스로 만든 것(`__`·`.`)은 빼야 한다');

  /* ★ git 이 대답을 했는가. 목록이 비면 아래 시험이 **모든 것을 통과시킨다** */
  assert.ok(tracked().length >= 5,
    '★ git 이 UI 파일 목록을 안 준다 — 묻는 길이 막혔다. 그러면 아래 검사는 아무것도 안 잡는다');
});

test('★★★ 검사가 **커밋되지 않은 산출물**을 읽지 않는다 — 「내 자리에서는 된다」가 안 통한다', () => {
  const R = risky();
  const bad = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.test.js'))) {
    const code = named(f);
    for (const n of R) {
      let at = code.indexOf("'" + n + "'");
      while (at >= 0) {
        /* ★★ **막아 두고 쓰는 것은 잡지 않는다** 〈2026-09-07 · 처음에 두 칸이 헛울었다〉.
           `preview-stamp.test.js` 는 `existsSync` 로 없으면 건너뛴다 — 그것은 CI 에서
           안 죽는다. 재려는 것은 **막지 않은 읽기**다. 이름 가까이(±400자)에 그 가드가
           있으면 통과시킨다. 멀리 있는 가드는 그 이름의 것이 아닐 수 있어 안 친다. */
        const near = code.slice(Math.max(0, at - 400), at + 400);
        if (!near.includes('existsSync')) { bad.push(`${f} → ${n}`); break; }
        at = code.indexOf("'" + n + "'", at + 1);
      }
    }
  }
  assert.deepStrictEqual(bad, [],
    '★ 위 검사가 **git 에 없는 산출물**을 이름으로 댄다. 내 자리에는 있어 초록이지만 '
    + 'CI 에는 없어 ENOENT 로 죽는다 — 실제로 그렇게 한 번 빨갰다. '
    + '**만드는 자리(소스)를 재거나**, 커밋되는 산출물을 쓴다. '
    + `지금 위험한 이름: ${R.join(' · ')}`);
});
