#!/usr/bin/env node
/**
 * 한국전력 전력데이터 개방포털 수집
 * 계통 여유용량 · 계약전력 추이 · 전기사용고객 증감
 *
 * API 규정집 v2.0 — ② GitHub Actions 레인
 *   · 인증키는 KEPCO_API_KEY 환경변수로만 받는다
 *   · 대상 지번은 KEPCO_SITE 시크릿으로 받는다 (공개 저장소에 노출하지 않음)
 *   · 행정코드는 공통코드 API 로 대조한다 (추정 금지)
 *   · 빈 응답은 「정상 0건 / 조건 미검증 / 수집 실패」로 나눠 적는다
 *
 * 종료 코드
 *   0 전부 수집   1 일부 수집   2 서버 미응답
 *   3 HTTP 5xx    4 인증 거부   5 행정코드 불일치
 *
 * 산출
 *   data/kepco/      시군구 단위 — 공개 공공데이터, 커밋 대상
 *   private/kepco/   지번 단위 — 대상지가 드러나므로 커밋하지 않고 아티팩트로만 보관
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'https://bigdata.kepco.co.kr/openapi/v1';
const PUB = 'data/kepco';
const PRIV = 'private/kepco';
const TODAY = new Date().toISOString().slice(0, 10);
const TIMEOUT = 40_000;

const KEY = (process.env.KEPCO_API_KEY || '').trim();
const MONTHS = Number(process.env.KEPCO_MONTHS || 24);
const PAUSE = Number(process.env.KEPCO_PAUSE || 400);

// 대상지 — 「시도|시군구|읍면동|리|번지」. 시크릿이 없으면 시군구 단위만 수집한다.
const SITE_RAW = (process.env.KEPCO_SITE || '').trim();
const [SIDO, SGG, LIDONG, LI, JIBUN] = SITE_RAW ? SITE_RAW.split('|').map(s => s.trim())
                                                : ['경기도', '김포시', '', '', ''];

if (!KEY) {
  console.error('KEPCO_API_KEY 시크릿이 없습니다. Settings → Secrets and variables → Actions 에 등록하십시오.');
  process.exit(4);
}
if (KEY.length !== 40) console.warn(`[경고] 인증키 길이가 ${KEY.length}자입니다. 개방포털 발급키는 40자입니다.`);

const mask = s => (KEY ? s.replaceAll(KEY, '***') : s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

/** 응답에서 리스트를 꺼낸다. data 또는 totData 에 담겨 온다. */
function rowsOf(obj) {
  if (!obj || typeof obj !== 'object') return [];
  for (const k of ['data', 'totData', 'list']) if (Array.isArray(obj[k])) return obj[k];
  return [];
}

const WORST = { OK: 0, EMPTY: 1, NET: 2, S5XX: 3, AUTH: 4, CODE: 5 };
let worst = 'OK';
const bump = s => { if (WORST[s] > WORST[worst]) worst = s; };

/** 개방포털 호출. { obj, status } 를 돌려준다. */
async function call(pathname, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  qs.set('apiKey', KEY);
  qs.set('returnType', 'json');
  const url = `${BASE}/${pathname}?${qs}`;
  const safe = mask(url);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'linkpilot-cron/kepco-fetch' },
        signal: AbortSignal.timeout(TIMEOUT),
      });

      if ([400, 401, 403, 404].includes(res.status)) {
        console.error(`  HTTP${res.status} ${safe} — 재시도하지 않습니다`);
        return { obj: null, status: res.status === 400 ? 'EMPTY' : 'AUTH' };
      }
      if (res.status >= 500) {
        console.warn(`  retry ${attempt}/3  HTTP${res.status}  ${safe}`);
        await sleep(3000 * attempt);
        if (attempt === 3) return { obj: null, status: 'S5XX' };
        continue;
      }

      const text = await res.text();
      let obj;
      try { obj = JSON.parse(text); }
      catch { console.error(`  FAIL  ${safe}\n        JSON 아님: ${text.slice(0, 180)}`); return { obj: null, status: 'NET' }; }

      const n = rowsOf(obj).length;
      if (!n) { console.log(`  EMPTY ${safe}  (응답은 받았으나 0건)`); return { obj, status: 'EMPTY' }; }
      console.log(`  OK    ${safe}  ${n}건`);
      return { obj, status: 'OK' };

    } catch (e) {
      console.warn(`  retry ${attempt}/3  ${e.name}: ${e.message}`);
      await sleep(3000 * attempt);
    }
  }
  console.error(`  FAIL  ${safe} — 3회 실패`);
  return { obj: null, status: 'NET' };
}

async function saveJson(dir, name, obj) {
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, name);
  const body = JSON.stringify(obj, null, 1);
  await fs.writeFile(p, body, 'utf8');
  const n = rowsOf(obj).length;
  console.log(`  saved ${p}  ${n}건  sha256:${sha(body)}`);
  return { 파일: p, 건수: n, sha256: sha(body) };
}

async function saveCsv(dir, name, rows) {
  if (!rows.length) return null;
  await fs.mkdir(dir, { recursive: true });
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const body = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n';
  const p = path.join(dir, name);
  await fs.writeFile(p, body, 'utf8');
  console.log(`  saved ${p}  ${rows.length}행  sha256:${sha(body)}`);
  return { 파일: p, 건수: rows.length, sha256: sha(body) };
}

/** 직전 완료월부터 n개월 거슬러 (year, month) 를 만든다. */
function months(n) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    d.setUTCMonth(d.getUTCMonth() - 1);
    out.push([String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0')]);
  }
  return out;
}

/**
 * 0단계 — 행정코드 대조.
 * 규격 화면 주석: 계약종별·산업분류별·분산전원연계 API 는 「법정동코드」를 쓴다.
 * 한전 자체코드는 부산이 21, 법정동코드는 26이라 서로 다르다. 추정하지 않는다.
 */
async function resolveCodes() {
  console.log('[0] 행정코드 대조 — 공통코드 API');

  const { obj: sidoObj, status: s1 } = await call('commonCode.do', { codeTy: 'lglDngMetroCd' });
  if (s1 !== 'OK') { console.error('  시도 코드를 받지 못했습니다.'); process.exit(s1 === 'AUTH' ? 4 : 2); }
  const sido = rowsOf(sidoObj).find(r => String(r.codeNm || '').includes(SIDO));
  if (!sido) { console.error(`  공통코드에 '${SIDO}' 가 없습니다.`); process.exit(5); }
  const metroCd = String(sido.code);
  console.log(`  시도   ${sido.codeNm} → metroCd=${metroCd}`);

  await sleep(PAUSE);
  const { obj: sggObj, status: s2 } = await call('commonCode.do', { codeTy: 'lglDngCityCd' });
  if (s2 !== 'OK') { console.error('  시군구 코드를 받지 못했습니다.'); process.exit(s2 === 'AUTH' ? 4 : 2); }
  const all = rowsOf(sggObj).filter(r => String(r.codeNm || '').includes(SGG));
  const hit = all.find(r => String(r.uppoCd ?? metroCd) === metroCd) || all[0];
  if (!hit) { console.error(`  공통코드에 '${SGG}' 가 없습니다.`); process.exit(5); }
  const cityCd = String(hit.code);
  console.log(`  시군구 ${hit.codeNm} → cityCd=${cityCd} (상위 ${hit.uppoCdNm ?? '-'})`);

  return { metroCd, cityCd, 시도: sido.codeNm, 시군구: hit.codeNm };
}

async function main() {
  const man = {
    조회일: TODAY,
    레인: 'GitHub Actions (API 규정집 v2.0)',
    증거등급: 'B — 공공 API',
    대상: SITE_RAW ? `${SIDO} ${SGG} ${LIDONG} ${LI} ${JIBUN}`.trim() : `${SIDO} ${SGG} (시군구 단위)`,
    코드: {},
    호출: [],
    산출: [],
  };
  // 공개 저장소에 커밋되는 manifest 에는 지번을 적지 않는다
  const manPublic = { ...man, 대상: `${SIDO} ${SGG}` };

  const codes = await resolveCodes();
  man.코드 = { ...codes, 조회방식: 'lglDngMetroCd / lglDngCityCd' };
  manPublic.코드 = man.코드;
  const { metroCd, cityCd } = codes;

  // 1) 지번 단위 계통 여유용량 — 비공개 폴더
  if (LIDONG && JIBUN) {
    console.log('\n[1] 분산전원연계 정보 — 지번 단위 (비공개)');
    const { obj, status } = await call('dispersedGeneration.do', {
      metroCd, cityCd, addrLidong: LIDONG, addrLi: LI, addrJibun: JIBUN,
    });
    bump(status);
    man.호출.push({ 항목: '분산전원연계(지번)', 상태: status });
    if (obj) {
      man.산출.push(await saveJson(PRIV, `dgen-site-${TODAY}.json`, obj));
      for (const r of rowsOf(obj).slice(0, 3)) {
        console.log(`    변전소 ${r.substNm} · 여유 vol1=${r.vol1} vol2=${r.vol2} vol3=${r.vol3}`);
      }
    }
    await sleep(PAUSE);
  } else {
    console.log('\n[1] 건너뜀 — KEPCO_SITE 시크릿이 없어 지번 조회를 하지 않습니다');
    man.호출.push({ 항목: '분산전원연계(지번)', 상태: 'SKIP' });
  }

  // 2) 시군구 단위 계통 여유용량 — 공개 폴더
  console.log('\n[2] 분산전원연계 정보 — 시군구 단위');
  {
    const { obj, status } = await call('dispersedGeneration.do', { metroCd, cityCd });
    bump(status);
    man.호출.push({ 항목: '분산전원연계(시군구)', 상태: status });
    manPublic.호출 = man.호출.filter(c => !c.항목.includes('지번'));
    if (obj) { const r = await saveJson(PUB, `dgen-sgg-${TODAY}.json`, obj); man.산출.push(r); manPublic.산출 = [r]; }
    await sleep(PAUSE);
  }

  // 3) 계약종별 전력사용량
  console.log(`\n[3] 계약종별 전력사용량 — 최근 ${MONTHS}개월`);
  {
    const rows = []; let empty = 0, last = 'OK';
    for (const [year, month] of months(MONTHS)) {
      const { obj, status } = await call('powerUsage/contractType.do', { year, month, metroCd, cityCd });
      last = status;
      if (status === 'OK') rows.push(...rowsOf(obj));
      else if (status === 'EMPTY') empty++;
      else { bump(status); break; }
      await sleep(PAUSE);
    }
    const st = rows.length ? 'OK' : (empty ? 'EMPTY' : last);
    bump(st === 'OK' ? 'OK' : st);
    man.호출.push({ 항목: '계약종별 전력사용량', 상태: st, 빈응답월: empty });
    const r = await saveCsv(PUB, 'contract-sgg.csv', rows);
    if (r) { man.산출.push(r); manPublic.산출 = [...(manPublic.산출 || []), r]; }
  }

  // 4) 산업분류별 전기사용고객 증감
  console.log(`\n[4] 산업분류별 전기사용고객 증감 — 최근 ${MONTHS}개월`);
  {
    const rows = []; let empty = 0, last = 'OK';
    for (const [year, month] of months(MONTHS)) {
      const { obj, status } = await call('change/custNum/industryType.do', { year, month, metroCd, cityCd });
      last = status;
      if (status === 'OK') rows.push(...rowsOf(obj));
      else if (status === 'EMPTY') empty++;
      else { bump(status); break; }
      await sleep(PAUSE);
    }
    const st = rows.length ? 'OK' : (empty ? 'EMPTY' : last);
    bump(st === 'OK' ? 'OK' : st);
    man.호출.push({ 항목: '산업분류별 고객 증감', 상태: st, 빈응답월: empty });
    const r = await saveCsv(PUB, 'custchange-sgg.csv', rows);
    if (r) { man.산출.push(r); manPublic.산출 = [...(manPublic.산출 || []), r]; }
  }

  manPublic.호출 = man.호출.filter(c => !c.항목.includes('지번'));
  await fs.mkdir(PUB, { recursive: true });
  await fs.writeFile(path.join(PUB, 'manifest.json'), JSON.stringify(manPublic, null, 1), 'utf8');
  await fs.mkdir(PRIV, { recursive: true });
  await fs.writeFile(path.join(PRIV, 'manifest.json'), JSON.stringify(man, null, 1), 'utf8');

  console.log('\n' + '─'.repeat(60));
  console.log(`조회일 ${TODAY} · 산출 ${man.산출.length}건`);
  for (const c of man.호출) console.log(`  ${String(c.상태).padEnd(6)} ${c.항목}`);
  console.log('─'.repeat(60));

  if (!man.산출.length) { console.error('수집 0건 — 인증키·승인상태·행정코드를 확인하십시오.'); process.exit(WORST[worst] || 1); }
  const partial = man.호출.some(c => !['OK', 'SKIP'].includes(c.상태));
  process.exit(partial ? Math.max(1, WORST[worst]) : 0);
}

main().catch(e => { console.error('예상치 못한 오류:', e); process.exit(2); });
