'use strict';
/**
 * ifc.js — IFC(.ifc) 모델에서 **모델이 이미 들고 있는 수량**을 읽는다.
 *
 * 왜 직접 쓰는가: IFC-SPF(STEP Physical File)는 텍스트 형식이라 파싱에
 * 라이브러리가 필요 없다. IfcOpenShell 은 Python 런타임을 들여야 하는데,
 * 이 저장소는 Node 하나로 돌고 의존성이 `solapi` 뿐이다 (CLAUDE.md §5).
 * `pdftext.js`·`ole.js` 와 같은 자리에 같은 방식으로 둔다.
 *
 * ★ **형상에서 물량을 새로 계산하지 않는다.** 벽·슬래브의 솔리드를 만들어
 *   부피를 재는 일은 기하 엔진(OpenCASCADE)이 필요하고, 그건 이 저장소가
 *   들일 수 있는 크기가 아니다. 대신 **설계 도구가 내보낼 때 함께 써 넣은
 *   수량**(IfcElementQuantity)만 읽는다.
 *
 * ★ 그래서 **수량이 없는 IFC 가 있다.** 그때 0 을 돌려주면 「물량 0」으로
 *   읽혀 견적이 통째로 비어도 정상처럼 보인다. 없으면 **없다고 말한다** —
 *   `hasQuantities:false` 와 함께 무엇을 켜서 다시 내보내면 되는지 적는다.
 *
 * ★ 수량은 **근거 있는 값이다.** 모델러가 그린 형상에서 도구가 계산해 넣은
 *   것이고, 우리가 가정한 것이 아니다. 다만 **모델이 곧 실물은 아니므로**
 *   출처에 「모델 파일명 · IFC 스키마 · 수량 출처 Pset」을 함께 남긴다 (§4.7).
 *
 * 의존성 0. Node 표준 라이브러리만 쓴다.
 */

/** 한 번에 읽을 수 있는 크기. IFC 는 쉽게 수백 MB 가 된다 */
const MAX_BYTES = 120 * 1024 * 1024;

/**
 * 우리가 찾는 수량 이름 → 뜻.
 *
 * ★ 이름이 도구마다 다르다. Revit 은 `NetVolume`, ArchiCAD 은 `NetVolume`
 *   또는 `GrossVolume` 을 쓰고, 어떤 내보내기는 한글 이름을 쓴다.
 *   **모르는 이름은 버리지 않고 그대로 모아 둔다** — 버리면 왜 물량이
 *   적은지 알 수 없다.
 */
const QUANTITY_KIND = {
  NETVOLUME: 'netVolume', GROSSVOLUME: 'grossVolume',
  NETAREA: 'netArea', GROSSAREA: 'grossArea',
  NETSIDEAREA: 'netArea', GROSSSIDEAREA: 'grossArea',
  NETFLOORAREA: 'netArea', GROSSFLOORAREA: 'grossArea',
  LENGTH: 'length', WIDTH: 'width', HEIGHT: 'height',
  NETWEIGHT: 'netWeight', GROSSWEIGHT: 'grossWeight',
  NETSURFACEAREA: 'netArea', GROSSSURFACEAREA: 'grossArea',
};

/** 수량 실체 → 단위 축 (숫자를 엉뚱한 단위로 합치지 않게) */
const QUANTITY_ENTITY = {
  IFCQUANTITYVOLUME: 'volume',
  IFCQUANTITYAREA: 'area',
  IFCQUANTITYLENGTH: 'length',
  IFCQUANTITYWEIGHT: 'weight',
  IFCQUANTITYCOUNT: 'count',
};

/** 물량이 뜻을 갖는 부재. 이 목록 밖은 「기타」로 모은다 */
const ELEMENT_LABEL = {
  IFCWALL: '벽', IFCWALLSTANDARDCASE: '벽',
  IFCSLAB: '슬래브', IFCROOF: '지붕',
  IFCCOLUMN: '기둥', IFCBEAM: '보',
  IFCFOOTING: '기초', IFCPILE: '파일',
  IFCSTAIR: '계단', IFCSTAIRFLIGHT: '계단',
  IFCDOOR: '문', IFCWINDOW: '창',
  IFCCOVERING: '마감', IFCCURTAINWALL: '커튼월',
  IFCRAMP: '램프', IFCMEMBER: '부재', IFCPLATE: '판',
  IFCSPACE: '공간', IFCBUILDINGSTOREY: '층',
};

/* ── STEP Physical File 훑기 ────────────────────────────────
 *
 * ★ 정규식 하나로 잘라 내지 않는다. IFC 의 문자열에는 세미콜론·괄호·쉼표가
 *   그대로 들어 있고(주소·부재명), 정규식으로 자르면 그 줄부터 어긋난다.
 *   그러면 **틀린 수량이 그럴듯하게 나온다** — 문서만 봐서는 안 잡힌다.
 *   그래서 문자열 안인지 밖인지를 지키며 한 글자씩 읽는다.
 */

/** 한 줄(`#12=IFCWALL(...);`)을 { id, type, args } 로 */
function parseLine(line) {
  const eq = line.indexOf('=');
  if (eq === -1 || line[0] !== '#') return null;
  const id = Number(line.slice(1, eq).trim());
  if (!Number.isFinite(id)) return null;

  const rest = line.slice(eq + 1).trim();
  const open = rest.indexOf('(');
  if (open === -1) return null;
  const type = rest.slice(0, open).trim().toUpperCase();
  const args = splitArgs(rest.slice(open + 1, rest.lastIndexOf(')')));
  return { id, type, args };
}

/** 최상위 쉼표로만 자른다 (문자열·중첩 괄호 안의 쉼표는 건드리지 않는다) */
function splitArgs(s) {
  const out = [];
  let depth = 0, inStr = false, buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      // STEP 은 작은따옴표를 두 번 써서 escape 한다 ('' → ')
      if (c === "'" && s[i + 1] === "'") { buf += "''"; i += 1; continue; }
      if (c === "'") { inStr = false; buf += c; continue; }
      buf += c;
      continue;
    }
    if (c === "'") { inStr = true; buf += c; continue; }
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim() !== '' || out.length) out.push(buf.trim());
  return out;
}

/**
 * 파일을 줄 단위 실체로 나눈다.
 *
 * ★ 줄바꿈으로 자르지 않는다. IFC 한 실체가 여러 줄에 걸쳐 있는 파일이
 *   흔하다 (내보내기 도구마다 줄 길이 제한이 다르다). **세미콜론**으로
 *   자르되, 문자열 안의 세미콜론은 건너뛴다.
 */
function* statements(text) {
  let inStr = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "'" && text[i + 1] === "'") { i += 1; continue; }
      if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === ';') {
      const chunk = text.slice(start, i).trim();
      start = i + 1;
      if (chunk) yield chunk;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) yield tail;
}

function str(arg) {
  if (typeof arg !== 'string') return null;
  const s = arg.trim();
  if (s === '$' || s === '*' || s === '') return null;
  if (s[0] !== "'" || s[s.length - 1] !== "'") return null;
  return unescapeStep(s.slice(1, -1));
}

/**
 * STEP 문자열 되돌리기. `\X2\D55C\X0\` 같은 표기가 **한글 부재명에 그대로 쓰인다** —
 * 안 풀면 화면에 `\X2\...` 가 그대로 나간다.
 */
function unescapeStep(s) {
  let out = s.split("''").join("'");
  out = out.replace(/\\X2\\((?:[0-9A-Fa-f]{4})+)\\X0\\/g, (_, hex) => {
    let t = '';
    for (let i = 0; i < hex.length; i += 4) t += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return t;
  });
  out = out.replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return out;
}

function ref(arg) {
  if (typeof arg !== 'string') return null;
  const s = arg.trim();
  if (s[0] !== '#') return null;
  const n = Number(s.slice(1));
  return Number.isFinite(n) ? n : null;
}

function refList(arg) {
  if (typeof arg !== 'string') return [];
  const s = arg.trim();
  if (s[0] !== '(') return [];
  return splitArgs(s.slice(1, -1)).map(ref).filter(x => x !== null);
}

function numArg(arg) {
  if (typeof arg !== 'string') return null;
  const s = arg.trim();
  if (s === '$' || s === '*' || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ── 읽기 ──────────────────────────────────────────────── */

/**
 * @param {Buffer|string} input .ifc 파일 내용
 * @param {object} [opt] { name } — 출처에 남길 파일명
 * @returns {{ok, schema, hasQuantities, elements, totals, unmapped, reason, source}}
 */
function read(input, opt) {
  const o = opt || {};
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  if (buf.length > MAX_BYTES) {
    return fail(`IFC 파일이 ${Math.round(buf.length / 1048576)}MB 다 — `
      + `${Math.round(MAX_BYTES / 1048576)}MB 를 넘으면 읽지 않는다 (메모리)`);
  }
  const text = buf.toString('utf8');
  if (text.indexOf('ISO-10303-21') === -1) {
    return fail('IFC(STEP) 파일이 아니다 — 헤더에 ISO-10303-21 이 없다');
  }

  const schema = (text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i) || [])[1] || null;

  // ── 1차: 필요한 실체만 모은다 ──────────────────────────
  const quantities = new Map();   // id → { kind, axis, name, value }
  const qsets = new Map();        // id → { name, quantityIds[] }
  const relDefines = [];          // { objectIds[], definitionId }
  const products = new Map();     // id → { type, name, tag }

  for (const stmt of statements(text)) {
    if (stmt[0] !== '#') continue;
    const e = parseLine(stmt);
    if (!e) continue;

    if (QUANTITY_ENTITY[e.type]) {
      const name = str(e.args[0]);
      const value = numArg(e.args[3]);
      quantities.set(e.id, {
        axis: QUANTITY_ENTITY[e.type],
        name: name,
        kind: name ? (QUANTITY_KIND[name.toUpperCase().replace(/[\s_]/g, '')] || null) : null,
        value: value,
      });
      continue;
    }
    if (e.type === 'IFCELEMENTQUANTITY') {
      qsets.set(e.id, { name: str(e.args[2]), ids: refList(e.args[5]) });
      continue;
    }
    if (e.type === 'IFCRELDEFINESBYPROPERTIES') {
      relDefines.push({ objects: refList(e.args[4]), definition: ref(e.args[5]) });
      continue;
    }
    if (ELEMENT_LABEL[e.type] || e.type.startsWith('IFC')) {
      // 부재 후보 — GlobalId(0) · Name(2) 자리가 IfcRoot 계열의 규약이다
      const gid = str(e.args[0]);
      if (gid && gid.length >= 20) products.set(e.id, { type: e.type, name: str(e.args[2]) });
    }
  }

  // ── 2차: 부재에 수량을 붙인다 ──────────────────────────
  const byElement = new Map();
  const unmapped = new Map();     // 이름을 모르는 수량 — 버리지 않고 세어 둔다

  relDefines.forEach((rel) => {
    const qset = qsets.get(rel.definition);
    if (!qset) return;
    rel.objects.forEach((pid) => {
      const p = products.get(pid);
      if (!p) return;
      const label = ELEMENT_LABEL[p.type] || '기타';
      if (!byElement.has(label)) {
        byElement.set(label, { label: label, types: new Set(), count: 0, q: {} });
      }
      const slot = byElement.get(label);
      slot.types.add(p.type);
      slot.count += 1;

      qset.ids.forEach((qid) => {
        const q = quantities.get(qid);
        if (!q || q.value === null) return;
        if (!q.kind) {
          unmapped.set(q.name || '(이름 없음)', (unmapped.get(q.name || '(이름 없음)') || 0) + 1);
          return;
        }
        const key = q.kind;
        slot.q[key] = (slot.q[key] || 0) + q.value;
      });
    });
  });

  const elements = [...byElement.values()]
    .map(e => ({ label: e.label, count: e.count, types: [...e.types].sort(), quantities: e.q }))
    .sort((a, b) => b.count - a.count);

  const totals = {};
  elements.forEach((e) => {
    Object.keys(e.quantities).forEach((k) => { totals[k] = (totals[k] || 0) + e.quantities[k]; });
  });

  const hasQuantities = elements.some(e => Object.keys(e.quantities).length > 0);

  return {
    ok: true,
    schema,
    hasQuantities,
    elements,
    totals,
    // ★ 「이름을 몰라 못 센 수량」을 함께 돌려준다. 이게 없으면 물량이 왜
    //   적은지 알 수 없고, 적은 물량이 그대로 견적이 된다
    unmapped: [...unmapped.entries()].map(([name, n]) => ({ name, count: n }))
      .sort((a, b) => b.count - a.count),
    reason: hasQuantities ? null
      : '이 모델에는 수량(IfcElementQuantity)이 들어 있지 않다. '
        + '내보낼 때 「Base Quantities / 기본 수량」 옵션을 켜고 다시 내보내야 한다. '
        + '형상에서 물량을 새로 계산하지는 않는다',
    source: {
      provider: 'IFC 모델',
      file: o.name || null,
      schema: schema,
      note: '설계 도구가 내보낼 때 써 넣은 수량을 그대로 읽었다 — 형상에서 다시 계산하지 않았다',
    },
  };
}

function fail(reason) {
  return {
    ok: false, schema: null, hasQuantities: false,
    elements: [], totals: {}, unmapped: [], reason, source: null,
  };
}

/**
 * 사람이 읽는 한 줄 요약. **없으면 없다고 적는다.**
 */
function summarize(r) {
  if (!r || !r.ok) return r && r.reason ? r.reason : 'IFC 를 읽지 못했다';
  if (!r.hasQuantities) return r.reason;
  const parts = [];
  if (r.totals.grossArea || r.totals.netArea) {
    parts.push(`면적 ${Math.round(r.totals.grossArea || r.totals.netArea).toLocaleString()}㎡`);
  }
  if (r.totals.netVolume || r.totals.grossVolume) {
    parts.push(`부피 ${Math.round(r.totals.netVolume || r.totals.grossVolume).toLocaleString()}㎥`);
  }
  const head = `부재 ${r.elements.reduce((a, e) => a + e.count, 0)}개 · ${parts.join(' · ') || '수량 축 없음'}`;
  return r.unmapped.length ? `${head} (이름을 모르는 수량 ${r.unmapped.length}종은 세지 않았다)` : head;
}

module.exports = { read, summarize, MAX_BYTES, ELEMENT_LABEL, QUANTITY_KIND, QUANTITY_ENTITY };
