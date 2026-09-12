/**
 * **웹소켓 최소 손님 (RFC 6455)** — 크로미움을 붙잡아 물어보는 데만 쓴다.
 *
 * 〈2026-09-12 · 왜 만들었나〉
 *   화면을 «그려서» 재는 칸은 크로미움에 붙어(CDP) 보이는 글자를 물어봐야 한다.
 *   그 연결이 웹소켓인데, **Node 20 에는 전역 `WebSocket` 이 없다.** 이 저장소의
 *   CI 와 NAS 가 둘 다 Node 20 이라(`deploy-im.yml`: 「NAS 가 v20 이다. 여기서만
 *   새 것을 쓰지 않는다」) 그 칸이 CI 에서 **늘 건너뛰어졌다** — 못 잰 것이다.
 *
 * ★ **고치는 방향을 「런타임을 올린다」로 잡지 않는다.** 올리면 CI 가 NAS 에 없는
 *   런타임에서 재게 되고, 그것은 이 저장소가 가장 조심하는 어긋남이다
 *   (「내 자리에서는 됩니다」). 모자란 것은 웹소켓 한 가지뿐이므로 그것만 채운다.
 *
 * ★★ **라이브러리를 들이지 않는다** (CLAUDE.md §5). `node:net` 과 `node:crypto` 만 쓴다.
 *
 * [범위] 손님(client) 쪽만. 텍스트 프레임 · 이어붙임(continuation) · ping 응답 ·
 *   64비트 길이까지 다룬다. 범용 웹소켓 라이브러리가 아니다 — CDP 한 갈래에 필요한 만큼이다.
 */
'use strict';

const net = require('node:net');
const crypto = require('node:crypto');

/** ws://host:port/path 에 붙어 { send, onMessage, close, closed } 를 돌려준다. */
function connect(url, timeoutMs) {
  const u = new URL(url);
  if (u.protocol !== 'ws:') throw new Error('ws: 주소만 붙는다 — ' + url);
  const key = crypto.randomBytes(16).toString('base64');

  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: u.hostname, port: Number(u.port || 80) });
    let settled = false;
    const fail = e => { if (!settled) { settled = true; try { sock.destroy(); } catch (_) {} reject(e); } };
    const timer = setTimeout(() => fail(new Error('웹소켓 손잡기가 ' + timeoutMs + 'ms 안에 안 끝났다')),
      timeoutMs || 10000);

    sock.on('error', fail);
    sock.setNoDelay(true);

    let head = Buffer.alloc(0);
    let body = Buffer.alloc(0);
    let open = false;
    const listeners = [];
    let frag = null, fragOp = 0;

    /* 서버 → 손님 프레임을 읽는다. 서버 프레임은 마스크가 없다. */
    function drain() {
      for (;;) {
        if (body.length < 2) return;
        const fin = (body[0] & 0x80) !== 0;
        const op = body[0] & 0x0f;
        const masked = (body[1] & 0x80) !== 0;
        let len = body[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (body.length < 4) return; len = body.readUInt16BE(2); off = 4; }
        else if (len === 127) {
          if (body.length < 10) return;
          const big = body.readBigUInt64BE(2);
          if (big > 64n * 1024n * 1024n) { fail(new Error('프레임이 너무 크다')); return; }
          len = Number(big); off = 10;
        }
        let mask = null;
        if (masked) { if (body.length < off + 4) return; mask = body.subarray(off, off + 4); off += 4; }
        if (body.length < off + len) return;
        let payload = Buffer.from(body.subarray(off, off + len));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        body = body.subarray(off + len);

        if (op === 0x9) { write(0xA, payload); continue; }          /* ping → pong */
        if (op === 0xA) continue;                                    /* pong 은 흘린다 */
        if (op === 0x8) { try { sock.end(); } catch (_) {} return; } /* close */
        if (op === 0x0) { frag = frag ? Buffer.concat([frag, payload]) : payload; }
        else { frag = payload; fragOp = op; }
        if (!fin) continue;
        const whole = frag; frag = null;
        if (fragOp === 0x1) { const s = whole.toString('utf8'); for (const fn of listeners) fn(s); }
      }
    }

    /* 손님 → 서버 프레임은 **반드시 마스크**한다 (RFC 6455 §5.3) */
    function write(op, payload) {
      const p = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
      const mask = crypto.randomBytes(4);
      let head2;
      if (p.length < 126) { head2 = Buffer.alloc(2); head2[1] = 0x80 | p.length; }
      else if (p.length < 65536) { head2 = Buffer.alloc(4); head2[1] = 0x80 | 126; head2.writeUInt16BE(p.length, 2); }
      else { head2 = Buffer.alloc(10); head2[1] = 0x80 | 127; head2.writeBigUInt64BE(BigInt(p.length), 2); }
      head2[0] = 0x80 | op;
      const masked = Buffer.from(p);
      for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
      sock.write(Buffer.concat([head2, mask, masked]));
    }

    sock.on('data', chunk => {
      if (open) { body = Buffer.concat([body, chunk]); drain(); return; }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      const text = head.subarray(0, end).toString('latin1');
      if (!/^HTTP\/1\.1 101/.test(text)) { fail(new Error('101 이 아니다: ' + text.split('\r\n')[0])); return; }
      const want = crypto.createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if (!new RegExp('sec-websocket-accept:\\s*' + want.replace(/[+/=]/g, c => '\\' + c), 'i').test(text)) {
        fail(new Error('서버가 돌려준 accept 값이 다르다')); return;
      }
      open = true;
      body = Buffer.concat([body, head.subarray(end + 4)]);
      head = Buffer.alloc(0);
      clearTimeout(timer);
      settled = true;
      resolve({
        send: s => write(0x1, s),
        onMessage: fn => listeners.push(fn),
        close: () => { try { write(0x8, Buffer.alloc(0)); sock.end(); } catch (_) {} },
        get closed() { return sock.destroyed || !open; },
      });
      drain();
    });

    sock.on('close', () => { open = false; if (!settled) fail(new Error('손잡기 전에 끊겼다')); });

    sock.write(
      'GET ' + (u.pathname || '/') + (u.search || '') + ' HTTP/1.1\r\n' +
      'Host: ' + u.host + '\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\n' +
      'Sec-WebSocket-Version: 13\r\n\r\n');
  });
}

module.exports = { connect };
