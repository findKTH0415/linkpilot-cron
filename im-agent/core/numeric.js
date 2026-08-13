'use strict';
/**
 * numeric.js — 한국어 문서의 수치 표기를 정규화 단위로 변환한다.
 *
 * 금액은 모두 '억원' 기준으로 환산한다 (Data Dictionary 규약).
 *   1조 2,000억원 → 12000
 *   2,846억원     → 2846
 *   284,600백만원 → 2846
 *   54,822㎡      → 54822
 */

const MONEY_UNITS = [
  { re: /조\s*원?/, mult: 10000 },
  { re: /억\s*원?/, mult: 1 },
  { re: /백만\s*원/, mult: 0.01 },
  { re: /천만\s*원/, mult: 0.1 },
  { re: /만\s*원/, mult: 0.0001 },
  { re: /원/, mult: 0.00000001 },
];

/** '54,822' / '2,846.5' / '1.5' → number */
function parseNumber(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/[^\d.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * '1조 2,000억원' 같은 복합 표기 포함 금액 → 억원 단위 숫자
 * @returns {number|null}
 */
function parseMoneyToEok(raw) {
  if (typeof raw === 'number') return raw;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // 복합 표기: 1조 2,000억
  const compound = s.match(/([\d,.]+)\s*조\s*([\d,.]+)?\s*억?/);
  if (compound) {
    const jo = parseNumber(compound[1]) || 0;
    const eok = compound[2] ? (parseNumber(compound[2]) || 0) : 0;
    return jo * 10000 + eok;
  }

  for (const u of MONEY_UNITS) {
    if (u.re.test(s)) {
      const n = parseNumber(s);
      if (n === null) return null;
      return round(n * u.mult, 4);
    }
  }
  return parseNumber(s);
}

/** 단위 문자열 감지 */
function detectUnit(text) {
  const s = String(text);
  if (/㎡|m2|m²|제곱미터|평방미터/i.test(s)) return '㎡';
  if (/\bMW\b/i.test(s)) return 'MW';
  if (/\bkW\b/i.test(s)) return 'kW';
  if (/조\s*원|억\s*원|백만\s*원|천만\s*원|만\s*원|원\b/.test(s)) return '억원';
  if (/%|퍼센트/.test(s)) return '%';
  if (/년|개년|yr|year/i.test(s)) return '년';
  if (/평\b/.test(s)) return '평';
  return null;
}

/** 문서 단위 → dictionary 정규화 단위 변환 */
function normalize(value, fromUnit, toUnit) {
  const n = typeof value === 'number' ? value : parseNumber(value);
  if (n === null) return null;
  if (!toUnit || fromUnit === toUnit) return n;

  const pair = `${fromUnit || ''}>${toUnit}`;
  const table = {
    '평>㎡': 3.305785,
    '㎡>평': 1 / 3.305785,
    'kW>MW': 0.001,
    'MW>kW': 1000,
  };
  if (table[pair]) return round(n * table[pair], 6);
  return n;
}

function round(n, digits = 2) {
  const p = Math.pow(10, digits);
  return Math.round((n + Number.EPSILON) * p) / p;
}

/** 억원 → 사람이 읽는 표기 ('2,846억원' / '1조 2,000억원') */
function formatEok(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-';
  const v = Number(n);
  if (Math.abs(v) >= 10000) {
    const jo = Math.floor(v / 10000);
    const eok = round(v - jo * 10000, 0);
    return eok ? `${jo}조 ${fmt(eok)}억원` : `${jo}조원`;
  }
  return `${fmt(round(v, 0))}억원`;
}

function fmt(n, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-';
  return Number(n).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-';
  return `${fmt(round(Number(n), digits), digits)}%`;
}

module.exports = { parseNumber, parseMoneyToEok, detectUnit, normalize, round, formatEok, fmt, pct };
