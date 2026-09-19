'use strict';
/**
 * backup — **되살아나는가** (인수인계 감사 H-1 · 지침 §11-4)
 *
 * ★★★ 이 검사가 재는 것은 「백업 파일이 생겼는가」가 아니다.
 *   지침 §11-4 가 「백업의 **존재가 아니라** 실제 복원시험에 성공해야 한다」로
 *   못 박았다. 그래서 여기서도 **빈 자리에 되살려 바이트를 댄다.**
 *
 * ★★ 그리고 **복원시험 자체가 거짓말을 안 하는지**를 잰다 —
 *   자료를 일부러 망가뜨리고 「그래도 통과」가 나오면, 그 시험은 없느니만 못하다.
 *   실제로 통과만 재는 검사가 초록으로 앉아 있는 것이 이 저장소가 여러 번
 *   당한 자리다 (지침 §5-④ · CLAUDE.md §8 「표본이 거짓말을 하면」).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const backup = require('../tools/backup.js');

/** 재려는 성질을 지키는 표본 — **파일마다 내용이 달라야** 한다 (M-«표본» 규칙) */
function sampleStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-src-'));
  fs.mkdirSync(path.join(dir, 'LP-T-001', '09_IM'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'LP-T-002', '01_Project'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'LP-T-001', '09_IM', 'im.md'), '# 첫 번째 딜\n값 1,234\n');
  fs.writeFileSync(path.join(dir, 'LP-T-001', 'run.log'), 'a\nb\n');
  fs.writeFileSync(path.join(dir, 'LP-T-002', '01_Project', 'dataset.json'), '{"facts":{"x":2}}');
  return dir;
}

const trash = [];
function tmpDir(p) { trash.push(p); return p; }
test.after(() => trash.forEach((p) => fs.rmSync(p, { recursive: true, force: true })));

/* ───────────── 되살아나는가 ───────────── */

test('★★★ 빈 자리에 되살리면 바이트까지 같다 — 이것이 복원시험이다', () => {
  const src = tmpDir(sampleStore());
  const r = backup.drill({ source: src });
  assert.strictEqual(r.ok, true, r.line);
  assert.strictEqual(r.count, 3, '표본 파일 수가 다르다');
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.differ, []);
});

test('★★★ 되살린 것이 다르면 **빨개진다** — 통과가 아니라 실패를 잰다', () => {
  // ★ 막는 장치를 빼고 돌려 본다 (지침 §5-④). 되살린 자료를 한 글자 바꾸고도
  //   「같다」가 나오면 이 시험은 아무것도 안 재는 것이다.
  const src = tmpDir(sampleStore());
  const dest = tmpDir(fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-dst-')));
  const back = tmpDir(path.join(dest, 'restored'));

  backup.write({ source: src, dest: path.join(dest, 'b') });
  backup.restore({ from: path.join(dest, 'b'), to: back });

  // 되살린 쪽을 한 글자 망가뜨린다
  const victim = path.join(back, 'LP-T-001', '09_IM', 'im.md');
  fs.writeFileSync(victim, `${fs.readFileSync(victim, 'utf8')}몰래 한 줄\n`);

  const before = backup.inventory(src);
  const after = backup.inventory(back);
  const differ = Object.keys(before).filter((f) => after[f] && after[f].sha256 !== before[f].sha256);
  assert.strictEqual(differ.length, 1, '한 글자를 바꿨는데 못 잡으면 지문이 내용을 안 본다');
  assert.notStrictEqual(backup.digestOf(before), backup.digestOf(after),
    '폴더 지문이 내용 변화를 안 따라간다');
});

test('★★ 파일이 통째로 빠지면 잡는다 — 복원이 반쯤 되는 것이 가장 위험하다', () => {
  const src = tmpDir(sampleStore());
  const dest = tmpDir(fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-dst2-')));
  const back = tmpDir(path.join(dest, 'restored'));
  backup.write({ source: src, dest: path.join(dest, 'b') });
  backup.restore({ from: path.join(dest, 'b'), to: back });

  fs.rmSync(path.join(back, 'LP-T-002', '01_Project', 'dataset.json'));
  const before = backup.inventory(src);
  const after = backup.inventory(back);
  const missing = Object.keys(before).filter((f) => !after[f]);
  assert.deepStrictEqual(missing, ['LP-T-002/01_Project/dataset.json']);
});

/* ───────────── 안전하게 도는가 ───────────── */

test('★★★ 되살리기가 **지우는 일**이 되지 않는다 — 비어 있지 않으면 거부한다', () => {
  // 급할 때 「무엇이 지워질지 몰라서 아무도 안 누르는」 도구가 되면 없는 것과 같다
  const src = tmpDir(sampleStore());
  const dest = tmpDir(fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-dst3-')));
  backup.write({ source: src, dest: path.join(dest, 'b') });

  const occupied = tmpDir(fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-occ-')));
  fs.writeFileSync(path.join(occupied, '소중한.txt'), '지우면 안 된다');

  const r = backup.restore({ from: path.join(dest, 'b'), to: occupied });
  assert.strictEqual(r.ok, false);
  assert.match(r.line, /비어 있지 않다/);
  assert.ok(fs.existsSync(path.join(occupied, '소중한.txt')), '거부했는데 파일이 사라졌다');
});

test('★★ 뜨는 도중에 죽어도 **반쯤 뜬 백업**이 남지 않는다', () => {
  // 반쯤 뜬 백업은 없느니만 못하다 — 있다고 믿고 다시 안 뜬다
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'backup.js'), 'utf8')
    // 주석을 떼고 본다 (CLAUDE.md §8)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /\$\{dest\}\.new/, '옆에 만들지 않고 바로 덮으면 반쯤 뜬 것이 남는다');
  assert.match(src, /fs\.renameSync\(staging, dest\)/, '마지막에 바꿔 다는 자리가 없다');
});

test('★ 심볼릭 링크를 따라가지 않는다 — 바깥 자료를 뜨거나 고리에 빠진다', () => {
  const src = tmpDir(sampleStore());
  const outside = tmpDir(fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-out-')));
  fs.writeFileSync(path.join(outside, '남의자료.txt'), 'x');
  try { fs.symlinkSync(outside, path.join(src, 'link')); }
  catch (_) { return; }   // 링크를 못 만드는 자리면 잴 것이 없다
  const files = backup.walk(src);
  assert.ok(!files.some((f) => f.startsWith('link/')), '링크를 따라가 바깥 자료를 떴다');
});

/* ───────────── 뜬 것과 지금이 같은가 ───────────── */

test('★★ 뜬 뒤 자료가 바뀌면 **말한다** — 조용하면 옛 백업을 믿는다', () => {
  const src = tmpDir(sampleStore());
  const dest = tmpDir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-v-')), 'b'));
  backup.write({ source: src, dest });
  assert.strictEqual(backup.verify({ source: src, dest }).ok, true);

  fs.writeFileSync(path.join(src, 'LP-T-001', '새 파일.md'), '나중에 생긴 것');
  const v = backup.verify({ source: src, dest });
  assert.strictEqual(v.ok, false);
  assert.match(v.line, /새 파일 1/);
});

test('★ 지문에 시각을 섞지 않는다 — 섞으면 「어긋났다」와 「다시 떴다」를 못 가른다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'backup.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Date\.now\(\)|new Date\(/.test(src),
    '시각이 섞이면 내용이 안 바뀌어도 지문이 매번 달라진다');
});

/* ───────────── 너무 크면 몰래 줄이지 않는다 ───────────── */

test('★★★ 한도를 넘으면 **못 쟀다**로 끝낸다 — 표본을 몰래 줄이지 않는다', () => {
  // ★ 복원시험은 뜬 것과 되살린 것 두 벌을 만든다. 자리가 모자랄 때
  //   **반쯤 하고 통과**하는 것이 가장 나쁘다 — 화면에는 「되살아난다」만 남는다.
  const src = tmpDir(sampleStore());
  const r = backup.drill({ source: src, maxMb: 0.000001 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 2, '못 쟀다(2)여야 한다 — 실패(1)와 다른 사실이다');
  assert.match(r.line, /한도/);

  // 한도가 넉넉하면 그대로 통과한다 (늑대야가 되면 안 된다)
  assert.strictEqual(backup.drill({ source: src, maxMb: 100 }).ok, true);
});

/* ───────────── 어디를 뜨는지 — 세는 자리와 같은가 ───────────── */

test('★★★ 프로젝트 폴더를 `store` 에서 가져온다 — 박아 두면 NAS 에서 빈 폴더를 뜬다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'backup.js'), 'utf8')
    // 주석을 떼고 본다 (CLAUDE.md §8)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /require\('\.\.\/core\/store'\)\.root\(\)/,
    '자리를 박아 두면 운영 자리(IM_AGENT_ROOT)를 안 보고 **빈 폴더를 뜨고 「되살아난다」**고 말한다');
  assert.ok(!/path\.join\(REPO, 'im-projects'\)/.test(src),
    '옛 경로가 남아 있다 — 두 벌이 되면 한쪽이 옛말을 한다');
});

/* ───────────── 배포가 실제로 돌리는가 ───────────── */

test('★★★ 배포가 나갈 때마다 복원시험을 돌린다 — 손으로 돌려야 도는 장치는 안 돈다', () => {
  // D-88 에서 이미 겪었다: 눌러야 도는 배포는 아무도 안 눌러서 NAS 가 옛 판으로 남았다.
  const wf = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', 'deploy-nas.yml'), 'utf8');
  assert.match(wf, /name: Restore drill/, '배포에 복원시험 단계가 없다');
  assert.match(wf, /backup\.js drill --max-mb/, '한도 없이 돌리면 자리가 모자랄 때 무슨 일이 날지 모른다');
  assert.match(wf, /복원시험: \*\*못 쟀다\*\*/,
    '못 잰 것을 실패로 적으면 멀쩡한 디스크를 두고 없는 고장을 찾으러 간다');
});

/**
 * ★★★ **못 읽는 파일 하나가 백업을 통째로 막고 있었다** 〈2026-09-17 · 실측 · D-212〉
 *
 * 배포 로그가 이렇게 죽었다 —
 *   `EACCES: permission denied, open '…/02_Source_Data/….pdf'`
 *   `at sha256 (backup.js:90) → inventory → write`
 * 앱이 만든 자료 파일을 **배포 계정이 못 읽는 것**인데, 던지고 끝나므로
 * **한 벌도 안 떴다.** 그리고 워크플로는 그것을 「못 쟀다」로만 적어,
 * **지금 이 디스크가 죽으면 그대로 잃는 상태**가 조용히 이어졌다 (H-1).
 *
 * ★ 잣대는 둘이다 — ① **일부라도 뜬다** ② **무엇이 빠졌는지 반드시 말한다.**
 *   ①만 하면 「백업이 있다」고 믿는 채로 그 파일만 없다 (§8 · §4.7).
 * ★★ **표본이 재려는 성질을 지켜야 한다** — `chmod` 로 막으면 root 로 돌 때
 *   권한이 안 먹어 **거짓으로 초록**이 된다(§12-10 에서 실제로 당했다).
 *   그래서 **읽기 자체를 던지게** 끼운다 — 누가 돌리든 같은 답이 나온다.
 */
function withUnreadable(rel, fn) {
  const realRead = fs.readFileSync;
  const realCopy = fs.copyFileSync;
  const boom = () => { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; };
  fs.readFileSync = function (p, ...a) {
    return String(p).endsWith(rel) ? boom() : realRead.call(fs, p, ...a);
  };
  fs.copyFileSync = function (s, ...a) {
    return String(s).endsWith(rel) ? boom() : realCopy.call(fs, s, ...a);
  };
  try { return fn(); } finally { fs.readFileSync = realRead; fs.copyFileSync = realCopy; }
}

test('★★★ 못 읽는 파일이 있어도 **한 벌은 뜬다** — 하나 때문에 전부를 잃지 않는다 (D-212)', () => {
  const src = sampleStore();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-dst-'));
  const r = withUnreadable('run.log', () => backup.write({ source: src, dest: path.join(dest, 'b') }));
  assert.ok(r.ok, `못 읽는 파일 하나에 백업이 통째로 죽었습니다: ${r.line}`);
  assert.ok(r.count >= 2, `뜬 파일이 ${r.count}개뿐입니다 — 나머지까지 안 떴습니다`);
});

test('★★★ 빠진 것을 **말한다** — 조용히 건너뛰면 「백업이 있다」가 거짓이 된다 (D-212)', () => {
  const src = sampleStore();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-dst2-'));
  const r = withUnreadable('run.log', () => backup.write({ source: src, dest: path.join(dest, 'b') }));
  /* ★ **개수를 손으로 박지 않는다** — 그 파일 이름이 있는지로 본다 (§6-2-5). */
  assert.ok(Array.isArray(r.skipped) && r.skipped.some((f) => /run\.log$/.test(f)),
    `빠진 파일을 안 돌려줍니다: ${JSON.stringify(r.skipped)}`);
  assert.ok(/못 읽어 빠진 것/.test(r.line),
    `첫 줄에 빠진 사실이 없습니다 — 뒤에 적으면 안 읽힙니다 (§6-3 ①): ${r.line}`);
  /* ★ 백업 «안»에도 남긴다 — 되살릴 때 무엇이 없는지 보여야 한다 */
  const mp = path.join(dest, 'b', 'BACKUP-MANIFEST.json');
  const saved = JSON.parse(fs.readFileSync(mp, 'utf8'));
  assert.ok(Array.isArray(saved.skipped)
    && saved.skipped.some((x) => /run\.log$/.test(x.rel)),
  '백업 목록에 빠진 파일이 안 적혀 있습니다 — 되살릴 때 무엇이 없는지 모릅니다.');
  /* ★ 같은 파일이 두 번 적히지 않는다 — 읽는 사람에게는 「무엇이」가 필요하다 */
  const rels = saved.skipped.map((x) => x.rel);
  assert.strictEqual(rels.length, new Set(rels).size,
    `빠진 파일이 두 번 적혔습니다: ${rels.join(' · ')}`);
});

test('★★ 복원시험도 못 읽는 파일에 **안 죽는다** — 그리고 몇 개를 못 셌는지 적는다 (D-212)', () => {
  const src = sampleStore();
  const r = withUnreadable('run.log', () => backup.drill({ source: src }));
  assert.ok(r.ok, `복원시험이 못 읽는 파일 하나에 죽었습니다: ${r.line}`);
  assert.ok(/못 읽어 안 센 것/.test(r.line),
    `「되살아난다」만 적고 못 센 것을 안 말합니다 — 반쪽 진실입니다: ${r.line}`);
});

test('★★★ 빠진 것의 **폴더는 적고 파일 이름은 안 적는다** (D-213 · §2)', () => {
  const src = sampleStore();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-dst4-'));
  /* ★ 표본이 재려는 성질을 지켜야 한다 — **폴더 안**의 파일이어야 폴더가 나온다.
     뿌리의 파일로 재면 「폴더를 적는가」를 영영 못 잰다. */
  const r = withUnreadable('dataset.json', () => backup.write({ source: src, dest: path.join(dest, 'b') }));
  assert.ok(r.ok, `백업이 통째로 죽었습니다: ${r.line}`);
  assert.ok(Array.isArray(r.skippedDirs) && r.skippedDirs.length >= 1,
    `빠진 것의 폴더를 안 돌려줍니다: ${JSON.stringify(r.skippedDirs)}`);
  /* ★★ **총수를 괄호로 함께 적는가**까지 잰다 〈2026-09-17 · 실측으로 잡았다〉.
     배포가 이 줄에서 폴더 수를 세어 기계용 표에 찍는데, 가운뎃점만 세면
     넷을 넘는 순간 「A · B · C 그리고 5곳 더」가 **8곳인데 3 으로** 세진다.
     ★ 그래서 정본이 총수를 적고, 그 수가 **실제 폴더 수와 같은지** 여기서 본다 —
       「괄호가 있는가」만 세면 엉뚱한 수를 적어도 통과한다 (§6-2-6 의 46 → 105). */
  const m = r.line.match(/그 자리\((\d+)곳\):/);
  assert.ok(m,
    `첫 줄에 「어디인지(총 몇 곳)」가 없습니다 — 개수만 있으면 어느 폴더를 여실지 모르고, 배포가 그 수를 못 셉니다: ${r.line}`);
  assert.equal(Number(m[1]), r.skippedDirs.length,
    `괄호의 총수가 실제 폴더 수와 다릅니다 — 그 숫자가 곧 거짓이 됩니다: ${m[1]} vs ${r.skippedDirs.length}`);
  /* ★★★ **파일 이름은 그 줄에 안 나간다** — 프로젝트 자료 이름에는 사람 이름·거래
     상대가 섞일 수 있고 이 줄은 Actions 로그로 나간다 (§2). 폴더만 있으면 충분하다. */
  assert.ok(!/dataset\.json/.test(r.line),
    `빠진 **파일 이름**이 로그 줄에 실립니다 — 폴더까지만 적어야 합니다 (§2): ${r.line}`);
  /* ★ 그리고 폴더 이름 자체는 맞아야 한다 — 「적는 척」만 하면 뜻이 없다 */
  assert.ok(r.skippedDirs.some((d) => /LP-T-002\/01_Project$/.test(d)),
    `폴더가 엉뚱합니다: ${JSON.stringify(r.skippedDirs)}`);
});

test('★ 못 읽는 파일이 **없을 때는** 그 말을 안 붙인다 (없는 걱정을 만들지 않는다)', () => {
  const src = sampleStore();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bk-dst3-'));
  const r = backup.write({ source: src, dest: path.join(dest, 'b') });
  assert.ok(r.ok && (!r.skipped || r.skipped.length === 0), '멀쩡한데 빠진 것이 있다고 합니다');
  assert.ok(!/못 읽어/.test(r.line), `멀쩡한데 경고를 붙입니다: ${r.line}`);
});
