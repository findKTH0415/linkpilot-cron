'use strict';
/**
 * evidence-report.test.js — **근거가 얇은 문서를 조용히 승인하지 않는다**
 * 〈2026-08-27 사장님 확정 · D-152〉.
 *
 * ★★ 확정된 것은 「막지 않는다」다 — 막는 검사는 사람이 꺼 버린다(D-127).
 *   대신 **승인하는 사람이 보는 자리**(최종검증 보고서)에 적는다.
 * ★ 못 쟀으면 **못 쟀다고 적는다.** 빈 자리는 「쟀는데 좋았다」와 구분이 안 된다.
 */
const test = require('node:test');
const assert = require('node:assert');
const reports = require('../core/reports');
const E = require('../ui/platform/evidence-core.js');

const FINAL = {
  score: { total: 82, weights: {}, dataAccuracy: 9, sourceVerification: 9, financialAccuracy: 9,
    crossValidation: 9, legal: 9, marketEvidence: 9, documentQuality: 9, visualQuality: 9, traceability: 9 },
  status: 'CONDITIONAL', summary: { critical: 0, major: 1, minor: 2, gatesPassed: 5, gatesTotal: 7 },
  gates: [], issues: [],
};

test('★★★ 최종검증 보고서에 **근거 구성**이 들어간다 — 승인 앞에서 한 번 보인다', () => {
  const ev = E.measure({
    keys: ['a', 'b', 'c', 'd'],
    fields: { a: { label: '가', category: 'Land' }, b: { label: '나', category: 'Land' },
      c: { label: '다', category: 'Debt' }, d: { label: '라', category: 'Debt' } },
    facts: { a: { origin: 'document', source: 'x.pdf', sourceDate: '2026-01' } },
  });
  ev.flags = E.verdict(ev);
  const md = reports.validationReport('LP-TEST', FINAL, null, ev);
  assert.match(md, /## 근거 구성 — 무엇이 이 문서를 채웠나/, '근거 절이 없다');
  assert.match(md, /올린 자료 \+ 공공 API \| \*\*25%\*\*/, '기여도를 안 적었다');
  assert.match(md, /EVIDENCE_THIN|절반 미만/, '근거가 얇다는 사실을 안 적었다');
  assert.match(md, /생성을 막지 않는다/, '막지 않는다는 것을 안 밝혔다 — 읽는 사람이 막힌 줄 안다');
});

test('★★★ **못 쟀으면 못 쟀다고 적는다** — 빈 자리는 「좋았다」로 읽힌다', () => {
  const md = reports.validationReport('LP-TEST', FINAL, null, null);
  assert.match(md, /## 근거 구성 — 무엇이 이 문서를 채웠나/, '절 자체가 사라졌다');
  assert.match(md, /좋다는 뜻이 아니라 못 쟀다는 뜻이다/, '빈 자리를 그냥 두었다');
});
