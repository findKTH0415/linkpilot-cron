'use strict';
/**
 * workflow-actions.test.js — **폐기 예고된 액션 판을 붙잡고 있지 않은지 잰다**
 * 〈2026-09-07 · 사장님 지시 「권하는 개선안으로 진행해」〉.
 *
 * ★★★ 왜 만들었나. 배포 로그마다 이 줄이 찍히고 있었다:
 *
 *     Node.js 20 is deprecated. The following actions target Node.js 20 but are
 *     being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4
 *
 *   지금은 「강제로 24 에서 돌려 준다」이지만, 그 배려가 끊기는 날 **워크플로가
 *   통째로 선다.** 그날이 하필 급한 날이면 원인이 둘로 보인다 — 오늘 SSH
 *   열쇠를 찾느라 하루를 쓴 자리에 이것까지 겹쳤으면 못 갈랐을 것이다.
 *
 * ★ 그런데 **판을 올리는 것만으로는 안 막힌다.** 새 워크플로를 쓸 때 손이
 *   기억하는 것은 `@v4` 다 — 지금까지 27자리가 전부 그랬다. 그래서 장치로 막는다
 *   (CLAUDE.md §8 「규칙을 문서에만 적으면 그 규칙은 사람의 기억에 얹힌다」).
 *
 * ★★ **없는 것을 세지 않는다.** 워크플로를 하나도 못 찾으면 그 자체로 빨개진다 —
 *   0개를 훑고 「전부 통과」라고 말하는 검사가 이 저장소에서 실제로 두 번 났다.
 *
 * ★★★ **주석을 걷고 본다** (CLAUDE.md §8). 위 경위에 `actions/checkout@v4` 가
 *   글자로 적혀 있어, 안 걷으면 **이 파일이 이 파일을 빨갛게 만든다.**
 *   YAML 의 주석(`#`)만 걷는다 — 재는 대상은 `uses:` 줄뿐이다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', '.github', 'workflows');

/** 이 판보다 낮으면 빨개진다. 올릴 때는 이 표만 고친다. */
const FLOOR = { checkout: 5, 'setup-node': 5, 'upload-artifact': 5 };

function uses() {
  const out = [];
  for (const f of fs.readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/#.*$/, '');           // ★ 주석을 걷는다
      const m = code.match(/uses:\s*actions\/([a-z-]+)@v(\d+)/);
      if (m) out.push({ file: f, line: i + 1, name: m[1], major: Number(m[2]) });
    });
  }
  return out;
}

test('워크플로를 실제로 찾았다 — 0개를 훑고 통과라고 말하지 않는다', () => {
  const found = uses();
  assert.ok(fs.existsSync(DIR), `${DIR} 가 없다 — 이 검사는 아무것도 안 재고 있다`);
  assert.ok(found.length >= 20,
    `actions/* 를 ${found.length}개만 찾았다 — 훑는 자리가 틀렸을 가능성이 크다 (재는 것이 없는 검사가 된다)`);
});

test('★★★ 폐기 예고된 액션 판(Node 20)을 붙잡고 있지 않다', () => {
  const bad = uses().filter((u) => FLOOR[u.name] && u.major < FLOOR[u.name]);
  assert.deepStrictEqual(bad.map((u) => `${u.file}:${u.line} actions/${u.name}@v${u.major}`), [],
    '★ 위 자리가 옛 판이다. 그 배려(강제 Node 24)가 끊기면 **워크플로가 통째로 선다** — '
    + `지금 기준은 ${Object.entries(FLOOR).map(([k, v]) => `${k}>=v${v}`).join(' · ')} 이다`);
});

test('아는 액션은 표에 다 있다 — 모르는 것을 조용히 통과시키지 않는다', () => {
  const unknown = [...new Set(uses().map((u) => u.name))].filter((n) => !(n in FLOOR));
  assert.deepStrictEqual(unknown, [],
    `★ 표에 없는 actions/* 가 있다: ${unknown.join(' · ')} — 이 검사가 그것만 안 재고 지나간다. FLOOR 에 더한다`);
});
