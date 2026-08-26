'use strict';
/**
 * request.js — **요청 한 건**을 가리키는 이름 (`request_id`).
 *
 * ★★★ **왜 만들었나** 〈2026-08-26 · 인수인계 완료검증 감사 H-3〉.
 *
 *   지침 §2-C 가 공통 식별자 열을 요구하고, §11-1 이 「Agent·DB·Platform 의
 *   값과 식별자가 일치해야 한다」를 완료의 **첫 조건**으로 삼는다.
 *   그런데 코드에서 세어 보니 —
 *
 *     project_id  82개 파일     status  114개 파일
 *     **request_id  0개**
 *
 *   **유저가 보고서를 요청한 한 건**을 가리키는 이름이 없었다.
 *   그래서 **같은 프로젝트를 두 번 요청하면 둘을 갈라 볼 수 없었다** —
 *   run-log 는 이어 붙기만 하고, 어디까지가 첫 번째 요청이었는지 모른다.
 *
 * ★★ **프로젝트와 요청은 다른 것이다.** 프로젝트는 「이 딜」이고,
 *   요청은 「이 딜의 보고서를 만들어 달라고 한 그 한 번」이다.
 *   사양을 고쳐 다시 돌리면 **같은 프로젝트의 두 번째 요청**이다.
 *   둘을 한 이름으로 부르면 「언제 것인지」가 사라진다.
 *
 * ★ **번호는 세어서 만든다 — 무작위도, 시각도 쓰지 않는다.**
 *   `Math.random()` 은 같은 입력이 다른 결과를 내고, 시각은 자정에 걸친다.
 *   이 저장소가 여러 번 당한 자리다. **있는 것을 세면 늘 같은 답이 나온다.**
 *
 * ★ 시각은 `core/kst.js` 한 곳에서만 만든다 (CLAUDE.md §5 — 타임존 명시).
 */

const store = require('./store');
const { kstStamp } = require('./kst');

/** 요청 장부 — 이어 붙이기만 한다. 지우지 않는다 */
const PATH = '01_Project/requests.jsonl';

/** `REQ-LP-DC-2026-006-001` 꼴 */
function format(projectId, seq) {
  return `REQ-${projectId}-${String(seq).padStart(3, '0')}`;
}

/**
 * 그 프로젝트의 요청 전부 (오래된 것부터).
 *
 * ★ 깨진 줄은 **버리되 세지는 않는다.** 세면 다음 번호가 어긋나고,
 *   그러면 두 요청이 같은 이름을 갖는다.
 */
function list(projectId) {
  return String(readRaw(projectId) || '').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
}

function readRaw(projectId) {
  const fs = require('fs');
  const path = require('path');
  const full = path.join(store.projectDir(projectId), PATH);
  try { return fs.readFileSync(full, 'utf8'); } catch (_) { return ''; }
}

/** 연 줄만 (닫는 줄은 뺀다) — **번호를 세는 것은 이것이다** */
function opened(projectId) {
  return list(projectId).filter((r) => !r.closing);
}

/**
 * 지금 도는 요청 (마지막으로 **연** 것). 없으면 null.
 *
 * ★ **닫는 줄을 여기 섞지 않는다.** 처음에 「마지막 줄」로 만들었더니
 *   요청을 닫자마자 `current()` 가 **닫는 줄**을 돌려줬다.
 */
function current(projectId) {
  const all = opened(projectId);
  return all.length ? all[all.length - 1] : null;
}

function get(projectId, requestId) {
  return list(projectId).find((r) => r.requestId === requestId) || null;
}

/**
 * 요청을 하나 연다.
 *
 * ★★ **여는 것과 프로젝트를 만드는 것은 다르다.** 프로젝트는 한 번 만들고,
 *   요청은 돌릴 때마다 열린다. 그래서 여기서 폴더를 만들지 않는다.
 *
 * @param {string} by      누가 요청했는가 (사람 또는 'agent')
 * @param {string} docType 무엇을 달라고 했는가 (im · teaser …)
 * @param {string} note    왜 다시 돌리는가 — 두 번째 요청에서 이것만 남는다
 */
function open(projectId, { by = null, docType = null, note = '' } = {}) {
  /* ★★★ **연 것만 센다.** 처음에 `list()` 로 세었더니 닫는 줄까지 세어져
   *   두 번째 요청이 `-002` 가 아니라 `-003` 이 되었다(실측). 번호가 한 칸씩
   *   밀리면 「몇 번째 요청인가」가 거짓이 되고, **그 거짓은 값도 형식도
   *   멀쩡해서 문서만 봐서는 안 잡힌다.** */
  const seq = opened(projectId).length + 1;
  const entry = {
    requestId: format(projectId, seq),
    projectId,
    seq,
    by,
    docType,
    note,
    at: kstStamp(),
    status: 'running',
  };
  appendLine(projectId, entry);
  return entry;
}

/**
 * 요청을 닫는다.
 *
 * ★ **덮어쓰지 않고 한 줄 더 붙인다.** 장부는 이어 붙이기만 해야 한다 —
 *   덮으면 「무엇이 있었는지」가 사라지고, 그러면 두 번째 요청에서
 *   첫 번째가 어떻게 끝났는지 알 수 없다.
 */
function close(projectId, requestId, { status = 'done', note = '' } = {}) {
  const entry = { requestId, projectId, at: kstStamp(), status, note, closing: true };
  appendLine(projectId, entry);
  return entry;
}

function appendLine(projectId, entry) {
  const fs = require('fs');
  const path = require('path');
  const full = path.join(store.projectDir(projectId), PATH);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.appendFileSync(full, `${JSON.stringify(entry)}\n`, 'utf8');
}

/**
 * 요청별로 묶어서 본다 — **이것이 이 모듈을 만든 이유다.**
 * 같은 프로젝트를 두 번 요청했을 때 둘을 갈라 보여 준다.
 */
function summary(projectId) {
  const rows = list(projectId);
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.requestId)) byId.set(r.requestId, { requestId: r.requestId, opened: null, closed: null });
    const g = byId.get(r.requestId);
    if (r.closing) g.closed = r;
    else g.opened = r;
  }
  return [...byId.values()].map((g) => ({
    requestId: g.requestId,
    seq: g.opened ? g.opened.seq : null,
    by: g.opened ? g.opened.by : null,
    docType: g.opened ? g.opened.docType : null,
    at: g.opened ? g.opened.at : null,
    status: g.closed ? g.closed.status : (g.opened ? 'running' : 'unknown'),
    closedAt: g.closed ? g.closed.at : null,
  }));
}

module.exports = { PATH, format, list, opened, current, get, open, close, summary };
