'use strict';
/**
 * 08 Appraisal Agent — 감정평가 (참고용 간이 평가)
 *
 * ⚠ 법적 고지: 대한민국에서 감정평가는 「감정평가 및 감정평가사에 관한 법률」에 따라
 *   감정평가법인등만 수행할 수 있다. 이 Agent의 산출물은 **법정 감정평가가 아니며**,
 *   내부 검토·타당성 판단용 참고 수치다. 모든 산출물에 이 문구가 따라붙는다.
 *
 * 3방식 병행 (전부 결정적 계산 — LLM 미사용):
 *   ① 공시지가 기준   개별공시지가 × 면적 × 현실화계수
 *   ② 거래사례비교법   인근 실거래 ㎡단가 중앙값 × 면적
 *   ③ 수익환원법      (안정화 NOI ÷ Cap Rate) − 건물가치
 *
 * 3방식 편차가 크면 그 자체가 신호다 → RED/YELLOW FLAG.
 */

const nsdi = require('../connectors/nsdi');
const molit = require('../connectors/molit');
const pnuUtil = require('../connectors/pnu');
const cache = require('../connectors/cache');
const { round, formatEok } = require('../core/numeric');
const { kstDate } = require('../core/kst');

const DISCLAIMER = '참고용 간이 평가 — 「감정평가 및 감정평가사에 관한 법률」상 감정평가가 아니며, 법적 효력이 없다. 투자 확정 전 감정평가법인등의 정식 평가가 필요하다.';

/** 공시지가 대비 시가 현실화 계수 기본값 (문서·시장자료로 확인되면 대체된다) */
const DEFAULT_REALIZATION = 1.6;
const TRADE_MONTHS = 6; // 실거래 조회 개월 수 — 늘리면 공공데이터 호출이 그만큼 증가한다

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    financial: { type: 'object', nullable: true },
    tradeType: { type: 'string' },
  },
};

const outputSchema = {
  type: 'object',
  required: ['methods', 'facts', 'flags', 'disclaimer'],
  properties: {
    methods: { type: 'object' },
    concluded: { type: 'object', nullable: true },
    facts: { type: 'array' },
    flags: { type: 'array' },
    comparables: { type: 'array' },
    disclaimer: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 원/㎡ × ㎡ → 억원 */
function toEok(pricePerSqm, areaSqm) {
  if (!pricePerSqm || !areaSqm) return null;
  return round((pricePerSqm * areaSqm) / 1e8, 1);
}

async function run(input, ctx) {
  const ds = ctx.dataset;
  if (!ds) throw new Error('ctx.dataset 필요');

  const today = kstDate();
  const facts = [];
  const flags = [];
  const methods = {};
  let comparables = [];

  const areaSqm = ds.num('land.area_sqm');
  const pnu = ds.get('geo.pnu');
  const parsed = pnu ? pnuUtil.parse(pnu.value) : null;

  if (!areaSqm) {
    ctx.warn('대지면적 미확인 — 토지 감정평가 산정 불가');
    return { methods, concluded: null, facts, flags, comparables, disclaimer: DISCLAIMER, confidence: 0 };
  }

  const src = name => ({ source: name, sourceDate: today, page: null });

  // ── ① 공시지가 기준 ────────────────────────────────────
  let officialPrice = ds.num('land.official_price');
  let officialSource = officialPrice !== null ? (ds.get('land.official_price').source) : null;

  if (officialPrice === null && parsed && nsdi.isAvailable()) {
    const lp = await nsdi.landPrice(parsed.pnu);
    if (lp.ok) {
      officialPrice = lp.value.pricePerSqm;
      officialSource = `개별공시지가(${lp.value.year}년 고시)`;
      facts.push({
        key: 'land.official_price', value: officialPrice, unit: '원/㎡',
        confidence: 0.95, verified: true, ...src(officialSource),
      });
    } else if (!lp.unavailable) {
      ctx.warn(`공시지가 조회 실패: ${lp.error}`);
    }
  }

  if (officialPrice !== null) {
    const realization = Number(process.env.IM_AGENT_LAND_REALIZATION || DEFAULT_REALIZATION);
    methods.official = {
      label: '공시지가 기준',
      pricePerSqm: officialPrice,
      realizationFactor: realization,
      valueEok: toEok(officialPrice * realization, areaSqm),
      basis: `${officialSource} × 현실화계수 ${realization}`,
      assumption: `현실화계수 ${realization}는 시장 통상치 가정이다 (IM_AGENT_LAND_REALIZATION 로 조정)`,
    };
  }

  // ── ② 거래사례비교법 ───────────────────────────────────
  if (parsed && molit.isAvailable()) {
    const months = pnuUtil.recentMonths(TRADE_MONTHS);
    const tr = await molit.trades(parsed.sigunguCd, months, input.tradeType || 'land');
    if (tr.ok) {
      comparables = tr.value
        .filter(t => t.pricePerSqm && t.pricePerSqm > 0)
        .sort((a, b) => (b.dealDate || '').localeCompare(a.dealDate || ''))
        .slice(0, 30);

      const unitPrices = comparables.map(t => t.pricePerSqm);
      const med = median(unitPrices);
      if (med) {
        methods.comparison = {
          label: '거래사례비교법',
          pricePerSqm: Math.round(med),
          sampleCount: unitPrices.length,
          periodMonths: TRADE_MONTHS,
          valueEok: toEok(med, areaSqm),
          basis: `국토교통부 ${tr.label} 실거래가 최근 ${TRADE_MONTHS}개월 ${unitPrices.length}건 중앙값 (시군구 ${parsed.sigunguCd})`,
          assumption: '동일 시군구 단순 중앙값이며 위치·형상·접도 보정을 하지 않았다',
        };
        facts.push({
          key: 'appraisal.market_price_per_sqm', value: Math.round(med), unit: '원/㎡',
          confidence: unitPrices.length >= 5 ? 0.8 : 0.55,
          ...src(`국토교통부 실거래가(${tr.label}, 최근 ${TRADE_MONTHS}개월 ${unitPrices.length}건)`),
        });
        if (unitPrices.length < 5) {
          flags.push({ severity: 'YELLOW', type: 'APPRAISAL_SAMPLE', message: `거래사례가 ${unitPrices.length}건뿐이다 — 비교법 신뢰도가 낮다` });
        }
      }
    } else if (!tr.unavailable) {
      ctx.warn(`실거래가 조회 실패: ${tr.error}`);
    }
  } else if (!molit.isAvailable()) {
    ctx.warn('DATA_GO_KR_KEY 미설정 — 거래사례비교법 생략');
  }

  // ── ③ 수익환원법 ───────────────────────────────────────
  const fin = input.financial;
  const capRate = ds.num('exit.cap_rate');
  if (fin && fin.scenarios && fin.scenarios.base && capRate) {
    const noi = fin.scenarios.base.metrics.noiStabilized;
    const buildingCost = ds.num('investment.construction');
    if (noi && capRate > 0) {
      const assetValue = round((noi / (capRate / 100)), 1);
      const landValue = buildingCost !== null ? round(assetValue - buildingCost, 1) : null;
      methods.income = {
        label: '수익환원법',
        assetValueEok: assetValue,
        buildingValueEok: buildingCost,
        valueEok: landValue,
        basis: `안정화 NOI ${formatEok(noi)} ÷ Cap Rate ${capRate}% − 건물가치(공사비 기준)`,
        assumption: '건물가치를 공사비 원가로 대체했으며 감가상각을 반영하지 않았다',
      };
      if (landValue !== null && landValue <= 0) {
        flags.push({
          severity: 'RED', type: 'APPRAISAL_NEGATIVE',
          message: `수익환원법상 토지 귀속가치가 ${formatEok(landValue)} 로 산출된다 — 사업 수익이 건축비도 회수하지 못하는 구조다`,
        });
      }
    }
  }

  // ── 결론: 사용 가능한 방식의 가중평균 ────────────────────
  const WEIGHTS = { comparison: 0.5, income: 0.3, official: 0.2 };
  const usable = Object.entries(methods)
    .filter(([, m]) => m.valueEok !== null && m.valueEok !== undefined && m.valueEok > 0);

  let concluded = null;
  if (usable.length) {
    const totalWeight = usable.reduce((a, [k]) => a + (WEIGHTS[k] || 0), 0);
    const value = round(usable.reduce((a, [k, m]) => a + m.valueEok * (WEIGHTS[k] || 0), 0) / totalWeight, 1);
    concluded = {
      valueEok: value,
      methodsUsed: usable.map(([k]) => methods[k].label),
      weights: Object.fromEntries(usable.map(([k]) => [methods[k].label, round((WEIGHTS[k] || 0) / totalWeight, 2)])),
      pricePerSqm: Math.round((value * 1e8) / areaSqm),
    };

    for (const [key, m] of usable) {
      facts.push({
        key: `appraisal.land_value_${key === 'official' ? 'official' : key}`,
        value: m.valueEok, unit: '억원', confidence: 0.85, verified: true,
        note: DISCLAIMER, ...src(`감정평가 Agent · ${m.label}`),
      });
    }
    facts.push({
      key: 'appraisal.land_value_concluded', value, unit: '억원',
      confidence: 0.8, verified: true, note: DISCLAIMER,
      ...src(`감정평가 Agent · ${usable.length}방식 가중평균`),
    });

    // 방식 간 편차
    const values = usable.map(([, m]) => m.valueEok);
    const spread = Math.max(...values) / Math.min(...values);
    if (usable.length >= 2 && spread >= 2) {
      flags.push({
        severity: 'RED', type: 'APPRAISAL_SPREAD',
        message: `평가 3방식 간 편차가 ${round(spread, 1)}배다 (${usable.map(([, m]) => `${m.label} ${formatEok(m.valueEok)}`).join(' / ')}) — 가정 재검토 필요`,
      });
    } else if (usable.length >= 2 && spread >= 1.5) {
      flags.push({
        severity: 'YELLOW', type: 'APPRAISAL_SPREAD',
        message: `평가 방식 간 편차 ${round(spread, 1)}배 — 결론값 채택 근거를 IM에 명시해야 한다`,
      });
    }

    // 문서상 토지비와 대조.
    // ★ 평가방식이 1개뿐이면 비교하지 않는다 — 수익환원법 단독값은 Cap Rate 가정에
    //   그대로 끌려다니므로, 그것만으로 '고가/저가 매입'을 단정하면 오경보가 된다.
    const docLandCost = ds.num('investment.land');
    if (usable.length < 2 && docLandCost !== null) {
      flags.push({
        severity: 'YELLOW', type: 'APPRAISAL_SINGLE_METHOD',
        message: `평가방식이 ${usable[0][1].label} 1개뿐이라 토지비 적정성을 판단하지 않았다 — 공시지가(VWORLD_KEY)·실거래가(DATA_GO_KR_KEY) 연동 필요`,
      });
    }
    if (usable.length >= 2 && docLandCost !== null && value > 0) {
      const ratio = docLandCost / value;
      if (ratio >= 1.3) {
        flags.push({
          severity: 'RED', type: 'LAND_OVERPAY',
          message: `사업계획상 토지비 ${formatEok(docLandCost)} 가 참고 평가액 ${formatEok(value)} 의 ${round(ratio, 2)}배다 — 고가 매입 여부 확인 필요`,
        });
      } else if (ratio <= 0.7) {
        flags.push({
          severity: 'YELLOW', type: 'LAND_UNDERPAY',
          message: `사업계획상 토지비 ${formatEok(docLandCost)} 가 참고 평가액 ${formatEok(value)} 대비 현저히 낮다 — 취득조건·특수관계 확인 필요`,
        });
      } else {
        flags.push({
          severity: 'GREEN', type: 'LAND_PRICE',
          message: `토지비 ${formatEok(docLandCost)} 가 참고 평가액 ${formatEok(value)} 범위 내다`,
        });
      }
    }
  } else {
    ctx.warn('감정평가 3방식 모두 산정 불가 — 공시지가·실거래·재무모델 중 최소 1개가 필요하다');
  }

  const confidence = usable.length ? round(0.4 + 0.2 * usable.length, 2) : 0;
  return { methods, concluded, facts, flags, comparables, disclaimer: DISCLAIMER, quota: cache.stats(), confidence };
}

/**
 * 이 Agent 가 공공데이터로 채우는 입력 항목.
 *
 * 개별공시지가는 07 Geo 가 아니라 **여기서** 받아 온다 (`nsdi.landPrice`).
 * 평가 3방식 중 공시지가 기준을 세우려고 어차피 부르므로, 같은 값을 07 에서
 * 한 번 더 부르면 일 10,000건 한도만 축낸다 (CLAUDE.md §4).
 *
 * `appraisal.*` 는 계산 결과라 여기 넣지 않는다 — 입력 대상이 아니다.
 */
const FILLS = ['land.official_price'];

module.exports = {
  id: '08_appraisal', label: 'Appraisal Agent (감정평가)',
  inputSchema, outputSchema, run, median, toEok, DISCLAIMER, FILLS,
};
