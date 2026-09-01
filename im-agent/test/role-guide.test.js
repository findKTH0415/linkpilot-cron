/**
 * **역할과 상태 낱말이 조용히 갈리는 것을 막는다.**
 *
 * ★★★ 2026-09-01. 사장님이 「최종 배포 전 교차검증 및 API 관리 운영지침」을 주셨다.
 *   조직을 그리는 문서는 **틀려도 아무 오류가 안 난다** — 조직도에 이름을 하나 더하고
 *   책임을 안 적으면 그 역할은 **그림에만 있는 채로** 반년을 간다. 실제로 이 문서의
 *   `Design Manager Agent` 가 그 상태였다(부록 A-2).
 *
 * ★★ 그리고 **같은 낱말이 다른 뜻으로** 늘어난다. `VERIFIED`·`BLOCKED`·`FAILED` 는
 *   오케스트레이터 지침의 **작업 단계**이면서 이 지침의 **검증 판정**이고,
 *   `READY_TO_DEPLOY` 는 코드(`core/design-gate.js`)에서 **디자인 게이트의 마지막 칸**인데
 *   이 지침에서는 **릴리스 판정**이다. 「VERIFIED 입니다」가 두 가지를 뜻하게 된다.
 *   ★ 겹치는 것 자체를 막지 않는다 — 이름은 이미 코드 여러 곳에 박혀 있다.
 *     **알려진 겹침을 표로 두고, 새로 겹치는 것이 생기면 빨개진다.**
 *
 * ★ 여기서 재는 것 넷:
 *   A. 조직도의 역할이 **전부 대조표(A-9)에 있다** — 그림에만 있는 역할을 막는다
 *   B. 상태 낱말이 **새로 겹치지 않는다** — 알려진 겹침은 A-1 표에 적혀 있어야 한다
 *   C. CLAUDE.md 가 **이 지침서를 가리킨다** (원문은 한 곳에)
 *   D. 지침서 표가 **CLAUDE.md 로 통째로 옮겨지지 않았다** (두 벌이면 한쪽이 옛말을 한다)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const GUIDE = path.join(ROOT, 'docs', '운영지침-배포전-교차검증-및-API관리.md');
const ORCH = path.join(ROOT, 'docs', '오케스트레이터-운영지침.md');
const GATE = path.join(ROOT, 'im-agent', 'core', 'design-gate.js');

const read = (p) => fs.readFileSync(p, 'utf8');

/** 제목의 **낱말**로 절을 찾는다 — 번호로 찾으면 판이 바뀔 때 통째로 죽는다 */
function section(text, re) {
  const heads = [...text.matchAll(/^#+ .*$/gm)];
  const i = heads.findIndex((h) => re.test(h[0]));
  if (i < 0) return '';
  const depth = heads[i][0].match(/^#+/)[0].length;
  const nxt = heads.slice(i + 1).find((h) => h[0].match(/^#+/)[0].length <= depth);
  return text.slice(heads[i].index, nxt ? nxt.index : text.length);
}

/* ── A. 조직도의 역할이 전부 대조표에 있는가 ───────────────────── */

/** 조직도(코드블록)에서 역할 이름만 뽑는다 */
function chartRoles(guide) {
  const sec = section(guide, /권장 조직구조|총괄 구조/);
  const m = sec.match(/~~~text\n([\s\S]*?)~~~/) || sec.match(/```text\n([\s\S]*?)```/);
  assert.ok(m, '조직도 코드블록을 못 찾았습니다 (§2.1)');
  return [...new Set(m[1].split('\n')
    /* 트리 문자와 앞 공백을 떼어 낸다 */
    .map((l) => l.replace(/[│├└─\s]+/g, ' ').trim())
    .filter(Boolean)
    /* 묶음 이름과 실행환경은 역할이 아니다 */
    .filter((n) => !/(책임군|검증군|실행환경)$/.test(n))
    .filter((n) => !/^LinkPilot (Staging|Production)$/.test(n)))];
}

test('A. 조직도에 그린 역할이 전부 대조표(A-9)에 있다 — 그림에만 있는 역할을 막는다', () => {
  const guide = read(GUIDE);
  const table = section(guide, /조직도 역할 대조표/);
  assert.ok(table, '부록 A-9 조직도 역할 대조표를 못 찾았습니다');
  /* 표 첫 칸만 읽는다 — 비고 칸의 이름을 「적혀 있다」로 오인하지 않는다 */
  const listed = new Set(table.split('\n').filter((l) => /^\s*\|/.test(l))
    .map((l) => (l.split('|')[1] || '').trim()));

  const missing = chartRoles(guide).filter((r) => !listed.has(r));
  assert.deepStrictEqual(missing, [],
    '조직도에는 있는데 대조표에 없는 역할입니다 — 책임을 아무도 안 맡습니다: ' + missing.join(', '));
});

/* ── B. 상태 낱말이 새로 겹치지 않는가 ─────────────────────────── */

/**
 * 상태 이름만 줍는다. **대문자라고 다 상태가 아니다** — `API`·`PASS`·`NAS` 가 섞이면
 * 겹침이 부풀어 검사가 아무것도 못 가른다. 그래서 **상태가 적히는 세 꼴**만 본다:
 *   `- NAME:` (설명 목록) · `` `NAME` `` (표·본문 인용) · `→ NAME` (전이 그림)
 * ★ 밑줄이 없는 이름도 상태다 (`VERIFIED`). 밑줄을 조건으로 걸었더니 **그 낱말이
 *   통째로 빠져** 겹침이 0 건으로 보였다 — 검사가 초록인데 아무것도 안 재고 있었다.
 */
function tokens(text) {
  const out = new Set();
  const add = (v) => { if (/^[A-Z][A-Z0-9_]{3,}$/.test(v)) out.add(v); };
  for (const m of text.matchAll(/^\s*[-|]\s*`?([A-Z][A-Z0-9_]+)`?\s*[:|]/gm)) add(m[1]);
  for (const m of text.matchAll(/`([A-Z][A-Z0-9_]+)`/g)) add(m[1]);
  for (const m of text.matchAll(/(?:^|→)\s*([A-Z][A-Z0-9_]+)\s*$/gm)) add(m[1]);
  return out;
}

test('B. 상태 낱말이 새로 겹치지 않는다 (알려진 겹침은 A-1 표에 적혀 있어야 한다)', () => {
  const guide = read(GUIDE);

  /* ① 이 지침이 정의하는 판정 — §3.7 「상태 정의」 */
  const mine = tokens(section(guide, /상태 정의/));
  /* Gate 4 의 릴리스 판정도 이 지침 것이다 */
  for (const t of tokens(section(guide, /독립 Release 검증/))) mine.add(t);

  /* ② 오케스트레이터 지침의 작업 단계 */
  const orch = tokens(section(read(ORCH), /작업상태/));

  /* ③ 코드의 디자인 게이트 칸 */
  const design = new Set([...read(GATE).matchAll(/id:\s*'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]));

  const collide = [...mine].filter((t) => orch.has(t) || design.has(t)).sort();

  /* A-1 표에 적힌 것 = 이미 알고 있고 뜻을 갈라 둔 겹침이다 */
  const known = section(guide, /같은 이름이 다른 뜻으로/);
  assert.ok(known, '부록 A-1 을 못 찾았습니다');
  const unlisted = collide.filter((t) => !new RegExp('`' + t + '`').test(known));

  assert.deepStrictEqual(unlisted, [],
    '뜻이 갈리는데 A-1 표에 없는 낱말입니다 — 「' + unlisted.join('」·「')
    + '」 입니다」가 두 가지를 뜻하게 됩니다');
  /* ★ 표만 적어 두고 실제로는 안 겹치는 상태가 되면 이 검사는 아무것도 안 잰다 */
  assert.ok(collide.length >= 3,
    '겹침이 3건 미만입니다 — 검사가 재는 대상이 사라졌는지 A-1 을 확인하십시오');
});

/* ── C·D. 원문은 한 곳에 ───────────────────────────────────────── */

test('C. CLAUDE.md 가 이 지침서를 가리킨다 (못 찾으면 없는 규칙이다)', () => {
  const md = read(path.join(ROOT, 'CLAUDE.md'));
  assert.ok(md.includes('운영지침-배포전-교차검증-및-API관리.md'),
    'CLAUDE.md 가 이 지침서를 안 가리킵니다 — 찾을 길이 없으면 없는 규칙입니다');
});

test('D. 지침서 표가 CLAUDE.md 로 통째로 옮겨지지 않았다 (두 벌이면 한쪽이 옛말을 한다)', () => {
  const md = read(path.join(ROOT, 'CLAUDE.md'));
  const roles = chartRoles(read(GUIDE));
  const copied = roles.filter((r) => md.includes(r));
  assert.ok(copied.length < roles.length,
    '조직도가 CLAUDE.md 에 통째로 옮겨졌습니다 — 원문은 지침서 한 곳에 둡니다 (§8-1)');
});
