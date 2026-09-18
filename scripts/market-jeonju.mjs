// scripts/market-jeonju.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// 전주시(여의동 893) 시장근거 수집 — 한국부동산원 지가지수·지가변동률
// market-wonju.mjs 와 같은 순서·같은 커넥터. 대상만 바꿨다.
//
// 왜 기존 market-fetch.mjs 를 쓰지 않는가
//   그 스크립트는 상가 수익률·임대료·공실률을 받고, 대상 지역이 분당·성남으로 고정되어 있다.
//   송계리 담보물은 토지(창고용지·전)이고 지역이 원주시다. 표도 지역도 맞지 않는다.
//
// 왜 조회를 새로 짜지 않는가
//   im-agent/connectors/reb.js 가 이미 같은 표를 부른다. 그 안에 이 저장소가
//   겪은 함정 셋이 주석과 방어코드로 박혀 있다 —
//     ① 시점수정은 변동률 누적이 아니라 지수 비로 낸다 (경계에서 한 달을 더 센다)
//     ② 지역코드 체계가 표마다 다르다. 색인은 조회할 표와 같은 표에서 만든다
//     ③ 지역을 못 찾으면 전국으로 조용히 대체하지 않는다
//   그래서 여기서는 부르는 순서만 정하고 계산은 커넥터에 맡긴다.

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// 커넥터가 키를 읽기 전에 .env 를 올린다 — 순서를 바꾸면 조용히 '미설정'이 된다.
process.env.IM_AGENT_CACHE = process.env.IM_AGENT_CACHE
  || path.join(os.tmpdir(), `lp-jeonju-${Date.now()}`);
require('../im-agent/core/env').load();

const reb = require('../im-agent/connectors/reb');

const OUT = 'data/market';
await mkdir(OUT, { recursive: true });

const log = [];
const P = (s = '') => { log.push(s); };
const save = async () => { await writeFile(`${OUT}/_jeonju.md`, log.join('\n')); };

// 대상과 기준. 기준일이 바뀌면 여기만 고친다.
const ADDRESS = '전북특별자치도 전주시 덕진구 여의동 893';
const BASE_MONTH = '202601';          // 개별공시지가 공시기준일 2026-01-01
const PROBE_BACK = 8;                 // 최신 공표월을 뒤에서부터 이만큼 찾아본다

P('# 전주시 시장근거 — 지가지수·지가변동률');
P('');
P(`조회일 ${new Date().toISOString().slice(0, 10)} · 대상 ${ADDRESS}`);
P('');

if (!reb.isAvailable()) {
  P('## 중단 — REB_API_KEY 없음');
  P('');
  P('부동산원 키는 reb.or.kr 에서 따로 발급받는다.');
  P('공공데이터포털 키를 넣으면 ERROR-290 만 돌아온다.');
  await save();
  process.exit(1);
}

/** YYYYMM 을 n 달 뒤로 민다 */
function shift(ym, n) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 최신 공표월을 찾는다.
 * ★ 평가시점을 이번 달로 박아 두면 아직 공표되지 않아 늘 빈손이 된다.
 *   전국 지수가 들어오는 가장 최근 달을 실제로 찾아 그 달을 쓴다.
 */
async function latestMonth(kind) {
  const now = new Date();
  let ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  for (let i = 0; i < PROBE_BACK; i++) {
    const r = kind === 'index'
      ? await reb.landIndex({ from: ym, to: ym })
      : await reb.landPriceChange({ from: ym, to: ym });
    if (r.ok && r.value.length) return { ok: true, month: ym, probed: i + 1 };
    ym = shift(ym, -1);
  }
  return { ok: false, error: `최근 ${PROBE_BACK}개월 안에 공표된 자료를 찾지 못했다` };
}

const result = {
  address: ADDRESS, baseMonth: BASE_MONTH,
  index: null, adjust: null, change: null, notes: [],
};

// ── 1. 지가지수와 시점수정 ──────────────────────────────────
P('## 1. 지가지수 · 시점수정');
P('');

const li = await latestMonth('index');
if (!li.ok) {
  P(`- **최신 공표월 확인 실패** — ${li.error}`);
  result.notes.push(li.error);
} else {
  P(`- 지가지수 최신 공표월 **${li.month}** (뒤에서 ${li.probed}번째로 확인)`);

  // ★ 색인은 조회할 표(지수표)와 같은 표에서 만든다.
  const rg = await reb.resolveRegion(ADDRESS, li.month, reb.TBL_LAND_INDEX);
  if (!rg.ok) {
    P(`- **지역 특정 실패** — ${rg.error}`);
    P('- 전국 값으로 대체하지 않는다. 지역 편차가 통째로 사라진다.');
    result.notes.push(rg.error);
  } else {
    P(`- 지역 **${rg.value.full}** (CLS_ID ${rg.value.clsId}${rg.candidates > 1 ? ` · 후보 ${rg.candidates}건` : ''})`);
    if (!/덕진/.test(rg.value.full)) P('- ※ 덕진구 단위가 아니라 위 지역 단위로 잡혔다. 커넥터 색인은 「시도>시군구」 두 단계만 받는다');

    const ta = await reb.timeAdjustment({
      clsId: rg.value.clsId, from: BASE_MONTH, to: li.month, expectRegion: rg.value.full,
    });
    if (!ta.ok) {
      P(`- **시점수정 산출 불가** — ${ta.error}`);
      result.notes.push(ta.error);
    } else {
      const v = ta.value;
      result.index = { region: v.region, clsId: v.clsId, baseIndex: v.baseIndex, lastIndex: v.lastIndex };
      result.adjust = { from: v.from, to: v.to, months: v.months, factor: v.factor, percent: v.percent };
      P('');
      P(`- ${v.from} 지수 ${v.baseIndex} → ${v.to} 지수 ${v.lastIndex}`);
      P(`- 시점수정 계수 **${v.factor}** (${v.percent >= 0 ? '+' : ''}${v.percent}% · 경과 ${v.months}개월)`);
      P('');
      P('> 계수 = 지수(평가시점) ÷ 지수(공시기준월). 변동률을 곱해 누적하지 않는다.');
      await writeFile(`${OUT}/jeonju_index_monthly.json`, JSON.stringify(v.monthly, null, 2));
    }
  }
}

// ── 2. 지가변동률 (추이) ────────────────────────────────────
P('');
P('## 2. 지가변동률 (추이)');
P('');

const lc = await latestMonth('change');
if (!lc.ok) {
  P(`- **최신 공표월 확인 실패** — ${lc.error}`);
  result.notes.push(lc.error);
} else {
  // ★ 변동률표는 지역코드 체계가 지수표와 다르다. 색인을 따로 만든다.
  const rg2 = await reb.resolveRegion(ADDRESS, lc.month, reb.TBL_LAND_PRICE);
  if (!rg2.ok) {
    P(`- **지역 특정 실패** — ${rg2.error}`);
    result.notes.push(rg2.error);
  } else {
    const ch = await reb.landPriceChange({ clsId: rg2.value.clsId, from: BASE_MONTH, to: lc.month });
    if (!ch.ok) {
      P(`- **조회 실패** — ${ch.error}`);
      result.notes.push(ch.error);
    } else {
      const rows = ch.value;
      result.change = { region: rg2.value.full, clsId: rg2.value.clsId, from: BASE_MONTH, to: lc.month, monthly: rows };
      P(`- 지역 **${rg2.value.full}** · ${rows[0].month} ~ ${rows[rows.length - 1].month} · ${rows.length}개월`);
      P('');
      P('| 월 | 변동률(%) |');
      P('|---|---:|');
      for (const r of rows) P(`| ${r.month} | ${r.rate} |`);
      P('');
      P('> 추이 표시용이다. 시점수정에는 쓰지 않는다.');
    }
  }
}

await writeFile(`${OUT}/jeonju.json`, JSON.stringify(result, null, 2));

// ── 3. 반영 위치 ────────────────────────────────────────────
P('');
P('## 3. 보고서 반영 위치');
P('');
P('| 값 | 들어갈 곳 |');
P('|---|---|');
P('| 시점수정 계수 | 가치검토 보고서 — 평가방법·시장시세 산정(시점수정) |');
P('| 지가변동률 추이 | 가치검토 보고서 — 외부 시장조사 |');
P('');
P('공표 통계이므로 가정치가 아니다. 신뢰등급 A로 기재한다.');
if (result.notes.length) {
  P('');
  P('## 4. 채우지 못한 것');
  P('');
  for (const n of result.notes) P(`- ${n}`);
}

await save();
console.log(`완료 — ${OUT}/_jeonju.md`);
