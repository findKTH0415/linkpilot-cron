'use strict';
/**
 * 02 Data Extraction Agent
 *
 * 원본자료(02_Source_Data) → Structured Data(Fact).
 *
 * 2단계 추출:
 *   ① 규칙 기반 (LLM 없이, 결정적) — Data Dictionary alias + 숫자/단위 파싱
 *   ② LLM 보완 (선택) — 규칙이 놓친 항목만. ★ 근거 문구(quote)가 원문에 실제로
 *      존재하지 않으면 그 값은 환각으로 간주하고 폐기한다.
 *
 * 지원 포맷: txt/md/csv/json/html (직접), docx/xlsx/pptx (내장 zlib 기반 unzip)
 * 미지원: pdf/이미지 — OCR/PDF 파서는 승인된 의존성 추가가 필요하므로
 *         파일을 조용히 건너뛰지 않고 YELLOW 경고로 남긴다.
 */

const fs = require('fs');
const path = require('path');
const { FIELDS, ALIAS_INDEX } = require('../core/dictionary');
const { parseNumber, parseMoneyToEok, normalize, round } = require('../core/numeric');
const unzip = require('../core/unzip');
const llm = require('../core/llm');

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.html', '.htm', '.xml', '.log']);
const ZIP_EXT = { '.docx': 'docxText', '.xlsx': 'xlsxText', '.xlsm': 'xlsxText', '.pptx': 'pptxText' };
const UNSUPPORTED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.tif', '.tiff', '.hwp', '.hwpx', '.doc', '.xls', '.ppt']);

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    files: { type: 'array' },
    useLlm: { type: 'boolean' },
  },
};

const outputSchema = {
  type: 'object',
  required: ['facts', 'documents'],
  properties: {
    facts: { type: 'array' },
    documents: { type: 'array' },
    unsupported: { type: 'array' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

/** 파일 → 평문 텍스트. 실패는 예외 대신 {error} 로 돌려 격리한다. */
function toText(file) {
  const ext = file.ext || path.extname(file.name).toLowerCase();
  try {
    if (TEXT_EXT.has(ext)) {
      let t = fs.readFileSync(file.path, 'utf8');
      if (ext === '.html' || ext === '.htm' || ext === '.xml') t = unzip.xmlToText(t, { paragraphTags: ['p', 'div', 'tr', 'li'] });
      return { text: t };
    }
    if (ZIP_EXT[ext]) {
      return { text: unzip[ZIP_EXT[ext]](fs.readFileSync(file.path)) };
    }
    if (UNSUPPORTED_EXT.has(ext)) {
      return { error: `${ext} 미지원 — PDF/이미지 OCR은 승인된 의존성 추가 필요` };
    }
    return { error: `알 수 없는 확장자 ${ext}` };
  } catch (e) {
    return { error: `읽기 실패: ${e.message}` };
  }
}

/**
 * 한 줄에서 dictionary 항목 값을 뽑는다.
 * @returns {Array<{key,value,unit,confidence,quote}>}
 */
function extractFromLine(line) {
  const found = [];
  if (!line || line.length > 2000) return found;

  const lower = line.toLowerCase();

  for (const entry of ALIAS_INDEX) {
    const pos = findAliasPos(lower, entry.aliasLower);
    if (pos === -1) continue;

    const field = FIELDS[entry.key];
    const after = line.slice(pos + entry.alias.length, pos + entry.alias.length + 60);

    if (field.type === 'string') {
      const m = after.match(/^[\s:：=|\t]*([^\t|,;]{1,60})/);
      const v = m && m[1].trim();
      if (v && !/^[\s\-]*$/.test(v)) {
        found.push({ key: entry.key, value: v, unit: null, confidence: /[:：=]/.test(after.slice(0, 3)) ? 0.8 : 0.6, quote: line.trim().slice(0, 200) });
      }
      continue;
    }

    // 숫자형: alias 뒤에서 첫 숫자 + 단위 토큰을 찾는다
    const m = after.match(/[\s:：=|\t]*(-?[\d][\d,]*(?:\.\d+)?)\s*(조\s*원?|억\s*원?|백만\s*원|천만\s*원|만\s*원|원|㎡|m2|m²|평|MW|kW|%|년|층)?/i);
    if (!m) continue;

    const rawNum = m[1];
    const rawUnit = (m[2] || '').replace(/\s+/g, '');
    let value = null;

    if (field.unit === '억원') {
      value = parseMoneyToEok(rawUnit ? `${rawNum}${rawUnit}` : rawNum);
    } else if (field.unit === '㎡') {
      const n = parseNumber(rawNum);
      value = rawUnit === '평' ? normalize(n, '평', '㎡') : n;
    } else if (field.unit === 'MW' && /kW/i.test(rawUnit)) {
      value = normalize(parseNumber(rawNum), 'kW', 'MW');
    } else if (field.unit === 'kW' && /MW/i.test(rawUnit)) {
      value = normalize(parseNumber(rawNum), 'MW', 'kW');
    } else {
      value = parseNumber(rawNum);
    }

    if (value === null || !Number.isFinite(value)) continue;

    // 단위가 dictionary와 명백히 다르면 신뢰도를 낮춘다 (Validation Agent가 잡도록)
    const unitMismatch = rawUnit && field.unit && !unitCompatible(rawUnit, field.unit);
    const confidence = (/[:：=|\t]/.test(after.slice(0, 3)) ? 0.85 : 0.7) - (unitMismatch ? 0.25 : 0);

    found.push({
      key: entry.key,
      value: round(value, 4),
      unit: field.unit,
      confidence: Math.max(0.3, confidence),
      quote: line.trim().slice(0, 200),
      ...(unitMismatch ? { note: `문서 단위 '${rawUnit}' ≠ 표준 단위 '${field.unit}'` } : {}),
    });
  }

  // 같은 줄에서 같은 key가 여러 번 잡히면 가장 신뢰도 높은 것만
  const best = new Map();
  for (const f of found) {
    const prev = best.get(f.key);
    if (!prev || f.confidence > prev.confidence) best.set(f.key, f);
  }
  return [...best.values()];
}

/**
 * alias가 더 긴 단어의 일부로 등장한 경우를 걸러낸다.
 *   '기타사업비 : 186억원' 에서 alias '사업비' 는 매칭되면 안 된다.
 *   (앞 글자가 한글/영숫자면 다른 단어의 꼬리다)
 */
const WORD_CHAR = /[가-힣a-z0-9]/;

function findAliasPos(lowerLine, alias) {
  let from = 0;
  while (from <= lowerLine.length) {
    const pos = lowerLine.indexOf(alias, from);
    if (pos === -1) return -1;
    const prev = pos > 0 ? lowerLine[pos - 1] : '';
    if (!prev || !WORD_CHAR.test(prev)) return pos;
    from = pos + 1;
  }
  return -1;
}

function unitCompatible(rawUnit, fieldUnit) {
  const u = rawUnit.toLowerCase();
  if (fieldUnit === '억원') return /조|억|백만|천만|만|원/.test(rawUnit);
  if (fieldUnit === '㎡') return /㎡|m2|m²|평/.test(u);
  if (fieldUnit === 'MW') return /mw|kw/.test(u);
  if (fieldUnit === 'kW') return /kw|mw/.test(u);
  if (fieldUnit === '%') return u === '%';
  if (fieldUnit === '년') return u === '년';
  return true;
}

/** LLM 보완 추출. quote 가 원문에 없으면 폐기한다. */
async function llmSupplement(text, missingKeys, docName, warn) {
  if (!missingKeys.length) return [];
  const fieldList = missingKeys.map(k => `- ${k}: ${FIELDS[k].label} (단위 ${FIELDS[k].unit || '없음'})`).join('\n');

  const schema = {
    type: 'object',
    required: ['facts'],
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['key', 'value', 'quote'],
          properties: {
            key: { type: 'string' },
            value: { type: ['number', 'string'] },
            quote: { type: 'string', minLength: 3 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  };

  const result = await llm.generateJson({
    system: '너는 투자심사 자료에서 수치를 추출하는 도구다. 문서에 명시되지 않은 값은 절대 만들어내지 않는다. 추정·계산·유추 금지.',
    prompt: `아래 문서에서 요청 항목의 값을 찾아라.

[규칙]
1. 문서에 그대로 적혀 있는 값만 추출한다. 없으면 그 항목은 결과에서 제외한다.
2. quote 에는 그 값이 등장하는 문서의 원문 문장을 **글자 그대로** 복사한다. 요약·재작성 금지.
3. 금액은 억원 단위 숫자로 환산한다 (2,846억원 → 2846, 1조 2,000억원 → 12000).
4. 면적은 ㎡, 전력은 MW, 비율은 % 숫자만.

[요청 항목]
${fieldList}

[문서: ${docName}]
${text.slice(0, 30000)}`,
    schema,
    label: '추출 결과',
  });

  const out = [];
  for (const f of result.facts || []) {
    if (!FIELDS[f.key]) continue;
    const quoteNorm = String(f.quote).replace(/\s+/g, '');
    if (!text.replace(/\s+/g, '').includes(quoteNorm.slice(0, 40))) {
      warn(`LLM 추출 폐기: ${f.key} — 근거 문구가 원문에 없음 (환각 의심)`);
      continue;
    }
    const lineNo = text.split('\n').findIndex(l => l.replace(/\s+/g, '').includes(quoteNorm.slice(0, 20)));
    const value = FIELDS[f.key].type === 'number' ? parseNumber(f.value) : String(f.value);
    if (value === null) continue;
    out.push({
      key: f.key, value, unit: FIELDS[f.key].unit,
      quote: String(f.quote).slice(0, 200),
      page: lineNo >= 0 ? lineNo + 1 : null,
      confidence: Math.min(0.75, f.confidence ?? 0.6), // LLM 추출은 규칙 기반보다 항상 낮게
    });
  }
  return out;
}

async function run(input, ctx) {
  const store = require('../core/store');
  const files = input.files || store.listSourceFiles(input.projectId);
  const facts = [];
  const documents = [];
  const unsupported = [];

  for (const file of files) {
    const { text, error } = toText(file);
    if (error) {
      unsupported.push({ name: file.name, reason: error });
      ctx.warn(`${file.name}: ${error}`);
      continue;
    }
    const lines = text.split('\n');
    let count = 0;
    lines.forEach((line, i) => {
      for (const f of extractFromLine(line)) {
        facts.push({ ...f, source: file.name, page: i + 1 });
        count++;
      }
    });
    documents.push({ name: file.name, chars: text.length, lines: lines.length, facts: count });

    // LLM 보완: 이 문서에서 규칙이 못 찾은 필수 항목만
    if (input.useLlm !== false && !llm.isOffline()) {
      const got = new Set(facts.filter(f => f.source === file.name).map(f => f.key));
      const missing = Object.keys(FIELDS).filter(k => !got.has(k)).slice(0, 25);
      try {
        const extra = await llmSupplement(text, missing, file.name, ctx.warn);
        for (const f of extra) facts.push({ ...f, source: file.name });
      } catch (e) {
        ctx.warn(`${file.name} LLM 보완 실패(규칙 추출 결과는 유지): ${e.message}`);
      }
    }
  }

  if (!files.length) ctx.warn('02_Source_Data 에 원본자료가 없다 — 추출할 것이 없음');

  const avgConf = facts.length ? facts.reduce((a, f) => a + f.confidence, 0) / facts.length : 0;
  return { facts, documents, unsupported, confidence: round(avgConf, 3) };
}

module.exports = {
  id: '02_extraction', label: 'Data Extraction Agent',
  inputSchema, outputSchema, run, extractFromLine, toText, unitCompatible, findAliasPos,
};
