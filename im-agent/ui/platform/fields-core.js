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

  /** 이 보고서 종류에 필수인 key 목록 */
  function requiredKeys(fields, docType) {
    var want = DOC_REQUIRES[docType] || [];
    return Object.keys(fields || {}).filter(function (key) {
      var r = (fields[key] && fields[key].requiredFor) || [];
      return r.some(function (x) { return want.indexOf(x) !== -1; });
    });
  }

  /**
   * 채움 정도. **값만 있고 출처가 없으면 채운 것으로 세지 않는다** —
   * 저장 자체가 안 되는 값을 진행률에 넣으면 다 됐다고 착각한다.
   */
  function completeness(fields, values, docType) {
    var keys = requiredKeys(fields, docType);
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

  return {
    CATEGORY_ORDER: CATEGORY_ORDER,
    DOC_REQUIRES: DOC_REQUIRES,
    TO_EOKWON: TO_EOKWON,
    groupByCategory: groupByCategory,
    requiredKeys: requiredKeys,
    completeness: completeness,
    parseNumber: parseNumber,
    toEokwon: toEokwon,
    isComputed: isComputed,
    hasProblem: hasProblem,
    isVisible: isVisible,
    validateEntry: validateEntry,
    validateAll: validateAll,
    changedEntries: changedEntries,
  };
}));
