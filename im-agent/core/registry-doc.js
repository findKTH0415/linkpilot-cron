'use strict';
/**
 * registry-doc.js — **등록부가 어디에 있는지 아는 한 곳.**
 *
 * ★★★ **왜 만들었나** 〈2026-08-26 · D-134〉.
 *
 *   `docs/미결정-사항.md` 하나에 **열린 항목**과 **닫힌 결정 표**가 같이 있었다.
 *   그래서 결정 하나를 적을 때마다 **열려 있는 다른 작업선과 같은 파일을 고쳤다** —
 *   오늘 실측에서 `claude/platform-manager-t22` 와 이 갈래가 그 파일 하나로
 *   겹쳤고, 교차검증 여덟째 칸이 노랑으로 끝났다.
 *
 *   표를 `docs/결정-기록.md` 로 뗐다. 그런데 **읽는 곳이 여럿이다** —
 *   검사 둘 · 대시보드 · 병합 절차서. 각자 경로를 적으면 **다음에 옮길 때
 *   한 곳이 빠지고, 그 한 곳은 조용히 옛 파일을 읽는다.** 그때 검사는
 *   초록으로 남는다(읽긴 읽었으니까) — 가장 안 잡히는 꼴이다.
 *
 * ★ 그래서 **경로도 세는 법도 여기 한 곳에만 둔다.**
 *
 * ★★ **세는 규칙은 바꾸지 않았다.** 앞 판(`flow.test.js`)이 세던 것과 같다 —
 *   미결정 = `### ` 머리말 중 `✅` 로 시작하지 않는 것,
 *   결정   = 표의 `| D-nn |` 줄 수(머리말이 아니다).
 *   여기서 규칙까지 바꾸면 「옮겨서 틀린 것」과 「세는 법이 틀린 것」이 섞인다.
 */

const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', '..', 'docs');

/** 열린 항목과 결정 **본문**이 있는 곳 */
const REGISTRY = path.join(DOCS, '미결정-사항.md');
/** 결정을 **표로** 적는 곳 (날짜·결정자·커밋) */
const DECISIONS = path.join(DOCS, '결정-기록.md');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

/**
 * 등록부의 항목 머리말들.
 *
 * ★ 이모지를 문자 집합(`[🔴🟠]`)으로 쓰지 않는다. `u` 플래그 없이는 서로게이트
 *   반쪽들의 집합이 되어 엉뚱하게 맞고, 일부 이모지 뒤에는 이형자 선택자
 *   (U+FE0F)가 붙어 뒤 공백 매칭이 어긋난다 — 그래서 표식을 통째로 잡는다.
 *
 * @returns {{mark:string, id:string, title:string, decided:boolean}[]}
 */
function items(text) {
  const src = text === undefined ? read(REGISTRY) : text;
  return [...src.matchAll(/^### (\S+)\s+(D-\d+)\.(.*)$/gmu)].map((m) => ({
    mark: m[1],
    id: m[2],
    title: m[3].trim(),
    decided: m[1].indexOf('✅') === 0,
  }));
}

/**
 * 결정 표의 줄들.
 *
 * ★ **본문 어디에나 있는 `| D-nn |` 을 세지 않는다.** 등록부 본문에는 두 작업선의
 *   번호를 견주는 **대조표**가 있어서, 문서 전체에서 세면 그 줄까지 결정으로
 *   세어진다 — 앞 판에서 실제로 헛울음이 났다. 표 파일만 본다.
 */
function decided(text) {
  const src = text === undefined ? read(DECISIONS) : text;
  return [...src.matchAll(/^\| (D-\d+) \|/gm)].map((m) => m[1]);
}

/** 머리에 적힌 건수 (손으로 적은 값) */
function statedCounts(text) {
  const src = text === undefined ? read(REGISTRY) : text;
  const m = src.match(/미결정 \*\*(\d+)건\*\* · 범위 외 (\d+)건 · 결정 (\d+)건/);
  return m ? { open: Number(m[1]), outOfScope: Number(m[2]), decided: Number(m[3]) } : null;
}

/** 실제로 센 건수 */
function actualCounts() {
  return {
    open: items().filter((i) => !i.decided).length,
    decided: decided().length,
  };
}

module.exports = { REGISTRY, DECISIONS, read, items, decided, statedCounts, actualCounts };

if (require.main === module) {
  const a = actualCounts();
  const s = statedCounts();
  const same = s && s.open === a.open && s.decided === a.decided;
  process.stdout.write(
    `\n  센 값   미결정 ${a.open}건 · 결정 ${a.decided}건\n`
    + `  적힌 값 ${s ? `미결정 ${s.open}건 · 결정 ${s.decided}건` : '(머리에 건수 줄이 없다)'}\n`
    + `  ${same ? '●' : '✕'} ${same ? '같다' : '다르다 — 머리의 건수를 고친다'}\n\n`);
  process.exit(same ? 0 : 1);
}
