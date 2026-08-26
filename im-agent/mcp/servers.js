'use strict';
/**
 * mcp/servers.js — **MCP 서버 등록부.** 붙어 있는 서버마다 「어느 길에 서는가」를
 * 한 곳에 적는다 (D-83).
 *
 * ★★★ 왜 필요한가. MCP 서버는 **붙이기가 너무 쉽다.** 설정 파일에 네 줄이면
 *   대화창이 그 도구를 부를 수 있게 된다. 그런데 이 시스템의 1순위 원칙은
 *   「출처 없는 숫자는 들어오지 못한다」이고, **도구 결과가 모델을 거치면
 *   출처가 문장 속으로 녹는다.** 붙은 것을 세어 두지 않으면 어느 날
 *   **값 하나가 출처 없이 IM 에 들어가 있고 아무도 모른다.**
 *
 * ★★ 그래서 길을 넷으로 가른다. **길을 안 밝힌 서버는 등록할 수 없다.**
 *
 *   out        LinkPilot 을 내보낸다 — 우리 서버. 값을 만들지 않는다
 *   in.files   **자료(파일)** 를 들여온다. 값은 02_extraction 이 만들고
 *              출처는 파일 이름이 된다 — 원칙이 그대로 산다. **허용**
 *   in.values  **값** 을 바로 준다. 출처가 녹는다 — **값의 길에 못 꽂는다** (D-83)
 *   side       값의 길에 닿지 않는다 (그림·문서·일정·저장소·세션 관리)
 *
 * ★ `in.files` 와 `in.values` 의 차이가 이 파일의 핵심이다. 둘 다 「바깥에서
 *   가져온다」지만 **출처가 남느냐**가 다르다. 파일은 이름·페이지가 남고,
 *   값은 안 남는다.
 *
 * ★ 짝지은 Agent id 는 `core/registry.js` 에서 확인한다 — 베껴 적지 않는다.
 *   (`mcp-servers.test.js` 가 없는 id 를 잡는다)
 *
 * 의존성 0건.
 */

const registry = require('../core/registry');

/** 길 — 넷뿐이다. 여기 없는 값은 등록부에 못 들어간다 */
const LANE = {
  OUT: 'out',
  IN_FILES: 'in.files',
  IN_VALUES: 'in.values',
  SIDE: 'side',
};

/**
 * 등급 — **그 서버가 준 것을 무엇으로 쓰는가.**
 *
 *   value      Dataset 의 값으로 쓴다 (출처가 남는 경우만)
 *   crosscheck 값을 채우지 않고 **어긋나는지만** 본다 (KOSIS 와 같은 등급 · §4.1)
 *   none       값이 아니다 (자료·그림·일정)
 *   blocked    값의 길에 못 쓴다 — 사유와 미결정 번호를 반드시 적는다
 */
const GRADE = { VALUE: 'value', CROSSCHECK: 'crosscheck', NONE: 'none', BLOCKED: 'blocked' };

/** 지금 상태 */
const STATUS = {
  CONNECTED: 'connected',        // 이 세션에 붙어 있다
  AUTH_REQUIRED: 'auth_required',// 붙었는데 사람이 인증해야 쓴다
  CANDIDATE: 'candidate',        // 아직 안 붙였다 — 검토 중
};

/**
 * 등록부. **붙어 있는 것을 전부 적는다** — 「값에 안 쓰니까 안 적어도 된다」가
 * 가장 위험하다. 안 적힌 서버는 다음 사람에게 보이지 않고, 보이지 않는 것은
 * 검토되지 않는다.
 */
const SERVERS = [
  {
    id: 'linkpilot',
    label: 'LinkPilot IM 엔진 (우리 서버)',
    lane: LANE.OUT, grade: GRADE.NONE, status: STATUS.CONNECTED,
    agents: [],
    why: '엔진이 이미 가진 것을 꺼내 준다. 값을 만들지 않으므로 출처가 그대로 따라온다 (D-83).',
    keys: [], adapter: 'im-agent/mcp/server.js',
  },

  /* ── 자료를 들여오는 길 — 값은 추출기가 만든다 ───────────────────────── */
  {
    id: 'Box',
    label: 'Box (문서 보관함)',
    lane: LANE.IN_FILES, grade: GRADE.NONE, status: STATUS.CONNECTED,
    agents: ['02_extraction'],
    why: '사업계획서·감정평가서 같은 **파일**을 가져온다. 값은 02_extraction 이 만들고 '
      + '출처는 그 파일 이름·페이지가 된다 — 원칙이 그대로 산다.',
    keys: [],
    note: '지금은 사람이 내려받아 화면에 올린다. 자동으로 잇는 것은 D-107.',
  },
  {
    id: 'Google_Drive',
    label: 'Google Drive',
    lane: LANE.IN_FILES, grade: GRADE.NONE, status: STATUS.CONNECTED,
    agents: ['02_extraction'],
    why: 'Box 와 같다 — 파일을 가져온다. 값이 아니다.',
    keys: [],
    note: '연결 자료(D-65)는 토큰을 보관하지 않는 「그때그때 고르기」다 (D-72). 그 결정이 그대로 유효하다.',
  },

  /* ── 값의 길에 닿지 않는 것 ────────────────────────────────────────── */
  {
    id: 'Adobe_for_creativity',
    label: 'Adobe (그림·글꼴·문서 렌더)',
    lane: LANE.SIDE, grade: GRADE.NONE, status: STATUS.CONNECTED,
    agents: ['15_design'],
    why: '보이는 것을 만든다. 생성물이므로 fact 로 등록하지 않는다 (D-33·D-38 과 같은 결).',
    keys: [],
  },
  {
    id: 'Trimble_SketchUp',
    label: 'Trimble SketchUp (모델)',
    lane: LANE.SIDE, grade: GRADE.NONE, status: STATUS.CONNECTED,
    // ★ 2026-08-26 병합 — PR #9 가 들고 있던 둘이 도착해서 `agentsPending` 에서
    //   여기로 옮겼다. 검사가 그것을 시켰다 — 안 옮기면 이 줄이 09_massing 만
    //   가리킨 채 남아 **진짜 주인을 가리키지 않는 등록부**가 된다.
    agents: ['09_massing', '12_sketchup_plan', '13_sketchup_intake'],
    why: '매스·모델을 만든다. **생성물은 fact 가 아니다** — 수량을 값으로 쓰려면 '
      + '설계사가 내보낸 IFC 를 `core/ifc.js` 로 읽는다 (D-37).',
    keys: [],
  },
  {
    id: 'Mermaid_Chart',
    label: 'Mermaid (도해)',
    lane: LANE.SIDE, grade: GRADE.NONE, status: STATUS.CONNECTED,
    agents: [],
    why: '도해를 그린다. 그림은 값이 아니다 — 숫자가 필요하면 그린 그림이 아니라 '
      + '그 그림을 만든 Dataset 을 본다.',
    keys: [],
  },
  {
    id: 'Gmail',
    label: 'Gmail',
    lane: LANE.SIDE, grade: GRADE.NONE, status: STATUS.CONNECTED,
    agents: [],
    why: '주고받는 일이지 값이 아니다. **대외 발송은 사람 승인 없이 하지 않는다** '
      + '(registry PLANNED 의 17_distribution 과 같은 규칙).',
    keys: [],
    note: '메일 첨부를 자료로 삼는 길은 안 열려 있다 — 열려면 D-107 과 같은 결정이 필요하다.',
  },
  {
    id: 'Google_Calendar',
    label: 'Google Calendar',
    lane: LANE.SIDE, grade: GRADE.NONE, status: STATUS.CONNECTED,
    agents: [],
    why: '일정이다. 이 저장소의 크론은 빠졌으므로(범위 변경 2026-08-14) 값의 길과 무관하다.',
    keys: [],
  },
  {
    id: 'github',
    label: 'GitHub',
    lane: LANE.SIDE, grade: GRADE.NONE, status: STATUS.CONNECTED,
    agents: [],
    why: '저장소를 다룬다. 딜 값과 무관하다.',
    keys: [],
  },
  {
    id: 'Claude_Code_Remote',
    label: 'Claude Code Remote (세션·예약)',
    lane: LANE.SIDE, grade: GRADE.NONE, status: STATUS.CONNECTED,
    agents: [],
    why: '세션을 띄우고 예약한다. 값의 길과 무관하다.',
    keys: [],
  },

  /* ── 값을 바로 주는 것 — 값의 길에 못 꽂는다 ─────────────────────────── */
  {
    id: 'PlayMCP',
    label: 'PlayMCP (네이버 검색 · 데이터랩 · 카카오)',
    lane: LANE.IN_VALUES, grade: GRADE.BLOCKED, status: STATUS.CONNECTED,
    agents: [],
    why: '검색 결과·쇼핑 지표를 **값으로 주는** 길이다. 검색으로 빈칸을 메우는 것은 '
      + '**아직 정해지지 않았다** — 검색 결과에는 기관·기준시점·모수가 없다.',
    keys: [],
    blockedBy: 'D-70',
    note: '쓰려면 `connectors/` 에 어댑터로 감싸고 대조용 등급으로 시작한다 (D-83 「MCP 만 제공할 때」).',
  },
  {
    id: 'TomTom_Maps',
    label: 'TomTom Maps (지도·경로)',
    lane: LANE.IN_VALUES, grade: GRADE.BLOCKED, status: STATUS.AUTH_REQUIRED,
    agents: ['07_geo'],
    why: '거리·소요시간을 **값으로** 준다. 07_geo 의 VWorld 지오코딩과 겹치는데 '
      + '**둘이 다른 값을 내면 어느 쪽이 맞는지 문서만 봐서는 안 잡힌다** (§4.9).',
    keys: [],
    blockedBy: 'D-109',
    note: '아직 인증이 안 되어 있어 부를 수도 없다. 사람이 claude.ai 커넥터 설정에서 승인해야 한다.',
  },

  /* ── 검토 중 ──────────────────────────────────────────────────────── */
  {
    id: 'financial-datasets',
    label: 'Financial Datasets (상장사 재무·주가)',
    lane: LANE.IN_VALUES, grade: GRADE.BLOCKED, status: STATUS.CANDIDATE,
    agents: ['03_research'],
    why: '상장사 재무제표·주가를 값으로 준다. 파이썬 서버이고 유료 키가 필요하다. '
      + '가장 자연스러운 용도(유사기업 배수법)는 **D-59 에서 이미 안 내기로 정했다.**',
    keys: ['FINANCIAL_DATASETS_API_KEY'],
    blockedBy: 'D-108',
    note: '자기네 REST 를 부르는 껍데기라, 붙인다면 Node 커넥터에서 직접 부르는 쪽이 낫다.',
  },
  {
    id: 'openbb',
    label: 'OpenBB (거시·시장·원자재)',
    lane: LANE.IN_VALUES, grade: GRADE.BLOCKED, status: STATUS.CANDIDATE,
    agents: ['03_research'],
    why: '파이썬이고 **AGPLv3** 다. 라이선스는 기술 판단이 아니라 법무 판단이므로 '
      + '확인 전에는 붙이지 않는다.',
    keys: [],
    blockedBy: 'D-108',
  },
];

/* ─────────────────────────── 검사 ─────────────────────────── */

/**
 * 등록부가 규칙을 지키는가. **위반 목록을 돌려준다 — 던지지 않는다.**
 * 던지면 한 줄 때문에 등록부를 못 읽게 되고, 그때 아무도 전체를 못 본다.
 */
function check() {
  const bad = [];
  const known = new Set(registry.list().map(a => a.id).concat(Object.keys(registry.PLANNED || {})));
  const seen = new Set();

  SERVERS.forEach((s) => {
    const at = `${s.id}`;
    if (seen.has(s.id)) bad.push(`${at}: 같은 id 가 두 번 등록되었다`);
    seen.add(s.id);

    if (!Object.values(LANE).includes(s.lane)) bad.push(`${at}: 길(lane)을 안 밝혔다`);
    if (!Object.values(GRADE).includes(s.grade)) bad.push(`${at}: 등급(grade)을 안 밝혔다`);
    if (!Object.values(STATUS).includes(s.status)) bad.push(`${at}: 상태(status)를 안 밝혔다`);
    if (!s.why || s.why.length < 10) bad.push(`${at}: 왜 그 길인지 안 적었다`);

    // ★★ D-83 의 핵심 — 값을 바로 주는 길은 값으로 못 쓴다
    if (s.lane === LANE.IN_VALUES && s.grade === GRADE.VALUE) {
      bad.push(`${at}: 값을 바로 주는 MCP 를 값으로 쓰려 한다 — D-83 위반`);
    }
    // 막아 둔 것은 **무엇 때문에 막혔는지**를 반드시 적는다. 사유 없는 금지는 다음 사람이 푼다
    if (s.grade === GRADE.BLOCKED && !s.blockedBy) {
      bad.push(`${at}: 막아 뒀는데 미결정 번호가 없다`);
    }
    (s.agents || []).forEach((id) => {
      if (!known.has(id)) bad.push(`${at}: 모르는 Agent id — ${id}`);
    });
    // ★ 「배포 엔진엔 있고 이 갈래엔 없다」고 적어 둔 것이 실제로 들어오면 알린다.
    //   조용히 두면 등록부가 진짜 주인을 안 가리킨 채 남는다
    (s.agentsPending || []).forEach((id) => {
      if (known.has(id)) bad.push(`${at}: ${id} 가 이 갈래에도 들어왔다 — agentsPending 에서 agents 로 옮겨라`);
    });
  });

  return bad;
}

/** 길별로 센다 — 화면·문서가 손으로 세지 않게 */
function byLane() {
  const out = {};
  Object.values(LANE).forEach((l) => { out[l] = SERVERS.filter(s => s.lane === l); });
  return out;
}

/** 사람이 손봐야 하는 것 — 인증 대기·막힌 것 */
function needsHuman() {
  return SERVERS.filter(s => s.status === STATUS.AUTH_REQUIRED || s.grade === GRADE.BLOCKED);
}

/** Agent 하나에 붙은 서버 */
function forAgent(agentId) {
  return SERVERS.filter(s => (s.agents || []).includes(agentId));
}

/**
 * 배포 엔진이 실제로 돌리고 있는 규모 〈2026-08-25 사용자 확인〉.
 *
 * ★ 이 갈래는 **그보다 뒤에 있다** (Agent 11 · 커넥터 21). SketchUp 갈래(PR #9)가
 *   Agent 둘과 커넥터 둘(kict · law)을 들고 있다. MCP 짝을 지을 때 **배포 쪽 수를
 *   기준으로 본다** — 이 갈래 수만 보면 없는 Agent 를 못 챙긴다.
 */
const ENGINE = { agents: 13, connectors: 23, note: '커넥터 수는 cache·http·xml(인프라 3종) 제외' };

module.exports = { SERVERS, LANE, GRADE, STATUS, ENGINE, check, byLane, needsHuman, forAgent };
