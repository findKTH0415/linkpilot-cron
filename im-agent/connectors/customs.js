'use strict';
/**
 * customs.js — 관세청 수출입무역통계 Connector (제조 딜의 **단가 실거래 대조**).
 *
 * 무엇에 쓰는가: 단가에 붙는 **두 번째** 출처다.
 * 생산자물가(ecos)는 「2년 전 단가가 지금 얼마인가」를 말해 주지만 **지수**라
 * 절대 수준을 말하지 못한다. 무역통계는 금액과 중량을 함께 줘서
 * 「그 품목이 실제로 kg당 몇 달러에 나가는가」를 말한다.
 *
 * ★ **단가를 만든다 — 그런데 나눗셈이 허용되는 경우다.**
 *   금액과 중량은 **둘 다 출처 있는 공표 값**이고, 그 비에는 가정계수가 하나도
 *   안 들어간다. 조달청 낙찰가(g2b)에서 ㎡당 단가를 못 만든 것과 다르다 —
 *   거기서는 분모(연면적)를 우리가 짐작해야 했다. 여기 분모는 통계가 준다.
 *
 * ★ **그런데 이 단가는 딜의 단가가 아니다.** HS 6단위 안에 등급·사양이 크게
 *   다른 제품이 섞인다. 「기타 기계 및 장비」 한 칸에 정밀기계와 단순가공품이
 *   같이 들어간다. 그래서 **대조용이지 채우는 값이 아니다** — fact 로 등록하지 않는다.
 *
 * ★ **수출단가와 내수단가는 다르다.** 수출은 FOB 기준이고 유통구조·물류비·
 *   계약조건이 내수와 다르다. 내수 위주 딜의 단가를 수출단가로 견주면
 *   숫자는 나오는데 견준 것이 아니다 — 그래서 `compare` 가 **판로를 묻고,
 *   내수면 거부한다.**
 *
 * ★ **원화로 바꾸지 않는다** (§4.8). 금액은 달러다. 원화 단가로 바꾸려면
 *   「기간 평균 단가를 어느 날 환율로 바꾸는가」를 정해야 하는데 그것이 가정이다.
 *   태양광에서 일사량까지만 내고 발전량을 안 낸 것과 같은 자리다 (D-25).
 *
 * ★ **중량이 없거나 0 인 품목은 단가를 만들지 않는다.** 무게로 팔지 않는 품목
 *   (기계·장비 다수)은 중량이 통계상 채워져 있어도 의미가 없어 단가가 요동친다.
 *   0 으로 나누면 Infinity 가 나오는데, 화면에서는 그냥 큰 수로 보인다.
 *
 * ★ **HS 코드를 자동으로 고르지 않는다** (§4.9). 딜의 제품 설명에서 HS 코드를
 *   추정하면 틀린 품목의 단가가 그럴듯하게 나온다.
 *
 * ⚠️ **엔드포인트·응답 필드·누적 여부가 실제 키로 검증되지 않았다** (등록부 D-46).
 *    특히 **월별 값이 단월인지 연초 누적인지**가 확인되지 않았다 — 누적을 단월로
 *    읽으면 단가는 맞고 물량만 틀려서 눈에 잘 안 띈다.
 *
 * 인증키: DATA_GO_KR_KEY — data.go.kr 의 **Decoding(일반)** 인증키.
 *         ★ 키가 있어도 **이 API 에 활용신청**이 따로 필요하다 (§4.2).
 *         (관세청 UNIPASS 직접 연동은 또 다른 키를 쓴다 — 그쪽은 D-46 에서 정한다)
 */

// ★ `request` 를 뜯어내지 않고 모듈 객체로 붙든다 (M-08)
const http = require('./http');
const { buildUrl, redact, looksUrlEncoded } = http;
const cache = require('./cache');
const { normalize, num } = require('./xml');

/** ★ 쿼터 버킷은 키 단위로 묶는다 — 한도는 API 별이 아니라 인증키 전체다 */
const PROVIDER = 'data.go.kr';

/** ⚠️ 미검증 — D-46 */
const BASE = 'https://apis.data.go.kr/1220000/nitemtrade';
const OPS = {
  byItem: { path: 'getNitemtradeList', label: '품목별 수출입실적' },
};

/** 수출 / 수입 */
const DIRECTIONS = {
  export: { label: '수출', amount: 'expDlr', weight: 'expWgt' },
  import: { label: '수입', amount: 'impDlr', weight: 'impWgt' },
};

/**
 * 이 단가를 **어떤 딜에 견줄 수 있는가**.
 * 판로를 묻는 이유가 여기 있다 — 묻지 않으면 전부 견줄 수 있는 것처럼 보인다.
 */
const CHANNELS = {
  export: { label: '수출', comparable: true },
  domestic: {
    label: '내수', comparable: false,
    why: '수출단가는 FOB 기준이고 유통구조·물류비·계약조건이 내수와 다르다. '
      + '내수 단가를 수출단가로 견주면 숫자는 나오지만 견준 것이 아니다',
  },
};

function apiKey() {
  return (process.env.DATA_GO_KR_KEY || '').trim();
}

function isAvailable() {
  return Boolean(apiKey());
}

function unavailable(what) {
  return {
    ok: false,
    error: `DATA_GO_KR_KEY 미설정 — ${what || '수출입 단가'} 조회 생략 `
      + '(단가를 실거래로 견줄 곳이 없다)',
    unavailable: true,
  };
}

function mask(text) {
  return redact(text, [apiKey()]);
}

/** HS 코드 정규화 — 숫자만. 4·6·10단위만 받는다 (그 밖은 짐작하지 않는다) */
function hs(code) {
  const t = String(code || '').replace(/[^\d]/g, '');
  return [4, 6, 10].includes(t.length) ? t : '';
}

/** 'YYYY-MM' · 'YYYYMM' → 'YYYYMM' */
function month(v) {
  const t = String(v || '').replace(/[^\d]/g, '');
  return /^\d{6}$/.test(t) ? t : '';
}

/**
 * 응답 해석. **네트워크와 분리해 둔다.**
 */
function parseTrade(body) {
  const j = normalize(body);
  if (!j.ok) return { ok: false, error: mask(`수출입무역통계: ${j.error}`) };

  const rows = (j.items || [])
    .map(x => ({
      // ★ 기간은 **기간 필드에서만** 만든다. 예전에 품목명(statKor)을 대체값으로
      //   두었는데, 품목명이 기간 자리에 들어오는 길을 열어 두는 셈이었다
      //   (month() 가 걸러 내긴 하지만, 거르는 것과 안 넣는 것은 다르다)
      period: month(x.year && x.month
        ? `${x.year}${String(x.month).padStart(2, '0')}`
        : (x.prdDe || x.statMm || '')),
      hsCode: String(x.hsCd || x.hsSgn || '').replace(/[^\d]/g, '') || null,
      name: x.statKor || x.hsCdNm || null,
      exportUsd: num(x.expDlr),
      exportKg: num(x.expWgt),
      importUsd: num(x.impDlr),
      importKg: num(x.impWgt),
    }))
    .filter(x => x.period);

  // ★ 빈 결과는 오류가 아니다 — 「조회 실패」와 「그 기간에 실적이 없다」는
  //   다음에 할 일이 정반대다. 무엇을 뜻하는지는 부르는 쪽이 말한다
  rows.sort((a, b) => a.period.localeCompare(b.period));   // §4.4 — 순서를 믿지 않는다
  return { ok: true, rows };
}

/**
 * 품목별 수출입 실적.
 *
 * @param {object} o { hsCode, from, to }
 */
async function trade(o) {
  const opt = o || {};
  if (!isAvailable()) return unavailable('품목별 수출입실적');

  const code = hs(opt.hsCode);
  if (!code) {
    return {
      ok: false,
      error: 'HS 코드(4·6·10단위)를 지정해야 한다 — 제품 설명에서 자동으로 추정하지 않는다. '
        + '틀린 품목의 단가는 그럴듯하게 나오고 문서에는 「수출입 실적 기준」만 남는다',
    };
  }
  const from = month(opt.from);
  const to = month(opt.to);
  if (!from || !to) return { ok: false, error: '조회 구간(YYYYMM)이 필요하다' };
  if (looksUrlEncoded(apiKey())) {
    return { ok: false, error: 'DATA_GO_KR_KEY 가 Encoding 키로 보인다 (%XX 포함) — Decoding(일반) 키를 넣는다' };
  }

  return cache.through(PROVIDER, 'customs', { code, from, to }, async () => {
    const url = buildUrl(`${BASE}/${OPS.byItem.path}`, {
      serviceKey: apiKey(), type: 'json',
      hsSgn: code, strtYymm: from, endYymm: to,
    });
    const r = await http.request(url);
    if (!r.ok) return { ok: false, error: mask(r.error) };

    const p = parseTrade(r.body);
    if (!p.ok) return p;
    return { ok: true, value: { rows: p.rows, hsCode: code, from, to } };
  }, { ttl: 7 * 86400 });
}

/**
 * kg당 단가 (USD).
 *
 * ★ **기간 합계로 낸다.** 월별 단가를 평균하면 물량이 적은 달이 물량이 많은 달과
 *   같은 무게로 들어가 실제 거래 단가에서 벗어난다. 총액 ÷ 총중량이 맞다.
 *
 * @param {object} o { hsCode, from, to, direction }
 */
async function unitPrice(o) {
  const opt = o || {};
  const dirKey = opt.direction || 'export';
  const dir = DIRECTIONS[dirKey];
  if (!dir) return { ok: false, error: `수출·수입 중 하나여야 한다 (${Object.keys(DIRECTIONS).join(' · ')})` };

  const r = await trade(opt);
  if (!r.ok) return r;

  const rows = r.value.rows;
  if (!rows.length) {
    return {
      ok: false, noData: true,
      error: `HS ${r.value.hsCode}: ${r.value.from}~${r.value.to} 구간에 실적이 없다 `
        + '— **거래가 없다는 뜻일 수도, 코드가 틀렸다는 뜻일 수도 있다**',
    };
  }

  const usdKey = dirKey === 'export' ? 'exportUsd' : 'importUsd';
  const kgKey = dirKey === 'export' ? 'exportKg' : 'importKg';

  // ★ 금액·중량이 **둘 다 있는 달만** 센다. 한쪽만 있는 달을 0 으로 채우면
  //   합계가 조용히 어긋나고 단가가 그만큼 움직인다 (§4.7 결측)
  const used = rows.filter(x => Number.isFinite(x[usdKey]) && Number.isFinite(x[kgKey])
    && x[usdKey] > 0 && x[kgKey] > 0);
  const skipped = rows.length - used.length;

  if (!used.length) {
    return {
      ok: false, noWeight: true,
      error: `HS ${r.value.hsCode} ${dir.label}: 금액과 중량이 함께 있는 달이 없어 단가를 낼 수 없다 `
        + '— 무게로 팔지 않는 품목이면 중량 기준 단가 자체가 의미 없다',
    };
  }

  const totalUsd = used.reduce((a, x) => a + x[usdKey], 0);
  const totalKg = used.reduce((a, x) => a + x[kgKey], 0);
  if (!(totalKg > 0)) {
    return { ok: false, noWeight: true, error: '총중량이 0 이라 단가를 낼 수 없다 (0 으로 나누면 무한대가 나온다)' };
  }

  const usdPerKg = totalUsd / totalKg;

  return {
    ok: true,
    cached: r.cached,
    value: {
      hsCode: r.value.hsCode,
      name: used[used.length - 1].name || null,
      direction: dirKey,
      directionLabel: dir.label,
      usdPerKg: Math.round(usdPerKg * 10000) / 10000,
      // ★ 단위를 값에 붙여 둔다. 떼면 「단가 3.42」가 되고 무엇당인지 사라진다
      unit: 'USD/kg',
      totalUsd: Math.round(totalUsd),
      totalKg: Math.round(totalKg),
      months: used.length,
      skippedMonths: skipped,
      from: used[0].period, to: used[used.length - 1].period,
      // ★ 값만 옮기지 않는다 (§4.7) — 모수·결측·성격을 함께 남긴다
      source: {
        provider: '관세청 수출입무역통계',
        label: `HS ${r.value.hsCode} ${dir.label} 단가`,
        note: `${used[0].period}~${used[used.length - 1].period} ${used.length}개월 합계 `
          + `${Math.round(totalUsd)}USD ÷ ${Math.round(totalKg)}kg = ${Math.round(usdPerKg * 10000) / 10000} USD/kg`
          + (skipped ? ` (금액·중량이 함께 있지 않은 ${skipped}개월 제외)` : '')
          + '. 월별 단가의 평균이 아니라 합계의 비다. '
          + 'HS 코드 안에 등급·사양이 다른 제품이 섞이므로 **딜의 단가가 아니라 대조값**이다. '
          + '원화 환산은 하지 않는다 — 어느 시점 환율을 쓸지가 가정이 된다',
      },
    },
  };
}

/**
 * 딜의 단가를 무역통계 단가와 견준다.
 *
 * ★ **판로를 묻는다.** 내수 위주 딜을 수출단가로 견주면 숫자는 나오지만
 *   견준 것이 아니다 — 기준이 다르다.
 * ★ **단위를 묻는다.** 딜이 톤당·개당으로 말하면 kg당과 그대로 못 뺀다.
 *   톤↔kg 은 순수 환산이라 해 주지만, **개당은 환산이 불가능하다** (개당 무게가 가정).
 *
 * @param {object} deal { price, unit: 'USD/kg'|'USD/ton', channel: 'export'|'domestic' }
 * @param {object} bm unitPrice() 의 value
 */
function compare(deal, bm) {
  const d = deal || {};
  const p = Number(d.price);
  if (!Number.isFinite(p) || p <= 0) return { ok: false, error: '딜의 단가가 숫자가 아니다' };
  if (!bm) return { ok: false, error: '대조값이 없다' };

  const ch = CHANNELS[d.channel];
  if (!ch) {
    return {
      ok: false,
      error: `판로를 밝혀야 한다 (${Object.keys(CHANNELS).join(' · ')}) — `
        + '내수 딜을 수출단가로 견주면 숫자는 나오지만 견준 것이 아니다',
    };
  }
  if (!ch.comparable) {
    return { ok: false, channelMismatch: true, error: `${ch.label} 딜이라 수출입 단가와 견줄 수 없다. ${ch.why}` };
  }

  // 단위 맞추기 — 톤은 환산해 준다(순수 환산), 그 밖은 거부한다
  let perKg;
  if (d.unit === 'USD/kg') perKg = p;
  else if (d.unit === 'USD/ton' || d.unit === 'USD/t') perKg = p / 1000;
  else {
    return {
      ok: false, unitMismatch: true,
      error: `딜 단가의 단위가 '${d.unit || '없음'}' 이라 kg당과 견줄 수 없다. `
        + 'USD/kg 또는 USD/ton 으로 준다 — 개당·리터당은 개당 무게가 가정이라 환산하지 않는다',
    };
  }

  const ratio = perKg / bm.usdPerKg;
  const gapPercent = Math.round((ratio - 1) * 1000) / 10;

  return {
    ok: true,
    value: {
      dealUsdPerKg: Math.round(perKg * 10000) / 10000,
      benchmarkUsdPerKg: bm.usdPerKg,
      ratio: Math.round(ratio * 1000) / 1000,
      gapPercent,
      // 「높다/낮다」까지만. 좋다/나쁘다는 이 커넥터가 판정할 것이 아니다
      direction: gapPercent > 0 ? 'above' : (gapPercent < 0 ? 'below' : 'equal'),
      text: `이 딜의 단가 ${Math.round(perKg * 10000) / 10000} USD/kg 은 `
        + `HS ${bm.hsCode} ${bm.directionLabel} 단가 ${bm.usdPerKg} USD/kg`
        + `(${bm.from}~${bm.to}, ${bm.months}개월 합계 기준)보다 `
        + `${Math.abs(gapPercent)}% ${gapPercent > 0 ? '높다' : gapPercent < 0 ? '낮다' : '같다'}`,
    },
  };
}

module.exports = {
  trade, unitPrice, compare,
  isAvailable, unavailable, mask, parseTrade, hs, month,
  PROVIDER, BASE, OPS, DIRECTIONS, CHANNELS,
};
