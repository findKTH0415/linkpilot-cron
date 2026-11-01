'use strict';
/* CLAUDE.md 크기 — 15만 자 아래 〈2026-11-01 사장님: 「CLAUDE.md 줄여줘」〉
   CLAUDE.md 는 세션마다 통째로 읽힌다. Claude Code 가 150k 자를 넘으면 경고를 낸다(실측 23.4만 자).
   경위·세부는 docs/경위-CLAUDE-본문.md · docs/경위-§12.md 에 두고 여기는 규칙 줄만 둔다 (§7). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LIMIT = 150000;

test('CLAUDE.md 가 15만 자 아래다 (Claude Code 경고 한도)', () => {
  const n = [...fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8')].length;
  console.log('     · CLAUDE.md ' + n.toLocaleString('en-US') + '자 / 한도 ' + LIMIT.toLocaleString('en-US') + '자');
  assert.ok(n < LIMIT, 'CLAUDE.md 가 ' + n + '자다 — 긴 경위는 docs/경위-CLAUDE-본문.md 로 옮기고 규칙 줄만 남긴다 (§7)');
});

test('옮긴 경위가 있는 파일이 있고, CLAUDE.md 가 그 파일을 가리킨다', () => {
  for (const f of ['docs/경위-CLAUDE-본문.md', 'docs/경위-§12.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' 가 없다 — 옮긴 경위가 사라졌다');
  }
  const md = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.ok(md.includes('docs/경위-CLAUDE-본문.md'), 'CLAUDE.md 가 경위 파일을 안 가리킨다 — 못 찾으면 없는 경위다');
});
