'use strict';
/**
 * branch-doctor — **물어본 것과 어림한 것을 가르는가** 〈2026-08-26 · D-134 후속〉
 *
 * ★★★ 재는 것은 셋이다.
 *   ① 한글 파일 이름을 풀고 세는가 — 안 풀면 **문서가 「코드 겹침」으로 세어진다**
 *   ② 못 물어봤을 때 **까닭이 남는가** — 「열쇠가 없다」와 「열쇠가 틀렸다」는 다르다
 *   ③ 밖에서 답을 넣어 주면 **어림이 아니라 물어본 판**이 되는가
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bd = require('../tools/branch-doctor.js');

/* ───────────── ① 한글 이름을 풀고 센다 ───────────── */

test('★★★ git 이 감싼 한글 이름을 풀고 센다 — 안 풀면 문서가 코드로 세어진다', () => {
  // 실측에서 난 꼴 그대로다. `docs/미결정-사항.md` 가 이렇게 나온다.
  const quoted = '"docs/\\353\\257\\270\\352\\262\\260\\354\\240\\225-\\354\\202\\254\\355\\225\\255.md"';
  const { unquote } = require('../tools/merge-watch.js');
  assert.strictEqual(unquote(quoted), 'docs/미결정-사항.md');

  // ★ 여기가 핵심 — **푼 뒤라야** 「원래 함께 고치는 것」으로 갈린다
  assert.strictEqual(bd.expected(quoted), false,
    '감싼 채로는 안 맞는다 — 이것이 실측에서 판정을 「겹친다」로 보냈다');
  assert.strictEqual(bd.expected(unquote(quoted)), true,
    '풀면 docs/ 로 시작하므로 문서·기록이다');
});

test('★★ 세는 자리 앞에서 푼다 (되돌아가면 잡힌다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'branch-doctor.js'), 'utf8')
    // 주석을 떼고 본다 — 경위를 잘 적어 둘수록 글자 대조가 눈이 먼다 (CLAUDE.md §8)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /\.filter\(Boolean\)\.map\(unquote\)/,
    '바뀐 파일 목록을 풀지 않고 세면 한글 이름이 전부 「코드」가 된다');
  assert.ok(!/function unquote\s*\(/.test(src),
    '푸는 규칙을 여기 다시 적으면 두 벌이 된다 — merge-watch.js 것을 가져다 쓴다');
});

/* ───────────── ② 못 물어본 까닭이 남는다 ───────────── */

test('★★★ 못 물어봤으면 **왜**인지가 남는다 — 삼키면 두 고장이 같은 화면이 된다', async () => {
  const saved = { gh: process.env.GH_TOKEN, gt: process.env.GITHUB_TOKEN, f: process.env.LP_OPEN_PRS };
  delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN; delete process.env.LP_OPEN_PRS;
  /* ★ 자동으로 찾는 기록도 치운다 〈2026-08-27 · D-142 로 길이 하나 늘었다〉.
   *   안 치우면 이 검사가 **재려는 것(열쇠가 없을 때의 까닭)을 안 재고** 그
   *   기록으로 통과한다 — 검사가 조용히 헛돌게 되는 자리다. */
  const auto = bd.AUTO_PRS;
  const backup = fs.existsSync(auto) ? fs.readFileSync(auto, 'utf8') : null;
  if (backup !== null) fs.rmSync(auto, { force: true });
  try {
    const r = await bd.openPrBranches();
    assert.strictEqual(r, null, '열쇠가 없으면 못 물어본 것이다');
    assert.match(bd.whyNoPr() || '', /열쇠/,
      '까닭이 없으면 「열쇠가 없다」와 「열쇠가 틀렸다」가 구분이 안 된다 (실측: 401)');
  } finally {
    if (backup !== null) fs.writeFileSync(auto, backup);
    if (saved.gh !== undefined) process.env.GH_TOKEN = saved.gh;
    if (saved.gt !== undefined) process.env.GITHUB_TOKEN = saved.gt;
    if (saved.f !== undefined) process.env.LP_OPEN_PRS = saved.f;
  }
});

test('★★ 화면 문구에 까닭이 실린다 — 검사 안에서만 알면 아무도 못 본다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'branch-doctor.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /나이로 어림했다\*\*\$\{whyNoPr\(\)/,
    '판정 줄에 까닭을 안 실으면 화면에는 「못 물어봤다」만 남는다');
});

/* ───────────── ③ 밖에서 답을 넣으면 물어본 판이 된다 ───────────── */

test('★★★ 파일로 답을 넣으면 **어림이 아니라 물어본 판**이 된다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-prs-'));
  const p = path.join(dir, 'open.json');
  const saved = process.env.LP_OPEN_PRS;
  try {
    fs.writeFileSync(p, JSON.stringify(['claude/a', 'claude/b']));
    process.env.LP_OPEN_PRS = p;
    assert.deepStrictEqual(bd.openPrFromFile(), ['claude/a', 'claude/b']);

    // `{at, refs}` 꼴도 받는다 — 받는 쪽을 넓히는 편이, 적는 쪽이 형식을 틀려
    // 조용히 빈 배열이 되는 것보다 낫다
    fs.writeFileSync(p, JSON.stringify({ at: '2026-08-26', refs: ['claude/c'] }));
    assert.deepStrictEqual(bd.openPrFromFile(), ['claude/c']);
  } finally {
    if (saved === undefined) delete process.env.LP_OPEN_PRS; else process.env.LP_OPEN_PRS = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★★ 잘못 적힌 파일을 **빈 목록으로 삼키지 않는다** — 그러면 다 닫힌 것이 된다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-prs-'));
  const p = path.join(dir, 'bad.json');
  const saved = process.env.LP_OPEN_PRS;
  try {
    // ★★★ 여기가 가장 위험한 자리다. 빈 배열을 돌려주면 `check()` 가
    //   **「열린 PR 이 하나도 없다」**로 읽고 겹침을 하나도 안 센다 —
    //   그리고 화면에는 「물어봤다」라고 적힌다. 가장 비싼 거짓말이다.
    fs.writeFileSync(p, '{ 이건 JSON 이 아니다 }');
    process.env.LP_OPEN_PRS = p;
    assert.strictEqual(bd.openPrFromFile(), null, '못 읽었으면 null 이다 — 빈 목록이 아니다');
    assert.match(bd.whyNoPr() || '', /LP_OPEN_PRS/);

    fs.writeFileSync(p, JSON.stringify({ 갈래: ['claude/a'] }));
    assert.strictEqual(bd.openPrFromFile(), null, '모르는 형식도 null 이다');

    process.env.LP_OPEN_PRS = path.join(dir, '없는파일.json');
    assert.strictEqual(bd.openPrFromFile(), null);
    assert.match(bd.whyNoPr() || '', /없다/);
  } finally {
    if (saved === undefined) delete process.env.LP_OPEN_PRS; else process.env.LP_OPEN_PRS = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ───────────── ④ 자동으로 찾은 기록은 **나이를 따진다** ───────────── */

test('★★★ 낡은 기록으로 「물어봤다」고 하지 않는다 — 어제 답이 가장 비싼 거짓말이다', () => {
  const saved = process.env.LP_OPEN_PRS;
  delete process.env.LP_OPEN_PRS;
  const auto = bd.AUTO_PRS;
  const backup = fs.existsSync(auto) ? fs.readFileSync(auto, 'utf8') : null;
  try {
    const old = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    fs.writeFileSync(auto, JSON.stringify({ at: old, refs: ['claude/a'] }));
    assert.strictEqual(bd.openPrFromFile(), null, '30시간 전 기록을 그대로 썼다');
    assert.match(bd.whyNoPr() || '', /시간 전/, '까닭에 나이가 없으면 다시 받을 생각이 안 든다');

    // 시각이 아예 없으면 — 언제 것인지 모르는 답도 안 쓴다
    fs.writeFileSync(auto, JSON.stringify(['claude/a']));
    assert.strictEqual(bd.openPrFromFile(), null);
    assert.match(bd.whyNoPr() || '', /시각/);

    // 갓 받은 것은 쓴다 (늑대야가 되면 아무도 안 쓴다)
    fs.writeFileSync(auto, JSON.stringify({ at: new Date().toISOString(), refs: ['claude/a'] }));
    assert.deepStrictEqual(bd.openPrFromFile(), ['claude/a']);
    assert.ok(bd.prAgeHours() !== null && bd.prAgeHours() < 1);
  } finally {
    if (backup === null) fs.rmSync(auto, { force: true });
    else fs.writeFileSync(auto, backup);
    if (saved !== undefined) process.env.LP_OPEN_PRS = saved;
  }
});

test('★★ 「열린 PR 이 없다」를 **적을 수는 있어야 한다** — 다만 실수로는 안 된다', () => {
  const openPrs = require('../tools/open-prs.js');
  const auto = bd.AUTO_PRS;
  const backup = fs.existsSync(auto) ? fs.readFileSync(auto, 'utf8') : null;
  try {
    // 이름을 안 주고 부르면 거부한다 — 그냥 빈 배열이 되면 겹침을 하나도 안 세면서
    // 「물어봤다」고 적는다 (이 파일 ② 가 막는 것과 같은 결)
    assert.strictEqual(openPrs.main([]), 1);
    // 뜻을 밝히면 받는다
    assert.strictEqual(openPrs.main(['--none']), 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(auto, 'utf8')).refs, []);
  } finally {
    if (backup === null) fs.rmSync(auto, { force: true });
    else fs.writeFileSync(auto, backup);
  }
});

test('★★ 기록이 커밋되지 않는다 — 남의 세션이 내 옛 답을 물려받으면 안 된다', () => {
  const ig = fs.readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf8');
  assert.match(ig, /^\.lp-open-prs\.json$/m, '.gitignore 에 없으면 커밋되어 옛 답이 따라다닌다');
});
