'use strict';
/**
 * design-gate.js — **디자인 게이트 7단계** (지시서 §8.4 · 인수인계 감사 H-4).
 *
 *   DESIGN_BRIEF → WIREFRAME_APPROVED → DESIGN_READY → DEVELOPING
 *   → FUNCTION_VERIFIED → DESIGN_VERIFIED → READY_TO_DEPLOY
 *
 * ★★★ **왜 만들었나** 〈2026-08-26 사장님 지시 · 감사 H-4〉.
 *
 *   지시서 §8.4 가 일곱을 적어 두었는데 **코드에는 `DESIGN_VERIFIED` 하나만**
 *   있었다. 감사에서 재 보니 나머지 여섯은 이 저장소 어디에도 없었다.
 *   그런데 지침은 그 게이트를 **완료 조건**으로 삼는다 — 즉 **완료 판정의
 *   근거가 문서에만 있고 코드에는 없는 상태**였다.
 *
 * ★★ **문서에만 있는 규칙은 규칙이 아니다.** 이 저장소가 여러 번 겪은 결이다
 *   (M-31: 넷을 손으로 챙기다 하루 반에 여섯 번 빠뜨렸다 → `guard` 한 줄로 묶었다).
 *   그래서 게이트를 **글이 아니라 상태기계**로 만든다.
 *
 * ★ **한 칸씩만 간다.** 건너뛰기를 허용하면 그 순간 게이트는 장식이 된다 —
 *   「기능은 됐으니 바로 배포」가 가능해지고, 그것이 §8.4 가 막으려던 바로 그것이다.
 *
 * ★ **뒤로는 갈 수 있다.** 검증에서 떨어지면 `DEVELOPING` 으로 돌아간다.
 *   앞으로만 가는 게이트는 한 번 틀리면 **거짓말을 하며 끝까지 간다.**
 *
 * ★★★ **자동으로 넘길 수 있는 칸과 사람이 넘겨야 하는 칸을 가른다.**
 *   `WIREFRAME_APPROVED` 와 `READY_TO_DEPLOY` 는 **승인**이다 —
 *   기계가 스스로 승인하면 승인이 아니다 (지침 §12 와 같은 뜻).
 *   `15_design` 이 낼 수 있는 것은 `DESIGN_VERIFIED` 까지다.
 *
 * ★ 시각은 `core/kst.js` 한 곳에서만 만든다 (CLAUDE.md §8).
 */

const store = require('./store');
const { kstStamp } = require('./kst');

const PATH = '11_QC/design-gate.json';

/**
 * 일곱 칸. **순서가 곧 규칙이다.**
 *
 * `by`  — 누가 넘기는가: `agent` 는 기계가 판정으로 넘길 수 있고,
 *         `human` 은 사람만 넘긴다 (승인).
 * `needs` — 넘어가려면 무엇이 참이어야 하는가. **말이 아니라 잴 수 있는 것**만 적는다.
 */
const STAGES = [
  {
    id: 'DESIGN_BRIEF',
    label: '디자인 요구 정리',
    by: 'agent',
    needs: '무엇을 만드는지·누가 보는지·어떤 형식인지가 정해졌다 (출력 사양)',
  },
  {
    id: 'WIREFRAME_APPROVED',
    label: '뼈대 승인',
    by: 'human',
    needs: '화면·문서의 뼈대를 **사람이 봤고 승인했다**',
  },
  {
    id: 'DESIGN_READY',
    label: '디자인 확정',
    by: 'agent',
    needs: '테마·토큰이 정해졌다 (design.json 에 선택이 있다)',
  },
  {
    id: 'DEVELOPING',
    label: '만드는 중',
    by: 'agent',
    needs: '산출물을 만들기 시작했다',
  },
  {
    id: 'FUNCTION_VERIFIED',
    label: '기능 검증 통과',
    by: 'agent',
    needs: '값 검증이 통과했다 (05_validation 이 REJECT 가 아니다)',
  },
  {
    id: 'DESIGN_VERIFIED',
    label: '디자인 검증 통과',
    by: 'agent',
    needs: '디자인 검증에 RED 가 없다 (15_design)',
  },
  {
    id: 'READY_TO_DEPLOY',
    label: '배포 준비 완료',
    by: 'human',
    needs: '최종 검증이 막지 않고, **사람이 내보내기로 정했다**',
  },
];

const IDS = STAGES.map((s) => s.id);
const BY_ID = new Map(STAGES.map((s) => [s.id, s]));

/** 아직 아무 칸도 안 지난 상태 */
const START = null;

function indexOf(id) {
  return id === null || id === undefined ? -1 : IDS.indexOf(id);
}

function stage(id) {
  return BY_ID.get(id) || null;
}

/** 지금 칸 다음에 갈 수 있는 칸 (하나뿐이다 — 건너뛰기 없음) */
function next(id) {
  const i = indexOf(id);
  return i + 1 < IDS.length ? IDS[i + 1] : null;
}

/**
 * `from` 에서 `to` 로 갈 수 있는가.
 *
 * ★ 셋만 허용한다 — **한 칸 앞으로** · **뒤로 (되돌리기)** · **제자리**.
 *   그 밖은 전부 막는다. 「기능은 됐으니 바로 배포」가 이 자리에서 막힌다.
 */
function canMove(from, to) {
  const a = indexOf(from);
  const b = indexOf(to);
  if (b < 0) return { ok: false, why: `모르는 칸이다: ${to}` };
  if (b === a) return { ok: true, kind: 'same' };
  if (b === a + 1) return { ok: true, kind: 'forward' };
  if (b < a) return { ok: true, kind: 'back' };
  const skipped = IDS.slice(a + 1, b);
  return {
    ok: false,
    kind: 'skip',
    why: `${skipped.length}칸을 건너뛴다 (${skipped.join(' → ')})`
      + ` — 게이트는 한 칸씩만 간다. 건너뛰기를 허용하면 그 순간 장식이 된다`,
  };
}

/** 기계가 이 칸으로 넘길 수 있는가 (승인 칸은 사람만) */
function canAgentEnter(id) {
  const s = stage(id);
  return !!s && s.by === 'agent';
}

/* ───────────────────────── 프로젝트 상태 ───────────────────────── */

function read(projectId) {
  const d = store.readJson(projectId, PATH, null);
  if (d && typeof d === 'object') return d;
  return { stage: START, at: null, by: null, note: '', history: [] };
}

/**
 * 칸을 옮긴다.
 *
 * ★ **막힌 이동은 조용히 넘기지 않는다.** `{ok:false, why}` 를 돌려주고
 *   상태는 그대로 둔다 — 반쯤 넘어간 상태가 가장 위험하다.
 *
 * @param {string} to      갈 칸
 * @param {string} actor   'agent' 또는 사람 이름
 * @param {string} note    왜 넘겼는지 (되돌아볼 때 이것만 남는다)
 */
function move(projectId, to, { actor = 'agent', note = '' } = {}) {
  const cur = read(projectId);
  const chk = canMove(cur.stage, to);
  if (!chk.ok) return { ok: false, why: chk.why, stage: cur.stage };

  // ★ 승인 칸을 기계가 스스로 넘기지 못한다. 기계가 승인하면 승인이 아니다
  if (actor === 'agent' && chk.kind === 'forward' && !canAgentEnter(to)) {
    return {
      ok: false,
      stage: cur.stage,
      why: `${to} 는 **사람이 넘기는 칸**이다 (${stage(to).needs})`
        + ' — 기계가 스스로 승인하면 그것은 승인이 아니다',
    };
  }

  const at = kstStamp();
  const entry = { from: cur.stage, to, at, by: actor, note };
  const nextState = {
    stage: to,
    at,
    by: actor,
    note,
    history: [...(cur.history || []), entry],
  };
  store.writeJson(projectId, PATH, nextState);
  return { ok: true, stage: to, kind: chk.kind, at };
}

/** 이 프로젝트가 내보내도 되는 상태인가 */
function readyToDeploy(projectId) {
  return read(projectId).stage === 'READY_TO_DEPLOY';
}

/**
 * 사람이 읽는 한 줄.
 *
 * ★ **못 지난 칸을 함께 적는다.** 「3/7」만 적으면 무엇이 남았는지 모른다.
 */
function summarize(state) {
  const s = state || { stage: START };
  const i = indexOf(s.stage);
  if (i < 0) return `게이트 0/${IDS.length} — 아직 시작 안 함 (다음: ${IDS[0]})`;
  const nxt = next(s.stage);
  const who = nxt && stage(nxt).by === 'human' ? ' · **사람이 넘겨야 한다**' : '';
  return `게이트 ${i + 1}/${IDS.length} — ${s.stage}`
    + (nxt ? ` (다음: ${nxt}${who})` : ' · 배포 준비 완료');
}

module.exports = {
  STAGES, IDS, PATH, START,
  stage, indexOf, next, canMove, canAgentEnter,
  read, move, readyToDeploy, summarize,
};
