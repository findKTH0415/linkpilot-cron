'use strict';
/**
 * 03 Market Research Agent
 *
 * ★ 이 Agent의 산출물은 전부 verified=false 다.
 *   LLM이 기억으로 만들어낸 시장 수치는 출처가 검증되지 않았으므로
 *   - 재무모델에 절대 투입되지 않고 (Financial Agent는 Dataset만 읽는다)
 *   - IM 본문에서는 "출처 확인 필요" 표시와 함께 서술 근거로만 쓰인다.
 *
 * 실제 운영에서는 Connector Layer(웹검색/통계API)를 붙여 URL 출처를 강제해야 한다.
 * 현재는 그 자리를 명시적으로 비워두고, 근거 URL이 없는 항목을 YELLOW로 표시한다.
 *
 * ★ 예외가 하나 생겼다: **시장금리**는 한국은행 ECOS 에서 직접 받아 온다.
 *   LLM 서술과 달리 출처가 확실하므로 `facts` 로 Dataset 에 들어간다 —
 *   이 Agent 에서 유일하게 재무·검증이 믿어도 되는 숫자다.
 *   단 채우는 것은 `debt.benchmark_rate`(기준선)이지 `debt.rate`(차입금리)가
 *   아니다. 이유는 connectors/ecos.js 머리말에 적었다.
 */

const llm = require('../core/llm');
const ecos = require('../connectors/ecos');
const { round } = require('../core/numeric');

const inputSchema = {
  type: 'object',
  required: ['projectId', 'assetType'],
  properties: {
    projectId: { type: 'string' },
    assetType: { type: 'string' },
    location: { type: 'string', nullable: true },
    projectName: { type: 'string' },
  },
};

const outputSchema = {
  type: 'object',
  required: ['sections', 'sources', 'facts'],
  properties: {
    sections: { type: 'array' },
    sources: { type: 'array' },
    facts: { type: 'array' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    offline: { type: 'boolean' },
  },
};

const TOPICS = [
  { id: 'market_size', label: '시장 규모 및 성장' },
  { id: 'demand_driver', label: '수요 동인' },
  { id: 'supply', label: '공급/경쟁 현황' },
  { id: 'location', label: '입지 경쟁력' },
  { id: 'regulation', label: '규제·정책 환경' },
  { id: 'risk', label: '시장 리스크' },
];

const SCHEMA = {
  type: 'object',
  required: ['sections'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'text'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string', minLength: 20 },
          sources: { type: 'array', items: { type: 'string' } },
          certainty: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

async function run(input, ctx) {
  if (llm.isOffline()) {
    ctx.warn('LLM 오프라인 — 시장조사 생략. IM의 시장분석 절은 자리표시자로 출력된다');
    return {
      sections: TOPICS.map(t => ({ id: t.id, label: t.label, text: '(시장조사 미실행 — LLM 오프라인)', sources: [], certainty: 'low', verified: false })),
      sources: [], facts: await marketFacts(ctx), confidence: 0, offline: true,
    };
  }

  const result = await llm.generateJson({
    system: '너는 투자은행 리서치 애널리스트다. 확인되지 않은 수치를 단정적으로 쓰지 않는다. 수치를 쓸 때는 반드시 출처(기관명·보고서명·연도)를 함께 적고, 출처가 불확실하면 certainty를 low 로 표기한다.',
    prompt: `아래 프로젝트의 시장 분석을 작성하라.

프로젝트: ${input.projectName || '(미지정)'}
자산유형: ${input.assetType}
소재지: ${input.location || '(미확인)'}

각 항목을 3~5문장으로 작성한다. 항목 id는 다음을 그대로 쓴다:
${TOPICS.map(t => `- ${t.id}: ${t.label}`).join('\n')}

[금지] 프로젝트 고유 수치(사업비·매출·IRR 등)를 지어내지 마라. 그 값들은 다른 Agent가 원본자료에서 추출한다.
[필수] 시장 수치를 인용하면 sources 배열에 출처를 남긴다. 출처를 특정할 수 없으면 certainty="low".`,
    schema: SCHEMA,
    label: '시장조사',
    temperature: 0.4,
  });

  const sections = TOPICS.map(t => {
    const s = (result.sections || []).find(x => x.id === t.id);
    return {
      id: t.id, label: t.label,
      text: s ? s.text : '(생성되지 않음)',
      sources: (s && s.sources) || [],
      certainty: (s && s.certainty) || 'low',
      verified: false, // 이 Agent 산출물은 절대 verified 가 되지 않는다
    };
  });

  const noSource = sections.filter(s => !s.sources.length);
  if (noSource.length) {
    ctx.warn(`출처 없는 시장분석 ${noSource.length}개 항목 — IM 본문에서 '출처 확인 필요'로 표기됨`);
  }

  const certScore = { high: 0.8, medium: 0.6, low: 0.35 };
  const confidence = sections.length
    ? sections.reduce((a, s) => a + (certScore[s.certainty] || 0.35), 0) / sections.length
    : 0;

  const sources = [...new Set(sections.flatMap(s => s.sources))];
  return {
    sections, sources, facts: await marketFacts(ctx),
    confidence: round(confidence, 3), offline: false,
  };
}

/**
 * 시장금리를 출처와 함께 가져온다.
 *
 * ★ 실패해도 Agent 를 죽이지 않는다 (CLAUDE.md §4). 한 소스가 없다고 시장조사
 *   전체가 사라지면 IM 이 통째로 빈다. 경고만 남기고 빈 배열을 돌려준다.
 */
async function marketFacts(ctx) {
  if (!ecos.isAvailable()) {
    if (ctx && ctx.warn) ctx.warn('ECOS_API_KEY 미설정 — 시장금리를 가정치로 둔다');
    return [];
  }
  const r = await ecos.marketRate();
  if (!r.ok) {
    if (ctx && ctx.warn) ctx.warn(`시장금리 조회 실패: ${r.error}`);
    return [];
  }
  return [{
    key: 'debt.benchmark_rate',
    value: r.value.rate,
    unit: r.value.unit === '%' ? '%' : r.value.unit,
    confidence: 0.95,
    source: `한국은행 ECOS ${r.value.label}`,
    sourceDate: r.value.date,
    page: null,
    note: '기준선이다 — 차입금리(debt.rate)가 아니다. PF 금리 = 기준금리 + 스프레드',
  }];
}

/** 이 Agent 가 공공데이터로 채우는 항목 (ECOS 키가 있을 때만) */
const FILLS = ['debt.benchmark_rate'];

module.exports = { id: '03_research', label: 'Market Research Agent', inputSchema, outputSchema, run, TOPICS, FILLS, marketFacts };
