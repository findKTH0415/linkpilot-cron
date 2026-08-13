'use strict';
/**
 * schema.js — 의존성 없는 최소 JSON Schema 검증기.
 *
 * 모든 Agent는 Input Schema / Output Schema를 선언하고, runtime이 이 검증기로
 * 입출력을 강제한다. Agent 간 계약이 코드로 고정되어야 체인이 조용히 어긋나지 않는다.
 *
 * 지원: type, required, properties, items, enum, minimum, maximum,
 *       minLength, maxLength, pattern, nullable
 */

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(actual, expected) {
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

function validate(value, schema, path = '$', errors = []) {
  if (!schema || typeof schema !== 'object') return errors;

  if (value === null && schema.nullable) return errors;

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!expected.some(t => typeMatches(actual, t))) {
      errors.push(`${path}: 타입 ${expected.join('|')} 필요, 실제 ${actual}`);
      return errors; // 타입이 틀리면 하위 검증은 무의미
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: 허용값 [${schema.enum.join(', ')}] 아님 (${JSON.stringify(value)})`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} < 최소 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} > 최대 ${schema.maximum}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: 길이 ${value.length} < ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: 길이 ${value.length} > ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: 패턴 ${schema.pattern} 불일치`);
  }

  if (typeOf(value) === 'object' && schema.properties) {
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${path}.${key}: 필수 항목 누락`);
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (value[key] !== undefined) validate(value[key], sub, `${path}.${key}`, errors);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: 항목수 ${value.length} < ${schema.minItems}`);
    if (schema.items) value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`, errors));
  }

  return errors;
}

function assertValid(value, schema, label) {
  const errors = validate(value, schema);
  if (errors.length) {
    const err = new Error(`${label} 스키마 위반 (${errors.length}건): ${errors.slice(0, 5).join(' / ')}`);
    err.code = 'SCHEMA_VIOLATION';
    err.errors = errors;
    throw err;
  }
  return value;
}

module.exports = { validate, assertValid };
