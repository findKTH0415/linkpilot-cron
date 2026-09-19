// scripts/routing-probe.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// 길찾기 소요시간 — **진단** 〈2026-09-19 · D-227〉
//   자동차: 카카오모빌리티 · 대중교통: ODsay
//
// ★★★ **왜 「진단」이지 「커넥터」가 아닌가** (CLAUDE.md §4 「진단부터 짠다」 · §4.3).
//   베이스 URL·인증 파라미터를 **모른다.** 추측으로 박으면 그것이 곧 거짓이 되고,
//   틀렸을 때 증상이 「열쇠가 틀렸다」와 **구분되지 않는다.** 그래서 이 스크립트는
//   ① 후보를 여럿 **순차로 걸어 보고** ② 응답 본문을 **200자 이상 그대로** 남기고
//   ③ 결과 코드·메시지를 요약에 적는다. 배선은 **그 값을 보고** 한다.
//   ★ R-ONE 은 이것을 안 해서 여섯 번 다시 썼다.
//
// ★★ **값은 한 글자도 안 남긴다** (§2). 이 저장소는 공개다 (D-10) —
//   `redact()` 를 지나가게 하고, 요약에는 **이름과 길이**만 적는다.
//
// ★ **열쇠 이름을 여럿 읽는다** — 갈리면 아무 오류도 안 나고 조용히 죽는다
//   (`ECOS_API_KEY`/`ECOS_BOK_KEY` · `LAW_OC`/`LAW_OPEN_DATA` 에서 두 번 당했다).
//   2026-09-19 에 사장님이 `KAKAO_MOBILITY_REST_API` 로 넣으셔서 세 번째가 됐다.

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { redact } = require('../im-agent/connectors/http');

const OUT = 'data/_api';
await mkdir(OUT, { recursive: true });

const log = [];
const P = (s = '') => { log.push(s); console.log(s); };

/** 열쇠 이름 여럿 중 먼저 든 것을 쓴다. 값은 안 돌려주고 **쓰는 자리에서만** 읽는다. */
function pick(names) {
  const n = names.find(x => (process.env[x] || '').trim());
  return n ? { name: n, value: String(process.env[n]).trim() } : null;
}

/* 공개 랜드마크 두 점 — 개인 주소를 안 쓴다 (§2). 서울시청 → 강남역 */
const FROM = { x: 126.9784, y: 37.5666, name: '서울시청' };
const TO = { x: 127.0276, y: 37.4979, name: '강남역' };

/**
 * 한 후보를 걸어 보고 **무엇이 왔는지 그대로** 돌려준다.
 * ★ 던지지 않는다 — 걸린 것이 곧 우리가 알고 싶은 것이다 (§4.6).
 */
async function probe(label, url, init) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    return {
      label, ok: r.ok, status: r.status, ms: Date.now() - t0,
      head: redact(body.replace(/\s+/g, ' ').trim().slice(0, 300)),
      server: r.headers.get('server') || null,
    };
  } catch (e) {
    return { label, ok: false, status: null, ms: Date.now() - t0, transport: String(e && e.message || e) };
  }
}

/* ★★★ **갈래를 가른다 — 값마다 사장님이 하실 일이 정반대다** (§12-24 의 그 규칙).
   0 값이 왔다 · 2 열쇠가 없다 · 3 못 닿았다 · 4 인증 거부 · 5 대답은 왔는데 값을 못 뽑았다 */
function verdictOf(rows) {
  if (!rows.length) return { code: 2, head: '열쇠가 없다 — 넣으시면 그날 잰다. 여기서 부른 적이 없다' };
  if (rows.some(r => r.gotValue)) return { code: 0, head: '**값이 왔다** — 이 후보로 배선한다' };
  if (rows.every(r => r.status == null)) {
    return { code: 3, head: '**못 닿았다** — 응답이 한 번도 안 왔다. '
      + '**열쇠 문제가 아니다** (다시 넣거나 신청하실 일이 아니다). 도는 자리를 옮겨 다시 잰다' };
  }
  if (rows.some(r => r.status === 401 || r.status === 403)) {
    return { code: 4, head: '**인증이 거부됐다** — 열쇠 자체이거나 **그 서비스 신청**이 안 된 것이다. '
      + '아래 응답 본문이 둘 중 어느 쪽인지 말해 준다' };
  }
  return { code: 5, head: '대답은 왔는데 **값을 못 뽑았다** — 주소·파라미터 규격이 다르다. '
    + '**열쇠 문제가 아니다.** 아래 본문을 보고 배선을 고친다' };
}

P('# 길찾기 소요시간 — 실측 진단');
P('');
P(`조회일 ${new Date().toISOString().slice(0, 10)} · ${FROM.name} → ${TO.name}`);
P('');
P('> 규격을 모르는 채 배선하지 않는다. 후보를 걸어 **무엇이 오는지부터** 본다 (CLAUDE.md §4).');
P('');

const results = {};

// ── 1. 자동차 — 카카오모빌리티 ────────────────────────────────
P('## 1. 자동차 — 카카오모빌리티');
P('');
const kakao = pick(['KAKAO_MOBILITY_REST_API', 'KAKAO_MOBILITY_KEY', 'KAKAOMOBILITY_KEY']);
const kRows = [];
if (!kakao) {
  P('- **열쇠 미설정** — 읽는 이름 셋 중 아무것도 안 들어왔다');
  P('  (`KAKAO_MOBILITY_REST_API` · `KAKAO_MOBILITY_KEY` · `KAKAOMOBILITY_KEY`)');
} else {
  P(`- 열쇠 **\`${kakao.name}\`** 로 읽었다 (길이 ${kakao.value.length}자 · 값은 안 적는다)`);
  P('');
  const auth = { headers: { Authorization: `KakaoAK ${kakao.value}` } };
  const q = `origin=${FROM.x},${FROM.y}&destination=${TO.x},${TO.y}`;
  for (const [label, url] of [
    ['apis-navi /v1/directions', `https://apis-navi.kakaomobility.com/v1/directions?${q}`],
    ['apis-navi /v1/future/directions', `https://apis-navi.kakaomobility.com/v1/future/directions?${q}&departure_time=202609200900`],
  ]) {
    const r = await probe(label, url, auth);
    /* ★ 「대답이 왔다」와 「값이 왔다」는 다른 사실이다 — 소요시간을 실제로 뽑았는지 본다 */
    r.gotValue = Boolean(r.ok && /"duration"\s*:\s*\d/.test(r.head || ''));
    kRows.push(r);
    P(`- \`${label}\` — ${r.status == null ? `**못 닿음** (${r.transport})` : `HTTP ${r.status}`} · ${r.ms}ms`);
    if (r.head) P(`  - 본문 «${r.head}»`);
    if (r.server) P(`  - 서버 ${r.server}`);
  }
}
results.kakao = { key: kakao ? kakao.name : null, rows: kRows };
const kv = verdictOf(kRows);
P('');
P(`> **판정 ${kv.code}** — ${kv.head}`);
P('');

// ── 2. 대중교통 — ODsay ──────────────────────────────────────
P('## 2. 대중교통 — ODsay');
P('');
const odsay = pick(['ODSAY_API_KEY', 'ODSAY_KEY']);
const oRows = [];
if (!odsay) {
  P('- **열쇠 미설정** — 읽는 이름 둘 중 아무것도 안 들어왔다 (`ODSAY_API_KEY` · `ODSAY_KEY`)');
} else {
  P(`- 열쇠 **\`${odsay.name}\`** 로 읽었다 (길이 ${odsay.value.length}자 · 값은 안 적는다)`);
  P('');
  /* ★ ODsay 는 콘솔이 주는 열쇠가 **인코딩된 것**일 수 있다 — 둘 다 걸어 본다 (§4.1 의 그 결) */
  for (const [label, k] of [['원본 그대로', odsay.value], ['한 번 디코딩', (() => {
    try { return decodeURIComponent(odsay.value); } catch (_) { return odsay.value; }
  })()]]) {
    if (label === '한 번 디코딩' && k === odsay.value) { P('- `한 번 디코딩` — 원본과 같아 건너뛴다'); continue; }
    const url = 'https://api.odsay.com/v1/api/searchPubTransPathT'
      + `?apiKey=${encodeURIComponent(k)}&SX=${FROM.x}&SY=${FROM.y}&EX=${TO.x}&EY=${TO.y}&output=json`;
    const r = await probe(label, url, {});
    r.gotValue = Boolean(r.ok && /"totalTime"\s*:\s*\d/.test(r.head || ''));
    oRows.push(r);
    P(`- \`${label}\` — ${r.status == null ? `**못 닿음** (${r.transport})` : `HTTP ${r.status}`} · ${r.ms}ms`);
    if (r.head) P(`  - 본문 «${r.head}»`);
  }
}
results.odsay = { key: odsay ? odsay.name : null, rows: oRows };
const ov = verdictOf(oRows);
P('');
P(`> **판정 ${ov.code}** — ${ov.head}`);
P('');

await writeFile(`${OUT}/routing-probe.json`, redact(JSON.stringify(results, null, 1)));

/* ★★ 판정을 요약 **맨 앞**에 올린다 (§6-3 ① · §12-36). 맨 끝은 아무도 안 본다.
   ★ 되돌아오는 값은 **둘 중 나쁜 쪽**이다 — 하나만 되면 그날 어떻게 가실지를
     앱이 대신 고른 것이 된다 (§4.9). */
const code = Math.max(kv.code, ov.code);
/* ★★★ **갈래 번호만 적지 않는다 — 뜻을 함께 적는다.** 「판정 3」만 보이면
   무엇을 하실지가 안 보이고, 그때 사장님은 **고칠 것이 없는 자리를 보러 가신다**
   (§4.6 「원인을 사람 말로 적는다」 · §12-24 의 그 규칙). 값마다 할 일이 정반대다. */
const MEAN = {
  0: '둘 다 값이 왔다 — 배선할 수 있다',
  2: '열쇠가 없다 — 넣으시면 그날 잰다',
  3: '못 닿았다 — **열쇠 문제가 아니다.** 도는 자리를 옮겨 다시 잰다',
  4: '인증이 거부됐다 — 열쇠이거나 그 서비스 신청이다',
  5: '대답은 왔는데 값을 못 뽑았다 — **규격**을 고친다. 열쇠 문제가 아니다',
};
const verdict = code === 0
  ? '판정 0 — **자동차·대중교통 둘 다 값이 왔다.** 배선할 수 있다'
  : `판정 ${code} — ${MEAN[code] || '판정하지 못했다'} `
    + `(자동차 ${kv.code} · 대중교통 ${ov.code}). 아래 갈래별 판정을 본다`;
log.unshift(`> ${verdict}`, '');

await writeFile(`${OUT}/routing-probe.md`, log.join('\n'));
console.log(`\n완료 — ${OUT}/routing-probe.md`);
// ★ 사람이 읽는 판정은 stderr 로도 낸다 — 요약이 stdout 만 받아 가는 자리가 있다 (§12-19)
if (code !== 0) console.error(verdict.replace(/\*\*/g, ''));
process.exit(code);
