'use strict';
/**
 * scripts-parse.test.js — **`scripts/` 가 `npm test` 를 한 번도 안 지나간다**
 *   〈2026-09-19 · D-224 · 사장님 「권하는 개선안 대로 진행해」 — 제가 올린 권장 ②〉
 *
 * ★★★ **무엇이 문제인가.** `npm test` 는 `im-agent/test/*.test.js` 만 돈다.
 *   그래서 `scripts/` 의 수집 스크립트 아홉은 **아무도 안 본다** — 문법이 깨진 채로
 *   커밋돼도 초록이고, **사장님이 [Run workflow] 를 누르시는 그 순간에야** 터진다.
 *   그때 화면은 「SyntaxError」 한 줄이라 **어느 파일인지도 안 보인다.**
 *
 * ★★ D-223 이 고친 것은 **「검사가 도는가」**(경로 거르개)였다. 이 칸이 고치는 것은
 *   **「무엇을 재는가」**다 — 거르개를 지워 CI 는 돌게 됐지만, 돌아도 `scripts/` 를
 *   보는 칸이 없으면 **여전히 아무것도 안 잰다** (§8 「걸었다 ≠ 올라갔다」와 같은 결).
 *
 * ★ **범위를 좁게 시작한다** (§12-4). 이 칸이 재는 것은 **파싱되는가** 하나다 —
 *   import 가 실제로 풀리는지·망이 열리는지는 **안 본다**(그건 돌려야 알고, 돌리면
 *   바깥을 부른다). 그 사실을 이 글에 적어 둔다: **못 재는 것을 재는 척하지 않는다**(§8).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');

/** 한 파일을 파싱해 본다 — 돌리지 않는다. `null` 이면 멀쩡하다 */
function parseErr(file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status === 0) return null;
  const msg = String(r.stderr || r.stdout || '').trim().split('\n').slice(0, 3).join(' / ');
  return msg || `되돌아온 값 ${r.status}`;
}

/** 임시 파일 하나를 만들어 파싱해 보고 지운다 (표본용) */
function parseText(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-parse-'));
  const p = path.join(dir, name);
  try {
    fs.writeFileSync(p, text, 'utf8');
    return parseErr(p);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 지우다 실패해도 판정과 무관 */ }
  }
}

test('★ 먼저 «이 칸의 잣대»가 도는지 잰다 (안 그러면 실측 0 이 「없다」와 「못 찾았다」로 갈린다)', () => {
  /* ★★★ 왜 이 칸이 맨 앞인가 〈§12-15 · §12-21 에서 실제로 당한 자리〉.
     아래 칸은 「깨진 것 0 개」로 통과한다. 그런데 파싱하는 법이 무뎌져도 **수는 그대로 0** 이라
     아무 일도 안 일어난다. 그래서 **일부러 만든 표본**을 먼저 먹여 잣대가 살아 있는지 본다. */

  // ① 멀쩡한 ESM — 통과해야 한다. 이것이 «.mjs 를 모듈로 읽는가»를 함께 잰다
  assert.strictEqual(
    parseText('good.mjs', "import fs from 'node:fs';\nexport const a = 1;\n"),
    null,
    'import·export 가 든 멀쩡한 .mjs 를 못 읽습니다 — 이 칸은 .mjs 를 CommonJS 로 읽고 있습니다',
  );

  // ② 깨진 ESM — 반드시 잡아야 한다
  assert.ok(
    parseText('bad.mjs', "import fs from 'node:fs'\nconst x = {;\n"),
    '일부러 깨뜨린 .mjs 를 통과시켰습니다 — 이 칸은 아무것도 안 재고 있습니다',
  );

  // ③ 정규식 역슬래시를 빼먹어 주석이 되는 꼴 (D-178 이 실제로 당한 모양)
  assert.ok(
    parseText('bad2.mjs', "const re = /\nfoo/;\n"),
    '줄이 끊긴 정규식을 통과시켰습니다 — 잣대가 무뎌졌습니다',
  );
});

test('scripts/ 의 모든 스크립트가 파싱된다 (누르시는 순간에야 터지지 않게)', () => {
  assert.ok(fs.existsSync(SCRIPTS), 'scripts/ 폴더가 없습니다 — 이 칸은 아무것도 안 잽니다');

  const files = fs.readdirSync(SCRIPTS).filter((f) => /\.(mjs|cjs|js)$/.test(f)).sort();

  /* ★ 「찾은 것이 0 개」와 「전부 멀쩡」을 갈라 적는다 (§8 · §12-12).
     0 이면 이 칸은 **눈이 먼 것**이라 통과로 안 적는다. */
  assert.ok(files.length > 0,
    'scripts/ 에서 스크립트를 한 개도 못 찾았습니다 — 폴더가 비었거나 이 칸이 눈이 멀었습니다');

  const broken = [];
  for (const f of files) {
    const err = parseErr(path.join(SCRIPTS, f));
    if (err) broken.push(`scripts/${f} — ${err}`);
  }
  assert.deepStrictEqual(broken, [],
    `scripts/ 의 ${files.length} 개 중 ${broken.length} 개가 파싱되지 않습니다.\n`
    + '  이대로 커밋되면 [Run workflow] 를 누르시는 순간에야 터지고,\n'
    + '  그 화면에는 SyntaxError 한 줄뿐이라 어느 파일인지도 안 보입니다.\n  '
    + broken.join('\n  '));
});
