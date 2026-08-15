'use strict';
/**
 * dart.js — 금융감독원 전자공시(DART) Open API Connector. 〈C-01〉
 *
 * 무엇을 하는가: **시행사/스폰서가 실재하는 법인인지, 어떤 규모인지**를
 * 사업계획서와 무관한 출처로 확인한다.
 *
 * ★ 이 커넥터는 `project.sponsor` 를 **채우지 않는다.**
 *   시행사 이름은 요청문·자료에서 온다. DART 가 하는 일은 그 이름을 **대조**하는
 *   것이다. 채운다고 선언하면 화면이 시행사를 안 물어보게 되고, 그러면 대조할
 *   원본 자체가 사라진다 (B-18 과 같은 실패 구조다).
 *
 * ★ DART 는 **공시대상회사만** 수록한다. 상장사·사업보고서 제출대상이 아닌
 *   일반 SPC·소규모 시행사는 **원래 없다.** 그래서 "못 찾음"은 실패도 아니고
 *   "법인이 없다"는 뜻도 아니다 — `notFound` 로 구분해 돌려준다.
 *   이걸 뭉개면 정상적인 SPC 딜이 IM 에서 "법인 미확인"으로 나간다.
 *
 * ★ 동명 법인이 흔하다. 여러 건이 나오면 **하나를 고르지 않는다** (`ambiguous`).
 *   엉뚱한 회사의 재무제표가 IM 에 실리는 것이 안 싣는 것보다 나쁘다.
 *
 * ★ 대표자 성명(`ceo_nm`)은 **가져오지 않는다.** 개인 성명이고, 이 저장소는
 *   공개이며, PDI 하우스 스타일도 대외 문서에 개인 성명을 적지 않는다.
 *
 * 인증키: DART_API_KEY — opendart.fss.or.kr 에서 발급 (무료, 즉시).
 *
 * ★ 응답 필드명은 공식 문서 기준이고 **실제 키로 검증하지 않았다** (B-4).
 *   `npm run im:smoke` 가 원본 필드를 함께 찍어 대조하게 해 둔다.
 */

const zlib = require('zlib');
const { request, buildUrl, redact } = require('./http');
const cache = require('./cache');
const { parseItems } = require('./xml');

const PROVIDER = 'dart';
const BASE = 'https://opendart.fss.or.kr/api';

/** DART status 코드 — 200 으로 오고 본문에만 드러난다 (ECOS 와 같은 함정) */
const STATUS = {
  '000': null,
  '013': '조회된 자료가 없다',
  '020': '요청 한도 초과 (일 20,000건)',
  '100': '인증키가 부적절하다',
  '101': '인증키가 등록되지 않았다',
  '800': '시스템 점검 중',
  '900': '정의되지 않은 오류',
  '901': '인증키가 만료되었다',
};

function apiKey() {
  return process.env.DART_API_KEY || '';
}

function isAvailable() {
  return Boolean(apiKey());
}

function unavailable(what) {
  return { ok: false, error: `DART_API_KEY 미설정 — ${what} 생략`, unavailable: true };
}

function mask(text) {
  return redact(text, [apiKey()]);
}

/* ───────────── 법인명 정규화 ───────────── */

/**
 * 비교용 이름. "㈜가온개발" · "주식회사 가온개발" · "가온개발(주)" 을 같게 본다.
 * ★ 원본을 덮어쓰지 않는다 — 표시에는 늘 등기된 이름을 쓴다.
 */
function normalizeName(name) {
  return String(name || '')
    .replace(/㈜|\(주\)|\(유\)|\(재\)|\(사\)/g, '')
    .replace(/주식회사|유한회사|유한책임회사|재단법인|사단법인/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/* ───────────── corpCode.zip (법인 코드 목록) ───────────── */

/**
 * DART 는 법인명으로 직접 찾는 API 를 주지 않는다. 전체 법인코드를 **ZIP 한 벌로**
 * 내려받아 그 안에서 찾아야 한다. 10만 건 남짓이라 무겁지만 **한 번 받으면 30일**
 * 캐시된다 (`cache.TTL.corpcode`). 재실행 시 네트워크를 타지 않는다.
 */
async function corpIndex() {
  if (!isAvailable()) return unavailable('법인코드 목록');

  return cache.through(PROVIDER, 'corpcode', { v: 1 }, async () => {
    const url = buildUrl(`${BASE}/corpCode.xml`, { crtfc_key: apiKey() });
    const r = await request(url, { binary: true, timeoutMs: 60000 });
    if (!r.ok) return { ok: false, error: mask(r.error) };

    // 오류일 때는 ZIP 이 아니라 XML 이 온다 (status/message)
    const head = Buffer.from(r.body).slice(0, 5).toString('utf8');
    if (!head.startsWith('PK')) {
      const s = statusError(Buffer.from(r.body).toString('utf8'));
      return { ok: false, error: s || 'corpCode 응답이 ZIP 이 아니다' };
    }

    let xml;
    try { xml = unzipFirstEntry(Buffer.from(r.body)); } catch (e) {
      return { ok: false, error: `corpCode.zip 해제 실패: ${e.message}` };
    }

    const rows = parseItems(xml, 'list').map(x => ({
      corpCode: x.corp_code || null,
      corpName: x.corp_name || null,
      stockCode: (x.stock_code || '').trim() || null,
      modifyDate: x.modify_date || null,
    })).filter(x => x.corpCode && x.corpName);

    if (!rows.length) return { ok: false, error: 'corpCode.xml 에서 법인을 하나도 읽지 못했다 (태그명 확인)' };
    return { ok: true, value: rows };
  });
}

/**
 * ZIP 첫 항목을 풀어 문자열로. 중앙 디렉터리를 읽는다 —
 * 로컬 헤더는 크기가 0 으로 오는 경우가 있어 믿을 수 없다.
 */
function unzipFirstEntry(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('ZIP 끝 표지(EOCD)를 찾지 못했다');

  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('중앙 디렉터리 서명이 맞지 않는다');

  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const nameLen = buf.readUInt16LE(cdOffset + 28);
  const localOffset = buf.readUInt32LE(cdOffset + 42);

  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('로컬 헤더 서명이 맞지 않는다');
  const lNameLen = buf.readUInt16LE(localOffset + 26);
  const lExtraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + lNameLen + lExtraLen;
  const data = buf.slice(start, start + compSize);

  if (method === 0) return data.toString('utf8');       // 무압축
  if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
  throw new Error(`지원하지 않는 압축 방식: ${method}`);
}

/** EOCD 서명을 뒤에서부터 찾는다 (주석이 붙을 수 있어 고정 위치가 아니다) */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/* ───────────── 조회 ───────────── */

/**
 * 법인명으로 찾는다.
 * @returns {Promise<{ok:boolean, value?:object, candidates?:object[], notFound?:boolean, ambiguous?:boolean, error?:string}>}
 */
async function findCompany(name) {
  if (!isAvailable()) return unavailable('법인 조회');
  if (!String(name || '').trim()) return { ok: false, error: '법인명 없음' };

  const idx = await corpIndex();
  if (!idx.ok) return idx;

  const want = normalizeName(name);
  const hits = idx.value.filter(r => normalizeName(r.corpName) === want);

  if (!hits.length) {
    return {
      ok: false, notFound: true,
      error: `DART 에 '${name}' 이(가) 없다 — **법인이 없다는 뜻이 아니다.** `
        + 'DART 는 공시대상회사만 수록한다. SPC·비상장 시행사는 원래 조회되지 않는다',
    };
  }
  if (hits.length > 1) {
    return {
      ok: false, ambiguous: true, candidates: hits,
      error: `'${name}' 과 같은 이름의 법인이 ${hits.length}건이다 — 엉뚱한 회사의 재무가 실리지 않도록 고르지 않는다`,
    };
  }
  return { ok: true, value: hits[0], cached: idx.cached };
}

/**
 * 기업개황. 이름 대조에 필요한 것만 남긴다.
 * ★ 대표자 성명은 일부러 빼 간다 (개인 성명).
 */
async function company(corpCode) {
  if (!isAvailable()) return unavailable('기업개황');
  if (!/^\d{8}$/.test(String(corpCode || ''))) return { ok: false, error: '법인코드 형식 오류 (8자리)' };

  return cache.through(PROVIDER, 'company', { corpCode }, async () => {
    const url = buildUrl(`${BASE}/company.json`, { crtfc_key: apiKey(), corp_code: corpCode });
    const r = await request(url);
    if (!r.ok) return { ok: false, error: mask(r.error) };
    return parseCompany(r.body);
  });
}

/** 본문 해석. 인증 실패도 HTTP 200 으로 오므로 status 를 반드시 본다 */
function parseCompany(body) {
  let j;
  try { j = JSON.parse(body); } catch (_) {
    return { ok: false, error: 'DART 응답이 JSON 이 아니다 (키 확인)' };
  }
  const err = statusError(j);
  if (err) return { ok: false, error: err };

  return {
    ok: true,
    value: {
      corpName: j.corp_name || null,
      corpNameEng: j.corp_name_eng || null,
      stockCode: (j.stock_code || '').trim() || null,
      corpClass: CORP_CLASS[j.corp_cls] || j.corp_cls || null,
      jurirNo: j.jurir_no || null,          // 법인등록번호 — 동명 법인을 가르는 유일한 값
      address: j.adres || null,
      industryCode: j.induty_code || null,
      establishedAt: ymd(j.est_dt),
      homepage: j.hm_url || null,
      // ceo_nm(대표자 성명)은 가져오지 않는다 — 개인 성명
    },
    raw: j,
  };
}

const CORP_CLASS = { Y: '유가증권시장', K: '코스닥', N: '코넥스', E: '기타(공시대상)' };

function ymd(v) {
  const s = String(v || '').replace(/\D/g, '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null;
}

/** status 코드를 사람이 읽는 사유로. 정상이면 null */
function statusError(input) {
  let code = null, message = '';
  if (typeof input === 'string') {
    const m = input.match(/<status>(\d+)<\/status>/);
    const mm = input.match(/<message>([\s\S]*?)<\/message>/);
    if (m) code = m[1];
    if (mm) message = mm[1].trim();
  } else if (input && typeof input === 'object') {
    code = input.status ? String(input.status) : null;
    message = input.message || '';
  }
  if (!code || code === '000') return null;
  const known = STATUS[code];
  return `DART ${code}: ${known || message || '조회 실패'}`.trim();
}

module.exports = {
  findCompany, company, corpIndex, isAvailable, unavailable,
  normalizeName, parseCompany, statusError, unzipFirstEntry, mask,
  PROVIDER, BASE, STATUS, CORP_CLASS,
};
