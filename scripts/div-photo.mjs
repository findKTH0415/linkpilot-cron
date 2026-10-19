// scripts/div-photo.mjs
// ↑ 첫 글자는 반드시 "//" 다.
// 보고서 간지용 위성사진 — 브이월드 정적지도(위성)를 열쇠가 있는 자리에서 받는다.
// 주소는 검토서·지번표에 적힌 지번만 쓴다(해남은 지번 미확정이라 한전 조회에 응답한 현산면 표본 지번).
// 열쇠가 실린 주소는 어디에도 적지 않는다 (§2).
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const vworld = require('../im-agent/connectors/vworld.js');
const OUT = 'data/_div'; await mkdir(OUT, { recursive: true });
const log = []; const P = (s) => { log.push(s); console.log(s); };
const SITES = [
  ['hn', ['전라남도 해남군 현산면 조산리 100', '전남광주통합특별시 해남군 현산면 조산리 100', '전라남도 해남군 현산면 월송리 10', '전라남도 해남군 현산면 구산리 100']],
  ['nd', ['충청남도 태안군 고남면 누동리 1550', '충청남도 태안군 고남면 누동리 1547']],
  ['wb', ['충청남도 태안군 원북면 방갈리 850-1', '충청남도 태안군 원북면 방갈리 850']],
];
const REF = /^https?:\/\//.test(vworld.domain() || '') ? vworld.domain() : `http://${vworld.domain()}`;
P(`# 간지 위성사진 · 열쇠 ${vworld.isAvailable() ? '있음' : '없음'} · 도메인 ${vworld.domain() ? '있음' : '없음'}`);
for (const [id, addrs] of SITES) {
  let g = null, used = '';
  for (const a of addrs) { const r = await vworld.geocode(a); if (r.ok) { g = r.value; used = a; break; } P(`- ${id} 지오코딩 실패 «${a}» — ${String(r.error).slice(0, 120)}`); }
  if (!g) continue;
  P(`- ${id} «${used}» → ${g.lat}, ${g.lon}`);
  for (const [z, w, h] of [[14, 1000, 1400], [15, 1000, 1400], [14, 1024, 1024], [15, 800, 1100]]) {
    const url = vworld.staticMapUrl(g.lat, g.lon, { zoom: z, width: w, height: h, layer: 'PHOTO' });
    try {
      const r = await fetch(url, { headers: { Referer: REF } }); const b = Buffer.from(await r.arrayBuffer());
      const img = /image/.test(r.headers.get('content-type') || '') && b.length > 5000;
      P(`  - z${z} ${w}x${h} → HTTP ${r.status} · ${(b.length / 1024).toFixed(0)}KB ${img ? '' : '이미지 아님 «' + b.subarray(0, 200).toString().replace(/key=[^&"]*/g, 'key=***') + '»'}`);
      if (img) await writeFile(`${OUT}/${id}_z${z}_${w}x${h}.png`, b);
    } catch (e) { P(`  - z${z} 네트워크 오류 ${e.code || e.message}`); }
  }
}
await writeFile(`${OUT}/_summary.md`, log.join('\n'));
