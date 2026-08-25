'use strict';
/**
 * router.js — 능력(Capability) 기준 배정기.
 *
 * ★ 이 파일의 존재 이유 한 줄
 *   **Agent 가 스스로 도구를 고르지 않게 한다.**
 *
 *   Agent 에게 "필요하면 알아서 불러 써라"를 주면, 같은 질문에 어떤 날은 DART 를
 *   부르고 어떤 날은 웹을 뒤진다. 결과가 달라지는데 **문서만 봐서는 어느 쪽으로
 *   나왔는지 알 수 없다.** 그래서 오케스트레이터가 Task 마다 **쓸 수 있는 도구를
 *   지정해서 내려보낸다.** Agent 는 그 목록 밖으로 나가지 않는다.
 *
 * ★ 두 번째 이유 — 키가 없으면 **미리** 안다.
 *   실행 한참 뒤에 401 로 죽는 대신, 배정하는 자리에서 「이 능력은 키가 없어
 *   못 쓴다」를 말한다. 그래야 Task 가 PLANNED 로 정직하게 남는다 (CLAUDE.md §4.6).
 *
 * ★ 지어내지 않는다
 *   구현되지 않은 Agent 는 여기서 `null` 을 돌려준다. 비슷한 Agent 로 대신
 *   태우지 않는다 — 대체로 메우면 문서에는 「했음」만 남는다 (CLAUDE.md §4.9).
 */

const registry = require('./registry');

/**
 * 커넥터가 요구하는 환경변수. **실측해서 적었다** (`grep process.env connectors/*.js`).
 * 베껴 적은 값이 아니라, 커넥터가 실제로 읽는 이름이다.
 */
const CONNECTOR_KEYS = {
  vworld: ['VWORLD_KEY', 'VWORLD_DOMAIN'],
  nsdi: ['VWORLD_KEY'],
  molit: ['DATA_GO_KR_KEY'],
  kpx: ['DATA_GO_KR_KEY'],
  fsc: ['DATA_GO_KR_KEY'],
  g2b: ['DATA_GO_KR_KEY'],
  factory: ['DATA_GO_KR_KEY'],
  enviro: ['DATA_GO_KR_KEY'],
  customs: ['DATA_GO_KR_KEY'],
  nts: ['DATA_GO_KR_KEY'],
  nps: ['DATA_GO_KR_KEY'],
  kepco: ['KEPCO_BIGDATA_KEY'],
  kma: ['KMA_APIHUB_KEY'],
  reb: ['REB_API_KEY'],
  ecos: ['ECOS_API_KEY'],
  kosis: ['KOSIS_API_KEY'],
  dart: ['DART_API_KEY'],
  rhino: ['RHINO_COMPUTE_URL', 'RHINO_COMPUTE_KEY'],
  pexels: ['PEXELS_API_KEY'],
};

/**
 * 능력 사전.
 *
 *   agents      이 능력을 수행할 수 있는 Agent 후보 — **앞에서부터** 고른다
 *   tools       그 Task 에서 부를 수 있는 커넥터 (순서 = fallback 순서)
 *   optional    없어도 Task 는 돈다 (그 절만 빈다)
 *   note        사람이 읽을 설명
 *
 * ★ tools 순서가 곧 fallback 순서다. 앞의 것이 키가 없거나 죽으면 다음으로 간다.
 *   **다만 「다른 기관의 값으로 대신 채우는」 fallback 은 두지 않는다** —
 *   같은 값을 주는 경로들 사이에서만 넘어간다 (CLAUDE.md §4.9).
 */
const CAPABILITIES = {
  OUTPUT_SPEC: {
    label: '출력사양 확정', agents: ['10_output_spec'], tools: [],
    note: '페이지·형식·언어를 사람이 LOCK 한다. 콘텐츠보다 먼저다',
  },
  PROJECT_SETUP: {
    label: '프로젝트 개설', agents: ['01_project'], tools: [],
    note: 'Project ID 부여 + 13개 표준 폴더 생성',
  },
  DOCUMENT_EXTRACTION: {
    label: '자료 추출', agents: ['02_extraction'], tools: [],
    note: '원본자료 → Fact. 문서에 그대로 적힌 값만 뽑는다',
  },
  GEO_CADASTRE: {
    label: '입지·지적·공부', agents: ['07_geo'],
    tools: ['vworld', 'nsdi', 'molit'], optional: ['reb'],
    note: '지오코딩 → PNU → 지적·용도지역·건축물대장. 나머지 계산의 입력이다',
  },
  MARKET_RESEARCH: {
    label: '시장조사', agents: ['03_research'], tools: [], optional: ['kosis', 'ecos'],
    note: '산출물 전량 미검증 — 재무모델에 투입하지 않는다',
  },
  FINANCIAL_MODEL: {
    label: '재무모델', agents: ['04_financial'], tools: [], optional: ['ecos'],
    note: '[계산 전용] 언어모델을 부르지 않는다',
  },
  APPRAISAL: {
    label: '감정평가 3방식', agents: ['08_appraisal'], tools: ['molit'], optional: ['reb'],
    note: '[계산 전용] 법정 감정평가가 아니다 — 참고용 Valuation',
  },
  MASSING: {
    label: '매스·용적률 검토', agents: ['09_massing'], tools: [], optional: ['rhino'],
    note: '[계산 전용] 설계안이 아니라 법적 성립 여부 확인이다',
  },
  CROSS_VALIDATION: {
    label: '교차검증', agents: ['05_validation'], tools: [],
    note: '[규칙 전용] RED/YELLOW/GREEN + QC Score',
  },
  IM_WRITING: {
    label: 'IM·티저 작성', agents: ['06_im_writer'], tools: [],
    note: '본문에 숫자를 직접 쓰지 않는다 — {{key}} 자리표시자만',
  },
  INDEPENDENT_VALIDATION: {
    label: '독립 최종검증', agents: ['11_final_validation'], tools: [],
    note: '[규칙 전용] 8 GATE. 앞 Agent 의 결과를 그대로 믿지 않는다',
  },

  // ── 아래 셋은 **이미 다른 Agent 안에서 돌고 있다.** 실측해서 적었다.
  //   따로 Task 를 만들어 또 부르면 같은 API 를 두 번 부른다 (CLAUDE.md §4.5).
  //   그래서 능력은 사전에 남기되 `handledBy` 로 「어디서 도는지」를 가리킨다 —
  //   지우면 「그 조회는 원래 안 한다」로 굳는다.
  CORPORATE_FINANCIALS: {
    label: '법인 재무·신용', agents: [], tools: ['dart'], optional: ['nts', 'nps'],
    handledBy: 'pipeline.js → core/corpreport.js',
    note: '전담 Agent 는 없다. 파이프라인이 직접 부른다',
  },
  SOLAR_RESOURCE: {
    label: '일사량·일조', agents: [], tools: ['kma'],
    handledBy: 'agents/07-geo.js (templateId=solar 이고 KMA 키가 있을 때)',
    note: '일사량은 내고 **발전량은 내지 않는다** — 시스템효율이 가정이다 (D-25)',
  },
  GRID_CAPACITY: {
    label: '계통 여유용량', agents: [], tools: ['kepco'],
    handledBy: 'agents/03-research.js',
    note: '변전소 좌표가 비식별이라 거리는 사람이 넣는다 (D-54)',
  },

  // ── 아래 둘은 **다른 갈래(SketchUp #9)에서 오는 중이다.**
  //   ★ 왜 미리 적어 두나 — 병합 시연에서 실측했다. 자리를 안 만들어 두면
  //     `12_sketchup_plan`·`13_sketchup_intake` 가 들어오는 순간 **계획에서
  //     영영 안 돈다.** registry 에는 있는데 그것을 가리키는 능력이 없어서다.
  //     지금은 미구현이므로 `PLANNED` 로 서고, 병합되는 날 저절로 살아난다.
  //     (MCP 갈래가 `agentsPending` 으로 같은 일을 해 둔 것과 같은 방식이다)
  SKETCHUP_PLAN: {
    label: '모델 계획 (무엇을 만들 수 있는가)', agents: ['12_sketchup_plan'], tools: [],
    note: 'SketchUp 갈래(PR #9)에서 오는 중 — 병합 전에는 PLANNED',
  },
  SKETCHUP_INTAKE: {
    label: '모델 결과 수령', agents: ['13_sketchup_intake'], tools: [],
    note: 'SketchUp 갈래(PR #9)에서 오는 중 — 병합 전에는 PLANNED',
  },

  // ── 아래는 담당 Agent 가 **아직 없다.** 대체로 태우지 않는다 ──
  LEGAL_PERMIT: {
    label: '인허가·법률 검토', agents: ['12_legal'], tools: [], optional: ['enviro', 'g2b'],
    note: '미구현 (registry.PLANNED phase 2)',
  },
  TECHNICAL_REVIEW: {
    label: '기술 검토', agents: ['13_technical'], tools: [],
    note: '미구현 (registry.PLANNED phase 2)',
  },
  RISK_ANALYSIS: {
    label: 'Risk Analysis', agents: ['14_risk'], tools: [],
    note: '미구현 — 지금은 05_validation 이 RED/YELLOW/GREEN 을 겸한다',
  },
  PRESENTATION: {
    label: 'PPT 생성', agents: ['15_design'], tools: [],
    note: '미구현 (registry.PLANNED phase 2)',
  },
};

/**
 * **다른 갈래에서 오는 중인 Agent** — 아직 이 갈래의 `registry.js` 에 없다.
 *
 * ★ 왜 이름을 적어 두나 — 병합 시연(2026-08-25)에서 실측했다. 자리를 안 만들어
 *   두면 그 Agent 가 들어오는 순간 **계획에서 영영 안 돈다.** registry 에는
 *   있는데 그것을 가리키는 능력이 없어서, 아무도 오류를 안 보고 그냥 안 돈다.
 *
 * ★ **들어오면 검사가 일부러 빨개진다** (`orchestrator.test.js`).
 *   그때 이 표에서 지우면 된다. 안 그러면 「오는 중」이 영원히 남아
 *   **이미 와 있는 것을 아직 안 왔다고 말하는 표**가 된다.
 *   (MCP 갈래가 `mcp/servers.js` 의 `agentsPending` 으로 같은 일을 해 두었다)
 */
const INCOMING = {
  '12_sketchup_plan': 'SketchUp 트랙 (PR #9)',
  '13_sketchup_intake': 'SketchUp 트랙 (PR #9)',
};

/** 환경변수가 실제로 들어 있는가 — 값은 절대 로그에 내지 않는다 (CLAUDE.md §2) */
function hasKey(name) {
  const v = process.env[name];
  return Boolean(v && String(v).trim());
}

/** 이 커넥터를 지금 쓸 수 있는가 */
function toolAvailable(name) {
  const keys = CONNECTOR_KEYS[name];
  if (!keys) return { ok: false, reason: `모르는 커넥터: ${name}` };
  const missing = keys.filter(k => !hasKey(k));
  if (missing.length) return { ok: false, reason: `키 없음: ${missing.join(', ')}`, missing };
  return { ok: true };
}

/**
 * 능력 하나를 배정한다.
 *
 * @returns {{capability, label, agentId, agentLabel, implemented, tools, unavailable, reason}}
 *   agentId       배정된 Agent (없으면 null)
 *   implemented   담당 Agent 가 registry 에 실제로 있고 켜져 있는가
 *   tools         이 Task 가 부를 수 있는 커넥터 — **이 목록 밖은 부르지 않는다**
 *   unavailable   키가 없어 못 쓰는 커넥터와 그 이유
 */
function assign(capability, opts = {}) {
  const cap = CAPABILITIES[capability];
  if (!cap) {
    return {
      capability, label: capability, agentId: null, agentLabel: null,
      implemented: false, tools: [], unavailable: [],
      reason: `사전에 없는 능력: ${capability}`,
    };
  }

  // ① Agent 배정 — 후보를 앞에서부터. registry 에 없거나 꺼져 있으면 다음 후보로
  let agentId = null, agentLabel = null, why = null;
  for (const id of cap.agents) {
    const meta = registry.get(id);
    if (!meta) { why = why || `${id} 미구현`; continue; }
    if (!meta.enabled) { why = why || `${id} OFF`; continue; }
    agentId = id; agentLabel = meta.label; why = null;
    break;
  }
  if (!agentId && cap.agents.length === 0) why = cap.note;

  // ② 도구 배정 — 순서를 지킨다. 못 쓰는 것은 이유와 함께 따로 낸다
  const tools = [];
  const unavailable = [];
  // ★ `assumeTools` — 키가 다 있다고 **치고** 배정한다. 「키만 넣으면 이 계획이
  //   이렇게 돈다」를 보여줄 때 쓴다. 미리보기가 만드는 기계의 키 유무에 따라
  //   달라지면 커밋본과 재생성 결과가 갈린다 (CLAUDE.md §8).
  //   ★ 실행 경로에서는 절대 켜지 않는다 — 켜면 없는 키로 부르고 401 로 죽는다.
  const consider = (name, optional) => {
    const av = opts.assumeTools ? { ok: true } : toolAvailable(name);
    if (av.ok) tools.push({ name, optional: Boolean(optional) });
    else unavailable.push({ name, optional: Boolean(optional), reason: av.reason });
  };
  for (const t of cap.tools || []) consider(t, false);
  for (const t of cap.optional || []) consider(t, true);

  // ③ 필수 도구가 하나도 없으면 그 사실을 말한다 — 실행 뒤 401 로 알게 하지 않는다
  const requiredMissing = unavailable.filter(u => !u.optional);
  const toolsBlocked = (cap.tools || []).length > 0 && tools.filter(t => !t.optional).length === 0;

  return {
    capability, label: cap.label, note: cap.note,
    // ★ 「전담 Agent 는 없지만 어딘가에서 이미 돌고 있다」를 말할 수 있게 한다.
    //   이것이 없으면 미구현과 구분이 안 된다
    handledBy: cap.handledBy || null,
    agentId, agentLabel,
    implemented: Boolean(agentId),
    tools, unavailable, requiredMissing,
    toolsBlocked,
    reason: agentId
      ? (toolsBlocked ? `필요한 자료원을 쓸 수 없다 — ${requiredMissing.map(u => u.reason).join(' / ')}` : null)
      : (why || `${capability}: 담당 Agent 없음`),
  };
}

/** 여러 능력을 한 번에 — 화면·CLI 가 같은 판정을 쓰게 한다 */
function assignAll(capabilities, opts = {}) {
  const out = {};
  for (const c of capabilities) out[c] = assign(c, opts);
  return out;
}

/**
 * 지금 이 기계에서 **쓸 수 있는 커넥터** 목록. 화면의 「MCP Manager」가 읽는다.
 * ★ 키 값은 내지 않는다. 「있다/없다」와 **어떤 이름의 키가 없는지**만 낸다.
 */
function toolStatus() {
  return Object.keys(CONNECTOR_KEYS).sort().map(name => {
    const av = toolAvailable(name);
    return { name, ok: av.ok, requires: CONNECTOR_KEYS[name], missing: av.missing || [] };
  });
}

module.exports = { CAPABILITIES, CONNECTOR_KEYS, INCOMING, assign, assignAll, toolAvailable, toolStatus, hasKey };
