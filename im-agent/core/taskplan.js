'use strict';
/**
 * taskplan.js — 요청문 한 줄을 Task 그래프로 쪼갠다.
 *
 *   "남해 육상풍력 사전 투자검토를 시작해줘"
 *        ↓
 *   T01 출력사양 … T16 PPT — 의존관계까지 붙은 그래프
 *
 * ★ 합격선을 여기서 정하지 않는다
 *   Agent 별 신뢰도 임계는 `core/registry.js` 의 `confidenceThreshold` 가 이미
 *   갖고 있다. 여기에 숫자를 또 적었다가 **04_financial(신뢰도 0.76, 정상 완료)이
 *   「요구 90점 미달」로 막혔다.** 근거 없는 숫자는 계획에 넣지 않는다 (§9).
 *
 * ★ 지어내지 않는다 — 이 파일의 첫 번째 규칙
 *   담당 Agent 가 저장소에 **실제로 있는 것만** 돌린다. 없는 것은 지우지 않고
 *   `PLANNED` 로 남기고 **왜 못 도는지**를 적는다. 빼 버리면 계획이 그럴듯해지고
 *   「그 검토는 원래 안 하는 것」으로 굳는다 — 이 저장소가 D-20 에서 겪은 일이다.
 *
 * ★ 순서를 사람이 정하지 않는다
 *   각 Task 는 **자기 선행만** 안다. 「무엇을 동시에 돌릴까」는 tasks.readySet()
 *   이 매번 계산한다. 그래서 하나가 실패해도 나머지 갈래는 계속 간다.
 *
 * ★ 왜 이 의존인가 (master-orchestrator.md 의 고정 순서와 같은 근거)
 *   GEO 가 재무·감정·매스보다 먼저인 이유는 거기서 나온 PNU·좌표가 셋의 입력이라서고,
 *   감정평가가 재무 뒤인 이유는 수익환원법에 안정화 NOI 가 필요해서다.
 *   시장조사는 **아무것도 안 기다린다** — 추출과 무관하므로 처음부터 같이 돈다.
 */

const tasks = require('./tasks');
const router = require('./router');
const assetclass = require('./assetclass');
const registry = require('./registry');

/**
 * 표준 사전 투자검토 계획.
 *
 * capability   router 가 이것으로 Agent·도구를 고른다 (Task 는 Agent 이름을 모른다)
 * outputs      이 Task 가 남겨야 할 산출물 (Artifact Registry 등록 대상)
 * assetOnly    이 자산군 계열에서만 만든다 (없으면 항상)
 * humanInput   사람이 값을 넣어야 진행되는 Task
 */
const PLAN = [
  {
    id: 'T01', name: '출력사양 확정', priority: 10,
    description: '페이지 수·크기·형식·언어를 확정한다. 콘텐츠보다 먼저다 — 확정 전에는 전부 DRAFT',
    capability: 'OUTPUT_SPEC', dependsOn: [], humanInput: true,
    outputs: ['01_Project/output-spec.json'],
  },
  {
    id: 'T02', name: '프로젝트 개설', priority: 5,
    description: 'Project ID 부여 + 13개 표준 폴더 생성',
    capability: 'PROJECT_SETUP', dependsOn: [],
    outputs: ['01_Project/project.json'],
  },
  {
    id: 'T03', name: '자료 추출', priority: 20,
    description: '업로드된 원본자료에서 Fact 를 뽑는다. 문서에 그대로 적힌 값만',
    capability: 'DOCUMENT_EXTRACTION', dependsOn: ['T02'],
    outputs: ['01_Project/extraction.json', '01_Project/dataset.json'],
  },
  {
    id: 'T04', name: '입지·지적·공부 조회', priority: 30,
    description: '주소 → 좌표 → PNU → 지적·용도지역·공시지가·건축물대장',
    capability: 'GEO_CADASTRE', dependsOn: ['T03'],
    outputs: ['04_Property/geo.json'],
  },
  {
    id: 'T05', name: '시장조사', priority: 25,
    description: '시장·경쟁·가격 동향. **산출물 전량 미검증** — 재무모델에 넣지 않는다',
    capability: 'MARKET_RESEARCH', dependsOn: ['T02'],
    outputs: ['05_Market/research.json'],
  },
  {
    id: 'T06', name: '재무모델', priority: 40,
    description: 'Base/Upside/Downside + 민감도. [계산 전용]',
    capability: 'FINANCIAL_MODEL', dependsOn: ['T03', 'T04'],
    outputs: ['07_Financial/financial.json'],
  },
  {
    id: 'T07', name: '감정평가 3방식', priority: 50,
    description: '공시지가·거래사례·수익환원. 법정 감정평가가 아니다 (참고용 Valuation)',
    capability: 'APPRAISAL', dependsOn: ['T04', 'T06'],
    outputs: ['04_Property/appraisal.json'],
  },
  {
    id: 'T08', name: '매스·용적률 검토', priority: 45,
    description: '계획안이 법적으로 성립하는지 확인한다. 설계안이 아니다',
    capability: 'MASSING', dependsOn: ['T04'],
    outputs: ['04_Property/massing.json'],
  },
  {
    id: 'T09', name: '교차검증', priority: 60,
    description: '같은 항목의 다른 값을 덮지 않고 드러낸다 → RED/YELLOW/GREEN',
    capability: 'CROSS_VALIDATION', dependsOn: ['T05', 'T06', 'T07', 'T08'],
    outputs: ['11_QC/validation.json'],
  },
  {
    id: 'T10', name: 'IM·티저 작성', priority: 70,
    description: '검증된 값만. 본문에 숫자를 직접 쓰지 않는다',
    capability: 'IM_WRITING', dependsOn: ['T01', 'T09'],
    outputs: ['09_IM/im.md', '09_IM/im.json', '10_Teaser/teaser.md'],
  },
  {
    id: 'T11', name: '독립 최종검증 (8 GATE)', priority: 80,
    description: '앞 Agent 결과를 다시 믿지 않는다 — 다른 알고리즘으로 역산',
    capability: 'INDEPENDENT_VALIDATION', dependsOn: ['T10'],
    outputs: ['11_QC/final-validation.json'],
  },

  // ── 자산군 전용 ────────────────────────────────────────────
  {
    id: 'T12', name: '자산군 대조값 입력', priority: 22,
    description: '업종·통계표·계통지역처럼 API 로 안 나오는 값을 사람이 넣는다. 비워도 보고서는 나오지만 그 대조만 건너뛴다',
    capability: null, dependsOn: ['T03'], humanInput: true, needsCrosschecks: true,
    // 실측: pipeline.js:241 이 여기에 쓴다. 짐작으로 01_Project 를 적었다가 고쳤다
    outputs: ['05_Market/crosschecks.json'],
  },
  // ── 아래 셋은 **다른 Agent 안에서 이미 돈다.** 계획에는 보이되 여기서는 안 돌린다.
  //   ★ 지우지 않는 이유 — 「그 조회는 원래 안 한다」로 굳는 것을 막는다 (D-20).
  //   ★ 또 돌리지 않는 이유 — 같은 API 를 두 번 부르게 된다 (CLAUDE.md §4.5).
  {
    id: 'T13', name: '일사량·일조 조회', priority: 32,
    description: '관측소 실측값. **일사량은 내고 발전량은 내지 않는다** — 시스템효율이 가정이다 (D-25)',
    capability: 'SOLAR_RESOURCE', dependsOn: ['T04'], assetOnly: ['solar'],
    // ★ 산출물을 갖지 않는다. 07_geo 의 geo.json 안에 실린다 — 여기에 적으면
    //   그 파일이 있다는 이유로 이 Task 가 「끝났다」로 바뀐다 (실제로 그랬다)
    outputs: [],
  },
  {
    id: 'T14', name: '계통 여유용량 대조', priority: 33,
    description: '수전용량이 계통에 실제로 있는지 본다. 변전소 거리는 사람이 넣는다 (D-54)',
    capability: 'GRID_CAPACITY', dependsOn: ['T05'],
    assetOnly: ['solar', 'wind_onshore', 'wind_offshore', 'datacenter', 'ess'],
    outputs: [],   // 03_research 의 research.json 안에 실린다 (위와 같은 이유)
  },
  {
    id: 'T15', name: '법인 재무·신용 조회', priority: 26,
    description: '사업자·시공사의 공시 재무. 동명 법인은 사람이 특정한다 (§4.9)',
    capability: 'CORPORATE_FINANCIALS', dependsOn: ['T03'],
    outputs: [],   // pipeline.js 가 10_Corporate/ 에 쓴다 — 이 Task 의 것이 아니다
  },

  // ── 다른 갈래에서 오는 중 (SketchUp PR #9) ──
  //   순서 근거: 계획은 매스(T08) 뒤 — 용적률이 성립해야 무엇을 만들지 정해진다.
  //
  //   ★★ **교차검증(T09)의 선행으로 걸지 않는다.** 처음엔 걸었다가 실측에서
  //     T09 부터 아래가 전부 BLOCKED 가 됐다 — 아직 구현되지 않은 Task 를 필수
  //     선행으로 두면 **그 갈래가 병합될 때까지 보고서가 통째로 안 나온다.**
  //     모델 결과는 있으면 쓰고 없으면 그 절만 비우는 값이다 (CLAUDE.md §4.6).
  {
    id: 'T20', name: '모델 계획', priority: 46,
    description: '무엇을 만들 수 있는지 정한다. 매스가 법적으로 성립한 뒤에 온다',
    capability: 'SKETCHUP_PLAN', dependsOn: ['T08'],
    outputs: ['04_Property/model-plan.json'],
  },
  {
    id: 'T21', name: '모델 결과 수령', priority: 47,
    description: '협력사·도구가 낸 결과를 받는다. 생성물이므로 fact 로 등록하지 않는다 (D-38)',
    capability: 'SKETCHUP_INTAKE', dependsOn: ['T20'],
    outputs: ['04_Property/model-result.json'],
  },

  // ── 담당 Agent 가 아직 없는 것 — 지우지 않고 PLANNED 로 남긴다 ──
  {
    id: 'T16', name: '인허가·법률 검토', priority: 35,
    description: '인허가 성립 여부와 법률 리스크',
    capability: 'LEGAL_PERMIT', dependsOn: ['T03'],
    outputs: ['03_Legal/legal.json'],
  },
  {
    id: 'T17', name: '기술 검토', priority: 36,
    description: '설비·공정·성능 가정의 타당성',
    capability: 'TECHNICAL_REVIEW', dependsOn: ['T03'],
    outputs: ['06_Technical/technical.json'],
  },
  {
    id: 'T18', name: 'Risk Analysis', priority: 75,
    description: '리스크 식별·정량화. 지금은 T09 교차검증이 일부를 겸한다',
    capability: 'RISK_ANALYSIS', dependsOn: ['T09'],
    outputs: ['08_DD/risk.json'],
  },
  // ── LinkPilot Platform Manager 〈2026-08-26 · D-119〉 ──
  //
  // ★★ **보고서가 끝나는 곳에서 시작한다.** 지침 §1 — 전문 Agent 결과를
  //   화면에 옮기는 것까지가 한 건이다. 그래서 T11(독립 최종검증) 뒤에 온다.
  //
  // ★ **T22 가 먼저다.** 지침 §5 마지막 줄이 「입력값·완료조건·제외범위가 없으면
  //   구현을 시작하지 않는다」이다. 지시서 없이 만들기 시작하면 무엇이 끝인지
  //   아무도 모른다 — 그래서 spec 이 build 의 선행이다.
  {
    id: 'T22', name: '화면 작업지시서', priority: 92,
    description: '무엇을 만들지 정한다. 지침 §5 의 20필드 — 없으면 NEEDS_INPUT',
    capability: 'PLATFORM_SPEC', dependsOn: ['T11'],
    outputs: ['14_Platform/spec.json'],
  },
  {
    id: 'T23', name: '화면·API 구현', priority: 93,
    description: '지시서대로 만든다. 임시 데이터가 아니라 실제 프로젝트 DB 에 붙인다',
    capability: 'PLATFORM_BUILD', dependsOn: ['T22'],
    outputs: ['14_Platform/build.json'],
  },
  {
    id: 'T24', name: '통합검증', priority: 94,
    description: '지침 §9 완료기준 14개 · §10 기능·데이터·UI·보안. 하나라도 못 채우면 완료가 아니다',
    capability: 'PLATFORM_VERIFY', dependsOn: ['T23'],
    outputs: ['14_Platform/verify.json'],
  },
  {
    id: 'T19', name: 'PPT 생성', priority: 90,
    description: '투자심의용 발표자료',
    capability: 'PRESENTATION', dependsOn: ['T11'],
    outputs: ['12_Final/deck.pptx'],
  },
];

/** 부동산 계열이 아니면 뜻이 옅어지는 Task — 지우지 않고 「해당 없음」 사유를 붙인다 */
const REAL_ESTATE_ONLY = { T07: '08_appraisal', T08: '09_massing' };

/**
 * 요청문에서 자산군을 알아낸다.
 *
 * ★ **못 알아내면 null 로 둔다.** generic 으로 밀어 넣으면 자산군 전용 Task
 *   (일사량·계통)가 조용히 빠지고 아무도 눈치채지 못한다.
 * ★ **여러 자산군이 함께 읽히면 하나를 고르지 않는다** (CLAUDE.md §4.9).
 *   후보를 그대로 돌려주고 사람이 고른다.
 *
 * @returns {{cls, candidates, reason}}
 */
function detectAsset(request, hint) {
  if (hint) {
    const found = assetclass.CLASSES.find(c => c.id === hint);
    if (found) return { cls: found, candidates: [], reason: null };
    return { cls: null, candidates: [], reason: `모르는 자산군: ${hint}` };
  }
  if (!request) return { cls: null, candidates: [], reason: '요청문이 없다' };
  const d = assetclass.detect(String(request));
  if (d && d.id) {
    const found = assetclass.CLASSES.find(c => c.id === d.id) || null;
    return { cls: found, candidates: [], reason: found ? null : `사전에 없는 자산군: ${d.id}` };
  }
  return { cls: null, candidates: (d && d.candidates) || [], reason: (d && d.reason) || '자산군을 특정하지 못했다' };
}

/**
 * 계획을 만든다.
 *
 * @param {object} opts { request, assetType, projectId, includePlanned }
 * @returns {{tasks, assetClass, template, notes, unassigned}}
 */
function plan(opts = {}) {
  const det = detectAsset(opts.request, opts.assetType);
  const cls = det.cls;
  const template = cls ? cls.template : (opts.templateId || null);
  const notes = [];
  const out = [];

  if (!cls) {
    notes.push(`자산군을 특정하지 못했다 (${det.reason}) — 자산군 전용 Task(일사량·계통)는 `
      + '계획에 넣지 않았다. 자산군을 지정하면 다시 계획한다.'
      + (det.candidates.length ? ` 후보: ${det.candidates.map(c => c.label || c.id || c).join(' · ')}` : ''));
  }

  for (const spec of PLAN) {
    // ① 자산군 제한
    if (spec.assetOnly && (!cls || !spec.assetOnly.includes(cls.id))) continue;

    // ② 대조값 Task 는 그 자산군이 실제로 묻는 것이 있을 때만
    if (spec.needsCrosschecks) {
      const asks = cls ? assetclass.asksCrosschecks(cls.id, template) : false;
      if (!asks) continue;
    }

    const t = tasks.makeTask({
      id: spec.id,
      projectId: opts.projectId || null,
      name: spec.name,
      description: spec.description,
      capability: spec.capability,
      dependsOn: spec.dependsOn,
      priority: spec.priority,
      humanInput: spec.humanInput,
      requiredQualityScore: spec.requiredQualityScore,
      maxRetry: spec.maxRetry,
    });
    t.expectedOutputs = (spec.outputs || []).slice();

    // ③ 담당 배정 — 여기서 Agent 와 쓸 수 있는 도구가 정해진다
    if (spec.capability) {
      const a = router.assign(spec.capability, { assumeTools: Boolean(opts.assumeTools) });
      t.agentType = a.agentId;
      t.agentLabel = a.agentLabel;
      t.requiredTools = a.tools.map(x => x.name);
      t.unavailableTools = a.unavailable;
      t.capabilityNote = a.note || null;

      t.handledBy = a.handledBy || null;

      if (a.handledBy) {
        // ★ 「전담 Agent 는 없지만 이미 어딘가에서 돈다」 — 미구현과 **다른 상태**로 둔다.
        //   SKIPPED 로 두면 후행이 막히지 않는다. 실제로 그 값은 들어오기 때문이다.
        tasks.advance(t, tasks.STATUS.SKIPPED, {
          reason: `여기서는 안 돌린다 — ${a.handledBy} 안에서 이미 돈다 (같은 API 를 두 번 부르지 않는다)`,
        });
      } else if (!a.implemented) {
        // ★ 대체 Agent 로 태우지 않는다. 못 하는 것은 못 한다고 남긴다
        tasks.advance(t, tasks.STATUS.PLANNED, { reason: a.reason });
        notes.push(`${t.id} ${t.name} — ${a.reason}`);
      } else if (a.toolsBlocked) {
        // ★ 미구현(PLANNED)과 **구분한다.** 이쪽은 코드는 있고 **키가 없는** 것이다 —
        //   키를 넣으면 그날 바로 돈다. 둘을 같은 상태로 뭉치면 「원래 안 되는 것」으로 읽힌다
        tasks.advance(t, tasks.STATUS.BLOCKED, { reason: a.reason });
        notes.push(`${t.id} ${t.name} — ${a.reason}`);
      }
    } else if (spec.humanInput) {
      t.agentType = null;
      t.agentLabel = '사람 입력';
    }

    // ④ 부동산 계열 전용 Task 를 다른 자산군에서 — 지우지 않고 사유를 붙인다
    if (REAL_ESTATE_ONLY[spec.id] && cls && !['realestate'].includes(template)
        && t.status !== tasks.STATUS.PLANNED) {
      t.assetNote = `${cls.label} 딜에서는 자료가 없어 자동으로 건너뛸 수 있다 `
        + `(${REAL_ESTATE_ONLY[spec.id]} 가 스스로 판단한다)`;
    }

    out.push(t);
  }

  // ⑤ 선행이 계획에서 빠졌으면 그 선행을 지운다 — 없는 것을 기다리면 영원히 안 돈다
  const have = new Set(out.map(t => t.id));
  for (const t of out) {
    const missing = t.dependsOn.filter(d => !have.has(d));
    if (missing.length) {
      t.dependsOn = t.dependsOn.filter(d => have.has(d));
      notes.push(`${t.id} 의 선행 ${missing.join(', ')} 이(가) 이 계획에 없어 의존에서 뺐다`);
    }
  }

  // ⑥ 계획을 내기 전에 그래프를 검사한다 — 순환이 있으면 실행기가 조용히 끝난다
  const cycles = tasks.findCycles(out);
  if (cycles.length) throw new Error(`Task 의존에 순환이 있다: ${cycles.map(c => c.join('→')).join(' / ')}`);
  const dangling = tasks.danglingDeps(out);
  if (dangling.length) throw new Error(`없는 선행을 가리킨다: ${dangling.map(d => `${d.task}→${d.missing}`).join(', ')}`);

  // ⑦ 선행이 죽은 Task 를 BLOCKED 로 — QUEUED 로 두면 「순서가 안 왔다」로 읽힌다.
  //   ★ **한 번만 훑으면 안 된다.** T04 가 막히면 T06 이 막히고 그다음 T09 가 막힌다 —
  //     더 번지지 않을 때까지 돈다. 한 번만 돌던 판에서는 T09 가 QUEUED 로 남아
  //     「곧 돈다」로 보였다.
  for (let i = 0; i < out.length + 1; i += 1) {
    const round = tasks.blockedSet(out);
    if (!round.length) break;
    for (const b of round) {
      tasks.advance(b.task, tasks.STATUS.BLOCKED, {
        reason: `선행 ${b.because.join(', ')} 이(가) 돌 수 없다`,
      });
    }
  }

  return {
    tasks: out,
    assetClass: cls ? { id: cls.id, label: cls.label, template: cls.template } : null,
    template,
    notes,
    assetCandidates: det.candidates,
    planned: out.filter(t => t.status === tasks.STATUS.PLANNED).map(t => ({ id: t.id, name: t.name, reason: t.reason })),
    blocked: out.filter(t => t.status === tasks.STATUS.BLOCKED).map(t => ({ id: t.id, name: t.name, reason: t.reason })),
    elsewhere: out.filter(t => t.handledBy).map(t => ({ id: t.id, name: t.name, handledBy: t.handledBy })),
    unassigned: out.filter(t => !t.agentType && !t.humanInput).map(t => t.id),
  };
}

/** registry 에 없는 Agent 를 계획이 가리키고 있지 않은가 — 검사에서 쓴다 */
function referencedAgents() {
  const ids = new Set();
  for (const spec of PLAN) {
    if (!spec.capability) continue;
    const cap = router.CAPABILITIES[spec.capability];
    for (const a of (cap ? cap.agents : [])) ids.add(a);
  }
  return Array.from(ids).sort();
}

/**
 * 계획이 가리키는데 아무 데도 없는 Agent — 오타를 잡는다.
 * ★ 「다른 갈래에서 오는 중」(router.INCOMING)이라고 **밝힌 것**은 뺀다.
 *   밝히지 않은 것만 오타로 본다 — 밝히면 병합될 때 검사가 따로 짚는다.
 */
function unknownAgents() {
  // ★ `registry.get()` 을 쓴다 — AGENTS 만 보면 Task 그래프 전용 Agent(D-130)가
  //   「모르는 Agent」로 잡힌다. 등록된 곳이 두 갈래라 세는 자리도 한 곳이어야 한다.
  return referencedAgents().filter(id =>
    !registry.get(id) && !registry.PLANNED[id] && !router.INCOMING[id]);
}

/**
 * 「오는 중」이라 적어 뒀는데 **이미 와 있는** Agent — 표를 지울 때가 됐다는 뜻.
 * ★ 안 지우면 이미 와 있는 것을 아직 안 왔다고 말하는 표가 된다.
 */
function arrivedIncoming() {
  // ★ AGENTS 와 TASK_AGENTS 를 함께 본다 (D-130) — 어느 갈래로 도착하든 도착이다
  return Object.keys(router.INCOMING).filter(id => registry.get(id));
}

module.exports = { PLAN, plan, detectAsset, referencedAgents, unknownAgents, arrivedIncoming, REAL_ESTATE_ONLY };
