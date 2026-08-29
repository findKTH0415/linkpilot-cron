'use strict';
/**
 * evidence.js — **무엇이 이 보고서를 채웠는가**를 센다 〈2026-08-27 · D-152〉.
 *
 * 사장님 지시: 「미리 지정된 필드값을 [자동+직접입력] 하기보다는, 업로드한 자료와
 * API 자동추출·서치로 확보된 자료를 근거로, 값들의 **100% 를 놓고 정보기여도와
 * 품질을 측정**하고 그 근원으로 보고서 생성을 완성해줘」.
 *
 * ★★★ 왜 필요한가. 지금까지 이 시스템은 **채워진 것만** 셌다(`facts.tally()`).
 *   그러면 열 칸 중 셋만 채워도 「문서 100%」가 나온다 — 비어 있는 일곱은
 *   세는 대상이 아니었기 때문이다. **분모가 틀리면 좋은 숫자가 거짓말이 된다.**
 *   그래서 여기서는 분모를 **이 보고서가 필요로 하는 항목 전부**로 둔다.
 *
 * ★★ **기여도와 품질을 한 숫자로 섞지 않는다.** 섞으면 「반쯤 채웠는데 아주
 *   좋다」와 「다 채웠는데 근거가 약하다」가 같은 점수가 된다 — 그 둘은 할 일이
 *   정반대다. 그래서 늘 **둘을 나란히** 낸다 (§8 「못 잰 것을 통과로 그리지 않는다」).
 *
 * ★ **품질 점수는 채워진 것에 대해서만 낸다.** 빈 칸을 0 점으로 섞으면 채움률과
 *   품질이 한 숫자에 뭉개진다. 빈 칸은 기여도 쪽에서 `missing` 으로 드러난다.
 *
 * 의존성 없음 (Node·브라우저 양쪽에서 돈다). 화면과 엔진이 **같은 셈**을 써야
 * 하므로 여기 한 곳에서만 정한다 — 두 벌이 되면 화면과 문서가 다른 수를 말한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotEvidence = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * ★ **이 스크립트가 어느 판인가** 〈D-93〉. `build-stamp.js` 가 채운다 —
   *   손으로 고치지 않는다. 화면이 자기 지문과 대 보고 다르면 「함수가 없다」로
   *   죽기 전에 사람 말로 알린다.
   */
  var LP_BUILD = '8ce0f736';

  /**
   * 값이 어디서 왔는가 — **갈래는 여섯이고 한 항목은 하나에만 속한다.**
   *
   * ★ `facts.js` 의 `ORIGIN` 은 넷이다(document·public·request·derived).
   *   여기서 둘을 더 가른다:
   *     - `derived` 를 **계산**과 **통상치(가정)** 로 나눈다. 앞엣것은 출처 있는
   *       값끼리의 계산이고 뒤엣것은 **가정계수**다 — §4.8 이 갈라 두라고 한
   *       바로 그 경계다. 한 칸에 두면 「계산이니 괜찮다」로 읽힌다.
   *     - **미확보**를 갈래로 세운다. 이것이 이 모듈을 만든 이유다.
   */
  var CLASSES = [
    { id: 'document', label: '올린 자료', why: '문서에서 읽은 값 — 이 시스템의 1순위' },
    { id: 'public', label: '공공 API', why: '공부·기관 통계에서 받은 값 (독립된 두 번째 출처)' },
    { id: 'request', label: '요청문', why: '사람이 접수 화면에 적은 한 줄에서 뽑은 값' },
    { id: 'derived', label: '계산', why: '출처 있는 값끼리의 계산' },
    { id: 'assumed', label: '가정·통상치', why: '가정계수가 들어간 값 — 사람이 정해야 한다 (§4.8)' },
    { id: 'manual', label: '사람이 넣음', why: '자료에 없어 사람이 직접 넣은 값' },
    { id: 'missing', label: '미확보', why: '아직 아무것도 이 값을 채우지 못했다' },
  ];

  /**
   * **값의 등급 — 어디서 온 값인가** 〈원래 `core/facts.js` 에 있던 것을 옮겼다〉.
   *
   * ★★ 왜 옮겼나. 화면도 이 판정이 필요한데, `facts.js` 는 엔진 전용이라
   *   브라우저가 못 읽는다. 두 벌로 적으면 **화면과 문서가 같은 값을 서로 다른
   *   갈래로 세는 날**이 온다 — 이 측정이 통째로 뜻을 잃는다.
   *   `facts.js` 가 여기서 받아 쓴다 (`ORIGIN` · `inferOrigin` 이름 그대로).
   */
  var ORIGIN = {
    document: 3,   // 올린 자료에서 읽은 값 — 이 시스템의 1순위
    public: 2,     // 공공데이터·기관 고시 (독립된 두 번째 출처)
    request: 1,    // 사람이 접수 화면에 적은 것
    derived: 0,    // 계산·가정·통상치 — 자료가 없을 때만 자리를 메운다
  };

  /** 확장자가 붙은 이름은 파일이다 — 그것이 「올린 자료」의 표시다 */
  var LOOKS_LIKE_FILE = /\.[A-Za-z0-9]{1,5}$/;
  /** 에이전트가 만든 값은 이름에 자기 번호를 적는다 (`… (04_financial)`) */
  var LOOKS_LIKE_AGENT = /\(\d{2}_[a-z]+\)/;

  function inferOrigin(source) {
    var s = String(source || '');
    if (!s) return 'derived';
    if (s === 'user_request') return 'request';
    if (LOOKS_LIKE_AGENT.test(s)) return 'derived';
    if (LOOKS_LIKE_FILE.test(s)) return 'document';
    return 'public';
  }

  /** 품질 등급 — **셈이 보이게** 점수를 박아 둔다 (감으로 매기지 않는다) */
  var GRADES = [
    { id: 'verified', score: 100, label: '검증됨', why: '독립된 두 출처가 같은 값을 말한다' },
    { id: 'dated', score: 85, label: '출처+기준시점', why: '출처와 기준시점이 둘 다 있다 (§4.7)' },
    { id: 'sourced', score: 65, label: '출처만', why: '출처는 있는데 기준시점이 없다 — 언제 값인지 모른다' },
    { id: 'assumed', score: 40, label: '가정', why: '가정계수가 들어갔다 — 사람이 확인해야 한다' },
    { id: 'conflict', score: 0, label: '충돌', why: '같은 항목에 다른 값이 둘 이상 있다 (RED)' },
  ];

  function gradeDef(id) {
    for (var i = 0; i < GRADES.length; i++) if (GRADES[i].id === id) return GRADES[i];
    return null;
  }

  /**
   * **자동으로 채워질 수 없는 갈래는 그렇다고 적는다** 〈2026-08-27 사장님 확정 · D-152〉.
   *
   * ★ `Crosscheck` 12개는 **값이 아니라 「무엇과 대조할지 고르는 것」**이다
   *   (사전의 `CATEGORY.CROSSCHECK` · D-48 · §4.9). 자동으로 고르면 틀린 대상의
   *   값이 그럴듯하게 나오고 문서에는 「대조함」만 남는다 — 그래서 사람이 고른다.
   * ★ 분모에는 **넣는다** (사장님이 세신 100% 에 들어 있다). 대신 **왜 늘 0%인지**를
   *   갈래 옆에 적는다 — 안 적으면 「12칸이 비었다」로만 읽히고 사람이 채우려 든다.
   */
  var CATEGORY_NOTE = {
    Crosscheck: '값이 아니라 「무엇과 대조할지」를 고르는 칸입니다 — 자동으로 못 고릅니다 (사람이 고릅니다)',
  };

  function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }

  /**
   * 한 항목이 어느 갈래인가.
   *
   * ★ **`fact.origin` 을 먼저 믿는다.** 만드는 쪽이 밝힌 것이 짐작보다 낫다.
   * ★ 다만 `derived` 는 그대로 두지 않는다 — 채움 계획(`plan`)이 「산업 통상치」
   *   라고 말하거나 값에 가정 표시가 붙어 있으면 **가정**으로 옮긴다.
   */
  function classOf(fact, planEntry) {
    if (!fact) return 'missing';
    /* ★ 값이 비어 있으면 **채운 것이 아니다.** 화면이 넘기는 줄에는 빈 칸도
     *   섞여 오므로 여기서 가른다 — 안 가르면 빈 칸이 「계산」으로 세어진다 */
    if (fact.value === '' || fact.value === null || fact.value === undefined) {
      if (!fact.origin && !fact.source) return 'missing';
    }
    /* ★ 밝힌 것이 있으면 그대로 믿고, 없으면 **출처로 짐작한다.** 화면이 서버에서
     *   받는 값에는 `origin` 이 없다 — 짐작 규칙은 `inferOrigin` 한 곳뿐이다 */
    var o = fact.origin || inferOrigin(fact.source);
    if (o === 'document') return 'document';
    if (o === 'public') return 'public';
    if (o === 'request') return 'request';
    var fill = planEntry && planEntry.fill;
    if (fill === 'default') return 'assumed';
    if (fact.assumption || fact.assumed) return 'assumed';
    if (fill === 'manual' || o === 'manual') return 'manual';
    return 'derived';
  }

  /** 이 값의 품질 등급 — 위에서부터 걸리는 첫째를 쓴다 */
  function gradeOf(fact, cls, hasConflict) {
    if (!fact) return null;
    if (hasConflict) return 'conflict';
    if (cls === 'assumed') return 'assumed';
    if (fact.verified) return 'verified';
    if (fact.source && fact.sourceDate) return 'dated';
    if (fact.source) return 'sourced';
    /* 출처가 없는 값은 애초에 들어올 수 없다(facts.js). 그래도 들어왔다면
       **모르는 것**이지 좋은 것이 아니다 — 가장 낮게 본다 */
    return 'assumed';
  }

  function emptyTally() {
    var t = {};
    CLASSES.forEach(function (c) { t[c.id] = 0; });
    return t;
  }

  /**
   * 잰다.
   *
   * @param {object} o
   *   keys        {string[]} **분모**. 이 보고서가 필요로 하는 항목 전부 (100%)
   *   facts       {object}   key → fact (dataset.toJSON().facts 또는 같은 꼴)
   *   fields      {object}   key → 사전 정의 (label·category). 갈래별로 묶을 때 쓴다
   *   plan        {object}   key → 채움 계획 (fieldplan). 없으면 갈래만으로 가른다
   *   conflicts   {Array}    dataset.conflicts — 충돌난 key 를 0 점으로 본다
   *   computedKeys{string[]} 계산으로 만들어지는 항목. **분모에 넣지 않는다**
   *                          (입력이 아니라 결과다) — 따로 세어 함께 낸다
   */
  function measure(o) {
    var opt = o || {};
    var keys = (opt.keys || []).slice();
    var facts = opt.facts || {};
    var fields = opt.fields || {};
    var plan = opt.plan || {};
    var computed = opt.computedKeys || [];

    var conflicted = {};
    (opt.conflicts || []).forEach(function (c) { if (c && c.key) conflicted[c.key] = true; });

    var byKey = {};
    var tally = emptyTally();
    var grades = {};
    GRADES.forEach(function (g) { grades[g.id] = 0; });

    var bySourceMap = {};
    var scoreSum = 0, scoreN = 0;

    keys.forEach(function (k) {
      var f = facts[k] || null;
      var cls = classOf(f, plan[k]);
      var g = gradeOf(f, cls, !!conflicted[k]);
      tally[cls] = (tally[cls] || 0) + 1;

      var row = {
        key: k,
        label: (fields[k] && fields[k].label) || k,
        category: (fields[k] && fields[k].category) || '기타',
        cls: cls,
        grade: g,
        source: f ? (f.source || null) : null,
        sourceDate: f ? (f.sourceDate || null) : null,
        conflict: !!conflicted[k],
        /* ★ 비어 있으면 **무엇을 올리면 채워지는지** 적는다. 「없음」만 적으면
           사람은 무엇을 해야 할지 모르고, 그때 값을 지어내서 넣는다 */
        howToFill: cls === 'missing' ? ((plan[k] && plan[k].why) || null) : null,
      };
      if (g) {
        var gd = gradeDef(g);
        row.score = gd ? gd.score : 0;
        grades[g] += 1;
        scoreSum += row.score; scoreN += 1;
      }
      byKey[k] = row;

      if (f && f.source && (cls === 'document' || cls === 'public')) {
        var s = String(f.source);
        if (!bySourceMap[s]) bySourceMap[s] = { source: s, cls: cls, n: 0 };
        bySourceMap[s].n += 1;
      }
    });

    var total = keys.length;

    var contribution = CLASSES.map(function (c) {
      return { id: c.id, label: c.label, why: c.why, n: tally[c.id] || 0, pct: pct(tally[c.id] || 0, total) };
    });

    var filled = total - (tally.missing || 0);

    /* ★★ **품질은 채워진 것에 대해서만** 낸다. 빈 칸을 0 점으로 섞으면
       채움률과 품질이 한 숫자에 뭉개진다 — 그 둘은 할 일이 정반대다 */
    var quality = {
      filled: filled,
      score: scoreN ? Math.round((scoreSum / scoreN) * 10) / 10 : null,
      grades: GRADES.map(function (g) {
        return { id: g.id, label: g.label, why: g.why, score: g.score, n: grades[g.id] || 0 };
      }),
    };
    quality.band = band(quality.score);

    /* 갈래별(사전의 category) 로 묶는다 — 화면이 「Land 12개 중 …」로 보여준다 */
    var catMap = {};
    keys.forEach(function (k) {
      var r = byKey[k];
      if (!catMap[r.category]) catMap[r.category] = { name: r.category, total: 0, tally: emptyTally(), scoreSum: 0, scoreN: 0 };
      var c = catMap[r.category];
      c.total += 1;
      c.tally[r.cls] += 1;
      if (r.score !== undefined) { c.scoreSum += r.score; c.scoreN += 1; }
    });
    var byCategory = Object.keys(catMap).map(function (name) {
      var c = catMap[name];
      return {
        name: name, total: c.total, note: CATEGORY_NOTE[name] || null,
        filled: c.total - c.tally.missing,
        fromEvidence: c.tally.document + c.tally.public,
        pct: pct(c.tally.document + c.tally.public, c.total),
        score: c.scoreN ? Math.round((c.scoreSum / c.scoreN) * 10) / 10 : null,
        tally: c.tally,
      };
    });

    /* 자료 한 건 한 건이 **몇 칸을 채웠는가** — 「어느 자료가 값을 냈는가」다 */
    var bySource = Object.keys(bySourceMap).map(function (s) {
      var r = bySourceMap[s];
      return { source: r.source, cls: r.cls, n: r.n, pct: pct(r.n, total) };
    }).sort(function (a, b) { return b.n - a.n; });

    /* 계산 항목은 **분모에 안 넣는다.** 입력이 아니라 결과이기 때문이다.
       대신 몇 개가 실제로 나왔는지 따로 센다 — 안 세면 「계산 19개」가
       화면에만 있고 나온 적이 없어도 아무도 모른다 */
    var computedReady = computed.filter(function (k) { return !!facts[k]; }).length;

    var evidencePct = pct((tally.document || 0) + (tally.public || 0), total);

    return {
      total: total,
      contribution: contribution,
      /** 「올린 자료 + 공공 API」가 100% 중 몇 %인가 — 사장님이 물으신 그 수 */
      evidencePct: evidencePct,
      quality: quality,
      byCategory: byCategory,
      bySource: bySource,
      byKey: byKey,
      computed: { total: computed.length, ready: computedReady },
      classes: CLASSES,
    };
  }

  /**
   * 점수를 말로 옮긴다. **문턱을 여기 적어 두는 이유**는, 적어 두지 않으면
   * 읽는 사람이 「보통」이 몇 점인지 몰라 숫자를 못 믿기 때문이다.
   */
  function band(score) {
    if (score === null || score === undefined) return { id: 'none', label: '잰 것이 없다', why: '채워진 값이 하나도 없다' };
    if (score >= 85) return { id: 'high', label: '높음', why: '85점 이상 — 대부분 검증됐거나 기준시점이 있다' };
    if (score >= 65) return { id: 'mid', label: '보통', why: '65점 이상 — 출처는 있는데 기준시점이 빠진 값이 섞여 있다' };
    return { id: 'low', label: '낮음', why: '65점 미만 — 가정·충돌이 많다. 그대로 내보내면 안 된다' };
  }

  /**
   * 이 근거로 **보고서를 내도 되는가**.
   *
   * ★★ 막지 않는다. **말한다.** 막으면 사람은 검사를 끄고, 그러면 없느니만
   *   못하다 (D-127 과 같은 결). 대신 무엇이 모자란지 이름을 대고 적는다.
   */
  function verdict(m) {
    var out = [];
    if (!m || !m.total) return out;
    if (m.evidencePct < 50) {
      out.push({
        level: 'RED',
        code: 'EVIDENCE_THIN',
        message: '자료·공공API 로 채운 것이 ' + m.evidencePct + '% 다 (절반 미만). '
          + '나머지는 계산·가정·미확보다 — 이 상태의 문서는 근거보다 가정이 많다.',
      });
    } else if (m.evidencePct < 70) {
      out.push({
        level: 'YELLOW',
        code: 'EVIDENCE_PARTIAL',
        message: '자료·공공API 로 채운 것이 ' + m.evidencePct + '% 다. '
          + '나머지 절을 읽을 때 가정이 섞였다는 것을 감안해야 한다.',
      });
    }
    var conflict = (m.quality.grades.filter(function (g) { return g.id === 'conflict'; })[0] || {}).n || 0;
    if (conflict > 0) {
      out.push({
        level: 'RED', code: 'EVIDENCE_CONFLICT',
        message: '값이 갈리는 항목이 ' + conflict + '건 있다. 어느 쪽이 맞는지 정하기 전에는 내보내지 않는다.',
      });
    }
    var missing = (m.contribution.filter(function (c) { return c.id === 'missing'; })[0] || {});
    if (missing.n) {
      out.push({
        level: 'YELLOW', code: 'EVIDENCE_MISSING',
        message: '아직 아무것도 채우지 못한 항목이 ' + missing.n + '건 (' + missing.pct + '%) 있다.',
      });
    }
    return out;
  }

  /** 사람이 읽는 한 줄 — 화면과 문서가 **같은 문장**을 쓰게 한다 */
  function headline(m) {
    if (!m || !m.total) return '잴 항목이 없습니다.';
    return '항목 ' + m.total + '개 중 ' + m.evidencePct + '% 를 올린 자료와 공공 API 가 채웠습니다'
      + ' · 채워진 값의 품질 ' + (m.quality.score === null ? '잰 것 없음' : m.quality.score + '점 (' + m.quality.band.label + ')');
  }

  /**
   * **분모를 만든다 — 이 딜에서 실제로 화면에 서는 항목 전부.**
   *
   * ★★★ 왜 `requiredFor` 를 안 쓰나 〈2026-08-27 · 실측〉. 사장님이 세어 주신 목록은
   *   Project 4 · Land 12 · Building 11 · Capacity 11 … Crosscheck 12 = **94개**다.
   *   그런데 `requiredFor('im')` 은 **10개**다 — 그것으로 100% 를 잡으면 화면이
   *   말하는 100% 와 문서가 말하는 100% 가 서로 다른 수가 된다.
   *
   * ★ 화면(`fields-core.inScope`)이 쓰는 규칙과 **같은 규칙**을 쓴다:
   *   사전의 모든 항목에서 **다른 산업 전용 항목(foreign)만** 뺀다.
   *   실측으로 datacenter = 94개 · solar = 95 · generic = 93 이 나온다.
   *
   * ★ Crosscheck 12개도 분모에 **넣는다.** 사장님이 세신 100% 에 들어 있고,
   *   자동으로 못 고르는 항목이라는 사실은 갈래별 표에서 그대로 드러난다 (§4.9).
   */
  function targetKeys(fields, foreign) {
    var skip = {};
    (foreign || []).forEach(function (k) { skip[k] = true; });
    return Object.keys(fields || {}).filter(function (k) { return !skip[k]; });
  }

  return {
    BUILD: LP_BUILD,
    CLASSES: CLASSES, GRADES: GRADES, targetKeys: targetKeys,
    ORIGIN: ORIGIN, inferOrigin: inferOrigin,
    measure: measure, verdict: verdict, headline: headline, band: band,
    classOf: classOf, gradeOf: gradeOf,
  };
}));
