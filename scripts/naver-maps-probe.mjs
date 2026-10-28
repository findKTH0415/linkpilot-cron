// scripts/naver-maps-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// **네이버 클라우드 Maps** 열쇠가 먹는가 — 진단 〈2026-09-25 · D-314〉
//
// ★★★ **왜 「진단」이지 「커넥터」가 아닌가** (CLAUDE.md §4 「진단부터 짠다」 · §4.3).
//   사장님이 Maps 애플리케이션(Directions 5 · Directions 15 · Geocoding · Reverse Geocoding)을
//   등록하시고 Client ID · Client Secret 을 넣으셨다. 그런데 **넣으신 이름**도, 그 계정이
//   **어느 호스트**를 쓰는지도 아직 안 쟀다 — 네이버 클라우드는 Maps 호스트가
//   옛 것(`naveropenapi.apigw.ntruss.com`)과 새 것(`maps.apigw.ntruss.com`) 둘이다.
//   추측으로 배선하면 틀렸을 때 증상이 **「열쇠가 틀렸다」와 구분되지 않는다.**
//   ★ R-ONE 은 이것을 안 해서 **여섯 번 다시 썼다.**
//
// ★★ **이름을 여럿 읽는다** — 안내드린 이름(`NCP_MAPS_*`)과 다르게 넣으셨을 수 있고,
//   이름이 갈리면 **아무 오류도 안 나고 조용히 죽는다** (ECOS·LAW·KAKAO 에서 세 번 당했다).
//   어느 이름으로 읽었는지는 요약에 **이름과 길이만** 적는다.
//
// ★ **값은 한 글자도 안 남긴다** (§2 · 이 저장소는 공개다 · D-10) — 공용 창구의
//   `redact()` 를 지나가고, 열쇠는 **머리(header)** 에만 싣는다(주소에 안 싣는다).
//
// ★★ 좌표·주소는 **공개 기준점**을 쓴다 — 서울시청 → 강남역 (routing-probe 와 같은 두 점).

import { mkdir, writeFile } from 'node:fs/promises';
/* ★★★ 진단 창구는 **한 벌**이다 (§8-1 · D-247) */
import { redact, pick, probe, sayRow, verdictOf, MEAN } from './probe-lib.mjs';

const OUT = 'data/_api';
await mkdir(OUT, { recursive: true });

const log = [];
const P = (s = '') => { log.push(s); console.log(s); };

/* 읽는 이름 — **짝으로** 읽는다. ID 는 한 이름, Secret 은 다른 이름에서 오면
   서로 다른 애플리케이션의 짝이 섞여 **인증만 실패하고** 원인이 안 보인다. */
const ID_NAMES = ['NCP_MAPS_CLIENT_ID', 'NAVER_MAPS_CLIENT_ID', 'NAVER_MAP_CLIENT_ID', 'NAVER_CLIENT_ID'];
const SECRET_NAMES = ['NCP_MAPS_CLIENT_SECRET', 'NAVER_MAPS_CLIENT_SECRET', 'NAVER_MAP_CLIENT_SECRET', 'NAVER_CLIENT_SECRET'];

/** 같은 자리(순번)의 짝을 먼저 든 것부터 쓴다. 짝이 안 맞으면 «짝이 갈렸다»고 적는다. */
function pickPair() {
  for (let i = 0; i < ID_NAMES.length; i += 1) {
    const id = pick([ID_NAMES[i]]);
    const sec = pick([SECRET_NAMES[i]]);
    if (id && sec) return { id, sec, split: false };
  }
  const id = pick(ID_NAMES);
  const sec = pick(SECRET_NAMES);
  return id || sec ? { id, sec, split: true } : null;
}

const HOSTS = [
  ['새 호스트', 'https://maps.apigw.ntruss.com'],
  ['옛 호스트', 'https://naveropenapi.apigw.ntruss.com'],
];
/* 값이 왔는가 — 규격이 다르다. 좌표는 **문자열**("126.97…")이라 숫자 칸 찾기가 안 통한다 */
const GEO_VALUE = /"addresses":\s*\[\s*\{/;
const DIR_VALUE = /"duration":\s*\d/;
const DIR_FIELD = /^(duration|distance)$/;

P('# 네이버 클라우드 Maps — 실측 진단');
P('');
P(`조회일 ${new Date().toISOString().slice(0, 10)} · 서울시청 → 강남역`);
P('');
P('> 규격을 모르는 채 배선하지 않는다. 후보를 걸어 **무엇이 오는지부터** 본다 (CLAUDE.md §4).');
P('');

const pair = pickPair();
const results = { idName: pair && pair.id ? pair.id.name : null,
  secretName: pair && pair.sec ? pair.sec.name : null, geo: [], dir: [] };

if (!pair || !pair.id || !pair.sec) {
  const have = [...ID_NAMES, ...SECRET_NAMES].filter((n) => (process.env[n] || '').trim());
  P(`- **열쇠 미설정** — 읽는 이름: ID ${ID_NAMES.join(' · ')} / Secret ${SECRET_NAMES.join(' · ')}`);
  P(`- 들어온 이름: ${have.length ? have.join(' · ') : '(하나도 없다)'}`);
  P('');
  P('> **판정 2** — 열쇠(짝)가 없다. **넣으신 이름이 위 목록에 없을 수 있다** — 이름을 알려 주시면 읽는 목록에 더한다');
  await writeFile(`${OUT}/naver-maps-probe.md`, ['> 판정 2 — 열쇠(짝)가 없다', ''].concat(log).join('\n'));
  console.error('판정 2 — 열쇠(짝)가 없다 — 넣으신 이름이 읽는 목록에 없을 수 있다');
  process.exit(2);
}

P(`- Client ID **\`${pair.id.name}\`** (길이 ${pair.id.value.length}자) · Client Secret **\`${pair.sec.name}\`** (길이 ${pair.sec.value.length}자) — 값은 안 적는다`);
if (pair.split) P('- ★ **두 이름이 짝이 아니다** — 다른 애플리케이션의 값이 섞였을 수 있다. 거부되면 먼저 이것을 본다');
P('');

/* ★ 머리 이름은 대소문자를 안 가린다(HTTP 규격). 콘솔 안내의 두 표기 중 하나로 싣는다 */
const headers = { 'x-ncp-apigw-api-key-id': pair.id.value, 'x-ncp-apigw-api-key': pair.sec.value };

P('## 1. Geocoding (주소 → 좌표)');
P('');
for (const [label, host] of HOSTS) {
  const url = `${host}/map-geocode/v2/geocode?query=${encodeURIComponent('서울특별시 중구 세종대로 110')}`;
  const r = await probe(`${label} geocode`, url, { headers }, GEO_VALUE, null);
  results.geo.push(r);
  sayRow(P, r, '좌표');
}
const gv = verdictOf(results.geo);
P('');
P(`> **판정 ${gv.code}** — ${gv.head}`);
P('');

P('## 2. Directions 5 (자동차 소요시간)');
P('');
P('> ★ 소요시간은 **밀리초**로 오는 규격으로 알려져 있다 — 배선 전에 칸 값으로 다시 잰다.');
P('');
for (const [label, host] of HOSTS) {
  const url = `${host}/map-direction/v1/driving?start=126.9779692,37.566535&goal=127.0276368,37.4979502`;
  const r = await probe(`${label} driving`, url, { headers }, DIR_VALUE, DIR_FIELD);
  results.dir.push(r);
  sayRow(P, r, '소요시간');
}
const dv = verdictOf(results.dir);
P('');
P(`> **판정 ${dv.code}** — ${dv.head}`);
P('');

await writeFile(`${OUT}/naver-maps-probe.json`, redact(JSON.stringify(results, null, 1)));

/* ★★ 되돌아오는 값은 **둘 중 나쁜 쪽**이다 — 등록하신 넷 중 둘을 쟀으므로 하나라도
   막히면 그 사실이 판정에 남아야 한다 (routing-probe 와 같은 쪽). 0 이 아닌 쪽의 뜻을 적는다. */
const code = Math.max(gv.code, dv.code);
const verdict = code === 0
  ? '판정 0 — Geocoding · Directions 5 둘 다 값이 왔다. 그 호스트로 배선할 수 있다'
  : `판정 ${code} — ${MEAN[code] || '판정하지 못했다'} (Geocoding ${gv.code} · Directions ${dv.code})`;
log.unshift(`> ${verdict}`, '');

await writeFile(`${OUT}/naver-maps-probe.md`, log.join('\n'));
console.log(`\n완료 — ${OUT}/naver-maps-probe.md`);
if (code !== 0) console.error(verdict.replace(/\*\*/g, ''));
process.exit(code);
