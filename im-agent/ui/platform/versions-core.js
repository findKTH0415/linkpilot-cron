'use strict';
/**
 * versions.js — 같은 문서의 **여러 판**을 찾아 알린다 (2026-08-21 · 클라우드 폴더 지시 §7).
 *
 * ★★ 왜 필요한가: 폴더에서 자료를 고르면 이런 것들이 함께 들어온다.
 *
 *     IM_v1.pdf · IM_v2.pdf · IM_20260820.pdf · IM_Final.pdf · IM_Final_20260820.pdf
 *
 *   사람은 「Final 이 최신이겠지」로 넘어간다. **그 짐작이 틀리는 경우가 흔하다** —
 *   `IM_Final.pdf` 를 만든 뒤에 `IM_v3.pdf` 를 더 고치는 일이 실제로 일어난다.
 *   틀린 판으로 보고서를 만들면 숫자는 멀쩡해 보이고 출처도 붙는다. **문서만
 *   봐서는 절대 안 잡힌다.**
 *
 * ★★ **자동으로 하나를 고르지 않는다.** 이것이 이 파일의 전부다 (CLAUDE.md §4.9).
 *   순서는 매겨 주되 고르는 것은 사람이다 — 틀렸을 때 되돌릴 수 있어야 하기 때문이다.
 *
 * ★ 「Final · 최종 · 최종본」이라는 **이름만으로 최신이라고 단정하지 않는다** (지시 §7).
 *   이름은 사람이 붙이는 것이고, 붙인 뒤에 파일이 또 바뀐다.
 *
 * ★ 출처를 가리지 않는다. Dropbox 든 NAS 든 앱이 넘긴 것이든 **같은 방식으로** 본다 —
 *   묶는 기준이 파일 이름이지 저장소가 아니기 때문이다.
 *
 * ★ 화면과 Node 가 **같은 파일**을 쓴다 (UMD). 사본을 만들면 갈린다 —
 *   이 저장소는 색과 단계 이름에서 이미 두 번 겪었다.
 *
 * 의존성 없음.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotVersions = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * ★ **이 스크립트가 어느 판인가** 〈2026-08-23 · D-93 사고〉.
   *   `build-stamp.js` 가 채운다 — 손으로 고치지 않는다. 화면이 자기
   *   지문과 대 보고 다르면 「함수가 없다」로 죽기 전에 사람 말로 알린다.
   */
  var LP_BUILD = '7ccb1b42';

  /** 버전으로 읽히는 꼬리표. **떼어내고 남은 것**이 같으면 같은 문서로 본다 */
  const VERSION_TOKEN = [
    /\bv(er(sion)?)?[ ._-]?\d+(\.\d+)*\b/gi,   // v1 · v03 · ver2 · version 1.2
    /\b(rev|리비전|판)[ ._-]?\d+\b/gi,          // rev2 · 판3
    /\b\d{8}\b/g,                               // 20260820
    /\b\d{4}[-._]\d{2}[-._]\d{2}\b/g,           // 2026-08-20
    /\b\d{6}\b/g,                               // 260820
    /\((\d+)\)/g,                               // 사본 (2)
    /\b(final|fin|latest|last)\b/gi,
    /(최종본|최종|파이널|마지막)/g,
    /\b(copy|사본|복사본)\b/gi,
    /\b(draft|초안|시안)\b/gi,
  ];

  /** 「최종」이라고 **이름이 주장하는가**. 주장일 뿐 근거가 아니다 */
  const CLAIMS_FINAL = /(final|최종본|최종|파이널)/i;

  /**
   * 밑줄을 띄어쓰기로 바꾼다. **이것을 먼저 하지 않으면 아무것도 안 잡힌다** —
   * `IM_v1.pdf` 의 `_v` 는 자바스크립트가 낱말 경계로 보지 않아서(`_` 도 낱말
   * 문자다) `\bv\d+` 가 안 걸린다. 실제로 그래서 묶음이 0 개로 나왔다.
   */
  function norm(name) {
    return String(name || '').replace(/_+/g, ' ');
  }

  function ext(name) {
    const m = String(name || '').match(/\.[A-Za-z0-9]{1,8}$/);
    return m ? m[0].toLowerCase() : '';
  }

  /**
   * 이름에서 **판을 뜻하는 부분을 떼어낸** 어간.
   * `IM_Final_20260820.pdf` · `IM_v2.pdf` → `im`
   */
  function stem(name) {
    const raw = String(name || '');
    let s = norm(raw.slice(0, raw.length - ext(raw).length));
    VERSION_TOKEN.forEach((re) => { s = s.replace(re, ' '); });
    return s
      .replace(/[_.\-()[\]{}]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * 이름에서 읽어낸 판 번호. **없으면 `null` 이다** — 0 으로 두면 번호 없는 것이
   * 「가장 낮은 판」으로 줄을 서는데, 실제로는 번호가 없는 것뿐이다.
   */
  function versionNumber(name) {
    const n = norm(name);
    const m = n.match(/\bv(?:er(?:sion)?)?[ ._-]?(\d+)/i)
      || n.match(/\b(?:rev|판)[ ._-]?(\d+)\b/i);
    return m ? Number(m[1]) : null;
  }

  /** 이름에 박힌 날짜 (YYYYMMDD). 없으면 `null` */
  function stampedDate(name) {
    const s = norm(name);
    let m = s.match(/\b(\d{4})[-._]?(\d{2})[-._]?(\d{2})\b/);
    if (!m) return null;
    const y = Number(m[1]);
    if (y < 1990 || y > 2999) return null;
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  }

  /** 비교에 쓸 시각. 없으면 빈 문자열 (뒤로 밀린다) */
  function when(item) {
    return String((item && (item.modifiedAt || item.readAt || item.createdAt)) || '');
  }

  /**
   * 무엇을 근거로 삼을 수 있는가. **셀 수 있는 근거일수록 세다.**
   *   4 판 번호 · 3 이름의 날짜 · 2 수정·읽은 시각 · 1 「최종」이라는 주장 · 0 없음
   */
  function strength(it) {
    if (versionNumber(it.name) !== null) return 4;
    if (stampedDate(it.name)) return 3;
    if (when(it)) return 2;
    if (CLAIMS_FINAL.test(it.name)) return 1;
    return 0;
  }

  /**
   * 줄을 세운다 — **근거가 센 것부터, 같은 근거끼리는 값으로.**
   *
   * ★★ 처음에는 지시 §7 의 차례(번호 → 최종표시 → 날짜 → 수정일)를 그대로 옮겼는데,
   *   그러면 **`IM_Final.pdf` 가 `IM_v2.pdf` 를 앞질렀다.** 같은 지시서가
   *   「이름만으로 최신이라고 단정하지 않는다」고 하는데 이름이 번호를 이긴 것이다.
   *   그래서 **주장은 맨 아래로** 내렸다 — 잴 수 있는 것이 있으면 그쪽이 먼저다.
   *
   * ★★ **종류가 다르면 가릴 수 없다.** `IM_v2.pdf` 와 `IM_20260820.pdf` 중 무엇이
   *   최신인지는 **알 방법이 없다.** 순서는 보여 주되 「못 가렸다」고 말한다 —
   *   여기서 하나를 고르면 그것이 곧 추측이다 (CLAUDE.md §4.9).
   *
   * @returns {number} 음수면 a 가 앞
   */
  function compare(a, b) {
    const sa = strength(a);
    const sb = strength(b);
    if (sa !== sb) return sb - sa;
    if (sa === 4) return versionNumber(b.name) - versionNumber(a.name);
    if (sa === 3) {
      const da = stampedDate(a.name);
      const db = stampedDate(b.name);
      return da === db ? 0 : (da < db ? 1 : -1);
    }
    if (sa === 2) {
      const wa = when(a);
      const wb = when(b);
      return wa === wb ? 0 : (wa < wb ? 1 : -1);
    }
    return 0;
  }

  /** 앞의 둘을 **정말로 가렸는가.** 근거 종류가 다르면 가린 것이 아니다 */
  function decidable(a, b) {
    if (strength(a) !== strength(b)) return false;   // 번호 vs 날짜 — 견줄 수 없다
    if (strength(a) <= 1) return false;              // 주장뿐이거나 근거가 없다
    return compare(a, b) !== 0;
  }

  /**
   * 무엇을 근거로 앞에 세웠는지 **말한다.** 순서만 주면 왜 그런지 알 수 없고,
   * 알 수 없으면 사람이 고를 수가 없다.
   */
  function basisOf(item) {
    const v = versionNumber(item.name);
    if (v !== null) return `판 번호 v${v}`;
    const d = stampedDate(item.name);
    if (d) return `이름의 날짜 ${d}`;
    const w = when(item);
    if (w) return `수정·읽은 시각 ${w.slice(0, 10)}`;
    if (CLAIMS_FINAL.test(item.name)) return '이름이 「최종」이라고 말함 (근거 아님)';
    return '가릴 근거가 없음';
  }

  /**
   * 같은 문서의 여러 판을 묶는다.
   *
   * @param {Array<{name:string, key?:string, provider?:string, rev?:string,
   *   modifiedAt?:string, readAt?:string, bytes?:number}>} items
   * @returns {{groups:Array, conflicts:number}}
   *   groups[i] = { stem, ext, items:[…최신 추정 순…], conflict:boolean, why:string }
   *
   * ★ `conflict` 는 「하나로 정할 수 없다」는 뜻이지 「고장」이 아니다.
   *   판이 여럿인 것은 정상이고, **어느 것을 쓸지 안 정한 것**이 문제다.
   */
  /** 지문 한 줄. 모양이 여럿이라 **아는 자리를 전부 본다** (없으면 null) */
  function fingerprintOf(it) {
    const f = it && it.fingerprint;
    const v = (f && (f.value || f.sha256)) || (it && it.sha256);
    return v ? String(v) : null;
  }

  /**
   * 지문이 같은 것을 **한 벌로 접는다.** 접은 수(`copies`)와 다른 이름
   * (`alsoNamed`)은 남긴다 — 접은 것이지 지운 것이 아니다.
   */
  function sameFile(items) {
    const out = [];
    const at = new Map();
    (items || []).forEach((it) => {
      if (!it) return;
      const k = fingerprintOf(it);
      if (!k) { out.push(it); return; }
      const seen = at.get(k);
      if (seen === undefined) {
        at.set(k, out.length);
        out.push(Object.assign({}, it, {
          copies: it.times || 1,
          alsoNamed: (it.alsoNamed || []).slice(),
        }));
        return;
      }
      const prev = out[seen];
      prev.copies += (it.times || 1);
      const other = it.name;
      if (other && other !== prev.name && prev.alsoNamed.indexOf(other) === -1) {
        prev.alsoNamed.push(other);
      }
    });
    return out;
  }

  function group(items) {
    /* ★★★ **같은 바이트를 「판이 둘」이라고 하지 않는다** 〈2026-08-23 사장님:
     *   「중복 오류 버그잡아줘」〉.
     *
     *   화면에 같은 그림이 여덟 줄 떴다 — `…인세티브(1).png` 와 `(2).png` 가
     *   번갈아. **맥이 같은 파일을 두 번 내려받으며 붙인 번호**였고, 사장님이
     *   OCR 이 꺼져 있던 동안 같은 자료를 네 번 올려 보신 것이 겹쳤다.
     *
     *   화면은 그것을 「어느 판으로 만들지 고르십시오」로 보여 줬다 —
     *   **고를 것이 없는데 고르라는 말**이다.
     *
     * ★ 지문이 같으면 바이트가 같다. 이름이 달라도 **한 벌**이다.
     * ★ 서버(`core/oneshot.js`)도 같은 규칙으로 접지만, 여기서도 접는다 —
     *   보관·연결·1회성이 **섞여 들어오는 곳은 여기뿐**이고, 서버 판이
     *   옛것이어도 화면은 맞아야 한다.
     * ★ 지문이 없으면 **안 접는다.** 같은지 알 수 없는 것을 같다고 하지 않는다. */
    items = sameFile(items);

    const by = new Map();
    (items || []).forEach((it) => {
      if (!it || !it.name) return;
      const k = stem(it.name) + '|' + ext(it.name);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(it);
    });

    const groups = [];
    by.forEach((list, k) => {
      if (list.length < 2) return;              // 한 벌뿐이면 고를 것이 없다
      const sorted = list.slice().sort(compare);
      // 앞의 둘을 **가릴 수 있었는가**. 못 가렸으면 순서에 뜻이 없다
      const tied = !decidable(sorted[0], sorted[1]);
      groups.push({
        stem: k.split('|')[0],
        ext: k.split('|')[1],
        items: sorted.map(it => Object.assign({}, it, { basis: basisOf(it) })),
        conflict: true,
        // ★ 못 가린 것을 「가렸다」로 내지 않는다
        why: tied
          ? '무엇이 최신인지 가릴 근거가 없습니다 — 파일을 열어 확인해야 합니다'
          : `${basisOf(sorted[0])} 기준으로 앞에 두었습니다 — 확인하고 고르십시오`,
        undecidable: tied,
      });
    });

    // 판이 많은 묶음부터 (사람이 먼저 봐야 할 순서)
    groups.sort((a, b) => b.items.length - a.items.length);
    return { groups, conflicts: groups.length };
  }

  return {
    BUILD: LP_BUILD,
    group: group, sameFile: sameFile, fingerprintOf: fingerprintOf,
    stem: stem, ext: ext, versionNumber: versionNumber,
    stampedDate: stampedDate, compare: compare, basisOf: basisOf,
    strength: strength, decidable: decidable, CLAIMS_FINAL: CLAIMS_FINAL,
  };
}));
