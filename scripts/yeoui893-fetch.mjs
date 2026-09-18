// 전주 덕진구 여의동 893 — 담보 가치검토 공공데이터 수집 (GitHub Actions 레인 전용)
// 대상 : 전북특별자치도 전주시 덕진구 여의동 893 (1,570㎡, 2026 재산세 고지서 기준)
// 수집 : ① 국토부 토지 매매 실거래 36개월(LAWD_CD 52113 · 고지서 기관번호와 일치)
//        ② 브이월드 필지(PNU)·토지특성·토지이용계획·개별공시지가
//        ③ 브이월드 정적지도(위성·일반)
// 원칙 : 키는 환경변수로만 받는다. URL 전문·키는 어디에도 적지 않는다.
//        응답 원문을 가공 전에 먼저 저장한다. 빈 응답은 「거래 없음」이 아니라 실패로 센다.
//        종료 코드 0 전부 / 1 일부 / 2 못 쟀다.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
require('../im-agent/core/env').load();

// ── 브이월드 호출에 등록 도메인을 Referer·Origin 으로 싣는다 (2026-09-19 재구성) ──
// 콘솔 서비스URL: https://synologynas.tail43fc79.ts.net (WEB·REPORT 키 공통)
// Actions 러너는 Referer 가 비어 있다. 커넥터는 domain 파라미터만 보내므로 여기서 헤더를 더한다.
// 모든 브이월드 응답의 상태와 앞부분(키 가림)을 diag 로 남겨 502·인증거부·권한없음을 구분한다.
const VW_DOMAIN = (process.env.VWORLD_DOMAIN || '').trim();
const VW_DIAG = [];
const _fetch = globalThis.fetch;
const redactUrl = (u) => String(u).replace(/([?&](key|KEY|serviceKey)=)[^&]+/g, '$1***').replace(/([?&]domain=)[^&]+/g, '$1(등록도메인)');
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!/vworld\.kr/.test(u)) return _fetch(url, init);
  const headers = new Headers(init.headers || {});
  if (VW_DOMAIN) {
    if (!headers.has('Referer')) headers.set('Referer', VW_DOMAIN.endsWith('/') ? VW_DOMAIN : VW_DOMAIN + '/');
    if (!headers.has('Origin')) headers.set('Origin', VW_DOMAIN.replace(/\/$/, ''));
  }
  const t0 = Date.now();
  try {
    const r = await _fetch(url, { ...init, headers });
    const ct = r.headers.get('content-type') || '';
    let head = '';
    if (!/image/.test(ct)) { try { head = (await r.clone().text()).slice(0, 240); } catch {} }
    VW_DIAG.push({ url: redactUrl(u).slice(0, 220), status: r.status, ct, ms: Date.now() - t0, head });
    return r;
  } catch (e) {
    VW_DIAG.push({ url: redactUrl(u).slice(0, 220), status: 'NETWORK', err: e.cause?.code || e.code || e.message, ms: Date.now() - t0 });
    throw e;
  }
};
const vworld = require('../im-agent/connectors/vworld');
const nsdi = require('../im-agent/connectors/nsdi');
const { dataKey } = require('../im-agent/connectors/datakey');
const { buildUrl } = require('../im-agent/connectors/http');

const OUT = 'data/yeoui893';
const ADDRESS = '전북특별자치도 전주시 덕진구 여의동 893';
const LAWD = '52113';
const FALLBACK = { lat: 35.8523635, lon: 127.075172 };   // 구글 지오코딩(등급 C) — 브이월드 실패 시 지도 중심에만 쓴다
await mkdir(`${OUT}/raw`, { recursive: true });
await mkdir(`${OUT}/maps`, { recursive: true });

const log = [];
const P = (s = '') => { log.push(s); console.log(s); };
const problems = [];
let got = 0, tried = 0;
const save = () => writeFile(`${OUT}/_summary.md`, log.join('\n'));
P('# 여의동 893 공공데이터 수집');
P(`조회일 ${new Date().toISOString().slice(0, 10)} · 대상 ${ADDRESS}`);
P('');

// ── ① 토지 매매 실거래 ────────────────────────────────
P('## 1. 토지 매매 실거래 (RTMSDataSvcLandTrade)');
const key = dataKey();
const months = [];
{ const d = new Date(); d.setUTCDate(1);
  for (let i = 1; i <= 36; i++) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push(`${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}`); } }
const trades = [];
if (process.env.SKIP_TRADE === '1') { P('- 이번 실행은 생략 (2026-09-18 수집본 사용)'); }
else if (!key) { P('- **DATA_GO_KR_KEY 미주입** — 실거래 미실행'); problems.push('실거래 키 없음'); }
else {
  let okMonths = 0, emptyMonths = 0, failMonths = 0;
  for (const ym of months) {
    tried++;
    let page = 1, total = null, rows = 0;
    while (true) {
      const url = buildUrl('https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade',
        { serviceKey: key, LAWD_CD: LAWD, DEAL_YMD: ym, numOfRows: 1000, pageNo: page, _type: 'json' });
      let text = '', status = 0;
      try { const r = await fetch(url); status = r.status; text = await r.text(); }
      catch (e) { text = `NETWORK ${e.code || e.message}`; }
      await writeFile(`${OUT}/raw/trade_${ym}_p${page}.txt`, text);          // 원문 먼저
      let body = null; try { body = JSON.parse(text)?.response; } catch {}
      const code = body?.header?.resultCode;
      if (status !== 200 || !body || (code && !['00', '000'].includes(String(code)))) {
        failMonths++; problems.push(`${ym}: HTTP ${status} · ${code || '해석 불가'} ${body?.header?.resultMsg || ''}`); break;
      }
      total = Number(body.body?.totalCount ?? 0);
      let items = body.body?.items?.item || [];
      if (!Array.isArray(items)) items = [items];
      for (const it of items) trades.push({ ym, ...it });
      rows += items.length;
      if (rows >= total || !items.length) break;
      page++;
    }
    if (total === null) continue;
    if (total === 0) emptyMonths++; else okMonths++;
    if (total !== null && rows < total) problems.push(`${ym}: 불완전 수집 ${rows}/${total}`);
    got++;
  }
  P(`- ${months.at(-1)}~${months[0]} · 36개월 중 응답 ${okMonths + emptyMonths}개월(건수 0인 달 ${emptyMonths}) · 실패 ${failMonths}개월`);
  P(`- 덕진구 토지 매매 원본 ${trades.length}건 → \`trades_all.json\``);
  const yeoui = trades.filter(t => /여의동/.test(String(t.umdNm ?? t.법정동 ?? '')));
  P(`- 여의동 ${yeoui.length}건 → \`trades_yeoui.json\` (지분거래·해제 포함 원본, 정제는 판독 단계에서)`);
  await writeFile(`${OUT}/trades_all.json`, JSON.stringify(trades, null, 1));
  await writeFile(`${OUT}/trades_yeoui.json`, JSON.stringify(yeoui, null, 1));
}
P(''); await save();

// ── ② 브이월드 필지·공부 속성 ─────────────────────────
P('## 2. 브이월드 필지·토지특성·토지이용계획·개별공시지가');
let center = null, pnu = null;
tried++;
const g = await vworld.geocode(ADDRESS);
if (!g.ok) { P(`- 지오코딩 실패 — ${g.error}`); problems.push(`지오코딩: ${g.error}`); }
else {
  const pa = await vworld.parcelAt(g.value.lon, g.value.lat);
  if (!pa.ok) { P(`- 필지 조회 실패 — ${pa.error}`); problems.push(`필지: ${pa.error}`); center = { lat: g.value.lat, lon: g.value.lon }; }
  else {
    pnu = pa.value.pnu; center = { lat: g.value.lat, lon: g.value.lon };
    P(`- PNU \`${pnu}\` · 지번 ${pa.value.jibun || '미회신'}${/893(?!\d|-)/.test(String(pa.value.jibun)) ? '' : '  ⚠ 893 아님 — 인접 필지를 집었을 수 있다'}`);
    await writeFile(`${OUT}/parcel.json`, JSON.stringify(pa.value, null, 1));
    got++;
  }
}
if (pnu) {
  for (const [name, fn] of [['토지특성', nsdi.landCharacteristics], ['토지이용계획', nsdi.landUse], ['개별공시지가', nsdi.landPrice]]) {
    tried++;
    const r = await fn(pnu);
    await writeFile(`${OUT}/${name}.json`, JSON.stringify(r, null, 1));
    if (r.ok) { got++; P(`- ${name} 수집 → \`${name}.json\``); }
    else { P(`- ${name} 실패 — ${r.error}`); problems.push(`${name}: ${r.error}`); }
  }
}
P(''); await save();

// ── ③ 정적지도 ───────────────────────────────────────
P('## 3. 브이월드 정적지도');
const C = center || FALLBACK;
P(`- 중심 ${C.lat}, ${C.lon} (${center ? '브이월드 지오코딩' : '구글 좌표 대체 — 등급 C'})`);
const REFERER = /^https?:\/\//.test(vworld.domain()) ? vworld.domain() : `http://${vworld.domain()}`;
const MAPS = [['site_sat', { zoom: 18, layer: 'Satellite' }], ['wide_sat', { zoom: 16, layer: 'Satellite' }],
              ['site_map', { zoom: 18, layer: 'Base' }], ['wide_map', { zoom: 15, layer: 'Base' }],
              // 시험 중 — 커넥터의 basemap 값(Satellite/Base)이 안 먹을 때 대체 표기
              ['site_sat_try', { zoom: 18, layer: 'PHOTO' }], ['site_map_try', { zoom: 18, layer: 'GRAPHIC' }]];
for (const [name, opt] of MAPS) {
  tried++;
  const url = vworld.staticMapUrl(C.lat, C.lon, { width: 1200, height: 900, ...opt });
  if (!url) { P(`- ${name} → 키 없음, 요청 안 함`); problems.push(`지도 ${name}: 키 없음`); continue; }
  try {
    const r = await fetch(url, { headers: { Referer: REFERER } });
    const buf = Buffer.from(await r.arrayBuffer()); const ct = r.headers.get('content-type') || '';
    if (/image/.test(ct) && buf.length > 5000) { await writeFile(`${OUT}/maps/${name}.png`, buf); got++; P(`- ${name} → HTTP ${r.status} · ${(buf.length / 1024).toFixed(0)}KB`); }
    else { await writeFile(`${OUT}/maps/${name}.err.txt`, buf.subarray(0, 3000)); P(`- ${name} → 이미지 아님 (HTTP ${r.status})`); problems.push(`지도 ${name} 미수집`); }
  } catch (e) { P(`- ${name} → 네트워크 오류 ${e.code || ''}`); problems.push(`지도 ${name}: 네트워크`); }
}
// 지적 경계(연속지적도) WMS — 시험 중. 결과로만 확정한다
{
  tried++;
  const d = 0.0009, k = (process.env.VWORLD_KEY || '').trim();
  if (!k) { P('- cadastral → 키 없음'); }
  else {
    const q = new URLSearchParams({ SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
      LAYERS: 'lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun', STYLES: 'lp_pa_cbnd_bubun_line,lp_pa_cbnd_bonbun_line',
      CRS: 'EPSG:4326', BBOX: [C.lat - d, C.lon - d * 1.25, C.lat + d, C.lon + d * 1.25].join(','),
      WIDTH: '1200', HEIGHT: '900', FORMAT: 'image/png', TRANSPARENT: 'true', KEY: k, DOMAIN: VW_DOMAIN });
    try {
      const r = await fetch(`https://api.vworld.kr/req/wms?${q}`);
      const buf = Buffer.from(await r.arrayBuffer()); const ct = r.headers.get('content-type') || '';
      if (/image/.test(ct) && buf.length > 2000) { await writeFile(`${OUT}/maps/cadastral_wms.png`, buf); got++; P(`- cadastral_wms → HTTP ${r.status} · ${(buf.length / 1024).toFixed(0)}KB`); }
      else { await writeFile(`${OUT}/maps/cadastral_wms.err.txt`, buf.subarray(0, 3000)); P(`- cadastral_wms → 이미지 아님 (HTTP ${r.status})`); problems.push('지적도 WMS 미수집'); }
    } catch (e) { P(`- cadastral_wms → 네트워크 오류`); problems.push('지적도 WMS: 네트워크'); }
  }
}
P(`- 공개 링크(키 없음) ${vworld.mapLink(C.lat, C.lon)}`);
await writeFile(`${OUT}/vworld_diag.json`, JSON.stringify(VW_DIAG, null, 1));
{
  const by = {}; for (const x of VW_DIAG) by[x.status] = (by[x.status] || 0) + 1;
  P(`- 브이월드 응답 분포 ${JSON.stringify(by)} → \`vworld_diag.json\``);
  P(`- 등록 도메인 주입 ${VW_DOMAIN ? '있음(Referer·Origin·domain)' : '**없음 — VWORLD_DOMAIN 비어 있음**'}`);
}
P('');
P('## 4. API로 받지 않는 것');
P('- 등기사항전부증명서 — 인터넷등기소 발급(직접 징구)');
P('- 토지대장 원본 — 정부24 발급. 위 토지특성이 지목·면적을 대신 확인한다');
P('- 표준지 공시지가 조서 — 부동산공시가격 알리미 열람(브라우저)');
P('- 법원경매 매각통계 — 법원경매정보 열람(브라우저)');
P('');
P('## 5. 걸린 것');
for (const p of problems) P(`- ${p}`);
const code = got === tried ? 0 : (got > 0 ? 1 : 2);
P(''); P(`판정 ${got}/${tried} · 종료코드 ${code}`);
await save();
console.log(`LP_YEOUI verdict=${code}`);
process.exit(code);
