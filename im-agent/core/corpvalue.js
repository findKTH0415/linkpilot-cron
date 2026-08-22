'use strict';
/**
 * corpvalue.js — 법인가치 계산과 **하지 않는 계산** (등록부 D-59).
 *
 * `core/deskappraisal.js` 가 토지에 대해 하는 일을 법인에 대해 한다. 구조도 같다 —
 * **법령이 정한 산식은 하고, 가정이 섞이는 것은 거절한다.**
 *
 * ★★ **이 산출물은 평가의견서가 아니다.** 「자본시장과 금융투자업에 관한 법률」상
 *    합병·영업양수도 등의 외부평가는 **외부평가기관(회계법인·신용평가회사·
 *    채권평가회사)만** 할 수 있고, 세무 목적 평가는 세무대리인의 영역이다.
 *    이 파일이 내는 것은 **내부 검토용 참고 수치**다.
 *
 * ★ **법령 산식은 가정이 아니다.** 상속세 및 증여세법 시행령이 정한 보충적
 *   평가방법(순손익가치 3 : 순자산가치 2)은 공표된 규범이라 우리가 지어낸 값이
 *   아니다. **다만 개정된다** — REC 가중치에서 배운 것과 같은 자리다. 그래서
 *   ① 상수에 근거 조문을 적고 ② **보고서가 적용한 산식을 그대로 인쇄한다.**
 *   사람이 현행 법령과 대조할 수 있어야 한다.
 *
 * ★ **자료가 없는 것이 정상이다.** DART 는 공시대상회사만 수록한다 — 딜 상대인
 *   시행사 SPC 는 **원래 거기 없다.** 그때는 문서를 만들지 않는다. 빈 평가서가
 *   나가는 것이 안 나가는 것보다 나쁘다.
 */

const { round } = require('./numeric');

/**
 * 법령이 정한 계수. **값을 지어내지 않았다는 근거를 값 옆에 붙여 둔다.**
 *
 * ⚠️ **개정 여부를 확인해야 한다** (등록부 D-59). 여기 적힌 것은 조문 기준이고,
 *    이 저장소가 관보를 감시하지는 않는다. 보고서가 적용 산식을 인쇄하므로
 *    사람이 대조할 수 있다.
 */
const STATUTE = {
  basis: '상속세 및 증여세법 시행령 제54조 (비상장주식 보충적 평가방법)',
  // 일반 법인 — 순손익가치 3 : 순자산가치 2
  weightsNormal: { income: 3, asset: 2 },
  // 부동산과다보유법인 — **뒤집힌다.** 이 판정 하나가 결과를 바꾼다
  weightsRealEstate: { income: 2, asset: 3 },
  realEstateThresholdPct: 50,
  // 순손익가치 환원율
  capitalizationRate: 10,
  // 최근 3개 연도 가중치 (직전 1년이 가장 무겁다)
  incomeWeights: [3, 2, 1],
  // 순자산가치의 일정 비율을 하한으로 둔다
  floorOfNetAssetPct: 80,
  asOf: '조문 기준 — 개정 여부는 사람이 확인한다',
};

function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;                       // ★ `Number('') === 0` (M-07)
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 최근 3개 연도 순손익액의 가중평균.
 *
 * ★ **세 해를 다 받아야 한다.** 한 해만 있으면 그 해가 곧 수익가치가 되는데,
 *   법령이 3년 가중평균을 쓰는 이유가 바로 그것이다 — 한 해의 특이 손익이
 *   회사 가치가 되어 버린다.
 * ★ **없는 해를 0 으로 세지 않는다.** 0 은 「그 해에 이익이 없었다」는 값이고,
 *   자료가 없는 것과 전혀 다르다. 평균이 조용히 낮아진다.
 */
function weightedIncome(incomes) {
  const list = (incomes || []).map(num);
  const missing = list.map((v, i) => (v === null ? i + 1 : null)).filter(x => x !== null);

  if (list.length < 3 || missing.length) {
    return {
      ok: false,
      error: `최근 3개 연도 순손익액이 모두 있어야 한다 — ${missing.length ? `직전 ${missing.join('·')}년차가 없다` : `${list.length}개 연도만 있다`}. `
        + '**없는 해를 0 으로 세면 평균이 조용히 낮아진다**',
    };
  }

  const w = STATUTE.incomeWeights;
  const sum = list.reduce((a, v, i) => a + v * w[i], 0);
  const totalW = w.reduce((a, b) => a + b, 0);
  const avg = round(sum / totalW, 2);

  return {
    ok: true,
    value: {
      avg,
      years: list,
      weights: w,
      // ★ **손실이면 그 사실을 들고 간다.** 음수 수익가치를 조용히 넘기면
      //   가중평균 결과만 남아 「가치가 있다」로 읽힌다
      negative: avg < 0,
      text: `순손익 가중평균 ${avg}억원 (직전 1·2·3년 ${list.join(' / ')} · 가중치 ${w.join(':')})`,
    },
  };
}

/**
 * 순손익가치 = 순손익 가중평균 ÷ 환원율.
 *
 * ★ **환원율은 법령이 정한 값이라 가정이 아니다.** 우리가 시장에서 골라 온
 *   할인율이 아니다 — 그 구분이 출처에 남아야 한다.
 */
function incomeValue(incomes) {
  const w = weightedIncome(incomes);
  if (!w.ok) return w;

  const rate = STATUTE.capitalizationRate;
  const value = round(w.value.avg / (rate / 100), 1);

  return {
    ok: true,
    value: {
      valueEok: value,
      weighted: w.value,
      rate,
      negative: value < 0,
      basis: `${STATUTE.basis} — 순손익 가중평균 ÷ 환원율 ${rate}%`,
      text: `순손익가치 ${value}억원`
        + (value < 0 ? ' — **음수다.** 최근 3년 가중평균이 손실이라는 뜻이다' : ''),
    },
  };
}

/** 순자산가치. 계산이랄 것이 없다 — **그래서 출처가 전부다** */
function assetValue(netAssetEok) {
  const v = num(netAssetEok);
  if (v === null) return { ok: false, error: '순자산가액이 없다' };
  return {
    ok: true,
    value: {
      valueEok: round(v, 1),
      basis: '재무상태표 자본총계 (제출 자료 또는 공시)',
      // ★ **법령이 말하는 순자산가액은 장부가가 아니라 시가 평가액이다.**
      //   그 차이를 안 적으면 장부가가 그대로 평가액으로 실린다
      caution: '법령상 순자산가액은 **자산을 시가로 평가한 값**이다. 장부가를 그대로 넣었다면 '
        + '토지·건물 등의 평가차액이 반영되지 않은 것이다',
      text: `순자산가치 ${round(v, 1)}억원`,
    },
  };
}

/**
 * 부동산과다보유법인인가 — **자동으로 판정하지 않는다.**
 *
 * ★ 이 판정 하나로 법령이 정한 가중치가 **3:2 에서 2:3 으로 뒤집힌다.** 그런데
 *   판정 기준(자산총액 중 부동산 비율)은 **시가 기준**이고, 자산 구성을 모르면
 *   짐작할 수 없다. 짐작해서 뒤집으면 결과는 그럴듯한데 근거가 없다 (§4.9).
 */
function realEstateHeavy(pct) {
  const v = num(pct);
  if (v === null) {
    return {
      ok: false,
      unknown: true,
      error: '자산 중 부동산 비율을 모른다 — **이 값 하나로 법령이 정한 가중치가 '
        + `${STATUTE.weightsNormal.income}:${STATUTE.weightsNormal.asset} 에서 `
        + `${STATUTE.weightsRealEstate.income}:${STATUTE.weightsRealEstate.asset} 로 뒤집힌다.** 짐작하지 않는다`,
    };
  }
  const heavy = v >= STATUTE.realEstateThresholdPct;
  return {
    ok: true,
    value: {
      heavy,
      pct: v,
      weights: heavy ? STATUTE.weightsRealEstate : STATUTE.weightsNormal,
      text: heavy
        ? `부동산 비율 ${v}% — 부동산과다보유법인 (가중치 ${STATUTE.weightsRealEstate.income}:${STATUTE.weightsRealEstate.asset})`
        : `부동산 비율 ${v}% — 일반 법인 (가중치 ${STATUTE.weightsNormal.income}:${STATUTE.weightsNormal.asset})`,
    },
  };
}

/**
 * 보충적 평가액 = (순손익가치 × w1 + 순자산가치 × w2) ÷ (w1 + w2),
 * 단 순자산가치의 일정 비율을 하한으로 둔다.
 *
 * ★ **가중치를 모르면 계산하지 않는다.** 부동산과다보유 여부가 안 정해지면
 *   어느 산식을 쓸지 정해지지 않는다 — 한쪽을 골라 놓고 「적용됨」으로 남기면
 *   무엇이 빠졌는지 사라진다.
 */
function statutoryValue(o) {
  const opt = o || {};
  const inc = incomeValue([opt.income1, opt.income2, opt.income3]);
  const asset = assetValue(opt.netAsset);
  const heavy = realEstateHeavy(opt.realEstatePct);

  if (!asset.ok) return { ok: false, error: `순자산가치를 못 냈다 — ${asset.error}` };
  if (!inc.ok) return { ok: false, error: `순손익가치를 못 냈다 — ${inc.error}` };
  if (!heavy.ok) return { ok: false, error: heavy.error, unknownWeights: true };

  const w = heavy.value.weights;
  const raw = round((inc.value.valueEok * w.income + asset.value.valueEok * w.asset) / (w.income + w.asset), 1);
  const floor = round(asset.value.valueEok * STATUTE.floorOfNetAssetPct / 100, 1);
  const applied = raw < floor ? floor : raw;

  return {
    ok: true,
    value: {
      valueEok: applied,
      rawEok: raw,
      floorEok: floor,
      floorApplied: raw < floor,
      weights: w,
      income: inc.value,
      asset: asset.value,
      realEstate: heavy.value,
      // ★ **적용한 산식을 그대로 들고 다닌다.** 보고서가 이것을 인쇄해야
      //   사람이 현행 법령과 대조할 수 있다 (§4.7)
      basis: `${STATUTE.basis} — (순손익가치 × ${w.income} + 순자산가치 × ${w.asset}) ÷ ${w.income + w.asset}`
        + `, 순자산가치의 ${STATUTE.floorOfNetAssetPct}% 하한`,
      text: `보충적 평가액 ${applied}억원`
        + (raw < floor ? ` — **하한이 적용됐다** (산식값 ${raw}억원 < 순자산 ${STATUTE.floorOfNetAssetPct}% ${floor}억원)` : ''),
    },
  };
}

/**
 * 시장가치(유사기업 배수) — **내지 않는다.**
 *
 * ★ `kepco.substationDistance()` 계열과 같은 자리다. 값을 내려고 둔 함수가
 *   아니라 **안 내는 이유를 코드가 들고 있으려고** 있다.
 *
 * 왜 못 하는가: 배수법은 **유사기업을 누가 고르느냐**가 결과를 정한다. 같은
 * 업종에서도 상장사 PER 이 배로 갈리고, 비상장 할인율은 또 다른 가정이다.
 * 우리가 고르면 그 선택이 문서에서 **근거처럼** 보인다.
 */
function marketMultipleValue() {
  return {
    ok: false,
    byDesign: true,
    error: '유사기업 배수법을 자동으로 내지 않는다 — **유사기업을 누가 고르느냐가 결과를 정한다.** '
      + '같은 업종에서도 배수가 배로 갈리고 비상장 할인율은 또 다른 가정이다. '
      + '비교대상을 사람이 특정하고 그 근거를 문서에 남긴다',
  };
}

/**
 * 최대주주 할증 — **자동으로 적용하지 않는다.**
 *
 * ★ 할증은 **지분율·중소기업 해당 여부·평가 목적**에 따라 붙기도 안 붙기도 한다.
 *   자동으로 얹으면 평가액이 조용히 커지는데, 문서에는 「할증 적용」이라는 한 줄만
 *   남아 조건을 확인한 것처럼 보인다.
 */
function controlPremium() {
  return {
    ok: false,
    byDesign: true,
    error: '최대주주 할증을 자동으로 적용하지 않는다 — 지분율·중소기업 해당 여부·평가 목적에 '
      + '따라 갈린다. **조건을 확인한 사람이 적용 여부를 정한다**',
  };
}

module.exports = {
  weightedIncome, incomeValue, assetValue, realEstateHeavy, statutoryValue,
  marketMultipleValue, controlPremium,
  STATUTE,
};
