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
      return { ok: false, items: [], totalCount: null, error: `API 오류 ${code}: ${header.resultMsg || ''}` };
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
      return { ok: false, items: [], totalCount: null, error: `API 오류 ${code}: ${msg}` };
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

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

module.exports = { normalize, parseItems, tagValue, decodeEntities, num };
