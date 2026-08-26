'use strict';
/**
 * factory.js — 공장등록 정보 Connector (제조 딜의 **물리적 상한**).
 *
 * 무엇에 쓰는가: 제조 딜에서 **건축물대장 격**이다.
 * 단가는 생산자물가(ecos)로, 가동률은 업종 평균(kosis)으로 대조가 붙었다.
 * 남은 것이 **생산능력**인데, 개별 공장의 생산능력은 어디에도 공표되지 않는다.
 * 대신 공장등록에는 **용지면적·제조시설면적·업종·등록일**이 실린다 —
 * 「연 12만톤을 만든다」는 주장이 앉을 수 있는 **물리적 상한**이 여기서 나온다.
 *
 * ★ **면적을 하나로 뭉치지 않는다. 이 파일에서 가장 중요한 규칙이다.**
 *   공장등록에는 면적이 넷 이상 실린다 — 용지(부지)·건축·제조시설·부대시설.
 *   「공장면적 12,000㎡」라고 뭉치는 순간 어느 면적인지 사라지는데, 생산능력을
 *   논해야 하는 것은 **제조시설면적**이고 용지면적은 보통 그 두세 배다.
 *   섞으면 상한이 세 배로 부풀고, 문서에는 「공장등록 기준」이라고만 남는다.
 *   그래서 이 파일은 **`area` 라는 이름의 필드를 만들지 않는다.**
 *
 * ★ **사업장을 자동으로 특정하지 않는다** (§4.9). 같은 이름의 공장이 여럿이고,
 *   한 사업장에 등록이 여러 건인 경우도 흔하다(증설·업종 추가). 후보를 내고
 *   사람이 고른다 — `dart.findCompany` 와 같은 방식이다.
 *
 * ★ **공부끼리 어긋나는 것을 드러낸다.** 공장등록의 용지면적과 건축물대장의
 *   대지면적은 같은 필지를 말하는데 값이 다를 수 있다. 그 차이를 드러내는 것이
 *   이 시스템의 존재 이유다 (§4 첫머리) — 자동으로 한쪽을 고르지 않는다.
 *
 * ★ **공장등록은 갱신이 늦다.** 변경신고를 안 하면 몇 년 전 상태가 그대로 남는다.
 *   그래서 값에 **등록일·변경일을 반드시 붙인다** (§4.7). 날짜 없는 면적은
 *   「지금 그렇다」로 읽히고, 그게 틀렸을 때 아무도 모른다.
 *
 * ⚠️ **엔드포인트·응답 필드는 실제 키로 검증되지 않았다** (등록부 D-45).
 *    제공 기관도 확정되지 않았다 — 공장설립온라인지원시스템(팩토리온)과
 *    한국산업단지공단 양쪽에 유사 자료가 있다. `npm run im:smoke` 가 대조한다.
 *
 * 인증키: DATA_GO_KR_KEY — data.go.kr 의 **Decoding(일반)** 인증키.
 *         ★ 키가 유효해도 **이 API 에 활용신청**이 따로 필요하다 (§4.2).
 */

// ★ `request` 를 뜯어내지 않고 모듈 객체로 붙든다 — 뜯어내면 테스트가 응답을
//   갈아끼울 수 없어 해석 경로가 한 번도 안 돈 채 통과한다 (M-08).
const http = require('./http');
const { buildUrl, redact, looksUrlEncoded } = http;
const cache = require('./cache');
const { normalize, num } = require('./xml');

/**
 * ★ 쿼터 버킷은 **키 단위로 묶는다.** data.go.kr 의 일 10,000건 한도는
 *   API 별이 아니라 **인증키 전체**에 걸린다. 버킷을 API 마다 쪼개면 각각
 *   10,000 까지 세어 실제로는 두 배를 쓰고도 한도에 안 걸린 것으로 보인다.
 
 * ★★ **정정 〈2026-08-23 실측 · D-85〉** — 「일 10,000건이 인증키 전체에 걸린다」는
 *   틀렸다. data.go.kr 활용신청 화면은 **상세기능(오퍼레이션)마다** 일일 트래픽을
 *   적어 주고, 개발계정은 **1,000건**이다. 그래서 쿼터 통을 `data.go.kr:<갈래>` 로
 *   나눴다 (`cache.js` 의 `FAMILY_QUOTA`).
 */
/* ★ 쿼터 통을 **갈래로 나눈다** 〈2026-08-23 · D-85〉. data.go.kr 은 상세기능마다
   하루치를 세는데(개발계정 1,000), 앞 판은 아홉 커넥터가 `data.go.kr` 한 통을
   같이 썼다 — 한 곳이 다 쓰면 나머지 여덟이 함께 막힌다. `cache.js` 참고. */
const PROVIDER = 'data.go.kr:factory';

/** ⚠️ 미검증 — 기관·경로 모두 D-45 */
const BASE = 'https://apis.data.go.kr/B552735';

const OPS = {
  /** 공장등록 목록 조회 */
  list: { path: 'kicoxFactoryService/getFactoryList', label: '공장등록 목록' },
  /** 공장등록 상세 */
  detail: { path: 'kicoxFactoryService/getFactoryDetail', label: '공장등록 상세' },
};

/**
 * 면적의 종류. **이름을 붙여 두는 것이 이 사전의 전부다.**
 *
 * 자동으로 하나를 고르지 않는다 — 무엇을 논하느냐에 따라 봐야 할 면적이 다르다.
 */
const AREA_KINDS = {
  land: {
    label: '용지면적(부지)',
    means: '공장이 앉은 땅 전체. 주차장·녹지·여유부지를 포함한다',
    caution: '생산능력의 근거로 쓰면 안 된다 — 제조시설면적의 보통 두세 배다',
  },
  building: {
    label: '건축면적',
    means: '건물이 땅을 덮은 넓이 (건폐 기준)',
    caution: '층수를 반영하지 않는다 — 연면적과 다르다',
  },
  manufacturing: {
    label: '제조시설면적',
    means: '실제로 제조가 일어나는 시설의 면적',
    caution: '생산능력을 논할 때 봐야 하는 것은 **이 값**이다',
  },
  auxiliary: {
    label: '부대시설면적',
    means: '창고·사무동·후생시설 등',
    caution: '제조시설면적과 더해 「공장면적」으로 뭉치지 않는다',
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
    error: `DATA_GO_KR_KEY 미설정 — ${what || '공장등록'} 조회 생략 `
      + '(생산능력의 물리적 상한을 대조할 곳이 없다)',
    unavailable: true,
  };
}

function mask(text) {
  return redact(text, [apiKey()]);
}

/** 'YYYYMMDD' · 'YYYY-MM-DD' → 'YYYY-MM-DD' (못 읽으면 null — 짐작하지 않는다) */
function ymd(v) {
  const t = String(v || '').replace(/[^\d]/g, '');
  if (!/^\d{8}$/.test(t)) return null;
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6)}`;
}

/**
 * 응답 한 건 → 우리 모양.
 *
 * ★ **면적을 `areas` 아래 종류별로만 둔다.** 최상위에 `area` 를 만들면
 *   부르는 쪽이 그걸 집어 쓰고, 그 순간 어느 면적인지 사라진다.
 */
function toRecord(x) {
  return {
    id: x.factrNo || x.fctryNo || x.factoryId || null,
    name: x.fctryNm || x.factrNm || null,
    address: x.fctryAddr || x.addr || x.lotnoAddr || null,
    // 한국표준산업분류 — KOSIS 업종을 고를 때의 **근거**가 된다 (자동 연결은 안 한다)
    industryCode: x.induty || x.ksicCd || x.indutyCd || null,
    industryName: x.indutyNm || x.ksicNm || null,
    complex: x.indutyCmplxNm || x.cmplxNm || null,   // 산업단지명 (있으면)
    areas: {
      land: num(x.lndarNm ?? x.lotArea ?? x.useAr),
      building: num(x.bldgAr ?? x.archArea),
      manufacturing: num(x.manufAr ?? x.mnfctFcltyAr),
      auxiliary: num(x.auxAr ?? x.addFcltyAr),
    },
    // ★ 날짜 없는 면적은 「지금 그렇다」로 읽힌다 — 반드시 함께 낸다
    registeredAt: ymd(x.regstrDe || x.rgstDt),
    changedAt: ymd(x.chgDe || x.updtDt),
    employees: num(x.emplyCnt ?? x.epmyCnt),
  };
}

/** 어느 면적도 안 잡혔으면 그 사실을 말한다 (0 이 아니다) */
function hasAnyArea(r) {
  return Object.values(r.areas).some(v => Number.isFinite(v) && v > 0);
}

/**
 * 응답 해석. **네트워크와 분리해 둔다** — 틀리면 「조회는 성공, 값은 빔」이 된다.
 */
function parseList(body) {
  // ★ data.go.kr 공통 오류는 **HTTP 200 으로** 오고 본문에만 드러난다 (§4.2).
  //   `normalize` 가 resultCode 를 이미 보고 `ok:false` 로 내려 준다 —
  //   여기서 또 보면 규칙이 두 곳에 생겨 한쪽만 고치는 날 갈린다
  const j = normalize(body);
  if (!j.ok) return { ok: false, error: mask(`공장등록: ${j.error}`) };

  const rows = (j.items || []).map(toRecord).filter(r => r.name || r.id);
  // ★ **빈 결과는 오류가 아니다.** 오류로 두면 「조회가 실패했다」와 「등록이
  //   없다」가 한 덩어리가 되는데, 둘은 다음에 할 일이 정반대다 —
  //   전자는 엔드포인트를 고치고, 후자는 미등록 가능성을 사람이 판단한다.
  //   무엇을 뜻하는지는 `resolve` 가 말한다.
  return { ok: true, rows, total: j.totalCount ?? rows.length };
}

/**
 * 상호·주소로 사업장을 찾는다.
 *
 * ★ **여러 건이면 고르지 않는다.** 같은 이름의 공장이 흔하고, 한 사업장에
 *   등록이 여러 건인 경우도 있다(증설·업종 추가). 엉뚱한 사업장의 면적으로
 *   생산능력 상한을 논하면 문서에는 「공장등록 기준」만 남는다.
 */
async function search(o) {
  const opt = o || {};
  if (!isAvailable()) return unavailable('공장등록 조회');

  const name = String(opt.name || '').trim();
  if (!name && !opt.address) {
    return { ok: false, error: '상호 또는 주소가 필요하다 — 전체 목록을 훑지 않는다' };
  }
  if (looksUrlEncoded(apiKey())) {
    return {
      ok: false,
      error: 'DATA_GO_KR_KEY 가 Encoding 키로 보인다 (%XX 포함) — Decoding(일반) 키를 넣는다',
    };
  }

  const params = { name, address: opt.address || '', sido: opt.sido || '' };
  return cache.through(PROVIDER, 'factory', params, async () => {
    const url = buildUrl(`${BASE}/${OPS.list.path}`, {
      serviceKey: apiKey(), type: 'json', numOfRows: 100, pageNo: 1,
      fctryNm: name || undefined,
      fctryAddr: opt.address || undefined,
      ctprvnNm: opt.sido || undefined,
    });
    const r = await http.request(url);
    if (!r.ok) return { ok: false, error: mask(r.error) };

    const p = parseList(r.body);
    if (!p.ok) return p;
    return { ok: true, value: { rows: p.rows, total: p.total } };
  }, { ttl: 30 * 86400 });
}

/**
 * 하나로 좁혀졌는가. 아니면 후보를 그대로 돌려준다.
 *
 * @returns {{ok, value?:record, candidates?:record[], ambiguous?:boolean, notFound?:boolean}}
 */
async function resolve(o) {
  const r = await search(o);
  if (!r.ok) return r;

  const rows = r.value.rows;
  if (!rows.length) {
    return { ok: false, notFound: true, error: '공장등록에 해당 사업장이 없다 — **공장이 없다는 뜻은 아니다** (미등록·소규모·자료 미갱신)' };
  }
  if (rows.length > 1) {
    return {
      ok: false, ambiguous: true, candidates: rows, cached: r.cached,
      error: `조건에 맞는 등록이 ${rows.length}건이다 — 엉뚱한 사업장의 면적으로 `
        + '생산능력 상한을 논하지 않도록 고르지 않는다. 주소·업종으로 좁히거나 사람이 고른다',
    };
  }
  return { ok: true, value: rows[0], cached: r.cached };
}

/**
 * 면적 하나를 **종류를 밝혀** 꺼낸다.
 *
 * ★ 종류를 안 주면 거부한다. 기본값을 두면 그게 곧 「어느 면적인지 모르는 값」이
 *   된다 — 이 파일이 막으려는 바로 그 상태다.
 */
function areaOf(record, kind) {
  const meta = AREA_KINDS[kind];
  if (!meta) {
    return {
      ok: false,
      error: `면적 종류를 지정해야 한다 (${Object.keys(AREA_KINDS).join(' · ')}) — `
        + '뭉치면 용지면적을 제조시설면적으로 쓰게 되고, 상한이 두세 배 부푼다',
    };
  }
  const v = record && record.areas ? record.areas[kind] : null;
  if (!Number.isFinite(v) || v <= 0) {
    // ★ 없는 것을 0 으로 그리지 않는다 — 0㎡ 는 「없다」가 아니라 「0 이다」로 읽힌다
    return { ok: false, missing: true, error: `${meta.label}이(가) 등록 자료에 없다` };
  }
  return {
    ok: true,
    value: {
      kind, sqm: v, label: meta.label, means: meta.means, caution: meta.caution,
      source: {
        provider: '공장등록 (공장설립온라인지원시스템)',
        label: `${meta.label} · ${record.name || ''}`.trim(),
        note: `${meta.label} ${v}㎡`
          + (record.registeredAt ? ` · 등록 ${record.registeredAt}` : '')
          + (record.changedAt ? ` · 변경 ${record.changedAt}` : '')
          + '. 공장등록은 변경신고가 없으면 갱신되지 않는다 — 기준일을 함께 읽는다',
      },
    },
  };
}

/**
 * 공부끼리 대조 — 공장등록 용지면적 vs 건축물대장 대지면적.
 *
 * ★ **한쪽을 고르지 않는다.** 어긋난다는 사실 자체가 결과다 (§4 첫머리).
 *   자동으로 큰 쪽·작은 쪽을 고르면 문서에는 「대지면적 12,000㎡」만 남고
 *   두 공부가 다르다는 것이 사라진다.
 *
 * @param {number} registeredLandSqm 공장등록 용지면적
 * @param {number} ledgerPlatAreaSqm 건축물대장 대지면적
 * @param {number} [tolerance] 같다고 볼 상대오차 (기본 1%)
 */
function crossCheckLand(registeredLandSqm, ledgerPlatAreaSqm, tolerance) {
  const a = Number(registeredLandSqm);
  const b = Number(ledgerPlatAreaSqm);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    return { ok: false, error: '두 값이 다 있어야 대조할 수 있다 (없는 쪽을 0 으로 세지 않는다)' };
  }
  const tol = Number.isFinite(tolerance) ? tolerance : 0.01;
  const diff = a - b;
  const rel = Math.abs(diff) / Math.max(a, b);
  const agree = rel <= tol;

  return {
    ok: true,
    value: {
      registered: a, ledger: b,
      diffSqm: Math.round(diff * 100) / 100,
      diffPercent: Math.round(rel * 1000) / 10,
      agree,
      // ★ 「어느 쪽이 맞다」고 말하지 않는다 — 그건 사람이 확인할 일이다
      text: agree
        ? `공장등록 용지면적 ${a}㎡ 와 건축물대장 대지면적 ${b}㎡ 가 일치한다 (차이 ${Math.round(rel * 1000) / 10}%)`
        : `공장등록 용지면적 ${a}㎡ 와 건축물대장 대지면적 ${b}㎡ 가 ${Math.round(rel * 1000) / 10}% 어긋난다 `
          + '— 어느 쪽이 맞는지는 사람이 확인한다 (등록 변경 누락·필지 분할·측량 갱신 등)',
    },
  };
}

module.exports = {
  search, resolve, areaOf, crossCheckLand,
  isAvailable, unavailable, mask, parseList, toRecord, hasAnyArea, ymd,
  PROVIDER, BASE, OPS, AREA_KINDS,
};
