'use strict';
/**
 * ole.js — 옛 바이너리 문서(.hwp .doc .xls .ppt)에서 본문 텍스트를 꺼낸다.
 *          의존성 없음. 내장 zlib 만 쓴다.
 *
 * 넷 다 겉은 다르지만 **속은 같은 그릇**이다 — CFBF(=OLE2 복합 문서).
 * 그릇 안에 이름 붙은 스트림이 들어 있고, 형식마다 읽어야 할 스트림이 다르다.
 *
 *   .hwp → BodyText/Section0…      (레코드 + UTF-16LE, 보통 raw deflate 압축)
 *   .doc → WordDocument + 0Table   (조각표(piece table)를 따라가야 글자 순서가 맞다)
 *   .xls → Workbook                (BIFF8 레코드 — 숫자가 여기 있다)
 *   .ppt → PowerPoint Document     (TextBytes/TextChars 원자)
 *
 * ★ **틀린 글자를 내놓느니 못 읽었다고 한다.** 이 파일들은 규격 밖의 변종이 많다.
 *   깨진 글자를 그대로 넘기면 「연면적 45,678」이 「연면적 4」로 들어오고,
 *   그 값은 출처까지 달고 보고서에 실린다. 그래서 뽑아낸 뒤 **읽을 수 있는 글자
 *   비율**을 보고, 낮으면 실패로 처리해 OCR 로 넘긴다.
 *
 * ★ 이 구현은 실제 파일로 검증하지 못했다 (등록부 D-25). 합성 파일로만 시험했다.
 *   실무 파일에서 처음 깨지는 곳이 어디인지는 아직 모른다.
 */

const zlib = require('zlib');

const SIG = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const FREE = 0xFFFFFFFF, END = 0xFFFFFFFE;

/* ── CFBF 그릇 ─────────────────────────────────────────────── */

/**
 * 복합 문서를 열어 스트림 이름 → Buffer 로 돌려준다.
 * @returns {Map<string, Buffer>}
 */
function readOle(buf) {
  if (buf.length < 512 || !buf.subarray(0, 8).equals(SIG)) throw new Error('CFBF 서명이 아니다');

  const sectorShift = buf.readUInt16LE(0x1E);
  const miniShift = buf.readUInt16LE(0x20);
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const dirStart = buf.readUInt32LE(0x30);
  const miniCutoff = buf.readUInt32LE(0x38);
  const miniFatStart = buf.readUInt32LE(0x3C);
  const difatStart = buf.readUInt32LE(0x44);
  const difatCount = buf.readUInt32LE(0x48);

  const offsetOf = (sec) => (sec + 1) * sectorSize;
  const sectorAt = (sec) => {
    const off = offsetOf(sec);
    if (off < 0 || off + sectorSize > buf.length) throw new Error(`섹터 ${sec} 가 파일 밖이다`);
    return buf.subarray(off, off + sectorSize);
  };

  // DIFAT → FAT 섹터 목록
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const v = buf.readUInt32LE(0x4C + i * 4);
    if (v === FREE || v === END) break;
    fatSectors.push(v);
  }
  let next = difatStart;
  const perSector = sectorSize / 4 - 1;
  for (let n = 0; n < difatCount && next !== END && next !== FREE; n++) {
    const s = sectorAt(next);
    for (let i = 0; i < perSector; i++) {
      const v = s.readUInt32LE(i * 4);
      if (v === FREE || v === END) break;
      fatSectors.push(v);
    }
    next = s.readUInt32LE(perSector * 4);
  }

  // FAT
  const fat = [];
  for (const fs of fatSectors) {
    const s = sectorAt(fs);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(s.readUInt32LE(i * 4));
  }

  const chain = (start, table) => {
    const out = [];
    let cur = start, guard = 0;
    while (cur !== END && cur !== FREE && cur < table.length) {
      out.push(cur);
      cur = table[cur];
      if (++guard > 1000000) throw new Error('FAT 순환');
    }
    return out;
  };

  const readChain = (start, size) => {
    const parts = chain(start, fat).map(sectorAt);
    const all = Buffer.concat(parts);
    return size ? all.subarray(0, size) : all;
  };

  // 디렉터리
  const dirBuf = readChain(dirStart, 0);
  const entries = [];
  for (let off = 0; off + 128 <= dirBuf.length; off += 128) {
    const nameLen = dirBuf.readUInt16LE(off + 0x40);
    if (nameLen < 2 || nameLen > 64) continue;
    const name = dirBuf.subarray(off, off + nameLen - 2).toString('utf16le');
    entries.push({
      name,
      type: dirBuf.readUInt8(off + 0x42),
      start: dirBuf.readUInt32LE(off + 0x74),
      size: Number(dirBuf.readBigUInt64LE(off + 0x78) & 0xFFFFFFFFn),
    });
  }

  const root = entries.find(e => e.type === 5);
  const miniStream = root && root.size ? readChain(root.start, root.size) : Buffer.alloc(0);

  // miniFAT
  const miniFat = [];
  if (miniFatStart !== END && miniFatStart !== FREE) {
    const mb = readChain(miniFatStart, 0);
    for (let i = 0; i + 4 <= mb.length; i += 4) miniFat.push(mb.readUInt32LE(i));
  }
  const readMini = (start, size) => {
    const parts = chain(start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize));
    return Buffer.concat(parts).subarray(0, size);
  };

  const out = new Map();
  for (const e of entries) {
    if (e.type !== 2 || !e.size) continue;              // 2 = 스트림
    try {
      out.set(e.name, e.size < miniCutoff ? readMini(e.start, e.size) : readChain(e.start, e.size));
    } catch (_) { /* 스트림 하나가 깨져도 나머지는 읽는다 */ }
  }
  return out;
}

/* ── 읽을 수 있는 글자인가 ─────────────────────────────────── */

/**
 * 뽑아낸 글자가 문서인지 쓰레기인지 본다.
 * 한글·영문·숫자·공백·흔한 문장부호의 비율이 낮으면 파싱이 어긋난 것이다.
 */
function readableRatio(s) {
  if (!s.length) return 0;
  let ok = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || c === 32) { ok++; continue; }
    if (c >= 0x20 && c <= 0x7E) { ok++; continue; }               // ASCII
    if (c >= 0xAC00 && c <= 0xD7A3) { ok++; continue; }           // 한글 음절
    if (c >= 0x3130 && c <= 0x318F) { ok++; continue; }           // 자모
    if (c >= 0x4E00 && c <= 0x9FFF) { ok++; continue; }           // 한자
    if (c >= 0x2000 && c <= 0x206F) { ok++; continue; }           // 문장부호
    if (c === 0x20A9 || c === 0xFFE6 || c === 0x00B7 || c === 0x33A1) { ok++; continue; } // ₩ ￦ · ㎡
  }
  return ok / s.length;
}

const MIN_READABLE = 0.75;

function guard(text, what) {
  const t = String(text).replace(/\0/g, '').trim();
  if (t.replace(/\s/g, '').length < 10) throw new Error(`${what}: 글자를 찾지 못했다`);
  const r = readableRatio(t);
  if (r < MIN_READABLE) {
    throw new Error(`${what}: 읽어낸 글자의 ${Math.round((1 - r) * 100)}% 가 깨져 있다 — 규격 밖 변종이다`);
  }
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

/* ── .hwp (한글 5.0) ───────────────────────────────────────── */

const HWPTAG_PARA_TEXT = 0x10 + 51;

/** 1글자(1 wchar)로 끝나는 제어문자 */
const HWP_CHAR_CTRL = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
/** 앞뒤로 8 wchar 를 차지하는 제어문자 (표·그림·각주 등) */
const HWP_EXT_CTRL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

function hwpText(buf) {
  const streams = readOle(buf);
  const head = streams.get('FileHeader');
  if (!head) throw new Error('FileHeader 없음 — hwp 가 아니다');
  if (head.subarray(0, 17).toString('latin1') !== 'HWP Document File') {
    throw new Error('HWP 서명이 아니다');
  }
  // 속성 플래그: bit0 압축, bit1 암호
  const flags = head.length >= 40 ? head.readUInt32LE(36) : 0;
  if (flags & 0x2) throw new Error('암호가 걸린 hwp — 본문을 열 수 없다');
  const compressed = !!(flags & 0x1);

  const names = [...streams.keys()].filter(n => /^Section\d+$/i.test(n));
  if (!names.length) throw new Error('BodyText 섹션이 없다');
  names.sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));

  const out = [];
  for (const n of names) {
    let data = streams.get(n);
    if (compressed) {
      try { data = zlib.inflateRawSync(data); }
      catch (_) { try { data = zlib.inflateSync(data); } catch (e2) { continue; } }
    }
    out.push(hwpRecords(data));
  }
  return guard(out.join('\n'), 'hwp');
}

function hwpRecords(data) {
  let out = '';
  let p = 0;
  while (p + 4 <= data.length) {
    const header = data.readUInt32LE(p); p += 4;
    const tag = header & 0x3FF;
    let size = (header >> 20) & 0xFFF;
    if (size === 0xFFF) { if (p + 4 > data.length) break; size = data.readUInt32LE(p); p += 4; }
    if (p + size > data.length) break;
    if (tag === HWPTAG_PARA_TEXT) out += hwpParagraph(data.subarray(p, p + size)) + '\n';
    p += size;
  }
  return out;
}

function hwpParagraph(buf) {
  let s = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const c = buf.readUInt16LE(i);
    if (c >= 32) { s += String.fromCharCode(c); continue; }
    if (HWP_EXT_CTRL.has(c)) { i += 14; continue; }   // 자기 자신 포함 8 wchar
    if (HWP_CHAR_CTRL.has(c)) { if (c === 13 || c === 10) s += '\n'; continue; }
  }
  return s;
}

/* ── .doc (Word 97-2003) ───────────────────────────────────── */

function docText(buf) {
  const streams = readOle(buf);
  const wd = streams.get('WordDocument');
  if (!wd) throw new Error('WordDocument 없음 — doc 가 아니다');
  if (wd.readUInt16LE(0) !== 0xA5EC) throw new Error('Word 97 형식이 아니다 (더 옛 버전일 수 있다)');

  const flags = wd.readUInt16LE(0x0A);
  if (flags & 0x0100) throw new Error('암호가 걸린 doc — 본문을 열 수 없다');
  const table = streams.get((flags & 0x0200) ? '1Table' : '0Table');
  if (!table) throw new Error('Table 스트림 없음');

  const fcClx = wd.readUInt32LE(0x01A2);
  const lcbClx = wd.readUInt32LE(0x01A6);
  if (!lcbClx || fcClx + lcbClx > table.length) throw new Error('조각표(CLX)를 찾지 못했다');
  const clx = table.subarray(fcClx, fcClx + lcbClx);

  // CLX = [Prc…] Pcdt.  0x01 = Prc(건너뛴다), 0x02 = 조각표
  let p = 0;
  while (p < clx.length && clx[p] === 0x01) {
    const cb = clx.readUInt16LE(p + 1);
    p += 3 + cb;
  }
  if (clx[p] !== 0x02) throw new Error('조각표(Pcdt)가 없다');
  const lcbPlc = clx.readUInt32LE(p + 1);
  const plc = clx.subarray(p + 5, p + 5 + lcbPlc);

  const nPieces = Math.floor((plc.length - 4) / 12);
  if (nPieces <= 0) throw new Error('조각이 없다');

  let text = '';
  for (let i = 0; i < nPieces; i++) {
    const cpStart = plc.readUInt32LE(i * 4);
    const cpEnd = plc.readUInt32LE((i + 1) * 4);
    const pcd = plc.subarray((nPieces + 1) * 4 + i * 8);
    const fc = pcd.readUInt32LE(2);
    const compressed = !!(fc & 0x40000000);
    const off = compressed ? (fc & 0x3FFFFFFF) / 2 : (fc & 0x3FFFFFFF);
    const chars = cpEnd - cpStart;
    if (chars <= 0) continue;
    const bytes = compressed ? chars : chars * 2;
    if (off + bytes > wd.length) continue;
    const raw = wd.subarray(off, off + bytes);
    text += compressed ? cp1252(raw) : raw.toString('utf16le');
  }

  // Word 는 문단 끝을 \r 로 쓴다. 셀 구분자(\x07)는 탭으로 살린다
  text = text.replace(/\r/g, '\n').replace(/\x07/g, '\t')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return guard(text, 'doc');
}

/** cp1252 (Windows Latin-1) — 옛 doc 의 '압축' 표현이다 */
const CP1252_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function cp1252(buf) {
  let s = '';
  for (const b of buf) s += b >= 0x80 && b <= 0x9F ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  return s;
}

/* ── .xls (BIFF8) ──────────────────────────────────────────── */

const XLS = { SST: 0x00FC, CONTINUE: 0x003C, LABELSST: 0x00FD, LABEL: 0x0204, NUMBER: 0x0203, RK: 0x027E, MULRK: 0x00BD, FORMULA: 0x0006, STRING: 0x0207, BOF: 0x0809, EOF: 0x000A, BOUNDSHEET: 0x0085 };

function xlsText(buf) {
  const streams = readOle(buf);
  const wb = streams.get('Workbook') || streams.get('Book');
  if (!wb) throw new Error('Workbook 없음 — xls 가 아니다');

  // ① 레코드로 자른다 (CONTINUE 는 앞 레코드에 이어 붙인다)
  const recs = [];
  let p = 0;
  while (p + 4 <= wb.length) {
    const type = wb.readUInt16LE(p);
    const len = wb.readUInt16LE(p + 2);
    if (p + 4 + len > wb.length) break;
    const data = wb.subarray(p + 4, p + 4 + len);
    if (type === XLS.CONTINUE && recs.length) recs[recs.length - 1].cont.push(data);
    else recs.push({ type, data, cont: [] });
    p += 4 + len;
  }

  // ② 공유 문자열(SST)
  const sst = [];
  const sstRec = recs.find(r => r.type === XLS.SST);
  if (sstRec) readSst(sstRec, sst);

  // ③ 셀
  const rows = new Map();
  const put = (row, col, val) => {
    if (val === '' || val === null || val === undefined) return;
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row).set(col, String(val));
  };

  for (const r of recs) {
    const d = r.data;
    switch (r.type) {
      case XLS.LABELSST:
        if (d.length >= 10) put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
        break;
      case XLS.LABEL:
        if (d.length >= 8) put(d.readUInt16LE(0), d.readUInt16LE(2), readXlUnicode(d, 6).text);
        break;
      case XLS.NUMBER:
        if (d.length >= 14) put(d.readUInt16LE(0), d.readUInt16LE(2), fmtNum(d.readDoubleLE(6)));
        break;
      case XLS.RK:
        if (d.length >= 10) put(d.readUInt16LE(0), d.readUInt16LE(2), fmtNum(rkValue(d.readUInt32LE(6))));
        break;
      case XLS.MULRK: {
        if (d.length < 6) break;
        const row = d.readUInt16LE(0); const first = d.readUInt16LE(2);
        const n = Math.floor((d.length - 6) / 6);
        for (let i = 0; i < n; i++) put(row, first + i, fmtNum(rkValue(d.readUInt32LE(4 + i * 6 + 2))));
        break;
      }
      case XLS.FORMULA:
        // 계산 결과가 숫자면 그 값을 쓴다 (문자열 결과는 뒤따르는 STRING 레코드다)
        if (d.length >= 14 && d.readUInt16LE(12) !== 0xFFFF) put(d.readUInt16LE(0), d.readUInt16LE(2), fmtNum(d.readDoubleLE(6)));
        break;
      default: break;
    }
  }

  const lines = [...rows.keys()].sort((a, b) => a - b).map((rowNo) => {
    const cells = rows.get(rowNo);
    const max = Math.max(...cells.keys());
    const arr = [];
    for (let c = 0; c <= max; c++) arr.push(cells.get(c) ?? '');
    return arr.join('\t').replace(/\t+$/, '');
  });
  return guard(lines.join('\n'), 'xls');
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
}

function rkValue(v) {
  const cents = v & 1, isInt = v & 2;
  let n;
  if (isInt) n = (v | 0) >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((v & 0xFFFFFFFC) >>> 0, 4);
    n = b.readDoubleLE(0);
  }
  return cents ? n / 100 : n;
}

/** BIFF8 유니코드 문자열 — 앞 2바이트가 글자 수, 다음 1바이트가 플래그 */
function readXlUnicode(buf, off) {
  if (off + 3 > buf.length) return { text: '', next: buf.length };
  const cch = buf.readUInt16LE(off);
  const flags = buf.readUInt8(off + 2);
  let p = off + 3;
  if (flags & 0x08) p += 2;                                  // rich text 서식 개수
  if (flags & 0x04) p += 4;                                  // 극동 확장 길이
  const wide = !!(flags & 0x01);
  const bytes = wide ? cch * 2 : cch;
  const raw = buf.subarray(p, p + bytes);
  const text = wide ? raw.toString('utf16le') : cp1252(raw);
  return { text, next: p + bytes };
}

/**
 * SST 를 읽는다.
 * ★ 문자열이 CONTINUE 경계에서 잘리면 **이어지는 조각의 첫 바이트가 플래그로 다시
 *   나온다** (와이드/좁은 표현이 바뀔 수 있다). 이걸 모르면 그 뒤 문자열이 전부
 *   한 칸씩 밀려 깨진다 — xls 파싱에서 가장 흔한 사고다.
 */
function readSst(rec, out) {
  const parts = [rec.data, ...rec.cont];
  let pi = 0, p = 8;                       // 0..7 = 총 개수 / 고유 개수
  const total = rec.data.length >= 8 ? rec.data.readUInt32LE(4) : 0;

  const cur = () => parts[pi];
  const need = (n) => { while (pi < parts.length && p + n > cur().length) { pi++; p = 0; } return pi < parts.length; };

  for (let i = 0; i < total; i++) {
    if (!need(3)) break;
    const cch = cur().readUInt16LE(p);
    let flags = cur().readUInt8(p + 2);
    p += 3;
    if (flags & 0x08) { if (!need(2)) break; p += 2; }
    if (flags & 0x04) { if (!need(4)) break; p += 4; }

    let text = '';
    let left = cch;
    while (left > 0) {
      if (!need(1)) break;
      const wide = !!(flags & 0x01);
      const avail = cur().length - p;
      const take = Math.min(left, wide ? Math.floor(avail / 2) : avail);
      if (take <= 0) {
        pi++; p = 0;
        if (pi >= parts.length) break;
        flags = cur().readUInt8(p); p += 1;      // 조각이 바뀌면 플래그가 다시 나온다
        continue;
      }
      const raw = cur().subarray(p, p + (wide ? take * 2 : take));
      text += wide ? raw.toString('utf16le') : cp1252(raw);
      p += wide ? take * 2 : take;
      left -= take;
      if (left > 0) {
        pi++; p = 0;
        if (pi >= parts.length) break;
        flags = cur().readUInt8(p); p += 1;
      }
    }
    out.push(text);
  }
}

/* ── .ppt (PowerPoint 97-2003) ─────────────────────────────── */

const PPT_TEXT_CHARS = 0x0FA0, PPT_TEXT_BYTES = 0x0FA8;

function pptText(buf) {
  const streams = readOle(buf);
  const doc = streams.get('PowerPoint Document');
  if (!doc) throw new Error('PowerPoint Document 없음 — ppt 가 아니다');

  const out = [];
  const walk = (b, depth) => {
    let p = 0;
    while (p + 8 <= b.length) {
      const verInst = b.readUInt16LE(p);
      const type = b.readUInt16LE(p + 2);
      const len = b.readUInt32LE(p + 4);
      const body = b.subarray(p + 8, p + 8 + len);
      if (p + 8 + len > b.length) break;

      if (type === PPT_TEXT_CHARS) out.push(body.toString('utf16le'));
      else if (type === PPT_TEXT_BYTES) out.push(cp1252(body));
      else if ((verInst & 0x0F) === 0x0F && depth < 12) walk(body, depth + 1);  // 컨테이너

      p += 8 + len;
    }
  };
  walk(doc, 0);

  const text = out.join('\n').replace(/\r/g, '\n').replace(/\x0B/g, '\n');
  return guard(text, 'ppt');
}

/* ── 갈래 ──────────────────────────────────────────────────── */

const BY_EXT = { '.hwp': hwpText, '.doc': docText, '.xls': xlsText, '.ppt': pptText };

/** 확장자에 맞는 파서로 읽는다. 못 읽으면 던진다 (부르는 쪽이 OCR 로 넘긴다) */
function oleText(ext, buf) {
  const fn = BY_EXT[String(ext).toLowerCase()];
  if (!fn) throw new Error(`${ext} 는 이 파서가 다루지 않는다`);
  return fn(buf);
}

module.exports = {
  readOle, oleText, hwpText, docText, xlsText, pptText,
  readableRatio, cp1252, rkValue, readXlUnicode, BY_EXT, MIN_READABLE,
};
