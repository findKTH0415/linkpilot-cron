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
