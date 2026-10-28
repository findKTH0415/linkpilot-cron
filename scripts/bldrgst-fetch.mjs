// scripts/bldrgst-fetch.mjs
// ↑ 이 파일의 첫 글자는 반드시 "//" 입니다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것입니다.
//
// 국토교통부_건축HUB_건축물대장정보 서비스
// 대상 : 경기도 성남시 분당구 금곡동 305-2  더헤리티지 커뮤니티동
// 목적 : 층별·호실별 법정 용도와 용도지역을 확정한다
//
// 지침서 6장 진단 우선 원칙 —
//   1) 무슨 일이 있어도 data/bldrgst/_summary.md 를 남긴다
//   2) 응답 원문을 먼저 저장한다
//   3) HTTP 상태와 resultCode·resultMsg 를 요약에 기록한다
//   4) 베이스 경로 후보를 순차 시도한다
//   5) 키는 로그에 찍지 않는다

import { mkdir, writeFile } from 'node:fs/promises';

const OUT = 'data/bldrgst';
await mkdir(OUT, { recursive: true });          // 무엇보다 먼저 폴더를 만든다

const log = [];
const P = (s = '') => { log.push(s); };
const save = async () => { await writeFile(`${OUT}/_summary.md`, log.join('\n')); };

P('# 건축물대장 조회 — 더헤리티지 커뮤니티동');
P();
P(`조회일 ${new Date().toISOString().slice(0, 10)}`);
P();

// ── 0. 키 확인 ─────────────────────────────────────────────
const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) {
  P('## 중단 — DATA_GO_KR_KEY 없음');
  P();
  P('워크플로의 `env:` 이름과 저장소 Secret 이름이 일치하는지 확인하십시오.');
  P();
  P('| 항목 | 값 |');
  P('|---|---|');
  P(`| 환경변수 중 KEY 포함 | ${Object.keys(process.env).filter(k => /KEY/i.test(k)).join(', ') || '없음'} |`);
  await save();
  console.error('DATA_GO_KR_KEY 없음 — _summary.md 참조');
  process.exit(1);
}
P(`키 길이 ${KEY.length}자 · 확인됨`);
P();

// ── 대상 필지 ──────────────────────────────────────────────
// 법정동코드 4113511100 = 경기도 성남시 분당구 금곡동
const PLAT = {
  sigunguCd: '41135',
  bjdongCd : '11100',
  platGbCd : '0',
  bun      : '0305',
  ji       : '0002',
};

P(`대상 성남시 분당구 금곡동 ${Number(PLAT.bun)}-${Number(PLAT.ji)}`);
P(`파라미터 sigunguCd=${PLAT.sigunguCd} bjdongCd=${PLAT.bjdongCd} bun=${PLAT.bun} ji=${PLAT.ji}`);
P();

const BASES = [
  'https://apis.data.go.kr/1613000/BldRgstHubService',
  'https://apis.data.go.kr/1613000/BldRgstService_v2',
];

const OPS = [
  ['getBrBasisOulnInfo',       '기본개요',      1],
  ['getBrRecapTitleInfo',      '총괄표제부',    2],
  ['getBrTitleInfo',           '표제부',        3],
  ['getBrFlrOulnInfo',         '층별개요',      4],
  ['getBrExposInfo',           '전유부',        5],
  ['getBrExposPubuseAreaInfo', '전유공용면적',  6],
  ['getBrJijiguInfo',          '지역지구구역',  7],
  ['getBrAtchJibunInfo',       '부속지번',      8],
];

// ── 1. 베이스 경로 판별 ────────────────────────────────────
let BASE = null;
for (const b of BASES) {
  const tag = b.split('/').pop();
  const q = new URLSearchParams({ ...PLAT, numOfRows: '5', pageNo: '1',
                                  _type: 'json', serviceKey: KEY });
  try {
    const r = await fetch(`${b}/getBrBasisOulnInfo?${q}`);
    const t = await r.text();
    await writeFile(`${OUT}/_probe_${tag}.txt`, t.slice(0, 4000));
    console.log(`시험 ${tag} HTTP ${r.status}`);
    if (r.status === 200 && !/SERVICE.*NOT.*FOUND|등록되지\s*않은|NOT_FOUND/i.test(t)) {
      BASE = b;
      P(`베이스 경로 확정 : \`${b}\``);
      P();
      break;
    }
  } catch (e) {
    console.log(`시험 오류 ${tag} ${String(e).slice(0, 80)}`);
  }
}
if (!BASE) {
  BASE = BASES[0];
  P('> 베이스 경로 자동 판별 실패. 첫 후보로 진행. `_probe_*.txt` 를 확인하십시오.');
  P();
}

// ── 2. 조회 ────────────────────────────────────────────────
const store = {};
/* 받음 · 공표(등재) 전 · 못 받음 — 셋을 갈라 센다 (§4) */
const got = [], empty = [], bad = [];

for (const [op, label, ord] of OPS) {
  const q = new URLSearchParams({ ...PLAT, numOfRows: '500', pageNo: '1',
                                  _type: 'json', serviceKey: KEY });
  let body = '', status = 0;
  try {
    const r = await fetch(`${BASE}/${op}?${q}`);
    status = r.status;
    body = await r.text();
  } catch (e) { body = `FETCH_ERROR ${String(e)}`; }

  await writeFile(`${OUT}/${op}.raw.txt`, body.slice(0, 30000));

  let items = [], head = {};
  try {
    const j = JSON.parse(body);
    head = j?.response?.header ?? {};
    const it = j?.response?.body?.items?.item;
    items = Array.isArray(it) ? it : it ? [it] : [];
    store[op] = items;
    await writeFile(`${OUT}/${op}.json`, JSON.stringify(j, null, 2));
  } catch {
    bad.push(`${label} (HTTP ${status} · 파싱 실패)`);
    P(`## ${ord}. ${label} (\`${op}\`)`);
    P();
    P(`HTTP ${status} · **JSON 파싱 실패**`);
    P();
    P('```');
    P(body.slice(0, 500));
    P('```');
    P();
    await save();
    continue;
  }

  P(`## ${ord}. ${label} (\`${op}\`)`);
  P();
  P(`HTTP ${status} · resultCode ${head.resultCode ?? '—'} · ${head.resultMsg ?? '—'} · **${items.length}건**`);
  /* ★ **셋으로 가른다** — 받음 · 대답했는데 그 필지에 자료가 없음 · 못 받음 (§4 의 셋째 갈래).
     0건은 **고칠 자리가 없는 갈래**라 실패로 세지 않는다. 뭉뚱그리면 날마다 빨개지고
     그 빨강이 뜻을 잃는다. */
  if (status !== 200 || (head.resultCode != null && String(head.resultCode) !== '00')) {
    bad.push(`${label} (HTTP ${status} · ${head.resultMsg ?? head.resultCode ?? '사유 없음'})`);
  } else if (items.length) got.push(label);
  else empty.push(label);
  P();

  if (op === 'getBrTitleInfo' && items.length) {
    for (const i of items) {
      P(`- 명칭 **${i.bldNm || '—'}** / 동명칭 ${i.dongNm || '—'}`);
      P(`- **주용도 : ${i.mainPurpsCdNm || '—'}**`);
      P(`- 기타용도 : ${i.etcPurps || '—'}`);
      P(`- 연면적 ${i.totArea || '—'}㎡ · 지상 ${i.grndFlrCnt || '—'}층 · 지하 ${i.ugrndFlrCnt || '—'}층`);
      P(`- 사용승인 ${i.useAprDay || '—'} · 구조 ${i.strctCdNm || '—'}`);
      P(`- **위반건축물 : ${i.violUseYn ?? i.vioalYn ?? '(필드없음 — raw 확인)'}**`);
      P();
    }
  }

  if (op === 'getBrFlrOulnInfo' && items.length) {
    P('| 층구분 | 층 | **주용도** | 기타용도 | 면적(㎡) | 구조 |');
    P('|---|---|---|---|---:|---|');
    for (const i of items) {
      P(`| ${i.flrGbCdNm || ''} | ${i.flrNoNm || ''} | **${i.mainPurpsCdNm || ''}** | ` +
        `${i.etcPurps || ''} | ${i.area || ''} | ${i.strctCdNm || ''} |`);
    }
    P();
  }

  if (op === 'getBrExposPubuseAreaInfo' && items.length) {
    const ex = items.filter((x) => (x.exposPubuseGbCdNm || '').includes('전유'));
    P(`전유 ${ex.length}건 / 전체 ${items.length}건`);
    P();
    P('| 호명 | 층 | **주용도** | 기타용도 | 면적(㎡) |');
    P('|---|---|---|---|---:|');
    for (const i of (ex.length ? ex : items).slice(0, 250)) {
      P(`| ${i.hoNm || ''} | ${i.flrNoNm || ''} | **${i.mainPurpsCdNm || ''}** | ` +
        `${i.etcPurps || ''} | ${i.area || ''} |`);
    }
    P();
  }

  if (op === 'getBrJijiguInfo' && items.length) {
    P('| 구분 | 지역·지구·구역명 | 비고 |');
    P('|---|---|---|');
    for (const i of items) {
      P(`| ${i.jijiguGbCdNm || ''} | **${i.jijiguCdNm || ''}** | ${i.etcJijigu || ''} |`);
    }
    P();
  }

  if (op === 'getBrRecapTitleInfo' && items.length) {
    for (const i of items) {
      P(`- 명칭 ${i.bldNm || '—'} / **주용도 ${i.mainPurpsCdNm || '—'}**`);
      P(`- 대지면적 ${i.platArea || '—'}㎡ · 연면적 ${i.totArea || '—'}㎡`);
      P(`- 주건축물수 ${i.mainBldCnt || '—'} · 부속건축물수 ${i.atchBldCnt || '—'}`);
      P();
    }
  }

  await save();   // 매 단계 저장 — 중간에 죽어도 여기까지는 남는다
}

// ── 3. 판정 보조 ───────────────────────────────────────────
const KEYWORDS = ['집회장', '예식장', '공연장', '전시장', '운동시설', '체력단련',
                  '수영장', '근린생활', '음식점', '판매시설', '노유자', '교육연구'];
const hits = {};
for (const [op, items] of Object.entries(store)) {
  for (const i of items) {
    const blob = `${i.mainPurpsCdNm || ''} ${i.etcPurps || ''}`;
    for (const k of KEYWORDS) {
      if (blob.includes(k)) {
        hits[k] ??= [];
        hits[k].push(`${op}:${i.flrNoNm || i.hoNm || ''}`);
      }
    }
  }
}

P('---');
P();
P('## 판정 보조 — 용도 키워드 검출');
P();
P('| 키워드 | 검출 | 위치 |');
P('|---|---|---|');
for (const k of KEYWORDS) {
  const v = hits[k];
  P(`| ${k} | ${v ? `**${v.length}건**` : '—'} | ${v ? v.slice(0, 6).join(', ') : ''} |`);
}
P();
P('### 읽는 법');
P();
P('- **집회장·예식장·운동시설·근린생활·음식점 검출** → 기존 용도 회복 성립 (시나리오 A)');
P('- **노유자시설만 검출** → 부대시설 구조 (시나리오 B). 외부 대상 영리 운영 불가');
P('- **표제부 위반건축물 표기 존재** → 기득권 주장 무너짐. 최우선 확인');
P('- **지역지구구역의 용도지역**이 보전녹지인지 제1종일반주거인지가 판정 분기를 가름');
P();

// ★★★ **초록이 「값이 왔다」를 뜻하게 한다** 〈2026-09-19 · D-226 · §12-24 · §12-36〉.
//   앞 판은 **열쇠가 없을 때만** 1 로 끝났다. 여덟 갈래가 전부 파싱 실패이거나
//   resultCode 가 오류여도 **초록**이라, 아무도 `_summary.md` 를 안 열어 본다.
//   ★ **셋으로 갈라 센다** — 받음 · 대답했는데 그 필지에 자료 없음 · 못 받음.
//     「자료 없음」은 **고칠 자리가 없는 갈래**라 실패로 세지 않는다 (§4 의 셋째 갈래).
//   ★★ 판정은 **요약 맨 앞**(§6-3 ①), **파일을 먼저 남긴 뒤에** 빨갛게 끝낸다 (§12-24).
const code = bad.length === 0 ? 0 : (got.length ? 1 : 2);
const verdict = code === 0
  ? `판정 0 — ${OPS.length} 갈래를 **전부 받았다** (자료 있음 ${got.length} · `
    + `대답했는데 그 필지에 자료 없음 ${empty.length} · 고칠 것 없음)`
  : code === 1
    ? `판정 1 — **${bad.length} 갈래를 못 받았다** (받음 ${got.length} · 자료 없음 ${empty.length}). `
      + `못 받은 것: ${bad.join(' · ')}`
    : `판정 2 — **한 갈래도 못 받았다** (${OPS.length} 갈래). 열쇠(DATA_GO_KR_KEY)·`
      + '활용신청·베이스 경로·그쪽 서버 중 하나다 — `_probe_*.txt` 와 아래 사유를 본다';
P('---');
P();
P(`> ${verdict}`);
log.unshift(`> ${verdict}`, '');

await save();
console.log('완료 — data/bldrgst/_summary.md');
// ★ 사람이 읽는 판정은 stderr 로도 낸다 — 요약이 stdout 만 받아 가는 자리가 있다 (§12-19)
if (code !== 0) console.error(verdict.replace(/\*\*/g, ''));
process.exit(code);
