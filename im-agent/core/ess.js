'use strict';
/**
 * ess.js — 에너지저장장치(ESS) 고유 셈과 **하지 않는 셈** (등록부 D-56).
 *
 * ESS 는 발전이 아니라 **저장**이다. 태양광·풍력은 자원(일사량·풍속)이 매출의
 * 출발점인데, ESS 는 자원이 없다 — **싸게 사서 비싸게 파는 차익**이거나
 * **계통에 제공하는 서비스 대가**다. 그래서 다른 자산군의 셈이 통하지 않는다.
 *
 * 이 파일이 하는 일은 둘이다.
 *
 *   ① **출처 있는 값끼리의 셈은 한다** — 지속시간·실효용량·열화 후 용량.
 *      셋 다 사업계획서와 보증서에 적혀 오는 값들의 조합이라 가정이 안 섞인다.
 *   ② **가정이 섞이는 셈은 거절한다** — 매출. 사이클 수·왕복효율·단가차가
 *      전부 가정이고, 그 셋을 곱하면 **어떤 숫자든 나온다** (§4.8, D-25 와 같은 자리).
 *
 * ★ **MWh 와 MW 는 짝이다.** 「100MWh ESS」는 사업을 특정하지 못한다 —
 *   100MWh/100MW(1시간)와 100MWh/25MW(4시간)는 **수익모델도 사업비도 다른
 *   사업이다.** 앞은 주파수조정에 쓰고 뒤는 피크저감·재생연계에 쓴다. 하나만
 *   받으면 나머지를 가정으로 메우게 되고, 그러면 어느 사업인지 모른 채 모델이 돈다.
 *
 * ★ **열화가 ESS 고유의 함정이다.** 배터리는 해마다 용량이 준다(통상 2~3%/년).
 *   초기 용량으로 20년 매출을 깔면 후반이 통째로 부풀려지는데, **문서에는 그
 *   사실이 안 남는다** — 매출표는 매년 같은 숫자가 깔려 있어 멀쩡해 보인다.
 */

/** 빈 문자열이 0 이 되지 않게 (M-07 — `Number('') === 0`) */
function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function round2(n) { return n === null ? null : Math.round(n * 100) / 100; }

/**
 * 알려진 수익모델. **자동으로 고르지 않는다** — 무엇으로 버는 사업인지는
 * 계약이 정하는 것이고, 용량비(C-rate)로 짐작하면 틀린다 (§4.9).
 */
const MODELS = [
  { id: 'fr', label: '주파수조정(FR)', hint: '짧고 굵게 — 통상 1시간 이하' },
  { id: 'peak', label: '피크저감(요금차익)', hint: '수요관리 — 통상 2~4시간' },
  { id: 'renewable', label: '재생에너지 연계', hint: '발전 연계 — REC 가중치가 붙는다' },
  { id: 'arbitrage', label: 'SMP 차익거래', hint: '시장가격 차이로 번다' },
];

function modelOf(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return null;
  if (/주파수|frequency|\bfr\b/.test(s)) return MODELS[0];
  if (/피크|peak|수요관리|요금/.test(s)) return MODELS[1];
  if (/재생|연계|태양광|풍력|renewable|rec/.test(s)) return MODELS[2];
  if (/차익|arbitrage|smp/.test(s)) return MODELS[3];
  return null;
}

/**
 * 지속시간(시간) = 저장용량 ÷ 출력용량.
 *
 * ★ **하나만 있으면 내지 않는다.** 나머지를 짐작하면 「4시간짜리」와
 *   「1시간짜리」가 문서에서 구분되지 않는다.
 *
 * @returns {{ok, value?:{hours, cRate, text}, error?}}
 */
function duration(mwh, mw) {
  const e = num(mwh);
  const p = num(mw);
  if (e === null && p === null) return { ok: false, error: '저장용량(MWh)과 출력용량(MW)이 모두 없다' };
  if (e === null) return { ok: false, error: '저장용량(MWh)이 없다 — 출력만으로는 몇 시간짜리인지 모른다' };
  if (p === null) {
    return {
      ok: false,
      error: '출력용량(MW)이 없다 — **「N MWh」만으로는 사업이 특정되지 않는다.** '
        + '같은 용량이라도 1시간짜리와 4시간짜리는 수익모델도 사업비도 다르다',
    };
  }
  if (p <= 0 || e <= 0) return { ok: false, error: '용량이 0 이하다' };

  const hours = e / p;
  return {
    ok: true,
    value: {
      hours: round2(hours),
      // C-rate = 출력/저장. 1C 는 1시간에 다 쓰는 것이다
      cRate: round2(p / e),
      text: `${e}MWh / ${p}MW = ${round2(hours)}시간 (${round2(p / e)}C)`,
    },
  };
}

/**
 * 실효 저장용량 — SOC 상한이 걸리면 정격만큼 못 쓴다.
 *
 * ★ **상한을 모르면 100% 로 치지 않는다.** 국내 ESS 는 화재 이후 충전율 상한
 *   규제를 겪었고, 사업계획서는 **정격 용량으로 적혀 온다.** 「모른다」와
 *   「제한이 없다」는 다르다.
 */
function usable(mwh, socLimit) {
  const e = num(mwh);
  if (e === null) return { ok: false, error: '저장용량(MWh)이 없다' };

  const soc = num(socLimit);
  if (soc === null) {
    return {
      ok: false, unknownLimit: true,
      error: 'SOC 상한을 모른다 — **제한이 없다는 뜻이 아니다.** '
        + '상한이 걸리면 정격 용량을 다 쓰지 못하는데 사업계획서는 정격으로 적혀 온다',
    };
  }
  if (soc <= 0 || soc > 100) return { ok: false, error: `SOC 상한이 범위를 벗어난다 (${soc}%)` };

  return {
    ok: true,
    value: {
      mwh: round2(e * soc / 100),
      ratedMwh: e,
      socLimit: soc,
      text: soc >= 100
        ? `실효 ${round2(e)}MWh (SOC 제한 없음)`
        : `실효 ${round2(e * soc / 100)}MWh — 정격 ${e}MWh 의 ${soc}%`,
    },
  };
}

/**
 * N년 뒤 남은 용량.
 *
 * ★ **열화율은 보증서에 적혀 오는 값이라 가정이 아니다.** 그래서 이 셈은 한다.
 *   다만 **매출로 넘어가지 않는다** — 용량이 줄었다고 매출이 그 비율로 주는지는
 *   계약이 정한다 (용량보증·교체 조항이 있으면 다르다).
 * ★ 열화율을 **모르면 내지 않는다.** 0 으로 두면 20년 내내 새 배터리가 된다.
 */
function capacityAfter(mwh, degradationPctPerYear, years) {
  const e = num(mwh);
  const d = num(degradationPctPerYear);
  const y = num(years);
  if (e === null) return { ok: false, error: '저장용량(MWh)이 없다' };
  if (d === null) {
    return {
      ok: false,
      error: '연간 열화율이 없다 — **0 으로 두면 20년 내내 새 배터리가 된다.** '
        + '보증서의 용량저하율을 넣는다',
    };
  }
  if (y === null || y < 0) return { ok: false, error: '연수가 없다' };

  const left = e * Math.pow(1 - d / 100, y);
  return {
    ok: true,
    value: {
      mwh: round2(left),
      ratio: round2(left / e * 100),
      years: y,
      text: `${y}년 뒤 ${round2(left)}MWh (초기의 ${round2(left / e * 100)}%)`,
      // ★ 용량이 준 것과 매출이 준 것은 다르다 — 계약이 정한다
      note: '용량 감소가 매출 감소와 같은지는 계약이 정한다 (용량보증·교체 조항)',
    },
  };
}

/**
 * 운영기간 전체의 용량 곡선. **매출표를 초기 용량으로 깔지 않게 하려고 있다.**
 */
function degradationCurve(mwh, degradationPctPerYear, opsYears) {
  const y = num(opsYears);
  if (y === null || y <= 0) return { ok: false, error: '운영기간이 없다' };

  const rows = [];
  for (let i = 0; i <= Math.floor(y); i++) {
    const r = capacityAfter(mwh, degradationPctPerYear, i);
    if (!r.ok) return r;
    rows.push({ year: i, mwh: r.value.mwh, ratio: r.value.ratio });
  }
  const last = rows[rows.length - 1];
  return {
    ok: true,
    value: {
      rows,
      text: `${Math.floor(y)}년 차 ${last.mwh}MWh (초기의 ${last.ratio}%) — `
        + '**초기 용량으로 전 기간 매출을 깔면 후반이 부풀려진다**',
    },
  };
}

/**
 * 매출 — **내지 않는다.**
 *
 * ★ `kepco.substationDistance()` · `kma.hubWindSpeed()` 와 같은 자리다. 값을
 *   내려고 둔 함수가 아니라 **안 내는 이유를 코드가 들고 있으려고** 있다.
 *
 * 왜 못 하는가: ESS 매출 = 용량 × **연간 사이클 수** × **왕복효율** ×
 * **단가차**다. 뒤의 셋이 전부 가정이다.
 *   - 사이클 수는 운전 전략이 정한다 (하루 1회냐 2회냐가 매출을 배로 가른다)
 *   - 왕복효율은 85~92% 로 갈리고 열화와 함께 더 떨어진다
 *   - 단가차는 시장가격이라 미래값이 없다
 *
 * 셋을 곱하면 **어떤 숫자든 만들 수 있다.** 그리고 결과는 언제나 그럴듯하다.
 */
function revenue() {
  return {
    ok: false,
    byDesign: true,
    error: 'ESS 매출을 자동으로 내지 않는다 — 사이클 수·왕복효율·단가차가 전부 가정이고 '
      + '셋을 곱하면 어떤 숫자든 나온다. **사업계획서의 매출 가정을 사람이 넣고, '
      + '우리는 용량·지속시간·열화로 그 가정이 물리적으로 가능한지만 견준다** (§4.8)',
  };
}

/**
 * 사업계획서가 말하는 매출이 **물리적으로 가능한 범위 안인가.**
 *
 * ★ 매출을 만들지 않는다. **상한만 말한다** — 하루 한 번도 못 채우는 용량으로
 *   그만큼 벌 수는 없다는 것은 가정 없이 알 수 있다.
 * ★ 「가능하다」고 말하지 않는다. 낼 수 있는 말은 「그 매출을 내려면 하루 N회
 *   돌아야 한다」까지다 — N 이 현실적인지는 사람이 판단한다.
 */
function cyclesNeeded(o) {
  const opt = o || {};
  const mwh = num(opt.mwh);
  const annualMwhSold = num(opt.annualMwhSold);
  if (mwh === null || annualMwhSold === null) {
    return { ok: false, error: '저장용량과 연간 방전량이 모두 있어야 견준다' };
  }
  if (mwh <= 0) return { ok: false, error: '저장용량이 0 이하다' };

  const cycles = annualMwhSold / mwh;
  const perDay = cycles / 365;
  return {
    ok: true,
    value: {
      cyclesPerYear: round2(cycles),
      cyclesPerDay: round2(perDay),
      // ★ 판정하지 않는다. **몇 회 돌아야 하는지만** 말한다
      text: `그 매출을 내려면 연 ${round2(cycles)}회 · 하루 ${round2(perDay)}회 돌아야 한다`
        + ' — 운전 전략·보증 사이클과 견주는 것은 사람이 한다',
    },
  };
}

module.exports = {
  duration, usable, capacityAfter, degradationCurve, revenue, cyclesNeeded,
  modelOf, MODELS,
};
