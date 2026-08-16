'use strict';
/**
 * enviro.js — 환경 인허가 Connector (제조 딜의 **딜브레이커 점검**).
 *
 * 무엇에 쓰는가: 앞의 넷(생산자물가·가동률·공장등록·수출입단가)은 **숫자를
 * 견준다.** 이것은 **사업이 성립하는지**를 본다. 통합환경허가가 없으면 가동을
 * 못 하고, 배출권 할당대상인데 그 비용이 원가에 없으면 재무모델이 통째로 낙관적이다.
 *
 * ★ **이 커넥터의 위험은 앞의 넷과 반대 방향이다.**
 *
 *   숫자는 없으면 비우면 된다 — 빈칸은 빈칸으로 보인다.
 *   딜브레이커는 **없는 것이 「문제 없음」처럼 보인다.** 조회 결과가 비었을 때
 *   그것을 통과로 읽으면 진짜 결격을 놓치고, 결격으로 읽으면 멀쩡한 딜을 죽인다.
 *   **둘 다 조용히 일어난다.**
 *
 *   그래서 이 파일은 **판정을 세 갈래가 아니라 네 갈래로 둔다.** 「확인됨」과
 *   「없음」 사이에 **「확인되지 않음」**을 두고, 그것을 **통과로 세지 않는다.**
 *
 * ★ **「조회 결과 없음」을 「허가 없음」이라고 말하지 않는다.** 네 가지가 같은
 *   모양으로 온다 — ① 정말 미허가 ② 애초에 대상이 아님 ③ 다른 법인명으로 등록
 *   ④ 자료 수록 범위 밖. 넷을 우리가 가릴 수 없다.
 *
 * ★ **「대상 아님」을 자동으로 붙이지 않는다.** 통합환경허가 대상 여부는 업종과
 *   규모로 정해지는데, 그 판단을 이 커넥터가 할 수 없다. 사람이 확인해서 넣는다.
 *
 * ★ **배출권은 「할당대상이다」까지만 낸다. 비용은 내지 않는다** (§4.8).
 *   비용 = 부족분 × 배출권 가격인데 둘 다 가정이다 — 태양광에서 일사량까지만
 *   내고 발전량을 안 낸 것과 같은 자리다 (D-25).
 *
 * ⚠️ **세 자료 모두 실제 키로 검증되지 않았고, 일부는 API 가 아닐 수 있다**
 *    (등록부 D-47). 특히 **배출권 할당대상업체 명단은 고시(告示)로 공표**되어
 *    API 가 없을 가능성이 있다 — 그러면 이 항목은 영구히 「확인되지 않음」이 된다.
 *
 * 인증키: DATA_GO_KR_KEY — **Decoding(일반)** 인증키. API 별 활용신청 필요 (§4.2).
 */

// ★ `request` 를 뜯어내지 않고 모듈 객체로 붙든다 (M-08)
const http = require('./http');
const { buildUrl, redact, looksUrlEncoded } = http;
const cache = require('./cache');
const { normalize } = require('./xml');

/** ★ 쿼터 버킷은 키 단위로 묶는다 — 한도는 API 별이 아니라 인증키 전체다 */
const PROVIDER = 'data.go.kr';

/** ⚠️ 미검증 — D-47 */
const BASE = 'https://apis.data.go.kr/1480523';

/**
 * 판정 갈래. **넷이다.** 셋으로 줄이면 「확인되지 않음」이 어딘가로 흡수되는데,
 * 어느 쪽으로 흡수되든 조용히 틀린다.
 */
const STATUS = {
  CONFIRMED: 'confirmed',       // 허가·신고가 확인됨
  ABSENT: 'absent',             // 조회는 됐고 기록이 없음 — **미허가라는 뜻이 아니다**
  UNKNOWN: 'unknown',           // 조회를 못 했음 (키 없음·API 실패·사업장 미특정)
  NOT_APPLICABLE: 'n/a',        // 대상이 아님 — **사람만 넣을 수 있다**
};

/** 통과로 세도 되는 상태. ★ 여기에 ABSENT·UNKNOWN 을 넣으면 안 된다 */
const CLEARED = [STATUS.CONFIRMED, STATUS.NOT_APPLICABLE];

/**
 * 점검 항목. 각 항목이 **없을 때 무슨 일이 벌어지는지**를 적어 둔다 —
 * 그것이 이 항목을 왜 보는지의 전부다.
 */
const CHECKS = {
  integrated: {
    label: '통합환경허가',
    why: '대상 업종·규모인데 허가가 없으면 **가동을 못 한다.** 신규 허가에 통상 1년 이상 걸린다',
    op: 'IntegratedPermitService/getPermitList',
    // ★ 대상 여부는 업종·규모로 정해진다 — 우리가 판단하지 않는다
    applicabilityByHuman: true,
  },
  air: {
    label: '대기배출시설 신고·허가',
    why: '미신고 가동은 조업정지·고발 대상이다. 증설 시 종별이 바뀌면 다시 받아야 한다',
    op: 'AirEmissionService/getFacilityList',
    applicabilityByHuman: true,
  },
  water: {
    label: '수질배출시설 신고·허가',
    why: '폐수 배출 공정이 있는데 없으면 가동을 못 한다. 방류수 수질기준이 원가를 좌우한다',
    op: 'WaterEmissionService/getFacilityList',
    applicabilityByHuman: true,
  },
  ets: {
    label: '배출권 할당대상 여부 (K-ETS)',
    why: '할당대상인데 배출권 구입비가 원가에 없으면 **재무모델이 통째로 낙관적이다**',
    op: 'EtsAllocationService/getEntityList',
    applicabilityByHuman: true,
    // ★ 명단이 고시로만 나올 수 있다 — 그러면 영구히 UNKNOWN 이다 (D-47)
    mayNotHaveApi: true,
  },
};

function apiKey() {
  return (process.env.DATA_GO_KR_KEY || '').trim();
}

function isAvailable() {
  return Boolean(apiKey());
}

function mask(text) {
  return redact(text, [apiKey()]);
}

/**
 * 한 항목 조회.
 *
 * ★ **실패를 `ok:false` 로 끝내지 않는다.** 딜브레이커 점검에서 「조회 실패」는
 *   그냥 사라지면 안 되는 사실이다 — `UNKNOWN` 상태로 **남겨서** 사람이 보게 한다.
 */
async function check(kind, o) {
  const opt = o || {};
  const spec = CHECKS[kind];
  if (!spec) return { kind, status: STATUS.UNKNOWN, reason: `모르는 점검 항목: ${kind}` };

  const name = String(opt.name || '').trim();
  if (!name) {
    return { kind, label: spec.label, status: STATUS.UNKNOWN, reason: '사업장을 특정하지 못했다 — 상호가 필요하다' };
  }
  if (!isAvailable()) {
    return { kind, label: spec.label, status: STATUS.UNKNOWN, reason: 'DATA_GO_KR_KEY 미설정 — 조회하지 못했다' };
  }
  if (looksUrlEncoded(apiKey())) {
    return { kind, label: spec.label, status: STATUS.UNKNOWN, reason: 'DATA_GO_KR_KEY 가 Encoding 키로 보인다 — Decoding(일반) 키를 넣는다' };
  }

  const r = await cache.through(PROVIDER, 'enviro', { kind, name, address: opt.address || '' }, async () => {
    const url = buildUrl(`${BASE}/${spec.op}`, {
      serviceKey: apiKey(), type: 'json', numOfRows: 50, pageNo: 1,
      bplcNm: name, addr: opt.address || undefined,
    });
    const res = await http.request(url);
    if (!res.ok) return { ok: false, error: mask(res.error) };

    const j = normalize(res.body);
    if (!j.ok) return { ok: false, error: mask(j.error) };
    return { ok: true, value: { items: j.items || [] } };
  }, { ttl: 7 * 86400 });

  if (!r.ok) {
    // ★ 조회 실패가 「없음」으로 둔갑하지 않는다
    return { kind, label: spec.label, status: STATUS.UNKNOWN, reason: r.error, why: spec.why };
  }

  const items = r.value.items || [];
  if (!items.length) {
    return {
      kind, label: spec.label, status: STATUS.ABSENT, why: spec.why, cached: r.cached,
      // ★ 「없음」이 무엇을 뜻하는지 **매번 함께 낸다.** 한 번 적어 둔 주석은
      //   화면까지 따라오지 않는다
      reason: `'${name}' 으로 조회된 기록이 없다 — **미허가라는 뜻이 아니다.** `
        + '① 정말 미허가 ② 애초에 대상이 아님 ③ 다른 법인명으로 등록 ④ 자료 수록 범위 밖 '
        + '— 넷이 같은 모양으로 온다. 사람이 확인한다',
    };
  }

  return {
    kind, label: spec.label, status: STATUS.CONFIRMED, why: spec.why, cached: r.cached,
    count: items.length,
    records: items.map(x => ({
      name: x.bplcNm || x.entrpsNm || null,
      address: x.addr || x.rnAddr || null,
      permitNo: x.prmisnNo || x.pmitNo || null,
      grade: x.emsnGrade || x.bplcKndNm || null,   // 종별 — 증설 시 바뀐다
      at: x.prmisnDe || x.dclrDe || null,
    })),
    source: {
      provider: '환경부',
      label: spec.label,
      note: `'${name}' 기준 ${items.length}건 확인. `
        + '**같은 이름의 다른 사업장일 수 있다** — 주소로 대조한다',
    },
  };
}

/**
 * 전 항목 점검.
 *
 * ★ 한 항목이 죽어도 나머지를 돌린다 (§4.6). 딜브레이커 점검에서 「하나가 안 돼서
 *   전부 못 봤다」는 가장 나쁜 결과다.
 */
async function screen(o) {
  const opt = o || {};
  const kinds = opt.kinds || Object.keys(CHECKS);
  const items = [];
  for (const k of kinds) {
    // eslint-disable-next-line no-await-in-loop
    items.push(await check(k, opt).catch(e => ({
      kind: k, label: (CHECKS[k] || {}).label || k,
      status: STATUS.UNKNOWN, reason: `점검 중 오류: ${e.message}`,
    })));
  }
  return { ok: true, items, verdict: verdict(items) };
}

/**
 * 종합 판정.
 *
 * ★ **「문제 없음」을 함부로 말하지 않는다.** 한 항목이라도 `ABSENT` 나 `UNKNOWN`
 *   이면 통과가 아니다 — 딜브레이커에서 「모름」은 「괜찮음」이 아니다.
 * ★ 그렇다고 **「결격」이라고도 말하지 않는다.** 우리는 미허가인지 대상이 아닌지
 *   가리지 못한다. 낼 수 있는 말은 **「사람이 확인해야 한다」** 까지다.
 */
function verdict(items) {
  const list = items || [];
  const mustConfirm = list.filter(x => !CLEARED.includes(x.status));
  const naByUs = list.filter(x => x.status === STATUS.NOT_APPLICABLE && !x.byHuman);

  return {
    // 전부 확인됐을 때만 참. 그 밖에는 전부 거짓이다
    cleared: list.length > 0 && mustConfirm.length === 0,
    mustConfirm: mustConfirm.map(x => ({ kind: x.kind, label: x.label, status: x.status, reason: x.reason, why: x.why })),
    // ★ 이 목록이 비어 있지 않으면 코드 어딘가가 「대상 아님」을 자동으로 붙인 것이다
    autoNotApplicable: naByUs.map(x => x.kind),
    text: list.length === 0
      ? '점검한 항목이 없다'
      : (mustConfirm.length === 0
        ? '환경 인허가 항목이 모두 확인되었다'
        : `${mustConfirm.length}개 항목을 사람이 확인해야 한다 — `
          + '**「확인되지 않음」은 「문제 없음」이 아니다.** '
          + mustConfirm.map(x => x.label).join(' · ')),
  };
}

/**
 * 「대상 아님」을 사람이 넣는다.
 *
 * ★ 이 함수를 거치지 않고 `NOT_APPLICABLE` 이 붙는 경로를 만들지 않는다.
 *   대상 여부는 업종·규모로 정해지는데 그 판단을 이 커넥터가 할 수 없다.
 */
function markNotApplicable(item, by, note) {
  if (!by) return { ok: false, error: '누가 판단했는지 없이 「대상 아님」을 붙일 수 없다' };
  if (!note) return { ok: false, error: '근거 없이 「대상 아님」을 붙일 수 없다 (업종·규모 기준을 적는다)' };
  return {
    ok: true,
    value: Object.assign({}, item, {
      status: STATUS.NOT_APPLICABLE,
      byHuman: true,
      reason: `대상 아님 — ${note} (확인: ${by})`,
    }),
  };
}

module.exports = {
  check, screen, verdict, markNotApplicable,
  isAvailable, mask,
  PROVIDER, BASE, STATUS, CLEARED, CHECKS,
};
