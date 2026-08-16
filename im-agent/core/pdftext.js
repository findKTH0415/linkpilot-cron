'use strict';
/**
 * pdftext.js — PDF 본문 텍스트 추출 (의존성 없음, 내장 zlib 만 쓴다).
 *
 * 왜 직접 만드는가: PDF 파서를 의존성으로 들이는 것은 승인 대상이고(등록부 D-13),
 * 무엇보다 **텍스트 레이어가 있는 PDF 는 LLM 없이 결정적으로 읽을 수 있다.**
 * 같은 파일을 두 번 넣으면 두 번 다 같은 글자가 나와야 한다 — OCR 은 그것을
 * 보장하지 못한다. 그래서 순서는 ① 텍스트 레이어 ② 안 되면 OCR 이다.
 *
 * ★ **못 읽었으면 못 읽었다고 말한다.** 이 파일의 가장 위험한 실패는 예외가
 *   아니라 "그럴듯한 깨진 글자"다. 한글 PDF 는 대부분 CID 폰트(Identity-H)라
 *   ToUnicode CMap 없이는 코드값이 글자가 아니다. 그 상태로 뽑으면 조회는
 *   성공하고 값은 쓰레기인데 화면에는 아무 경고도 안 뜬다.
 *   그래서 매핑이 없는 문자열을 만나면 `reliable:false` 로 돌려 OCR 로 넘긴다.
 *
 * 다루는 것: FlateDecode · LZWDecode · ASCIIHexDecode · ASCII85Decode,
 *            Tj · TJ · ' · " 연산자, ToUnicode CMap(bfchar/bfrange).
 * 안 다루는 것: 암호화된 PDF(/Encrypt) — 열쇠가 없으면 원래 못 읽는다.
 */

const zlib = require('zlib');

/** 텍스트 레이어가 이만큼도 안 나오면 스캔본으로 본다 */
const MIN_TEXT_CHARS = 40;

/* ── 스트림 필터 ───────────────────────────────────────────── */

function inflate(buf) {
  try { return zlib.inflateSync(buf); } catch (_) { /* zlib 헤더가 없을 수 있다 */ }
  return zlib.inflateRawSync(buf);
}

/** LZW (PDF/TIFF 변종 — MSB 우선, EarlyChange 기본 1) */
function lzwDecode(buf, earlyChange) {
  const early = earlyChange === 0 ? 0 : 1;
  const out = [];
  let dict = [];
  const reset = () => {
    dict = new Array(256);
    for (let i = 0; i < 256; i++) dict[i] = [i];
    dict.length = 258;                       // 256=CLEAR, 257=EOD
  };
  reset();

  let width = 9, prev = null, bitBuf = 0, bitCnt = 0;
  for (let i = 0; i < buf.length; i++) {
    bitBuf = (bitBuf << 8) | buf[i];
    bitCnt += 8;
    while (bitCnt >= width) {
      const code = (bitBuf >> (bitCnt - width)) & ((1 << width) - 1);
      bitCnt -= width;
      if (code === 256) { reset(); width = 9; prev = null; continue; }
      if (code === 257) { bitCnt = 0; i = buf.length; break; }

      let entry;
      if (code < dict.length && dict[code]) entry = dict[code];
      else if (prev) entry = prev.concat(prev[0]);
      else throw new Error('LZW 코드 오류');

      out.push(...entry);
      if (prev) dict.push(prev.concat(entry[0]));
      prev = entry;

      if (dict.length + early >= (1 << width) && width < 12) width++;
    }
  }
  return Buffer.from(out);
}

function asciiHexDecode(buf) {
  const s = buf.toString('latin1').replace(/[^0-9A-Fa-f>]/g, '');
  const hex = s.slice(0, s.indexOf('>') === -1 ? s.length : s.indexOf('>'));
  return Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
}

function ascii85Decode(buf) {
  let s = buf.toString('latin1').replace(/\s/g, '');
  if (s.startsWith('<~')) s = s.slice(2);
  const end = s.indexOf('~>');
  if (end !== -1) s = s.slice(0, end);
  const out = [];
  let tuple = [], i = 0;
  while (i < s.length) {
    const c = s[i++];
    if (c === 'z' && tuple.length === 0) { out.push(0, 0, 0, 0); continue; }
    tuple.push(c.charCodeAt(0) - 33);
    if (tuple.length === 5) {
      let n = 0;
      for (const t of tuple) n = n * 85 + t;
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      tuple = [];
    }
  }
  if (tuple.length) {
    const missing = 5 - tuple.length;
    for (let k = 0; k < missing; k++) tuple.push(84);
    let n = 0;
    for (const t of tuple) n = n * 85 + t;
    const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    out.push(...bytes.slice(0, 4 - missing));
  }
  return Buffer.from(out);
}

/** 필터 이름 순서대로 푼다. 모르는 필터(이미지 계열 등)를 만나면 null */
function decodeStream(raw, dict) {
  const filters = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/) || [])[1] || '';
  const names = filters.match(/\/(\w+)/g) || [];
  const early = Number((dict.match(/\/EarlyChange\s+(\d)/) || [])[1]);

  let data = raw;
  for (const n of names) {
    try {
      switch (n) {
        case '/FlateDecode': case '/Fl': data = inflate(data); break;
        case '/LZWDecode':   case '/LZW': data = lzwDecode(data, early); break;
        case '/ASCIIHexDecode': case '/AHx': data = asciiHexDecode(data); break;
        case '/ASCII85Decode':  case '/A85': data = ascii85Decode(data); break;
        default: return null;         // DCTDecode·JPXDecode·CCITTFaxDecode = 이미지다
      }
    } catch (_) {
      return null;                    // 깨진 스트림 하나가 문서 전체를 죽이지 않는다
    }
  }
  return data;
}

/* ── 객체 훑기 ─────────────────────────────────────────────── */

/**
 * `N G obj … endobj` 를 훑는다. xref 를 신뢰하지 않고 파일을 직접 훑는 이유:
 * 실무에서 오는 PDF 는 이어붙이기·부분 갱신으로 xref 가 어긋난 것이 흔하다.
 * 훑기는 그런 파일에서도 동작한다.
 */
function scanObjects(buf, latin1) {
  const s = latin1 || buf.toString('latin1');
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  const objs = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    const start = m.index + m[0].length;
    let end = s.indexOf('endobj', start);
    if (end === -1) end = s.length;

    let dict = s.slice(start, end);
    let stream = null;
    const sAt = s.indexOf('stream', start);
    if (sAt !== -1 && sAt < end) {
      dict = s.slice(start, sAt);
      // 'stream' 뒤의 EOL 은 데이터가 아니다 (CRLF 또는 LF)
      let dataAt = sAt + 6;
      if (s[dataAt] === '\r') dataAt++;
      if (s[dataAt] === '\n') dataAt++;

      const len = Number((dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/) || [])[1]);
      let dataEnd = Number.isFinite(len) && len > 0 ? dataAt + len : -1;
      // /Length 가 간접참조이거나 틀린 경우가 흔하다 — endstream 으로 다시 잡는다
      if (dataEnd === -1 || s.slice(dataEnd, dataEnd + 20).indexOf('endstream') === -1) {
        const es = s.indexOf('endstream', dataAt);
        dataEnd = es === -1 ? s.length : es;
      }
      stream = buf.subarray(dataAt, dataEnd);
      const after = s.indexOf('endobj', dataEnd);
      end = after === -1 ? s.length : after;
    }
    objs.push({ num: Number(m[1]), dict, stream });
    re.lastIndex = end;
  }
  return objs;
}

/* ── ToUnicode CMap ────────────────────────────────────────── */

function parseCMap(text) {
  const map = new Map();
  const hex = (h) => {
    // UTF-16BE — 서로게이트 쌍(이모지 등)도 그대로 살린다
    const b = Buffer.from(h.length % 2 ? h + '0' : h, 'hex');
    let out = '';
    for (let i = 0; i + 1 < b.length; i += 2) out += String.fromCharCode(b.readUInt16BE(i));
    return out;
  };

  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      map.set(parseInt(p[1], 16), hex(p[2]));
    }
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // <lo> <hi> <dst>  또는  <lo> <hi> [<d1> <d2> …]
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([\s\S]*?)\])/g;
    let r;
    while ((r = re.exec(blk[1])) !== null) {
      const lo = parseInt(r[1], 16), hi = parseInt(r[2], 16);
      if (hi < lo || hi - lo > 65535) continue;
      if (r[3] !== undefined) {
        const base = hex(r[3]);
        for (let c = lo; c <= hi; c++) {
          if (!base) break;
          const last = base.charCodeAt(base.length - 1) + (c - lo);
          map.set(c, base.slice(0, -1) + String.fromCharCode(last));
        }
      } else {
        const items = [...r[4].matchAll(/<([0-9A-Fa-f]*)>/g)];
        items.forEach((it, i) => map.set(lo + i, hex(it[1])));
      }
    }
  }
  return map;
}

/* ── 본문 연산자 ───────────────────────────────────────────── */

const ESC = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

/** 글자 폭 어림 (em 기준). 한글·한자·가나는 한 칸, 그 밖은 반 칸 */
function widthOf(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 0x1100 && c <= 0x11FF) || (c >= 0x2E80 && c <= 0xA4CF)
      || (c >= 0xAC00 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF)
      || (c >= 0xFF00 && c <= 0xFF60) ? 1 : 0.5;
}

/** `(...)` 안의 PDF 리터럴 문자열 → 바이트 배열 */
function literalBytes(src, i) {
  const out = [];
  let depth = 1;
  while (i < src.length) {
    const c = src[i++];
    if (c === '\\') {
      const e = src[i++];
      if (ESC[e] !== undefined) out.push(ESC[e].charCodeAt(0));
      else if (e >= '0' && e <= '7') {
        let oct = e;
        while (oct.length < 3 && src[i] >= '0' && src[i] <= '7') oct += src[i++];
        out.push(parseInt(oct, 8) & 255);
      } else if (e === '\n') { /* 줄 이어붙임 */ }
      else out.push(e.charCodeAt(0));
      continue;
    }
    if (c === '(') { depth++; out.push(40); continue; }
    if (c === ')') { depth--; if (!depth) break; out.push(41); continue; }
    out.push(c.charCodeAt(0) & 255);
  }
  return { bytes: out, next: i };
}

function hexBytes(hex) {
  const h = hex.replace(/\s/g, '');
  const out = [];
  for (let k = 0; k < h.length; k += 2) {
    const pair = h.slice(k, k + 2);
    out.push(parseInt(pair.length === 1 ? pair + '0' : pair, 16) & 255);
  }
  return out;
}

/**
 * 내용 스트림 → 텍스트.
 *
 * ★ 줄바꿈을 **위치로 판단한다.** PDF 에는 '줄'이 없고 글자마다 좌표를 다시 잡는
 *   경우가 흔하다 (크로미움 출력이 그렇다). `Td` 를 볼 때마다 줄을 바꾸면
 *   "인\n천\n남\n동" 처럼 글자마다 줄이 나뉘고, 그러면 한 줄에서 값을 찾는
 *   규칙 추출(02)이 「대지면적 12,345㎡」를 영영 못 만난다.
 *   그래서 **y 가 바뀔 때만** 줄을 바꾸고, x 만 벌어지면 공백을 넣는다.
 *
 * @param {string} content latin1 문자열
 * @param {Map<string, Map<number,string>>} cmaps 리소스 이름(/F1) → CMap
 * @returns {{text:string, unmapped:number, total:number}}
 */
function contentText(content, cmaps) {
  let out = '';
  let font = null;
  let unmapped = 0, total = 0;
  let y = null, x = null, lineH = 12;
  let runW = 0;            // 마지막 이동 뒤 찍은 글자 폭의 어림값

  const emit = (bytes, isHex) => {
    const cmap = font && cmaps.get(font);
    if (cmap) {
      // CID 는 2바이트가 기본이다 (Identity-H). 1바이트 CMap 도 있어 둘 다 본다
      const two = cmap.__twoByte !== false;
      for (let i = 0; i < bytes.length; i += (two ? 2 : 1)) {
        const code = two ? ((bytes[i] << 8) | (bytes[i + 1] || 0)) : bytes[i];
        total++;
        const ch = cmap.get(code);
        if (ch === undefined) { unmapped++; continue; }
        out += ch; runW += widthOf(ch) * lineH;
      }
      return;
    }
    // CMap 이 없다: 16진 문자열은 코드값이라 글자가 아니다 — 지어내지 않는다
    if (isHex) { total += Math.ceil(bytes.length / 2); unmapped += Math.ceil(bytes.length / 2); return; }
    for (const b of bytes) { total++; out += String.fromCharCode(b); runW += widthOf(String.fromCharCode(b)) * lineH; }
  };

  const newline = () => { if (!/\n$/.test(out)) out += '\n'; };
  const space = () => { if (out && !/[\s(]$/.test(out)) out += ' '; };

  /**
   * 새 좌표로 옮겼다 — 줄을 바꿀지 띄어쓸지 정한다.
   *
   * ★ 글자 폭을 모르면 **띄어쓰기를 지어내게 된다.** 폰트 메트릭이 없으므로
   *   찍은 글자 수로 폭을 어림한다 (한글·한자 1em, 그 밖 0.5em). 어림을 안 하면
   *   글자마다 좌표를 다시 잡는 PDF 에서 'LTC' 가 'L TC' 가 되고, 그 상태로
   *   alias 매칭을 하면 「대지면적」이 영영 안 잡힌다.
   */
  const moveTo = (nx, ny) => {
    if (y !== null && Math.abs(ny - y) > Math.max(1, lineH * 0.4)) newline();
    else if (x !== null && nx - (x + runW) > lineH * 0.22) space();
    x = nx; y = ny; runW = 0;
  };

  const stack = [];
  const n = (i) => { const v = stack[stack.length + i]; return typeof v === 'number' ? v : 0; };

  const re = /(<<|>>|\[|\]|\/[^\s/[\]<>(){}]*|\((?:\\.|[^\\()]|\((?:\\.|[^\\()])*\))*\)|<[0-9A-Fa-f\s]*>|-?\d*\.?\d+|[A-Za-z'"*][A-Za-z0-9'"*]*)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const tok = m[0];
    const c0 = tok[0];

    if (c0 === '(') {
      const { bytes } = literalBytes(content, m.index + 1);
      stack.push({ bytes, hex: false });
      continue;
    }
    if (c0 === '<' && tok !== '<<') { stack.push({ bytes: hexBytes(tok.slice(1, -1)), hex: true }); continue; }
    if (c0 === '/' || tok === '[' || tok === ']' || tok === '<<' || tok === '>>') { stack.push(tok); continue; }
    if (/^-?[\d.]+$/.test(tok)) { stack.push(Number(tok)); continue; }

    switch (tok) {
      case 'Tf': {
        const name = stack.slice(-2).find(v => typeof v === 'string' && v[0] === '/');
        if (name) font = name;
        const size = n(-1);
        if (size > 0) lineH = size;
        break;
      }
      case 'TL': lineH = n(-1) || lineH; break;
      case 'Td': case 'TD': moveTo((x || 0) + n(-2), (y === null ? 0 : y) + n(-1)); break;
      case 'Tm': moveTo(n(-2), n(-1)); break;
      case 'T*': newline(); break;
      // ★ BT/ET 로 줄을 나누지 않는다. 뷰어가 글자 몇 개마다 BT…ET 를 새로 여는
      //   경우가 흔해서(크로미움 출력이 그렇다) 그때마다 줄을 바꾸면 다시
      //   글자마다 줄이 나뉜다. 줄은 오직 y 좌표가 바뀔 때만 바꾼다
      case 'BT': break;
      case 'ET': break;
      case 'Tj': case "'": case '"': {
        const s = stack[stack.length - 1];
        if (s && s.bytes) { if (tok !== 'Tj') newline(); emit(s.bytes, s.hex); }
        break;
      }
      case 'TJ': {
        // [ (a) -250 (b) ] TJ — 큰 음수는 낱말 사이 간격이다
        let i = stack.length - 1;
        const items = [];
        while (i >= 0 && stack[i] !== '[') { items.unshift(stack[i]); i--; }
        for (const it of items) {
          if (it && it.bytes) emit(it.bytes, it.hex);
          else if (typeof it === 'number' && it <= -180) space();
        }
        break;
      }
      default: break;
    }
    stack.length = 0;
  }
  return { text: out, unmapped, total };
}

/* ── 바깥으로 나가는 함수 ──────────────────────────────────── */

/**
 * PDF → 텍스트.
 *
 * @param {Buffer} buf
 * @returns {{text:string, reliable:boolean, reason:string|null, pages:number}}
 *   reliable=false 면 **그 텍스트를 쓰면 안 된다.** 호출 쪽에서 OCR 로 넘긴다.
 */
function pdfText(buf) {
  const head = buf.subarray(0, 1024).toString('latin1');
  if (!head.includes('%PDF-')) return { text: '', reliable: false, reason: 'PDF 서명(%PDF-)이 없다', pages: 0 };

  // ★ latin1 문자열은 파일 크기만큼 메모리를 쓴다. 20MB 짜리 PDF 를 네 번
  //   변환하면 80MB 다 — 한 번만 만들어 돌려 쓴다
  const all = buf.toString('latin1');
  const objs = scanObjects(buf, all);
  const pages = (all.match(/\/Type\s*\/Page\b/g) || []).length;

  if (/\/Encrypt\b/.test(all)) {
    return { text: '', reliable: false, reason: '암호가 걸린 PDF — 본문을 열 수 없다', pages };
  }

  // 스트림은 두 번 본다 (CMap 찾기 · 본문 읽기). 푸는 것은 한 번만 한다
  const decoded = new Map();
  const dataOf = (o) => {
    if (!decoded.has(o.num)) decoded.set(o.num, decodeStream(o.stream, o.dict));
    return decoded.get(o.num);
  };

  // ① ToUnicode CMap 을 객체번호별로 모은다
  const cmapByObj = new Map();
  for (const o of objs) {
    if (!o.stream) continue;
    const data = dataOf(o);
    if (!data) continue;
    const t = data.toString('latin1');
    if (t.includes('beginbfchar') || t.includes('beginbfrange')) {
      const map = parseCMap(t);
      // 코드 폭: <00> 처럼 2자리면 1바이트 CMap 이다
      const oneByte = /begincodespacerange\s*<([0-9A-Fa-f]{2})>\s*<([0-9A-Fa-f]{2})>/.test(t);
      if (oneByte) map.__twoByte = false;
      if (map.size) cmapByObj.set(o.num, map);
    }
  }

  // ② 폰트 리소스 이름(/F1) → ToUnicode CMap.
  //    ★ 이름은 문서 안에서 재사용된다(/F1 이 페이지마다 다른 폰트일 수 있다).
  //      섞이면 글자가 조용히 바뀌므로, 한 이름이 서로 다른 CMap 을 가리키면
  //      그 이름은 아예 안 쓴다 (매핑 없음 → 신뢰 불가로 떨어진다)
  const nameToCmap = new Map();
  const conflict = new Set();
  const toUnicodeOf = new Map();          // 폰트 객체번호 → CMap 객체번호
  for (const o of objs) {
    const m = o.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (m) toUnicodeOf.set(o.num, Number(m[1]));
  }
  for (const fd of all.matchAll(/\/Font\s*<<([\s\S]{0,4000}?)>>/g)) {
    for (const p of fd[1].matchAll(/\/([^\s/[\]<>]+)\s+(\d+)\s+\d+\s+R/g)) {
      const name = '/' + p[1];
      const cmapNum = toUnicodeOf.get(Number(p[2]));
      if (cmapNum === undefined) continue;
      const map = cmapByObj.get(cmapNum);
      if (!map) continue;
      if (nameToCmap.has(name) && nameToCmap.get(name) !== map) conflict.add(name);
      else nameToCmap.set(name, map);
    }
  }
  conflict.forEach(n => nameToCmap.delete(n));

  // ③ 내용 스트림에서 글자를 꺼낸다
  let text = '', unmapped = 0, total = 0;
  for (const o of objs) {
    if (!o.stream) continue;
    if (/\/Type\s*\/(XObject|Font|Metadata|ObjStm|XRef)\b/.test(o.dict)
        && !/\/Subtype\s*\/Form\b/.test(o.dict)) continue;
    const data = dataOf(o);
    if (!data) continue;
    const s = data.toString('latin1');
    if (!/\b(Tj|TJ)\b/.test(s)) continue;
    const r = contentText(s, nameToCmap);
    text += r.text + '\n';
    unmapped += r.unmapped; total += r.total;
  }

  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  // ④ 믿을 수 있는가
  if (total && unmapped / total > 0.15) {
    return {
      text: '', reliable: false, pages,
      reason: `글자의 ${Math.round((unmapped / total) * 100)}% 가 ToUnicode 없이 코드값으로만 있다 `
        + '— 그대로 뽑으면 깨진 글자가 수치처럼 들어간다',
    };
  }
  if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
    return { text: '', reliable: false, pages, reason: '텍스트 레이어가 없다 — 스캔 이미지로 만든 PDF 다' };
  }
  return { text, reliable: true, reason: null, pages };
}

module.exports = {
  pdfText, scanObjects, decodeStream, parseCMap, contentText, lzwDecode, ascii85Decode,
  MIN_TEXT_CHARS,
};
