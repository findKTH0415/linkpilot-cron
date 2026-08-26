/**
 * fields-core.js — 가이드 필드 입력값 판정 로직.
 *
 * ★★ 이 파일에는 **필드 정의가 없다.** 단일 출처는 `core/dictionary.js` 뿐이고,
 *   화면은 `GET /fields` 로 받아 쓴다. 여기에 필드를 복사해 두면 사전이 바뀔 때
 *   화면만 옛 항목을 계속 보여준다 — 그런 화면은 없느니만 못하다.
 *
 * 여기 있는 것은 '받은 정의로 무엇을 판정하는가' 뿐이다:
 *   ① 출처 없는 값은 저장할 수 없다 (facts.js 가 던지는 예외를 화면에서 먼저 막는다)
 *   ② 계산 항목은 입력란 자체를 만들지 않는다
 *   ③ 범위를 벗어난 값은 **막지 않고 경고한다** — 진짜 이상값을 화면이 숨기면
 *      05 Validation 이 잡을 것을 못 잡는다
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 동작한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotFields = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * ★ **이 스크립트가 어느 판인가** 〈2026-08-23 · D-93 사고〉.
   *   `build-stamp.js` 가 채운다 — 손으로 고치지 않는다. 화면이 자기
   *   지문과 대 보고 다르면 「함수가 없다」로 죽기 전에 사람 말로 알린다.
   */
  var LP_BUILD = 'c2ddb960';

  /** 화면에 놓는 순서. 사전의 CATEGORY 값과 같은 문자열을 쓴다 */
  var CATEGORY_ORDER = [
    'Project', 'Land', 'Building', 'Capacity', 'Investment',
    'Revenue', 'OPEX', 'Debt', 'Equity', 'Tax', 'Schedule', 'Exit', 'Legal',
  ];

  /** 보고서 종류 → 사전의 requiredFor 값 */
  var DOC_REQUIRES = {
    im: ['im', 'financial'],
    teaser: ['teaser'],
    summary: ['im'],
    validation: ['im', 'financial'],
  };

  /** 억원 환산표 — 사용자가 원/만원/백만원으로 들고 오는 경우가 대부분이다 */
  var TO_EOKWON = { '원': 1e-8, '만원': 1e-4, '백만원': 1e-2, '천만원': 1e-1, '억원': 1 };

  /**
   * 카테고리별로 묶는다. 사전에 없는 카테고리가 와도 버리지 않고 뒤에 붙인다 —
   * 사전에 항목이 추가됐는데 화면에서 사라지면 입력할 방법이 없어진다.
   */
  function groupByCategory(fields) {
    var buckets = {};
    var extras = [];
    Object.keys(fields || {}).forEach(function (key) {
      var f = fields[key];
      var cat = (f && f.category) || '기타';
      if (!buckets[cat]) { buckets[cat] = []; if (CATEGORY_ORDER.indexOf(cat) === -1) extras.push(cat); }
      buckets[cat].push({ key: key, def: f });
    });
    var order = CATEGORY_ORDER.filter(function (c) { return buckets[c]; }).concat(extras.sort());
    return order.map(function (c) { return { category: c, items: buckets[c] }; });
  }

  /**
   * 이 보고서 종류에 필수인 key 목록.
   *
   * @param {string[]} [classKeys] 자산군 전용 필수 키 (`core/assetclass.js` 가 준다).
   *   **더해지기만 한다** — 문서 종류 필수를 자산군이 빼앗지 않는다. 빼면
   *   호텔 딜에서 대지면적이 필수가 아니게 되는 식으로 규칙이 조용히 무너진다.
   *
   * ★ 사전에 없는 키는 넣지 않는다. 넣으면 입력란은 안 생기는데 필수로는
   *   세어져 진행률이 영원히 100% 가 되지 않는다.
   */
  function requiredKeys(fields, docType, classKeys) {
    var want = DOC_REQUIRES[docType] || [];
    var f = fields || {};
    var out = Object.keys(f).filter(function (key) {
      var r = (f[key] && f[key].requiredFor) || [];
      return r.some(function (x) { return want.indexOf(x) !== -1; });
    });
    (classKeys || []).forEach(function (k) {
      if (f[k] && out.indexOf(k) === -1) out.push(k);
    });
    return out;
  }

  /**
   * 채움 정도. **값만 있고 출처가 없으면 채운 것으로 세지 않는다** —
   * 저장 자체가 안 되는 값을 진행률에 넣으면 다 됐다고 착각한다.
   */
  function completeness(fields, values, docType, classKeys) {
    var keys = requiredKeys(fields, docType, classKeys);
    var missing = keys.filter(function (k) {
      var v = (values || {})[k];
      return !v || v.value === '' || v.value === null || v.value === undefined || !v.source;
    });
    return {
      total: keys.length,
      filled: keys.length - missing.length,
      missing: missing,
      percent: keys.length ? Math.round((keys.length - missing.length) / keys.length * 100) : 0,
    };
  }

  /** 숫자 입력 정리 — 쉼표·공백만 없앤다. 단위는 짐작하지 않는다 */
  function parseNumber(raw) {
    if (raw === null || raw === undefined) return NaN;
    var s = String(raw).trim().replace(/,/g, '').replace(/\s/g, '');
    if (s === '') return NaN;
    return Number(s);
  }

  /**
   * 억원 환산. **자동으로 적용하지 않는다** — 값을 돌려주기만 하고
   * 적용 여부는 사람이 확인해서 누른다. 단위를 잘못 잡으면 재무모델이 통째로 틀린다.
   */
  function toEokwon(raw, fromUnit) {
    var n = parseNumber(raw);
    var f = TO_EOKWON[fromUnit];
    if (!Number.isFinite(n) || !f) return null;
    return Math.round(n * f * 1e6) / 1e6;
  }

  function isComputed(key, computedKeys) {
    return (computedKeys || []).indexOf(key) !== -1;
  }

  /**
   * 입력 한 건 판정.
   * @returns {{errors:string[], warnings:string[]}} errors 가 있으면 저장할 수 없다
   */
  function validateEntry(key, def, entry, computedKeys) {
    var errors = [];
    var warnings = [];
    var e = entry || {};
    var label = (def && def.label) || key;

    if (isComputed(key, computedKeys)) {
      errors.push(label + ': 계산으로 만들어지는 항목이라 입력할 수 없다');
      return { errors: errors, warnings: warnings };
    }
    if (!def) {
      errors.push(key + ': 사전에 없는 항목 — 사전에 없는 key 는 보고서에 들어가지 못한다');
      return { errors: errors, warnings: warnings };
    }

    var blank = e.value === '' || e.value === null || e.value === undefined;
    if (blank) {
      // 값이 없으면 '입력하지 않은 것'이다. 출처만 적어 둔 경우만 걸러낸다
      if (e.source) errors.push(label + ': 출처만 있고 값이 없다');
      return { errors: errors, warnings: warnings };
    }

    // ★ facts.js 가 던지는 것과 같은 규칙을 화면에서 먼저 막는다
    if (!e.source || !String(e.source).trim()) {
      errors.push(label + ': 출처가 없다 — 출처 없는 값은 저장할 수 없다');
    }

    if (def.type === 'number') {
      var n = parseNumber(e.value);
      if (!Number.isFinite(n)) {
        errors.push(label + ': 숫자가 아니다 (' + e.value + ')');
      } else {
        // 범위 위반은 경고까지만. 막으면 진짜 이상값이 화면에서 사라진다
        if (def.min !== undefined && n < def.min) {
          warnings.push(label + ': ' + n + (def.unit || '') + ' — 허용 최소 ' + def.min + ' 미만');
        }
        if (def.max !== undefined && n > def.max) {
          warnings.push(label + ': ' + n + (def.unit || '') + ' — 허용 최대 ' + def.max + ' 초과');
        }
      }
    }

    if (e.page !== undefined && e.page !== null && String(e.page).trim() !== '') {
      var p = parseNumber(e.page);
      if (!Number.isFinite(p) || p < 1) errors.push(label + ': 페이지는 1 이상의 숫자여야 한다');
    }
    if (e.sourceDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.sourceDate))) {
      errors.push(label + ': 출처일은 YYYY-MM-DD 형식이어야 한다');
    }
    return { errors: errors, warnings: warnings };
  }

  /** 전체 판정 — 저장 버튼을 열지 말지 정한다 */
  function validateAll(fields, values, computedKeys) {
    var errors = [];
    var warnings = [];
    Object.keys(values || {}).forEach(function (key) {
      var r = validateEntry(key, (fields || {})[key], values[key], computedKeys);
      errors = errors.concat(r.errors);
      warnings = warnings.concat(r.warnings);
    });
    return { errors: errors, warnings: warnings, canSave: errors.length === 0 };
  }

  /**
   * 화면 판(版) — 무엇까지 보여줄지.
   *
   * ★ 일반용은 **파이프라인이 요구하는 항목만** 보여준다. 52개를 한꺼번에
   *   내밀면 무엇부터 채워야 하는지 모른다. 전문가용은 전부 보여준다.
   *
   * ★ 일반용에서 감춘 항목도 **값이 있거나 문제가 있으면 보인다.** 감춘 채로
   *   틀린 값이 남아 있으면 고칠 방법이 없다 (isVisible 참조).
   */
  var LEVELS = {
    manual: { id: 'manual', label: '직접 입력', hint: '자동으로 못 채우는 것만' },
    basic:  { id: 'basic',  label: '일반용',   hint: '보고서에 꼭 필요한 항목' },
    expert: { id: 'expert', label: '전문가용', hint: '사전의 모든 항목' },
  };

  /** 자동으로 채워지는 경로 — 이 경로가 붙은 항목은 사람이 칠 필요가 없다 */
  var AUTO_FILLS = ['request', 'public', 'derived', 'default'];

  /** 이 항목이 자동으로 채워지는가 (plan 이 없으면 모른다 → 자동이 아니라고 본다) */
  function isAuto(key, plan) {
    var p = (plan || {})[key];
    return !!(p && AUTO_FILLS.indexOf(p.fill) !== -1);
  }

  /**
   * 이 판·산업에서 보여줄 key 인가 (값 유무·오류와 무관한 '기본 노출' 판정).
   *
   * @param {object} industry { own:[], foreign:[] } — 서버가 준 산업 정의.
   *   없으면 산업으로 거르지 않는다 (모르는 것을 감추면 입력할 방법이 없어진다)
   */
  function inScope(key, fields, opts) {
    var o = opts || {};
    var def = (fields || {})[key];
    if (!def) return false;

    // 산업 전용 항목 — 다른 산업이면 감춘다 (태양광 딜에 PUE 를 띄우지 않는다)
    var ind = o.industry;
    if (ind && ind.foreign && ind.foreign.indexOf(key) !== -1) return false;

    if (o.level === 'expert') return true;

    var isRequired = (def.requiredFor || []).length
      && requiredKeys(fields, o.docType).indexOf(key) !== -1;

    // 직접 입력 — 필수인데 **자동으로 못 채우는 것**만 남긴다.
    // 52칸을 내밀면 사람은 알지도 못하는 값을 지어내서 채운다
    if (o.level === 'manual') return !!isRequired && !isAuto(key, o.plan);

    // 일반용 — 이 보고서 종류에 필요한 항목 + 이 산업의 핵심 지표
    if ((def.requiredFor || []).length) return !!isRequired;
    return !!(ind && ind.own && ind.own.indexOf(key) !== -1 && (def.category === 'Capacity'));
  }

  /** 오류·경고가 붙은 항목인가 */
  function hasProblem(key, fields, values, computedKeys) {
    var e = (values || {})[key];
    if (!e) return false;
    var v = validateEntry(key, (fields || {})[key], e, computedKeys);
    return v.errors.length > 0 || v.warnings.length > 0;
  }

  /**
   * 목록에 보일 key 판정.
   *
   * ★ 오류·경고가 있는 줄은 필터·검색과 무관하게 항상 보인다.
   *   "경고 1건"이라고 띄워 놓고 그 줄이 필터에 가려 있으면 고칠 방법이 없다.
   *
   * @param {object} opts { filter: 'required'|'all'|'empty', q, docType }
   */
  function isVisible(key, fields, values, computedKeys, opts) {
    var o = opts || {};
    var def = (fields || {})[key];
    if (!def) return false;

    if (hasProblem(key, fields, values, computedKeys)) return true;

    // 값이 들어 있으면 판·산업과 무관하게 보인다.
    // 감춘 채로 틀린 값이 남아 있으면 고칠 방법이 없다
    var e0 = (values || {})[key];
    var hasValue = e0 && e0.value !== '' && e0.value !== null && e0.value !== undefined;
    if (!hasValue && !inScope(key, fields, o)) return false;

    if (o.filter === 'required' && requiredKeys(fields, o.docType).indexOf(key) === -1) return false;
    if (o.filter === 'empty') {
      var e = (values || {})[key];
      if (e && e.value !== '' && e.value !== null && e.value !== undefined) return false;
    }
    var q = String(o.q || '').trim().toLowerCase();
    if (!q) return true;
    var hay = (def.label + ' ' + key + ' ' + (def.aliases || []).join(' ')).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  /**
   * 이 줄에 **출처를 물어야 하는가.**
   *
   * ★ 자동으로 채워지는 줄에는 묻지 않는다. 그 값의 출처는 이미 정해져 있다
   *   (요청문 · 공공데이터 · 산업 통상치 · 계산). 시스템이 채울 값의 근거를
   *   사람에게 물으면 사람은 **자기가 모르는 것을 적어 넣는다** — 출처 강제가
   *   오히려 거짓 출처를 만든다. 막으려던 바로 그 일이다.
   *
   * ★ 단 사람이 값을 치는 순간 달라진다. 자동값을 덮어쓰는 것이므로 근거가
   *   있어야 하고, 그때 출처 칸이 나타나며 저장이 잠긴다.
   *
   * @param {object} entry { value, source } — 화면의 현재 입력값
   */
  function asksSource(key, entry, plan) {
    if (!isAuto(key, plan)) return true;          // 사람이 채우는 줄 — 처음부터 묻는다
    var e = entry || {};
    var typed = e.value !== '' && e.value !== null && e.value !== undefined;
    return typed || !!e.source;                   // 덮어쓰기 시작 or 이미 적어 둔 출처
  }

  /**
   * 이 보고서에 필요한 항목 중 자동으로 채워지는 것의 내역.
   * 화면이 "몇 개나 안 물어봐도 되는지"를 근거와 함께 보여줄 때 쓴다.
   */
  function autoBreakdown(fields, plan, docType) {
    var keys = requiredKeys(fields, docType);
    var by = {};
    var manual = [];
    keys.forEach(function (k) {
      var p = (plan || {})[k];
      if (p && AUTO_FILLS.indexOf(p.fill) !== -1) {
        if (!by[p.fill]) by[p.fill] = { fill: p.fill, label: p.label, why: p.why, keys: [] };
        by[p.fill].keys.push(k);
      } else {
        manual.push(k);
      }
    });
    return {
      total: keys.length,
      manual: manual,
      groups: AUTO_FILLS.filter(function (f) { return by[f]; }).map(function (f) { return by[f]; }),
    };
  }

  /** 저장 대상만 추린다 — 값이 있는 것만. 빈 칸을 보내면 기존 값이 지워진다 */
  function changedEntries(values) {
    var out = [];
    Object.keys(values || {}).forEach(function (key) {
      var e = values[key];
      if (!e || e.value === '' || e.value === null || e.value === undefined) return;
      out.push({
        key: key,
        value: e.value,
        source: e.source,
        sourceDate: e.sourceDate || null,
        page: (e.page === '' || e.page === undefined) ? null : e.page,
        confidence: e.confidence === undefined ? null : e.confidence,
      });
    });
    return out;
  }

  /**
   * ★★★ **자료를 정말 읽었는가** 〈2026-08-23 사장님: 「데이터를 정말 스캔했는지
   *   모르겠다 알수 있는 방법이 좋을듯」〉.
   *
   *   지금까지 이 화면은 **빈 입력칸 목록**으로 시작했다. 자료를 읽어 값이
   *   들어와 있어도 화면은 똑같이 생겼다 — 사람이 「읽긴 읽었나」를 가릴 방법이
   *   없었다. 「스캔했습니다」라는 **말**만으로는 확인이 아니다.
   *
   *   ★ 그래서 **값 자체에서 증거를 만든다.** 별도 기록을 믿지 않는다 —
   *     기록은 값과 갈릴 수 있지만, 값에 붙은 출처는 그 값의 출처다.
   *
   *   @param {object} values  key → {value, source, page, ...}
   *   @param {string[]} [files] 올린 자료 이름 (읽혔는데 값이 안 나온 것을 가른다)
   *   @returns {{total:number, bySource:Array, unusedFiles:string[], noSource:number}}
   */
  function readEvidence(values, files) {
    var bucket = {};
    var total = 0;
    var noSource = 0;
    Object.keys(values || {}).forEach(function (key) {
      var e = values[key];
      if (!e || e.value === '' || e.value === null || e.value === undefined) return;
      total++;
      var src = (e.source === undefined || e.source === null) ? '' : String(e.source).trim();
      if (!src) { noSource++; return; }
      if (!bucket[src]) bucket[src] = { source: src, count: 0, keys: [], pages: [] };
      bucket[src].count++;
      bucket[src].keys.push(key);
      var pg = e.page;
      if (pg !== '' && pg !== null && pg !== undefined
        && bucket[src].pages.indexOf(String(pg)) === -1) bucket[src].pages.push(String(pg));
    });
    var bySource = Object.keys(bucket).map(function (k) { return bucket[k]; })
      .sort(function (a, b) { return b.count - a.count || (a.source < b.source ? -1 : 1); });

    /* ★ 올렸는데 **값이 하나도 안 나온 자료**를 따로 센다. 이것이 없으면
     *   「10개 올렸는데 값 3개」일 때 어느 7개가 헛돌았는지 알 수 없다 */
    var used = {};
    bySource.forEach(function (b) { used[b.source] = true; });
    var unusedFiles = (files || []).filter(function (f) { return f && !used[f]; });

    /**
     * ★★★ **「자료에서 읽었다」와 「우리가 만들었다」를 가른다**
     *   〈2026-08-25 사장님: 「스캔, 읽는 흉내만 내지 실제 판독을 하지않음 거짓」〉.
     *
     *   앞 판은 값이 있으면 전부 「자료에서 읽었습니다」로 셌다. 그런데 사장님
     *   화면의 셋은 **전부 `user_request`** 였다 — 요청문에 쓰신 말이지
     *   문서에서 읽은 것이 아니다. 자료를 한 글자도 못 읽은 상태에서
     *   **「자료에서 3개를 읽었습니다」**라고 적고 있었다.
     *
     * ★ 이 저장소의 존재 이유가 그 구분이다 — **사용자가 말했다는 것은 문서로
     *   확인됐다는 뜻이 아니다** (`intake.html` 머리 주석). 화면이 그걸 뭉갰다.
     *
     * ★ 그래서 둘로 센다.
     *   - **수집자료** — 올린 문서에서 읽은 값 (`origin === 'document'`)
     *   - **자체분석자료** — 요청문·공공데이터·계산으로 만든 값 (나머지)
     * ★ `origin` 을 안 주는 옛 서버가 있을 수 있다. 그때는 **모른다고 둔다** —
     *   모르는 것을 「자료에서 읽었다」로 세는 것이 지금 잡은 그 잘못이다.
     */
    var collected = 0;
    var analyzed = 0;
    var unknownOrigin = 0;
    Object.keys(values || {}).forEach(function (key) {
      var e = values[key];
      if (!e || e.value === '' || e.value === null || e.value === undefined) return;
      var o = e.origin;
      if (o === 'document') collected++;
      else if (o) analyzed++;
      else unknownOrigin++;
    });

    return {
      total: total, bySource: bySource, unusedFiles: unusedFiles, noSource: noSource,
      collected: collected, analyzed: analyzed, unknownOrigin: unknownOrigin,
    };
  }

  /**
   * 이 값이 **어디서 왔는가** — 화면이 줄마다 한 마디로 적는다.
   *
   * ★ 「자동」과 「자료에서 읽음」을 갈라야 한다. 둘 다 사람이 안 친 값이지만
   *   **자동은 규칙이고 읽은 값은 증거다.** 뭉뚱그리면 규칙으로 채운 값을
   *   자료에 있는 값으로 오해한다.
   */
  /**
   * 줄머리에 붙는 한 마디. **채움 경로 이름(`fieldplan.LABEL`)과는 다른 것**이다 —
   * 저쪽은 「무엇으로 채울 작정인가」이고 이쪽은 「지금 이 값이 어디서 왔나」다.
   * 낱말이 겹쳐도 뜻이 다르므로 한 곳에서만 적는다.
   */
  var ORIGIN_LABEL = {
    read: '자료', auto: '자동', typed: '직접 입력',
    empty: '자료에 없음', computed: '계산',
  };

  function originOf(key, entry, plan, computedKeys) {
    if (isComputed(key, computedKeys)) return { kind: 'computed', label: ORIGIN_LABEL.computed };
    var e = entry || {};
    var has = e.value !== '' && e.value !== null && e.value !== undefined;
    if (!has) return { kind: 'empty', label: '없음' };
    var src = (e.source === undefined || e.source === null) ? '' : String(e.source).trim();
    if (src) return { kind: 'read', label: src, page: (e.page === '' || e.page === undefined) ? null : e.page };
    if (isAuto(key, plan)) return { kind: 'auto', label: (plan[key] && plan[key].label) || '자동' };
    return { kind: 'typed', label: '직접 입력' };
  }

  /**
   * 읽은 값 / 안 나온 값으로 가른다. **안 나온 것을 감추지 않는다** —
   * 감추면 「다 찼다」로 보이고, 빈 채로 보고서가 나간다.
   */
  function splitByOrigin(keys, values, plan, computedKeys) {
    var read = [], auto = [], typed = [], empty = [];
    (keys || []).forEach(function (key) {
      var o = originOf(key, (values || {})[key], plan, computedKeys);
      if (o.kind === 'read') read.push(key);
      else if (o.kind === 'auto') auto.push(key);
      else if (o.kind === 'typed') typed.push(key);
      else if (o.kind === 'empty') empty.push(key);
    });
    return { read: read, auto: auto, typed: typed, empty: empty };
  }

  return {
    BUILD: LP_BUILD,
    CATEGORY_ORDER: CATEGORY_ORDER,
    readEvidence: readEvidence,
    ORIGIN_LABEL: ORIGIN_LABEL,
    originOf: originOf,
    splitByOrigin: splitByOrigin,
    DOC_REQUIRES: DOC_REQUIRES,
    TO_EOKWON: TO_EOKWON,
    groupByCategory: groupByCategory,
    requiredKeys: requiredKeys,
    completeness: completeness,
    parseNumber: parseNumber,
    toEokwon: toEokwon,
    LEVELS: LEVELS,
    AUTO_FILLS: AUTO_FILLS,
    isAuto: isAuto,
    asksSource: asksSource,
    autoBreakdown: autoBreakdown,
    inScope: inScope,
    isComputed: isComputed,
    hasProblem: hasProblem,
    isVisible: isVisible,
    validateEntry: validateEntry,
    validateAll: validateAll,
    changedEntries: changedEntries,
  };
}));
