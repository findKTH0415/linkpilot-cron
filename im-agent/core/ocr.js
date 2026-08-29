'use strict';
/**
 * ocr.js — 스캔본·이미지에서 **글자만** 꺼내 온다.
 *
 * ★ 여기서 하는 일은 '전사(轉寫)'다. 값 추출이 아니다.
 *
 *   왜 나누는가: 이 저장소는 LLM 이 지어낸 숫자를 막기 위해 "근거 문구가 원문에
 *   실제로 있는지" 대조한다(02-extraction). 그런데 이미지에서 LLM 에게 값을
 *   바로 물으면 **대조할 원문이 없다.** 대조할 수 없는 값은 이 시스템에 들어올 수
 *   없다. 그래서 ① 이미지를 글자로 옮기고 ② 그 글자에 평소의 규칙 추출을 돌린다.
 *   그러면 근거 문구 대조가 그대로 작동하고, 사람이 나중에 원문을 볼 수도 있다.
 *
 * ★ OCR 로 읽은 글자는 **원문이 아니라 옮겨 적은 것**이다. 그래서 이 경로로 들어온
 *   값은 신뢰도를 깎고(OCR_CONFIDENCE), Fact 의 note 에 그 사실을 적는다.
 *   출처표에서 "이 값은 사람이 원본을 다시 봐야 한다"를 알 수 있어야 한다.
 *
 * ★ 지어내기를 막는 장치: 읽을 수 없는 글자는 비워 두라고 지시하고, 응답이
 *   비정상적으로 짧으면 실패로 본다. 조용히 빈 문서를 돌려주면 "자료를 올렸는데
 *   아무 값도 안 나온다"가 되고, 그 이유를 아무도 모른다.
 */

const llm = require('./llm');
const claude = require('./claude');

/** Gemini 가 inlineData 로 받는 형식. 목록 밖은 **변환 없이는 못 읽는다** */
const OCR_MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

/** 인라인 요청 한도(20MB)에 여유를 둔다 — base64 로 커지는 몫까지 본다 */
const MAX_INLINE_BYTES = 14 * 1024 * 1024;

/** OCR 로 읽은 값의 신뢰도 상한. 규칙 추출(원문 직접)보다 항상 낮다 */
const OCR_CONFIDENCE = 0.55;

const SYSTEM = [
  '너는 문서를 글자 그대로 옮겨 적는 전사원이다.',
  '해석·요약·정리를 하지 않는다. 보이는 글자만 옮긴다.',
  '보이지 않거나 확실하지 않은 글자는 지어내지 않고 [?] 로 남긴다.',
  '숫자는 자릿점·단위까지 보이는 그대로 옮긴다 (2,846억원 → 2,846억원).',
  '표는 한 행을 한 줄로, 칸은 탭으로 구분한다.',
  '쪽이 나뉘면 그 자리에 "--- p.2 ---" 처럼 쪽 번호를 적는다.',
].join('\n');

function extOf(name) {
  const i = String(name).lastIndexOf('.');
  return i === -1 ? '' : String(name).slice(i).toLowerCase();
}

function mimeFor(name) {
  return OCR_MIME[extOf(name)] || null;
}

function isSupported(name) {
  return !!mimeFor(name);
}

/**
 * 이미지·스캔본 → 텍스트.
 *
 * @param {{buffer:Buffer, name:string}} file
 * @returns {Promise<{text:string, chars:number}>}
 * @throws {llm.OfflineError} 키가 없을 때 — 부르는 쪽이 '못 읽었다'로 남긴다
 */
async function transcribe(file) {
  const mime = mimeFor(file.name);
  if (!mime) throw new Error(`${extOf(file.name)} 는 그대로 읽을 수 없다 — PDF 나 PNG/JPG 로 바꿔서 올린다`);
  if (!file.buffer || !file.buffer.length) throw new Error('빈 파일');
  if (file.buffer.length > MAX_INLINE_BYTES) {
    throw new Error(`파일이 커서 한 번에 못 읽는다 (${Math.round(file.buffer.length / 1048576)}MB · 한도 ${MAX_INLINE_BYTES / 1048576}MB) — 나눠서 올린다`);
  }

  const PROMPT = '이 문서에 적힌 글자를 처음부터 끝까지 그대로 옮겨 적어라. 설명은 붙이지 않는다.';

  /* ★★★ **읽는 길이 둘이다** 〈2026-08-29 · D-167〉.
   *
   *   사장님이 PDF 여덟을 올리셨는데 셋을 한 글자도 못 읽었다. 그 셋은 글자가
   *   코드값으로만 들어 있어 OCR 로 넘어가야 했는데, **그 OCR 이 하나뿐**이었고
   *   그날 Gemini 열쇠가 전부 막혀 있었다(D-166).
   *
   *   ★ D-166 은 **같은 길을 고친 것**이다. 한도가 정말 찬 날에는 여전히 한 글자도
   *     못 읽는다. 그래서 **다른 회사의 다른 길**을 하나 더 둔다.
   *   ★★ 첫 길이 실패한 **까닭을 버리지 않는다.** 둘 다 실패하면 두 까닭을 함께
   *     적는다 — 하나만 적으면 「왜 안 되는지」를 반쪽만 알게 된다.
   */
  let text = null;
  let by = 'gemini';
  let firstWhy = null;

  try {
    text = await llm.generate({
      system: SYSTEM,
      files: [{ mime, data: file.buffer }],
      prompt: PROMPT,
      temperature: 0,
      maxOutputTokens: 8192,
      timeoutMs: 180000,          // 여러 쪽짜리 스캔본은 오래 걸린다
    });
  } catch (e) {
    firstWhy = e && e.message ? e.message : String(e);
    if (!claude.available()) {
      /* 두 번째 길이 꺼져 있으면 **첫 까닭을 그대로** 올린다. 여기서 말을
         바꾸면 원인이 흐려진다 */
      throw e;
    }
    try {
      text = await claude.generate({
        system: SYSTEM,
        files: [{ mime, data: file.buffer }],
        prompt: PROMPT,
        maxOutputTokens: 8192,
        timeoutMs: 180000,
      });
      by = 'claude';
    } catch (e2) {
      const why2 = e2 && e2.message ? e2.message : String(e2);
      const err = new Error(`두 길 다 못 읽었다 — 첫째: ${firstWhy} / 둘째: ${why2}`);
      err.code = 'OCR_BOTH_FAILED';
      throw err;
    }
  }

  const clean = String(text).replace(/\r\n/g, '\n').trim();
  // ★ 조용한 빈 응답을 성공으로 넘기지 않는다
  if (clean.replace(/\s|\[\?\]/g, '').length < 10) {
    throw new Error('글자를 거의 못 읽었다 — 해상도가 낮거나 글자가 없는 이미지일 수 있다');
  }
  /* ★ **누가 읽었는지 남긴다.** 두 길의 글자는 결이 다를 수 있고, 나중에
     「이 값이 왜 이런가」를 볼 때 그 사실이 필요하다 (§4.7 출처 규칙) */
  return { text: clean, chars: clean.length, by, fallbackFrom: by === 'claude' ? firstWhy : null };
}

module.exports = {
  transcribe, isSupported, mimeFor, extOf, secondReader: claude,
  OCR_MIME, MAX_INLINE_BYTES, OCR_CONFIDENCE, SYSTEM,
};
