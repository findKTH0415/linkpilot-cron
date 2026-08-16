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
 *
 *   ③ 대조(crosschecks) — 2026-08-16 추가 (등록부 D-48).
 *      제조 딜의 생산자물가·가동률·공장등록·수출입단가·환경인허가.
 *      **facts 가 아니다.** 사업계획서가 말하는 숫자 옆에 공표 통계를 세워
 *      얼마나 떨어져 있는지 보여 줄 뿐, 값을 대신 채우지 않는다.
 *
 *      ★ 부르는 조건이 다른 둘과 다르다: **사람이 무엇을 대조할지 골라야 부른다.**
 *        업종·통계표·상호·HS코드를 자동으로 추정하면 틀린 대상의 값이 그럴듯하게
 *        나오고 문서에는 「대조함」만 남는다 (§4.9). 그래서 `crosscheck.*`
 *        가이드 필드가 비어 있으면 **부르지 않고 왜 못 했는지만 남긴다.**
 */

const llm = require('../core/llm');
const kpx = require('../connectors/kpx');
const ecos = require('../connectors/ecos');
const dart = require('../connectors/dart');
const kosis = require('../connectors/kosis');
const factory = require('../connectors/factory');
const customs = require('../connectors/customs');
const enviro = require('../connectors/enviro');
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
    // ★ facts 와 **다른 칸**에 둔다. 섞이면 대조값이 딜의 값으로 실린다 (D-48)
    crosschecks: { type: 'array' },
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
  // ★ LLM 보다 **먼저** 돌린다. LLM 이 죽어도 대조는 남아야 한다
  const checks = await crosschecks(ctx);

  if (llm.isOffline()) {
    ctx.warn('LLM 오프라인 — 시장조사 생략. IM의 시장분석 절은 자리표시자로 출력된다');
    return {
      sections: TOPICS.map(t => ({ id: t.id, label: t.label, text: '(시장조사 미실행 — LLM 오프라인)', sources: [], certainty: 'low', verified: false })),
      // ★ LLM 이 죽어도 실측 지표는 살아 있다 — 출처가 LLM 이 아니기 때문이다
      sources: market.sources, facts: market.facts, sponsor: await sponsorCheck(ctx),
      // ★ LLM 이 죽어도 대조는 돈다 — 출처가 LLM 이 아니다
      crosschecks: checks,
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
    crosschecks: checks,
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

/* ───────────── ③ 대조 (등록부 D-48) ───────────── */

/**
 * 대조에 쓰는 가이드 필드. **값이 있어야 그 대조를 부른다.**
 *
 * ★ `needs` 가 이 대조의 전제다. 하나라도 비면 **부르지 않는다** — 없는 값을
 *   짐작해 부르면 틀린 대상의 값이 그럴듯하게 나온다 (§4.9).
 */
const CROSSCHECKS = [
  {
    id: 'ppi', label: '단가 시점수정 (생산자물가)',
    needs: ['crosscheck.ppi_item'], connector: 'ecos',
    ask: 'ECOS 업종 목록에서 딜 업종에 해당하는 코드를 고른다',
  },
  {
    id: 'utilization', label: '가동률 (업종 평균)',
    needs: ['crosscheck.kosis_table', 'crosscheck.kosis_item'], connector: 'kosis',
    ask: 'KOSIS 통계표와 **% 항목**을 고른다 (지수를 고르면 「가동률 102%」가 나온다)',
  },
  {
    id: 'factory', label: '생산능력 상한 (공장등록)',
    needs: ['crosscheck.factory_name'], connector: 'factory',
    ask: '공장등록 상호를 넣는다',
  },
  {
    id: 'unitprice', label: '단가 실거래 (수출입)',
    needs: ['crosscheck.hs_code'], connector: 'customs',
    ask: 'HS 코드(4·6·10단위)를 넣는다',
  },
  {
    id: 'enviro', label: '환경 인허가 (딜브레이커)',
    needs: ['crosscheck.enviro_name'], connector: 'enviro',
    ask: '조회할 상호를 넣는다',
  },
];

/** dataset 에서 가이드 필드 값을 꺼낸다 (없으면 null — 빈 문자열도 없는 것으로 본다) */
function pick(dataset, key) {
  if (!dataset || typeof dataset.get !== 'function') return null;
  const f = dataset.get(key);
  const v = f && f.value !== undefined && f.value !== null ? String(f.value).trim() : '';
  return v || null;
}

/**
 * 대조 실행.
 *
 * ★ **한 항목이 죽어도 나머지를 돌린다** (§4.6). 그리고 **건너뛴 것도 결과에
 *   남긴다** — 조용히 사라지면 「대조했는데 문제 없었다」로 읽힌다.
 * ★ **facts 를 만들지 않는다.** 전부 사업계획서 숫자 옆에 세우는 값이다.
 */
async function crosschecks(ctx) {
  const dataset = ctx && ctx.dataset;
  const out = [];

  for (const c of CROSSCHECKS) {
    const missing = c.needs.filter(k => !pick(dataset, k));
    if (missing.length) {
      // ★ 「안 물어봐서 못 했다」와 「해 봤는데 안 나왔다」는 다르다
      out.push({
        id: c.id, label: c.label, status: 'skipped',
        reason: `대조할 대상을 고르지 않았다 — ${c.ask}`,
        needs: c.needs, missing,
      });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await runOne(c, dataset).catch(e => ({
      id: c.id, label: c.label, status: 'error', reason: `대조 중 오류: ${e.message}`,
    }));
    out.push(r);
    if (r.status !== 'ok' && ctx && ctx.warn) ctx.warn(`${c.label}: ${r.reason || ''}`);
  }
  return out;
}

async function runOne(c, dataset) {
  const base = { id: c.id, label: c.label };
  const months = 24;
  const to = kstDate().slice(0, 7).replace('-', '');
  const from = (() => {
    const y = Number(to.slice(0, 4)); const m = Number(to.slice(4, 6));
    const t = (y * 12 + (m - 1)) - months;
    return `${Math.floor(t / 12)}${String((t % 12) + 1).padStart(2, '0')}`;
  })();

  if (c.id === 'ppi') {
    const r = await ecos.priceAdjustment({ item: pick(dataset, 'crosscheck.ppi_item'), from, to });
    if (!r.ok) return { ...base, status: r.unavailable ? 'unavailable' : 'failed', reason: r.error };
    return {
      ...base, status: 'ok',
      text: `${r.value.label} ${r.value.from}→${r.value.to} 시점수정 계수 ${r.value.factor}`
        + ` (${r.value.percent >= 0 ? '+' : ''}${r.value.percent}%)`,
      source: r.value.source,
      // ★ 적용 여부는 사람이 정한다 — 사업계획서 단가가 이미 최근 값이면 두 번 보정된다
      apply: 'human',
    };
  }

  if (c.id === 'utilization') {
    const r = await kosis.benchmark({
      tblId: pick(dataset, 'crosscheck.kosis_table'),
      itmId: pick(dataset, 'crosscheck.kosis_item'),
      from, to,
    });
    if (!r.ok) return { ...base, status: r.unavailable ? 'unavailable' : 'failed', reason: r.error };

    const deal = pick(dataset, 'revenue.occupancy');   // 제조에서는 가동률로 쓴다
    const cmp = deal ? kosis.compare(Number(deal), r.value) : null;
    return {
      ...base, status: 'ok',
      text: cmp && cmp.ok ? cmp.value.text
        : `업종 평균 ${r.value.mean}${r.value.unit || ''} (${r.value.from}~${r.value.to}, ${r.value.n}개 시점)`
          + (cmp && !cmp.ok ? ` — 견주지 못했다: ${cmp.error}` : ''),
      source: r.value.source,
    };
  }

  if (c.id === 'factory') {
    const r = await factory.resolve({ name: pick(dataset, 'crosscheck.factory_name') });
    if (r.ambiguous) {
      return { ...base, status: 'ambiguous', reason: r.error,
        candidates: r.candidates.map(x => ({ name: x.name, address: x.address })) };
    }
    if (!r.ok) return { ...base, status: r.unavailable ? 'unavailable' : 'failed', reason: r.error };

    const mfg = factory.areaOf(r.value, 'manufacturing');
    const land = factory.areaOf(r.value, 'land');
    // ★ 공부끼리 어긋나면 그 사실을 드러낸다 — 어느 쪽이 맞다고 말하지 않는다
    const ledger = pick(dataset, 'land.area_sqm');
    const cross = (land.ok && ledger) ? factory.crossCheckLand(land.value.sqm, Number(ledger)) : null;

    return {
      ...base, status: 'ok',
      text: [
        mfg.ok ? `제조시설면적 ${mfg.value.sqm}㎡` : `제조시설면적 ${mfg.error}`,
        land.ok ? `용지면적 ${land.value.sqm}㎡` : null,
        cross && cross.ok ? cross.value.text : null,
      ].filter(Boolean).join(' · '),
      source: mfg.ok ? mfg.value.source : (land.ok ? land.value.source : null),
    };
  }

  if (c.id === 'unitprice') {
    const r = await customs.unitPrice({ hsCode: pick(dataset, 'crosscheck.hs_code'), from, to });
    if (!r.ok) return { ...base, status: r.unavailable ? 'unavailable' : 'failed', reason: r.error };

    const channelRaw = pick(dataset, 'crosscheck.sales_channel') || '';
    const channel = /수출|export/i.test(channelRaw) ? 'export'
      : (/내수|domestic/i.test(channelRaw) ? 'domestic' : null);
    return {
      ...base, status: 'ok',
      text: `HS ${r.value.hsCode} ${r.value.directionLabel} ${r.value.usdPerKg} ${r.value.unit}`
        + ` (${r.value.months}개월 합계)`
        // ★ 판로를 안 밝히면 견주지 않는다 — 내수 딜을 수출단가와 견주면 견준 것이 아니다
        + (channel ? '' : ' — 판로(수출/내수)를 넣으면 딜 단가와 견준다'),
      channel,
      source: r.value.source,
    };
  }

  if (c.id === 'enviro') {
    const s = await enviro.screen({ name: pick(dataset, 'crosscheck.enviro_name') });
    return {
      ...base,
      // ★ 하나라도 확인 안 되면 통과가 아니다. 「모름」은 「문제 없음」이 아니다
      status: s.verdict.cleared ? 'ok' : 'needs_review',
      text: s.verdict.text,
      items: s.items.map(x => ({ kind: x.kind, label: x.label, status: x.status, reason: x.reason })),
      reason: s.verdict.cleared ? null : s.verdict.text,
    };
  }

  return { ...base, status: 'failed', reason: `모르는 대조: ${c.id}` };
}

module.exports = {
  id: '03_research', label: 'Market Research Agent',
  inputSchema, outputSchema, run, TOPICS, FILLS,
  marketFacts, rateFacts, sponsorCheck, crosschecks, CROSSCHECKS, pick,
};
