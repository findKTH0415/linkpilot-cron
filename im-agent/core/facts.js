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
    this.lastUpdated = o.lastUpdated || kstStamp();
  }

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

      // 그룹 점수: 독립 출처 수 우선, 그다음 최고 신뢰도
      const score = g => {
        const sources = new Set(g.facts.map(f => f.source));
        const maxConf = Math.max(...g.facts.map(f => f.confidence));
        const anyVerified = g.facts.some(f => f.verified);
        return sources.size * 10 + maxConf + (anyVerified ? 5 : 0);
      };
      groups.sort((a, b) => score(b) - score(a));

      const winnerGroup = groups[0];
      const winner = winnerGroup.facts.slice().sort((a, b) => b.confidence - a.confidence)[0];
      const independentSources = new Set(winnerGroup.facts.map(f => f.source));

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

module.exports = { Fact, Dataset, sameValue, DEFAULT_TOLERANCE };
