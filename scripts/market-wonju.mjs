// scripts/market-wonju.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// 원주시 시장근거 수집 — 지가지수·지가변동률
//
// 왜 기존 market-fetch.mjs 를 쓰지 않는가
//   그 스크립트는 상가 수익률·임대료·공실률을 받고, 대상 지역이 분당·성남으로 고정되어 있다.
//   송계리 담보물은 토지(창고용지·전)이고 지역이 원주시다. 표도 지역도 맞지 않는다.
//
// 표 식별자와 분류 규칙은 im-agent/connectors/reb.js 의 값을 그대로 따른다.
//   지가지수     A_2024_00901  — 시점수정은 이쪽
//   지가변동률   A_2024_00903  — 추이 표시용
//   지역 분류는 CLS_FULLNM 이 "시도>시군구" 2단계인 행만 쓴다.
//
// 시점수정 계수 = 지수(평가시점) ÷ 지수(공시기준월)
//   변동률을 곱해 누적하지 않는다. 구간 경계에서 한 달을 더 세는 실수가 생긴다.

import { mkdir, writeFile } from 'node:fs/promises';

const KEY = process.env.REB_API_KEY;
const OUT = 'data/market';
await mkdir(OUT, { recursive: true });

const log = [];
const P = (s = '') => { log.push(s); };
const save = async () => { await writeFile(`${OUT}/_wonju.md`, log.join('\n')); };

P('# 원주시 시장근거 — 지가지수·지가변동률');
P('');
P(`조회일 ${new Date().toISOString().slice(0, 10)}`);
P('');

if (!KEY) {
  P('## 중단 — REB_API_KEY 없음');
  P('');
  P('부동산원 키는 reb.or.kr 에서 따로 발급받는다.');
  P('공공데이터포털 키를 넣으면 ERROR-290 만 돌아온다.');
  await save();
  process.exit(1);
}

const BASE = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';
const TBL_INDEX  = { id: 'A_2024_00901', cycle: 'MM', item: null, name: '지가지수' };
const TBL_CHANGE = { id: 'A_2024_00903', cycle: 'MM', item: 100001, name: '지가변동률' };

// 공시기준월과 평가시점. 기준일이 바뀌면 여기만 고친다.
const BASE_MONTH = '202601';     // 개별공시지가 공시기준일 2026-01-01
const EVAL_MONTH = '202609';     // 검토 기준시점

function url(tbl, month, page) {
  const p = new URLSearchParams({
    KEY, Type: 'json', STATBL_ID: tbl.id, DTACYCLE_CD: tbl.cycle,
    START_WRTTIME: month, END_WRTTIME: month,
    pIndex: String(page), pSize: '1000',
  });
  if (tbl.item !== null) p.set('ITM_ID', String(tbl.item));
  return `${BASE}?${p}`;
}

async function fetchMonth(tbl, month) {
  const rows = [];
  let total = null;
  for (let p = 1; p <= 20; p++) {
    let body;
    try {
      const r = await fetch(url(tbl, month, p));
      const t = await r.text();
      try { body = JSON.parse(t); } catch { 
        P(`- \`${tbl.name} ${month} p${p}\` → JSON 이 아닌 응답 (HTTP ${r.status})`);
        return { ok: false, rows: [] };
      }
      if (body.RESULT) {
        P(`- \`${tbl.name} ${month}\` → ${body.RESULT.MESSAGE} (${body.RESULT.CODE})`);
        return { ok: false, rows: [] };
      }
    } catch {
      P(`- \`${tbl.name} ${month} p${p}\` → 네트워크 오류`);
      return { ok: false, rows: [] };
    }
    const blocks = body.SttsApiTblData || [];
    if (total === null) total = blocks[0]?.head?.[0]?.list_total_count ?? 0;
    const rr = blocks[1]?.row || [];
    rows.push(...rr);
    if (!rr.length || p * 1000 >= total) break;
  }
  P(`- \`${tbl.name} ${month}\` → ${rows.length}건 수신 (전체 ${total})`);
  return { ok: true, rows };
}

// 시도>시군구 2단계 행만 남긴다. 읍면동까지 두면 같은 이름이 여러 시도에서 겹친다.
function pickWonju(rows) {
  return rows.filter((x) => {
    const full = x.CLS_FULLNM || '';
    const parts = full.split('>');
    if (parts.length !== 2) return false;
    return parts[1].includes('원주');
  });
}

const result = { base: {}, eval: {}, adjust: null };

P('## 1. 지가지수');
P('');
for (const [tag, month] of [['base', BASE_MONTH], ['eval', EVAL_MONTH]]) {
  const r = await fetchMonth(TBL_INDEX, month);
  await writeFile(`${OUT}/reb_index_${month}.json`, JSON.stringify(r.rows, null, 2));
  if (!r.ok) continue;
  const hit = pickWonju(r.rows);
  if (!hit.length) { P(`  - ${month} 원주 행 없음 — 수집 실패로 기록`); continue; }
  const v = Number(hit[0].DTA_VAL);
  result[tag] = { month, clsId: hit[0].CLS_ID, full: hit[0].CLS_FULLNM, value: v };
  P(`  - ${month} · ${hit[0].CLS_FULLNM} · 지수 ${v}`);
}

P('');
P('## 2. 시점수정 계수');
P('');
if (result.base.value && result.eval.value) {
  const k = result.eval.value / result.base.value;
  result.adjust = { from: BASE_MONTH, to: EVAL_MONTH, factor: +k.toFixed(5),
                    pct: +((k - 1) * 100).toFixed(3) };
  P(`- ${BASE_MONTH} → ${EVAL_MONTH}`);
  P(`- 계수 **${k.toFixed(5)}** (${((k - 1) * 100).toFixed(3)}%)`);
  P('');
  P('> 계수 = 지수(평가시점) ÷ 지수(공시기준월). 변동률 누적이 아니다.');
} else {
  P('- **산출 불가** — 두 달 중 한쪽 지수를 받지 못했다.');
}

P('');
P('## 3. 지가변동률 (추이)');
P('');
{
  const r = await fetchMonth(TBL_CHANGE, EVAL_MONTH);
  await writeFile(`${OUT}/reb_change_${EVAL_MONTH}.json`, JSON.stringify(r.rows, null, 2));
  if (r.ok) {
    const hit = pickWonju(r.rows);
    if (hit.length) P(`  - ${EVAL_MONTH} · ${hit[0].CLS_FULLNM} · ${hit[0].DTA_VAL}%`);
    else P('  - 원주 행 없음 — 수집 실패로 기록');
  }
}

await writeFile(`${OUT}/wonju.json`, JSON.stringify(result, null, 2));

P('');
P('## 4. 보고서 반영 위치');
P('');
P('| 값 | 들어갈 곳 |');
P('|---|---|');
P('| 시점수정 계수 | 제4장 공시지가기준법 — 나. 시점수정 |');
P('| 지가변동률 | 제3장 인근 지가수준 |');
P('');
P('공표 통계이므로 가정치가 아니다. 신뢰등급 A로 기재한다.');

await save();
console.log(`완료 — ${OUT}/_wonju.md`);
