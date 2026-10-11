// 해외 국가 개황 주간 수집 — 외교부 국가·지역별 정치현황 + KOTRA 국가정보 (D-442)
// 의존성 없음. Node 20+ 내장 fetch 만 쓴다.
//
// ★ 왜: 투자정보 [해외투자자] 탭에 «나라를 고르면 정치·경제 개황이 서는» 칸을 붙이려면 자료가 먼저다.
//   화면은 이 파일이 실제로 찬 것을 본 뒤에 잇는다 — 빈 칸을 먼저 그리지 않는다 (CLAUDE.md §8).
// ★ 규격은 진단으로 쟀다 (§4.3 · 실행 73·74 · 2026-10-11):
//   · 외교부  1262000/OverviewPoliticService/getOverviewPoliticList — 국가 전체 목록이 온다(판정 0).
//   · KOTRA   B410001/kotra_nationalInformation/natnInfo/natnInfo — 필수 인자 isoWd2CntCd(ISO 2자리).
//     열쇠는 통과했고(결과코드 81 = 인자 없음) 칸 이름은 아직 모른다 — 그래서 받은 칸을 그대로 싣고,
//     요약에 칸 이름을 적는다. 칸을 지어 내지 않는다.
// ★★ 열쇠 값은 어디에도 안 남긴다 — 오류 글·주소는 가린다(§2 · 이 저장소는 공개다).
// ★★ 판정: 0 둘 다 받음 · 1 한쪽만/일부 · 2 둘 다 못 닿음 · 4 인증 거부 · 5 대답은 왔는데 비었다.

import { mkdir, writeFile, readFile } from 'node:fs/promises';

const OUT = 'data/country';
await mkdir(OUT, { recursive: true });

const pick = (...names) => { for (const n of names) { const v = String(process.env[n] || '').trim(); if (v) return { name: n, value: v }; } return null; };
const KEY_POL = pick('KOICA_GLOBAL_POLITICAL_DEVELOPMENTS', 'DATA_GO_KR_KEY');
const KEY_KOT = pick('KOICA_COUNTRY_INFORMATION', 'DATA_GO_KR_KEY');
const SECRETS = [KEY_POL, KEY_KOT].filter(Boolean).map((k) => k.value);
const mask = (s) => { let t = String(s ?? ''); for (const v of SECRETS) { t = t.split(v).join('***').split(encodeURIComponent(v)).join('***'); } return t; };

// 고르는 나라 — 사장님 프로젝트에 걸린 나라와 주변 시장. 바꾸려면 COUNTRIES="BD,VN" 로 준다.
const COUNTRIES = String(process.env.COUNTRIES || 'BD,VN,TH,ID,PH,MY,KH,MN,KZ,UZ,IN,SA,AE,US,JP,CN')
  .split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));

const log = [];
const say = (...ls) => { for (const s of ls) { const m = mask(s); console.log(m); log.push(m); } };

async function get(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return { reached: true, status: r.status, text: await r.text() };
  } catch (e) {
    return { reached: false, status: 0, text: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}

const AUTH_RE = /SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ACCESS DENIED|ApiKeyAuthFailed|INVALID_REQUEST_PARAMETER_ERROR|등록되지 않은 서비스키/i;
const itemsOf = (j) => {
  const it = j && j.response && j.response.body && j.response.body.items;
  const arr = it && (Array.isArray(it.item) ? it.item : it.item ? [it.item] : Array.isArray(it) ? it : []);
  return Array.isArray(arr) ? arr : [];
};
// 한 번의 대답을 갈래로 가른다 — 못 닿음(2) · 인증 거부(4) · 대답은 왔는데 비었다(5) · 받음(0)
function classify(r) {
  if (!r.reached) return { code: 2, why: `못 닿았다 — ${mask(r.text).slice(0, 120)}` };
  if (AUTH_RE.test(r.text)) return { code: 4, why: `인증 거부 (HTTP ${r.status}) — 열쇠·활용신청을 본다` };
  let j = null; try { j = JSON.parse(r.text); } catch (_) { /* JSON 이 아니면 아래 */ }
  if (!j) return { code: 5, why: `JSON 이 아니다 (HTTP ${r.status}) — 앞머리 «${mask(r.text).replace(/\s+/g, ' ').slice(0, 160)}»` };
  const items = itemsOf(j);
  if (!items.length) {
    const h = (j.response && j.response.header) || {};
    return { code: 5, why: `대답은 왔는데 항목이 없다 (결과 ${h.resultCode ?? '?'} ${h.resultMsg ?? ''})`.trim() };
  }
  return { code: 0, items };
}

let prev = null;
try { prev = JSON.parse(await readFile(`${OUT}/latest.json`, 'utf8')); } catch (_) { prev = null; }

// ① 외교부 정치현황 — 전체 목록을 쪽마다 받는다
const pol = { ok: false, code: KEY_POL ? 2 : 4, why: KEY_POL ? '' : '열쇠가 없다', items: [] };
if (KEY_POL) {
  for (let page = 1; page <= 5; page++) {
    const url = `https://apis.data.go.kr/1262000/OverviewPoliticService/getOverviewPoliticList?serviceKey=${encodeURIComponent(KEY_POL.value)}&pageNo=${page}&numOfRows=100&returnType=JSON`;
    const c = classify(await get(url));
    if (c.code !== 0) { if (page === 1) { pol.code = c.code; pol.why = c.why; } break; }
    pol.items.push(...c.items);
    if (c.items.length < 100) break;
  }
  if (pol.items.length) { pol.ok = true; pol.code = 0; }
}
const polByIso = new Map(pol.items.filter((x) => x && x.country_iso_alp2).map((x) => [String(x.country_iso_alp2).toUpperCase(), x]));

// ② KOTRA 국가정보 — 고른 나라마다
const kot = { got: 0, rows: {}, codes: {}, fields: new Set() };
for (const iso of COUNTRIES) {
  if (!KEY_KOT) { kot.codes[iso] = { code: 4, why: '열쇠가 없다' }; continue; }
  const url = `https://apis.data.go.kr/B410001/kotra_nationalInformation/natnInfo/natnInfo?serviceKey=${encodeURIComponent(KEY_KOT.value)}&isoWd2CntCd=${iso}&numOfRows=10&pageNo=1&type=json`;
  const c = classify(await get(url));
  if (c.code === 0) {
    kot.got++; kot.rows[iso] = c.items;
    for (const it of c.items) for (const k of Object.keys(it || {})) kot.fields.add(k);
    kot.codes[iso] = { code: 0 };
  } else kot.codes[iso] = { code: c.code, why: c.why };
}

// 결과 — 못 받은 쪽은 앞 결과를 덮지 않는다
const now = new Date().toISOString();
const countries = {};
for (const iso of COUNTRIES) {
  const p = polByIso.get(iso) || (prev && prev.countries && prev.countries[iso] && prev.countries[iso].politic) || null;
  const k = kot.rows[iso] || (prev && prev.countries && prev.countries[iso] && prev.countries[iso].kotra) || null;
  countries[iso] = { iso, name: (p && p.country_nm) || null, politic: p, kotra: k };
}
const result = {
  updatedAt: now,
  sources: {
    politic: { org: '외교부', service: '국가·지역별 정치현황', id: '15099537', ok: pol.ok, count: pol.items.length },
    kotra: { org: '대한무역투자진흥공사', service: '국가정보', id: '15034830', got: kot.got, of: COUNTRIES.length, fields: [...kot.fields] },
  },
  countries,
};
if (pol.ok || kot.got > 0) await writeFile(`${OUT}/latest.json`, JSON.stringify(result, null, 1) + '\n');

say(`- 열쇠: 정치현황 ${KEY_POL ? `\`${KEY_POL.name}\` (${KEY_POL.value.length}자)` : '**없음**'} · KOTRA ${KEY_KOT ? `\`${KEY_KOT.name}\` (${KEY_KOT.value.length}자)` : '**없음**'}`);
say(`- KOTRA 칸 이름: ${kot.fields.size ? [...kot.fields].map((x) => `\`${x}\``).join(' ') : '(받은 칸 없음)'}`, '');
say('| 나라 | 정치현황 | KOTRA |', '|---|---|---|');
for (const iso of COUNTRIES) {
  const kc = kot.codes[iso];
  say(`| ${iso} ${countries[iso].name || ''} | ${polByIso.has(iso) ? '받음' : '없음'} | ${kc.code === 0 ? `받음 (${kot.rows[iso].length}건)` : `판정 ${kc.code} — ${kc.why}`} |`);
}
// 판정 — 고칠 것이 있는 쪽이 이긴다(인증 거부 > 규격·비었음 > 못 닿음)
const kotCodes = Object.values(kot.codes).map((x) => x.code);
const parts = [pol.code, ...kotCodes];
let code;
if (pol.ok && kot.got === COUNTRIES.length) code = 0;
else if (pol.ok || kot.got > 0) code = 1;
else if (parts.includes(4)) code = 4;
else if (parts.includes(5)) code = 5;
else code = 2;
const MEAN = {
  0: '둘 다 받았다',
  1: '일부만 받았다 — 아래 표에서 어느 쪽·어느 나라가 빠졌는지 본다',
  2: '둘 다 못 닿았다 — 도는 자리(러너·NAS)를 본다. 열쇠 문제가 아니다',
  4: '열쇠가 없거나 거부됐다 — 아래 «열쇠» 줄과 표의 사유로 갈라 본다 (없으면 Secrets 이름 · 거부면 활용신청)',
  5: '대답은 왔는데 비었다 — 주소·인자 규격을 본다. 열쇠 문제가 아니다',
};

// 판정은 요약 «맨 앞»에 올린다 — 맨 끝에 적으면 아무도 안 본다 (§6-3 ①)
log.unshift(mask(`> **판정 ${code}** — ${MEAN[code]} (정치현황 ${pol.ok ? `${pol.items.length}개국` : `못 받음 · ${pol.why}`} · KOTRA ${kot.got}/${COUNTRIES.length}개국)`), '');
console.log(log[0]);
await writeFile(`${OUT}/_summary.md`, log.join('\n') + '\n');
console.error(`판정 ${code} — ${MEAN[code]}`);
process.exit(code);
