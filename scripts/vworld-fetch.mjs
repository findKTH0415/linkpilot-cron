// scripts/vworld-fetch.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// 대상 : 강원특별자치도 원주시 신림면 송계리 695-4 / 695-11 / 610-1 / 610-2 / 612-1
// 목적 : 보고서에 남은 빈칸을 채운다 — 필지 중심좌표·경계, 그리고 지도 이미지
//
// 왜 조회를 새로 짜지 않는가
//   im-agent/connectors/vworld.js 가 이미 지오코딩·필지·정적지도를 부른다.
//   그 안에 겪은 함정이 박혀 있다 — key·domain 을 마지막에 둬야 type 이 안 덮인다,
//   연속지적도에는 면적 필드가 없다, 도메인 등록형이라 domain 을 함께 보낸다.
//
// 확정되지 않은 것 하나
//   정적지도의 basemap 표기가 저장소 안에서 갈린다(Satellite/Base vs PHOTO/GRAPHIC).
//   추정하지 않고 둘 다 시험한 뒤 응답으로 확정해 이 파일과 요약에 적는다.

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

process.env.IM_AGENT_CACHE = process.env.IM_AGENT_CACHE
  || path.join(os.tmpdir(), `lp-vworld-${Date.now()}`);
require('../im-agent/core/env').load();

const vworld = require('../im-agent/connectors/vworld');

const OUT = 'data/vworld';
await mkdir(OUT, { recursive: true });
await mkdir(`${OUT}/maps`, { recursive: true });

const log = [];
const P = (s = '') => { log.push(s); };
const save = async () => { await writeFile(`${OUT}/_summary.md`, log.join('\n')); };

P('# 브이월드 수집 — 송계리 5필지');
P('');
P(`조회일 ${new Date().toISOString().slice(0, 10)}`);
P('');

if (!vworld.isAvailable() || !vworld.domain()) {
  P('## 중단 — 키 또는 도메인 없음');
  P('');
  P(`- \`VWORLD_KEY\`    ${vworld.isAvailable() ? '주입됨' : '**없음**'}`);
  P(`- \`VWORLD_DOMAIN\` ${vworld.domain() ? '주입됨' : '**없음**'}`);
  P('');
  P('브이월드는 도메인 등록형이다. 둘을 반드시 함께 주입한다. 한쪽만 넣으면 거부된다.');
  await save();
  process.exit(1);
}

// 법정동코드는 토지대장 고유번호에서 확정했다. 추정값이 아니다.
// PNU = 법정동코드(10) + 필지구분 1(일반) + 본번 4 + 부번 4
const BJD = '5113039027';
const SIDO = '강원특별자치도 원주시 신림면 송계리';
const pnuOf = (bon, bu) => `${BJD}1${String(bon).padStart(4, '0')}${String(bu).padStart(4, '0')}`;
const LOTS = [
  { label: '695-4',  address: `${SIDO} 695-4`,  pnu: pnuOf(695, 4) },
  { label: '695-11', address: `${SIDO} 695-11`, pnu: pnuOf(695, 11) },
  { label: '610-1',  address: `${SIDO} 610-1`,  pnu: pnuOf(610, 1) },
  { label: '610-2',  address: `${SIDO} 610-2`,  pnu: pnuOf(610, 2) },
  { label: '612-1',  address: `${SIDO} 612-1`,  pnu: pnuOf(612, 1) },
];

const round6 = (n) => Math.round(n * 1e6) / 1e6;
function centerOf(ring) {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return {
    lon: round6((Math.min(...lons) + Math.max(...lons)) / 2),
    lat: round6((Math.min(...lats) + Math.max(...lats)) / 2),
  };
}

// ── 1. 필지 도형 — 중심좌표와 경계 ──────────────────────────
P('## 1. 필지 도형 (중심좌표·경계)');
P('');
P('> 면적·지목·용도지역·공시지가는 토지대장과 토지이용계획확인서로 이미 확보했다.');
P('> 여기서 받을 것은 위치도 작성에 쓸 좌표와 경계다.');
P('');

const parcels = [];
const problems = [];

for (const lot of LOTS) {
  const g = await vworld.geocode(lot.address);
  if (!g.ok) {
    P(`- **${lot.label}** 지오코딩 실패 — ${g.error}`);
    if (g.hint) P(`  - ${g.hint}`);
    problems.push(`${lot.label} 지오코딩: ${g.error}`);
    continue;
  }

  const pa = await vworld.parcelAt(g.value.lon, g.value.lat);
  if (!pa.ok) {
    P(`- **${lot.label}** 필지 조회 실패 — ${pa.error}`);
    problems.push(`${lot.label} 필지: ${pa.error}`);
    continue;
  }

  const ring = pa.value.polygon || [];
  const center = ring.length >= 3 ? centerOf(ring) : { lon: round6(g.value.lon), lat: round6(g.value.lat) };

  // ★ 공부에서 만든 PNU 와 브이월드가 돌려준 PNU 를 대조한다.
  //   어긋나면 좌표가 옆 필지를 집은 것이다 — 조용히 넘기지 않는다.
  const pnuMatch = pa.value.pnu ? pa.value.pnu === lot.pnu : null;

  parcels.push({
    lot: lot.label,
    address: lot.address,
    pnuExpected: lot.pnu,
    pnuReturned: pa.value.pnu,
    pnuMatch,
    jibun: pa.value.jibun,
    matchedType: g.value.matchedType,
    refined: g.value.refined,
    vertices: ring.length,
    center,
    polygon: ring,
  });

  const mark = pnuMatch === true ? '' : (pnuMatch === false ? '  ⚠ PNU 불일치' : '  · PNU 미회신');
  P(`- **${lot.label}** → 꼭짓점 ${ring.length}개 · 중심 ${center.lat}, ${center.lon}${mark}`);
  if (pnuMatch === false) {
    P(`  - 공부 기준 \`${lot.pnu}\` · 회신 \`${pa.value.pnu}\` (지번 ${pa.value.jibun || '미회신'})`);
    problems.push(`${lot.label} PNU 불일치 — 좌표가 인접 필지를 집었을 수 있다`);
  }
}

await writeFile(`${OUT}/parcels.json`, JSON.stringify(parcels, null, 2));
P('');
P(`- 수집 ${parcels.length}/${LOTS.length}필지 · \`parcels.json\``);

// ── 2. 지도 이미지 ──────────────────────────────────────────
P('');
P('## 2. 지도 이미지');
P('');

const CEN = parcels.length
  ? {
      lon: round6(parcels.reduce((a, p) => a + p.center.lon, 0) / parcels.length),
      lat: round6(parcels.reduce((a, p) => a + p.center.lat, 0) / parcels.length),
    }
  : null;

// 키가 주소에 실리므로 URL 은 어디에도 적지 않는다. 태그와 응답만 남긴다.
const REFERER = /^https?:\/\//.test(vworld.domain()) ? vworld.domain() : `http://${vworld.domain()}`;

async function download(tag, url) {
  if (!url) { P(`  - \`${tag}\` → 주소 생성 실패`); return null; }
  try {
    const r = await fetch(url, { headers: { Referer: REFERER } });
    const ct = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer());
    const isImage = /image/i.test(ct) && buf.length > 5000;
    P(`  - \`${tag}\` → HTTP ${r.status} · ${ct || '형식 미회신'} · ${(buf.length / 1024).toFixed(0)}KB${isImage ? '' : '  ⚠ 이미지 아님'}`);
    return { isImage, buf, ct, status: r.status };
  } catch (e) {
    P(`  - \`${tag}\` → 네트워크 오류 (${e.code || 'unknown'})`);
    return null;
  }
}

if (!CEN) {
  P('- **중심 좌표 없음** — 앞 단계가 실패해 지도 요청을 건너뛴다.');
  problems.push('지도 미수집 — 필지 좌표를 한 건도 받지 못했다');
} else {
  P(`- 5필지 중심 ${CEN.lat}, ${CEN.lon}`);
  P('');

  // basemap 표기 확정 — 둘 다 시험하고 응답으로 정한다.
  P('### basemap 표기 확인 (시험 중)');
  P('');
  let SAT = null, PLAIN = null;
  for (const [sat, plain] of [['Satellite', 'Base'], ['PHOTO', 'GRAPHIC']]) {
    const r = await download(`probe_${sat}`, vworld.staticMapUrl(CEN.lat, CEN.lon, { zoom: 15, width: 400, height: 300, layer: sat }));
    if (r && r.isImage) { SAT = sat; PLAIN = plain; break; }
    if (r && !r.isImage) {
      await writeFile(`${OUT}/probe_${sat}.txt`, r.buf.subarray(0, 4000));
    }
  }

  P('');
  if (!SAT) {
    P('- **정적지도 응답이 이미지가 아니다.** `probe_*.txt` 를 열어 원문을 확인한다.');
    P('- 오류 문구가 보이면 활용신청 범위에 정적지도가 빠진 것이다 — 신청부터 한다.');
    problems.push('정적지도 미수집 — 응답이 이미지가 아니다');
  } else {
    P(`- 확정: 위성 \`${SAT}\` · 일반 \`${PLAIN}\``);
    P('');
    const SHOTS = [
      ['wide_sat',  { zoom: 15, layer: SAT },   '광역 위성'],
      ['wide_map',  { zoom: 15, layer: PLAIN }, '광역 일반'],
      ['site_sat',  { zoom: 17, layer: SAT },   '대상 사이트 위성'],
      ['site_map',  { zoom: 17, layer: PLAIN }, '대상 사이트 일반'],
      ['close_sat', { zoom: 18, layer: SAT },   '근접 위성'],
    ];
    for (const [name, opt, label] of SHOTS) {
      const r = await download(`map_${name}`, vworld.staticMapUrl(CEN.lat, CEN.lon, { width: 1200, height: 900, ...opt }));
      if (r && r.isImage) {
        await writeFile(`${OUT}/maps/${name}.png`, r.buf);
        P(`    ${label} → \`maps/${name}.png\``);
      } else {
        P(`    ${label} → 저장 안 함`);
        problems.push(`지도 ${label} 미수집`);
      }
    }
    P('');
    P(`- 키 없는 공개 지도 링크 — ${vworld.mapLink(CEN.lat, CEN.lon)}`);
    P('- 지도 이미지 주소에는 키가 실린다. 보고서에는 위 공개 링크만 적는다.');
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
P('| 694번지 공부 | 담보 5필지 밖이다. 등기부·토지대장을 따로 받는다 |');
P('');
P('수집물은 공부 기반이므로 신뢰등급 A로 기재한다.');

if (problems.length) {
  P('');
  P('## 4. 이번 실행에서 걸린 것');
  P('');
  for (const p of problems) P(`- ${p}`);
}

await save();
console.log(`완료 — ${OUT}/_summary.md`);
