#!/usr/bin/env node
'use strict';
/**
 * smoke-public-data.js — 공공데이터 API 실측 진단.
 *
 * 목적: Connector 가 기대하는 필드명이 **실제 응답과 같은지** 확인한다.
 *   엔드포인트·파라미터는 공식 문서 기준으로 작성했지만 응답 필드명이 다를 수 있고,
 *   그러면 조회는 성공하는데 값이 전부 null 로 들어온다 — 가장 잡기 어려운 종류의 오류다.
 *
 * 실행:
 *   VWORLD_KEY=... DATA_GO_KR_KEY=... node im-agent/tools/smoke-public-data.js
 *   VWORLD_KEY=... node im-agent/tools/smoke-public-data.js --address "인천광역시 남동구 ..."
 *
 * ★ 키를 인자로 넘기지 않는다. 환경변수로만 받는다 (셸 히스토리에 남지 않게).
 * ★ 키는 출력에 절대 찍지 않는다.
 * ★ 이 스크립트는 아무것도 저장하지 않는다. 캐시도 임시 폴더를 쓴다.
 */

const os = require('os');
const path = require('path');

process.env.IM_AGENT_CACHE = process.env.IM_AGENT_CACHE
  || path.join(os.tmpdir(), `lp-smoke-${Date.now()}`);

const vworld = require('../connectors/vworld');
const nsdi = require('../connectors/nsdi');
const molit = require('../connectors/molit');
const pnuUtil = require('../connectors/pnu');
const geometry = require('../geo/geometry');

const ADDRESS = argOf('--address') || '인천광역시 남동구 남동대로 215';
const results = [];

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

function report(name, ok, detail, expectedFields = null, raw = null) {
  results.push({ name, ok });
  console.log(`\n${ok ? '●' : '✕'} ${name}`);
  console.log(`  ${detail}`);

  // 필드명 대조 — 조회는 됐는데 값이 null 이면 여기서 원인이 드러난다
  if (expectedFields && raw) {
    const actual = Object.keys(raw);
    const missing = expectedFields.filter(f => !(f in raw));
    console.log(`  실제 응답 필드(${actual.length}개): ${actual.slice(0, 14).join(', ')}${actual.length > 14 ? ' …' : ''}`);
    if (missing.length) {
      console.log(`  ⚠ Connector 가 기대하지만 없는 필드: ${missing.join(', ')}`);
      console.log('    → 이 필드명을 실제 응답에 맞게 고쳐야 값이 채워진다');
    } else {
      console.log('  ✓ 기대 필드가 모두 존재한다');
    }
  }
}

async function main() {
  console.log('공공데이터 API 실측 진단');
  console.log('─'.repeat(60));
  console.log(`대상 주소 : ${ADDRESS}`);
  console.log(`VWORLD_KEY     : ${vworld.isAvailable() ? '설정됨' : '미설정 — 지오코딩/지적/공시지가 건너뜀'}`);
  console.log(`VWORLD_DOMAIN  : ${vworld.domain() || '미설정 ⚠ 서버 호출은 등록 도메인을 명시해야 허용된다'}`);
  console.log(`DATA_GO_KR_KEY : ${molit.isAvailable() ? '설정됨' : '미설정 — 실거래가/건축물대장 건너뜀'}`);

  let lat = null, lon = null, parsedPnu = null;

  // ── 1. 지오코딩 ────────────────────────────────────────
  if (vworld.isAvailable()) {
    const g = await vworld.geocode(ADDRESS);
    if (g.ok) {
      ({ lat, lon } = g.value);
      report('VWorld 지오코딩', true, `좌표 ${lat}, ${lon} (${g.value.matchedType})`);
    } else {
      report('VWorld 지오코딩', false, g.error);
      console.log('  ※ VWorld 키는 신청 시 등록한 도메인에서만 동작한다.');
      console.log('    서버에서 호출하려면 콘솔에서 서버 IP/도메인을 등록하거나');
      console.log('    VWORLD_DOMAIN 환경변수에 등록된 도메인을 넣어야 한다.');
    }
  }

  // ── 2. 필지(지적도) ────────────────────────────────────
  if (lat !== null) {
    const p = await vworld.parcelAt(lon, lat);
    if (p.ok) {
      const areaCalc = p.value.polygon.length >= 3 ? geometry.polygonAreaSqm(p.value.polygon) : null;
      report('VWorld 연속지적도', true,
        `PNU ${p.value.pnu} · 공부면적 ${p.value.officialAreaSqm}㎡ · 폴리곤 ${p.value.polygon.length}점`
        + (areaCalc ? ` · 실측 ${Math.round(areaCalc)}㎡` : ''));
      if (p.value.pnu) {
        parsedPnu = pnuUtil.parse(p.value.pnu);
        console.log(`  PNU 분해: 시군구 ${parsedPnu.sigunguCd} · 법정동 ${parsedPnu.bjdongCd} · 지번 ${parsedPnu.jibun}`);
      }
      if (!p.value.officialAreaSqm) {
        console.log('  ⚠ 공부상 면적이 비었다 — 응답의 면적 필드명 확인 필요 (lndpcl_ar 등)');
      }
    } else {
      report('VWorld 연속지적도', false, p.error);
    }
  }

  // ── 3. 개별공시지가 ────────────────────────────────────
  if (parsedPnu && nsdi.isAvailable()) {
    const lp = await nsdi.landPrice(parsedPnu.pnu);
    if (lp.ok) {
      report('개별공시지가 (VWorld NED)', true, `${lp.value.year}년 ${lp.value.pricePerSqm?.toLocaleString('ko-KR')}원/㎡`);
      if (!lp.value.pricePerSqm) {
        console.log('  ⚠ 가격이 비었다 — 필드명 확인 (pblntfPclnd / pblntf_pclnd)');
      }
    } else {
      report('개별공시지가 (VWorld NED)', false, lp.error);
    }
  }

  // ── 4. 토지이용계획 ────────────────────────────────────
  if (parsedPnu && nsdi.isAvailable()) {
    const lu = await nsdi.landUse(parsedPnu.pnu);
    if (lu.ok) {
      report('토지이용계획 (VWorld NED)', true,
        `용도지역 ${lu.value.zone}` + (lu.value.limits ? ` · 용적률 ${lu.value.limits.far}% / 건폐율 ${lu.value.limits.bcr}%` : ' · 법정한도 테이블 미매칭'));
      if (!lu.value.limits) {
        console.log(`  ⚠ '${lu.value.zone}' 가 ZONE_LIMITS 테이블에 없다 — connectors/nsdi.js 에 추가 필요`);
      }
    } else {
      report('토지이용계획 (VWorld NED)', false, lu.error);
    }
  }

  // ── 5. 건축물대장 ──────────────────────────────────────
  if (parsedPnu && molit.isAvailable()) {
    const b = await molit.buildingRegister(parsedPnu);
    if (b.ok) {
      report('건축물대장 (국토교통부)', true,
        `${b.value.name || '(무명)'} · 연면적 ${b.value.totalAreaSqm}㎡ · 지상 ${b.value.groundFloors}층`,
        ['platArea', 'archArea', 'totArea', 'bcRat', 'vlRat', 'grndFlrCnt'], b.raw);
      const nulls = Object.entries(b.value).filter(([, v]) => v === null).map(([k]) => k);
      if (nulls.length) console.log(`  ⚠ 비어 있는 항목: ${nulls.join(', ')} — 필드명 확인 필요`);
    } else {
      report('건축물대장 (국토교통부)', false, b.error);
    }
  }

  // ── 6. 실거래가 ────────────────────────────────────────
  if (parsedPnu && molit.isAvailable()) {
    const months = pnuUtil.recentMonths(3);
    for (const type of ['land', 'commercial']) {
      const t = await molit.trades(parsedPnu.sigunguCd, months, type);
      if (t.ok) {
        const withPrice = t.value.filter(x => x.pricePerSqm);
        report(`실거래가 (${t.label})`, true,
          `${months.join(',')} · ${t.value.length}건 (단가 산출 ${withPrice.length}건)`);
        if (t.value.length && !withPrice.length) {
          console.log('  ⚠ 거래는 있는데 단가가 안 나온다 — 거래금액/면적 필드명 확인');
          console.log(`    첫 건 원본 필드: ${Object.keys(t.value[0]).join(', ')}`);
        } else if (withPrice.length) {
          const s = withPrice[0];
          console.log(`  예시: ${s.dealDate || s.ym} ${s.dong || ''} ${s.areaSqm}㎡ ${s.dealAmountEok}억원 → ${s.pricePerSqm?.toLocaleString('ko-KR')}원/㎡`);
        }
      } else {
        report(`실거래가 (${type})`, false, t.error);
      }
    }
  }

  // ── 요약 ───────────────────────────────────────────────
  const ok = results.filter(r => r.ok).length;
  console.log('\n' + '─'.repeat(60));
  console.log(`결과: ${ok}/${results.length} 통과`);
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.log(`실패: ${failed.map(f => f.name).join(', ')}`);
    console.log('\n실패 내용과 위의 ⚠ 표시를 그대로 전달하면 Connector 를 실제 응답에 맞게 고칠 수 있다.');
  }
  console.log('\n※ 이 스크립트는 아무것도 저장하지 않았다. 키는 출력에 포함되지 않는다.');
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(e => {
  console.error('\n✕ 진단 중단:', e.message);
  process.exit(1);
});
