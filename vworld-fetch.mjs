// scripts/vworld-fetch.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// 대상 : 강원특별자치도 원주시 신림면 송계리 695-4 / 695-11 / 610-1 / 610-2 / 612-1
// 목적 : 보고서에 남은 빈칸을 채운다 — 필지 중심좌표·경계, 그리고 지도 이미지 다섯 장
// 주의 : 브이월드는 도메인 등록형이다. VWORLD_KEY 단독 주입은 거부된다.

import { mkdir, writeFile } from 'node:fs/promises';

const OUT = 'data/vworld';
await mkdir(OUT, { recursive: true });            // 무엇보다 먼저

const log = [];
const P = (s = '') => { log.push(s); };
const save = async () => { await writeFile(`${OUT}/_summary.md`, log.join('\n')); };

P('# 브이월드 수집 — 송계리 5필지');
P('');
P(`조회일 ${new Date().toISOString().slice(0, 10)}`);
P('');

// ── 0. 키와 도메인 ──────────────────────────────────────────
const KEY = process.env.VWORLD_KEY;
const DOMAIN = process.env.VWORLD_DOMAIN;

if (!KEY || !DOMAIN) {
  P('## 중단 — 키 또는 도메인 없음');
  P('');
  P(`- \`VWORLD_KEY\`    ${KEY ? '주입됨' : '**없음**'}`);
  P(`- \`VWORLD_DOMAIN\` ${DOMAIN ? '주입됨' : '**없음**'}`);
  P('');
  P('브이월드는 도메인 등록형이다. 둘을 반드시 함께 주입한다.');
  await save();
  process.exit(1);
}

// 도메인 검증은 Referer 헤더로도 이루어진다. 파라미터와 헤더를 함께 보낸다.
const HDR = { Referer: /^https?:\/\//.test(DOMAIN) ? DOMAIN : `http://${DOMAIN}` };
const q = (o) => new URLSearchParams({ ...o, key: KEY, domain: DOMAIN });

// 법정동코드는 토지대장 고유번호에서 확정했다. 추정값이 아니다.
const BJD = '5113039027';
const LOTS = [
  { label: '695-4',  pnu: `${BJD}106950004` },
  { label: '695-11', pnu: `${BJD}106950011` },
  { label: '610-1',  pnu: `${BJD}106100001` },
  { label: '610-2',  pnu: `${BJD}106100002` },
  { label: '612-1',  pnu: `${BJD}106120001` },
];

async function grab(tag, url, binary = false) {
  try {
    const r = await fetch(url, { headers: HDR });
    const ct = r.headers.get('content-type') ?? '';
    const buf = Buffer.from(await r.arrayBuffer());
    const bad = !binary && /INCORRECT_KEY|NOT_APPLICABLE|UNREGISTERED|ERROR/i
      .test(buf.subarray(0, 600).toString());
    P(`- \`${tag}\` → HTTP ${r.status} · ${ct} · ${(buf.length / 1024).toFixed(0)}KB`
      + (bad ? '  ⚠ 키·도메인 거부 의심' : ''));
    return { ok: r.status === 200 && !bad, buf, ct };
  } catch {
    P(`- \`${tag}\` → 네트워크 오류`);
    return { ok: false, buf: Buffer.alloc(0), ct: '' };
  }
}

// ── 1. 필지 도형 — 중심좌표와 경계 ──────────────────────────
P('## 1. 필지 도형 (중심좌표·경계)');
P('');
P('> 면적·지목·용도지역·공시지가는 토지대장과 토지이용계획확인서로 이미 확보했다.');
P('> 여기서 받을 것은 위치도 작성에 쓸 좌표와 경계다.');
P('');

const DATA = 'https://api.vworld.kr/req/data';
const parcels = [];

for (const lot of LOTS) {
  const r = await grab(`parcel_${lot.label}`, `${DATA}?${q({
    service: 'data', request: 'GetFeature', data: 'LP_PA_CBND_BUBUN',
    attrFilter: `pnu:=:${lot.pnu}`, size: '10', page: '1',
    geometry: 'true', format: 'json',
  })}`);
  await writeFile(`${OUT}/parcel_${lot.label}.json`, r.buf);
  if (!r.ok) continue;
  const t = r.buf.toString();
  const pts = [...t.matchAll(/\[\s*(1[2-3]\d\.\d+)\s*,\s*(3[0-9]\.\d+)\s*\]/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
  if (!pts.length) { P(`  - ${lot.label} → 도형 없음 (수집 실패로 기록)`); continue; }
  const ctr = [
    (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2,
    (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2,
  ];
  parcels.push({ lot: lot.label, pnu: lot.pnu, vertices: pts.length,
    center: { lon: +ctr[0].toFixed(6), lat: +ctr[1].toFixed(6) } });
  P(`  - ${lot.label} → 꼭짓점 ${pts.length}개 · 중심 ${ctr[1].toFixed(6)}, ${ctr[0].toFixed(6)}`);
}
await writeFile(`${OUT}/parcels.json`, JSON.stringify(parcels, null, 2));

// ── 2. 지도 이미지 다섯 장 ──────────────────────────────────
P('');
P('## 2. 지도 이미지');
P('');

await mkdir(`${OUT}/maps`, { recursive: true });

// 5필지 전체를 감싸는 중심
const CEN = parcels.length
  ? { lon: parcels.reduce((a, p) => a + p.center.lon, 0) / parcels.length,
      lat: parcels.reduce((a, p) => a + p.center.lat, 0) / parcels.length }
  : null;

if (!CEN) {
  P('- **중심 좌표 없음** — 앞 단계가 실패해 지도 요청을 건너뛴다.');
} else {
  P(`- 5필지 중심 ${CEN.lat.toFixed(6)}, ${CEN.lon.toFixed(6)}`);

  const IMG = 'https://api.vworld.kr/req/image';
  const SHOTS = [
    ['wide_sat',  { basemap: 'PHOTO',   zoom: '15' }, '광역 위성'],
    ['wide_map',  { basemap: 'GRAPHIC', zoom: '15' }, '광역 일반'],
    ['site_sat',  { basemap: 'PHOTO',   zoom: '17' }, '대상 사이트 위성'],
    ['site_map',  { basemap: 'GRAPHIC', zoom: '17' }, '대상 사이트 일반'],
    ['cadastral', { basemap: 'PHOTO',   zoom: '17', layers: 'lp_pa_cbnd_bubun' }, '지적도 중첩'],
  ];

  // 첫 요청으로 경로와 변수명을 확인한 뒤 본 수집을 한다.
  const probe = await grab('_probe_image', `${IMG}?${q({
    service: 'image', request: 'getmap', format: 'png', size: '400,300',
    center: `${CEN.lon},${CEN.lat}`, crs: 'EPSG:4326', zoom: '15', basemap: 'PHOTO',
  })}`, true);
  await writeFile(`${OUT}/_probe_image.bin`, probe.buf.subarray(0, 4000));

  if (!/image/.test(probe.ct) || probe.buf.length < 2000) {
    P('- **정적지도 응답이 이미지가 아니다.** `_probe_image.bin` 앞부분을 열어 확인한다.');
    P('- 오류 문구가 보이면 활용신청 범위에 정적지도가 빠진 것이다.');
  } else {
    for (const [name, opt, label] of SHOTS) {
      const r = await grab(`map_${name}`, `${IMG}?${q({
        service: 'image', request: 'getmap', format: 'png', size: '1200,900',
        center: `${CEN.lon},${CEN.lat}`, crs: 'EPSG:4326', ...opt,
      })}`, true);
      if (r.ok && r.buf.length > 5000) {
        await writeFile(`${OUT}/maps/${name}.png`, r.buf);
        P(`  - ${label} → \`maps/${name}.png\``);
      } else {
        P(`  - ${label} → 저장 안 함`);
      }
    }
  }
}

// ── 3. 마무리 ───────────────────────────────────────────────
P('');
P('## 3. 이 수집으로도 채워지지 않는 것');
P('');
P('| 항목 | 사유 |');
P('|---|---|');
P('| 감정평가액 | API 미개방. 지정 평가법인 의뢰 |');
P('| 법원경매 감정평가서 | 미개방. 법원경매정보 직접 열람 |');
P('| 임대차 현황 | 공부에 없음. 현장 실사 |');
P('');
P('수집물은 공부 기반이므로 신뢰등급 A로 기재한다.');

await save();
console.log(`완료 — ${OUT}/_summary.md`);
