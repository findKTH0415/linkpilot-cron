'use strict';
/**
 * solar.js — 태양광 고유 셈과 **하지 않는 셈** (등록부 D-58).
 *
 * `core/ess.js` 와 같은 구조다 — 출처 있는 값끼리의 셈은 하고, 가정이 섞이는
 * 셈은 **거절한다.** 태양광에서 거절해야 하는 자리는 셋이고, 셋 다 **결과가
 * 그럴듯해서** 문서만 봐서는 안 잡힌다.
 *
 *   ① **수평면 일사량 → 경사면 일사량.** 기상청이 주는 것은 수평면(GHI)이고
 *      모듈은 기울어져 있다. 변환에는 경사각·방위각·알베도·확산광 모델이 들어가는데
 *      **모델을 무엇으로 잡느냐가 결과를 몇 %씩 흔든다.** 그리고 나온 값은
 *      실측 경사면 일사량과 구분되지 않는다.
 *   ② **발전량.** 시스템효율(PR)이 가정이다 — 2026-08-15 에 이미 결정된 것이고
 *      (D-25) 여기서 코드로 못 박는다.
 *   ③ **REC 가중치.** 부지 유형·용량 구간·설치 형태로 갈리는데, 그 값은
 *      **고시가 정하고 개정된다.** 코드에 숫자를 박으면 개정된 날부터 조용히 틀린다.
 *
 * ★ **DC 와 AC 는 짝이다.** ESS 의 MWh/MW 와 같은 자리다. 「1MW 태양광」만으로는
 *   사업이 특정되지 않는다 — DC 1.0MW/AC 1.0MW 와 DC 1.3MW/AC 1.0MW 는
 *   **모듈 값도 발전량도 다르다.** 뒤쪽은 맑은 날 정오에 인버터가 잘라 낸다(클리핑).
 */

const { round } = require('./numeric');

function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;                     // ★ `Number('') === 0` (M-07)
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 부지 유형. **가중치 값을 적지 않는다** — 고시가 정하고 개정된다.
 * 여기 적는 것은 **어느 축에서 갈리는가**까지다.
 */
const LAND_KINDS = [
  { id: 'forest', label: '임야', match: /임야|산지|forest/i, caution: '**가중치가 가장 불리하게 매겨지는 유형이다.** 산지전용·복구의무도 함께 걸린다' },
  { id: 'farm', label: '농지', match: /농지|전답|田|畓|farm/i, caution: '농지전용부담금과 영농형 여부에 따라 조건이 갈린다' },
  { id: 'building', label: '건축물', match: /건축물|지붕|옥상|roof|building/i, caution: '건축물 설치는 별도 축으로 매겨진다 — 구조 안전 검토가 따라온다' },
  { id: 'water', label: '수상', match: /수상|저수지|해상|water|float/i, caution: '수면 점용허가가 성립 조건이다' },
  { id: 'etc', label: '잡종지·기타', match: /잡종|나대지|기타/i, caution: null },
];

/** 부지 유형을 읽는다. **못 읽으면 고르지 않는다** (§4.9) */
function landKind(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  return LAND_KINDS.find(k => k.match.test(s)) || null;
}

/**
 * DC/AC 과적률.
 *
 * ★ **하나만 있으면 내지 않는다.** 「1MW 태양광」은 사업을 특정하지 못한다 —
 *   DC 를 AC 보다 얼마나 크게 깔았는지가 모듈 값과 발전량을 함께 바꾼다.
 * ★ **「적정/부적정」을 말하지 않는다.** 과적은 설계 선택이고, 얼마가 맞는지는
 *   일사 조건과 단가가 정한다. 우리가 낼 수 있는 말은 **「잘리는 구간이 생긴다」**까지다.
 */
function overloadRatio(dcKw, acKw) {
  const dc = num(dcKw);
  const ac = num(acKw);

  if (dc === null && ac === null) return { ok: false, error: 'DC·AC 용량이 모두 없다' };
  if (ac === null) {
    return {
      ok: false,
      error: 'AC(인버터) 용량이 없다 — **「N MW 태양광」만으로는 사업이 특정되지 않는다.** '
        + 'DC 를 AC 보다 크게 깔았는지가 모듈 값과 발전량을 함께 바꾼다',
    };
  }
  if (dc === null) return { ok: false, error: 'DC(모듈) 용량이 없다' };
  if (dc <= 0 || ac <= 0) return { ok: false, error: '용량이 0 이하다' };

  const ratio = round(dc / ac, 2);
  return {
    ok: true,
    value: {
      ratio,
      dcKw: dc,
      acKw: ac,
      // ★ 판정이 아니라 **무슨 일이 일어나는지**를 적는다
      clipping: ratio > 1,
      text: ratio > 1
        ? `DC/AC ${ratio} — 맑은 날 정오에 인버터가 **잘라 낸다(클리핑).** `
          + '발전량을 DC 용량으로 곱해 두면 그만큼 부풀려진다'
        : (ratio < 1
          ? `DC/AC ${ratio} — 인버터가 모듈보다 크다. 용량이 남는 설계다`
          : `DC/AC ${ratio} — 과적 없음`),
    },
  };
}

/**
 * 경사면 일사량 — **내지 않는다.**
 *
 * ★ `kma.hubWindSpeed()` · `kepco.substationDistance()` 와 같은 자리다.
 *   값을 내려고 둔 함수가 아니라 **안 내는 이유를 코드가 들고 있으려고** 있다.
 */
function planeOfArrayIrradiance() {
  return {
    ok: false,
    byDesign: true,
    error: '수평면 일사량(GHI)을 경사면(POA)으로 변환하지 않는다 — 경사각·방위각·알베도·'
      + '확산광 모델이 들어가고 **모델 선택이 결과를 몇 %씩 흔든다.** '
      + '그리고 나온 값은 실측 경사면 일사량과 문서에서 구분되지 않는다. '
      + '**설계사 산출값(PVsyst 등)을 사람이 넣는다**',
  };
}

/**
 * 발전량 — **내지 않는다** (2026-08-15 결정, 등록부 D-25).
 *
 * ★ 결정은 이미 있었는데 **코드에 그 자리가 없었다.** 결정만 문서에 있고
 *   코드에 없으면, 언젠가 「간단한 곱셈인데」 하고 누가 붙인다.
 */
function generation() {
  return {
    ok: false,
    byDesign: true,
    error: '발전량을 자동으로 내지 않는다 (등록부 D-25) — 발전량 = 일사량 × 설비용량 × '
      + '**시스템효율(PR)** 인데 PR 이 가정치(통상 75~85%)고, 그 10%p 가 매출을 그대로 흔든다. '
      + '**설계사 산출값을 사람이 넣고, 우리는 일사량까지만 낸다**',
  };
}

/**
 * REC 가중치 — **값을 내지 않는다. 어느 축에서 갈리는지만 말한다.**
 *
 * ★ 가중치는 **고시가 정하고 개정된다.** 코드에 숫자를 박으면 개정된 날부터
 *   조용히 틀리는데, 문서에는 「가중치 적용됨」만 남아 무엇이 틀렸는지 사라진다.
 * ★ 그렇다고 아무 말도 안 하면 **임야 딜이 유리한 가중치로 계산된 채 넘어간다.**
 *   그래서 **갈리는 축과 이 딜이 걸리는 자리**까지는 말한다.
 */
function recWeightAxes(o) {
  const opt = o || {};
  const kind = landKind(opt.landCategory);
  const dc = num(opt.dcKw);

  const axes = [
    { axis: '부지 유형', here: kind ? kind.label : '미확인', note: kind ? kind.caution : '부지 유형을 밝히지 않았다 — **가중치를 가르는 첫 축이다**' },
    { axis: '설비 용량', here: dc === null ? '미확인' : `${dc.toLocaleString('ko-KR')} kW`, note: '용량 구간마다 가중치가 다르게 매겨진다' },
    { axis: '설치 형태', here: '미확인', note: '지상·건축물·수상·영농형이 각각 다른 축이다' },
  ];

  return {
    ok: true,
    value: {
      axes,
      // ★ **값을 내지 않는다는 사실**이 결과에 실려야 한다
      weight: null,
      text: '가중치 값은 산출하지 않는다 — **고시가 정하고 개정된다.** '
        + '위 세 축을 확인해 신재생원 고시에서 확인한다'
        + (kind && kind.id === 'forest' ? ' · **임야다 — 가중치가 가장 불리한 유형이다**' : ''),
    },
  };
}

/**
 * 부지면적이 용량을 담을 수 있는가.
 *
 * ★ **「가능/불가능」을 말하지 않는다.** 필요한 면적은 경사·이격·배치가 정한다.
 *   낼 수 있는 말은 **「지금 면적이면 kW당 N㎡」**까지고, 그 수치가 통상보다
 *   빡빡한지는 사람이 본다.
 */
function areaPerKw(areaSqm, dcKw) {
  const a = num(areaSqm);
  const dc = num(dcKw);
  if (a === null || dc === null) return { ok: false, error: '부지면적과 DC 용량이 모두 있어야 견준다' };
  if (dc <= 0) return { ok: false, error: 'DC 용량이 0 이하다' };

  const per = round(a / dc, 2);
  return {
    ok: true,
    value: {
      sqmPerKw: per,
      text: `부지 ${a.toLocaleString('ko-KR')}㎡ / DC ${dc.toLocaleString('ko-KR')}kW = kW당 ${per}㎡`
        + ' — 필요한 면적은 경사·이격·배치가 정한다. 통상치와 견주는 것은 사람이 한다',
    },
  };
}

module.exports = {
  overloadRatio, planeOfArrayIrradiance, generation, recWeightAxes, areaPerKw,
  landKind, LAND_KINDS,
};
