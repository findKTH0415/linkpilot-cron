'use strict';
/**
 * sources-verdict.test.js — **초록이 「값이 왔다」를 뜻하게** 〈2026-09-19 · D-225〉
 *   〈사장님 「권하는 개선안 대로 진행해」 — 제가 올린 권장 ①〉
 *
 * ★★★ **무엇이 문제였나.** `yeoui893-sources.yml` 의 두 단계가 모두
 *   `continue-on-error: true` 이고 **판정 단계가 없어**, 조회가 전부 실패해도
 *   **초록으로 끝났다.** 초록이라 아무도 요약을 안 열어 보고, 정작 하려던 수집은
 *   한 번도 안 된 채로 남는다 — §12-24 가 브이월드에서 겪은 「0/5 인데 초록」과
 *   **같은 모양**이다.
 *
 * ★ **`continue-on-error` 자체는 남긴다.** 걷어내면 앞 단계가 막힌 날 뒷 단계가
 *   **아예 안 돈다** — 지가지수가 막혔다고 법령·금리까지 못 받을 이유가 없다.
 *   대신 **맨 끝에서 판정**한다.
 *
 * ★★ **판정은 맨 마지막이다** — 결과 커밋과 아티팩트를 먼저 남긴 뒤에 빨갛게
 *   끝내야 **빨간 실행에서도 받을 것이 남는다** (§12-24 의 그 규칙).
 *
 * ★★★ **검사가 «자기 논리»를 재면 안 된다** (§12-24 에서 사보타주 둘이 빠져나간 자리).
 *   그래서 판정을 **베끼지 않고 오려 내 실제로 돌린다** — 셸은 `bash` 로,
 *   스크립트의 갈래식은 소스에서 읽어 먹인다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { yamlNoComment } = require('./yaml-lite.js');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows', 'yeoui893-sources.yml');
const read = (p) => fs.readFileSync(p, 'utf8');

test('판정 단계가 «맨 마지막»이다 (결과·아티팩트를 먼저 남긴 뒤에 빨갛게 끝낸다)', () => {
  const y = read(WF);
  const names = [...y.matchAll(/^\s*- name:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(names.length >= 4, `단계를 못 읽었습니다 — 이 칸은 아무것도 안 잽니다 (${names.length}개)`);

  const iVerdict = names.findIndex((n) => /판정/.test(n));
  assert.ok(iVerdict >= 0, '판정 단계가 없습니다 — 그러면 전부 실패해도 초록입니다 (§12-24)');

  const iArtifact = names.findIndex((n) => /아티팩트/.test(n));
  const iCommit = names.findIndex((n) => /커밋/.test(n));
  assert.ok(iArtifact >= 0 && iCommit >= 0, '결과 커밋·아티팩트 단계를 못 찾았습니다');
  assert.ok(iVerdict > iArtifact && iVerdict > iCommit,
    '판정이 결과 커밋·아티팩트보다 «앞»에 있습니다 — 빨갛게 끝나면 받을 것이 안 남습니다 '
    + `(판정 ${iVerdict + 1}번째 · 커밋 ${iCommit + 1} · 아티팩트 ${iArtifact + 1})`);
});

test('★ 판정 셸을 «오려 내 돌린다» — 베끼면 한쪽이 옛말을 한다', () => {
  const y = yamlNoComment(read(WF));
  /* 판정 단계의 `run: |` 블록을 통째로 집는다 (꼬리 글자로 찾지 않는다 · §12-6) */
  const at = y.search(/^\s*- name:\s*판정/m);
  assert.ok(at >= 0, '판정 단계를 못 찾았습니다');
  const runAt = y.indexOf('run: |', at);
  assert.ok(runAt > 0, '판정 단계에 run 블록이 없습니다');
  const lines = y.slice(y.indexOf('\n', runAt) + 1).split('\n');
  const indent = (lines[0].match(/^\s*/) || [''])[0].length;
  const body = [];
  for (const l of lines) {
    if (l.trim() && (l.match(/^\s*/) || [''])[0].length < indent) break;
    body.push(l.slice(indent));
  }
  const shell = body.join('\n');
  assert.ok(/GITHUB_STEP_SUMMARY/.test(shell) && /exit 1/.test(shell),
    '판정 셸을 제대로 못 오려 냈습니다 — 이 칸은 아무것도 안 잽니다');

  const run = (J, S) => {
    const r = spawnSync('bash', ['-c', shell], {
      encoding: 'utf8',
      env: { ...process.env, J, S, GITHUB_STEP_SUMMARY: '/dev/null' },
    });
    return { code: r.status, out: String(r.stdout || '') };
  };

  /* ① 둘 다 성공 → 초록 */
  const ok = run('success', 'success');
  assert.strictEqual(ok.code, 0, `둘 다 성공인데 빨갛습니다: ${ok.out}`);
  assert.match(ok.out, /전부 받았다/, '전부 받은 것을 그렇게 안 적습니다');

  /* ② 한쪽 실패 → 빨강 + «어느 것»인지 적는다 */
  const half = run('failure', 'success');
  assert.strictEqual(half.code, 1, '한쪽이 실패했는데 초록입니다 — 이것이 이 칸을 둔 까닭입니다');
  assert.match(half.out, /지가지수/, '실패한 갈래의 이름을 안 적습니다');
  assert.ok(!/법령·한국은행 — \*\*못/.test(half.out), '멀쩡한 갈래를 실패로 적습니다');

  /* ③ 둘 다 실패 → 빨강 */
  assert.strictEqual(run('failure', 'failure').code, 1, '둘 다 실패인데 초록입니다');

  /* ④ 안 돌았다(skipped)·못 쟀다(빈 값) → «초록으로 안 끝낸다» (§8) */
  assert.strictEqual(run('skipped', 'success').code, 1, '안 돈 단계를 통과로 셉니다');
  const unknown = run('', '');
  assert.strictEqual(unknown.code, 1, '못 잰 것을 통과로 셉니다 (§8)');
  assert.match(unknown.out, /못 쟀다/, '못 잰 것을 「못 쟀다」로 안 적습니다');

  /* ★ 그리고 스스로 처방을 안 적는다 — 무엇이 막았는지는 요약이 말한다 (§12-19) */
  assert.ok(!/열쇠를 다시|콘솔|활용신청/.test(half.out),
    '판정 단계가 스스로 처방을 적습니다 — 무엇이 막았든 같은 곳을 가리키게 됩니다 (§12-19)');
});

test('두 스크립트가 갈래를 «되돌아오는 값»으로 낸다 (0 전부 · 1 일부 · 2 하나도)', () => {
  for (const f of ['yeoui893-sources.mjs', 'market-jeonju.mjs']) {
    const src = read(path.join(ROOT, 'scripts', f))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    assert.match(src, /process\.exit\(/,
      `scripts/${f} 가 되돌아오는 값을 안 냅니다 — 늘 0 이면 워크플로가 못 가릅니다`);
    /* 세 갈래가 다 있는지 — 0·1·2 */
    assert.ok(/\b2\b/.test(src.slice(src.lastIndexOf('process.exit(') - 800)),
      `scripts/${f} 의 판정에 「하나도 못 받음(2)」 갈래가 안 보입니다`);
    /* 판정 글이 요약 «맨 앞»에 간다 — 맨 끝에 적으면 아무도 안 본다 (§6-3 ①) */
    assert.match(src, /log\.unshift\(/,
      `scripts/${f} 가 판정을 요약 맨 앞에 안 올립니다 — 맨 끝은 아무도 안 봅니다`);
  }
});
