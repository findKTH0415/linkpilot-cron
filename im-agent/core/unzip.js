'use strict';
/**
 * unzip.js — 의존성 없는 최소 ZIP 리더 (Node 내장 zlib 사용).
 *
 * docx / xlsx / pptx 는 전부 ZIP 컨테이너다. 새 라이브러리를 추가하지 않고
 * 원본자료에서 텍스트를 뽑기 위해 중앙 디렉터리만 읽어 항목을 꺼낸다.
 * 지원 압축방식: 0(store), 8(deflate). 그 외는 null 을 반환한다.
 */

const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 66560); // 주석 최대 64KB 고려
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * @param {Buffer} buf zip 파일 전체
 * @returns {Map<string, Buffer>} 파일명 → 압축해제된 내용
 */
function readZip(buf) {
  const out = new Map();
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('ZIP 형식이 아니다 (EOCD 없음)');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // 중앙 디렉터리 시작

  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;

    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // 로컬 헤더에서 실제 데이터 시작 위치 계산
    if (localOffset + 30 <= buf.length && buf.readUInt32LE(localOffset) === 0x04034b50) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      try {
        if (method === 0) out.set(name, raw);
        else if (method === 8) out.set(name, zlib.inflateRawSync(raw));
      } catch (_) {
        // 개별 항목 실패는 건너뛴다 (전체 파싱을 죽이지 않는다)
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** XML 태그 제거 → 텍스트. 문단 구분은 줄바꿈으로 보존 */
function xmlToText(xml, { paragraphTags = ['w:p', 'a:p', 'text:p'] } = {}) {
  let s = String(xml);
  for (const tag of paragraphTags) {
    s = s.replace(new RegExp(`</${tag}>`, 'g'), '\n');
  }
  s = s.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
       .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/** docx → 텍스트 */
function docxText(buf) {
  const zip = readZip(buf);
  const doc = zip.get('word/document.xml');
  if (!doc) throw new Error('word/document.xml 없음');
  return xmlToText(doc.toString('utf8'));
}

/** xlsx → 시트별 행 텍스트 (셀은 탭 구분) */
function xlsxText(buf) {
  const zip = readZip(buf);
  const shared = [];
  const ss = zip.get('xl/sharedStrings.xml');
  if (ss) {
    const xml = ss.toString('utf8');
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(xmlToText(m[1], { paragraphTags: [] }));
    }
  }

  const lines = [];
  for (const [name, content] of zip) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = content.toString('utf8');
    lines.push(`# ${name}`);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c[^>]*?(?:\st="(\w+)")?[^>]*>([\s\S]*?)<\/c>/g)) {
        const type = c[1];
        const vm = c[2].match(/<v>([\s\S]*?)<\/v>/);
        const im = c[2].match(/<is>([\s\S]*?)<\/is>/);
        let val = '';
        if (im) val = xmlToText(im[1], { paragraphTags: [] });
        else if (vm) val = type === 's' ? (shared[Number(vm[1])] ?? '') : vm[1];
        cells.push(val);
      }
      if (cells.some(c => c !== '')) lines.push(cells.join('\t'));
    }
  }
  return lines.join('\n').trim();
}

/** pptx → 슬라이드 텍스트 */
function pptxText(buf) {
  const zip = readZip(buf);
  const slides = [...zip.keys()].filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
  return slides.map((n, i) => `# slide ${i + 1}\n${xmlToText(zip.get(n).toString('utf8'))}`).join('\n\n').trim();
}

module.exports = { readZip, xmlToText, docxText, xlsxText, pptxText };
