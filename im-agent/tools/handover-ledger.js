'use strict';
/**
 * handover-ledger.js — **관리대장이 채워졌는가.**
 *
 *   npm run handover:check          사람이 읽는 표
 *   npm run handover:check -- --json
 *
 * ★★★ **왜 만들었나** 〈2026-08-26 · 인수인계 완료검증 감사〉.
 *
 *   지침 §6 이 한 줄로 못 박았다 —
 *   **「인계자 또는 인수자가 지정되지 않은 항목은 완료로 판정하지 않는다」**.
 *   그리고 필수 통과 게이트 13번이 「미완료 작업의 담당자·목표일 지정」이다.
 *
 *   그런데 **이름은 내가 지어낼 수 없다.** 지어내면 그 순간 이 장부는 거짓이
 *   되고, 거짓 장부는 없는 장부보다 나쁘다 — 채워져 있으니 아무도 안 본다.
 *
 * ★★ 그래서 이 도구가 하는 일은 하나다: **빈 칸을 세어서 보이게 한다.**
 *   채우는 것은 사람이고, **안 채워졌다는 사실을 숨기지 않는 것**이 코드의 몫이다.
 *   (`rights-count.js` 와 같은 결이다 — 판단은 사람이 하고, 근거는 기계가 쌓는다.)
 *
 * ★ **지난 목표일도 센다.** 목표일을 적어 두고 지나가 버리는 것이
 *   안 적은 것보다 조금 낫지만, 아무도 안 보면 결국 같다.
 *   ※ 오늘 날짜는 `LP_TODAY` 로 넣을 수 있다 — 검사가 자정마다 달라지지 않게.
 *
 * 되돌아오는 값: 0 다 채워졌다 · 1 빈 칸이 있다 · 2 못 쟀다
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const LEDGER = path.join(REPO, 'docs', '인수인계-관리대장.md');

/** 안 정해진 것을 적는 말. **여기 한 곳에만 둔다** */
const UNSET = ['미지정', '-', '—', ''];

/** 지침 §5 의 상태·중요도 — 오타를 잡으려고 여기 적는다 */
const STATES = new Set(['NOT_STARTED', 'UNVERIFIED', 'PARTIAL', 'READY_FOR_TEST',
  'TEST_FAILED', 'BLOCKED', 'VERIFIED', 'ACCEPTED']);
const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

/** 끝난 것으로 치는 상태 — 이것들은 빈 칸을 안 센다 */
const DONE = new Set(['ACCEPTED']);

const COLS = ['번호', '영역', '항목', '인계자', '인수자', '증빙',
  '상태', '중요도', '문제점', '후속조치', '완료조건', '목표일'];

function unset(v) {
  return UNSET.includes(String(v == null ? '' : v).trim());
}

/**
 * 대장을 읽는다.
 *
 * ★ **머리글이 있는 표만** 읽는다. 문서에 다른 표가 생겨도 섞이지 않는다 —
 *   앞 판의 등록부 검사가 「본문의 견주는 표」를 결정으로 세다 헛울음이 났다.
 */
function parse(text) {
  const src = text === undefined ? fs.readFileSync(LEDGER, 'utf8') : text;
  const lines = src.split('\n');
  const head = lines.findIndex((l) => COLS.every((c) => l.includes(c)));
  if (head < 0) return null;

  const rows = [];
  for (let i = head + 2; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith('|')) break;              // 표가 끝났다
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < COLS.length) continue;
    const row = {};
    COLS.forEach((c, k) => { row[c] = cells[k]; });
    rows.push(row);
  }
  return rows;
}

/** 오늘 (검사가 자정마다 달라지지 않게 밖에서 넣을 수 있다) */
function today() {
  const t = process.env.LP_TODAY;
  if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return new Date().toISOString().slice(0, 10);
}

function count(rows) {
  const open = rows.filter((r) => !DONE.has(r.상태));
  const noGiver = open.filter((r) => unset(r.인계자));
  const noTaker = open.filter((r) => unset(r.인수자));
  const noDate = open.filter((r) => unset(r.목표일));
  const now = today();
  const overdue = open.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.목표일) && r.목표일 < now);

  const badState = rows.filter((r) => !STATES.has(r.상태));
  const badSev = rows.filter((r) => !SEVERITIES.has(r.중요도));
  const badDate = open.filter((r) => !unset(r.목표일) && !/^\d{4}-\d{2}-\d{2}$/.test(r.목표일));

  const assigned = open.filter((r) => !unset(r.인계자) && !unset(r.인수자) && !unset(r.목표일));

  return {
    total: rows.length,
    open: open.length,
    done: rows.length - open.length,
    assigned: assigned.length,
    noGiver: noGiver.map((r) => r.번호),
    noTaker: noTaker.map((r) => r.번호),
    noDate: noDate.map((r) => r.번호),
    overdue: overdue.map((r) => ({ no: r.번호, at: r.목표일 })),
    badState: badState.map((r) => ({ no: r.번호, v: r.상태 })),
    badSev: badSev.map((r) => ({ no: r.번호, v: r.중요도 })),
    badDate: badDate.map((r) => ({ no: r.번호, v: r.목표일 })),
    high: open.filter((r) => r.중요도 === 'HIGH' || r.중요도 === 'CRITICAL').length,
    ready: assigned.length === open.length && !badState.length && !badSev.length && !badDate.length,
    today: now,
  };
}

/** 교차검증 아래에 한 줄로 적을 말 */
function line(c) {
  if (!c) return '관리대장을 못 읽었다 — 표 머리글이 바뀌었는지 본다';
  if (c.ready) {
    return `관리대장 ${c.open}건 전부 담당자·목표일이 있다`
      + (c.overdue.length ? ` · **목표일이 지난 것 ${c.overdue.length}건**` : '')
      + ' — 필수 게이트 13번이 열린다';
  }
  const bits = [];
  if (c.noGiver.length) bits.push(`인계자 ${c.noGiver.length}건`);
  if (c.noTaker.length) bits.push(`인수자 ${c.noTaker.length}건`);
  if (c.noDate.length) bits.push(`목표일 ${c.noDate.length}건`);
  if (c.badState.length) bits.push(`모르는 상태 ${c.badState.length}건`);
  if (c.badSev.length) bits.push(`모르는 중요도 ${c.badSev.length}건`);
  if (c.badDate.length) bits.push(`날짜 꼴이 아닌 목표일 ${c.badDate.length}건`);
  return `관리대장 ${c.open}건 중 ${c.assigned}건만 지정됨 — 비었다: ${bits.join(' · ')}`
    + ' (지침 §6 — 지정되지 않은 항목은 완료로 판정하지 않는다)';
}

function render(rows, c) {
  const L = ['', '  인수인계 관리대장 (지침 §6)', ''];
  L.push(`  전체 ${c.total}건 · 열림 ${c.open}건 · 끝남 ${c.done}건 · HIGH 이상 ${c.high}건`);
  L.push('');
  const pad = (s, n) => {
    const w = [...String(s)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x1100 ? 2 : 1), 0);
    return String(s) + ' '.repeat(Math.max(0, n - w));
  };
  L.push(`  ${pad('#', 3)} ${pad('항목', 22)} ${pad('중요도', 9)} ${pad('인계자', 8)} ${pad('인수자', 8)} 목표일`);
  L.push(`  ${'─'.repeat(66)}`);
  for (const r of rows) {
    const mark = DONE.has(r.상태) ? '●' : (unset(r.인계자) || unset(r.인수자) || unset(r.목표일) ? '✕' : '·');
    L.push(`  ${pad(r.번호, 3)} ${pad(r.항목, 22)} ${pad(r.중요도, 9)} ${pad(r.인계자, 8)} ${pad(r.인수자, 8)} ${r.목표일} ${mark}`);
  }
  L.push('');
  L.push(`  ${c.ready ? '●' : '✕'} ${line(c)}`);
  if (!c.ready) {
    L.push('');
    L.push('  ★ 이름은 기계가 지어내지 않는다. 지어내면 장부가 거짓이 되고,');
    L.push('    거짓 장부는 없는 장부보다 나쁘다 — 채워져 있으니 아무도 안 본다.');
    L.push(`    ${path.relative(REPO, LEDGER)} 에서 한 줄에 사람 하나씩 적는다.`);
  }
  L.push('');
  return L.join('\n');
}

function main(argv) {
  if (!fs.existsSync(LEDGER)) {
    process.stdout.write(`\n  ? 관리대장이 없다: ${path.relative(REPO, LEDGER)}\n\n`);
    return 2;
  }
  const rows = parse();
  if (!rows) {
    process.stdout.write('\n  ? 관리대장의 표를 못 읽었다 — 머리글이 바뀌었는지 본다\n\n');
    return 2;
  }
  const c = count(rows);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(c, null, 2)}\n`);
    return c.ready ? 0 : 1;
  }
  process.stdout.write(render(rows, c));
  return c.ready ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { LEDGER, COLS, STATES, SEVERITIES, UNSET, unset, parse, count, line, render, today };
