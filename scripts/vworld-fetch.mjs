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
/* ★★★ **근거를 따로 모은다 — 요약은 «파일»이고 사장님이 보시는 것은 «실행 요약»이다**
 *   〈D-218 이음〉. 본문을 되살렸는데 그것이 `_summary.md` 안에만 있었다 —
 *   그리고 작업 가지에서는 그 파일이 **커밋도 안 된다**(D-213 이음). 곰
 *   **아티팩트를 받지 않으면 아무도 못 본다.**
 * ★ 「만들었다」와 「닿는다」는 다른 사실이다 (§8 · §12-19 의 그 자리). */
const evidence = [];

for (const lot of LOTS) {
  const g = await vworld.geocode(lot.address);
  if (!g.ok) {
    P(`- **${lot.label}** 지오코딩 실패 — ${g.error}`);
    if (g.hint) P(`  - ${g.hint}`);
    // ★★★ **응답 본문 앞머리를 적는다** 〈D-218〉 — 「그 5xx 를 누가 냈는가」는
    //   본문 없이 못 가른다. 예전에는 `HTTP 502` 글자만 남아, 기관 게이트웨이와
    //   중간 프록시가 **같은 모습**이었다 — 할 일은 정반대인데.
    // ★ 본문을 못 받았으면 **그 줄을 아예 안 적는다** — 빈 줄은 「본문이 비었다」로
    //   읽혀 또 다른 거짓이 된다 (§8 「못 잼을 통과로 적지 않는다」).
    // ★★★ **헤더도 함께 적는다** 〈D-219〉 — 그 502 본문에는 서버 서명이 없었다.
    //   `Server` 한 줄이면 대개 갈리고, `Via`·`X-Cache` 가 있으면 **중간이 끼었다**는 표다.
    //   ★ 본문과 «따로» 센다 — 본문이 비어도 헤더는 올 수 있고 그 반대도 있다.
    //     하나라도 있으면 그 줄을 적고, 둘 다 없으면 아무 줄도 안 적는다.
    for (const a of (g.attempts || [])) {
      const who = `${a.type}${a.httpStatus ? ' · HTTP ' + a.httpStatus : ''}`;
      if (a.bodyHead) {
        P(`  - 그쪽이 돌려준 본문(${who}): \`${a.bodyHead}\``);
        evidence.push(`${lot.label} ${who} 본문: ${a.bodyHead}`);
      }
      if (a.headHdr) {
        P(`  - 그쪽이 돌려준 헤더(${who}): \`${a.headHdr}\``);
        evidence.push(`${lot.label} ${who} 헤더: ${a.headHdr}`);
      }
    }
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

/* ★★★ **판정을 갈라 돌려준다 — 「0/5 인데 초록」을 막는다** 〈2026-09-17 · D-213〉.
 *
 *   [무엇이 났나] 앞 판은 `problems` 를 §4 에 **적기만** 하고 종료 코드가 늘 0 이었다.
 *   그래서 **5필지 전부 실패한 실행이 초록으로 끝났다**(실측: `fetch failed` 3 ·
 *   `HTTP 502` 2). 초록이라 아무도 안 열어 보고, 정작 하려던 수집은 한 번도 안 됐다.
 *   §4 의 `kasi.year()` 가 「못 받았다」와 「아직 공표 전」을 같은 글자로 냈던 것과
 *   **같은 고장**이다 — 뭉뚱그리면 할 일이 정반대인 것들이 한 값으로 묻힌다.
 *
 * ★ [갈래 넷] 되돌아오는 값이 사장님이 하실 일을 가른다.
 *     0 — 5/5 받았다 (지도 일부 실패는 경고로만)
 *     1 — 일부만 받았다 (1~4필지) · 어느 필지가 왜 빠졌는지 §4 에 있다
 *     2 — **못 쟀다** — 전부 응답이 없었다. 이 자리의 나가는 길이 막힌 것이고
 *         **열쇠·도메인·활용신청 문제가 아니다** (§4 「못 닿음을 승인 안 됨으로
 *         적지 않는다」와 같은 규칙). 도는 자리를 옮겨 다시 잰다.
 *     3 — 전부 실패했고 **서버가 대답했다** — 그때는 도메인·활용신청을 본다.
 *
 * ★★ **「대답이 왔다」가 곧 「닿았다」다.** 그 하나가 갈래 2 와 3 을 가르고,
 *   할 일이 **자리를 옮기는 일**과 **콘솔을 여는 일**로 정반대가 된다.
 * ★★★ **판정은 요약 «맨 앞»에 넣는다** (§6-3 ①). §4 맨 끝에 적으면 안 읽힌다 —
 *   실제로 앞 판이 그 자리에 적고 있었고, 아무도 못 봤다.
 */
const UNREACHED = /fetch failed|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|ECONNRESET|응답 없음|네트워크/i;
const ANSWERED = /HTTP \d{3}|VWorld [A-Z_]+|INVALID_KEY|INCORRECT_KEY|결과가 없|NOT_FOUND|권한|인증/i;
/* ★★★ **「서버가 대답했다」 안에 갈래 셋이 또 있다 — 할 일이 전부 다르다**
 *   〈2026-09-17 · 실측으로 드러났다〉.
 *
 *   앞 판은 「대답이 왔다」를 한 덩어리로 보고 **「콘솔의 서비스URL·활용신청을 보라」**
 *   하나만 가리켰다. 그런데 실측 응답은 `fetch failed` 10 · **`HTTP 502` 6** 이고
 *   **인증 거부(`INVALID_KEY`·권한)는 0건**이었다 — 열쇠가 틀렸으면 VWorld 는
 *   `INVALID_KEY` 를 준다. **502 는 그쪽 게이트웨이**다.
 *   그 상태로 콘솔을 여시게 하면 **거기에는 고칠 것이 없다** (§4.6 · §12-11 의 그 잣대).
 *
 * ★ 그래서 셋으로 가른다 —
 *     `5xx`            그쪽 서버가 지금 못 받는다 → **우리 쪽에 고칠 것이 없다.** 기다렸다 다시
 *     인증·권한        도메인·활용신청 → 콘솔을 본다
 *     결과 없음        주소 미매칭 → 주소를 본다
 * ★★ **섞이면 「고칠 것이 있는 쪽」을 먼저 가리킨다** — 인증 > 주소 > 5xx.
 *   5xx 를 먼저 말하면 「기다리면 된다」로 읽혀 진짜 고칠 것이 묻힌다.
 */
const SERVER5XX = /HTTP 5\d{2}/;
const AUTHDENY = /INVALID_KEY|INCORRECT_KEY|권한|인증|UNAUTHORIZED|등록되지/i;
const NOMATCH = /결과가 없|NOT_FOUND|no result|좌표\(result\.point\)가 없다/i;

const unreached = problems.filter((t) => UNREACHED.test(t)).length;
const answered = problems.filter((t) => ANSWERED.test(t)).length;
const s5xx = problems.filter((t) => SERVER5XX.test(t)).length;
const deny = problems.filter((t) => AUTHDENY.test(t)).length;
const nomatch = problems.filter((t) => NOMATCH.test(t)).length;

let code = 0;
let verdict;
if (parcels.length === LOTS.length) {
  verdict = `✅ **수집 ${parcels.length}/${LOTS.length}필지** — 전부 받았다`;
} else if (parcels.length > 0) {
  code = 1;
  verdict = `⚠️ **수집 ${parcels.length}/${LOTS.length}필지 — 일부만 받았다.**`
    + ' 어느 필지가 왜 빠졌는지는 아래 §4 에 있다';
} else if (deny > 0) {
  code = 4;
  verdict = `❌ **0/${LOTS.length}필지 — 서버가 «인증을 거부»했다** (${deny}건).`
    + ' 볼 것은 둘이다 — ① VWorld 콘솔의 서비스URL 과 `VWORLD_DOMAIN` 이 글자까지'
    + ' 같은지 ② 그 키의 활용 API 목록에 **지오코더**가 있는지';
} else if (nomatch > 0) {
  code = 5;
  verdict = `❌ **0/${LOTS.length}필지 — 인증은 통과했고 «주소가 안 맞았다»** (${nomatch}건).`
    + ' **열쇠 문제가 아니다** — 주소 표기를 본다';
} else if (s5xx > 0) {
  code = 3;
  verdict = `❌ **0/${LOTS.length}필지 — VWorld 쪽 서버가 지금 못 받는다** (HTTP 5xx ${s5xx}건).`
    + ' 인증 거부는 **0건**이므로 **열쇠·도메인·활용신청 문제가 아니고, 우리 쪽에 고칠 것이'
    + ' 없다.** 시간을 두고 다시 걸어 본다';
} else if (unreached > 0) {
  code = 2;
  verdict = `❌ **못 쟀다 — 0/${LOTS.length}필지 · 서버가 한 번도 대답하지 않았다**`
    + ' (응답 없음). 이 자리의 나가는 길이 막힌 것이고 **열쇠·도메인·활용신청 문제가'
    + ' 아니다.** 도는 자리를 옮겨 다시 잰다';
} else {
  code = 2;
  verdict = `❌ **못 쟀다 — 0/${LOTS.length}필지 · 사유를 못 받았다.**`
    + ' 무엇이 막았는지 지어내지 않는다 — 아래 §4 의 원문을 본다';
}

/* ★ 요약 맨 앞(제목·조회일 바로 뒤)에 끼워 넣는다 */
log.splice(4, 0, '', verdict, '',
  `- 못 닿음 ${unreached}건 · 서버가 대답 ${answered}건`
  + ` (그 안에서 — 5xx ${s5xx} · 인증거부 ${deny} · 주소 미매칭 ${nomatch})`, '');

await save();
/* ★★ 판정을 **stdout 으로도** 낸다 — 워크플로가 이것을 요약에 나른다.
 *   §12-19 에서 배운 자리다: 도구가 갈라 줘도 **나르는 자리가 버리면** 사장님 화면에는
 *   한 줄도 안 온다. 「만들었다」와 「닿는다」는 다른 사실이다. */
console.log(`LP_VWORLD verdict=${code}`);
console.log(verdict.replace(/\*\*/g, ''));
/* ★★★ **걸렸으면 근거를 함께 낸다** — 판정만 나르면 「왜 그렇게 판정했는지」를
 *   보려면 아티팩트를 받아 압축을 푸셔야 한다. 그러면 아무도 안 본다.
 * ★ 본문을 못 받았으면 그 줄을 **아예 안 찍는다** — 빈 줄은 「본문이 비었다」로
 *   읽혀 또 다른 거짓이 된다 (§8). */
if (code !== 0 && evidence.length) {
  console.log('— 그쪽이 돌려준 본문 (이것이 위 판정의 근거다):');
  for (const e of evidence) console.log(`  · ${e}`);
}
console.log(`완료 — ${OUT}/_summary.md`);
process.exit(code);
