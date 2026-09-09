'use strict';
/**
 * platformspec.js — 화면 작업지시서의 **기록 모양과 착수 판정**.
 *
 * 플랫폼 자동완성 지침 §5 마지막 줄이 이렇게 정한다:
 *
 *   「입력값 · 완료조건 · 제외범위가 없으면 구현을 시작하지 않고
 *     `NEEDS_INPUT` 으로 보고한다」
 *
 * ★★ **그 판정을 세우려면 볼 칸이 있어야 한다.** 등록부 D-122 가 실측한 것이
 *   이것이다 — 두 저장소에 `scope_in` · `acceptance_criteria` 가 0건이라
 *   지침이 시키는 판정 자체가 서지 않았다. 이 파일이 그 칸을 만든다.
 *
 * ─────────────────────────────────────────────────────────────
 * ★ **게이트는 셋이다** 〈2026-08-26 · D-122 결정 · 사장님 「권고안대로」〉
 *
 * `scope_in` · `scope_out` · `acceptance_criteria`. 20개를 한 번에 넣으면
 * 채우는 일이 커져 **빈 칸으로 남고, 빈 칸이 많으면 아무도 안 본다.**
 *
 * ★★ `input_data`(입력값)은 **적을 자리는 두되 막지는 않는다.**
 *   지침 §5 마지막 줄이 세는 것은 「입력값·완료조건·제외범위」이고, §5 의 표는
 *   그 「입력값」에 **`input_data` 라는 이름을 붙여** `scope_in` 과 **따로** 두었다.
 *   결정된 셋은 그 자리에 `scope_in` 을 놓았는데 둘은 다른 칸이다 —
 *   `scope_in`(무엇을 만드나) 대 `input_data`(무엇을 받고 시작하나).
 *   **T23 에서 손을 묶는 것은 뒤쪽이다**: 「어느 API 가 무엇을 주는가·
 *   프로젝트 DB 가 어디인가」는 `scope_in` 에 안 들어간다.
 *
 *   그래도 **내가 게이트를 넷으로 늘리지 않는다.** D-122 는 이미 결정됐고,
 *   결정을 말없이 넓히는 것이 이 저장소가 D-77·D-101 에서 겪은 모양이다.
 *   대신 칸을 만들어 두고 **막을지 말지는 D-133 에 올렸다** (CLAUDE.md §9).
 *
 * ─────────────────────────────────────────────────────────────
 * ★★★ **`null` 과 `[]` 를 가른다. 이 파일에서 가장 중요한 규칙이다.**
 *
 *   `null` = 아직 안 정했다  → NEEDS_INPUT
 *   `[]`   = 정말 없다(의도) → 통과
 *
 * 가르지 않으면 게이트가 「안 적었다」와 「없다」를 구분 못 한다. 그러면
 * 칸을 20개로 늘리든 4개로 줄이든 **판정이 안 선다** — 빈 칸이 전부 통과하거나
 * 전부 막히거나 둘 중 하나가 되고, 어느 쪽이든 사람이 곧 게이트를 꺼 버린다.
 *
 * 이 저장소가 이미 쓰는 방식이다 — `ui/platform/membership.html` 의
 * `limit: null` 에 「한도는 확정된 것이 없다」고 적혀 있다.
 *
 * ─────────────────────────────────────────────────────────────
 * ★ **완료조건마다 `shows` 를 단다** (어디를 보면 확인되는가).
 *   CLAUDE.md §8 이 요구하는 것과 같은 칸이고 `ui/platform/changes.js` 가
 *   이미 그 이름을 쓴다 — **새 이름을 만들지 않는다.** 두 벌이 되면
 *   화면 쪽 `shows` 와 지시서 쪽 「확인방법」이 서로 다른 말을 하는 날이 온다.
 *
 * ★ **지어내지 않는다** (§4.6 · §9). 빈 칸을 그럴듯한 기본값으로 메우지 않는다.
 *   메우면 지시서에는 「적용됨」만 남고 무엇이 빠졌는지 사라진다 (§4.9).
 *
 * 전부 결정적 판정이다. LLM 미사용. 의존성 없음.
 */

const SCHEMA = 'platform-spec/1';

/**
 * **착수를 막는 칸 — 셋** (D-122 결정).
 *
 * ★ 여기만 고치면 게이트가 바뀐다. 판정 로직은 이 배열을 읽으므로
 *   칸이 늘거나 줄어도 `judge()` 를 다시 쓸 일이 없다.
 */
const REQUIRED_FIELDS = ['scope_in', 'scope_out', 'acceptance_criteria'];

/**
 * **적어 두되 막지는 않는 칸** — 지금은 `input_data` 하나다 (D-133 에 올림).
 *
 * ★ 비어 있으면 **말은 한다** (YELLOW). 조용히 넘어가면 T23 이 시작한 뒤에야
 *   「어느 API 를 부르라는 거였지」가 나온다 — 그때는 이미 만들고 있다.
 */
const ADVISORY_FIELDS = ['input_data'];

/** 사람이 읽는 칸 이름 — 판정 사유 문장에 그대로 나간다 */
const FIELD_LABEL = {
  input_data: '입력값 (무엇을 받고 시작하나 — API 경로·DB·손댈 기존 파일)',   // 막지 않는다 (D-133)
  scope_in: '범위 (무엇을 만드나)',
  scope_out: '제외범위 (무엇을 안 만드나)',
  acceptance_criteria: '완료조건 (무엇이 되면 끝인가)',
};

/**
 * **비어 있어도 되는 칸** — `[]` 가 정당한 답인 곳.
 *
 * ★ `scope_in` 이 여기 없는 이유: 만들 것이 없는 작업지시서는 지시서가 아니다.
 * ★ `acceptance_criteria` 가 여기 없는 이유: 지침 §5 가 완료조건 없이
 *   시작하지 말라고 한 그 칸이다. 비면 끝을 아무도 모른다.
 */
const MAY_BE_EMPTY = new Set(['scope_out']);

/** 빈 지시서 — 모든 칸이 `null` 이다. 채우는 것은 사람 또는 상위 Task 다. */
function blank(taskId = null) {
  return {
    schema: SCHEMA,
    task_id: taskId,
    /** 어느 지침의 몇 절을 근거로 썼는가. 모르면 null 이다 — 지어내지 않는다 (§4.7) */
    spec_doc: null,
    input_data: null,
    scope_in: null,
    scope_out: null,
    acceptance_criteria: null,
  };
}

/** 배열이 아닌 것을 배열로 착각하지 않는다 — 문자열도 `length` 를 갖는다 */
function isList(v) {
  return Array.isArray(v);
}

/**
 * 완료조건 한 줄이 온전한가.
 *
 * @returns {string|null} 모자란 이유, 온전하면 null
 */
function criterionProblem(c, i) {
  const at = `완료조건 ${i + 1}번`;
  if (!c || typeof c !== 'object') return `${at} 이 객체가 아니다`;
  if (!c.must || !String(c.must).trim()) return `${at} 에 무엇이 되어야 하는지(must)가 없다`;
  // ★ 여기가 §8 이 걸리는 자리다 — 확인할 방법이 없는 완료조건은 완료조건이 아니다
  if (!c.shows || !String(c.shows).trim()) {
    return `${at} 에 shows 가 없다 — 어디를 보면 확인되는지 적지 않으면 「됐다」를 확인할 방법이 없다`;
  }
  return null;
}

/**
 * 착수해도 되는가 — 지침 §5 마지막 줄의 판정.
 *
 * ★ **여기서 값을 채우지 않는다.** 판정만 한다. 모자란 것을 메우기 시작하면
 *   그 순간 「누가 정했는지 모르는 값」이 지시서에 들어간다 (§4.9).
 *
 * @param {object} spec
 * @returns {{status:'READY'|'NEEDS_INPUT', missing:string[], reasons:string[]}}
 */
function judge(spec) {
  const missing = [];
  const reasons = [];

  if (!spec || typeof spec !== 'object') {
    return { status: 'NEEDS_INPUT', missing: REQUIRED_FIELDS.slice(), reasons: ['작업지시서가 없다'] };
  }

  for (const f of REQUIRED_FIELDS) {
    const v = spec[f];

    // ★ null = 안 정했다. 이 갈래가 이 파일의 존재 이유다.
    if (v === null || v === undefined) {
      missing.push(f);
      reasons.push(`${FIELD_LABEL[f]} 이(가) 정해지지 않았다 (null)`);
      continue;
    }

    if (!isList(v)) {
      missing.push(f);
      reasons.push(`${FIELD_LABEL[f]} 이(가) 목록이 아니다`);
      continue;
    }

    // ★ [] = 정말 없다. 비어도 되는 칸이면 여기서 통과한다.
    if (v.length === 0 && !MAY_BE_EMPTY.has(f)) {
      missing.push(f);
      reasons.push(
        f === 'scope_in'
          ? '범위가 비어 있다 — 만들 것이 없는 작업지시서는 지시서가 아니다'
          : `${FIELD_LABEL[f]} 이(가) 비어 있다`,
      );
      continue;
    }

    if (f === 'acceptance_criteria') {
      for (let i = 0; i < v.length; i += 1) {
        const p = criterionProblem(v[i], i);
        if (p) {
          if (!missing.includes(f)) missing.push(f);
          reasons.push(p);
        }
      }
    }
  }

  // ★ 막지는 않지만 **말은 한다.** 비어 있는 채로 T23 이 시작하면 그때 막힌다.
  const advisory = [];
  for (const f of ADVISORY_FIELDS) {
    const v = spec[f];
    if (v === null || v === undefined) advisory.push(`${FIELD_LABEL[f]} 이(가) 비어 있다 — 막지는 않으나 구현할 때 다시 물어야 한다`);
  }

  return { status: missing.length ? 'NEEDS_INPUT' : 'READY', missing, reasons, advisory };
}

/**
 * 들어온 값을 지시서 모양으로 옮긴다.
 *
 * ★ **없는 칸은 `null` 로 남긴다.** `[]` 로 바꾸지 않는다 — 그 순간
 *   「안 정했다」가 「정말 없다」로 바뀌어 게이트를 그냥 통과한다.
 *   이것이 이 파일에서 가장 쉽게 나는 사고다.
 */
function normalize(raw, taskId = null) {
  const out = blank(taskId);
  if (!raw || typeof raw !== 'object') return out;

  if (raw.task_id) out.task_id = raw.task_id;
  if (raw.spec_doc) out.spec_doc = raw.spec_doc;

  for (const f of [...REQUIRED_FIELDS, ...ADVISORY_FIELDS]) {
    if (isList(raw[f])) out[f] = raw[f].slice();
    // 배열이 아니면 건드리지 않는다 — blank() 의 null 이 그대로 남는다
  }
  return out;
}

module.exports = {
  SCHEMA, REQUIRED_FIELDS, ADVISORY_FIELDS, FIELD_LABEL, MAY_BE_EMPTY,
  blank, judge, normalize, criterionProblem,
};
