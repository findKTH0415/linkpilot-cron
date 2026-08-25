'use strict';
/**
 * law.js — 법제처 **국가법령정보 공동활용** OPEN API Connector.
 *
 *   ① 법령 목록 조회   lawSearch.do  — 이름으로 법령을 찾아 MST(마스터번호)를 얻는다
 *   ② 법령 본문 조회   lawService.do — MST 로 본문을, `JO` 로 **조문 하나만** 받는다
 *   ③ 자치법규(조례)   target=ordin  — 지자체 건축조례가 여기 있다
 *
 * ★★ **왜 붙였나 — 법규 검토가 여태 사람 몫이었다** 〈2026-08-25 사장님 지시:
 *   「국가법령정보 공동활용 API 확보」〉. 이 저장소는 「출처 없는 숫자는 못 들어온다」
 *   가 설계의 전부인데, **법정 한도만은 출처가 사람의 기억**이었다. 용적률 800%,
 *   방화구획 1,500㎡, 인동거리 0.5배 — 전부 맞는 말이지만 **어느 조문인지 문서에
 *   안 적혀 있었다.** 이 커넥터가 그 자리를 메운다.
 *
 * ★ **인증이 키가 아니라 `OC` 다.** 신청자 이메일의 `@` 앞부분 그대로다
 *   (예: 메일이 `hong@pdi.co.kr` 이면 OC 는 `hong`). 그래서 **아주 짧다** —
 *   `http.js` 의 가리개는 8자 미만을 건드리지 않으므로 로그에 그대로 남을 수 있다.
 *   짧다고 공개해도 되는 값은 아니다: 그 값이 곧 **승인된 이용자 식별자**다.
 *   `SECRET_ENV` 에 이미 `LAW_OC` 로 올라가 있다 (§2).
 *
 * ★ **사용 승인이 있어야 돈다.** 키만 만들면 되는 다른 기관과 다르다 —
 *   open.law.go.kr 에서 신청하고 1~2일 뒤 승인된다. 승인 전에는 인증 오류가
 *   나는데, **오류 모양이 「OC 오타」와 구분되지 않는다** (§4.2 와 같은 결).
 *   그래서 아래 `diagnose()` 가 응답 본문을 보고 갈라 준다.
 *
 * ★ **조문 번호(`JO`)는 6자리다** — 조 4자리 + 항 2자리. 제46조는 `004600`,
 *   제86조 제3항은 `008603`. 앞을 0 으로 채우지 않으면 엉뚱한 조문이 온다.
 *
 * ★ 법령은 **거의 안 바뀐다.** TTL 을 길게 잡는다(30일). 대신 조례는 지자체가
 *   수시로 고치므로 그보다 짧게 둔다(7일).
 *
 * ★ 값을 **지어내지 않는다.** OC 가 없으면 `unavailable` 을 돌려주고 그 절을
 *   비운다 (§4.6). 「아마 800%」 같은 것을 채우지 않는다.
 */

const { request, buildUrl, redact } = require('./http');
const cache = require('./cache');

const PROVIDER = 'law';
const BASE = 'https://www.law.go.kr/DRF';

/** 법령 본문은 잘 안 바뀐다 / 조례는 자주 바뀐다 */
const TTL_LAW = 30 * 86400;
const TTL_ORDIN = 7 * 86400;

/**
 * ★★ **이름이 둘이다** 〈2026-08-25 실측 — Secrets 화면에서 발견〉.
 *   나는 `LAW_OC` 로 안내했는데 사장님은 신청 후 받으신 값을 `LAW_OPEN_DATA`
 *   로도 넣으셨다. 엔진이 한 이름만 보면 **넣으신 값이 죽는다** — 넣은 사람은
 *   넣었다고 알고, 엔진은 「키가 없다」고 하고, 배포는 초록이다 (M-40 과 같은 결).
 *
 *   다시 넣으시라고 하는 대신 **둘 다 읽는다.** 우선순위는 `LAW_OC` 가 먼저다
 *   (안내 문서가 그 이름으로 되어 있다). `usedName()` 이 **어느 이름이 쓰였는지**
 *   말해 주므로 스모크에서 한눈에 갈린다.
 */
const OC_NAMES = ['LAW_OC', 'LAW_OPEN_DATA'];

function usedName() {
  return OC_NAMES.find(n => (process.env[n] || '').trim()) || null;
}

function oc() {
  const n = usedName();
  return n ? String(process.env[n]).trim() : '';
}

function isAvailable() {
  return Boolean(oc());
}

function unavailable(what) {
  return {
    ok: false,
    unavailable: true,
    error: `${OC_NAMES.join(' / ')} 둘 다 미설정 — ${what} 조회 생략. 국가법령정보 공동활용(open.law.go.kr) 신청 후 이메일 ID(@ 앞부분)를 넣는다`,
  };
}

/**
 * 응답이 실패일 때 **왜 실패했는지**를 사람 말로 가른다.
 *
 * ★ 이 API 는 승인 전·OC 오타·대상 없음이 **전부 비슷하게** 보인다. 실제로
 *   Gemini 에서 같은 일을 겪고 `render-birdseye.js` 에 `diagnose()` 를 넣었다
 *   (M-31 과 같은 결) — 같은 장치를 여기도 둔다.
 *
 * @returns {{kind:'approval'|'oc'|'notfound'|'format'|'unknown', head:string}}
 */
function diagnose(status, body) {
  const t = String(body || '');
  if (/승인|미승인|권한|허가되지/.test(t)) {
    return { kind: 'approval', head: '이용 승인이 아직 안 났다 — open.law.go.kr 신청 후 1~2일 걸린다. OC 값 문제가 아니다' };
  }
  if (status === 401 || status === 403 || /OC|사용자|등록되지/.test(t)) {
    return { kind: 'oc', head: 'OC 값이 등록된 이용자와 다르다 — 신청에 쓴 이메일의 @ 앞부분 그대로여야 한다' };
  }
  if (/검색결과가 없|조회된 자료가 없/.test(t)) {
    return { kind: 'notfound', head: '그 이름의 법령을 못 찾았다 — 약칭 말고 정식 명칭으로 찾는다' };
  }
  if (/^\s*</.test(t)) {
    return { kind: 'format', head: 'JSON 을 요청했는데 HTML 이 왔다 — 대개 승인 전이거나 점검 중이다' };
  }
  return { kind: 'unknown', head: `판정하지 못했다 (HTTP ${status})` };
}

async function call(path, params, { ttl, namespace }) {
  const url = buildUrl(`${BASE}/${path}`, { OC: oc(), type: 'JSON', ...params });
  const r = await request(url);
  if (!r.ok) return { ok: false, error: redact(r.error) };

  let body;
  try {
    body = JSON.parse(r.body);
  } catch (_) {
    const d = diagnose(r.status, r.body);
    return { ok: false, error: `${d.head}`, kind: d.kind };
  }
  return { ok: true, body };
}

/**
 * 법령 이름으로 찾아 **마스터번호(MST)** 를 얻는다.
 * MST 가 있어야 본문·조문을 부를 수 있다.
 *
 * @param {string} name 정식 명칭 (예: '건축법 시행령')
 */
async function findLaw(name) {
  if (!isAvailable()) return unavailable(`법령 「${name}」`);
  if (!name) return { ok: false, error: '법령 이름이 필요하다' };

  return cache.through(PROVIDER, 'lawsearch', { name }, async () => {
    const r = await call('lawSearch.do', { target: 'law', query: name, display: 20 }, {});
    if (!r.ok) return r;

    const list = r.body?.LawSearch?.law || [];
    const rows = (Array.isArray(list) ? list : [list])
      .map(x => ({
        name: x['법령명한글'] || null,
        mst: String(x['법령일련번호'] || x['법령ID'] || ''),
        kind: x['법령구분명'] || null,
        enforcedAt: x['시행일자'] || null,
        promulgatedAt: x['공포일자'] || null,
      }))
      .filter(x => x.mst);

    if (!rows.length) return { ok: false, error: `「${name}」 을(를) 못 찾았다 — 정식 명칭으로 찾는다`, kind: 'notfound' };
    // ★ 이름이 정확히 같은 것을 먼저 준다. 「건축법」 을 찾으면 「건축법 시행령」 도 함께 온다
    rows.sort((a, b) => (a.name === name ? -1 : b.name === name ? 1 : 0));
    return { ok: true, value: rows };
  }, { ttl: TTL_LAW });
}

/**
 * **조문 하나**를 원문 그대로 가져온다.
 *
 * @param {object} o
 * @param {string} o.mst  findLaw 가 준 마스터번호
 * @param {number} o.jo   조 번호 (46 → 제46조)
 * @param {number} [o.hang] 항 번호 (3 → 제3항). 생략하면 조 전체
 */
async function article({ mst, jo, hang = 0 } = {}) {
  if (!isAvailable()) return unavailable(`제${jo}조`);
  if (!mst || !jo) return { ok: false, error: 'mst 와 jo 가 필요하다' };

  // ★ 6자리 — 조 4자리 + 항 2자리. 0 을 안 채우면 엉뚱한 조문이 온다
  const JO = String(jo).padStart(4, '0') + String(hang).padStart(2, '0');

  return cache.through(PROVIDER, 'article', { mst, JO }, async () => {
    const r = await call('lawService.do', { target: 'law', MST: mst, JO }, {});
    if (!r.ok) return r;

    const root = r.body?.법령 || r.body?.Law || {};
    const unit = root?.조문?.조문단위;
    const units = Array.isArray(unit) ? unit : (unit ? [unit] : []);
    if (!units.length) return { ok: false, error: `제${jo}조 본문을 못 받았다`, kind: 'notfound' };

    const u = units[0];
    return {
      ok: true,
      value: {
        law: root?.기본정보?.법령명_한글 || null,
        enforcedAt: root?.기본정보?.시행일자 || null,
        articleNo: u['조문번호'] || String(jo),
        title: u['조문제목'] || null,
        text: u['조문내용'] || null,
        // 항·호는 구조가 들쭉날쭉해 **가공하지 않고 그대로** 넘긴다.
        // 여기서 요약하면 그 요약이 출처가 되어 버린다 (§4.7).
        raw: u,
      },
    };
  }, { ttl: TTL_LAW });
}

/**
 * 지자체 **건축조례**를 찾는다.
 *
 * ★ 이것이 이 커넥터의 진짜 값이다. 용적률·건폐율 **상한은 시행령이 정하지만
 *   실제 한도는 조례가 정한다** — 지금까지 그 자리를 「조례 확인 사항」이라고만
 *   적어 왔다. 조례를 자동으로 찾아 주면 그 문장이 근거를 갖는다.
 *
 * @param {string} region 지자체 이름 (예: '서울특별시 서초구')
 * @param {string} [name] 조례 이름 (기본 '건축조례')
 */
async function ordinance(region, name = '건축조례') {
  if (!isAvailable()) return unavailable(`${region} ${name}`);
  if (!region) return { ok: false, error: '지자체 이름이 필요하다' };

  return cache.through(PROVIDER, 'ordin', { region, name }, async () => {
    const r = await call('lawSearch.do', { target: 'ordin', query: `${region} ${name}`, display: 20 }, {});
    if (!r.ok) return r;

    const list = r.body?.LawSearch?.law || r.body?.LawSearch?.ordin || [];
    const rows = (Array.isArray(list) ? list : [list])
      .map(x => ({
        name: x['자치법규명'] || x['법령명한글'] || null,
        id: String(x['자치법규ID'] || x['법령일련번호'] || ''),
        org: x['지자체기관명'] || null,
        enforcedAt: x['시행일자'] || null,
      }))
      .filter(x => x.id);

    // ★ 여러 지자체가 걸리면 **고르지 않는다** — 후보를 내고 사람이 특정한다 (§4.9)
    if (!rows.length) return { ok: false, error: `${region} 의 ${name} 을(를) 못 찾았다`, kind: 'notfound' };
    return { ok: true, value: rows, ambiguous: rows.length > 1 };
  }, { ttl: TTL_ORDIN });
}

module.exports = { isAvailable, usedName, findLaw, article, ordinance, diagnose, OC_NAMES, PROVIDER };
