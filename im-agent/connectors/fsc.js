'use strict';
/**
 * fsc.js — 금융위원회 기업기본정보(data.go.kr) Connector.
 *
 *   ① 기업개요   법인명 → 법인등록번호·설립일·상장시장·감사의견
 *
 * ★ 쓰임: **시행사 실체 확인**이다. `project.sponsor` 는 필수 직접 입력 8칸 중
 *   하나이고, 투자자가 가장 먼저 확인하는 항목이다. 사람이 적은 이름이 실재하는
 *   법인인지, 업력이 얼마인지, 감사의견이 적정인지를 독립된 출처로 대조한다.
 *
 * ★ **대표자 성명(enpRprFnm)은 가져오지 않는다.** 개인정보이고, PDI 하우스
 *   스타일이 대외 문서에 개인 성명을 넣지 않는다 (CLAUDE.md §6). 응답에는
 *   들어 있지만 여기서 버린다 — 위에서 거르면 아래 어딘가로 새어 나간다.
 *
 * ★ **이름이 겹치면 고르지 않는다.** '롯데케미칼' 로 22건이 나온다. 첫 건을
 *   집으면 틀린 법인이 IM 에 들어가고, 그 오류는 문서만 보고는 못 잡는다.
 *   정확히 일치하는 것이 하나일 때만 확정하고, 아니면 후보를 그대로 돌려준다.
 *
 * 인증키: DATA_GO_KR_KEY
 */

const { request, buildUrl, redact, looksUrlEncoded } = require('./http');
const cache = require('./cache');

/* ★ 쿼터 통을 **갈래로 나눈다** 〈2026-08-23 · D-85〉. data.go.kr 은 상세기능마다
   하루치를 세는데(개발계정 1,000), 앞 판은 아홉 커넥터가 `data.go.kr` 한 통을
   같이 썼다 — 한 곳이 다 쓰면 나머지 여덟이 함께 막힌다. `cache.js` 참고. */
const PROVIDER = 'data.go.kr:fsc';
const BASE = 'https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2';

function apiKey() {
  return process.env.DATA_GO_KR_KEY || '';
}

function isAvailable() {
  return Boolean(apiKey());
}

/**
 * 법인명 정규화 — 대조에만 쓴다.
 * '(주)', '주식회사', 공백, 마침표를 걷어낸다. 사람이 적는 표기가 제각각이라
 * 그대로 비교하면 같은 회사도 다르게 잡힌다.
 */
function normalizeName(name) {
  return String(name || '')
    .replace(/\(\s*주\s*\)|㈜|주식회사|\(\s*유\s*\)|유한회사/g, '')
    .replace(/[\s.,·]/g, '')
    .toLowerCase();
}

async function call(path, params, namespace, cacheParams) {
  if (!isAvailable()) {
    return { ok: false, error: 'DATA_GO_KR_KEY 미설정 — 기업정보 조회 생략', unavailable: true };
  }
  if (looksUrlEncoded(apiKey())) {
    return { ok: false, unavailable: true, error: 'DATA_GO_KR_KEY 가 Encoding 인증키다 — Decoding(일반) 을 써야 한다' };
  }

  return cache.through(PROVIDER, namespace, cacheParams, async () => {
    const url = buildUrl(`${BASE}/${path}`, { ...params, serviceKey: apiKey(), resultType: 'json' });
    const r = await request(url);
    if (!r.ok) return { ok: false, error: redact(r.error) };

    let body;
    try {
      body = JSON.parse(r.body);
    } catch (_) {
      return { ok: false, error: 'JSON 이 아닌 응답 (인증 오류일 수 있다)' };
    }
    if (!body.response) {
      const msg = body.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg;
      return { ok: false, error: redact(msg || '알 수 없는 응답 형식') };
    }
    const items = body.response.body?.items?.item ?? [];
    return {
      ok: true,
      total: Number(body.response.body?.totalCount ?? 0),
      value: Array.isArray(items) ? items : [items].filter(Boolean),
    };
  });
}

/** 응답 1건 → 우리가 쓰는 형태. 개인정보는 여기서 버린다. */
function toCorp(x) {
  return {
    corpRegNo: x.crno || null,              // 법인등록번호
    bizNo: x.bzno || null,                  // 사업자등록번호
    name: x.corpNm || null,
    nameEn: x.corpEnsnNm || null,
    establishedOn: x.enpEstbDt || null,     // YYYYMMDD
    market: x.corpRegMrktDcdNm || null,     // 유가 / 코스닥 / (비상장이면 공란)
    address: x.enpBsadr || null,
    homepage: x.enpHmpgUrl || null,
    employees: x.enpEmpeCnt ? Number(x.enpEmpeCnt) : null,
    auditor: x.actnAudpnNm || null,         // 감사인
    auditOpinion: x.audtRptOpnnCtt || null, // 감사의견
    dartCorpNo: x.fssCorpUnqNo || null,
    // 개정 이력 판별용 — 같은 법인이 여러 리비전으로 온다
    revisedOn: String(x.lastOpegDt || x.fssCorpChgDtm || '').replace(/\D/g, ''),
    // ★ enpRprFnm(대표자 성명)은 의도적으로 담지 않는다 — 이 파일 머리말 참고
  };
}

/**
 * 같은 법인의 개정 이력을 하나로 합친다.
 *
 * ★ '롯데케미칼' 조회에 22건이 오는데 **법인등록번호는 하나다.** 전부 같은
 *   회사의 리비전이다. 이걸 서로 다른 법인으로 세면 "동명 법인 22건" 이라는
 *   틀린 경고가 나가고, 사람은 있지도 않은 모호성을 해소하려 든다.
 * ★ 리비전마다 값이 조금씩 다르다 (상장시장이 빈 행이 섞여 있었다).
 *   **가장 최근 리비전**을 남긴다.
 */
function dedupeByCorp(rows) {
  const byNo = new Map();
  for (const x of rows) {
    const key = x.corpRegNo || `${x.name}|${x.bizNo}`;
    const prev = byNo.get(key);
    if (!prev || (x.revisedOn || '') > (prev.revisedOn || '')) byNo.set(key, x);
  }
  return [...byNo.values()];
}

/**
 * 법인명으로 기업개요를 찾는다.
 *
 * @param {string} name 시행사명
 * @returns {Promise<{ok:boolean, value?:object, candidates?:object[], ambiguous?:boolean}>}
 *   - 정확히 일치하는 것이 1건 → `value` 확정
 *   - 여러 건이거나 부분일치뿐 → `ambiguous: true` + `candidates` (사람이 고른다)
 */
async function corpOutline(name) {
  if (!name || !String(name).trim()) return { ok: false, error: '법인명 없음' };

  const r = await call('getCorpOutline_V2',
    { corpNm: String(name).trim(), pageNo: 1, numOfRows: 50 },
    'corp', { name: String(name).trim() });
  if (!r.ok) return r;

  const rows = dedupeByCorp(r.value.map(toCorp).filter(x => x.name));
  if (!rows.length) {
    return { ok: false, error: `'${name}' 으로 등록된 법인을 찾지 못했다`, notFound: true };
  }

  const target = normalizeName(name);
  const exact = rows.filter(x => normalizeName(x.name) === target);

  if (exact.length === 1) {
    return { ok: true, cached: r.cached, value: exact[0], rows: rows.length };
  }
  // ★ 여기서 하나를 고르지 않는다. 고르면 틀렸을 때 아무도 모른다.
  return {
    ok: true, cached: r.cached, ambiguous: true,
    candidates: (exact.length ? exact : rows).slice(0, 10),
    rows: rows.length,
    error: exact.length > 1
      ? `'${name}' 과 같은 이름의 법인이 ${exact.length}곳이다 — 법인등록번호로 특정해야 한다`
      : `'${name}' 과 정확히 일치하는 법인이 없다 (유사 ${rows.length}곳)`,
  };
}

/** 설립일(YYYYMMDD) → 업력(년). 기준일 없으면 계산하지 않는다 — 서버 시각에 의존하지 않는다. */
function yearsSince(yyyymmdd, todayIso) {
  if (!/^\d{8}$/.test(String(yyyymmdd || '')) || !todayIso) return null;
  const y = Number(String(yyyymmdd).slice(0, 4));
  const m = Number(String(yyyymmdd).slice(4, 6));
  const [ty, tm] = String(todayIso).split('-').map(Number);
  if (!ty || !tm) return null;
  return Math.floor(((ty * 12 + tm) - (y * 12 + m)) / 12);
}

module.exports = { corpOutline, normalizeName, yearsSince, toCorp, dedupeByCorp, isAvailable, PROVIDER };
