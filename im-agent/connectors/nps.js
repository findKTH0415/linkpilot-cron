'use strict';
/**
 * nps.js — 국민연금 가입 사업장 Connector (등록부 D-60).
 *
 * 무엇에 쓰는가: 법인평가(D-59)에서 **「이 회사에 실체가 있는가」**를 본다.
 * 재무제표는 회사가 만든 숫자이고 등기는 껍데기만 말한다. 국민연금 사업장
 * 자료는 **가입자 수와 당월 고지금액**을 주는데, 이것은 회사가 만든 숫자가
 * 아니라 **공단이 부과한 금액**이다 — 두 번째 출처로서 값이 있다.
 *
 * ★★ **가입자 0명이 부실이 아니다.** SPC 는 원래 직원이 없다. 이 자료를
 *    「직원이 없으니 이상하다」로 읽으면 **정상적인 프로젝트 금융 구조를
 *    결함으로 만든다.** 그래서 이 커넥터는 **판정하지 않는다** — 숫자와
 *    그 숫자가 무엇을 뜻하는지까지만 낸다.
 *
 * ★ 수록 범위가 정해져 있다: **가입자 3인 이상 법인사업장**(개인사업장은 더
 *   큰 기준). 그 아래는 **원래 목록에 없다** — 「조회 안 됨」이 「없는 회사」가
 *   아니다. `dart.js` 의 `notFound` 와 같은 자리다.
 *
 * ★ **동명 사업장이 흔하다.** 여러 건이 나오면 **하나를 고르지 않는다** —
 *   엉뚱한 회사의 인원·급여가 실사 보고서에 실리는 것이 안 싣는 것보다 나쁘다.
 *
 * 인증키: `DATA_GO_KR_KEY` (공공데이터포털 — 활용신청 필요)
 *
 * ⚠️ **실제 키로 검증되지 않았다** (등록부 D-60). 응답 필드명은 공개 문서
 *    기준이고 이 환경에서는 data.go.kr 이 망 정책으로 막혀 있다 (§4.3).
 */

const http = require('./http');
const { buildUrl, redact, looksUrlEncoded } = http;
const cache = require('./cache');
const { normalize } = require('./xml');

/* ★ 쿼터 통을 **갈래로 나눈다** 〈2026-08-23 · D-85〉. data.go.kr 은 상세기능마다
   하루치를 세는데(개발계정 1,000), 앞 판은 아홉 커넥터가 `data.go.kr` 한 통을
   같이 썼다 — 한 곳이 다 쓰면 나머지 여덟이 함께 막힌다. `cache.js` 참고. */
const PROVIDER = 'data.go.kr:nps';
const BASE = 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireService';

function apiKey() {
  return (process.env.DATA_GO_KR_KEY || '').trim();
}

function isAvailable() {
  return Boolean(apiKey());
}

function mask(text) {
  return redact(text, [apiKey()]);
}

/** 빈 문자열이 0 이 되지 않게 (M-07 — `Number('') === 0`) */
function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeName(name) {
  return String(name || '')
    .replace(/\(주\)|\(유\)|주식회사|유한회사|㈜/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * 사업장 검색.
 *
 * ★ **하나를 고르지 않는다.** 동명 사업장이 여럿이면 후보를 돌려주고 사람이
 *   특정한다 (§4.9 · `factory.js` 와 같은 규칙).
 */
async function findWorkplace(name) {
  const want = normalizeName(name);
  if (!want) return { ok: false, error: '사업장명이 없다' };
  if (!isAvailable()) {
    return { ok: false, unavailable: true, error: 'DATA_GO_KR_KEY 미설정 — 국민연금 사업장 조회 건너뜀' };
  }
  if (looksUrlEncoded(apiKey())) {
    return { ok: false, error: 'DATA_GO_KR_KEY 가 Encoding 키로 보인다 — Decoding(일반) 키를 넣는다' };
  }

  const r = await cache.through(PROVIDER, 'npsworkplace', { n: want }, async () => {
    const url = buildUrl(`${BASE}/getBassInfoSearch`, {
      serviceKey: apiKey(), wkpl_nm: String(name).trim(), numOfRows: 50, pageNo: 1,
    });
    const res = await http.request(url);
    if (!res.ok) return { ok: false, error: mask(res.error) };
    const j = normalize(res.body);
    if (!j.ok) return { ok: false, error: mask(j.error) };
    return { ok: true, value: { items: j.items || [] } };
  });

  if (!r.ok) return r;

  const rows = (r.value.items || []).map(x => ({
    seq: x.seq || x.SEQ || null,
    name: x.wkplNm || x.wkpl_nm || null,
    address: x.wkplRoadNmDtlAddr || x.wkplJnngStcd || x.addr || null,
    bizNo: x.bzowrRgstNo || null,          // 사업자등록번호 앞 6자리만 공개되는 경우가 있다
  }));

  if (!rows.length) {
    // ★ **수록 범위 밖인 것이 정상이다.** 「없는 회사」로 읽히면 안 된다
    return {
      ok: false, notFound: true,
      error: `'${name}' 으로 조회된 사업장이 없다 — **회사가 없다는 뜻이 아니다.** `
        + '이 자료는 **가입자 3인 이상 법인사업장**부터 수록한다. SPC 는 원래 여기 없다',
    };
  }

  const exact = rows.filter(x => normalizeName(x.name) === want);
  const pick = exact.length ? exact : rows;
  if (pick.length > 1) {
    return {
      ok: false, ambiguous: true, candidates: pick.slice(0, 10),
      error: `'${name}' 으로 ${pick.length}건이 나왔다 — **고르지 않는다.** `
        + '엉뚱한 회사의 인원·급여가 실사 보고서에 실리는 것이 안 싣는 것보다 나쁘다',
    };
  }

  return { ok: true, value: pick[0] };
}

/**
 * 사업장 상세 — 가입자 수와 당월 고지금액.
 *
 * ★ **판정하지 않는다.** 인원이 적다·많다를 우리가 말하면 그것이 근거가 된다.
 *   SPC 는 직원이 없는 것이 정상이고, 시행사는 몇 명이 정상인지 딜마다 다르다.
 */
async function workplaceDetail(seq) {
  if (!seq) return { ok: false, error: '사업장 식별자(seq)가 없다' };
  if (!isAvailable()) return { ok: false, unavailable: true, error: 'DATA_GO_KR_KEY 미설정' };

  const r = await cache.through(PROVIDER, 'npsdetail', { s: String(seq) }, async () => {
    const url = buildUrl(`${BASE}/getDetailInfoSearch`, { serviceKey: apiKey(), seq });
    const res = await http.request(url);
    if (!res.ok) return { ok: false, error: mask(res.error) };
    const j = normalize(res.body);
    if (!j.ok) return { ok: false, error: mask(j.error) };
    return { ok: true, value: { items: j.items || [] } };
  });

  if (!r.ok) return r;
  const x = (r.value.items || [])[0];
  if (!x) return { ok: false, noData: true, error: '사업장 상세가 비어 있다' };

  const members = num(x.jnngpCnt || x.jnngp_cnt);
  const monthly = num(x.crrmmNtcAmt || x.crrmm_ntc_amt);

  return {
    ok: true,
    value: {
      name: x.wkplNm || null,
      members,
      monthlyNoticeKrw: monthly,
      joinedAt: x.adptDt || null,
      industry: x.vldtVlKrnNm || null,
      // ★ **판정이 아니라 뜻풀이다.** 「적다/많다」를 말하지 않는다
      text: [
        members === null ? '가입자 수 미확인' : `가입자 ${members.toLocaleString('ko-KR')}명`,
        monthly === null ? null : `당월 고지 ${monthly.toLocaleString('ko-KR')}원`,
      ].filter(Boolean).join(' · ')
        + ' — **인원이 적은 것이 결함은 아니다.** SPC 는 직원이 없는 것이 정상이다',
      source: {
        provider: '국민연금공단',
        label: '국민연금 가입 사업장 내역',
        // ★ 고지금액은 상한이 걸린 값이다 — 그걸 안 적으면 급여 총액으로 읽힌다
        note: '당월 고지금액은 **기준소득월액 상한**이 적용된 값이라 급여 총액이 아니다. '
          + '수록 범위는 가입자 3인 이상 법인사업장이다',
      },
    },
  };
}

/**
 * 4대보험 완납증명 — **하지 않는다. 할 수 없다.**
 *
 * ★ `nts.taxClearance()` 와 같은 자리다. 완납증명은 **당사자 발급**이다.
 */
function insuranceClearance() {
  return {
    ok: false,
    byDesign: true,
    error: '4대보험 완납증명은 **공개 API 로 조회할 수 없다** — 당사자가 발급받는 서류다. '
      + '가입 사업장 내역(인원·고지금액)은 공개되지만 **납부 여부는 공개되지 않는다.** '
      + '**당사자에게 서류로 받는다**',
  };
}

module.exports = {
  findWorkplace, workplaceDetail, insuranceClearance, normalizeName,
  isAvailable, mask,
  PROVIDER, BASE,
};
