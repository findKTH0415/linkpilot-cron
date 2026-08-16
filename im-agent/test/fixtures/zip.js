'use strict';
/**
 * 시험용 ZIP 만들기 (무압축 store). hwpx 파서를 시험하려면 hwpx 파일이 필요한데,
 * 실무 파일은 이 저장소(public)에 넣을 수 없다.
 *
 * 압축(deflate)을 안 쓰는 이유: 읽는 쪽은 둘 다 다루고, 시험 파일은 작아서
 * 압축해 봐야 얻는 게 없다. 만드는 코드가 짧을수록 시험 파일이 틀릴 일이 적다.
 */

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let x = 0xFFFFFFFF;
  for (const b of buf) x = table[(x ^ b) & 0xFF] ^ (x >>> 8);
  return (x ^ 0xFFFFFFFF) >>> 0;
}

/**
 * @param {Array<{name:string, data:Buffer|string}>} files
 * @returns {Buffer}
 */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // version
    lh.writeUInt16LE(0, 6);             // flags
    lh.writeUInt16LE(0, 8);             // method = store
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 10);            // method = store
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += 30 + name.length + data.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, eocd]);
}

/** hwpx (OWPML) — 본문은 Contents/section0.xml */
function buildHwpx(paragraphs) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = paragraphs.map(p => `<hp:p><hp:run><hp:t>${esc(p)}</hp:t></hp:run></hp:p>`).join('');
  return buildZip([
    { name: 'mimetype', data: 'application/hwp+zip' },
    { name: 'Contents/section0.xml', data: `<?xml version="1.0" encoding="UTF-8"?><hs:sec>${body}</hs:sec>` },
  ]);
}

module.exports = { buildZip, buildHwpx, crc32 };
