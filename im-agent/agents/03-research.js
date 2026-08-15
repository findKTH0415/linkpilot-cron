'use strict';
/**
 * 03 Market Research Agent
 *
 * ★ 이 Agent 의 산출물은 **두 갈래**다. 섞이면 안 된다.
 *
 *   ① 서술(sections) — LLM 이 기억으로 쓴다. 전부 verified=false 다.
 *      재무모델에 절대 투입되지 않고(Financial 은 Dataset 만 읽는다),
 *      IM 본문에서 "출처 확인 필요" 표시와 함께 서술 근거로만 쓰인다.
 *
 *   ② 실측 지표(facts) — Connector 가 낸다. 출처가 있으므로 Dataset 에 들어간다.
 *      현재: REC 현물시장 단가(전력거래소). 태양광 딜에서만.
 *
 * ②가 D-15 가 "Connector 를 붙여 URL 출처를 강제해야 한다"고 적어 둔 자리다.
 * 아직 첫 칸만 찼다 — 나머지 서술 항목은 여전히 LLM 기억이다.
 */

const llm = require('../core/llm');
const kpx = require('../connectors/kpx');
const { round } = require('../core/numeric');
const { kstDate } = require('../core/kst');

const inputSchema = {
  type: 'object',
  required: ['projectId', 'assetType'],
  properties: {
    projectId: { type: 'string' },
    assetType: { type: 'string' },
    templateId: { type: 'string', nullable: true },
    location: { type: 'string', nullable: true },
    projectName: { type: 'string' },
  },
};

const outputSchema = {
  type: 'object',
  required: ['sections', 'sources'],
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

/**
 * 실측 시장지표 — LLM 이 아니라 Connector 가 낸다.
 *
 * ★ 이 Agent 의 나머지 산출물은 전부 `verified=false` 다(LLM 기억). 여기만
 *   다르다 — 전력거래소 실거래 통계라 출처가 있고 재무모델에 들어갈 수 있다.
 *   D-15 가 "Connector 를 붙여 URL 출처를 강제해야 한다"고 적어 둔 자리의 첫 칸이다.
 *
 * ★ REC 단가까지만 낸다. 매출(= 발전량 × (SMP + REC × 가중치))은 계산하지
 *   않는다 — 발전량과 REC 가중치가 가정치다 (등록부 D-25).
 */
async function marketFacts(input, ctx, today) {
  const facts = [];
  const sources = [];
  if (!isSolar(input) || !kpx.isAvailable()) return { facts, sources };

  const rec = await kpx.recAverage({ months: 12, area: 'land' });
  if (!rec.ok) {
    if (!rec.unavailable) ctx.warn(`REC 시장 조회 실패: ${rec.error}`);
    return { facts, sources };
  }

  const v = rec.value;
  sources.push('REC 현물시장(한국전력거래소)');

  // 가중평균과 단순평균이 크게 벌어지면 거래가 얇다는 뜻이다 — 그 시세는 덜 믿는다
  const gap = v.weightedAvg && v.simpleAvg
    ? Math.abs(v.weightedAvg - v.simpleAvg) / v.simpleAvg : 0;
  if (gap > 0.05) {
    ctx.warn(`REC 거래량 가중평균(${v.weightedAvg?.toLocaleString('ko-KR')})과 `
      + `단순평균(${v.simpleAvg?.toLocaleString('ko-KR')})이 ${Math.round(gap * 100)}% 차이 — `
      + '거래가 얇은 구간이다. 시세를 단정하지 않는다');
  }

  facts.push({
    key: 'market.rec_price',
    value: v.weightedAvg ?? v.simpleAvg,
    unit: '원/REC',
    confidence: 0.9,
    quote: `최근 ${v.months}개월 육지 거래량 가중평균 (${v.sessions}회 개장, `
      + `${v.from.slice(0, 6)}~${v.latestDate.slice(0, 6)}, 최근가 ${v.latestPrice?.toLocaleString('ko-KR')}원)`,
    source: `REC 현물시장(한국전력거래소, 기준일 ${v.latestDate})`,
    sourceDate: today,
    page: null,
  });
  return { facts, sources };
}

/** 태양광 딜인지 — assetType 문자열과 템플릿 id 를 모두 본다 */
function isSolar(input) {
  const s = `${input.assetType || ''} ${input.templateId || ''}`.toLowerCase();
  return /solar|태양광|pv/.test(s);
}

async function run(input, ctx) {
  const today = kstDate();
  const market = await marketFacts(input, ctx, today);

  if (llm.isOffline()) {
    ctx.warn('LLM 오프라인 — 시장조사 생략. IM의 시장분석 절은 자리표시자로 출력된다');
    return {
      sections: TOPICS.map(t => ({ id: t.id, label: t.label, text: '(시장조사 미실행 — LLM 오프라인)', sources: [], certainty: 'low', verified: false })),
      // ★ LLM 이 죽어도 실측 지표는 살아 있다 — 출처가 LLM 이 아니기 때문이다
      sources: market.sources, facts: market.facts, confidence: 0, offline: true,
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

  const sources = [...new Set([...sections.flatMap(s => s.sources), ...market.sources])];
  return { sections, sources, facts: market.facts, confidence: round(confidence, 3), offline: false };
}

module.exports = { id: '03_research', label: 'Market Research Agent', inputSchema, outputSchema, run, TOPICS };
