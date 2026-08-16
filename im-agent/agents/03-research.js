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
 *      지금 셋이다 — REC 현물시장 단가(전력거래소, 태양광 딜만) ·
 *      시장금리(한국은행 ECOS) · 시행사 실재 대조(금감원 DART).
 *
 * ★ 시장금리가 채우는 것은 `debt.benchmark_rate`(기준선)이지 `debt.rate`
 *   (차입금리)가 아니다. 이유는 connectors/ecos.js 머리말에 적었다.
 * ★ 시행사 대조는 **값을 채우지 않는다.** 동명 법인이 여러 건이면 고르지 않는다.
 */

const llm = require('../core/llm');
const kpx = require('../connectors/kpx');
const ecos = require('../connectors/ecos');
const dart = require('../connectors/dart');
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
  required: ['sections', 'sources', 'facts'],
  properties: {
    sections: { type: 'array' },
    sources: { type: 'array' },
    facts: { type: 'array' },
    sponsor: { type: 'object', nullable: true },
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

  // ★ 금리는 딜 종류를 안 가린다 — 태양광이든 부동산이든 차입은 한다.
  //   REC 는 태양광에서만 부른다. 두 소스를 한 함수에 모아 두는 이유는
  //   부르는 쪽이 "실측 지표는 여기서 다 온다"고 믿을 수 있어야 하기 때문이다.
  const rates = await rateFacts(ctx);
  if (rates.length) {
    facts.push(...rates);
    sources.push(...rates.map(f => f.source));
  }

  if (!isSolar(input) || !kpx.isAvailable()) return { facts, sources };

  const rec = await kpx.recAverage({ months: 12, area: 'land' });
  if (!rec.ok) {
    if (!rec.unavailable) ctx.warn(`REC 시장 조회 실패: ${rec.error}`);
    return { facts, sources };   // 금리는 이미 담겨 있다
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
      sources: market.sources, facts: market.facts, sponsor: await sponsorCheck(ctx),
      confidence: 0, offline: true,
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
  return {
    sections, sources, facts: market.facts, sponsor: await sponsorCheck(ctx),
    confidence: round(confidence, 3), offline: false,
  };
}

/**
 * 시행사가 실재하는 법인인지 DART 로 대조한다. 〈C-01〉
 *
 * ★ 값을 **채우지 않는다.** 시행사 이름은 요청문·자료에서 오고, 여기서는 그 이름을
 *   확인만 한다. 채우면 화면이 시행사를 안 물어보게 되고, 그러면 대조할 원본이
 *   사라진다.
 *
 * ★ 못 찾는 것이 정상인 경우가 많다 — DART 는 공시대상회사만 수록하므로 SPC 는
 *   원래 없다. 그걸 경고로 띄우면 매 딜마다 뜨는 경고가 되어 아무도 안 읽는다.
 *   경고는 **동명 법인이 여러 건일 때만** 낸다 (사람이 골라야 하는 순간이다).
 */
async function sponsorCheck(ctx) {
  const ds = ctx && ctx.dataset;
  const fact = ds && ds.get && ds.get('project.sponsor');
  const name = fact ? String(fact.value || '').trim() : '';
  if (!name) return null;

  if (!dart.isAvailable()) {
    return { name, status: 'unchecked', note: 'DART_API_KEY 미설정 — 시행사 실재 확인 생략' };
  }

  const r = await dart.findCompany(name);
  if (r.ambiguous) {
    if (ctx.warn) ctx.warn(`'${name}' 과 같은 이름의 공시대상 법인이 ${r.candidates.length}건 — 어느 법인인지 확인이 필요하다`);
    return { name, status: 'ambiguous', candidates: r.candidates.map(c => ({ corpCode: c.corpCode, corpName: c.corpName, stockCode: c.stockCode })) };
  }
  if (r.notFound) {
    // 정상적인 경우가 많다. 경고하지 않고 사실만 남긴다
    return { name, status: 'not_in_dart', note: 'DART 공시대상회사가 아니다 — SPC·비상장 시행사는 원래 조회되지 않는다' };
  }
  if (!r.ok) {
    if (ctx.warn) ctx.warn(`시행사 조회 실패: ${r.error}`);
    return { name, status: 'error', note: r.error };
  }

  const detail = await dart.company(r.value.corpCode);
  return {
    name, status: 'found',
    corpCode: r.value.corpCode,
    corpName: r.value.corpName,
    stockCode: r.value.stockCode,
    profile: detail.ok ? detail.value : null,
    note: detail.ok ? null : detail.error,
  };
}

/**
 * 시장금리를 출처와 함께 가져온다.
 *
 * ★ 실패해도 Agent 를 죽이지 않는다 (CLAUDE.md §4). 한 소스가 없다고 시장조사
 *   전체가 사라지면 IM 이 통째로 빈다. 경고만 남기고 빈 배열을 돌려준다.
 */
async function rateFacts(ctx) {
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

/**
 * 이 Agent 가 공공데이터로 채우는 항목 (ECOS 키가 있을 때만).
 *
 * ★ `market.rec_price` 는 여기 없다. **태양광 딜에서만** 나오므로 FILLS 에 넣으면
 *   부동산 딜에서 "자동으로 채워집니다"라고 해 놓고 조용히 빈칸이 남는다.
 */
const FILLS = ['debt.benchmark_rate'];

module.exports = {
  id: '03_research', label: 'Market Research Agent',
  inputSchema, outputSchema, run, TOPICS, FILLS, marketFacts, rateFacts, sponsorCheck,
};
