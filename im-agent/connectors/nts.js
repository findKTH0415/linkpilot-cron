'use strict';
/**
 * nts.js — 국세청 사업자등록 상태·진위 Connector (등록부 D-60).
 *
 * 무엇에 쓰는가: 법인평가(D-59)와 시행사 대조에서 **「이 회사가 지금도 살아
 * 있는가」**를 확인한다. DART 는 공시대상회사만 수록하고 법인등기는 폐업을
 * 말해 주지 않는다 — **휴업·폐업은 국세청만 안다.**
 *
 * ★★ **여기서 되는 것과 안 되는 것을 분명히 해 둔다.** 이 경계를 흐리면
 *    「API 로 받으면 되겠지」 하고 기다리다 실사가 멈춘다.
 *
 *    되는 것 (이 파일)
 *      · 사업자등록 **상태** — 계속사업자 / 휴업 / 폐업, 과세유형
 *      · 사업자등록 **진위** — 번호·개업일·대표자명이 국세청 자료와 맞는지
 *
 *    **안 되는 것 (어떤 키로도 안 된다)**
 *      · 납세증명(국세완납증명) · 지방세 납세증명 · 체납 내역
 *        → 「국세기본법」 제81조의13 이 과세정보의 제3자 제공을 막는다.
 *          **본인이 발급하거나, 본인 동의를 증명한 제3자만** 신청할 수 있다.
 *          즉 **당사자에게 받아야 하는 서류**이지 우리가 긁을 수 있는 값이 아니다.
 *      · 4대보험 완납증명도 같다 — 당사자 발급이다.
 *
 *    그래서 이 저장소가 할 일은 **「받아야 할 서류」로 남기는 것**이지
 *    조회를 흉내 내는 것이 아니다 (`corp.tax_clearance` 가이드 필드).
 *
 * ★ **사업자등록번호는 법인등록번호가 아니다.** DART 가 주는 것은
 *   `jurir_no`(법인등록번호 13자리)이고, 이 API 가 받는 것은
 *   **사업자등록번호 10자리**다. 섞으면 조회가 실패하는데 **증상이 「없는
 *   회사」와 똑같아서** 원인에 도달하기까지 오래 걸린다.
 *
 * 인증키: `DATA_GO_KR_KEY` (공공데이터포털 — 활용신청 필요)
 *
 * ⚠️ **실제 키로 검증되지 않았다** (등록부 D-60). 이 환경에서는 data.go.kr 이
 *    망 정책으로 막혀 있다 (§4.3).
 */

// ★ 모듈 객체로 붙든다 — 뜯어내면 테스트가 응답을 갈아끼울 수 없다 (M-08)
const http = require('./http');
const { buildUrl, redact, looksUrlEncoded } = http;
const cache = require('./cache');

const PROVIDER = 'data.go.kr';
const BASE = 'https://api.odcloud.kr/api/nts-businessman/v1';

/**
 * 판정 갈래. **`enviro.js` 와 같은 넷이다** — 줄이면 「모름」이 흡수된다.
 */
const STATUS = {
  ACTIVE: 'active',        // 계속사업자
  SUSPENDED: 'suspended',  // 휴업
  CLOSED: 'closed',        // 폐업
  UNKNOWN: 'unknown',      // 조회 못 함 — **「문제 없음」이 아니다**
};

/** 통과로 세도 되는 상태. ★ 휴업·폐업·모름은 여기 없다 */
const CLEARED = [STATUS.ACTIVE];

/** 국세청 응답의 상태 문자열 → 우리 갈래 */
function toStatus(text) {
  const s = String(text || '');
  if (/계속사업자/.test(s)) return STATUS.ACTIVE;
  if (/휴업/.test(s)) return STATUS.SUSPENDED;
  if (/폐업/.test(s)) return STATUS.CLOSED;
  return STATUS.UNKNOWN;
}

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
 * 사업자등록번호를 숫자 10자리로 다듬는다.
 *
 * ★ **13자리가 들어오면 거절한다.** 법인등록번호를 넣은 것이다 — 잘라서
 *   쓰면 엉뚱한 사업자를 조회하고, 그 결과가 문서에 그대로 실린다.
 */
function normalizeBizNo(v) {
  const digits = String(v || '').replace(/\D/g, '');
  if (!digits) return { ok: false, error: '사업자등록번호가 없다' };
  if (digits.length === 13) {
    return {
      ok: false,
      error: '13자리가 들어왔다 — **법인등록번호는 사업자등록번호가 아니다.** '
        + 'DART 가 주는 `jurir_no` 로는 국세청 조회를 할 수 없다 (사업자등록번호 10자리가 필요하다)',
    };
  }
  if (digits.length !== 10) {
    return { ok: false, error: `사업자등록번호는 10자리다 (${digits.length}자리가 들어왔다)` };
  }
  return { ok: true, value: digits };
}

async function post(path, payload, namespace, cacheParams) {
  if (!isAvailable()) {
    return { ok: false, unavailable: true, error: 'DATA_GO_KR_KEY 미설정 — 사업자등록 상태 조회 건너뜀' };
  }
  if (looksUrlEncoded(apiKey())) {
    return { ok: false, error: 'DATA_GO_KR_KEY 가 Encoding 키로 보인다 — Decoding(일반) 키를 넣는다' };
  }

  return cache.through(PROVIDER, namespace, cacheParams, async () => {
    const url = buildUrl(`${BASE}/${path}`, { serviceKey: apiKey() });
    const res = await http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      requestBody: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: mask(res.error) };

    let j;
    try { j = JSON.parse(res.body); } catch (_) {
      return { ok: false, error: '국세청 응답이 JSON 이 아니다 (키·활용신청 확인)' };
    }
    if (j.status_code && j.status_code !== 'OK') {
      return { ok: false, error: mask(`국세청 오류: ${j.status_code}`) };
    }
    const data = Array.isArray(j.data) ? j.data : [];
    return { ok: true, value: { data, matchCnt: j.match_cnt } };
  });
}

/**
 * 사업자등록 **상태** 조회 — 계속사업자·휴업·폐업.
 *
 * ★ **조회가 안 되는 것과 폐업은 다르다.** 국세청에 자료가 없으면 `UNKNOWN`
 *   이고, 그것을 「폐업」으로 읽으면 멀쩡한 회사가 죽는다. 반대도 마찬가지다.
 */
async function status(bizNo) {
  const n = normalizeBizNo(bizNo);
  if (!n.ok) return { ok: false, error: n.error };

  const r = await post('status', { b_no: [n.value] }, 'bizstatus', { b: n.value });
  if (!r.ok) return r;

  const row = (r.value.data || [])[0];
  if (!row) {
    // ★ 「없다」를 「폐업」으로 바꾸지 않는다
    return {
      ok: true,
      value: {
        bizNo: n.value,
        status: STATUS.UNKNOWN,
        raw: null,
        text: '국세청에 조회되지 않는다 — **폐업이라는 뜻이 아니다.** 번호가 틀렸거나 수록 전일 수 있다',
        source: { provider: '국세청', label: '사업자등록 상태조회' },
      },
    };
  }

  const st = toStatus(row.b_stt);
  return {
    ok: true,
    value: {
      bizNo: n.value,
      status: st,
      label: row.b_stt || null,
      taxType: row.tax_type || null,
      closedAt: row.end_dt || null,          // 폐업일
      raw: row,
      text: st === STATUS.ACTIVE
        ? `계속사업자 (${row.tax_type || '과세유형 미상'})`
        : (st === STATUS.CLOSED
          ? `**폐업**${row.end_dt ? ` (${row.end_dt})` : ''} — 사업 성립 여부부터 확인해야 한다`
          : (st === STATUS.SUSPENDED
            ? '**휴업 중** — 계속사업자가 아니다'
            : `상태를 판정하지 못했다 (${row.b_stt || '응답에 상태 없음'})`)),
      source: {
        provider: '국세청',
        label: '사업자등록 상태조회',
        // ★ **조회 시점이 곧 정보다** (§4.7). 어제 계속사업자였다고 오늘도 그런 것은 아니다
        note: '조회 시점의 상태다 — 30분 주기로 갱신되고 신규 사업자는 1~2일 걸린다',
      },
    },
  };
}

/**
 * 사업자등록 **진위** 확인 — 번호·개업일·대표자명이 국세청 자료와 맞는가.
 *
 * ★ **대표자 성명을 저장하지 않는다.** 확인에만 쓰고 결과에 담지 않는다 —
 *   개인 성명이고 이 저장소는 공개다 (`dart.js` 와 같은 규칙, §2·§6-2).
 */
async function verify(o) {
  const opt = o || {};
  const n = normalizeBizNo(opt.bizNo);
  if (!n.ok) return { ok: false, error: n.error };

  const startDt = String(opt.startDate || '').replace(/\D/g, '');
  const name = String(opt.ceoName || '').trim();
  if (startDt.length !== 8 || !name) {
    return {
      ok: false,
      error: '진위확인에는 사업자등록번호·개업일(YYYYMMDD)·대표자명이 모두 필요하다 — '
        + '하나라도 없으면 국세청이 확인해 주지 않는다',
    };
  }

  const r = await post('validate',
    { businesses: [{ b_no: n.value, start_dt: startDt, p_nm: name }] },
    // ★ 캐시 키에 **성명을 넣지 않는다.** 캐시 파일에 평문으로 남는다
    'bizvalidate', { b: n.value, s: startDt });
  if (!r.ok) return r;

  const row = (r.value.data || [])[0];
  const valid = row && row.valid === '01';
  return {
    ok: true,
    value: {
      bizNo: n.value,
      valid: Boolean(valid),
      // ★ 「일치하지 않음」이 「가짜」는 아니다 — 개업일 표기 차이로도 갈린다
      text: valid
        ? '국세청 자료와 일치한다'
        : '국세청 자료와 일치하지 않는다 — **위조라는 뜻은 아니다.** 개업일·상호 표기 차이로도 갈린다',
      source: { provider: '국세청', label: '사업자등록 진위확인' },
    },
  };
}

/**
 * 납세증명·체납 조회 — **하지 않는다. 할 수 없다.**
 *
 * ★ `kepco.substationDistance()` 계열과 같은 자리다. 값을 내려고 둔 함수가
 *   아니라 **못 하는 이유를 코드가 들고 있으려고** 있다. 없으면 「아직 안
 *   붙였나 보다」로 읽히고, 누군가 상용 스크래핑 서비스를 붙이려 든다.
 */
function taxClearance() {
  return {
    ok: false,
    byDesign: true,
    error: '납세증명(국세완납증명)·지방세 납세증명·체납 내역은 **어떤 공개 API 로도 조회할 수 없다** — '
      + '「국세기본법」 제81조의13(비밀 유지)이 과세정보의 제3자 제공을 막는다. '
      + '**본인이 발급하거나 본인 동의를 증명한 제3자만** 신청할 수 있다. '
      + '4대보험 완납증명도 같다. **당사자에게 서류로 받는다** (corp.tax_clearance)',
  };
}

module.exports = {
  status, verify, taxClearance, normalizeBizNo, toStatus,
  isAvailable, mask,
  PROVIDER, BASE, STATUS, CLEARED,
};
