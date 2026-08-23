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
 * 읽는 방법은 파일 형식마다 다르다 (FORMATS 가 단일 출처):
 *   text  txt/md/csv/json/html            그대로
 *   zip   docx/xlsx/pptx/hwpx             내장 zlib 기반 unzip (hwpx 도 ZIP 이다)
 *   pdf   pdf                             텍스트 레이어 → 없으면 OCR
 *   ole   hwp/doc/xls/ppt                 CFBF 파서 → 깨지면 OCR
 *   ocr   jpg/jpeg/png/webp/heic/heif     Gemini 전사(轉寫)
 *   convert gif/tif/tiff                  변환 없이는 못 읽는다 (아래 ★)
 *
 * ★ **읽은 방법을 값에 남긴다.** OCR 로 옮겨 적은 글자에서 뽑은 값과 원문에서
 *   바로 뽑은 값을 같은 신뢰도로 두면, 나중에 값이 틀렸을 때 어디를 봐야 하는지
 *   알 수 없다. OCR 경로는 신뢰도를 깎고 note 에 그 사실을 적는다.
 *
 * ★★★ **파일을 나란히 읽는다** 〈2026-08-23 사장님: 「너무 오래걸려 단축방법을
 *   찾아줘」〉. OCR 을 켠 첫날 자료 15건에 **7분 55초**가 걸렸다.
 *
 *   원인은 계산이 무거워서가 아니라 **한 줄로 세워 놓아서**다. 파일마다
 *   ① OCR 전사 ② LLM 보완 — 최대 두 번의 왕복이 있고, 그것을 파일 수만큼
 *   차례로 기다렸다. 15건이면 최대 30번을 줄 세운 셈이다.
 *
 *   ★ 파일끼리는 **서로 아무 상관이 없다.** 한 파일의 값이 다른 파일에
 *     영향을 주지 않으므로 나란히 읽어도 결과가 달라지지 않는다.
 *   ★ 그래도 **결과 차례는 그대로 둔다** — 값·문서·경고가 파일 순서대로
 *     나와야 다시 돌렸을 때 같은 보고서가 나온다.
 *   ★ 몇 개씩 읽을지는 `IM_EXTRACT_CONCURRENCY` 로 바꾼다. 너무 올리면
 *     구글이 한도(429)로 막고, 그러면 **읽히던 것도 안 읽힌다.**
 *
 * ★★ **같은 파일을 두 번 읽지 않는다** 〈같은 날〉. 같은 자료를 여러 번 올리면
 *   그만큼 OCR 을 다시 돌렸다. 내용이 같으면(sha256) 한 번만 읽고, **건너뛴
 *   것은 말한다** — 조용히 빠지면 「올렸는데 안 읽혔다」가 된다.
 *
 * ★ gif/tif/tiff 는 지금 못 읽는다. Gemini 가 인라인으로 받는 이미지는
 *   png/jpeg/webp/heic/heif 뿐이고, 이 저장소는 이미지 변환 라이브러리를
 *   들이지 않는다. **되는 척하지 않고** 무엇으로 바꿔 올리면 되는지 말한다.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FIELDS, ALIAS_INDEX } = require('../core/dictionary');
const { parseNumber, parseMoneyToEok, normalize, round } = require('../core/numeric');
const unzip = require('../core/unzip');
const pdftext = require('../core/pdftext');
const ole = require('../core/ole');
const ifc = require('../core/ifc');
const ocr = require('../core/ocr');
const llm = require('../core/llm');

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.html', '.htm', '.xml', '.log']);
const ZIP_EXT = {
  '.docx': 'docxText', '.xlsx': 'xlsxText', '.xlsm': 'xlsxText', '.pptx': 'pptxText',
  '.hwpx': 'hwpxText',
};
const OLE_EXT = new Set(['.hwp', '.doc', '.xls', '.ppt']);
const OCR_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
/** 변환 없이는 못 읽는 형식. **이 목록은 짧을수록 좋다** */
const UNSUPPORTED_EXT = new Set(['.gif', '.tif', '.tiff']);

/** 확장자 → 읽는 방법. 화면·서버가 같이 본다 */
const FORMATS = (() => {
  const m = {};
  TEXT_EXT.forEach(e => { m[e] = 'text'; });
  Object.keys(ZIP_EXT).forEach(e => { m[e] = 'zip'; });
  m['.pdf'] = 'pdf';
  m['.ifc'] = 'model';
  OLE_EXT.forEach(e => { m[e] = 'ole'; });
  OCR_EXT.forEach(e => { m[e] = 'ocr'; });
  UNSUPPORTED_EXT.forEach(e => { m[e] = 'convert'; });
  return m;
})();

/**
 * 화면에 보여 줄 묶음. **화면이 확장자를 나열하지 않게** 여기서 만들어 내려보낸다.
 *
 * ★ pdf·hwp·doc·xls·ppt 는 「본문을 읽습니다」에 둔다. 대부분은 정말 그대로
 *   읽히고, 안 읽히는 것(스캔본·규격 밖 변종)만 자동으로 2번 묶음으로 넘어간다.
 *   반대로 두면 — 읽히는 파일을 「스캔해야 읽습니다」에 넣으면 — 사람은 키가
 *   없다고 생각해 아예 안 올린다.
 */
function readGroups() {
  const of = (kinds) => Object.keys(FORMATS).filter(e => kinds.includes(FORMATS[e])).sort();
  return [
    {
      id: 'direct',
      label: '본문을 그대로 읽습니다',
      why: '서버가 파일을 열어 글자를 꺼냅니다. 인터넷도 인증키도 필요 없습니다.',
      ext: of(['text', 'zip', 'pdf', 'ole']),
    },
    {
      id: 'model',
      label: 'BIM 모델은 수량을 읽습니다',
      why: '모델이 내보낼 때 함께 써 넣은 수량(부재 개수·면적·부피)을 읽습니다. '
        + '형상에서 물량을 새로 계산하지는 않습니다 — 모델에 수량이 없으면 없다고 말합니다. '
        + '읽은 수량은 자동으로 필드에 채우지 않습니다. 모델은 근거가 아니라 대조 대상입니다.',
      ext: of(['model']),
    },
    {
      id: 'scan',
      label: '스캔·사진은 글자로 옮겨 읽습니다',
      why: '이미지에는 글자 정보가 없어 옮겨 적는 과정을 한 번 거칩니다. '
        + '옮긴 글자에서 뽑은 값은 신뢰도를 낮춰 표시하고, 원본 확인 안내를 붙입니다.',
      ext: of(['ocr']),
      needsKey: 'GEMINI_API_KEY',
    },
    {
      id: 'convert',
      label: '변환해서 올려야 합니다',
      why: '이 형식은 읽는 방법이 없습니다. 되는 척하지 않고 미리 말씀드립니다.',
      ext: of(['convert']),
      hint: CONVERT_HINT,
    },
  ];
}

/** 무엇으로 바꿔 올리면 되는지 — 화면이 그대로 보여 준다 */
const CONVERT_HINT = {
  '.gif': 'PNG 로 저장해서 올립니다',
  '.tif': 'PDF 나 PNG 로 저장해서 올립니다 (스캐너 설정에서 바꿀 수 있습니다)',
  '.tiff': 'PDF 나 PNG 로 저장해서 올립니다 (스캐너 설정에서 바꿀 수 있습니다)',
};

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    files: { type: 'array' },
    /** 02_Source_Data 밖에서 온 파일 — 연결 자료를 임시 폴더에 받은 것 ({name,path,size,ext,key}).
     *  files 와 달리 **원본자료 목록에 더해서** 읽는다 (D-65). */
    extraFiles: { type: 'array' },
    /** 연결 자료 중 못 가져온 것 ({key,name,reason}) — 조용히 빠지지 않고 unsupported 로 선다 */
    linkedFailed: { type: 'array' },
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

/**
 * 파일 → 평문 텍스트 (LLM 없이 되는 것만). 실패는 예외 대신 {error} 로 돌려 격리한다.
 * @returns {{text?:string, via?:string, error?:string, ocr?:string}}
 *   ocr  이 붙어 오면 "규칙으로는 못 읽었지만 OCR 은 해 볼 만하다"는 뜻이고,
 *        그 값은 사람에게 보일 사유다 (스캔본인지 규격 밖 파일인지)
 */
function toText(file) {
  const ext = file.ext || path.extname(file.name).toLowerCase();
  try {
    if (TEXT_EXT.has(ext)) {
      let t = fs.readFileSync(file.path, 'utf8');
      if (ext === '.html' || ext === '.htm' || ext === '.xml') t = unzip.xmlToText(t, { paragraphTags: ['p', 'div', 'tr', 'li'] });
      return { text: t, via: 'text' };
    }
    if (ZIP_EXT[ext]) {
      return { text: unzip[ZIP_EXT[ext]](fs.readFileSync(file.path)), via: 'zip' };
    }
    if (ext === '.pdf') {
      const r = pdftext.pdfText(fs.readFileSync(file.path));
      if (r.reliable) return { text: r.text, via: 'pdf' };
      // ★ 여기서 '깨진 글자라도' 돌려주지 않는다. 그러면 조회는 성공하고
      //   값만 쓰레기가 된다 — 화면에는 아무 경고도 안 뜬다
      return { error: r.reason, ocr: r.reason, via: 'pdf' };
    }
    if (OLE_EXT.has(ext)) {
      const raw = fs.readFileSync(file.path);
      const out = { text: ole.oleText(ext, raw), via: 'ole' };
      /* ★★ **글자만 읽고 「읽었다」고 하지 않는다** 〈2026-08-22 실측〉.
       *   실무 사업계획서 하나를 재 보니 8.6MB 중 **8.2MB(95%)가 그림 58장**이고
       *   글자는 3,243자뿐이었다. 파서는 정상으로 읽었는데 **문서 내용의
       *   대부분은 아무도 안 본 그림 안에** 있었다 — M-16 과 같은 병이다.
       * ★ 여기서 OCR 을 부르지 않는다(키·비용). **몇 장이 남았는지 세어서
       *   말할 뿐이다.** 세지 않으면 아무도 그것이 있는 줄 모른다. */
      if (ext === '.hwp' && typeof ole.hwpImages === 'function') {
        try {
          const pics = ole.hwpImages(raw);
          if (pics.length) {
            out.pictures = pics.length;
            out.pictureBytes = pics.reduce((n, x) => n + x.buf.length, 0);
          }
        } catch (_) { /* 그림을 못 꺼내도 본문은 읽었다 — 여기서 죽이지 않는다 */ }
      }
      return out;
    }
    if (ext === '.ifc') {
      // ★ STEP 원문을 글자로 넘기지 않는다. 좌표·GUID 가 수만 줄이라 별칭 추출이
      //   엉뚱한 숫자를 잡는다 — 「연면적 12.5」 같은 값이 출처까지 달고 들어온다.
      //   대신 **읽은 수량을 사람 말로 요약해서만** 넘긴다.
      const r = ifc.read(fs.readFileSync(file.path), { name: file.name });
      if (!r.ok) return { error: r.reason, via: 'model' };
      return { text: ifc.summarize(r), via: 'model', model: r };
    }
    if (OCR_EXT.has(ext)) {
      return { error: '이미지는 글자로 옮겨야 읽는다', ocr: '이미지 파일', via: 'ocr' };
    }
    if (UNSUPPORTED_EXT.has(ext)) {
      return { error: `${ext} 는 변환 없이는 못 읽습니다 — ${CONVERT_HINT[ext] || 'PDF 나 PNG 로 바꿔서 올립니다'}`, via: 'convert' };
    }
    return { error: `알 수 없는 확장자 ${ext}` };
  } catch (e) {
    // OLE 파서가 "규격 밖 변종"이라고 한 경우는 OCR 로 넘겨 볼 값어치가 있다
    const retryable = OLE_EXT.has(ext);
    return { error: `읽기 실패: ${e.message}`, ocr: retryable ? e.message : undefined, via: FORMATS[ext] };
  }
}

/**
 * 규칙으로 못 읽은 파일을 OCR 로 한 번 더 시도한다.
 *
 * ★ 실패해도 파이프라인을 죽이지 않는다. 자료 하나가 안 읽혔다고 보고서 생성이
 *   멈추면, 사람은 무엇 때문에 멈췄는지 모른 채 처음부터 다시 한다.
 */
async function tryOcr(file, reason, warn) {
  const ext = file.ext || path.extname(file.name).toLowerCase();
  if (!ocr.isSupported(file.name)) {
    return { error: `${reason} — ${CONVERT_HINT[ext] || '이 형식은 OCR 로도 읽을 수 없습니다'}` };
  }
  if (llm.isOffline()) {
    return { error: `${reason} — 스캔본을 읽으려면 GEMINI_API_KEY 가 필요합니다 (지금은 꺼져 있습니다)` };
  }
  try {
    const r = await ocr.transcribe({ buffer: fs.readFileSync(file.path), name: file.name });
    warn(`${file.name}: ${reason} → OCR 로 ${r.chars}자를 옮겨 적었습니다 (원문이 아니라 옮긴 글자입니다)`);
    return { text: r.text, via: 'ocr' };
  } catch (e) {
    return { error: `${reason} · OCR 도 실패: ${e.message}` };
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


/* ────────────────────── 나란히 읽기 ────────────────────── */

/**
 * 한 번에 몇 개까지 읽는가. **너무 올리면 구글이 한도로 막는다**(429) —
 * 그러면 읽히던 것도 안 읽히므로, 기본을 낮게 두고 필요할 때 올린다.
 */
const CONCURRENCY = Math.max(1, Number(process.env.IM_EXTRACT_CONCURRENCY || 4) || 1);

/**
 * `items` 를 최대 `limit` 개씩 나란히 돌린다. **결과는 넣은 차례 그대로** 돌려준다.
 *
 * ★ `Promise.all(items.map(...))` 를 쓰지 않는다 — 그것은 한도가 없어서
 *   파일이 쉰 개면 쉰 개를 한꺼번에 던진다.
 */
async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * 내용이 같은 파일을 하나로 줄인다. **건너뛴 것은 돌려준다** — 조용히 빠지면
 * 「올렸는데 안 읽혔다」가 되고 원인을 찾을 수가 없다.
 *
 * ★ 이름이 아니라 **내용**으로 가른다. 맥이 붙이는 `(1)`·`(2)` 때문에 같은
 *   파일이 다른 이름으로 들어온다.
 * ★ 못 읽는 파일은 **거르지 않는다** — 읽기 실패는 아래에서 사람 말로 말해야 한다.
 */
function dedupeByContent(files) {
  const keep = [];
  const skipped = [];
  const seen = new Map();
  for (const f of files) {
    let sha = null;
    try { sha = crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex'); } catch (_) { /* 못 읽으면 아래에서 말한다 */ }
    if (!sha) { keep.push(f); continue; }
    const first = seen.get(sha);
    if (first === undefined) { seen.set(sha, f.name); keep.push(f); continue; }
    skipped.push({ name: f.name, sameAs: first });
  }
  return { keep, skipped };
}

async function run(input, ctx) {
  const store = require('../core/store');
  const files = input.files || store.listSourceFiles(input.projectId).concat(input.extraFiles || []);
  const facts = [];
  const documents = [];
  const unsupported = [];
  // ★ 연결 자료를 못 가져온 것은 **읽기 실패와 같은 자리**에 선다 — 값이 조용히 빠지고
  //   문서가 멀쩡해 보이는 것이 이 시스템에서 가장 나쁜 실패다 (플랫폼-연결-지시서 §2-1)
  for (const f of input.linkedFailed || []) {
    unsupported.push({ name: f.name || f.key, reason: `연결 자료를 가져오지 못했습니다 — ${f.reason || '사유 없음'}` });
    ctx.warn(`${f.name || f.key}: 연결 자료를 가져오지 못했습니다 — ${f.reason || '사유 없음'}`);
  }

  /* ★★ 같은 파일을 두 번 읽지 않는다. **건너뛴 것은 말한다** */
  const dd = dedupeByContent(files);
  dd.skipped.forEach((x) => {
    ctx.warn(`${x.name}: 내용이 「${x.sameAs}」와 같아 한 번만 읽었습니다 (지문 일치)`);
  });

  /* ★★★ **파일끼리 나란히 읽는다.** 파일은 서로 상관이 없으므로 결과가
   *   달라지지 않는다. 다만 **차례는 그대로 둔다** — 경고도 값도 파일 순서대로
   *   나와야 다시 돌렸을 때 같은 보고서가 나온다. 그래서 각 파일의 경고를
   *   모아 두었다가 아래에서 차례로 낸다. */
  const perFile = await mapLimited(dd.keep, CONCURRENCY, async (file) => {
    const warns = [];
    const warn = (m) => warns.push(m);

    let r = toText(file);
    // 규칙으로 못 읽었지만 OCR 이 해 볼 만한 파일 (스캔 PDF · 이미지 · 규격 밖 옛 문서)
    if (r.error && r.ocr) r = await tryOcr(file, r.ocr, warn);

    const { text, error, via } = r;
    if (error) {
      warns.push(`${file.name}: ${error}`);
      return { warns, unsupported: { name: file.name, reason: error } };
    }

    const lines = text.split('\n');
    const mine = [];
    // ★ OCR 은 원문이 아니라 옮겨 적은 글자다. 같은 신뢰도로 두면 값이 틀렸을 때
    //   어디를 봐야 하는지 알 수 없다 — 신뢰도를 깎고 그 사실을 값에 적어 둔다
    const byOcr = via === 'ocr';
    lines.forEach((line, i) => {
      for (const f of extractFromLine(line)) {
        mine.push({
          ...f,
          confidence: byOcr ? Math.min(f.confidence, ocr.OCR_CONFIDENCE) : f.confidence,
          note: byOcr ? 'OCR 로 옮겨 적은 글자에서 뽑았습니다 — 원본을 확인하세요' : undefined,
          source: file.name,
          page: i + 1,
        });
      }
    });

    const doc = { name: file.name, chars: text.length, lines: lines.length, facts: mine.length, via: via || 'text' };
    /* ★ 그림이 남아 있으면 **문서 옆에 적어 둔다.** 「3,243자를 읽었습니다」만
     *   보이면 그림 58장은 없는 것이 된다 */
    if (r.pictures) {
      doc.pictures = r.pictures;
      doc.pictureBytes = r.pictureBytes || 0;
      warns.push(`${file.name}: 글자 ${text.length}자를 읽었습니다. `
        + `**그림 ${r.pictures}장(${Math.round((r.pictureBytes || 0) / 1048576)}MB)은 아직 글자로 옮기지 않았습니다** `
        + '— 도면·표 캡처가 그 안에 있으면 그 값은 들어오지 않습니다');
    }

    // LLM 보완: 이 문서에서 규칙이 못 찾은 필수 항목만
    if (input.useLlm !== false && !llm.isOffline()) {
      const got = new Set(mine.map(f => f.key));
      const missing = Object.keys(FIELDS).filter(k => !got.has(k)).slice(0, 25);
      try {
        const extra = await llmSupplement(text, missing, file.name, warn);
        for (const f of extra) mine.push({ ...f, source: file.name });
      } catch (e) {
        warns.push(`${file.name} LLM 보완 실패(규칙 추출 결과는 유지): ${e.message}`);
      }
    }
    doc.facts = mine.length;
    return { warns, doc, facts: mine };
  });

  /* ★ 넣은 차례 그대로 편다 */
  perFile.forEach((r) => {
    if (!r) return;
    r.warns.forEach((m) => ctx.warn(m));
    if (r.unsupported) { unsupported.push(r.unsupported); return; }
    if (r.doc) documents.push(r.doc);
    if (r.facts) facts.push(...r.facts);
  });

  if (!files.length) ctx.warn('02_Source_Data 에 원본자료가 없다 — 추출할 것이 없음');

  // ★ 건너뛴 것을 **말한다.** 휴지통은 안 읽는 것이 맞지만, 「지웠는데도 값이
  //   그대로다」·「올렸는데 안 읽혔다」의 원인이 여기일 때 로그가 없으면
  //   찾을 방법이 없다. 조용히 빠지는 것이 이 시스템에서 가장 비싼 실패다.
  if (!input.files) {
    for (const x of store.listExcludedSourceFiles(input.projectId)) {
      if (!x.files) continue;
      ctx.warn(`읽지 않음: ${x.name} (${x.files}건, ${Math.round(x.size / 1024)}KB) — ${x.why}`);
    }
  }

  const avgConf = facts.length ? facts.reduce((a, f) => a + f.confidence, 0) / facts.length : 0;
  return { facts, documents, unsupported, confidence: round(avgConf, 3) };
}

module.exports = {
  id: '02_extraction', label: 'Data Extraction Agent',
  inputSchema, outputSchema, run, extractFromLine, toText, tryOcr, unitCompatible, findAliasPos,
  // ★ 나란히 읽기 — 시험이 실제로 돌려 봐야 한다 (한도·차례·건너뛰기)
  mapLimited, dedupeByContent, CONCURRENCY,
  // ★ 접수 화면이 '올리기 전에' 지원 형식을 알려주려면 이 목록이 필요하다.
  //   화면에 복사해 두면 여기가 바뀌는 날부터 갈린다 — 되는 줄 알고 올렸다가
  //   추출 단계에서야 안 된다는 걸 알게 된다.
  TEXT_EXT, ZIP_EXT, OLE_EXT, OCR_EXT, UNSUPPORTED_EXT, FORMATS, CONVERT_HINT, readGroups,
};
