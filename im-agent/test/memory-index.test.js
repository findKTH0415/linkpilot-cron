'use strict';
/**
 * memory-index.test.js — **재발 방지 기록이 실제로 찾아지는가** 〈2026-08-22〉.
 *
 * ★★ 왜 만들었나. `MEMORY.md` 는 「문제가 생기면 **먼저 여기를 찾는다**」는
 *   약속 위에 서 있다(CLAUDE.md §7). 그 약속은 **색인**이 지킨다 — 1,100줄짜리
 *   파일에서 사람은 색인만 훑는다.
 *
 * ★★ 그런데 실제로 **M-19 ~ M-23 다섯 항목이 색인에 없었다.** 본문은 멀쩡히
 *   있었는데 표에서 빠져 있었다. 그 다섯은 **적어 두고도 못 찾는 상태**였다 —
 *   기록의 값이 0이 되는 자리다. 실제로 같은 종류(M-20 배포 사고)를 다시 겪었다.
 *
 * ★ 그리고 이 어긋남은 **아무 오류도 안 낸다.** 문서는 잘 렌더되고, 링크도
 *   안 깨진다. 없는 줄만 없다. 그래서 검사가 아니면 못 잡는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MEM = fs.readFileSync(path.join(ROOT, 'MEMORY.md'), 'utf8');

/** GitHub 이 제목에서 닻(anchor)을 만드는 규칙을 흉내 낸다 */
function slug(title) {
  return title
    .toLowerCase()
    .replace(/[`*]/g, '')                      // 역따옴표·별표는 사라진다
    .replace(/[^\w가-힣 -]/g, '')              // 마침표·괄호 따위도 사라진다
    .trim()
    .replace(/\s+/g, '-');
}

test('★★★ 색인이 본문 항목을 하나도 빠뜨리지 않는다 (다섯이 빠져 있었다)', () => {
  const bodies = (MEM.match(/^## (M-\d+)\./gm) || []).map((h) => h.slice(3).replace('.', ''));
  const indexed = (MEM.match(/^\| \[(M-\d+)\]/gm) || []).map((h) => h.slice(3, -1));

  assert.ok(bodies.length >= 20,
    `본문 항목을 못 찾았다 (${bodies.length}개) — 검사가 아무것도 재지 못했다`);

  const missing = bodies.filter((id) => indexed.indexOf(id) < 0);
  assert.deepStrictEqual(missing, [],
    `색인에 없는 항목: ${missing.join(' · ')} — 적어 두고도 못 찾는 상태다`);

  const stale = indexed.filter((id) => bodies.indexOf(id) < 0);
  assert.deepStrictEqual(stale, [],
    `본문이 없는 색인 줄: ${stale.join(' · ')} — 눌러도 아무 데도 안 간다`);
});

test('★★ 색인의 링크가 실제 제목으로 간다 (눌러서 헛도는 줄이 없다)', () => {
  const rows = MEM.match(/^\| \[(M-\d+)\]\(#([^)]+)\)/gm) || [];
  assert.ok(rows.length >= 20, `색인 줄을 못 찾았다 (${rows.length}개)`);

  const titles = {};
  (MEM.match(/^## M-\d+\..*$/gm) || []).forEach((h) => {
    const id = h.match(/^## (M-\d+)\./)[1];
    titles[id] = slug(h.replace(/^## /, ''));
  });

  rows.forEach((row) => {
    const m = row.match(/^\| \[(M-\d+)\]\(#([^)]+)\)/);
    assert.strictEqual(m[2], titles[m[1]],
      `${m[1]} 의 링크가 제목과 다르다 — 눌러도 안 간다\n  색인: ${m[2]}\n  제목: ${titles[m[1]]}`);
  });
});

/**
 * ★★ 사장님 지시 〈2026-08-22〉 — 「상태 변경 시 단일 소스 updatedAt 필수」 규칙과
 *   상태 토글 검증 체크리스트가 **사라지지 않게** 지킨다. 규칙은 지워도 아무
 *   오류가 안 나고, 없어진 줄은 아무도 그리워하지 않는다.
 */
test('★★ 「상태 변경 시 단일 출처 updatedAt 필수」 규칙과 체크리스트가 남아 있다', () => {
  assert.match(MEM, /### 규칙 — 상태 변경 시 단일 출처 `updatedAt` 필수/,
    '규칙 제목이 사라졌다');
  assert.match(MEM, /kstStamp\(\)/, '단일 출처(kstStamp)를 가리키지 않는다');
  assert.match(MEM, /### 상태 토글 기능 검증 체크리스트/, '체크리스트가 사라졌다');

  const at = MEM.indexOf('### 상태 토글 기능 검증 체크리스트');
  const list = MEM.slice(at, MEM.indexOf('###', at + 10));
  const items = (list.match(/^- \[ \]/gm) || []).length;
  assert.ok(items >= 8,
    `체크리스트 항목이 ${items}개뿐이다 — 줄어들면 건너뛰는 자리가 생긴다`);
});

/**
 * ★★ 「배포 전 교차검증」은 CLAUDE.md §7 이 이름으로 가리키는 목록이다.
 *   이름이 바뀌거나 사라지면 **지침이 없는 곳을 가리킨다.**
 */
test('★★ 배포 전 교차검증 목록이 있고, 실패를 재라는 항목이 들어 있다', () => {
  assert.match(MEM, /## 배포 전 교차검증 \(건너뛰지 않는다\)/,
    'CLAUDE.md §7 이 이름으로 가리키는 목록이 사라졌다');
  assert.match(MEM, /통과를 재지 말고 \*\*실패를 잰다\.\*\*/,
    '「실패를 잰다」 항목이 사라졌다 — 아무것도 안 하는 검사가 통과한다 (M-12)');
  assert.match(MEM, /같은 일을 하는 길이 둘이면 둘 다 밟아 본다/,
    '길이 갈리는 자리를 보라는 항목이 사라졌다 (M-24)');
});
