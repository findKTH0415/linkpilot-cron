'use strict';
/**
 * png-read.js — **찍어 낸 그림을 실제로 읽어 본다** 〈2026-08-30 · D-181〉.
 *
 * ★★★ 왜 필요한가 — 이 갈래에서 **바로 당했다.** 임시 html 이 옆 폴더의 SVG 를
 *   못 찾았는데 크로미움은 **오류를 안 냈다.** 깨진 그림 표시만 찍고 정상
 *   종료했고, 스크립트는 「10장 만들었다」로 끝났다. **파일도 있고 크기도
 *   있는데 전부 빈 그림이었다** — 눈으로 열어 보지 않았으면 그대로 나갔다.
 *
 * ★ 그래서 「만들어졌다」가 아니라 **「무엇이 그려졌는가」**를 잰다. 색이 몇 개
 *   있는지, 그림이 어디까지 닿는지, 가장자리가 비었는지를 픽셀에서 읽는다.
 *
 * ★ 라이브러리를 안 들인다 (§5) — PNG 는 zlib 만 있으면 읽힌다. 우리가 만드는
 *   그림뿐이므로 **8비트 RGBA(색유형 6)만** 읽으면 된다. 다른 꼴이면 그렇다고
 *   말하고 멈춘다 — 조용히 0 을 돌려주지 않는다.
 */

const fs = require('fs');
const zlib = require('zlib');

function chunks(buf) {
  const out = [];
  let at = 8;                                   // 서명 8바이트를 건너뛴다
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    out.push({ type, data: buf.subarray(at + 8, at + 8 + len) });
    at += 12 + len;                             // 길이4 + 이름4 + 자료 + CRC4
  }
  return out;
}

/** @returns {{width:number,height:number,at:(x:number,y:number)=>[number,number,number,number]}} */
function read(file) {
  const buf = fs.readFileSync(file);
  const cs = chunks(buf);
  const ihdr = cs.filter((c) => c.type === 'IHDR')[0];
  if (!ihdr) throw new Error('PNG 가 아니다 (IHDR 이 없다): ' + file);
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8];
  const color = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (depth !== 8 || color !== 6 || interlace !== 0) {
    throw new Error(`이 읽개는 8비트 RGBA 만 읽는다 (깊이 ${depth} · 색유형 ${color} · 인터레이스 ${interlace})`);
  }
  const raw = zlib.inflateSync(Buffer.concat(
    cs.filter((c) => c.type === 'IDAT').map((c) => c.data)));

  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const line = raw.subarray(src, src + stride); src += stride;
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;        // 왼쪽
      const b = prev ? prev[i] : 0;                 // 위
      const c = (prev && i >= bpp) ? prev[i - bpp] : 0;  // 왼쪽 위
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) throw new Error('모르는 줄 필터: ' + filter);
      row[i] = v & 0xff;
    }
  }
  return {
    width, height,
    at(x, y) {
      const i = y * stride + x * bpp;
      return [out[i], out[i + 1], out[i + 2], out[i + 3]];
    },
  };
}

module.exports = { read };
