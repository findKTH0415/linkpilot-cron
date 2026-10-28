'use strict';
/**
 * rhino.js — Rhino.Compute + Grasshopper Connector.
 *
 * 무엇에 쓰는가: 매스 스터디를 자동으로 돌린다. 대지 조건(면적·용적률 상한·
 * 사선제한)을 넣으면 Grasshopper 정의가 배치안을 풀고 연면적·층수·동수를 돌려준다.
 *
 * ★ **결과는 근거가 아니라 생성물이다.**
 *   공공데이터(§4)는 사업계획서를 대조하는 독립된 출처지만, 이건 **우리가 만든
 *   값**이다. IM 에 「연면적 32,000㎡(출처: 매스 스터디)」라고 적으면 우리가 만든
 *   것으로 우리 주장을 증명하는 셈이 된다.
 *   그래서 이 커넥터는 **fact 를 등록하지 않는다** — 검토 결과로만 내고,
 *   사람이 채택할 때 사람 이름으로 들어간다.
 *
 * ★ **Grasshopper 정의 안에 가정이 들어 있다.** 코어 면적률·기준층 높이·주차
 *   대수 산정 방식이 전부 정의를 만든 사람의 판단이다. 그래서 결과에
 *   `assumption: true` 와 **어느 정의를 썼는지**를 반드시 붙인다 (§4.8).
 *
 * ★ **형상(Geometry)은 숫자로 바꾸지 않는다.** Compute 가 돌려주는 BRep·Mesh 는
 *   rhino3dm 이 있어야 읽히는데 그건 이 저장소에 없다. 형상 출력은 **있다는
 *   사실만** 알리고 값으로 만들지 않는다 — 억지로 파싱하면 틀린 숫자가 나온다.
 *
 * ⚠️ **비용.** Compute 소프트웨어 자체는 오픈소스지만 **서버에 Rhino 라이선스가
 *    있어야** Grasshopper 를 푼다. 「무료」가 아니다 (등록부 D-38).
 *    무료인 것은 `rhino3dm`(형상 읽기 라이브러리)이고 그건 Grasshopper 를 못 돌린다.
 *
 * ★ **2026-08-16 결정: 서버를 세우지 않는다** (D-38). IM 에 실을 매스 검토 한두 장
 *   때문에 라이선스 서버를 세우는 값이 더 크다. 설계 협력사가 이미 가진 Rhino 로
 *   돌리고 **결과만 받는다** — 무엇을 어떤 형식으로 받는지는
 *   `docs/설계-협력사-산출물-규격.md` §2 에 적었다.
 *
 *   **그래서 이 파일은 지우지 않는다.** 나중에 서버를 세우면 `RHINO_COMPUTE_URL`
 *   만 넣으면 그대로 돈다. 지금은 **미설정이 정상**이고, 그 상태에서 조용히
 *   실패하지 않고 사유를 남기는 것이 이 커넥터가 지금 하는 일의 전부다.
 *
 * 설정: RHINO_COMPUTE_URL  자체 호스팅 Compute 주소 (예: http://10.0.0.5:8081)
 *       RHINO_COMPUTE_KEY  접근키 (서버에 설정했으면)
 *       ★ 키는 GitHub Secrets 로만 넣는다 (CLAUDE.md §2). `http.js` 의
 *         SECRET_ENV 에 등록해 두어 로그·오류에 평문으로 안 남는다.
 */

const { request, redact } = require('./http');
const cache = require('./cache');

const PROVIDER = 'Rhino.Compute';
const DEFAULT_TIMEOUT = 60000;   // 매스 풀이는 몇 초~수십 초가 걸린다

/** Compute 가 알아듣는 스칼라 타입. 형상은 여기 없다 — 일부러 없다 */
const TYPE_OF = {
  number: 'System.Double',
  string: 'System.String',
  boolean: 'System.Boolean',
};

function baseUrl() {
  const u = process.env.RHINO_COMPUTE_URL || '';
  return u.replace(/\/+$/, '');
}

function isAvailable() {
  return Boolean(baseUrl());
}

function unavailable(what) {
  return {
    ok: false, unavailable: true,
    error: `RHINO_COMPUTE_URL 미설정 — ${what} 생략. `
      // ★ 「미설정」만 있으면 설정하면 되는 줄 안다. **안 세우기로 한 것**이고,
      //   대신 협력사 결과를 받는다는 사실까지 말해야 다음 행동이 정해진다
      + 'Compute 는 자체 호스팅이고 서버에 Rhino 라이선스가 필요하다. '
      + '2026-08-16 결정으로 서버를 세우지 않고 설계 협력사 결과를 받는다 '
      + '(등록부 D-38 · docs/설계-협력사-산출물-규격.md §2)',
  };
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  const key = process.env.RHINO_COMPUTE_KEY;
  if (key) h.RhinoComputeKey = key;
  return h;
}

/* ── 입출력 변환 ────────────────────────────────────────────
 *
 * Compute 는 값을 **DataTree** 로 주고받는다. 평평한 객체를 그대로 보내면
 * 400 이 돌아오는데, 오류 본문이 "Unable to convert" 한 줄이라 무엇이 틀렸는지
 * 알기 어렵다. 그래서 변환을 여기 한 곳에 두고 테스트로 고정한다.
 */

/**
 * `{ 대지면적: 12000 }` → Compute 가 받는 values 배열.
 *
 * ★ 지원하지 않는 타입은 **조용히 버리지 않는다.** 버리면 Grasshopper 는
 *   기본값으로 풀고, 결과는 정상으로 보인다 — 넣은 줄 알았던 값이 안 들어갔다.
 */
function toTree(inputs) {
  const values = [];
  const skipped = [];
  Object.keys(inputs || {}).forEach((name) => {
    const v = inputs[name];
    if (v === null || v === undefined) { skipped.push(`${name}(값 없음)`); return; }
    const t = TYPE_OF[typeof v];
    if (!t) { skipped.push(`${name}(${typeof v} 는 못 보낸다)`); return; }
    values.push({
      ParamName: name,
      InnerTree: { '{0}': [{ type: t, data: JSON.stringify(v) }] },
    });
  });
  return { values, skipped };
}

/**
 * Compute 응답 → 평평한 객체.
 *
 * ★ 가지(branch)가 여럿이면 **합치지 않는다.** 합치면 「동 3개의 연면적」이
 *   한 숫자로 뭉개져 어느 동인지 사라진다. 배열로 그대로 둔다.
 * ★ 형상은 값으로 만들지 않는다 — rhino3dm 없이는 못 읽는다.
 */
function fromTree(payload) {
  const out = {};
  const geometry = [];
  (payload && payload.values ? payload.values : []).forEach((v) => {
    const items = [];
    const tree = v.InnerTree || {};
    Object.keys(tree).forEach((branch) => {
      (tree[branch] || []).forEach((cell) => {
        const type = String(cell.type || '');
        if (!/^System\.(Double|String|Boolean|Int32|Int64)$/.test(type)) {
          geometry.push({ param: v.ParamName, type });
          return;
        }
        let data = cell.data;
        try { data = JSON.parse(cell.data); } catch (_) { /* 문자열 그대로 둔다 */ }
        items.push(data);
      });
    });
    if (items.length) out[v.ParamName] = items.length === 1 ? items[0] : items;
  });
  return { values: out, geometry };
}

/* ── 호출 ──────────────────────────────────────────────── */

/** 서버가 살아 있는가. 스모크가 가장 먼저 보는 것 */
async function version() {
  if (!isAvailable()) return unavailable('Compute 확인');
  const r = await request(`${baseUrl()}/version`, { headers: headers(), timeoutMs: 10000 });
  if (!r.ok) return { ok: false, error: redact(r.error) };
  let v = r.body;
  try { v = JSON.parse(r.body); } catch (_) { /* 문자열로 주는 판도 있다 */ }
  return { ok: true, value: v };
}

/**
 * Grasshopper 정의를 푼다.
 *
 * @param {object} opt
 *   definition  { pointer } 서버가 아는 경로·URL · 또는 { algo } .gh 파일 base64
 *   inputs      { 파라미터명: 숫자|문자열|참거짓 }
 *   label       무엇을 푼 것인지 (출처에 남는다)
 *   timeoutMs   기본 60초
 * @returns {{ok, values, geometry, assumption, source, error}}
 */
async function solve(opt) {
  const o = opt || {};
  if (!isAvailable()) return unavailable('매스 스터디');

  const def = o.definition || {};
  if (!def.pointer && !def.algo) {
    return { ok: false, error: 'Grasshopper 정의가 없다 — definition.pointer 나 definition.algo 가 필요하다' };
  }

  const { values, skipped } = toTree(o.inputs);
  // ★ 넣으려던 값이 안 들어갔으면 **풀기 전에 멈춘다.** 그대로 풀면
  //   Grasshopper 가 기본값으로 계산하고, 결과는 멀쩡해 보인다
  if (skipped.length) {
    return { ok: false, error: `보낼 수 없는 입력이 있다: ${skipped.join(', ')} — 기본값으로 풀리면 결과가 조용히 달라진다` };
  }

  const body = JSON.stringify({
    ...(def.pointer ? { pointer: def.pointer } : { algo: def.algo }),
    values,
  });

  // 같은 정의 · 같은 입력이면 답도 같다 (순수 함수) — 다시 풀지 않는다
  const key = { definition: def.pointer || `algo:${(def.algo || '').length}`, inputs: o.inputs || {} };
  const r = await cache.through(PROVIDER, 'grasshopper', key, async () => {
    const res = await request(`${baseUrl()}/grasshopper`, {
      method: 'POST', headers: headers(), requestBody: body,
      timeoutMs: o.timeoutMs || DEFAULT_TIMEOUT,
    });
    if (!res.ok) {
      // ★ 오류 본문을 함께 남긴다. Compute 는 "Unable to convert" 한 줄만
      //   주는 일이 많아, 상태코드만 보면 무엇이 틀렸는지 알 수 없다
      const detail = res.body ? ` — ${String(res.body).slice(0, 300)}` : '';
      return { ok: false, error: redact(`${res.error}${detail}`) };
    }
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (e) {
      return { ok: false, error: `응답이 JSON 이 아니다: ${e.message}` };
    }
    return { ok: true, value: parsed };
  });

  if (!r.ok) return { ok: false, error: r.error };

  const got = fromTree(r.value);
  if (!Object.keys(got.values).length) {
    return {
      ok: false, geometry: got.geometry,
      error: got.geometry.length
        ? `숫자 출력이 없다 — 형상만 ${got.geometry.length}개 돌아왔다. `
          + '정의에서 연면적·층수 같은 값을 출력 파라미터로 내보내야 한다 '
          + '(형상은 rhino3dm 없이 읽지 않는다)'
        : '출력이 비어 있다 — 정의의 출력 파라미터 이름을 확인해야 한다',
    };
  }

  return {
    ok: true,
    cached: r.cached,
    values: got.values,
    // 형상은 「있다」까지만 알린다. 값으로 만들지 않는다
    geometry: got.geometry,
    // ★ 이 표시를 떼지 않는다. 떼는 순간 이 값이 공부(公簿)에서 온 값과
    //   구분되지 않고, 그때부터 우리가 만든 숫자가 근거처럼 쓰인다
    assumption: true,
    source: {
      provider: PROVIDER,
      label: o.label || '매스 스터디',
      definition: def.pointer || '(업로드한 정의)',
      note: '우리가 만든 검토 결과다. 정의 안의 코어 면적률·기준층 높이 같은 '
        + '가정이 결과를 좌우하므로, IM 에 실으려면 사람이 확인하고 채택해야 한다',
    },
  };
}

module.exports = {
  solve, version, isAvailable, toTree, fromTree, baseUrl,
  PROVIDER, TYPE_OF, DEFAULT_TIMEOUT,
};
