'use strict';
/* kst.test.js — 날짜 처리가 **로케일 데이터에 기대지 않는가**
   [사고 2026-08-16] NAS Node 20 에 sv-SE 로케일이 없어 en-US 로 폴백 → kstYear() NaN →
   프로젝트 ID LP-SOL-NaN-001 → 스키마 위반으로 생성 불가. 개발기·CI 에서는 재현되지 않았다. */
const test = require('node:test');
const assert = require('node:assert/strict');
const k = require('../core/kst');

test('kstStamp/kstDate/kstYear 는 항상 ISO 모양·숫자 연도를 낸다', () => {
  const d = new Date('2026-08-16T07:04:46Z'); // KST 16:04:46
  assert.equal(k.kstDate(d), '2026-08-16');
  assert.equal(k.kstYear(d), 2026);
  assert.equal(k.kstStamp(d), '2026-08-16T16:04:46+09:00');
  assert.equal(k.kstSlug(d), '20260816-160446');
});

test('UTC 연말은 KST 로 다음 해가 된다', () => {
  assert.equal(k.kstYear(new Date('2025-12-31T15:30:00Z')), 2026);
});

test('sv-SE 로케일이 없는 환경(en-US 폴백)을 흉내내도 결과가 같다', () => {
  // Intl 이 en-US 형식만 낼 수 있는 상황: 원본 생성자를 감싸 로케일 인자를 en-US 로 강제한다
  const Orig = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (loc, opt) { return new Orig('en-US', opt); };
  Intl.DateTimeFormat.prototype = Orig.prototype;
  try {
    delete require.cache[require.resolve('../core/kst')];
    const k2 = require('../core/kst');
    assert.equal(k2.kstYear(new Date('2026-08-16T07:04:46Z')), 2026);
    assert.equal(k2.kstDate(new Date('2026-08-16T07:04:46Z')), '2026-08-16');
  } finally {
    Intl.DateTimeFormat = Orig;
    delete require.cache[require.resolve('../core/kst')];
  }
});
