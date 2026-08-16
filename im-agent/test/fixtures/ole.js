'use strict';
/**
 * 시험용 CFBF(복합 문서) 만들기.
 *
 * ★ 왜 만들어 쓰는가: .hwp/.doc/.xls/.ppt 실제 파일을 저장소에 넣을 수 없다.
 *   **이 저장소는 public 이고**, 실무 파일에는 딜 정보가 들어 있다.
 *   그래서 규격대로 그릇을 직접 만들어 파서를 시험한다.
 *
 * ★ 이것으로 증명되는 것과 안 되는 것을 섞지 말 것.
 *   증명되는 것: 그릇(FAT·miniFAT·디렉터리) 읽기와 각 형식의 레코드 해석.
 *   증명 안 되는 것: 실무 파일의 변종. 한글·오피스 버전마다 규격 밖 구현이 있다.
 *   (등록부 D-25)
 */

const SECTOR = 512;
const MINI = 64;
const MINI_CUTOFF = 4096;
const FREE = 0xFFFFFFFF, END = 0xFFFFFFFE, FATSEC = 0xFFFFFFFD;

function pad(buf, size) {
  if (buf.length % size === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(size - (buf.length % size))]);
}

/**
 * @param {Array<{name:string, data:Buffer}>} streams
 * @returns {Buffer} CFBF 파일
 */
function buildOle(streams) {
  const big = streams.filter(s => s.data.length >= MINI_CUTOFF);
  const small = streams.filter(s => s.data.length < MINI_CUTOFF);

  // ① 미니 스트림 (작은 스트림들을 64바이트 칸에 이어 붙인다)
  const miniParts = [];
  const miniStart = new Map();
  let miniSec = 0;
  for (const s of small) {
    miniStart.set(s.name, miniSec);
    const p = pad(s.data, MINI);
    miniParts.push(p);
    miniSec += p.length / MINI;
  }
  const miniStream = Buffer.concat(miniParts);

  // ② 섹터 배치: 큰 스트림 → 미니스트림 → miniFAT → 디렉터리 → FAT
  const chunks = [];      // 섹터에 실제로 들어갈 데이터
  const alloc = (buf) => {
    const start = chunks.length;
    const p = pad(buf, SECTOR);
    for (let i = 0; i < p.length / SECTOR; i++) chunks.push(p.subarray(i * SECTOR, (i + 1) * SECTOR));
    return { start, count: p.length / SECTOR };
  };

  const bigAt = new Map();
  for (const s of big) bigAt.set(s.name, alloc(s.data));
  const miniAt = miniStream.length ? alloc(miniStream) : { start: END, count: 0 };

  // miniFAT: 미니 섹터 체인
  const miniFat = [];
  for (const s of small) {
    const n = pad(s.data, MINI).length / MINI;
    const st = miniStart.get(s.name);
    for (let i = 0; i < n; i++) miniFat.push(i === n - 1 ? END : st + i + 1);
  }
  const miniFatBuf = Buffer.alloc(Math.max(1, Math.ceil(miniFat.length / 128)) * SECTOR, 0xFF);
  miniFat.forEach((v, i) => miniFatBuf.writeUInt32LE(v >>> 0, i * 4));
  const miniFatAt = miniFat.length ? alloc(miniFatBuf) : { start: END, count: 0 };

  // 디렉터리
  const entries = [{ name: 'Root Entry', type: 5, start: miniAt.start, size: miniStream.length }];
  for (const s of streams) {
    entries.push({
      name: s.name, type: 2, size: s.data.length,
      start: s.data.length >= MINI_CUTOFF ? bigAt.get(s.name).start : miniStart.get(s.name),
    });
  }
  const dirBuf = Buffer.alloc(Math.ceil(entries.length / 4) * SECTOR);
  entries.forEach((e, i) => {
    const off = i * 128;
    const nm = Buffer.from(e.name + '\0', 'utf16le');
    nm.copy(dirBuf, off);
    dirBuf.writeUInt16LE(nm.length, off + 0x40);
    dirBuf.writeUInt8(e.type, off + 0x42);
    dirBuf.writeUInt8(1, off + 0x43);                       // black
    dirBuf.writeUInt32LE(FREE, off + 0x44);                 // left
    dirBuf.writeUInt32LE(FREE, off + 0x48);                 // right
    dirBuf.writeUInt32LE(i === 0 && entries.length > 1 ? 1 : FREE, off + 0x4C);
    dirBuf.writeUInt32LE(e.start >>> 0, off + 0x74);
    dirBuf.writeBigUInt64LE(BigInt(e.size), off + 0x78);
  });
  const dirAt = alloc(dirBuf);

  // ③ FAT — FAT 자신이 차지하는 섹터까지 세어야 하므로 수렴시킨다
  let fatSectors = 1;
  let total;
  for (;;) {
    total = chunks.length + fatSectors;
    const need = Math.ceil(total / (SECTOR / 4));
    if (need === fatSectors) break;
    fatSectors = need;
  }

  const fat = new Array(fatSectors * (SECTOR / 4)).fill(FREE);
  const chain = (start, count) => {
    for (let i = 0; i < count; i++) fat[start + i] = i === count - 1 ? END : start + i + 1;
  };
  for (const s of big) { const a = bigAt.get(s.name); chain(a.start, a.count); }
  if (miniAt.count) chain(miniAt.start, miniAt.count);
  if (miniFatAt.count) chain(miniFatAt.start, miniFatAt.count);
  chain(dirAt.start, dirAt.count);
  for (let i = 0; i < fatSectors; i++) fat[chunks.length + i] = FATSEC;

  const fatBuf = Buffer.alloc(fatSectors * SECTOR);
  fat.forEach((v, i) => fatBuf.writeUInt32LE(v >>> 0, i * 4));

  // ④ 헤더
  const header = Buffer.alloc(SECTOR, 0);
  Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(header, 0);
  header.writeUInt16LE(0x003E, 0x18);              // minor
  header.writeUInt16LE(0x0003, 0x1A);              // major (v3)
  header.writeUInt16LE(0xFFFE, 0x1C);              // little endian
  header.writeUInt16LE(9, 0x1E);                   // 512
  header.writeUInt16LE(6, 0x20);                   // 64
  header.writeUInt32LE(dirAt.count, 0x28);
  header.writeUInt32LE(fatSectors, 0x2C);
  header.writeUInt32LE(dirAt.start, 0x30);
  header.writeUInt32LE(MINI_CUTOFF, 0x38);
  header.writeUInt32LE(miniFatAt.count ? miniFatAt.start : END, 0x3C);
  header.writeUInt32LE(miniFatAt.count, 0x40);
  header.writeUInt32LE(END, 0x44);                 // DIFAT 없음 (109개로 충분)
  header.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) {
    header.writeUInt32LE(i < fatSectors ? chunks.length + i : FREE, 0x4C + i * 4);
  }

  return Buffer.concat([header, ...chunks, fatBuf]);
}

/* ── 형식별 최소 파일 ─────────────────────────────────────── */

/** hwp 본문 레코드 하나 (HWPTAG_PARA_TEXT) */
function hwpParaRecord(text) {
  const body = Buffer.from(text, 'utf16le');
  const header = Buffer.alloc(4);
  const tag = 0x10 + 51, level = 0, size = body.length;
  header.writeUInt32LE((tag & 0x3FF) | ((level & 0x3FF) << 10) | ((size & 0xFFF) << 20));
  return Buffer.concat([header, body]);
}

/**
 * @param {string[]} paragraphs
 * @param {{compressed?:boolean}} [opt]
 */
function buildHwp(paragraphs, opt) {
  const zlib = require('zlib');
  const compressed = !opt || opt.compressed !== false;
  const head = Buffer.alloc(256);
  Buffer.from('HWP Document File').copy(head, 0);
  head.writeUInt32LE(compressed ? 1 : 0, 36);
  const body = Buffer.concat(paragraphs.map(hwpParaRecord));
  return buildOle([
    { name: 'FileHeader', data: head },
    { name: 'Section0', data: compressed ? zlib.deflateRawSync(body) : body },
  ]);
}

/** ppt TextBytesAtom / TextCharsAtom 만 담은 최소 파일 */
function buildPpt(texts) {
  const recs = texts.map((t) => {
    const wide = /[^\x00-\x7F]/.test(t);
    const body = wide ? Buffer.from(t, 'utf16le') : Buffer.from(t, 'latin1');
    const h = Buffer.alloc(8);
    h.writeUInt16LE(0, 0);
    h.writeUInt16LE(wide ? 0x0FA0 : 0x0FA8, 2);
    h.writeUInt32LE(body.length, 4);
    return Buffer.concat([h, body]);
  });
  const inner = Buffer.concat(recs);
  const cont = Buffer.alloc(8);
  cont.writeUInt16LE(0x000F, 0);                 // 컨테이너 표시
  cont.writeUInt16LE(0x03E8, 2);
  cont.writeUInt32LE(inner.length, 4);
  return buildOle([{ name: 'PowerPoint Document', data: Buffer.concat([cont, inner]) }]);
}

/** xls: SST + LABELSST + NUMBER 만 담은 최소 Workbook */
function buildXls(rows) {
  const rec = (type, data) => {
    const h = Buffer.alloc(4);
    h.writeUInt16LE(type, 0); h.writeUInt16LE(data.length, 2);
    return Buffer.concat([h, data]);
  };
  const strings = [];
  const cells = [];
  rows.forEach((cols, r) => cols.forEach((v, c) => {
    if (typeof v === 'number') {
      const d = Buffer.alloc(14);
      d.writeUInt16LE(r, 0); d.writeUInt16LE(c, 2); d.writeUInt16LE(0, 4);
      d.writeDoubleLE(v, 6);
      cells.push(rec(0x0203, d));
    } else if (v !== null && v !== '') {
      const idx = strings.push(String(v)) - 1;
      const d = Buffer.alloc(10);
      d.writeUInt16LE(r, 0); d.writeUInt16LE(c, 2); d.writeUInt16LE(0, 4);
      d.writeUInt32LE(idx, 6);
      cells.push(rec(0x00FD, d));
    }
  }));

  const parts = [Buffer.alloc(8)];
  parts[0].writeUInt32LE(strings.length, 0);
  parts[0].writeUInt32LE(strings.length, 4);
  for (const s of strings) {
    const h = Buffer.alloc(3);
    h.writeUInt16LE(s.length, 0);
    h.writeUInt8(1, 2);                            // 와이드(UTF-16LE)
    parts.push(h, Buffer.from(s, 'utf16le'));
  }
  const bof = Buffer.alloc(16); bof.writeUInt16LE(0x0600, 0); bof.writeUInt16LE(5, 2);
  return buildOle([{
    name: 'Workbook',
    data: Buffer.concat([rec(0x0809, bof), rec(0x00FC, Buffer.concat(parts)), ...cells, rec(0x000A, Buffer.alloc(0))]),
  }]);
}

/** doc: 조각표 하나짜리 최소 Word 97 파일 */
function buildDoc(text, opt) {
  const compressed = !opt || opt.compressed !== false;    // cp1252 1바이트 표현
  const body = compressed ? Buffer.from(text, 'latin1') : Buffer.from(text, 'utf16le');
  const textAt = 0x800;

  const wd = Buffer.alloc(textAt + body.length + 16);
  wd.writeUInt16LE(0xA5EC, 0);                            // wIdent
  wd.writeUInt16LE(0x0000, 0x0A);                         // flags: 0Table, 암호 없음
  body.copy(wd, textAt);

  // CLX = 0x02 + lcb + PLCF(CP 2개 + PCD 1개)
  const plc = Buffer.alloc(4 * 2 + 8);
  plc.writeUInt32LE(0, 0);
  plc.writeUInt32LE(text.length, 4);
  const fc = compressed ? ((textAt * 2) | 0x40000000) >>> 0 : textAt;
  plc.writeUInt16LE(0, 8);
  plc.writeUInt32LE(fc, 10);
  const clx = Buffer.concat([Buffer.from([0x02]), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(plc.length); return b; })(), plc]);

  const table = Buffer.concat([Buffer.alloc(0x40), clx]);
  wd.writeUInt32LE(0x40, 0x01A2);                         // fcClx
  wd.writeUInt32LE(clx.length, 0x01A6);                   // lcbClx

  return buildOle([{ name: 'WordDocument', data: wd }, { name: '0Table', data: table }]);
}

module.exports = { buildOle, buildHwp, buildPpt, buildXls, buildDoc, SECTOR, MINI_CUTOFF };
