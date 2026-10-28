// scripts/weather-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// `WEATHER_GO` 가 **어느 기관 것인가** — 진단 〈2026-09-20 · D-247〉
//
// ★★★ **왜 「진단」이지 「커넥터」가 아닌가** (CLAUDE.md §4 「진단부터 짠다」 · §4.3).
//   2026-09-13 에 사장님이 「WEATHER_GO 날씨정보 API 걸어 넣었어」로 넣으셨는데,
//   **어느 기관의 어느 서비스인지 아직 안 쟀다.** 이름이 `weather.go.kr` 을 가리키는
//   듯하지만 **그것은 짐작이고**, 기상청만 해도 열쇠를 받는 자리가 둘이다 —
//   **API허브**(`apihub.kma.go.kr` · `authKey`)와 **공공데이터포털**
//   (`apis.data.go.kr/1360000` · `serviceKey`). 인증 방식도 응답 규격도 다르다.
//   추측으로 배선하면 그것이 곧 거짓이 되고, 틀렸을 때 증상이 **「열쇠가 틀렸다」와
//   구분되지 않는다.** ★ R-ONE 은 이것을 안 해서 **여섯 번 다시 썼다.**
//
// ★★ **`KMA_APIHUB_KEY` 와 견주지 않는다.** 이 진단이 재는 것은 **`WEATHER_GO` 하나**가
//   어디서 받아들여지는가다. 다른 열쇠를 함께 걸면 **어느 열쇠가 통한 것인지** 흐려진다.
//
// ★ **값은 한 글자도 안 남긴다** (§2 · 이 저장소는 공개다 · D-10) — 공용 창구의
//   `redact()` 를 지나가고, 요약에는 **이름과 길이**만 적는다.
//
// ★★ 좌표·관측소는 **공개 기준점**을 쓴다 — 서울(격자 60,127 · 지점 108).

import { mkdir, writeFile } from 'node:fs/promises';
/* ★★★ 진단 창구는 **한 벌**이다 (§8-1 · D-247) — 판정 번호의 «뜻»이 갈리면
   같은 응답에 다른 사람 말이 붙고, 그 글이 틀린 곳을 가리킨다 (§4.6). */
import { redact, pick, probe, sayRow, verdictOf, MEAN } from './probe-lib.mjs';

const OUT = 'data/_api';
await mkdir(OUT, { recursive: true });

const log = [];
const P = (s = '') => { log.push(s); console.log(s); };

/* 기준 시각 — KST 기준 90분 전을 정시로 내린다.
   ★ 초단기실황은 **정시 자료가 40여 분 뒤에** 올라온다. 지금 시각으로 부르면
     「자료 없음」이 오고, 그것이 **「규격이 틀렸다」와 구분되지 않는다** (§8). */
const KST = new Date(Date.now() + 9 * 3600 * 1000 - 90 * 60 * 1000);
const p2 = (n) => String(n).padStart(2, '0');
const YMD = `${KST.getUTCFullYear()}${p2(KST.getUTCMonth() + 1)}${p2(KST.getUTCDate())}`;
const HH = p2(KST.getUTCHours());

/* 응답에 관측값이 실렸는가. 두 자리의 규격이 **서로 다르다** — 뭉뚱그리면 못 가른다 */
const HUB_VALUE = /#7777END|#START7777/;              // API허브 typ01 — 텍스트
const PORTAL_VALUE = /"obsrValue"|<obsrValue>/;        // 포털 JSON·XML 공통

/* ★★ **관측값이 «문자열»이라 숫자 칸 찾기(D-230)가 안 통한다.** 포털은 `obsrValue`
   를 `"12.3"` 처럼 따옴표로 준다 — `findFields` 는 **숫자 칸만** 담으므로 여기서는
   빈손이 되고, 그 빈손이 「이름이 다른 것이다」로 읽혀 **틀린 곳을 가리킨다.**
   그래서 **칸 찾기를 안 건다**(`null`)고 그 사실을 아래에 적는다 — 못 재는 것을
   재는 척하지 않는다 (§8). 경로는 본문 앞머리가 그대로 보여 준다. */
const NO_FIELDS = null;

P('# `WEATHER_GO` 가 어느 기관 것인가 — 실측 진단');
P('');
P(`조회일 ${new Date().toISOString().slice(0, 10)} · 기준 ${YMD} ${HH}00 (KST) · 서울`);
P('');
P('> 규격을 모르는 채 배선하지 않는다. 후보를 걸어 **무엇이 오는지부터** 본다 (CLAUDE.md §4).');
P('> ★ 관측값이 **문자열**이라 숫자 칸 찾기(D-230)는 **안 건다** — 경로는 본문 앞머리로 읽는다.');
P('');

const key = pick(['WEATHER_GO']);
const results = { key: key ? key.name : null, hub: [], portal: [] };

if (!key) {
  P('- **열쇠 미설정** — `WEATHER_GO` 가 이 자리에 안 들어왔다');
  P('');
  P('> **판정 2** — 열쇠가 없다. 넣으시면 그날 잰다');
  await writeFile(`${OUT}/weather-probe.md`, ['> 판정 2 — 열쇠가 없다', ''].concat(log).join('\n'));
  console.error('판정 2 — 열쇠가 없다 — 넣으시면 그날 잰다');
  process.exit(2);
}

P(`- 열쇠 **\`${key.name}\`** 로 읽었다 (길이 ${key.value.length}자 · 값은 안 적는다)`);
P('');

/* ★ 포털 열쇠는 **Decoding(일반) 인증키**여야 한다 — Encoding 키를 넣으면 한 번 더
   인코딩되어 **인증만 실패하고, 증상이 「키가 틀렸다」와 구분되지 않는다** (§4.1).
   그래서 **원본과 한 번 디코딩한 것을 둘 다** 걸어 본다. */
let decoded = key.value;
try { decoded = decodeURIComponent(key.value); } catch (_) { decoded = key.value; }

// ── 1. 기상청 API허브 (apihub.kma.go.kr · authKey) ─────────────
P('## 1. 기상청 **API허브** (`apihub.kma.go.kr` · `authKey`)');
P('');
for (const [label, url, valueRe] of [
  ['typ01 지상관측 kma_sfctm2',
    `https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php?tm=${YMD}${HH}00&stn=108&help=0&authKey=${encodeURIComponent(key.value)}`,
    HUB_VALUE],
  ['typ02 초단기실황 getUltraSrtNcst',
    'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst'
      + `?pageNo=1&numOfRows=10&dataType=JSON&base_date=${YMD}&base_time=${HH}00&nx=60&ny=127`
      + `&authKey=${encodeURIComponent(key.value)}`,
    PORTAL_VALUE],
]) {
  const r = await probe(label, url, {}, valueRe, NO_FIELDS);
  results.hub.push(r);
  sayRow(P, r, '관측값');
}
const hv = verdictOf(results.hub);
P('');
P(`> **판정 ${hv.code}** — ${hv.head}`);
P('');

// ── 2. 공공데이터포털 기상청 (apis.data.go.kr/1360000 · serviceKey) ──
P('## 2. **공공데이터포털** 기상청 (`apis.data.go.kr/1360000` · `serviceKey`)');
P('');
P('> ★ 이 호스트는 **러너에서 안 열릴 때가 있다** (D-206 · 2026-09-20 실측 재확인).');
P('> 그때 판정 3 은 **열쇠 문제가 아니다** — 도는 자리를 NAS 로 옮겨 다시 잰다.');
P('');
const base = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst'
  + `?pageNo=1&numOfRows=10&dataType=JSON&base_date=${YMD}&base_time=${HH}00&nx=60&ny=127`;
for (const [label, k] of [['원본 그대로', key.value], ['한 번 디코딩', decoded]]) {
  if (label === '한 번 디코딩' && k === key.value) { P('- `한 번 디코딩` — 원본과 같아 건너뛴다'); continue; }
  const r = await probe(label, `${base}&serviceKey=${encodeURIComponent(k)}`, {}, PORTAL_VALUE, NO_FIELDS);
  results.portal.push(r);
  sayRow(P, r, '관측값');
}
const pv = verdictOf(results.portal);
P('');
P(`> **판정 ${pv.code}** — ${pv.head}`);
P('');

await writeFile(`${OUT}/weather-probe.json`, redact(JSON.stringify(results, null, 1)));

/* ★★★ 되돌아오는 값은 **둘 중 «좋은» 쪽**이다 — 길찾기와 **반대**이고, 그것이 맞다.
   길찾기는 자동차·대중교통이 **둘 다 있어야** 그날 어떻게 가실지를 앱이 대신 안 고른다
   (§4.9). 여기는 **한 열쇠가 어디에 속하는지**를 묻는 것이라, **한 자리에서 받아들여지면
   답이 나온 것**이다. 나머지 한 자리가 거부하는 것은 **당연한 일**이지 고장이 아니다. */
const code = Math.min(hv.code, pv.code);
const where = hv.code === 0 ? '기상청 **API허브**' : (pv.code === 0 ? '**공공데이터포털** 기상청' : null);
const verdict = where
  ? `판정 0 — \`WEATHER_GO\` 는 ${where} 열쇠다. 그 규격으로 배선한다`
  : `판정 ${code} — ${MEAN[code] || '판정하지 못했다'} `
    + `(API허브 ${hv.code} · 포털 ${pv.code}). **어느 기관인지 아직 못 정했다** — 아래 본문을 본다`;
log.unshift(`> ${verdict}`, '');

await writeFile(`${OUT}/weather-probe.md`, log.join('\n'));
console.log(`\n완료 — ${OUT}/weather-probe.md`);
// ★ 사람이 읽는 판정은 stderr 로도 낸다 — 요약이 stdout 만 받아 가는 자리가 있다 (§12-19)
if (code !== 0) console.error(verdict.replace(/\*\*/g, ''));
process.exit(code);
