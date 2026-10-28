'use strict';
/**
 * facts.js — LinkPilot IM 플랫폼의 1순위 원칙을 강제하는 모듈.
 *
 *   "출처 없는 숫자는 시스템에 들어올 수 없다."
 *
 * 모든 값(Fact)은 Value / Unit / Source / Source Date / Page / Confidence /
 * Verified / Last Updated 를 반드시 동반한다. source가 없으면 생성 자체가 실패한다.
 *
 * 동일 key에 서로 다른 값이 들어오면 폐기하지 않고 후보(candidate)로 모두 보관한 뒤
 * resolve() 시점에 충돌(RED FLAG)로 드러낸다. (예: 연면적 54,822 vs 52,822)
 */

const { kstStamp } = require('./kst');

const DEFAULT_TOLERANCE = 0.001; // 상대오차 0.1% 이내면 같은 값으로 본다(반올림 표기 차이 흡수)

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

/**
 * ★★★ **올린 자료가 1순위다** 〈2026-08-24 사장님 지시:
 *   「업로드한 자료를 100% 초점을 맞추고 + 추가자료로는 AI 자동으로 보완적
 *    기능으로 재구성해줘」〉.
 *
 *   앞 판은 값이 갈릴 때 **독립 출처 수**만 봤다(`sources.size * 10`). 그래서
 *   공공데이터·계산값이 여럿이면 **사장님이 올린 문서를 이겼다.** 자료를
 *   올린 사람 입장에서는 「내 자료가 안 쓰였다」가 되고, 문서만 봐서는
 *   그 사실이 안 보인다 — 출처 표시가 멀쩡하기 때문이다.
 *
 * ★ 그래서 **등급을 먼저 보고** 그다음에 출처 수를 본다.
 * ★ **낮은 등급이 이기는 일은 없다. 다만 사라지지도 않는다** — 진 값은
 *   `alternatives` 에 남고 충돌은 그대로 기록된다 (§4.9).
 * ★ 등급은 만드는 쪽이 `origin` 으로 **밝히는 것이 원칙**이다. 안 밝히면
 *   아래 규칙으로 짐작하되, **짐작했다는 것을 값에 적는다**(`originGuessed`).
 */
/* ★★★ **등급 판정은 `ui/platform/evidence-core.js` 한 곳에 있다** 〈2026-08-27 · D-152〉.
 *   화면도 같은 판정이 필요한데 이 파일은 엔진 전용이라 브라우저가 못 읽는다.
 *   두 벌로 적으면 **화면과 문서가 같은 값을 다른 갈래로 세는 날**이 온다 —
 *   그 순간 근거 측정이 통째로 뜻을 잃는다. 이름은 그대로 쓴다. */
const { ORIGIN, inferOrigin } = require('../ui/platform/evidence-core.js');

/**
 * ★★★ **출처를 세는 이름** — `source` 문자열이 아니라 이것으로 센다 (D-117).
 *
 *   〈2026-08-26 사장님 지시 「source_id 를 다음 것으로」〉
 *
 * ★★ **왜 이것이 D-117 셋 중 가장 급한가.** 나머지 둘은 「불편」이고
 *   이것은 **거짓**이다. 아래가 그 자리다 (`resolve()`):
 *
 *     const independentSources = new Set(facts.map(f => f.source));
 *     if (independentSources.size >= 2) { chosen.verified = true; … }
 *
 *   같은 곳을 **다르게 적으면 둘로 세어져 「검증됨」이 된다.** 그러면
 *   「독립된 두 출처가 같은 값을 말한다」는 이 시스템의 근거가 거짓이 된다.
 *   실제 자료에 그 꼴이 있다 — `감정평가 Agent · 수익환원법` 과
 *   `감정평가 Agent · 1방식 가중평균` 은 **우리 Agent 가 자기 자신과 일치한 것**이다.
 *
 * ★★★ **덜 세는 쪽이 안전하다.** 둘을 하나로 잘못 합치면 `verified` 를 하나
 *   놓칠 뿐이고, 문서는 **더 조심스러워진다.** 반대로 하나를 둘로 세면
 *   **없는 근거를 만든다.** 그래서 애매하면 **합치는 쪽**으로 간다.
 *
 * ★ **저장하지 않고 파생한다** (`confidence.js` 와 같은 규칙 — D-116).
 *   두 곳에 따로 적으면 반드시 어긋난다. `source` 하나만 저장하고 여기서 낸다.
 *
 * 무엇을 떼나 — 셋. 전부 **「같은 곳인가」에 영향을 안 주는 것**이다.
 *   ① 뒤에 붙는 조건 괄호       `국토계획법 시행령(용도지역: 일반공업지역)`
 *                              → 같은 법령이다. 조회 조건이 다를 뿐이다
 *   ② 가운뎃점 뒤의 방법·갈래   `감정평가 Agent · 수익환원법`
 *                              → 같은 Agent 다. 방법이 다르다고 독립 출처가 아니다
 *   ③ 대소문자·군더더기 공백
 *
 * ★ 그리고 **기관 별칭**은 표로 둔다. 「국토교통부 실거래가」와
 *   「MOLIT 실거래가」는 같은 곳이다. 표에 없는 것은 **합치지 않는다** —
 *   짐작으로 합치면 진짜 독립 출처를 잃는다.
 */
/* ★ 별칭은 **앞머리**로만 본다. `\b` 를 쓰면 안 된다 — 자바스크립트의 낱말
 *   경계는 영문·숫자 기준이라 **한글 뒤에서는 경계가 안 잡힌다.**
 *   실제로 「국토교통부 실거래가」가 안 걸려서 알았다 (2026-08-26). */
const SOURCE_ALIASES = [
  [/^(국토교통부|국토부|molit)(?:\s|$)/i, 'molit'],
  [/^(한국부동산원|부동산원|reb)(?:\s|$)/i, 'reb'],
  [/^(한국은행|한은|ecos)(?:\s|$)/i, 'ecos'],
  [/^(통계청|kosis)(?:\s|$)/i, 'kosis'],
  [/^(기상청|kma)(?:\s|$)/i, 'kma'],
  [/^(전력거래소|kpx)(?:\s|$)/i, 'kpx'],
  [/^(금융위원회|fsc)(?:\s|$)/i, 'fsc'],
  [/^(브이월드|vworld)(?:\s|$)/i, 'vworld'],
  [/^(국가공간정보|nsdi)(?:\s|$)/i, 'nsdi'],
  [/^(법제처|국가법령정보|law\.go\.kr)(?:\s|$)/i, 'law'],
  [/^(금융감독원|전자공시|dart)(?:\s|$)/i, 'dart'],
];

/**
 * 출처 문자열 → 세는 이름. 같은 곳이면 같은 값이 나온다.
 * @param {string} source
 * @returns {string}
 */
function sourceId(source) {
  let s = String(source || '').trim();
  if (!s) return '';
  // ① 뒤에 붙는 조건 괄호를 뗀다 — 조회 조건이지 다른 출처가 아니다
  s = s.replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim();
  // ② 가운뎃점 뒤의 방법·갈래를 뗀다 — 같은 곳이 방법만 달리한 것이다
  s = s.split(/\s*[·・]\s*/)[0].trim();
  // ③ 대소문자·군더더기 공백
  s = s.toLowerCase().replace(/\s+/g, ' ');
  for (const [re, id] of SOURCE_ALIASES) if (re.test(s)) return id;
  return s;
}

class Fact {
  constructor(o) {
    if (!o || !o.key) throw new Error('Fact.key 필수');
    if (o.value === undefined || o.value === null || o.value === '') {
      throw new Error(`Fact(${o.key}).value 필수 — 빈 값은 저장하지 않는다`);
    }
    if (!o.source) {
      throw new Error(`Fact(${o.key}).source 필수 — 출처 없는 값은 저장할 수 없다`);
    }
    this.key = o.key;
    this.value = o.value;
    this.unit = o.unit || null;
    this.source = o.source;              // 파일명 / API명 / 'user_request'
    this.sourceDate = o.sourceDate || null;
    this.page = o.page ?? null;          // 페이지 또는 라인 번호
    this.quote = o.quote || null;        // 원문 근거 문구 (LLM 추출 시 필수)
    this.confidence = clamp01(o.confidence ?? 0.5);
    this.verified = !!o.verified;
    this.note = o.note || null;
    /* ★ 밝힌 것이 있으면 그대로 쓰고, 없으면 짐작하되 **짐작했다고 적는다** */
    const told = o.origin && Object.prototype.hasOwnProperty.call(ORIGIN, o.origin);
    this.origin = told ? o.origin : inferOrigin(o.source);
    /* ★ 다시 만들어질 때(`new Fact(f.toJSON())`) **짐작이었다는 사실을 잃지
     *   않는다.** 잃으면 확정값이 「밝힌 값」처럼 보인다 */
    this.originGuessed = told ? !!o.originGuessed : true;
    this.lastUpdated = o.lastUpdated || kstStamp();
  }

  /** 등급. 높을수록 먼저다 */
  get tier() { return ORIGIN[this.origin] ?? 0; }

  /** 출처를 **세는 이름**. 저장하지 않고 `source` 에서 낸다 (D-117) */
  get sourceId() { return sourceId(this.source); }

  /** IM 본문에 노출할 출처 표기 */
  citation() {
    const parts = [this.source];
    if (this.page !== null && this.page !== undefined) parts.push(`p.${this.page}`);
    if (this.sourceDate) parts.push(this.sourceDate);
    return parts.join(', ');
  }

  toJSON() {
    return {
      key: this.key, value: this.value, unit: this.unit,
      source: this.source, sourceDate: this.sourceDate, page: this.page,
      quote: this.quote, confidence: this.confidence, verified: this.verified,
      origin: this.origin, originGuessed: this.originGuessed,
      note: this.note, lastUpdated: this.lastUpdated,
    };
  }
}

function sameValue(a, b, tolerance = DEFAULT_TOLERANCE) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return true;
    const scale = Math.max(Math.abs(a), Math.abs(b));
    if (scale === 0) return true;
    return Math.abs(a - b) / scale <= tolerance;
  }
  return String(a).trim() === String(b).trim();
}

class Dataset {
  /**
   * @param {string} projectId
   * @param {object} dictionary key별 tolerance 조회용 (선택)
   */
  constructor(projectId, dictionary = null) {
    this.projectId = projectId;
    this.dictionary = dictionary;
    this.candidates = new Map(); // key -> Fact[]
    this.resolved = new Map();   // key -> Fact
    this.conflicts = [];
  }

  _tolerance(key) {
    const field = this.dictionary && this.dictionary[key];
    return field && field.tolerance !== undefined ? field.tolerance : DEFAULT_TOLERANCE;
  }

  /** 후보 추가. 동일 (key, value, source)는 중복 저장하지 않는다. */
  add(factLike) {
    const fact = factLike instanceof Fact ? factLike : new Fact(factLike);
    const list = this.candidates.get(fact.key) || [];
    const dup = list.find(f => f.source === fact.source && f.page === fact.page && sameValue(f.value, fact.value, this._tolerance(fact.key)));
    if (dup) {
      // 같은 출처의 재추출 — 신뢰도만 갱신
      dup.confidence = Math.max(dup.confidence, fact.confidence);
      dup.lastUpdated = fact.lastUpdated;
      return dup;
    }
    list.push(fact);
    this.candidates.set(fact.key, list);
    return fact;
  }

  /**
   * 특정 출처의 후보를 모두 제거한다.
   * 재실행 시 같은 출처(재무모델·재추출 문서)의 옛 값이 남아 스스로와 충돌하는 것을 막는다.
   */
  dropSource(source) {
    let removed = 0;
    for (const [key, list] of this.candidates) {
      const kept = list.filter(f => f.source !== source);
      removed += list.length - kept.length;
      if (kept.length) this.candidates.set(key, kept);
      else this.candidates.delete(key);
    }
    return removed;
  }

  /**
   * 조건에 맞는 후보만 제거한다.
   *
   * dropSource 는 한 출처의 값을 통째로 지운다. 사람이 화면에서 값 하나를 고칠 때는
   * 그렇게 넓게 지우면 같은 문서에서 뽑은 다른 항목까지 사라진다.
   *
   * ★ 이 메서드로 **다른 출처의 후보를 지우면 안 된다.** 출처가 다른 값이 갈리는 것은
   *   버그가 아니라 이 시스템이 잡아내야 할 신호다. 좁게 쓴다.
   *
   * @param {(fact: Fact, key: string) => boolean} predicate 참이면 제거
   */
  dropWhere(predicate) {
    let removed = 0;
    for (const [key, list] of this.candidates) {
      const kept = list.filter(f => !predicate(f, key));
      removed += list.length - kept.length;
      if (kept.length) this.candidates.set(key, kept);
      else this.candidates.delete(key);
    }
    return removed;
  }

  addMany(facts) {
    return facts.map(f => {
      try {
        return this.add(f);
      } catch (e) {
        // 출처 누락 등 규칙 위반 값은 버리되, 조용히 버리지 않는다
        this.conflicts.push({ key: (f && f.key) || '(unknown)', severity: 'RED', type: 'REJECTED', message: e.message, values: [] });
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * 후보를 확정값으로 정리하고 충돌을 기록한다.
   *  - 값이 갈리면 RED FLAG (자동 채택하되 flag를 남긴다)
   *  - 서로 다른 2개 이상 출처가 일치하면 verified = true 로 승격
   */
  resolve() {
    this.resolved = new Map();
    this.conflicts = this.conflicts.filter(c => c.type === 'REJECTED'); // 재실행 시 REJECTED만 보존

    for (const [key, list] of this.candidates) {
      const tol = this._tolerance(key);

      // 값 기준 그룹핑
      const groups = [];
      for (const f of list) {
        const g = groups.find(g => sameValue(g.value, f.value, tol));
        if (g) g.facts.push(f);
        else groups.push({ value: f.value, facts: [f] });
      }

      /* ★★★ **등급을 먼저 본다** 〈2026-08-24 사장님 지시 — 올린 자료가 1순위〉.
       *   앞 판은 독립 출처 수만 봤다. 그래서 공공데이터·계산값이 여럿이면
       *   **올린 문서를 이겼다.** 자료를 올린 사람에게는 「내 자료가 안 쓰였다」가
       *   되는데, 출처 표시가 멀쩡해서 문서만 봐서는 안 잡힌다.
       * ★ 등급이 같을 때에만 예전 규칙(출처 수 → 신뢰도)으로 가른다.
       * ★ **진 값은 사라지지 않는다** — `alternatives` 에 남고 충돌도 그대로다. */
      const tierOf = g => Math.max(...g.facts.map(f => f.tier));
      const score = g => {
        const sources = new Set(g.facts.map(f => f.sourceId));
        const maxConf = Math.max(...g.facts.map(f => f.confidence));
        const anyVerified = g.facts.some(f => f.verified);
        return sources.size * 10 + maxConf + (anyVerified ? 5 : 0);
      };
      groups.sort((a, b) => (tierOf(b) - tierOf(a)) || (score(b) - score(a)));

      const winnerGroup = groups[0];
      /* ★ 이긴 무리 안에서도 **등급이 높은 값**을 대표로 삼는다 */
      const winner = winnerGroup.facts.slice()
        .sort((a, b) => (b.tier - a.tier) || (b.confidence - a.confidence))[0];
      /* ★★★ **글자가 아니라 「세는 이름」으로 센다** (D-117).
       *   앞 판은 `f.source` 를 그대로 셌다 — 같은 곳을 다르게 적으면 둘로
       *   세어져 **없는 근거를 만들었다.** 바로 아래에서 그 수가 `verified` 를
       *   켠다. 그것이 이 저장소에서 가장 비싼 종류의 거짓말이다. */
      const independentSources = new Set(winnerGroup.facts.map(f => f.sourceId));

      const chosen = new Fact(winner.toJSON());
      if (independentSources.size >= 2) {
        chosen.verified = true;
        chosen.confidence = Math.min(0.99, chosen.confidence + 0.1);
        chosen.note = [chosen.note, `독립 출처 ${independentSources.size}건 일치`].filter(Boolean).join(' / ');
      }
      chosen.corroboration = independentSources.size;
      chosen.alternatives = groups.slice(1).map(g => ({
        value: g.value,
        sources: g.facts.map(f => f.citation()),
      }));

      if (groups.length > 1) {
        chosen.verified = false; // 충돌이 있으면 절대 verified 로 두지 않는다
        // 숫자 충돌은 치명적(RED), 문자열 표기 차이는 검토 대상(YELLOW)으로 구분한다.
        const numeric = groups.every(g => typeof g.value === 'number');
        this.conflicts.push({
          key,
          numeric,
          severity: numeric ? 'RED' : 'YELLOW',
          type: 'VALUE_CONFLICT',
          message: `동일 항목에 서로 다른 값 ${groups.length}개가 존재한다`,
          values: groups.map(g => ({
            value: g.value,
            unit: g.facts[0].unit,
            sources: g.facts.map(f => f.citation()),
            confidence: Math.max(...g.facts.map(f => f.confidence)),
          })),
        });
      }

      this.resolved.set(key, chosen);
    }
    return this;
  }

  /**
   * 확정값이 **어디서 왔는지** 센다 〈2026-08-24〉.
   *
   * ★ 「올린 자료 100%, 나머지는 보완」이 지켜지는지는 **세어 봐야** 안다.
   *   화면과 보고서가 이 셈을 그대로 적는다 — 안 적으면 통상치가 몇 개
   *   섞였는지 아무도 모른 채로 문서가 나간다.
   */
  tally() {
    const out = { document: 0, public: 0, request: 0, derived: 0, guessed: 0, total: 0 };
    this.resolved.forEach((f) => {
      out[f.origin] = (out[f.origin] || 0) + 1;
      if (f.originGuessed) out.guessed += 1;
      out.total += 1;
    });
    return out;
  }

  get(key) { return this.resolved.get(key) || null; }
  has(key) { return this.resolved.has(key); }

  /** 숫자값. 없으면 null (기본값을 몰래 채우지 않는다) */
  num(key) {
    const f = this.get(key);
    if (!f) return null;
    const n = Number(f.value);
    return Number.isFinite(n) ? n : null;
  }

  /** 검증 통과한 값만 (IM 본문 작성 시 사용) */
  verifiedOnly() {
    return new Map([...this.resolved].filter(([, f]) => f.verified));
  }

  /** 필수 key 누락 목록 */
  missing(keys) {
    return keys.filter(k => this.num(k) === null && !this.has(k));
  }

  keys() { return [...this.resolved.keys()]; }

  toJSON() {
    return {
      projectId: this.projectId,
      resolvedAt: kstStamp(),
      facts: Object.fromEntries([...this.resolved].map(([k, f]) => [k, { ...f.toJSON(), corroboration: f.corroboration, alternatives: f.alternatives }])),
      candidates: Object.fromEntries([...this.candidates].map(([k, l]) => [k, l.map(f => f.toJSON())])),
      conflicts: this.conflicts,
    };
  }

  static fromJSON(json, dictionary = null) {
    const ds = new Dataset(json.projectId, dictionary);
    for (const [key, list] of Object.entries(json.candidates || {})) {
      for (const f of list) ds.add({ ...f, key });
    }
    return ds.resolve();
  }
}

module.exports = {
  ORIGIN, inferOrigin, sourceId, SOURCE_ALIASES, Fact, Dataset, sameValue, DEFAULT_TOLERANCE };
