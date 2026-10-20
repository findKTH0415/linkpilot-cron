'use strict';
// NAS 에서 도는 스크립트(im-agent/tools/*-nas.sh)가 부르는 파일은 «배포가 올리는 자리»에 있어야 한다.
// ★ 〈2026-10-20 · 실측〉 yeoui893-nas.sh 가 scripts/yeoui893-fetch.mjs 를 불렀는데 deploy/engine.sh 는 im-agent/ 만 올린다 —
//   저장소에는 있고 NAS 에는 없었다. calendar-nas.sh 가 2026-09-12 에 겪은 것과 같은 자리다 (CLAUDE.md §4 「자리가 im-agent/ 안인 것이 규격이다」).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TOOLS = path.join(ROOT, 'im-agent', 'tools');

test('NAS 스크립트가 부르는 node 파일은 전부 im-agent/ 안에 있고 실제로 있다', () => {
  const shs = fs.readdirSync(TOOLS).filter((f) => /-nas\.sh$/.test(f));
  assert.ok(shs.length >= 3, `NAS 스크립트를 못 읽었다 (${shs.length}개) — 이 칸은 아무것도 안 잰다`);
  const engine = fs.readFileSync(path.join(ROOT, 'deploy', 'engine.sh'), 'utf8');
  const excluded = [...engine.matchAll(/--exclude='([^']+)'/g)].map((m) => m[1].replace(/\*/g, ''));
  assert.ok(excluded.length >= 3, 'engine.sh 에서 빼는 폴더 목록을 못 읽었다');
  const bad = [];
  let seen = 0;
  for (const f of shs) {
    const src = fs.readFileSync(path.join(TOOLS, f), 'utf8').replace(/^[ \t]*#.*$/gm, '');
    for (const m of src.matchAll(/"\$NODE"\s+([\w./-]+\.(?:m?js|cjs))/g)) {
      seen++;
      const rel = m[1];
      if (!rel.startsWith('im-agent/')) bad.push(`${f} → ${rel} (im-agent/ 밖 — 배포가 안 올린다)`);
      else if (excluded.some((e) => e && rel.startsWith(e))) bad.push(`${f} → ${rel} (배포가 빼는 자리)`);
      else if (!fs.existsSync(path.join(ROOT, rel))) bad.push(`${f} → ${rel} (파일이 없다)`);
    }
  }
  assert.ok(seen >= 2, `NAS 스크립트에서 부르는 node 파일을 못 읽었다 (${seen}개)`);
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});
