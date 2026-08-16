'use strict';
/**
 * kepco.js — 전력계통 여유 Connector (등록부 D-54).
 *
 * 무엇에 쓰는가: 데이터센터·태양광·풍력 딜에서 `capacity.power_mw`(수전용량)는
 * **딜이 말하는 대로 들어온다.** 그 용량이 계통에 실제로 있는지 확인할 방법이
 * 지금까지 없었다. 제조의 가동률과 같은 자리인데, 이쪽은 **딜브레이커**다 —
 * 계통이 안 받아 주면 사업이 성립하지 않는다.
 *
 * ★ **요구된 것은 둘인데 낼 수 있는 것은 하나다.**
 *
 *   ① **여유용량** — 나온다. `분산전원연계정보`(공공데이터포털 15147381)가
 *      선로별 여유용량을 준다.
 *   ② **변전소 거리** — **못 낸다.** 한전은 변전소 좌표를 **국가중요시설
 *      사유로 비식별 처리**한다. `지역별 공급가능 변전소 정보`(15128065)의
 *      공개 범위는 **행정구역 단위로 「공급 가능한 변전소가 있다/없다」**까지고,
 *      `변전설비현황`(15101530)은 지역본부별 **집계**라 개별 변전소가 아니다.
 *      **거리를 계산할 좌표 자체가 공개되지 않는다.**
 *
 *   그래서 이 파일은 ①을 조회하고, ②는 **거절한다.** 거절하는 함수를 굳이 두는
 *   이유는 하나다 — 없으면 「아직 안 붙였나 보다」로 읽히고, 언젠가 누가
 *   좌표를 짐작해 채운다. **못 하는 이유를 코드가 들고 있어야 한다** (§4.9).
 *
 * ★ **직선거리 ≠ 선로거리.** 실무상 1.3~2배 벌어진다. 사람이 거리를 넣더라도
 *   **인입 공사비는 내지 않는다** — 단가가 가정이다 (§4.8, 태양광 발전량 D-25 와
 *   같은 자리).
 *
 * ★ **여유용량은 시점 스냅샷이다.** 접속 대기열이 실재한다 — 보령 해상풍력은
 *   **2032년 이전 접속 불가** 통보를 받았다. 조회 시점에 여유가 있다는 것이
 *   「접속 가능」을 뜻하지 않는다. **대조값이지 확정값이 아니다.**
 *
 * ★ **「확인 안 됨」이 「문제 없음」이 되면 안 된다.** `enviro.js` 의 네 갈래
 *   판정을 그대로 쓴다 — 딜브레이커에서 「모름」을 통과로 세면 조용히 틀린다.
 *
 * 인증키: **`KEPCO_BIGDATA_KEY`** — 전력데이터개방포털(bigdata.kepco.co.kr)
 *   **자체 발급키**다. 공공데이터포털에 목록이 올라와 있어도 인증은 저쪽에서
 *   한다. **`DATA_GO_KR_KEY` 로는 안 된다** (§4.1 「기관마다 키가 다르고 서로
 *   통용되지 않는다」에 새 행이 는다).
 *
 * ⚠️ **실제 키로 검증되지 않았다** (등록부 D-54). 이 환경에서는 한전·공공데이터
 *    포털 도메인이 전부 망 정책으로 차단되어 있어 **응답 필드가 실측 전이다**
 *    (§4.3). 필드명은 공개 문서 기준이고, 실측에서 바뀔 수 있다.
 */

// ★ `request` 를 뜯어내지 않고 모듈 객체로 붙든다 (M-08)
const http = require('./http');
const { buildUrl, redact, looksUrlEncoded } = http;
const cache = require('./cache');
const { normalize } = require('./xml');

/**
 * ★ 쿼터 버킷을 `data.go.kr` 과 **분리한다.** 한도는 인증키 단위인데 이 키는
 *   아예 다른 포털에서 발급된다 — 같은 버킷에 넣으면 한쪽 소진이 다른 쪽을
 *   막는다. (반대로 같은 키를 두 버킷으로 나누면 한도를 두 배로 쓰게 된다 —
 *   `g2b` 에서 실제로 그랬다)
 */
const PROVIDER = 'kepco';

/** ⚠️ 미검증 — D-54 */
const BASE = 'https://bigdata.kepco.co.kr/openapi/v1';

/** 판정 갈래. **`enviro.js` 와 같은 넷이다** — 여기서 줄이면 「모름」이 흡수된다 */
const STATUS = {
  CONFIRMED: 'confirmed',       // 여유가 요구용량 이상임이 확인됨
  SHORT: 'short',               // 조회는 됐고 여유가 모자람
  UNKNOWN: 'unknown',           // 조회를 못 했음 (키 없음·API 실패·지역 미특정)
  NOT_APPLICABLE: 'n/a',        // 대상이 아님 — **사람만 넣을 수 있다**
};

/** 통과로 세도 되는 상태. ★ 여기에 SHORT·UNKNOWN 을 넣으면 안 된다 */
const CLEARED = [STATUS.CONFIRMED, STATUS.NOT_APPLICABLE];

/**
 * 거리 기준. **어느 쪽인지 모르면 그 값은 쓸 수 없다** — 1.3~2배 갈린다.
 */
const BASIS = {
  STRAIGHT: 'straight',   // 직선거리 (지도상)
  ROUTE: 'route',         // 선로거리 (한전 사전검토 회신)
};

const BASIS_LABEL = {
  [BASIS.STRAIGHT]: '직선거리',
  [BASIS.ROUTE]: '선로거리',
};

function apiKey() {
  return (process.env.KEPCO_BIGDATA_KEY || '').trim();
}

function isAvailable() {
  return Boolean(apiKey());
}

function mask(text) {
  return redact(text, [apiKey()]);
}

/** 빈 문자열이 0 이 되지 않게 거른 뒤 숫자로 (M-07 — `Number('') === 0`) */
function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 선로별 여유용량 조회.
 *
 * ★ **지역을 특정하지 못하면 부르지 않는다.** 전국 값으로 대체하면 문서에는
 *   「적용됨」만 남고 무엇이 빠졌는지 사라진다 (§4.9).
 *
 * @param {object} o { region } — 시·군·구
 * @returns {{ok, value?:{rows, region, source}, error?, unavailable?}}
 */
async function capacity(o) {
  const opt = o || {};
  const region = String(opt.region || '').trim();

  if (!region) {
    return { ok: false, error: '조회할 지역을 특정하지 못했다 — 시·군·구가 필요하다. **전국 값으로 대체하지 않는다**' };
  }
  if (!isAvailable()) {
    return { ok: false, unavailable: true, error: 'KEPCO_BIGDATA_KEY 미설정 — 전력데이터개방포털에서 따로 발급받는다 (data.go.kr 키가 아니다)' };
  }
  if (looksUrlEncoded(apiKey())) {
    return { ok: false, error: 'KEPCO_BIGDATA_KEY 가 Encoding 키로 보인다 — Decoding(일반) 키를 넣는다' };
  }

  // ★ 여유용량은 접속 신청이 들어오면 바뀐다 — 오래 붙들면 옛 여유를 보고 판단한다
  const r = await cache.through(PROVIDER, 'grid', { region }, async () => {
    const url = buildUrl(`${BASE}/distributionCapacity`, {
      apiKey: apiKey(), returnType: 'json', numOfRows: 200, pageNo: 1, addr: region,
    });
    const res = await http.request(url);
    if (!res.ok) return { ok: false, error: mask(res.error) };

    const j = normalize(res.body);
    if (!j.ok) return { ok: false, error: mask(j.error) };
    return { ok: true, value: { items: j.items || [] } };
  });

  if (!r.ok) return r;

  const items = r.value.items || [];
  if (!items.length) {
    return {
      ok: false, noData: true,
      error: `'${region}' 으로 조회된 선로가 없다 — **여유가 없다는 뜻이 아니다.** `
        + '지역 표기가 다르거나 수록 범위 밖일 수 있다',
    };
  }

  const rows = items.map(x => ({
    substation: x.subst_nm || x.substNm || null,
    transformer: x.mtr_nm || x.mtrNm || null,        // 주변압기
    line: x.dl_nm || x.dlNm || null,                 // 배전선로
    // ★ 셋 다 여유가 0보다 커야 접속이 된다 — 하나만 보면 통과처럼 보인다
    substationMw: num(x.subst_cap || x.substCap),
    transformerMw: num(x.mtr_cap || x.mtrCap),
    lineMw: num(x.dl_cap || x.dlCap),
    at: x.base_ym || x.baseYm || null,
  }));

  return {
    ok: true,
    value: {
      region,
      rows,
      cached: r.cached,
      source: {
        provider: '한국전력공사',
        label: '분산전원연계정보',
        // ★ **모수와 시점을 함께 남긴다** (§4.7)
        note: `'${region}' ${rows.length}개 선로. `
          + '**조회 시점의 스냅샷이다** — 접속 대기열이 있어 여유가 곧 접속 가능을 뜻하지 않는다',
      },
    },
  };
}

/**
 * 딜의 수전용량이 계통 여유 안에 들어가는가.
 *
 * ★ **셋을 모두 본다** — 변전소·주변압기·배전선로 중 하나라도 모자라면 접속이
 *   안 된다. 가장 큰 것만 보면 통과처럼 보인다.
 * ★ **「가능하다」고 말하지 않는다.** 낼 수 있는 말은 「지금 여유가 요구보다
 *   크다/작다」까지다 — 대기열은 이 자료에 없다.
 */
function headroom(rows, needMw) {
  const need = num(needMw);
  if (need === null || need <= 0) {
    return { ok: false, error: '수전용량(capacity.power_mw)이 없어 견주지 못했다' };
  }
  const list = (rows || []).filter(r => r && (r.substationMw !== null || r.transformerMw !== null || r.lineMw !== null));
  if (!list.length) {
    return { ok: false, error: '여유용량이 수록된 선로가 없어 견주지 못했다' };
  }

  // 한 선로가 받아 주려면 **셋 중 최소값**이 요구용량 이상이어야 한다
  const scored = list.map((r) => {
    const parts = [r.substationMw, r.transformerMw, r.lineMw].filter(v => v !== null);
    return { row: r, min: parts.length ? Math.min(...parts) : null };
  }).filter(x => x.min !== null);

  if (!scored.length) {
    return { ok: false, error: '여유용량 수치가 비어 있어 견주지 못했다' };
  }

  const best = scored.reduce((a, b) => (b.min > a.min ? b : a));
  const fits = scored.filter(x => x.min >= need);

  return {
    ok: true,
    value: {
      needMw: need,
      bestMw: Math.round(best.min * 100) / 100,
      bestLine: [best.row.substation, best.row.transformer, best.row.line].filter(Boolean).join(' · ') || null,
      fitting: fits.length,
      scanned: scored.length,
      status: fits.length > 0 ? STATUS.CONFIRMED : STATUS.SHORT,
      text: fits.length > 0
        ? `요구 ${need}MW · 여유가 그보다 큰 선로 ${fits.length}/${scored.length}개 `
          + `(최대 ${Math.round(best.min * 100) / 100}MW)`
          + ' — **접속 가능을 뜻하지 않는다.** 대기열은 이 자료에 없다'
        : `요구 ${need}MW · 조회된 ${scored.length}개 선로 모두 여유가 모자라다 `
          + `(최대 ${Math.round(best.min * 100) / 100}MW) — 계통 보강 없이는 이 용량이 앉지 않는다`,
    },
  };
}

/**
 * 변전소 거리 자동 산출 — **하지 않는다.**
 *
 * ★ 이 함수는 값을 내려고 있는 것이 아니라 **못 내는 이유를 코드가 들고 있으려고**
 *   있다. 없으면 「아직 안 붙였나 보다」로 읽히고, 언젠가 누가 좌표를 짐작해
 *   채운다. 짐작한 좌표로 잰 거리는 문서에서 진짜 거리와 구분되지 않는다.
 */
function substationDistance() {
  return {
    ok: false,
    byDesign: true,
    error: '변전소 좌표는 공개되지 않는다 — 한전이 **국가중요시설 사유로 비식별 처리**한다. '
      + '공개 범위는 행정구역 단위 「공급가능 변전소 있음/없음」까지다. '
      + '**거리는 한전 지사 사전검토 회신값을 사람이 넣는다** (crosscheck.substation_km)',
  };
}

/**
 * 사람이 넣은 변전소 거리를 받는다.
 *
 * ★ **기준을 밝히지 않으면 받지 않는다.** 직선거리와 선로거리는 실무상 1.3~2배
 *   벌어진다 — 어느 쪽인지 모르는 「3.2km」는 쓸 수 없는 값이다.
 * ★ **인입 공사비를 내지 않는다.** 거리 × 단가인데 단가가 가정이다 (§4.8).
 */
function humanDistance(o) {
  const opt = o || {};
  const km = num(opt.km);
  const basis = String(opt.basis || '').trim().toLowerCase();
  const name = String(opt.substation || '').trim();

  if (km === null || km <= 0) return { ok: false, error: '거리(km)가 없다' };
  if (!name) return { ok: false, error: '어느 변전소인지 없이 거리만 적을 수 없다' };

  const resolved = /선로|route|실거리/.test(basis) ? BASIS.ROUTE
    : (/직선|straight|지도/.test(basis) ? BASIS.STRAIGHT : null);
  if (!resolved) {
    return {
      ok: false,
      error: '거리 기준(직선/선로)을 밝히지 않았다 — 실무상 1.3~2배 갈린다. '
        + '어느 쪽인지 모르는 거리는 쓰지 않는다',
    };
  }

  return {
    ok: true,
    value: {
      substation: name,
      km,
      basis: resolved,
      basisLabel: BASIS_LABEL[resolved],
      reviewedAt: String(opt.reviewedAt || '').trim() || null,
      text: `${name} ${km}km (${BASIS_LABEL[resolved]})`
        + (resolved === BASIS.STRAIGHT ? ' — **선로거리는 통상 1.3~2배다**' : '')
        + (opt.reviewedAt ? ` · 사전검토 ${String(opt.reviewedAt).trim()} 기준` : ' · 회신일 미상'),
      source: {
        provider: '한국전력공사 지사 사전검토',
        label: '접속가능용량 조회',
        // ★ 출처에 **사람이 넣었다는 사실**을 남긴다 — 자동 조회값과 구분되어야 한다
        note: '공개 API 로는 나오지 않는 값이다 (변전소 좌표 비식별). '
          + '사람이 회신받아 입력했다'
          + (opt.reviewedAt ? '' : ' · **회신일이 없어 언제 기준인지 모른다**'),
      },
      // ★ 공사비는 여기서 끝낸다 (§4.8)
      cost: null,
      costNote: '인입 공사비는 내지 않는다 — 거리 × 단가인데 단가가 가정이다',
    },
  };
}

/**
 * 종합 판정.
 *
 * ★ **`enviro.verdict` 와 같은 규칙이다** — 하나라도 확인 안 되면 통과가 아니고,
 *   그렇다고 「불가」라고도 말하지 않는다. 낼 수 있는 말은 「사람이 확인해야
 *   한다」까지다.
 */
function verdict(items) {
  const list = items || [];
  const mustConfirm = list.filter(x => !CLEARED.includes(x.status));

  return {
    cleared: list.length > 0 && mustConfirm.length === 0,
    mustConfirm: mustConfirm.map(x => ({ kind: x.kind, label: x.label, status: x.status, reason: x.reason })),
    text: list.length === 0
      ? '점검한 항목이 없다'
      : (mustConfirm.length === 0
        ? '조회 시점 기준으로 여유가 요구용량을 넘는다 — **접속 가능을 뜻하지 않는다** (대기열은 이 자료에 없다)'
        : `${mustConfirm.length}개 항목을 사람이 확인해야 한다 — `
          + '**「확인되지 않음」은 「문제 없음」이 아니다.** '
          + mustConfirm.map(x => x.label).join(' · ')),
  };
}

module.exports = {
  capacity, headroom, substationDistance, humanDistance, verdict,
  isAvailable, mask,
  PROVIDER, BASE, STATUS, CLEARED, BASIS, BASIS_LABEL,
};
