'use strict';
/**
 * xml.js — 공공데이터포털 응답 파서 (의존성 0).
 *
 * data.go.kr 계열은 `_type=json` 을 지원하는 API와 XML만 주는 API가 섞여 있다.
 * 두 경우를 한 함수로 흡수한다. 응답 구조도 API마다 제각각이라
 * 헤더(resultCode)와 item 배열만 규격화해서 돌려준다.
 */

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * <item> 블록들을 평평한 객체 배열로 변환 (중첩 없는 공공데이터 표준 형태 가정).
 *
 * ★ 태그명에 한글이 온다. 국토교통부 실거래가 API는 <거래금액>, <거래면적> 처럼
 *   한글 태그를 쓰므로 태그명 패턴을 ASCII로 제한하면 아무것도 파싱되지 않는다.
 */
function parseItems(xml, tag = 'item') {
  const items = [];
  for (const block of String(xml).matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))) {
    const obj = {};
    for (const f of block[1].matchAll(/<([^\s/>?!<]+)>([\s\S]*?)<\/\1>/g)) {
      const key = f[1].includes(':') ? f[1].split(':').pop() : f[1];
      obj[key] = decodeEntities(f[2]).trim();
    }
    if (Object.keys(obj).length) items.push(obj);
  }
  return items;
}

function tagValue(xml, tag) {
  const m = String(xml).match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return m ? decodeEntities(m[1]).trim() : null;
}

/**
 * JSON/XML 응답을 공통 형태로 정규화한다.
 * @returns {{ok:boolean, items:object[], totalCount:number|null, error?:string}}
 */
function normalize(body) {
  const text = String(body || '').trim();
  if (!text) return { ok: false, items: [], totalCount: null, error: '빈 응답' };

  // JSON 응답
  if (text.startsWith('{') || text.startsWith('[')) {
    let j;
    try {
      j = JSON.parse(text);
    } catch (e) {
      return { ok: false, items: [], totalCount: null, error: `JSON 파싱 실패: ${e.message}` };
    }
    const header = j?.response?.header || j?.header || null;
    const code = header ? String(header.resultCode ?? '') : null;
    if (code && !['00', '0', '000'].includes(code)) {
      return { ok: false, items: [], totalCount: null, error: explainCode(code, header.resultMsg) };
    }
    const bodyNode = j?.response?.body || j?.body || j;
    let items = bodyNode?.items?.item ?? bodyNode?.items ?? bodyNode?.item ?? [];
    if (items && !Array.isArray(items)) items = [items];
    return { ok: true, items: Array.isArray(items) ? items : [], totalCount: num(bodyNode?.totalCount) };
  }

  // XML 응답
  if (text.startsWith('<')) {
    const code = tagValue(text, 'resultCode');
    if (code && !['00', '0', '000'].includes(code)) {
      const msg = tagValue(text, 'resultMsg') || tagValue(text, 'returnAuthMsg') || '';
      return { ok: false, items: [], totalCount: null, error: explainCode(code, msg) };
    }
    // 서비스키 오류는 별도 포맷으로 온다
    const authMsg = tagValue(text, 'returnAuthMsg');
    if (authMsg && !code) {
      return { ok: false, items: [], totalCount: null, error: `인증 오류: ${authMsg}` };
    }
    return { ok: true, items: parseItems(text), totalCount: num(tagValue(text, 'totalCount')) };
  }

  return { ok: false, items: [], totalCount: null, error: `알 수 없는 응답 형식: ${text.slice(0, 60)}` };
}

/**
 * data.go.kr 표준 오류코드 → 사람이 읽는 사유.
 *
 * ★ 코드만 보여주면 **무엇을 해야 하는지 알 수 없다.** 특히 20·30 은
 *   "키가 틀렸다"가 아니라 **API 별 활용신청이 승인되지 않았다**는 뜻인데,
 *   그 구분을 못 하면 멀쩡한 키를 계속 재발급받게 된다.
 */
const RESULT_CODES = {
  '01': '어플리케이션 오류 (제공처 문제 — 잠시 뒤 재시도)',
  '02': '데이터베이스 오류 (제공처 문제)',
  '03': '데이터 없음 — 조회 조건에 해당하는 자료가 없다 (키 문제가 아니다)',
  '04': 'HTTP 오류',
  '05': '서비스 연결 실패',
  '10': '잘못된 요청 파라미터',
  '11': '필수 요청 파라미터 누락',
  '12': '해당 오픈API 가 없거나 폐기되었다 — 엔드포인트 확인',
  '20': '서비스 접근 거부 — **이 API 의 활용신청이 승인되지 않았다**',
  '21': '일시적으로 사용할 수 없는 서비스키',
  '22': '요청 한도 초과 (일 10,000건)',
  '30': '등록되지 않은 서비스키 — **이 API 에 활용신청을 했는지 확인할 것**',
  '31': '기한이 만료된 서비스키',
  '32': '등록되지 않은 도메인/IP',
  '99': '기타 오류',
};

/** 코드에 뜻을 붙인다. 모르는 코드면 제공처 메시지를 그대로 쓴다 */
function explainCode(code, message) {
  const known = RESULT_CODES[String(code).padStart(2, '0')] || RESULT_CODES[String(code)];
  const msg = String(message || '').trim();
  if (!known) return `API 오류 ${code}${msg ? ': ' + msg : ''}`;
  return `API 오류 ${code}: ${known}${msg ? ` (원문: ${msg})` : ''}`;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

module.exports = { normalize, parseItems, tagValue, decodeEntities, num, explainCode, RESULT_CODES };
